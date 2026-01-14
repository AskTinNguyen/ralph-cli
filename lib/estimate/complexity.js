/**
 * Story complexity scoring for estimation
 *
 * Calculates complexity scores based on:
 * - Number of acceptance criteria/tasks
 * - Story type keywords (refactor, test, feature, fix, docs)
 */

// Keyword multipliers for different story types
const KEYWORD_MULTIPLIERS = {
  refactor: 1.5, // Refactoring is typically more complex
  test: 1.2, // Testing requires careful verification
  feature: 1.3, // New features often involve multiple components
  fix: 0.8, // Bug fixes are usually more focused
  docs: 0.5, // Documentation is typically faster
};

// Base estimates per task/criterion (in seconds)
const BASE_DURATION_PER_TASK = 120; // 2 minutes base per task
const BASE_TOKENS_PER_TASK = 5000; // 5K tokens per task

/**
 * Calculate complexity score for a story
 * @param {Object} story - Story object with tasks or acceptanceCriteria
 * @returns {Object} Complexity analysis
 */
function scoreComplexity(story) {
  if (!story) {
    return null;
  }

  // Get task/criteria count
  const taskCount = story.taskCount || story.acceptanceCriteriaCount || 0;
  const keywords = story.keywords || [];

  // Calculate keyword multiplier
  let keywordMultiplier = 1.0;
  for (const keyword of keywords) {
    if (KEYWORD_MULTIPLIERS[keyword]) {
      keywordMultiplier *= KEYWORD_MULTIPLIERS[keyword];
    }
  }

  // Cap multiplier to reasonable bounds
  keywordMultiplier = Math.min(Math.max(keywordMultiplier, 0.3), 2.5);

  // Calculate base complexity score (1-10 scale based on task count)
  // 1-2 tasks = low (1-3), 3-5 tasks = medium (4-6), 6+ tasks = high (7-10)
  let baseScore;
  if (taskCount <= 2) {
    baseScore = Math.max(1, taskCount * 1.5);
  } else if (taskCount <= 5) {
    baseScore = 3 + (taskCount - 2);
  } else {
    baseScore = Math.min(10, 6 + (taskCount - 5) * 0.5);
  }

  // Apply keyword multiplier to get final score
  const finalScore = Math.min(10, baseScore * keywordMultiplier);

  return {
    storyId: story.id,
    taskCount: taskCount,
    keywords: keywords,
    keywordMultiplier: Math.round(keywordMultiplier * 100) / 100,
    baseScore: Math.round(baseScore * 10) / 10,
    finalScore: Math.round(finalScore * 10) / 10,
    complexityLevel: getComplexityLevel(finalScore),
  };
}

/**
 * Get complexity level label from score
 * @param {number} score - Complexity score (1-10)
 * @returns {string} Complexity level label
 */
function getComplexityLevel(score) {
  if (score <= 3) return "low";
  if (score <= 6) return "medium";
  return "high";
}

/**
 * Calculate base time estimate from complexity
 * @param {Object} complexity - Complexity analysis from scoreComplexity
 * @returns {number} Estimated duration in seconds
 */
function estimateBaseDuration(complexity) {
  if (!complexity) return BASE_DURATION_PER_TASK;

  const taskCount = complexity.taskCount || 1;
  const multiplier = complexity.keywordMultiplier || 1.0;

  return Math.round(taskCount * BASE_DURATION_PER_TASK * multiplier);
}

/**
 * Calculate base token estimate from complexity
 * @param {Object} complexity - Complexity analysis from scoreComplexity
 * @returns {number} Estimated token count
 */
function estimateBaseTokens(complexity) {
  if (!complexity) return BASE_TOKENS_PER_TASK;

  const taskCount = complexity.taskCount || 1;
  const multiplier = complexity.keywordMultiplier || 1.0;

  return Math.round(taskCount * BASE_TOKENS_PER_TASK * multiplier);
}

/**
 * Get confidence range multipliers based on data availability
 * @param {number} historicalSamples - Number of historical data points
 * @returns {Object} Multipliers for optimistic/pessimistic estimates
 */
function getConfidenceMultipliers(historicalSamples = 0) {
  // With more historical data, we can narrow the range
  if (historicalSamples >= 5) {
    return {
      optimistic: 0.8,
      pessimistic: 1.3,
      confidence: "high",
    };
  } else if (historicalSamples >= 2) {
    return {
      optimistic: 0.7,
      pessimistic: 1.5,
      confidence: "medium",
    };
  } else {
    return {
      optimistic: 0.6,
      pessimistic: 1.8,
      confidence: "low",
    };
  }
}

module.exports = {
  scoreComplexity,
  getComplexityLevel,
  estimateBaseDuration,
  estimateBaseTokens,
  getConfidenceMultipliers,
  KEYWORD_MULTIPLIERS,
  BASE_DURATION_PER_TASK,
  BASE_TOKENS_PER_TASK,
};
