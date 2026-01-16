/**
 * Metrics Builder - Type-safe metrics record builder for Ralph CLI
 *
 * Replaces 27-argument bash function with JSON object API.
 * Provides schema validation and consistent record structure.
 *
 * @module lib/metrics/builder
 */

const { METRICS_SCHEMA, ALL_METRICS_FIELDS } = require("./schema");

/**
 * Build a metrics record from input data with validation
 *
 * @param {Object} data - Metrics data object
 * @param {string} data.storyId - Story identifier (required)
 * @param {string} [data.storyTitle] - Story title
 * @param {number} [data.duration] - Duration in seconds
 * @param {number|null} [data.inputTokens] - Input tokens
 * @param {number|null} [data.outputTokens] - Output tokens
 * @param {string} [data.agent] - Agent type (claude, codex, droid)
 * @param {string|null} [data.model] - Model name
 * @param {string} [data.status] - Status (success, error)
 * @param {string} [data.runId] - Run identifier
 * @param {number|null} [data.iteration] - Iteration number
 * @param {number} [data.retryCount] - Number of retries
 * @param {number} [data.retryTime] - Time spent on retries (seconds)
 * @param {number|null} [data.complexityScore] - Complexity score
 * @param {string|null} [data.routingReason] - Routing decision reason
 * @param {number|null} [data.estimatedCost] - Estimated cost
 * @param {string} [data.timestamp] - ISO 8601 timestamp
 * @param {string|null} [data.experimentName] - Experiment name
 * @param {string|null} [data.experimentVariant] - Experiment variant
 * @param {boolean} [data.experimentExcluded] - Excluded from experiment
 * @param {number} [data.rollbackCount] - Number of rollbacks
 * @param {string|null} [data.rollbackReason] - Reason for rollback
 * @param {boolean|null} [data.rollbackSuccess] - Whether rollback succeeded
 * @param {number} [data.switchCount] - Number of agent switches
 * @param {string[]|null} [data.agents] - List of agents tried
 * @param {string|null} [data.failureType] - Type of failure (timeout, error, quality)
 * @param {string|null} [data.retryHistory] - Retry history string
 * @returns {Object} Validated metrics record
 */
function buildMetrics(data = {}) {
  const record = {
    // Required fields
    storyId: normalizeString(data.storyId) || "unknown",
    timestamp: data.timestamp || new Date().toISOString(),

    // Core metrics
    storyTitle: normalizeString(data.storyTitle) || "",
    duration: normalizeNumber(data.duration) || 0,
    inputTokens: normalizeNullableNumber(data.inputTokens),
    outputTokens: normalizeNullableNumber(data.outputTokens),
    agent: normalizeString(data.agent) || "unknown",
    model: normalizeNullableString(data.model),
    status: normalizeString(data.status) || "error",
    runId: normalizeNullableString(data.runId),
    iteration: normalizeNullableNumber(data.iteration),

    // Retry statistics
    retryCount: normalizeNumber(data.retryCount) || 0,
    retryTime: normalizeNumber(data.retryTime) || 0,

    // Routing data
    complexityScore: normalizeNullableNumber(data.complexityScore),
    routingReason: normalizeNullableString(data.routingReason),
    estimatedCost: normalizeNullableNumber(data.estimatedCost),
    actualCost: normalizeNullableNumber(data.actualCost),

    // Fix tracking
    fixSuccessRate: normalizeNullableNumber(data.fixSuccessRate),
    fixesAttempted: normalizeNullableNumber(data.fixesAttempted),
    fixesSucceeded: normalizeNullableNumber(data.fixesSucceeded),
    fixesFailed: normalizeNullableNumber(data.fixesFailed),
    fixesByType: data.fixesByType || null,

    // Switch tracking (US-004)
    switchCount: normalizeNullableNumber(data.switchCount),
    agents: normalizeAgentsList(data.agents),
    failureType: normalizeNullableString(data.failureType),

    // Rollback tracking (US-004)
    rollbackCount: normalizeNullableNumber(data.rollbackCount),
    rollbackReason: normalizeNullableString(data.rollbackReason),
    rollbackSuccess: normalizeNullableBoolean(data.rollbackSuccess),
  };

  // Add experiment fields only if experimentName is present
  if (data.experimentName) {
    record.experimentName = normalizeString(data.experimentName);
    record.experimentVariant = normalizeNullableString(data.experimentVariant);
    record.experimentExcluded = data.experimentExcluded === true;
  }

  // Add quality signals only if present
  if (data.testsPassed != null) {
    record.testsPassed = Boolean(data.testsPassed);
  }
  if (data.lintClean != null) {
    record.lintClean = Boolean(data.lintClean);
  }
  if (data.typeCheckClean != null) {
    record.typeCheckClean = Boolean(data.typeCheckClean);
  }

  // Add retry history if present
  if (data.retryHistory) {
    record.retryHistory = normalizeString(data.retryHistory);
  }

  return record;
}

/**
 * Normalize a string value (handle null, undefined, "null", empty)
 * @param {*} value - Value to normalize
 * @returns {string} Normalized string or empty string
 */
function normalizeString(value) {
  if (value === null || value === undefined || value === "null" || value === "") {
    return "";
  }
  return String(value);
}

/**
 * Normalize a nullable string value
 * @param {*} value - Value to normalize
 * @returns {string|null} Normalized string or null
 */
function normalizeNullableString(value) {
  if (value === null || value === undefined || value === "null" || value === "") {
    return null;
  }
  return String(value);
}

/**
 * Normalize a number value
 * @param {*} value - Value to normalize
 * @returns {number} Normalized number or 0
 */
function normalizeNumber(value) {
  if (value === null || value === undefined || value === "null" || value === "") {
    return 0;
  }
  const num = Number(value);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalize a nullable number value
 * @param {*} value - Value to normalize
 * @returns {number|null} Normalized number or null
 */
function normalizeNullableNumber(value) {
  if (value === null || value === undefined || value === "null" || value === "") {
    return null;
  }
  const num = Number(value);
  return isNaN(num) ? null : num;
}

/**
 * Normalize a nullable boolean value
 * @param {*} value - Value to normalize
 * @returns {boolean|null} Normalized boolean or null
 */
function normalizeNullableBoolean(value) {
  if (value === null || value === undefined || value === "null") {
    return null;
  }
  if (value === "true" || value === true) {
    return true;
  }
  if (value === "false" || value === false) {
    return false;
  }
  return null;
}

/**
 * Normalize agents list (handle comma-separated string or array)
 * @param {*} value - Value to normalize
 * @returns {string[]|null} Normalized array or null
 */
function normalizeAgentsList(value) {
  if (value === null || value === undefined || value === "null" || value === "") {
    return null;
  }
  if (Array.isArray(value)) {
    return value.filter((v) => v && v !== "null");
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && s !== "null");
  }
  return null;
}

/**
 * Serialize a metrics record to JSON line format
 * @param {Object} record - Record to serialize
 * @returns {string} JSON line
 */
function serializeMetrics(record) {
  return JSON.stringify(record);
}

/**
 * Parse JSON input into a metrics record
 * Handles both JSON string and object input
 * @param {string|Object} input - JSON string or object
 * @returns {Object} Parsed and normalized metrics record
 * @throws {Error} If input is invalid JSON
 */
function parseMetricsInput(input) {
  let data;

  if (typeof input === "string") {
    try {
      data = JSON.parse(input);
    } catch (err) {
      throw new Error(`Invalid JSON input: ${err.message}`);
    }
  } else if (typeof input === "object" && input !== null) {
    data = input;
  } else {
    throw new Error("Input must be a JSON string or object");
  }

  return buildMetrics(data);
}

/**
 * Validate a metrics record against schema
 * @param {Object} record - Record to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateMetrics(record) {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["Record must be an object"] };
  }

  // Check required fields
  if (!record.storyId || record.storyId === "unknown") {
    errors.push("storyId is required");
  }
  if (!record.timestamp) {
    errors.push("timestamp is required");
  }

  // Check status enum
  const validStatuses = ["success", "error"];
  if (record.status && !validStatuses.includes(record.status)) {
    errors.push(`status must be one of: ${validStatuses.join(", ")}`);
  }

  // Check agent enum
  const validAgents = ["claude", "codex", "droid", "unknown"];
  if (record.agent && !validAgents.includes(record.agent)) {
    errors.push(`agent must be one of: ${validAgents.join(", ")}`);
  }

  // Check numeric fields are numbers
  const numericFields = [
    "duration",
    "inputTokens",
    "outputTokens",
    "iteration",
    "retryCount",
    "retryTime",
    "complexityScore",
    "estimatedCost",
    "actualCost",
    "switchCount",
    "rollbackCount",
  ];
  for (const field of numericFields) {
    if (record[field] !== null && record[field] !== undefined) {
      if (typeof record[field] !== "number") {
        errors.push(`${field} must be a number`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a minimal valid metrics record (for testing/defaults)
 * @param {string} storyId - Story ID
 * @returns {Object} Minimal valid record
 */
function createMinimalRecord(storyId) {
  return buildMetrics({
    storyId,
    status: "success",
    duration: 0,
    agent: "claude",
  });
}

module.exports = {
  buildMetrics,
  serializeMetrics,
  parseMetricsInput,
  validateMetrics,
  createMinimalRecord,
  // Expose normalization utilities for testing
  normalizeString,
  normalizeNullableString,
  normalizeNumber,
  normalizeNullableNumber,
  normalizeNullableBoolean,
  normalizeAgentsList,
};
