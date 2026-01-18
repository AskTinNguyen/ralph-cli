/**
 * Review report formatter
 * Generates terminal, markdown, and JSON output for review results
 */
const pc = require("picocolors");
const fs = require("fs");
const path = require("path");

/**
 * Format review results for terminal output
 * @param {object} result - Review result from prd-reviewer or plan-reviewer
 * @returns {string} Formatted terminal output
 */
function formatTerminalOutput(result) {
  const lines = [];

  // Header
  const prdName = result.path ? path.basename(path.dirname(result.path)) : "Unknown";
  const reviewType = result.type === "prd" ? "PRD" : "Plan";

  lines.push("");
  lines.push(pc.bold(`┌─────────────────────────────────────────────────┐`));
  lines.push(pc.bold(`│ ${reviewType} Review: ${prdName}`.padEnd(50) + "│"));
  lines.push(pc.bold(`└─────────────────────────────────────────────────┘`));
  lines.push("");

  // Overall grade
  const gradeColor = getGradeColor(result.grade);
  lines.push(
    `Overall Grade: ${gradeColor(pc.bold(result.grade))} (${result.score}/100)`
  );
  lines.push("");

  // Score breakdown
  lines.push(pc.bold("Score Breakdown:"));

  for (const [key, breakdown] of Object.entries(result.breakdown)) {
    const label = formatBreakdownLabel(key);
    const bar = scoreBar(breakdown.score, breakdown.max);
    const score = `${breakdown.score}/${breakdown.max}`;
    lines.push(`  ${label.padEnd(20)} ${bar} ${score.padStart(7)}`);
  }
  lines.push("");

  // Issues summary
  const criticalIssues = result.issues.filter((i) => i.severity === "critical");
  const highIssues = result.issues.filter((i) => i.severity === "high");
  const mediumIssues = result.issues.filter((i) => i.severity === "medium");
  const lowIssues = result.issues.filter((i) => i.severity === "low");

  if (result.issues.length > 0) {
    lines.push(pc.bold("Issues Found:"));

    if (criticalIssues.length > 0) {
      lines.push(pc.red(`  ✗ ${criticalIssues.length} Critical`));
      criticalIssues.slice(0, 3).forEach((issue) => {
        const lineInfo = issue.line ? `:${issue.line}` : "";
        lines.push(pc.red(`    ${issue.message}${lineInfo}`));
      });
      if (criticalIssues.length > 3) {
        lines.push(pc.dim(`    ... and ${criticalIssues.length - 3} more`));
      }
    }

    if (highIssues.length > 0) {
      lines.push(pc.yellow(`  ⚠ ${highIssues.length} High Priority`));
      highIssues.slice(0, 3).forEach((issue) => {
        const lineInfo = issue.line ? `:${issue.line}` : "";
        lines.push(pc.yellow(`    ${issue.message}${lineInfo}`));
      });
      if (highIssues.length > 3) {
        lines.push(pc.dim(`    ... and ${highIssues.length - 3} more`));
      }
    }

    if (mediumIssues.length > 0) {
      lines.push(pc.cyan(`  ℹ ${mediumIssues.length} Medium Priority`));
    }

    if (lowIssues.length > 0) {
      lines.push(pc.dim(`  • ${lowIssues.length} Low Priority`));
    }

    lines.push("");
  } else {
    lines.push(pc.green("✓ No issues found!"));
    lines.push("");
  }

  // Top recommendations
  if (result.recommendations && result.recommendations.length > 0) {
    lines.push(pc.bold("Top Recommendations:"));

    const topRecs = result.recommendations
      .filter((r) => r.priority === "critical" || r.priority === "high")
      .slice(0, 5);

    topRecs.forEach((rec, i) => {
      const icon = rec.priority === "critical" ? "⚠️" : "→";
      lines.push(`  ${icon} ${rec.message}`);
    });

    if (result.recommendations.length > topRecs.length) {
      lines.push(pc.dim(`  ... and ${result.recommendations.length - topRecs.length} more`));
    }

    lines.push("");
  }

  // Report location
  const reportPath = getReportPath(result);
  if (reportPath) {
    lines.push(pc.dim(`Full report saved to: ${reportPath}`));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate markdown report
 * @param {object} result - Review result
 * @returns {string} Markdown report content
 */
function generateMarkdownReport(result) {
  const lines = [];
  const reviewType = result.type === "prd" ? "PRD" : "Implementation Plan";
  const prdName = result.path ? path.basename(path.dirname(result.path)) : "Unknown";

  // Title
  lines.push(`# ${reviewType} Review Report`);
  lines.push("");
  lines.push(`**PRD:** ${prdName}`);
  lines.push(`**Review Date:** ${new Date().toISOString().split("T")[0]}`);
  lines.push(`**Overall Grade:** ${result.grade} (${result.score}/100)`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");

  const statusEmoji = result.grade === "A" ? "✅" : result.grade === "B" ? "⚠️" : "❌";
  const statusText =
    result.grade === "A"
      ? "Production-ready"
      : result.grade === "B"
      ? "Minor improvements needed"
      : result.grade === "C"
      ? "Moderate issues"
      : result.grade === "D"
      ? "Significant rework needed"
      : "Not ready for implementation";

  lines.push(`${statusEmoji} **Status:** ${statusText}`);
  lines.push("");

  // Score breakdown table
  lines.push("## Score Breakdown");
  lines.push("");
  lines.push("| Category | Score | Max | Percentage |");
  lines.push("|----------|-------|-----|------------|");

  for (const [key, breakdown] of Object.entries(result.breakdown)) {
    const label = formatBreakdownLabel(key);
    const percentage = Math.round((breakdown.score / breakdown.max) * 100);
    lines.push(
      `| ${label} | ${breakdown.score} | ${breakdown.max} | ${percentage}% |`
    );
  }
  lines.push("");

  // Detailed breakdown
  for (const [key, breakdown] of Object.entries(result.breakdown)) {
    const label = formatBreakdownLabel(key);
    lines.push(`### ${label} (${breakdown.score}/${breakdown.max})`);
    lines.push("");

    if (breakdown.checks) {
      lines.push("**Checks:**");
      lines.push("");
      for (const [checkName, passed] of Object.entries(breakdown.checks)) {
        const icon = passed ? "✅" : "❌";
        const checkLabel = checkName.replace(/([A-Z])/g, " $1").trim();
        lines.push(`- ${icon} ${checkLabel}`);
      }
      lines.push("");
    }

    if (breakdown.issues && breakdown.issues.length > 0) {
      lines.push("**Issues:**");
      lines.push("");
      breakdown.issues.forEach((issue) => {
        const lineInfo = issue.line ? ` (line ${issue.line})` : "";
        const severity = issue.severity ? `[${issue.severity.toUpperCase()}]` : "";
        lines.push(`- ${severity} ${issue.message}${lineInfo}`);
        if (issue.suggestion) {
          lines.push(`  - *Suggestion:* ${issue.suggestion}`);
        }
      });
      lines.push("");
    }
  }

  // All issues by severity
  if (result.issues.length > 0) {
    lines.push("## All Issues");
    lines.push("");

    const bySeverity = {
      critical: result.issues.filter((i) => i.severity === "critical"),
      high: result.issues.filter((i) => i.severity === "high"),
      medium: result.issues.filter((i) => i.severity === "medium"),
      low: result.issues.filter((i) => i.severity === "low"),
    };

    for (const [severity, issues] of Object.entries(bySeverity)) {
      if (issues.length > 0) {
        lines.push(`### ${severity.charAt(0).toUpperCase() + severity.slice(1)} Priority (${issues.length})`);
        lines.push("");
        issues.forEach((issue, i) => {
          const lineInfo = issue.line ? ` (line ${issue.line})` : "";
          lines.push(`${i + 1}. ${issue.message}${lineInfo}`);
          if (issue.suggestion) {
            lines.push(`   - *Suggestion:* ${issue.suggestion}`);
          }
          if (issue.example) {
            lines.push(`   - *Example:* ${issue.example}`);
          }
        });
        lines.push("");
      }
    }
  }

  // Recommendations
  if (result.recommendations && result.recommendations.length > 0) {
    lines.push("## Recommendations");
    lines.push("");

    const byPriority = {
      critical: result.recommendations.filter((r) => r.priority === "critical"),
      high: result.recommendations.filter((r) => r.priority === "high"),
      medium: result.recommendations.filter((r) => r.priority === "medium"),
      low: result.recommendations.filter((r) => r.priority === "low"),
    };

    for (const [priority, recs] of Object.entries(byPriority)) {
      if (recs.length > 0) {
        const emoji =
          priority === "critical" ? "🔴" : priority === "high" ? "🟡" : priority === "medium" ? "🔵" : "⚪";
        lines.push(`### ${emoji} ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority`);
        lines.push("");
        recs.forEach((rec, i) => {
          lines.push(`${i + 1}. ${rec.message}`);
        });
        lines.push("");
      }
    }
  }

  // Next steps
  lines.push("## Next Steps");
  lines.push("");
  if (result.grade === "A") {
    lines.push("✅ This document is production-ready and can be used for implementation.");
  } else if (result.grade === "B") {
    lines.push("1. Address the recommendations above");
    lines.push("2. Re-run review to verify improvements");
    lines.push("3. Proceed with implementation");
  } else {
    lines.push("1. Review all critical and high-priority issues");
    lines.push("2. Address recommendations systematically");
    lines.push("3. Re-run review until grade reaches B or higher");
    lines.push("4. Consider using `ralph improve` for automated fixes");
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Generate JSON output
 * @param {object} result - Review result
 * @returns {string} JSON string
 */
function generateJSONOutput(result) {
  return JSON.stringify(result, null, 2);
}

/**
 * Save report to file
 * @param {object} result - Review result
 * @param {string} outputPath - Path to save report
 */
function saveReport(result, outputPath) {
  const content = generateMarkdownReport(result);
  fs.writeFileSync(outputPath, content, "utf8");
}

/**
 * Get report file path based on review result
 * @param {object} result - Review result
 * @returns {string|null} Report path
 */
function getReportPath(result) {
  if (!result.path) return null;

  const prdDir = path.dirname(result.path);
  const filename = result.type === "prd" ? "review-prd.md" : "review-plan.md";
  return path.join(prdDir, filename);
}

/**
 * Create score bar visualization
 * @param {number} score - Current score
 * @param {number} max - Maximum score
 * @returns {string} Colored score bar
 */
function scoreBar(score, max) {
  const percentage = (score / max) * 100;
  const width = 20;
  const filled = Math.round((score / max) * width);
  const empty = width - filled;

  const bar = "█".repeat(filled) + "░".repeat(empty);

  const color =
    percentage >= 90
      ? pc.green
      : percentage >= 70
      ? pc.cyan
      : percentage >= 50
      ? pc.yellow
      : pc.red;

  return color(bar);
}

/**
 * Get color function for grade
 */
function getGradeColor(grade) {
  if (grade === "A") return pc.green;
  if (grade === "B") return pc.cyan;
  if (grade === "C") return pc.yellow;
  if (grade === "D") return pc.magenta;
  return pc.red;
}

/**
 * Format breakdown label for display
 */
function formatBreakdownLabel(key) {
  return key
    .replace(/([A-Z])/g, " $1")
    .trim()
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

module.exports = {
  formatTerminalOutput,
  generateMarkdownReport,
  generateJSONOutput,
  saveReport,
  getReportPath,
  scoreBar,
};
