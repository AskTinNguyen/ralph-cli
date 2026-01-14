/**
 * Schema for checkpoint.json - loop state snapshots for resumable builds
 *
 * Checkpoints capture the state of a build run before each story execution,
 * enabling builds to be resumed after interruption without losing progress.
 *
 * Schema fields:
 * - version: Schema version for forward compatibility
 * - created_at: ISO 8601 timestamp of checkpoint creation
 * - prd_id: PRD number (e.g., 1 for PRD-1)
 * - iteration: Current iteration count
 * - story_id: Current story identifier (e.g., "US-001")
 * - git_sha: Git commit SHA at checkpoint
 * - loop_state: Object containing loop execution state
 */

/**
 * Current checkpoint schema version
 * Increment this when making breaking changes to the schema
 */
const CHECKPOINT_VERSION = 1;

/**
 * Schema definition for checkpoint records
 */
const CHECKPOINT_SCHEMA = {
  version: { type: "number", required: true },
  created_at: { type: "string", required: true },
  prd_id: { type: "number", required: true },
  iteration: { type: "number", required: true },
  story_id: { type: "string", required: true },
  git_sha: { type: "string", required: true },
  loop_state: {
    type: "object",
    required: false,
    properties: {
      stories_completed: { type: "array", required: false },
      current_story: { type: "string", required: false },
      agent: { type: "string", required: false },
    },
  },
};

/**
 * Create a new checkpoint record with defaults
 * @param {Object} data - Partial checkpoint data
 * @returns {Object} Complete checkpoint record
 */
function createCheckpoint(data = {}) {
  return {
    version: CHECKPOINT_VERSION,
    created_at: data.created_at || new Date().toISOString(),
    prd_id: data.prd_id || 0,
    iteration: data.iteration || 1,
    story_id: data.story_id || "",
    git_sha: data.git_sha || "",
    loop_state: {
      stories_completed: data.loop_state?.stories_completed || [],
      current_story: data.loop_state?.current_story || data.story_id || "",
      agent: data.loop_state?.agent || "codex",
    },
  };
}

/**
 * Validate a checkpoint record against the schema
 * @param {Object} checkpoint - Checkpoint to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateCheckpoint(checkpoint) {
  const errors = [];

  if (!checkpoint || typeof checkpoint !== "object") {
    return { valid: false, errors: ["Checkpoint must be an object"] };
  }

  // Check version
  if (typeof checkpoint.version !== "number") {
    errors.push("Missing or invalid version field");
  } else if (checkpoint.version > CHECKPOINT_VERSION) {
    errors.push(`Checkpoint version ${checkpoint.version} is newer than supported version ${CHECKPOINT_VERSION}`);
  }

  // Check required string fields
  const requiredStrings = ["created_at", "story_id", "git_sha"];
  for (const field of requiredStrings) {
    if (typeof checkpoint[field] !== "string" || !checkpoint[field]) {
      errors.push(`Missing or invalid ${field} field`);
    }
  }

  // Check required number fields
  const requiredNumbers = ["prd_id", "iteration"];
  for (const field of requiredNumbers) {
    if (typeof checkpoint[field] !== "number") {
      errors.push(`Missing or invalid ${field} field`);
    }
  }

  // Validate created_at is a valid ISO date
  if (checkpoint.created_at) {
    const date = new Date(checkpoint.created_at);
    if (isNaN(date.getTime())) {
      errors.push("created_at must be a valid ISO 8601 date");
    }
  }

  // Validate iteration is positive
  if (typeof checkpoint.iteration === "number" && checkpoint.iteration < 1) {
    errors.push("iteration must be >= 1");
  }

  // Validate prd_id is non-negative
  if (typeof checkpoint.prd_id === "number" && checkpoint.prd_id < 0) {
    errors.push("prd_id must be >= 0");
  }

  // Validate loop_state if present
  if (checkpoint.loop_state !== undefined && checkpoint.loop_state !== null) {
    if (typeof checkpoint.loop_state !== "object") {
      errors.push("loop_state must be an object");
    } else {
      // Validate stories_completed is an array if present
      if (checkpoint.loop_state.stories_completed !== undefined) {
        if (!Array.isArray(checkpoint.loop_state.stories_completed)) {
          errors.push("loop_state.stories_completed must be an array");
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a checkpoint is compatible with the current schema version
 * @param {Object} checkpoint - Checkpoint to check
 * @returns {boolean} True if compatible
 */
function isCompatible(checkpoint) {
  if (!checkpoint || typeof checkpoint.version !== "number") {
    return false;
  }
  return checkpoint.version <= CHECKPOINT_VERSION;
}

module.exports = {
  CHECKPOINT_VERSION,
  CHECKPOINT_SCHEMA,
  createCheckpoint,
  validateCheckpoint,
  isCompatible,
};
