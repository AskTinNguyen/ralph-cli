/**
 * Ralph Notification Configuration
 *
 * Configure how and when notifications are sent to Slack and Discord.
 * Environment variables take precedence over values defined here.
 */
module.exports = {
  // Global enable/disable
  enabled: process.env.RALPH_NOTIFY_ENABLED !== "false",

  // Slack configuration
  slack: {
    // Webhook URL (required for Slack notifications)
    webhook: process.env.SLACK_WEBHOOK || "",

    // Default channel for notifications
    channel: process.env.SLACK_CHANNEL || "#ralph-builds",

    // Events to notify on (use '*' for all events)
    // Available: 'build.start', 'build.complete', 'build.fail', 'story.complete'
    events: ["build.start", "build.complete", "build.fail", "story.complete"],

    // Users/channels to mention on failure
    // Examples: '@channel', '@here', '@username', '<@U12345678>'
    mentionOnFail: ["@channel"],

    // Per-PRD channel overrides
    // Key: PRD ID (e.g., 'PRD-1', 'PRD-5')
    // Value: channel name (e.g., '#team-auth-builds')
    channels: {
      // 'PRD-1': '#team-auth-builds',
      // 'PRD-5': '#team-payments-builds'
    },

    // Per-event channel overrides
    // Key: event type
    // Value: channel name
    eventChannels: {
      // 'build.fail': '#alerts',
      // 'build.complete': '#announcements'
    },
  },

  // Discord configuration
  discord: {
    // Webhook URL (required for Discord notifications)
    webhook: process.env.DISCORD_WEBHOOK || "",

    // Events to notify on (use '*' for all events)
    events: ["build.complete", "build.fail"],

    // Dashboard URL for links in embeds
    dashboardUrl: process.env.RALPH_DASHBOARD_URL || "http://localhost:3000",

    // Role ID to mention on failure (Discord role mention format)
    // Example: '<@&1234567890>' for a role, '<@1234567890>' for a user
    mentionOnFail: "",

    // Per-PRD webhook overrides
    // Key: PRD ID
    // Value: webhook URL
    webhooks: {
      // 'PRD-1': 'https://discord.com/api/webhooks/...',
    },
  },

  // Quiet hours configuration
  // Notifications are suppressed during quiet hours (except failures)
  quietHours: {
    enabled: false,

    // Start time in 24-hour format (e.g., '22:00' for 10 PM)
    start: "22:00",

    // End time in 24-hour format (e.g., '08:00' for 8 AM)
    end: "08:00",

    // Timezone (IANA format)
    // Examples: 'America/New_York', 'Europe/London', 'Asia/Tokyo'
    timezone: process.env.TZ || "UTC",

    // Events that bypass quiet hours (always notify)
    bypassEvents: ["build.fail"],
  },

  // Summary configuration (for US-004)
  summary: {
    // Cron schedule for daily summary (default: 9 AM on weekdays)
    dailySchedule: "0 9 * * 1-5",

    // Cron schedule for weekly summary (default: Monday 9 AM)
    weeklySchedule: "0 9 * * 1",

    // Channel for summary messages
    channel: "#ralph-weekly",
  },
};
