/**
 * Assignment module - handles deterministic hash-based variant assignment
 *
 * Uses a simple but effective hash algorithm to consistently assign
 * story IDs to experiment variants. The same story ID will always
 * get the same variant, ensuring experiment validity.
 */
const { loadExperiment, getRunningExperiment } = require("./manager");

/**
 * Simple string hash function (djb2 algorithm)
 * Produces consistent, well-distributed hash values
 * @param {string} str - String to hash
 * @returns {number} 32-bit unsigned integer hash
 */
function djb2Hash(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

/**
 * Generate a deterministic hash for experiment assignment
 * Combines experiment name and story ID for unique assignment per experiment
 * @param {string} experimentName - Name of the experiment
 * @param {string} storyId - Story identifier (e.g., "US-001")
 * @returns {number} Hash value between 0 and 99 (inclusive)
 */
function hashForAssignment(experimentName, storyId) {
  const combined = `${experimentName}:${storyId}`;
  const hash = djb2Hash(combined);
  return hash % 100;
}

/**
 * Check if a story ID matches any exclusion pattern
 * Excluded stories always use the control variant
 * @param {string} storyId - Story identifier
 * @param {string[]} patterns - Array of glob-like patterns
 * @returns {boolean} True if story should be excluded from experiment
 */
function isExcluded(storyId, patterns = []) {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  for (const pattern of patterns) {
    // Convert glob pattern to regex
    // * matches any characters, ? matches single character
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape special regex chars
      .replace(/\*/g, ".*") // * -> .*
      .replace(/\?/g, "."); // ? -> .

    const regex = new RegExp(`^${regexPattern}$`, "i");
    if (regex.test(storyId)) {
      return true;
    }
  }

  return false;
}

/**
 * Assign a variant to a story based on deterministic hashing
 * @param {string} projectRoot - Project root directory
 * @param {string} experimentName - Name of the experiment
 * @param {string} storyId - Story identifier
 * @returns {Object} { success: boolean, variant?: string, agent?: string, excluded?: boolean, error?: string }
 */
function assignVariant(projectRoot, experimentName, storyId) {
  // Load experiment
  const loadResult = loadExperiment(projectRoot, experimentName);
  if (!loadResult.success) {
    return { success: false, error: loadResult.error };
  }

  const experiment = loadResult.experiment;

  // Check if experiment is running
  if (experiment.status !== "running") {
    return {
      success: false,
      error: `Experiment "${experimentName}" is not running (status: ${experiment.status})`,
    };
  }

  // Check exclusions - excluded stories always get control variant
  if (isExcluded(storyId, experiment.exclusions)) {
    const controlVariant = Object.keys(experiment.variants).find(
      (v) => v === "control" || experiment.variants[v].weight >= 50
    );
    return {
      success: true,
      variant: controlVariant || Object.keys(experiment.variants)[0],
      agent: experiment.variants[controlVariant || Object.keys(experiment.variants)[0]].agent,
      excluded: true,
    };
  }

  // Calculate hash and assign variant
  const hashValue = hashForAssignment(experimentName, storyId);

  // Sort variants by name for consistent ordering
  const variantNames = Object.keys(experiment.variants).sort();

  // Build cumulative weight ranges
  let cumulativeWeight = 0;
  for (const variantName of variantNames) {
    cumulativeWeight += experiment.variants[variantName].weight;
    if (hashValue < cumulativeWeight) {
      return {
        success: true,
        variant: variantName,
        agent: experiment.variants[variantName].agent,
        model: experiment.variants[variantName].model || null,
        excluded: false,
      };
    }
  }

  // Fallback to first variant (should not happen if weights sum to 100)
  const fallbackVariant = variantNames[0];
  return {
    success: true,
    variant: fallbackVariant,
    agent: experiment.variants[fallbackVariant].agent,
    excluded: false,
  };
}

/**
 * Get assignment for the currently running experiment
 * @param {string} projectRoot - Project root directory
 * @param {string} storyId - Story identifier
 * @returns {Object} { success: boolean, experimentName?: string, variant?: string, agent?: string, excluded?: boolean, error?: string }
 */
function getAssignmentForStory(projectRoot, storyId) {
  const runningExperiment = getRunningExperiment(projectRoot);
  if (!runningExperiment) {
    return { success: false, error: "No running experiment" };
  }

  const result = assignVariant(projectRoot, runningExperiment.name, storyId);
  if (result.success) {
    return {
      ...result,
      experimentName: runningExperiment.name,
    };
  }
  return result;
}

/**
 * Verify that hash distribution matches expected weights
 * @param {string} projectRoot - Project root directory
 * @param {string} experimentName - Name of the experiment
 * @param {number} sampleSize - Number of samples to test (default: 1000)
 * @param {number} tolerance - Acceptable deviation percentage (default: 5)
 * @returns {Object} { success: boolean, distribution?: Object, withinTolerance?: boolean, error?: string }
 */
function verifyDistribution(projectRoot, experimentName, sampleSize = 1000, tolerance = 5) {
  // Load experiment
  const loadResult = loadExperiment(projectRoot, experimentName);
  if (!loadResult.success) {
    return { success: false, error: loadResult.error };
  }

  const experiment = loadResult.experiment;
  const variants = experiment.variants;
  const variantNames = Object.keys(variants);

  // Count assignments for random story IDs
  const counts = {};
  for (const name of variantNames) {
    counts[name] = 0;
  }

  for (let i = 0; i < sampleSize; i++) {
    // Generate pseudo-random story ID
    const storyId = `TEST-${i}-${Math.random().toString(36).substring(7)}`;
    const hashValue = hashForAssignment(experimentName, storyId);

    // Determine variant using same logic as assignVariant
    const sortedVariants = variantNames.slice().sort();
    let cumulativeWeight = 0;
    for (const variantName of sortedVariants) {
      cumulativeWeight += variants[variantName].weight;
      if (hashValue < cumulativeWeight) {
        counts[variantName]++;
        break;
      }
    }
  }

  // Calculate actual percentages and check tolerance
  const distribution = {};
  let withinTolerance = true;

  for (const name of variantNames) {
    const actual = (counts[name] / sampleSize) * 100;
    const expected = variants[name].weight;
    const deviation = Math.abs(actual - expected);

    distribution[name] = {
      expected,
      actual: parseFloat(actual.toFixed(2)),
      deviation: parseFloat(deviation.toFixed(2)),
      count: counts[name],
    };

    if (deviation > tolerance) {
      withinTolerance = false;
    }
  }

  return {
    success: true,
    distribution,
    withinTolerance,
    sampleSize,
    tolerance,
  };
}

/**
 * Get assignment as a shell-friendly string for loop.sh integration
 * Outputs: EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED
 * @param {string} projectRoot - Project root directory
 * @param {string} storyId - Story identifier
 * @returns {string} Pipe-delimited assignment string or empty if no experiment
 */
function getAssignmentString(projectRoot, storyId) {
  const result = getAssignmentForStory(projectRoot, storyId);
  if (!result.success) {
    return "";
  }
  return `${result.experimentName}|${result.variant}|${result.agent}|${result.excluded ? "1" : "0"}`;
}

module.exports = {
  djb2Hash,
  hashForAssignment,
  isExcluded,
  assignVariant,
  getAssignmentForStory,
  verifyDistribution,
  getAssignmentString,
};
