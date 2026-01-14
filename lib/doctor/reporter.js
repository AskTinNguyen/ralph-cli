/**
 * Output formatting for ralph doctor
 *
 * Provides terminal output (colored with status icons),
 * verbose mode (with file paths and masked env vars),
 * and JSON output for machine parsing.
 */
const pc = require("picocolors");

/**
 * Status icons for check results
 */
const ICONS = {
  pass: "✓",
  fail: "✗",
  warn: "⚠",
  info: "ℹ",
};

/**
 * Environment variables that contain sensitive data
 */
const SENSITIVE_ENV_PATTERNS = [
  /API_KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /PASSWORD/i,
  /CREDENTIAL/i,
  /AUTH/i,
  /PRIVATE/i,
];

/**
 * Mask sensitive values in a string
 * @param {string} value - Value to potentially mask
 * @param {string} key - Environment variable key
 * @returns {string} Masked or original value
 */
function maskValue(value, key) {
  if (!value || value.length < 4) return "****";

  // Check if key matches sensitive patterns
  const isSensitive = SENSITIVE_ENV_PATTERNS.some((pattern) => pattern.test(key));
  if (isSensitive) {
    const prefix = value.slice(0, 4);
    return `${prefix}${"*".repeat(Math.min(20, value.length - 4))}`;
  }

  return value;
}

/**
 * Get relevant environment variables for display
 * @returns {object} Environment variables with masked sensitive values
 */
function getEnvironmentVariables() {
  const relevantPatterns = [
    /^RALPH_/i,
    /^CODEX_/i,
    /^CLAUDE_/i,
    /^ANTHROPIC_/i,
    /^OPENAI_/i,
    /^NODE_/i,
    /^GIT_/i,
    /^PATH$/i,
    /^HOME$/i,
    /^USER$/i,
    /^SHELL$/i,
  ];

  const result = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (relevantPatterns.some((pattern) => pattern.test(key))) {
      result[key] = maskValue(value, key);
    }
  }
  return result;
}

/**
 * Format a single check result for terminal output
 * @param {object} check - Check result object
 * @param {boolean} verbose - Whether to show verbose details
 * @returns {string[]} Array of output lines
 */
function formatCheck(check, verbose = false) {
  const lines = [];
  const isValid = check.valid !== false && check.available !== false;
  const hasWarnings = (check.warnings && check.warnings.length > 0) || false;
  const hasErrors = (check.errors && check.errors.length > 0) || false;

  // Determine status icon and color
  let icon, color;
  if (hasErrors || !isValid) {
    icon = ICONS.fail;
    color = pc.red;
  } else if (hasWarnings) {
    icon = ICONS.warn;
    color = pc.yellow;
  } else {
    icon = ICONS.pass;
    color = pc.green;
  }

  // Build main check line
  let mainLine = `${color(icon)} ${check.name}`;

  // Add version if available
  if (check.version) {
    mainLine += pc.dim(` v${check.version}`);
  }

  // Add availability/validity status
  if (check.available === false) {
    mainLine += pc.dim(" not installed");
  } else if (check.valid === false && check.suggestion) {
    mainLine += pc.dim(` (${check.suggestion})`);
  }

  lines.push(mainLine);

  // Add verbose details
  if (verbose) {
    if (check.path) {
      lines.push(pc.dim(`    Path: ${check.path}`));
    }

    if (check.state) {
      if (check.state.branch) {
        lines.push(pc.dim(`    Branch: ${check.state.branch}`));
      }
      if (check.state.hasUncommitted) {
        lines.push(pc.yellow(`    ${ICONS.warn} Uncommitted changes detected`));
      }
      if (check.state.hasConflicts) {
        lines.push(pc.red(`    ${ICONS.fail} Merge conflicts present`));
      }
    }

    if (check.settings && Object.keys(check.settings).length > 0) {
      lines.push(pc.dim("    Settings:"));
      for (const [key, value] of Object.entries(check.settings)) {
        lines.push(pc.dim(`      ${key}=${maskValue(value, key)}`));
      }
    }

    if (check.stats) {
      lines.push(pc.dim(`    Stats: ${JSON.stringify(check.stats)}`));
    }
  }

  // Add suggestion if tool is not available/valid
  if (check.suggestion && check.available === false) {
    lines.push(pc.cyan(`    → ${check.suggestion}`));
  }

  // Add fix suggestion if available
  if (check.fix) {
    if (check.fix.command) {
      lines.push(pc.cyan(`    → ${check.fix.command}`));
    } else if (check.fix.description) {
      lines.push(pc.cyan(`    → ${check.fix.description}`));
    }
    if (check.fix.link && verbose) {
      lines.push(pc.dim(`    → See: ${check.fix.link}`));
    }
  }

  // Add errors
  if (hasErrors) {
    for (const err of check.errors) {
      const lineInfo = err.line ? ` (line ${err.line})` : "";
      lines.push(pc.red(`    ${ICONS.fail} ${err.message}${lineInfo}`));

      if (err.fix && verbose) {
        if (err.fix.command) {
          lines.push(pc.cyan(`      → ${err.fix.command}`));
        } else if (err.fix.description) {
          lines.push(pc.cyan(`      → ${err.fix.description}`));
        }
      }
    }
  }

  // Add warnings
  if (hasWarnings) {
    for (const warn of check.warnings) {
      const lineInfo = warn.line ? ` (line ${warn.line})` : "";
      lines.push(pc.yellow(`    ${ICONS.warn} ${warn.message}${lineInfo}`));

      if (warn.fix && verbose) {
        if (warn.fix.command) {
          lines.push(pc.cyan(`      → ${warn.fix.command}`));
        } else if (warn.fix.description) {
          lines.push(pc.cyan(`      → ${warn.fix.description}`));
        }
      }
    }
  }

  // Add git fixes if present
  if (check.gitFixes && check.gitFixes.length > 0 && verbose) {
    for (const gitFix of check.gitFixes) {
      lines.push(pc.cyan(`    ${ICONS.info} ${gitFix.fix.description}`));
      if (gitFix.commands) {
        for (const cmd of gitFix.commands.slice(0, 2)) {
          lines.push(pc.dim(`      ${cmd}`));
        }
      }
    }
  }

  return lines;
}

/**
 * Format terminal output (standard mode)
 * @param {object} results - Results from runAllChecks
 * @returns {string} Formatted terminal output
 */
function formatTerminal(results) {
  const lines = [];

  lines.push("");
  lines.push(pc.bold("  Ralph CLI Diagnostics"));
  lines.push("");

  // Environment checks
  if (results.environment && results.environment.checks) {
    lines.push(pc.bold(pc.cyan("  Environment")));
    for (const check of results.environment.checks) {
      const checkLines = formatCheck(check, false);
      for (const line of checkLines) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  // Configuration checks
  if (results.configuration && results.configuration.checks) {
    lines.push(pc.bold(pc.cyan("  Configuration")));
    for (const check of results.configuration.checks) {
      const checkLines = formatCheck(check, false);
      for (const line of checkLines) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  // State checks
  if (results.state && results.state.checks) {
    lines.push(pc.bold(pc.cyan("  State Files")));
    for (const check of results.state.checks) {
      // Skip orphaned run detection if no orphans
      if (check.name === "Orphaned Run Detection" && check.orphanedRuns && check.orphanedRuns.length === 0) {
        continue;
      }

      const checkLines = formatCheck(check, false);
      for (const line of checkLines) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  // Summary
  if (results.summary) {
    const warnings = results.summary.totalWarnings || 0;
    const errors = results.summary.totalErrors || 0;

    lines.push(pc.dim("  " + "─".repeat(50)));

    if (errors === 0 && warnings === 0) {
      lines.push(pc.green(`  ${ICONS.pass} All checks passed`));
    } else {
      const parts = [];
      if (warnings > 0) {
        parts.push(pc.yellow(`${warnings} warning${warnings !== 1 ? "s" : ""}`));
      }
      if (errors > 0) {
        parts.push(pc.red(`${errors} error${errors !== 1 ? "s" : ""}`));
      }
      lines.push(`  Summary: ${parts.join(", ")}`);
    }

    if (errors > 0) {
      lines.push("");
      lines.push(pc.cyan(`  Run 'ralph doctor --fix' to attempt automatic repairs.`));
    }
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Format terminal output (verbose mode)
 * @param {object} results - Results from runAllChecks
 * @returns {string} Formatted verbose terminal output
 */
function formatTerminalVerbose(results) {
  const lines = [];

  lines.push("");
  lines.push(pc.bold("  Ralph CLI Diagnostics") + pc.dim(" (verbose)"));
  lines.push("");

  // Environment checks
  if (results.environment && results.environment.checks) {
    lines.push(pc.bold(pc.cyan("  Environment")));
    lines.push(pc.dim("  " + "─".repeat(50)));
    for (const check of results.environment.checks) {
      const checkLines = formatCheck(check, true);
      for (const line of checkLines) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  // Configuration checks
  if (results.configuration && results.configuration.checks) {
    lines.push(pc.bold(pc.cyan("  Configuration")));
    lines.push(pc.dim("  " + "─".repeat(50)));
    for (const check of results.configuration.checks) {
      const checkLines = formatCheck(check, true);
      for (const line of checkLines) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  // State checks
  if (results.state && results.state.checks) {
    lines.push(pc.bold(pc.cyan("  State Files")));
    lines.push(pc.dim("  " + "─".repeat(50)));
    for (const check of results.state.checks) {
      const checkLines = formatCheck(check, true);
      for (const line of checkLines) {
        lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  // Environment variables (verbose only)
  lines.push(pc.bold(pc.cyan("  Environment Variables")));
  lines.push(pc.dim("  " + "─".repeat(50)));
  const envVars = getEnvironmentVariables();
  const sortedKeys = Object.keys(envVars).sort();
  for (const key of sortedKeys) {
    lines.push(pc.dim(`  ${key}=${envVars[key]}`));
  }
  lines.push("");

  // Summary
  if (results.summary) {
    const warnings = results.summary.totalWarnings || 0;
    const errors = results.summary.totalErrors || 0;
    const passed = results.summary.totalPassed || 0;

    lines.push(pc.bold(pc.cyan("  Summary")));
    lines.push(pc.dim("  " + "─".repeat(50)));
    lines.push(`  Passed:   ${pc.green(passed)}`);
    lines.push(`  Warnings: ${pc.yellow(warnings)}`);
    lines.push(`  Errors:   ${pc.red(errors)}`);

    if (errors > 0) {
      lines.push("");
      lines.push(pc.cyan(`  Run 'ralph doctor --fix' to attempt automatic repairs.`));
    }
  }

  lines.push("");

  return lines.join("\n");
}

/**
 * Format JSON output
 * @param {object} results - Results from runAllChecks
 * @returns {string} JSON string
 */
function formatJSON(results) {
  // Add environment variables to the output
  const output = {
    ...results,
    environmentVariables: getEnvironmentVariables(),
    generatedAt: new Date().toISOString(),
  };

  return JSON.stringify(output, null, 2);
}

/**
 * Format fix results for terminal output
 * @param {object} fixResults - Results from applyFixes
 * @returns {string} Formatted terminal output
 */
function formatFixResults(fixResults) {
  const lines = [];

  lines.push("");
  lines.push(pc.bold("  Ralph Doctor Fix Results"));
  lines.push("");

  // Applied fixes
  if (fixResults.applied && fixResults.applied.length > 0) {
    lines.push(pc.bold(pc.green("  Applied Fixes")));
    for (const fix of fixResults.applied) {
      lines.push(pc.green(`  ${ICONS.pass} ${fix.fix}`));
      if (fix.changes && fix.changes.length > 0) {
        lines.push(pc.dim(`      ${fix.changes.length} change(s) made`));
      }
    }
    lines.push("");
  }

  // Skipped fixes (require manual intervention)
  if (fixResults.skipped && fixResults.skipped.length > 0) {
    lines.push(pc.bold(pc.yellow("  Skipped (Manual Required)")));
    for (const skip of fixResults.skipped) {
      lines.push(pc.yellow(`  ${ICONS.warn} ${skip.fix}`));
      lines.push(pc.dim(`      Reason: ${skip.reason}`));
      if (skip.suggestion) {
        if (Array.isArray(skip.suggestion)) {
          for (const step of skip.suggestion) {
            lines.push(pc.cyan(`      → ${step}`));
          }
        } else {
          lines.push(pc.cyan(`      → ${skip.suggestion}`));
        }
      }
    }
    lines.push("");
  }

  // Failed fixes
  if (fixResults.failed && fixResults.failed.length > 0) {
    lines.push(pc.bold(pc.red("  Failed Fixes")));
    for (const fail of fixResults.failed) {
      lines.push(pc.red(`  ${ICONS.fail} ${fail.fix}`));
      lines.push(pc.dim(`      Error: ${fail.error}`));
    }
    lines.push("");
  }

  // Summary
  const applied = fixResults.applied ? fixResults.applied.length : 0;
  const skipped = fixResults.skipped ? fixResults.skipped.length : 0;
  const failed = fixResults.failed ? fixResults.failed.length : 0;

  lines.push(pc.dim("  " + "─".repeat(50)));
  lines.push(
    `  ${pc.green(`${applied} applied`)}, ${pc.yellow(`${skipped} skipped`)}, ${pc.red(`${failed} failed`)}`
  );

  if (applied > 0) {
    lines.push("");
    lines.push(pc.cyan("  Run 'ralph doctor' again to verify repairs."));
  }

  lines.push("");

  return lines.join("\n");
}

module.exports = {
  // Main formatters
  formatTerminal,
  formatTerminalVerbose,
  formatJSON,
  formatFixResults,

  // Utilities
  formatCheck,
  maskValue,
  getEnvironmentVariables,
  ICONS,
  SENSITIVE_ENV_PATTERNS,
};
