/**
 * Context module - intelligent context selection for agent builds
 *
 * Provides:
 * - File relevance scoring based on story content
 * - Import/require connection detection
 * - Recently modified file tracking
 * - Token-aware file selection
 * - Context budget management (token limits, truncation)
 */

const scorer = require("./scorer");
const selector = require("./selector");
const budget = require("./budget");

// Re-export main functions
module.exports = {
  // Selector functions
  selectRelevantFiles: selector.selectRelevantFiles,
  selectWithBudget: selector.selectWithBudget,
  getProjectFiles: selector.getProjectFiles,
  getFilePaths: selector.getFilePaths,
  countFileTokens: selector.countFileTokens,

  // Scorer functions
  calculateFileRelevance: scorer.calculateFileRelevance,
  extractFileReferences: scorer.extractFileReferences,
  findImportConnections: scorer.findImportConnections,
  getRecentlyModifiedFiles: scorer.getRecentlyModifiedFiles,
  extractKeywords: scorer.extractKeywords,

  // Budget functions
  calculateBudget: budget.calculateBudget,
  getModelLimit: budget.getModelLimit,
  getBudgetStatus: budget.getBudgetStatus,
  truncateFile: budget.truncateFile,
  selectWithinBudget: budget.selectWithinBudget,

  // Constants
  MODEL_LIMITS: budget.MODEL_LIMITS,
  BUDGET_RATIOS: budget.BUDGET_RATIOS,
  BUDGET_THRESHOLDS: budget.BUDGET_THRESHOLDS,

  // Cache management
  clearCaches: scorer.clearCaches,
  clearTokenCache: budget.clearTokenCache,

  // Sub-modules for direct access
  scorer,
  selector,
  budget,
};
