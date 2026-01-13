/**
 * Stats module - main entry point
 *
 * Provides performance metrics and trend analysis for Ralph loops.
 */
const {
  aggregateProjectMetrics,
  aggregateGlobalMetrics,
  saveMetricsCache,
  loadMetricsCache,
  isCacheValid,
  groupRunsByDate,
  groupRunsByWeek,
  calculateSuccessRate,
  calculateAvgDuration,
  calculateTrend,
  parseGuardrailsWithDates,
} = require("./aggregator");

module.exports = {
  aggregateProjectMetrics,
  aggregateGlobalMetrics,
  saveMetricsCache,
  loadMetricsCache,
  isCacheValid,
  groupRunsByDate,
  groupRunsByWeek,
  calculateSuccessRate,
  calculateAvgDuration,
  calculateTrend,
  parseGuardrailsWithDates,
};
