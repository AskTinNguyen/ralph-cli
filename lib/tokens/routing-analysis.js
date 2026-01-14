/**
 * Routing analysis module - learns from routing outcomes (US-004)
 *
 * Analyzes historical metrics to:
 * - Track success rate by model/complexity combination
 * - Identify patterns in routing failures
 * - Suggest routing threshold adjustments
 * - Generate guardrail entries from learnings
 */
const fs = require("fs");
const path = require("path");

/**
 * Complexity range definitions
 */
const COMPLEXITY_RANGES = [
  { name: "low", min: 1, max: 3 },
  { name: "medium", min: 4, max: 7 },
  { name: "high", min: 8, max: 10 },
];

/**
 * Model names
 */
const MODELS = ["haiku", "sonnet", "opus"];

/**
 * Get complexity range name for a score
 * @param {number} score - Complexity score (1-10)
 * @returns {string} Range name (low, medium, high)
 */
function getComplexityRange(score) {
  if (score == null) return "unknown";
  for (const range of COMPLEXITY_RANGES) {
    if (score >= range.min && score <= range.max) {
      return range.name;
    }
  }
  return "unknown";
}

/**
 * Analyze routing outcomes from metrics
 * @param {Object[]} metrics - Array of metric records with complexityScore and model
 * @returns {Object} Analysis results with success rates and patterns
 */
function analyzeRoutingOutcomes(metrics) {
  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return {
      hasData: false,
      message: "No metrics data available for routing analysis",
      successRates: {},
      patterns: [],
      recommendations: [],
    };
  }

  // Filter metrics with routing data
  const routingMetrics = metrics.filter(
    (m) => m.complexityScore != null && m.model != null
  );

  if (routingMetrics.length === 0) {
    return {
      hasData: false,
      message: "No routing data available. Run builds with model routing enabled.",
      successRates: {},
      patterns: [],
      recommendations: [],
    };
  }

  // Calculate success rates by model/complexity combination
  const successRates = calculateSuccessRates(routingMetrics);

  // Identify patterns in failures
  const patterns = identifyFailurePatterns(routingMetrics, successRates);

  // Generate recommendations based on analysis
  const recommendations = generateRecommendations(successRates, patterns);

  return {
    hasData: true,
    totalSamples: routingMetrics.length,
    successRates,
    patterns,
    recommendations,
    summary: generateSummary(successRates),
  };
}

/**
 * Calculate success rates by model/complexity combination
 * @param {Object[]} metrics - Filtered metrics with routing data
 * @returns {Object} Success rates organized by model and complexity
 */
function calculateSuccessRates(metrics) {
  const rates = {};

  // Initialize structure
  for (const model of MODELS) {
    rates[model] = {
      overall: { total: 0, success: 0, rate: null },
      byRange: {},
    };
    for (const range of COMPLEXITY_RANGES) {
      rates[model].byRange[range.name] = { total: 0, success: 0, rate: null };
    }
  }

  // Aggregate metrics
  for (const m of metrics) {
    const model = m.model?.toLowerCase();
    if (!rates[model]) continue;

    const range = getComplexityRange(m.complexityScore);
    const isSuccess = m.status === "success";

    // Update overall model stats
    rates[model].overall.total++;
    if (isSuccess) rates[model].overall.success++;

    // Update range-specific stats
    if (rates[model].byRange[range]) {
      rates[model].byRange[range].total++;
      if (isSuccess) rates[model].byRange[range].success++;
    }
  }

  // Calculate rates
  for (const model of MODELS) {
    const overall = rates[model].overall;
    if (overall.total > 0) {
      overall.rate = Math.round((overall.success / overall.total) * 100);
    }

    for (const range of COMPLEXITY_RANGES) {
      const rangeData = rates[model].byRange[range.name];
      if (rangeData.total > 0) {
        rangeData.rate = Math.round((rangeData.success / rangeData.total) * 100);
      }
    }
  }

  return rates;
}

/**
 * Identify patterns in routing failures
 * @param {Object[]} metrics - Filtered metrics with routing data
 * @param {Object} successRates - Calculated success rates
 * @returns {Object[]} Array of identified patterns
 */
function identifyFailurePatterns(metrics, successRates) {
  const patterns = [];

  // Pattern: Model underperforming at specific complexity
  for (const model of MODELS) {
    const modelRates = successRates[model];
    if (!modelRates || modelRates.overall.total < 3) continue;

    for (const range of COMPLEXITY_RANGES) {
      const rangeData = modelRates.byRange[range.name];
      if (rangeData.total < 2) continue;

      // Flag if failure rate > 30%
      if (rangeData.rate != null && rangeData.rate < 70) {
        patterns.push({
          type: "high_failure_rate",
          model,
          complexityRange: range.name,
          rate: rangeData.rate,
          samples: rangeData.total,
          description: `${model} has ${100 - rangeData.rate}% failure rate at ${range.name} complexity`,
          severity: rangeData.rate < 50 ? "high" : "medium",
        });
      }
    }
  }

  // Pattern: Model used outside optimal range
  const expectedRanges = {
    haiku: "low",
    sonnet: "medium",
    opus: "high",
  };

  for (const model of MODELS) {
    const modelRates = successRates[model];
    if (!modelRates) continue;

    const expected = expectedRanges[model];
    for (const range of COMPLEXITY_RANGES) {
      if (range.name === expected) continue;

      const rangeData = modelRates.byRange[range.name];
      if (rangeData.total > 0) {
        // Check if model is being used outside its expected range with failures
        if (rangeData.rate != null && rangeData.rate < 80) {
          patterns.push({
            type: "misrouted",
            model,
            actualRange: range.name,
            expectedRange: expected,
            rate: rangeData.rate,
            samples: rangeData.total,
            description: `${model} used for ${range.name} complexity tasks (expected: ${expected})`,
            severity: rangeData.rate < 60 ? "high" : "low",
          });
        }
      }
    }
  }

  // Sort by severity
  patterns.sort((a, b) => {
    const severityOrder = { high: 0, medium: 1, low: 2 };
    return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
  });

  return patterns;
}

/**
 * Generate routing recommendations based on analysis
 * @param {Object} successRates - Calculated success rates
 * @param {Object[]} patterns - Identified patterns
 * @returns {Object[]} Array of recommendations
 */
function generateRecommendations(successRates, patterns) {
  const recommendations = [];

  // Recommend threshold adjustments based on success rates
  for (const pattern of patterns) {
    if (pattern.type === "high_failure_rate") {
      if (pattern.model === "haiku" && pattern.complexityRange === "low") {
        // Haiku struggling with "low" complexity - maybe threshold too high
        recommendations.push({
          type: "lower_threshold",
          target: "RALPH_HAIKU_MAX_COMPLEXITY",
          currentExpected: 3,
          suggested: 2,
          reason: `Haiku has ${100 - pattern.rate}% failure rate at low complexity. Consider lowering threshold.`,
          impact: "More tasks will route to Sonnet, increasing cost but improving success rate.",
        });
      } else if (pattern.model === "sonnet" && pattern.complexityRange === "medium") {
        // Sonnet struggling at medium - consider routing more to Opus
        recommendations.push({
          type: "lower_threshold",
          target: "RALPH_SONNET_MAX_COMPLEXITY",
          currentExpected: 7,
          suggested: 6,
          reason: `Sonnet has ${100 - pattern.rate}% failure rate at medium complexity. Consider lowering threshold.`,
          impact: "More tasks will route to Opus, increasing cost but improving success rate.",
        });
      }
    }

    if (pattern.type === "misrouted" && pattern.severity === "high") {
      recommendations.push({
        type: "routing_correction",
        issue: `${pattern.model} is being used for ${pattern.actualRange} complexity tasks`,
        suggestion: `Consider using ${getRecommendedModel(pattern.actualRange)} for these tasks`,
        reason: pattern.description,
        impact: "Better model-task matching should improve success rate.",
      });
    }
  }

  // Check for models with excellent performance that could handle more
  for (const model of MODELS) {
    const modelRates = successRates[model];
    if (!modelRates) continue;

    for (const range of COMPLEXITY_RANGES) {
      const rangeData = modelRates.byRange[range.name];
      if (rangeData.total >= 5 && rangeData.rate === 100) {
        // Model has 100% success rate with sufficient samples
        const nextRange = getNextComplexityRange(range.name);
        if (nextRange) {
          recommendations.push({
            type: "expand_range",
            model,
            currentRange: range.name,
            suggestedRange: nextRange,
            reason: `${model} has 100% success rate at ${range.name} complexity (${rangeData.total} samples). Could potentially handle more complex tasks.`,
            impact: "Cost reduction by routing more tasks to lower-cost model.",
            confidence: rangeData.total >= 10 ? "high" : "medium",
          });
        }
      }
    }
  }

  return recommendations;
}

/**
 * Get recommended model for complexity range
 * @param {string} range - Complexity range
 * @returns {string} Recommended model
 */
function getRecommendedModel(range) {
  switch (range) {
    case "low":
      return "haiku";
    case "medium":
      return "sonnet";
    case "high":
      return "opus";
    default:
      return "sonnet";
  }
}

/**
 * Get next complexity range (for expansion suggestions)
 * @param {string} range - Current range
 * @returns {string|null} Next range or null
 */
function getNextComplexityRange(range) {
  const order = ["low", "medium", "high"];
  const idx = order.indexOf(range);
  if (idx >= 0 && idx < order.length - 1) {
    return order[idx + 1];
  }
  return null;
}

/**
 * Generate summary statistics
 * @param {Object} successRates - Calculated success rates
 * @returns {Object} Summary object
 */
function generateSummary(successRates) {
  const summary = {
    bestPerforming: null,
    worstPerforming: null,
    overallRate: null,
    modelComparison: [],
  };

  let totalSuccess = 0;
  let totalRuns = 0;

  for (const model of MODELS) {
    const modelRates = successRates[model];
    if (!modelRates || modelRates.overall.total === 0) continue;

    totalSuccess += modelRates.overall.success;
    totalRuns += modelRates.overall.total;

    summary.modelComparison.push({
      model,
      rate: modelRates.overall.rate,
      samples: modelRates.overall.total,
    });
  }

  if (totalRuns > 0) {
    summary.overallRate = Math.round((totalSuccess / totalRuns) * 100);
  }

  // Sort by rate descending
  summary.modelComparison.sort((a, b) => (b.rate || 0) - (a.rate || 0));

  if (summary.modelComparison.length > 0) {
    summary.bestPerforming = summary.modelComparison[0];
    summary.worstPerforming = summary.modelComparison[summary.modelComparison.length - 1];
  }

  return summary;
}

/**
 * Generate guardrail entry from routing analysis
 * @param {Object} analysis - Routing analysis result
 * @returns {Object|null} Guardrail entry or null if no actionable insights
 */
function generateGuardrailEntry(analysis) {
  if (!analysis.hasData || analysis.patterns.length === 0) {
    return null;
  }

  const highSeverityPatterns = analysis.patterns.filter((p) => p.severity === "high");
  if (highSeverityPatterns.length === 0) {
    return null;
  }

  const pattern = highSeverityPatterns[0];
  const date = new Date().toISOString().split("T")[0];

  return {
    title: `Use ${getRecommendedModel(pattern.complexityRange || "medium")} for ${pattern.complexityRange || "medium"} complexity tasks`,
    trigger: `Routing decisions for ${pattern.complexityRange || "medium"} complexity stories`,
    instruction: `${pattern.model} has ${100 - pattern.rate}% failure rate at this complexity level. Route to ${getRecommendedModel(pattern.complexityRange || "medium")} instead.`,
    addedAfter: `Routing analysis on ${date} - ${analysis.totalSamples} samples analyzed`,
    source: "routing-analysis",
    severity: pattern.severity,
    metrics: {
      model: pattern.model,
      range: pattern.complexityRange,
      failureRate: 100 - pattern.rate,
      samples: pattern.samples,
    },
  };
}

/**
 * Format analysis results for CLI display
 * @param {Object} analysis - Routing analysis results
 * @returns {string} Formatted string
 */
function formatAnalysis(analysis) {
  if (!analysis.hasData) {
    return analysis.message;
  }

  const lines = [];

  // Summary
  lines.push("=== Routing Analysis Summary ===");
  lines.push(`Total samples: ${analysis.totalSamples}`);
  if (analysis.summary.overallRate != null) {
    lines.push(`Overall success rate: ${analysis.summary.overallRate}%`);
  }
  lines.push("");

  // Model comparison
  lines.push("=== Model Performance ===");
  for (const entry of analysis.summary.modelComparison) {
    lines.push(`  ${entry.model.padEnd(10)} ${entry.rate}% (${entry.samples} samples)`);
  }
  lines.push("");

  // Success rates by model/complexity
  lines.push("=== Success Rates by Model/Complexity ===");
  for (const model of MODELS) {
    const rates = analysis.successRates[model];
    if (!rates || rates.overall.total === 0) continue;

    lines.push(`${model}:`);
    for (const range of COMPLEXITY_RANGES) {
      const rangeData = rates.byRange[range.name];
      if (rangeData.total > 0) {
        const rateStr = rangeData.rate != null ? `${rangeData.rate}%` : "N/A";
        lines.push(`  ${range.name.padEnd(10)} ${rateStr.padStart(4)} (${rangeData.total} samples)`);
      }
    }
  }
  lines.push("");

  // Patterns
  if (analysis.patterns.length > 0) {
    lines.push("=== Identified Patterns ===");
    for (const pattern of analysis.patterns) {
      const icon = pattern.severity === "high" ? "❌" : pattern.severity === "medium" ? "⚠️" : "ℹ️";
      lines.push(`${icon} ${pattern.description}`);
    }
    lines.push("");
  }

  // Recommendations
  if (analysis.recommendations.length > 0) {
    lines.push("=== Recommendations ===");
    for (const rec of analysis.recommendations) {
      lines.push(`→ ${rec.reason}`);
      if (rec.impact) {
        lines.push(`  Impact: ${rec.impact}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Format analysis as JSON for CLI output
 * @param {Object} analysis - Routing analysis results
 * @returns {string} JSON string
 */
function formatAnalysisJSON(analysis) {
  return JSON.stringify(analysis, null, 2);
}

/**
 * Append guardrail entry to guardrails.md
 * @param {string} guardrailsPath - Path to guardrails.md
 * @param {Object} entry - Guardrail entry from generateGuardrailEntry
 * @returns {Object} Result { success, error? }
 */
function appendGuardrail(guardrailsPath, entry) {
  if (!entry) {
    return { success: false, error: "No guardrail entry provided" };
  }

  try {
    let content = "";
    if (fs.existsSync(guardrailsPath)) {
      content = fs.readFileSync(guardrailsPath, "utf-8");
    } else {
      // Create basic structure if file doesn't exist
      content = "# Guardrails (Signs)\n\n> Lessons learned from failures. Read before acting.\n\n## Learned Signs\n\n";
    }

    // Check if similar guardrail already exists
    if (content.includes(entry.title)) {
      return { success: false, error: "Similar guardrail already exists" };
    }

    // Format guardrail entry
    const entryText = `### Sign: ${entry.title}
- **Trigger**: ${entry.trigger}
- **Instruction**: ${entry.instruction}
- **Added after**: ${entry.addedAfter}

`;

    // Find "## Learned Signs" section and append
    const learnedSignsIdx = content.indexOf("## Learned Signs");
    if (learnedSignsIdx >= 0) {
      // Find the next section or end of file
      const nextSectionIdx = content.indexOf("\n## ", learnedSignsIdx + 1);
      const insertIdx = nextSectionIdx >= 0 ? nextSectionIdx : content.length;

      content = content.slice(0, insertIdx) + "\n" + entryText + content.slice(insertIdx);
    } else {
      // Append at end
      content += "\n## Learned Signs\n\n" + entryText;
    }

    fs.writeFileSync(guardrailsPath, content, "utf-8");
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = {
  analyzeRoutingOutcomes,
  calculateSuccessRates,
  identifyFailurePatterns,
  generateRecommendations,
  generateGuardrailEntry,
  generateSummary,
  getComplexityRange,
  formatAnalysis,
  formatAnalysisJSON,
  appendGuardrail,
  COMPLEXITY_RANGES,
  MODELS,
};

// CLI mode when run directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--help")) {
    console.log("Usage: node routing-analysis.js [options]");
    console.log("");
    console.log("Options:");
    console.log("  --prd <path>     Path to PRD folder to analyze");
    console.log("  --json           Output as JSON");
    console.log("  --help           Show this help");
    process.exit(0);
  }

  const prdIdx = args.indexOf("--prd");
  const prdFolder = prdIdx >= 0 ? args[prdIdx + 1] : null;
  const jsonOutput = args.includes("--json");

  if (!prdFolder) {
    console.error("Error: --prd <path> is required");
    process.exit(1);
  }

  try {
    const { loadMetrics } = require("../estimate/metrics");
    const result = loadMetrics(prdFolder);

    if (!result.success) {
      console.error("Error loading metrics:", result.error);
      process.exit(1);
    }

    const analysis = analyzeRoutingOutcomes(result.metrics);

    if (jsonOutput) {
      console.log(formatAnalysisJSON(analysis));
    } else {
      console.log(formatAnalysis(analysis));
    }
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
