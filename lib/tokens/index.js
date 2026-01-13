/**
 * Tokens module - main entry point
 *
 * Provides token extraction, caching, and cost calculation for Ralph agent runs.
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

const {
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
} = require("./calculator");

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

  // Calculator functions
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
