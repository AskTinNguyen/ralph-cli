/**
 * GitHub integration module for Ralph CLI
 * Provides PR creation and branch management utilities
 */

const pr = require('./pr');
const template = require('./template');

module.exports = {
  // PR creation functions
  createPullRequest: pr.createPullRequest,
  ensureBranch: pr.ensureBranch,
  pushBranch: pr.pushBranch,
  getBranchName: pr.getBranchName,

  // Template functions
  renderPRBody: template.renderPRBody,
  extractPRDSummary: template.extractPRDSummary,
  formatCompletedStories: template.formatCompletedStories,
  getKeyFiles: template.getKeyFiles,
  formatTestResults: template.formatTestResults,
  loadTemplate: template.loadTemplate,
};
