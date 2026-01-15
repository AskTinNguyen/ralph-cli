/**
 * Error Registry Module
 *
 * Loads and manages the centralized error definitions from errors.json
 */
const fs = require("fs");
const path = require("path");

// Cache for loaded registry
let registryCache = null;
let registryPath = null;

/**
 * Get the default path to errors.json
 * @returns {string} Path to errors.json
 */
function getDefaultRegistryPath() {
  // Try multiple locations
  const candidates = [
    path.join(__dirname, "../../.agents/ralph/lib/errors.json"),
    path.join(process.cwd(), ".agents/ralph/lib/errors.json"),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return candidates[0]; // Default to first option
}

/**
 * Load the error registry from disk
 * @param {string} [customPath] - Optional custom path to errors.json
 * @returns {object} The error registry object
 */
function loadRegistry(customPath = null) {
  const filePath = customPath || getDefaultRegistryPath();

  // Return cached if same path
  if (registryCache && registryPath === filePath) {
    return registryCache;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    const registry = JSON.parse(content);

    // Remove meta fields for lookups
    const { $schema, _meta, ...errors } = registry;

    registryCache = {
      errors,
      meta: _meta || {},
      path: filePath,
    };
    registryPath = filePath;

    return registryCache;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Error registry not found: ${filePath}`);
    }
    throw new Error(`Failed to load error registry: ${err.message}`);
  }
}

/**
 * Clear the registry cache (useful for testing)
 */
function clearCache() {
  registryCache = null;
  registryPath = null;
}

/**
 * Validate error code format
 * @param {string} code - Error code to validate
 * @returns {boolean} True if valid format
 */
function isValidCode(code) {
  return /^RALPH-[0-9]{3}$/.test(code);
}

/**
 * Get an error definition by code
 * @param {string} code - Error code (e.g., "RALPH-001")
 * @returns {object|null} Error definition or null if not found
 */
function getError(code) {
  if (!isValidCode(code)) {
    return null;
  }

  const registry = loadRegistry();
  return registry.errors[code] || null;
}

/**
 * Get all error codes
 * @returns {string[]} Array of error codes
 */
function getAllCodes() {
  const registry = loadRegistry();
  return Object.keys(registry.errors).sort();
}

/**
 * Get errors filtered by category
 * @param {string} category - Category to filter by (CONFIG, PRD, BUILD, GIT, AGENT, STREAM, INTERNAL)
 * @returns {object} Object with error codes as keys
 */
function getByCategory(category) {
  const registry = loadRegistry();
  const filtered = {};

  for (const [code, error] of Object.entries(registry.errors)) {
    if (error.category === category.toUpperCase()) {
      filtered[code] = error;
    }
  }

  return filtered;
}

/**
 * Get errors filtered by severity
 * @param {string} severity - Severity to filter by (critical, error, warning, info)
 * @returns {object} Object with error codes as keys
 */
function getBySeverity(severity) {
  const registry = loadRegistry();
  const filtered = {};

  for (const [code, error] of Object.entries(registry.errors)) {
    if (error.severity === severity.toLowerCase()) {
      filtered[code] = error;
    }
  }

  return filtered;
}

/**
 * Get errors that trigger auto-issue creation
 * @returns {object} Object with error codes as keys
 */
function getAutoIssueErrors() {
  const registry = loadRegistry();
  const filtered = {};

  for (const [code, error] of Object.entries(registry.errors)) {
    if (error.auto_issue === true) {
      filtered[code] = error;
    }
  }

  return filtered;
}

/**
 * Get the metadata from the registry
 * @returns {object} Registry metadata
 */
function getMeta() {
  const registry = loadRegistry();
  return registry.meta;
}

/**
 * Get all available categories
 * @returns {string[]} Array of category names
 */
function getCategories() {
  return ["CONFIG", "PRD", "BUILD", "GIT", "AGENT", "STREAM", "INTERNAL"];
}

/**
 * Get category description from code range
 * @param {string} code - Error code
 * @returns {string} Category description
 */
function getCategoryFromCode(code) {
  if (!isValidCode(code)) {
    return "UNKNOWN";
  }

  const num = parseInt(code.replace("RALPH-", ""), 10);

  if (num >= 1 && num <= 99) return "CONFIG";
  if (num >= 100 && num <= 199) return "PRD";
  if (num >= 200 && num <= 299) return "BUILD";
  if (num >= 300 && num <= 399) return "GIT";
  if (num >= 400 && num <= 499) return "AGENT";
  if (num >= 500 && num <= 599) return "STREAM";
  if (num >= 900 && num <= 999) return "INTERNAL";

  return "UNKNOWN";
}

module.exports = {
  loadRegistry,
  clearCache,
  isValidCode,
  getError,
  getAllCodes,
  getByCategory,
  getBySeverity,
  getAutoIssueErrors,
  getMeta,
  getCategories,
  getCategoryFromCode,
  getDefaultRegistryPath,
};
