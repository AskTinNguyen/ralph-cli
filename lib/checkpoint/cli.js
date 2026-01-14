#!/usr/bin/env node
/**
 * CLI helper for checkpoint operations
 *
 * Called from loop.sh to save/load/clear checkpoints via node.
 *
 * Usage:
 *   node lib/checkpoint/cli.js save <prd-folder> <json-data>
 *   node lib/checkpoint/cli.js load <prd-folder>
 *   node lib/checkpoint/cli.js clear <prd-folder>
 *   node lib/checkpoint/cli.js list <ralph-dir>
 *   node lib/checkpoint/cli.js exists <prd-folder>
 *   node lib/checkpoint/cli.js --help
 */
const { saveCheckpoint, loadCheckpoint, clearCheckpoint, listCheckpoints, hasCheckpoint, CHECKPOINT_VERSION } = require("./index");

function printUsage() {
  console.log(`
Checkpoint CLI - manage build checkpoints for resumable builds

Usage:
  node lib/checkpoint/cli.js <command> [options]

Commands:
  save <prd-folder> <json-data>   Save a checkpoint to the PRD folder
  load <prd-folder>               Load and print checkpoint from PRD folder
  clear <prd-folder>              Remove checkpoint from PRD folder
  list <ralph-dir>                List all checkpoints across PRD folders
  exists <prd-folder>             Check if checkpoint exists (exit 0 if yes, 1 if no)

Options:
  --help, -h                      Show this help message
  --version, -v                   Show checkpoint schema version

Examples:
  # Save a checkpoint
  node lib/checkpoint/cli.js save .ralph/PRD-1 '{"prd_id":1,"iteration":3,"story_id":"US-005","git_sha":"abc123"}'

  # Load a checkpoint
  node lib/checkpoint/cli.js load .ralph/PRD-1

  # Clear a checkpoint
  node lib/checkpoint/cli.js clear .ralph/PRD-1

  # List all checkpoints
  node lib/checkpoint/cli.js list .ralph

  # Check if checkpoint exists
  node lib/checkpoint/cli.js exists .ralph/PRD-1 && echo "Checkpoint found"

Schema version: ${CHECKPOINT_VERSION}
`);
}

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  if (args.includes("--version") || args.includes("-v")) {
    console.log(`Checkpoint schema version: ${CHECKPOINT_VERSION}`);
    process.exit(0);
  }

  const command = args[0];

  switch (command) {
    case "save": {
      if (args.length < 3) {
        console.error("Error: save requires <prd-folder> and <json-data> arguments");
        process.exit(1);
      }
      const prdFolder = args[1];
      const jsonData = args[2];

      let data;
      try {
        data = JSON.parse(jsonData);
      } catch (err) {
        console.error(`Error: Invalid JSON data: ${err.message}`);
        process.exit(1);
      }

      const result = saveCheckpoint(prdFolder, data);
      if (result.success) {
        console.log(JSON.stringify({ success: true, path: result.path }));
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case "load": {
      if (args.length < 2) {
        console.error("Error: load requires <prd-folder> argument");
        process.exit(1);
      }
      const prdFolder = args[1];

      const result = loadCheckpoint(prdFolder);
      if (result.success) {
        console.log(JSON.stringify(result.checkpoint, null, 2));
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(result.notFound ? 2 : 1);
      }
      break;
    }

    case "clear": {
      if (args.length < 2) {
        console.error("Error: clear requires <prd-folder> argument");
        process.exit(1);
      }
      const prdFolder = args[1];

      const result = clearCheckpoint(prdFolder);
      if (result.success) {
        console.log(JSON.stringify({ success: true }));
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case "list": {
      if (args.length < 2) {
        console.error("Error: list requires <ralph-dir> argument");
        process.exit(1);
      }
      const ralphDir = args[1];

      const result = listCheckpoints(ralphDir);
      if (result.success) {
        if (result.checkpoints.length === 0) {
          console.log("No checkpoints found.");
        } else {
          console.log(JSON.stringify(result.checkpoints, null, 2));
        }
      } else {
        console.error(`Error: ${result.error}`);
        process.exit(1);
      }
      break;
    }

    case "exists": {
      if (args.length < 2) {
        console.error("Error: exists requires <prd-folder> argument");
        process.exit(1);
      }
      const prdFolder = args[1];

      if (hasCheckpoint(prdFolder)) {
        console.log("true");
        process.exit(0);
      } else {
        console.log("false");
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`Error: Unknown command '${command}'`);
      printUsage();
      process.exit(1);
  }
}

main();
