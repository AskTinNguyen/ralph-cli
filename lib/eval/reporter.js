/**
 * Evaluation report generator - creates markdown reports from scores
 */
const fs = require("fs");
const path = require("path");
const { gradeScore } = require("./scorer");

/**
 * Format duration in human-readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
  if (seconds == null) return "N/A";
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

/**
 * Generate score bar visualization
 * @param {number} score - Score 0-100
 * @param {number} width - Bar width in characters
 * @returns {string} ASCII bar
 */
function scoreBar(score, width = 20) {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  return `[${"█".repeat(filled)}${"░".repeat(empty)}] ${score}%`;
}

/**
 * Generate a markdown evaluation report for a single run
 * @param {object} scores - Score object from scoreRun
 * @returns {string} Markdown report content
 */
function generateRunReport(scores) {
  const grade = gradeScore(scores.overall);
  const gradeEmoji = {
    A: "🟢",
    B: "🔵",
    C: "🟡",
    D: "🟠",
    F: "🔴",
  };

  const lines = [
    `# Evaluation Report: ${scores.runId}`,
    "",
    `**Grade: ${gradeEmoji[grade] || "⚪"} ${grade}** (Score: ${scores.overall}/100)`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Run ID | ${scores.runId} |`,
    `| Iteration | ${scores.iteration || "N/A"} |`,
    `| Mode | ${scores.mode || "N/A"} |`,
    `| Story | ${scores.story || "N/A"} |`,
    `| Status | ${scores.status} |`,
    `| Duration | ${formatDuration(scores.duration)} |`,
    "",
    "## Scores",
    "",
    `| Category | Score | Grade |`,
    `|----------|-------|-------|`,
    `| Success | ${scores.successScore}/100 | ${gradeScore(scores.successScore)} |`,
    `| Verification | ${scores.verificationScore}/100 | ${gradeScore(scores.verificationScore)} |`,
    `| Commit Quality | ${scores.commitScore}/100 | ${gradeScore(scores.commitScore)} |`,
    `| Efficiency | ${scores.efficiencyScore}/100 | ${gradeScore(scores.efficiencyScore)} |`,
    `| **Overall** | **${scores.overall}/100** | **${grade}** |`,
    "",
    "## Score Breakdown",
    "",
    `- Success: ${scoreBar(scores.successScore)}`,
    `- Verification: ${scoreBar(scores.verificationScore)}`,
    `- Commit Quality: ${scoreBar(scores.commitScore)}`,
    `- Efficiency: ${scoreBar(scores.efficiencyScore)}`,
    "",
    "## Details",
    "",
    "### Git Activity",
    `- Commits made: ${scores.details.commitCount}`,
    `- Files changed: ${scores.details.changedFilesCount}`,
    `- Clean working tree: ${scores.details.hasUncommittedChanges ? "No" : "Yes"}`,
    scores.details.hasUncommittedChanges
      ? `- Uncommitted files: ${scores.details.uncommittedCount}`
      : "",
    "",
    "### Verification",
    `- Tests passed: ${scores.details.verificationsPassed}`,
    `- Tests failed: ${scores.details.verificationsFailed}`,
    `- Complete signal: ${scores.details.hasCompleteSignal ? "Yes" : "No"}`,
    `- Errors detected: ${scores.details.errorCount}`,
    "",
  ].filter((line) => line !== "");

  // Add recommendations
  const recommendations = [];
  if (scores.successScore < 50) {
    recommendations.push(
      "- **Critical**: Run failed. Review error logs and fix blocking issues."
    );
  }
  if (scores.verificationScore < 70) {
    recommendations.push(
      "- Run more verification commands and ensure tests pass before commit."
    );
  }
  if (scores.commitScore < 70) {
    recommendations.push(
      "- Ensure all changes are committed and working tree is clean."
    );
  }
  if (scores.efficiencyScore < 60) {
    recommendations.push(
      "- Run took longer than expected. Consider breaking down into smaller tasks."
    );
  }

  if (recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");
    lines.push(...recommendations);
    lines.push("");
  }

  lines.push("---");
  lines.push(`*Generated at ${new Date().toISOString()}*`);

  return lines.join("\n");
}

/**
 * Generate a summary table for multiple runs
 * @param {object[]} scores - Array of score objects
 * @param {object} aggregate - Aggregated metrics
 * @returns {string} Markdown summary content
 */
function generateSummaryReport(scores, aggregate) {
  const lines = [
    "# Evaluation Summary",
    "",
    "## Overview",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Total Runs | ${aggregate.totalRuns} |`,
    `| Successful | ${aggregate.successCount} (${aggregate.successRate}%) |`,
    `| Failed | ${aggregate.errorCount} |`,
    `| Average Score | ${aggregate.avgOverall}/100 (${aggregate.grade}) |`,
    `| Avg Duration | ${formatDuration(aggregate.avgDuration)} |`,
    `| Min Duration | ${formatDuration(aggregate.minDuration)} |`,
    `| Max Duration | ${formatDuration(aggregate.maxDuration)} |`,
    "",
    "## Score Averages",
    "",
    `- Success Rate: ${scoreBar(aggregate.avgSuccess)}`,
    `- Verification: ${scoreBar(aggregate.avgVerification)}`,
    `- Commit Quality: ${scoreBar(aggregate.avgCommit)}`,
    `- Efficiency: ${scoreBar(aggregate.avgEfficiency)}`,
    "",
  ];

  // Common failure patterns
  if (aggregate.failurePatterns && aggregate.failurePatterns.length > 0) {
    lines.push("## Common Failure Patterns");
    lines.push("");
    lines.push("| Pattern | Occurrences |");
    lines.push("|---------|-------------|");
    for (const { pattern, count } of aggregate.failurePatterns) {
      const readable = pattern
        .replace(/_/g, " ")
        .replace(/errors (\d+)/, "$1 errors");
      lines.push(`| ${readable} | ${count} |`);
    }
    lines.push("");
  }

  // Run details table
  lines.push("## Individual Runs");
  lines.push("");
  lines.push(
    "| Run ID | Mode | Story | Status | Score | Duration |"
  );
  lines.push(
    "|--------|------|-------|--------|-------|----------|"
  );

  for (const score of scores) {
    if (!score) continue;
    const shortStory = score.story
      ? score.story.substring(0, 30) + (score.story.length > 30 ? "..." : "")
      : "N/A";
    lines.push(
      `| ${score.runId} | ${score.mode || "N/A"} | ${shortStory} | ${score.status} | ${score.overall} | ${formatDuration(score.duration)} |`
    );
  }

  lines.push("");
  lines.push("---");
  lines.push(`*Generated at ${new Date().toISOString()}*`);

  return lines.join("\n");
}

/**
 * Save evaluation report to file
 * @param {string} content - Report content
 * @param {string} outputPath - Output file path
 */
function saveReport(content, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outputPath, content);
}

module.exports = {
  generateRunReport,
  generateSummaryReport,
  saveReport,
  formatDuration,
  scoreBar,
};
