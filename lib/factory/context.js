/**
 * Factory Context Manager - Learning and Context Flow
 *
 * Manages context flow between stages and accumulates learnings
 * across factory runs. Provides project-wide shared learnings pool.
 *
 * @module lib/factory/context
 */
const fs = require("fs");
const path = require("path");

/**
 * Maximum number of learnings to keep per project
 */
const MAX_LEARNINGS = 100;

/**
 * Create a new execution context
 * @param {string} projectRoot - Project root directory
 * @param {string} runDir - Run directory
 * @param {Object} variables - Initial variables
 * @returns {Object} Execution context
 */
function createContext(projectRoot, runDir, variables = {}) {
  // Load existing learnings
  const learnings = loadLearnings(projectRoot);

  return {
    // Project info
    project_root: projectRoot,
    run_dir: runDir,

    // Variables from factory config
    ...variables,

    // Stage results (populated during execution)
    stages: {},

    // Current execution state
    current_stage: null,
    recursion_count: 0,

    // Learnings (read-only reference to project learnings)
    learnings: learnings.learnings || [],

    // Runtime metadata
    started_at: new Date().toISOString(),
    environment: {
      node_version: process.version,
      platform: process.platform,
      cwd: process.cwd(),
    },
  };
}

/**
 * Load learnings from project
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Learnings data
 */
function loadLearnings(projectRoot) {
  const learningsPath = path.join(projectRoot, ".ralph/factory/learnings.json");

  if (!fs.existsSync(learningsPath)) {
    return { learnings: [], version: 1 };
  }

  try {
    return JSON.parse(fs.readFileSync(learningsPath, "utf8"));
  } catch {
    return { learnings: [], version: 1 };
  }
}

/**
 * Save learnings to project
 * @param {string} projectRoot - Project root directory
 * @param {Object} learnings - Learnings data
 */
function saveLearnings(projectRoot, learnings) {
  const factoryDir = path.join(projectRoot, ".ralph/factory");
  const learningsPath = path.join(factoryDir, "learnings.json");

  if (!fs.existsSync(factoryDir)) {
    fs.mkdirSync(factoryDir, { recursive: true });
  }

  // Limit learnings to MAX_LEARNINGS
  if (learnings.learnings && learnings.learnings.length > MAX_LEARNINGS) {
    learnings.learnings = learnings.learnings.slice(-MAX_LEARNINGS);
  }

  fs.writeFileSync(learningsPath, JSON.stringify(learnings, null, 2));
}

/**
 * Save context to file
 * @param {Object} context - Execution context
 * @param {string} contextPath - Path to save
 */
function saveContext(context, contextPath) {
  // Create a serializable copy (remove non-serializable fields)
  const serializable = {
    ...context,
    saved_at: new Date().toISOString(),
  };

  fs.writeFileSync(contextPath, JSON.stringify(serializable, null, 2));
}

/**
 * Load context from file
 * @param {string} contextPath - Path to load from
 * @returns {Object} Loaded context
 */
function loadContext(contextPath) {
  if (!fs.existsSync(contextPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(contextPath, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Add a learning to the project
 * @param {string} projectRoot - Project root directory
 * @param {Object} learning - Learning to add
 */
function addLearning(projectRoot, learning) {
  const data = loadLearnings(projectRoot);

  data.learnings.push({
    ...learning,
    id: `learning-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    added_at: new Date().toISOString(),
  });

  saveLearnings(projectRoot, data);
}

/**
 * Extract learnings from stage output
 * @param {Object} stageResult - Stage execution result
 * @returns {Array} Extracted learnings
 */
function extractLearnings(stageResult) {
  const learnings = [];

  // Extract from failed stages
  if (stageResult.status === "failed") {
    learnings.push({
      type: "failure",
      stage_id: stageResult.stageId,
      error: stageResult.error,
      context: {
        stage_type: stageResult.output?.stage_type,
        command: stageResult.output?.command,
      },
    });
  }

  // Extract from test results
  if (stageResult.output?.test_results) {
    const testResults = stageResult.output.test_results;
    if (testResults.failures && testResults.failures.length > 0) {
      learnings.push({
        type: "test_failure",
        stage_id: stageResult.stageId,
        failures: testResults.failures.slice(0, 3), // First 3 failures
        summary: `${testResults.failed}/${testResults.total} tests failed`,
      });
    }
  }

  // Extract from build results
  if (stageResult.output?.completed_stories !== undefined) {
    learnings.push({
      type: "build_progress",
      stage_id: stageResult.stageId,
      stories_completed: stageResult.output.completed_stories,
      duration: stageResult.duration,
    });
  }

  return learnings;
}

/**
 * Update context with stage results
 * @param {Object} context - Execution context
 * @param {string} stageId - Stage ID
 * @param {Object} result - Stage result
 */
function updateStageResult(context, stageId, result) {
  context.stages[stageId] = {
    status: result.status,
    completed: result.status === "completed",
    passed: result.status === "completed",
    failed: result.status === "failed",
    skipped: result.status === "skipped",
    duration: result.duration,
    output: result.output,
    error: result.error,
    ...result.output,
  };
}

/**
 * Inject context into stage input
 * @param {Object} input - Stage input configuration
 * @param {Object} context - Execution context
 * @returns {Object} Resolved input
 */
function injectContext(input, context) {
  if (!input || typeof input !== "object") {
    return input;
  }

  const resolved = {};

  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      // Resolve {{ variable }} templates
      resolved[key] = value.replace(
        /\{\{\s*([^}]+)\s*\}\}/g,
        (match, path) => {
          const trimmedPath = path.trim();
          const result = getNestedValue(context, trimmedPath);
          return result !== undefined ? String(result) : match;
        }
      );
    } else if (typeof value === "object" && value !== null) {
      resolved[key] = injectContext(value, context);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * Get nested value from object using dot notation
 * @param {Object} obj - Object to query
 * @param {string} path - Dot-separated path
 * @returns {*} Value at path
 */
function getNestedValue(obj, path) {
  const parts = path.split(".");
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

/**
 * Set nested value in object using dot notation
 * @param {Object} obj - Object to modify
 * @param {string} path - Dot-separated path
 * @param {*} value - Value to set
 */
function setNestedValue(obj, path, value) {
  const parts = path.split(".");
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part];
  }

  current[parts[parts.length - 1]] = value;
}

/**
 * Create a summary of context for logging
 * @param {Object} context - Execution context
 * @returns {Object} Summarized context
 */
function summarizeContext(context) {
  const summary = {
    stages_completed: Object.keys(context.stages || {}).filter(
      (id) => context.stages[id]?.completed
    ).length,
    stages_failed: Object.keys(context.stages || {}).filter(
      (id) => context.stages[id]?.failed
    ).length,
    current_stage: context.current_stage,
    recursion_count: context.recursion_count,
    learnings_count: context.learnings?.length || 0,
  };

  // Add stage summaries
  summary.stages = {};
  for (const [id, stage] of Object.entries(context.stages || {})) {
    summary.stages[id] = {
      status: stage.status,
      duration: stage.duration,
      prd_number: stage.prd_number,
    };
  }

  return summary;
}

/**
 * Merge contexts (for parallel stage results)
 * @param {Object} base - Base context
 * @param {Object[]} contexts - Contexts to merge
 * @returns {Object} Merged context
 */
function mergeContexts(base, contexts) {
  const merged = { ...base };

  for (const ctx of contexts) {
    // Merge stage results
    if (ctx.stages) {
      merged.stages = { ...merged.stages, ...ctx.stages };
    }
  }

  return merged;
}

/**
 * Format learnings for injection into prompts
 * @param {Array} learnings - Array of learning objects
 * @param {Object} options - Formatting options
 * @returns {string} Formatted learnings text
 */
function formatLearningsForPrompt(learnings, options = {}) {
  if (!learnings || learnings.length === 0) {
    return "";
  }

  const maxLearnings = options.maxLearnings || 10;
  const recent = learnings.slice(-maxLearnings);

  const lines = ["## Learnings from Previous Runs", ""];

  for (const learning of recent) {
    switch (learning.type) {
      case "failure":
        lines.push(`- **Failure** in stage \`${learning.stage_id}\`: ${learning.error}`);
        break;
      case "test_failure":
        lines.push(`- **Test failures** in \`${learning.stage_id}\`: ${learning.summary}`);
        break;
      case "build_progress":
        lines.push(
          `- **Build progress** in \`${learning.stage_id}\`: ${learning.stories_completed} stories completed`
        );
        break;
      default:
        lines.push(`- ${learning.type}: ${JSON.stringify(learning)}`);
    }
  }

  return lines.join("\n");
}

/**
 * Get user request from context for PRD stages
 * @param {Object} context - Execution context
 * @param {Object} stage - Stage configuration
 * @returns {string} User request text
 */
function getUserRequest(context, stage) {
  // Check stage input
  if (stage.input?.request) {
    return injectContext({ request: stage.input.request }, context).request;
  }

  // Check context variables
  if (context.user_request) {
    return context.user_request;
  }

  return "";
}

module.exports = {
  MAX_LEARNINGS,
  createContext,
  loadLearnings,
  saveLearnings,
  saveContext,
  loadContext,
  addLearning,
  extractLearnings,
  updateStageResult,
  injectContext,
  getNestedValue,
  setNestedValue,
  summarizeContext,
  mergeContexts,
  formatLearningsForPrompt,
  getUserRequest,
};
