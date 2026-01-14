/**
 * Schema for metrics.jsonl - historical run data
 *
 * Each line in metrics.jsonl is a JSON object with run metrics.
 * This enables historical analysis for improving estimation accuracy.
 *
 * Schema fields:
 * - storyId: Story identifier (e.g., "US-001")
 * - storyTitle: Story title
 * - duration: Run duration in seconds
 * - inputTokens: Input tokens consumed (null if unavailable)
 * - outputTokens: Output tokens consumed (null if unavailable)
 * - agent: Agent type used ("claude", "codex", "droid")
 * - model: Specific model used (e.g., "sonnet", "opus", "haiku")
 * - timestamp: ISO 8601 timestamp of run completion
 * - status: Run status ("success" or "error")
 * - runId: Unique run identifier
 * - iteration: Iteration number within the run
 * - retryCount: Number of retries before success (null if no retries)
 * - retryTime: Total time spent waiting for retries in seconds
 * - experimentName: Name of active experiment (null if not in experiment)
 * - experimentVariant: Assigned variant name (null if not in experiment)
 * - experimentExcluded: Whether story was excluded from experiment
 * - testsPassed: Whether tests passed after run (null if not checked)
 * - lintClean: Whether lint passed after run (null if not checked)
 * - typeCheckClean: Whether type check passed after run (null if not checked)
 */

/**
 * Schema definition for metrics records
 */
const METRICS_SCHEMA = {
  storyId: { type: "string", required: true },
  storyTitle: { type: "string", required: false, nullable: true },
  duration: { type: "number", required: true },
  inputTokens: { type: "number", required: false, nullable: true },
  outputTokens: { type: "number", required: false, nullable: true },
  agent: { type: "string", required: true, enum: ["claude", "codex", "droid", "unknown"] },
  model: { type: "string", required: false, nullable: true },
  timestamp: { type: "string", required: true },
  status: { type: "string", required: true, enum: ["success", "error"] },
  runId: { type: "string", required: false, nullable: true },
  iteration: { type: "number", required: false, nullable: true },
  // Retry statistics
  retryCount: { type: "number", required: false, nullable: true },
  retryTime: { type: "number", required: false, nullable: true },
  // Experiment tracking fields
  experimentName: { type: "string", required: false, nullable: true },
  experimentVariant: { type: "string", required: false, nullable: true },
  experimentExcluded: { type: "boolean", required: false, nullable: true },
  // Quality signals
  testsPassed: { type: "boolean", required: false, nullable: true },
  lintClean: { type: "boolean", required: false, nullable: true },
  typeCheckClean: { type: "boolean", required: false, nullable: true },
};

/**
 * Create a new metrics record with defaults
 * @param {Object} data - Partial metrics data
 * @returns {Object} Complete metrics record
 */
function createMetricsRecord(data = {}) {
  const record = {
    storyId: data.storyId || "unknown",
    storyTitle: data.storyTitle || "",
    duration: data.duration || 0,
    inputTokens: data.inputTokens != null ? data.inputTokens : null,
    outputTokens: data.outputTokens != null ? data.outputTokens : null,
    agent: data.agent || "unknown",
    model: data.model || null,
    timestamp: data.timestamp || new Date().toISOString(),
    status: data.status || "error",
    runId: data.runId || null,
    iteration: data.iteration != null ? data.iteration : null,
    // Retry statistics
    retryCount: data.retryCount != null ? data.retryCount : null,
    retryTime: data.retryTime != null ? data.retryTime : null,
  };

  // Add experiment fields only if experimentName is present
  if (data.experimentName) {
    record.experimentName = data.experimentName;
    record.experimentVariant = data.experimentVariant || null;
    record.experimentExcluded = data.experimentExcluded === true;
  }

  // Add quality signals only if any are present
  if (data.testsPassed != null) {
    record.testsPassed = data.testsPassed;
  }
  if (data.lintClean != null) {
    record.lintClean = data.lintClean;
  }
  if (data.typeCheckClean != null) {
    record.typeCheckClean = data.typeCheckClean;
  }

  return record;
}

/**
 * Validate a metrics record against the schema
 * @param {Object} record - Record to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateMetricsRecord(record) {
  const errors = [];

  if (!record || typeof record !== "object") {
    return { valid: false, errors: ["Record must be an object"] };
  }

  for (const [field, schema] of Object.entries(METRICS_SCHEMA)) {
    const value = record[field];

    // Check required fields
    if (schema.required && (value === undefined || value === null || value === "")) {
      // Allow null for nullable fields
      if (!(schema.nullable && value === null)) {
        errors.push(`Missing required field: ${field}`);
        continue;
      }
    }

    // Skip validation if value is null and nullable is true
    if (value === null && schema.nullable) {
      continue;
    }

    // Skip validation if value is undefined (optional field)
    if (value === undefined) {
      continue;
    }

    // Type check
    if (schema.type === "number" && typeof value !== "number") {
      errors.push(`Field ${field} must be a number, got ${typeof value}`);
    }
    if (schema.type === "string" && typeof value !== "string") {
      errors.push(`Field ${field} must be a string, got ${typeof value}`);
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`Field ${field} must be one of: ${schema.enum.join(", ")}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Parse a JSON line into a metrics record
 * Returns null for invalid/corrupt lines
 * @param {string} line - JSON line to parse
 * @returns {Object|null} Parsed record or null if invalid
 */
function parseMetricsLine(line) {
  if (!line || typeof line !== "string") {
    return null;
  }

  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    // Empty line or comment
    return null;
  }

  try {
    const record = JSON.parse(trimmed);
    const validation = validateMetricsRecord(record);

    if (!validation.valid) {
      // Log warning but return partial record for backwards compatibility
      console.warn(`Invalid metrics record: ${validation.errors.join(", ")}`);
      // Still return the record for partial data extraction
      return record;
    }

    return record;
  } catch {
    // Corrupt JSON - return null
    return null;
  }
}

/**
 * Serialize a metrics record to JSON line
 * @param {Object} record - Record to serialize
 * @returns {string} JSON line
 */
function serializeMetricsRecord(record) {
  const validated = createMetricsRecord(record);
  return JSON.stringify(validated);
}

module.exports = {
  METRICS_SCHEMA,
  createMetricsRecord,
  validateMetricsRecord,
  parseMetricsLine,
  serializeMetricsRecord,
};
