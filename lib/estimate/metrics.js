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

/**
 * Get fix success rate from metrics records
 * Aggregates fix statistics across all or filtered records
 * @param {Object[]} metrics - Array of metric records
 * @returns {Object} Fix success rate statistics
 */
function getFixSuccessRate(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {
      successRate: 0,
      totalAttempted: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      byType: {},
      recordsWithFixes: 0,
    };
  }

  let totalAttempted = 0;
  let totalSucceeded = 0;
  let totalFailed = 0;
  let recordsWithFixes = 0;
  const byType = {};

  for (const m of metrics) {
    if (m.fixesAttempted != null && m.fixesAttempted > 0) {
      recordsWithFixes++;
      totalAttempted += m.fixesAttempted || 0;
      totalSucceeded += m.fixesSucceeded || 0;
      totalFailed += m.fixesFailed || 0;

      // Aggregate by type
      if (m.fixesByType && typeof m.fixesByType === "object") {
        for (const [type, stats] of Object.entries(m.fixesByType)) {
          if (!byType[type]) {
            byType[type] = { attempted: 0, succeeded: 0, failed: 0 };
          }
          byType[type].attempted += stats.attempted || 0;
          byType[type].succeeded += stats.succeeded || 0;
          byType[type].failed += stats.failed || 0;
        }
      }
    }
  }

  const successRate = totalAttempted > 0 ? (totalSucceeded / totalAttempted) * 100 : 0;

  return {
    successRate: Math.round(successRate * 100) / 100,
    totalAttempted,
    totalSucceeded,
    totalFailed,
    byType,
    recordsWithFixes,
  };
}

/**
 * Get fix metrics summary for a PRD folder
 * Calculates overall fix success rate from metrics.jsonl
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} Fix metrics summary
 */
function getFixMetricsSummary(prdFolder) {
  const { success, metrics } = loadMetrics(prdFolder);

  if (!success || metrics.length === 0) {
    return {
      success: true,
      hasData: false,
      fixSuccessRate: null,
      totalAttempted: 0,
      totalSucceeded: 0,
      totalFailed: 0,
    };
  }

  const fixStats = getFixSuccessRate(metrics);

  return {
    success: true,
    hasData: fixStats.recordsWithFixes > 0,
    ...fixStats,
  };
}

/**
 * Get agent success rates from metrics (US-004)
 * @param {Object[]} metrics - Array of metric records
 * @returns {Object} Agent success rates { agentName: { total, success, error, successRate } }
 */
function getAgentSuccessRates(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {};
  }

  const agentStats = {};

  for (const m of metrics) {
    const agent = m.agent || "unknown";
    if (!agentStats[agent]) {
      agentStats[agent] = {
        agent,
        total: 0,
        success: 0,
        error: 0,
        successRate: 0,
        avgDuration: 0,
        totalDuration: 0,
        switchesInvolved: 0,
        storiesCompleted: new Set(),
      };
    }

    const stats = agentStats[agent];
    stats.total++;
    stats.totalDuration += m.duration || 0;

    if (m.status === "success") {
      stats.success++;
      if (m.storyId) {
        stats.storiesCompleted.add(m.storyId);
      }
    } else {
      stats.error++;
    }

    // Track switch involvement
    if (m.switchCount && m.switchCount > 0) {
      stats.switchesInvolved += m.switchCount;
    }
  }

  // Calculate rates and averages
  for (const [, stats] of Object.entries(agentStats)) {
    stats.successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
    stats.avgDuration = stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : 0;
    stats.storiesCompleted = Array.from(stats.storiesCompleted);
    stats.storyCount = stats.storiesCompleted.length;
  }

  return agentStats;
}

/**
 * Get switch analytics from metrics (US-004)
 * @param {Object[]} metrics - Array of metric records
 * @returns {Object} Switch analytics summary
 */
function getSwitchAnalytics(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {
      totalIterations: 0,
      iterationsWithSwitches: 0,
      totalSwitches: 0,
      avgSwitchesPerIteration: 0,
      switchesByFailureType: {},
      agentsInvolved: {},
      storyTypesAffected: {},
    };
  }

  const analytics = {
    totalIterations: metrics.length,
    iterationsWithSwitches: 0,
    totalSwitches: 0,
    avgSwitchesPerIteration: 0,
    switchesByFailureType: {},
    agentsInvolved: {},
    storyTypesAffected: {},
  };

  for (const m of metrics) {
    const switchCount = m.switchCount || 0;

    if (switchCount > 0) {
      analytics.iterationsWithSwitches++;
      analytics.totalSwitches += switchCount;

      // Track by failure type
      const failureType = m.failureType || "unknown";
      if (!analytics.switchesByFailureType[failureType]) {
        analytics.switchesByFailureType[failureType] = 0;
      }
      analytics.switchesByFailureType[failureType] += switchCount;

      // Track agents involved in switches
      if (Array.isArray(m.agents)) {
        for (const agent of m.agents) {
          if (!analytics.agentsInvolved[agent]) {
            analytics.agentsInvolved[agent] = { switchedTo: 0, switchedFrom: 0 };
          }
        }
        // First agent was switched from, rest were switched to
        if (m.agents.length > 1) {
          analytics.agentsInvolved[m.agents[0]].switchedFrom += switchCount;
          for (let i = 1; i < m.agents.length; i++) {
            analytics.agentsInvolved[m.agents[i]].switchedTo++;
          }
        }
      }

      // Track story types (extract prefix like "US-" or "BUG-")
      if (m.storyId) {
        const storyType = m.storyId.match(/^([A-Z]+-)/)?.[1] || "OTHER";
        if (!analytics.storyTypesAffected[storyType]) {
          analytics.storyTypesAffected[storyType] = { count: 0, switches: 0 };
        }
        analytics.storyTypesAffected[storyType].count++;
        analytics.storyTypesAffected[storyType].switches += switchCount;
      }
    }
  }

  // Calculate averages
  if (analytics.iterationsWithSwitches > 0) {
    analytics.avgSwitchesPerIteration = Math.round(
      (analytics.totalSwitches / analytics.iterationsWithSwitches) * 100
    ) / 100;
  }

  return analytics;
}

/**
 * Identify optimal agent per story type based on historical success rates (US-004)
 * @param {Object[]} metrics - Array of metric records
 * @returns {Object} Optimal agents by story type { storyType: { bestAgent, successRate, confidence } }
 */
function getOptimalAgentsByStoryType(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {};
  }

  // Group metrics by story type and agent
  const storyTypeStats = {};

  for (const m of metrics) {
    if (!m.storyId) continue;

    // Extract story type prefix (e.g., "US-", "BUG-", "FEAT-")
    const storyType = m.storyId.match(/^([A-Z]+-)/)?.[1] || "OTHER";
    const agent = m.agent || "unknown";

    if (!storyTypeStats[storyType]) {
      storyTypeStats[storyType] = {};
    }

    if (!storyTypeStats[storyType][agent]) {
      storyTypeStats[storyType][agent] = {
        total: 0,
        success: 0,
        error: 0,
        avgDuration: 0,
        totalDuration: 0,
      };
    }

    const stats = storyTypeStats[storyType][agent];
    stats.total++;
    stats.totalDuration += m.duration || 0;

    if (m.status === "success") {
      stats.success++;
    } else {
      stats.error++;
    }
  }

  // Find best agent for each story type
  const optimalAgents = {};

  for (const [storyType, agentStats] of Object.entries(storyTypeStats)) {
    let bestAgent = null;
    let bestRate = -1;
    let bestConfidence = 0;
    const agents = [];

    for (const [agent, stats] of Object.entries(agentStats)) {
      const successRate = stats.total > 0 ? (stats.success / stats.total) * 100 : 0;
      const avgDuration = stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : 0;

      // Confidence based on sample size (more samples = higher confidence)
      const confidence = Math.min(100, stats.total * 20); // 5 samples = 100% confidence

      agents.push({
        agent,
        total: stats.total,
        success: stats.success,
        error: stats.error,
        successRate: Math.round(successRate),
        avgDuration,
        confidence,
      });

      // Choose best agent based on success rate weighted by confidence
      const weightedScore = successRate * (confidence / 100);
      if (weightedScore > bestRate) {
        bestRate = weightedScore;
        bestAgent = agent;
        bestConfidence = confidence;
      }
    }

    optimalAgents[storyType] = {
      storyType,
      bestAgent,
      bestSuccessRate: Math.round(bestRate),
      confidence: Math.round(bestConfidence),
      agents: agents.sort((a, b) => b.successRate - a.successRate),
      sampleSize: agents.reduce((sum, a) => sum + a.total, 0),
    };
  }

  return optimalAgents;
}

/**
 * Generate agent default change suggestions based on metrics (US-004)
 * @param {Object[]} metrics - Array of metric records
 * @param {string} currentDefault - Current default agent name
 * @returns {Object} Suggestion with reasoning
 */
function suggestDefaultAgentChange(metrics, currentDefault = "codex") {
  const agentRates = getAgentSuccessRates(metrics);
  const optimalByType = getOptimalAgentsByStoryType(metrics);

  if (Object.keys(agentRates).length === 0) {
    return {
      shouldChange: false,
      reason: "Insufficient data to make a recommendation",
      currentDefault,
      suggestedDefault: null,
      confidence: 0,
    };
  }

  // Find the agent with the highest overall success rate
  let bestAgent = currentDefault;
  let bestRate = 0;
  let bestTotal = 0;

  for (const [agent, stats] of Object.entries(agentRates)) {
    if (stats.total >= 3 && stats.successRate > bestRate) { // Minimum 3 samples
      bestRate = stats.successRate;
      bestAgent = agent;
      bestTotal = stats.total;
    }
  }

  // Check if current default is significantly worse
  const currentStats = agentRates[currentDefault] || { successRate: 0, total: 0 };
  const improvementThreshold = 15; // Suggest change if > 15% improvement possible

  const shouldChange = bestAgent !== currentDefault &&
    bestRate - currentStats.successRate > improvementThreshold &&
    bestTotal >= 3;

  // Build reasoning
  let reason;
  if (!shouldChange) {
    if (bestAgent === currentDefault) {
      reason = `${currentDefault} is already the best performing agent (${currentStats.successRate}% success rate)`;
    } else if (bestTotal < 3) {
      reason = "Not enough data to confidently recommend a change";
    } else {
      reason = `${bestAgent} is only marginally better (${bestRate}% vs ${currentStats.successRate}%)`;
    }
  } else {
    reason = `${bestAgent} has ${bestRate}% success rate vs ${currentDefault}'s ${currentStats.successRate}% (based on ${bestTotal} iterations)`;
  }

  return {
    shouldChange,
    reason,
    currentDefault,
    suggestedDefault: shouldChange ? bestAgent : null,
    improvement: shouldChange ? bestRate - currentStats.successRate : 0,
    confidence: Math.min(100, bestTotal * 20),
    agentRates,
    optimalByType,
  };
}

/**
 * Get comprehensive agent analytics from a PRD folder (US-004)
 * This is a wrapper function that loads metrics and returns formatted analytics
 * for use by ralph stats switches command
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} options - Options { groupByStoryType: boolean }
 * @returns {Object} Formatted analytics { overall, byStoryType, totalRuns, switchAnalytics }
 */
function getAgentAnalytics(prdFolder, options = {}) {
  const { groupByStoryType = false } = options;

  const { success, metrics } = loadMetrics(prdFolder);

  if (!success || metrics.length === 0) {
    return {
      overall: {},
      byStoryType: {},
      totalRuns: 0,
      switchAnalytics: {
        totalIterations: 0,
        iterationsWithSwitches: 0,
        totalSwitches: 0,
        avgSwitchesPerIteration: 0,
        switchesByFailureType: {},
        agentsInvolved: {},
        storyTypesAffected: {},
      },
    };
  }

  // Get agent success rates
  const overall = getAgentSuccessRates(metrics);

  // Add avgSwitchesPerRun to each agent
  for (const [, stats] of Object.entries(overall)) {
    stats.avgSwitchesPerRun = stats.total > 0
      ? (stats.switchesInvolved / stats.total).toFixed(2)
      : "0.00";
  }

  // Get switch analytics
  const switchAnalytics = getSwitchAnalytics(metrics);

  // Get by story type if requested
  let byStoryType = {};
  if (groupByStoryType) {
    byStoryType = getOptimalAgentsByStoryType(metrics);
  }

  return {
    overall,
    byStoryType,
    totalRuns: metrics.length,
    switchAnalytics,
  };
}

/**
 * Get rollback statistics from metrics (US-004)
 * @param {Object[]} metrics - Array of metric records
 * @returns {Object} Rollback statistics summary
 */
function getRollbackStats(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {
      totalRollbacks: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      recoveryRate: 0,
      avgRetryAttempts: 0,
      byReason: {},
      byStory: {},
      iterationsWithRollbacks: 0,
    };
  }

  const stats = {
    totalRollbacks: 0,
    successfulRecoveries: 0,
    failedRecoveries: 0,
    recoveryRate: 0,
    avgRetryAttempts: 0,
    byReason: {},
    byStory: {},
    iterationsWithRollbacks: 0,
  };

  let totalRetryAttempts = 0;
  let iterationsWithRetries = 0;

  for (const m of metrics) {
    const rollbackCount = m.rollbackCount || 0;

    if (rollbackCount > 0) {
      stats.totalRollbacks += rollbackCount;
      stats.iterationsWithRollbacks++;

      // Track by reason
      const reason = m.rollbackReason || "unknown";
      if (!stats.byReason[reason]) {
        stats.byReason[reason] = { count: 0, recovered: 0 };
      }
      stats.byReason[reason].count += rollbackCount;

      // Track recovery success
      if (m.rollbackSuccess === true) {
        stats.successfulRecoveries++;
        stats.byReason[reason].recovered++;
      } else if (m.rollbackSuccess === false) {
        stats.failedRecoveries++;
      }

      // Track by story
      const storyId = m.storyId || "unknown";
      if (!stats.byStory[storyId]) {
        stats.byStory[storyId] = { rollbacks: 0, maxRetries: 0 };
      }
      stats.byStory[storyId].rollbacks += rollbackCount;
    }

    // Track retry attempts
    const retryCount = m.retryCount || 0;
    if (retryCount > 0) {
      totalRetryAttempts += retryCount;
      iterationsWithRetries++;

      // Update max retries for story
      const storyId = m.storyId || "unknown";
      if (stats.byStory[storyId]) {
        stats.byStory[storyId].maxRetries = Math.max(stats.byStory[storyId].maxRetries, retryCount);
      }
    }
  }

  // Calculate rates
  stats.recoveryRate = stats.totalRollbacks > 0
    ? Math.round((stats.successfulRecoveries / stats.totalRollbacks) * 100)
    : 0;

  stats.avgRetryAttempts = iterationsWithRetries > 0
    ? Math.round((totalRetryAttempts / iterationsWithRetries) * 100) / 100
    : 0;

  return stats;
}

/**
 * Get rollback statistics for a PRD folder (US-004)
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} Rollback statistics summary
 */
function getRollbackStatsSummary(prdFolder) {
  const { success, metrics } = loadMetrics(prdFolder);

  if (!success || metrics.length === 0) {
    return {
      success: true,
      hasData: false,
      totalRollbacks: 0,
      recoveryRate: 0,
    };
  }

  const rollbackStats = getRollbackStats(metrics);

  return {
    success: true,
    hasData: rollbackStats.totalRollbacks > 0,
    ...rollbackStats,
  };
}

/**
 * Load rollback history from rollback-history.jsonl (US-004)
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} { success: boolean, records: Object[], error?: string }
 */
function loadRollbackHistory(prdFolder) {
  const rollbackPath = path.join(prdFolder, "runs", "rollback-history.jsonl");

  if (!fs.existsSync(rollbackPath)) {
    return {
      success: true,
      records: [],
    };
  }

  try {
    const content = fs.readFileSync(rollbackPath, "utf-8");
    const lines = content.split("\n");
    const records = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line));
      } catch {
        // Skip corrupt lines
      }
    }

    return {
      success: true,
      records,
    };
  } catch (err) {
    return {
      success: false,
      records: [],
      error: `Failed to load rollback history: ${err.message}`,
    };
  }
}

/**
 * Get comprehensive rollback analytics from history file (US-004)
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} Comprehensive rollback analytics
 */
function getRollbackAnalytics(prdFolder) {
  const { success, records, error } = loadRollbackHistory(prdFolder);

  if (!success) {
    return { success: false, error };
  }

  if (records.length === 0) {
    return {
      success: true,
      hasData: false,
      total: 0,
      successful: 0,
      failed: 0,
      successRate: 0,
      avgAttempts: 0,
      byReason: {},
      byStory: {},
      timeline: [],
    };
  }

  const analytics = {
    success: true,
    hasData: true,
    total: records.length,
    successful: 0,
    failed: 0,
    successRate: 0,
    avgAttempts: 0,
    byReason: {},
    byStory: {},
    timeline: [],
  };

  let totalAttempts = 0;

  for (const r of records) {
    // Success/failure counts
    if (r.success === true || r.success === "true") {
      analytics.successful++;
    } else {
      analytics.failed++;
    }

    // Attempts tracking
    totalAttempts += r.attempt || 1;

    // By reason
    const reason = r.reason || "unknown";
    if (!analytics.byReason[reason]) {
      analytics.byReason[reason] = { count: 0, successful: 0, avgAttempts: 0, totalAttempts: 0 };
    }
    analytics.byReason[reason].count++;
    analytics.byReason[reason].totalAttempts += r.attempt || 1;
    if (r.success === true || r.success === "true") {
      analytics.byReason[reason].successful++;
    }

    // By story
    const storyId = r.storyId || "unknown";
    if (!analytics.byStory[storyId]) {
      analytics.byStory[storyId] = { rollbacks: 0, maxAttempts: 0, lastReason: null };
    }
    analytics.byStory[storyId].rollbacks++;
    analytics.byStory[storyId].maxAttempts = Math.max(analytics.byStory[storyId].maxAttempts, r.attempt || 1);
    analytics.byStory[storyId].lastReason = reason;

    // Timeline (last 10 events)
    if (analytics.timeline.length < 10) {
      analytics.timeline.push({
        timestamp: r.timestamp,
        storyId: r.storyId,
        reason: r.reason,
        success: r.success === true || r.success === "true",
        attempt: r.attempt || 1,
      });
    }
  }

  // Calculate rates and averages
  analytics.successRate = analytics.total > 0
    ? Math.round((analytics.successful / analytics.total) * 100)
    : 0;

  analytics.avgAttempts = analytics.total > 0
    ? Math.round((totalAttempts / analytics.total) * 100) / 100
    : 0;

  // Calculate per-reason averages
  for (const [, reasonStats] of Object.entries(analytics.byReason)) {
    reasonStats.avgAttempts = reasonStats.count > 0
      ? Math.round((reasonStats.totalAttempts / reasonStats.count) * 100) / 100
      : 0;
    delete reasonStats.totalAttempts;
  }

  // Sort timeline by timestamp descending
  analytics.timeline.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return analytics;
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
  // Fix success rate reporting (US-004)
  getFixSuccessRate,
  getFixMetricsSummary,
  // Switch analytics (US-004)
  getAgentSuccessRates,
  getSwitchAnalytics,
  getOptimalAgentsByStoryType,
  suggestDefaultAgentChange,
  getAgentAnalytics,
  // Rollback analytics (US-004)
  getRollbackStats,
  getRollbackStatsSummary,
  loadRollbackHistory,
  getRollbackAnalytics,
};
