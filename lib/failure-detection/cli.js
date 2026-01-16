#!/usr/bin/env node
/**
 * CLI wrapper for failure detection module
 *
 * Usage:
 *   node lib/failure-detection/cli.js <log_file> [options]
 *
 * Options:
 *   --categories=test,lint,type  Comma-separated categories to check
 *   --min-severity=N             Minimum severity (1-4, default: 1)
 *   --format=json|text           Output format (default: json)
 *   --context=N                  Lines of context (default: 2)
 *   --classify                   Only output failure classification
 *   --has-failure                Exit 0 if failure detected, 1 otherwise
 *
 * Examples:
 *   node lib/failure-detection/cli.js run.log
 *   node lib/failure-detection/cli.js run.log --categories=test,lint
 *   node lib/failure-detection/cli.js run.log --format=text
 *   node lib/failure-detection/cli.js run.log --classify
 *   node lib/failure-detection/cli.js run.log --has-failure && echo "Has failures"
 */

const fs = require("fs");
const path = require("path");
const {
  detectFailure,
  classifyFailureType,
  extractErrorContext,
  formatResult,
  getPatternCounts,
} = require("./index");

/**
 * Parse command line arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs(args) {
  const options = {
    logFile: null,
    categories: null,
    minSeverity: 1,
    format: "json",
    contextLines: 2,
    classify: false,
    hasFailure: false,
    help: false,
    stats: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--classify") {
      options.classify = true;
    } else if (arg === "--has-failure") {
      options.hasFailure = true;
    } else if (arg === "--stats") {
      options.stats = true;
    } else if (arg.startsWith("--categories=")) {
      const value = arg.split("=")[1];
      options.categories = value.split(",").map((c) => c.trim());
    } else if (arg.startsWith("--min-severity=")) {
      options.minSeverity = parseInt(arg.split("=")[1], 10);
    } else if (arg.startsWith("--format=")) {
      options.format = arg.split("=")[1];
    } else if (arg.startsWith("--context=")) {
      options.contextLines = parseInt(arg.split("=")[1], 10);
    } else if (!arg.startsWith("-") && !options.logFile) {
      options.logFile = arg;
    }
  }

  return options;
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Failure Detection CLI

Usage:
  node lib/failure-detection/cli.js <log_file> [options]

Options:
  --categories=test,lint,type  Comma-separated categories to check
                               Available: test, lint, type, build, runtime, git
  --min-severity=N             Minimum severity level (1-4, default: 1)
                               1=info, 2=warning, 3=error, 4=critical
  --format=json|text           Output format (default: json)
  --context=N                  Lines of context around matches (default: 2)
  --classify                   Only output failure classification type
  --has-failure                Exit with code 0 if failures found, 1 otherwise
  --stats                      Show pattern statistics
  --help, -h                   Show this help message

Examples:
  # Detect all failures in a log file
  node lib/failure-detection/cli.js run.log

  # Check only for test failures
  node lib/failure-detection/cli.js run.log --categories=test

  # Get human-readable output
  node lib/failure-detection/cli.js run.log --format=text

  # Classify the type of failure
  node lib/failure-detection/cli.js run.log --classify

  # Use in bash conditionals
  node lib/failure-detection/cli.js run.log --has-failure && echo "Failures found"

Bash Integration:
  # In loop.sh
  result=$(node lib/failure-detection/cli.js "$log_file")
  has_failure=$(echo "$result" | jq -r '.hasFailure')

  # Or with --has-failure flag
  if node lib/failure-detection/cli.js "$log_file" --has-failure; then
    echo "Test failures detected"
  fi
`);
}

/**
 * Main CLI entry point
 */
function main() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);

  // Show help
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  // Show stats
  if (options.stats) {
    const counts = getPatternCounts();
    console.log(JSON.stringify(counts, null, 2));
    process.exit(0);
  }

  // Require log file
  if (!options.logFile) {
    console.error("Error: Log file path required");
    console.error('Run with --help for usage information');
    process.exit(1);
  }

  // Read log file
  let logContent;
  try {
    const logPath = path.resolve(options.logFile);
    if (!fs.existsSync(logPath)) {
      console.error(`Error: Log file not found: ${logPath}`);
      process.exit(1);
    }
    logContent = fs.readFileSync(logPath, "utf8");
  } catch (err) {
    console.error(`Error reading log file: ${err.message}`);
    process.exit(1);
  }

  // Classify-only mode
  if (options.classify) {
    const failureType = classifyFailureType(logContent);
    if (options.format === "json") {
      console.log(JSON.stringify({ failureType }));
    } else {
      console.log(failureType);
    }
    process.exit(0);
  }

  // Run detection
  const result = detectFailure(logContent, {
    categories: options.categories,
    minSeverity: options.minSeverity,
    contextLines: options.contextLines,
  });

  // has-failure mode (exit code only)
  if (options.hasFailure) {
    process.exit(result.hasFailure ? 0 : 1);
  }

  // Output result
  if (options.format === "text") {
    console.log(formatResult(result, { showContext: true, color: process.stdout.isTTY }));
  } else {
    // JSON output (default)
    // Simplify context in JSON output
    const jsonResult = {
      hasFailure: result.hasFailure,
      summary: result.summary,
      matches: result.matches.map((m) => ({
        pattern: m.pattern,
        category: m.category,
        severity: m.severity,
        severityLevel: m.severityLevel,
        description: m.description,
        matchedLine: m.matchedLine,
        lineNumber: m.lineNumber,
      })),
    };
    console.log(JSON.stringify(jsonResult, null, 2));
  }

  process.exit(0);
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
