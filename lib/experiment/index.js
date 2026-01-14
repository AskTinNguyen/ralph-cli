/**
 * Experiment module - main entry point
 *
 * Provides A/B testing framework for comparing agent performance:
 * - Experiment definition with variants and traffic allocation
 * - Schema validation for experiment configuration
 * - CRUD operations for experiment management
 * - Metrics collection and aggregation per variant
 */

const schema = require("./schema");
const manager = require("./manager");
const assignment = require("./assignment");
const metrics = require("./metrics");

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

  // Assignment exports
  djb2Hash: assignment.djb2Hash,
  hashForAssignment: assignment.hashForAssignment,
  isExcluded: assignment.isExcluded,
  assignVariant: assignment.assignVariant,
  getAssignmentForStory: assignment.getAssignmentForStory,
  verifyDistribution: assignment.verifyDistribution,
  getAssignmentString: assignment.getAssignmentString,

  // Metrics exports
  filterByExperiment: metrics.filterByExperiment,
  filterByVariant: metrics.filterByVariant,
  calculateAggregatedMetrics: metrics.calculateAggregatedMetrics,
  aggregateExperimentMetrics: metrics.aggregateExperimentMetrics,
  aggregateExperimentMetricsAcrossPRDs: metrics.aggregateExperimentMetricsAcrossPRDs,
  compareVariants: metrics.compareVariants,
  getQualitySignalSummary: metrics.getQualitySignalSummary,
  getExperimentCostBreakdown: metrics.getExperimentCostBreakdown,

  // Re-export sub-modules for advanced usage
  schema,
  manager,
  assignment,
  metrics,
};
