/**
 * Context module - intelligent context selection for agent builds
 *
 * Provides:
 * - File relevance scoring based on story content
 * - Import/require connection detection
 * - Recently modified file tracking
 * - Token-aware file selection
 * - Context budget management (token limits, truncation)
 * - Context visualization and summary formatting
 */

const scorer = require("./scorer");
const selector = require("./selector");
const budget = require("./budget");

/**
 * Format context selection as a markdown summary for run logs
 * @param {Object} selection - Result from selectRelevantFiles or selectWithBudget
 * @param {Object} options - Formatting options
 * @param {string} options.title - Section title (default: "Context Files")
 * @param {boolean} options.showReasons - Whether to show selection reasons (default: true)
 * @param {boolean} options.showTruncated - Whether to show truncated files section (default: true)
 * @param {boolean} options.showSkipped - Whether to show skipped files section (default: true)
 * @returns {string} Formatted markdown string
 */
function formatContextSummary(selection, options = {}) {
  const {
    title = "Context Files",
    showReasons = true,
    showTruncated = true,
    showSkipped = true,
  } = options;

  if (!selection || !selection.files) {
    return `## ${title}\n\nNo context files selected.\n`;
  }

  const lines = [];
  lines.push(`## ${title}`);
  lines.push("");

  // Summary statistics
  const { summary } = selection;
  lines.push("### Summary");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`|--------|-------|`);
  lines.push(`| Files included | ${summary.totalFiles} |`);
  lines.push(`| Total tokens | ${summary.totalTokens.toLocaleString()} |`);
  lines.push(`| Avg relevance score | ${summary.avgScore} |`);
  lines.push(`| Files scanned | ${summary.scannedFiles} |`);
  lines.push(`| Files matched | ${summary.matchedFiles} |`);

  // Add budget info if present
  if (summary.budget) {
    lines.push(`| Budget | ${summary.budget.toLocaleString()} tokens |`);
    lines.push(`| Budget used | ${summary.budgetUtilization}% |`);
    lines.push(`| Budget remaining | ${summary.budgetRemaining.toLocaleString()} tokens |`);

    if (summary.truncatedFiles > 0) {
      lines.push(`| Truncated files | ${summary.truncatedFiles} |`);
    }
    if (summary.skippedFiles > 0) {
      lines.push(`| Skipped (over budget) | ${summary.skippedFiles} |`);
    }
  }
  lines.push("");

  // Budget status warning if applicable
  if (summary.budgetStatus && summary.budgetStatus.message) {
    const statusIcon =
      summary.budgetStatus.level === "critical"
        ? "🔴"
        : summary.budgetStatus.level === "warning"
        ? "🟠"
        : "🟡";
    lines.push(`> ${statusIcon} **${summary.budgetStatus.message}**`);
    lines.push("");
  }

  // Files table
  lines.push("### Included Files");
  lines.push("");

  if (showReasons) {
    lines.push(`| File | Score | Tokens | Reason |`);
    lines.push(`|------|-------|--------|--------|`);
  } else {
    lines.push(`| File | Score | Tokens |`);
    lines.push(`|------|-------|--------|`);
  }

  for (const file of selection.files) {
    const reasons = file.reasons ? file.reasons.join(", ") : "";
    const truncateMarker = file.truncated ? " (truncated)" : "";

    if (showReasons) {
      lines.push(`| ${file.file}${truncateMarker} | ${file.score} | ${file.tokens.toLocaleString()} | ${reasons} |`);
    } else {
      lines.push(`| ${file.file}${truncateMarker} | ${file.score} | ${file.tokens.toLocaleString()} |`);
    }
  }
  lines.push("");

  // Truncated files section
  if (showTruncated && selection.truncated && selection.truncated.length > 0) {
    lines.push("### Truncated Files");
    lines.push("");
    lines.push("These files were truncated to fit within the token budget:");
    lines.push("");
    lines.push(`| File | Original Tokens | Truncated Tokens |`);
    lines.push(`|------|-----------------|------------------|`);

    for (const item of selection.truncated) {
      lines.push(`| ${item.file} | ${item.originalTokens.toLocaleString()} | ${item.truncatedTokens.toLocaleString()} |`);
    }
    lines.push("");
  }

  // Skipped files section
  if (showSkipped && selection.skipped && selection.skipped.length > 0) {
    lines.push("### Skipped Files (Over Budget)");
    lines.push("");
    lines.push("These relevant files were skipped because they would exceed the token budget:");
    lines.push("");
    lines.push(`| File | Score | Tokens |`);
    lines.push(`|------|-------|--------|`);

    // Show top 10 skipped files
    const topSkipped = selection.skipped.slice(0, 10);
    for (const item of topSkipped) {
      lines.push(`| ${item.file} | ${item.score} | ${item.tokens.toLocaleString()} |`);
    }

    if (selection.skipped.length > 10) {
      lines.push(`| ... and ${selection.skipped.length - 10} more | | |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Get a compact one-line summary of context selection
 * @param {Object} selection - Result from selectRelevantFiles or selectWithBudget
 * @returns {string} Compact summary string
 */
function getCompactSummary(selection) {
  if (!selection || !selection.summary) {
    return "No context selected";
  }

  const { summary } = selection;
  let result = `${summary.totalFiles} files, ${summary.totalTokens.toLocaleString()} tokens`;

  if (summary.budget) {
    result += `, ${summary.budgetUtilization}% of budget`;

    if (summary.budgetStatus && summary.budgetStatus.level !== "ok") {
      result += ` [${summary.budgetStatus.level.toUpperCase()}]`;
    }
  }

  return result;
}

// Re-export main functions
module.exports = {
  // Selector functions
  selectRelevantFiles: selector.selectRelevantFiles,
  selectWithBudget: selector.selectWithBudget,
  getProjectFiles: selector.getProjectFiles,
  getFilePaths: selector.getFilePaths,
  countFileTokens: selector.countFileTokens,
  parseDirectives: selector.parseDirectives,
  matchesAnyPattern: selector.matchesAnyPattern,
  expandPatterns: selector.expandPatterns,

  // Scorer functions
  calculateFileRelevance: scorer.calculateFileRelevance,
  extractFileReferences: scorer.extractFileReferences,
  findImportConnections: scorer.findImportConnections,
  getRecentlyModifiedFiles: scorer.getRecentlyModifiedFiles,
  extractKeywords: scorer.extractKeywords,

  // Budget functions
  calculateBudget: budget.calculateBudget,
  getModelLimit: budget.getModelLimit,
  getBudgetStatus: budget.getBudgetStatus,
  truncateFile: budget.truncateFile,
  selectWithinBudget: budget.selectWithinBudget,

  // Visualization functions
  formatContextSummary,
  getCompactSummary,

  // Constants
  MODEL_LIMITS: budget.MODEL_LIMITS,
  BUDGET_RATIOS: budget.BUDGET_RATIOS,
  BUDGET_THRESHOLDS: budget.BUDGET_THRESHOLDS,

  // Cache management
  clearCaches: scorer.clearCaches,
  clearTokenCache: budget.clearTokenCache,

  // Sub-modules for direct access
  scorer,
  selector,
  budget,
};
