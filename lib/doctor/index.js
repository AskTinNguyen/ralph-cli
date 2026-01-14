/**
 * Ralph Doctor module
 *
 * Comprehensive diagnostics for validating environment setup,
 * identifying issues, and providing actionable fixes.
 */
const environment = require("./checks/environment");

/**
 * Run all environment checks
 * @param {string} projectPath - Path to project root
 * @returns {object} Environment check results
 */
function runEnvironmentChecks(projectPath = ".") {
  return environment.runAllChecks(projectPath);
}

module.exports = {
  // Main entry point
  runEnvironmentChecks,

  // Environment checks
  checkClaude: environment.checkClaude,
  checkCodex: environment.checkCodex,
  checkDroid: environment.checkDroid,
  checkNodeVersion: environment.checkNodeVersion,
  checkGitVersion: environment.checkGitVersion,
};
