#!/usr/bin/env node
/**
 * CLI for metrics builder - Type-safe metrics record creation
 *
 * Replaces the 27-argument bash function with JSON object input.
 * Backward compatible with existing metrics.jsonl format.
 *
 * Usage:
 *   # Append metrics to PRD folder
 *   node lib/metrics/cli.js <prd-folder> <json-data>
 *   echo '<json-data>' | node lib/metrics/cli.js <prd-folder> -
 *
 *   # Build without writing (validate/transform only)
 *   node lib/metrics/cli.js --build <json-data>
 *   echo '<json-data>' | node lib/metrics/cli.js --build -
 *
 *   # Validate JSON data
 *   node lib/metrics/cli.js --validate <json-data>
 *
 * Arguments:
 *   prd-folder: Path to PRD folder (e.g., .ralph/PRD-1)
 *   json-data: JSON string or '-' to read from stdin
 *
 * Options:
 *   --build      Build and output JSON without writing to file
 *   --validate   Validate JSON data and report errors
 *   --pretty     Pretty-print JSON output
 *   --help       Show help
 *
 * Example:
 *   node lib/metrics/cli.js .ralph/PRD-1 '{"storyId":"US-001","duration":120,"agent":"claude","status":"success"}'
 *
 * @module lib/metrics/cli
 */

const fs = require("fs");
const path = require("path");
const { buildMetrics, serializeMetrics, validateMetrics, parseMetricsInput } = require("./builder");

/**
 * Read input from stdin
 * @returns {Promise<string>} Stdin content
 */
async function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");

    // Handle piped input
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }

    process.stdin.on("readable", () => {
      let chunk;
      while ((chunk = process.stdin.read()) !== null) {
        data += chunk;
      }
    });

    process.stdin.on("end", () => {
      resolve(data.trim());
    });

    process.stdin.on("error", reject);

    // Timeout after 5 seconds if no input
    setTimeout(() => {
      if (data === "") {
        resolve("");
      }
    }, 5000);
  });
}

/**
 * Get metrics file path for a PRD folder
 * @param {string} prdFolder - Path to PRD folder
 * @returns {string} Path to metrics.jsonl
 */
function getMetricsPath(prdFolder) {
  return path.join(prdFolder, "runs", "metrics.jsonl");
}

/**
 * Append a metric record to the metrics file
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} record - Built metrics record
 * @returns {Object} { success: boolean, error?: string, path?: string }
 */
function appendMetric(prdFolder, record) {
  try {
    const metricsPath = getMetricsPath(prdFolder);
    const runsDir = path.dirname(metricsPath);

    // Create runs directory if it doesn't exist
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    // Serialize and append
    const line = serializeMetrics(record);
    fs.appendFileSync(metricsPath, line + "\n", "utf-8");

    return {
      success: true,
      path: metricsPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to append metric: ${err.message}`,
    };
  }
}

/**
 * Print help message
 */
function printHelp() {
  console.log(`
Ralph Metrics Builder CLI

Usage:
  node lib/metrics/cli.js <prd-folder> <json-data>    Append metrics to PRD
  node lib/metrics/cli.js --build <json-data>          Build JSON without writing
  node lib/metrics/cli.js --validate <json-data>       Validate JSON data

Arguments:
  prd-folder     Path to PRD folder (e.g., .ralph/PRD-1)
  json-data      JSON string or '-' to read from stdin

Options:
  --build        Build and output JSON without writing to file
  --validate     Validate JSON data and report errors
  --pretty       Pretty-print JSON output
  --help         Show this help

Examples:
  # Append metrics to PRD-1
  node lib/metrics/cli.js .ralph/PRD-1 '{"storyId":"US-001","duration":120,"agent":"claude","status":"success"}'

  # Build from stdin
  echo '{"storyId":"US-002","status":"error"}' | node lib/metrics/cli.js --build -

  # Validate data
  node lib/metrics/cli.js --validate '{"storyId":"US-001"}'

Input Fields:
  storyId          Story identifier (required)
  storyTitle       Story title
  duration         Duration in seconds
  inputTokens      Input token count
  outputTokens     Output token count
  agent            Agent type (claude, codex, droid)
  model            Model name
  status           Status (success, error)
  runId            Run identifier
  iteration        Iteration number
  retryCount       Number of retries
  retryTime        Retry wait time (seconds)
  complexityScore  Complexity score (0-10)
  routingReason    Routing decision reason
  estimatedCost    Estimated cost
  rollbackCount    Number of rollbacks
  rollbackReason   Rollback reason
  rollbackSuccess  Whether rollback succeeded
  switchCount      Agent switches
  agents           Agents tried (array or comma-separated)
  failureType      Failure type (timeout, error, quality)
  experimentName   Experiment name
  experimentVariant Experiment variant
  experimentExcluded Excluded from experiment
  timestamp        ISO 8601 timestamp (auto-generated if missing)
`.trim());
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Handle help
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  // Parse flags
  const flags = {
    build: args.includes("--build"),
    validate: args.includes("--validate"),
    pretty: args.includes("--pretty"),
  };

  // Remove flags from args
  const positionalArgs = args.filter((arg) => !arg.startsWith("--"));

  // Determine mode and get input
  let jsonInput;
  let prdFolder;

  if (flags.build || flags.validate) {
    // --build or --validate mode: just need JSON data
    if (positionalArgs.length < 1) {
      console.error("Usage: metrics/cli.js --build|--validate <json-data>");
      process.exit(1);
    }
    jsonInput = positionalArgs[0];
  } else {
    // Append mode: need PRD folder and JSON data
    if (positionalArgs.length < 2) {
      console.error("Usage: metrics/cli.js <prd-folder> <json-data>");
      console.error("Or: metrics/cli.js --build <json-data>");
      process.exit(1);
    }
    prdFolder = positionalArgs[0];
    jsonInput = positionalArgs[1];
  }

  // Read from stdin if '-'
  if (jsonInput === "-") {
    jsonInput = await readStdin();
    if (!jsonInput) {
      console.error("Error: No input received from stdin");
      process.exit(1);
    }
  }

  try {
    // Parse and build metrics
    const record = parseMetricsInput(jsonInput);

    // Validate mode
    if (flags.validate) {
      const validation = validateMetrics(record);
      if (validation.valid) {
        console.log(JSON.stringify({ valid: true }));
        process.exit(0);
      } else {
        console.log(
          JSON.stringify({
            valid: false,
            errors: validation.errors,
          })
        );
        process.exit(1);
      }
    }

    // Build mode - just output the record
    if (flags.build) {
      if (flags.pretty) {
        console.log(JSON.stringify(record, null, 2));
      } else {
        console.log(serializeMetrics(record));
      }
      process.exit(0);
    }

    // Append mode - write to file
    const result = appendMetric(prdFolder, record);

    if (result.success) {
      console.log(JSON.stringify({ success: true }));
      process.exit(0);
    } else {
      console.error(JSON.stringify({ success: false, error: result.error }));
      process.exit(1);
    }
  } catch (err) {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({ success: false, error: err.message }));
    process.exit(1);
  });
}

module.exports = {
  getMetricsPath,
  appendMetric,
  main,
};
