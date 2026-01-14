/**
 * Checkpoint module - main entry point
 *
 * Provides checkpoint save/load/management for resumable builds.
 * Checkpoints capture loop state before each story execution,
 * enabling builds to resume after interruption.
 */
const fs = require("fs");
const path = require("path");

const { createCheckpoint, validateCheckpoint, isCompatible, CHECKPOINT_VERSION } = require("./schema");

/**
 * Get the checkpoint file path for a PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @returns {string} Path to checkpoint.json
 */
function getCheckpointPath(prdFolder) {
  return path.join(prdFolder, "checkpoint.json");
}

/**
 * Get the checkpoints history folder path
 * @param {string} prdFolder - Path to PRD-N folder
 * @returns {string} Path to checkpoints/ folder
 */
function getCheckpointsDir(prdFolder) {
  return path.join(prdFolder, "checkpoints");
}

/**
 * Maximum number of checkpoint history files to keep
 */
const MAX_CHECKPOINT_HISTORY = 3;

/**
 * Rotate current checkpoint to history folder and prune old checkpoints
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {Object} currentCheckpoint - Current checkpoint being replaced
 */
function rotateCheckpointHistory(prdFolder, currentCheckpoint) {
  try {
    const checkpointsDir = getCheckpointsDir(prdFolder);

    // Ensure history directory exists
    if (!fs.existsSync(checkpointsDir)) {
      fs.mkdirSync(checkpointsDir, { recursive: true });
    }

    // Create timestamp-based filename for archived checkpoint
    const timestamp = currentCheckpoint.created_at
      ? new Date(currentCheckpoint.created_at).toISOString().replace(/[:.]/g, "-")
      : new Date().toISOString().replace(/[:.]/g, "-");
    const historyFile = path.join(checkpointsDir, `checkpoint-${timestamp}.json`);

    // Save current checkpoint to history
    fs.writeFileSync(historyFile, JSON.stringify(currentCheckpoint, null, 2) + "\n");

    // Prune old checkpoints - keep only the last MAX_CHECKPOINT_HISTORY
    const historyFiles = fs.readdirSync(checkpointsDir)
      .filter((f) => f.startsWith("checkpoint-") && f.endsWith(".json"))
      .sort() // Lexicographic sort works for ISO timestamps
      .reverse(); // Most recent first

    // Remove excess files
    for (let i = MAX_CHECKPOINT_HISTORY; i < historyFiles.length; i++) {
      const oldFile = path.join(checkpointsDir, historyFiles[i]);
      try {
        fs.unlinkSync(oldFile);
      } catch {
        // Ignore removal errors
      }
    }
  } catch {
    // Ignore rotation errors - checkpoint save should still succeed
  }
}

/**
 * Save a checkpoint to the PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {Object} data - Checkpoint data
 * @returns {Object} { success: boolean, path: string, error?: string }
 */
function saveCheckpoint(prdFolder, data) {
  try {
    // Ensure PRD folder exists
    if (!fs.existsSync(prdFolder)) {
      fs.mkdirSync(prdFolder, { recursive: true });
    }

    // Create checkpoint with defaults
    const checkpoint = createCheckpoint(data);

    // Validate before saving
    const validation = validateCheckpoint(checkpoint);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid checkpoint data: ${validation.errors.join(", ")}`,
      };
    }

    const checkpointPath = getCheckpointPath(prdFolder);

    // If a checkpoint already exists, rotate it to history
    if (fs.existsSync(checkpointPath)) {
      try {
        const existingContent = fs.readFileSync(checkpointPath, "utf8");
        const existingCheckpoint = JSON.parse(existingContent);
        rotateCheckpointHistory(prdFolder, existingCheckpoint);
      } catch {
        // Ignore errors reading existing checkpoint
      }
    }

    // Write checkpoint atomically (write to temp, then rename)
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
 * Load a checkpoint from the PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @returns {Object} { success: boolean, checkpoint?: Object, path?: string, error?: string }
 */
function loadCheckpoint(prdFolder) {
  try {
    const checkpointPath = getCheckpointPath(prdFolder);

    if (!fs.existsSync(checkpointPath)) {
      return {
        success: false,
        error: "No checkpoint found",
        notFound: true,
      };
    }

    const content = fs.readFileSync(checkpointPath, "utf8");
    const checkpoint = JSON.parse(content);

    // Validate loaded checkpoint
    const validation = validateCheckpoint(checkpoint);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid checkpoint: ${validation.errors.join(", ")}`,
      };
    }

    // Check compatibility
    if (!isCompatible(checkpoint)) {
      return {
        success: false,
        error: `Checkpoint version ${checkpoint.version} is not compatible with current version ${CHECKPOINT_VERSION}`,
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
 * Clear (remove) the checkpoint from the PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @returns {Object} { success: boolean, error?: string }
 */
function clearCheckpoint(prdFolder) {
  try {
    const checkpointPath = getCheckpointPath(prdFolder);

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
 * List checkpoints across all PRD folders
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {Object} { success: boolean, checkpoints: Array, error?: string }
 */
function listCheckpoints(ralphDir) {
  try {
    const checkpoints = [];

    if (!fs.existsSync(ralphDir)) {
      return { success: true, checkpoints: [] };
    }

    // Find all PRD-N folders
    const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
    const prdFolders = entries
      .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
      .sort((a, b) => {
        const numA = parseInt(a.name.replace(/PRD-/i, ""), 10);
        const numB = parseInt(b.name.replace(/PRD-/i, ""), 10);
        return numA - numB;
      });

    for (const folder of prdFolders) {
      const prdPath = path.join(ralphDir, folder.name);
      const result = loadCheckpoint(prdPath);

      if (result.success) {
        checkpoints.push({
          prdFolder: folder.name,
          prdPath,
          ...result.checkpoint,
        });
      }
    }

    return { success: true, checkpoints };
  } catch (err) {
    return {
      success: false,
      checkpoints: [],
      error: `Failed to list checkpoints: ${err.message}`,
    };
  }
}

/**
 * Check if a checkpoint exists for the PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @returns {boolean} True if checkpoint exists
 */
function hasCheckpoint(prdFolder) {
  const checkpointPath = getCheckpointPath(prdFolder);
  return fs.existsSync(checkpointPath);
}

module.exports = {
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  listCheckpoints,
  hasCheckpoint,
  getCheckpointPath,
  getCheckpointsDir,
  rotateCheckpointHistory,
  // Re-export schema module
  schema: require("./schema"),
  // Convenience exports
  CHECKPOINT_VERSION,
  MAX_CHECKPOINT_HISTORY,
  createCheckpoint,
  validateCheckpoint,
};
