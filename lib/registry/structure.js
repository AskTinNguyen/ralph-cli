/**
 * Registry structure management
 *
 * Handles creation and management of global registry directories.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Get the global Ralph directory path (~/.ralph/)
 * @returns {string}
 */
function getGlobalDir() {
  return path.join(os.homedir(), ".ralph");
}

/**
 * Get the registry file path (~/.ralph/registry.json)
 * @returns {string}
 */
function getRegistryPath() {
  return path.join(getGlobalDir(), "registry.json");
}

/**
 * Get the index directory path (~/.ralph/index/)
 * @returns {string}
 */
function getIndexPath() {
  return path.join(getGlobalDir(), "index");
}

/**
 * Get the cache directory path (~/.ralph/cache/)
 * @returns {string}
 */
function getCachePath() {
  return path.join(getGlobalDir(), "cache");
}

/**
 * Ensure global registry directory structure exists
 * Creates ~/.ralph/, ~/.ralph/registry/, ~/.ralph/index/, ~/.ralph/cache/
 * @returns {boolean} true if directories were created or already exist
 */
function ensureGlobalRegistry() {
  const globalDir = getGlobalDir();
  const indexDir = getIndexPath();
  const cacheDir = getCachePath();

  const dirs = [globalDir, indexDir, cacheDir];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
    }
  }

  // Initialize registry.json if it doesn't exist
  const registryPath = getRegistryPath();
  if (!fs.existsSync(registryPath)) {
    fs.writeFileSync(
      registryPath,
      JSON.stringify(
        {
          version: "1.0.0",
          projects: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  return true;
}

module.exports = {
  getGlobalDir,
  getRegistryPath,
  getIndexPath,
  getCachePath,
  ensureGlobalRegistry,
};
