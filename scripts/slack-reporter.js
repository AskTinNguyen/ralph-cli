#!/usr/bin/env node

/**
 * Slack Reporter - Send Team Reports to Slack Channels
 *
 * Production-ready Slack integration using the Slack Web API.
 * Features:
 * - Real Slack API integration via SLACK_BOT_TOKEN
 * - Rate limiting: 1 msg/sec per channel, 20 req/min global
 * - Retry logic: 3 attempts with exponential backoff
 * - Message queue for failed sends with persistence
 * - Email fallback when Slack fails after retries
 * - Comprehensive logging
 *
 * Message Types Supported:
 * - Channel posts (chat.postMessage)
 * - Direct messages (chat.postMessage to user ID or conversations.open + post)
 * - File uploads (files.upload)
 *
 * Configuration:
 * - SLACK_BOT_TOKEN: Required env var for Slack Bot OAuth token
 * - .ralph/automation-config.json: Channel mappings and settings
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// Nodemailer is optional - only required for email fallback
let nodemailer = null;
try {
  nodemailer = require("nodemailer");
} catch {
  // nodemailer not installed - email fallback will be disabled
}

// ============================================================================
// Configuration Constants
// ============================================================================

const MAX_RETRIES = 3;
const RATE_LIMIT_PER_CHANNEL_MS = 1000; // 1 message per second per channel
const RATE_LIMIT_GLOBAL_PER_MIN = 20; // 20 requests per minute global
const MESSAGE_QUEUE_FILE = ".ralph/message-queue.json";
const MESSAGE_QUEUE_MAX_AGE_DAYS = 7;
const SLACK_API_BASE = "https://slack.com/api";

// Track rate limiting state
const channelLastSend = new Map(); // channelId -> timestamp
let globalRequestCount = 0;
let globalWindowStart = Date.now();

// ============================================================================
// Logging Utilities
// ============================================================================

const LOG_FILE = process.env.SLACK_LOG_FILE || null;

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data ? { data } : {}),
  };

  const prefix = level === "ERROR" ? "  \u274c" : level === "SUCCESS" ? "  \u2705" : "  ";
  const consoleMsg = `${prefix} ${message}`;
  if (level === "ERROR") {
    console.error(consoleMsg);
  } else {
    console.log(consoleMsg);
  }

  // Write to log file if configured
  if (LOG_FILE) {
    try {
      fs.appendFileSync(LOG_FILE, JSON.stringify(logEntry) + "\n");
    } catch {
      // Ignore log file write errors
    }
  }
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load automation configuration
 * @returns {Object} Automation config
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    console.error(`[Error] Automation config not found: ${configPath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`[Error] Failed to parse automation config: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Load latest daily metrics
 * @returns {Object|null} Metrics data or null if not found
 */
function loadLatestMetrics() {
  const runsDir = path.join(process.cwd(), ".ralph", "factory", "runs");

  if (!fs.existsSync(runsDir)) {
    log("INFO", "No factory runs directory found, creating sample data");
    return createSampleMetrics();
  }

  const files = fs
    .readdirSync(runsDir)
    .filter((f) => f.startsWith("daily-metrics-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    log("INFO", "No daily metrics found, creating sample data");
    return createSampleMetrics();
  }

  const latestFile = path.join(runsDir, files[0]);

  try {
    const content = fs.readFileSync(latestFile, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`[Error] Failed to parse metrics file: ${error.message}`);
    return createSampleMetrics();
  }
}

/**
 * Create sample metrics for testing/demo purposes
 * @returns {Object} Sample metrics
 */
function createSampleMetrics() {
  return {
    disciplines: [
      {
        discipline: "backend",
        totalRuns: 10,
        successfulRuns: 8,
        failedRuns: 2,
        successRate: 80,
        projects: ["ralph-cli"],
      },
    ],
    blockers: [],
    totals: {
      totalRuns: 10,
      successRate: 80,
      storiesCompleted: 5,
      totalCost: 1.5,
    },
  };
}

// ============================================================================
// Rate Limiting
// ============================================================================

/**
 * Check if we can send a message respecting rate limits
 * @param {string} channelId - Target channel ID
 * @returns {Promise<boolean>} True if send is allowed
 */
async function checkRateLimit(channelId) {
  const now = Date.now();

  // Reset global window if 1 minute has passed
  if (now - globalWindowStart >= 60000) {
    globalWindowStart = now;
    globalRequestCount = 0;
  }

  // Check global rate limit (20 req/min)
  if (globalRequestCount >= RATE_LIMIT_GLOBAL_PER_MIN) {
    const waitTime = 60000 - (now - globalWindowStart);
    log("INFO", `Global rate limit reached, waiting ${Math.ceil(waitTime / 1000)}s`);
    await delay(waitTime);
    globalWindowStart = Date.now();
    globalRequestCount = 0;
  }

  // Check per-channel rate limit (1 msg/sec)
  const lastSend = channelLastSend.get(channelId) || 0;
  const timeSinceLastSend = now - lastSend;

  if (timeSinceLastSend < RATE_LIMIT_PER_CHANNEL_MS) {
    const waitTime = RATE_LIMIT_PER_CHANNEL_MS - timeSinceLastSend;
    log("INFO", `Channel rate limit for ${channelId}, waiting ${waitTime}ms`);
    await delay(waitTime);
  }

  return true;
}

/**
 * Update rate limiting state after a send
 * @param {string} channelId - Target channel ID
 */
function updateRateLimitState(channelId) {
  channelLastSend.set(channelId, Date.now());
  globalRequestCount++;
}

// ============================================================================
// Message Queue (Failed Messages)
// ============================================================================

/**
 * Load message queue from disk
 * @returns {Array} Queued messages
 */
function loadMessageQueue() {
  const queuePath = path.join(process.cwd(), MESSAGE_QUEUE_FILE);

  if (!fs.existsSync(queuePath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(queuePath, "utf-8");
    const queue = JSON.parse(content);

    // Filter out old entries (>7 days)
    const now = Date.now();
    const maxAge = MESSAGE_QUEUE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

    return queue.filter((msg) => {
      const age = now - new Date(msg.timestamp).getTime();
      return age < maxAge;
    });
  } catch {
    return [];
  }
}

/**
 * Save message queue to disk
 * @param {Array} queue - Messages to save
 */
function saveMessageQueue(queue) {
  const queuePath = path.join(process.cwd(), MESSAGE_QUEUE_FILE);
  const queueDir = path.dirname(queuePath);

  if (!fs.existsSync(queueDir)) {
    fs.mkdirSync(queueDir, { recursive: true });
  }

  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
}

/**
 * Add failed message to queue for retry
 * @param {Object} message - Failed message details
 */
function queueFailedMessage(message) {
  const queue = loadMessageQueue();

  queue.push({
    ...message,
    timestamp: new Date().toISOString(),
    retryCount: (message.retryCount || 0) + 1,
  });

  saveMessageQueue(queue);
  log("INFO", `Message queued for retry (attempt ${message.retryCount || 1}/${MAX_RETRIES})`);
}

/**
 * Process queued messages
 * @returns {Promise<Object>} Results { success: number, failed: number }
 */
async function processMessageQueue() {
  const queue = loadMessageQueue();

  if (queue.length === 0) {
    return { success: 0, failed: 0 };
  }

  log("INFO", `Processing ${queue.length} queued message(s)`);

  let success = 0;
  let failed = 0;
  const remainingQueue = [];

  for (const msg of queue) {
    if (msg.retryCount >= MAX_RETRIES) {
      log("ERROR", `Message exceeded max retries, triggering email fallback`, { channel: msg.channel });
      await sendEmailFallback(msg);
      failed++;
      continue;
    }

    const result = await sendSlackApiRequest(msg.endpoint, msg.payload);

    if (result.success) {
      success++;
      log("SUCCESS", `Queued message sent successfully to ${msg.channel}`);
    } else {
      remainingQueue.push({
        ...msg,
        retryCount: msg.retryCount + 1,
        lastError: result.error,
      });
      failed++;
    }
  }

  saveMessageQueue(remainingQueue);

  return { success, failed };
}

// ============================================================================
// Email Fallback
// ============================================================================

/**
 * Send email fallback when Slack fails
 * @param {Object} message - Failed Slack message
 * @returns {Promise<boolean>} Success status
 */
async function sendEmailFallback(message) {
  const config = loadAutomationConfig();
  const emailConfig = config.emailFallback;

  if (!emailConfig || !emailConfig.enabled) {
    log("INFO", "Email fallback not configured, message dropped");
    return false;
  }

  if (!nodemailer) {
    log("ERROR", "nodemailer not installed. Run: npm install nodemailer");
    return false;
  }

  if (!process.env.SMTP_SERVER || !process.env.SMTP_PORT) {
    log("ERROR", "SMTP not configured (SMTP_SERVER, SMTP_PORT env vars required)");
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_SERVER,
      port: parseInt(process.env.SMTP_PORT, 10),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER
        ? {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS,
          }
        : undefined,
    });

    const recipients = emailConfig.recipients || [];
    if (recipients.length === 0) {
      log("ERROR", "No email recipients configured");
      return false;
    }

    // Convert Slack blocks to plain text for email
    const plainText = blocksToPlainText(message.payload?.blocks || []);

    const mailOptions = {
      from: emailConfig.sender || "ralph-automation@localhost",
      to: recipients.join(", "),
      subject: `[Ralph Alert] Slack message failed: ${message.channel}`,
      text: `Original message could not be delivered to Slack channel ${message.channel}.\n\n${plainText}\n\nError: ${message.lastError || "Unknown error"}`,
    };

    await transporter.sendMail(mailOptions);
    log("SUCCESS", `Email fallback sent to ${recipients.length} recipient(s)`);
    return true;
  } catch (error) {
    log("ERROR", `Email fallback failed: ${error.message}`);
    return false;
  }
}

/**
 * Convert Slack blocks to plain text
 * @param {Array} blocks - Slack blocks
 * @returns {string} Plain text
 */
function blocksToPlainText(blocks) {
  const lines = [];

  for (const block of blocks) {
    if (block.type === "header" && block.text) {
      lines.push(`=== ${block.text.text} ===`);
    } else if (block.type === "section") {
      if (block.text) {
        lines.push(block.text.text);
      }
      if (block.fields) {
        for (const field of block.fields) {
          lines.push(field.text);
        }
      }
    } else if (block.type === "context" && block.elements) {
      for (const element of block.elements) {
        if (element.text) {
          lines.push(`  ${element.text}`);
        }
      }
    } else if (block.type === "divider") {
      lines.push("---");
    }
  }

  return lines.join("\n");
}

// ============================================================================
// Slack API Integration
// ============================================================================

/**
 * Make a request to the Slack Web API
 * @param {string} endpoint - API endpoint (e.g., "chat.postMessage")
 * @param {Object} payload - Request payload
 * @returns {Promise<Object>} { success: boolean, data?: object, error?: string }
 */
function sendSlackApiRequest(endpoint, payload) {
  return new Promise((resolve) => {
    const token = process.env.SLACK_BOT_TOKEN;

    if (!token) {
      resolve({ success: false, error: "SLACK_BOT_TOKEN not set" });
      return;
    }

    const data = JSON.stringify(payload);

    const options = {
      hostname: "slack.com",
      port: 443,
      path: `/api/${endpoint}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const result = JSON.parse(responseData);

          if (result.ok) {
            resolve({ success: true, data: result });
          } else {
            resolve({
              success: false,
              error: result.error || "Unknown Slack API error",
              data: result,
            });
          }
        } catch (error) {
          resolve({ success: false, error: `Parse error: ${error.message}` });
        }
      });
    });

    req.on("error", (error) => {
      resolve({ success: false, error: `Network error: ${error.message}` });
    });

    req.write(data);
    req.end();
  });
}

/**
 * Utility delay function
 * @param {number} ms - Milliseconds to wait
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================================
// Message Sending Functions
// ============================================================================

/**
 * Send Slack message with retry logic and rate limiting
 * @param {string} channel - Slack channel ID
 * @param {Object[]} blocks - Slack blocks
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} Success status
 */
async function sendSlackMessage(channel, blocks, options = {}) {
  const { text = "Ralph Automation Report", retries = MAX_RETRIES } = options;

  // Dry run mode - log message without sending
  if (process.env.RALPH_DRY_RUN === "1") {
    log("INFO", `[DRY RUN] Would send to ${channel}`);
    if (process.env.RALPH_DRY_RUN_VERBOSE === "1") {
      console.log(JSON.stringify({ channel, text, blocks }, null, 2));
    }
    return true;
  }

  // Check if we have a token
  if (!process.env.SLACK_BOT_TOKEN) {
    log("ERROR", "SLACK_BOT_TOKEN not set, skipping send");
    return false;
  }

  // Rate limiting
  await checkRateLimit(channel);

  const payload = {
    channel,
    text, // Fallback text for notifications
    blocks,
  };

  // Retry loop with exponential backoff
  for (let attempt = 1; attempt <= retries; attempt++) {
    log("INFO", `Attempt ${attempt}/${retries}: Sending to channel ${channel}`);

    const result = await sendSlackApiRequest("chat.postMessage", payload);

    if (result.success) {
      updateRateLimitState(channel);
      log("SUCCESS", `Sent message to ${channel}`);
      return true;
    }

    log("ERROR", `Attempt ${attempt} failed: ${result.error}`);

    if (attempt < retries) {
      const backoffMs = Math.pow(2, attempt) * 1000;
      log("INFO", `Retrying in ${backoffMs}ms...`);
      await delay(backoffMs);
    }
  }

  // All retries exhausted - queue for later retry or email fallback
  queueFailedMessage({
    channel,
    endpoint: "chat.postMessage",
    payload,
    lastError: "Max retries exhausted",
  });

  return false;
}

/**
 * Send a direct message to a user
 * @param {string} userId - Slack user ID
 * @param {Object[]} blocks - Slack blocks
 * @param {Object} options - Additional options
 * @returns {Promise<boolean>} Success status
 */
async function sendDirectMessage(userId, blocks, options = {}) {
  if (!process.env.SLACK_BOT_TOKEN) {
    log("ERROR", "SLACK_BOT_TOKEN not set, skipping DM");
    return false;
  }

  // First, open a conversation with the user
  const openResult = await sendSlackApiRequest("conversations.open", {
    users: userId,
  });

  if (!openResult.success) {
    log("ERROR", `Failed to open DM with user ${userId}: ${openResult.error}`);
    return false;
  }

  const dmChannel = openResult.data.channel.id;

  // Now send the message to the DM channel
  return sendSlackMessage(dmChannel, blocks, options);
}

/**
 * Upload a file to Slack
 * @param {string} channels - Comma-separated channel IDs
 * @param {Buffer|string} content - File content
 * @param {Object} options - File options (filename, title, etc.)
 * @returns {Promise<boolean>} Success status
 */
async function uploadFile(channels, content, options = {}) {
  if (!process.env.SLACK_BOT_TOKEN) {
    log("ERROR", "SLACK_BOT_TOKEN not set, skipping file upload");
    return false;
  }

  const { filename = "report.txt", title, initialComment } = options;

  const payload = {
    channels,
    filename,
    title: title || filename,
    content: typeof content === "string" ? content : content.toString("utf-8"),
    initial_comment: initialComment,
  };

  const result = await sendSlackApiRequest("files.upload", payload);

  if (result.success) {
    log("SUCCESS", `Uploaded file ${filename} to ${channels}`);
    return true;
  }

  log("ERROR", `Failed to upload file: ${result.error}`);
  return false;
}

// ============================================================================
// Message Formatting - Block Kit (US-002)
// ============================================================================

/**
 * UI base URL for PRD links
 */
const UI_BASE_URL = process.env.RALPH_UI_URL || "http://localhost:3000";

/**
 * Get status emoji based on health indicator
 * @param {string} status - Status type: healthy, at-risk, blocked
 * @returns {string} Emoji
 */
function getStatusEmoji(status) {
  switch (status) {
    case "healthy":
      return "🟢";
    case "at-risk":
      return "🟡";
    case "blocked":
      return "🔴";
    default:
      return "⚪";
  }
}

/**
 * Determine PRD health status based on days since activity
 * @param {number} daysSinceActivity - Days since last activity
 * @returns {string} Status: healthy, at-risk, blocked
 */
function getPrdHealthStatus(daysSinceActivity) {
  if (daysSinceActivity >= 7) return "blocked";
  if (daysSinceActivity >= 3) return "at-risk";
  return "healthy";
}

/**
 * Format a date for display in messages
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted date string (YYYY-MM-DD)
 */
function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split("T")[0];
}

/**
 * Format timestamp for display
 * @param {Date|string} date - Date to format
 * @returns {string} Formatted timestamp
 */
function formatTimestamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().replace("T", " ").substring(0, 19) + " UTC";
}

/**
 * Check if current time is in quiet hours (22:00-08:00)
 * @returns {boolean} True if in quiet hours
 */
function isQuietHours() {
  const hour = new Date().getHours();
  return hour >= 22 || hour < 8;
}

/**
 * Create standard metadata context block
 * @param {Object} options - Metadata options
 * @param {Date} options.timestamp - Generation timestamp
 * @param {number} options.runCount - Total run count
 * @param {Date|string} options.lastActivity - Last activity date
 * @returns {Object} Slack context block
 */
function createMetadataBlock(options = {}) {
  const {
    timestamp = new Date(),
    runCount = 0,
    lastActivity = new Date(),
  } = options;

  return {
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `📅 Generated: ${formatTimestamp(timestamp)} | 🔄 Runs: ${runCount} | 🕐 Last Activity: ${formatTimestamp(lastActivity)}`,
      },
    ],
  };
}

/**
 * Create action button block with View Details link
 * @param {string|number} prdId - PRD ID for link (optional)
 * @param {string} buttonText - Button label
 * @param {string} actionId - Action ID for tracking
 * @returns {Object} Slack actions block
 */
function createActionButtonBlock(prdId = null, buttonText = "View Details", actionId = "view_details") {
  const url = prdId ? `${UI_BASE_URL}/prd/${prdId}` : `${UI_BASE_URL}/prd`;

  return {
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: buttonText,
          emoji: true,
        },
        url,
        action_id: actionId,
      },
    ],
  };
}

/**
 * Format Daily PRD Status as Slack Block Kit (US-002)
 *
 * Creates a rich-formatted daily status report with:
 * - Header with date
 * - Sections grouped by discipline/team
 * - Emoji indicators (🟢 healthy, 🟡 at-risk, 🔴 blocked)
 * - Links to UI for each PRD
 * - Metadata footer (timestamp, run count, last activity)
 *
 * @param {Object} options - Formatting options
 * @param {Date} options.date - Report date
 * @param {Object[]} options.disciplines - Array of discipline data
 * @param {Object[]} options.prds - Array of PRD status objects
 * @param {Object} options.totals - Overall totals
 * @returns {Object[]} Slack Block Kit blocks
 */
function formatDailyStatusBlocks(options = {}) {
  const {
    date = new Date(),
    disciplines = [],
    prds = [],
    totals = {},
  } = options;

  const blocks = [];

  // Header block
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `📊 Daily PRD Status - ${formatDate(date)}`,
      emoji: true,
    },
  });

  // Overview section
  const healthyCount = prds.filter((p) => getPrdHealthStatus(p.daysSinceActivity || 0) === "healthy").length;
  const atRiskCount = prds.filter((p) => getPrdHealthStatus(p.daysSinceActivity || 0) === "at-risk").length;
  const blockedCount = prds.filter((p) => getPrdHealthStatus(p.daysSinceActivity || 0) === "blocked").length;

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Overview:* ${getStatusEmoji("healthy")} ${healthyCount} healthy | ${getStatusEmoji("at-risk")} ${atRiskCount} at-risk | ${getStatusEmoji("blocked")} ${blockedCount} blocked`,
    },
  });

  blocks.push({ type: "divider" });

  // Group PRDs by discipline
  const prdsByDiscipline = {};
  for (const prd of prds) {
    const disc = prd.discipline || "other";
    if (!prdsByDiscipline[disc]) {
      prdsByDiscipline[disc] = [];
    }
    prdsByDiscipline[disc].push(prd);
  }

  // Section for each discipline
  for (const discipline of disciplines) {
    const discName = discipline.discipline || discipline.name;
    const discPrds = prdsByDiscipline[discName] || [];

    if (discPrds.length === 0 && disciplines.length > 1) {
      continue; // Skip empty disciplines when there are multiple
    }

    // Format PRD lines with emoji indicators and links
    const prdLines = discPrds.map((prd) => {
      const status = getPrdHealthStatus(prd.daysSinceActivity || 0);
      const emoji = getStatusEmoji(status);
      const prdLink = `<${UI_BASE_URL}/prd/${prd.id}|PRD-${prd.id}>`;

      let statusText = "";
      if (prd.storiesCompleted) {
        statusText = `${prd.storiesCompleted} stories completed`;
      } else if (prd.daysSinceActivity >= 2) {
        statusText = `Blocked for ${prd.daysSinceActivity} days`;
      } else {
        statusText = "Active";
      }

      return `${emoji} ${prdLink}: ${statusText}`;
    }).join("\n");

    // Discipline section with metrics
    const discTitle = discName.charAt(0).toUpperCase() + discName.slice(1);
    const successRate = discipline.successRate || 0;
    const rateEmoji = successRate >= 80 ? "🟢" : successRate >= 60 ? "🟡" : "🔴";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${discTitle} Team* ${rateEmoji} ${successRate}%\n${prdLines || "_No active PRDs_"}`,
      },
    });

    // Context block with discipline metrics
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `Runs: ${discipline.totalRuns || 0} | Success: ${discipline.successfulRuns || 0} | Failed: ${discipline.failedRuns || 0}`,
        },
      ],
    });
  }

  blocks.push({ type: "divider" });

  // Metadata footer
  blocks.push(createMetadataBlock({
    timestamp: new Date(),
    runCount: totals.totalRuns || 0,
    lastActivity: totals.lastActivity || new Date(),
  }));

  // Action button
  blocks.push(createActionButtonBlock(null, "View Dashboard", "view_daily_dashboard"));

  return blocks;
}

/**
 * Format Weekly Summary as Slack Block Kit (US-002)
 *
 * Creates a rich-formatted weekly summary with:
 * - Header block with week number
 * - Dividers between sections
 * - Key metrics fields
 * - Top performers and blockers
 * - Action buttons (View Details)
 * - Metadata footer
 *
 * @param {Object} options - Formatting options
 * @param {Date} options.weekStart - Week start date
 * @param {Date} options.weekEnd - Week end date
 * @param {Object} options.metrics - Weekly metrics
 * @param {Object[]} options.highlights - Notable achievements
 * @param {Object[]} options.blockers - Blocked PRDs
 * @param {Object} options.comparison - Week-over-week comparison
 * @returns {Object[]} Slack Block Kit blocks
 */
function formatWeeklySummaryBlocks(options = {}) {
  const {
    weekStart = new Date(),
    weekEnd = new Date(),
    metrics = {},
    highlights = [],
    blockers = [],
    comparison = {},
  } = options;

  const blocks = [];

  // Get week number
  const weekNum = getWeekNumber(weekStart);

  // Header block
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `📈 Weekly Summary - Week ${weekNum}`,
      emoji: true,
    },
  });

  // Date range section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Period:* ${formatDate(weekStart)} to ${formatDate(weekEnd)}`,
    },
  });

  blocks.push({ type: "divider" });

  // Key metrics section with fields
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*📊 Key Metrics*",
    },
  });

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Total Runs*\n${metrics.totalRuns || 0}`,
      },
      {
        type: "mrkdwn",
        text: `*Success Rate*\n${getStatusEmoji(metrics.successRate >= 80 ? "healthy" : metrics.successRate >= 60 ? "at-risk" : "blocked")} ${metrics.successRate || 0}%`,
      },
      {
        type: "mrkdwn",
        text: `*Stories Completed*\n${metrics.storiesCompleted || 0}`,
      },
      {
        type: "mrkdwn",
        text: `*Total Cost*\n$${(metrics.totalCost || 0).toFixed(2)}`,
      },
    ],
  });

  // Week-over-week comparison
  if (comparison.previousWeek) {
    const runsDelta = (metrics.totalRuns || 0) - (comparison.previousWeek.totalRuns || 0);
    const rateDelta = (metrics.successRate || 0) - (comparison.previousWeek.successRate || 0);
    const runsArrow = runsDelta >= 0 ? "📈" : "📉";
    const rateArrow = rateDelta >= 0 ? "📈" : "📉";

    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `${runsArrow} Runs: ${runsDelta >= 0 ? "+" : ""}${runsDelta} vs last week | ${rateArrow} Rate: ${rateDelta >= 0 ? "+" : ""}${rateDelta.toFixed(1)}%`,
        },
      ],
    });
  }

  blocks.push({ type: "divider" });

  // Highlights section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: "*✨ Highlights*",
    },
  });

  if (highlights.length > 0) {
    const highlightText = highlights
      .slice(0, 5)
      .map((h) => `• ${getStatusEmoji("healthy")} <${UI_BASE_URL}/prd/${h.prdId}|PRD-${h.prdId}>: ${h.achievement}`)
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: highlightText,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: "_No notable highlights this week_",
      },
    });
  }

  blocks.push({ type: "divider" });

  // Blockers section
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*🚨 Blockers (${blockers.length})*`,
    },
  });

  if (blockers.length > 0) {
    const blockerText = blockers
      .slice(0, 5)
      .map((b) => {
        const status = getPrdHealthStatus(b.daysSinceActivity || b.daysBlocked || 7);
        return `• ${getStatusEmoji(status)} <${UI_BASE_URL}/prd/${b.prdId}|PRD-${b.prdId}>: Blocked ${b.daysSinceActivity || b.daysBlocked || "?"} days - ${b.reason || "No recent activity"}`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: blockerText,
      },
    });
  } else {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${getStatusEmoji("healthy")} _No blockers this week!_`,
      },
    });
  }

  blocks.push({ type: "divider" });

  // Metadata footer
  blocks.push(createMetadataBlock({
    timestamp: new Date(),
    runCount: metrics.totalRuns || 0,
    lastActivity: metrics.lastActivity || new Date(),
  }));

  // Action buttons
  blocks.push({
    type: "actions",
    elements: [
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "View Details",
          emoji: true,
        },
        url: `${UI_BASE_URL}/executive`,
        action_id: "view_weekly_details",
      },
      {
        type: "button",
        text: {
          type: "plain_text",
          text: "View All PRDs",
          emoji: true,
        },
        url: `${UI_BASE_URL}/prd`,
        action_id: "view_all_prds",
      },
    ],
  });

  return blocks;
}

/**
 * Get ISO week number for a date
 * @param {Date} date - Date to get week number for
 * @returns {number} Week number (1-53)
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * Format discipline report as Slack Block Kit
 * @param {string} discipline - Discipline name
 * @param {Object} data - Discipline metrics
 * @param {Object[]} blockers - Blocked PRDs
 * @returns {Object[]} Slack blocks
 */
function formatDisciplineBlocks(discipline, data, blockers) {
  const blocks = [];

  // Header
  blocks.push({
    type: "header",
    text: {
      type: "plain_text",
      text: `📊 ${discipline.charAt(0).toUpperCase() + discipline.slice(1)} Daily Report`,
      emoji: true,
    },
  });

  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `*Generated:* ${formatTimestamp(new Date())}\n*Projects:* ${data.projects.join(", ")}`,
    },
  });

  blocks.push({ type: "divider" });

  // Metrics with status emoji
  const successRate = data.successRate || 0;
  const successEmoji = getStatusEmoji(successRate >= 80 ? "healthy" : successRate >= 60 ? "at-risk" : "blocked");

  blocks.push({
    type: "section",
    fields: [
      {
        type: "mrkdwn",
        text: `*Total Runs*\n${data.totalRuns}`,
      },
      {
        type: "mrkdwn",
        text: `*Success Rate*\n${successEmoji} ${successRate}%`,
      },
      {
        type: "mrkdwn",
        text: `*Successful*\n${data.successfulRuns}`,
      },
      {
        type: "mrkdwn",
        text: `*Failed*\n${data.failedRuns}`,
      },
    ],
  });

  // Blockers section
  const disciplineBlockers = blockers.filter((b) => b.discipline === discipline);

  if (disciplineBlockers.length > 0) {
    blocks.push({ type: "divider" });

    const blockerLines = disciplineBlockers
      .map((b) => {
        const status = getPrdHealthStatus(b.daysSinceActivity || 0);
        const emoji = getStatusEmoji(status);
        const prdLink = `<${UI_BASE_URL}/prd/${b.prdId}|PRD-${b.prdId}>`;
        return `• ${emoji} ${prdLink} (${b.projectName}): No activity for ${b.daysSinceActivity} days`;
      })
      .join("\n");

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*⚠️ Blockers (${disciplineBlockers.length})*\n${blockerLines}`,
      },
    });
  } else {
    blocks.push({ type: "divider" });

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${getStatusEmoji("healthy")} No Blockers*\nAll PRDs in this discipline are actively progressing.`,
      },
    });
  }

  // Metadata footer
  blocks.push(createMetadataBlock({
    timestamp: new Date(),
    runCount: data.totalRuns,
    lastActivity: data.lastActivity || new Date(),
  }));

  // Action button with discipline filter
  blocks.push(createActionButtonBlock(null, "View Details", "view_discipline_details"));

  return blocks;
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Run Block Kit format test (--format-test flag)
 * Outputs sample Block Kit JSON for validation
 */
function runFormatTest() {
  console.log("=".repeat(60));
  console.log("  Block Kit Format Test (US-002)");
  console.log("=".repeat(60));
  console.log("\nGenerating sample Block Kit messages...\n");

  // Sample data for testing
  const sampleDate = new Date();
  const sampleDisciplines = [
    {
      discipline: "gameplay",
      name: "gameplay",
      totalRuns: 15,
      successfulRuns: 12,
      failedRuns: 3,
      successRate: 80,
      projects: ["game-core", "mobile-client"],
    },
    {
      discipline: "backend",
      name: "backend",
      totalRuns: 10,
      successfulRuns: 9,
      failedRuns: 1,
      successRate: 90,
      projects: ["api-server"],
    },
  ];

  const samplePrds = [
    { id: 45, discipline: "gameplay", storiesCompleted: 3, daysSinceActivity: 0 },
    { id: 46, discipline: "gameplay", storiesCompleted: 0, daysSinceActivity: 5 },
    { id: 47, discipline: "backend", storiesCompleted: 2, daysSinceActivity: 1 },
    { id: 48, discipline: "backend", storiesCompleted: 0, daysSinceActivity: 8 },
  ];

  const sampleBlockers = [
    { prdId: 46, discipline: "gameplay", projectName: "mobile-client", daysSinceActivity: 5, reason: "Build failures" },
    { prdId: 48, discipline: "backend", projectName: "api-server", daysSinceActivity: 8, reason: "Dependency conflict" },
  ];

  const sampleTotals = {
    totalRuns: 25,
    successRate: 84,
    storiesCompleted: 5,
    totalCost: 12.50,
    lastActivity: new Date(),
  };

  // Test 1: Daily Status Blocks
  console.log("1. Daily Status Message:");
  console.log("-".repeat(40));
  const dailyBlocks = formatDailyStatusBlocks({
    date: sampleDate,
    disciplines: sampleDisciplines,
    prds: samplePrds,
    totals: sampleTotals,
  });
  console.log(JSON.stringify({ blocks: dailyBlocks }, null, 2));

  // Test 2: Weekly Summary Blocks
  console.log("\n2. Weekly Summary Message:");
  console.log("-".repeat(40));
  const weekStart = new Date(sampleDate);
  weekStart.setDate(weekStart.getDate() - 7);
  const weeklySummaryBlocks = formatWeeklySummaryBlocks({
    weekStart,
    weekEnd: sampleDate,
    metrics: sampleTotals,
    highlights: [
      { prdId: 45, achievement: "Completed all 3 stories" },
      { prdId: 47, achievement: "API refactoring done" },
    ],
    blockers: sampleBlockers,
    comparison: {
      previousWeek: {
        totalRuns: 20,
        successRate: 75,
      },
    },
  });
  console.log(JSON.stringify({ blocks: weeklySummaryBlocks }, null, 2));

  // Test 3: Discipline Report Blocks (existing function, enhanced)
  console.log("\n3. Discipline Report Message:");
  console.log("-".repeat(40));
  const disciplineBlocks = formatDisciplineBlocks(
    "gameplay",
    sampleDisciplines[0],
    sampleBlockers
  );
  console.log(JSON.stringify({ blocks: disciplineBlocks }, null, 2));

  // Validation summary
  console.log("\n" + "=".repeat(60));
  console.log("  Validation Summary");
  console.log("=".repeat(60));

  const allBlocks = [dailyBlocks, weeklySummaryBlocks, disciplineBlocks];
  let validCount = 0;
  let errorCount = 0;

  for (let i = 0; i < allBlocks.length; i++) {
    const blocks = allBlocks[i];
    const name = ["Daily Status", "Weekly Summary", "Discipline Report"][i];

    // Check for required block types
    const hasHeader = blocks.some((b) => b.type === "header");
    const hasSection = blocks.some((b) => b.type === "section");
    const hasContext = blocks.some((b) => b.type === "context");
    const hasActions = blocks.some((b) => b.type === "actions");
    const hasDivider = blocks.some((b) => b.type === "divider");

    const isValid = hasHeader && hasSection && hasContext && hasActions && hasDivider;

    if (isValid) {
      console.log(`  ✅ ${name}: Valid Block Kit structure`);
      validCount++;
    } else {
      console.log(`  ❌ ${name}: Missing required blocks`);
      if (!hasHeader) console.log("     - Missing: header");
      if (!hasSection) console.log("     - Missing: section");
      if (!hasContext) console.log("     - Missing: context (metadata)");
      if (!hasActions) console.log("     - Missing: actions (buttons)");
      if (!hasDivider) console.log("     - Missing: divider");
      errorCount++;
    }

    // Check for emoji indicators
    const hasEmoji = JSON.stringify(blocks).includes("🟢") ||
                     JSON.stringify(blocks).includes("🟡") ||
                     JSON.stringify(blocks).includes("🔴");
    if (hasEmoji) {
      console.log(`     ✓ Contains status emoji indicators`);
    }

    // Check for UI links
    const hasLinks = JSON.stringify(blocks).includes(UI_BASE_URL);
    if (hasLinks) {
      console.log(`     ✓ Contains UI links (${UI_BASE_URL})`);
    }
  }

  console.log("=".repeat(60));
  console.log(`  Total: ${validCount} valid, ${errorCount} invalid`);
  console.log("=".repeat(60));

  return errorCount === 0;
}

/**
 * Main execution
 */
async function main() {
  // Check for --format-test flag (US-002)
  if (process.argv.includes("--format-test")) {
    const success = runFormatTest();
    process.exit(success ? 0 : 1);
  }

  console.log("=".repeat(60));
  console.log("  Slack Reporter - Send Team Reports to Slack");
  console.log("=".repeat(60));

  // Check for dry run mode
  if (process.env.RALPH_DRY_RUN === "1") {
    console.log("[DRY RUN] Messages will be logged but not sent");
  }

  // Check quiet hours
  if (isQuietHours() && !process.env.FORCE_SLACK_SEND) {
    console.log("[Quiet Hours] Skipping Slack notifications (22:00-08:00)");
    console.log("Set FORCE_SLACK_SEND=true to override");
    process.exit(0);
  }

  // Load configuration
  console.log("[1/4] Loading configuration...");
  const config = loadAutomationConfig();
  const metrics = loadLatestMetrics();

  if (!config.slackChannels) {
    console.error("[Error] No Slack channels configured in automation-config.json");
    process.exit(1);
  }

  // Check for SLACK_BOT_TOKEN
  if (!process.env.SLACK_BOT_TOKEN && process.env.RALPH_DRY_RUN !== "1") {
    console.log("[Warning] SLACK_BOT_TOKEN not set");
    console.log("  Set SLACK_BOT_TOKEN environment variable with your Slack bot token");
    console.log("  Or set RALPH_DRY_RUN=1 for testing without sending");
  }

  console.log(`  Found ${metrics.disciplines.length} discipline(s) to report`);

  // Process queued messages from previous failed attempts
  console.log("[2/4] Processing message queue...");
  const queueResults = await processMessageQueue();
  if (queueResults.success > 0 || queueResults.failed > 0) {
    console.log(`  Queue processed: ${queueResults.success} sent, ${queueResults.failed} remaining`);
  } else {
    console.log("  No queued messages");
  }

  // Send discipline reports
  console.log("[3/4] Sending discipline reports to Slack...");
  let successCount = 0;
  let failureCount = 0;

  for (const discipline of metrics.disciplines) {
    const channelId = config.slackChannels[discipline.discipline];

    if (!channelId) {
      console.log(`  Skipping ${discipline.discipline}: No channel configured`);
      continue;
    }

    const blocks = formatDisciplineBlocks(discipline.discipline, discipline, metrics.blockers || []);

    const success = await sendSlackMessage(channelId, blocks, {
      text: `Ralph Daily Report: ${discipline.discipline}`,
    });

    if (success) {
      log("SUCCESS", `Sent ${discipline.discipline} report to ${channelId}`);
      successCount++;
    } else {
      log("ERROR", `Failed to send ${discipline.discipline} report`);
      failureCount++;
    }
  }

  // Send leadership summary using Block Kit (US-002 enhanced)
  console.log("[4/4] Sending leadership summary...");
  const leadershipChannel = config.slackChannels.leadership;

  if (leadershipChannel) {
    // Create PRD status data from metrics
    const prds = (metrics.blockers || []).map((b) => ({
      id: b.prdId,
      discipline: b.discipline,
      daysSinceActivity: b.daysSinceActivity,
      storiesCompleted: 0,
    }));

    // Use the new Block Kit daily status format
    const summaryBlocks = formatDailyStatusBlocks({
      date: new Date(),
      disciplines: metrics.disciplines,
      prds,
      totals: metrics.totals,
    });

    const success = await sendSlackMessage(leadershipChannel, summaryBlocks, {
      text: "Ralph Studio Daily Summary",
    });

    if (success) {
      log("SUCCESS", `Sent leadership summary to ${leadershipChannel}`);
      successCount++;
    } else {
      log("ERROR", "Failed to send leadership summary");
      failureCount++;
    }
  }

  console.log("=".repeat(60));
  console.log("  Summary");
  console.log("=".repeat(60));
  console.log(`  Successful: ${successCount}`);
  console.log(`  Failed: ${failureCount}`);
  if (failureCount > 0) {
    console.log(`  Note: Failed messages queued for retry on next run`);
  }
  console.log("=".repeat(60));

  process.exit(failureCount > 0 ? 1 : 0);
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Main entry
  main,
  runFormatTest,
  // Message sending
  sendSlackMessage,
  sendDirectMessage,
  uploadFile,
  // Block Kit Formatting (US-002)
  formatDisciplineBlocks,
  formatDailyStatusBlocks,
  formatWeeklySummaryBlocks,
  createMetadataBlock,
  createActionButtonBlock,
  // Status helpers
  getStatusEmoji,
  getPrdHealthStatus,
  getWeekNumber,
  formatDate,
  formatTimestamp,
  isQuietHours,
  // Queue management
  loadMessageQueue,
  saveMessageQueue,
  processMessageQueue,
  // Email fallback
  sendEmailFallback,
  // Rate limiting (for testing)
  checkRateLimit,
  // Utilities
  blocksToPlainText,
  // Configuration
  loadAutomationConfig,
  loadLatestMetrics,
  // Constants
  UI_BASE_URL,
};

// Execute if run directly
if (require.main === module) {
  main().catch((error) => {
    console.error("[Fatal Error]", error.message);
    console.error(error.stack);
    process.exit(1);
  });
}
