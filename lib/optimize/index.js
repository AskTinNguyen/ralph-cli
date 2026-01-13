/**
 * Prompt optimization module
 *
 * Provides tools for analyzing prompt effectiveness,
 * tracking versions, and generating improvement suggestions.
 */

const versions = require("./versions");
const correlator = require("./correlator");
const suggestions = require("./suggestions");

module.exports = {
  // Version tracking
  parseVersion: versions.parseVersion,
  setVersion: versions.setVersion,
  incrementVersion: versions.incrementVersion,
  loadVersionMetrics: versions.loadVersionMetrics,
  saveVersionMetrics: versions.saveVersionMetrics,
  recordRunResult: versions.recordRunResult,
  getVersionComparison: versions.getVersionComparison,
  getPromptTemplates: versions.getPromptTemplates,
  initializeVersions: versions.initializeVersions,
  getVersionMetricsPath: versions.getVersionMetricsPath,

  // Correlation analysis
  parsePromptSections: correlator.parsePromptSections,
  extractKeyInstructions: correlator.extractKeyInstructions,
  checkInstructionFollowed: correlator.checkInstructionFollowed,
  analyzeCorrelation: correlator.analyzeCorrelation,
  categorizeInstructions: correlator.categorizeInstructions,
  getRunsByVersion: correlator.getRunsByVersion,

  // Suggestions
  generateSuggestions: suggestions.generateSuggestions,
  generateVersionSuggestions: suggestions.generateVersionSuggestions,
  formatSuggestionsMarkdown: suggestions.formatSuggestionsMarkdown,
  saveSuggestions: suggestions.saveSuggestions,
  loadSuggestions: suggestions.loadSuggestions,
  getSuggestionsPath: suggestions.getSuggestionsPath,
  generateAllSuggestions: suggestions.generateAllSuggestions,
};
