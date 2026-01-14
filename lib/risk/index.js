/**
 * Risk assessment module - entry point
 *
 * Provides risk analysis capabilities for user stories,
 * scoring changes based on keywords, file patterns, and dependencies.
 */

const {
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,
  extractFilePaths,
  formatRiskPrompt,
  isHighRisk,
} = require("./analyzer");

const {
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
} = require("./patterns");

/**
 * Get the risk threshold from config
 * Reads from RALPH_RISK_THRESHOLD env var or returns default
 * @returns {number} Risk threshold (default: 7)
 */
function getRiskThreshold() {
  const envThreshold = process.env.RALPH_RISK_THRESHOLD;
  if (envThreshold && !isNaN(parseInt(envThreshold, 10))) {
    return parseInt(envThreshold, 10);
  }
  return DEFAULT_RISK_CONFIG.threshold;
}

/**
 * Check if risk pause is enabled
 * Reads from RALPH_RISK_PAUSE env var or returns default
 * @returns {boolean} Whether to pause on high-risk stories
 */
function shouldPauseOnHighRisk() {
  const envPause = process.env.RALPH_RISK_PAUSE;
  if (envPause !== undefined) {
    return envPause.toLowerCase() === "true" || envPause === "1";
  }
  return DEFAULT_RISK_CONFIG.pauseOnHighRisk;
}

module.exports = {
  // Main analysis functions
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,
  isHighRisk,

  // Configuration functions
  getRiskThreshold,
  shouldPauseOnHighRisk,

  // Utilities
  extractFilePaths,
  formatRiskPrompt,

  // Pattern definitions (for customization)
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
};
