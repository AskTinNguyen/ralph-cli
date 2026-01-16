/**
 * Model routing module - selects optimal AI model based on task complexity
 *
 * Routes tasks to appropriate models:
 * - Haiku: complexity 1-3 (simple fixes, docs, typos)
 * - Sonnet: complexity 4-7 (features, refactoring, moderate changes)
 * - Opus: complexity 8-10 (architecture, new systems, complex multi-file changes)
 *
 * Supports:
 * - Automatic routing based on complexity score
 * - Manual override via --model flag
 * - Configurable thresholds via config.sh
 */

const fs = require("fs");
const path = require("path");

// Default routing thresholds
const DEFAULT_THRESHOLDS = {
  haikuMax: 3,    // Complexity 1-3 -> Low tier
  sonnetMax: 7,   // Complexity 4-7 -> Medium tier
  // Complexity 8-10 -> High tier (implicit)
};

// Default model assignments per complexity tier
const DEFAULT_MODEL_ASSIGNMENTS = {
  lowModel: "haiku",      // Used for complexity 1-3
  mediumModel: "sonnet",  // Used for complexity 4-7
  highModel: "opus",      // Used for complexity 8-10
};

// Model names
const MODELS = {
  HAIKU: "haiku",
  SONNET: "sonnet",
  OPUS: "opus",
};

// Model descriptions for logging
const MODEL_DESCRIPTIONS = {
  haiku: "simple fixes, docs, typos",
  sonnet: "features, refactoring, moderate changes",
  opus: "architecture, new systems, complex changes",
};

// Cache for loaded config
let configCache = null;
let configLastLoaded = 0;
const CONFIG_CACHE_TTL_MS = 5000;

/**
 * Load routing configuration from config.sh
 * @param {string} repoRoot - Root directory of the repository
 * @returns {Object} Routing thresholds and model assignments
 */
function loadRoutingConfig(repoRoot) {
  const now = Date.now();

  // Return cached config if still valid
  if (configCache !== null && now - configLastLoaded < CONFIG_CACHE_TTL_MS) {
    return configCache;
  }

  const configPath = path.join(repoRoot, ".agents", "ralph", "config.sh");
  const config = {
    ...DEFAULT_THRESHOLDS,
    ...DEFAULT_MODEL_ASSIGNMENTS,
  };

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");

      // Parse routing variables
      const patterns = [
        { pattern: /^RALPH_ROUTING_ENABLED\s*=\s*"?(true|false)"?/im, key: "enabled", type: "bool" },
        { pattern: /^RALPH_HAIKU_MAX_COMPLEXITY\s*=\s*"?([0-9]+)"?/m, key: "haikuMax", type: "int" },
        { pattern: /^RALPH_SONNET_MAX_COMPLEXITY\s*=\s*"?([0-9]+)"?/m, key: "sonnetMax", type: "int" },
        { pattern: /^RALPH_DEFAULT_MODEL\s*=\s*"?(\w+)"?/m, key: "defaultModel", type: "string" },
        // Configurable model assignments per complexity tier
        { pattern: /^RALPH_LOW_COMPLEXITY_MODEL\s*=\s*"?(\w+)"?/m, key: "lowModel", type: "string" },
        { pattern: /^RALPH_MEDIUM_COMPLEXITY_MODEL\s*=\s*"?(\w+)"?/m, key: "mediumModel", type: "string" },
        { pattern: /^RALPH_HIGH_COMPLEXITY_MODEL\s*=\s*"?(\w+)"?/m, key: "highModel", type: "string" },
      ];

      for (const { pattern, key, type } of patterns) {
        const match = content.match(pattern);
        if (match) {
          if (type === "bool") {
            config[key] = match[1].toLowerCase() === "true";
          } else if (type === "int") {
            config[key] = parseInt(match[1], 10);
          } else {
            config[key] = match[1].toLowerCase();
          }
        }
      }
    } catch {
      // Use defaults on error
    }
  }

  configCache = config;
  configLastLoaded = now;
  return configCache;
}

/**
 * Get model for a given complexity score
 * @param {number} score - Complexity score (1-10)
 * @param {Object} options - Options { thresholds, config }
 * @returns {string} Model name (haiku, sonnet, opus)
 */
function getModelForComplexity(score, options = {}) {
  const config = options.config || options.thresholds || {
    ...DEFAULT_THRESHOLDS,
    ...DEFAULT_MODEL_ASSIGNMENTS,
  };

  // Get thresholds (support both old and new config format)
  const haikuMax = config.haikuMax ?? DEFAULT_THRESHOLDS.haikuMax;
  const sonnetMax = config.sonnetMax ?? DEFAULT_THRESHOLDS.sonnetMax;

  // Get configurable model assignments
  const lowModel = config.lowModel || DEFAULT_MODEL_ASSIGNMENTS.lowModel;
  const mediumModel = config.mediumModel || DEFAULT_MODEL_ASSIGNMENTS.mediumModel;
  const highModel = config.highModel || DEFAULT_MODEL_ASSIGNMENTS.highModel;

  if (score <= haikuMax) {
    return lowModel;
  } else if (score <= sonnetMax) {
    return mediumModel;
  } else {
    return highModel;
  }
}

/**
 * Generate human-readable reason for model selection
 * @param {string} model - Selected model
 * @param {number} score - Complexity score
 * @param {Object} thresholds - Routing thresholds
 * @returns {string} Reason string
 */
function getRoutingReason(model, score, thresholds) {
  const description = MODEL_DESCRIPTIONS[model] || "unknown";
  const scoreLabel = score <= 3 ? "low" : score <= 7 ? "medium" : "high";

  return `${scoreLabel} complexity (${score}/10) - ${description}`;
}

/**
 * Get routing decision for a story
 * @param {string} storyBlock - Raw story markdown block
 * @param {Object} options - Options { override, repoRoot, parsedStory }
 * @returns {Object} Routing decision { model, score, reason, override }
 */
function getRoutingDecision(storyBlock, options = {}) {
  const { override, repoRoot, parsedStory = {} } = options;

  // If override is specified, use it
  if (override) {
    const normalizedOverride = override.toLowerCase();
    if ([MODELS.HAIKU, MODELS.SONNET, MODELS.OPUS].includes(normalizedOverride)) {
      return {
        model: normalizedOverride,
        score: null,
        reason: `manual override (--model=${normalizedOverride})`,
        override: true,
        thresholds: null,
      };
    }
    // Invalid override - fall through to automatic routing
  }

  // Load routing config
  const thresholds = repoRoot ? loadRoutingConfig(repoRoot) : DEFAULT_THRESHOLDS;

  // Check if routing is disabled
  if (thresholds.enabled === false) {
    const defaultModel = thresholds.defaultModel || MODELS.SONNET;
    return {
      model: defaultModel,
      score: null,
      reason: `routing disabled, using default (${defaultModel})`,
      override: false,
      thresholds,
    };
  }

  // Get complexity score
  let complexityAnalysis;
  try {
    const complexity = require("../estimate/complexity");
    complexityAnalysis = complexity.analyzeComplexity(storyBlock, parsedStory);
  } catch {
    // Fallback if complexity module not available
    return {
      model: thresholds.defaultModel || MODELS.SONNET,
      score: null,
      reason: "complexity analysis unavailable, using default",
      override: false,
      thresholds,
    };
  }

  const score = complexityAnalysis.finalScore;
  const model = getModelForComplexity(score, { config: thresholds });
  const reason = getRoutingReason(model, score, thresholds);

  return {
    model,
    score,
    reason,
    override: false,
    thresholds,
    complexityBreakdown: complexityAnalysis.breakdown,
    scopeAnalysis: complexityAnalysis.scopeAnalysis,
  };
}

/**
 * Format routing decision for display
 * @param {Object} decision - Routing decision from getRoutingDecision
 * @returns {string} Formatted string for CLI output
 */
function formatRoutingDecision(decision) {
  const lines = [];

  if (decision.override) {
    lines.push(`Model: ${decision.model} (override)`);
  } else {
    lines.push(`Complexity: ${decision.score}/10`);
    lines.push(`Model: ${decision.model}`);
    lines.push(`Reason: ${decision.reason}`);
  }

  if (decision.complexityBreakdown) {
    const b = decision.complexityBreakdown;
    lines.push(`Breakdown: text=${b.textDepthScore}, criteria=${b.criteriaScore}, scope=${b.fileScopeScore}, multiplier=${b.keywordMultiplier}x`);
  }

  return lines.join("\n");
}

/**
 * Get routing decision as JSON for shell scripts
 * @param {Object} decision - Routing decision from getRoutingDecision
 * @returns {string} JSON string
 */
function toJSON(decision) {
  return JSON.stringify({
    model: decision.model,
    score: decision.score,
    reason: decision.reason,
    override: decision.override,
  });
}

/**
 * Validate model name
 * @param {string} model - Model name to validate
 * @returns {boolean} True if valid model name
 */
function isValidModel(model) {
  if (!model) return false;
  const normalized = model.toLowerCase();
  return [MODELS.HAIKU, MODELS.SONNET, MODELS.OPUS].includes(normalized);
}

/**
 * Get available model names
 * @returns {string[]} Array of valid model names
 */
function getAvailableModels() {
  return [MODELS.HAIKU, MODELS.SONNET, MODELS.OPUS];
}

/**
 * Clear the config cache (for testing)
 */
function clearConfigCache() {
  configCache = null;
  configLastLoaded = 0;
}

module.exports = {
  getModelForComplexity,
  getRoutingDecision,
  getRoutingReason,
  formatRoutingDecision,
  toJSON,
  isValidModel,
  getAvailableModels,
  loadRoutingConfig,
  clearConfigCache,
  DEFAULT_THRESHOLDS,
  DEFAULT_MODEL_ASSIGNMENTS,
  MODELS,
  MODEL_DESCRIPTIONS,
};

// CLI test mode when run directly
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes("--test")) {
    // Run test cases
    console.log("Running router test cases...\n");

    const testCases = [
      { score: 1, expected: "haiku" },
      { score: 2, expected: "haiku" },
      { score: 3, expected: "haiku" },
      { score: 4, expected: "sonnet" },
      { score: 5, expected: "sonnet" },
      { score: 6, expected: "sonnet" },
      { score: 7, expected: "sonnet" },
      { score: 8, expected: "opus" },
      { score: 9, expected: "opus" },
      { score: 10, expected: "opus" },
    ];

    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
      const result = getModelForComplexity(tc.score);
      if (result === tc.expected) {
        console.log(`✓ Complexity ${tc.score} -> ${result}`);
        passed++;
      } else {
        console.log(`✗ Complexity ${tc.score} -> ${result} (expected ${tc.expected})`);
        failed++;
      }
    }

    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  } else if (args.includes("--help")) {
    console.log("Usage: node router.js [options]");
    console.log("");
    console.log("Options:");
    console.log("  --test          Run test cases");
    console.log("  --score <N>     Get model for complexity score N");
    console.log("  --story <path>  Analyze story file and get routing decision");
    console.log("  --override <M>  Force model M (haiku, sonnet, opus)");
    console.log("  --help          Show this help");
  } else if (args.includes("--score")) {
    const idx = args.indexOf("--score");
    const score = parseFloat(args[idx + 1]);
    if (isNaN(score) || score < 1 || score > 10) {
      console.error("Error: --score requires a number between 1 and 10");
      process.exit(1);
    }
    const model = getModelForComplexity(score);
    console.log(JSON.stringify({ score, model }));
  } else if (args.includes("--story")) {
    const idx = args.indexOf("--story");
    const storyPath = args[idx + 1];
    if (!storyPath || !fs.existsSync(storyPath)) {
      console.error("Error: --story requires a valid file path");
      process.exit(1);
    }
    const storyBlock = fs.readFileSync(storyPath, "utf-8");
    const overrideIdx = args.indexOf("--override");
    const override = overrideIdx >= 0 ? args[overrideIdx + 1] : null;
    const decision = getRoutingDecision(storyBlock, { override });
    console.log(toJSON(decision));
  } else {
    console.log("Model Router - selects optimal AI model based on task complexity");
    console.log("Run with --help for usage information");
  }
}
