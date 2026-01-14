#!/usr/bin/env node
/**
 * CLI for appending metrics to metrics.jsonl
 *
 * Usage:
 *   node metrics-cli.js <prd-folder> <json-data>
 *
 * Arguments:
 *   prd-folder: Path to PRD folder (e.g., .ralph/PRD-1)
 *   json-data: JSON string with metric data
 *
 * Example:
 *   node metrics-cli.js .ralph/PRD-1 '{"storyId":"US-001","duration":120,"agent":"claude"}'
 */
const { appendMetric } = require("./metrics");

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: metrics-cli.js <prd-folder> <json-data>");
    process.exit(1);
  }

  const prdFolder = args[0];
  const jsonData = args[1];

  try {
    const data = JSON.parse(jsonData);
    const result = appendMetric(prdFolder, data);

    if (result.success) {
      console.log(JSON.stringify({ success: true }));
      process.exit(0);
    } else {
      console.error(JSON.stringify({ success: false, error: result.error }));
      process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: `Invalid JSON: ${err.message}` }));
    process.exit(1);
  }
}

main();
