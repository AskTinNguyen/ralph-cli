/**
 * Metrics Aggregator - Computes trend data across runs for visualization
 *
 * Provides:
 * - Daily success rate time series
 * - Aggregation by PRD, agent, or developer
 * - Detection of significant changes
 */
const fs = require("fs");
const path = require("path");
const { parseRunSummary, listRunSummaries } = require("../eval/parser");

/**
 * Get all runs from a PRD directory
 * @param {string} prdPath - Path to PRD-N directory
 * @returns {Object[]} Array of parsed run objects with PRD context
 */
function getRunsFromPrd(prdPath) {
  const runsDir = path.join(prdPath, "runs");
  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const summaryPaths = listRunSummaries(runsDir);
  const prdId = path.basename(prdPath).replace("PRD-", "");

  return summaryPaths
    .map((p) => {
      const run = parseRunSummary(p);
      if (run) {
        run.prdId = prdId;
        run.summaryPath = p;
      }
      return run;
    })
    .filter((r) => r !== null);
}

/**
 * Get all runs across all PRDs in the .ralph directory
 * @param {string} ralphRoot - Path to .ralph directory
 * @returns {Object[]} Array of all runs with PRD context
 */
function getAllRuns(ralphRoot) {
  if (!fs.existsSync(ralphRoot)) {
    return [];
  }

  const allRuns = [];
  const entries = fs.readdirSync(ralphRoot);

  for (const entry of entries) {
    if (entry.startsWith("PRD-")) {
      const prdPath = path.join(ralphRoot, entry);
      const stat = fs.statSync(prdPath);
      if (stat.isDirectory()) {
        const runs = getRunsFromPrd(prdPath);
        allRuns.push(...runs);
      }
    }
  }

  return allRuns;
}

/**
 * Extract agent from run log path or mode
 * @param {Object} run - Parsed run object
 * @returns {string} Agent name or 'unknown'
 */
function extractAgent(run) {
  if (run.mode) {
    // Mode might be like "build" or include agent info
    return run.mode.toLowerCase();
  }

  // Try to extract from log path or other fields
  if (run.logPath) {
    if (run.logPath.includes("claude")) return "claude";
    if (run.logPath.includes("codex")) return "codex";
    if (run.logPath.includes("droid")) return "droid";
  }

  return "unknown";
}

/**
 * Extract developer from git info if available
 * @param {Object} run - Parsed run object
 * @returns {string} Developer name or 'unknown'
 */
function extractDeveloper(run) {
  // For now, return 'default' as developer tracking isn't in the base system
  // This could be extended to parse git author info from commits
  return "default";
}

/**
 * Group runs by date (YYYY-MM-DD)
 * @param {Object[]} runs - Array of parsed run objects
 * @returns {Object} Runs grouped by date
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
 * Calculate success rate for a set of runs
 * @param {Object[]} runs - Array of parsed run objects
 * @returns {number|null} Success rate as percentage (0-100), or null if no runs
 */
function calculateSuccessRate(runs) {
  if (!runs || runs.length === 0) return null;

  const successCount = runs.filter((r) => r.status === "success").length;
  return Math.round((successCount / runs.length) * 100);
}

/**
 * Filter runs by criteria
 * @param {Object[]} runs - Array of runs
 * @param {Object} filters - Filter criteria { prd, agent, developer }
 * @returns {Object[]} Filtered runs
 */
function filterRuns(runs, filters = {}) {
  let filtered = runs;

  if (filters.prd && filters.prd !== "all") {
    filtered = filtered.filter((r) => r.prdId === String(filters.prd));
  }

  if (filters.agent && filters.agent !== "all") {
    filtered = filtered.filter((r) => extractAgent(r) === filters.agent);
  }

  if (filters.developer && filters.developer !== "all") {
    filtered = filtered.filter((r) => extractDeveloper(r) === filters.developer);
  }

  return filtered;
}

/**
 * Get date N days ago in YYYY-MM-DD format
 * @param {number} days - Number of days ago
 * @returns {string} Date string
 */
function getDateDaysAgo(days) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split("T")[0];
}

/**
 * Aggregate daily success rate metrics
 * @param {string} ralphRoot - Path to .ralph directory
 * @param {Object} options - Options { days, prd, agent, developer }
 * @returns {Object} Aggregated metrics with time series
 */
function aggregateDailyMetrics(ralphRoot, options = {}) {
  const days = options.days || 7;
  const startDate = getDateDaysAgo(days);

  // Get all runs
  let allRuns = getAllRuns(ralphRoot);

  // Apply filters
  allRuns = filterRuns(allRuns, {
    prd: options.prd,
    agent: options.agent,
    developer: options.developer,
  });

  // Filter by date range
  allRuns = allRuns.filter((run) => {
    if (!run.startedAt) return false;
    const runDate = run.startedAt.split(" ")[0];
    return runDate >= startDate;
  });

  // Group by date
  const runsByDate = groupRunsByDate(allRuns);
  const dates = Object.keys(runsByDate).sort();

  // Calculate daily metrics
  const dailyMetrics = dates.map((date) => {
    const dayRuns = runsByDate[date];
    const total = dayRuns.length;
    const passed = dayRuns.filter((r) => r.status === "success").length;
    const failed = total - passed;
    const successRate = calculateSuccessRate(dayRuns);

    return {
      date,
      total,
      passed,
      failed,
      successRate,
    };
  });

  // Calculate overall stats
  const totalRuns = allRuns.length;
  const totalPassed = allRuns.filter((r) => r.status === "success").length;
  const overallSuccessRate = calculateSuccessRate(allRuns);

  // Detect significant changes (>10% week-over-week)
  const significantChanges = detectSignificantChanges(dailyMetrics);

  return {
    period: `${days}d`,
    startDate,
    endDate: new Date().toISOString().split("T")[0],
    totalRuns,
    totalPassed,
    totalFailed: totalRuns - totalPassed,
    overallSuccessRate,
    dailyMetrics,
    significantChanges,
    filters: {
      prd: options.prd || "all",
      agent: options.agent || "all",
      developer: options.developer || "all",
    },
  };
}

/**
 * Detect significant changes in success rate
 * @param {Object[]} dailyMetrics - Array of daily metric objects
 * @returns {Object[]} Array of significant change events
 */
function detectSignificantChanges(dailyMetrics) {
  const changes = [];
  const threshold = 10; // 10% change is significant

  for (let i = 1; i < dailyMetrics.length; i++) {
    const prev = dailyMetrics[i - 1];
    const curr = dailyMetrics[i];

    if (prev.successRate === null || curr.successRate === null) continue;

    const delta = curr.successRate - prev.successRate;
    if (Math.abs(delta) >= threshold) {
      changes.push({
        date: curr.date,
        previousRate: prev.successRate,
        currentRate: curr.successRate,
        delta,
        direction: delta > 0 ? "improved" : "declined",
        magnitude: Math.abs(delta),
      });
    }
  }

  return changes;
}

/**
 * Get list of available PRDs for filtering
 * @param {string} ralphRoot - Path to .ralph directory
 * @returns {string[]} Array of PRD IDs
 */
function getAvailablePrds(ralphRoot) {
  if (!fs.existsSync(ralphRoot)) {
    return [];
  }

  const prds = [];
  const entries = fs.readdirSync(ralphRoot);

  for (const entry of entries) {
    if (entry.startsWith("PRD-")) {
      const id = entry.replace("PRD-", "");
      prds.push(id);
    }
  }

  return prds.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/**
 * Get list of agents used across all runs
 * @param {string} ralphRoot - Path to .ralph directory
 * @returns {string[]} Array of agent names
 */
function getAvailableAgents(ralphRoot) {
  const allRuns = getAllRuns(ralphRoot);
  const agents = new Set();

  for (const run of allRuns) {
    const agent = extractAgent(run);
    if (agent && agent !== "unknown") {
      agents.add(agent);
    }
  }

  return Array.from(agents).sort();
}

/**
 * Calculate week-over-week comparison
 * @param {string} ralphRoot - Path to .ralph directory
 * @param {Object} options - Filter options
 * @returns {Object} Week-over-week comparison data
 */
function calculateWeekOverWeek(ralphRoot, options = {}) {
  const thisWeek = aggregateDailyMetrics(ralphRoot, { ...options, days: 7 });
  const lastWeek = aggregateDailyMetrics(ralphRoot, { ...options, days: 14 });

  // Calculate last week's stats (days 8-14 from lastWeek)
  const lastWeekStartDate = getDateDaysAgo(14);
  const lastWeekEndDate = getDateDaysAgo(8);

  const lastWeekRuns = getAllRuns(ralphRoot).filter((run) => {
    if (!run.startedAt) return false;
    const runDate = run.startedAt.split(" ")[0];
    return runDate >= lastWeekStartDate && runDate < lastWeekEndDate;
  });

  const lastWeekFiltered = filterRuns(lastWeekRuns, options);
  const lastWeekSuccessRate = calculateSuccessRate(lastWeekFiltered);

  const delta =
    thisWeek.overallSuccessRate !== null && lastWeekSuccessRate !== null
      ? thisWeek.overallSuccessRate - lastWeekSuccessRate
      : null;

  return {
    thisWeek: {
      successRate: thisWeek.overallSuccessRate,
      totalRuns: thisWeek.totalRuns,
    },
    lastWeek: {
      successRate: lastWeekSuccessRate,
      totalRuns: lastWeekFiltered.length,
    },
    delta,
    direction: delta === null ? "stable" : delta > 0 ? "improved" : delta < 0 ? "declined" : "stable",
    percentChange: lastWeekSuccessRate > 0 ? Math.round((delta / lastWeekSuccessRate) * 100) : null,
  };
}

module.exports = {
  aggregateDailyMetrics,
  getAllRuns,
  getRunsFromPrd,
  filterRuns,
  groupRunsByDate,
  calculateSuccessRate,
  detectSignificantChanges,
  getAvailablePrds,
  getAvailableAgents,
  calculateWeekOverWeek,
  extractAgent,
  extractDeveloper,
};
