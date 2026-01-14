#!/usr/bin/env node
/**
 * Ralph GitHub Action - Notification Script
 *
 * Sends build notifications to Slack via webhook.
 * Supports customizable messages with build metrics.
 */

const https = require('https');
const http = require('http');
const url = require('url');

/**
 * Get environment variables with defaults
 */
function getEnvConfig() {
  return {
    webhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
    channel: process.env.NOTIFY_CHANNEL || '',
    success: process.env.NOTIFY_SUCCESS === 'true',
    storiesCompleted: parseInt(process.env.NOTIFY_STORIES_COMPLETED || '0', 10),
    duration: parseInt(process.env.NOTIFY_DURATION || '0', 10),
    prdNum: process.env.NOTIFY_PRD_NUM || '',
    branch: process.env.NOTIFY_BRANCH || '',
    repo: process.env.GITHUB_REPOSITORY || '',
    runId: process.env.GITHUB_RUN_ID || '',
    runUrl: process.env.GITHUB_SERVER_URL
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '',
  };
}

/**
 * Format duration in human-readable format
 */
function formatDuration(seconds) {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Build Slack message payload
 */
function buildSlackMessage(config) {
  const statusEmoji = config.success ? ':white_check_mark:' : ':x:';
  const statusText = config.success ? 'succeeded' : 'failed';
  const color = config.success ? 'good' : 'danger';

  const fields = [
    {
      title: 'Status',
      value: `${statusEmoji} Build ${statusText}`,
      short: true,
    },
    {
      title: 'PRD',
      value: `PRD-${config.prdNum}`,
      short: true,
    },
    {
      title: 'Stories Completed',
      value: String(config.storiesCompleted),
      short: true,
    },
    {
      title: 'Duration',
      value: formatDuration(config.duration),
      short: true,
    },
  ];

  if (config.branch) {
    fields.push({
      title: 'Branch',
      value: config.branch,
      short: true,
    });
  }

  const message = {
    text: `Ralph Scheduled Build ${statusText}`,
    attachments: [
      {
        color,
        title: `Scheduled Build Results - ${config.repo}`,
        title_link: config.runUrl,
        fields,
        footer: 'Ralph GitHub Action',
        footer_icon: 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  // Add channel if specified
  if (config.channel) {
    message.channel = config.channel.startsWith('#') ? config.channel : `#${config.channel}`;
  }

  return message;
}

/**
 * Send HTTP POST request to webhook URL
 */
function sendWebhook(webhookUrl, payload) {
  return new Promise((resolve, reject) => {
    const parsedUrl = url.parse(webhookUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const postData = JSON.stringify(payload);

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ statusCode: res.statusCode, body: data });
        } else {
          reject(new Error(`Webhook failed with status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Send notification to Discord webhook
 */
function buildDiscordMessage(config) {
  const statusEmoji = config.success ? ':white_check_mark:' : ':x:';
  const statusText = config.success ? 'succeeded' : 'failed';
  const color = config.success ? 0x28a745 : 0xdc3545; // Green or red

  return {
    content: `Ralph Scheduled Build ${statusText}`,
    embeds: [
      {
        title: `Scheduled Build Results - ${config.repo}`,
        url: config.runUrl,
        color,
        fields: [
          { name: 'Status', value: `${statusEmoji} Build ${statusText}`, inline: true },
          { name: 'PRD', value: `PRD-${config.prdNum}`, inline: true },
          { name: 'Stories Completed', value: String(config.storiesCompleted), inline: true },
          { name: 'Duration', value: formatDuration(config.duration), inline: true },
          ...(config.branch ? [{ name: 'Branch', value: config.branch, inline: true }] : []),
        ],
        footer: {
          text: 'Ralph GitHub Action',
        },
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

/**
 * Detect webhook type and build appropriate message
 */
function detectWebhookType(webhookUrl) {
  if (webhookUrl.includes('discord.com') || webhookUrl.includes('discordapp.com')) {
    return 'discord';
  }
  return 'slack';
}

/**
 * Main function
 */
async function main() {
  const config = getEnvConfig();

  if (!config.webhookUrl) {
    console.error('Error: NOTIFY_WEBHOOK_URL is required');
    process.exit(1);
  }

  try {
    const webhookType = detectWebhookType(config.webhookUrl);
    const payload =
      webhookType === 'discord' ? buildDiscordMessage(config) : buildSlackMessage(config);

    console.log(`Sending ${webhookType} notification...`);
    const result = await sendWebhook(config.webhookUrl, payload);
    console.log(`Notification sent successfully (status: ${result.statusCode})`);

    // Output result for GitHub Actions
    const output = {
      sent: true,
      type: webhookType,
      statusCode: result.statusCode,
    };
    console.log(JSON.stringify(output));
  } catch (error) {
    console.error(`Failed to send notification: ${error.message}`);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

module.exports = {
  getEnvConfig,
  formatDuration,
  buildSlackMessage,
  buildDiscordMessage,
  sendWebhook,
  detectWebhookType,
};
