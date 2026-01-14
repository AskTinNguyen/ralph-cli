/**
 * Watch module - main entry point
 *
 * Provides file watching capabilities for Ralph CLI.
 * Watches PRD, plan, and config files for changes.
 */

const {
  FileWatcher,
  startWatch,
  stopWatch,
  DEFAULT_DEBOUNCE_MS,
} = require("./watcher");

const {
  registerAction,
  unregisterAction,
  listActions,
  getActionsForTrigger,
  executeAction,
  executeActionsForTrigger,
  loadCustomConfig,
  clearCustomActions,
  handlers,
} = require("./actions");

module.exports = {
  // Watcher class and functions
  FileWatcher,
  startWatch,
  stopWatch,
  DEFAULT_DEBOUNCE_MS,
  // Action registry and execution
  registerAction,
  unregisterAction,
  listActions,
  getActionsForTrigger,
  executeAction,
  executeActionsForTrigger,
  loadCustomConfig,
  clearCustomActions,
  handlers,
};
