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

// ============================================
// Cost Trends Functions
// ============================================

/**
 * Model pricing per 1M tokens (in dollars)
 * Based on standard Claude API pricing
 */
const MODEL_PRICING = {
  "claude-3-opus": { input: 15.0, output: 75.0 },
  "claude-3-sonnet": { input: 3.0, output: 15.0 },
  "claude-3-haiku": { input: 0.25, output: 1.25 },
  "claude-3.5-sonnet": { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
  sonnet: { input: 3.0, output: 15.0 },
  haiku: { input: 0.25, output: 1.25 },
  default: { input: 3.0, output: 15.0 }, // Default to sonnet pricing
};

/**
 * Calculate cost for a run based on tokens and model
 * @param {Object} run - Parsed run object with inputTokens and outputTokens
 * @returns {number} Cost in dollars
 */
function calculateRunCost(run) {
  const inputTokens = run.inputTokens || 0;
  const outputTokens = run.outputTokens || 0;

  // Find pricing for model
  let pricing = MODEL_PRICING.default;
  if (run.tokenModel) {
    const modelKey = run.tokenModel.toLowerCase();
    for (const [key, value] of Object.entries(MODEL_PRICING)) {
      if (modelKey.includes(key)) {
        pricing = value;
        break;
      }
    }
  }

  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;

  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
}

/**
 * Extract model name from run
 * @param {Object} run - Parsed run object
 * @returns {string} Normalized model name
 */
function extractModel(run) {
  if (!run.tokenModel) return "unknown";

  const model = run.tokenModel.toLowerCase();
  if (model.includes("opus")) return "opus";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("sonnet")) return "sonnet";

  return run.tokenModel;
}

/**
 * Load token cache from a PRD directory
 * @param {string} prdPath - Path to PRD-N directory
 * @returns {Object|null} Token cache data or null
 */
function loadTokenCache(prdPath) {
  const cachePath = path.join(prdPath, "tokens.json");

  if (!fs.existsSync(cachePath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Get cost data from token cache for a PRD
 * @param {string} prdPath - Path to PRD-N directory
 * @returns {Object[]} Array of cost records with date and model info
 */
function getCostDataFromCache(prdPath) {
  const cache = loadTokenCache(prdPath);
  if (!cache || !cache.runs) {
    return [];
  }

  const prdId = path.basename(prdPath).replace("PRD-", "");

  return cache.runs.map((run) => ({
    runId: run.runId,
    prdId,
    storyId: run.storyId,
    date: run.timestamp ? run.timestamp.split("T")[0] : null,
    cost: run.cost || 0,
    inputCost: run.inputCost || 0,
    outputCost: run.outputCost || 0,
    inputTokens: run.inputTokens || 0,
    outputTokens: run.outputTokens || 0,
    model: run.model || "unknown",
    estimated: run.estimated || false,
  }));
}

/**
 * Get all cost data across all PRDs
 * @param {string} ralphRoot - Path to .ralph directory
 * @returns {Object[]} Array of all cost records
 */
function getAllCostData(ralphRoot) {
  if (!fs.existsSync(ralphRoot)) {
    return [];
  }

  const allCosts = [];
  const entries = fs.readdirSync(ralphRoot);

  for (const entry of entries) {
    if (entry.startsWith("PRD-")) {
      const prdPath = path.join(ralphRoot, entry);
      const stat = fs.statSync(prdPath);
      if (stat.isDirectory()) {
        const costs = getCostDataFromCache(prdPath);
        allCosts.push(...costs);
      }
    }
  }

  return allCosts;
}

/**
 * Aggregate daily cost metrics
 * @param {string} ralphRoot - Path to .ralph directory
 * @param {Object} options - Options { days, prd, groupBy, model }
 * @returns {Object} Aggregated cost metrics with time series
 */
function aggregateDailyCosts(ralphRoot, options = {}) {
  const days = options.days || 30;
  const startDate = getDateDaysAgo(days);
  const groupBy = options.groupBy || "day"; // 'day' or 'week'

  // Get all cost data
  let allCosts = getAllCostData(ralphRoot);

  // Apply PRD filter
  if (options.prd && options.prd !== "all") {
    allCosts = allCosts.filter((c) => c.prdId === String(options.prd));
  }

  // Apply model filter
  if (options.model && options.model !== "all") {
    allCosts = allCosts.filter((c) => {
      const model = (c.model || "").toLowerCase();
      return model.includes(options.model.toLowerCase());
    });
  }

  // Filter by date range
  allCosts = allCosts.filter((cost) => {
    if (!cost.date) return false;
    return cost.date >= startDate;
  });

  // Group by date (or week)
  const groups = {};
  for (const cost of allCosts) {
    if (!cost.date) continue;

    let key = cost.date;
    if (groupBy === "week") {
      // Get start of week (Sunday)
      const date = new Date(cost.date);
      const dayOfWeek = date.getDay();
      date.setDate(date.getDate() - dayOfWeek);
      key = date.toISOString().split("T")[0];
    }

    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(cost);
  }

  // Calculate daily/weekly metrics
  const dates = Object.keys(groups).sort();
  const dailyMetrics = dates.map((date) => {
    const dayCosts = groups[date];
    const totalCost = dayCosts.reduce((sum, c) => sum + c.cost, 0);
    const runs = dayCosts.length;
    const stories = new Set(dayCosts.filter((c) => c.storyId).map((c) => c.storyId)).size;

    // Calculate cost per story for the day
    const costPerStory = stories > 0 ? totalCost / stories : 0;

    // Calculate cost by model for this date
    const byModel = {};
    for (const cost of dayCosts) {
      const model = cost.model || "unknown";
      if (!byModel[model]) {
        byModel[model] = { cost: 0, runs: 0 };
      }
      byModel[model].cost += cost.cost;
      byModel[model].runs += 1;
    }

    return {
      date,
      cost: Math.round(totalCost * 1_000_000) / 1_000_000,
      runs,
      stories,
      costPerStory: Math.round(costPerStory * 1_000_000) / 1_000_000,
      byModel,
    };
  });

  // Calculate cumulative costs
  let cumulative = 0;
  for (const metric of dailyMetrics) {
    cumulative += metric.cost;
    metric.cumulativeCost = Math.round(cumulative * 1_000_000) / 1_000_000;
  }

  // Calculate totals
  const totalCost = allCosts.reduce((sum, c) => sum + c.cost, 0);
  const totalRuns = allCosts.length;
  const allStories = new Set(allCosts.filter((c) => c.storyId).map((c) => c.storyId));
  const totalStories = allStories.size;

  // Calculate breakdown by model
  const byModel = {};
  for (const cost of allCosts) {
    const model = cost.model || "unknown";
    if (!byModel[model]) {
      byModel[model] = { cost: 0, runs: 0, inputTokens: 0, outputTokens: 0 };
    }
    byModel[model].cost += cost.cost;
    byModel[model].runs += 1;
    byModel[model].inputTokens += cost.inputTokens;
    byModel[model].outputTokens += cost.outputTokens;
  }

  // Round model costs
  for (const model of Object.keys(byModel)) {
    byModel[model].cost = Math.round(byModel[model].cost * 1_000_000) / 1_000_000;
  }

  // Calculate cost per story over time for trend
  const storyTrends = calculateCostPerStoryTrend(allCosts);

  return {
    period: `${days}d`,
    groupBy,
    startDate,
    endDate: new Date().toISOString().split("T")[0],
    totalCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    totalRuns,
    totalStories,
    avgCostPerRun: totalRuns > 0 ? Math.round((totalCost / totalRuns) * 1_000_000) / 1_000_000 : 0,
    avgCostPerStory: totalStories > 0 ? Math.round((totalCost / totalStories) * 1_000_000) / 1_000_000 : 0,
    dailyMetrics,
    byModel,
    storyTrends,
    filters: {
      prd: options.prd || "all",
      model: options.model || "all",
    },
  };
}

/**
 * Calculate cost per story trend over time
 * @param {Object[]} costs - Array of cost records
 * @returns {Object[]} Array of cost per story by date
 */
function calculateCostPerStoryTrend(costs) {
  // Group costs by story
  const storyCosts = {};

  for (const cost of costs) {
    if (!cost.storyId || !cost.date) continue;

    if (!storyCosts[cost.storyId]) {
      storyCosts[cost.storyId] = {
        storyId: cost.storyId,
        firstDate: cost.date,
        lastDate: cost.date,
        totalCost: 0,
        runs: 0,
      };
    }

    storyCosts[cost.storyId].totalCost += cost.cost;
    storyCosts[cost.storyId].runs += 1;

    if (cost.date < storyCosts[cost.storyId].firstDate) {
      storyCosts[cost.storyId].firstDate = cost.date;
    }
    if (cost.date > storyCosts[cost.storyId].lastDate) {
      storyCosts[cost.storyId].lastDate = cost.date;
    }
  }

  // Convert to array sorted by first date
  return Object.values(storyCosts)
    .sort((a, b) => a.firstDate.localeCompare(b.firstDate))
    .map((s) => ({
      storyId: s.storyId,
      date: s.firstDate,
      cost: Math.round(s.totalCost * 1_000_000) / 1_000_000,
      runs: s.runs,
    }));
}

/**
 * Compare costs against a budget line
 * @param {string} ralphRoot - Path to .ralph directory
 * @param {number} dailyBudget - Daily budget in dollars
 * @param {Object} options - Options { days, prd }
 * @returns {Object} Budget comparison data
 */
function compareToBudget(ralphRoot, dailyBudget, options = {}) {
  const costData = aggregateDailyCosts(ralphRoot, options);

  const budgetAnalysis = costData.dailyMetrics.map((day) => ({
    date: day.date,
    cost: day.cost,
    budget: dailyBudget,
    variance: Math.round((dailyBudget - day.cost) * 1_000_000) / 1_000_000,
    overBudget: day.cost > dailyBudget,
    percentOfBudget: dailyBudget > 0 ? Math.round((day.cost / dailyBudget) * 100) : 0,
  }));

  const totalBudget = dailyBudget * costData.dailyMetrics.length;
  const overBudgetDays = budgetAnalysis.filter((d) => d.overBudget).length;

  return {
    ...costData,
    dailyBudget,
    totalBudget: Math.round(totalBudget * 100) / 100,
    budgetAnalysis,
    overBudgetDays,
    underBudgetDays: costData.dailyMetrics.length - overBudgetDays,
    totalVariance: Math.round((totalBudget - costData.totalCost) * 1_000_000) / 1_000_000,
    percentOfTotalBudget:
      totalBudget > 0 ? Math.round((costData.totalCost / totalBudget) * 100) : 0,
  };
}

/**
 * Get available models for filtering
 * @param {string} ralphRoot - Path to .ralph directory
 * @returns {string[]} Array of model names
 */
function getAvailableModels(ralphRoot) {
  const allCosts = getAllCostData(ralphRoot);
  const models = new Set();

  for (const cost of allCosts) {
    if (cost.model && cost.model !== "unknown") {
      models.add(cost.model);
    }
  }

  return Array.from(models).sort();
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
  // Cost trend exports
  aggregateDailyCosts,
  calculateRunCost,
  extractModel,
  getCostDataFromCache,
  getAllCostData,
  calculateCostPerStoryTrend,
  compareToBudget,
  getAvailableModels,
  MODEL_PRICING,
};
