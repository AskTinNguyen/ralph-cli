/**
 * Tokens module - main entry point
 *
 * Provides token extraction and caching for Ralph agent runs.
 */
const {
  extractTokensFromLog,
  extractTokensWithFallback,
  detectModel,
  estimateTokensFromText,
  parseTokensFromSummary,
  formatTokenSection,
} = require("./extractor");

const {
  loadTokenCache,
  saveTokenCache,
  aggregateTokens,
  aggregateByStory,
  aggregateByModel,
  addRunToCache,
  getStreamSummary,
  rebuildCache,
} = require("./cache");

module.exports = {
  // Extractor functions
  extractTokensFromLog,
  extractTokensWithFallback,
  detectModel,
  estimateTokensFromText,
  parseTokensFromSummary,
  formatTokenSection,

  // Cache functions
  loadTokenCache,
  saveTokenCache,
  aggregateTokens,
  aggregateByStory,
  aggregateByModel,
  addRunToCache,
  getStreamSummary,
  rebuildCache,
};
