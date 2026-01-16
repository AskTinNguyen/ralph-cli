/**
 * Metrics Schema - Type definitions and validation for metrics.jsonl records
 *
 * This schema defines the structure for metrics records in Ralph CLI.
 * It is compatible with the existing lib/estimate/schema.js but provides
 * a cleaner, focused API for metrics building.
 *
 * @module lib/metrics/schema
 */

/**
 * Schema definition for metrics records
 * Each field has: type, required, nullable, enum (optional), description
 */
const METRICS_SCHEMA = {
  // Required fields
  storyId: {
    type: "string",
    required: true,
    nullable: false,
    description: "Story identifier (e.g., US-001)",
  },
  timestamp: {
    type: "string",
    required: true,
    nullable: false,
    description: "ISO 8601 timestamp of record creation",
  },

  // Core metrics
  storyTitle: {
    type: "string",
    required: false,
    nullable: false,
    description: "Human-readable story title",
  },
  duration: {
    type: "number",
    required: false,
    nullable: false,
    description: "Duration in seconds",
  },
  inputTokens: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of input tokens consumed",
  },
  outputTokens: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of output tokens generated",
  },
  agent: {
    type: "string",
    required: false,
    nullable: false,
    enum: ["claude", "codex", "droid", "unknown"],
    description: "Agent type used",
  },
  model: {
    type: "string",
    required: false,
    nullable: true,
    description: "Specific model name (e.g., sonnet, opus)",
  },
  status: {
    type: "string",
    required: false,
    nullable: false,
    enum: ["success", "error"],
    description: "Iteration outcome status",
  },
  runId: {
    type: "string",
    required: false,
    nullable: true,
    description: "Unique run identifier",
  },
  iteration: {
    type: "number",
    required: false,
    nullable: true,
    description: "Iteration number within the run",
  },

  // Retry statistics
  retryCount: {
    type: "number",
    required: false,
    nullable: false,
    description: "Number of retries before success/final failure",
  },
  retryTime: {
    type: "number",
    required: false,
    nullable: false,
    description: "Total time spent waiting for retries (seconds)",
  },
  retryHistory: {
    type: "string",
    required: false,
    nullable: true,
    description: "Retry history string (format: attempt=N status=S duration=Ds|...)",
  },

  // Routing data (US-004)
  complexityScore: {
    type: "number",
    required: false,
    nullable: true,
    description: "Estimated complexity score (0-10)",
  },
  routingReason: {
    type: "string",
    required: false,
    nullable: true,
    description: "Reason for agent routing decision",
  },
  estimatedCost: {
    type: "number",
    required: false,
    nullable: true,
    description: "Estimated cost before execution",
  },
  actualCost: {
    type: "number",
    required: false,
    nullable: true,
    description: "Actual cost after execution",
  },

  // Fix tracking (US-004)
  fixSuccessRate: {
    type: "number",
    required: false,
    nullable: true,
    description: "Fix success rate for this iteration (0-100)",
  },
  fixesAttempted: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of fix attempts made",
  },
  fixesSucceeded: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of successful fixes",
  },
  fixesFailed: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of failed fixes",
  },
  fixesByType: {
    type: "object",
    required: false,
    nullable: true,
    description: "Fix breakdown by type",
  },

  // Switch tracking (US-004)
  switchCount: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of agent switches during iteration",
  },
  agents: {
    type: "array",
    required: false,
    nullable: true,
    description: "List of agents tried during iteration",
  },
  failureType: {
    type: "string",
    required: false,
    nullable: true,
    enum: ["timeout", "error", "quality", null],
    description: "Type of failure that caused switch",
  },

  // Rollback tracking (US-004)
  rollbackCount: {
    type: "number",
    required: false,
    nullable: true,
    description: "Number of rollbacks performed",
  },
  rollbackReason: {
    type: "string",
    required: false,
    nullable: true,
    description: "Reason for rollback",
  },
  rollbackSuccess: {
    type: "boolean",
    required: false,
    nullable: true,
    description: "Whether rollback was successful",
  },

  // Experiment tracking
  experimentName: {
    type: "string",
    required: false,
    nullable: true,
    description: "Name of active experiment",
  },
  experimentVariant: {
    type: "string",
    required: false,
    nullable: true,
    description: "Assigned experiment variant",
  },
  experimentExcluded: {
    type: "boolean",
    required: false,
    nullable: true,
    description: "Whether story was excluded from experiment",
  },

  // Quality signals
  testsPassed: {
    type: "boolean",
    required: false,
    nullable: true,
    description: "Whether tests passed after iteration",
  },
  lintClean: {
    type: "boolean",
    required: false,
    nullable: true,
    description: "Whether lint passed after iteration",
  },
  typeCheckClean: {
    type: "boolean",
    required: false,
    nullable: true,
    description: "Whether type check passed after iteration",
  },
};

/**
 * All field names in the schema
 */
const ALL_METRICS_FIELDS = Object.keys(METRICS_SCHEMA);

/**
 * Required fields that must be present
 */
const REQUIRED_FIELDS = ALL_METRICS_FIELDS.filter(
  (field) => METRICS_SCHEMA[field].required
);

/**
 * Fields that accept null values
 */
const NULLABLE_FIELDS = ALL_METRICS_FIELDS.filter(
  (field) => METRICS_SCHEMA[field].nullable
);

/**
 * Get field type from schema
 * @param {string} field - Field name
 * @returns {string|null} Field type or null if not found
 */
function getFieldType(field) {
  return METRICS_SCHEMA[field]?.type || null;
}

/**
 * Check if a field is required
 * @param {string} field - Field name
 * @returns {boolean} True if required
 */
function isRequired(field) {
  return METRICS_SCHEMA[field]?.required === true;
}

/**
 * Check if a field is nullable
 * @param {string} field - Field name
 * @returns {boolean} True if nullable
 */
function isNullable(field) {
  return METRICS_SCHEMA[field]?.nullable === true;
}

/**
 * Get allowed enum values for a field
 * @param {string} field - Field name
 * @returns {string[]|null} Enum values or null if not an enum field
 */
function getEnumValues(field) {
  return METRICS_SCHEMA[field]?.enum || null;
}

/**
 * Validate a single field value against schema
 * @param {string} field - Field name
 * @param {*} value - Value to validate
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateField(field, value) {
  const schema = METRICS_SCHEMA[field];

  if (!schema) {
    return { valid: true }; // Allow extra fields for extensibility
  }

  // Check required
  if (schema.required && (value === null || value === undefined)) {
    return { valid: false, error: `${field} is required` };
  }

  // Allow null for nullable fields
  if (value === null && schema.nullable) {
    return { valid: true };
  }

  // Skip further validation if undefined (optional field)
  if (value === undefined) {
    return { valid: true };
  }

  // Type check
  const expectedType = schema.type;
  const actualType = Array.isArray(value) ? "array" : typeof value;

  if (expectedType !== actualType) {
    return {
      valid: false,
      error: `${field} must be ${expectedType}, got ${actualType}`,
    };
  }

  // Enum check
  if (schema.enum && !schema.enum.includes(value)) {
    return {
      valid: false,
      error: `${field} must be one of: ${schema.enum.join(", ")}`,
    };
  }

  return { valid: true };
}

module.exports = {
  METRICS_SCHEMA,
  ALL_METRICS_FIELDS,
  REQUIRED_FIELDS,
  NULLABLE_FIELDS,
  getFieldType,
  isRequired,
  isNullable,
  getEnumValues,
  validateField,
};
