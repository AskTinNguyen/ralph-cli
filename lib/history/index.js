/**
 * Historical Log Context Module
 *
 * Enables fresh Ralph iterations to optionally access historical logs from
 * earlier runs to avoid repeating failed approaches.
 *
 * Three modes:
 * - off (default): No historical context
 * - smart (recommended): Focused context on failures and current story
 * - full: Complete historical context for all runs
 */
const indexer = require("./indexer");
const contextCli = require("./context-cli");

module.exports = {
  // Indexer functions
  indexRun: indexer.indexRun,
  buildIndex: indexer.buildIndex,
  getRunsForStory: indexer.getRunsForStory,
  getFailedRuns: indexer.getFailedRuns,
  getSuccessfulRuns: indexer.getSuccessfulRuns,

  // Context generation
  generateContext: contextCli.generateContext,
  generateSmartContext: contextCli.generateSmartContext,
  generateFullContext: contextCli.generateFullContext,

  // Utilities
  scoreRun: contextCli.scoreRun,
  formatRun: contextCli.formatRun,
  estimateTokens: contextCli.estimateTokens,

  // Constants
  DEFAULT_TOKEN_BUDGET: contextCli.DEFAULT_TOKEN_BUDGET,
  DEFAULT_MAX_RUNS: contextCli.DEFAULT_MAX_RUNS,
};
