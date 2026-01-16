/**
 * Path utilities for Ralph CLI
 * Provides consistent path resolution across all commands
 */
const fs = require("fs");
const path = require("path");

/**
 * Find the project root by walking up from a starting directory
 * to find the nearest .ralph directory.
 *
 * Configuration priority:
 * 1. RALPH_ROOT environment variable (if set and exists)
 * 2. Walk up from starting directory
 *
 * @param {string} startDir - Directory to start searching from (default: process.cwd())
 * @returns {string|null} Path to project root (parent of .ralph) or null if not found
 */
function findProjectRoot(startDir = process.cwd()) {
  // Check if RALPH_ROOT is explicitly configured
  if (process.env.RALPH_ROOT) {
    const explicitPath = path.resolve(process.env.RALPH_ROOT);
    if (fs.existsSync(explicitPath) && fs.statSync(explicitPath).isDirectory()) {
      // RALPH_ROOT points to the .ralph directory, return its parent
      return path.dirname(explicitPath);
    }
    // RALPH_ROOT might point to project root itself
    const ralphInProject = path.join(explicitPath, ".ralph");
    if (fs.existsSync(ralphInProject) && fs.statSync(ralphInProject).isDirectory()) {
      return explicitPath;
    }
  }

  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    const ralphPath = path.join(currentDir, ".ralph");
    if (fs.existsSync(ralphPath) && fs.statSync(ralphPath).isDirectory()) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }

  // Check root directory too
  const rootRalphPath = path.join(root, ".ralph");
  if (fs.existsSync(rootRalphPath) && fs.statSync(rootRalphPath).isDirectory()) {
    return root;
  }

  return null;
}

/**
 * Find the .ralph directory by walking up from a starting directory.
 *
 * @param {string} startDir - Directory to start searching from (default: process.cwd())
 * @returns {string|null} Path to .ralph directory or null if not found
 */
function findRalphDir(startDir = process.cwd()) {
  const projectRoot = findProjectRoot(startDir);
  if (projectRoot) {
    return path.join(projectRoot, ".ralph");
  }
  return null;
}

/**
 * Get the effective working directory for Ralph commands.
 * This is the project root (parent directory of .ralph).
 * Falls back to current working directory if no .ralph found.
 *
 * @param {string} startDir - Directory to start searching from (default: process.cwd())
 * @returns {string} Project root or current working directory
 */
function getEffectiveCwd(startDir = process.cwd()) {
  const projectRoot = findProjectRoot(startDir);
  return projectRoot || startDir;
}

module.exports = {
  findProjectRoot,
  findRalphDir,
  getEffectiveCwd,
};
