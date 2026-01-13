/**
 * Improve module - main entry point
 *
 * Provides automated guardrail generation from failure patterns.
 */
const {
  analyzeRunErrors,
  parseErrorsLog,
  clusterErrors,
  generateCandidates,
  formatCandidatesMarkdown,
  formatGuardrailEntry,
  analyzeAndGenerate,
  saveCandidates,
  loadCandidates,
} = require("./generator");

const {
  GUARDRAIL_TEMPLATES,
  PATTERN_MATCHERS,
  matchErrorToRule,
  getGuardrailTemplate,
  getAllRuleKeys,
} = require("./rules");

module.exports = {
  // Generator
  analyzeRunErrors,
  parseErrorsLog,
  clusterErrors,
  generateCandidates,
  formatCandidatesMarkdown,
  formatGuardrailEntry,
  analyzeAndGenerate,
  saveCandidates,
  loadCandidates,

  // Rules
  GUARDRAIL_TEMPLATES,
  PATTERN_MATCHERS,
  matchErrorToRule,
  getGuardrailTemplate,
  getAllRuleKeys,
};
