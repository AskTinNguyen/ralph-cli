/**
 * Experiment manager - handles experiment CRUD operations
 *
 * Experiments are stored as JSON files in `.ralph/experiments/<name>.json`
 * This module provides functions to create, read, update, and delete experiments.
 */
const fs = require("fs");
const path = require("path");

const { validateExperiment, createExperiment, createDefaultExperiment } = require("./schema");

/**
 * Get the experiments directory path
 * @param {string} projectRoot - Project root directory
 * @returns {string} Path to experiments directory
 */
function getExperimentsDir(projectRoot) {
  return path.join(projectRoot, ".ralph", "experiments");
}

/**
 * Ensure the experiments directory exists
 * @param {string} projectRoot - Project root directory
 * @returns {string} Path to experiments directory
 */
function ensureExperimentsDir(projectRoot) {
  const dir = getExperimentsDir(projectRoot);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the file path for an experiment
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {string} Path to experiment file
 */
function getExperimentPath(projectRoot, name) {
  const dir = getExperimentsDir(projectRoot);
  // Sanitize name for filesystem
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
  return path.join(dir, `${safeName}.json`);
}

/**
 * Check if an experiment exists
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {boolean} True if experiment exists
 */
function experimentExists(projectRoot, name) {
  const filePath = getExperimentPath(projectRoot, name);
  return fs.existsSync(filePath);
}

/**
 * Save an experiment to disk
 * @param {string} projectRoot - Project root directory
 * @param {Object} experiment - Experiment configuration
 * @returns {Object} { success: boolean, error?: string, path?: string }
 */
function saveExperiment(projectRoot, experiment) {
  // Validate experiment
  const validation = validateExperiment(experiment);
  if (!validation.valid) {
    return {
      success: false,
      error: `Invalid experiment: ${validation.errors.join(", ")}`,
    };
  }

  // Ensure directory exists
  ensureExperimentsDir(projectRoot);

  // Save to file
  const filePath = getExperimentPath(projectRoot, experiment.name);
  try {
    fs.writeFileSync(filePath, JSON.stringify(experiment, null, 2));
    return { success: true, path: filePath };
  } catch (err) {
    return { success: false, error: `Failed to save experiment: ${err.message}` };
  }
}

/**
 * Load an experiment from disk
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function loadExperiment(projectRoot, name) {
  const filePath = getExperimentPath(projectRoot, name);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Experiment not found: ${name}` };
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const experiment = JSON.parse(content);
    return { success: true, experiment };
  } catch (err) {
    return { success: false, error: `Failed to load experiment: ${err.message}` };
  }
}

/**
 * Create a new experiment
 * @param {string} projectRoot - Project root directory
 * @param {Object} data - Experiment data
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function createNewExperiment(projectRoot, data) {
  // Check if experiment already exists
  if (experimentExists(projectRoot, data.name)) {
    return { success: false, error: `Experiment already exists: ${data.name}` };
  }

  // Create experiment with defaults
  const experiment = createExperiment(data);

  // Validate
  const validation = validateExperiment(experiment);
  if (!validation.valid) {
    return {
      success: false,
      error: `Invalid experiment configuration: ${validation.errors.join(", ")}`,
    };
  }

  // Save
  const saveResult = saveExperiment(projectRoot, experiment);
  if (!saveResult.success) {
    return saveResult;
  }

  return { success: true, experiment, path: saveResult.path };
}

/**
 * Create a default experiment comparing two agents
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @param {string} controlAgent - Control agent
 * @param {string} treatmentAgent - Treatment agent
 * @param {Object} options - Additional options
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function createQuickExperiment(projectRoot, name, controlAgent = "claude", treatmentAgent = "codex", options = {}) {
  const experiment = createDefaultExperiment(name, controlAgent, treatmentAgent, options);
  return createNewExperiment(projectRoot, experiment);
}

/**
 * List all experiments
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Filter options { status?: string }
 * @returns {Object} { success: boolean, experiments?: Object[], error?: string }
 */
function listExperiments(projectRoot, options = {}) {
  const dir = getExperimentsDir(projectRoot);

  if (!fs.existsSync(dir)) {
    return { success: true, experiments: [] };
  }

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    const experiments = [];

    for (const file of files) {
      const filePath = path.join(dir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const experiment = JSON.parse(content);

        // Filter by status if specified
        if (options.status && experiment.status !== options.status) {
          continue;
        }

        experiments.push(experiment);
      } catch {
        // Skip invalid files
        continue;
      }
    }

    // Sort by updatedAt descending
    experiments.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return { success: true, experiments };
  } catch (err) {
    return { success: false, error: `Failed to list experiments: ${err.message}` };
  }
}

/**
 * Get the currently running experiment (if any)
 * @param {string} projectRoot - Project root directory
 * @returns {Object|null} Running experiment or null
 */
function getRunningExperiment(projectRoot) {
  const result = listExperiments(projectRoot, { status: "running" });
  if (!result.success || result.experiments.length === 0) {
    return null;
  }
  // Return the most recently updated running experiment
  return result.experiments[0];
}

/**
 * Update an experiment's status
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @param {string} status - New status
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function updateExperimentStatus(projectRoot, name, status) {
  const loadResult = loadExperiment(projectRoot, name);
  if (!loadResult.success) {
    return loadResult;
  }

  const experiment = loadResult.experiment;

  // Validate status transition
  const validStatuses = ["draft", "running", "paused", "concluded"];
  if (!validStatuses.includes(status)) {
    return { success: false, error: `Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}` };
  }

  // Prevent starting concluded experiments
  if (experiment.status === "concluded" && status === "running") {
    return { success: false, error: "Cannot restart a concluded experiment. Create a new experiment instead." };
  }

  experiment.status = status;
  experiment.updatedAt = new Date().toISOString();

  const saveResult = saveExperiment(projectRoot, experiment);
  if (!saveResult.success) {
    return saveResult;
  }

  return { success: true, experiment };
}

/**
 * Start an experiment (set status to "running")
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function startExperiment(projectRoot, name) {
  // Check if another experiment is already running
  const running = getRunningExperiment(projectRoot);
  if (running && running.name !== name) {
    return {
      success: false,
      error: `Another experiment is already running: ${running.name}. Pause or conclude it first.`,
    };
  }

  return updateExperimentStatus(projectRoot, name, "running");
}

/**
 * Pause an experiment (set status to "paused")
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function pauseExperiment(projectRoot, name) {
  return updateExperimentStatus(projectRoot, name, "paused");
}

/**
 * Conclude an experiment (set status to "concluded")
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function concludeExperiment(projectRoot, name) {
  return updateExperimentStatus(projectRoot, name, "concluded");
}

/**
 * Delete an experiment
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @returns {Object} { success: boolean, error?: string }
 */
function deleteExperiment(projectRoot, name) {
  const filePath = getExperimentPath(projectRoot, name);

  if (!fs.existsSync(filePath)) {
    return { success: false, error: `Experiment not found: ${name}` };
  }

  try {
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (err) {
    return { success: false, error: `Failed to delete experiment: ${err.message}` };
  }
}

/**
 * Update experiment metadata (description, metrics, samples, etc.)
 * @param {string} projectRoot - Project root directory
 * @param {string} name - Experiment name
 * @param {Object} updates - Fields to update
 * @returns {Object} { success: boolean, experiment?: Object, error?: string }
 */
function updateExperiment(projectRoot, name, updates) {
  const loadResult = loadExperiment(projectRoot, name);
  if (!loadResult.success) {
    return loadResult;
  }

  const experiment = loadResult.experiment;

  // Apply updates (excluding name which is immutable)
  const allowedFields = ["description", "metrics", "minSamples", "maxSamples", "duration", "exclusions"];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      experiment[field] = updates[field];
    }
  }

  experiment.updatedAt = new Date().toISOString();

  // Validate updated experiment
  const validation = validateExperiment(experiment);
  if (!validation.valid) {
    return {
      success: false,
      error: `Invalid experiment after update: ${validation.errors.join(", ")}`,
    };
  }

  const saveResult = saveExperiment(projectRoot, experiment);
  if (!saveResult.success) {
    return saveResult;
  }

  return { success: true, experiment };
}

module.exports = {
  getExperimentsDir,
  ensureExperimentsDir,
  getExperimentPath,
  experimentExists,
  saveExperiment,
  loadExperiment,
  createNewExperiment,
  createQuickExperiment,
  listExperiments,
  getRunningExperiment,
  updateExperimentStatus,
  startExperiment,
  pauseExperiment,
  concludeExperiment,
  deleteExperiment,
  updateExperiment,
};
