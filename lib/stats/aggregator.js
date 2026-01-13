/**
 * Stats aggregator - computes aggregate metrics across runs
 *
 * Provides metrics for:
 * - Total runs, success rate, avg duration
 * - Trends over time (daily/weekly)
 * - Guardrail impact analysis
 * - Cross-project aggregation (with --global)
 */
const fs = require("fs");
const path = require("path");
const { parseRunSummary, parseRunLog, listRunSummaries } = require("../eval/parser");

/**
 * Group runs by date (YYYY-MM-DD)
 * @param {Object[]} runs - Array of parsed run objects
 * @returns {Object} - Runs grouped by date
 */
function groupRunsByDate(runs) {
  const groups = {};

  for (const run of runs) {
    if (!run.startedAt) continue;

    // Extract date from startedAt (e.g., "2026-01-13 21:07:03")
    const dateMatch = run.startedAt.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const date = dateMatch[1];
    if (!groups[date]) {
      groups[date] = [];
    }
    groups[date].push(run);
  }

  return groups;
}

/**
 * Group runs by week (YYYY-WNN)
 * @param {Object[]} runs - Array of parsed run objects
 * @returns {Object} - Runs grouped by week
 */
function groupRunsByWeek(runs) {
  const groups = {};

  for (const run of runs) {
    if (!run.startedAt) continue;

    const dateMatch = run.startedAt.match(/^(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) continue;

    const date = new Date(dateMatch[1]);
    const year = date.getFullYear();
    const weekNum = getWeekNumber(date);
    const key = `${year}-W${String(weekNum).padStart(2, "0")}`;

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(run);
  }

  return groups;
}

/**
 * Get ISO week number for a date
 * @param {Date} date - Date object
 * @returns {number} - Week number (1-53)
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

/**
 * Calculate success rate for a set of runs
 * @param {Object[]} runs - Array of parsed run objects
 * @returns {number|null} - Success rate as percentage, or null if no runs
 */
function calculateSuccessRate(runs) {
  if (!runs || runs.length === 0) return null;

  const successCount = runs.filter((r) => r.status === "success").length;
  return Math.round((successCount / runs.length) * 100);
}

/**
 * Calculate average duration for a set of runs
 * @param {Object[]} runs - Array of parsed run objects
 * @returns {number|null} - Average duration in seconds, or null if no data
 */
function calculateAvgDuration(runs) {
  if (!runs || runs.length === 0) return null;

  const durations = runs.map((r) => r.duration).filter((d) => d != null);
  if (durations.length === 0) return null;

  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}

/**
 * Parse guardrails and extract when they were added
 * @param {string} projectPath - Path to project
 * @returns {Object[]} - Array of guardrail info with dates
 */
function parseGuardrailsWithDates(projectPath) {
  const guardrailsPath = path.join(projectPath, ".ralph", "guardrails.md");
  if (!fs.existsSync(guardrailsPath)) {
    return [];
  }

  const guardrails = [];
  try {
    const content = fs.readFileSync(guardrailsPath, "utf-8");

    // Match guardrail blocks
    const signRegex = /### Sign: ([^\n]+)\n([\s\S]*?)(?=###|$)/g;
    let match;
    while ((match = signRegex.exec(content)) !== null) {
      const title = match[1].trim();
      const body = match[2].trim();

      // Try to extract "Added after:" date
      const addedMatch = body.match(/\*\*Added after\*\*:\s*(.+)/);
      const acceptedMatch = body.match(/Accepted at:\s*(\d{4}-\d{2}-\d{2})/);

      let addedDate = null;
      if (acceptedMatch) {
        addedDate = acceptedMatch[1];
      } else if (addedMatch) {
        // Try to extract date from "Added after" text
        const dateInAdded = addedMatch[1].match(/(\d{4}-\d{2}-\d{2})/);
        if (dateInAdded) {
          addedDate = dateInAdded[1];
        }
      }

      guardrails.push({
        title,
        addedDate,
        content: body,
      });
    }
  } catch {
    // ignore
  }

  return guardrails;
}

/**
 * Calculate trend direction and magnitude
 * @param {number} current - Current value
 * @param {number} previous - Previous value
 * @returns {Object} - Trend info { direction, change, arrow }
 */
function calculateTrend(current, previous) {
  if (previous == null || current == null) {
    return { direction: "stable", change: 0, arrow: "-" };
  }

  const change = current - previous;
  const percentChange = previous !== 0 ? Math.round((change / previous) * 100) : 0;

  if (change > 0) {
    return { direction: "up", change: percentChange, arrow: "\u2191" };
  } else if (change < 0) {
    return { direction: "down", change: Math.abs(percentChange), arrow: "\u2193" };
  }
  return { direction: "stable", change: 0, arrow: "-" };
}

/**
 * Aggregate metrics for a single project
 * @param {string} projectPath - Path to project
 * @returns {Object} - Aggregated metrics
 */
function aggregateProjectMetrics(projectPath) {
  const runsDir = path.join(projectPath, ".ralph", "runs");
  const summaryPaths = listRunSummaries(runsDir);

  // Parse all runs
  const runs = summaryPaths
    .map((p) => parseRunSummary(p))
    .filter((r) => r !== null);

  // Basic metrics
  const totalRuns = runs.length;
  const successCount = runs.filter((r) => r.status === "success").length;
  const failedCount = runs.filter((r) => r.status === "error").length;
  const successRate = totalRuns > 0 ? Math.round((successCount / totalRuns) * 100) : null;

  // Duration metrics
  const durations = runs.map((r) => r.duration).filter((d) => d != null);
  const avgDuration = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : null;
  const minDuration = durations.length > 0 ? Math.min(...durations) : null;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : null;
  const totalDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) : 0;

  // Time-based grouping for trends
  const runsByDate = groupRunsByDate(runs);
  const runsByWeek = groupRunsByWeek(runs);

  // Get sorted dates and weeks
  const dates = Object.keys(runsByDate).sort();
  const weeks = Object.keys(runsByWeek).sort();

  // Calculate daily stats
  const dailyStats = dates.map((date) => ({
    date,
    runs: runsByDate[date].length,
    successRate: calculateSuccessRate(runsByDate[date]),
    avgDuration: calculateAvgDuration(runsByDate[date]),
  }));

  // Calculate weekly stats
  const weeklyStats = weeks.map((week) => ({
    week,
    runs: runsByWeek[week].length,
    successRate: calculateSuccessRate(runsByWeek[week]),
    avgDuration: calculateAvgDuration(runsByWeek[week]),
  }));

  // Success rate trend (compare last week to previous week)
  let successRateTrend = { direction: "stable", change: 0, arrow: "-" };
  if (weeklyStats.length >= 2) {
    const current = weeklyStats[weeklyStats.length - 1].successRate;
    const previous = weeklyStats[weeklyStats.length - 2].successRate;
    successRateTrend = calculateTrend(current, previous);
  }

  // Duration trend (compare last week to previous week)
  let durationTrend = { direction: "stable", change: 0, arrow: "-" };
  if (weeklyStats.length >= 2) {
    const current = weeklyStats[weeklyStats.length - 1].avgDuration;
    const previous = weeklyStats[weeklyStats.length - 2].avgDuration;
    // For duration, down is good
    const rawTrend = calculateTrend(current, previous);
    durationTrend = {
      ...rawTrend,
      isImprovement: rawTrend.direction === "down",
    };
  }

  // Guardrail metrics
  const guardrails = parseGuardrailsWithDates(projectPath);
  const guardrailCount = guardrails.length;

  // Find guardrails that improved success rate
  const guardrailImpacts = [];
  for (const guardrail of guardrails) {
    if (!guardrail.addedDate) continue;

    // Get runs before and after guardrail
    const runsBefore = runs.filter((r) => {
      if (!r.startedAt) return false;
      const runDate = r.startedAt.split(" ")[0];
      return runDate < guardrail.addedDate;
    });
    const runsAfter = runs.filter((r) => {
      if (!r.startedAt) return false;
      const runDate = r.startedAt.split(" ")[0];
      return runDate >= guardrail.addedDate;
    });

    if (runsBefore.length >= 3 && runsAfter.length >= 3) {
      const rateBefore = calculateSuccessRate(runsBefore);
      const rateAfter = calculateSuccessRate(runsAfter);

      if (rateBefore != null && rateAfter != null) {
        const improvement = rateAfter - rateBefore;
        if (Math.abs(improvement) >= 5) {
          guardrailImpacts.push({
            title: guardrail.title,
            addedDate: guardrail.addedDate,
            rateBefore,
            rateAfter,
            improvement,
            isPositive: improvement > 0,
          });
        }
      }
    }
  }

  // Sort impacts by improvement magnitude
  guardrailImpacts.sort((a, b) => Math.abs(b.improvement) - Math.abs(a.improvement));

  // Count by mode
  const modeStats = {};
  for (const run of runs) {
    const mode = run.mode || "unknown";
    if (!modeStats[mode]) {
      modeStats[mode] = { total: 0, success: 0 };
    }
    modeStats[mode].total++;
    if (run.status === "success") {
      modeStats[mode].success++;
    }
  }

  // First and last run dates
  const firstRun = runs.length > 0 ? runs[0].startedAt : null;
  const lastRun = runs.length > 0 ? runs[runs.length - 1].startedAt : null;

  return {
    totalRuns,
    successCount,
    failedCount,
    successRate,
    avgDuration,
    minDuration,
    maxDuration,
    totalDuration,
    guardrailCount,
    firstRun,
    lastRun,
    successRateTrend,
    durationTrend,
    dailyStats,
    weeklyStats,
    guardrailImpacts: guardrailImpacts.slice(0, 5), // Top 5 impacts
    modeStats,
    runsPerDay: dates.length > 0 ? Math.round((totalRuns / dates.length) * 10) / 10 : 0,
  };
}

/**
 * Aggregate metrics across multiple projects (global)
 * @param {Object[]} projects - Array of project entries from registry
 * @returns {Object} - Aggregated cross-project metrics
 */
function aggregateGlobalMetrics(projects) {
  let totalRuns = 0;
  let totalSuccess = 0;
  let totalFailed = 0;
  let totalGuardrails = 0;
  let allDurations = [];
  const projectStats = [];

  for (const project of projects) {
    try {
      const metrics = aggregateProjectMetrics(project.path);
      totalRuns += metrics.totalRuns;
      totalSuccess += metrics.successCount;
      totalFailed += metrics.failedCount;
      totalGuardrails += metrics.guardrailCount;

      if (metrics.avgDuration != null) {
        allDurations.push({
          duration: metrics.avgDuration,
          runs: metrics.totalRuns,
        });
      }

      projectStats.push({
        name: project.name,
        path: project.path,
        runs: metrics.totalRuns,
        successRate: metrics.successRate,
        avgDuration: metrics.avgDuration,
        guardrails: metrics.guardrailCount,
        successRateTrend: metrics.successRateTrend,
      });
    } catch {
      // Skip projects that fail to aggregate
    }
  }

  // Weighted average duration
  let avgDuration = null;
  if (allDurations.length > 0) {
    const totalWeighted = allDurations.reduce((sum, d) => sum + d.duration * d.runs, 0);
    const totalWeight = allDurations.reduce((sum, d) => sum + d.runs, 0);
    avgDuration = totalWeight > 0 ? Math.round(totalWeighted / totalWeight) : null;
  }

  // Overall success rate
  const successRate = totalRuns > 0 ? Math.round((totalSuccess / totalRuns) * 100) : null;

  // Sort projects by run count
  projectStats.sort((a, b) => b.runs - a.runs);

  return {
    projectCount: projects.length,
    totalRuns,
    successCount: totalSuccess,
    failedCount: totalFailed,
    successRate,
    avgDuration,
    totalGuardrails,
    projectStats,
    topProjects: projectStats.slice(0, 10),
  };
}

/**
 * Save metrics to cache file
 * @param {Object} metrics - Metrics object
 * @param {string} projectPath - Project path
 */
function saveMetricsCache(metrics, projectPath) {
  const metricsDir = path.join(projectPath, ".ralph", "metrics");
  const metricsPath = path.join(metricsDir, "stats.json");

  try {
    fs.mkdirSync(metricsDir, { recursive: true });
    fs.writeFileSync(
      metricsPath,
      JSON.stringify(
        {
          ...metrics,
          generatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {
    // Ignore cache errors
  }
}

/**
 * Load metrics from cache file
 * @param {string} projectPath - Project path
 * @returns {Object|null} - Cached metrics or null
 */
function loadMetricsCache(projectPath) {
  const metricsPath = path.join(projectPath, ".ralph", "metrics", "stats.json");

  try {
    if (fs.existsSync(metricsPath)) {
      const content = fs.readFileSync(metricsPath, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // Ignore cache errors
  }

  return null;
}

/**
 * Check if cache is still valid (run summaries haven't changed)
 * @param {string} projectPath - Project path
 * @param {Object} cache - Cached metrics
 * @returns {boolean} - True if cache is valid
 */
function isCacheValid(projectPath, cache) {
  if (!cache || !cache.generatedAt) return false;

  const runsDir = path.join(projectPath, ".ralph", "runs");
  if (!fs.existsSync(runsDir)) return cache.totalRuns === 0;

  try {
    const cacheTime = new Date(cache.generatedAt).getTime();
    const files = fs.readdirSync(runsDir);

    // Check if any run file is newer than cache
    for (const file of files) {
      const filePath = path.join(runsDir, file);
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs > cacheTime) {
        return false;
      }
    }

    return true;
  } catch {
    return false;
  }
}

module.exports = {
  aggregateProjectMetrics,
  aggregateGlobalMetrics,
  saveMetricsCache,
  loadMetricsCache,
  isCacheValid,
  groupRunsByDate,
  groupRunsByWeek,
  calculateSuccessRate,
  calculateAvgDuration,
  calculateTrend,
  parseGuardrailsWithDates,
};
