/**
 * Estimation algorithm - combines base estimates with historical data
 *
 * When historical data is available (>3 samples), uses weighted average:
 * - 70% historical data
 * - 30% base estimate (from complexity heuristics)
 *
 * When insufficient history, falls back to 100% base estimate with wider
 * confidence intervals.
 */
const { loadMetrics, filterByStory, getStoryAverages, filterByStatus } = require("./metrics");
const { scoreComplexity, estimateBaseDuration, estimateBaseTokens, getConfidenceMultipliers } = require("./complexity");

// Weighting configuration
const HISTORY_WEIGHT = 0.7; // Weight for historical data when available
const BASE_WEIGHT = 0.3; // Weight for base estimate
const MIN_SAMPLES_FOR_HISTORY = 3; // Minimum samples to use historical weighting

/**
 * Calculate estimate for a story using historical data when available
 *
 * @param {Object} story - Story object with id, taskCount, keywords
 * @param {Object} options - Options
 * @param {string} options.prdFolder - PRD folder path (for loading metrics)
 * @param {Object[]} options.metrics - Pre-loaded metrics (optional, to avoid re-loading)
 * @returns {Object} Estimate with duration, tokens, confidence
 */
function estimateFromHistory(story, options = {}) {
  const { prdFolder, metrics: preloadedMetrics } = options;

  // Get base estimate from complexity heuristics
  const complexity = scoreComplexity(story);
  const baseDuration = estimateBaseDuration(complexity);
  const baseTokens = estimateBaseTokens(complexity);

  // Try to load historical data
  let historicalAvg = null;
  let sampleCount = 0;

  if (preloadedMetrics) {
    // Use pre-loaded metrics
    historicalAvg = calculateHistoricalAverage(preloadedMetrics, story.id);
    sampleCount = historicalAvg ? historicalAvg.sampleCount : 0;
  } else if (prdFolder) {
    // Load metrics from file
    const loadResult = loadMetrics(prdFolder);
    if (loadResult.success && loadResult.metrics.length > 0) {
      historicalAvg = calculateHistoricalAverage(loadResult.metrics, story.id);
      sampleCount = historicalAvg ? historicalAvg.sampleCount : 0;
    }
  }

  // Calculate weighted estimate
  let finalDuration;
  let finalTokens;
  let confidenceLevel;

  if (sampleCount >= MIN_SAMPLES_FOR_HISTORY && historicalAvg) {
    // Use weighted average: 70% history, 30% base
    finalDuration = Math.round(
      historicalAvg.avgDuration * HISTORY_WEIGHT + baseDuration * BASE_WEIGHT
    );
    finalTokens = Math.round(
      historicalAvg.avgTotalTokens * HISTORY_WEIGHT + baseTokens * BASE_WEIGHT
    );
    confidenceLevel = sampleCount >= 5 ? "high" : "medium";
  } else if (sampleCount > 0 && historicalAvg) {
    // Some history but not enough for full weighting
    // Use 50/50 split when we have 1-2 samples
    const historyWeight = 0.5;
    const baseWeight = 0.5;
    finalDuration = Math.round(
      historicalAvg.avgDuration * historyWeight + baseDuration * baseWeight
    );
    finalTokens = Math.round(
      historicalAvg.avgTotalTokens * historyWeight + baseTokens * baseWeight
    );
    confidenceLevel = "medium";
  } else {
    // No historical data, use 100% base estimate
    finalDuration = baseDuration;
    finalTokens = baseTokens;
    confidenceLevel = "low";
  }

  // Get confidence multipliers for range calculation
  const confidenceMultipliers = getConfidenceMultipliers(sampleCount);

  // Calculate confidence range based on historical variance if available
  let optimisticMultiplier = confidenceMultipliers.optimistic;
  let pessimisticMultiplier = confidenceMultipliers.pessimistic;

  if (sampleCount >= MIN_SAMPLES_FOR_HISTORY && historicalAvg && historicalAvg.stdDev) {
    // Use actual variance from historical data to narrow/widen range
    const cv = historicalAvg.stdDev / historicalAvg.avgDuration; // coefficient of variation
    optimisticMultiplier = Math.max(0.5, 1 - cv);
    pessimisticMultiplier = Math.min(2.0, 1 + cv * 1.5);
  }

  return {
    storyId: story.id,
    complexity: complexity,

    // Base estimates (from heuristics)
    baseDuration: baseDuration,
    baseTokens: baseTokens,

    // Final estimates (weighted with history)
    duration: finalDuration,
    tokens: finalTokens,

    // Confidence range
    durationOptimistic: Math.round(finalDuration * optimisticMultiplier),
    durationPessimistic: Math.round(finalDuration * pessimisticMultiplier),
    tokensOptimistic: Math.round(finalTokens * optimisticMultiplier),
    tokensPessimistic: Math.round(finalTokens * pessimisticMultiplier),

    // Metadata
    historicalSamples: sampleCount,
    confidence: confidenceLevel,
    usedHistory: sampleCount >= MIN_SAMPLES_FOR_HISTORY,
    historyWeight: sampleCount >= MIN_SAMPLES_FOR_HISTORY ? HISTORY_WEIGHT : (sampleCount > 0 ? 0.5 : 0),
  };
}

/**
 * Calculate historical average for a story from metrics
 *
 * @param {Object[]} metrics - Array of metric records
 * @param {string} storyId - Story ID to calculate average for
 * @returns {Object|null} Average metrics or null if no data
 */
function calculateHistoricalAverage(metrics, storyId) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return null;
  }

  // Filter to successful runs for this story
  const storyMetrics = filterByStory(metrics, storyId);
  const successMetrics = filterByStatus(storyMetrics, "success");

  if (successMetrics.length === 0) {
    // Try similar stories (same prefix pattern) if exact match not found
    const similarMetrics = findSimilarStoryMetrics(metrics, storyId);
    if (similarMetrics.length === 0) {
      return null;
    }
    return calculateAverageFromMetrics(similarMetrics, storyId);
  }

  return calculateAverageFromMetrics(successMetrics, storyId);
}

/**
 * Find metrics from similar stories (for new stories without history)
 *
 * @param {Object[]} metrics - All metrics
 * @param {string} storyId - Target story ID
 * @returns {Object[]} Metrics from similar stories
 */
function findSimilarStoryMetrics(metrics, storyId) {
  // For now, return all successful metrics as a baseline
  // Future enhancement: match by story type keywords
  const successMetrics = filterByStatus(metrics, "success");
  return successMetrics;
}

/**
 * Calculate average values from a set of metrics
 *
 * @param {Object[]} metrics - Array of metric records
 * @param {string} storyId - Story ID for the result
 * @returns {Object} Average metrics
 */
function calculateAverageFromMetrics(metrics, storyId) {
  const count = metrics.length;

  // Calculate averages
  const totalDuration = metrics.reduce((sum, m) => sum + (m.duration || 0), 0);
  const totalInputTokens = metrics.reduce((sum, m) => sum + (m.inputTokens || 0), 0);
  const totalOutputTokens = metrics.reduce((sum, m) => sum + (m.outputTokens || 0), 0);

  const avgDuration = totalDuration / count;
  const avgInputTokens = totalInputTokens / count;
  const avgOutputTokens = totalOutputTokens / count;

  // Calculate standard deviation for duration (for confidence range)
  const squaredDiffs = metrics.map((m) => Math.pow((m.duration || 0) - avgDuration, 2));
  const avgSquaredDiff = squaredDiffs.reduce((sum, d) => sum + d, 0) / count;
  const stdDev = Math.sqrt(avgSquaredDiff);

  return {
    storyId,
    sampleCount: count,
    avgDuration: Math.round(avgDuration),
    avgInputTokens: Math.round(avgInputTokens),
    avgOutputTokens: Math.round(avgOutputTokens),
    avgTotalTokens: Math.round(avgInputTokens + avgOutputTokens),
    stdDev: Math.round(stdDev),
  };
}

/**
 * Estimate all stories in a plan using historical data
 *
 * @param {Object[]} stories - Array of story objects
 * @param {Object} options - Options { prdFolder }
 * @returns {Object} Estimates with per-story and totals
 */
function estimateAllStories(stories, options = {}) {
  const { prdFolder } = options;

  // Load metrics once for all stories
  let allMetrics = [];
  if (prdFolder) {
    const loadResult = loadMetrics(prdFolder);
    if (loadResult.success) {
      allMetrics = loadResult.metrics;
    }
  }

  const estimates = [];
  let totalDuration = 0;
  let totalTokens = 0;
  let totalHistoricalSamples = 0;

  for (const story of stories) {
    const estimate = estimateFromHistory(story, {
      metrics: allMetrics,
    });

    estimates.push(estimate);

    // Accumulate totals for pending stories only
    if (!story.completed) {
      totalDuration += estimate.duration;
      totalTokens += estimate.tokens;
    }

    totalHistoricalSamples += estimate.historicalSamples;
  }

  // Calculate overall confidence based on average historical coverage
  const avgSamples = stories.length > 0 ? totalHistoricalSamples / stories.length : 0;
  const overallConfidence = avgSamples >= 5 ? "high" : avgSamples >= 2 ? "medium" : "low";

  return {
    estimates,
    totals: {
      duration: totalDuration,
      tokens: totalTokens,
      historicalSamples: totalHistoricalSamples,
      confidence: overallConfidence,
    },
  };
}

module.exports = {
  estimateFromHistory,
  calculateHistoricalAverage,
  findSimilarStoryMetrics,
  calculateAverageFromMetrics,
  estimateAllStories,
  // Export constants for testing
  HISTORY_WEIGHT,
  BASE_WEIGHT,
  MIN_SAMPLES_FOR_HISTORY,
};
