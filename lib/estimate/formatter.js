/**
 * Estimate output formatter - formats estimation results for display
 */

/**
 * Format duration in seconds to human-readable string
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration (e.g., "2m 30s", "1h 5m")
 */
function formatDuration(seconds) {
  if (seconds == null || isNaN(seconds)) {
    return "N/A";
  }

  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.round(seconds % 60);

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${hours}h`;
  }

  if (secs > 0 && minutes < 10) {
    return `${minutes}m ${secs}s`;
  }

  return `${minutes}m`;
}

/**
 * Format token count with K/M suffix
 * @param {number} tokens - Token count
 * @returns {string} Formatted token count
 */
function formatTokens(tokens) {
  if (tokens == null || isNaN(tokens)) {
    return "N/A";
  }

  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return String(tokens);
}

/**
 * Format cost as currency
 * @param {number} cost - Cost in USD
 * @returns {string} Formatted cost
 */
function formatCost(cost) {
  if (cost == null || isNaN(cost)) {
    return "$0.00";
  }

  // Use more decimals for very small amounts
  if (cost < 0.01 && cost > 0) {
    return `$${cost.toFixed(4)}`;
  }

  return `$${cost.toFixed(2)}`;
}

/**
 * Pad string to fixed width
 * @param {string} str - String to pad
 * @param {number} width - Target width
 * @param {string} align - Alignment ('left' or 'right')
 * @returns {string} Padded string
 */
function pad(str, width, align = "left") {
  const s = String(str || "");
  if (s.length >= width) {
    return s.slice(0, width);
  }
  const padding = " ".repeat(width - s.length);
  return align === "right" ? padding + s : s + padding;
}

/**
 * Format estimates as a table
 * @param {Object[]} estimates - Array of story estimates
 * @param {Object} totals - Total estimates
 * @param {Object} options - Formatting options
 * @returns {string} Formatted table
 */
function formatTable(estimates, totals, options = {}) {
  const { showConfidence = true } = options;

  // Column widths
  const cols = {
    story: 25,
    time: 12,
    tokens: 10,
    cost: 10,
    confidence: 10,
  };

  const lines = [];

  // Header
  let header = `${pad("Story", cols.story)} ${pad("Time", cols.time, "right")} ${pad("Tokens", cols.tokens, "right")} ${pad("Cost", cols.cost, "right")}`;
  if (showConfidence) {
    header += ` ${pad("Confidence", cols.confidence)}`;
  }
  lines.push(header);

  // Separator
  const totalWidth =
    cols.story +
    cols.time +
    cols.tokens +
    cols.cost +
    3 +
    (showConfidence ? cols.confidence + 1 : 0);
  lines.push("─".repeat(totalWidth));

  // Rows
  for (const est of estimates) {
    const storyLabel = est.completed ? `✓ ${est.storyId}` : est.storyId;
    let row = `${pad(storyLabel, cols.story)} ${pad(formatDuration(est.duration), cols.time, "right")} ${pad(formatTokens(est.tokens), cols.tokens, "right")} ${pad(formatCost(est.cost), cols.cost, "right")}`;
    if (showConfidence) {
      row += ` ${pad(est.confidence || "N/A", cols.confidence)}`;
    }
    lines.push(row);
  }

  // Total separator
  lines.push("─".repeat(totalWidth));

  // Totals row
  let totalRow = `${pad("TOTAL", cols.story)} ${pad(formatDuration(totals.duration), cols.time, "right")} ${pad(formatTokens(totals.tokens), cols.tokens, "right")} ${pad(formatCost(totals.cost), cols.cost, "right")}`;
  if (showConfidence) {
    totalRow += ` ${pad("", cols.confidence)}`;
  }
  lines.push(totalRow);

  return lines.join("\n");
}

/**
 * Format estimates as JSON
 * @param {Object[]} estimates - Array of story estimates
 * @param {Object} totals - Total estimates
 * @returns {string} JSON string
 */
function formatJSON(estimates, totals) {
  return JSON.stringify(
    {
      stories: estimates,
      totals: totals,
      generatedAt: new Date().toISOString(),
    },
    null,
    2
  );
}

/**
 * Get confidence badge for display
 * @param {string} confidence - Confidence level (high/medium/low)
 * @returns {string} Badge string
 */
function confidenceBadge(confidence) {
  switch (confidence) {
    case "high":
      return "●●●";
    case "medium":
      return "●●○";
    case "low":
      return "●○○";
    default:
      return "○○○";
  }
}

module.exports = {
  formatDuration,
  formatTokens,
  formatCost,
  formatTable,
  formatJSON,
  confidenceBadge,
  pad,
};
