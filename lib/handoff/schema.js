/**
 * Schema for handoff.json - Context transfer between agent sessions
 *
 * Handoffs capture the essential context needed to transfer work between
 * AI agent sessions, solving the "context drift" problem common in long
 * conversations. Unlike compaction (which summarizes and loses detail),
 * handoffs preserve critical technical state.
 *
 * Schema fields:
 * - version: Schema version for forward compatibility
 * - id: Unique handoff identifier (handoff-TIMESTAMP-RANDOM)
 * - created_at: ISO 8601 timestamp of handoff creation
 * - parent_id: ID of parent handoff (for thread mapping)
 * - reason: Why the handoff was created (manual, context_limit, time_limit, etc.)
 * - prd_id: PRD number being worked on
 * - iteration: Current build iteration
 * - story_id: Current story identifier
 * - git_sha: Git commit SHA at handoff
 * - summary: Human-readable summary of what was accomplished
 * - state: Detailed state snapshot
 * - remaining_work: Tasks/stories still to be done
 * - blockers: Any blockers or issues encountered
 * - critical_files: Key files to read for context
 * - learnings: Insights accumulated during the session
 * - metadata: Additional metadata (agent, model, duration, etc.)
 */

/**
 * Current handoff schema version
 * Increment this when making breaking changes to the schema
 */
const HANDOFF_VERSION = 1;

/**
 * Reasons for handoff creation
 */
const HANDOFF_REASONS = {
  MANUAL: "manual", // User explicitly requested handoff
  CONTEXT_LIMIT: "context_limit", // Context window threshold reached
  TIME_LIMIT: "time_limit", // Session time limit reached
  ERROR: "error", // Unrecoverable error requiring fresh start
  COMPLETION: "completion", // Task completed, final state capture
  ITERATION_END: "iteration_end", // End of build iteration
  CHECKPOINT: "checkpoint", // Periodic checkpoint during long work
};

/**
 * Schema definition for handoff records
 */
const HANDOFF_SCHEMA = {
  version: { type: "number", required: true },
  id: { type: "string", required: true },
  created_at: { type: "string", required: true },
  parent_id: { type: "string", required: false },
  reason: { type: "string", required: true },
  prd_id: { type: "number", required: false },
  iteration: { type: "number", required: false },
  story_id: { type: "string", required: false },
  git_sha: { type: "string", required: false },
  summary: { type: "string", required: true },
  state: {
    type: "object",
    required: true,
    properties: {
      completed_stories: { type: "array", required: false },
      current_story: { type: "string", required: false },
      agent: { type: "string", required: false },
      model: { type: "string", required: false },
      phase: { type: "string", required: false },
    },
  },
  remaining_work: {
    type: "array",
    required: false,
    items: { type: "object" },
  },
  blockers: {
    type: "array",
    required: false,
    items: { type: "object" },
  },
  critical_files: {
    type: "array",
    required: false,
    items: { type: "string" },
  },
  learnings: {
    type: "array",
    required: false,
    items: { type: "object" },
  },
  metadata: {
    type: "object",
    required: false,
    properties: {
      agent: { type: "string", required: false },
      model: { type: "string", required: false },
      session_duration: { type: "number", required: false },
      context_usage_percent: { type: "number", required: false },
      tokens_used: { type: "number", required: false },
    },
  },
};

/**
 * Generate a unique handoff ID
 * @returns {string} Unique ID in format handoff-TIMESTAMP-RANDOM
 */
function generateHandoffId() {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `handoff-${timestamp}-${random}`;
}

/**
 * Create a new handoff record with defaults
 * @param {Object} data - Partial handoff data
 * @returns {Object} Complete handoff record
 */
function createHandoff(data = {}) {
  const handoff = {
    version: HANDOFF_VERSION,
    id: data.id || generateHandoffId(),
    created_at: data.created_at || new Date().toISOString(),
    parent_id: data.parent_id || null,
    reason: data.reason || HANDOFF_REASONS.MANUAL,
    prd_id: data.prd_id || null,
    iteration: data.iteration || null,
    story_id: data.story_id || null,
    git_sha: data.git_sha || null,
    summary: data.summary || "",
    state: {
      completed_stories: data.state?.completed_stories || [],
      current_story: data.state?.current_story || data.story_id || null,
      agent: data.state?.agent || data.metadata?.agent || "claude",
      model: data.state?.model || data.metadata?.model || null,
      phase: data.state?.phase || "unknown",
    },
    remaining_work: data.remaining_work || [],
    blockers: data.blockers || [],
    critical_files: data.critical_files || [],
    learnings: data.learnings || [],
    metadata: {
      agent: data.metadata?.agent || "claude",
      model: data.metadata?.model || null,
      session_duration: data.metadata?.session_duration || null,
      context_usage_percent: data.metadata?.context_usage_percent || null,
      tokens_used: data.metadata?.tokens_used || null,
      ...data.metadata,
    },
  };

  return handoff;
}

/**
 * Validate a handoff record against the schema
 * @param {Object} handoff - Handoff to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateHandoff(handoff) {
  const errors = [];

  if (!handoff || typeof handoff !== "object") {
    return { valid: false, errors: ["Handoff must be an object"] };
  }

  // Check version
  if (typeof handoff.version !== "number") {
    errors.push("Missing or invalid version field");
  } else if (handoff.version > HANDOFF_VERSION) {
    errors.push(
      `Handoff version ${handoff.version} is newer than supported version ${HANDOFF_VERSION}`
    );
  }

  // Check required fields
  const requiredStrings = ["id", "created_at", "reason", "summary"];
  for (const field of requiredStrings) {
    if (typeof handoff[field] !== "string") {
      errors.push(`Missing or invalid ${field} field`);
    }
  }

  // Validate created_at is a valid ISO date
  if (handoff.created_at) {
    const date = new Date(handoff.created_at);
    if (isNaN(date.getTime())) {
      errors.push("created_at must be a valid ISO 8601 date");
    }
  }

  // Validate reason is a known value
  if (handoff.reason && !Object.values(HANDOFF_REASONS).includes(handoff.reason)) {
    // Allow custom reasons but warn
    // errors.push(`Unknown reason: ${handoff.reason}`);
  }

  // Validate state is an object
  if (handoff.state !== undefined && typeof handoff.state !== "object") {
    errors.push("state must be an object");
  }

  // Validate arrays
  const arrayFields = ["remaining_work", "blockers", "critical_files", "learnings"];
  for (const field of arrayFields) {
    if (handoff[field] !== undefined && !Array.isArray(handoff[field])) {
      errors.push(`${field} must be an array`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Check if a handoff is compatible with the current schema version
 * @param {Object} handoff - Handoff to check
 * @returns {boolean} True if compatible
 */
function isCompatible(handoff) {
  if (!handoff || typeof handoff.version !== "number") {
    return false;
  }
  return handoff.version <= HANDOFF_VERSION;
}

module.exports = {
  HANDOFF_VERSION,
  HANDOFF_REASONS,
  HANDOFF_SCHEMA,
  generateHandoffId,
  createHandoff,
  validateHandoff,
  isCompatible,
};
