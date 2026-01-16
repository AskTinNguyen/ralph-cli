#!/usr/bin/env node
/**
 * CLI wrapper for story selection module
 *
 * Provides bash integration for atomic story selection.
 *
 * Usage:
 *   node lib/story/cli.js select-and-lock <prd_path>
 *   node lib/story/cli.js select <prd_path>
 *   node lib/story/cli.js select-and-lock <prd_path> <meta_out> <block_out>
 *   node lib/story/cli.js list <prd_path>
 *   node lib/story/cli.js remaining <prd_path>
 *   node lib/story/cli.js field <meta_file> <field_name>
 *
 * Examples:
 *   # Atomic story selection with locking (for parallel builds)
 *   node lib/story/cli.js select-and-lock .ralph/PRD-1/prd.md
 *
 *   # Select and write to output files (bash integration)
 *   node lib/story/cli.js select-and-lock .ralph/PRD-1/prd.md /tmp/meta.json /tmp/block.txt
 *
 *   # Simple selection (no locking, for read-only)
 *   node lib/story/cli.js select .ralph/PRD-1/prd.md
 *
 *   # Get remaining story count
 *   node lib/story/cli.js remaining .ralph/PRD-1/prd.md
 *
 * @module lib/story/cli
 */

const fs = require("fs");
const path = require("path");
const {
  selectAndLock,
  selectStory,
  parseStoriesFromFile,
  getRemaining,
  getSummary,
  storyField,
} = require("./index");

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Story Selection CLI (US-015)

Usage:
  node lib/story/cli.js <command> <args...>

Commands:
  select-and-lock <prd_path> [meta_out] [block_out]
      Atomic story selection with file locking for parallel builds.
      Outputs JSON to stdout, or writes to files if paths provided.

  select <prd_path> [meta_out] [block_out]
      Simple story selection (no locking, for read-only operations).

  list <prd_path>
      List all stories with their status.

  remaining <prd_path>
      Print count of remaining stories.

  field <meta_file> <field_name>
      Extract a field from story metadata JSON file.

Options:
  --help, -h        Show this help message
  --json            Output in JSON format (default for most commands)
  --timeout=<ms>    Lock timeout in milliseconds (default: 30000)

Examples:
  # Select next story with locking (parallel-safe)
  node lib/story/cli.js select-and-lock .ralph/PRD-1/prd.md

  # Write outputs to files (bash integration)
  node lib/story/cli.js select-and-lock .ralph/PRD-1/prd.md /tmp/meta.json /tmp/block.txt

  # Get story count
  node lib/story/cli.js remaining .ralph/PRD-1/prd.md

  # Extract story ID from metadata
  node lib/story/cli.js field /tmp/meta.json id

Bash Integration:
  # In loop.sh - atomic selection
  result=$(node lib/story/cli.js select-and-lock "$PRD_PATH")
  story_id=$(echo "$result" | jq -r '.id // empty')

  # Or with file outputs
  node lib/story/cli.js select-and-lock "$PRD_PATH" "$META_FILE" "$BLOCK_FILE"
  story_id=$(jq -r '.id // empty' "$META_FILE")
`);
}

/**
 * Handle select-and-lock command
 */
async function handleSelectAndLock(args) {
  const prdPath = args[0];
  const metaOut = args[1];
  const blockOut = args[2];
  const timeout = parseInt(getOption(args, "--timeout") || "30000", 10);

  if (!prdPath) {
    console.error("Error: PRD path required");
    console.error('Usage: select-and-lock <prd_path> [meta_out] [block_out]');
    process.exit(1);
  }

  const result = await selectAndLock(prdPath, { maxWaitMs: timeout });

  // Write to output files if provided
  if (metaOut) {
    const meta = {
      ok: result.ok,
      total: result.total || 0,
      remaining: result.remaining || 0,
    };
    if (result.ok && result.story) {
      meta.id = result.id;
      meta.title = result.title;
    }
    if (result.error) {
      meta.error = result.error;
    }
    fs.writeFileSync(metaOut, JSON.stringify(meta, null, 2) + "\n", "utf8");
  }

  if (blockOut) {
    const block = result.ok && result.block ? result.block : "";
    fs.writeFileSync(blockOut, block, "utf8");
  }

  // Output to stdout
  console.log(JSON.stringify(result, null, 2));

  // Exit with error code if failed
  if (!result.ok) {
    process.exit(1);
  }
}

/**
 * Handle select command (no locking)
 */
function handleSelect(args) {
  const prdPath = args[0];
  const metaOut = args[1];
  const blockOut = args[2];

  if (!prdPath) {
    console.error("Error: PRD path required");
    console.error('Usage: select <prd_path> [meta_out] [block_out]');
    process.exit(1);
  }

  const result = selectStory(prdPath);

  // Write to output files if provided
  if (metaOut) {
    const meta = {
      ok: result.ok,
      total: result.total || 0,
      remaining: result.remaining || 0,
    };
    if (result.ok && result.story) {
      meta.id = result.id;
      meta.title = result.title;
    }
    if (result.error) {
      meta.error = result.error;
    }
    fs.writeFileSync(metaOut, JSON.stringify(meta, null, 2) + "\n", "utf8");
  }

  if (blockOut) {
    const block = result.ok && result.block ? result.block : "";
    fs.writeFileSync(blockOut, block, "utf8");
  }

  // Output to stdout
  console.log(JSON.stringify(result, null, 2));

  if (!result.ok) {
    process.exit(1);
  }
}

/**
 * Handle list command
 */
function handleList(args) {
  const prdPath = args[0];

  if (!prdPath) {
    console.error("Error: PRD path required");
    console.error('Usage: list <prd_path>');
    process.exit(1);
  }

  const result = parseStoriesFromFile(prdPath);

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  // Format output
  const output = {
    ok: true,
    total: result.total,
    completed: result.completed,
    pending: result.pending,
    stories: result.stories.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      lineNumber: s.lineNumber,
    })),
  };

  console.log(JSON.stringify(output, null, 2));
}

/**
 * Handle remaining command
 */
function handleRemaining(args) {
  const prdPath = args[0];

  if (!prdPath) {
    console.error("Error: PRD path required");
    console.error('Usage: remaining <prd_path>');
    process.exit(1);
  }

  const result = parseStoriesFromFile(prdPath);

  if (!result.ok) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  // Match the output format of the bash remaining_stories function
  console.log(result.pending);
}

/**
 * Handle field command
 */
function handleField(args) {
  const metaFile = args[0];
  const fieldName = args[1];

  if (!metaFile || !fieldName) {
    console.error("Error: Both meta file and field name required");
    console.error('Usage: field <meta_file> <field_name>');
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(metaFile, "utf8");
    const data = JSON.parse(content);
    const value = data[fieldName];

    // Match bash story_field output (print empty string if not found)
    console.log(value !== undefined ? value : "");
  } catch (err) {
    console.error(`Error reading field: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Get option value from args
 */
function getOption(args, name) {
  for (const arg of args) {
    if (arg.startsWith(`${name}=`)) {
      return arg.split("=")[1];
    }
  }
  return null;
}

/**
 * Check if args contain flag
 */
function hasFlag(args, name) {
  return args.includes(name);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for help
  if (args.length === 0 || hasFlag(args, "--help") || hasFlag(args, "-h")) {
    printHelp();
    process.exit(0);
  }

  const command = args[0];
  const commandArgs = args.slice(1).filter((a) => !a.startsWith("--"));

  switch (command) {
    case "select-and-lock":
      await handleSelectAndLock(commandArgs);
      break;
    case "select":
      handleSelect(commandArgs);
      break;
    case "list":
      handleList(commandArgs);
      break;
    case "remaining":
      handleRemaining(commandArgs);
      break;
    case "field":
      handleField(commandArgs);
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.error('Run with --help for usage information');
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
