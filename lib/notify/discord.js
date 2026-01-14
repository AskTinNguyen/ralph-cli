/**
 * Discord notification module
 *
 * Provides functions to send build notifications to Discord.
 * Uses Discord webhooks with rich embeds for enhanced display.
 */
const https = require("https");
const http = require("http");

// Default configuration
const DEFAULT_DISCORD_CONFIG = {
  discord: {
    webhook: process.env.DISCORD_WEBHOOK || "",
    events: ["build.start", "build.complete", "build.fail", "story.complete"],
    dashboardUrl: process.env.RALPH_DASHBOARD_URL || "http://localhost:3000",
    mentionOnFail: "",
    webhooks: {},
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

// Color codes for Discord embeds (decimal format)
const COLORS = {
  success: 5763719, // Green (#57F287)
  failure: 15548997, // Red (#ED4245)
  warning: 16776960, // Yellow (#FFFF00)
  progress: 5793266, // Blue (#5865F2)
  info: 9807270, // Gray (#959B9A)
};

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

  if (start > end) {
    return current >= start || current < end;
  }

  return current >= start && current < end;
}

/**
 * Check if an event should trigger a Discord notification
 * @param {string} event - Event type
 * @param {object} config - Configuration object
 * @returns {boolean} True if notification should be sent
 */
function shouldNotify(event, config) {
  if (config.enabled === false) {
    return false;
  }

  const discordConfig = config.discord || {};
  const events = discordConfig.events || DEFAULT_DISCORD_CONFIG.discord.events;
  if (!events.includes(event) && !events.includes("*")) {
    return false;
  }

  const quietHoursConfig = config.quietHours || DEFAULT_DISCORD_CONFIG.quietHours;
  if (isQuietHours(quietHoursConfig)) {
    const bypassEvents = quietHoursConfig.bypassEvents || ["build.fail"];
    if (!bypassEvents.includes(event)) {
      return false;
    }
  }

  return true;
}

/**
 * Get the appropriate webhook for a PRD
 * @param {object} discordConfig - Discord configuration
 * @param {string} [prdId] - PRD identifier
 * @returns {string} Webhook URL
 */
function getWebhookForPrd(discordConfig, prdId) {
  if (prdId && discordConfig.webhooks && discordConfig.webhooks[prdId]) {
    return discordConfig.webhooks[prdId];
  }
  return discordConfig.webhook || DEFAULT_DISCORD_CONFIG.discord.webhook;
}

/**
 * Send a webhook request to Discord
 * @param {string} webhookUrl - Discord webhook URL
 * @param {object} payload - Message payload with embeds
 * @returns {Promise<boolean>} Success status
 */
function sendDiscordWebhook(webhookUrl, payload) {
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
 * Create a Discord embed object
 * @param {object} options - Embed options
 * @returns {object} Discord embed object
 */
function createEmbed(options) {
  const embed = {
    title: options.title || "",
    description: options.description || "",
    color: options.color || COLORS.info,
    timestamp: new Date().toISOString(),
  };

  if (options.fields && options.fields.length > 0) {
    embed.fields = options.fields;
  }

  if (options.footer) {
    embed.footer = { text: options.footer };
  }

  if (options.url) {
    embed.url = options.url;
  }

  return embed;
}

/**
 * Format build start embed
 * @param {object} data - Build data
 * @param {object} config - Discord config
 * @returns {object} Discord embed
 */
function formatBuildStartEmbed(data, config) {
  const dashboardUrl = config.dashboardUrl || DEFAULT_DISCORD_CONFIG.discord.dashboardUrl;
  const prdUrl = `${dashboardUrl}/prd/${data.prdId}`;

  const fields = [
    {
      name: "PRD",
      value: data.prdTitle ? `${data.prdId} - ${data.prdTitle}` : data.prdId || "Unknown",
      inline: true,
    },
    {
      name: "Stories",
      value: `${data.pendingStories || 0} pending`,
      inline: true,
    },
  ];

  if (data.stream) {
    fields.push({
      name: "Stream",
      value: data.stream,
      inline: true,
    });
  }

  return createEmbed({
    title: "Ralph Build Started",
    description: "A new build has started.",
    color: COLORS.progress,
    fields,
    url: prdUrl,
    footer: "Ralph CLI",
  });
}

/**
 * Format story completion embed
 * @param {object} data - Story data
 * @param {object} config - Discord config
 * @returns {object} Discord embed
 */
function formatStoryCompleteEmbed(data, config) {
  const dashboardUrl = config.dashboardUrl || DEFAULT_DISCORD_CONFIG.discord.dashboardUrl;
  const prdUrl = data.prdId ? `${dashboardUrl}/prd/${data.prdId}` : dashboardUrl;

  const fields = [
    {
      name: "Story",
      value: data.storyTitle ? `${data.storyId} - ${data.storyTitle}` : data.storyId || "Unknown",
      inline: false,
    },
  ];

  if (data.duration) {
    fields.push({
      name: "Duration",
      value: formatDuration(data.duration),
      inline: true,
    });
  }

  if (data.tokens) {
    fields.push({
      name: "Tokens",
      value: data.tokens.toLocaleString(),
      inline: true,
    });
  }

  const costStr = formatCost(data.cost);
  if (costStr) {
    fields.push({
      name: "Cost",
      value: costStr,
      inline: true,
    });
  }

  if (data.prdId) {
    fields.push({
      name: "PRD",
      value: data.prdId,
      inline: true,
    });
  }

  return createEmbed({
    title: "Story Completed",
    description: "A story has been successfully completed.",
    color: COLORS.success,
    fields,
    url: prdUrl,
    footer: "Ralph CLI",
  });
}

/**
 * Format build completion embed
 * @param {object} data - Build summary data
 * @param {object} config - Discord config
 * @returns {object} Discord embed
 */
function formatBuildCompleteEmbed(data, config) {
  const dashboardUrl = config.dashboardUrl || DEFAULT_DISCORD_CONFIG.discord.dashboardUrl;
  const prdUrl = data.prdId ? `${dashboardUrl}/prd/${data.prdId}` : dashboardUrl;

  const fields = [
    {
      name: "PRD",
      value: data.prdId || "Unknown",
      inline: true,
    },
    {
      name: "Stories",
      value: `${data.completedStories || 0} completed`,
      inline: true,
    },
  ];

  if (data.duration) {
    fields.push({
      name: "Duration",
      value: formatDuration(data.duration),
      inline: true,
    });
  }

  const costStr = formatCost(data.totalCost);
  if (costStr) {
    fields.push({
      name: "Total Cost",
      value: costStr,
      inline: true,
    });
  }

  if (data.successRate !== undefined) {
    fields.push({
      name: "Success Rate",
      value: `${data.successRate}%`,
      inline: true,
    });
  }

  return createEmbed({
    title: "Build Completed",
    description: "Build has finished successfully.",
    color: COLORS.success,
    fields,
    url: prdUrl,
    footer: "Ralph CLI",
  });
}

/**
 * Format build failure embed
 * @param {object} data - Failure data
 * @param {object} config - Discord config
 * @returns {object} Discord embed
 */
function formatBuildFailEmbed(data, config) {
  const dashboardUrl = config.dashboardUrl || DEFAULT_DISCORD_CONFIG.discord.dashboardUrl;
  const logUrl = data.logUrl || (data.prdId ? `${dashboardUrl}/prd/${data.prdId}/runs/latest` : dashboardUrl);

  const fields = [
    {
      name: "PRD",
      value: data.prdId || "Unknown",
      inline: true,
    },
    {
      name: "Story",
      value: data.storyId || "Unknown",
      inline: true,
    },
  ];

  if (data.error) {
    fields.push({
      name: "Error",
      value: data.error.length > 1024 ? data.error.substring(0, 1021) + "..." : data.error,
      inline: false,
    });
  }

  return createEmbed({
    title: "Build Failed",
    description: "Build has encountered an error. Please review.",
    color: COLORS.failure,
    fields,
    url: logUrl,
    footer: "Ralph CLI - Click title to view logs",
  });
}

/**
 * Send a generic Discord notification
 * @param {string} event - Event type (build.start, story.complete, etc.)
 * @param {object} data - Event data
 * @param {object} [config] - Configuration override
 * @returns {Promise<boolean>} Success status
 */
async function sendDiscordNotification(event, data, config) {
  const cfg = config || DEFAULT_DISCORD_CONFIG;

  // Use shouldNotify to check all conditions (enabled, events, quiet hours)
  if (!shouldNotify(event, cfg)) {
    return false;
  }

  const discordConfig = cfg.discord || {};

  // Build the embed based on event type
  let embed;
  switch (event) {
    case "build.start":
      embed = formatBuildStartEmbed(data, discordConfig);
      break;
    case "story.complete":
      embed = formatStoryCompleteEmbed(data, discordConfig);
      break;
    case "build.complete":
      embed = formatBuildCompleteEmbed(data, discordConfig);
      break;
    case "build.fail":
      embed = formatBuildFailEmbed(data, discordConfig);
      break;
    default:
      embed = createEmbed({
        title: `Ralph: ${event}`,
        description: JSON.stringify(data, null, 2),
        color: COLORS.info,
      });
  }

  const payload = {
    embeds: [embed],
  };

  // Add mention on failure if configured
  if (event === "build.fail" && discordConfig.mentionOnFail) {
    payload.content = `${discordConfig.mentionOnFail} - Build failed, please review.`;
  }

  // Get webhook (per-PRD or default)
  const webhookUrl = getWebhookForPrd(discordConfig, data.prdId);

  // Send via webhook if configured
  if (webhookUrl) {
    return sendDiscordWebhook(webhookUrl, payload);
  }

  // If no webhook, log the notification (useful for testing/debugging)
  console.log(`[DISCORD NOTIFY] ${event}:`, JSON.stringify(payload, null, 2));
  return true;
}

/**
 * Send build start notification to Discord
 * @param {string} prdId - PRD identifier
 * @param {string} prdTitle - PRD title
 * @param {number} pendingStories - Number of pending stories
 * @param {object} [options] - Additional options (stream, config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyDiscordBuildStart(prdId, prdTitle, pendingStories, options = {}) {
  return sendDiscordNotification(
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
 * Send story completion notification to Discord
 * @param {string} prdId - PRD identifier
 * @param {string} storyId - Story identifier
 * @param {string} storyTitle - Story title
 * @param {number} duration - Duration in seconds
 * @param {object} [options] - Additional options (tokens, cost, config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyDiscordStoryComplete(prdId, storyId, storyTitle, duration, options = {}) {
  return sendDiscordNotification(
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
 * Send build completion notification to Discord
 * @param {string} prdId - PRD identifier
 * @param {object} summary - Build summary
 * @param {object} [options] - Additional options (config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyDiscordBuildComplete(prdId, summary, options = {}) {
  return sendDiscordNotification(
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
 * Send build failure notification to Discord
 * @param {string} prdId - PRD identifier
 * @param {string} storyId - Story identifier
 * @param {string} error - Error description
 * @param {object} [options] - Additional options (logUrl, config)
 * @returns {Promise<boolean>} Success status
 */
async function notifyDiscordBuildFailure(prdId, storyId, error, options = {}) {
  return sendDiscordNotification(
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
  sendDiscordNotification,
  notifyDiscordBuildStart,
  notifyDiscordStoryComplete,
  notifyDiscordBuildComplete,
  notifyDiscordBuildFailure,
  DEFAULT_DISCORD_CONFIG,
  COLORS,
  // Configuration helpers
  shouldNotify,
  isQuietHours,
  getWebhookForPrd,
  // Export internal functions for testing
  formatDuration,
  formatCost,
  createEmbed,
  formatBuildStartEmbed,
  formatStoryCompleteEmbed,
  formatBuildCompleteEmbed,
  formatBuildFailEmbed,
  parseTime,
  getCurrentTimeInTimezone,
};
