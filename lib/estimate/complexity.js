/**
 * Story complexity scoring for estimation
 *
 * Calculates complexity scores based on:
 * - Number of acceptance criteria/tasks
 * - Story type keywords (refactor, test, feature, fix, docs)
 * - Story text analysis (depth, signals)
 * - File scope estimation
 */

// Complexity signal keywords and their weights
const COMPLEXITY_SIGNALS = {
  // High complexity signals (add 1-2 points)
  "architecture": 2.0,
  "refactor": 1.5,
  "new system": 2.0,
  "migration": 1.8,
  "rewrite": 1.8,
  "security": 1.5,
  "performance": 1.3,
  "integration": 1.3,
  "database": 1.3,
  "api design": 1.5,
  // Medium complexity signals (add 0.5-1 point)
  "multiple components": 1.0,
  "cross-cutting": 1.0,
  "testing": 0.8,
  "validation": 0.6,
  "error handling": 0.6,
  // Low complexity signals (add 0-0.5 points)
  "update": 0.3,
  "modify": 0.3,
  "add": 0.2,
  "remove": 0.2,
  "fix": -0.2, // Reduces complexity slightly
  "typo": -0.3,
  "documentation": -0.3,
  "comment": -0.3,
};

// File scope keywords for estimation
const SCOPE_KEYWORDS = {
  wide: ["all files", "codebase-wide", "entire project", "across the", "throughout", "every file", "global"],
  multi: ["multiple files", "several files", "multiple components", "various", "different modules", "all components"],
  single: ["single file", "one file", "this file", "only in", "just the"],
};

// Keyword multipliers for different story types
const KEYWORD_MULTIPLIERS = {
  refactor: 1.5,   // Refactoring is typically more complex
  test: 1.2,       // Testing requires careful verification
  feature: 1.3,    // New features often involve multiple components
  fix: 0.8,        // Bug fixes are usually more focused
  docs: 0.5,       // Documentation is typically faster
};

// Base estimates per task/criterion (in seconds)
const BASE_DURATION_PER_TASK = 120;  // 2 minutes base per task
const BASE_TOKENS_PER_TASK = 5000;   // 5K tokens per task

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

/**
 * Analyze story text for complexity signals
 * @param {string} storyText - Full story text including title, description, and criteria
 * @returns {Object} Text analysis results
 */
function analyzeStoryText(storyText) {
  if (!storyText || typeof storyText !== "string") {
    return {
      wordCount: 0,
      sentenceCount: 0,
      signalScore: 0,
      detectedSignals: [],
      textDepthScore: 0,
    };
  }

  const text = storyText.toLowerCase();

  // Count words and sentences
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  const sentenceCount = sentences.length;

  // Detect complexity signals
  const detectedSignals = [];
  let signalScore = 0;

  for (const [signal, weight] of Object.entries(COMPLEXITY_SIGNALS)) {
    if (text.includes(signal)) {
      detectedSignals.push({ signal, weight });
      signalScore += weight;
    }
  }

  // Calculate text depth score (0-3 points based on content richness)
  // Short stories (< 50 words) = low depth, medium (50-150) = medium, long (> 150) = high
  let textDepthScore;
  if (wordCount < 50) {
    textDepthScore = 1;
  } else if (wordCount < 150) {
    textDepthScore = 2;
  } else {
    textDepthScore = 3;
  }

  return {
    wordCount,
    sentenceCount,
    signalScore: Math.round(signalScore * 10) / 10,
    detectedSignals,
    textDepthScore,
  };
}

/**
 * Estimate file scope from story text
 * @param {string} storyText - Full story text
 * @returns {Object} File scope estimation
 */
function estimateFileScope(storyText) {
  if (!storyText || typeof storyText !== "string") {
    return {
      scope: "single",
      estimatedFileCount: 1,
      fileScopeScore: 1,
      detectedFiles: [],
      scopeIndicators: [],
    };
  }

  const text = storyText.toLowerCase();

  // Detect explicit file mentions (e.g., paths in backticks or .js/.ts extensions)
  const filePatterns = [
    /`([^`]+\.(js|ts|jsx|tsx|css|html|json|md|sh))`/gi, // Files in backticks
    /(?:modify|update|edit|create|change|add to)\s+[`"]?([a-zA-Z0-9_/-]+\.(js|ts|jsx|tsx|css|html|json|md|sh))[`"]?/gi, // Action + file
    /(?:in|file)\s+[`"]?([a-zA-Z0-9_/-]+\.(js|ts|jsx|tsx|css|html|json|md|sh))[`"]?/gi, // "in" file references
  ];

  const detectedFiles = new Set();
  for (const pattern of filePatterns) {
    const matches = storyText.matchAll(pattern);
    for (const match of matches) {
      detectedFiles.add(match[1]);
    }
  }

  // Detect scope keywords
  const scopeIndicators = [];
  let detectedScope = "single";

  // Check for wide scope
  for (const keyword of SCOPE_KEYWORDS.wide) {
    if (text.includes(keyword)) {
      scopeIndicators.push({ keyword, scope: "wide" });
      detectedScope = "wide";
    }
  }

  // Check for multi-file scope (only if not already wide)
  if (detectedScope !== "wide") {
    for (const keyword of SCOPE_KEYWORDS.multi) {
      if (text.includes(keyword)) {
        scopeIndicators.push({ keyword, scope: "multi" });
        detectedScope = "multi";
      }
    }
  }

  // Check for single scope (only if still undetermined)
  if (detectedScope === "single" && detectedFiles.size <= 1) {
    for (const keyword of SCOPE_KEYWORDS.single) {
      if (text.includes(keyword)) {
        scopeIndicators.push({ keyword, scope: "single" });
      }
    }
  }

  // Override scope based on detected file count
  if (detectedFiles.size >= 5) {
    detectedScope = "wide";
  } else if (detectedFiles.size >= 2) {
    detectedScope = "multi";
  }

  // Calculate estimated file count and scope score
  let estimatedFileCount;
  let fileScopeScore;

  switch (detectedScope) {
    case "wide":
      estimatedFileCount = Math.max(detectedFiles.size, 16);
      fileScopeScore = 4; // 4 points for wide scope
      break;
    case "multi":
      estimatedFileCount = Math.max(detectedFiles.size, 6);
      fileScopeScore = 2.5; // 2.5 points for multi scope
      break;
    default:
      estimatedFileCount = Math.max(detectedFiles.size, 1);
      fileScopeScore = 1; // 1 point for single scope
  }

  return {
    scope: detectedScope,
    estimatedFileCount,
    fileScopeScore,
    detectedFiles: Array.from(detectedFiles),
    scopeIndicators,
  };
}

/**
 * Unified complexity analyzer combining all scoring factors
 * Produces a final 1-10 complexity score
 *
 * Scoring breakdown:
 * - Text depth score: 0-3 points
 * - Criteria count score: 0-3 points
 * - Keyword/signal multiplier: 0.5-2.0x applied to base
 * - File scope score: 0-4 points
 *
 * @param {string} storyBlock - Raw story markdown block
 * @param {Object} parsedStory - Parsed story object with id, taskCount, keywords
 * @returns {Object} Complete complexity analysis with 1-10 score
 */
function analyzeComplexity(storyBlock, parsedStory = {}) {
  // Get text analysis
  const textAnalysis = analyzeStoryText(storyBlock);

  // Get file scope analysis
  const scopeAnalysis = estimateFileScope(storyBlock);

  // Get task/criteria count
  const criteriaCount = parsedStory.taskCount || parsedStory.acceptanceCriteriaCount || 0;

  // Calculate criteria score (0-3 points)
  // 0-1 criteria = 0.5, 2-3 = 1.5, 4-5 = 2.5, 6+ = 3
  let criteriaScore;
  if (criteriaCount <= 1) {
    criteriaScore = 0.5;
  } else if (criteriaCount <= 3) {
    criteriaScore = 1.5;
  } else if (criteriaCount <= 5) {
    criteriaScore = 2.5;
  } else {
    criteriaScore = 3;
  }

  // Calculate keyword/signal multiplier (0.5-2.0x)
  // Based on both legacy keywords and new signal detection
  let keywordMultiplier = 1.0;

  // Apply legacy keyword multipliers
  const keywords = parsedStory.keywords || [];
  for (const keyword of keywords) {
    if (KEYWORD_MULTIPLIERS[keyword]) {
      keywordMultiplier *= KEYWORD_MULTIPLIERS[keyword];
    }
  }

  // Adjust based on signal score (add up to 0.5x for high signal content)
  if (textAnalysis.signalScore > 3) {
    keywordMultiplier += 0.5;
  } else if (textAnalysis.signalScore > 1.5) {
    keywordMultiplier += 0.25;
  }

  // Cap multiplier to reasonable bounds
  keywordMultiplier = Math.min(Math.max(keywordMultiplier, 0.5), 2.0);

  // Calculate raw score (sum of component scores)
  const rawScore =
    textAnalysis.textDepthScore + criteriaScore + scopeAnalysis.fileScopeScore;

  // Apply keyword multiplier
  const adjustedScore = rawScore * keywordMultiplier;

  // Normalize to 1-10 scale
  // Raw range: 1.5 (min) to 10 (max from 3+3+4), adjusted range: 0.75-20
  // Normalize: clamp to 1-10
  const finalScore = Math.max(1, Math.min(10, Math.round(adjustedScore * 10) / 10));

  return {
    storyId: parsedStory.id || null,
    finalScore,
    complexityLevel: getComplexityLevel(finalScore),
    breakdown: {
      textDepthScore: textAnalysis.textDepthScore,
      criteriaScore,
      fileScopeScore: scopeAnalysis.fileScopeScore,
      keywordMultiplier: Math.round(keywordMultiplier * 100) / 100,
      rawScore: Math.round(rawScore * 10) / 10,
    },
    textAnalysis: {
      wordCount: textAnalysis.wordCount,
      sentenceCount: textAnalysis.sentenceCount,
      signalScore: textAnalysis.signalScore,
      detectedSignals: textAnalysis.detectedSignals.map((s) => s.signal),
    },
    scopeAnalysis: {
      scope: scopeAnalysis.scope,
      estimatedFileCount: scopeAnalysis.estimatedFileCount,
      detectedFiles: scopeAnalysis.detectedFiles,
    },
    factors: {
      criteriaCount,
      keywords,
    },
  };
}

module.exports = {
  scoreComplexity,
  getComplexityLevel,
  estimateBaseDuration,
  estimateBaseTokens,
  getConfidenceMultipliers,
  analyzeStoryText,
  estimateFileScope,
  analyzeComplexity,
  KEYWORD_MULTIPLIERS,
  COMPLEXITY_SIGNALS,
  SCOPE_KEYWORDS,
  BASE_DURATION_PER_TASK,
  BASE_TOKENS_PER_TASK,
};
