/**
 * Schema for experiment configuration
 *
 * Experiments define A/B tests between different agents or configurations.
 * Each experiment specifies variants with weights for traffic allocation.
 *
 * Schema fields:
 * - name: Unique experiment identifier (e.g., "claude-vs-codex")
 * - description: Human-readable description of the experiment
 * - status: Current state ("draft", "running", "paused", "concluded")
 * - variants: Object mapping variant names to {agent, weight} configs
 * - metrics: Array of metric names to track (e.g., ["success_rate", "execution_time"])
 * - minSamples: Minimum sample size before analysis is valid
 * - maxSamples: Optional maximum sample size to auto-conclude
 * - duration: Optional duration in days after which to auto-conclude
 * - exclusions: Array of patterns to exclude from experiment (always use control)
 * - createdAt: ISO 8601 timestamp of experiment creation
 * - updatedAt: ISO 8601 timestamp of last update
 */

/**
 * Schema definition for experiment configuration
 */
const EXPERIMENT_SCHEMA = {
  name: { type: "string", required: true },
  description: { type: "string", required: false, default: "" },
  status: { type: "string", required: true, enum: ["draft", "running", "paused", "concluded"], default: "draft" },
  variants: { type: "object", required: true },
  metrics: { type: "array", required: false, default: ["success_rate", "execution_time", "token_cost"] },
  minSamples: { type: "number", required: false, default: 30 },
  maxSamples: { type: "number", required: false, nullable: true, default: null },
  duration: { type: "number", required: false, nullable: true, default: null },
  exclusions: { type: "array", required: false, default: [] },
  createdAt: { type: "string", required: true },
  updatedAt: { type: "string", required: true },
};

/**
 * Schema definition for variant configuration
 */
const VARIANT_SCHEMA = {
  agent: { type: "string", required: true, enum: ["claude", "codex", "droid"] },
  weight: { type: "number", required: true, min: 0, max: 100 },
  model: { type: "string", required: false, nullable: true },
  config: { type: "object", required: false, nullable: true },
};

/**
 * Validate a variant configuration
 * @param {Object} variant - Variant to validate
 * @param {string} variantName - Name of the variant for error messages
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateVariant(variant, variantName) {
  const errors = [];

  if (!variant || typeof variant !== "object") {
    return { valid: false, errors: [`Variant "${variantName}" must be an object`] };
  }

  for (const [field, schema] of Object.entries(VARIANT_SCHEMA)) {
    const value = variant[field];

    // Check required fields
    if (schema.required && (value === undefined || value === null)) {
      errors.push(`Variant "${variantName}" missing required field: ${field}`);
      continue;
    }

    // Skip validation if value is null/undefined and field is optional
    if (value === null || value === undefined) {
      continue;
    }

    // Type check
    if (schema.type === "number" && typeof value !== "number") {
      errors.push(`Variant "${variantName}" field ${field} must be a number`);
    }
    if (schema.type === "string" && typeof value !== "string") {
      errors.push(`Variant "${variantName}" field ${field} must be a string`);
    }
    if (schema.type === "object" && typeof value !== "object") {
      errors.push(`Variant "${variantName}" field ${field} must be an object`);
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`Variant "${variantName}" field ${field} must be one of: ${schema.enum.join(", ")}`);
    }

    // Range check
    if (schema.min !== undefined && typeof value === "number" && value < schema.min) {
      errors.push(`Variant "${variantName}" field ${field} must be at least ${schema.min}`);
    }
    if (schema.max !== undefined && typeof value === "number" && value > schema.max) {
      errors.push(`Variant "${variantName}" field ${field} must be at most ${schema.max}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate an experiment configuration
 * @param {Object} experiment - Experiment to validate
 * @returns {Object} { valid: boolean, errors: string[] }
 */
function validateExperiment(experiment) {
  const errors = [];

  if (!experiment || typeof experiment !== "object") {
    return { valid: false, errors: ["Experiment must be an object"] };
  }

  // Validate top-level fields
  for (const [field, schema] of Object.entries(EXPERIMENT_SCHEMA)) {
    const value = experiment[field];

    // Check required fields
    if (schema.required && (value === undefined || value === null || value === "")) {
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
    if (schema.type === "object" && typeof value !== "object") {
      errors.push(`Field ${field} must be an object, got ${typeof value}`);
    }
    if (schema.type === "array" && !Array.isArray(value)) {
      errors.push(`Field ${field} must be an array, got ${typeof value}`);
    }

    // Enum check
    if (schema.enum && !schema.enum.includes(value)) {
      errors.push(`Field ${field} must be one of: ${schema.enum.join(", ")}`);
    }
  }

  // Validate variants
  if (experiment.variants) {
    if (typeof experiment.variants !== "object" || Array.isArray(experiment.variants)) {
      errors.push("Field variants must be an object (not an array)");
    } else {
      const variantNames = Object.keys(experiment.variants);

      // Must have at least 2 variants
      if (variantNames.length < 2) {
        errors.push("Experiment must have at least 2 variants");
      }

      // Validate each variant
      let totalWeight = 0;
      for (const variantName of variantNames) {
        const variantValidation = validateVariant(experiment.variants[variantName], variantName);
        errors.push(...variantValidation.errors);

        if (typeof experiment.variants[variantName]?.weight === "number") {
          totalWeight += experiment.variants[variantName].weight;
        }
      }

      // Weights must sum to 100
      if (totalWeight !== 100) {
        errors.push(`Variant weights must sum to 100, got ${totalWeight}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Create a new experiment configuration with defaults
 * @param {Object} data - Partial experiment data
 * @returns {Object} Complete experiment configuration
 */
function createExperiment(data = {}) {
  const now = new Date().toISOString();

  return {
    name: data.name || "unnamed-experiment",
    description: data.description || "",
    status: data.status || "draft",
    variants: data.variants || {},
    metrics: data.metrics || ["success_rate", "execution_time", "token_cost"],
    minSamples: data.minSamples != null ? data.minSamples : 30,
    maxSamples: data.maxSamples != null ? data.maxSamples : null,
    duration: data.duration != null ? data.duration : null,
    exclusions: data.exclusions || [],
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
  };
}

/**
 * Create a default 50/50 experiment between two agents
 * @param {string} name - Experiment name
 * @param {string} controlAgent - Control variant agent
 * @param {string} treatmentAgent - Treatment variant agent
 * @param {Object} options - Additional options
 * @returns {Object} Experiment configuration
 */
function createDefaultExperiment(name, controlAgent = "claude", treatmentAgent = "codex", options = {}) {
  return createExperiment({
    name,
    description: options.description || `Compare ${controlAgent} vs ${treatmentAgent}`,
    status: "draft",
    variants: {
      control: {
        agent: controlAgent,
        weight: options.controlWeight || 50,
        model: options.controlModel || null,
      },
      treatment: {
        agent: treatmentAgent,
        weight: options.treatmentWeight || 50,
        model: options.treatmentModel || null,
      },
    },
    metrics: options.metrics || ["success_rate", "execution_time", "token_cost"],
    minSamples: options.minSamples || 30,
    maxSamples: options.maxSamples || null,
    duration: options.duration || null,
    exclusions: options.exclusions || [],
  });
}

module.exports = {
  EXPERIMENT_SCHEMA,
  VARIANT_SCHEMA,
  validateExperiment,
  validateVariant,
  createExperiment,
  createDefaultExperiment,
};
