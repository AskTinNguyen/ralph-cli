/**
 * Registry module - main entry point
 *
 * Provides cross-project knowledge registry for Ralph loops.
 */
const {
  ensureGlobalRegistry,
  getRegistryPath,
  getIndexPath,
  getCachePath,
  getGlobalDir,
} = require("./structure");

const {
  loadRegistry,
  saveRegistry,
  addProject,
  removeProject,
  updateProject,
  getProject,
  listProjects,
  findProjectByPath,
} = require("./projects");

const {
  indexProject,
  getProjectStats,
  countGuardrails,
  countProgressEntries,
  countRuns,
} = require("./indexer");

module.exports = {
  // Structure
  ensureGlobalRegistry,
  getRegistryPath,
  getIndexPath,
  getCachePath,
  getGlobalDir,

  // Projects
  loadRegistry,
  saveRegistry,
  addProject,
  removeProject,
  updateProject,
  getProject,
  listProjects,
  findProjectByPath,

  // Indexer
  indexProject,
  getProjectStats,
  countGuardrails,
  countProgressEntries,
  countRuns,
};
