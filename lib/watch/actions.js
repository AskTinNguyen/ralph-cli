/**
 * Action Handler Registry
 *
 * Manages automatic actions triggered by file changes.
 * Actions can be registered, executed, and customized.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

/**
 * Default actions configuration
 */
const DEFAULT_ACTIONS = new Map();

/**
 * Custom actions loaded from watch.config.js
 */
const CUSTOM_ACTIONS = new Map();

/**
 * Action execution state
 */
let isExecuting = false;
let pendingActions = [];

/**
 * Register an action
 * @param {Object} action - Action configuration
 * @param {string} action.name - Unique action name
 * @param {string} action.trigger - Event type that triggers this action (e.g., 'prd_changed')
 * @param {Function} action.handler - Async function to execute
 * @param {string} [action.prompt] - Optional confirmation prompt
 * @param {boolean} [action.autoRun=true] - Whether to auto-run without confirmation
 */
function registerAction(action) {
  if (!action.name || !action.trigger || !action.handler) {
    throw new Error("Action must have name, trigger, and handler");
  }

  const actionConfig = {
    name: action.name,
    trigger: action.trigger,
    handler: action.handler,
    prompt: action.prompt || null,
    autoRun: action.autoRun !== false,
  };

  if (action.isCustom) {
    CUSTOM_ACTIONS.set(action.name, actionConfig);
  } else {
    DEFAULT_ACTIONS.set(action.name, actionConfig);
  }
}

/**
 * Unregister an action by name
 * @param {string} name - Action name to remove
 */
function unregisterAction(name) {
  DEFAULT_ACTIONS.delete(name);
  CUSTOM_ACTIONS.delete(name);
}

/**
 * Get all registered actions
 * @returns {Object[]} Array of action configs
 */
function listActions() {
  const all = [];
  for (const action of DEFAULT_ACTIONS.values()) {
    all.push({ ...action, source: "default" });
  }
  for (const action of CUSTOM_ACTIONS.values()) {
    all.push({ ...action, source: "custom" });
  }
  return all;
}

/**
 * Get actions for a specific trigger
 * @param {string} trigger - Event type
 * @returns {Object[]} Actions that match the trigger
 */
function getActionsForTrigger(trigger) {
  const actions = [];

  // Custom actions take precedence
  for (const action of CUSTOM_ACTIONS.values()) {
    if (action.trigger === trigger) {
      actions.push(action);
    }
  }

  // Then default actions
  for (const action of DEFAULT_ACTIONS.values()) {
    if (action.trigger === trigger) {
      // Skip if custom action with same name exists
      if (!CUSTOM_ACTIONS.has(action.name)) {
        actions.push(action);
      }
    }
  }

  return actions;
}

/**
 * Execute an action by name
 * @param {string} name - Action name
 * @param {Object} event - Event data from watcher
 * @param {Object} [options] - Execution options
 * @param {Function} [options.onOutput] - Callback for action output
 * @param {Function} [options.onConfirm] - Callback for confirmation prompts
 * @returns {Promise<{success: boolean, result?: any, error?: Error}>}
 */
async function executeAction(name, event, options = {}) {
  const action = CUSTOM_ACTIONS.get(name) || DEFAULT_ACTIONS.get(name);

  if (!action) {
    return { success: false, error: new Error(`Action not found: ${name}`) };
  }

  // Check if confirmation needed and not auto-run
  if (action.prompt && !action.autoRun && options.onConfirm) {
    const confirmed = await options.onConfirm(action.prompt);
    if (!confirmed) {
      return { success: true, result: "skipped" };
    }
  }

  try {
    const result = await action.handler(event, options);
    return { success: true, result };
  } catch (err) {
    return { success: false, error: err };
  }
}

/**
 * Execute all actions for a trigger
 * @param {string} trigger - Event type
 * @param {Object} event - Event data
 * @param {Object} [options] - Execution options
 * @returns {Promise<Object[]>} Results for each action
 */
async function executeActionsForTrigger(trigger, event, options = {}) {
  const actions = getActionsForTrigger(trigger);
  const results = [];

  for (const action of actions) {
    const result = await executeAction(action.name, event, options);
    results.push({ action: action.name, ...result });
  }

  return results;
}

// ============================================================================
// Built-in Action Handlers
// ============================================================================

/**
 * PRD change action - offers to regenerate plan
 */
async function handlePRDChange(event, options = {}) {
  const { onOutput, projectRoot, prdNumber } = options;

  if (onOutput) {
    onOutput(`PRD modified: ${path.basename(event.prdPath || event.path)}`);
  }

  return {
    action: "offer_regenerate_plan",
    message: `PRD-${prdNumber || event.prdNumber} changed. Run 'ralph plan --prd=${prdNumber || event.prdNumber}' to regenerate.`,
    prdNumber: prdNumber || event.prdNumber,
  };
}

/**
 * Plan change action - validates story format
 */
async function handlePlanChange(event, options = {}) {
  const { onOutput } = options;
  const planPath = event.planPath || event.path;

  // Read and validate the plan file
  let content;
  try {
    content = fs.readFileSync(planPath, "utf-8");
  } catch (err) {
    return {
      valid: false,
      errors: [`Could not read plan file: ${err.message}`],
    };
  }

  const errors = [];
  const warnings = [];
  let storiesFound = 0;

  // Validate story format: ### [ ] US-XXX: Title or ### [x] US-XXX: Title
  const storyPattern = /^###\s*\[[ x]\]\s*US-(\d+):\s*(.+)$/gm;
  let match;

  while ((match = storyPattern.exec(content)) !== null) {
    storiesFound++;
    const storyNumber = match[1];
    const title = match[2].trim();

    if (!title) {
      errors.push(`US-${storyNumber}: Missing title`);
    }
  }

  // Check for malformed story headers
  const malformedPattern = /^###.*US-\d+/gm;
  const allMatches = content.match(malformedPattern) || [];

  if (allMatches.length > storiesFound) {
    warnings.push(
      `Found ${allMatches.length - storiesFound} potentially malformed story header(s)`
    );
  }

  // Check for stories without acceptance criteria
  // Split by story headers and track which story each section belongs to
  const storyHeaderPattern = /^###\s*\[[ x]\]\s*US-(\d+):/gm;
  const storyMatches = [...content.matchAll(storyHeaderPattern)];

  for (let i = 0; i < storyMatches.length; i++) {
    const storyNum = storyMatches[i][1];
    const startIndex = storyMatches[i].index;
    const endIndex = i + 1 < storyMatches.length ? storyMatches[i + 1].index : content.length;
    const section = content.slice(startIndex, endIndex);

    // Check if section has acceptance criteria markers
    if (!section.includes("Acceptance") && !section.includes("- [")) {
      warnings.push(`US-${storyNum}: No acceptance criteria found`);
    }
  }

  const valid = errors.length === 0;

  if (onOutput) {
    if (valid && warnings.length === 0) {
      onOutput(`Plan validated: ${storiesFound} stories, all valid ✓`);
    } else if (valid) {
      onOutput(
        `Plan validated: ${storiesFound} stories, ${warnings.length} warning(s)`
      );
      for (const w of warnings) {
        onOutput(`  ⚠ ${w}`);
      }
    } else {
      onOutput(`Plan validation failed: ${errors.length} error(s)`);
      for (const e of errors) {
        onOutput(`  ✗ ${e}`);
      }
    }
  }

  return {
    valid,
    storiesFound,
    errors,
    warnings,
  };
}

/**
 * Config change action - reloads and validates config
 */
async function handleConfigChange(event, options = {}) {
  const { onOutput, projectRoot } = options;
  const configPath = event.configPath || event.path;
  const filename = path.basename(configPath);

  // For shell configs, we can't actually source them in Node.js
  // but we can validate they exist and report what changed
  let stats;
  try {
    stats = fs.statSync(configPath);
  } catch (err) {
    return {
      valid: false,
      error: `Config file not accessible: ${err.message}`,
    };
  }

  // For config.sh, try to extract and report key values
  const result = {
    valid: true,
    file: filename,
    lastModified: stats.mtime,
    values: {},
  };

  if (filename === "config.sh" || filename.endsWith(".sh")) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");

      // Extract variable assignments
      const varPattern = /^([A-Z_][A-Z0-9_]*)=["']?([^"'\n]*)["']?/gm;
      let varMatch;

      while ((varMatch = varPattern.exec(content)) !== null) {
        result.values[varMatch[1]] = varMatch[2];
      }
    } catch {
      // Ignore read errors for validation
    }
  }

  if (onOutput) {
    const valueCount = Object.keys(result.values).length;
    if (valueCount > 0) {
      onOutput(`Config reloaded: ${filename}`);
      for (const [key, value] of Object.entries(result.values)) {
        onOutput(`  ${key}=${value}`);
      }
    } else {
      onOutput(`Config reloaded: ${filename} ✓`);
    }
  }

  return result;
}

// ============================================================================
// Custom Config Loading
// ============================================================================

/**
 * Load custom watch configuration
 * @param {string} projectRoot - Project root directory
 * @returns {Object|null} Custom config or null if not found
 */
function loadCustomConfig(projectRoot) {
  const configPath = path.join(projectRoot, ".agents", "ralph", "watch.config.js");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    // Clear require cache to get fresh config
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);

    // Validate and register custom patterns
    if (config.patterns && typeof config.patterns === "object") {
      for (const [pattern, actionConfig] of Object.entries(config.patterns)) {
        if (actionConfig.action && typeof actionConfig.handler === "function") {
          registerAction({
            name: `custom_${pattern.replace(/\./g, "_")}`,
            trigger: patternToTrigger(pattern),
            handler: actionConfig.handler,
            prompt: actionConfig.prompt,
            autoRun: actionConfig.autoRun !== false,
            isCustom: true,
          });
        }
      }
    }

    return config;
  } catch (err) {
    console.error(`Error loading watch.config.js: ${err.message}`);
    return null;
  }
}

/**
 * Convert file pattern to trigger type
 * @param {string} pattern - File pattern (e.g., 'prd.md')
 * @returns {string} Trigger type
 */
function patternToTrigger(pattern) {
  if (pattern === "prd.md" || pattern.includes("prd")) {
    return "prd_changed";
  }
  if (pattern === "plan.md" || pattern.includes("plan")) {
    return "plan_changed";
  }
  if (pattern === "config.sh" || pattern.includes("config")) {
    return "config_changed";
  }
  return "file_changed";
}

/**
 * Clear all custom actions (useful for config reload)
 */
function clearCustomActions() {
  CUSTOM_ACTIONS.clear();
}

// ============================================================================
// Register Default Actions
// ============================================================================

registerAction({
  name: "prd_regenerate_plan",
  trigger: "prd_changed",
  handler: handlePRDChange,
  prompt: "PRD changed. Regenerate plan?",
  autoRun: true,
});

registerAction({
  name: "plan_validate",
  trigger: "plan_changed",
  handler: handlePlanChange,
  autoRun: true,
});

registerAction({
  name: "config_reload",
  trigger: "config_changed",
  handler: handleConfigChange,
  autoRun: true,
});

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  registerAction,
  unregisterAction,
  listActions,
  getActionsForTrigger,
  executeAction,
  executeActionsForTrigger,
  loadCustomConfig,
  clearCustomActions,
  // Built-in handlers (for testing/extension)
  handlers: {
    handlePRDChange,
    handlePlanChange,
    handleConfigChange,
  },
};
