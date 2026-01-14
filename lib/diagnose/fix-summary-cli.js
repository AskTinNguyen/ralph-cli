#!/usr/bin/env node
/**
 * CLI for fix summary operations
 *
 * Usage:
 *   node fix-summary-cli.js print [session-id]       - Print fix summary to console
 *   node fix-summary-cli.js commit [session-id]      - Output fix string for commit message
 *   node fix-summary-cli.js json [session-id]        - Output fix stats as JSON
 *   node fix-summary-cli.js read <log-path>          - Read fix records from activity.log
 */

const fs = require("fs");
const path = require("path");

/**
 * Parse AUTO_FIX entries from an activity.log file
 * @param {string} logPath - Path to activity.log
 * @returns {Object[]} Array of parsed fix records
 */
function parseFixesFromLog(logPath) {
  const fixes = [];

  try {
    if (!fs.existsSync(logPath)) {
      return fixes;
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n");

    // Match AUTO_FIX log entries
    // Format: [timestamp] AUTO_FIX type=X command="Y" status=success|failure duration=Nms
    const pattern = /^\[([^\]]+)\] AUTO_FIX type=(\w+) command="([^"]*)" status=(\w+) duration=(\d+)ms(?:\s+error="([^"]*)")?/;

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        fixes.push({
          timestamp: match[1],
          type: match[2],
          command: match[3],
          status: match[4],
          duration: parseInt(match[5], 10),
          error: match[6] || null,
        });
      }
    }
  } catch (err) {
    // Silently handle errors
  }

  return fixes;
}

/**
 * Get fix summary from activity.log file
 * @param {string} logPath - Path to activity.log
 * @returns {Object} Summary stats
 */
function getSummaryFromLog(logPath) {
  const fixes = parseFixesFromLog(logPath);

  const summary = {
    attempted: fixes.length,
    succeeded: 0,
    failed: 0,
    byType: {},
    totalDuration: 0,
  };

  for (const fix of fixes) {
    summary.totalDuration += fix.duration || 0;

    if (fix.status === "success") {
      summary.succeeded++;
    } else {
      summary.failed++;
    }

    if (!summary.byType[fix.type]) {
      summary.byType[fix.type] = { attempted: 0, succeeded: 0, failed: 0 };
    }
    summary.byType[fix.type].attempted++;
    if (fix.status === "success") {
      summary.byType[fix.type].succeeded++;
    } else {
      summary.byType[fix.type].failed++;
    }
  }

  return { summary, fixes };
}

/**
 * Format fix summary for console output
 * @param {Object} summary - Summary stats
 * @param {Object[]} fixes - Fix records
 * @returns {string} Formatted output
 */
function formatSummary(summary, fixes) {
  if (summary.attempted === 0) {
    return "";
  }

  const lines = [];
  lines.push("");
  lines.push("\x1b[36m═══════════════════════════════════════════════════════\x1b[0m");
  lines.push("\x1b[1m\x1b[36m                    FIX SUMMARY                        \x1b[0m");
  lines.push("\x1b[36m═══════════════════════════════════════════════════════\x1b[0m");
  lines.push("");

  // Overall stats
  lines.push(`  \x1b[1mTotal Fixes:\x1b[0m ${summary.attempted}`);
  lines.push(`  \x1b[32m✓ Succeeded:\x1b[0m ${summary.succeeded}`);
  lines.push(`  \x1b[31m✗ Failed:\x1b[0m ${summary.failed}`);
  lines.push(`  \x1b[2mTotal Duration:\x1b[0m ${(summary.totalDuration / 1000).toFixed(2)}s`);
  lines.push("");

  // By type breakdown
  if (Object.keys(summary.byType).length > 0) {
    lines.push("  \x1b[1mBy Type:\x1b[0m");
    for (const [type, stats] of Object.entries(summary.byType)) {
      const status = stats.succeeded === stats.attempted
        ? "\x1b[32m✓\x1b[0m"
        : stats.failed > 0
          ? "\x1b[31m✗\x1b[0m"
          : "\x1b[33m○\x1b[0m";
      lines.push(`    ${status} ${type}: ${stats.succeeded}/${stats.attempted}`);
    }
    lines.push("");
  }

  // Detailed list
  if (fixes.length > 0) {
    lines.push("  \x1b[1mDetails:\x1b[0m");
    for (const fix of fixes) {
      const status = fix.status === "success"
        ? "\x1b[32m✓\x1b[0m"
        : "\x1b[31m✗\x1b[0m";
      const duration = fix.duration ? `(${fix.duration}ms)` : "";
      lines.push(`    ${status} ${fix.type} ${duration}`);
      if (fix.command) {
        lines.push(`      \x1b[2mCommand: ${fix.command}\x1b[0m`);
      }
      if (fix.error) {
        const errorShort = fix.error.slice(0, 80) + (fix.error.length > 80 ? "..." : "");
        lines.push(`      \x1b[31mError: ${errorShort}\x1b[0m`);
      }
    }
    lines.push("");
  }

  lines.push("\x1b[36m═══════════════════════════════════════════════════════\x1b[0m");

  return lines.join("\n");
}

/**
 * Format fixes for commit message
 * @param {Object[]} fixes - Fix records
 * @returns {string} Commit message line
 */
function formatForCommit(fixes) {
  const successful = fixes.filter(f => f.status === "success");

  if (successful.length === 0) {
    return "";
  }

  // Group by type
  const byType = {};
  for (const fix of successful) {
    if (!byType[fix.type]) {
      byType[fix.type] = 0;
    }
    byType[fix.type]++;
  }

  // Format as comma-separated list
  const types = Object.entries(byType)
    .map(([type, count]) => (count > 1 ? `${type} (${count})` : type))
    .join(", ");

  return `Auto-fixed: ${types}`;
}

// CLI commands
const command = process.argv[2];
const arg = process.argv[3];

switch (command) {
  case "print": {
    // Print fix summary from activity.log
    const logPath = arg || path.join(process.cwd(), ".ralph", "activity.log");
    const { summary, fixes } = getSummaryFromLog(logPath);
    const output = formatSummary(summary, fixes);
    if (output) {
      console.log(output);
    }
    break;
  }

  case "commit": {
    // Output fix string for commit message
    const logPath = arg || path.join(process.cwd(), ".ralph", "activity.log");
    const { fixes } = getSummaryFromLog(logPath);
    const commitLine = formatForCommit(fixes);
    if (commitLine) {
      console.log(commitLine);
    }
    break;
  }

  case "json": {
    // Output fix stats as JSON
    const logPath = arg || path.join(process.cwd(), ".ralph", "activity.log");
    const { summary, fixes } = getSummaryFromLog(logPath);
    console.log(JSON.stringify({ summary, fixes }, null, 2));
    break;
  }

  case "read": {
    // Read fix records from specified log
    if (!arg) {
      console.error("Error: log path required");
      process.exit(1);
    }
    const fixes = parseFixesFromLog(arg);
    console.log(JSON.stringify(fixes, null, 2));
    break;
  }

  default:
    console.log(`
Fix Summary CLI

Usage:
  node fix-summary-cli.js print [log-path]    - Print fix summary to console
  node fix-summary-cli.js commit [log-path]   - Output fix string for commit message
  node fix-summary-cli.js json [log-path]     - Output fix stats as JSON
  node fix-summary-cli.js read <log-path>     - Read fix records from activity.log
`);
    break;
}
