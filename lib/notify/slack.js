/**
 * Slack notification module
 *
 * Provides functions to send build notifications to Slack.
 * Uses either MCP Slack tools or webhook-based delivery.
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// Default configuration
const DEFAULT_CONFIG = {
  slack: {
    webhook: process.env.SLACK_WEBHOOK || "",
    channel: process.env.SLACK_CHANNEL || "#ralph-builds",
    events: ["build.start", "build.complete", "build.fail", "story.complete"],
    mentionOnFail: ["@channel"],
    channels: {},
    eventChannels: {},
  },
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "08:00",
    timezone: process.env.TZ || "UTC",
    bypassEvents: ["build.fail"],
  },
  enabled: true,
};

/**
 * Load notification configuration from file or environment
 * @param {string} [configPath] - Path to config file
 * @returns {object} Configuration object
 */
function loadNotifyConfig(configPath) {
  // Try environment variable first
  if (process.env.RALPH_NOTIFY_CONFIG) {
    try {
      return JSON.parse(process.env.RALPH_NOTIFY_CONFIG);
    } catch {
      // Fall through to file-based config
    }
  }

  // Try config file
  const configLocations = [
    configPath,
    ".agents/ralph/notify.config.js",
    ".agents/ralph/notify.config.json",
    ".ralph/notify.config.js",
    ".ralph/notify.config.json",
  ].filter(Boolean);

  for (const loc of configLocations) {
    try {
      if (fs.existsSync(loc)) {
        if (loc.endsWith(".js")) {
          // Clear require cache to get fresh config
          delete require.cache[require.resolve(path.resolve(loc))];
          return require(path.resolve(loc));
        } else {
          return JSON.parse(fs.readFileSync(loc, "utf8"));
        }
      }
    } catch {
      // Continue to next location
    }
  }

  // Return default config
  return DEFAULT_CONFIG;
}

/**
 * Parse time string (HH:MM) to minutes since midnight
 * @param {string} timeStr - Time in HH:MM format
 * @returns {number} Minutes since midnight
 */
function parseTime(timeStr) {
  const [hours, minutes] = timeStr.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Get current time in specified timezone as minutes since midnight
 * @param {string} timezone - IANA timezone string
 * @returns {number} Minutes since midnight in the specified timezone
 */
function getCurrentTimeInTimezone(timezone) {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const hour = parseInt(parts.find((p) => p.type === "hour").value, 10);
    const minute = parseInt(parts.find((p) => p.type === "minute").value, 10);
    return hour * 60 + minute;
  } catch {
    // Fallback to UTC if timezone parsing fails
    const now = new Date();
    return now.getUTCHours() * 60 + now.getUTCMinutes();
  }
}

/**
 * Check if current time is within quiet hours
 * @param {object} quietHoursConfig - Quiet hours configuration
 * @returns {boolean} True if currently in quiet hours
 */
function isQuietHours(quietHoursConfig) {
  if (!quietHoursConfig || !quietHoursConfig.enabled) {
    return false;
  }

  const start = parseTime(quietHoursConfig.start || "22:00");
  const end = parseTime(quietHoursConfig.end || "08:00");
  const current = getCurrentTimeInTimezone(quietHoursConfig.timezone || "UTC");

  // Handle overnight quiet hours (e.g., 22:00 to 08:00)
  if (start > end) {
    return current >= start || current < end;
  }

  // Same-day quiet hours (e.g., 12:00 to 14:00)
  return current >= start && current < end;
}

/**
 * Check if an event should trigger a notification
 * @param {string} event - Event type
 * @param {object} config - Configuration object
 * @param {object} [options] - Additional options (prdId, stream)
 * @returns {boolean} True if notification should be sent
 */
function shouldNotify(event, config, options = {}) {
  // Check if notifications are globally enabled
  if (config.enabled === false) {
    return false;
  }

  const slackConfig = config.slack || {};

  // Check if event is in allowed events list
  const events = slackConfig.events || DEFAULT_CONFIG.slack.events;
  if (!events.includes(event) && !events.includes("*")) {
    return false;
  }

  // Check quiet hours (unless event bypasses quiet hours)
  const quietHoursConfig = config.quietHours || DEFAULT_CONFIG.quietHours;
  if (isQuietHours(quietHoursConfig)) {
    const bypassEvents = quietHoursConfig.bypassEvents || ["build.fail"];
    if (!bypassEvents.includes(event)) {
      return false;
    }
  }

  return true;
}

/**
 * Get the appropriate channel for an event
 * @param {string} event - Event type
 * @param {object} slackConfig - Slack configuration
 * @param {object} [options] - Additional options (prdId)
 * @returns {string} Channel name
 */
function getChannelForEvent(event, slackConfig, options = {}) {
  // Priority 1: Per-PRD channel override
  if (options.prdId && slackConfig.channels && slackConfig.channels[options.prdId]) {
    return slackConfig.channels[options.prdId];
  }

  // Priority 2: Per-event channel override
  if (slackConfig.eventChannels && slackConfig.eventChannels[event]) {
    return slackConfig.eventChannels[event];
  }

  // Priority 3: Default channel
  return slackConfig.channel || DEFAULT_CONFIG.slack.channel;
}

/**
 * Send a notification to Slack via webhook
 * @param {string} webhookUrl - Slack webhook URL
 * @param {object} payload - Message payload
 * @returns {Promise<boolean>} Success status
 */
function sendWebhook(webhookUrl, payload) {
  return new Promise((resolve) => {
    if (!webhookUrl) {
      resolve(false);
      return;
    }

    try {
      const url = new URL(webhookUrl);
      const data = JSON.stringify(payload);

      const options = {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: url.pathname + url.search,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };

      const protocol = url.protocol === "https:" ? https : http;
      const req = protocol.request(options, (res) => {
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      });

      req.on("error", () => resolve(false));
      req.write(data);
      req.end();
    } catch {
      resolve(false);
    }
  });
}

/**
 * Format duration in human readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins < 60) {
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Format cost with dollar sign
 * @param {number|string} cost - Cost value
 * @returns {string} Formatted cost
 */
function formatCost(cost) {
  if (!cost || cost === "0" || cost === 0) {
    return "";
  }
  const numCost = typeof cost === "string" ? parseFloat(cost) : cost;
  return `$${numCost.toFixed(2)}`;
}

/**
 * Send a generic Slack notification
 * @param {string} event - Event type (build.start, story.complete, etc.)
 * @param {object} data - Event data
 * @param {object} [config] - Configuration override
 * @returns {Promise<boolean>} Success status
 */
async function sendSlackNotification(event, data, config) {
  const cfg = config || loadNotifyConfig();

  // Use shouldNotify to check all conditions (enabled, events, quiet hours)
  if (!shouldNotify(event, cfg, { prdId: data.prdId })) {
    return false;
  }

  const slackConfig = cfg.slack || {};

  // Get the appropriate channel for this event/PRD
  const channel = getChannelForEvent(event, slackConfig, { prdId: data.prdId });

  // Build the message based on event type
  let message;
  switch (event) {
    case "build.start":
      message = formatBuildStartMessage(data, { ...slackConfig, channel });
      break;
    case "story.complete":
      message = formatStoryCompleteMessage(data, { ...slackConfig, channel });
      break;
    case "build.complete":
      message = formatBuildCompleteMessage(data, { ...slackConfig, channel });
      break;
    case "build.fail":
      message = formatBuildFailMessage(data, { ...slackConfig, channel });
      break;
    default:
      message = { text: `Ralph: ${event} - ${JSON.stringify(data)}`, channel };
  }

  // Send via webhook if configured
  if (slackConfig.webhook) {
    return sendWebhook(slackConfig.webhook, message);
  }

  // If no webhook, log the notification (useful for testing/debugging)
  console.log(`[SLACK NOTIFY] ${event}:`, JSON.stringify(message, null, 2));
  return true;
}

/**
 * Format build start notification message
 * @param {object} data - Build data
 * @param {object} config - Slack config
 * @returns {object} Slack message payload
 */
function formatBuildStartMessage(data, config) {
  const channel = config.channel || DEFAULT_CONFIG.slack.channel;
  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Ralph Build Started",
        emoji: true,
      },
    },
    {
      type: "section",
      fields: [
        {
          type: "mrkdwn",
          text: `*PRD:*\n${data.prdId || "Unknown"} - ${data.prdTitle || ""}`,
        },
        {
          type: "mrkdwn",
          text: `*Stories:*\n${data.pendingStories || 0} pending`,
        },
      ],
    },
  ];

  if (data.stream) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Stream: ${data.stream}`,
        },
      ],
    });
  }

  return {
    channel,
    text: `Ralph Build Started - PRD ${data.prdId}`,
    blocks,
  };
}

/**
 * Format story completion notification message
 * @param {object} data - Story data
 * @param {object} config - Slack config
 * @returns {object} Slack message payload
 */
function formatStoryCompleteMessage(data, config) {
  const channel = config.channel || DEFAULT_CONFIG.slack.channel;
  const durationStr = data.duration ? formatDuration(data.duration) : "";
  const costStr = formatCost(data.cost);

  const fields = [
    {
      type: "mrkdwn",
      text: `*Story:*\n${data.storyId || "Unknown"} - ${data.storyTitle || ""}`,
    },
  ];

  if (durationStr) {
    fields.push({
      type: "mrkdwn",
      text: `*Duration:*\n${durationStr}`,
    });
  }

  if (costStr) {
    fields.push({
      type: "mrkdwn",
      text: `*Cost:*\n${costStr}`,
    });
  }

  if (data.tokens) {
    fields.push({
      type: "mrkdwn",
      text: `*Tokens:*\n${data.tokens.toLocaleString()}`,
    });
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Story Completed",
        emoji: true,
      },
    },
    {
      type: "section",
      fields,
    },
  ];

  if (data.prdId) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `PRD: ${data.prdId}`,
        },
      ],
    });
  }

  return {
    channel,
    text: `Story Completed: ${data.storyId}`,
    blocks,
  };
}

/**
 * Format build completion notification message
 * @param {object} data - Build summary data
 * @param {object} config - Slack config
 * @returns {object} Slack message payload
 */
function formatBuildCompleteMessage(data, config) {
  const channel = config.channel || DEFAULT_CONFIG.slack.channel;
  const durationStr = data.duration ? formatDuration(data.duration) : "";
  const costStr = formatCost(data.totalCost);

  const fields = [
    {
      type: "mrkdwn",
      text: `*PRD:*\n${data.prdId || "Unknown"}`,
    },
    {
      type: "mrkdwn",
      text: `*Stories:*\n${data.completedStories || 0} completed`,
    },
  ];

  if (durationStr) {
    fields.push({
      type: "mrkdwn",
      text: `*Duration:*\n${durationStr}`,
    });
  }

  if (costStr) {
    fields.push({
      type: "mrkdwn",
      text: `*Total Cost:*\n${costStr}`,
    });
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Build Completed",
        emoji: true,
      },
    },
    {
      type: "section",
      fields,
    },
  ];

  if (data.successRate !== undefined) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Success rate: ${data.successRate}%`,
        },
      ],
    });
  }

  return {
    channel,
    text: `Build Completed - PRD ${data.prdId}`,
    blocks,
  };
}

/**
 * Format build failure notification message
 * @param {object} data - Failure data
 * @param {object} config - Slack config
 * @returns {object} Slack message payload
 */
function formatBuildFailMessage(data, config) {
  const channel = config.channel || DEFAULT_CONFIG.slack.channel;
  const mentionOnFail = config.mentionOnFail || DEFAULT_CONFIG.slack.mentionOnFail;

  const fields = [
    {
      type: "mrkdwn",
      text: `*PRD:*\n${data.prdId || "Unknown"}`,
    },
    {
      type: "mrkdwn",
      text: `*Story:*\n${data.storyId || "Unknown"}`,
    },
  ];

  if (data.error) {
    fields.push({
      type: "mrkdwn",
      text: `*Error:*\n${data.error}`,
    });
  }

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "Build Failed",
        emoji: true,
      },
    },
    {
      type: "section",
      fields,
    },
  ];

  // Add mention if configured
  if (mentionOnFail && mentionOnFail.length > 0) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: mentionOnFail.join(" ") + " - please review",
      },
    });
  }

  // Add link to logs if available
  if (data.logUrl) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Logs",
            emoji: true,
          },
          url: data.logUrl,
        },
      ],
    });
  }

  return {
    channel,
    text: `Build Failed - PRD ${data.prdId} / ${data.storyId}`,
    blocks,
  };
}

/**
 * Send build start notification
 * @param {string} prdId - PRD identifier
 * @param {string} prdTitle - PRD title
 * @param {number} pendingStories - Number of pending stories
 * @param {object} [options] - Additional options (stream, config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyBuildStart(prdId, prdTitle, pendingStories, options = {}) {
  return sendSlackNotification(
    "build.start",
    {
      prdId,
      prdTitle,
      pendingStories,
      stream: options.stream,
    },
    options.config
  );
}

/**
 * Send story completion notification
 * @param {string} prdId - PRD identifier
 * @param {string} storyId - Story identifier
 * @param {string} storyTitle - Story title
 * @param {number} duration - Duration in seconds
 * @param {object} [options] - Additional options (tokens, cost, config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyStoryComplete(prdId, storyId, storyTitle, duration, options = {}) {
  return sendSlackNotification(
    "story.complete",
    {
      prdId,
      storyId,
      storyTitle,
      duration,
      tokens: options.tokens,
      cost: options.cost,
    },
    options.config
  );
}

/**
 * Send build completion notification
 * @param {string} prdId - PRD identifier
 * @param {object} summary - Build summary
 * @param {object} [options] - Additional options (config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyBuildComplete(prdId, summary, options = {}) {
  return sendSlackNotification(
    "build.complete",
    {
      prdId,
      completedStories: summary.completedStories,
      duration: summary.duration,
      totalCost: summary.totalCost,
      successRate: summary.successRate,
    },
    options.config
  );
}

/**
 * Send build failure notification
 * @param {string} prdId - PRD identifier
 * @param {string} storyId - Story identifier
 * @param {string} error - Error description
 * @param {object} [options] - Additional options (logUrl, config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyBuildFailure(prdId, storyId, error, options = {}) {
  return sendSlackNotification(
    "build.fail",
    {
      prdId,
      storyId,
      error,
      logUrl: options.logUrl,
    },
    options.config
  );
}

module.exports = {
  sendSlackNotification,
  notifyBuildStart,
  notifyStoryComplete,
  notifyBuildComplete,
  notifyBuildFailure,
  loadNotifyConfig,
  DEFAULT_CONFIG,
  // Configuration helpers
  shouldNotify,
  isQuietHours,
  getChannelForEvent,
  // Export internal functions for testing
  formatDuration,
  formatCost,
  formatBuildStartMessage,
  formatStoryCompleteMessage,
  formatBuildCompleteMessage,
  formatBuildFailMessage,
  parseTime,
  getCurrentTimeInTimezone,
};
