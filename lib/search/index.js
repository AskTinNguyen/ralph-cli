/**
 * Search module - main entry point
 *
 * Provides cross-project search functionality for Ralph loops.
 */
const {
  getSearchIndexPath,
  loadSearchIndex,
  saveSearchIndex,
  buildIndex,
  indexSingleProject,
} = require("./indexer");

const {
  search,
  calculateRelevance,
  extractSnippet,
  parseSince,
  getFilterOptions,
} = require("./searcher");

module.exports = {
  // Indexer
  getSearchIndexPath,
  loadSearchIndex,
  saveSearchIndex,
  buildIndex,
  indexSingleProject,

  // Searcher
  search,
  calculateRelevance,
  extractSnippet,
  parseSince,
  getFilterOptions,
};
