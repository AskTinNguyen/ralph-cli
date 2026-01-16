#!/usr/bin/env node
/**
 * CLI wrapper for TypeScript executor (US-017)
 *
 * Usage:
 *   node lib/executor/cli.js run <prd-folder> [options]
 *   node lib/executor/cli.js check
 *
 * Options:
 *   --iterations=N    Maximum iterations (default: 10)
 *   --no-commit       Skip git commits
 *   --agent=NAME      Override agent (claude, codex, droid)
 *   --json            Output JSON result
 *   --verbose         Verbose output
 *
 * Environment:
 *   RALPH_EXECUTOR=typescript  Enable TypeScript executor
 */

const path = require("path");
const {
  BuildExecutor,
  DEFAULT_CONFIG,
  shouldUseTypescriptExecutor,
  runTypescriptBuild,
} = require("./index");

// Parse command line arguments
function parseArgs(args) {
  const result = {
    command: null,
    prdFolder: null,
    iterations: 10,
    noCommit: false,
    agent: null,
    json: false,
    verbose: false,
    help: false,
  };

  let positionalIndex = 0;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--json") {
      result.json = true;
    } else if (arg === "--verbose" || arg === "-v") {
      result.verbose = true;
    } else if (arg === "--no-commit") {
      result.noCommit = true;
    } else if (arg.startsWith("--iterations=")) {
      result.iterations = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--agent=")) {
      result.agent = arg.split("=")[1];
    } else if (!arg.startsWith("-")) {
      if (positionalIndex === 0) {
        result.command = arg;
      } else if (positionalIndex === 1) {
        result.prdFolder = arg;
      }
      positionalIndex++;
    }
  }

  return result;
}

// Print help message
function printHelp() {
  console.log(`
Ralph TypeScript Executor CLI (US-017)

Usage:
  executor run <prd-folder> [options]   Run build with TypeScript executor
  executor check                        Check if TypeScript executor is enabled

Options:
  --iterations=N    Maximum iterations (default: 10)
  --no-commit       Skip git commits
  --agent=NAME      Override agent (claude, codex, droid)
  --json            Output JSON result
  --verbose         Verbose output
  --help, -h        Show this help message

Environment:
  RALPH_EXECUTOR=typescript   Enable TypeScript executor (required for 'run')

Examples:
  # Check if TypeScript executor is enabled
  executor check

  # Run build with TypeScript executor
  RALPH_EXECUTOR=typescript executor run .ralph/PRD-1 --iterations=5

  # Run with specific agent
  RALPH_EXECUTOR=typescript executor run .ralph/PRD-1 --agent=codex --no-commit
`);
}

// Check command - verify TypeScript executor is available/enabled
function cmdCheck(args, json) {
  const enabled = shouldUseTypescriptExecutor();
  const nodeVersion = process.version;
  const modulesAvailable = {
    checkpoint: (() => {
      try {
        require("../checkpoint");
        return true;
      } catch {
        return false;
      }
    })(),
    story: (() => {
      try {
        require("../story");
        return true;
      } catch {
        return false;
      }
    })(),
    state: (() => {
      try {
        require("../state");
        return true;
      } catch {
        return false;
      }
    })(),
    "failure-detection": (() => {
      try {
        require("../failure-detection");
        return true;
      } catch {
        return false;
      }
    })(),
  };

  const allModulesAvailable = Object.values(modulesAvailable).every((v) => v);

  const result = {
    enabled,
    ready: enabled && allModulesAvailable,
    nodeVersion,
    modules: modulesAvailable,
    config: DEFAULT_CONFIG,
  };

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`TypeScript Executor Status:`);
    console.log(`  Enabled: ${enabled ? "yes" : "no"} (RALPH_EXECUTOR=${process.env.RALPH_EXECUTOR || "not set"})`);
    console.log(`  Ready: ${result.ready ? "yes" : "no"}`);
    console.log(`  Node.js: ${nodeVersion}`);
    console.log(`  Modules:`);
    for (const [name, available] of Object.entries(modulesAvailable)) {
      console.log(`    - ${name}: ${available ? "✓" : "✗"}`);
    }
    if (!enabled) {
      console.log(`\nTo enable: export RALPH_EXECUTOR=typescript`);
    }
  }

  return result.ready ? 0 : 1;
}

// Run command - execute build with TypeScript executor
async function cmdRun(args) {
  const { prdFolder, iterations, noCommit, agent, json, verbose } = args;

  if (!prdFolder) {
    console.error("Error: PRD folder path required");
    console.error("Usage: executor run <prd-folder> [options]");
    return 1;
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(prdFolder);

  // Verify PRD folder exists
  const fs = require("fs");
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: PRD folder not found: ${resolvedPath}`);
    return 1;
  }

  // Verify plan.md exists
  const planPath = path.join(resolvedPath, "plan.md");
  if (!fs.existsSync(planPath)) {
    console.error(`Error: plan.md not found in ${resolvedPath}`);
    return 1;
  }

  // Check if TypeScript executor is enabled
  if (!shouldUseTypescriptExecutor()) {
    console.error("Error: TypeScript executor not enabled");
    console.error("Set RALPH_EXECUTOR=typescript to enable");
    return 1;
  }

  if (!json) {
    console.log(`Starting TypeScript executor...`);
    console.log(`  PRD folder: ${resolvedPath}`);
    console.log(`  Iterations: ${iterations}`);
    console.log(`  Agent: ${agent || "default (claude)"}`);
    console.log(`  No commit: ${noCommit}`);
    console.log("");
  }

  try {
    const result = await runTypescriptBuild({
      prdFolder: resolvedPath,
      maxIterations: iterations,
      noCommit,
      agent,
      config: {
        verbose,
      },
    });

    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`\n═══════════════════════════════════════════════════════`);
      console.log(`  Build ${result.success ? "✓ COMPLETE" : "✗ FAILED"}`);
      console.log(`═══════════════════════════════════════════════════════`);
      console.log(`  Iterations: ${result.iterations}`);
      console.log(`  Completed: ${result.completed}`);
      console.log(`  Failed: ${result.failed}`);
      console.log(`  Duration: ${result.totalDuration}s`);
    }

    return result.success ? 0 : 1;
  } catch (err) {
    if (json) {
      console.log(JSON.stringify({ success: false, error: err.message }, null, 2));
    } else {
      console.error(`Error: ${err.message}`);
      if (verbose) {
        console.error(err.stack);
      }
    }
    return 1;
  }
}

// Main entry point
async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  let exitCode = 0;

  switch (args.command) {
    case "check":
      exitCode = cmdCheck(args, args.json);
      break;

    case "run":
      exitCode = await cmdRun(args);
      break;

    default:
      if (args.command) {
        console.error(`Unknown command: ${args.command}`);
      }
      printHelp();
      exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
