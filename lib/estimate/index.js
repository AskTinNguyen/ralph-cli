/**
 * Estimate module - main entry point
 *
 * Provides build time and cost estimation based on:
 * - Story complexity (acceptance criteria count, keywords)
 * - Historical run data (when available)
 */
const fs = require("fs");
const path = require("path");

const { parsePlan, parsePRD, getPendingStories } = require("./parser");
const { scoreComplexity, estimateBaseDuration, estimateBaseTokens, getConfidenceMultipliers } = require("./complexity");
const { formatTable, formatJSON, formatDuration, formatTokens, formatCost } = require("./formatter");

// Import token calculator for cost calculation
let tokenCalculator;
try {
  tokenCalculator = require("../tokens/calculator");
} catch {
  tokenCalculator = null;
}

/**
 * Estimate build time and cost for a PRD
 * @param {Object} options - Estimation options
 * @param {string} options.prdFolder - Path to PRD folder (containing plan.md)
 * @param {string} options.repoRoot - Repository root path (for pricing config)
 * @param {string} options.model - Model to use for cost calculation (default: 'sonnet')
 * @param {Object} options.customPricing - Custom pricing override { input, output }
 * @returns {Object} Estimation results
 */
function estimate(options = {}) {
  const { prdFolder, repoRoot, model = "sonnet", customPricing = null } = options;

  // Check for plan.md
  const planPath = path.join(prdFolder, "plan.md");
  const prdPath = path.join(prdFolder, "prd.md");

  if (!fs.existsSync(planPath)) {
    return {
      success: false,
      error: `No plan.md found in ${prdFolder}. Run \`ralph plan\` first.`,
    };
  }

  // Parse plan and PRD for story data
  const plan = parsePlan(planPath);
  const prd = fs.existsSync(prdPath) ? parsePRD(prdPath) : null;

  if (!plan || plan.stories.length === 0) {
    return {
      success: false,
      error: "No stories found in plan.md",
    };
  }

  // Get pending stories (not completed)
  const pendingStories = getPendingStories(plan);

  // Build estimates for each story
  const estimates = [];
  let totalDuration = 0;
  let totalTokens = 0;
  let totalCost = 0;

  for (const story of plan.stories) {
    // Find matching PRD story for acceptance criteria count
    let prdStory = null;
    if (prd && prd.stories) {
      prdStory = prd.stories.find((s) => s.id === story.id);
    }

    // Use PRD acceptance criteria count if available, else task count from plan
    const storyForComplexity = prdStory
      ? {
          id: story.id,
          taskCount: prdStory.acceptanceCriteriaCount || story.taskCount,
          keywords: [...(story.keywords || []), ...(prdStory.keywords || [])].filter((k, i, arr) => arr.indexOf(k) === i),
        }
      : story;

    // Calculate complexity
    const complexity = scoreComplexity(storyForComplexity);

    // Get confidence multipliers (no historical data in US-001)
    const confidenceMultipliers = getConfidenceMultipliers(0);

    // Calculate base estimates
    const baseDuration = estimateBaseDuration(complexity);
    const baseTokens = estimateBaseTokens(complexity);

    // Calculate cost
    let cost = 0;
    if (tokenCalculator) {
      // Assume 70% input, 30% output token ratio
      const inputTokens = Math.round(baseTokens * 0.7);
      const outputTokens = Math.round(baseTokens * 0.3);

      const costResult = tokenCalculator.calculateCost(
        { inputTokens, outputTokens },
        model,
        { repoRoot }
      );
      cost = costResult.totalCost;

      // Apply custom pricing if provided
      if (customPricing) {
        const inputCost = (inputTokens / 1_000_000) * customPricing.input;
        const outputCost = (outputTokens / 1_000_000) * customPricing.output;
        cost = inputCost + outputCost;
      }
    }

    // Build estimate object
    const storyEstimate = {
      storyId: story.id,
      title: story.title,
      completed: story.completed,
      taskCount: storyForComplexity.taskCount || 0,
      keywords: storyForComplexity.keywords || [],
      complexity: complexity ? complexity.finalScore : 5,
      complexityLevel: complexity ? complexity.complexityLevel : "medium",

      // Time estimates
      duration: baseDuration,
      durationOptimistic: Math.round(baseDuration * confidenceMultipliers.optimistic),
      durationPessimistic: Math.round(baseDuration * confidenceMultipliers.pessimistic),

      // Token estimates
      tokens: baseTokens,
      tokensOptimistic: Math.round(baseTokens * confidenceMultipliers.optimistic),
      tokensPessimistic: Math.round(baseTokens * confidenceMultipliers.pessimistic),

      // Cost estimates
      cost: cost,
      costOptimistic: cost * confidenceMultipliers.optimistic,
      costPessimistic: cost * confidenceMultipliers.pessimistic,

      confidence: confidenceMultipliers.confidence,
    };

    estimates.push(storyEstimate);

    // Accumulate totals for pending stories only
    if (!story.completed) {
      totalDuration += baseDuration;
      totalTokens += baseTokens;
      totalCost += cost;
    }
  }

  // Build totals
  const confidenceMultipliers = getConfidenceMultipliers(0);
  const totals = {
    stories: plan.stories.length,
    completed: plan.completedStories,
    pending: plan.pendingStories,
    duration: totalDuration,
    durationOptimistic: Math.round(totalDuration * confidenceMultipliers.optimistic),
    durationPessimistic: Math.round(totalDuration * confidenceMultipliers.pessimistic),
    tokens: totalTokens,
    tokensOptimistic: Math.round(totalTokens * confidenceMultipliers.optimistic),
    tokensPessimistic: Math.round(totalTokens * confidenceMultipliers.pessimistic),
    cost: totalCost,
    costOptimistic: totalCost * confidenceMultipliers.optimistic,
    costPessimistic: totalCost * confidenceMultipliers.pessimistic,
    confidence: confidenceMultipliers.confidence,
    model: model,
  };

  return {
    success: true,
    estimates,
    totals,
    prdFolder,
  };
}

/**
 * Format estimate results for console output
 * @param {Object} result - Result from estimate()
 * @param {Object} options - Formatting options { json: boolean }
 * @returns {string} Formatted output
 */
function formatEstimate(result, options = {}) {
  if (!result.success) {
    return result.error;
  }

  if (options.json) {
    return formatJSON(result.estimates, result.totals);
  }

  return formatTable(result.estimates, result.totals);
}

/**
 * Find the active PRD folder (highest numbered PRD-N that has plan.md)
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {Object|null} { number, folder } or null if not found
 */
function findActivePRD(ralphDir) {
  if (!fs.existsSync(ralphDir)) {
    return null;
  }

  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdFolders = entries
    .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
    .map((e) => {
      const num = parseInt(e.name.replace(/PRD-/i, ""), 10);
      return { number: num, name: e.name, folder: path.join(ralphDir, e.name) };
    })
    .filter((p) => {
      // Must have plan.md to be considered active
      return fs.existsSync(path.join(p.folder, "plan.md"));
    })
    .sort((a, b) => b.number - a.number);

  return prdFolders.length > 0 ? prdFolders[0] : null;
}

/**
 * Get PRD folder path by number
 * @param {string} ralphDir - Path to .ralph directory
 * @param {number} prdNumber - PRD number
 * @returns {string|null} PRD folder path or null
 */
function getPRDFolder(ralphDir, prdNumber) {
  const folder = path.join(ralphDir, `PRD-${prdNumber}`);
  return fs.existsSync(folder) ? folder : null;
}

module.exports = {
  estimate,
  formatEstimate,
  findActivePRD,
  getPRDFolder,
  // Re-export sub-modules
  parser: require("./parser"),
  complexity: require("./complexity"),
  formatter: require("./formatter"),
  // Convenience exports
  formatDuration,
  formatTokens,
  formatCost,
};
