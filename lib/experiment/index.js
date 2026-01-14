/**
 * Experiment module - main entry point
 *
 * Provides A/B testing framework for comparing agent performance:
 * - Experiment definition with variants and traffic allocation
 * - Schema validation for experiment configuration
 * - CRUD operations for experiment management
 */

const schema = require("./schema");
const manager = require("./manager");

module.exports = {
  // Schema exports
  EXPERIMENT_SCHEMA: schema.EXPERIMENT_SCHEMA,
  VARIANT_SCHEMA: schema.VARIANT_SCHEMA,
  validateExperiment: schema.validateExperiment,
  validateVariant: schema.validateVariant,
  createExperiment: schema.createExperiment,
  createDefaultExperiment: schema.createDefaultExperiment,

  // Manager exports
  getExperimentsDir: manager.getExperimentsDir,
  ensureExperimentsDir: manager.ensureExperimentsDir,
  getExperimentPath: manager.getExperimentPath,
  experimentExists: manager.experimentExists,
  saveExperiment: manager.saveExperiment,
  loadExperiment: manager.loadExperiment,
  createNewExperiment: manager.createNewExperiment,
  createQuickExperiment: manager.createQuickExperiment,
  listExperiments: manager.listExperiments,
  getRunningExperiment: manager.getRunningExperiment,
  updateExperimentStatus: manager.updateExperimentStatus,
  startExperiment: manager.startExperiment,
  pauseExperiment: manager.pauseExperiment,
  concludeExperiment: manager.concludeExperiment,
  deleteExperiment: manager.deleteExperiment,
  updateExperiment: manager.updateExperiment,

  // Re-export sub-modules for advanced usage
  schema,
  manager,
};
