/**
 * Notify module - main entry point
 *
 * Provides build notification functions for Slack and Discord integration.
 * Works with webhooks for message delivery.
 */
const {
  sendSlackNotification,
  notifyBuildStart,
  notifyStoryComplete,
  notifyBuildComplete,
  notifyBuildFailure,
  loadNotifyConfig,
  DEFAULT_CONFIG,
  shouldNotify: shouldNotifySlack,
  isQuietHours: isQuietHoursSlack,
  getChannelForEvent,
} = require("./slack");

const {
  sendDiscordNotification,
  notifyDiscordBuildStart,
  notifyDiscordStoryComplete,
  notifyDiscordBuildComplete,
  notifyDiscordBuildFailure,
  DEFAULT_DISCORD_CONFIG,
  COLORS: DISCORD_COLORS,
  shouldNotify: shouldNotifyDiscord,
  isQuietHours: isQuietHoursDiscord,
  getWebhookForPrd,
} = require("./discord");

module.exports = {
  // Slack notification functions
  sendSlackNotification,
  notifyBuildStart,
  notifyStoryComplete,
  notifyBuildComplete,
  notifyBuildFailure,

  // Discord notification functions
  sendDiscordNotification,
  notifyDiscordBuildStart,
  notifyDiscordStoryComplete,
  notifyDiscordBuildComplete,
  notifyDiscordBuildFailure,
  DISCORD_COLORS,

  // Configuration
  loadNotifyConfig,
  DEFAULT_CONFIG,
  DEFAULT_DISCORD_CONFIG,

  // Configuration helpers
  shouldNotifySlack,
  shouldNotifyDiscord,
  isQuietHoursSlack,
  isQuietHoursDiscord,
  getChannelForEvent,
  getWebhookForPrd,
};
