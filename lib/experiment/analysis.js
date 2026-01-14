/**
 * Experiment Analysis Module
 *
 * Provides statistical analysis for A/B experiment results:
 * - Chi-squared and z-test for proportions
 * - Winner determination with confidence levels
 * - Results export in JSON and CSV formats
 * - ASCII visualization for terminal output
 */

const {
  aggregateExperimentMetrics,
  aggregateExperimentMetricsAcrossPRDs,
  compareVariants,
  getQualitySignalSummary,
  getExperimentCostBreakdown,
  roundCost,
} = require("./metrics");

const { loadExperiment } = require("./manager");

/**
 * Normal CDF approximation using Abramowitz and Stegun formula
 * @param {number} z - Z-score
 * @returns {number} Cumulative probability
 */
function normalCDF(z) {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z);

  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z / 2);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate p-value from z-score (two-tailed test)
 * @param {number} z - Z-score
 * @returns {number} Two-tailed p-value
 */
function zToPValue(z) {
  return 2 * (1 - normalCDF(Math.abs(z)));
}

/**
 * Calculate statistical significance using z-test for proportions
 * @param {Object} control - Control metrics { successCount, count }
 * @param {Object} treatment - Treatment metrics { successCount, count }
 * @returns {Object} Statistical results { zScore, pValue, significant, confidenceLevel }
 */
function calculateSignificance(control, treatment) {
  const n1 = control.count;
  const n2 = treatment.count;
  const x1 = control.successCount;
  const x2 = treatment.successCount;

  // Check minimum sample sizes
  if (n1 < 5 || n2 < 5) {
    return {
      zScore: null,
      pValue: null,
      significant: false,
      confidenceLevel: 0,
      reason: "Insufficient samples (minimum 5 per variant)",
      minSamplesReached: false,
    };
  }

  // Calculate proportions
  const p1 = x1 / n1;
  const p2 = x2 / n2;

  // Pooled proportion for z-test
  const pooledP = (x1 + x2) / (n1 + n2);

  // Standard error
  const se = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));

  // Handle edge case where se is 0
  if (se === 0) {
    return {
      zScore: 0,
      pValue: 1,
      significant: false,
      confidenceLevel: 0,
      reason: "No variance in data",
      minSamplesReached: true,
      proportions: { control: p1, treatment: p2 },
    };
  }

  // Z-score
  const zScore = (p1 - p2) / se;

  // P-value (two-tailed)
  const pValue = zToPValue(zScore);

  // Determine confidence level
  let confidenceLevel = 0;
  if (pValue < 0.01) {
    confidenceLevel = 99;
  } else if (pValue < 0.05) {
    confidenceLevel = 95;
  } else if (pValue < 0.1) {
    confidenceLevel = 90;
  } else if (pValue < 0.2) {
    confidenceLevel = 80;
  }

  return {
    zScore: Math.round(zScore * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    significant: pValue < 0.05,
    confidenceLevel,
    minSamplesReached: true,
    proportions: {
      control: Math.round(p1 * 10000) / 10000,
      treatment: Math.round(p2 * 10000) / 10000,
    },
    absoluteDifference: Math.round((p2 - p1) * 10000) / 10000,
    relativeDifference: p1 > 0 ? Math.round(((p2 - p1) / p1) * 10000) / 100 : null,
  };
}

/**
 * Calculate significance for duration/continuous metrics using Welch's t-test
 * @param {Object} control - Control metrics { avgDuration, count, durations[] }
 * @param {Object} treatment - Treatment metrics { avgDuration, count, durations[] }
 * @param {Object[]} controlRaw - Raw control metrics array
 * @param {Object[]} treatmentRaw - Raw treatment metrics array
 * @returns {Object} Statistical results
 */
function calculateDurationSignificance(control, treatment, controlRaw = [], treatmentRaw = []) {
  const n1 = control.count;
  const n2 = treatment.count;

  if (n1 < 5 || n2 < 5) {
    return {
      tScore: null,
      pValue: null,
      significant: false,
      confidenceLevel: 0,
      reason: "Insufficient samples (minimum 5 per variant)",
    };
  }

  const mean1 = control.avgDuration;
  const mean2 = treatment.avgDuration;

  // Calculate variance from raw data if available, otherwise estimate from aggregated
  let var1, var2;
  if (controlRaw.length > 0 && treatmentRaw.length > 0) {
    const durations1 = controlRaw.map((m) => m.duration || 0);
    const durations2 = treatmentRaw.map((m) => m.duration || 0);

    var1 = variance(durations1);
    var2 = variance(durations2);
  } else {
    // Estimate variance from min/max if available
    const range1 = control.maxDuration - control.minDuration;
    const range2 = treatment.maxDuration - treatment.minDuration;
    // Using range/4 as rough variance estimate
    var1 = Math.pow(range1 / 4, 2) || 1;
    var2 = Math.pow(range2 / 4, 2) || 1;
  }

  // Welch's t-test
  const se = Math.sqrt(var1 / n1 + var2 / n2);

  if (se === 0) {
    return {
      tScore: 0,
      pValue: 1,
      significant: false,
      confidenceLevel: 0,
      reason: "No variance in data",
    };
  }

  const tScore = (mean1 - mean2) / se;

  // Approximate p-value using normal distribution (valid for large samples)
  const pValue = zToPValue(tScore);

  let confidenceLevel = 0;
  if (pValue < 0.01) {
    confidenceLevel = 99;
  } else if (pValue < 0.05) {
    confidenceLevel = 95;
  } else if (pValue < 0.1) {
    confidenceLevel = 90;
  }

  return {
    tScore: Math.round(tScore * 1000) / 1000,
    pValue: Math.round(pValue * 10000) / 10000,
    significant: pValue < 0.05,
    confidenceLevel,
    means: { control: mean1, treatment: mean2 },
    absoluteDifference: Math.round(mean2 - mean1),
    relativeDifference: mean1 > 0 ? Math.round(((mean2 - mean1) / mean1) * 10000) / 100 : null,
  };
}

/**
 * Calculate variance of an array
 * @param {number[]} values - Array of values
 * @returns {number} Variance
 */
function variance(values) {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map((v) => Math.pow(v - mean, 2));
  return squaredDiffs.reduce((a, b) => a + b, 0) / (values.length - 1);
}

/**
 * Determine experiment winner based on analysis
 * @param {Object} aggregation - Result from aggregateExperimentMetrics
 * @param {Object} options - Options { minConfidence: 95, primaryMetric: 'successRate' }
 * @returns {Object} Winner determination { winner, confidence, reason, metrics }
 */
function determineWinner(aggregation, options = {}) {
  const { minConfidence = 95, primaryMetric = "successRate" } = options;

  if (!aggregation || !aggregation.success) {
    return {
      winner: null,
      confidence: 0,
      reason: aggregation?.error || "No experiment data available",
      significant: false,
    };
  }

  const variantNames = Object.keys(aggregation.variants);

  if (variantNames.length < 2) {
    return {
      winner: null,
      confidence: 0,
      reason: "Need at least 2 variants to determine winner",
      significant: false,
    };
  }

  // For now, support two-variant experiments
  if (variantNames.length > 2) {
    return {
      winner: null,
      confidence: 0,
      reason: "Multi-variant experiments not yet supported for winner determination",
      significant: false,
    };
  }

  const [controlName, treatmentName] = variantNames;
  const control = aggregation.variants[controlName];
  const treatment = aggregation.variants[treatmentName];

  // Calculate significance for success rate
  const successSignificance = calculateSignificance(control, treatment);

  // Calculate significance for duration
  const durationSignificance = calculateDurationSignificance(control, treatment);

  // Determine winner based on primary metric
  let winner = null;
  let winnerReason = "";
  let confidence = 0;
  let significant = false;

  if (primaryMetric === "successRate") {
    if (!successSignificance.minSamplesReached) {
      return {
        winner: null,
        confidence: 0,
        reason: successSignificance.reason,
        significant: false,
        analysis: { successRate: successSignificance, duration: durationSignificance },
      };
    }

    if (successSignificance.significant) {
      significant = true;
      confidence = successSignificance.confidenceLevel;

      if (successSignificance.proportions.treatment > successSignificance.proportions.control) {
        winner = treatmentName;
        winnerReason = `${treatmentName} has ${successSignificance.relativeDifference}% higher success rate`;
      } else {
        winner = controlName;
        winnerReason = `${controlName} has ${-successSignificance.relativeDifference}% higher success rate`;
      }
    } else {
      winnerReason = `No significant difference (p=${successSignificance.pValue})`;
    }
  } else if (primaryMetric === "duration") {
    if (!durationSignificance.tScore) {
      return {
        winner: null,
        confidence: 0,
        reason: durationSignificance.reason,
        significant: false,
        analysis: { successRate: successSignificance, duration: durationSignificance },
      };
    }

    if (durationSignificance.significant) {
      significant = true;
      confidence = durationSignificance.confidenceLevel;

      // Lower duration is better
      if (durationSignificance.means.treatment < durationSignificance.means.control) {
        winner = treatmentName;
        winnerReason = `${treatmentName} is ${-durationSignificance.relativeDifference}% faster`;
      } else {
        winner = controlName;
        winnerReason = `${controlName} is ${durationSignificance.relativeDifference}% faster`;
      }
    } else {
      winnerReason = `No significant difference (p=${durationSignificance.pValue})`;
    }
  }

  // Check if confidence meets minimum threshold
  const meetsConfidenceThreshold = confidence >= minConfidence;

  return {
    winner: meetsConfidenceThreshold ? winner : null,
    proposedWinner: winner,
    confidence,
    minConfidence,
    meetsConfidenceThreshold,
    significant,
    reason: meetsConfidenceThreshold ? winnerReason : `Confidence ${confidence}% < required ${minConfidence}%`,
    analysis: {
      successRate: successSignificance,
      duration: durationSignificance,
    },
    sampleSizes: {
      [controlName]: control.count,
      [treatmentName]: treatment.count,
      total: control.count + treatment.count,
    },
  };
}

/**
 * Run full experiment analysis
 * @param {string} repoRoot - Repository root directory
 * @param {string} experimentName - Experiment name
 * @param {Object} options - Analysis options
 * @returns {Object} Complete analysis results
 */
function analyzeExperiment(repoRoot, experimentName, options = {}) {
  const { minConfidence = 95, prdFolder = null } = options;

  // Load experiment configuration
  const expResult = loadExperiment(repoRoot, experimentName);
  if (!expResult.success) {
    return {
      success: false,
      error: expResult.error,
      experimentName,
    };
  }

  const experiment = expResult.experiment;

  // Aggregate metrics
  let aggregation;
  if (prdFolder) {
    aggregation = aggregateExperimentMetrics(prdFolder, experimentName, { repoRoot });
  } else {
    aggregation = aggregateExperimentMetricsAcrossPRDs(repoRoot, experimentName);
  }

  if (!aggregation.success) {
    return {
      success: false,
      error: aggregation.error,
      experimentName,
      experiment,
    };
  }

  // Check minimum samples
  const totalSamples = aggregation.overall?.count || 0;
  const minSamplesReached = totalSamples >= (experiment.minSamples || 30);

  // Determine winner
  const winnerResult = determineWinner(aggregation, { minConfidence });

  // Get variant comparison
  const variantNames = Object.keys(aggregation.variants);
  let comparison = null;
  if (variantNames.length === 2) {
    comparison = compareVariants(
      aggregation.variants[variantNames[0]],
      aggregation.variants[variantNames[1]]
    );
    comparison.variantA = variantNames[0];
    comparison.variantB = variantNames[1];
  }

  // Get cost breakdown
  const costBreakdown = getExperimentCostBreakdown(aggregation);

  // Get quality signals per variant
  const qualityByVariant = {};
  for (const [name, metrics] of Object.entries(aggregation.variants)) {
    qualityByVariant[name] = getQualitySignalSummary(metrics);
  }

  return {
    success: true,
    experimentName,
    experiment,
    status: experiment.status,
    totalSamples,
    minSamples: experiment.minSamples,
    minSamplesReached,
    variants: aggregation.variants,
    variantNames,
    overall: aggregation.overall,
    winner: winnerResult,
    comparison,
    costBreakdown,
    qualityByVariant,
    analyzedAt: new Date().toISOString(),
  };
}

/**
 * Format analysis results as JSON
 * @param {Object} analysis - Analysis results from analyzeExperiment
 * @returns {string} JSON string
 */
function exportAsJSON(analysis) {
  return JSON.stringify(analysis, null, 2);
}

/**
 * Format analysis results as CSV
 * @param {Object} analysis - Analysis results from analyzeExperiment
 * @returns {string} CSV string
 */
function exportAsCSV(analysis) {
  if (!analysis.success) {
    return `error,${analysis.error}\n`;
  }

  const lines = [];

  // Header
  lines.push("metric,variant,value");

  // Per-variant metrics
  for (const [variantName, metrics] of Object.entries(analysis.variants)) {
    lines.push(`count,${variantName},${metrics.count}`);
    lines.push(`successRate,${variantName},${metrics.successRate}`);
    lines.push(`avgDuration,${variantName},${metrics.avgDuration}`);
    lines.push(`totalCost,${variantName},${metrics.totalCost}`);
    lines.push(`avgCost,${variantName},${metrics.avgCost}`);
    lines.push(`avgTokens,${variantName},${metrics.avgTokens}`);
    lines.push(`avgRetries,${variantName},${metrics.avgRetries}`);
  }

  // Overall metrics
  lines.push(`count,overall,${analysis.overall.count}`);
  lines.push(`successRate,overall,${analysis.overall.successRate}`);
  lines.push(`totalCost,overall,${analysis.overall.totalCost}`);

  // Winner info
  lines.push(`winner,result,${analysis.winner.winner || "none"}`);
  lines.push(`confidence,result,${analysis.winner.confidence}`);
  lines.push(`significant,result,${analysis.winner.significant}`);

  // Statistical significance
  if (analysis.winner.analysis?.successRate) {
    lines.push(`pValue,successRate,${analysis.winner.analysis.successRate.pValue}`);
    lines.push(`zScore,successRate,${analysis.winner.analysis.successRate.zScore}`);
  }

  return lines.join("\n");
}

/**
 * Generate ASCII bar for visualization
 * @param {number} value - Value (0-100)
 * @param {number} width - Bar width
 * @param {string} char - Bar character
 * @returns {string} ASCII bar
 */
function asciiBar(value, width = 30, char = "=") {
  const filled = Math.round((value / 100) * width);
  return char.repeat(filled) + " ".repeat(width - filled);
}

/**
 * Format analysis results for terminal display
 * @param {Object} analysis - Analysis results from analyzeExperiment
 * @returns {string} Formatted string for terminal
 */
function formatForTerminal(analysis) {
  if (!analysis.success) {
    return `Error: ${analysis.error}`;
  }

  const lines = [];
  const sep = "=".repeat(60);
  const sepLight = "-".repeat(50);

  lines.push("");
  lines.push(sep);
  lines.push(`  EXPERIMENT ANALYSIS: ${analysis.experimentName}`);
  lines.push(sep);
  lines.push("");

  // Status and samples
  lines.push(`Status:       ${analysis.status}`);
  lines.push(`Total Runs:   ${analysis.totalSamples} / ${analysis.minSamples} min samples`);
  lines.push(`Min Reached:  ${analysis.minSamplesReached ? "Yes" : "No"}`);
  lines.push("");

  // Variant comparison table
  lines.push("METRICS BY VARIANT");
  lines.push(sepLight);

  const header = "Metric".padEnd(18) + analysis.variantNames.map((n) => n.padStart(15)).join("");
  lines.push(header);
  lines.push(sepLight);

  const metrics = [
    { name: "Sample Size", key: "count", format: (v) => String(v) },
    { name: "Success Rate", key: "successRate", format: (v) => `${v}%` },
    { name: "Avg Duration", key: "avgDuration", format: (v) => `${v}ms` },
    { name: "Avg Cost", key: "avgCost", format: (v) => `$${v.toFixed(4)}` },
    { name: "Avg Tokens", key: "avgTokens", format: (v) => String(v) },
    { name: "Avg Retries", key: "avgRetries", format: (v) => v.toFixed(2) },
  ];

  for (const metric of metrics) {
    let row = metric.name.padEnd(18);
    for (const variantName of analysis.variantNames) {
      const value = analysis.variants[variantName][metric.key];
      row += metric.format(value).padStart(15);
    }
    lines.push(row);
  }
  lines.push("");

  // Visual comparison - Success Rate
  lines.push("SUCCESS RATE COMPARISON");
  lines.push(sepLight);
  for (const variantName of analysis.variantNames) {
    const rate = analysis.variants[variantName].successRate;
    const bar = asciiBar(rate, 30);
    lines.push(`${variantName.padEnd(12)} [${bar}] ${rate}%`);
  }
  lines.push("");

  // Statistical significance
  if (analysis.winner.analysis?.successRate) {
    const sig = analysis.winner.analysis.successRate;
    lines.push("STATISTICAL ANALYSIS");
    lines.push(sepLight);
    lines.push(`Z-Score:      ${sig.zScore ?? "N/A"}`);
    lines.push(`P-Value:      ${sig.pValue ?? "N/A"}`);
    lines.push(`Significant:  ${sig.significant ? "Yes (p < 0.05)" : "No"}`);
    lines.push(`Confidence:   ${analysis.winner.confidence}%`);
    lines.push("");
  }

  // Winner determination
  lines.push("WINNER");
  lines.push(sepLight);
  if (analysis.winner.winner) {
    lines.push(`  >>> ${analysis.winner.winner.toUpperCase()} <<<`);
    lines.push(`  ${analysis.winner.reason}`);
  } else if (analysis.winner.proposedWinner) {
    lines.push(`  Proposed: ${analysis.winner.proposedWinner}`);
    lines.push(`  ${analysis.winner.reason}`);
  } else {
    lines.push(`  No winner determined`);
    lines.push(`  ${analysis.winner.reason}`);
  }
  lines.push("");

  // Cost breakdown
  if (analysis.costBreakdown?.success) {
    lines.push("COST BREAKDOWN");
    lines.push(sepLight);
    lines.push(`Total Cost:     $${analysis.costBreakdown.totalCost.toFixed(4)}`);
    lines.push(`Avg Per Run:    $${analysis.costBreakdown.avgCostPerRun.toFixed(4)}`);
    for (const [variantName, cost] of Object.entries(analysis.costBreakdown.variants)) {
      lines.push(`  ${variantName}: $${cost.totalCost.toFixed(4)} (${cost.runCount} runs)`);
    }
    lines.push("");
  }

  lines.push(sep);
  lines.push(`  Analyzed at: ${analysis.analyzedAt}`);
  lines.push(sep);
  lines.push("");

  return lines.join("\n");
}

module.exports = {
  // Core statistical functions
  normalCDF,
  zToPValue,
  variance,

  // Significance tests
  calculateSignificance,
  calculateDurationSignificance,

  // Winner determination
  determineWinner,

  // Full analysis
  analyzeExperiment,

  // Export formats
  exportAsJSON,
  exportAsCSV,

  // Terminal display
  formatForTerminal,
  asciiBar,
};
