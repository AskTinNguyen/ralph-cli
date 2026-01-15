/**
 * Ralph Error Management Module
 *
 * Centralized error registry with lookup, formatting, and GitHub issue integration.
 *
 * Usage:
 *   const error = require('./lib/error');
 *
 *   // Lookup error
 *   const errDef = error.lookup('RALPH-001');
 *
 *   // Format for terminal
 *   console.log(error.format('RALPH-001'));
 *
 *   // List all errors
 *   const all = error.list();
 *
 *   // List by category
 *   const buildErrors = error.list({ category: 'BUILD' });
 */
const registry = require("./registry");
const formatter = require("./formatter");

/**
 * Lookup an error by code
 * @param {string} code - Error code (e.g., "RALPH-001")
 * @returns {object|null} Error definition or null if not found
 */
function lookup(code) {
  return registry.getError(code);
}

/**
 * Format an error for terminal display
 * @param {string} code - Error code
 * @param {object} [options] - Formatting options
 * @param {boolean} [options.compact=false] - Use compact format
 * @param {boolean} [options.json=false] - Return JSON instead of string
 * @returns {string|object} Formatted error
 */
function format(code, options = {}) {
  const error = registry.getError(code);
  if (!error) {
    return options.json
      ? { error: "not_found", code }
      : `Error code not found: ${code}`;
  }

  if (options.json) {
    return formatter.formatJSON(code, error);
  }

  if (options.compact) {
    return formatter.formatCompact(code, error);
  }

  return formatter.formatTerminal(code, error);
}

/**
 * List errors with optional filtering
 * @param {object} [options] - Filter options
 * @param {string} [options.category] - Filter by category
 * @param {string} [options.severity] - Filter by severity
 * @param {boolean} [options.autoIssueOnly] - Only errors with auto_issue=true
 * @param {boolean} [options.json] - Return as JSON array
 * @returns {string|object[]} Formatted list or JSON array
 */
function list(options = {}) {
  let errors;

  if (options.category) {
    errors = registry.getByCategory(options.category);
  } else if (options.severity) {
    errors = registry.getBySeverity(options.severity);
  } else if (options.autoIssueOnly) {
    errors = registry.getAutoIssueErrors();
  } else {
    // Get all errors
    const codes = registry.getAllCodes();
    errors = {};
    for (const code of codes) {
      errors[code] = registry.getError(code);
    }
  }

  if (options.json) {
    return formatter.formatListJSON(errors);
  }

  return formatter.formatList(errors);
}

/**
 * Validate an error code format
 * @param {string} code - Error code to validate
 * @returns {boolean} True if valid format
 */
function isValid(code) {
  return registry.isValidCode(code);
}

/**
 * Check if error code exists in registry
 * @param {string} code - Error code
 * @returns {boolean} True if exists
 */
function exists(code) {
  return registry.getError(code) !== null;
}

/**
 * Get all available categories
 * @returns {string[]} Category names
 */
function getCategories() {
  return registry.getCategories();
}

/**
 * Get all error codes
 * @returns {string[]} Array of error codes
 */
function getCodes() {
  return registry.getAllCodes();
}

/**
 * Check if an error should trigger auto-issue creation
 * @param {string} code - Error code
 * @returns {boolean} True if should create issue
 */
function shouldCreateIssue(code) {
  const error = registry.getError(code);
  return error?.auto_issue === true;
}

/**
 * Get labels for GitHub issue creation
 * @param {string} code - Error code
 * @returns {string[]} Array of labels
 */
function getLabels(code) {
  const error = registry.getError(code);
  return error?.labels || ["ralph-error"];
}

/**
 * Format error for GitHub issue body
 * @param {string} code - Error code
 * @param {object} context - Context information
 * @returns {string} Markdown formatted issue body
 */
function formatForIssue(code, context = {}) {
  const error = registry.getError(code);
  if (!error) {
    return `Error code not found: ${code}`;
  }
  return formatter.formatForIssue(code, error, context);
}

/**
 * Get the category for an error code based on its number range
 * @param {string} code - Error code
 * @returns {string} Category name
 */
function getCategoryFromCode(code) {
  return registry.getCategoryFromCode(code);
}

/**
 * Get registry metadata
 * @returns {object} Metadata including version and ranges
 */
function getMeta() {
  return registry.getMeta();
}

// Export everything
module.exports = {
  // Main functions
  lookup,
  format,
  list,
  isValid,
  exists,

  // Helper functions
  getCategories,
  getCodes,
  shouldCreateIssue,
  getLabels,
  formatForIssue,
  getCategoryFromCode,
  getMeta,

  // Re-export submodules for advanced usage
  registry,
  formatter,
};
