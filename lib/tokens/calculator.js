/**
 * Cost calculator - computes costs from token usage
 *
 * Supports:
 * - Default pricing for Claude models (Opus, Sonnet, Haiku)
 * - Prompt cache pricing (cache write and cache read)
 * - Custom pricing override via config
 * - Cost calculation per run, per story, per stream, and total
 *
 * Pricing is per 1M tokens (as of Jan 2026):
 * - Claude Opus 4.5: $15 input / $75 output
 * - Claude Sonnet 4/4.5: $3 input / $15 output
 * - Claude Haiku 3.5: $0.25 input / $1.25 output
 * - Prompt Cache Write: $3.75 (Opus), $0.75 (Sonnet), $0.0625 (Haiku)
 * - Prompt Cache Read: $1.50 (Opus), $0.30 (Sonnet), $0.025 (Haiku)
 */
const fs = require("fs");
const path = require("path");

// Default pricing per 1M tokens (in USD) - as of Jan 2026
const DEFAULT_PRICING = {
  opus: {
    input: 15.0,
    output: 75.0,
    cacheWrite: 3.75, // 25% of input cost
    cacheRead: 1.50, // 10% of input cost
  },
  sonnet: {
    input: 3.0,
    output: 15.0,
    cacheWrite: 0.75, // 25% of input cost
    cacheRead: 0.30, // 10% of input cost
  },
  haiku: {
    input: 0.25,
    output: 1.25,
    cacheWrite: 0.0625, // 25% of input cost
    cacheRead: 0.025, // 10% of input cost
  },
  // Fallback for unknown models - use Sonnet pricing as default
  default: {
    input: 3.0,
    output: 15.0,
    cacheWrite: 0.75,
    cacheRead: 0.30,
  },
  // Non-Claude models (no token cost, or unknown)
  codex: {
    input: 0.0,
    output: 0.0,
    cacheWrite: 0.0,
    cacheRead: 0.0,
  },
  droid: {
    input: 0.0,
    output: 0.0,
    cacheWrite: 0.0,
    cacheRead: 0.0,
  },
};

// Cache for loaded config
let configCache = null;
let configLastLoaded = 0;
const CONFIG_CACHE_TTL_MS = 5000; // Reload config every 5 seconds max

/**
 * Load pricing configuration from config.sh
 * @param {string} repoRoot - Root directory of the repository
 * @returns {Object|null} Pricing overrides or null if not configured
 */
function loadPricingConfig(repoRoot) {
  const now = Date.now();

  // Return cached config if still valid
  if (configCache !== null && now - configLastLoaded < CONFIG_CACHE_TTL_MS) {
    return configCache;
  }

  const configPath = path.join(repoRoot, ".agents", "ralph", "config.sh");

  if (!fs.existsSync(configPath)) {
    configCache = null;
    configLastLoaded = now;
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const pricing = {};

    // Parse pricing variables from config.sh
    // Format: CLAUDE_PRICING_INPUT=3.00 or CLAUDE_OPUS_INPUT=15.00
    const patterns = [
      // Global override (applies to default model)
      { pattern: /^CLAUDE_PRICING_INPUT\s*=\s*"?([0-9.]+)"?/m, key: "defaultInput" },
      { pattern: /^CLAUDE_PRICING_OUTPUT\s*=\s*"?([0-9.]+)"?/m, key: "defaultOutput" },
      // Per-model overrides
      { pattern: /^CLAUDE_OPUS_INPUT\s*=\s*"?([0-9.]+)"?/m, key: "opusInput" },
      { pattern: /^CLAUDE_OPUS_OUTPUT\s*=\s*"?([0-9.]+)"?/m, key: "opusOutput" },
      { pattern: /^CLAUDE_SONNET_INPUT\s*=\s*"?([0-9.]+)"?/m, key: "sonnetInput" },
      { pattern: /^CLAUDE_SONNET_OUTPUT\s*=\s*"?([0-9.]+)"?/m, key: "sonnetOutput" },
      { pattern: /^CLAUDE_HAIKU_INPUT\s*=\s*"?([0-9.]+)"?/m, key: "haikuInput" },
      { pattern: /^CLAUDE_HAIKU_OUTPUT\s*=\s*"?([0-9.]+)"?/m, key: "haikuOutput" },
      // Default model setting
      { pattern: /^CLAUDE_MODEL\s*=\s*"?(\w+)"?/m, key: "model" },
    ];

    for (const { pattern, key } of patterns) {
      const match = content.match(pattern);
      if (match) {
        pricing[key] = key === "model" ? match[1].toLowerCase() : parseFloat(match[1]);
      }
    }

    configCache = Object.keys(pricing).length > 0 ? pricing : null;
    configLastLoaded = now;
    return configCache;
  } catch {
    configCache = null;
    configLastLoaded = now;
    return null;
  }
}

/**
 * Get pricing for a specific model
 * @param {string} model - Model name (opus, sonnet, haiku)
 * @param {string} repoRoot - Root directory for config loading (optional)
 * @returns {Object} Pricing object { input, output } per 1M tokens
 */
function getPricing(model, repoRoot = null) {
  const normalizedModel = (model || "default").toLowerCase();

  // Start with default pricing for the model
  const pricing = { ...DEFAULT_PRICING[normalizedModel] } || { ...DEFAULT_PRICING.default };

  // Load config overrides if repoRoot provided
  if (repoRoot) {
    const configPricing = loadPricingConfig(repoRoot);

    if (configPricing) {
      // Apply per-model overrides
      if (normalizedModel === "opus") {
        if (configPricing.opusInput != null) pricing.input = configPricing.opusInput;
        if (configPricing.opusOutput != null) pricing.output = configPricing.opusOutput;
      } else if (normalizedModel === "sonnet") {
        if (configPricing.sonnetInput != null) pricing.input = configPricing.sonnetInput;
        if (configPricing.sonnetOutput != null) pricing.output = configPricing.sonnetOutput;
      } else if (normalizedModel === "haiku") {
        if (configPricing.haikuInput != null) pricing.input = configPricing.haikuInput;
        if (configPricing.haikuOutput != null) pricing.output = configPricing.haikuOutput;
      }

      // Apply global overrides (for unknown models or default)
      if (normalizedModel === "default" || !DEFAULT_PRICING[normalizedModel]) {
        if (configPricing.defaultInput != null) pricing.input = configPricing.defaultInput;
        if (configPricing.defaultOutput != null) pricing.output = configPricing.defaultOutput;
      }
    }
  }

  return pricing;
}

/**
 * Calculate cost for given token counts
 * @param {Object} tokens - Token counts { inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens }
 * @param {string} model - Model name (opus, sonnet, haiku, default)
 * @param {Object} options - Options { repoRoot }
 * @returns {Object} Cost breakdown { inputCost, outputCost, cacheWriteCost, cacheReadCost, totalCost }
 */
function calculateCost(tokens, model = "default", options = {}) {
  const { repoRoot = null } = options;

  const inputTokens = tokens.inputTokens || 0;
  const outputTokens = tokens.outputTokens || 0;
  const cacheCreationTokens = tokens.cacheCreationInputTokens || 0;
  const cacheReadTokens = tokens.cacheReadInputTokens || 0;

  const pricing = getPricing(model, repoRoot);

  // Calculate costs (pricing is per 1M tokens)
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const cacheWriteCost = (cacheCreationTokens / 1_000_000) * (pricing.cacheWrite || 0);
  const cacheReadCost = (cacheReadTokens / 1_000_000) * (pricing.cacheRead || 0);
  const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

  return {
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    cacheWriteCost: roundCost(cacheWriteCost),
    cacheReadCost: roundCost(cacheReadCost),
    totalCost: roundCost(totalCost),
    model: model || "default",
    pricing: {
      inputPer1M: pricing.input,
      outputPer1M: pricing.output,
      cacheWritePer1M: pricing.cacheWrite || 0,
      cacheReadPer1M: pricing.cacheRead || 0,
    },
  };
}

/**
 * Calculate cost for a run with token data
 * @param {Object} run - Run object with inputTokens, outputTokens, cacheCreationInputTokens, cacheReadInputTokens, model
 * @param {Object} options - Options { repoRoot }
 * @returns {Object} Run with cost data added
 */
function calculateRunCost(run, options = {}) {
  const cost = calculateCost(
    {
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      cacheCreationInputTokens: run.cacheCreationInputTokens,
      cacheReadInputTokens: run.cacheReadInputTokens,
    },
    run.model,
    options
  );

  return {
    ...run,
    cost: cost.totalCost,
    inputCost: cost.inputCost,
    outputCost: cost.outputCost,
    cacheWriteCost: cost.cacheWriteCost,
    cacheReadCost: cost.cacheReadCost,
  };
}

/**
 * Calculate costs for multiple runs
 * @param {Object[]} runs - Array of run objects with token data
 * @param {Object} options - Options { repoRoot }
 * @returns {Object[]} Runs with cost data added
 */
function calculateRunsCost(runs, options = {}) {
  if (!runs || !Array.isArray(runs)) {
    return [];
  }

  return runs.map((run) => calculateRunCost(run, options));
}

/**
 * Aggregate costs by story from runs with cost data
 * @param {Object[]} runs - Array of runs with cost data
 * @returns {Object} Costs grouped by story ID
 */
function aggregateCostByStory(runs) {
  if (!runs || !Array.isArray(runs)) {
    return {};
  }

  const byStory = {};

  for (const run of runs) {
    const storyId = run.storyId || "unknown";

    if (!byStory[storyId]) {
      byStory[storyId] = {
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        runs: 0,
      };
    }

    byStory[storyId].totalCost += run.cost || 0;
    byStory[storyId].inputCost += run.inputCost || 0;
    byStory[storyId].outputCost += run.outputCost || 0;
    byStory[storyId].runs++;
  }

  // Round all costs
  for (const storyId of Object.keys(byStory)) {
    byStory[storyId].totalCost = roundCost(byStory[storyId].totalCost);
    byStory[storyId].inputCost = roundCost(byStory[storyId].inputCost);
    byStory[storyId].outputCost = roundCost(byStory[storyId].outputCost);
  }

  return byStory;
}

/**
 * Aggregate costs by model from runs with cost data
 * @param {Object[]} runs - Array of runs with cost data
 * @returns {Object} Costs grouped by model
 */
function aggregateCostByModel(runs) {
  if (!runs || !Array.isArray(runs)) {
    return {};
  }

  const byModel = {};

  for (const run of runs) {
    const model = run.model || "unknown";

    if (!byModel[model]) {
      byModel[model] = {
        totalCost: 0,
        inputCost: 0,
        outputCost: 0,
        runs: 0,
      };
    }

    byModel[model].totalCost += run.cost || 0;
    byModel[model].inputCost += run.inputCost || 0;
    byModel[model].outputCost += run.outputCost || 0;
    byModel[model].runs++;
  }

  // Round all costs
  for (const model of Object.keys(byModel)) {
    byModel[model].totalCost = roundCost(byModel[model].totalCost);
    byModel[model].inputCost = roundCost(byModel[model].inputCost);
    byModel[model].outputCost = roundCost(byModel[model].outputCost);
  }

  return byModel;
}

/**
 * Calculate total costs from runs with cost data
 * @param {Object[]} runs - Array of runs with cost data
 * @returns {Object} Total cost summary
 */
function calculateTotalCost(runs) {
  if (!runs || !Array.isArray(runs) || runs.length === 0) {
    return {
      totalCost: 0,
      inputCost: 0,
      outputCost: 0,
      runCount: 0,
      avgCostPerRun: 0,
    };
  }

  let totalCost = 0;
  let inputCost = 0;
  let outputCost = 0;

  for (const run of runs) {
    totalCost += run.cost || 0;
    inputCost += run.inputCost || 0;
    outputCost += run.outputCost || 0;
  }

  return {
    totalCost: roundCost(totalCost),
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    runCount: runs.length,
    avgCostPerRun: roundCost(totalCost / runs.length),
  };
}

/**
 * Format cost as currency string
 * @param {number} cost - Cost in USD
 * @param {Object} options - Options { currency, decimals }
 * @returns {string} Formatted cost string
 */
function formatCost(cost, options = {}) {
  const { currency = "$", decimals = 4 } = options;

  if (cost == null || isNaN(cost)) {
    return `${currency}0.00`;
  }

  // Use more decimals for small amounts
  const actualDecimals = cost < 0.01 && cost > 0 ? decimals : 2;

  return `${currency}${cost.toFixed(actualDecimals)}`;
}

/**
 * Round cost to reasonable precision
 * @param {number} cost - Cost value
 * @returns {number} Rounded cost
 */
function roundCost(cost) {
  if (cost == null || isNaN(cost)) {
    return 0;
  }
  // Round to 6 decimal places to maintain precision for small costs
  return Math.round(cost * 1_000_000) / 1_000_000;
}

/**
 * Clear the config cache (for testing)
 */
function clearConfigCache() {
  configCache = null;
  configLastLoaded = 0;
}

/**
 * Calculate efficiency metrics for runs grouped by model
 *
 * Efficiency metrics help compare model performance:
 * - tokensPerRun: Average tokens consumed per run
 * - tokensPerSuccessfulRun: Average tokens per successful (completed) run
 * - costPerStory: Average cost to complete a story
 * - successRate: Percentage of runs that were successful
 *
 * @param {Object[]} runs - Array of run objects with token data and success status
 * @param {Object} options - Options { completedStories: number, successCriteria: function }
 * @returns {Object} Efficiency metrics keyed by model
 */
function calculateEfficiency(runs, options = {}) {
  if (!runs || !Array.isArray(runs) || runs.length === 0) {
    return {};
  }

  const { completedStories = 0, successCriteria } = options;

  // Default success criteria: run has a storyId and positive cost (indicates completion)
  const isSuccessful =
    successCriteria ||
    ((run) => {
      return run.storyId && run.cost > 0;
    });

  // Group runs by model
  const byModel = {};

  for (const run of runs) {
    const model = run.model || "unknown";

    if (!byModel[model]) {
      byModel[model] = {
        model,
        totalRuns: 0,
        successfulRuns: 0,
        totalTokens: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        storiesCompleted: 0,
        storyIds: new Set(),
      };
    }

    const m = byModel[model];
    m.totalRuns++;
    m.totalTokens += (run.inputTokens || 0) + (run.outputTokens || 0);
    m.totalInputTokens += run.inputTokens || 0;
    m.totalOutputTokens += run.outputTokens || 0;
    m.totalCost += run.cost || 0;

    if (isSuccessful(run)) {
      m.successfulRuns++;
      if (run.storyId) {
        m.storyIds.add(run.storyId);
      }
    }
  }

  // Calculate efficiency metrics
  const result = {};

  for (const model of Object.keys(byModel)) {
    const m = byModel[model];
    const storiesCount = m.storyIds.size;

    result[model] = {
      model,
      totalRuns: m.totalRuns,
      successfulRuns: m.successfulRuns,
      totalTokens: m.totalTokens,
      totalInputTokens: m.totalInputTokens,
      totalOutputTokens: m.totalOutputTokens,
      totalCost: roundCost(m.totalCost),
      storiesCompleted: storiesCount,

      // Efficiency metrics (lower is better for tokens/cost, higher is better for success rate)
      tokensPerRun: m.totalRuns > 0 ? Math.round(m.totalTokens / m.totalRuns) : 0,
      tokensPerSuccessfulRun:
        m.successfulRuns > 0 ? Math.round(m.totalTokens / m.successfulRuns) : 0,
      costPerRun: m.totalRuns > 0 ? roundCost(m.totalCost / m.totalRuns) : 0,
      costPerSuccessfulRun: m.successfulRuns > 0 ? roundCost(m.totalCost / m.successfulRuns) : 0,
      costPerStory: storiesCount > 0 ? roundCost(m.totalCost / storiesCount) : 0,
      successRate: m.totalRuns > 0 ? Math.round((m.successfulRuns / m.totalRuns) * 100) : 0,

      // Efficiency score (lower is better) - weighted combination of metrics
      // Formula: (tokens per story * 0.4) + (cost per story * 1000 * 0.4) + ((100 - success rate) * 100 * 0.2)
      efficiencyScore:
        storiesCount > 0 && m.successfulRuns > 0
          ? Math.round(
              (m.totalTokens / storiesCount) * 0.4 +
                (m.totalCost / storiesCount) * 1000 * 0.4 +
                (100 - (m.successfulRuns / m.totalRuns) * 100) * 100 * 0.2
            )
          : null,
    };
  }

  return result;
}

/**
 * Compare efficiency between two models
 * @param {Object} modelAMetrics - Efficiency metrics for model A
 * @param {Object} modelBMetrics - Efficiency metrics for model B
 * @returns {Object} Comparison results with recommendations
 */
function compareModelEfficiency(modelAMetrics, modelBMetrics) {
  if (!modelAMetrics || !modelBMetrics) {
    return {
      valid: false,
      reason: "Both models must have efficiency data for comparison",
    };
  }

  const comparison = {
    valid: true,
    modelA: modelAMetrics.model,
    modelB: modelBMetrics.model,
    metrics: {},
    recommendations: [],
  };

  // Compare key metrics
  const metrics = [
    { key: "tokensPerRun", label: "Tokens per Run", lowerBetter: true },
    { key: "costPerRun", label: "Cost per Run", lowerBetter: true },
    { key: "costPerStory", label: "Cost per Story", lowerBetter: true },
    { key: "successRate", label: "Success Rate", lowerBetter: false },
    { key: "efficiencyScore", label: "Efficiency Score", lowerBetter: true },
  ];

  for (const { key, label, lowerBetter } of metrics) {
    const aValue = modelAMetrics[key];
    const bValue = modelBMetrics[key];

    if (aValue == null || bValue == null) continue;

    let winner = null;
    let difference = 0;
    let percentDiff = 0;

    if (aValue !== bValue) {
      if (lowerBetter) {
        winner = aValue < bValue ? modelAMetrics.model : modelBMetrics.model;
      } else {
        winner = aValue > bValue ? modelAMetrics.model : modelBMetrics.model;
      }

      const baseValue = Math.max(aValue, bValue);
      difference = Math.abs(aValue - bValue);
      percentDiff = baseValue > 0 ? Math.round((difference / baseValue) * 100) : 0;
    }

    comparison.metrics[key] = {
      label,
      modelA: aValue,
      modelB: bValue,
      winner,
      difference,
      percentDiff,
    };
  }

  // Generate recommendations based on comparison
  const effA = modelAMetrics.efficiencyScore;
  const effB = modelBMetrics.efficiencyScore;
  const successA = modelAMetrics.successRate;
  const successB = modelBMetrics.successRate;
  const costA = modelAMetrics.costPerStory;
  const costB = modelBMetrics.costPerStory;

  if (effA != null && effB != null) {
    if (effA < effB * 0.8) {
      comparison.recommendations.push({
        type: "overall",
        message: `${modelAMetrics.model} is significantly more efficient overall (${Math.round((1 - effA / effB) * 100)}% better efficiency score)`,
        recommendedModel: modelAMetrics.model,
      });
    } else if (effB < effA * 0.8) {
      comparison.recommendations.push({
        type: "overall",
        message: `${modelBMetrics.model} is significantly more efficient overall (${Math.round((1 - effB / effA) * 100)}% better efficiency score)`,
        recommendedModel: modelBMetrics.model,
      });
    }
  }

  // Cost-focused recommendation
  if (costA > 0 && costB > 0) {
    if (costA < costB * 0.7) {
      comparison.recommendations.push({
        type: "cost",
        message: `For cost-sensitive tasks, ${modelAMetrics.model} is ${Math.round((1 - costA / costB) * 100)}% cheaper per story`,
        recommendedModel: modelAMetrics.model,
      });
    } else if (costB < costA * 0.7) {
      comparison.recommendations.push({
        type: "cost",
        message: `For cost-sensitive tasks, ${modelBMetrics.model} is ${Math.round((1 - costB / costA) * 100)}% cheaper per story`,
        recommendedModel: modelBMetrics.model,
      });
    }
  }

  // Success rate recommendation
  if (successA > 0 && successB > 0) {
    if (successA > successB + 15) {
      comparison.recommendations.push({
        type: "reliability",
        message: `For reliability-critical tasks, ${modelAMetrics.model} has ${successA - successB}% higher success rate`,
        recommendedModel: modelAMetrics.model,
      });
    } else if (successB > successA + 15) {
      comparison.recommendations.push({
        type: "reliability",
        message: `For reliability-critical tasks, ${modelBMetrics.model} has ${successB - successA}% higher success rate`,
        recommendedModel: modelBMetrics.model,
      });
    }
  }

  // Default recommendation if no clear winner
  if (comparison.recommendations.length === 0) {
    comparison.recommendations.push({
      type: "neutral",
      message: "Both models show similar efficiency. Choose based on specific requirements.",
      recommendedModel: null,
    });
  }

  return comparison;
}

/**
 * Generate model recommendations for different task types
 * @param {Object} efficiencyByModel - Efficiency metrics keyed by model
 * @returns {Object} Recommendations for different task types
 */
function generateModelRecommendations(efficiencyByModel) {
  const models = Object.keys(efficiencyByModel);

  if (models.length === 0) {
    return { hasData: false, recommendations: [] };
  }

  const recommendations = [];

  // Find best model for each criterion
  let bestCostModel = null;
  let bestCost = Infinity;
  let bestSuccessModel = null;
  let bestSuccess = -1;
  let bestEfficiencyModel = null;
  let bestEfficiency = Infinity;

  for (const model of models) {
    const metrics = efficiencyByModel[model];

    // Skip models with no meaningful data
    if (metrics.totalRuns < 2) continue;

    if (metrics.costPerStory > 0 && metrics.costPerStory < bestCost) {
      bestCost = metrics.costPerStory;
      bestCostModel = model;
    }

    if (metrics.successRate > bestSuccess) {
      bestSuccess = metrics.successRate;
      bestSuccessModel = model;
    }

    if (metrics.efficiencyScore != null && metrics.efficiencyScore < bestEfficiency) {
      bestEfficiency = metrics.efficiencyScore;
      bestEfficiencyModel = model;
    }
  }

  // Generate recommendations
  if (bestEfficiencyModel) {
    recommendations.push({
      taskType: "general",
      description: "Best overall efficiency for typical development tasks",
      recommendedModel: bestEfficiencyModel,
      reason: `${bestEfficiencyModel} has the best balance of cost, token usage, and success rate`,
      confidence: bestEfficiency < 50000 ? "high" : "medium",
    });
  }

  if (bestCostModel && bestCostModel !== bestEfficiencyModel) {
    recommendations.push({
      taskType: "cost-sensitive",
      description: "Budget-conscious development with cost as primary concern",
      recommendedModel: bestCostModel,
      reason: `${bestCostModel} achieves the lowest cost per completed story ($${bestCost.toFixed(4)})`,
      confidence: bestCost < 1 ? "high" : "medium",
    });
  }

  if (bestSuccessModel && bestSuccessModel !== bestEfficiencyModel) {
    recommendations.push({
      taskType: "reliability-critical",
      description: "Tasks where completion success is critical",
      recommendedModel: bestSuccessModel,
      reason: `${bestSuccessModel} has the highest success rate (${bestSuccess}%)`,
      confidence: bestSuccess > 80 ? "high" : "medium",
    });
  }

  // Add specific task type recommendations based on model characteristics
  const hasOpus = efficiencyByModel.opus != null;
  const hasSonnet = efficiencyByModel.sonnet != null;
  const hasHaiku = efficiencyByModel.haiku != null;

  if (hasOpus && efficiencyByModel.opus.totalRuns >= 2) {
    recommendations.push({
      taskType: "complex-tasks",
      description: "Complex multi-file refactoring or architecture changes",
      recommendedModel: "opus",
      reason: "Opus excels at complex reasoning and large codebase understanding",
      confidence: "high",
    });
  }

  if (hasSonnet && efficiencyByModel.sonnet.totalRuns >= 2) {
    recommendations.push({
      taskType: "standard-development",
      description: "Standard feature implementation and bug fixes",
      recommendedModel: "sonnet",
      reason: "Sonnet provides a good balance of capability and cost for most tasks",
      confidence: "high",
    });
  }

  if (hasHaiku && efficiencyByModel.haiku.totalRuns >= 2) {
    recommendations.push({
      taskType: "simple-tasks",
      description: "Simple fixes, documentation updates, or straightforward changes",
      recommendedModel: "haiku",
      reason: "Haiku offers the best cost efficiency for simpler tasks",
      confidence: "high",
    });
  }

  return {
    hasData: recommendations.length > 0,
    recommendations,
    bestOverall: bestEfficiencyModel,
    bestCost: bestCostModel,
    bestSuccess: bestSuccessModel,
  };
}

/**
 * Get default pricing table (for reference/display)
 * @returns {Object} Default pricing table
 */
function getDefaultPricing() {
  return { ...DEFAULT_PRICING };
}

module.exports = {
  calculateCost,
  calculateRunCost,
  calculateRunsCost,
  aggregateCostByStory,
  aggregateCostByModel,
  calculateTotalCost,
  formatCost,
  roundCost,
  getPricing,
  loadPricingConfig,
  getDefaultPricing,
  clearConfigCache,
  calculateEfficiency,
  compareModelEfficiency,
  generateModelRecommendations,
  DEFAULT_PRICING,
};
