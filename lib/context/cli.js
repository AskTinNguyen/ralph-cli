#!/usr/bin/env node
/**
 * Context CLI - command-line interface for context selection and visualization
 *
 * Usage:
 *   node lib/context/cli.js --story "Story text" --model sonnet --format markdown
 *   node lib/context/cli.js --story-file path/to/story.md --limit 20
 *
 * Outputs context selection summary to stdout in the requested format.
 */

const fs = require("fs");
const path = require("path");

const {
  selectRelevantFiles,
  selectWithBudget,
  formatContextSummary,
  getCompactSummary,
} = require("./index");

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    story: null,
    storyFile: null,
    projectRoot: process.cwd(),
    model: "sonnet",
    limit: 10,
    format: "markdown", // markdown, json, compact
    budget: null,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    switch (arg) {
      case "--story":
      case "-s":
        options.story = next;
        i++;
        break;
      case "--story-file":
      case "-f":
        options.storyFile = next;
        i++;
        break;
      case "--project-root":
      case "-p":
        options.projectRoot = next;
        i++;
        break;
      case "--model":
      case "-m":
        options.model = next;
        i++;
        break;
      case "--limit":
      case "-l":
        options.limit = parseInt(next, 10);
        i++;
        break;
      case "--format":
        options.format = next;
        i++;
        break;
      case "--budget":
      case "-b":
        options.budget = parseInt(next, 10);
        i++;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
    }
  }

  return options;
}

/**
 * Print usage information
 */
function printUsage() {
  console.log(`
Context Selection CLI

Usage:
  node lib/context/cli.js [options]

Options:
  --story, -s <text>        Story text to analyze
  --story-file, -f <path>   Path to file containing story text
  --project-root, -p <path> Project root directory (default: cwd)
  --model, -m <name>        Model name for budget calculation (default: sonnet)
  --limit, -l <n>           Maximum files to select (default: 10)
  --budget, -b <tokens>     Override automatic budget with specific token count
  --format <type>           Output format: markdown, json, compact (default: markdown)
  --help, -h                Show this help message

Examples:
  # Select context for a story using model-based budget
  node lib/context/cli.js -s "Update lib/context/scorer.js" -m sonnet

  # Output JSON format for programmatic use
  node lib/context/cli.js -s "Fix authentication" --format json

  # Use story from file
  node lib/context/cli.js -f .ralph/PRD-1/current-story.txt
`);
}

/**
 * Main entry point
 */
function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  if (options.help) {
    printUsage();
    process.exit(0);
  }

  // Get story text
  let storyText = options.story;

  if (options.storyFile) {
    try {
      storyText = fs.readFileSync(options.storyFile, "utf-8");
    } catch (err) {
      console.error(`Error reading story file: ${err.message}`);
      process.exit(1);
    }
  }

  if (!storyText) {
    console.error("Error: No story text provided. Use --story or --story-file.");
    printUsage();
    process.exit(1);
  }

  // Perform context selection
  let selection;

  if (options.budget) {
    // Use explicit budget
    selection = selectRelevantFiles(storyText, {
      projectRoot: options.projectRoot,
      limit: options.limit,
      budget: options.budget,
      model: options.model,
    });
  } else {
    // Use model-based budget calculation
    selection = selectWithBudget(storyText, {
      projectRoot: options.projectRoot,
      limit: options.limit,
      model: options.model,
    });
  }

  // Output in requested format
  switch (options.format) {
    case "json":
      console.log(JSON.stringify(selection, null, 2));
      break;

    case "compact":
      console.log(getCompactSummary(selection));
      break;

    case "markdown":
    default:
      console.log(formatContextSummary(selection));
      break;
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
