/**
 * BuildStateManager - Transactional updates for Ralph build state files
 *
 * Provides atomic, concurrent-safe updates to progress.md and activity.log
 * using file locking to prevent corruption from parallel builds.
 *
 * @module lib/state
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Lock configuration
 */
const LOCK_CONFIG = {
  /** Max time to wait for lock acquisition in milliseconds */
  maxWaitMs: 30000,
  /** Polling interval in milliseconds */
  pollIntervalMs: 100,
  /** Lock directory suffix */
  lockSuffix: ".lock",
  /** Max retries for lock acquisition */
  maxRetries: 3,
  /** Base delay for exponential backoff in ms */
  baseDelayMs: 100,
};

/**
 * Helper function to sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a unique lock ID for this process
 * @returns {string} Unique lock identifier
 */
function generateLockId() {
  return `${process.pid}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Acquire a file lock using directory-based locking
 *
 * Uses mkdir for atomicity (atomic on POSIX systems).
 * Includes stale lock detection and exponential backoff retry.
 *
 * @param {string} targetPath - Path to file being locked
 * @param {Object} options - Lock options
 * @param {number} options.maxWaitMs - Maximum wait time in ms
 * @param {number} options.pollIntervalMs - Poll interval in ms
 * @param {number} options.maxRetries - Max retry attempts
 * @returns {Promise<Object>} Lock result: { acquired: boolean, lockPath: string, lockId: string, error?: string }
 */
async function acquireLock(targetPath, options = {}) {
  const {
    maxWaitMs = LOCK_CONFIG.maxWaitMs,
    pollIntervalMs = LOCK_CONFIG.pollIntervalMs,
    maxRetries = LOCK_CONFIG.maxRetries,
    baseDelayMs = LOCK_CONFIG.baseDelayMs,
  } = options;

  const lockDir = targetPath + LOCK_CONFIG.lockSuffix;
  const pidFile = path.join(lockDir, "pid");
  const lockId = generateLockId();
  const startTime = Date.now();
  let retryCount = 0;

  while (Date.now() - startTime < maxWaitMs && retryCount < maxRetries) {
    try {
      // Attempt to create lock directory (atomic operation)
      fs.mkdirSync(lockDir, { recursive: false });

      // Write lock info for stale lock detection
      const lockInfo = JSON.stringify({
        pid: process.pid,
        lockId,
        hostname: os.hostname(),
        timestamp: Date.now(),
      });
      fs.writeFileSync(pidFile, lockInfo, "utf8");

      return {
        acquired: true,
        lockPath: lockDir,
        lockId,
        pid: process.pid,
      };
    } catch (err) {
      if (err.code === "EEXIST") {
        // Lock exists - check if it's stale
        const isStale = await checkStaleLock(lockDir, pidFile);
        if (isStale) {
          // Clean up stale lock and retry immediately
          try {
            fs.rmSync(lockDir, { recursive: true, force: true });
            continue;
          } catch {
            // Ignore cleanup errors, another process may have acquired it
          }
        }

        // Exponential backoff on contention
        const delay = Math.min(baseDelayMs * Math.pow(2, retryCount), 1000);
        await sleep(delay + Math.random() * pollIntervalMs);
        retryCount++;
      } else {
        // Unexpected error
        return {
          acquired: false,
          lockPath: lockDir,
          error: `Lock acquisition failed: ${err.message}`,
        };
      }
    }
  }

  return {
    acquired: false,
    lockPath: lockDir,
    error:
      retryCount >= maxRetries
        ? `Max retries (${maxRetries}) exceeded waiting for lock`
        : `Timeout waiting for lock after ${maxWaitMs}ms`,
  };
}

/**
 * Check if a lock is stale (holding process has died)
 *
 * @param {string} lockDir - Lock directory path
 * @param {string} pidFile - PID file path
 * @returns {Promise<boolean>} True if lock is stale
 */
async function checkStaleLock(lockDir, pidFile) {
  try {
    if (!fs.existsSync(pidFile)) {
      // No PID file - assume stale
      return true;
    }

    const content = fs.readFileSync(pidFile, "utf8").trim();
    let lockInfo;

    try {
      lockInfo = JSON.parse(content);
    } catch {
      // Invalid JSON - check if it's a plain PID (backward compat)
      const lockPid = parseInt(content, 10);
      if (isNaN(lockPid)) {
        return true;
      }
      lockInfo = { pid: lockPid };
    }

    // Check if lock is too old (> 5 minutes = likely stale)
    if (lockInfo.timestamp && Date.now() - lockInfo.timestamp > 300000) {
      return true;
    }

    // Check if process is alive
    try {
      // Signal 0 doesn't send a signal but checks if process exists
      process.kill(lockInfo.pid, 0);
      // Process exists - lock is not stale
      return false;
    } catch {
      // Process doesn't exist - lock is stale
      return true;
    }
  } catch {
    // Error reading lock - assume stale
    return true;
  }
}

/**
 * Release a file lock
 *
 * @param {string} targetPath - Path to file being unlocked
 * @returns {Object} Release result: { released: boolean, error?: string }
 */
function releaseLock(targetPath) {
  const lockDir = targetPath + LOCK_CONFIG.lockSuffix;

  try {
    if (fs.existsSync(lockDir)) {
      fs.rmSync(lockDir, { recursive: true, force: true });
    }
    return { released: true };
  } catch (err) {
    return {
      released: false,
      error: `Failed to release lock: ${err.message}`,
    };
  }
}

/**
 * Format a timestamp for log entries
 * @param {Date} date - Date to format
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(date = new Date()) {
  return date.toISOString().replace("T", " ").substring(0, 19);
}

/**
 * BuildStateManager - Manages transactional updates to progress.md and activity.log
 */
class BuildStateManager {
  /**
   * Create a new BuildStateManager
   * @param {string} prdFolder - Path to PRD folder (e.g., .ralph/PRD-67)
   * @param {Object} options - Configuration options
   */
  constructor(prdFolder, options = {}) {
    this.prdFolder = prdFolder;
    this.progressPath = path.join(prdFolder, "progress.md");
    this.activityPath = path.join(prdFolder, "activity.log");
    this.options = {
      maxWaitMs: options.maxWaitMs || LOCK_CONFIG.maxWaitMs,
      maxRetries: options.maxRetries || LOCK_CONFIG.maxRetries,
      ...options,
    };
  }

  /**
   * Log an activity entry to activity.log
   *
   * @param {string} message - Activity message (e.g., "ITERATION 1 start (mode=build story=US-001)")
   * @returns {Promise<Object>} Result: { success: boolean, error?: string }
   */
  async logActivity(message) {
    const lock = await acquireLock(this.activityPath, this.options);
    if (!lock.acquired) {
      return { success: false, error: lock.error };
    }

    try {
      const timestamp = formatTimestamp();
      const entry = `[${timestamp}] ${message}\n`;

      // Ensure the activity log exists with proper structure
      if (!fs.existsSync(this.activityPath)) {
        const initialContent = `# Activity Log

## Run Summary

## Events

`;
        fs.writeFileSync(this.activityPath, initialContent, "utf8");
      }

      // Append to Events section
      const content = fs.readFileSync(this.activityPath, "utf8");
      const lines = content.split("\n");
      const outputLines = [];
      let inEventsSection = false;

      for (const line of lines) {
        outputLines.push(line);
        if (line.trim() === "## Events") {
          inEventsSection = true;
        }
      }

      // Add entry at end (Events section should be last)
      if (inEventsSection) {
        // Ensure there's a newline before the entry if file doesn't end with one
        if (outputLines[outputLines.length - 1] !== "") {
          outputLines.push("");
        }
        outputLines.push(entry.trim());
      } else {
        // No Events section found - append at end
        outputLines.push(entry.trim());
      }

      fs.writeFileSync(this.activityPath, outputLines.join("\n") + "\n", "utf8");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      releaseLock(this.activityPath);
    }
  }

  /**
   * Add a run summary entry to activity.log
   *
   * @param {Object} data - Run summary data
   * @param {string} data.run - Run ID
   * @param {number} data.iter - Iteration number
   * @param {string} data.mode - Mode (build, plan)
   * @param {string} data.story - Story ID (optional)
   * @param {number} data.duration - Duration in seconds
   * @param {string} data.status - Status (success, failed)
   * @param {number} data.cost - Cost (optional)
   * @returns {Promise<Object>} Result: { success: boolean, error?: string }
   */
  async addRunSummary(data) {
    const lock = await acquireLock(this.activityPath, this.options);
    if (!lock.acquired) {
      return { success: false, error: lock.error };
    }

    try {
      const timestamp = formatTimestamp();

      // Build summary line
      let line = `${timestamp} | run=${data.run} | iter=${data.iter} | mode=${data.mode}`;
      if (data.story) {
        line += ` | story=${data.story}`;
      }
      line += ` | duration=${data.duration}s | status=${data.status}`;
      if (data.cost !== undefined && data.cost !== null) {
        line += ` | cost=${data.cost}`;
      }

      // Ensure the activity log exists with proper structure
      if (!fs.existsSync(this.activityPath)) {
        const initialContent = `# Activity Log

## Run Summary
- ${line}

## Events

`;
        fs.writeFileSync(this.activityPath, initialContent, "utf8");
        return { success: true };
      }

      // Insert after "## Run Summary" line
      const content = fs.readFileSync(this.activityPath, "utf8");
      const lines = content.split("\n");
      const outputLines = [];
      let inserted = false;

      for (const fileLine of lines) {
        outputLines.push(fileLine);
        if (!inserted && fileLine.trim() === "## Run Summary") {
          outputLines.push(`- ${line}`);
          inserted = true;
        }
      }

      if (!inserted) {
        // No Run Summary section - create structure
        const newContent = `# Activity Log

## Run Summary
- ${line}

## Events

${content}`;
        fs.writeFileSync(this.activityPath, newContent, "utf8");
      } else {
        fs.writeFileSync(this.activityPath, outputLines.join("\n"), "utf8");
      }

      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      releaseLock(this.activityPath);
    }
  }

  /**
   * Add an iteration entry to progress.md
   *
   * @param {Object} data - Iteration data
   * @param {string} data.storyId - Story ID (e.g., US-001)
   * @param {string} data.storyTitle - Story title
   * @param {string} data.run - Run ID
   * @param {number} data.iteration - Iteration number
   * @param {string} data.runLog - Path to run log
   * @param {string} data.runSummary - Path to run summary
   * @param {string} data.commit - Commit hash and subject (or "none")
   * @param {string} data.postCommitStatus - Post-commit status (clean, list of files)
   * @param {Array<Object>} data.verification - Verification results [{command, result}]
   * @param {Array<string>} data.filesChanged - List of changed files
   * @param {string} data.implementation - Description of what was implemented
   * @param {Array<string>} data.learnings - Learnings for future iterations
   * @param {boolean} data.noCommit - Whether this is a no-commit run
   * @param {string} data.thread - Thread/session ID (optional)
   * @returns {Promise<Object>} Result: { success: boolean, error?: string }
   */
  async addIteration(data) {
    const lock = await acquireLock(this.progressPath, this.options);
    if (!lock.acquired) {
      return { success: false, error: lock.error };
    }

    try {
      const timestamp = formatTimestamp();

      // Build progress entry
      const entry = this._formatProgressEntry(data, timestamp);

      // Ensure the progress log exists with proper structure
      if (!fs.existsSync(this.progressPath)) {
        const initialContent = `# Progress Log
Started: ${new Date().toDateString()} ${new Date().toTimeString().split(" ")[0]}

## Codebase Patterns
- (add reusable patterns here)

---

${entry}`;
        fs.writeFileSync(this.progressPath, initialContent, "utf8");
        return { success: true };
      }

      // Append entry to end of file
      let content = fs.readFileSync(this.progressPath, "utf8");

      // Ensure content ends with newline
      if (!content.endsWith("\n")) {
        content += "\n";
      }

      // Add entry
      content += "\n" + entry;

      fs.writeFileSync(this.progressPath, content, "utf8");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      releaseLock(this.progressPath);
    }
  }

  /**
   * Format a progress entry in the standard format
   * @private
   */
  _formatProgressEntry(data, timestamp) {
    const lines = [];

    // Header
    lines.push(`## [${timestamp}] - ${data.storyId}: ${data.storyTitle}`);
    lines.push(`Thread: ${data.thread || ""}`);
    lines.push(`Run: ${data.run} (iteration ${data.iteration})`);
    lines.push(`Run log: ${data.runLog}`);
    lines.push(`Run summary: ${data.runSummary}`);
    lines.push(`- Guardrails reviewed: yes`);
    lines.push(`- No-commit run: ${data.noCommit ? "true" : "false"}`);
    lines.push(`- Commit: ${data.commit || "none"}`);
    lines.push(`- Post-commit status: ${data.postCommitStatus || "N/A"}`);

    // Verification
    if (data.verification && data.verification.length > 0) {
      lines.push(`- Verification:`);
      for (const v of data.verification) {
        lines.push(`  - Command: ${v.command} -> ${v.result}`);
      }
    }

    // Files changed
    if (data.filesChanged && data.filesChanged.length > 0) {
      lines.push(`- Files changed:`);
      for (const f of data.filesChanged) {
        lines.push(`  - ${f}`);
      }
    }

    // Implementation description
    if (data.implementation) {
      lines.push(`- What was implemented:`);
      const implLines = data.implementation.split("\n");
      for (const line of implLines) {
        lines.push(`  ${line}`);
      }
    }

    // Learnings
    if (data.learnings && data.learnings.length > 0) {
      lines.push(`- **Learnings for future iterations:**`);
      for (const l of data.learnings) {
        lines.push(`  - ${l}`);
      }
    }

    lines.push(`---`);
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Update story status in a plan file (mark [x] when complete)
   *
   * @param {string} planPath - Path to plan.md
   * @param {string} storyId - Story ID (e.g., US-001)
   * @param {boolean} completed - Whether to mark as completed
   * @returns {Promise<Object>} Result: { success: boolean, error?: string }
   */
  async updateStoryStatus(planPath, storyId, completed = true) {
    const lock = await acquireLock(planPath, this.options);
    if (!lock.acquired) {
      return { success: false, error: lock.error };
    }

    try {
      const content = fs.readFileSync(planPath, "utf8");

      // Find and update the story checkbox
      const checkboxPattern = completed ? "[ ]" : "[x]";
      const newCheckbox = completed ? "[x]" : "[ ]";

      // Match story heading pattern: ### [ ] US-XXX: or ### [x] US-XXX:
      const storyRegex = new RegExp(
        `(###\\s*)\\[${completed ? " " : "x"}\\](\\s*${storyId}:)`,
        "g"
      );

      const updatedContent = content.replace(storyRegex, `$1${newCheckbox}$2`);

      if (updatedContent !== content) {
        fs.writeFileSync(planPath, updatedContent, "utf8");
        return { success: true, updated: true };
      }

      return { success: true, updated: false, reason: "Story not found or already in target state" };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      releaseLock(planPath);
    }
  }

  /**
   * Update acceptance criteria checkbox in PRD
   *
   * @param {string} prdPath - Path to prd.md
   * @param {string} criteriaText - Text of the criteria to update
   * @param {boolean} completed - Whether to mark as completed
   * @returns {Promise<Object>} Result: { success: boolean, error?: string }
   */
  async updateCriteriaStatus(prdPath, criteriaText, completed = true) {
    const lock = await acquireLock(prdPath, this.options);
    if (!lock.acquired) {
      return { success: false, error: lock.error };
    }

    try {
      const content = fs.readFileSync(prdPath, "utf8");

      // Escape special regex characters in criteria text
      const escapedText = criteriaText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

      const checkboxPattern = completed ? "[ ]" : "[x]";
      const newCheckbox = completed ? "[x]" : "[ ]";

      // Match criteria checkbox pattern: - [ ] criteria text
      const criteriaRegex = new RegExp(
        `(-\\s*)\\[${completed ? " " : "x"}\\](\\s*${escapedText})`,
        "g"
      );

      const updatedContent = content.replace(criteriaRegex, `$1${newCheckbox}$2`);

      if (updatedContent !== content) {
        fs.writeFileSync(prdPath, updatedContent, "utf8");
        return { success: true, updated: true };
      }

      return { success: true, updated: false, reason: "Criteria not found or already in target state" };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      releaseLock(prdPath);
    }
  }

  /**
   * Batch update multiple files atomically
   *
   * Acquires all locks first, then performs updates, then releases all locks.
   * If any lock fails, no updates are made.
   *
   * @param {Array<Object>} updates - Array of update operations
   * @param {string} updates[].type - Type: 'activity', 'runSummary', 'iteration', 'storyStatus', 'criteriaStatus'
   * @param {Object} updates[].data - Data for the update operation
   * @returns {Promise<Object>} Result: { success: boolean, results: Array, error?: string }
   */
  async batchUpdate(updates) {
    const locksNeeded = new Set();
    const locksAcquired = [];

    // Determine which files need locking
    for (const update of updates) {
      switch (update.type) {
        case "activity":
        case "runSummary":
          locksNeeded.add(this.activityPath);
          break;
        case "iteration":
          locksNeeded.add(this.progressPath);
          break;
        case "storyStatus":
          locksNeeded.add(update.data.planPath);
          break;
        case "criteriaStatus":
          locksNeeded.add(update.data.prdPath);
          break;
      }
    }

    // Acquire all locks
    try {
      for (const filePath of locksNeeded) {
        const lock = await acquireLock(filePath, this.options);
        if (!lock.acquired) {
          // Release any locks we already acquired
          for (const acquiredPath of locksAcquired) {
            releaseLock(acquiredPath);
          }
          return { success: false, error: `Failed to acquire lock for ${filePath}: ${lock.error}` };
        }
        locksAcquired.push(filePath);
      }

      // Perform all updates (locks already held, so skip internal locking)
      const results = [];
      for (const update of updates) {
        let result;
        switch (update.type) {
          case "activity":
            result = await this._logActivityNoLock(update.data.message);
            break;
          case "runSummary":
            result = await this._addRunSummaryNoLock(update.data);
            break;
          case "iteration":
            result = await this._addIterationNoLock(update.data);
            break;
          case "storyStatus":
            result = await this._updateStoryStatusNoLock(
              update.data.planPath,
              update.data.storyId,
              update.data.completed
            );
            break;
          case "criteriaStatus":
            result = await this._updateCriteriaStatusNoLock(
              update.data.prdPath,
              update.data.criteriaText,
              update.data.completed
            );
            break;
          default:
            result = { success: false, error: `Unknown update type: ${update.type}` };
        }
        results.push(result);
      }

      return { success: true, results };
    } finally {
      // Release all locks
      for (const filePath of locksAcquired) {
        releaseLock(filePath);
      }
    }
  }

  // Internal methods without locking (for batch operations)

  async _logActivityNoLock(message) {
    try {
      const timestamp = formatTimestamp();
      const entry = `[${timestamp}] ${message}\n`;

      if (!fs.existsSync(this.activityPath)) {
        const initialContent = `# Activity Log\n\n## Run Summary\n\n## Events\n\n`;
        fs.writeFileSync(this.activityPath, initialContent, "utf8");
      }

      const content = fs.readFileSync(this.activityPath, "utf8");
      const lines = content.split("\n");
      const outputLines = [];

      for (const line of lines) {
        outputLines.push(line);
      }

      if (outputLines[outputLines.length - 1] !== "") {
        outputLines.push("");
      }
      outputLines.push(entry.trim());

      fs.writeFileSync(this.activityPath, outputLines.join("\n") + "\n", "utf8");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _addRunSummaryNoLock(data) {
    try {
      const timestamp = formatTimestamp();
      let line = `${timestamp} | run=${data.run} | iter=${data.iter} | mode=${data.mode}`;
      if (data.story) {
        line += ` | story=${data.story}`;
      }
      line += ` | duration=${data.duration}s | status=${data.status}`;
      if (data.cost !== undefined) {
        line += ` | cost=${data.cost}`;
      }

      if (!fs.existsSync(this.activityPath)) {
        const initialContent = `# Activity Log\n\n## Run Summary\n- ${line}\n\n## Events\n\n`;
        fs.writeFileSync(this.activityPath, initialContent, "utf8");
        return { success: true };
      }

      const content = fs.readFileSync(this.activityPath, "utf8");
      const lines = content.split("\n");
      const outputLines = [];
      let inserted = false;

      for (const fileLine of lines) {
        outputLines.push(fileLine);
        if (!inserted && fileLine.trim() === "## Run Summary") {
          outputLines.push(`- ${line}`);
          inserted = true;
        }
      }

      fs.writeFileSync(this.activityPath, outputLines.join("\n"), "utf8");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _addIterationNoLock(data) {
    try {
      const timestamp = formatTimestamp();
      const entry = this._formatProgressEntry(data, timestamp);

      if (!fs.existsSync(this.progressPath)) {
        const initialContent = `# Progress Log\nStarted: ${new Date().toDateString()}\n\n## Codebase Patterns\n- (add reusable patterns here)\n\n---\n\n${entry}`;
        fs.writeFileSync(this.progressPath, initialContent, "utf8");
        return { success: true };
      }

      let content = fs.readFileSync(this.progressPath, "utf8");
      if (!content.endsWith("\n")) {
        content += "\n";
      }
      content += "\n" + entry;
      fs.writeFileSync(this.progressPath, content, "utf8");
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _updateStoryStatusNoLock(planPath, storyId, completed) {
    try {
      const content = fs.readFileSync(planPath, "utf8");
      const newCheckbox = completed ? "[x]" : "[ ]";
      const storyRegex = new RegExp(
        `(###\\s*)\\[${completed ? " " : "x"}\\](\\s*${storyId}:)`,
        "g"
      );
      const updatedContent = content.replace(storyRegex, `$1${newCheckbox}$2`);
      if (updatedContent !== content) {
        fs.writeFileSync(planPath, updatedContent, "utf8");
        return { success: true, updated: true };
      }
      return { success: true, updated: false };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async _updateCriteriaStatusNoLock(prdPath, criteriaText, completed) {
    try {
      const content = fs.readFileSync(prdPath, "utf8");
      const escapedText = criteriaText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const newCheckbox = completed ? "[x]" : "[ ]";
      const criteriaRegex = new RegExp(
        `(-\\s*)\\[${completed ? " " : "x"}\\](\\s*${escapedText})`,
        "g"
      );
      const updatedContent = content.replace(criteriaRegex, `$1${newCheckbox}$2`);
      if (updatedContent !== content) {
        fs.writeFileSync(prdPath, updatedContent, "utf8");
        return { success: true, updated: true };
      }
      return { success: true, updated: false };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = {
  BuildStateManager,
  acquireLock,
  releaseLock,
  checkStaleLock,
  formatTimestamp,
  LOCK_CONFIG,
};
