/**
 * Error management checks for ralph doctor
 *
 * Validates error registry and analyzes recent errors
 */
const fs = require("fs");
const path = require("path");

/**
 * Validate error registry file exists and is valid
 * @param {string} projectPath - Project root path
 * @returns {object} Check result
 */
function validateRegistry(projectPath = ".") {
  const result = {
    name: "Error Registry",
    type: "error_management",
    valid: false,
    path: null,
    errorCount: 0,
    categories: [],
    errors: [],
    warnings: [],
  };

  // Look for errors.json
  const registryPath = path.join(projectPath, ".agents/ralph/lib/errors.json");
  result.path = registryPath;

  if (!fs.existsSync(registryPath)) {
    result.errors.push({
      type: "missing_error_registry",
      message: "Error registry not found at .agents/ralph/lib/errors.json",
    });
    return result;
  }

  try {
    const content = fs.readFileSync(registryPath, "utf8");
    const registry = JSON.parse(content);

    // Remove meta fields
    const { $schema, _meta, ...errors } = registry;

    result.errorCount = Object.keys(errors).length;
    result.valid = true;

    // Collect categories
    const categories = new Set();
    for (const [code, error] of Object.entries(errors)) {
      if (error.category) {
        categories.add(error.category);
      }

      // Validate each error has required fields
      const requiredFields = ["category", "severity", "message", "remediation"];
      for (const field of requiredFields) {
        if (!error[field]) {
          result.warnings.push({
            type: "missing_field",
            code,
            message: `Error ${code} is missing required field: ${field}`,
          });
        }
      }
    }

    result.categories = Array.from(categories);
  } catch (err) {
    result.errors.push({
      type: "invalid_error_registry",
      message: `Failed to parse error registry: ${err.message}`,
    });
  }

  return result;
}

/**
 * Analyze recent errors from error log
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {object} Analysis result
 */
function analyzeRecentErrors(ralphDir = ".ralph") {
  const result = {
    name: "Recent Errors",
    type: "error_analysis",
    valid: true,
    logPath: null,
    totalErrors: 0,
    errorsByCode: {},
    recentErrors: [],
    suggestions: [],
    errors: [],
  };

  // Look for errors.log
  const logPath = path.join(ralphDir, "errors.log");
  result.logPath = logPath;

  if (!fs.existsSync(logPath)) {
    // Not an error - just no errors logged yet
    return result;
  }

  try {
    const content = fs.readFileSync(logPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);

    // Parse error log entries
    // Format: [timestamp] RALPH-XXX: message | context
    const errorPattern = /^\[([^\]]+)\]\s*(RALPH-\d{3}):\s*(.+?)(?:\s*\|\s*(.+))?$/;

    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    for (const line of lines) {
      const match = line.match(errorPattern);
      if (match) {
        const [, timestamp, code, message, context] = match;
        const errorTime = new Date(timestamp).getTime();

        // Track all errors
        result.totalErrors++;

        // Count by code
        if (!result.errorsByCode[code]) {
          result.errorsByCode[code] = { count: 0, lastSeen: null, message };
        }
        result.errorsByCode[code].count++;
        result.errorsByCode[code].lastSeen = timestamp;

        // Track recent (last 7 days)
        if (errorTime > sevenDaysAgo) {
          result.recentErrors.push({
            timestamp,
            code,
            message,
            context,
          });
        }
      }
    }

    // Generate suggestions based on error patterns
    for (const [code, stats] of Object.entries(result.errorsByCode)) {
      if (stats.count >= 3) {
        result.suggestions.push({
          code,
          count: stats.count,
          message: `${code} occurred ${stats.count} times. Run 'ralph error ${code}' for remediation steps.`,
        });
      }
    }
  } catch (err) {
    result.errors.push({
      type: "error_log_parse_failed",
      message: `Failed to parse error log: ${err.message}`,
    });
  }

  return result;
}

/**
 * Check GitHub issue creation configuration
 * @returns {object} Check result
 */
function checkIssueConfig() {
  const result = {
    name: "GitHub Issue Integration",
    type: "issue_config",
    valid: true,
    enabled: false,
    ghAvailable: false,
    repo: null,
    warnings: [],
  };

  // Check if auto-issues are enabled
  result.enabled = process.env.RALPH_AUTO_ISSUES === "true";

  // Check if gh CLI is available
  try {
    const { execSync } = require("child_process");
    execSync("gh auth status", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    result.ghAvailable = true;
  } catch {
    result.ghAvailable = false;
    if (result.enabled) {
      result.warnings.push({
        type: "gh_not_authenticated",
        message:
          "RALPH_AUTO_ISSUES is enabled but gh CLI is not authenticated. Run 'gh auth login'",
      });
    }
  }

  // Get repo info if available
  if (process.env.RALPH_ISSUE_REPO) {
    result.repo = process.env.RALPH_ISSUE_REPO;
  } else {
    try {
      const { execSync } = require("child_process");
      const remote = execSync("git config --get remote.origin.url", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();

      const match = remote.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(?:\.git)?$/);
      if (match) {
        result.repo = `${match[1]}/${match[2]}`;
      }
    } catch {
      // Not in a git repo or no remote
    }
  }

  return result;
}

/**
 * Run all error-related checks
 * @param {string} projectPath - Project root path
 * @returns {object} Combined check results
 */
function runAllChecks(projectPath = ".") {
  const ralphDir = path.join(projectPath, ".ralph");

  const registryCheck = validateRegistry(projectPath);
  const analysisCheck = analyzeRecentErrors(ralphDir);
  const issueCheck = checkIssueConfig();

  const checks = [registryCheck, analysisCheck, issueCheck];

  let passed = 0;
  let warnings = 0;
  let errors = 0;

  for (const check of checks) {
    if (check.valid) passed++;
    warnings += (check.warnings || []).length;
    errors += (check.errors || []).length;
  }

  return {
    checks,
    passed,
    warnings,
    errors,
  };
}

module.exports = {
  validateRegistry,
  analyzeRecentErrors,
  checkIssueConfig,
  runAllChecks,
};
