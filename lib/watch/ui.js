/**
 * Watch Dashboard UI
 *
 * Terminal dashboard for Ralph watch mode.
 * Shows PRD/plan status, recent file changes, and running actions.
 * Supports keyboard shortcuts for interaction.
 */

const fs = require("node:fs");
const path = require("node:path");
const pc = require("picocolors");

/**
 * ANSI escape codes for terminal control
 */
const ANSI = {
  CLEAR_SCREEN: "\x1b[2J",
  CURSOR_HOME: "\x1b[H",
  CURSOR_HIDE: "\x1b[?25l",
  CURSOR_SHOW: "\x1b[?25h",
  CLEAR_LINE: "\x1b[2K",
  MOVE_UP: (n) => `\x1b[${n}A`,
  MOVE_DOWN: (n) => `\x1b[${n}B`,
  SAVE_CURSOR: "\x1b[s",
  RESTORE_CURSOR: "\x1b[u",
};

/**
 * Dashboard state
 */
class DashboardState {
  constructor() {
    this.prdNumber = null;
    this.prdPath = null;
    this.planPath = null;
    this.storiesPending = 0;
    this.storiesComplete = 0;
    this.storiesTotal = 0;
    this.lastPrdModified = null;
    this.lastPlanModified = null;
    this.recentChanges = []; // Array of { time, file, action, result }
    this.currentAction = null; // { name, startedAt } or null
    this.pendingActions = [];
    this.status = "Ready";
    this.isRunning = false;
    this.watchedPaths = [];
    // Build mode state
    this.buildMode = false;
    this.buildRunning = false;
    this.buildPaused = false;
    this.buildOutput = []; // Last N lines of build output
    this.buildExitCode = null;
    this.maxBuildOutputLines = 15;
  }
}

/**
 * WatchDashboard class - manages terminal UI for watch mode
 */
class WatchDashboard {
  constructor(options = {}) {
    this.state = new DashboardState();
    this.maxRecentChanges = options.maxRecentChanges || 8;
    this.refreshInterval = options.refreshInterval || 1000;
    this.keyHandlers = new Map();
    this.isRendering = false;
    this.renderTimer = null;
    this.stdinListener = null;
    this.originalRawMode = null;
    this.onQuit = options.onQuit || (() => {});
    this.onReload = options.onReload || (() => {});
    this.onBuild = options.onBuild || (() => {});
    this.onResume = options.onResume || (() => {});
    this.projectRoot = options.projectRoot || process.cwd();

    // Register default key handlers
    this.registerKeyHandler("q", () => this.handleQuit());
    this.registerKeyHandler("r", () => this.handleReload());
    this.registerKeyHandler("b", () => this.handleBuild());
    this.registerKeyHandler("c", () => this.handleResume());
    this.registerKeyHandler("\x03", () => this.handleQuit()); // Ctrl+C
  }

  /**
   * Initialize the dashboard with PRD information
   * @param {Object} config - Dashboard configuration
   * @param {string} config.prdNumber - PRD number
   * @param {string} config.prdPath - Path to PRD directory
   * @param {string[]} config.watchedPaths - Paths being watched
   */
  init(config) {
    this.state.prdNumber = config.prdNumber;
    this.state.prdPath = config.prdPath;
    this.state.watchedPaths = config.watchedPaths || [];
    this.state.buildMode = config.buildMode || false;

    // Set plan path
    if (config.prdPath) {
      this.state.planPath = path.join(config.prdPath, "plan.md");
    }

    // Load initial PRD/plan status
    this.refreshPRDStatus();
  }

  /**
   * Refresh PRD and plan status from files
   */
  refreshPRDStatus() {
    const { prdPath, planPath } = this.state;

    // Read PRD status
    if (prdPath) {
      const prdFilePath = path.join(prdPath, "prd.md");
      try {
        const stat = fs.statSync(prdFilePath);
        this.state.lastPrdModified = stat.mtime;
      } catch {
        // File may not exist
      }
    }

    // Read plan status
    if (planPath && fs.existsSync(planPath)) {
      try {
        const stat = fs.statSync(planPath);
        this.state.lastPlanModified = stat.mtime;

        const content = fs.readFileSync(planPath, "utf-8");
        this.parsePlanStatus(content);
      } catch {
        // Ignore read errors
      }
    }
  }

  /**
   * Parse plan.md to count stories
   * @param {string} content - Plan file content
   */
  parsePlanStatus(content) {
    // Count completed stories: ### [x] US-XXX
    const completedPattern = /^###\s*\[x\]\s*US-\d+/gim;
    const completedMatches = content.match(completedPattern) || [];

    // Count pending stories: ### [ ] US-XXX
    const pendingPattern = /^###\s*\[ \]\s*US-\d+/gim;
    const pendingMatches = content.match(pendingPattern) || [];

    this.state.storiesComplete = completedMatches.length;
    this.state.storiesPending = pendingMatches.length;
    this.state.storiesTotal = completedMatches.length + pendingMatches.length;
  }

  /**
   * Add a file change to recent changes list
   * @param {Object} change - Change information
   * @param {string} change.file - File name
   * @param {string} change.action - Action type (create, modify, delete)
   * @param {string} change.result - Result (validated, warning, error)
   * @param {string} [change.resultIcon] - Result icon
   */
  addFileChange(change) {
    const entry = {
      time: new Date(),
      file: change.file,
      action: change.action,
      result: change.result || "",
      resultIcon: change.resultIcon || "",
    };

    // Add to beginning of array
    this.state.recentChanges.unshift(entry);

    // Trim to max size
    if (this.state.recentChanges.length > this.maxRecentChanges) {
      this.state.recentChanges = this.state.recentChanges.slice(0, this.maxRecentChanges);
    }

    // Refresh PRD status on PRD/plan changes
    if (change.file === "prd.md" || change.file === "plan.md") {
      this.refreshPRDStatus();
    }

    this.render();
  }

  /**
   * Set the current running action
   * @param {string|null} actionName - Action name or null if idle
   */
  setCurrentAction(actionName) {
    if (actionName) {
      this.state.currentAction = {
        name: actionName,
        startedAt: new Date(),
      };
      this.state.status = "Running";
    } else {
      this.state.currentAction = null;
      this.state.status = "Ready";
    }
    this.render();
  }

  /**
   * Add a pending action to queue
   * @param {string} actionName - Action name
   */
  addPendingAction(actionName) {
    this.state.pendingActions.push(actionName);
    this.render();
  }

  /**
   * Remove a pending action from queue
   * @param {string} actionName - Action name
   */
  removePendingAction(actionName) {
    const idx = this.state.pendingActions.indexOf(actionName);
    if (idx >= 0) {
      this.state.pendingActions.splice(idx, 1);
    }
    this.render();
  }

  /**
   * Set dashboard status
   * @param {string} status - Status message
   */
  setStatus(status) {
    this.state.status = status;
    this.render();
  }

  /**
   * Set build running state
   * @param {boolean} running - Whether build is running
   */
  setBuildRunning(running) {
    this.state.buildRunning = running;
    if (running) {
      this.state.buildOutput = [];
      this.state.buildExitCode = null;
      this.state.buildPaused = false;
    }
    this.render();
  }

  /**
   * Set build paused state (after failure)
   * @param {boolean} paused - Whether build is paused
   * @param {number} [exitCode] - Exit code if failed
   */
  setBuildPaused(paused, exitCode = null) {
    this.state.buildPaused = paused;
    this.state.buildRunning = false;
    if (exitCode !== null) {
      this.state.buildExitCode = exitCode;
    }
    this.render();
  }

  /**
   * Add build output line
   * @param {string} line - Output line
   */
  addBuildOutput(line) {
    this.state.buildOutput.push(line);
    // Trim to max lines
    if (this.state.buildOutput.length > this.state.maxBuildOutputLines) {
      this.state.buildOutput = this.state.buildOutput.slice(-this.state.maxBuildOutputLines);
    }
    this.render();
  }

  /**
   * Clear build output
   */
  clearBuildOutput() {
    this.state.buildOutput = [];
    this.state.buildExitCode = null;
    this.render();
  }

  /**
   * Register a keyboard shortcut handler
   * @param {string} key - Key character
   * @param {Function} handler - Handler function
   */
  registerKeyHandler(key, handler) {
    this.keyHandlers.set(key, handler);
  }

  /**
   * Start the dashboard (enable raw mode and start rendering)
   */
  start() {
    if (this.state.isRunning) {
      return;
    }

    this.state.isRunning = true;

    // Enable raw mode for keyboard input
    if (process.stdin.isTTY) {
      this.originalRawMode = process.stdin.isRaw;
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      this.stdinListener = (key) => this.handleKeypress(key);
      process.stdin.on("data", this.stdinListener);
    }

    // Initial render
    this.render();
  }

  /**
   * Stop the dashboard and cleanup
   */
  stop() {
    if (!this.state.isRunning) {
      return;
    }

    this.state.isRunning = false;

    // Restore terminal state
    if (process.stdin.isTTY && this.originalRawMode !== null) {
      process.stdin.setRawMode(this.originalRawMode);
      if (this.stdinListener) {
        process.stdin.removeListener("data", this.stdinListener);
      }
    }

    // Show cursor
    process.stdout.write(ANSI.CURSOR_SHOW);

    // Clear render timer
    if (this.renderTimer) {
      clearInterval(this.renderTimer);
      this.renderTimer = null;
    }
  }

  /**
   * Handle keypress
   * @param {string} key - Key pressed
   */
  handleKeypress(key) {
    const handler = this.keyHandlers.get(key);
    if (handler) {
      handler();
    }
  }

  /**
   * Handle quit key
   */
  handleQuit() {
    this.stop();
    this.onQuit();
  }

  /**
   * Handle reload key
   */
  handleReload() {
    this.refreshPRDStatus();
    this.addFileChange({
      file: "config",
      action: "reload",
      result: "reloaded",
      resultIcon: "✓",
    });
    this.onReload();
  }

  /**
   * Handle build key (manual build trigger)
   */
  handleBuild() {
    if (this.state.buildMode && !this.state.buildRunning) {
      this.onBuild();
    }
  }

  /**
   * Handle resume key (continue after failure)
   */
  handleResume() {
    if (this.state.buildPaused) {
      this.state.buildPaused = false;
      this.state.status = "Ready";
      this.render();
      this.onResume();
    }
  }

  /**
   * Render the dashboard to terminal
   */
  render() {
    if (this.isRendering || !this.state.isRunning) {
      return;
    }

    this.isRendering = true;

    const output = this.buildDashboard();

    // Clear screen and move to top
    process.stdout.write(ANSI.CLEAR_SCREEN + ANSI.CURSOR_HOME);
    process.stdout.write(output);

    this.isRendering = false;
  }

  /**
   * Build the dashboard output string
   * @returns {string} Dashboard content
   */
  buildDashboard() {
    const lines = [];
    const width = Math.min(process.stdout.columns || 80, 80);
    const divider = pc.dim("─".repeat(width));

    // Header
    lines.push("");
    lines.push(pc.bold(pc.cyan("  Ralph Watch Mode")));
    lines.push(divider);

    // PRD/Plan Status Section
    lines.push("");
    lines.push(pc.bold("  Status"));
    lines.push(this.buildStatusSection());

    // Recent Changes Section
    lines.push("");
    lines.push(pc.bold("  Recent Changes"));
    lines.push(this.buildChangesSection());

    // Actions Section
    lines.push("");
    lines.push(pc.bold("  Actions"));
    lines.push(this.buildActionsSection());

    // Build Output Section (only if in build mode and have output)
    if (this.state.buildMode && (this.state.buildOutput.length > 0 || this.state.buildRunning)) {
      lines.push("");
      lines.push(pc.bold("  Build Output"));
      lines.push(this.buildBuildOutputSection());
    }

    // Footer with shortcuts
    lines.push("");
    lines.push(divider);
    lines.push(this.buildFooter());
    lines.push("");

    return lines.join("\n");
  }

  /**
   * Build the status section
   * @returns {string} Status section content
   */
  buildStatusSection() {
    const lines = [];
    const { prdNumber, storiesPending, storiesComplete, storiesTotal, lastPrdModified, lastPlanModified, watchedPaths } = this.state;

    // PRD info
    lines.push(`  PRD: ${pc.cyan(`PRD-${prdNumber}`)}`);

    // Stories progress bar
    if (storiesTotal > 0) {
      const progress = storiesComplete / storiesTotal;
      const barWidth = 20;
      const filled = Math.round(progress * barWidth);
      const empty = barWidth - filled;
      const progressBar = pc.green("█".repeat(filled)) + pc.dim("░".repeat(empty));
      lines.push(`  Stories: ${progressBar} ${storiesComplete}/${storiesTotal}`);
      lines.push(`           ${pc.dim(`${storiesPending} pending`)}`);
    } else {
      lines.push(`  Stories: ${pc.dim("No stories found")}`);
    }

    // Last modified times
    if (lastPrdModified) {
      lines.push(`  PRD modified: ${pc.dim(this.formatTime(lastPrdModified))}`);
    }
    if (lastPlanModified) {
      lines.push(`  Plan modified: ${pc.dim(this.formatTime(lastPlanModified))}`);
    }

    // Watched paths
    if (watchedPaths.length > 0) {
      const shortenedPaths = watchedPaths.map(p => {
        const rel = path.relative(this.projectRoot, p);
        return rel.length < p.length ? rel : p;
      });
      lines.push(`  Watching: ${pc.dim(shortenedPaths.join(", "))}`);
    }

    return lines.join("\n");
  }

  /**
   * Build the recent changes section
   * @returns {string} Changes section content
   */
  buildChangesSection() {
    const { recentChanges } = this.state;

    if (recentChanges.length === 0) {
      return `  ${pc.dim("No changes yet. Waiting for file changes...")}`;
    }

    const lines = [];
    for (const change of recentChanges) {
      const time = this.formatTime(change.time);
      const fileColor = this.getFileColor(change.file);
      const resultStr = change.result ? ` → ${change.result} ${change.resultIcon}` : "";

      lines.push(`  ${pc.dim(time)} ${fileColor(change.file)} ${pc.dim(change.action)}${resultStr}`);
    }

    return lines.join("\n");
  }

  /**
   * Build the actions section
   * @returns {string} Actions section content
   */
  buildActionsSection() {
    const { currentAction, pendingActions, status } = this.state;
    const lines = [];

    // Current action
    if (currentAction) {
      const elapsed = Math.round((Date.now() - currentAction.startedAt.getTime()) / 1000);
      const spinner = this.getSpinner();
      lines.push(`  ${spinner} ${pc.yellow(`Running: ${currentAction.name}`)} ${pc.dim(`(${elapsed}s)`)}`);
    } else {
      lines.push(`  Status: ${status === "Ready" ? pc.green(status) : pc.yellow(status)}`);
    }

    // Pending actions
    if (pendingActions.length > 0) {
      lines.push(`  Pending: ${pc.dim(pendingActions.join(", "))}`);
    }

    return lines.join("\n");
  }

  /**
   * Build the build output section
   * @returns {string} Build output section content
   */
  buildBuildOutputSection() {
    const { buildOutput, buildRunning, buildPaused, buildExitCode } = this.state;
    const lines = [];

    // Status line
    if (buildRunning) {
      const spinner = this.getSpinner();
      lines.push(`  ${spinner} ${pc.yellow("Build running...")}`);
    } else if (buildPaused) {
      lines.push(`  ${pc.red("✗")} ${pc.red(`Build failed (exit ${buildExitCode})`)} - ${pc.dim("Press 'c' to continue or fix plan")}`);
    } else if (buildOutput.length > 0) {
      lines.push(`  ${pc.green("✓")} ${pc.green("Build completed")}`);
    }

    // Output lines (truncated to last N lines)
    if (buildOutput.length > 0) {
      lines.push(pc.dim("  ───────────────────────────────────────"));
      for (const line of buildOutput) {
        // Strip ANSI for line length check but keep for display
        const stripped = line.replace(/\x1b\[[0-9;]*m/g, "");
        const truncated = stripped.length > 70 ? stripped.slice(0, 67) + "..." : stripped;
        lines.push(`  ${pc.dim("│")} ${truncated}`);
      }
      lines.push(pc.dim("  ───────────────────────────────────────"));
    }

    return lines.join("\n");
  }

  /**
   * Build the footer with keyboard shortcuts
   * @returns {string} Footer content
   */
  buildFooter() {
    const shortcuts = [
      `${pc.bold("q")}${pc.dim("=quit")}`,
      `${pc.bold("r")}${pc.dim("=reload")}`,
    ];

    // Add build mode shortcuts
    if (this.state.buildMode) {
      shortcuts.push(`${pc.bold("b")}${pc.dim("=build")}`);
      if (this.state.buildPaused) {
        shortcuts.push(`${pc.bold("c")}${pc.dim("=continue")}`);
      }
    }

    return `  Commands: ${shortcuts.join("  ")}`;
  }

  /**
   * Format a date/time for display
   * @param {Date} date - Date to format
   * @returns {string} Formatted time string
   */
  formatTime(date) {
    if (!date) return "";
    return date.toLocaleTimeString("en-US", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  /**
   * Get color function for a file type
   * @param {string} filename - File name
   * @returns {Function} Color function
   */
  getFileColor(filename) {
    if (filename === "prd.md" || filename.endsWith("/prd.md")) {
      return pc.yellow;
    }
    if (filename === "plan.md" || filename.endsWith("/plan.md")) {
      return pc.cyan;
    }
    if (filename === "config.sh" || filename.endsWith(".sh") || filename === "config") {
      return pc.magenta;
    }
    if (filename.endsWith(".js")) {
      return pc.green;
    }
    return pc.white;
  }

  /**
   * Get spinner character for running action
   * @returns {string} Spinner character
   */
  getSpinner() {
    const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    const idx = Math.floor(Date.now() / 100) % frames.length;
    return pc.cyan(frames[idx]);
  }
}

/**
 * Create and initialize a dashboard
 * @param {Object} config - Dashboard configuration
 * @returns {WatchDashboard} Dashboard instance
 */
function createDashboard(config = {}) {
  const dashboard = new WatchDashboard(config);
  if (config.prdNumber || config.prdPath) {
    dashboard.init(config);
  }
  return dashboard;
}

/**
 * Render a simple one-time dashboard view (non-interactive)
 * @param {Object} state - Dashboard state
 */
function renderDashboard(state) {
  const dashboard = new WatchDashboard();
  Object.assign(dashboard.state, state);
  dashboard.state.isRunning = true;
  const output = dashboard.buildDashboard();
  console.log(output);
}

/**
 * Clear the dashboard from terminal
 */
function clearDashboard() {
  process.stdout.write(ANSI.CLEAR_SCREEN + ANSI.CURSOR_HOME + ANSI.CURSOR_SHOW);
}

/**
 * Update a single line in place (for minimal redraws)
 * @param {number} line - Line number (0-indexed from top)
 * @param {string} content - New content for the line
 */
function updateLine(line, content) {
  process.stdout.write(`${ANSI.SAVE_CURSOR}\x1b[${line + 1};1H${ANSI.CLEAR_LINE}${content}${ANSI.RESTORE_CURSOR}`);
}

module.exports = {
  WatchDashboard,
  DashboardState,
  createDashboard,
  renderDashboard,
  clearDashboard,
  updateLine,
  ANSI,
};
