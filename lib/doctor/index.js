/**
 * Ralph Doctor module
 *
 * Comprehensive diagnostics for validating environment setup,
 * identifying issues, and providing actionable fixes.
 */
const path = require("path");
const environment = require("./checks/environment");
const state = require("./checks/state");
const configuration = require("./checks/configuration");
const fixes = require("./fixes");

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
 * Run all configuration checks
 * @param {string} projectPath - Path to project root
 * @returns {object} Configuration check results
 */
function runConfigChecks(projectPath = ".") {
  return configuration.runAllChecks(projectPath);
}

/**
 * Add fix suggestions to check results
 * @param {object} results - Results from runAllChecks
 * @returns {object} Results with fixes attached
 */
function suggestFixes(results) {
  const withFixes = { ...results };

  // Add fixes to environment errors
  if (withFixes.environment && withFixes.environment.checks) {
    for (const check of withFixes.environment.checks) {
      if (check.suggestion && !check.available) {
        // Agent not available
        const issueType = `missing_${check.name.toLowerCase().replace(/\s+/g, "_")}`;
        check.fix = fixes.getFix(issueType) || {
          description: check.suggestion,
          type: "manual",
        };
      }
      if (!check.valid && check.suggestion) {
        check.fix = {
          description: check.suggestion,
          type: "manual",
        };
      }
      // Add git fixes
      if (check.state) {
        const gitFixes = fixes.suggestGitFixes(check.state);
        if (gitFixes.suggestions.length > 0) {
          check.gitFixes = gitFixes.suggestions;
        }
      }
    }
  }

  // Add fixes to configuration errors
  if (withFixes.configuration && withFixes.configuration.checks) {
    for (const check of withFixes.configuration.checks) {
      if (check.errors) {
        for (const error of check.errors) {
          error.fix = fixes.getFix(error.type);
        }
      }
      if (check.warnings) {
        for (const warning of check.warnings) {
          warning.fix = fixes.getFix(warning.type);
        }
      }
    }
  }

  // Add fixes to state errors
  if (withFixes.state && withFixes.state.checks) {
    for (const check of withFixes.state.checks) {
      if (check.errors) {
        for (const error of check.errors) {
          error.fix = fixes.getFix(error.type);
        }
      }
    }
  }

  return withFixes;
}

/**
 * Run all checks (environment + configuration + state) with fix suggestions
 * @param {string} projectPath - Path to project root
 * @returns {object} Combined results from all checks with fixes
 */
function runAllChecks(projectPath = ".") {
  const ralphDir = path.join(projectPath, ".ralph");

  const envResults = runEnvironmentChecks(projectPath);
  const configResults = runConfigChecks(projectPath);
  const stateResults = runStateChecks(ralphDir);

  const results = {
    environment: envResults,
    configuration: configResults,
    state: stateResults,
    summary: {
      totalPassed:
        envResults.passed + configResults.passed + stateResults.passed,
      totalWarnings:
        envResults.warnings + configResults.warnings + stateResults.warnings,
      totalErrors:
        envResults.errors + configResults.errors + stateResults.errors,
    },
  };

  // Add fix suggestions
  return suggestFixes(results);
}

/**
 * Apply automatic fixes for detected issues
 * @param {object} diagnosticResults - Results from runAllChecks
 * @param {string} projectPath - Path to project root
 * @returns {object} Results of applied fixes
 */
function applyFixes(diagnosticResults, projectPath = ".") {
  return fixes.applyFixes(diagnosticResults, projectPath);
}

module.exports = {
  // Main entry points
  runEnvironmentChecks,
  runStateChecks,
  runConfigChecks,
  runAllChecks,
  suggestFixes,
  applyFixes,

  // Environment checks
  checkClaude: environment.checkClaude,
  checkCodex: environment.checkCodex,
  checkDroid: environment.checkDroid,
  checkNodeVersion: environment.checkNodeVersion,
  checkGitVersion: environment.checkGitVersion,

  // Configuration checks
  validateTemplates: configuration.validateTemplates,
  validateConfigFile: configuration.validateConfigFile,
  validateRalphDirectory: configuration.validateRalphDirectory,

  // State checks
  validatePRD: state.validatePRD,
  validatePlan: state.validatePlan,
  validateProgress: state.validateProgress,
  findOrphanedRuns: state.findOrphanedRuns,

  // Fixes
  FIXES: fixes.FIXES,
  DOCUMENTATION_LINKS: fixes.DOCUMENTATION_LINKS,
  repairPRDMarkers: fixes.repairPRDMarkers,
  repairPlanFormat: fixes.repairPlanFormat,
  repairUnclosedBrackets: fixes.repairUnclosedBrackets,
  suggestGitFixes: fixes.suggestGitFixes,
  getFix: fixes.getFix,
  formatFix: fixes.formatFix,
};
