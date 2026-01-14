/**
 * Experiment Metrics Aggregator
 *
 * Collects and aggregates metrics from metrics.jsonl for experiment analysis.
 * Provides:
 * - Per-variant aggregation of success rate, duration, and token cost
 * - Filtering by experiment name
 * - Quality signal tracking
 *
 * Uses existing metrics infrastructure from lib/estimate/metrics.js
 */
const path = require("path");
const { loadMetrics } = require("../estimate/metrics");
const { calculateCost } = require("../tokens/calculator");

/**
 * Filter metrics by experiment name
 * @param {Object[]} metrics - Array of metric records
 * @param {string} experimentName - Experiment name to filter by
 * @returns {Object[]} Filtered metrics
 */
function filterByExperiment(metrics, experimentName) {
  if (!metrics || !Array.isArray(metrics)) {
    return [];
  }

  return metrics.filter((m) => m.experimentName === experimentName);
}

/**
 * Filter metrics by experiment variant
 * @param {Object[]} metrics - Array of metric records
 * @param {string} variantName - Variant name to filter by
 * @returns {Object[]} Filtered metrics
 */
function filterByVariant(metrics, variantName) {
  if (!metrics || !Array.isArray(metrics)) {
    return [];
  }

  return metrics.filter((m) => m.experimentVariant === variantName);
}

/**
 * Calculate aggregated metrics for a set of metric records
 * @param {Object[]} metrics - Array of metric records
 * @param {Object} options - Options { repoRoot }
 * @returns {Object} Aggregated metrics
 */
function calculateAggregatedMetrics(metrics, options = {}) {
  const { repoRoot = null } = options;

  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {
      count: 0,
      successCount: 0,
      errorCount: 0,
      successRate: 0,
      totalDuration: 0,
      avgDuration: 0,
      minDuration: 0,
      maxDuration: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      avgTokens: 0,
      totalCost: 0,
      avgCost: 0,
      totalRetries: 0,
      avgRetries: 0,
      qualitySignals: {
        testsPassedCount: 0,
        testsFailedCount: 0,
        lintCleanCount: 0,
        lintFailedCount: 0,
        typeCheckCleanCount: 0,
        typeCheckFailedCount: 0,
      },
    };
  }

  const successMetrics = metrics.filter((m) => m.status === "success");
  const errorMetrics = metrics.filter((m) => m.status === "error");

  // Duration calculations
  const durations = metrics.map((m) => m.duration || 0).filter((d) => d > 0);
  const totalDuration = durations.reduce((sum, d) => sum + d, 0);
  const minDuration = durations.length > 0 ? Math.min(...durations) : 0;
  const maxDuration = durations.length > 0 ? Math.max(...durations) : 0;

  // Token calculations
  const totalInputTokens = metrics.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalOutputTokens = metrics.reduce((sum, m) => sum + (m.outputTokens || 0), 0);
  const totalTokens = totalInputTokens + totalOutputTokens;

  // Cost calculations (calculate per-record and sum for accuracy)
  let totalCost = 0;
  for (const m of metrics) {
    if (m.inputTokens != null && m.outputTokens != null) {
      const cost = calculateCost(
        { inputTokens: m.inputTokens, outputTokens: m.outputTokens },
        m.model || "default",
        { repoRoot }
      );
      totalCost += cost.totalCost;
    }
  }

  // Retry calculations
  const totalRetries = metrics.reduce((sum, m) => sum + (m.retryCount || 0), 0);

  // Quality signals
  const qualitySignals = {
    testsPassedCount: metrics.filter((m) => m.testsPassed === true).length,
    testsFailedCount: metrics.filter((m) => m.testsPassed === false).length,
    lintCleanCount: metrics.filter((m) => m.lintClean === true).length,
    lintFailedCount: metrics.filter((m) => m.lintClean === false).length,
    typeCheckCleanCount: metrics.filter((m) => m.typeCheckClean === true).length,
    typeCheckFailedCount: metrics.filter((m) => m.typeCheckClean === false).length,
  };

  const count = metrics.length;
  const successCount = successMetrics.length;
  const errorCount = errorMetrics.length;

  return {
    count,
    successCount,
    errorCount,
    successRate: count > 0 ? Math.round((successCount / count) * 100) : 0,
    totalDuration,
    avgDuration: count > 0 ? Math.round(totalDuration / count) : 0,
    minDuration,
    maxDuration,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    avgTokens: count > 0 ? Math.round(totalTokens / count) : 0,
    totalCost: roundCost(totalCost),
    avgCost: count > 0 ? roundCost(totalCost / count) : 0,
    totalRetries,
    avgRetries: count > 0 ? Math.round((totalRetries / count) * 100) / 100 : 0,
    qualitySignals,
  };
}

/**
 * Round cost to 6 decimal places
 * @param {number} cost - Cost value
 * @returns {number} Rounded cost
 */
function roundCost(cost) {
  if (cost == null || isNaN(cost)) {
    return 0;
  }
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Aggregate metrics for an experiment grouped by variant
 * @param {string} prdFolder - Path to PRD folder containing metrics
 * @param {string} experimentName - Name of the experiment
 * @param {Object} options - Options { repoRoot }
 * @returns {Object} Aggregated metrics by variant
 */
function aggregateExperimentMetrics(prdFolder, experimentName, options = {}) {
  const result = loadMetrics(prdFolder);

  if (!result.success) {
    return {
      success: false,
      error: result.error,
      experimentName,
      variants: {},
      overall: null,
    };
  }

  const experimentMetrics = filterByExperiment(result.metrics, experimentName);

  if (experimentMetrics.length === 0) {
    return {
      success: true,
      experimentName,
      variants: {},
      overall: calculateAggregatedMetrics([], options),
      metricsCount: 0,
    };
  }

  // Group by variant
  const variantGroups = {};
  for (const m of experimentMetrics) {
    const variant = m.experimentVariant || "unknown";
    if (!variantGroups[variant]) {
      variantGroups[variant] = [];
    }
    variantGroups[variant].push(m);
  }

  // Calculate aggregated metrics per variant
  const variants = {};
  for (const [variantName, variantMetrics] of Object.entries(variantGroups)) {
    variants[variantName] = calculateAggregatedMetrics(variantMetrics, options);
  }

  // Calculate overall metrics for the experiment
  const overall = calculateAggregatedMetrics(experimentMetrics, options);

  return {
    success: true,
    experimentName,
    variants,
    overall,
    metricsCount: experimentMetrics.length,
    variantNames: Object.keys(variants),
  };
}

/**
 * Load and aggregate metrics from multiple PRD folders for an experiment
 * @param {string} repoRoot - Repository root directory
 * @param {string} experimentName - Name of the experiment
 * @param {Object} options - Options { prdFolders?: string[] }
 * @returns {Object} Aggregated metrics across all PRD folders
 */
function aggregateExperimentMetricsAcrossPRDs(repoRoot, experimentName, options = {}) {
  const fs = require("fs");
  const { prdFolders = null } = options;

  const ralphDir = path.join(repoRoot, ".ralph");

  if (!fs.existsSync(ralphDir)) {
    return {
      success: false,
      error: "No .ralph directory found",
      experimentName,
      variants: {},
      overall: null,
    };
  }

  // Find all PRD folders if not specified
  let folders = prdFolders;
  if (!folders) {
    folders = [];
    const entries = fs.readdirSync(ralphDir);
    for (const entry of entries) {
      if (/^PRD-\d+$/i.test(entry)) {
        folders.push(path.join(ralphDir, entry));
      }
    }
  }

  if (folders.length === 0) {
    return {
      success: false,
      error: "No PRD folders found",
      experimentName,
      variants: {},
      overall: null,
    };
  }

  // Collect all metrics from all PRD folders
  const allMetrics = [];
  for (const folder of folders) {
    const result = loadMetrics(folder);
    if (result.success && result.metrics.length > 0) {
      const experimentMetrics = filterByExperiment(result.metrics, experimentName);
      allMetrics.push(...experimentMetrics);
    }
  }

  if (allMetrics.length === 0) {
    return {
      success: true,
      experimentName,
      variants: {},
      overall: calculateAggregatedMetrics([], { repoRoot }),
      metricsCount: 0,
      prdFolderCount: folders.length,
    };
  }

  // Group by variant
  const variantGroups = {};
  for (const m of allMetrics) {
    const variant = m.experimentVariant || "unknown";
    if (!variantGroups[variant]) {
      variantGroups[variant] = [];
    }
    variantGroups[variant].push(m);
  }

  // Calculate aggregated metrics per variant
  const variants = {};
  for (const [variantName, variantMetrics] of Object.entries(variantGroups)) {
    variants[variantName] = calculateAggregatedMetrics(variantMetrics, { repoRoot });
  }

  // Calculate overall metrics
  const overall = calculateAggregatedMetrics(allMetrics, { repoRoot });

  return {
    success: true,
    experimentName,
    variants,
    overall,
    metricsCount: allMetrics.length,
    variantNames: Object.keys(variants),
    prdFolderCount: folders.length,
  };
}

/**
 * Get metrics comparison between two variants
 * @param {Object} variantA - Aggregated metrics for variant A
 * @param {Object} variantB - Aggregated metrics for variant B
 * @returns {Object} Comparison results
 */
function compareVariants(variantA, variantB) {
  if (!variantA || !variantB) {
    return {
      valid: false,
      error: "Both variants must have metrics data",
    };
  }

  const comparison = {
    valid: true,
    successRate: {
      variantA: variantA.successRate,
      variantB: variantB.successRate,
      difference: variantA.successRate - variantB.successRate,
      better: variantA.successRate > variantB.successRate ? "A" :
        variantB.successRate > variantA.successRate ? "B" : "tie",
    },
    avgDuration: {
      variantA: variantA.avgDuration,
      variantB: variantB.avgDuration,
      difference: variantA.avgDuration - variantB.avgDuration,
      better: variantA.avgDuration < variantB.avgDuration ? "A" :
        variantB.avgDuration < variantA.avgDuration ? "B" : "tie",
    },
    avgCost: {
      variantA: variantA.avgCost,
      variantB: variantB.avgCost,
      difference: roundCost(variantA.avgCost - variantB.avgCost),
      better: variantA.avgCost < variantB.avgCost ? "A" :
        variantB.avgCost < variantA.avgCost ? "B" : "tie",
    },
    avgTokens: {
      variantA: variantA.avgTokens,
      variantB: variantB.avgTokens,
      difference: variantA.avgTokens - variantB.avgTokens,
      better: variantA.avgTokens < variantB.avgTokens ? "A" :
        variantB.avgTokens < variantA.avgTokens ? "B" : "tie",
    },
    avgRetries: {
      variantA: variantA.avgRetries,
      variantB: variantB.avgRetries,
      difference: Math.round((variantA.avgRetries - variantB.avgRetries) * 100) / 100,
      better: variantA.avgRetries < variantB.avgRetries ? "A" :
        variantB.avgRetries < variantA.avgRetries ? "B" : "tie",
    },
    sampleSizes: {
      variantA: variantA.count,
      variantB: variantB.count,
    },
  };

  return comparison;
}

/**
 * Get summary statistics for quality signals
 * @param {Object} aggregatedMetrics - Aggregated metrics with qualitySignals
 * @returns {Object} Quality signal summary
 */
function getQualitySignalSummary(aggregatedMetrics) {
  if (!aggregatedMetrics || !aggregatedMetrics.qualitySignals) {
    return {
      testsPassRate: null,
      lintPassRate: null,
      typeCheckPassRate: null,
      overallQuality: null,
    };
  }

  const q = aggregatedMetrics.qualitySignals;

  const testsTotal = q.testsPassedCount + q.testsFailedCount;
  const lintTotal = q.lintCleanCount + q.lintFailedCount;
  const typeCheckTotal = q.typeCheckCleanCount + q.typeCheckFailedCount;

  const testsPassRate = testsTotal > 0 ? Math.round((q.testsPassedCount / testsTotal) * 100) : null;
  const lintPassRate = lintTotal > 0 ? Math.round((q.lintCleanCount / lintTotal) * 100) : null;
  const typeCheckPassRate = typeCheckTotal > 0 ? Math.round((q.typeCheckCleanCount / typeCheckTotal) * 100) : null;

  // Calculate overall quality as average of available signals
  const rates = [testsPassRate, lintPassRate, typeCheckPassRate].filter((r) => r !== null);
  const overallQuality = rates.length > 0 ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;

  return {
    testsPassRate,
    lintPassRate,
    typeCheckPassRate,
    overallQuality,
    signals: {
      tests: { passed: q.testsPassedCount, failed: q.testsFailedCount, total: testsTotal },
      lint: { passed: q.lintCleanCount, failed: q.lintFailedCount, total: lintTotal },
      typeCheck: { passed: q.typeCheckCleanCount, failed: q.typeCheckFailedCount, total: typeCheckTotal },
    },
  };
}

/**
 * Get cost breakdown for an experiment
 * @param {Object} experimentAggregation - Result from aggregateExperimentMetrics
 * @returns {Object} Cost breakdown by variant
 */
function getExperimentCostBreakdown(experimentAggregation) {
  if (!experimentAggregation || !experimentAggregation.success) {
    return {
      success: false,
      error: experimentAggregation?.error || "No experiment data",
    };
  }

  const breakdown = {
    success: true,
    experimentName: experimentAggregation.experimentName,
    totalCost: experimentAggregation.overall?.totalCost || 0,
    avgCostPerRun: experimentAggregation.overall?.avgCost || 0,
    variants: {},
  };

  for (const [variantName, variantMetrics] of Object.entries(experimentAggregation.variants)) {
    breakdown.variants[variantName] = {
      totalCost: variantMetrics.totalCost,
      avgCost: variantMetrics.avgCost,
      runCount: variantMetrics.count,
      costPerSuccess: variantMetrics.successCount > 0
        ? roundCost(variantMetrics.totalCost / variantMetrics.successCount)
        : null,
      totalInputTokens: variantMetrics.totalInputTokens,
      totalOutputTokens: variantMetrics.totalOutputTokens,
    };
  }

  return breakdown;
}

module.exports = {
  filterByExperiment,
  filterByVariant,
  calculateAggregatedMetrics,
  aggregateExperimentMetrics,
  aggregateExperimentMetricsAcrossPRDs,
  compareVariants,
  getQualitySignalSummary,
  getExperimentCostBreakdown,
  roundCost,
};
