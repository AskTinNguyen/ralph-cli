/**
 * TypeScript Executor for Ralph Build Loop (US-017)
 *
 * Optional TypeScript-based build orchestrator that replaces loop.sh.
 * Enabled via RALPH_EXECUTOR=typescript environment variable.
 *
 * Features:
 * - Story selection with atomic locking
 * - Agent execution with timeout and retry
 * - Verification (tests, lint, type-check)
 * - Git commit and rollback support
 * - Checkpoint/resume capability
 * - Agent switching on failure
 * - Real-time status updates
 *
 * @module lib/executor
 */

const fs = require("fs");
const path = require("path");
const { spawn, execSync } = require("child_process");
const os = require("os");

// Import existing Ralph modules
const checkpointModule = require("../checkpoint");
const storyModule = require("../story");
const stateModule = require("../state");
const failureModule = require("../failure-detection");
const metricsModule = require("../metrics/builder");

/**
 * Default executor configuration
 */
const DEFAULT_CONFIG = {
  // Agent configuration
  defaultAgent: "claude",
  agentFallbackChain: ["claude", "codex", "droid"],
  agentTimeout: 3600, // 60 minutes in seconds
  agentMaxRetries: 3,

  // Iteration limits
  iterationTimeout: 5400, // 90 minutes in seconds
  storyTimeout: 10800, // 3 hours in seconds

  // Verification
  verifyCommands: ["npm test", "npm run lint", "npm run typecheck"],
  verifyOnCommit: true,

  // Git
  autoCommit: true,
  commitPrefix: "feat",

  // Logging
  verbose: false,
  logLevel: "info",
};

/**
 * Build state tracking
 */
class BuildState {
  constructor(prdFolder) {
    this.prdFolder = prdFolder;
    this.iteration = 0;
    this.currentStory = null;
    this.currentAgent = null;
    this.startTime = Date.now();
    this.iterationStartTime = null;
    this.totalCost = 0;
    this.completedStories = [];
    this.failedStories = [];
    this.agentsTried = [];
    this.rollbackCount = 0;
  }

  toJSON() {
    return {
      prdFolder: this.prdFolder,
      iteration: this.iteration,
      currentStory: this.currentStory,
      currentAgent: this.currentAgent,
      startTime: this.startTime,
      totalCost: this.totalCost,
      completedStories: this.completedStories,
      failedStories: this.failedStories,
    };
  }
}

/**
 * Result of a single iteration
 */
class IterationResult {
  constructor() {
    this.success = false;
    this.storyId = null;
    this.storyTitle = null;
    this.duration = 0;
    this.agent = null;
    this.commit = null;
    this.cost = 0;
    this.error = null;
    this.verification = [];
    this.filesChanged = [];
    this.rollbackPerformed = false;
    this.agentSwitched = false;
  }
}

/**
 * Execute a shell command and return output
 * @param {string} cmd - Command to execute
 * @param {Object} options - Execution options
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
function execCommand(cmd, options = {}) {
  return new Promise((resolve) => {
    const { cwd = process.cwd(), timeout = 60000, env = process.env } = options;

    try {
      const stdout = execSync(cmd, {
        cwd,
        timeout,
        encoding: "utf8",
        env,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });

      resolve({ code: 0, stdout: stdout || "", stderr: "" });
    } catch (err) {
      resolve({
        code: err.status || 1,
        stdout: err.stdout || "",
        stderr: err.stderr || err.message,
      });
    }
  });
}

/**
 * Execute agent command with timeout and logging
 * @param {string} agent - Agent name (claude, codex, droid)
 * @param {string} promptFile - Path to rendered prompt
 * @param {string} logFile - Path to output log file
 * @param {Object} options - Execution options
 * @returns {Promise<{success: boolean, code: number, timedOut: boolean}>}
 */
function runAgent(agent, promptFile, logFile, options = {}) {
  return new Promise((resolve) => {
    const { timeout = 3600000, cwd = process.cwd() } = options;

    // Map agent name to command
    const agentCommands = {
      claude: "claude",
      codex: "codex",
      droid: "droid",
    };

    const cmd = agentCommands[agent] || agent;
    const args = ["--print", "--dangerously-skip-permissions", "-p", promptFile];

    const logStream = fs.createWriteStream(logFile, { flags: "a" });
    let timedOut = false;

    const proc = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, FORCE_COLOR: "0" },
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => proc.kill("SIGKILL"), 5000);
    }, timeout);

    proc.stdout.on("data", (data) => {
      logStream.write(data);
    });

    proc.stderr.on("data", (data) => {
      logStream.write(data);
    });

    proc.on("close", (code) => {
      clearTimeout(timeoutId);
      logStream.end();
      resolve({
        success: code === 0 && !timedOut,
        code: code || 0,
        timedOut,
      });
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      logStream.write(`\nError: ${err.message}\n`);
      logStream.end();
      resolve({
        success: false,
        code: 1,
        timedOut: false,
        error: err.message,
      });
    });
  });
}

/**
 * Run verification commands
 * @param {Array<string>} commands - Commands to run
 * @param {string} cwd - Working directory
 * @returns {Promise<Array<{command: string, success: boolean, output: string}>>}
 */
async function runVerification(commands, cwd) {
  const results = [];

  for (const cmd of commands) {
    const result = await execCommand(cmd, { cwd, timeout: 300000 });
    results.push({
      command: cmd,
      success: result.code === 0,
      output: result.stdout + result.stderr,
    });

    // Stop on first failure
    if (result.code !== 0) {
      break;
    }
  }

  return results;
}

/**
 * Get current git HEAD SHA
 * @param {string} cwd - Working directory
 * @returns {string} Git HEAD SHA
 */
function getGitHead(cwd) {
  try {
    const result = execSync("git rev-parse HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim();
  } catch {
    return "";
  }
}

/**
 * Get list of changed files
 * @param {string} cwd - Working directory
 * @returns {Array<string>} List of changed file paths
 */
function getChangedFiles(cwd) {
  try {
    const result = execSync("git diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result
      .trim()
      .split("\n")
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

/**
 * Create a git commit
 * @param {string} message - Commit message
 * @param {string} cwd - Working directory
 * @returns {Promise<{success: boolean, sha: string, error?: string}>}
 */
async function gitCommit(message, cwd) {
  // Stage all changes
  const addResult = await execCommand("git add -A", { cwd });
  if (addResult.code !== 0) {
    return { success: false, sha: "", error: `git add failed: ${addResult.stderr}` };
  }

  // Check if there are changes to commit
  const statusResult = await execCommand("git status --porcelain", { cwd });
  if (!statusResult.stdout.trim()) {
    return { success: true, sha: "", noChanges: true };
  }

  // Commit with co-author
  const fullMessage = `${message}\n\nCo-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>`;
  const commitResult = await execCommand(`git commit -m "${fullMessage.replace(/"/g, '\\"')}"`, { cwd });

  if (commitResult.code !== 0) {
    return { success: false, sha: "", error: `git commit failed: ${commitResult.stderr}` };
  }

  const sha = getGitHead(cwd);
  return { success: true, sha };
}

/**
 * Rollback to a specific commit
 * @param {string} sha - Commit SHA to rollback to
 * @param {string} cwd - Working directory
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function gitRollback(sha, cwd) {
  const result = await execCommand(`git reset --hard ${sha}`, { cwd });
  return {
    success: result.code === 0,
    error: result.code !== 0 ? result.stderr : undefined,
  };
}

/**
 * Render build prompt with story context
 * @param {string} templatePath - Path to prompt template
 * @param {string} outputPath - Path to output rendered prompt
 * @param {Object} storyMeta - Story metadata
 * @param {string} storyBlock - Story markdown content
 * @param {Object} context - Additional context
 */
function renderPrompt(templatePath, outputPath, storyMeta, storyBlock, context = {}) {
  let template = fs.readFileSync(templatePath, "utf8");

  // Replace placeholders
  const replacements = {
    "{{STORY_ID}}": storyMeta.id || "",
    "{{STORY_TITLE}}": storyMeta.title || "",
    "{{STORY_BLOCK}}": storyBlock || "",
    "{{ITERATION}}": context.iteration || 1,
    "{{RUN_TAG}}": context.runTag || "",
    "{{PRD_PATH}}": context.prdPath || "",
    "{{PLAN_PATH}}": context.planPath || "",
  };

  for (const [key, value] of Object.entries(replacements)) {
    template = template.replace(new RegExp(key, "g"), String(value));
  }

  fs.writeFileSync(outputPath, template, "utf8");
}

/**
 * Update .status.json for real-time visibility
 * @param {string} prdFolder - PRD folder path
 * @param {string} phase - Current phase
 * @param {number} iteration - Iteration number
 * @param {string} storyId - Current story ID
 * @param {string} storyTitle - Current story title
 * @param {number} elapsed - Elapsed seconds
 */
function updateStatus(prdFolder, phase, iteration, storyId, storyTitle, elapsed) {
  const statusPath = path.join(prdFolder, ".status.json");
  const status = {
    phase,
    story_id: storyId || "",
    story_title: storyTitle || "",
    iteration,
    elapsed_seconds: elapsed,
    updated_at: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2) + "\n");
  } catch {
    // Ignore status write errors
  }
}

/**
 * Clear status file
 * @param {string} prdFolder - PRD folder path
 */
function clearStatus(prdFolder) {
  const statusPath = path.join(prdFolder, ".status.json");
  try {
    if (fs.existsSync(statusPath)) {
      fs.unlinkSync(statusPath);
    }
  } catch {
    // Ignore
  }
}

/**
 * Main build executor class
 */
class BuildExecutor {
  /**
   * Create a new BuildExecutor
   * @param {Object} options - Executor options
   */
  constructor(options = {}) {
    this.config = { ...DEFAULT_CONFIG, ...options };
    this.state = null;
    this.stateManager = null;
  }

  /**
   * Run the build loop
   * @param {Object} params - Build parameters
   * @param {string} params.prdFolder - Path to PRD-N folder
   * @param {number} params.maxIterations - Maximum iterations to run
   * @param {boolean} params.noCommit - Skip git commits
   * @param {string} params.agent - Override agent
   * @returns {Promise<{success: boolean, iterations: number, results: Array}>}
   */
  async runBuild(params) {
    const { prdFolder, maxIterations = 10, noCommit = false, agent } = params;

    // Initialize state
    this.state = new BuildState(prdFolder);
    this.stateManager = new stateModule.BuildStateManager(prdFolder);

    // Paths
    const planPath = path.join(prdFolder, "plan.md");
    const prdPath = path.join(prdFolder, "prd.md");
    const runsDir = path.join(prdFolder, "runs");
    const rootDir = path.resolve(prdFolder, "../..");
    const promptTemplate = path.join(rootDir, ".agents/ralph/PROMPT_build.md");

    // Ensure runs directory exists
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    // Check for checkpoint/resume
    let startIteration = 1;
    const checkpointResult = checkpointModule.loadCheckpoint(prdFolder);
    if (checkpointResult.success) {
      startIteration = checkpointResult.checkpoint.iteration || 1;
      this.state.currentAgent = checkpointResult.checkpoint.agent;
      console.log(`Resuming from iteration ${startIteration}`);
    }

    // Set default agent
    if (agent) {
      this.state.currentAgent = agent;
    } else if (!this.state.currentAgent) {
      this.state.currentAgent = this.config.defaultAgent;
    }

    const results = [];
    const runTag = `${new Date().toISOString().replace(/[:.]/g, "").substring(0, 15)}`;

    // Log build start
    await this.stateManager.logActivity(`BUILD_START iterations=${maxIterations} agent=${this.state.currentAgent}`);

    // Main iteration loop
    for (let i = startIteration; i <= maxIterations; i++) {
      this.state.iteration = i;
      this.state.iterationStartTime = Date.now();

      console.log(`\n═══════════════════════════════════════════════════════`);
      console.log(`  Running iteration ${i}/${maxIterations}`);
      console.log(`═══════════════════════════════════════════════════════`);

      // Select next story
      const storyResult = await this._selectStory(planPath);
      if (!storyResult.success) {
        if (storyResult.noStories) {
          console.log("No remaining stories. Build complete!");
          break;
        }
        console.error(`Story selection failed: ${storyResult.error}`);
        break;
      }

      this.state.currentStory = storyResult.story;
      const { story } = storyResult;

      console.log(`  Working on: ${story.id} - ${story.title}`);

      // Update status
      const elapsed = Math.floor((Date.now() - this.state.startTime) / 1000);
      updateStatus(prdFolder, "executing", i, story.id, story.title, elapsed);

      // Save checkpoint before execution
      checkpointModule.saveCheckpoint(prdFolder, {
        iteration: i,
        story_id: story.id,
        story_title: story.title,
        agent: this.state.currentAgent,
        git_sha: getGitHead(rootDir),
      });

      // Run iteration
      const iterResult = await this._runIteration({
        story,
        iteration: i,
        runTag,
        prdFolder,
        planPath,
        runsDir,
        rootDir,
        promptTemplate,
        noCommit,
      });

      results.push(iterResult);

      // Log iteration result
      await this.stateManager.logActivity(
        `ITERATION ${i} ${iterResult.success ? "success" : "failed"} story=${story.id} duration=${iterResult.duration}s`
      );

      if (iterResult.success) {
        this.state.completedStories.push(story.id);
        // Mark story complete in plan
        await this.stateManager.updateStoryStatus(planPath, story.id, true);
      } else {
        this.state.failedStories.push(story.id);
        // Try agent switching if configured
        if (this.config.agentFallbackChain.length > 1) {
          const switched = await this._switchAgent();
          if (!switched) {
            console.error(`All agents exhausted for story ${story.id}`);
          }
        }
      }
    }

    // Clear checkpoint on successful completion
    if (this.state.failedStories.length === 0) {
      checkpointModule.clearCheckpoint(prdFolder);
    }

    // Clear status
    clearStatus(prdFolder);

    // Log build complete
    const totalDuration = Math.floor((Date.now() - this.state.startTime) / 1000);
    await this.stateManager.logActivity(
      `BUILD_COMPLETE iterations=${results.length} completed=${this.state.completedStories.length} failed=${this.state.failedStories.length} duration=${totalDuration}s`
    );

    return {
      success: this.state.failedStories.length === 0,
      iterations: results.length,
      completed: this.state.completedStories.length,
      failed: this.state.failedStories.length,
      totalDuration,
      results,
    };
  }

  /**
   * Select the next story to work on
   * @param {string} planPath - Path to plan.md
   * @returns {Promise<{success: boolean, story?: Object, error?: string}>}
   */
  async _selectStory(planPath) {
    try {
      // Use story module's atomic selection
      const result = storyModule.parseStoriesFromFile(planPath);

      // Handle parse result object structure
      if (!result.ok) {
        return { success: false, error: result.error || "Failed to parse stories" };
      }

      const stories = result.stories || [];
      const remaining = storyModule.getRemaining(stories);

      if (remaining.length === 0) {
        return { success: false, noStories: true };
      }

      const story = storyModule.selectNextStory(stories);
      if (!story) {
        return { success: false, noStories: true };
      }

      return { success: true, story };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Run a single iteration
   * @param {Object} params - Iteration parameters
   * @returns {Promise<IterationResult>}
   */
  async _runIteration(params) {
    const { story, iteration, runTag, prdFolder, planPath, runsDir, rootDir, promptTemplate, noCommit } = params;

    const result = new IterationResult();
    result.storyId = story.id;
    result.storyTitle = story.title;
    result.agent = this.state.currentAgent;

    const iterStart = Date.now();
    const headBefore = getGitHead(rootDir);

    // Prepare files
    const logFile = path.join(runsDir, `run-${runTag}-iter-${iteration}.log`);
    const promptFile = path.join(runsDir, `prompt-${runTag}-iter-${iteration}.md`);

    // Render prompt
    renderPrompt(promptTemplate, promptFile, story, story.block || "", {
      iteration,
      runTag,
      prdPath: path.join(prdFolder, "prd.md"),
      planPath,
    });

    // Run agent
    console.log(`  Running ${this.state.currentAgent}...`);
    const agentResult = await runAgent(this.state.currentAgent, promptFile, logFile, {
      timeout: this.config.agentTimeout * 1000,
      cwd: rootDir,
    });

    result.duration = Math.floor((Date.now() - iterStart) / 1000);

    if (!agentResult.success) {
      result.error = agentResult.timedOut
        ? `Agent timed out after ${this.config.agentTimeout}s`
        : `Agent failed with code ${agentResult.code}`;

      // Detect failure type
      if (fs.existsSync(logFile)) {
        const logContent = fs.readFileSync(logFile, "utf8");
        const detection = failureModule.detectFailure(logContent);
        if (detection.hasFailure) {
          result.error += `: ${detection.summary}`;
        }
      }

      // Rollback if needed
      if (headBefore && getGitHead(rootDir) !== headBefore) {
        const rollback = await gitRollback(headBefore, rootDir);
        result.rollbackPerformed = rollback.success;
        this.state.rollbackCount++;
      }

      return result;
    }

    // Get changed files
    result.filesChanged = getChangedFiles(rootDir);

    // Run verification if enabled
    if (this.config.verifyOnCommit && this.config.verifyCommands.length > 0) {
      console.log(`  Running verification...`);
      result.verification = await runVerification(this.config.verifyCommands, rootDir);

      const verifyFailed = result.verification.some((v) => !v.success);
      if (verifyFailed) {
        result.error = "Verification failed";

        // Rollback on verification failure
        if (headBefore && getGitHead(rootDir) !== headBefore) {
          const rollback = await gitRollback(headBefore, rootDir);
          result.rollbackPerformed = rollback.success;
          this.state.rollbackCount++;
        }

        return result;
      }
    }

    // Commit changes
    if (!noCommit && result.filesChanged.length > 0) {
      console.log(`  Committing changes...`);
      const commitMessage = `${this.config.commitPrefix}(${story.id}): ${story.title}`;
      const commitResult = await gitCommit(commitMessage, rootDir);

      if (commitResult.success) {
        result.commit = commitResult.sha;
        result.success = true;
      } else if (commitResult.noChanges) {
        result.success = true;
        console.log(`  No changes to commit`);
      } else {
        result.error = `Commit failed: ${commitResult.error}`;
        return result;
      }
    } else {
      result.success = true;
      if (noCommit) {
        console.log(`  Skipping commit (--no-commit)`);
      }
    }

    console.log(`  ✓ Iteration ${iteration} complete (${result.duration}s)`);
    return result;
  }

  /**
   * Switch to next agent in fallback chain
   * @returns {Promise<boolean>} True if switched successfully
   */
  async _switchAgent() {
    const currentIndex = this.config.agentFallbackChain.indexOf(this.state.currentAgent);
    const nextIndex = currentIndex + 1;

    if (nextIndex >= this.config.agentFallbackChain.length) {
      return false;
    }

    const nextAgent = this.config.agentFallbackChain[nextIndex];
    console.log(`  Switching agent: ${this.state.currentAgent} → ${nextAgent}`);

    this.state.agentsTried.push(this.state.currentAgent);
    this.state.currentAgent = nextAgent;

    await this.stateManager.logActivity(`AGENT_SWITCH from=${this.state.agentsTried.slice(-1)[0]} to=${nextAgent}`);

    return true;
  }
}

/**
 * Check if TypeScript executor should be used
 * @returns {boolean}
 */
function shouldUseTypescriptExecutor() {
  return process.env.RALPH_EXECUTOR === "typescript";
}

/**
 * Run build with TypeScript executor
 * @param {Object} params - Build parameters
 * @returns {Promise<Object>} Build result
 */
async function runTypescriptBuild(params) {
  const executor = new BuildExecutor(params.config || {});
  return executor.runBuild(params);
}

module.exports = {
  BuildExecutor,
  BuildState,
  IterationResult,
  DEFAULT_CONFIG,
  shouldUseTypescriptExecutor,
  runTypescriptBuild,
  // Utility exports for testing
  execCommand,
  runAgent,
  runVerification,
  getGitHead,
  getChangedFiles,
  gitCommit,
  gitRollback,
  renderPrompt,
  updateStatus,
  clearStatus,
};
