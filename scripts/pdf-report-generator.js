#!/usr/bin/env node

/**
 * PDF Report Generator - Weekly Executive Summary
 *
 * Generates PDF reports with charts for weekly executive summaries.
 * Aggregates 7 days of metrics and creates visualizations.
 */

const fs = require("fs");
const path = require("path");

/**
 * Load historical metrics for the week
 */
function loadWeeklyMetrics() {
  const ralphRoot = process.cwd();
  const runsDir = path.join(ralphRoot, ".ralph", "factory", "runs");

  if (!fs.existsSync(runsDir)) {
    console.error("[PDF Generator] No runs directory found");
    return [];
  }

  // Get last 7 daily metrics files
  const files = fs
    .readdirSync(runsDir)
    .filter((f) => f.startsWith("daily-metrics-") && f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, 7);

  const metrics = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(runsDir, file), "utf-8");
      metrics.push(JSON.parse(content));
    } catch (error) {
      console.error(`[PDF Generator] Failed to load ${file}:`, error.message);
    }
  }

  return metrics.reverse(); // Chronological order
}

/**
 * Load automation configuration for budget data
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    return {
      budgets: { monthly: 2000, alertThresholds: [80, 95] },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("[PDF Generator] Failed to load config:", error.message);
    return {
      budgets: { monthly: 2000, alertThresholds: [80, 95] },
    };
  }
}

/**
 * Calculate weekly summary statistics
 */
function calculateWeeklySummary(weeklyMetrics) {
  if (weeklyMetrics.length === 0) {
    return {
      totalRuns: 0,
      avgSuccessRate: 0,
      totalStories: 0,
      totalCost: 0,
      daysReported: 0,
    };
  }

  const totalRuns = weeklyMetrics.reduce((sum, m) => sum + (m.totals?.totalRuns || 0), 0);
  const avgSuccessRate = Math.round(
    weeklyMetrics.reduce((sum, m) => sum + (m.totals?.successRate || 0), 0) / weeklyMetrics.length
  );
  const totalStories = weeklyMetrics.reduce(
    (sum, m) => sum + (m.totals?.storiesCompleted || 0),
    0
  );
  const totalCost = weeklyMetrics.reduce((sum, m) => sum + (m.totals?.totalCost || 0), 0);

  return {
    totalRuns,
    avgSuccessRate,
    totalStories,
    totalCost: Math.round(totalCost * 100) / 100,
    daysReported: weeklyMetrics.length,
  };
}

/**
 * Perform budget analysis
 */
function analyzeBudget(weeklySummary, config) {
  const monthlyBudget = config.budgets?.monthly || 2000;
  const weeklyAllocation = monthlyBudget / 4; // Assuming 4 weeks per month
  const percentUsed = Math.round((weeklySummary.totalCost / weeklyAllocation) * 100);
  const [warningThreshold, criticalThreshold] = config.budgets?.alertThresholds || [80, 95];

  let severity = "normal";
  if (percentUsed >= criticalThreshold) {
    severity = "critical";
  } else if (percentUsed >= warningThreshold) {
    severity = "warning";
  }

  return {
    weeklyAllocation,
    totalSpent: weeklySummary.totalCost,
    remaining: Math.round((weeklyAllocation - weeklySummary.totalCost) * 100) / 100,
    percentUsed,
    severity,
    warningThreshold,
    criticalThreshold,
  };
}

/**
 * Identify top cost drivers
 */
function identifyTopCostDrivers(weeklyMetrics) {
  const projectCosts = {};

  for (const metrics of weeklyMetrics) {
    if (!metrics.projects) continue;

    for (const project of metrics.projects) {
      if (!projectCosts[project.name]) {
        projectCosts[project.name] = 0;
      }
      projectCosts[project.name] += project.totalCost || 0;
    }
  }

  return Object.entries(projectCosts)
    .map(([name, cost]) => ({ name, cost: Math.round(cost * 100) / 100 }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 5);
}

/**
 * Generate markdown report (fallback when PDF generation not available)
 */
function generateMarkdownReport(weeklyMetrics, summary, budgetAnalysis, topCostDrivers) {
  const startDate = weeklyMetrics[0]?.timestamp?.split("T")[0] || "unknown";
  const endDate = weeklyMetrics[weeklyMetrics.length - 1]?.timestamp?.split("T")[0] || "unknown";

  let report = `# Weekly Executive Summary\n\n`;
  report += `**Period:** ${startDate} to ${endDate}\n`;
  report += `**Generated:** ${new Date().toLocaleString()}\n\n`;
  report += `---\n\n`;

  // Executive Summary
  report += `## Executive Summary\n\n`;
  report += `| Metric | Value |\n`;
  report += `|--------|-------|\n`;
  report += `| **Days Reported** | ${summary.daysReported} of 7 |\n`;
  report += `| **Total Runs** | ${summary.totalRuns} |\n`;
  report += `| **Average Success Rate** | ${summary.avgSuccessRate}% |\n`;
  report += `| **Stories Completed** | ${summary.totalStories} |\n`;
  report += `| **Total Cost** | $${summary.totalCost} |\n\n`;

  // Budget Analysis
  report += `## Budget Analysis\n\n`;
  const budgetIcon = budgetAnalysis.severity === "critical" ? "🚨" :
                     budgetAnalysis.severity === "warning" ? "⚠️" : "✅";

  report += `${budgetIcon} **Status:** ${budgetAnalysis.severity.toUpperCase()}\n\n`;
  report += `| Item | Amount |\n`;
  report += `|------|--------|\n`;
  report += `| **Weekly Allocation** | $${budgetAnalysis.weeklyAllocation} |\n`;
  report += `| **Total Spent** | $${budgetAnalysis.totalSpent} |\n`;
  report += `| **Remaining** | $${budgetAnalysis.remaining} |\n`;
  report += `| **Percent Used** | ${budgetAnalysis.percentUsed}% |\n\n`;

  if (budgetAnalysis.severity !== "normal") {
    report += `> **Alert:** Budget ${budgetAnalysis.severity === "critical" ? "critically" : ""} exceeded ${budgetAnalysis.percentUsed}% of weekly allocation.\n\n`;
  }

  // Top Cost Drivers
  if (topCostDrivers.length > 0) {
    report += `## Top Cost Drivers\n\n`;
    report += `| Rank | Project | Cost |\n`;
    report += `|------|---------|------|\n`;
    topCostDrivers.forEach((driver, index) => {
      report += `| ${index + 1} | ${driver.name} | $${driver.cost} |\n`;
    });
    report += `\n`;
  }

  // Daily Trends
  report += `## Daily Trends\n\n`;
  report += `| Date | Success Rate | Stories | Cost |\n`;
  report += `|------|--------------|---------|------|\n`;
  weeklyMetrics.forEach((m) => {
    const date = m.timestamp ? m.timestamp.split("T")[0] : "unknown";
    const successRate = m.totals?.successRate || 0;
    const stories = m.totals?.storiesCompleted || 0;
    const cost = m.totals?.totalCost || 0;
    report += `| ${date} | ${successRate}% | ${stories} | $${cost.toFixed(2)} |\n`;
  });
  report += `\n`;

  // Recommendations
  report += `## Recommendations\n\n`;
  if (budgetAnalysis.severity === "critical") {
    report += `- **Immediate action required:** Budget exceeded critical threshold (${budgetAnalysis.criticalThreshold}%)\n`;
    report += `- Review and reduce model usage (consider Haiku for simpler tasks)\n`;
    report += `- Pause non-critical builds until budget reviewed\n`;
  } else if (budgetAnalysis.severity === "warning") {
    report += `- **Caution:** Approaching budget limit (${budgetAnalysis.warningThreshold}%)\n`;
    report += `- Monitor spending closely for remainder of month\n`;
    report += `- Consider optimizing prompts to reduce token usage\n`;
  } else {
    report += `- Budget on track, continue current pace\n`;
    report += `- Success rate ${summary.avgSuccessRate >= 80 ? "healthy" : "needs improvement"}\n`;
    report += `- Stories completed: ${summary.totalStories} this week\n`;
  }

  report += `\n---\n\n`;
  report += `_Generated by Ralph Automation System_\n`;

  return report;
}

/**
 * Main execution
 */
async function main() {
  console.log("=".repeat(60));
  console.log("  PDF Report Generator - Weekly Executive Summary");
  console.log("=".repeat(60));

  // Load weekly metrics
  console.log("[1/5] Loading weekly metrics...");
  const weeklyMetrics = loadWeeklyMetrics();

  if (weeklyMetrics.length === 0) {
    console.error("[Error] No weekly metrics found. Run daily-status-report factory first.");
    process.exit(1);
  }

  console.log(`  Loaded ${weeklyMetrics.length} days of metrics`);

  // Load configuration
  console.log("[2/5] Loading configuration...");
  const config = loadAutomationConfig();

  // Calculate summary
  console.log("[3/5] Calculating weekly summary...");
  const summary = calculateWeeklySummary(weeklyMetrics);
  const budgetAnalysis = analyzeBudget(summary, config);
  const topCostDrivers = identifyTopCostDrivers(weeklyMetrics);

  console.log(`  Total runs: ${summary.totalRuns}`);
  console.log(`  Avg success rate: ${summary.avgSuccessRate}%`);
  console.log(`  Total cost: $${summary.totalCost}`);
  console.log(`  Budget status: ${budgetAnalysis.severity}`);

  // Generate markdown report
  console.log("[4/5] Generating report...");
  const markdownReport = generateMarkdownReport(weeklyMetrics, summary, budgetAnalysis, topCostDrivers);

  // Save report
  console.log("[5/5] Saving report...");
  const reportsDir = path.join(process.cwd(), ".ralph", "reports");
  const timestamp = new Date().toISOString().split("T")[0];
  const reportPath = path.join(reportsDir, `weekly-executive-${timestamp}.md`);

  fs.writeFileSync(reportPath, markdownReport);
  console.log(`  Saved to: ${reportPath}`);

  // Note about PDF generation
  console.log("\n  Note: PDF generation requires chartjs-node-canvas package");
  console.log("  Install with: npm install chartjs-node-canvas pdfkit");
  console.log("  For now, markdown report generated successfully.");

  console.log("=".repeat(60));
  console.log("  Summary");
  console.log("=".repeat(60));
  console.log(`  Days Reported: ${summary.daysReported} of 7`);
  console.log(`  Total Runs: ${summary.totalRuns}`);
  console.log(`  Average Success Rate: ${summary.avgSuccessRate}%`);
  console.log(`  Total Cost: $${summary.totalCost}`);
  console.log(`  Budget Status: ${budgetAnalysis.severity.toUpperCase()}`);
  console.log("=".repeat(60));

  process.exit(0);
}

// Execute if run directly
if (require.main === module) {
  main().catch((error) => {
    console.error("[Fatal Error]", error.message);
    console.error(error.stack);
    process.exit(1);
  });
}

module.exports = {
  main,
  loadWeeklyMetrics,
  calculateWeeklySummary,
  analyzeBudget,
  generateMarkdownReport,
};
