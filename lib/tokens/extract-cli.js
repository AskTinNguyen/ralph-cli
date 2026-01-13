#!/usr/bin/env node
/**
 * CLI helper for token extraction from run logs
 *
 * Usage:
 *   node extract-cli.js <log-file>
 *   node extract-cli.js --from-stdin
 *
 * Output (JSON):
 *   { "inputTokens": N, "outputTokens": N, "model": "...", "estimated": bool }
 */
const fs = require("fs");
const { extractTokensWithFallback } = require("./extractor");

function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Usage: node extract-cli.js <log-file> | --from-stdin");
    process.exit(1);
  }

  let content;

  if (args[0] === "--from-stdin") {
    // Read from stdin
    content = fs.readFileSync(0, "utf-8");
  } else {
    // Read from file
    const logFile = args[0];
    if (!fs.existsSync(logFile)) {
      console.error(`File not found: ${logFile}`);
      process.exit(1);
    }
    content = fs.readFileSync(logFile, "utf-8");
  }

  const tokens = extractTokensWithFallback(content, { useEstimation: true });

  console.log(JSON.stringify(tokens));
}

main();
