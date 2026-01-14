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
} = require("./analyzer");

const {
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
} = require("./patterns");

module.exports = {
  // Main analysis functions
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,

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
