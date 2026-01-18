/**
 * Executive Summary API
 *
 * Unified metrics endpoint for executive dashboard.
 * Aggregates data across all game projects.
 */

import { Hono } from "hono";
import path from "path";
import fs from "fs";

const executiveSummary = new Hono();

/**
 * Load automation configuration
 */
function loadAutomationConfig() {
  const ralphRoot = process.env.RALPH_ROOT || path.join(__dirname, "../../../.ralph");
  const configPath = path.join(ralphRoot, "automation-config.json");

  if (!fs.existsSync(configPath)) {
    return {
      projects: [],
      budgets: { monthly: 2000, alertThresholds: [80, 95] },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("[Executive API] Failed to load config:", error);
    return {
      projects: [],
      budgets: { monthly: 2000, alertThresholds: [80, 95] },
    };
  }
}

/**
 * Load latest daily metrics
 */
function loadLatestMetrics() {
  const ralphRoot = process.env.RALPH_ROOT || path.join(__dirname, "../../../.ralph");
  const runsDir = path.join(ralphRoot, "factory", "runs");

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  const files = fs
    .readdirSync(runsDir)
    .filter((f) => f.startsWith("daily-metrics-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    return null;
  }

  try {
    const content = fs.readFileSync(path.join(runsDir, files[0]), "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error("[Executive API] Failed to load metrics:", error);
    return null;
  }
}

/**
 * Load historical metrics for trend analysis
 */
function loadHistoricalMetrics(days = 7) {
  const ralphRoot = process.env.RALPH_ROOT || path.join(__dirname, "../../../.ralph");
  const runsDir = path.join(ralphRoot, "factory", "runs");

  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(runsDir)
    .filter((f) => f.startsWith("daily-metrics-") && f.endsWith(".json"))
    .sort()
    .reverse()
    .slice(0, days);

  const metrics = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(runsDir, file), "utf-8");
      metrics.push(JSON.parse(content));
    } catch (error) {
      console.error(`[Executive API] Failed to load ${file}:`, error);
    }
  }

  return metrics;
}

/**
 * Calculate budget progress
 */
function calculateBudgetProgress(metrics, config) {
  const monthlyBudget = config.budgets?.monthly || 2000;
  const totalCost = metrics?.totals?.totalCost || 0;
  const percentUsed = Math.round((totalCost / monthlyBudget) * 100);
  const [warningThreshold, criticalThreshold] = config.budgets?.alertThresholds || [80, 95];

  let severity = "normal";
  if (percentUsed >= criticalThreshold) {
    severity = "critical";
  } else if (percentUsed >= warningThreshold) {
    severity = "warning";
  }

  return {
    monthlyBudget,
    totalCost: Math.round(totalCost * 100) / 100,
    percentUsed,
    remaining: Math.round((monthlyBudget - totalCost) * 100) / 100,
    severity,
    warningThreshold,
    criticalThreshold,
  };
}

/**
 * Detect top performers (highest velocity teams)
 */
function detectTopPerformers(metrics) {
  if (!metrics || !metrics.disciplines) {
    return [];
  }

  return metrics.disciplines
    .map((d) => ({
      discipline: d.discipline,
      successRate: d.successRate,
      totalRuns: d.totalRuns,
      projects: d.projects,
    }))
    .sort((a, b) => b.successRate - a.successRate)
    .slice(0, 3);
}

/**
 * GET /api/executive-summary
 *
 * Returns unified executive metrics across all game projects.
 *
 * Query params:
 *   - days: Number of days for historical trends (default: 7)
 */
executiveSummary.get("/", (c) => {
  const days = parseInt(c.req.query("days") || "7", 10);

  try {
    const config = loadAutomationConfig();
    const latestMetrics = loadLatestMetrics();
    const historicalMetrics = loadHistoricalMetrics(days);

    if (!latestMetrics) {
      return c.json({
        error: "No metrics available. Run 'ralph factory run daily-status-report' first.",
        available: false,
      });
    }

    // Cost by Game
    const costByGame = latestMetrics.projects?.map((p) => ({
      name: p.name,
      cost: p.totalCost || 0,
      runs: p.totalRuns,
      successRate: p.successRate,
    })) || [];

    // Velocity by Discipline
    const velocityByDiscipline = latestMetrics.disciplines?.map((d) => ({
      discipline: d.discipline,
      storiesCompleted: d.successfulRuns,
      runs: d.totalRuns,
      successRate: d.successRate,
    })) || [];

    // Success Rate Gauge
    const successRate = latestMetrics.totals?.successRate || 0;

    // Budget Progress
    const budgetProgress = calculateBudgetProgress(latestMetrics, config);

    // Alerts (budget overages and blockers)
    const alerts = [];
    if (budgetProgress.severity === "critical") {
      alerts.push({
        type: "budget",
        severity: "critical",
        message: `Budget critically exceeded: ${budgetProgress.percentUsed}% used`,
      });
    } else if (budgetProgress.severity === "warning") {
      alerts.push({
        type: "budget",
        severity: "warning",
        message: `Budget warning: ${budgetProgress.percentUsed}% used`,
      });
    }

    if (latestMetrics.blockers && latestMetrics.blockers.length > 0) {
      alerts.push({
        type: "blockers",
        severity: "warning",
        message: `${latestMetrics.blockers.length} PRD(s) with zero velocity`,
        count: latestMetrics.blockers.length,
      });
    }

    // Blockers
    const blockers = latestMetrics.blockers || [];

    // Top Performers
    const topPerformers = detectTopPerformers(latestMetrics);

    // Trends (historical data)
    const trends = historicalMetrics.map((m) => ({
      date: m.timestamp ? m.timestamp.split("T")[0] : "unknown",
      successRate: m.totals?.successRate || 0,
      totalCost: m.totals?.totalCost || 0,
      storiesCompleted: m.totals?.storiesCompleted || 0,
    }));

    return c.json({
      available: true,
      timestamp: latestMetrics.timestamp,
      generated: new Date().toISOString(),
      costByGame,
      velocityByDiscipline,
      successRate,
      budgetProgress,
      alerts,
      blockers,
      topPerformers,
      trends,
      totals: latestMetrics.totals,
    });
  } catch (error) {
    console.error("[Executive API] Error:", error);
    return c.json({
      error: error.message,
      available: false,
    }, 500);
  }
});

export default executiveSummary;
