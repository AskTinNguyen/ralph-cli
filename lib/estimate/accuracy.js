/**
 * Accuracy tracking module - compare estimates vs actual results
 *
 * Provides:
 * - saveEstimate(): Save pre-run estimate for later comparison
 * - loadEstimates(): Load saved estimates
 * - compareEstimateToActual(): Compare an estimate to actual metrics
 * - calculateAccuracy(): Calculate overall accuracy metrics (MAPE)
 * - detectTrend(): Detect if accuracy is improving/stable/degrading
 */
const fs = require("fs");
const path = require("path");
const { loadMetrics } = require("./metrics");

/**
 * Get the estimates file path for a PRD folder
 * @param {string} prdFolder - Path to PRD folder
 * @returns {string} Path to estimates.jsonl
 */
function getEstimatesPath(prdFolder) {
  return path.join(prdFolder, "runs", "estimates.jsonl");
}

/**
 * Save a pre-run estimate for later accuracy comparison
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} estimate - Estimate data from estimate()
 * @returns {Object} { success: boolean, error?: string }
 */
function saveEstimate(prdFolder, estimate) {
  try {
    const estimatesPath = getEstimatesPath(prdFolder);
    const runsDir = path.dirname(estimatesPath);

    // Create runs directory if it doesn't exist
    if (!fs.existsSync(runsDir)) {
      fs.mkdirSync(runsDir, { recursive: true });
    }

    // Create estimate record
    const record = {
      timestamp: new Date().toISOString(),
      stories: estimate.estimates.map((e) => ({
        storyId: e.storyId,
        title: e.title,
        estimatedDuration: e.duration,
        estimatedTokens: e.tokens,
        estimatedCost: e.cost,
        confidence: e.confidence,
        completed: e.completed,
      })),
      totals: {
        duration: estimate.totals.duration,
        tokens: estimate.totals.tokens,
        cost: estimate.totals.cost,
        confidence: estimate.totals.confidence,
      },
    };

    // Append to file
    fs.appendFileSync(estimatesPath, JSON.stringify(record) + "\n", "utf-8");

    return { success: true, record };
  } catch (err) {
    return {
      success: false,
      error: `Failed to save estimate: ${err.message}`,
    };
  }
}

/**
 * Load all saved estimates from estimates.jsonl
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} { success: boolean, estimates: Object[], error?: string }
 */
function loadEstimates(prdFolder) {
  try {
    const estimatesPath = getEstimatesPath(prdFolder);

    if (!fs.existsSync(estimatesPath)) {
      return { success: true, estimates: [] };
    }

    const content = fs.readFileSync(estimatesPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    const estimates = [];

    for (const line of lines) {
      try {
        estimates.push(JSON.parse(line));
      } catch {
        // Skip corrupt lines
        continue;
      }
    }

    return { success: true, estimates };
  } catch (err) {
    return {
      success: false,
      estimates: [],
      error: `Failed to load estimates: ${err.message}`,
    };
  }
}

/**
 * Compare an estimate to actual metrics for a specific story
 * @param {Object} estimateStory - Story estimate { storyId, estimatedDuration, estimatedTokens, estimatedCost }
 * @param {Object} actualMetric - Actual metric { storyId, duration, inputTokens, outputTokens }
 * @returns {Object} Comparison result with deviation percentages
 */
function compareEstimateToActual(estimateStory, actualMetric) {
  if (!estimateStory || !actualMetric) {
    return null;
  }

  const actualTokens = (actualMetric.inputTokens || 0) + (actualMetric.outputTokens || 0);

  // Calculate deviations (positive = overestimate, negative = underestimate)
  const durationDeviation = estimateStory.estimatedDuration > 0
    ? ((actualMetric.duration - estimateStory.estimatedDuration) / estimateStory.estimatedDuration) * 100
    : 0;

  const tokensDeviation = estimateStory.estimatedTokens > 0
    ? ((actualTokens - estimateStory.estimatedTokens) / estimateStory.estimatedTokens) * 100
    : 0;

  return {
    storyId: estimateStory.storyId,
    title: estimateStory.title,
    estimated: {
      duration: estimateStory.estimatedDuration,
      tokens: estimateStory.estimatedTokens,
      cost: estimateStory.estimatedCost,
    },
    actual: {
      duration: actualMetric.duration,
      tokens: actualTokens,
    },
    deviation: {
      duration: durationDeviation,
      tokens: tokensDeviation,
    },
    absoluteDeviation: {
      duration: Math.abs(durationDeviation),
      tokens: Math.abs(tokensDeviation),
    },
  };
}

/**
 * Match estimates to actual metrics and calculate comparisons
 * @param {Object[]} estimates - Saved estimates
 * @param {Object[]} metrics - Actual metrics from metrics.jsonl
 * @returns {Object[]} Array of comparisons
 */
function matchEstimatesToActuals(estimates, metrics) {
  const comparisons = [];

  // Group metrics by story ID for faster lookup
  const metricsByStory = {};
  for (const m of metrics) {
    if (m.status === "success" && m.storyId) {
      if (!metricsByStory[m.storyId]) {
        metricsByStory[m.storyId] = [];
      }
      metricsByStory[m.storyId].push(m);
    }
  }

  // For each estimate, find matching actual metrics
  for (const est of estimates) {
    const estimateTimestamp = new Date(est.timestamp).getTime();

    for (const storyEst of est.stories) {
      if (storyEst.completed) {
        // Skip already completed stories at time of estimate
        continue;
      }

      const storyMetrics = metricsByStory[storyEst.storyId] || [];

      // Find metrics that occurred after this estimate
      const matchingMetrics = storyMetrics.filter((m) => {
        const metricTime = new Date(m.timestamp).getTime();
        return metricTime > estimateTimestamp;
      });

      if (matchingMetrics.length > 0) {
        // Use the first successful metric after the estimate
        const actualMetric = matchingMetrics[0];
        const comparison = compareEstimateToActual(storyEst, actualMetric);
        if (comparison) {
          comparison.estimateTimestamp = est.timestamp;
          comparison.actualTimestamp = actualMetric.timestamp;
          comparisons.push(comparison);
        }
      }
    }
  }

  return comparisons;
}

/**
 * Calculate Mean Absolute Percentage Error (MAPE) for accuracy
 * @param {Object[]} comparisons - Array of estimate-to-actual comparisons
 * @returns {Object} Accuracy metrics
 */
function calculateAccuracy(comparisons) {
  if (!comparisons || comparisons.length === 0) {
    return {
      sampleCount: 0,
      mape: { duration: null, tokens: null },
      averageDeviation: { duration: null, tokens: null },
      medianDeviation: { duration: null, tokens: null },
    };
  }

  // Filter out comparisons with zero estimates (would cause infinity)
  const validComparisons = comparisons.filter(
    (c) => c.estimated.duration > 0 && c.estimated.tokens > 0
  );

  if (validComparisons.length === 0) {
    return {
      sampleCount: comparisons.length,
      mape: { duration: null, tokens: null },
      averageDeviation: { duration: null, tokens: null },
      medianDeviation: { duration: null, tokens: null },
    };
  }

  // Calculate MAPE (Mean Absolute Percentage Error)
  const durationDeviations = validComparisons.map((c) => c.absoluteDeviation.duration);
  const tokensDeviations = validComparisons.map((c) => c.absoluteDeviation.tokens);

  const sum = (arr) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr) => sum(arr) / arr.length;
  const median = (arr) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  // Average signed deviation (shows bias direction)
  const signedDurationDeviations = validComparisons.map((c) => c.deviation.duration);
  const signedTokensDeviations = validComparisons.map((c) => c.deviation.tokens);

  return {
    sampleCount: validComparisons.length,
    mape: {
      duration: avg(durationDeviations),
      tokens: avg(tokensDeviations),
    },
    averageDeviation: {
      duration: avg(signedDurationDeviations),
      tokens: avg(signedTokensDeviations),
    },
    medianDeviation: {
      duration: median(signedDurationDeviations),
      tokens: median(signedTokensDeviations),
    },
  };
}

/**
 * Detect accuracy trend (improving/stable/degrading)
 * Compares recent estimates (last N) vs older estimates
 * @param {Object[]} comparisons - Array of comparisons sorted by time
 * @param {number} recentCount - Number of recent comparisons to use (default: 5)
 * @returns {Object} Trend analysis
 */
function detectTrend(comparisons, recentCount = 5) {
  if (!comparisons || comparisons.length < 3) {
    return {
      trend: "insufficient_data",
      trendIndicator: "?",
      description: "Not enough data to determine trend",
      recentMape: null,
      olderMape: null,
    };
  }

  // Sort by timestamp
  const sorted = [...comparisons].sort(
    (a, b) => new Date(a.actualTimestamp).getTime() - new Date(b.actualTimestamp).getTime()
  );

  // Split into recent and older
  const splitPoint = Math.max(sorted.length - recentCount, Math.floor(sorted.length / 2));
  const recent = sorted.slice(splitPoint);
  const older = sorted.slice(0, splitPoint);

  if (older.length === 0) {
    return {
      trend: "insufficient_data",
      trendIndicator: "?",
      description: "Not enough older data for comparison",
      recentMape: calculateAccuracy(recent).mape,
      olderMape: null,
    };
  }

  const recentAccuracy = calculateAccuracy(recent);
  const olderAccuracy = calculateAccuracy(older);

  // Compare MAPE values (lower is better)
  const recentMape = recentAccuracy.mape.duration;
  const olderMape = olderAccuracy.mape.duration;

  if (recentMape === null || olderMape === null) {
    return {
      trend: "insufficient_data",
      trendIndicator: "?",
      description: "Cannot calculate trend with available data",
      recentMape: recentAccuracy.mape,
      olderMape: olderAccuracy.mape,
    };
  }

  // Determine trend based on improvement threshold (10% change)
  const improvement = ((olderMape - recentMape) / olderMape) * 100;

  let trend, trendIndicator, description;
  if (improvement > 10) {
    trend = "improving";
    trendIndicator = "↑";
    description = `Accuracy improving (${Math.abs(improvement).toFixed(0)}% better)`;
  } else if (improvement < -10) {
    trend = "degrading";
    trendIndicator = "↓";
    description = `Accuracy degrading (${Math.abs(improvement).toFixed(0)}% worse)`;
  } else {
    trend = "stable";
    trendIndicator = "→";
    description = "Accuracy stable";
  }

  return {
    trend,
    trendIndicator,
    description,
    recentMape: recentAccuracy.mape,
    olderMape: olderAccuracy.mape,
    improvement: improvement,
  };
}

/**
 * Generate accuracy report for a PRD
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} Full accuracy report
 */
function generateAccuracyReport(prdFolder) {
  // Load estimates
  const estimatesResult = loadEstimates(prdFolder);
  if (!estimatesResult.success) {
    return {
      success: false,
      error: estimatesResult.error,
    };
  }

  // Load actual metrics
  const metricsResult = loadMetrics(prdFolder);
  if (!metricsResult.success) {
    return {
      success: false,
      error: metricsResult.error,
    };
  }

  // Check if we have enough data
  if (estimatesResult.estimates.length === 0) {
    return {
      success: true,
      hasData: false,
      message: "No saved estimates found. Run `ralph estimate` before builds to track accuracy.",
      comparisons: [],
      accuracy: null,
      trend: null,
    };
  }

  if (metricsResult.metrics.length === 0) {
    return {
      success: true,
      hasData: false,
      message: "No actual run metrics found. Complete some builds to compare against estimates.",
      comparisons: [],
      accuracy: null,
      trend: null,
    };
  }

  // Match estimates to actuals
  const comparisons = matchEstimatesToActuals(estimatesResult.estimates, metricsResult.metrics);

  if (comparisons.length === 0) {
    return {
      success: true,
      hasData: false,
      message: "No matching estimate-to-actual pairs found. Estimates may predate metrics.",
      comparisons: [],
      accuracy: null,
      trend: null,
    };
  }

  // Calculate accuracy metrics
  const accuracy = calculateAccuracy(comparisons);
  const trend = detectTrend(comparisons);

  return {
    success: true,
    hasData: true,
    comparisons,
    accuracy,
    trend,
    summary: {
      totalEstimates: estimatesResult.estimates.length,
      totalMetrics: metricsResult.metrics.length,
      matchedPairs: comparisons.length,
    },
  };
}

/**
 * Format accuracy report for console output
 * @param {Object} report - Report from generateAccuracyReport()
 * @returns {string} Formatted output
 */
function formatAccuracyReport(report) {
  if (!report.success) {
    return report.error;
  }

  if (!report.hasData) {
    return report.message;
  }

  const lines = [];
  const pad = (str, width, align = "left") => {
    const s = String(str || "");
    if (s.length >= width) return s.slice(0, width);
    const padding = " ".repeat(width - s.length);
    return align === "right" ? padding + s : s + padding;
  };

  // Header
  lines.push("Estimate vs Actual Comparison");
  lines.push("─".repeat(80));
  lines.push("");

  // Table header
  lines.push(
    `${pad("Story", 15)} ${pad("Est. Time", 12, "right")} ${pad("Actual", 12, "right")} ${pad("Deviation", 12, "right")} ${pad("Est. Tokens", 12, "right")} ${pad("Actual", 12, "right")}`
  );
  lines.push("─".repeat(80));

  // Table rows
  for (const comp of report.comparisons) {
    const durationDev = comp.deviation.duration.toFixed(0) + "%";
    const durationSign = comp.deviation.duration >= 0 ? "+" : "";

    lines.push(
      `${pad(comp.storyId, 15)} ${pad(formatSeconds(comp.estimated.duration), 12, "right")} ${pad(formatSeconds(comp.actual.duration), 12, "right")} ${pad(durationSign + durationDev, 12, "right")} ${pad(formatNumber(comp.estimated.tokens), 12, "right")} ${pad(formatNumber(comp.actual.tokens), 12, "right")}`
    );
  }

  lines.push("─".repeat(80));
  lines.push("");

  // Summary statistics
  lines.push("Accuracy Summary");
  lines.push("─".repeat(40));

  const acc = report.accuracy;
  if (acc.mape.duration !== null) {
    lines.push(`Average deviation (time):    ±${acc.mape.duration.toFixed(1)}%`);
  }
  if (acc.mape.tokens !== null) {
    lines.push(`Average deviation (tokens):  ±${acc.mape.tokens.toFixed(1)}%`);
  }
  if (acc.averageDeviation.duration !== null) {
    const sign = acc.averageDeviation.duration >= 0 ? "+" : "";
    lines.push(`Bias (time):                 ${sign}${acc.averageDeviation.duration.toFixed(1)}% (${acc.averageDeviation.duration >= 0 ? "underestimating" : "overestimating"})`);
  }

  lines.push("");
  lines.push(`Samples: ${acc.sampleCount}`);

  // Trend
  lines.push("");
  lines.push("Trend Analysis");
  lines.push("─".repeat(40));
  lines.push(`${report.trend.trendIndicator} ${report.trend.description}`);

  return lines.join("\n");
}

/**
 * Format accuracy report as JSON
 * @param {Object} report - Report from generateAccuracyReport()
 * @returns {string} JSON string
 */
function formatAccuracyJSON(report) {
  return JSON.stringify(report, null, 2);
}

/**
 * Format seconds to human readable
 * @param {number} seconds - Seconds
 * @returns {string} Formatted string
 */
function formatSeconds(seconds) {
  if (seconds == null || isNaN(seconds)) return "N/A";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * Format number with K/M suffix
 * @param {number} num - Number
 * @returns {string} Formatted string
 */
function formatNumber(num) {
  if (num == null || isNaN(num)) return "N/A";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return String(Math.round(num));
}

module.exports = {
  getEstimatesPath,
  saveEstimate,
  loadEstimates,
  compareEstimateToActual,
  matchEstimatesToActuals,
  calculateAccuracy,
  detectTrend,
  generateAccuracyReport,
  formatAccuracyReport,
  formatAccuracyJSON,
};
