/**
 * Metrics module - operations for metrics.jsonl files
 *
 * Provides:
 * - appendMetric(): Append a new metric record to metrics.jsonl
 * - loadMetrics(): Load all metrics from a file (gracefully handles corruption)
 * - filterByStory(): Filter metrics by story ID
 * - filterByDateRange(): Filter metrics by date range
 * - filterByAgent(): Filter metrics by agent type
 */
const fs = require("fs");
const path = require("path");
const { createMetricsRecord, parseMetricsLine, serializeMetricsRecord } = require("./schema");

/**
 * Get the metrics file path for a PRD folder
 * @param {string} prdFolder - Path to PRD folder
 * @returns {string} Path to metrics.jsonl
 */
function getMetricsPath(prdFolder) {
  return path.join(prdFolder, "runs", "metrics.jsonl");
}

/**
 * Append a metric record to the metrics file (append-only)
 * Creates the file and parent directories if they don't exist
 *
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} data - Metric data to append
 * @returns {Object} { success: boolean, error?: string, record?: Object }
 */
function appendMetric(prdFolder, data) {
  try {
    const metricsPath = getMetricsPath(prdFolder);
    const runsDir = path.dirname(metricsPath);

    // Create runs directory if it doesn't exist
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    // Create the record with defaults
    const record = createMetricsRecord(data);
    const line = serializeMetricsRecord(record);

    // Append to file (creates if doesn't exist)
    fs.appendFileSync(metricsPath, line + "\n", "utf-8");

    return {
      success: true,
      record,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to append metric: ${err.message}`,
    };
  }
}

/**
 * Load all metrics from a metrics file
 * Gracefully handles missing files and corrupt lines
 *
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} options - Options { warnOnCorrupt: boolean }
 * @returns {Object} { success: boolean, metrics: Object[], skipped: number, error?: string }
 */
function loadMetrics(prdFolder, options = {}) {
  const { warnOnCorrupt = false } = options;

  try {
    const metricsPath = getMetricsPath(prdFolder);

    // Handle missing file gracefully
    if (!fs.existsSync(metricsPath)) {
      return {
        success: true,
        metrics: [],
        skipped: 0,
      };
    }

    const content = fs.readFileSync(metricsPath, "utf-8");
    const lines = content.split("\n");

    const metrics = [];
    let skipped = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip empty lines
      if (!line.trim()) {
        continue;
      }

      const record = parseMetricsLine(line);

      if (record === null) {
        // Corrupt or invalid line
        skipped++;
        if (warnOnCorrupt) {
          console.warn(`Skipping corrupt metrics line ${i + 1} in ${metricsPath}`);
        }
        continue;
      }

      metrics.push(record);
    }

    return {
      success: true,
      metrics,
      skipped,
    };
  } catch (err) {
    return {
      success: false,
      metrics: [],
      skipped: 0,
      error: `Failed to load metrics: ${err.message}`,
    };
  }
}

/**
 * Filter metrics by story ID
 * @param {Object[]} metrics - Array of metric records
 * @param {string} storyId - Story ID to filter by
 * @returns {Object[]} Filtered metrics
 */
function filterByStory(metrics, storyId) {
  if (!metrics || !Array.isArray(metrics)) {
    return [];
  }

  return metrics.filter((m) => m.storyId === storyId);
}

/**
 * Filter metrics by date range
 * @param {Object[]} metrics - Array of metric records
 * @param {Object} range - { start?: Date|string, end?: Date|string }
 * @returns {Object[]} Filtered metrics
 */
function filterByDateRange(metrics, range = {}) {
  if (!metrics || !Array.isArray(metrics)) {
    return [];
  }

  const { start, end } = range;

  return metrics.filter((m) => {
    if (!m.timestamp) {
      return false;
    }

    const ts = new Date(m.timestamp);

    if (start && ts < new Date(start)) {
      return false;
    }

    if (end && ts > new Date(end)) {
      return false;
    }

    return true;
  });
}

/**
 * Filter metrics by agent type
 * @param {Object[]} metrics - Array of metric records
 * @param {string} agent - Agent type ("claude", "codex", "droid")
 * @returns {Object[]} Filtered metrics
 */
function filterByAgent(metrics, agent) {
  if (!metrics || !Array.isArray(metrics)) {
    return [];
  }

  return metrics.filter((m) => m.agent === agent);
}

/**
 * Filter metrics by status
 * @param {Object[]} metrics - Array of metric records
 * @param {string} status - Status ("success" or "error")
 * @returns {Object[]} Filtered metrics
 */
function filterByStatus(metrics, status) {
  if (!metrics || !Array.isArray(metrics)) {
    return [];
  }

  return metrics.filter((m) => m.status === status);
}

/**
 * Get metrics summary statistics
 * @param {Object[]} metrics - Array of metric records
 * @returns {Object} Summary stats
 */
function getMetricsSummary(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {
      count: 0,
      successCount: 0,
      errorCount: 0,
      totalDuration: 0,
      avgDuration: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      uniqueStories: [],
      agentCounts: {},
    };
  }

  const successMetrics = metrics.filter((m) => m.status === "success");
  const errorMetrics = metrics.filter((m) => m.status === "error");

  const totalDuration = metrics.reduce((sum, m) => sum + (m.duration || 0), 0);
  const totalInputTokens = metrics.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalOutputTokens = metrics.reduce((sum, m) => sum + (m.outputTokens || 0), 0);

  const storyIds = new Set(metrics.map((m) => m.storyId).filter(Boolean));

  const agentCounts = {};
  for (const m of metrics) {
    const agent = m.agent || "unknown";
    agentCounts[agent] = (agentCounts[agent] || 0) + 1;
  }

  return {
    count: metrics.length,
    successCount: successMetrics.length,
    errorCount: errorMetrics.length,
    totalDuration,
    avgDuration: Math.round(totalDuration / metrics.length),
    totalInputTokens,
    totalOutputTokens,
    uniqueStories: Array.from(storyIds),
    agentCounts,
  };
}

/**
 * Get average metrics for a specific story (for estimation)
 * @param {Object[]} metrics - Array of metric records
 * @param {string} storyId - Story ID
 * @returns {Object|null} Average metrics or null if no data
 */
function getStoryAverages(metrics, storyId) {
  const storyMetrics = filterByStory(metrics, storyId);
  const successMetrics = storyMetrics.filter((m) => m.status === "success");

  if (successMetrics.length === 0) {
    return null;
  }

  const totalDuration = successMetrics.reduce((sum, m) => sum + (m.duration || 0), 0);
  const totalInputTokens = successMetrics.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalOutputTokens = successMetrics.reduce((sum, m) => sum + (m.outputTokens || 0), 0);

  const count = successMetrics.length;

  return {
    storyId,
    sampleCount: count,
    avgDuration: Math.round(totalDuration / count),
    avgInputTokens: Math.round(totalInputTokens / count),
    avgOutputTokens: Math.round(totalOutputTokens / count),
    avgTotalTokens: Math.round((totalInputTokens + totalOutputTokens) / count),
  };
}

/**
 * Check if metrics file exists
 * @param {string} prdFolder - Path to PRD folder
 * @returns {boolean} True if metrics file exists
 */
function metricsFileExists(prdFolder) {
  const metricsPath = getMetricsPath(prdFolder);
  return fs.existsSync(metricsPath);
}

module.exports = {
  getMetricsPath,
  appendMetric,
  loadMetrics,
  filterByStory,
  filterByDateRange,
  filterByAgent,
  filterByStatus,
  getMetricsSummary,
  getStoryAverages,
  metricsFileExists,
};
