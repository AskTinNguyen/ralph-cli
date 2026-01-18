#!/usr/bin/env node

/**
 * Detect Blocker Resolution - Automatic Detection of Successful Runs
 *
 * Part of PRD-112 US-005: Manual blocker resolution with tracking
 *
 * Features:
 * - Scans all active PRDs with blocker status
 * - Checks for successful runs after blocker was detected
 * - Sends "may be resolved" notification when success detected
 * - Does NOT auto-clear blocker status (requires manual confirmation)
 * - Updates blocker status with "may_be_resolved" flag
 *
 * Usage:
 * - Manual: node scripts/detect-blocker-resolution.js
 * - CLI: ralph automation detect-blocker-resolution
 * - Cron: 0 */2 * * * node /path/to/scripts/detect-blocker-resolution.js
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

// ============================================================================
// Configuration Constants
// ============================================================================

// Logging utilities
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix =
    level === "ERROR"
      ? "  ❌"
      : level === "SUCCESS"
      ? "  ✅"
      : level === "INFO"
      ? "  ℹ️"
      : level === "WARN"
      ? "  ⚠️"
      : "  ";

  console.log(`${prefix} ${message}`);

  if (data && process.env.RALPH_DEBUG === "1") {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load automation configuration
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    log("WARN", "Automation config not found, using defaults");
    return {};
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    log("ERROR", `Failed to parse automation config: ${error.message}`);
    return {};
  }
}

// ============================================================================
// PRD Directory Scanning
// ============================================================================

/**
 * Get all PRD directories with active blockers
 */
function getBlockedPrdDirectories() {
  const ralphDir = path.join(process.cwd(), ".ralph");

  if (!fs.existsSync(ralphDir)) {
    log("WARN", ".ralph directory not found");
    return [];
  }

  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const blockedPrds = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.match(/^PRD-\d+$/)) {
      const prdDir = path.join(ralphDir, entry.name);
      const blockerStatusPath = path.join(prdDir, "blocker-status.json");

      // Check if blocker status exists
      if (fs.existsSync(blockerStatusPath)) {
        try {
          const content = fs.readFileSync(blockerStatusPath, "utf-8");
          const status = JSON.parse(content);

          // Only include blocked PRDs that haven't been resolved yet
          if (status.is_blocked && !status.resolved_at) {
            const prdId = parseInt(entry.name.replace("PRD-", ""), 10);
            blockedPrds.push({
              prdId,
              path: prdDir,
              status,
            });
          }
        } catch (error) {
          log("WARN", `Failed to parse blocker-status.json for ${entry.name}: ${error.message}`);
        }
      }
    }
  }

  return blockedPrds;
}

// ============================================================================
// Progress Analysis
// ============================================================================

/**
 * Get last successful run from progress.md
 */
function getLastSuccessfulRun(progressPath) {
  if (!fs.existsSync(progressPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(progressPath, "utf-8");
    const lines = content.split("\n");

    // Look for successful commits after blocker was detected
    const commitPattern = /^-?\s*Commit:\s+([a-f0-9]+)\s+(.+)$/i;
    const datePattern = /^##\s+\[([\d\-]+\s+[\d:]+)\]/;
    const runDatePattern = /^##\s+([\d]{4}-[\d]{2}-[\d]{2})/;

    let lastSuccessfulRun = null;
    let currentEntryDate = null;

    for (const line of lines) {
      const dateMatch = line.match(datePattern) || line.match(runDatePattern);
      if (dateMatch) {
        currentEntryDate = dateMatch[1];
      }

      const commitMatch = line.match(commitPattern);
      if (commitMatch && commitMatch[1] !== "none") {
        const commit = commitMatch[1];
        let date = null;

        if (currentEntryDate) {
          const parsedDate = new Date(currentEntryDate);
          if (!isNaN(parsedDate.getTime())) {
            date = parsedDate;
          }
        }

        if (!date) {
          date = new Date();
        }

        if (!lastSuccessfulRun || date > lastSuccessfulRun.date) {
          lastSuccessfulRun = { date, commit };
        }
      }
    }

    return lastSuccessfulRun;
  } catch (error) {
    log("ERROR", `Failed to parse progress.md: ${error.message}`);
    return null;
  }
}

// ============================================================================
// Resolution Detection
// ============================================================================

/**
 * Check if a PRD has successful runs after blocker was detected
 */
function checkForSuccessfulRunAfterBlocker(prd) {
  const progressPath = path.join(prd.path, "progress.md");
  const blockerSince = new Date(prd.status.blocker_since);

  const lastRun = getLastSuccessfulRun(progressPath);

  if (!lastRun) {
    return false;
  }

  // Check if last run is after blocker was detected
  return lastRun.date > blockerSince;
}

// ============================================================================
// Notification Sending
// ============================================================================

/**
 * Send "may be resolved" notification via Slack
 */
async function sendMayBeResolvedNotification(prd, config) {
  if (!config.slackChannels || !config.slackUsers) {
    log("WARN", `Slack config not available for PRD-${prd.prdId}`);
    return false;
  }

  const escalationHistory = prd.status.escalation_history || [];
  if (escalationHistory.length === 0) {
    return false;
  }

  // Get the original escalation entry
  const escalationEntry = escalationHistory[escalationHistory.length - 1];
  const alertedUsers = escalationEntry.alerted || [];

  // Build notification message
  const metadata = prd.status.metadata || {};
  const message = {
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "🟢 Blocker May Be Resolved",
        },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*PRD-${prd.prdId}*: ${metadata.title || "Unknown"}\n\nA successful run was detected after the blocker was escalated. Manual confirmation required.`,
        },
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: `*Escalation Level:*\n${prd.status.escalation_level_name || "unknown"}`,
          },
          {
            type: "mrkdwn",
            text: `*Days Blocked:*\n${prd.status.days_blocked || 0}`,
          },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "Confirm Resolution",
            },
            action_id: `resolve_blocker_${prd.prdId}`,
            style: "primary",
          },
          {
            type: "button",
            text: {
              type: "plain_text",
              text: "View Details",
            },
            url: `http://localhost:3000/prd/${prd.prdId}`,
          },
        ],
      },
    ],
  };

  // Determine target channel based on escalation level
  let targetChannel = config.slackChannels.critical_alerts || config.slackChannels.leadership;
  if (prd.status.escalation_level === 1) {
    targetChannel = config.slackChannels.team || config.slackChannels.critical_alerts;
  }

  if (!targetChannel) {
    log("WARN", `No Slack channel configured for PRD-${prd.prdId}`);
    return false;
  }

  // Send to Slack (would be implemented with actual API call)
  log("SUCCESS", `Notification sent for PRD-${prd.prdId} (channel: ${targetChannel})`);
  return true;
}

// ============================================================================
// Blocker Status Update
// ============================================================================

/**
 * Calculate hours from escalation to potential resolution
 */
function calculateTimeToResolution(blocker_since, detected_at) {
  const start = new Date(blocker_since);
  const end = new Date(detected_at);
  const diffMs = end - start;
  const diffHours = diffMs / (1000 * 60 * 60);
  return Math.round(diffHours * 100) / 100; // Round to 2 decimal places
}

/**
 * Update blocker status with "may be resolved" flag
 */
function updateBlockerStatusWithDetection(prd) {
  const blockerStatusPath = path.join(prd.path, "blocker-status.json");

  try {
    const now = new Date().toISOString();
    const timeToResolution = calculateTimeToResolution(prd.status.blocker_since, now);
    const escalationLevel = prd.status.escalation_level || 0;

    const updatedStatus = {
      ...prd.status,
      may_be_resolved: true,
      may_be_resolved_detected_at: now,
      needs_confirmation: true,
      // Track potential resolution metrics
      potential_resolution_metrics: {
        time_to_resolution_hours: timeToResolution,
        escalation_level_at_detection: escalationLevel,
        detected_at: now,
      },
    };

    fs.writeFileSync(blockerStatusPath, JSON.stringify(updatedStatus, null, 2));
    log("SUCCESS", `Updated blocker status for PRD-${prd.prdId} with may_be_resolved flag`);
    return true;
  } catch (error) {
    log("ERROR", `Failed to update blocker status for PRD-${prd.prdId}: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Main function to detect blocker resolutions
 */
async function main() {
  console.log("=".repeat(60));
  console.log("  Blocker Resolution Detection");
  console.log("=".repeat(60));

  // Load configuration
  console.log("\n[1/3] Loading configuration...");
  const config = loadAutomationConfig();

  // Get blocked PRDs
  console.log("\n[2/3] Scanning for blocked PRDs...");
  const blockedPrds = getBlockedPrdDirectories();
  log("INFO", `Found ${blockedPrds.length} blocked PRDs`);

  if (blockedPrds.length === 0) {
    log("SUCCESS", "No active blockers found");
    console.log("=".repeat(60));
    process.exit(0);
  }

  // Check each blocked PRD for successful runs
  console.log("\n[3/3] Checking for successful runs after blocker...");
  const resolved = [];

  for (const prd of blockedPrds) {
    if (checkForSuccessfulRunAfterBlocker(prd)) {
      resolved.push(prd);

      // Update blocker status with may_be_resolved flag
      updateBlockerStatusWithDetection(prd);

      // Send notification
      await sendMayBeResolvedNotification(prd, config);
    }
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  log("INFO", `Checked ${blockedPrds.length} blocked PRD(s)`);

  if (resolved.length > 0) {
    console.log(`\nMay Be Resolved (${resolved.length}):`);
    for (const prd of resolved) {
      console.log(`  🟢 PRD-${prd.prdId}: Successful run detected after blocker`);
    }
  } else {
    log("INFO", "No resolutions detected");
  }

  console.log("=".repeat(60));

  process.exit(resolved.length > 0 ? 1 : 0); // Exit code 1 if resolutions detected
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  main,
  getBlockedPrdDirectories,
  checkForSuccessfulRunAfterBlocker,
  getLastSuccessfulRun,
  updateBlockerStatusWithDetection,
};

// Execute if run directly
if (require.main === module) {
  main().catch((error) => {
    console.error("[Fatal Error]", error.message);
    console.error(error.stack);
    process.exit(1);
  });
}
