/**
 * Shared argument parsing utilities for Ralph CLI commands
 * Provides consistent flag parsing across all commands
 */

/**
 * Parse a flag value from args array
 * Supports both --flag=value and --flag value formats
 * @param {string[]} args - Arguments array
 * @param {string} flagName - Flag name without -- prefix
 * @param {*} defaultValue - Default value if flag not found
 * @returns {*} Parsed value or default
 */
function parseFlag(args, flagName, defaultValue = null) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Handle --flag=value format
    if (arg.startsWith(`--${flagName}=`)) {
      return arg.split("=").slice(1).join("=");
    }

    // Handle --flag value format
    if (arg === `--${flagName}` && args[i + 1] && !args[i + 1].startsWith("--")) {
      return args[i + 1];
    }
  }
  return defaultValue;
}

/**
 * Check if a boolean flag is present
 * @param {string[]} args - Arguments array
 * @param {string} flagName - Flag name without -- prefix
 * @returns {boolean}
 */
function hasFlag(args, flagName) {
  return args.includes(`--${flagName}`);
}

/**
 * Parse numeric flag value
 * @param {string[]} args - Arguments array
 * @param {string} flagName - Flag name without -- prefix
 * @param {number} defaultValue - Default value if flag not found or invalid
 * @returns {number}
 */
function parseNumericFlag(args, flagName, defaultValue = 0) {
  const value = parseFlag(args, flagName);
  if (value === null) return defaultValue;
  const num = parseInt(value, 10);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Parse comma-separated list flag
 * @param {string[]} args - Arguments array
 * @param {string} flagName - Flag name without -- prefix
 * @returns {string[]} Array of values (empty if not found)
 */
function parseListFlag(args, flagName) {
  const value = parseFlag(args, flagName);
  if (!value) return [];
  return value.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Get positional arguments (non-flag arguments after command)
 * @param {string[]} args - Arguments array
 * @param {number} startIndex - Index to start from (after command name)
 * @returns {string[]}
 */
function getPositionalArgs(args, startIndex = 1) {
  const positional = [];
  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      // Skip flag and its value if next arg doesn't start with --
      if (!arg.includes("=") && args[i + 1] && !args[i + 1].startsWith("--")) {
        i++; // Skip the value
      }
      continue;
    }
    positional.push(arg);
  }
  return positional;
}

/**
 * Parse common global flags that appear in many commands
 * @param {string[]} args - Arguments array
 * @returns {Object} Common flags object
 */
function parseCommonFlags(args) {
  return {
    json: hasFlag(args, "json"),
    verbose: hasFlag(args, "verbose") || hasFlag(args, "v"),
    help: hasFlag(args, "help") || hasFlag(args, "h"),
    prdNumber: parseFlag(args, "prd"),
    tags: parseListFlag(args, "tags"),
  };
}

module.exports = {
  parseFlag,
  hasFlag,
  parseNumericFlag,
  parseListFlag,
  getPositionalArgs,
  parseCommonFlags,
};
