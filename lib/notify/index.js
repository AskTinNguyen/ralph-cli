/**
 * Notify module - main entry point
 *
 * Provides build notification functions for Slack integration.
 * Works with MCP Slack tools for message delivery.
 */
const {
  sendSlackNotification,
  notifyBuildStart,
  notifyStoryComplete,
  notifyBuildComplete,
  notifyBuildFailure,
  loadNotifyConfig,
  DEFAULT_CONFIG,
} = require("./slack");

module.exports = {
  // Slack notification functions
  sendSlackNotification,
  notifyBuildStart,
  notifyStoryComplete,
  notifyBuildComplete,
  notifyBuildFailure,

  // Configuration
  loadNotifyConfig,
  DEFAULT_CONFIG,
};
