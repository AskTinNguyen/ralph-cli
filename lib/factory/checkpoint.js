/**
 * Factory Checkpoint Module
 *
 * Handles checkpointing for factory runs, enabling resumable execution
 * after interruption or failure.
 *
 * Supports both legacy checkpoints and FSM state serialization.
 *
 * @module lib/factory/checkpoint
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

/**
 * Checkpoint version for compatibility checking
 * v1.0 - Original legacy format
 * v2.0 - FSM state machine format
 */
const CHECKPOINT_VERSION = "1.0";
const CHECKPOINT_VERSION_FSM = "2.0";

/**
 * Create a factory checkpoint
 * @param {Object} data - Checkpoint data
 * @returns {Object} Complete checkpoint object
 */
function createCheckpoint(data) {
  return {
    version: CHECKPOINT_VERSION,
    factory_name: data.factory_name,
    run_id: data.run_id,
    current_stage: data.current_stage,
    completed_stages: data.completed_stages || [],
    failed_stages: data.failed_stages || [],
    skipped_stages: data.skipped_stages || [],
    recursion_count: data.recursion_count || 0,
    context_hash: data.context_hash || null,
    created_at: new Date().toISOString(),
    git_sha: getGitSha(),
    ...data,
  };
}

/**
 * Get current git SHA
 * @returns {string|null} Git SHA or null
 */
function getGitSha() {
  try {
    const { execSync } = require("child_process");
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Hash context for change detection
 * @param {Object} context - Context object
 * @returns {string} SHA256 hash
 */
function hashContext(context) {
  const content = JSON.stringify({
    variables: context.variables,
    stages: Object.keys(context.stages || {}),
  });
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Save factory checkpoint
 * @param {string} runDir - Run directory
 * @param {Object} checkpointData - Checkpoint data
 * @returns {Object} { success: boolean, path?: string, error?: string }
 */
function saveCheckpoint(runDir, checkpointData) {
  try {
    const checkpoint = createCheckpoint(checkpointData);
    const checkpointPath = path.join(runDir, "checkpoint.json");

    // Write atomically
    const tempPath = `${checkpointPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2) + "\n");
    fs.renameSync(tempPath, checkpointPath);

    return {
      success: true,
      path: checkpointPath,
      checkpoint,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to save checkpoint: ${err.message}`,
    };
  }
}

/**
 * Load factory checkpoint
 * @param {string} runDir - Run directory
 * @returns {Object} { success: boolean, checkpoint?: Object, error?: string }
 */
function loadCheckpoint(runDir) {
  try {
    const checkpointPath = path.join(runDir, "checkpoint.json");

    if (!fs.existsSync(checkpointPath)) {
      return {
        success: false,
        error: "No checkpoint found",
        notFound: true,
      };
    }

    const content = fs.readFileSync(checkpointPath, "utf8");
    const checkpoint = JSON.parse(content);

    // Validate version
    if (checkpoint.version !== CHECKPOINT_VERSION) {
      return {
        success: false,
        error: `Incompatible checkpoint version: ${checkpoint.version}`,
      };
    }

    return {
      success: true,
      checkpoint,
      path: checkpointPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load checkpoint: ${err.message}`,
    };
  }
}

/**
 * Clear factory checkpoint
 * @param {string} runDir - Run directory
 * @returns {Object} { success: boolean, error?: string }
 */
function clearCheckpoint(runDir) {
  try {
    const checkpointPath = path.join(runDir, "checkpoint.json");

    if (fs.existsSync(checkpointPath)) {
      fs.unlinkSync(checkpointPath);
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to clear checkpoint: ${err.message}`,
    };
  }
}

/**
 * Check if checkpoint exists
 * @param {string} runDir - Run directory
 * @returns {boolean}
 */
function hasCheckpoint(runDir) {
  const checkpointPath = path.join(runDir, "checkpoint.json");
  return fs.existsSync(checkpointPath);
}

/**
 * Update checkpoint after stage completion
 * @param {string} runDir - Run directory
 * @param {string} stageId - Completed stage ID
 * @param {string} status - Stage status (completed, failed, skipped)
 * @param {Object} context - Current context
 * @returns {Object} { success: boolean, error?: string }
 */
function updateCheckpoint(runDir, stageId, status, context) {
  const loadResult = loadCheckpoint(runDir);

  let checkpoint;
  if (loadResult.success) {
    checkpoint = loadResult.checkpoint;
  } else if (loadResult.notFound) {
    // Create new checkpoint
    checkpoint = createCheckpoint({
      factory_name: context.factory_name || "unknown",
      run_id: path.basename(runDir),
    });
  } else {
    return loadResult;
  }

  // Update stage lists
  switch (status) {
    case "completed":
      if (!checkpoint.completed_stages.includes(stageId)) {
        checkpoint.completed_stages.push(stageId);
      }
      break;
    case "failed":
      if (!checkpoint.failed_stages.includes(stageId)) {
        checkpoint.failed_stages.push(stageId);
      }
      break;
    case "skipped":
      if (!checkpoint.skipped_stages.includes(stageId)) {
        checkpoint.skipped_stages.push(stageId);
      }
      break;
  }

  // Update current stage
  checkpoint.current_stage = stageId;
  checkpoint.context_hash = hashContext(context);
  checkpoint.updated_at = new Date().toISOString();

  return saveCheckpoint(runDir, checkpoint);
}

/**
 * Get stages to execute based on checkpoint
 * @param {Array} allStages - All stage IDs in execution order
 * @param {Object} checkpoint - Checkpoint data
 * @returns {Array} Remaining stages to execute
 */
function getRemainingStages(allStages, checkpoint) {
  if (!checkpoint) {
    return allStages;
  }

  const completed = new Set(checkpoint.completed_stages || []);
  const failed = new Set(checkpoint.failed_stages || []);
  const skipped = new Set(checkpoint.skipped_stages || []);

  // Filter out completed and skipped stages
  // Keep failed stages for potential retry
  return allStages.filter((stageId) => {
    return !completed.has(stageId) && !skipped.has(stageId);
  });
}

/**
 * Validate checkpoint state matches current factory
 * @param {Object} checkpoint - Checkpoint data
 * @param {Object} factory - Parsed factory configuration
 * @returns {Object} { valid: boolean, warnings?: string[], error?: string }
 */
function validateCheckpoint(checkpoint, factory) {
  const warnings = [];

  // Check factory name matches
  if (checkpoint.factory_name !== factory.name) {
    return {
      valid: false,
      error: `Checkpoint is for factory '${checkpoint.factory_name}', not '${factory.name}'`,
    };
  }

  // Check git SHA if available
  const currentSha = getGitSha();
  if (checkpoint.git_sha && currentSha && checkpoint.git_sha !== currentSha) {
    warnings.push(
      `Git SHA changed: checkpoint=${checkpoint.git_sha.slice(0, 8)} current=${currentSha.slice(0, 8)}`
    );
  }

  // Check stage IDs still exist
  const factoryStageIds = new Set(factory.stages.map((s) => s.id));
  for (const stageId of checkpoint.completed_stages || []) {
    if (!factoryStageIds.has(stageId)) {
      warnings.push(`Completed stage '${stageId}' no longer exists in factory`);
    }
  }

  return { valid: true, warnings };
}

/**
 * Create checkpoint before stage execution
 * @param {string} runDir - Run directory
 * @param {string} stageId - Stage about to execute
 * @param {Object} context - Current context
 * @returns {Object} { success: boolean, error?: string }
 */
function checkpointBeforeStage(runDir, stageId, context) {
  const loadResult = loadCheckpoint(runDir);

  let checkpoint;
  if (loadResult.success) {
    checkpoint = loadResult.checkpoint;
  } else if (loadResult.notFound) {
    checkpoint = createCheckpoint({
      factory_name: context.factory_name || "unknown",
      run_id: path.basename(runDir),
    });
  } else {
    return loadResult;
  }

  checkpoint.current_stage = stageId;
  checkpoint.context_hash = hashContext(context);
  checkpoint.updated_at = new Date().toISOString();

  return saveCheckpoint(runDir, checkpoint);
}

// ============================================================================
// FSM State Machine Checkpoint Support
// ============================================================================

/**
 * Create an FSM-aware checkpoint
 * @param {Object} data - Checkpoint data including FSM state
 * @returns {Object} Complete FSM checkpoint object
 */
function createFSMCheckpoint(data) {
  return {
    version: CHECKPOINT_VERSION_FSM,
    factory_name: data.factory_name,
    run_id: data.run_id,
    current_stage: data.current_stage,
    completed_stages: data.completed_stages || [],
    failed_stages: data.failed_stages || [],
    skipped_stages: data.skipped_stages || [],
    recursion_count: data.recursion_count || 0,
    context_hash: data.context_hash || null,
    created_at: new Date().toISOString(),
    git_sha: getGitSha(),
    // FSM-specific state
    fsm_state: data.fsm_state || null,
    ...data,
  };
}

/**
 * Save FSM checkpoint
 * @param {string} runDir - Run directory
 * @param {Object} checkpointData - Checkpoint data including FSM state
 * @returns {Object} { success: boolean, path?: string, error?: string }
 */
function saveFSMCheckpoint(runDir, checkpointData) {
  try {
    const checkpoint = createFSMCheckpoint(checkpointData);
    const checkpointPath = path.join(runDir, "checkpoint.json");

    // Write atomically
    const tempPath = `${checkpointPath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2) + "\n");
    fs.renameSync(tempPath, checkpointPath);

    return {
      success: true,
      path: checkpointPath,
      checkpoint,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to save FSM checkpoint: ${err.message}`,
    };
  }
}

/**
 * Load checkpoint with FSM state awareness
 * @param {string} runDir - Run directory
 * @returns {Object} { success: boolean, checkpoint?: Object, isFSM?: boolean, error?: string }
 */
function loadFSMCheckpoint(runDir) {
  try {
    const checkpointPath = path.join(runDir, "checkpoint.json");

    if (!fs.existsSync(checkpointPath)) {
      return {
        success: false,
        error: "No checkpoint found",
        notFound: true,
      };
    }

    const content = fs.readFileSync(checkpointPath, "utf8");
    const checkpoint = JSON.parse(content);

    // Check version compatibility
    const isFSM = checkpoint.version === CHECKPOINT_VERSION_FSM;

    if (!isFSM && checkpoint.version !== CHECKPOINT_VERSION) {
      return {
        success: false,
        error: `Incompatible checkpoint version: ${checkpoint.version}`,
      };
    }

    return {
      success: true,
      checkpoint,
      isFSM,
      path: checkpointPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load checkpoint: ${err.message}`,
    };
  }
}

/**
 * Update FSM checkpoint after stage completion
 * @param {string} runDir - Run directory
 * @param {string} stageId - Completed stage ID
 * @param {string} status - Stage status
 * @param {Object} context - Current context
 * @param {Object} fsmState - FSM state to save
 * @returns {Object} { success: boolean, error?: string }
 */
function updateFSMCheckpoint(runDir, stageId, status, context, fsmState) {
  const loadResult = loadFSMCheckpoint(runDir);

  let checkpoint;
  if (loadResult.success) {
    checkpoint = loadResult.checkpoint;
  } else if (loadResult.notFound) {
    checkpoint = createFSMCheckpoint({
      factory_name: context.factory_name || "unknown",
      run_id: path.basename(runDir),
    });
  } else {
    return loadResult;
  }

  // Update stage lists
  switch (status) {
    case "completed":
    case "COMPLETED":
      if (!checkpoint.completed_stages.includes(stageId)) {
        checkpoint.completed_stages.push(stageId);
      }
      break;
    case "failed":
    case "FAILED":
      if (!checkpoint.failed_stages.includes(stageId)) {
        checkpoint.failed_stages.push(stageId);
      }
      break;
    case "skipped":
    case "SKIPPED":
      if (!checkpoint.skipped_stages.includes(stageId)) {
        checkpoint.skipped_stages.push(stageId);
      }
      break;
  }

  // Update current stage and FSM state
  checkpoint.current_stage = stageId;
  checkpoint.context_hash = hashContext(context);
  checkpoint.updated_at = new Date().toISOString();
  checkpoint.fsm_state = fsmState;

  return saveFSMCheckpoint(runDir, checkpoint);
}

/**
 * Check if checkpoint contains FSM state
 * @param {string} runDir - Run directory
 * @returns {boolean} True if checkpoint has FSM state
 */
function hasFSMState(runDir) {
  const result = loadFSMCheckpoint(runDir);
  return result.success && result.isFSM && result.checkpoint.fsm_state !== null;
}

/**
 * Get FSM state from checkpoint
 * @param {string} runDir - Run directory
 * @returns {Object|null} FSM state or null
 */
function getFSMState(runDir) {
  const result = loadFSMCheckpoint(runDir);
  if (result.success && result.checkpoint.fsm_state) {
    return result.checkpoint.fsm_state;
  }
  return null;
}

/**
 * Migrate legacy checkpoint to FSM format
 * @param {Object} legacyCheckpoint - Legacy checkpoint data
 * @returns {Object} FSM-compatible checkpoint
 */
function migrateLegacyCheckpoint(legacyCheckpoint) {
  return {
    ...legacyCheckpoint,
    version: CHECKPOINT_VERSION_FSM,
    fsm_state: null, // No FSM state in legacy, will be reconstructed
    migrated_from: legacyCheckpoint.version,
    migrated_at: new Date().toISOString(),
  };
}

module.exports = {
  CHECKPOINT_VERSION,
  CHECKPOINT_VERSION_FSM,
  createCheckpoint,
  hashContext,
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  hasCheckpoint,
  updateCheckpoint,
  getRemainingStages,
  validateCheckpoint,
  checkpointBeforeStage,
  // FSM-specific exports
  createFSMCheckpoint,
  saveFSMCheckpoint,
  loadFSMCheckpoint,
  updateFSMCheckpoint,
  hasFSMState,
  getFSMState,
  migrateLegacyCheckpoint,
};
