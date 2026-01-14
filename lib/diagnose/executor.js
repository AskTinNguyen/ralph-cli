/**
 * Fix Executor for Auto-Remediation
 *
 * Executes fixes from the fix registry with:
 * - Approval prompts for risky fixes
 * - Activity logging
 * - Before/after state tracking
 */

const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const {
  FIX_CATEGORIES,
  FIX_REGISTRY,
  getFixCommand,
  isSafeFix,
  needsApproval,
  isManualOnly,
} = require("./fixes");

/**
 * Auto-fix modes
 */
const AUTO_FIX_MODES = {
  NONE: "none", // No auto-fix
  SAFE: "safe", // Only safe fixes
  ALL: "all", // All fixes including risky ones (skip prompts)
};

/**
 * Maximum fix attempts per error type per session
 */
const MAX_FIX_ATTEMPTS = 3;

/**
 * Track fix attempts to prevent infinite loops
 */
const fixAttempts = new Map();

/**
 * Check if a fix should be executed based on auto-fix mode
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {string} autoFixMode - One of AUTO_FIX_MODES
 * @returns {{execute: boolean, needsPrompt: boolean}}
 */
function shouldExecuteFix(fixKey, autoFixMode) {
  const fix = FIX_REGISTRY[fixKey];
  if (!fix || !fix.command) {
    return { execute: false, needsPrompt: false };
  }

  // Manual-only fixes are never auto-executed
  if (isManualOnly(fixKey)) {
    return { execute: false, needsPrompt: false };
  }

  // No auto-fix mode
  if (autoFixMode === AUTO_FIX_MODES.NONE) {
    return { execute: false, needsPrompt: false };
  }

  // Safe mode - only safe fixes
  if (autoFixMode === AUTO_FIX_MODES.SAFE) {
    if (isSafeFix(fixKey)) {
      return { execute: true, needsPrompt: false };
    }
    return { execute: false, needsPrompt: false };
  }

  // All mode - execute all, skip prompts
  if (autoFixMode === AUTO_FIX_MODES.ALL) {
    return { execute: true, needsPrompt: false };
  }

  // Default: safe fixes auto, risky needs prompt
  if (isSafeFix(fixKey)) {
    return { execute: true, needsPrompt: false };
  }

  if (needsApproval(fixKey)) {
    return { execute: true, needsPrompt: true };
  }

  return { execute: false, needsPrompt: false };
}

/**
 * Prompt user for approval on risky fixes
 * Uses @clack/prompts for consistent UI
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {string} command - Command that will be executed
 * @returns {Promise<boolean>} True if approved
 */
async function promptForApproval(fixKey, command) {
  try {
    const { confirm, isCancel } = await import("@clack/prompts");
    const fix = FIX_REGISTRY[fixKey];

    console.log("");
    console.log(`\x1b[33m⚠️  Risky fix requires approval\x1b[0m`);
    console.log(`   Type: ${fixKey}`);
    console.log(`   Description: ${fix?.description || "N/A"}`);
    console.log(`   Command: ${command}`);
    console.log("");

    const approved = await confirm({
      message: "Execute this fix?",
      initialValue: false,
    });

    if (isCancel(approved)) {
      return false;
    }

    return approved === true;
  } catch {
    // Non-interactive mode - don't execute risky fixes
    console.log(`\x1b[33m⚠️  Skipping risky fix (non-interactive): ${fixKey}\x1b[0m`);
    return false;
  }
}

/**
 * Log a fix execution to activity.log
 *
 * @param {object} options - Log options
 * @param {string} options.fixKey - Fix type
 * @param {string} options.command - Command executed
 * @param {string} options.status - "success" or "failure"
 * @param {number} options.duration - Duration in ms
 * @param {string} [options.error] - Error message if failed
 * @param {string} [options.activityLogPath] - Path to activity log
 */
function logFix(options) {
  const {
    fixKey,
    command,
    status,
    duration,
    error,
    activityLogPath,
  } = options;

  const logPath = activityLogPath || path.join(process.cwd(), ".ralph", "activity.log");

  try {
    // Ensure directory exists
    fs.mkdirSync(path.dirname(logPath), { recursive: true });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    let logEntry = `[${timestamp}] AUTO_FIX type=${fixKey} command="${command}" status=${status} duration=${duration}ms`;

    if (error) {
      logEntry += ` error="${error.replace(/"/g, '\\"')}"`;
    }

    fs.appendFileSync(logPath, logEntry + "\n");
  } catch (err) {
    // Silently fail logging - don't break fix execution
    console.error(`\x1b[33mWarning: Could not log fix: ${err.message}\x1b[0m`);
  }
}

/**
 * Execute a fix command
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {object} context - Context with errorMessage, filePath, etc.
 * @param {object} [options] - Execution options
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.activityLogPath] - Path to activity log
 * @returns {{success: boolean, output?: string, error?: string, command?: string, duration?: number}}
 */
function executeFix(fixKey, context = {}, options = {}) {
  const startTime = Date.now();
  const fix = FIX_REGISTRY[fixKey];

  if (!fix) {
    return { success: false, error: `Unknown fix type: ${fixKey}` };
  }

  const command = getFixCommand(fixKey, context);
  if (!command) {
    return {
      success: false,
      error: fix.suggest || "No command available for this fix",
    };
  }

  // Track attempts
  const attemptKey = fixKey;
  const attempts = fixAttempts.get(attemptKey) || 0;

  if (attempts >= MAX_FIX_ATTEMPTS) {
    return {
      success: false,
      error: `Max fix attempts (${MAX_FIX_ATTEMPTS}) reached for ${fixKey}`,
      command,
    };
  }

  fixAttempts.set(attemptKey, attempts + 1);

  try {
    const result = spawnSync(command, {
      shell: true,
      cwd: options.cwd || process.cwd(),
      encoding: "utf-8",
      timeout: 60000, // 60 second timeout
    });

    const duration = Date.now() - startTime;
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();

    const success = result.status === 0;

    // Log the fix
    logFix({
      fixKey,
      command,
      status: success ? "success" : "failure",
      duration,
      error: success ? undefined : output,
      activityLogPath: options.activityLogPath,
    });

    return {
      success,
      command,
      output,
      duration,
      error: success ? undefined : output || `Exit code: ${result.status}`,
    };
  } catch (err) {
    const duration = Date.now() - startTime;

    logFix({
      fixKey,
      command,
      status: "failure",
      duration,
      error: err.message,
      activityLogPath: options.activityLogPath,
    });

    return {
      success: false,
      command,
      error: err.message,
      duration,
    };
  }
}

/**
 * Execute a fix with approval if needed
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {object} context - Context with errorMessage, filePath, etc.
 * @param {string} autoFixMode - One of AUTO_FIX_MODES
 * @param {object} [options] - Execution options
 * @returns {Promise<{success: boolean, executed: boolean, skipped: boolean, error?: string}>}
 */
async function executeFixWithApproval(fixKey, context, autoFixMode, options = {}) {
  const { execute, needsPrompt } = shouldExecuteFix(fixKey, autoFixMode);

  if (!execute) {
    return {
      success: false,
      executed: false,
      skipped: true,
      reason: isManualOnly(fixKey)
        ? "Manual-only fix"
        : `Auto-fix mode "${autoFixMode}" does not allow this fix`,
    };
  }

  const command = getFixCommand(fixKey, context);
  if (!command) {
    return {
      success: false,
      executed: false,
      skipped: true,
      reason: FIX_REGISTRY[fixKey]?.suggest || "No command available",
    };
  }

  // Prompt for approval if needed
  if (needsPrompt) {
    const approved = await promptForApproval(fixKey, command);
    if (!approved) {
      return {
        success: false,
        executed: false,
        skipped: true,
        reason: "User declined approval",
      };
    }
  }

  // Execute the fix
  const result = executeFix(fixKey, context, options);

  return {
    ...result,
    executed: true,
    skipped: false,
  };
}

/**
 * Reset fix attempt counters
 * Call this at the start of a new build iteration
 */
function resetFixAttempts() {
  fixAttempts.clear();
}

/**
 * Get current fix attempt counts
 *
 * @returns {Map<string, number>}
 */
function getFixAttempts() {
  return new Map(fixAttempts);
}

module.exports = {
  // Constants
  AUTO_FIX_MODES,
  MAX_FIX_ATTEMPTS,

  // Core functions
  shouldExecuteFix,
  promptForApproval,
  logFix,
  executeFix,
  executeFixWithApproval,

  // State management
  resetFixAttempts,
  getFixAttempts,
};
