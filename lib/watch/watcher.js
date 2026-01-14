/**
 * File Watcher Module
 *
 * Watches .ralph/PRD-N/ and .agents/ralph/ directories for changes.
 * Uses EventEmitter pattern with debouncing for rapid change handling.
 */

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");

/**
 * Default debounce time in milliseconds
 */
const DEFAULT_DEBOUNCE_MS = 500;

/**
 * FileWatcher class - watches Ralph directories for file changes
 */
class FileWatcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.watchers = new Map(); // Map of path -> FSWatcher
    this.debounceTimers = new Map(); // Map of debounce key -> timer
    this.debounceMs = options.debounceMs || DEFAULT_DEBOUNCE_MS;
    this.isWatching = false;
    this.watchedPaths = new Set();
    this.prdNumber = null;
  }

  /**
   * Start watching the specified PRD directory and config directory
   * @param {string} prdPath - Path to .ralph/PRD-N directory
   * @param {Object} options - Watch options
   * @param {number} [options.debounceMs] - Debounce time in milliseconds
   * @returns {boolean} - True if watch started successfully
   */
  start(prdPath, options = {}) {
    if (this.isWatching) {
      return true;
    }

    if (options.debounceMs) {
      this.debounceMs = options.debounceMs;
    }

    // Extract PRD number from path (e.g., PRD-1 -> 1)
    const prdMatch = prdPath.match(/PRD-(\d+)/i);
    if (prdMatch) {
      this.prdNumber = prdMatch[1];
    }

    // Determine paths to watch
    const watchPaths = [];

    // Watch the PRD directory
    if (fs.existsSync(prdPath)) {
      watchPaths.push({ path: prdPath, type: "prd" });
    } else {
      this.emit("error", new Error(`PRD path not found: ${prdPath}`));
      return false;
    }

    // Watch .agents/ralph/ directory (find it relative to .ralph/)
    const ralphDir = path.dirname(prdPath);
    const projectRoot = path.dirname(ralphDir);
    const agentsDir = path.join(projectRoot, ".agents", "ralph");

    if (fs.existsSync(agentsDir)) {
      watchPaths.push({ path: agentsDir, type: "config" });
    }

    // Start watching each path
    for (const { path: watchPath, type } of watchPaths) {
      try {
        const watcher = fs.watch(
          watchPath,
          { recursive: true },
          (eventType, filename) => {
            if (filename) {
              this.handleFileChange(watchPath, type, eventType, filename);
            }
          }
        );

        watcher.on("error", (err) => {
          this.emit("error", err);
        });

        watcher.on("close", () => {
          this.watchers.delete(watchPath);
          this.watchedPaths.delete(watchPath);
        });

        this.watchers.set(watchPath, watcher);
        this.watchedPaths.add(watchPath);
      } catch (err) {
        this.emit("error", err);
        return false;
      }
    }

    this.isWatching = true;
    this.emit("started", {
      paths: Array.from(this.watchedPaths),
      prdNumber: this.prdNumber,
    });

    return true;
  }

  /**
   * Stop watching all directories
   */
  stop() {
    // Close all watchers
    for (const [watchPath, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.watchedPaths.clear();
    this.isWatching = false;
    this.prdNumber = null;

    this.emit("stopped");
  }

  /**
   * Check if watcher is active
   * @returns {boolean}
   */
  isActive() {
    return this.isWatching;
  }

  /**
   * Get the paths being watched
   * @returns {string[]}
   */
  getWatchedPaths() {
    return Array.from(this.watchedPaths);
  }

  /**
   * Set debounce interval in milliseconds
   * @param {number} ms - Debounce time
   */
  setDebounceMs(ms) {
    this.debounceMs = Math.max(10, Math.min(5000, ms));
  }

  /**
   * Handle file change with debouncing
   * @private
   */
  handleFileChange(basePath, pathType, eventType, filename) {
    // Create unique key for debouncing based on file and event
    const debounceKey = `${basePath}:${eventType}:${filename}`;

    // Clear existing timer if any
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced handler
    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      this.processFileChange(basePath, pathType, eventType, filename);
    }, this.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Process file change after debounce period
   * @private
   */
  processFileChange(basePath, pathType, eventType, filename) {
    const fullPath = path.join(basePath, filename);
    const changeType = this.determineChangeType(eventType, fullPath);

    // Normalize filename for pattern matching
    const normalizedFilename = filename.replace(/\\/g, "/");

    // Create base event data
    const baseEvent = {
      timestamp: new Date(),
      path: fullPath,
      filename: normalizedFilename,
      changeType,
      prdNumber: this.prdNumber,
    };

    // Always emit generic file_changed event
    this.emit("file_changed", baseEvent);

    // Detect and emit specific events based on file patterns
    if (pathType === "config") {
      // Config file changed
      this.emitConfigChanged(baseEvent);
    } else {
      // PRD directory - check for specific file types
      this.detectPRDFileType(normalizedFilename, baseEvent);
    }
  }

  /**
   * Determine if change is create, modify, or delete
   * @private
   */
  determineChangeType(eventType, fullPath) {
    if (eventType === "rename") {
      // rename can mean create or delete
      try {
        fs.accessSync(fullPath);
        return "create";
      } catch {
        return "delete";
      }
    }
    return "modify";
  }

  /**
   * Detect PRD file type and emit appropriate event
   * @private
   */
  detectPRDFileType(filename, baseEvent) {
    // Check for prd.md
    if (filename === "prd.md" || filename.endsWith("/prd.md")) {
      this.emit("prd_changed", {
        ...baseEvent,
        prdPath: baseEvent.path,
      });
      return;
    }

    // Check for plan.md
    if (filename === "plan.md" || filename.endsWith("/plan.md")) {
      this.emit("plan_changed", {
        ...baseEvent,
        planPath: baseEvent.path,
      });
      return;
    }

    // Check for progress.md
    if (filename === "progress.md" || filename.endsWith("/progress.md")) {
      this.emit("progress_changed", {
        ...baseEvent,
        progressPath: baseEvent.path,
      });
      return;
    }
  }

  /**
   * Emit config_changed event
   * @private
   */
  emitConfigChanged(baseEvent) {
    this.emit("config_changed", {
      ...baseEvent,
      configPath: baseEvent.path,
    });
  }
}

/**
 * Create and start a new file watcher
 * @param {string} prdPath - Path to .ralph/PRD-N directory
 * @param {Object} options - Watch options
 * @returns {FileWatcher} - The watcher instance
 */
function startWatch(prdPath, options = {}) {
  const watcher = new FileWatcher(options);
  watcher.start(prdPath, options);
  return watcher;
}

/**
 * Stop a watcher
 * @param {FileWatcher} watcher - The watcher to stop
 */
function stopWatch(watcher) {
  if (watcher && typeof watcher.stop === "function") {
    watcher.stop();
  }
}

module.exports = {
  FileWatcher,
  startWatch,
  stopWatch,
  DEFAULT_DEBOUNCE_MS,
};
