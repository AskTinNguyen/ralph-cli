/**
 * Token cache manager - persists and aggregates token metrics per stream
 *
 * Storage format: .ralph/PRD-N/tokens.json
 * Structure:
 * {
 *   streamId: N,
 *   lastUpdated: ISO timestamp,
 *   totals: { inputTokens, outputTokens, totalCost, estimatedCount },
 *   costByStory: { [storyId]: { totalCost, inputCost, outputCost, runs } },
 *   costByModel: { [model]: { totalCost, inputCost, outputCost, runs } },
 *   byStory: { [storyId]: { inputTokens, outputTokens, runs } },
 *   runs: [ { runId, storyId, inputTokens, outputTokens, model, cost, timestamp, estimated } ]
 * }
 */
const fs = require("fs");
const path = require("path");
const calculator = require("./calculator");

/**
 * Load token cache from stream directory
 * @param {string} streamPath - Path to PRD-N directory
 * @returns {Object|null} Token cache data or null if not found
 */
function loadTokenCache(streamPath) {
  const cachePath = path.join(streamPath, "tokens.json");

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
 * Save token cache to stream directory
 * @param {string} streamPath - Path to PRD-N directory
 * @param {Object} data - Token cache data to save
 */
function saveTokenCache(streamPath, data) {
  const cachePath = path.join(streamPath, "tokens.json");

  // Ensure directory exists
  if (!fs.existsSync(streamPath)) {
    fs.mkdirSync(streamPath, { recursive: true });
  }

  // Add timestamp
  data.lastUpdated = new Date().toISOString();

  fs.writeFileSync(cachePath, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Aggregate token data from an array of run metrics
 * @param {Object[]} runs - Array of run token objects
 * @param {Object} options - Options { repoRoot for pricing config }
 * @returns {Object} Aggregated metrics including cost
 */
function aggregateTokens(runs, options = {}) {
  if (!runs || !Array.isArray(runs) || runs.length === 0) {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      avgCostPerRun: 0,
      estimatedCount: 0,
      runCount: runs ? runs.length : 0,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let inputCost = 0;
  let outputCost = 0;
  let estimatedCount = 0;

  for (const run of runs) {
    if (run.inputTokens != null) {
      totalInputTokens += run.inputTokens;
    }
    if (run.outputTokens != null) {
      totalOutputTokens += run.outputTokens;
    }
    if (run.estimated) {
      estimatedCount++;
    }

    // Add costs if already computed on run, otherwise calculate
    if (run.cost != null) {
      totalCost += run.cost;
      inputCost += run.inputCost || 0;
      outputCost += run.outputCost || 0;
    } else {
      const cost = calculator.calculateCost(
        { inputTokens: run.inputTokens, outputTokens: run.outputTokens },
        run.model,
        options
      );
      totalCost += cost.totalCost;
      inputCost += cost.inputCost;
      outputCost += cost.outputCost;
    }
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    totalCost: calculator.roundCost(totalCost),
    inputCost: calculator.roundCost(inputCost),
    outputCost: calculator.roundCost(outputCost),
    avgCostPerRun: runs.length > 0 ? calculator.roundCost(totalCost / runs.length) : 0,
    estimatedCount,
    runCount: runs.length,
  };
}

/**
 * Aggregate tokens by story from runs
 * @param {Object[]} runs - Array of run token objects with storyId
 * @param {Object} options - Options { repoRoot for pricing config }
 * @returns {Object} Metrics grouped by story ID
 */
function aggregateByStory(runs, options = {}) {
  if (!runs || !Array.isArray(runs)) {
    return {};
  }

  const byStory = {};

  for (const run of runs) {
    const storyId = run.storyId || "unknown";

    if (!byStory[storyId]) {
      byStory[storyId] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        runs: 0,
        estimatedCount: 0,
      };
    }

    if (run.inputTokens != null) {
      byStory[storyId].inputTokens += run.inputTokens;
    }
    if (run.outputTokens != null) {
      byStory[storyId].outputTokens += run.outputTokens;
    }
    byStory[storyId].totalTokens = byStory[storyId].inputTokens + byStory[storyId].outputTokens;
    byStory[storyId].runs++;
    if (run.estimated) {
      byStory[storyId].estimatedCount++;
    }

    // Add costs
    if (run.cost != null) {
      byStory[storyId].totalCost += run.cost;
      byStory[storyId].inputCost += run.inputCost || 0;
      byStory[storyId].outputCost += run.outputCost || 0;
    } else {
      const cost = calculator.calculateCost(
        { inputTokens: run.inputTokens, outputTokens: run.outputTokens },
        run.model,
        options
      );
      byStory[storyId].totalCost += cost.totalCost;
      byStory[storyId].inputCost += cost.inputCost;
      byStory[storyId].outputCost += cost.outputCost;
    }
  }

  // Round all cost values
  for (const storyId of Object.keys(byStory)) {
    byStory[storyId].totalCost = calculator.roundCost(byStory[storyId].totalCost);
    byStory[storyId].inputCost = calculator.roundCost(byStory[storyId].inputCost);
    byStory[storyId].outputCost = calculator.roundCost(byStory[storyId].outputCost);
  }

  return byStory;
}

/**
 * Aggregate tokens by model from runs
 * @param {Object[]} runs - Array of run token objects with model
 * @param {Object} options - Options { repoRoot for pricing config }
 * @returns {Object} Metrics grouped by model
 */
function aggregateByModel(runs, options = {}) {
  if (!runs || !Array.isArray(runs)) {
    return {};
  }

  const byModel = {};

  for (const run of runs) {
    const model = run.model || "unknown";

    if (!byModel[model]) {
      byModel[model] = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        runs: 0,
      };
    }

    if (run.inputTokens != null) {
      byModel[model].inputTokens += run.inputTokens;
    }
    if (run.outputTokens != null) {
      byModel[model].outputTokens += run.outputTokens;
    }
    byModel[model].totalTokens = byModel[model].inputTokens + byModel[model].outputTokens;
    byModel[model].runs++;

    // Add costs
    if (run.cost != null) {
      byModel[model].totalCost += run.cost;
      byModel[model].inputCost += run.inputCost || 0;
      byModel[model].outputCost += run.outputCost || 0;
    } else {
      const cost = calculator.calculateCost(
        { inputTokens: run.inputTokens, outputTokens: run.outputTokens },
        run.model,
        options
      );
      byModel[model].totalCost += cost.totalCost;
      byModel[model].inputCost += cost.inputCost;
      byModel[model].outputCost += cost.outputCost;
    }
  }

  // Round all cost values
  for (const model of Object.keys(byModel)) {
    byModel[model].totalCost = calculator.roundCost(byModel[model].totalCost);
    byModel[model].inputCost = calculator.roundCost(byModel[model].inputCost);
    byModel[model].outputCost = calculator.roundCost(byModel[model].outputCost);
  }

  return byModel;
}

/**
 * Add a run to the token cache
 * @param {string} streamPath - Path to PRD-N directory
 * @param {Object} runData - Run token data to add
 * @param {Object} options - Options { repoRoot for pricing config }
 */
function addRunToCache(streamPath, runData, options = {}) {
  // Load existing cache or create new one
  let cache = loadTokenCache(streamPath);

  if (!cache) {
    // Extract stream ID from path (e.g., /path/to/PRD-1 -> 1)
    const streamIdMatch = streamPath.match(/PRD-(\d+)|prd-(\d+)/i);
    const streamId = streamIdMatch ? parseInt(streamIdMatch[1] || streamIdMatch[2], 10) : 0;

    cache = {
      streamId,
      runs: [],
    };
  }

  // Calculate cost for this run
  const cost = calculator.calculateCost(
    { inputTokens: runData.inputTokens, outputTokens: runData.outputTokens },
    runData.model,
    options
  );

  // Add run data with timestamp and cost
  const runEntry = {
    runId: runData.runId,
    storyId: runData.storyId || null,
    inputTokens: runData.inputTokens,
    outputTokens: runData.outputTokens,
    model: runData.model || null,
    timestamp: runData.timestamp || new Date().toISOString(),
    estimated: runData.estimated || false,
    cost: cost.totalCost,
    inputCost: cost.inputCost,
    outputCost: cost.outputCost,
  };

  // Check if run already exists (update instead of duplicate)
  const existingIndex = cache.runs.findIndex((r) => r.runId === runEntry.runId);
  if (existingIndex >= 0) {
    cache.runs[existingIndex] = runEntry;
  } else {
    cache.runs.push(runEntry);
  }

  // Recalculate aggregates (including costs)
  cache.totals = aggregateTokens(cache.runs, options);
  cache.byStory = aggregateByStory(cache.runs, options);
  cache.byModel = aggregateByModel(cache.runs, options);

  // Save updated cache
  saveTokenCache(streamPath, cache);

  return cache;
}

/**
 * Get token summary for a stream
 * @param {string} streamPath - Path to PRD-N directory
 * @returns {Object} Summary metrics including costs
 */
function getStreamSummary(streamPath) {
  const cache = loadTokenCache(streamPath);

  if (!cache) {
    return {
      streamId: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      avgCostPerRun: 0,
      avgCostPerStory: 0,
      runCount: 0,
      storyCount: 0,
      estimatedCount: 0,
    };
  }

  const storyCount = cache.byStory ? Object.keys(cache.byStory).length : 0;
  const totalCost = cache.totals?.totalCost || 0;

  return {
    streamId: cache.streamId,
    totalInputTokens: cache.totals?.totalInputTokens || 0,
    totalOutputTokens: cache.totals?.totalOutputTokens || 0,
    totalTokens: cache.totals?.totalTokens || 0,
    totalCost,
    inputCost: cache.totals?.inputCost || 0,
    outputCost: cache.totals?.outputCost || 0,
    avgCostPerRun: cache.totals?.avgCostPerRun || 0,
    avgCostPerStory: storyCount > 0 ? calculator.roundCost(totalCost / storyCount) : 0,
    runCount: cache.runs?.length || 0,
    storyCount,
    estimatedCount: cache.totals?.estimatedCount || 0,
    byStory: cache.byStory || {},
    byModel: cache.byModel || {},
    lastUpdated: cache.lastUpdated,
  };
}

/**
 * Build cache from existing run summaries (for migration/rebuild)
 * Falls back to estimating tokens from log files when summaries lack token data.
 * @param {string} streamPath - Path to PRD-N directory
 * @param {Function} tokenExtractor - Function to extract tokens from run summary
 * @param {Object} options - Options { repoRoot for pricing config, useEstimation for fallback }
 * @returns {Object} Built cache
 */
function rebuildCache(streamPath, tokenExtractor, options = {}) {
  const { useEstimation = true } = options;
  const runsDir = path.join(streamPath, "runs");

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  // Import extractor for fallback estimation
  let extractTokensWithFallback = null;
  let detectModel = null;
  try {
    const extractor = require("./extractor");
    extractTokensWithFallback = extractor.extractTokensWithFallback;
    detectModel = extractor.detectModel;
  } catch {
    // Extractor not available, skip estimation
  }

  // Find all run summary files
  const files = fs.readdirSync(runsDir).filter((f) => f.endsWith(".md") && f.startsWith("run-"));

  const runs = [];

  for (const file of files) {
    const summaryPath = path.join(runsDir, file);

    try {
      const content = fs.readFileSync(summaryPath, "utf-8");

      // Extract run ID and iteration from filename
      const runIdMatch = file.match(/run-(\d{8}-\d{6}-\d+)(?:-iter-(\d+))?/);
      const runId = runIdMatch ? runIdMatch[1] : file.replace(".md", "");
      const iteration = runIdMatch && runIdMatch[2] ? parseInt(runIdMatch[2], 10) : null;

      // Extract story ID from content
      const storyMatch = content.match(/- Story:\s*(US-\d+)/i);
      const storyId = storyMatch ? storyMatch[1] : null;

      // Extract timestamp from content
      const startedMatch = content.match(/- Started:\s*(.+)/);
      const timestamp = startedMatch ? startedMatch[1].trim() : null;

      // Extract tokens using provided extractor (from summary)
      let tokens = { inputTokens: null, outputTokens: null, model: null, estimated: false };
      if (tokenExtractor) {
        const summaryTokens = tokenExtractor(content);
        if (
          summaryTokens &&
          (summaryTokens.inputTokens !== null || summaryTokens.outputTokens !== null)
        ) {
          tokens = summaryTokens;
        }
      }

      // Fallback: if no tokens found in summary, try to estimate from log file
      if (
        (tokens.inputTokens === null || tokens.outputTokens === null) &&
        useEstimation &&
        extractTokensWithFallback
      ) {
        const logPath = summaryPath.replace(".md", ".log");
        if (fs.existsSync(logPath)) {
          try {
            const logContent = fs.readFileSync(logPath, "utf-8");
            const estimatedTokens = extractTokensWithFallback(logContent, { useEstimation: true });
            if (estimatedTokens && estimatedTokens.inputTokens !== null) {
              tokens = estimatedTokens;
            }
            // Also try to detect model from log if not already set
            if (!tokens.model && detectModel) {
              tokens.model = detectModel(logContent);
            }
          } catch {
            // Skip if log file can't be read
          }
        }
      }

      // Calculate cost for this run
      const cost = calculator.calculateCost(
        { inputTokens: tokens.inputTokens, outputTokens: tokens.outputTokens },
        tokens.model,
        options
      );

      runs.push({
        runId,
        iteration,
        storyId,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        model: tokens.model,
        timestamp,
        estimated: tokens.estimated,
        cost: cost.totalCost,
        inputCost: cost.inputCost,
        outputCost: cost.outputCost,
      });
    } catch {
      // Skip files that can't be parsed
    }
  }

  // Extract stream ID from path
  const streamIdMatch = streamPath.match(/PRD-(\d+)|prd-(\d+)/i);
  const streamId = streamIdMatch ? parseInt(streamIdMatch[1] || streamIdMatch[2], 10) : 0;

  const cache = {
    streamId,
    runs,
    totals: aggregateTokens(runs, options),
    byStory: aggregateByStory(runs, options),
    byModel: aggregateByModel(runs, options),
  };

  saveTokenCache(streamPath, cache);

  return cache;
}

module.exports = {
  loadTokenCache,
  saveTokenCache,
  aggregateTokens,
  aggregateByStory,
  aggregateByModel,
  addRunToCache,
  getStreamSummary,
  rebuildCache,
};
