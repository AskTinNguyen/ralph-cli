#!/usr/bin/env node
/**
 * CLI wrapper for BuildStateManager
 *
 * Provides bash integration for transactional state updates.
 *
 * Usage:
 *   node lib/state/cli.js update-iteration <prd-folder> <json-data>
 *   node lib/state/cli.js log-activity <prd-folder> <message>
 *   node lib/state/cli.js add-run-summary <prd-folder> <json-data>
 *   node lib/state/cli.js update-story <plan-path> <story-id> [--uncomplete]
 *   node lib/state/cli.js update-criteria <prd-path> <criteria-text> [--uncomplete]
 *   node lib/state/cli.js batch <prd-folder> <json-updates>
 *
 * @module lib/state/cli
 */

const path = require("path");
const fs = require("fs");
const { BuildStateManager } = require("./index");

/**
 * Parse JSON data from argument or stdin
 * @param {string} arg - JSON string or '-' for stdin
 * @returns {Object} Parsed JSON
 */
function parseJsonArg(arg) {
  if (arg === "-") {
    // Read from stdin
    const input = fs.readFileSync(0, "utf8");
    return JSON.parse(input);
  }
  return JSON.parse(arg);
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
BuildStateManager CLI - Transactional state updates for Ralph

Usage:
  node lib/state/cli.js <command> [arguments]

Commands:
  update-iteration <prd-folder> <json>  Add iteration entry to progress.md
  log-activity <prd-folder> <message>   Add activity entry to activity.log
  add-run-summary <prd-folder> <json>   Add run summary to activity.log
  update-story <plan-path> <story-id>   Mark story as complete in plan.md
  update-criteria <prd-path> <text>     Mark criteria as complete in prd.md
  batch <prd-folder> <json>             Execute batch updates atomically

Options:
  --help, -h          Show this help message
  --uncomplete        For update-story/update-criteria: mark as incomplete
  --json              Output results as JSON (for machine parsing)
  --timeout=<ms>      Lock acquisition timeout in milliseconds (default: 30000)

Examples:
  # Add iteration entry
  node lib/state/cli.js update-iteration .ralph/PRD-67 '{"storyId":"US-001",...}'

  # Log activity
  node lib/state/cli.js log-activity .ralph/PRD-67 "ITERATION 1 start (mode=build)"

  # Add run summary
  node lib/state/cli.js add-run-summary .ralph/PRD-67 '{"run":"20260116","iter":1,"mode":"build",...}'

  # Mark story complete
  node lib/state/cli.js update-story .ralph/PRD-67/plan.md US-001

  # Batch update (JSON array of operations)
  node lib/state/cli.js batch .ralph/PRD-67 '[{"type":"activity","data":{"message":"..."}}]'

  # Read JSON from stdin
  echo '{"storyId":"US-001",...}' | node lib/state/cli.js update-iteration .ralph/PRD-67 -
`);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Parse options
  const options = {};
  const positionalArgs = [];

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--uncomplete") {
      options.uncomplete = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("--timeout=")) {
      options.timeout = parseInt(arg.substring(10), 10);
    } else if (!arg.startsWith("-")) {
      positionalArgs.push(arg);
    }
  }

  const [command, ...commandArgs] = positionalArgs;

  if (!command) {
    console.error("Error: No command specified. Use --help for usage.");
    process.exit(1);
  }

  let result;

  try {
    switch (command) {
      case "update-iteration": {
        const [prdFolder, jsonArg] = commandArgs;
        if (!prdFolder || !jsonArg) {
          console.error("Error: update-iteration requires <prd-folder> and <json-data>");
          process.exit(1);
        }

        const data = parseJsonArg(jsonArg);
        const manager = new BuildStateManager(prdFolder, {
          maxWaitMs: options.timeout || 30000,
        });

        result = await manager.addIteration(data);
        break;
      }

      case "log-activity": {
        const [prdFolder, message] = commandArgs;
        if (!prdFolder || !message) {
          console.error("Error: log-activity requires <prd-folder> and <message>");
          process.exit(1);
        }

        const manager = new BuildStateManager(prdFolder, {
          maxWaitMs: options.timeout || 30000,
        });

        result = await manager.logActivity(message);
        break;
      }

      case "add-run-summary": {
        const [prdFolder, jsonArg] = commandArgs;
        if (!prdFolder || !jsonArg) {
          console.error("Error: add-run-summary requires <prd-folder> and <json-data>");
          process.exit(1);
        }

        const data = parseJsonArg(jsonArg);
        const manager = new BuildStateManager(prdFolder, {
          maxWaitMs: options.timeout || 30000,
        });

        result = await manager.addRunSummary(data);
        break;
      }

      case "update-story": {
        const [planPath, storyId] = commandArgs;
        if (!planPath || !storyId) {
          console.error("Error: update-story requires <plan-path> and <story-id>");
          process.exit(1);
        }

        const prdFolder = path.dirname(planPath);
        const manager = new BuildStateManager(prdFolder, {
          maxWaitMs: options.timeout || 30000,
        });

        result = await manager.updateStoryStatus(planPath, storyId, !options.uncomplete);
        break;
      }

      case "update-criteria": {
        const [prdPath, criteriaText] = commandArgs;
        if (!prdPath || !criteriaText) {
          console.error("Error: update-criteria requires <prd-path> and <criteria-text>");
          process.exit(1);
        }

        const prdFolder = path.dirname(prdPath);
        const manager = new BuildStateManager(prdFolder, {
          maxWaitMs: options.timeout || 30000,
        });

        result = await manager.updateCriteriaStatus(prdPath, criteriaText, !options.uncomplete);
        break;
      }

      case "batch": {
        const [prdFolder, jsonArg] = commandArgs;
        if (!prdFolder || !jsonArg) {
          console.error("Error: batch requires <prd-folder> and <json-updates>");
          process.exit(1);
        }

        const updates = parseJsonArg(jsonArg);
        if (!Array.isArray(updates)) {
          console.error("Error: batch updates must be a JSON array");
          process.exit(1);
        }

        const manager = new BuildStateManager(prdFolder, {
          maxWaitMs: options.timeout || 30000,
        });

        result = await manager.batchUpdate(updates);
        break;
      }

      default:
        console.error(`Error: Unknown command '${command}'. Use --help for usage.`);
        process.exit(1);
    }

    // Output result
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      if (result.success) {
        console.log("Success");
        if (result.updated !== undefined) {
          console.log(`Updated: ${result.updated}`);
        }
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
    }

    process.exit(result.success ? 0 : 1);
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ success: false, error: err.message }));
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
