/**
 * Shared TTS mode configurations
 * Used by both summarize-for-tts.mjs (auto-speak) and recap-for-tts.mjs
 *
 * Universal Language-Agnostic Adaptive Mode Detection
 * Uses multi-dimensional complexity scoring instead of keyword patterns
 */

export const MODES = {
  short: {
    maxChars: 150,
    maxTokens: 150,
    promptWords: "under 30 words",
    promptStyle: "1-2 sentences",
  },
  medium: {
    maxChars: 500,
    maxTokens: 250,
    promptWords: "under 60 words",
    promptStyle: "bulleted list using numbered words (One, Two, Three)",
  },
  full: {
    maxChars: 1000,
    maxTokens: 400,
    promptWords: "under 120 words",
    promptStyle: "comprehensive bulleted list with numbered items",
  },
};

/**
 * Score thresholds for mode detection
 * Complexity score ranges from 0-100
 * Tuned for balanced detection across content types
 */
export const MODE_THRESHOLDS = {
  short: { min: 0, max: 25 },    // Simple, brief responses
  medium: { min: 26, max: 55 },  // Multi-paragraph explanations
  full: { min: 56, max: 100 },   // Complex, structured content
};

// Legacy thresholds kept for backward compatibility
export const COMPLEXITY_THRESHOLDS = {
  shortMaxChars: 500,
  mediumMaxChars: 2000,
  userStoryThreshold: 3,
  bulletThreshold: 5,
};

// Pre-compiled regex patterns for performance
const PATTERNS = {
  paragraphs: /\n\n+/g,
  sentences: /[.!?。！？]+/g,
  headings: /^#{1,6}\s/gm,
  codeBlocks: /```/g,
  tableRows: /^\s*\|.+\|/gm,
  bullets: /^[\s]*[-*+]\s+/gm,
  numberedItems: /^[\s]*\d+\.\s+/gm,
  userStories: /US-\d+/g,
  weeksPhases: /(?:Week|Tuần|Phase|Giai đoạn)\s+\d+/gi,
};

/**
 * Analyze text and extract universal structural metrics
 * Works across all languages and content types
 * @param {string} text - Response text to analyze
 * @returns {object} - Extracted metrics
 */
export function analyzeMetrics(text) {
  if (!text || typeof text !== "string") {
    return createEmptyMetrics();
  }

  const charCount = text.length;
  const wordCount = countWords(text);
  const paragraphCount = countParagraphs(text);
  const sentenceCount = countSentences(text);
  const avgSentenceLength = sentenceCount > 0 ? charCount / sentenceCount : 0;
  const headingCount = countHeadings(text);
  const codeBlockCount = countCodeBlocks(text);
  const tableRowCount = countTableRows(text);
  const listItemCount = countListItems(text);
  const nestingDepth = calculateNestingDepth(text);

  return {
    charCount,
    wordCount,
    paragraphCount,
    sentenceCount,
    avgSentenceLength,
    headingCount,
    codeBlockCount,
    tableRowCount,
    listItemCount,
    nestingDepth,
  };
}

/**
 * Create empty metrics object for invalid input
 */
function createEmptyMetrics() {
  return {
    charCount: 0,
    wordCount: 0,
    paragraphCount: 0,
    sentenceCount: 0,
    avgSentenceLength: 0,
    headingCount: 0,
    codeBlockCount: 0,
    tableRowCount: 0,
    listItemCount: 0,
    nestingDepth: 0,
  };
}

/**
 * Count words (whitespace-delimited tokens)
 * Works for most languages including CJK (counts characters as approximation)
 */
function countWords(text) {
  const tokens = text.trim().split(/\s+/);
  return tokens.filter(t => t.length > 0).length;
}

/**
 * Count paragraphs (double newline separated blocks)
 */
function countParagraphs(text) {
  const matches = text.match(PATTERNS.paragraphs);
  return (matches ? matches.length : 0) + 1;
}

/**
 * Count sentences using universal terminators
 * Supports: . ! ? and CJK equivalents 。！？
 */
function countSentences(text) {
  const matches = text.match(PATTERNS.sentences);
  return matches ? matches.length : 0;
}

/**
 * Count markdown headings (# to ######)
 */
function countHeadings(text) {
  const matches = text.match(PATTERNS.headings);
  return matches ? matches.length : 0;
}

/**
 * Count fenced code blocks (``` pairs)
 */
function countCodeBlocks(text) {
  const matches = text.match(PATTERNS.codeBlocks);
  return matches ? Math.floor(matches.length / 2) : 0;
}

/**
 * Count markdown table rows (lines with | delimiters)
 */
function countTableRows(text) {
  const matches = text.match(PATTERNS.tableRows);
  return matches ? matches.length : 0;
}

/**
 * Count list items (bullets and numbered)
 */
function countListItems(text) {
  const bullets = text.match(PATTERNS.bullets) || [];
  const numbered = text.match(PATTERNS.numberedItems) || [];
  return bullets.length + numbered.length;
}

/**
 * Calculate maximum nesting depth based on indentation
 * Returns depth in "levels" (2 spaces or 1 tab = 1 level)
 */
function calculateNestingDepth(text) {
  const lines = text.split("\n");
  let maxDepth = 0;

  for (const line of lines) {
    const match = line.match(/^[\s\t]+/);
    if (match) {
      // Convert to consistent depth: 2 spaces or 1 tab = 1 level
      const spaces = match[0].replace(/\t/g, "  ").length;
      const depth = Math.floor(spaces / 2);
      maxDepth = Math.max(maxDepth, depth);
    }
  }

  return maxDepth;
}

/**
 * Calculate complexity score from metrics (0-100)
 * Higher score = more complex content
 * @param {object} metrics - Metrics from analyzeMetrics()
 * @returns {number} - Complexity score 0-100
 */
export function calculateComplexityScore(metrics) {
  let score = 0;

  // Base score from length (0-30 points)
  // 100 chars = 1 point, max 30 points at 3000 chars
  score += Math.min(30, metrics.charCount / 100);

  // Structure complexity (0-25 points)
  // Paragraphs: 2 points each, max 10
  score += Math.min(10, metrics.paragraphCount * 2);
  // Headings: 3 points each, max 10
  score += Math.min(10, metrics.headingCount * 3);
  // Nesting depth: 2 points per level, max 5
  score += Math.min(5, metrics.nestingDepth * 2);

  // List/table density (0-25 points)
  // List items: 2 points each, max 15
  score += Math.min(15, metrics.listItemCount * 2);
  // Table rows: 1.5 points each, max 10
  score += Math.min(10, Math.floor(metrics.tableRowCount * 1.5));

  // Code density (0-15 points)
  // Code blocks: 5 points each, max 15
  score += Math.min(15, metrics.codeBlockCount * 5);

  // Sentence complexity (0-10 points)
  // Average sentence length / 10, max 10 points
  if (metrics.sentenceCount > 0) {
    score += Math.min(10, metrics.avgSentenceLength / 10);
  }

  return Math.min(100, Math.round(score));
}

/**
 * Calculate pattern-based bonus points for backward compatibility
 * PRD patterns (US-XXX, Week/Phase) add bonus to existing score
 * @param {string} text - Response text
 * @returns {number} - Bonus points (0-35)
 */
function calculatePatternBonus(text) {
  let bonus = 0;

  // User stories: 3+ = +20 bonus
  const userStories = (text.match(PATTERNS.userStories) || []).length;
  if (userStories >= 3) {
    bonus += 20;
  }

  // Weeks/Phases: 2+ = +15 bonus
  const weeksPhases = (text.match(PATTERNS.weeksPhases) || []).length;
  if (weeksPhases >= 2) {
    bonus += 15;
  }

  return bonus;
}

/**
 * Detect optimal summarization mode based on response complexity
 * Uses universal structural metrics that work across all languages and topics
 *
 * @param {string} responseText - The response text to analyze
 * @returns {{ mode: string, reason: string, score: number, metrics: object }}
 */
export function detectOptimalMode(responseText) {
  const startTime = Date.now();

  // Handle invalid input
  if (!responseText || typeof responseText !== "string") {
    return {
      mode: "short",
      reason: "Empty or invalid input",
      score: 0,
      metrics: createEmptyMetrics(),
    };
  }

  // Early exit for very short responses (optimization)
  // Threshold set low (100) to ensure structured short content still gets analyzed
  if (responseText.length < 100) {
    const elapsed = Date.now() - startTime;
    if (process.env.RALPH_DEBUG) {
      console.error(`[detectOptimalMode] ${elapsed}ms (early exit: short)`);
    }
    return {
      mode: "short",
      reason: "Brief response (< 100 chars)",
      score: responseText.length / 10,
      metrics: { charCount: responseText.length },
    };
  }

  // Analyze metrics
  const metrics = analyzeMetrics(responseText);

  // Calculate base complexity score
  const baseScore = calculateComplexityScore(metrics);

  // Add pattern bonus for backward compatibility
  const patternBonus = calculatePatternBonus(responseText);

  // Final score (capped at 100)
  const finalScore = Math.min(100, baseScore + patternBonus);

  // Determine mode based on score thresholds
  let mode;
  let reason;

  if (finalScore >= MODE_THRESHOLDS.full.min) {
    mode = "full";
    reason = `High complexity (score: ${finalScore})`;
  } else if (finalScore >= MODE_THRESHOLDS.medium.min) {
    mode = "medium";
    reason = `Medium complexity (score: ${finalScore})`;
  } else {
    mode = "short";
    reason = `Low complexity (score: ${finalScore})`;
  }

  // Add detail about what contributed to score
  const details = [];
  if (metrics.paragraphCount > 3) details.push(`${metrics.paragraphCount} paragraphs`);
  if (metrics.headingCount > 0) details.push(`${metrics.headingCount} headings`);
  if (metrics.listItemCount > 5) details.push(`${metrics.listItemCount} list items`);
  if (metrics.codeBlockCount > 0) details.push(`${metrics.codeBlockCount} code blocks`);
  if (metrics.tableRowCount > 0) details.push(`${metrics.tableRowCount} table rows`);
  if (patternBonus > 0) details.push(`+${patternBonus} pattern bonus`);

  if (details.length > 0) {
    reason += ` - ${details.join(", ")}`;
  }

  // Performance logging
  const elapsed = Date.now() - startTime;
  if (process.env.RALPH_DEBUG) {
    console.error(`[detectOptimalMode] ${elapsed}ms (score: ${finalScore})`);
  }

  return {
    mode,
    reason,
    score: finalScore,
    metrics,
  };
}

/**
 * Get mode configuration by name
 * @param {string} modeName - Mode name (short, medium, full)
 * @returns {object} - Mode configuration
 */
export function getModeConfig(modeName) {
  return MODES[modeName] || MODES.short;
}
