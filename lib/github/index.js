/**
 * GitHub integration module for Ralph CLI
 * Provides PR creation, branch management, and issue creation utilities
 */

const pr = require('./pr');
const template = require('./template');
const issue = require('./issue');

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

  // Review assignment functions (US-003)
  getCodeOwners: pr.getCodeOwners,
  getChangedFiles: pr.getChangedFiles,
  assignReviewers: pr.assignReviewers,
  assignTeam: pr.assignTeam,
  addLabels: pr.addLabels,
  autoAssignReviewers: pr.autoAssignReviewers,

  // Issue creation functions (Error Management)
  createIssue: issue.createIssue,
  findDuplicateIssue: issue.findDuplicateIssue,
  addCommentToIssue: issue.addCommentToIssue,
  getRepoInfo: issue.getRepoInfo,
  isGhAvailable: issue.isGhAvailable,
  isIssueEnabled: issue.isEnabled,
  getIssueStatus: issue.getStatus,
};
