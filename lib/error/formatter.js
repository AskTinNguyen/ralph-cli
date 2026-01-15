/**
 * Error Formatter Module
 *
 * Handles formatting error definitions for terminal and JSON output
 */
const pc = require("picocolors");

/**
 * Get severity color function
 * @param {string} severity - Severity level
 * @returns {function} Picocolors function
 */
function getSeverityColor(severity) {
  switch (severity) {
    case "critical":
      return pc.bgRed;
    case "error":
      return pc.red;
    case "warning":
      return pc.yellow;
    case "info":
      return pc.cyan;
    default:
      return pc.white;
  }
}

/**
 * Get category color function
 * @param {string} category - Error category
 * @returns {function} Picocolors function
 */
function getCategoryColor(category) {
  switch (category) {
    case "CONFIG":
      return pc.blue;
    case "PRD":
      return pc.magenta;
    case "BUILD":
      return pc.red;
    case "GIT":
      return pc.green;
    case "AGENT":
      return pc.yellow;
    case "STREAM":
      return pc.cyan;
    case "INTERNAL":
      return pc.bgRed;
    default:
      return pc.white;
  }
}

/**
 * Format error for terminal display (box style)
 * @param {string} code - Error code
 * @param {object} error - Error definition
 * @returns {string} Formatted string for terminal
 */
function formatTerminal(code, error) {
  const width = 65;
  const border = "─".repeat(width);
  const severityColor = getSeverityColor(error.severity);
  const categoryColor = getCategoryColor(error.category);

  const lines = [];

  // Top border with title
  lines.push(pc.dim("┌" + border + "┐"));
  lines.push(
    pc.dim("│ ") +
      pc.bold(severityColor(`${code}: ${error.message}`)).padEnd(width + 10) +
      pc.dim(" │")
  );
  lines.push(pc.dim("├" + border + "┤"));

  // Category and severity row
  const catLabel = `Category: ${categoryColor(error.category)}`;
  const sevLabel = `Severity: ${severityColor(error.severity)}`;
  lines.push(
    pc.dim("│ ") +
      catLabel.padEnd(width / 2 + 15) +
      sevLabel.padEnd(width / 2 - 5) +
      pc.dim(" │")
  );
  lines.push(pc.dim("├" + border + "┤"));

  // Details
  const detailLines = wrapText(error.details, width - 2);
  for (const line of detailLines) {
    lines.push(pc.dim("│ ") + line.padEnd(width) + pc.dim(" │"));
  }

  // Remediation
  if (error.remediation && error.remediation.length > 0) {
    lines.push(pc.dim("│" + " ".repeat(width) + " │"));
    lines.push(pc.dim("│ ") + pc.bold("Remediation:").padEnd(width) + pc.dim(" │"));
    for (let i = 0; i < error.remediation.length; i++) {
      const step = `  ${i + 1}. ${error.remediation[i]}`;
      const stepLines = wrapText(step, width - 2);
      for (const line of stepLines) {
        lines.push(pc.dim("│ ") + pc.green(line.padEnd(width)) + pc.dim(" │"));
      }
    }
  }

  // See also
  if (error.see_also && error.see_also.length > 0) {
    lines.push(pc.dim("│" + " ".repeat(width) + " │"));
    lines.push(
      pc.dim("│ ") +
        pc.dim(`See also: ${error.see_also.join(", ")}`).padEnd(width) +
        pc.dim(" │")
    );
  }

  // Bottom border
  lines.push(pc.dim("└" + border + "┘"));

  return lines.join("\n");
}

/**
 * Format error for compact terminal display (single line + details)
 * @param {string} code - Error code
 * @param {object} error - Error definition
 * @returns {string} Formatted string for terminal
 */
function formatCompact(code, error) {
  const severityColor = getSeverityColor(error.severity);
  const categoryColor = getCategoryColor(error.category);

  const lines = [];
  lines.push(
    severityColor(pc.bold(code)) +
      " " +
      categoryColor(`[${error.category}]`) +
      " " +
      error.message
  );

  return lines.join("\n");
}

/**
 * Format error list for terminal
 * @param {object} errors - Object with error codes as keys
 * @returns {string} Formatted list
 */
function formatList(errors) {
  const lines = [];

  // Group by category
  const byCategory = {};
  for (const [code, error] of Object.entries(errors)) {
    if (!byCategory[error.category]) {
      byCategory[error.category] = [];
    }
    byCategory[error.category].push({ code, ...error });
  }

  // Sort categories
  const categoryOrder = ["CONFIG", "PRD", "BUILD", "GIT", "AGENT", "STREAM", "INTERNAL"];

  for (const category of categoryOrder) {
    if (!byCategory[category]) continue;

    const categoryColor = getCategoryColor(category);
    lines.push("");
    lines.push(categoryColor(pc.bold(`${category} Errors`)));
    lines.push(pc.dim("─".repeat(50)));

    for (const error of byCategory[category].sort((a, b) =>
      a.code.localeCompare(b.code)
    )) {
      const severityColor = getSeverityColor(error.severity);
      const autoIssue = error.auto_issue ? pc.yellow(" [auto-issue]") : "";
      lines.push(
        `  ${severityColor(error.code)}  ${error.message}${autoIssue}`
      );
    }
  }

  lines.push("");
  lines.push(pc.dim(`Total: ${Object.keys(errors).length} error codes`));

  return lines.join("\n");
}

/**
 * Format error as JSON
 * @param {string} code - Error code
 * @param {object} error - Error definition
 * @returns {object} JSON-friendly object
 */
function formatJSON(code, error) {
  return {
    code,
    ...error,
  };
}

/**
 * Format multiple errors as JSON
 * @param {object} errors - Object with error codes as keys
 * @returns {object[]} Array of JSON objects
 */
function formatListJSON(errors) {
  return Object.entries(errors).map(([code, error]) => ({
    code,
    ...error,
  }));
}

/**
 * Format error for use in GitHub issue body
 * @param {string} code - Error code
 * @param {object} error - Error definition
 * @param {object} context - Additional context (prd, story, logs, etc.)
 * @returns {string} Markdown formatted string
 */
function formatForIssue(code, error, context = {}) {
  const lines = [];

  lines.push(`## Error: [${code}] ${error.message}`);
  lines.push("");

  // Context section
  lines.push("### Context");
  if (context.prd) lines.push(`- **PRD:** ${context.prd}`);
  if (context.story) lines.push(`- **Story:** ${context.story}`);
  if (context.agent) lines.push(`- **Agent:** ${context.agent}`);
  if (context.agentChain)
    lines.push(`- **Agent Chain:** ${context.agentChain.join(" → ")}`);
  lines.push(`- **Time:** ${new Date().toISOString()}`);
  if (context.runId) lines.push(`- **Run ID:** ${context.runId}`);
  lines.push("");

  // Error details
  lines.push("### Error Details");
  lines.push(error.details);
  lines.push("");

  // Remediation
  if (error.remediation && error.remediation.length > 0) {
    lines.push("### Remediation Steps");
    for (let i = 0; i < error.remediation.length; i++) {
      lines.push(`${i + 1}. ${error.remediation[i]}`);
    }
    lines.push("");
  }

  // Logs
  if (context.logs) {
    lines.push("### Logs");
    lines.push("```");
    lines.push(context.logs);
    lines.push("```");
    lines.push("");
  }

  // Related
  lines.push("### Related");
  lines.push(
    `- See [${code} documentation](https://github.com/AskTinNguyen/ralph-cli#error-codes)`
  );
  if (error.see_also && error.see_also.length > 0) {
    lines.push(`- See also: ${error.see_also.join(", ")}`);
  }
  lines.push("");

  lines.push("---");
  lines.push("*Generated by Ralph CLI Error Management System*");

  return lines.join("\n");
}

/**
 * Wrap text to specified width
 * @param {string} text - Text to wrap
 * @param {number} width - Max width
 * @returns {string[]} Array of lines
 */
function wrapText(text, width) {
  const words = text.split(" ");
  const lines = [];
  let currentLine = "";

  for (const word of words) {
    if (currentLine.length + word.length + 1 <= width) {
      currentLine += (currentLine ? " " : "") + word;
    } else {
      if (currentLine) lines.push(currentLine);
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine);

  return lines.length ? lines : [""];
}

module.exports = {
  formatTerminal,
  formatCompact,
  formatList,
  formatJSON,
  formatListJSON,
  formatForIssue,
  getSeverityColor,
  getCategoryColor,
  wrapText,
};
