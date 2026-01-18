/**
 * Factory Executor - Stage Execution Engine
 *
 * Executes factory stages via existing Ralph commands (loop.sh, stream.sh).
 * Handles parallel execution, conditions, loops, and retries.
 *
 * @module lib/factory/executor
 */
const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");

const parser = require("./parser");
const scheduler = require("./scheduler");
const verifier = require("./verifier");

/**
 * Stage execution status
 */
const StageStatus = {
  PENDING: "pending",
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
};

/**
 * Create a stage executor instance
 */
class StageExecutor extends EventEmitter {
  constructor(factory, context, runDir, projectRoot, options = {}) {
    super();
    this.factory = factory;
    this.context = context;
    this.runDir = runDir;
    this.projectRoot = projectRoot;
    this.options = options;
    this.stageResults = new Map();
    this.runningProcesses = new Map();
    this.stopped = false;
  }

  /**
   * Execute a single stage
   * @param {Object} stage - Stage configuration
   * @returns {Promise<Object>} Stage result
   */
  async executeStage(stage) {
    const stageDir = path.join(this.runDir, "stages", stage.id);
    fs.mkdirSync(stageDir, { recursive: true });

    const startTime = Date.now();
    const result = {
      stageId: stage.id,
      status: StageStatus.PENDING,
      startedAt: new Date().toISOString(),
      completedAt: null,
      duration: 0,
      output: {},
      error: null,
    };

    try {
      // Check condition
      if (stage.condition) {
        const resolvedCondition = parser.resolveTemplate(
          stage.condition,
          this.context
        );
        const conditionMet = parser.evaluateExpression(
          resolvedCondition,
          this.context
        );

        if (!conditionMet) {
          result.status = StageStatus.SKIPPED;
          result.output.reason = "Condition not met";
          this.emit("stage:skipped", { stage, result });
          return result;
        }
      }

      // Update context with current stage
      this.context.current_stage = stage.id;
      result.status = StageStatus.RUNNING;
      this.emit("stage:started", { stage, result });

      // Execute based on type
      let stageOutput;
      switch (stage.type) {
        case "prd":
          stageOutput = await this.executePrdStage(stage, stageDir);
          break;
        case "plan":
          stageOutput = await this.executePlanStage(stage, stageDir);
          break;
        case "build":
          stageOutput = await this.executeBuildStage(stage, stageDir);
          break;
        case "custom":
          stageOutput = await this.executeCustomStage(stage, stageDir);
          break;
        case "factory":
          stageOutput = await this.executeNestedFactory(stage, stageDir);
          break;
        default:
          throw new Error(`Unknown stage type: ${stage.type}`);
      }

      result.output = stageOutput;

      // Check if stage output indicates failure
      // Handlers may return: { success: bool } or { passed: bool, failed: bool }
      // Check all possible indicators of failure
      let stagePassed = true;
      let stageFailed = false;

      // Check 'success' field (used by PRD, Plan, Build handlers)
      if (stageOutput.success !== undefined) {
        stagePassed = stageOutput.success;
        stageFailed = !stageOutput.success;
      }
      // Check 'passed'/'failed' fields (used by Custom handler)
      if (stageOutput.passed !== undefined) {
        stagePassed = stageOutput.passed;
      }
      if (stageOutput.failed !== undefined) {
        stageFailed = stageOutput.failed;
      }
      // Check exit_code for shell commands
      if (stageOutput.exit_code !== undefined && stageOutput.exit_code !== 0) {
        stagePassed = false;
        stageFailed = true;
      }

      // ========================================================================
      // VERIFICATION GATE - Cannot be bypassed by agent output manipulation
      // ========================================================================
      // Run verification checks if configured for this stage
      // Verification checks actual artifacts, git history, and test results
      // NOT the agent's claimed output
      if (stage.verify && stagePassed) {
        this.emit("verification:start", { stage, verifiers: stage.verify });

        const verifyResult = verifier.runAllVerifications(
          stage.verify,
          this.context,
          this.projectRoot
        );

        result.verification = verifyResult;

        if (verifyResult.status === verifier.VerificationStatus.FAILED) {
          // Verification failed - override the stage's claimed success
          stagePassed = false;
          stageFailed = true;
          result.error = `Verification failed: ${verifyResult.message}`;

          this.emit("verification:failed", {
            stage,
            result: verifyResult,
          });
        } else {
          this.emit("verification:passed", {
            stage,
            result: verifyResult,
          });
        }
      }
      // ========================================================================

      if (stageFailed) {
        result.status = StageStatus.FAILED;
        result.error = result.error || stageOutput.error_summary || `Stage ${stage.id} failed`;
      } else {
        result.status = StageStatus.COMPLETED;
      }

      // Update context with stage results
      this.context.stages = this.context.stages || {};
      this.context.stages[stage.id] = {
        ...stageOutput,
        completed: true,
        passed: stagePassed,
        failed: stageFailed,
        verification: result.verification,
      };
    } catch (err) {
      result.status = StageStatus.FAILED;
      result.error = err.message;

      // Update context with failure
      this.context.stages = this.context.stages || {};
      this.context.stages[stage.id] = {
        completed: true,
        passed: false,
        failed: true,
        error: err.message,
        error_summary: err.message.slice(0, 200),
      };
    }

    result.completedAt = new Date().toISOString();
    result.duration = Date.now() - startTime;

    // Save stage result
    fs.writeFileSync(
      path.join(stageDir, "result.json"),
      JSON.stringify(result, null, 2)
    );

    this.stageResults.set(stage.id, result);

    if (result.status === StageStatus.COMPLETED) {
      this.emit("stage:completed", { stage, result });
    } else if (result.status === StageStatus.FAILED) {
      this.emit("stage:failed", { stage, result });
    }

    return result;
  }

  /**
   * Execute PRD generation stage
   */
  async executePrdStage(stage, stageDir) {
    const input = parser.resolveTemplates(stage.input, this.context);
    const request = input.request || "";

    // Create request file
    const requestFile = path.join(stageDir, "request.txt");
    fs.writeFileSync(requestFile, request);

    // Get the next PRD number
    const ralphDir = path.join(this.projectRoot, ".ralph");
    const prdNumber = this.getNextPrdNumber(ralphDir);

    // Debug: Log PATH to diagnose environment issues
    const debugLogPath = path.join(stageDir, "env-debug.log");
    fs.writeFileSync(debugLogPath, `PATH=${process.env.PATH}\nHOME=${process.env.HOME}\n`);

    // Get timeout from stage config (default: 10 minutes for PRD)
    const timeout = stage.config?.timeout || stage.timeout || 600000;

    // Execute ralph prd
    const args = ["prd", request, "--headless"];
    const result = await this.runRalphCommand(args, {
      env: {
        PRD_NUMBER: String(prdNumber),
        // Explicitly include HOME and PATH to ensure shell compatibility
        HOME: process.env.HOME,
        PATH: process.env.PATH,
      },
      timeout,
    });

    // Extract PRD path from output or determine from number
    const prdPath = path.join(ralphDir, `PRD-${prdNumber}`, "prd.md");

    return {
      prd_number: prdNumber,
      prd_path: prdPath,
      request,
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * Execute planning stage
   */
  async executePlanStage(stage, stageDir) {
    // Get PRD number from context or dependencies
    const prdNumber = this.getPrdNumberFromContext(stage);

    if (!prdNumber) {
      throw new Error("No PRD number found for planning stage");
    }

    // Get timeout from stage config (default: 10 minutes for planning)
    const timeout = stage.config?.timeout || stage.timeout || 600000;

    // Execute ralph plan
    const args = ["plan", `--prd=${prdNumber}`];
    const result = await this.runRalphCommand(args, { timeout });

    // Parse plan to get story count
    const ralphDir = path.join(this.projectRoot, ".ralph");
    const planPath = path.join(ralphDir, `PRD-${prdNumber}`, "plan.md");

    let storiesCount = 0;
    if (fs.existsSync(planPath)) {
      const planContent = fs.readFileSync(planPath, "utf8");
      const storyMatches = planContent.match(/###\s*\[\s*\]/g);
      storiesCount = storyMatches ? storyMatches.length : 0;
    }

    return {
      prd_number: prdNumber,
      plan_path: planPath,
      stories_count: storiesCount,
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * Execute build stage
   */
  async executeBuildStage(stage, stageDir) {
    const prdNumber = this.getPrdNumberFromContext(stage);

    if (!prdNumber) {
      throw new Error("No PRD number found for build stage");
    }

    const iterations = stage.config.iterations || 5;
    const useWorktree = stage.config.use_worktree || false;

    // Get timeout from stage config (default: 1 hour for builds)
    const timeout = stage.config.timeout || stage.timeout || 3600000;

    // Build command
    let args;
    if (useWorktree) {
      args = ["stream", "build", String(prdNumber), String(iterations)];
    } else {
      args = ["build", String(iterations), `--prd=${prdNumber}`];
    }

    const result = await this.runRalphCommand(args, { timeout });

    // Get progress summary
    const ralphDir = path.join(this.projectRoot, ".ralph");
    const progressPath = path.join(
      ralphDir,
      `PRD-${prdNumber}`,
      "progress.md"
    );

    let completedStories = 0;
    if (fs.existsSync(progressPath)) {
      const progressContent = fs.readFileSync(progressPath, "utf8");
      const completedMatches = progressContent.match(/###\s*\[x\]/gi);
      completedStories = completedMatches ? completedMatches.length : 0;
    }

    return {
      prd_number: prdNumber,
      iterations,
      completed_stories: completedStories,
      success: result.exitCode === 0,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * Execute custom command stage
   */
  async executeCustomStage(stage, stageDir) {
    const command = parser.resolveTemplate(stage.command, this.context);

    // Log file for output
    const logFile = path.join(stageDir, "output.log");

    const result = await this.runShellCommand(command, {
      cwd: this.projectRoot,
      logFile,
    });

    // Determine pass/fail based on exit code
    const passed = result.exitCode === 0;

    // Try to parse test results if this looks like a test command
    let testResults = null;
    if (
      command.includes("test") ||
      command.includes("jest") ||
      command.includes("mocha")
    ) {
      testResults = this.parseTestOutput(result.stdout + result.stderr);
    }

    return {
      command,
      passed,
      failed: !passed,
      exit_code: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      test_results: testResults,
      failures: testResults?.failures || [],
      error_summary: !passed ? result.stderr.slice(0, 500) : null,
    };
  }

  /**
   * Execute nested factory stage
   */
  async executeNestedFactory(stage, stageDir) {
    const factoryRef = stage.factory;

    // Nested factory execution
    const factoryModule = require("./index");

    const result = await factoryModule.runFactory(
      this.projectRoot,
      factoryRef,
      {
        variables: {
          ...this.context,
          parent_stage: stage.id,
        },
      }
    );

    return {
      factory: factoryRef,
      run_id: result.runId,
      success: result.success,
      state: result.state,
      error: result.error,
    };
  }

  /**
   * Run a Ralph CLI command
   */
  async runRalphCommand(args, options = {}) {
    // Check multiple locations for ralph binary
    const possiblePaths = [
      path.join(this.projectRoot, "bin/ralph"),              // Development (in ralph-cli repo)
      path.join(this.projectRoot, "node_modules/.bin/ralph"), // Installed as dependency
    ];

    let ralphScript = null;
    for (const binPath of possiblePaths) {
      if (fs.existsSync(binPath)) {
        ralphScript = binPath;
        break;
      }
    }

    // If we found a local ralph script, run it with node explicitly
    // This avoids issues with shebang interpretation and PATH
    if (ralphScript) {
      // Destructure to separate env from other options
      // This prevents ...restOptions from overwriting our constructed env
      const { env: optionsEnv, ...restOptions } = options;

      return this.runCommand(process.execPath, [ralphScript, ...args], {
        cwd: this.projectRoot,
        ...restOptions,
        env: {
          ...process.env,
          RALPH_ROOT: path.join(this.projectRoot, ".ralph"),
          ...optionsEnv,
        },
      });
    }

    // Fall back to global ralph (uses shell to find it)
    const { env: optionsEnv, ...restOptions } = options;
    return this.runShellCommand(`ralph ${args.join(" ")}`, {
      cwd: this.projectRoot,
      ...restOptions,
      env: {
        ...process.env,
        RALPH_ROOT: path.join(this.projectRoot, ".ralph"),
        ...optionsEnv,
      },
    });
  }

  /**
   * Run a shell command
   */
  async runShellCommand(command, options = {}) {
    const shell = process.platform === "win32" ? "cmd" : "bash";
    const shellArgs =
      process.platform === "win32" ? ["/c", command] : ["-c", command];

    return this.runCommand(shell, shellArgs, options);
  }

  /**
   * Run a command and capture output
   */
  runCommand(cmd, args, options = {}) {
    return new Promise((resolve) => {
      const { cwd, env, timeout, logFile, stdio } = options;

      // Default stdio: provide stdin from /dev/null for non-interactive execution
      // This fixes Claude Code "No messages returned" error when run in background
      let defaultStdio = ["ignore", "pipe", "pipe"];
      let stdinFd = null;

      if (!stdio) {
        const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
        try {
          stdinFd = fs.openSync(nullDevice, "r");
          defaultStdio = [stdinFd, "pipe", "pipe"];
        } catch (err) {
          // Fall back to ignore if /dev/null can't be opened
        }
      }

      const proc = spawn(cmd, args, {
        cwd: cwd || this.projectRoot,
        env: env || process.env,
        shell: false,
        stdio: stdio || defaultStdio,
      });

      // Track running process
      const procId = `${cmd}-${Date.now()}`;
      this.runningProcesses.set(procId, proc);

      let stdout = "";
      let stderr = "";
      let logStream = null;

      if (logFile) {
        logStream = fs.createWriteStream(logFile);
      }

      proc.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        if (logStream) logStream.write(text);
        this.emit("output", { type: "stdout", data: text });
      });

      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        if (logStream) logStream.write(text);
        this.emit("output", { type: "stderr", data: text });
      });

      let timeoutId = null;
      if (timeout && timeout > 0) {
        timeoutId = setTimeout(() => {
          proc.kill("SIGTERM");
          stderr += "\n[TIMEOUT] Process killed after timeout";
        }, timeout);
      }

      proc.on("close", (code) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (logStream) logStream.end();
        // Close stdin fd if we opened it
        if (stdinFd !== null) {
          try { fs.closeSync(stdinFd); } catch {}
        }
        this.runningProcesses.delete(procId);

        resolve({
          exitCode: code,
          stdout,
          stderr,
        });
      });

      proc.on("error", (err) => {
        if (timeoutId) clearTimeout(timeoutId);
        if (logStream) logStream.end();
        // Close stdin fd if we opened it
        if (stdinFd !== null) {
          try { fs.closeSync(stdinFd); } catch {}
        }
        this.runningProcesses.delete(procId);

        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + `\n[ERROR] ${err.message}`,
        });
      });
    });
  }

  /**
   * Stop all running processes
   */
  stop() {
    this.stopped = true;
    for (const [id, proc] of this.runningProcesses.entries()) {
      try {
        proc.kill("SIGTERM");
      } catch {
        // Ignore
      }
    }
    this.runningProcesses.clear();
  }

  /**
   * Get the next PRD number
   */
  getNextPrdNumber(ralphDir) {
    if (!fs.existsSync(ralphDir)) {
      return 1;
    }

    let max = 0;
    const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && /^PRD-\d+$/i.test(entry.name)) {
        const num = parseInt(entry.name.split("-")[1], 10);
        if (num > max) max = num;
      }
    }

    return max + 1;
  }

  /**
   * Get PRD number from context based on stage dependencies
   */
  getPrdNumberFromContext(stage) {
    // Check direct input
    if (stage.input?.prd_number) {
      return stage.input.prd_number;
    }

    // Check context stages for PRD output
    if (this.context.stages) {
      for (const dep of stage.depends_on || []) {
        const depResult = this.context.stages[dep];
        if (depResult?.prd_number) {
          return depResult.prd_number;
        }
      }
    }

    // Check latest factory run output
    if (this.context.prd_number) {
      return this.context.prd_number;
    }

    return null;
  }

  /**
   * Parse test output for failures
   */
  parseTestOutput(output) {
    const results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      failures: [],
    };

    // Jest/Mocha style output
    const summaryMatch = output.match(
      /(\d+)\s*(passing|passed)|(\d+)\s*(failing|failed)|(\d+)\s*(pending|skipped)/gi
    );
    if (summaryMatch) {
      for (const match of summaryMatch) {
        const num = parseInt(match.match(/\d+/)[0], 10);
        if (/passing|passed/i.test(match)) results.passed = num;
        if (/failing|failed/i.test(match)) results.failed = num;
        if (/pending|skipped/i.test(match)) results.skipped = num;
      }
      results.total = results.passed + results.failed + results.skipped;
    }

    // Extract failure messages
    const failureBlocks = output.match(/✖|FAIL|AssertionError[\s\S]*?(?=\n\n|\n✖|$)/g);
    if (failureBlocks) {
      results.failures = failureBlocks.slice(0, 5); // First 5 failures
    }

    return results;
  }
}

/**
 * Execute a factory's stages in order
 * @param {Object} factory - Parsed factory configuration
 * @param {Array} executionOrder - Ordered list of stage IDs
 * @param {Object} context - Execution context
 * @param {string} runDir - Run directory for outputs
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution result
 */
async function executeFactory(
  factory,
  executionOrder,
  context,
  runDir,
  projectRoot,
  options = {}
) {
  const executor = new StageExecutor(
    factory,
    context,
    runDir,
    projectRoot,
    options
  );

  const completedStages = [];
  const failedStages = [];
  const skippedStages = [];

  // Build lookup map
  const stageMap = new Map(factory.stages.map((s) => [s.id, s]));

  // Track recursion for loops
  const recursionCounts = new Map();

  // Event handlers for logging
  if (options.onStageStart) {
    executor.on("stage:started", options.onStageStart);
  }
  if (options.onStageComplete) {
    executor.on("stage:completed", options.onStageComplete);
  }
  if (options.onStageFail) {
    executor.on("stage:failed", options.onStageFail);
  }
  if (options.onOutput) {
    executor.on("output", options.onOutput);
  }

  let currentIndex = 0;
  let success = true;

  // Track global loop count (for loops that go back to earlier stages)
  let globalLoopCount = 0;

  while (currentIndex < executionOrder.length && !executor.stopped) {
    const stageId = executionOrder[currentIndex];
    const stage = stageMap.get(stageId);

    if (!stage) {
      currentIndex++;
      continue;
    }

    // Use global loop count for recursion tracking (more intuitive for users)
    context.recursion_count = globalLoopCount;

    // Execute stage
    const result = await executor.executeStage(stage);

    if (result.status === StageStatus.COMPLETED) {
      completedStages.push(stageId);

      // Check for loop
      if (stage.loop_to) {
        // Find loop target index
        const loopTargetIndex = executionOrder.indexOf(stage.loop_to);
        if (loopTargetIndex >= 0 && loopTargetIndex < currentIndex) {
          // Check recursion limit
          const maxRecursion = factory.variables?.max_recursion || 3;
          if (globalLoopCount < maxRecursion) {
            globalLoopCount++;
            currentIndex = loopTargetIndex;
            continue;
          }
        }
      }
    } else if (result.status === StageStatus.FAILED) {
      failedStages.push(stageId);
      success = false;

      // Check retry configuration
      if (stage.config?.retries && stage.config.retries > 0) {
        // TODO: Implement retry logic
      }

      // Stop on failure unless continue_on_failure is set
      if (!options.continueOnFailure) {
        break;
      }
    } else if (result.status === StageStatus.SKIPPED) {
      skippedStages.push(stageId);
    }

    currentIndex++;
  }

  // Cleanup
  executor.stop();

  return {
    success,
    completedStages,
    failedStages,
    skippedStages,
    stageResults: Object.fromEntries(executor.stageResults),
    error: failedStages.length > 0
      ? `Failed stages: ${failedStages.join(", ")}`
      : null,
  };
}

/**
 * Execute stages in parallel groups
 * @param {Object} factory - Parsed factory configuration
 * @param {Object} context - Execution context
 * @param {string} runDir - Run directory for outputs
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution result
 */
async function executeParallel(
  factory,
  context,
  runDir,
  projectRoot,
  options = {}
) {
  const graph = scheduler.buildDependencyGraph(factory.stages);
  const parallelGroups = scheduler.getParallelGroups(graph);

  const executor = new StageExecutor(
    factory,
    context,
    runDir,
    projectRoot,
    options
  );

  const completedStages = [];
  const failedStages = [];
  let success = true;

  for (const group of parallelGroups) {
    if (executor.stopped) break;

    // Get stages in this group
    const stages = group.map((id) => graph.nodes.get(id));

    // Execute in parallel
    const results = await Promise.all(
      stages.map((stage) => executor.executeStage(stage))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const stage = stages[i];

      if (result.status === StageStatus.COMPLETED) {
        completedStages.push(stage.id);
      } else if (result.status === StageStatus.FAILED) {
        failedStages.push(stage.id);
        success = false;
      }
    }

    // Check merge strategy for failed stages
    if (failedStages.length > 0 && !options.continueOnFailure) {
      // Check if any remaining stages depend on failed stages
      break;
    }
  }

  executor.stop();

  return {
    success,
    completedStages,
    failedStages,
    stageResults: Object.fromEntries(executor.stageResults),
  };
}

module.exports = {
  StageStatus,
  StageExecutor,
  executeFactory,
  executeParallel,
};
