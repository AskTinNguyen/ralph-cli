#!/usr/bin/env node
/**
 * CLI wrapper for cost estimation before execution
 * Used by loop.sh to estimate costs before running agent
 *
 * Usage:
 *   node estimator-cli.js --model <model> [--complexity <score>] [--repo-root <path>]
 *
 * Output: JSON with cost estimate
 */

const path = require("path");
const calculator = require("./calculator");
const complexity = require("../estimate/complexity");

// Default token estimates based on complexity (conservative estimates)
const TOKEN_ESTIMATES = {
  // Base tokens for different complexity levels
  low: { input: 8000, output: 4000 },     // Complexity 1-3
  medium: { input: 15000, output: 8000 }, // Complexity 4-7
  high: { input: 30000, output: 15000 },  // Complexity 8-10
};

// Token multipliers for different models (higher capability = potentially more tokens)
const MODEL_TOKEN_MULTIPLIERS = {
  haiku: 0.8,   // Haiku tends to be more concise
  sonnet: 1.0,  // Sonnet is baseline
  opus: 1.2,    // Opus may use more tokens for complex reasoning
};

/**
 * Estimate tokens based on complexity score
 * @param {number} complexityScore - Complexity score (1-10)
 * @param {string} model - Model name (haiku, sonnet, opus)
 * @returns {Object} Estimated tokens { input, output }
 */
function estimateTokens(complexityScore, model) {
  const score = complexityScore || 5; // Default to medium complexity
  const modelMultiplier = MODEL_TOKEN_MULTIPLIERS[model] || 1.0;

  let baseTokens;
  if (score <= 3) {
    baseTokens = TOKEN_ESTIMATES.low;
  } else if (score <= 7) {
    baseTokens = TOKEN_ESTIMATES.medium;
  } else {
    baseTokens = TOKEN_ESTIMATES.high;
  }

  return {
    input: Math.round(baseTokens.input * modelMultiplier),
    output: Math.round(baseTokens.output * modelMultiplier),
  };
}

/**
 * Calculate cost range based on uncertainty
 * @param {number} estimatedCost - Estimated cost
 * @returns {Object} Cost range { min, max, rangeStr }
 */
function calculateCostRange(estimatedCost) {
  // Cost range based on uncertainty (typically 50-150% of estimate)
  const min = estimatedCost * 0.5;
  const max = estimatedCost * 1.5;

  return {
    min: calculator.roundCost(min),
    max: calculator.roundCost(max),
    rangeStr: `$${calculator.formatCost(min, { currency: "" })}-${calculator.formatCost(max, { currency: "" })}`,
  };
}

/**
 * Generate cost comparison with other models
 * @param {number} estimatedCost - Estimated cost for selected model
 * @param {string} selectedModel - Selected model name
 * @param {Object} tokens - Estimated tokens { input, output }
 * @param {string} repoRoot - Repository root for config
 * @returns {string} Comparison string
 */
function generateComparison(estimatedCost, selectedModel, tokens, repoRoot) {
  const models = ["haiku", "sonnet", "opus"];
  const comparisons = [];

  for (const model of models) {
    if (model === selectedModel) continue;

    // Adjust tokens for model comparison
    const modelMultiplier = MODEL_TOKEN_MULTIPLIERS[model] || 1.0;
    const selectedMultiplier = MODEL_TOKEN_MULTIPLIERS[selectedModel] || 1.0;
    const adjustedTokens = {
      inputTokens: Math.round(tokens.input * modelMultiplier / selectedMultiplier),
      outputTokens: Math.round(tokens.output * modelMultiplier / selectedMultiplier),
    };

    const cost = calculator.calculateCost(adjustedTokens, model, { repoRoot });

    // Only show comparison if there's a significant difference
    if (cost.totalCost > estimatedCost * 1.5 || cost.totalCost < estimatedCost * 0.5) {
      comparisons.push(`${calculator.formatCost(cost.totalCost)} if using ${model}`);
    }
  }

  if (comparisons.length === 0) return null;

  // Return most relevant comparison (usually the most expensive alternative)
  return `vs ${comparisons[comparisons.length - 1]}`;
}

function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let model = "sonnet";
  let complexityScore = null;
  let repoRoot = process.cwd();

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--model" || arg === "-m") {
      model = (args[++i] || "sonnet").toLowerCase();
    } else if (arg === "--complexity" || arg === "-c") {
      complexityScore = parseFloat(args[++i]);
    } else if (arg === "--repo-root" || arg === "-r") {
      repoRoot = args[++i];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Cost Estimator CLI

Usage:
  node estimator-cli.js --model <model> [--complexity <score>] [--repo-root <path>]

Options:
  --model, -m       Model name (haiku, sonnet, opus)
  --complexity, -c  Complexity score (1-10)
  --repo-root, -r   Repository root for config loading (default: cwd)
  --help, -h        Show this help

Output: JSON object with cost estimate

Examples:
  # Estimate cost for sonnet with complexity 5
  node estimator-cli.js --model sonnet --complexity 5

  # Estimate cost for opus (high complexity default)
  node estimator-cli.js --model opus --complexity 8
`);
      process.exit(0);
    }
  }

  // Estimate tokens based on complexity
  const tokens = estimateTokens(complexityScore, model);
  const totalTokens = tokens.input + tokens.output;

  // Calculate cost
  const cost = calculator.calculateCost(
    { inputTokens: tokens.input, outputTokens: tokens.output },
    model,
    { repoRoot }
  );

  // Calculate cost range
  const range = calculateCostRange(cost.totalCost);

  // Generate comparison
  const comparison = generateComparison(cost.totalCost, model, tokens, repoRoot);

  // Format output
  const result = {
    model,
    complexity: complexityScore,
    estimatedTokens: totalTokens,
    tokenBreakdown: tokens,
    estimatedCost: cost.totalCost.toFixed(4),
    costRange: range.rangeStr,
    comparison,
    pricing: cost.pricing,
  };

  console.log(JSON.stringify(result));
}

main();
