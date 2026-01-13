/**
 * Cost calculator - computes costs from token usage
 *
 * Supports:
 * - Default pricing for Claude models (Opus, Sonnet, Haiku)
 * - Custom pricing override via config
 * - Cost calculation per run, per story, per stream, and total
 *
 * Pricing is per 1M tokens (as of 2025):
 * - Claude Opus: $15 input / $75 output
 * - Claude Sonnet: $3 input / $15 output
 * - Claude Haiku: $0.25 input / $1.25 output
 */
const fs = require("fs");
const path = require("path");

// Default pricing per 1M tokens (in USD)
const DEFAULT_PRICING = {
  opus: {
    input: 15.0,
    output: 75.0,
  },
  sonnet: {
    input: 3.0,
    output: 15.0,
  },
  haiku: {
    input: 0.25,
    output: 1.25,
  },
  // Fallback for unknown models - use Sonnet pricing as default
  default: {
    input: 3.0,
    output: 15.0,
  },
  // Non-Claude models (no token cost, or unknown)
  codex: {
    input: 0.0,
    output: 0.0,
  },
  droid: {
    input: 0.0,
    output: 0.0,
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
  let pricing = { ...DEFAULT_PRICING[normalizedModel] } || { ...DEFAULT_PRICING.default };

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
 * @param {Object} tokens - Token counts { inputTokens, outputTokens }
 * @param {string} model - Model name (opus, sonnet, haiku, default)
 * @param {Object} options - Options { repoRoot }
 * @returns {Object} Cost breakdown { inputCost, outputCost, totalCost }
 */
function calculateCost(tokens, model = "default", options = {}) {
  const { repoRoot = null } = options;

  const inputTokens = tokens.inputTokens || 0;
  const outputTokens = tokens.outputTokens || 0;

  const pricing = getPricing(model, repoRoot);

  // Calculate costs (pricing is per 1M tokens)
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  const totalCost = inputCost + outputCost;

  return {
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    totalCost: roundCost(totalCost),
    model: model || "default",
    pricing: {
      inputPer1M: pricing.input,
      outputPer1M: pricing.output,
    },
  };
}

/**
 * Calculate cost for a run with token data
 * @param {Object} run - Run object with inputTokens, outputTokens, model
 * @param {Object} options - Options { repoRoot }
 * @returns {Object} Run with cost data added
 */
function calculateRunCost(run, options = {}) {
  const cost = calculateCost(
    { inputTokens: run.inputTokens, outputTokens: run.outputTokens },
    run.model,
    options
  );

  return {
    ...run,
    cost: cost.totalCost,
    inputCost: cost.inputCost,
    outputCost: cost.outputCost,
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
  DEFAULT_PRICING,
};
