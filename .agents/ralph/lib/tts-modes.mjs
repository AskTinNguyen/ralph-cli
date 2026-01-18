/**
 * Shared TTS mode configurations
 * Used by both summarize-for-tts.mjs (auto-speak) and recap-for-tts.mjs
 */

export const MODES = {
  short: {
    maxChars: 150,
    maxTokens: 150,
    promptWords: "under 30 words",
    promptStyle: "1-2 sentences",
  },
  medium: {
    maxChars: 800,
    maxTokens: 400,
    promptWords: "under 100 words",
    promptStyle: "bulleted list using numbered words (One, Two, Three)",
  },
  full: {
    maxChars: 1500,
    maxTokens: 600,
    promptWords: "under 200 words",
    promptStyle: "comprehensive bulleted list with numbered items",
  },
};

export const COMPLEXITY_THRESHOLDS = {
  shortMaxChars: 500,
  mediumMaxChars: 2000,
  userStoryThreshold: 3,
  bulletThreshold: 5,
};

/**
 * Detect optimal summarization mode based on response complexity
 * @param {string} responseText - The response text to analyze
 * @returns {{ mode: string, reason: string }}
 */
export function detectOptimalMode(responseText) {
  const charCount = responseText.length;
  const userStories = (responseText.match(/US-\d+/g) || []).length;
  const weeks = (responseText.match(/Week \d+/gi) || []).length;
  const phases = (responseText.match(/Phase \d+/gi) || []).length;
  const bullets = (responseText.match(/^[\s]*[-*+]\s+/gm) || []).length;
  const numberedItems = (responseText.match(/^[\s]*\d+\.\s+/gm) || []).length;
  const totalListItems = bullets + numberedItems;

  // PRD/Plan detection - structured content with user stories or multi-week plans
  if (userStories >= COMPLEXITY_THRESHOLDS.userStoryThreshold) {
    return { mode: "full", reason: `PRD content (${userStories} user stories)` };
  }

  if (weeks >= 2 || phases >= 2) {
    return { mode: "full", reason: `Multi-phase plan (${weeks} weeks, ${phases} phases)` };
  }

  // Length-based detection with list density consideration
  if (charCount > COMPLEXITY_THRESHOLDS.mediumMaxChars) {
    return { mode: "full", reason: `Long response (${charCount} chars)` };
  }

  if (charCount > COMPLEXITY_THRESHOLDS.shortMaxChars || totalListItems > COMPLEXITY_THRESHOLDS.bulletThreshold) {
    return { mode: "medium", reason: `Medium complexity (${charCount} chars, ${totalListItems} list items)` };
  }

  return { mode: "short", reason: "Simple response" };
}

/**
 * Get mode configuration by name
 * @param {string} modeName - Mode name (short, medium, full)
 * @returns {object} - Mode configuration
 */
export function getModeConfig(modeName) {
  return MODES[modeName] || MODES.short;
}
