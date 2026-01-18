#!/usr/bin/env node

/**
 * Aggregate Game Metrics - Multi-Project Metrics Aggregator
 *
 * Scans multiple game projects' .ralph directories and generates unified daily metrics.
 * Used by daily-status-report factory for automated reporting.
 */

const fs = require("fs");
const path = require("path");
const {
  scanMultipleProjects,
  groupByProject,
  groupByDiscipline,
  calculateSuccessRate,
  aggregateVelocityMetrics,
  getAllCostData,
} = require("../lib/metrics/aggregator");

/**
 * Load automation configuration
 * @returns {Object} Automation config object
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    console.error(`[Error] Automation config not found at: ${configPath}`);
    console.error("Run: cp .ralph/automation-config.example.json .ralph/automation-config.json");
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`[Error] Failed to parse automation config: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Calculate daily KPIs from aggregated runs
 * @param {Object[]} runs - Array of runs with project context
 * @returns {Object} Daily KPIs
 */
function calculateDailyKPIs(runs) {
  const totalRuns = runs.length;
  const successfulRuns = runs.filter((r) => r.status === "success").length;
  const failedRuns = totalRuns - successfulRuns;
  const successRate = calculateSuccessRate(runs);

  // Calculate stories completed
  const storiesCompleted = new Set(
    runs.filter((r) => r.status === "success" && r.story).map((r) => r.story)
  ).size;

  // Calculate velocity (stories per day)
  const today = new Date().toISOString().split("T")[0];
  const todayRuns = runs.filter((r) => {
    if (!r.startedAt) return false;
    const runDate = r.startedAt.split(" ")[0];
    return runDate === today;
  });

  const todayStories = new Set(
    todayRuns.filter((r) => r.status === "success" && r.story).map((r) => r.story)
  ).size;

  // Calculate total cost (if token data available)
  let totalCost = 0;
  for (const run of runs) {
    if (run.cost) {
      totalCost += run.cost;
    }
  }

  return {
    totalRuns,
    successfulRuns,
    failedRuns,
    successRate,
    storiesCompleted,
    todayStories,
    velocity: todayStories, // Stories completed today
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
  };
}

/**
 * Detect blockers (PRDs with zero velocity in last N days)
 * @param {Object[]} runs - Array of runs
 * @param {number} days - Number of days to check (default: 2)
 * @returns {Object[]} Array of blocked PRDs
 */
function detectBlockers(runs, days = 2) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);
  const cutoffStr = cutoffDate.toISOString().split("T")[0];

  // Group runs by PRD
  const prdGroups = {};
  for (const run of runs) {
    const prdId = run.prdId || "unknown";
    if (!prdGroups[prdId]) {
      prdGroups[prdId] = {
        prdId,
        projectName: run.projectName,
        discipline: run.discipline,
        runs: [],
        lastActivity: null,
      };
    }
    prdGroups[prdId].runs.push(run);

    // Track last activity
    if (run.startedAt) {
      const runDate = run.startedAt.split(" ")[0];
      if (!prdGroups[prdId].lastActivity || runDate > prdGroups[prdId].lastActivity) {
        prdGroups[prdId].lastActivity = runDate;
      }
    }
  }

  // Find PRDs with no activity after cutoff date
  const blockers = [];
  for (const [prdId, data] of Object.entries(prdGroups)) {
    if (!data.lastActivity || data.lastActivity < cutoffStr) {
      blockers.push({
        prdId,
        projectName: data.projectName,
        discipline: data.discipline,
        lastActivity: data.lastActivity || "never",
        daysSinceActivity: data.lastActivity
          ? Math.floor((new Date() - new Date(data.lastActivity)) / (1000 * 60 * 60 * 24))
          : 999,
      });
    }
  }

  return blockers;
}

/**
 * Main execution
 */
async function main() {
  const startTime = Date.now();
  console.log("=".repeat(60));
  console.log("  Aggregate Game Metrics - Multi-Project Scanner");
  console.log("=".repeat(60));

  // Load configuration
  console.log("[1/5] Loading automation configuration...");
  const config = loadAutomationConfig();

  if (!config.projects || config.projects.length === 0) {
    console.error("[Error] No projects configured in automation-config.json");
    process.exit(1);
  }

  console.log(`  Found ${config.projects.length} projects configured`);

  // Scan multiple projects
  console.log("[2/5] Scanning projects for metrics...");
  const allRuns = scanMultipleProjects(config.projects);
  console.log(`  Scanned ${allRuns.length} total runs across all projects`);

  // Group by project and discipline
  console.log("[3/5] Grouping metrics...");
  const byProject = groupByProject(allRuns);
  const byDiscipline = groupByDiscipline(allRuns);
  console.log(`  Projects: ${Object.keys(byProject).length}`);
  console.log(`  Disciplines: ${Object.keys(byDiscipline).length}`);

  // Calculate daily KPIs
  console.log("[4/5] Calculating KPIs...");
  const totals = calculateDailyKPIs(allRuns);
  const blockers = detectBlockers(allRuns, 2);

  if (blockers.length > 0) {
    console.log(`  WARNING: ${blockers.length} blocked PRDs detected`);
  }

  // Generate output
  console.log("[5/5] Writing metrics JSON...");
  const timestamp = new Date().toISOString();
  const dateStr = timestamp.split("T")[0];

  const output = {
    timestamp,
    generated: new Date().toLocaleString(),
    runDurationMs: Date.now() - startTime,
    projectsScanned: config.projects.length,
    totals,
    projects: Object.values(byProject).map((p) => ({
      name: p.projectName,
      path: p.projectPath,
      team: p.team,
      totalRuns: p.totalRuns,
      successfulRuns: p.successfulRuns,
      failedRuns: p.failedRuns,
      successRate: p.successRate,
    })),
    disciplines: Object.values(byDiscipline).map((d) => ({
      discipline: d.discipline,
      totalRuns: d.totalRuns,
      successfulRuns: d.successfulRuns,
      failedRuns: d.failedRuns,
      successRate: d.successRate,
      projects: d.projects,
    })),
    blockers,
  };

  const outputPath = path.join(
    process.cwd(),
    ".ralph",
    "factory",
    "runs",
    `daily-metrics-${dateStr}.json`
  );

  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`  Saved to: ${outputPath}`);

  console.log("=".repeat(60));
  console.log("  Summary");
  console.log("=".repeat(60));
  console.log(`  Total Runs: ${totals.totalRuns}`);
  console.log(`  Success Rate: ${totals.successRate}%`);
  console.log(`  Stories Completed: ${totals.storiesCompleted}`);
  console.log(`  Total Cost: $${totals.totalCost}`);
  if (blockers.length > 0) {
    console.log(`  Blockers: ${blockers.length} PRDs with zero velocity`);
  }
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

module.exports = { main, calculateDailyKPIs, detectBlockers };
