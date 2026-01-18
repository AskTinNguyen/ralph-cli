/**
 * Review module exports
 * Quality validation for PRDs and implementation plans
 */
const prdReviewer = require("./prd-reviewer");
const planReviewer = require("./plan-reviewer");
const validators = require("./validators");
const reporter = require("./reporter");

module.exports = {
  // PRD Review
  reviewPRD: prdReviewer.reviewPRD,

  // Plan Review
  reviewPlan: planReviewer.reviewPlan,

  // Validators
  detectVagueLanguage: validators.detectVagueLanguage,
  detectPlaceholders: validators.detectPlaceholders,
  validateBoundaries: validators.validateBoundaries,
  checkCommandExecutability: validators.checkCommandExecutability,
  validateFilePaths: validators.validateFilePaths,

  // Reporting
  formatTerminalOutput: reporter.formatTerminalOutput,
  generateMarkdownReport: reporter.generateMarkdownReport,
  generateJSONOutput: reporter.generateJSONOutput,
  saveReport: reporter.saveReport,

  // Grading
  gradeScore: prdReviewer.gradeScore,
};
