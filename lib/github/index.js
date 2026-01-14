/**
 * GitHub integration module for Ralph CLI
 * Provides PR creation and branch management utilities
 */

const pr = require('./pr');

module.exports = {
  createPullRequest: pr.createPullRequest,
  ensureBranch: pr.ensureBranch,
  pushBranch: pr.pushBranch,
  getBranchName: pr.getBranchName,
};
