/**
 * Command registry and dispatcher for Ralph CLI
 *
 * This module provides:
 * 1. A registry of all available commands
 * 2. A dispatcher that loads commands on demand
 * 3. Help text generation from command metadata
 */

// Command registry - maps command names to their module paths
// Commands are loaded lazily to reduce startup time and context consumption
const COMMANDS = {
  // Getting Started
  install: "./install",
  init: "./init",
  ping: "./ping",
  help: "./help",

  // Core Workflow
  prd: "./prd",
  plan: "./plan",
  build: "./build",
  eval: "./eval",
  improve: "./improve",

  // Stream Management
  stream: "./stream",

  // Analytics & Estimation
  estimate: "./estimate",
  stats: "./stats",
  routing: "./routing",

  // Diagnostics
  doctor: "./doctor",
  diagnose: "./diagnose",

  // Experimentation
  experiment: "./experiment",

  // Project & Knowledge Management
  registry: "./registry",
  search: "./search",
  import: "./import",
  optimize: "./optimize",

  // Utilities
  checkpoint: "./checkpoint",
  watch: "./watch",
  ui: "./ui",
  log: "./log",
  completions: "./completions",

  // Voice Control
  voice: "./voice",

  // Error Handling & Notifications (US-012)
  error: "./error",
  budget: "./budget",
  notify: "./notify",
};

// Aliases for common commands
const ALIASES = {
  "-h": "help",
  "--help": "help",
};

/**
 * Get a command module by name
 * Loads the module on demand
 * @param {string} name - Command name
 * @returns {Object|null} Command module or null if not found
 */
function getCommand(name) {
  const resolved = ALIASES[name] || name;
  const modulePath = COMMANDS[resolved];

  if (!modulePath) {
    return null;
  }

  try {
    return require(modulePath);
  } catch (err) {
    // Command module not yet extracted - return null
    // The main CLI will fall back to inline handling
    return null;
  }
}

/**
 * Check if a command exists
 * @param {string} name - Command name
 * @returns {boolean}
 */
function hasCommand(name) {
  const resolved = ALIASES[name] || name;
  return COMMANDS[resolved] !== undefined;
}

/**
 * Get all registered command names
 * @returns {string[]}
 */
function listCommands() {
  return Object.keys(COMMANDS);
}

/**
 * Run a command
 * @param {string} name - Command name
 * @param {string[]} args - Command arguments
 * @param {Object} env - Environment variables
 * @param {Object} options - Additional options (cwd, templateDir, etc)
 * @returns {Promise<number>} Exit code
 */
async function runCommand(name, args, env, options) {
  const command = getCommand(name);

  if (!command) {
    return null; // Command not found or not yet extracted
  }

  if (typeof command.run !== "function") {
    throw new Error(`Command '${name}' does not export a run function`);
  }

  return command.run(args, env, options);
}

module.exports = {
  COMMANDS,
  ALIASES,
  getCommand,
  hasCommand,
  listCommands,
  runCommand,
};
