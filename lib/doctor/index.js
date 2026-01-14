/**
 * Ralph Doctor module
 *
 * Comprehensive diagnostics for validating environment setup,
 * identifying issues, and providing actionable fixes.
 */
const path = require("path");
const environment = require("./checks/environment");
const state = require("./checks/state");

/**
 * Run all environment checks
 * @param {string} projectPath - Path to project root
 * @returns {object} Environment check results
 */
function runEnvironmentChecks(projectPath = ".") {
  return environment.runAllChecks(projectPath);
}

/**
 * Run all state file checks
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {object} State check results
 */
function runStateChecks(ralphDir = ".ralph") {
  return state.runAllChecks(ralphDir);
}

/**
 * Run all checks (environment + state)
 * @param {string} projectPath - Path to project root
 * @returns {object} Combined results from all checks
 */
function runAllChecks(projectPath = ".") {
  const ralphDir = path.join(projectPath, ".ralph");

  const envResults = runEnvironmentChecks(projectPath);
  const stateResults = runStateChecks(ralphDir);

  return {
    environment: envResults,
    state: stateResults,
    summary: {
      totalPassed: envResults.passed + stateResults.passed,
      totalWarnings: envResults.warnings + stateResults.warnings,
      totalErrors: envResults.errors + stateResults.errors,
    },
  };
}

module.exports = {
  // Main entry points
  runEnvironmentChecks,
  runStateChecks,
  runAllChecks,

  // Environment checks
  checkClaude: environment.checkClaude,
  checkCodex: environment.checkCodex,
  checkDroid: environment.checkDroid,
  checkNodeVersion: environment.checkNodeVersion,
  checkGitVersion: environment.checkGitVersion,

  // State checks
  validatePRD: state.validatePRD,
  validatePlan: state.validatePlan,
  validateProgress: state.validateProgress,
  findOrphanedRuns: state.findOrphanedRuns,
};
