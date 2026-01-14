/**
 * Context module - intelligent context selection for agent builds
 *
 * Provides:
 * - File relevance scoring based on story content
 * - Import/require connection detection
 * - Recently modified file tracking
 * - Token-aware file selection
 */

const scorer = require("./scorer");
const selector = require("./selector");

// Re-export main functions
module.exports = {
  // Selector functions
  selectRelevantFiles: selector.selectRelevantFiles,
  getProjectFiles: selector.getProjectFiles,
  getFilePaths: selector.getFilePaths,
  countFileTokens: selector.countFileTokens,

  // Scorer functions
  calculateFileRelevance: scorer.calculateFileRelevance,
  extractFileReferences: scorer.extractFileReferences,
  findImportConnections: scorer.findImportConnections,
  getRecentlyModifiedFiles: scorer.getRecentlyModifiedFiles,
  extractKeywords: scorer.extractKeywords,

  // Cache management
  clearCaches: scorer.clearCaches,

  // Sub-modules for direct access
  scorer,
  selector,
};
