/**
 * Ralph factory command
 * Meta-orchestration layer for factorial-style agent workflows
 */
const fs = require("fs");
const path = require("path");
const { error, success, info, dim, pc, hasFlag, parseFlag } = require("../cli");

// Factory module
const factory = require("../factory");
const scheduler = require("../factory/scheduler");

module.exports = {
  name: "factory",
  description: "Meta-orchestration for factorial-style agent workflows",
  usage: "ralph factory <subcommand> [options]",

  help: `
${pc.bold("ralph factory")} - Meta-orchestration for factorial-style agent workflows

${pc.bold("Subcommands:")}
  ${pc.cyan("init")} [name]              Initialize a new factory
  ${pc.cyan("run")} [name]               Execute a factory
  ${pc.cyan("status")} [name]            Show factory status
  ${pc.cyan("stop")} [name]              Stop running factory
  ${pc.cyan("resume")} [name]            Resume from checkpoint
  ${pc.cyan("stages")} [name]            List factory stages
  ${pc.cyan("rerun")} [name] [stage]     Re-run a specific stage
  ${pc.cyan("skip")} [name] [stage]      Skip a stage
  ${pc.cyan("learnings")} [name]         Show project learnings
  ${pc.cyan("inject")} [name] --ctx=""   Inject context
  ${pc.cyan("graph")} [name]             Visualize execution graph

${pc.bold("Options:")}
  ${pc.dim("--var=key=value")}          Set variable (can be used multiple times)
  ${pc.dim("--template=basic|full")}    Template for init (default: basic)
  ${pc.dim("--force")}                  Force overwrite existing factory
  ${pc.dim("--run-id=ID")}              Target specific run
  ${pc.dim("--continue")}               Continue on stage failure

${pc.bold("Examples:")}
  ${pc.dim("ralph factory init myflow")}                    Create new factory
  ${pc.dim("ralph factory init --template=full")}           Create with full template
  ${pc.dim('ralph factory run --var="user_request=Add auth"')}  Run with variable
  ${pc.dim("ralph factory status")}                         Show active run status
  ${pc.dim("ralph factory graph")}                          View execution graph
`,

  /**
   * Run the factory command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd() } = options;

    // Check for help flag
    if (hasFlag(args, "help") || args.length < 2) {
      console.log(this.help);
      return 0;
    }

    const subcommand = args[1];
    const subArgs = args.slice(2);

    switch (subcommand) {
      case "init":
        return this.cmdInit(subArgs, cwd);
      case "run":
        return this.cmdRun(subArgs, cwd);
      case "status":
        return this.cmdStatus(subArgs, cwd);
      case "stop":
        return this.cmdStop(subArgs, cwd);
      case "resume":
        return this.cmdResume(subArgs, cwd);
      case "stages":
        return this.cmdStages(subArgs, cwd);
      case "rerun":
        return this.cmdRerun(subArgs, cwd);
      case "skip":
        return this.cmdSkip(subArgs, cwd);
      case "learnings":
        return this.cmdLearnings(subArgs, cwd);
      case "inject":
        return this.cmdInject(subArgs, cwd);
      case "graph":
        return this.cmdGraph(subArgs, cwd);
      default:
        error(`Unknown subcommand: ${pc.bold(subcommand)}`);
        info(`Run ${pc.cyan("ralph factory help")} for available commands.`);
        return 1;
    }
  },

  /**
   * Initialize a new factory
   */
  async cmdInit(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";
    const template = parseFlag(args, "template") || "basic";
    const force = hasFlag(args, "force");

    info(`Initializing factory: ${pc.bold(name)}`);

    const result = factory.initFactory(cwd, name, { template, force });

    if (!result.success) {
      error(result.error);
      return 1;
    }

    success(`Factory initialized: ${pc.cyan(result.path)}`);
    console.log("");
    dim("Next steps:");
    console.log(`  1. Edit factory config: ${pc.dim(result.path)}`);
    console.log(`  2. Run factory: ${pc.dim(`ralph factory run ${name}`)}`);

    return 0;
  },

  /**
   * Run a factory
   */
  async cmdRun(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";
    const continueOnFailure = hasFlag(args, "continue");

    // Parse variables from --var=key=value flags
    const variables = {};
    for (const arg of args) {
      if (arg.startsWith("--var=")) {
        const varPart = arg.slice(6);
        const eqIdx = varPart.indexOf("=");
        if (eqIdx > 0) {
          const key = varPart.slice(0, eqIdx);
          const value = varPart.slice(eqIdx + 1);
          variables[key] = value;
        }
      }
    }

    // Check if factory exists
    if (!factory.factoryExists(cwd, name)) {
      error(`Factory '${name}' not found.`);
      info(`Run ${pc.cyan(`ralph factory init ${name}`)} to create one.`);
      return 1;
    }

    console.log("");
    console.log(
      `${pc.cyan("═".repeat(50))}`
    );
    console.log(`${pc.bold("Factory Run:")} ${name}`);
    console.log(
      `${pc.cyan("═".repeat(50))}`
    );
    console.log("");

    // Show variables if any
    if (Object.keys(variables).length > 0) {
      dim("Variables:");
      for (const [key, value] of Object.entries(variables)) {
        console.log(`  ${key}: ${pc.cyan(value)}`);
      }
      console.log("");
    }

    // Run factory with event handlers for progress
    const result = await factory.runFactory(cwd, name, {
      variables,
      continueOnFailure,
      onStageStart: ({ stage }) => {
        console.log(`${pc.yellow("▶")} Starting stage: ${pc.bold(stage.id)}`);
      },
      onStageComplete: ({ stage, result }) => {
        console.log(
          `${pc.green("✓")} Completed: ${pc.bold(stage.id)} ${pc.dim(`(${result.duration}ms)`)}`
        );
      },
      onStageFail: ({ stage, result }) => {
        console.log(`${pc.red("✗")} Failed: ${pc.bold(stage.id)}`);
        if (result.error) {
          error(`  ${result.error}`);
        }
      },
    });

    console.log("");

    if (result.success) {
      success(`Factory completed successfully!`);
      console.log(`Run ID: ${pc.cyan(result.runId)}`);
    } else {
      error(`Factory execution failed.`);
      if (result.error) {
        error(result.error);
      }
      console.log(`Run ID: ${pc.cyan(result.runId)}`);
      info(`Resume with: ${pc.dim(`ralph factory resume ${name}`)}`);
    }

    return result.success ? 0 : 1;
  },

  /**
   * Show factory status
   */
  async cmdStatus(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";

    const status = factory.getFactoryStatus(cwd, name);

    console.log("");
    console.log(
      `${pc.cyan("═".repeat(50))}`
    );
    console.log(`${pc.bold("Factory Status:")} ${name}`);
    console.log(
      `${pc.cyan("═".repeat(50))}`
    );
    console.log("");

    if (status.runs.length === 0) {
      dim("No runs found.");
      info(`Start with: ${pc.dim(`ralph factory run ${name}`)}`);
      return 0;
    }

    // Show active run if any
    if (status.activeRun) {
      console.log(`${pc.yellow("▶")} ${pc.bold("Active Run:")}`);
      this.printRunSummary(status.activeRun);
      console.log("");
    }

    // Show recent runs
    console.log(`${pc.bold("Recent Runs:")}`);
    console.log("");

    const recentRuns = status.runs.slice(0, 5);
    for (const run of recentRuns) {
      this.printRunSummary(run);
    }

    if (status.runs.length > 5) {
      dim(`  ... and ${status.runs.length - 5} more runs`);
    }

    return 0;
  },

  /**
   * Print a run summary
   */
  printRunSummary(run) {
    const statusIcon =
      run.status === "completed"
        ? pc.green("✓")
        : run.status === "failed"
          ? pc.red("✗")
          : run.status === "running"
            ? pc.yellow("▶")
            : pc.dim("○");

    console.log(`  ${statusIcon} ${pc.bold(run.runId)}`);
    console.log(`    Status: ${this.colorStatus(run.status)}`);
    console.log(`    Started: ${pc.dim(run.startedAt)}`);

    if (run.completedAt) {
      console.log(`    Completed: ${pc.dim(run.completedAt)}`);
    }

    if (run.completedStages?.length > 0) {
      console.log(
        `    Completed stages: ${pc.green(run.completedStages.length)}`
      );
    }

    if (run.failedStages?.length > 0) {
      console.log(`    Failed stages: ${pc.red(run.failedStages.join(", "))}`);
    }

    console.log("");
  },

  /**
   * Color status text
   */
  colorStatus(status) {
    switch (status) {
      case "completed":
        return pc.green(status);
      case "failed":
        return pc.red(status);
      case "running":
        return pc.yellow(status);
      case "stopped":
        return pc.cyan(status);
      default:
        return pc.dim(status);
    }
  },

  /**
   * Stop a running factory
   */
  async cmdStop(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";
    const runId = parseFlag(args, "run-id");

    const result = factory.stopFactory(cwd, name, runId);

    if (!result.success) {
      error(result.error);
      return 1;
    }

    success("Factory stopped.");
    return 0;
  },

  /**
   * Resume a factory run
   */
  async cmdResume(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";
    const runId = parseFlag(args, "run-id");
    const continueOnFailure = hasFlag(args, "continue");

    info(`Resuming factory: ${pc.bold(name)}`);

    const result = await factory.resumeFactory(cwd, name, runId, {
      continueOnFailure,
      onStageStart: ({ stage }) => {
        console.log(`${pc.yellow("▶")} Starting stage: ${pc.bold(stage.id)}`);
      },
      onStageComplete: ({ stage }) => {
        console.log(`${pc.green("✓")} Completed: ${pc.bold(stage.id)}`);
      },
      onStageFail: ({ stage, result }) => {
        console.log(`${pc.red("✗")} Failed: ${pc.bold(stage.id)}`);
        if (result.error) {
          error(`  ${result.error}`);
        }
      },
    });

    if (result.success) {
      success("Factory completed successfully!");
    } else {
      error(`Factory execution failed: ${result.error}`);
    }

    return result.success ? 0 : 1;
  },

  /**
   * List factory stages
   */
  async cmdStages(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";

    const result = factory.listStages(cwd, name);

    if (!result.success) {
      error(result.error);
      return 1;
    }

    console.log("");
    console.log(`${pc.bold("Factory Stages:")} ${name}`);
    console.log(`${pc.dim("─".repeat(50))}`);
    console.log("");

    for (const stage of result.stages) {
      const depStr =
        stage.depends_on?.length > 0
          ? pc.dim(` ← [${stage.depends_on.join(", ")}]`)
          : "";

      const condStr = stage.condition ? pc.yellow(" (conditional)") : "";
      const loopStr = stage.loop_to ? pc.cyan(` ↺ ${stage.loop_to}`) : "";

      console.log(
        `  ${pc.bold(stage.id)} ${pc.dim(`(${stage.type})`)}${depStr}${condStr}${loopStr}`
      );

      if (stage.config?.iterations) {
        dim(`    iterations: ${stage.config.iterations}`);
      }
      if (stage.command) {
        dim(`    command: ${stage.command}`);
      }
    }

    console.log("");
    return 0;
  },

  /**
   * Re-run a specific stage
   */
  async cmdRerun(args, cwd) {
    const name = args[0] || "factory";
    const stageId = args[1];

    if (!stageId) {
      error("Stage ID required.");
      info(`Usage: ${pc.dim("ralph factory rerun <factory> <stage>")}`);
      return 1;
    }

    error("Stage re-run not yet implemented.");
    return 1;
  },

  /**
   * Skip a stage
   */
  async cmdSkip(args, cwd) {
    const name = args[0] || "factory";
    const stageId = args[1];

    if (!stageId) {
      error("Stage ID required.");
      info(`Usage: ${pc.dim("ralph factory skip <factory> <stage>")}`);
      return 1;
    }

    error("Stage skip not yet implemented.");
    return 1;
  },

  /**
   * Show project learnings
   */
  async cmdLearnings(args, cwd) {
    const learnings = factory.getLearnings(cwd);

    console.log("");
    console.log(`${pc.bold("Project Learnings")}`);
    console.log(`${pc.dim("─".repeat(50))}`);
    console.log("");

    if (learnings.learnings.length === 0) {
      dim("No learnings recorded yet.");
      info("Learnings are automatically collected from factory runs.");
      return 0;
    }

    for (const learning of learnings.learnings.slice(-10)) {
      const typeIcon =
        learning.type === "failure"
          ? pc.red("✗")
          : learning.type === "test_failure"
            ? pc.yellow("⚠")
            : pc.dim("○");

      console.log(`  ${typeIcon} ${pc.bold(learning.type)}`);
      console.log(`    Stage: ${pc.dim(learning.stage_id || "unknown")}`);
      console.log(`    Added: ${pc.dim(learning.added_at || learning.addedAt)}`);

      if (learning.error) {
        console.log(`    Error: ${pc.dim(learning.error.slice(0, 100))}`);
      }
      if (learning.summary) {
        console.log(`    Summary: ${pc.dim(learning.summary)}`);
      }

      console.log("");
    }

    if (learnings.learnings.length > 10) {
      dim(`  Showing last 10 of ${learnings.learnings.length} learnings`);
    }

    return 0;
  },

  /**
   * Inject context
   */
  async cmdInject(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";
    const ctx = parseFlag(args, "ctx");

    if (!ctx) {
      error("Context required.");
      info(`Usage: ${pc.dim('ralph factory inject <factory> --ctx="key=value"')}`);
      return 1;
    }

    error("Context injection not yet implemented.");
    return 1;
  },

  /**
   * Visualize execution graph
   */
  async cmdGraph(args, cwd) {
    const name = args.find((a) => !a.startsWith("--")) || "factory";

    // Load and parse factory
    const factoryDir = factory.getFactoryDir(cwd);
    const configPath = path.join(factoryDir, `${name}.yaml`);

    if (!fs.existsSync(configPath)) {
      error(`Factory '${name}' not found.`);
      return 1;
    }

    const parseResult = factory.parser.parseFactory(configPath);
    if (!parseResult.success) {
      error(`Failed to parse factory: ${parseResult.error}`);
      return 1;
    }

    // Build graph and visualize
    const graph = scheduler.buildDependencyGraph(parseResult.factory.stages);
    const visualization = scheduler.visualizeGraph(graph);

    console.log("");
    console.log(visualization);
    console.log("");

    return 0;
  },
};
