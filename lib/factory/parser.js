/**
 * Factory Parser - YAML Configuration Parser
 *
 * Parses factory YAML configuration files and validates schema.
 * Supports variable templates via {{ variable_name }} syntax.
 *
 * @module lib/factory/parser
 */
const fs = require("fs");
const path = require("path");
const yaml = require("yaml");

/**
 * Supported factory config version
 */
const SUPPORTED_VERSIONS = ["1"];

/**
 * Supported stage types
 */
const STAGE_TYPES = ["prd", "plan", "build", "custom", "factory"];

/**
 * Supported merge strategies for parallel branches
 */
const MERGE_STRATEGIES = ["any", "all", "first"];

/**
 * Parse a factory configuration file
 * @param {string} configPath - Path to factory YAML file
 * @returns {Object} { success: boolean, factory?: Object, error?: string, warnings?: string[] }
 */
function parseFactory(configPath) {
  const warnings = [];

  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      error: `Configuration file not found: ${configPath}`,
    };
  }

  let content;
  try {
    content = fs.readFileSync(configPath, "utf8");
  } catch (err) {
    return {
      success: false,
      error: `Failed to read configuration file: ${err.message}`,
    };
  }

  let config;
  try {
    config = yaml.parse(content);
  } catch (err) {
    return {
      success: false,
      error: `Invalid YAML syntax: ${err.message}`,
    };
  }

  // Validate schema
  const validation = validateFactorySchema(config);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
      warnings: validation.warnings,
    };
  }

  warnings.push(...(validation.warnings || []));

  // Parse and resolve variables
  const factory = {
    version: config.version || "1",
    name: config.name || path.basename(configPath, ".yaml"),
    variables: parseVariables(config.variables || {}),
    agents: parseAgents(config.agents || {}),
    stages: parseStages(config.stages || []),
    configPath,
  };

  // Validate stage dependencies
  const depValidation = validateDependencies(factory.stages);
  if (!depValidation.valid) {
    return {
      success: false,
      error: depValidation.error,
    };
  }

  return {
    success: true,
    factory,
    warnings,
  };
}

/**
 * Validate factory configuration schema
 * @param {Object} config - Parsed YAML configuration
 * @returns {Object} { valid: boolean, error?: string, warnings?: string[] }
 */
function validateFactorySchema(config) {
  const warnings = [];

  if (!config || typeof config !== "object") {
    return {
      valid: false,
      error: "Configuration must be a valid YAML object",
    };
  }

  // Version check
  if (config.version && !SUPPORTED_VERSIONS.includes(String(config.version))) {
    warnings.push(
      `Unknown version '${config.version}'. Supported: ${SUPPORTED_VERSIONS.join(", ")}`
    );
  }

  // Stages are required
  if (!config.stages || !Array.isArray(config.stages)) {
    return {
      valid: false,
      error: "Factory must have a 'stages' array",
    };
  }

  if (config.stages.length === 0) {
    return {
      valid: false,
      error: "Factory must have at least one stage",
    };
  }

  // Validate each stage
  const stageIds = new Set();
  for (let i = 0; i < config.stages.length; i++) {
    const stage = config.stages[i];
    const stageValidation = validateStageSchema(stage, i);

    if (!stageValidation.valid) {
      return {
        valid: false,
        error: `Stage ${i + 1}: ${stageValidation.error}`,
      };
    }

    warnings.push(...(stageValidation.warnings || []));

    // Check for duplicate IDs
    if (stageIds.has(stage.id)) {
      return {
        valid: false,
        error: `Duplicate stage ID: '${stage.id}'`,
      };
    }
    stageIds.add(stage.id);
  }

  return { valid: true, warnings };
}

/**
 * Validate a single stage schema
 * @param {Object} stage - Stage configuration
 * @param {number} index - Stage index for error messages
 * @returns {Object} { valid: boolean, error?: string, warnings?: string[] }
 */
function validateStageSchema(stage, index) {
  const warnings = [];

  if (!stage || typeof stage !== "object") {
    return {
      valid: false,
      error: "Stage must be an object",
    };
  }

  // ID is required
  if (!stage.id || typeof stage.id !== "string") {
    return {
      valid: false,
      error: "Stage must have a string 'id' field",
    };
  }

  // Validate ID format (alphanumeric, underscores, hyphens)
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(stage.id)) {
    return {
      valid: false,
      error: `Invalid stage ID format: '${stage.id}'. Must start with a letter and contain only letters, numbers, underscores, or hyphens`,
    };
  }

  // Type is required
  if (!stage.type || typeof stage.type !== "string") {
    return {
      valid: false,
      error: "Stage must have a string 'type' field",
    };
  }

  if (!STAGE_TYPES.includes(stage.type)) {
    return {
      valid: false,
      error: `Unknown stage type: '${stage.type}'. Supported types: ${STAGE_TYPES.join(", ")}`,
    };
  }

  // Custom stages require a command
  if (stage.type === "custom" && !stage.command) {
    return {
      valid: false,
      error: "Custom stages must have a 'command' field",
    };
  }

  // Factory stages require a factory reference
  if (stage.type === "factory" && !stage.factory) {
    return {
      valid: false,
      error: "Factory stages must have a 'factory' field",
    };
  }

  // Validate depends_on
  if (stage.depends_on) {
    if (!Array.isArray(stage.depends_on)) {
      return {
        valid: false,
        error: "depends_on must be an array",
      };
    }

    for (const dep of stage.depends_on) {
      if (typeof dep !== "string") {
        return {
          valid: false,
          error: "depends_on must contain only strings",
        };
      }
    }
  }

  // Validate merge_strategy
  if (stage.merge_strategy) {
    if (!MERGE_STRATEGIES.includes(stage.merge_strategy)) {
      return {
        valid: false,
        error: `Unknown merge_strategy: '${stage.merge_strategy}'. Supported: ${MERGE_STRATEGIES.join(", ")}`,
      };
    }
  }

  // Validate loop_to
  if (stage.loop_to && typeof stage.loop_to !== "string") {
    return {
      valid: false,
      error: "loop_to must be a string (stage ID)",
    };
  }

  // Validate config
  if (stage.config) {
    if (typeof stage.config !== "object") {
      return {
        valid: false,
        error: "config must be an object",
      };
    }

    // Validate specific config options
    if (stage.config.iterations !== undefined) {
      const iters = parseInt(stage.config.iterations, 10);
      if (isNaN(iters) || iters < 1) {
        return {
          valid: false,
          error: "config.iterations must be a positive integer",
        };
      }
    }

    if (stage.config.parallel !== undefined) {
      const parallel = parseInt(stage.config.parallel, 10);
      if (isNaN(parallel) || parallel < 1) {
        return {
          valid: false,
          error: "config.parallel must be a positive integer",
        };
      }
    }

    if (stage.config.timeout !== undefined) {
      const timeout = parseInt(stage.config.timeout, 10);
      if (isNaN(timeout) || timeout < 0) {
        return {
          valid: false,
          error: "config.timeout must be a non-negative integer",
        };
      }
    }
  }

  return { valid: true, warnings };
}

/**
 * Validate stage dependencies
 * @param {Array} stages - Parsed stages
 * @returns {Object} { valid: boolean, error?: string }
 */
function validateDependencies(stages) {
  const stageIds = new Set(stages.map((s) => s.id));

  for (const stage of stages) {
    if (stage.depends_on) {
      for (const dep of stage.depends_on) {
        if (!stageIds.has(dep)) {
          return {
            valid: false,
            error: `Stage '${stage.id}' depends on unknown stage '${dep}'`,
          };
        }
        if (dep === stage.id) {
          return {
            valid: false,
            error: `Stage '${stage.id}' cannot depend on itself`,
          };
        }
      }
    }

    if (stage.loop_to && !stageIds.has(stage.loop_to)) {
      return {
        valid: false,
        error: `Stage '${stage.id}' loops to unknown stage '${stage.loop_to}'`,
      };
    }
  }

  // Check for circular dependencies
  const cycleCheck = detectCyclicDependencies(stages);
  if (cycleCheck.hasCycle) {
    return {
      valid: false,
      error: `Circular dependency detected: ${cycleCheck.cycle.join(" -> ")}`,
    };
  }

  return { valid: true };
}

/**
 * Detect circular dependencies in stages
 * @param {Array} stages - Parsed stages
 * @returns {Object} { hasCycle: boolean, cycle?: string[] }
 */
function detectCyclicDependencies(stages) {
  const graph = new Map();
  for (const stage of stages) {
    graph.set(stage.id, stage.depends_on || []);
  }

  const visited = new Set();
  const recursionStack = new Set();
  const path = [];

  function dfs(nodeId) {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);

    const deps = graph.get(nodeId) || [];
    for (const dep of deps) {
      if (!visited.has(dep)) {
        const result = dfs(dep);
        if (result.hasCycle) return result;
      } else if (recursionStack.has(dep)) {
        // Found a cycle
        const cycleStart = path.indexOf(dep);
        return {
          hasCycle: true,
          cycle: [...path.slice(cycleStart), dep],
        };
      }
    }

    path.pop();
    recursionStack.delete(nodeId);
    return { hasCycle: false };
  }

  for (const stage of stages) {
    if (!visited.has(stage.id)) {
      const result = dfs(stage.id);
      if (result.hasCycle) return result;
    }
  }

  return { hasCycle: false };
}

/**
 * Parse variables configuration
 * @param {Object} variables - Variables config
 * @returns {Object} Parsed variables
 */
function parseVariables(variables) {
  const parsed = {};

  for (const [key, value] of Object.entries(variables)) {
    parsed[key] = value;
  }

  return parsed;
}

/**
 * Parse agents configuration
 * @param {Object} agents - Agents config
 * @returns {Object} Parsed agents config
 */
function parseAgents(agents) {
  return {
    default: agents.default || "claude",
    planning: agents.planning || agents.default || "claude",
    implementation: agents.implementation || agents.default || "claude",
    ...agents,
  };
}

/**
 * Parse stages configuration
 * @param {Array} stages - Stages array
 * @returns {Array} Parsed stages
 */
function parseStages(stages) {
  return stages.map((stage) => ({
    id: stage.id,
    type: stage.type,
    depends_on: stage.depends_on || [],
    condition: stage.condition || null,
    input: stage.input || {},
    config: {
      iterations: stage.config?.iterations || 5,
      parallel: stage.config?.parallel || 1,
      timeout: stage.config?.timeout || 0, // 0 = no timeout
      retries: stage.config?.retries || 0,
      use_worktree: stage.config?.use_worktree ?? false,
      ...stage.config,
    },
    command: stage.command || null,
    factory: stage.factory || null,
    merge_strategy: stage.merge_strategy || "all",
    loop_to: stage.loop_to || null,
    // Verification gates - tamper-resistant checks for actual proof of work
    verify: stage.verify || null,
  }));
}

/**
 * Resolve variable templates in a string
 * @param {string} template - String with {{ variable }} templates
 * @param {Object} context - Context object with variable values
 * @returns {string} Resolved string
 */
function resolveTemplate(template, context) {
  if (typeof template !== "string") {
    return template;
  }

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (match, expr) => {
    const value = evaluateExpression(expr.trim(), context);
    return value !== undefined ? String(value) : match;
  });
}

/**
 * Resolve all templates in an object recursively
 * @param {*} obj - Object to resolve
 * @param {Object} context - Context object with variable values
 * @returns {*} Resolved object
 */
function resolveTemplates(obj, context) {
  if (typeof obj === "string") {
    return resolveTemplate(obj, context);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => resolveTemplates(item, context));
  }

  if (obj && typeof obj === "object") {
    const resolved = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveTemplates(value, context);
    }
    return resolved;
  }

  return obj;
}

/**
 * Evaluate a simple expression in context
 * Supports: variable access, comparisons, boolean operations
 * @param {string} expr - Expression to evaluate
 * @param {Object} context - Context object
 * @returns {*} Evaluated result
 */
function evaluateExpression(expr, context) {
  // Handle boolean literals first (before variable matching)
  if (expr === "true") return true;
  if (expr === "false") return false;

  // Simple variable access: variable_name or stages.id.field
  const varMatch = expr.match(/^([a-zA-Z_][a-zA-Z0-9_.]*)\s*$/);
  if (varMatch) {
    return getNestedValue(context, varMatch[1]);
  }

  // Comparison: left op right
  const compMatch = expr.match(
    /^(.+?)\s*(===?|!==?|>=?|<=?)\s*(.+)$/
  );
  if (compMatch) {
    const left = evaluateExpression(compMatch[1].trim(), context);
    const op = compMatch[2];
    const right = parseValue(compMatch[3].trim(), context);

    switch (op) {
      case "==":
      case "===":
        return left === right;
      case "!=":
      case "!==":
        return left !== right;
      case ">":
        return left > right;
      case ">=":
        return left >= right;
      case "<":
        return left < right;
      case "<=":
        return left <= right;
      default:
        return undefined;
    }
  }

  // Boolean operations: left && right, left || right
  const andMatch = expr.match(/^(.+?)\s*&&\s*(.+)$/);
  if (andMatch) {
    const left = evaluateExpression(andMatch[1].trim(), context);
    const right = evaluateExpression(andMatch[2].trim(), context);
    return Boolean(left) && Boolean(right);
  }

  const orMatch = expr.match(/^(.+?)\s*\|\|\s*(.+)$/);
  if (orMatch) {
    const left = evaluateExpression(orMatch[1].trim(), context);
    const right = evaluateExpression(orMatch[2].trim(), context);
    return Boolean(left) || Boolean(right);
  }

  // Negation: !expr
  const notMatch = expr.match(/^!\s*(.+)$/);
  if (notMatch) {
    const value = evaluateExpression(notMatch[1].trim(), context);
    return !value;
  }

  // Try parsing as literal value
  return parseValue(expr, context);
}

/**
 * Parse a value (number, boolean, string, or variable)
 * @param {string} value - Value string
 * @param {Object} context - Context object
 * @returns {*} Parsed value
 */
function parseValue(value, context) {
  // Number
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    return parseFloat(value);
  }

  // Boolean
  if (value === "true") return true;
  if (value === "false") return false;

  // Null
  if (value === "null") return null;

  // Quoted string
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  // Variable reference
  return getNestedValue(context, value);
}

/**
 * Get nested value from object using dot notation
 * @param {Object} obj - Object to query
 * @param {string} path - Dot-separated path
 * @returns {*} Value at path or undefined
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
 * Load additional variables from a separate file
 * @param {string} varsPath - Path to variables YAML file
 * @returns {Object} { success: boolean, variables?: Object, error?: string }
 */
function loadVariables(varsPath) {
  if (!fs.existsSync(varsPath)) {
    return { success: true, variables: {} };
  }

  try {
    const content = fs.readFileSync(varsPath, "utf8");
    const variables = yaml.parse(content);
    return { success: true, variables: variables || {} };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load variables: ${err.message}`,
    };
  }
}

module.exports = {
  SUPPORTED_VERSIONS,
  STAGE_TYPES,
  MERGE_STRATEGIES,
  parseFactory,
  validateFactorySchema,
  validateStageSchema,
  validateDependencies,
  detectCyclicDependencies,
  resolveTemplate,
  resolveTemplates,
  evaluateExpression,
  getNestedValue,
  loadVariables,
};
