/**
 * Story Selection Module - Atomic story selection for parallel builds
 *
 * Provides reliable story parsing and atomic lock+select operations
 * to ensure parallel execution works correctly.
 *
 * @module lib/story
 */

const fs = require("fs");
const path = require("path");
const {
  parseStories,
  parseStoriesFromFile,
  isCompleted,
  isPending,
  getRemaining,
  getCompleted,
  findById,
  getSummary,
  StoryStatus,
  STORY_PATTERN,
} = require("./parser");

/**
 * Lock configuration
 */
const LOCK_CONFIG = {
  /** Max time to wait for lock acquisition in milliseconds */
  maxWaitMs: 30000,
  /** Polling interval in milliseconds */
  pollIntervalMs: 100,
  /** Lock directory name */
  lockDirName: ".story-selection.lock",
  /** PID file name within lock directory */
  pidFileName: "pid",
};

/**
 * Acquire a story selection lock
 *
 * Uses directory-based locking for atomicity (mkdir is atomic on POSIX systems).
 * Includes stale lock detection for cases where the holding process died.
 *
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} options - Lock options
 * @param {number} options.maxWaitMs - Maximum wait time in ms (default: 30000)
 * @param {number} options.pollIntervalMs - Poll interval in ms (default: 100)
 * @returns {Object} Lock result: { acquired: boolean, lockPath: string, error?: string }
 */
async function acquireLock(prdFolder, options = {}) {
  const { maxWaitMs = LOCK_CONFIG.maxWaitMs, pollIntervalMs = LOCK_CONFIG.pollIntervalMs } =
    options;

  const lockDir = path.join(prdFolder, LOCK_CONFIG.lockDirName);
  const pidFile = path.join(lockDir, LOCK_CONFIG.pidFileName);
  const startTime = Date.now();
  const pid = process.pid;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Attempt to create lock directory (atomic operation)
      fs.mkdirSync(lockDir, { recursive: false });

      // Write PID file for stale lock detection
      fs.writeFileSync(pidFile, String(pid), "utf8");

      return {
        acquired: true,
        lockPath: lockDir,
        pid,
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

        // Wait and retry
        await sleep(pollIntervalMs);
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
    error: `Timeout waiting for lock after ${maxWaitMs}ms`,
  };
}

/**
 * Check if a lock is stale (holding process has died)
 *
 * @param {string} lockDir - Lock directory path
 * @param {string} pidFile - PID file path
 * @returns {boolean} True if lock is stale
 */
async function checkStaleLock(lockDir, pidFile) {
  try {
    if (!fs.existsSync(pidFile)) {
      // No PID file - assume stale
      return true;
    }

    const pidContent = fs.readFileSync(pidFile, "utf8").trim();
    const lockPid = parseInt(pidContent, 10);

    if (isNaN(lockPid)) {
      // Invalid PID - assume stale
      return true;
    }

    // Check if process is alive
    try {
      // Signal 0 doesn't send a signal but checks if process exists
      process.kill(lockPid, 0);
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
 * Release a story selection lock
 *
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object} Release result: { released: boolean, error?: string }
 */
function releaseLock(prdFolder) {
  const lockDir = path.join(prdFolder, LOCK_CONFIG.lockDirName);

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
 * Select the next uncompleted story
 *
 * @param {Object[]} stories - Array of story objects from parseStories
 * @returns {Object|null} Next story to work on, or null if none remaining
 */
function selectNextStory(stories) {
  const remaining = getRemaining(stories);
  return remaining.length > 0 ? remaining[0] : null;
}

/**
 * Atomic select-and-lock operation
 *
 * Acquires lock, parses PRD, selects next story, and releases lock.
 * This ensures parallel builds don't select the same story.
 *
 * @param {string} prdPath - Path to PRD file (prd.md)
 * @param {Object} options - Options
 * @param {number} options.maxWaitMs - Max lock wait time in ms
 * @returns {Promise<Object>} Selection result
 */
async function selectAndLock(prdPath, options = {}) {
  const prdFolder = path.dirname(prdPath);

  // Acquire lock first
  const lockResult = await acquireLock(prdFolder, options);

  if (!lockResult.acquired) {
    return {
      ok: false,
      error: lockResult.error,
      lockAcquired: false,
    };
  }

  try {
    // Parse stories from PRD
    const parseResult = parseStoriesFromFile(prdPath);

    if (!parseResult.ok) {
      return {
        ok: false,
        error: parseResult.error,
        lockAcquired: true,
        lockReleased: true,
      };
    }

    // Select next story
    const nextStory = selectNextStory(parseResult.stories);

    // Build result
    const result = {
      ok: true,
      total: parseResult.total,
      completed: parseResult.completed,
      remaining: parseResult.pending,
      lockAcquired: true,
    };

    if (nextStory) {
      result.story = nextStory;
      result.id = nextStory.id;
      result.title = nextStory.title;
      result.block = nextStory.block;
    } else {
      result.story = null;
      result.allCompleted = true;
    }

    return result;
  } catch (err) {
    return {
      ok: false,
      error: `Selection failed: ${err.message}`,
      lockAcquired: true,
    };
  } finally {
    // Always release lock
    releaseLock(prdFolder);
  }
}

/**
 * Select story without locking (for read-only operations)
 *
 * @param {string} prdPath - Path to PRD file
 * @returns {Object} Selection result (same format as selectAndLock)
 */
function selectStory(prdPath) {
  const parseResult = parseStoriesFromFile(prdPath);

  if (!parseResult.ok) {
    return {
      ok: false,
      error: parseResult.error,
    };
  }

  const nextStory = selectNextStory(parseResult.stories);

  const result = {
    ok: true,
    total: parseResult.total,
    completed: parseResult.completed,
    remaining: parseResult.pending,
  };

  if (nextStory) {
    result.story = nextStory;
    result.id = nextStory.id;
    result.title = nextStory.title;
    result.block = nextStory.block;
  } else {
    result.story = null;
    result.allCompleted = true;
  }

  return result;
}

/**
 * Get a specific field from a story (matches bash story_field function)
 *
 * @param {Object} story - Story object
 * @param {string} field - Field name to retrieve
 * @returns {*} Field value or empty string if not found
 */
function storyField(story, field) {
  if (!story || typeof story !== "object") {
    return "";
  }
  return story[field] !== undefined ? story[field] : "";
}

/**
 * Helper function to sleep for a specified number of milliseconds
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write story metadata to a JSON file (matches bash select_story output format)
 *
 * @param {string} metaPath - Path to write metadata JSON
 * @param {Object} result - Result from selectAndLock or selectStory
 */
function writeStoryMeta(metaPath, result) {
  const meta = {
    ok: result.ok,
    total: result.total || 0,
    remaining: result.remaining || 0,
  };

  if (result.ok && result.story) {
    meta.id = result.id;
    meta.title = result.title;
  }

  if (result.error) {
    meta.error = result.error;
  }

  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n", "utf8");
}

/**
 * Write story block content to a file (matches bash select_story output format)
 *
 * @param {string} blockPath - Path to write block content
 * @param {Object} result - Result from selectAndLock or selectStory
 */
function writeStoryBlock(blockPath, result) {
  const block = result.ok && result.block ? result.block : "";
  fs.writeFileSync(blockPath, block, "utf8");
}

module.exports = {
  // Main entry points
  selectAndLock,
  selectStory,
  selectNextStory,

  // Locking primitives
  acquireLock,
  releaseLock,
  checkStaleLock,

  // Parsing (re-exported from parser.js)
  parseStories,
  parseStoriesFromFile,

  // Story utilities
  storyField,
  isCompleted,
  isPending,
  getRemaining,
  getCompleted,
  findById,
  getSummary,

  // Output helpers
  writeStoryMeta,
  writeStoryBlock,

  // Constants
  StoryStatus,
  STORY_PATTERN,
  LOCK_CONFIG,
};
