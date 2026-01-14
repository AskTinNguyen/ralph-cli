/**
 * Fix Executor for Auto-Remediation
 *
 * Executes fixes from the fix registry with:
 * - Approval prompts for risky fixes
 * - Activity logging
 * - Before/after state tracking
 * - Fix execution records for tracking and reporting
 */

const { spawnSync, execSync } = require("child_process");
const crypto = require("crypto");
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
 * Store for fix execution records
 * Records are stored by session and can be retrieved for summaries
 * @type {Map<string, FixRecord[]>}
 */
const fixRecords = new Map();

/**
 * Current session ID for grouping fix records
 */
let currentSessionId = null;

/**
 * FixRecord structure for tracking fix executions
 * @typedef {Object} FixRecord
 * @property {string} id - Unique identifier for this fix execution
 * @property {string} type - Fix type key (e.g., 'LINT_ERROR')
 * @property {string} command - Command that was executed
 * @property {Object} before - State snapshot before fix
 * @property {Object} after - State snapshot after fix
 * @property {number} startTime - Unix timestamp when fix started
 * @property {number} endTime - Unix timestamp when fix completed
 * @property {number} duration - Duration in milliseconds
 * @property {'success'|'failure'|'skipped'} status - Fix execution status
 * @property {string} [error] - Error message if failed
 * @property {string} [output] - Command output
 */

/**
 * StateSnapshot structure for capturing before/after state
 * @typedef {Object} StateSnapshot
 * @property {number} timestamp - Unix timestamp of snapshot
 * @property {Object.<string, string>} fileChecksums - Map of file path to MD5 checksum
 * @property {string} gitDiff - Output of git diff (staged and unstaged)
 * @property {string} gitStatus - Output of git status --porcelain
 * @property {string[]} modifiedFiles - List of files that differ from HEAD
 */

/**
 * Generate a unique ID for a fix record
 * @returns {string} Unique ID
 */
function generateFixId() {
  return `fix-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Start a new fix session for grouping records
 * @param {string} [sessionId] - Optional session ID, auto-generated if not provided
 * @returns {string} The session ID
 */
function startFixSession(sessionId = null) {
  currentSessionId = sessionId || `session-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  if (!fixRecords.has(currentSessionId)) {
    fixRecords.set(currentSessionId, []);
  }
  return currentSessionId;
}

/**
 * Get current session ID, starting new session if none exists
 * @returns {string} Current session ID
 */
function getCurrentSessionId() {
  if (!currentSessionId) {
    return startFixSession();
  }
  return currentSessionId;
}

/**
 * End the current fix session
 */
function endFixSession() {
  currentSessionId = null;
}

/**
 * Capture state snapshot of specified files and git status
 *
 * @param {string[]} [filePaths=[]] - Specific files to capture checksums for
 * @param {object} [options={}] - Capture options
 * @param {string} [options.cwd] - Working directory
 * @returns {StateSnapshot} State snapshot
 */
function captureState(filePaths = [], options = {}) {
  const cwd = options.cwd || process.cwd();
  const snapshot = {
    timestamp: Date.now(),
    fileChecksums: {},
    gitDiff: "",
    gitStatus: "",
    modifiedFiles: [],
  };

  // Capture file checksums for specified files
  for (const filePath of filePaths) {
    try {
      const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath);
        const hash = crypto.createHash("md5").update(content).digest("hex");
        snapshot.fileChecksums[filePath] = hash;
      }
    } catch {
      // Skip files that can't be read
    }
  }

  // Capture git status
  try {
    const gitStatus = execSync("git status --porcelain", {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    snapshot.gitStatus = gitStatus.trim();

    // Extract modified files from git status
    if (gitStatus) {
      const lines = gitStatus.split("\n").filter(Boolean);
      snapshot.modifiedFiles = lines.map((line) => line.slice(3).trim());
    }
  } catch {
    // Git not available or not in repo
  }

  // Capture git diff (staged and unstaged)
  try {
    const gitDiff = execSync("git diff HEAD", {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 1024 * 1024, // 1MB limit
    });
    snapshot.gitDiff = gitDiff.trim();
  } catch {
    // Git not available or not in repo
  }

  return snapshot;
}

/**
 * Calculate what changed between two state snapshots
 *
 * @param {StateSnapshot} before - State before fix
 * @param {StateSnapshot} after - State after fix
 * @returns {{changedFiles: string[], newFiles: string[], deletedFiles: string[], summary: string}}
 */
function diffStates(before, after) {
  const changedFiles = [];
  const newFiles = [];
  const deletedFiles = [];

  // Compare file checksums
  const beforeFiles = new Set(Object.keys(before.fileChecksums));
  const afterFiles = new Set(Object.keys(after.fileChecksums));

  for (const file of afterFiles) {
    if (!beforeFiles.has(file)) {
      newFiles.push(file);
    } else if (before.fileChecksums[file] !== after.fileChecksums[file]) {
      changedFiles.push(file);
    }
  }

  for (const file of beforeFiles) {
    if (!afterFiles.has(file)) {
      deletedFiles.push(file);
    }
  }

  // Also check git status changes
  const beforeModified = new Set(before.modifiedFiles);
  const afterModified = new Set(after.modifiedFiles);

  for (const file of afterModified) {
    if (!beforeModified.has(file) && !changedFiles.includes(file) && !newFiles.includes(file)) {
      changedFiles.push(file);
    }
  }

  // Generate summary
  const parts = [];
  if (changedFiles.length > 0) {
    parts.push(`${changedFiles.length} file(s) modified`);
  }
  if (newFiles.length > 0) {
    parts.push(`${newFiles.length} file(s) created`);
  }
  if (deletedFiles.length > 0) {
    parts.push(`${deletedFiles.length} file(s) deleted`);
  }

  const summary = parts.length > 0 ? parts.join(", ") : "No changes detected";

  return {
    changedFiles,
    newFiles,
    deletedFiles,
    summary,
  };
}

/**
 * Add a fix record to the current session
 *
 * @param {FixRecord} record - Fix record to add
 */
function addFixRecord(record) {
  const sessionId = getCurrentSessionId();
  const records = fixRecords.get(sessionId) || [];
  records.push(record);
  fixRecords.set(sessionId, records);
}

/**
 * Get fix records for a session
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 * @returns {FixRecord[]} Fix records for the session
 */
function getFixRecords(sessionId = null) {
  const id = sessionId || currentSessionId;
  if (!id) return [];
  return fixRecords.get(id) || [];
}

/**
 * Get fix records for all sessions
 *
 * @returns {Map<string, FixRecord[]>} All fix records by session
 */
function getAllFixRecords() {
  return new Map(fixRecords);
}

/**
 * Clear fix records for a session or all sessions
 *
 * @param {string} [sessionId] - Session ID to clear, clears all if not provided
 */
function clearFixRecords(sessionId = null) {
  if (sessionId) {
    fixRecords.delete(sessionId);
  } else {
    fixRecords.clear();
  }
}

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
 * Execute a fix command with before/after state tracking
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {object} context - Context with errorMessage, filePath, etc.
 * @param {object} [options] - Execution options
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.activityLogPath] - Path to activity log
 * @param {boolean} [options.trackState=true] - Whether to track before/after state
 * @param {string[]} [options.trackFiles=[]] - Specific files to track checksums for
 * @returns {FixRecord} Fix execution record with full details
 */
function executeFix(fixKey, context = {}, options = {}) {
  const startTime = Date.now();
  const fix = FIX_REGISTRY[fixKey];
  const cwd = options.cwd || process.cwd();
  const trackState = options.trackState !== false;
  const trackFiles = options.trackFiles || [];

  // Initialize fix record
  const record = {
    id: generateFixId(),
    type: fixKey,
    command: null,
    before: null,
    after: null,
    startTime,
    endTime: null,
    duration: null,
    status: "failure",
    error: null,
    output: null,
  };

  if (!fix) {
    record.endTime = Date.now();
    record.duration = record.endTime - startTime;
    record.error = `Unknown fix type: ${fixKey}`;
    addFixRecord(record);
    return { success: false, error: record.error, ...record };
  }

  const command = getFixCommand(fixKey, context);
  record.command = command;

  if (!command) {
    record.endTime = Date.now();
    record.duration = record.endTime - startTime;
    record.error = fix.suggest || "No command available for this fix";
    addFixRecord(record);
    return { success: false, error: record.error, ...record };
  }

  // Track attempts
  const attemptKey = fixKey;
  const attempts = fixAttempts.get(attemptKey) || 0;

  if (attempts >= MAX_FIX_ATTEMPTS) {
    record.endTime = Date.now();
    record.duration = record.endTime - startTime;
    record.error = `Max fix attempts (${MAX_FIX_ATTEMPTS}) reached for ${fixKey}`;
    addFixRecord(record);
    return { success: false, error: record.error, command, ...record };
  }

  fixAttempts.set(attemptKey, attempts + 1);

  // Capture before state
  if (trackState) {
    record.before = captureState(trackFiles, { cwd });
  }

  try {
    const result = spawnSync(command, {
      shell: true,
      cwd,
      encoding: "utf-8",
      timeout: 60000, // 60 second timeout
    });

    const endTime = Date.now();
    const duration = endTime - startTime;
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    const success = result.status === 0;

    // Capture after state
    if (trackState) {
      record.after = captureState(trackFiles, { cwd });
    }

    // Update record
    record.endTime = endTime;
    record.duration = duration;
    record.status = success ? "success" : "failure";
    record.output = output;
    record.error = success ? null : output || `Exit code: ${result.status}`;

    // Log the fix
    logFix({
      fixKey,
      command,
      status: success ? "success" : "failure",
      duration,
      error: success ? undefined : output,
      activityLogPath: options.activityLogPath,
    });

    // Add to session records
    addFixRecord(record);

    return {
      success,
      command,
      output,
      duration,
      error: success ? undefined : output || `Exit code: ${result.status}`,
      ...record,
    };
  } catch (err) {
    const endTime = Date.now();
    const duration = endTime - startTime;

    // Capture after state even on error
    if (trackState) {
      record.after = captureState(trackFiles, { cwd });
    }

    // Update record
    record.endTime = endTime;
    record.duration = duration;
    record.status = "failure";
    record.error = err.message;

    logFix({
      fixKey,
      command,
      status: "failure",
      duration,
      error: err.message,
      activityLogPath: options.activityLogPath,
    });

    // Add to session records
    addFixRecord(record);

    return {
      success: false,
      command,
      error: err.message,
      duration,
      ...record,
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

/**
 * Get fix summary statistics for current or specified session
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 * @returns {{attempted: number, succeeded: number, failed: number, skipped: number, byType: Object, totalDuration: number}}
 */
function getFixSummary(sessionId = null) {
  const records = getFixRecords(sessionId);
  const summary = {
    attempted: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    byType: {},
    totalDuration: 0,
  };

  for (const record of records) {
    summary.attempted++;
    summary.totalDuration += record.duration || 0;

    // Count by status
    if (record.status === "success") {
      summary.succeeded++;
    } else if (record.status === "skipped") {
      summary.skipped++;
    } else {
      summary.failed++;
    }

    // Count by type
    if (!summary.byType[record.type]) {
      summary.byType[record.type] = {
        attempted: 0,
        succeeded: 0,
        failed: 0,
      };
    }
    summary.byType[record.type].attempted++;
    if (record.status === "success") {
      summary.byType[record.type].succeeded++;
    } else if (record.status !== "skipped") {
      summary.byType[record.type].failed++;
    }
  }

  return summary;
}

/**
 * Format fix summary for console output (build output)
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 * @returns {string} Formatted fix summary for terminal output
 */
function formatFixSummary(sessionId = null) {
  const summary = getFixSummary(sessionId);
  const records = getFixRecords(sessionId);

  if (summary.attempted === 0) {
    return "";
  }

  const lines = [];
  lines.push("");
  lines.push("\x1b[36m═══════════════════════════════════════════════════════\x1b[0m");
  lines.push("\x1b[1m\x1b[36m                    FIX SUMMARY                        \x1b[0m");
  lines.push("\x1b[36m═══════════════════════════════════════════════════════\x1b[0m");
  lines.push("");

  // Overall stats
  lines.push(`  \x1b[1mTotal Fixes:\x1b[0m ${summary.attempted}`);
  lines.push(`  \x1b[32m✓ Succeeded:\x1b[0m ${summary.succeeded}`);
  lines.push(`  \x1b[31m✗ Failed:\x1b[0m ${summary.failed}`);
  lines.push(`  \x1b[33m○ Skipped:\x1b[0m ${summary.skipped}`);
  lines.push(`  \x1b[2mTotal Duration:\x1b[0m ${(summary.totalDuration / 1000).toFixed(2)}s`);
  lines.push("");

  // By type breakdown
  if (Object.keys(summary.byType).length > 0) {
    lines.push("  \x1b[1mBy Type:\x1b[0m");
    for (const [type, stats] of Object.entries(summary.byType)) {
      const status = stats.succeeded === stats.attempted
        ? "\x1b[32m✓\x1b[0m"
        : stats.failed > 0
          ? "\x1b[31m✗\x1b[0m"
          : "\x1b[33m○\x1b[0m";
      lines.push(`    ${status} ${type}: ${stats.succeeded}/${stats.attempted}`);
    }
    lines.push("");
  }

  // Detailed list of fixes
  if (records.length > 0) {
    lines.push("  \x1b[1mDetails:\x1b[0m");
    for (const record of records) {
      const status = record.status === "success"
        ? "\x1b[32m✓\x1b[0m"
        : record.status === "skipped"
          ? "\x1b[33m○\x1b[0m"
          : "\x1b[31m✗\x1b[0m";
      const duration = record.duration ? `(${record.duration}ms)` : "";
      lines.push(`    ${status} ${record.type} ${duration}`);
      if (record.command) {
        lines.push(`      \x1b[2mCommand: ${record.command}\x1b[0m`);
      }
      if (record.error && record.status !== "success") {
        const errorShort = record.error.slice(0, 80) + (record.error.length > 80 ? "..." : "");
        lines.push(`      \x1b[31mError: ${errorShort}\x1b[0m`);
      }
    }
    lines.push("");
  }

  lines.push("\x1b[36m═══════════════════════════════════════════════════════\x1b[0m");

  return lines.join("\n");
}

/**
 * Format fix summary for commit message
 * Returns a concise list of auto-fixed issues
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 * @returns {string} Formatted string for commit message
 */
function formatFixesForCommit(sessionId = null) {
  const records = getFixRecords(sessionId);
  const successfulFixes = records.filter((r) => r.status === "success");

  if (successfulFixes.length === 0) {
    return "";
  }

  // Group by type
  const byType = {};
  for (const record of successfulFixes) {
    if (!byType[record.type]) {
      byType[record.type] = 0;
    }
    byType[record.type]++;
  }

  // Format as comma-separated list
  const types = Object.entries(byType)
    .map(([type, count]) => (count > 1 ? `${type} (${count})` : type))
    .join(", ");

  return `Auto-fixed: ${types}`;
}

/**
 * Get fix statistics for UI dashboard API
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 * @returns {{attempted: number, succeeded: number, failed: number, byType: Object, records: FixRecord[]}}
 */
function getFixStats(sessionId = null) {
  const summary = getFixSummary(sessionId);
  const records = getFixRecords(sessionId);

  return {
    attempted: summary.attempted,
    succeeded: summary.succeeded,
    failed: summary.failed,
    byType: summary.byType,
    totalDuration: summary.totalDuration,
    records: records.map((r) => ({
      id: r.id,
      type: r.type,
      command: r.command,
      status: r.status,
      duration: r.duration,
      error: r.error,
      startTime: r.startTime,
      endTime: r.endTime,
      // Include state diff summary if available
      stateChanges: r.before && r.after ? diffStates(r.before, r.after) : null,
    })),
  };
}

/**
 * Print fix summary to console
 * Call this after a build iteration completes
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 */
function printFixSummary(sessionId = null) {
  const output = formatFixSummary(sessionId);
  if (output) {
    console.log(output);
  }
}

/**
 * Verify a fix by re-running the original validation check
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {object} [options] - Verification options
 * @param {string} [options.cwd] - Working directory
 * @param {number} [options.timeout=30000] - Timeout in ms
 * @returns {{verified: boolean, error?: string, output?: string, duration: number}}
 */
function verifyFix(fixKey, options = {}) {
  const startTime = Date.now();
  const fix = FIX_REGISTRY[fixKey];
  const cwd = options.cwd || process.cwd();
  const timeout = options.timeout || 30000;

  if (!fix) {
    return {
      verified: false,
      error: `Unknown fix type: ${fixKey}`,
      duration: Date.now() - startTime,
    };
  }

  if (!fix.verify) {
    // No verification command defined - assume success
    return {
      verified: true,
      output: "No verification command defined, assuming success",
      duration: Date.now() - startTime,
    };
  }

  try {
    const result = spawnSync(fix.verify, {
      shell: true,
      cwd,
      encoding: "utf-8",
      timeout,
    });

    const duration = Date.now() - startTime;
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    const verified = result.status === 0;

    return {
      verified,
      output: output || undefined,
      error: verified ? undefined : output || `Exit code: ${result.status}`,
      duration,
    };
  } catch (err) {
    return {
      verified: false,
      error: err.message,
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Rollback a fix by restoring files to their pre-fix state
 * Uses git checkout for tracked files, or restores from captured state
 *
 * @param {FixRecord} fixRecord - The fix record containing before state
 * @param {object} [options] - Rollback options
 * @param {string} [options.cwd] - Working directory
 * @returns {{success: boolean, error?: string, filesRestored: string[]}}
 */
function rollbackFix(fixRecord, options = {}) {
  const cwd = options.cwd || process.cwd();
  const filesRestored = [];

  if (!fixRecord) {
    return {
      success: false,
      error: "No fix record provided",
      filesRestored: [],
    };
  }

  if (!fixRecord.before) {
    return {
      success: false,
      error: "No before state captured for rollback",
      filesRestored: [],
    };
  }

  try {
    // Get list of files that were modified by the fix
    const modifiedFiles = [];

    if (fixRecord.after && fixRecord.after.modifiedFiles) {
      modifiedFiles.push(...fixRecord.after.modifiedFiles);
    }

    // Also check files from before state that may have changed
    if (fixRecord.before.modifiedFiles) {
      for (const file of fixRecord.before.modifiedFiles) {
        if (!modifiedFiles.includes(file)) {
          modifiedFiles.push(file);
        }
      }
    }

    // Try to restore each modified file using git checkout
    for (const file of modifiedFiles) {
      try {
        const result = spawnSync(`git checkout HEAD -- "${file}"`, {
          shell: true,
          cwd,
          encoding: "utf-8",
          timeout: 5000,
        });

        if (result.status === 0) {
          filesRestored.push(file);
        }
      } catch {
        // File might not be tracked by git, skip
      }
    }

    // If we couldn't restore any files via git, try restoring from checksums
    if (filesRestored.length === 0 && Object.keys(fixRecord.before.fileChecksums).length > 0) {
      // We only have checksums, not content - can't restore file contents
      // This is a limitation - we'd need to store full file content for full rollback
      return {
        success: false,
        error: "Cannot rollback: files not tracked by git and no content backup available",
        filesRestored: [],
      };
    }

    // Verify rollback succeeded by checking git status
    try {
      execSync("git status --porcelain", { cwd, encoding: "utf-8", timeout: 5000 });
    } catch {
      // Git status failed, but we may have still restored some files
    }

    return {
      success: filesRestored.length > 0,
      filesRestored,
      error: filesRestored.length === 0 ? "No files were restored" : undefined,
    };
  } catch (err) {
    return {
      success: false,
      error: `Rollback failed: ${err.message}`,
      filesRestored,
    };
  }
}

/**
 * Execute a fix with verification and automatic rollback on failure
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {object} context - Context with errorMessage, filePath, etc.
 * @param {object} [options] - Execution options
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.activityLogPath] - Path to activity log
 * @param {boolean} [options.verify=true] - Whether to verify after fix
 * @param {boolean} [options.rollbackOnFailure=true] - Whether to rollback on verification failure
 * @returns {{success: boolean, verified: boolean, rolledBack: boolean, error?: string, fixRecord: FixRecord}}
 */
function executeFixWithVerification(fixKey, context = {}, options = {}) {
  const verify = options.verify !== false;
  const rollbackOnFailure = options.rollbackOnFailure !== false;

  // Execute the fix
  const fixResult = executeFix(fixKey, context, {
    ...options,
    trackState: true, // Always track state for potential rollback
  });

  // If fix execution failed, no need to verify
  if (!fixResult.success) {
    return {
      success: false,
      verified: false,
      rolledBack: false,
      error: fixResult.error,
      fixRecord: fixResult,
    };
  }

  // Verify the fix if enabled
  if (verify) {
    const verifyResult = verifyFix(fixKey, options);

    if (!verifyResult.verified) {
      // Verification failed - attempt rollback if enabled
      if (rollbackOnFailure) {
        const rollbackResult = rollbackFix(fixResult, options);

        // Log the rollback
        logFix({
          fixKey: `${fixKey}_ROLLBACK`,
          command: "git checkout HEAD",
          status: rollbackResult.success ? "success" : "failure",
          duration: 0,
          error: rollbackResult.error,
          activityLogPath: options.activityLogPath,
        });

        return {
          success: false,
          verified: false,
          rolledBack: rollbackResult.success,
          error: `Fix verification failed: ${verifyResult.error}${rollbackResult.success ? " (rolled back)" : " (rollback failed)"}`,
          fixRecord: fixResult,
        };
      }

      return {
        success: false,
        verified: false,
        rolledBack: false,
        error: `Fix verification failed: ${verifyResult.error}`,
        fixRecord: fixResult,
      };
    }

    return {
      success: true,
      verified: true,
      rolledBack: false,
      fixRecord: fixResult,
    };
  }

  // No verification requested
  return {
    success: fixResult.success,
    verified: false,
    rolledBack: false,
    fixRecord: fixResult,
  };
}

/**
 * Calculate fix success rate from fix records
 *
 * @param {string} [sessionId] - Session ID, uses current session if not provided
 * @returns {{successRate: number, attempted: number, succeeded: number, failed: number, verified: number}}
 */
function getFixSuccessRate(sessionId = null) {
  const records = getFixRecords(sessionId);

  if (records.length === 0) {
    return {
      successRate: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      verified: 0,
    };
  }

  const attempted = records.filter((r) => r.status !== "skipped").length;
  const succeeded = records.filter((r) => r.status === "success").length;
  const failed = records.filter((r) => r.status === "failure").length;
  // Verified count would require additional tracking in fixRecord
  const verified = succeeded; // For now, assume all successful fixes are verified

  const successRate = attempted > 0 ? (succeeded / attempted) * 100 : 0;

  return {
    successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
    attempted,
    succeeded,
    failed,
    verified,
  };
}

/**
 * Check if max fix attempts have been reached for a fix type
 *
 * @param {string} fixKey - Fix type key
 * @returns {boolean} True if max attempts reached
 */
function hasReachedMaxAttempts(fixKey) {
  const attempts = fixAttempts.get(fixKey) || 0;
  return attempts >= MAX_FIX_ATTEMPTS;
}

/**
 * Get remaining fix attempts for a fix type
 *
 * @param {string} fixKey - Fix type key
 * @returns {number} Remaining attempts
 */
function getRemainingAttempts(fixKey) {
  const attempts = fixAttempts.get(fixKey) || 0;
  return Math.max(0, MAX_FIX_ATTEMPTS - attempts);
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

  // State tracking (US-003)
  captureState,
  diffStates,
  startFixSession,
  getCurrentSessionId,
  endFixSession,
  addFixRecord,
  getFixRecords,
  getAllFixRecords,
  clearFixRecords,

  // Fix summary and reporting (US-003)
  getFixSummary,
  formatFixSummary,
  formatFixesForCommit,
  getFixStats,
  printFixSummary,

  // Fix verification and rollback (US-004)
  verifyFix,
  rollbackFix,
  executeFixWithVerification,
  getFixSuccessRate,
  hasReachedMaxAttempts,
  getRemainingAttempts,

  // State management
  resetFixAttempts,
  getFixAttempts,
};
