/**
 * Token cache manager - persists and aggregates token metrics per stream
 *
 * Storage format: .ralph/PRD-N/tokens.json
 * Structure:
 * {
 *   streamId: N,
 *   lastUpdated: ISO timestamp,
 *   totals: { inputTokens, outputTokens, estimatedCount },
 *   byStory: { [storyId]: { inputTokens, outputTokens, runs } },
 *   runs: [ { runId, storyId, inputTokens, outputTokens, model, timestamp, estimated } ]
 * }
 */
const fs = require("fs");
const path = require("path");

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
 * @returns {Object} Aggregated metrics
 */
function aggregateTokens(runs) {
  if (!runs || !Array.isArray(runs) || runs.length === 0) {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      estimatedCount: 0,
      runCount: runs ? runs.length : 0,
    };
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
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
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    estimatedCount,
    runCount: runs.length,
  };
}

/**
 * Aggregate tokens by story from runs
 * @param {Object[]} runs - Array of run token objects with storyId
 * @returns {Object} Metrics grouped by story ID
 */
function aggregateByStory(runs) {
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
  }

  return byStory;
}

/**
 * Aggregate tokens by model from runs
 * @param {Object[]} runs - Array of run token objects with model
 * @returns {Object} Metrics grouped by model
 */
function aggregateByModel(runs) {
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
  }

  return byModel;
}

/**
 * Add a run to the token cache
 * @param {string} streamPath - Path to PRD-N directory
 * @param {Object} runData - Run token data to add
 */
function addRunToCache(streamPath, runData) {
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

  // Add run data with timestamp if not present
  const runEntry = {
    runId: runData.runId,
    storyId: runData.storyId || null,
    inputTokens: runData.inputTokens,
    outputTokens: runData.outputTokens,
    model: runData.model || null,
    timestamp: runData.timestamp || new Date().toISOString(),
    estimated: runData.estimated || false,
  };

  // Check if run already exists (update instead of duplicate)
  const existingIndex = cache.runs.findIndex((r) => r.runId === runEntry.runId);
  if (existingIndex >= 0) {
    cache.runs[existingIndex] = runEntry;
  } else {
    cache.runs.push(runEntry);
  }

  // Recalculate aggregates
  cache.totals = aggregateTokens(cache.runs);
  cache.byStory = aggregateByStory(cache.runs);
  cache.byModel = aggregateByModel(cache.runs);

  // Save updated cache
  saveTokenCache(streamPath, cache);

  return cache;
}

/**
 * Get token summary for a stream
 * @param {string} streamPath - Path to PRD-N directory
 * @returns {Object} Summary metrics
 */
function getStreamSummary(streamPath) {
  const cache = loadTokenCache(streamPath);

  if (!cache) {
    return {
      streamId: null,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      runCount: 0,
      storyCount: 0,
      estimatedCount: 0,
    };
  }

  return {
    streamId: cache.streamId,
    totalInputTokens: cache.totals?.totalInputTokens || 0,
    totalOutputTokens: cache.totals?.totalOutputTokens || 0,
    totalTokens: cache.totals?.totalTokens || 0,
    runCount: cache.runs?.length || 0,
    storyCount: cache.byStory ? Object.keys(cache.byStory).length : 0,
    estimatedCount: cache.totals?.estimatedCount || 0,
    byStory: cache.byStory || {},
    byModel: cache.byModel || {},
    lastUpdated: cache.lastUpdated,
  };
}

/**
 * Build cache from existing run summaries (for migration/rebuild)
 * @param {string} streamPath - Path to PRD-N directory
 * @param {Function} tokenExtractor - Function to extract tokens from run summary
 * @returns {Object} Built cache
 */
function rebuildCache(streamPath, tokenExtractor) {
  const runsDir = path.join(streamPath, "runs");

  if (!fs.existsSync(runsDir)) {
    return null;
  }

  // Find all run summary files
  const files = fs.readdirSync(runsDir)
    .filter((f) => f.endsWith(".md") && f.startsWith("run-"));

  const runs = [];

  for (const file of files) {
    const summaryPath = path.join(runsDir, file);

    try {
      const content = fs.readFileSync(summaryPath, "utf-8");

      // Extract run ID from filename
      const runIdMatch = file.match(/run-(\d{8}-\d{6}-\d+)/);
      const runId = runIdMatch ? runIdMatch[1] : file;

      // Extract story ID from content
      const storyMatch = content.match(/- Story:\s*(US-\d+)/i);
      const storyId = storyMatch ? storyMatch[1] : null;

      // Extract timestamp from content
      const startedMatch = content.match(/- Started:\s*(.+)/);
      const timestamp = startedMatch ? startedMatch[1].trim() : null;

      // Extract tokens using provided extractor
      let tokens = { inputTokens: null, outputTokens: null, model: null, estimated: false };
      if (tokenExtractor) {
        tokens = tokenExtractor(content);
      }

      runs.push({
        runId,
        storyId,
        inputTokens: tokens.inputTokens,
        outputTokens: tokens.outputTokens,
        model: tokens.model,
        timestamp,
        estimated: tokens.estimated,
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
    totals: aggregateTokens(runs),
    byStory: aggregateByStory(runs),
    byModel: aggregateByModel(runs),
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
