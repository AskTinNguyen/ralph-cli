/**
 * Shared display utilities for Ralph CLI commands
 * Provides consistent color helpers and formatting functions
 */
const pc = require("picocolors");

// Color helper functions for consistent output
const success = (msg) => console.log(pc.green(msg));
const error = (msg) => console.error(pc.red(msg));
const info = (msg) => console.log(pc.cyan(msg));
const dim = (msg) => console.log(pc.dim(msg));
const warn = (msg) => console.log(pc.yellow(msg));

// Format duration in human-readable form
function formatDuration(ms) {
  if (!ms || ms < 0) return "N/A";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  const hours = Math.floor(ms / 3600000);
  const mins = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${mins}m`;
}

// Format cost with appropriate precision
function formatCost(cost) {
  if (cost >= 1) return `$${cost.toFixed(2)}`;
  if (cost >= 0.01) return `$${cost.toFixed(3)}`;
  if (cost > 0) return `$${cost.toFixed(4)}`;
  return "$0.00";
}

// Format tokens with K/M suffix
function formatTokens(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

// Trend arrow helper with color
function trendArrow(trend, positiveIsGood = true) {
  if (!trend || trend.direction === "stable") return pc.dim("-");
  const isGood =
    (positiveIsGood && trend.direction === "up") ||
    (!positiveIsGood && trend.direction === "down");
  const color = isGood ? pc.green : pc.red;
  return color(`${trend.arrow} ${trend.change}%`);
}

// Score bar for visual representation
function scoreBar(score, maxScore = 100, width = 10) {
  const filled = Math.round((score / maxScore) * width);
  const empty = width - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  const color = score >= 80 ? pc.green : score >= 50 ? pc.yellow : pc.red;
  return `${color(bar)} ${score}%`;
}

// Print a horizontal rule
function hr(char = "─", length = 50) {
  console.log(pc.dim(char.repeat(length)));
}

// Print a section header
function sectionHeader(title, length = 50) {
  console.log(pc.bold(pc.cyan(title)));
  hr("-", length);
}

// Print a table row
function tableRow(cols, widths, colors = []) {
  const parts = cols.map((col, i) => {
    const width = widths[i] || 10;
    const str = String(col);
    const padded = i === 0 ? str.padEnd(width) : str.padStart(width);
    return colors[i] ? colors[i](padded) : padded;
  });
  console.log(parts.join(" "));
}

module.exports = {
  pc,
  success,
  error,
  info,
  dim,
  warn,
  formatDuration,
  formatCost,
  formatTokens,
  trendArrow,
  scoreBar,
  hr,
  sectionHeader,
  tableRow,
};
