#!/usr/bin/env node

/**
 * Check Blockers - 3-Level Blocker Detection Script
 *
 * Part of PRD-112 US-003: Implement 3-level blocker detection
 *
 * Features:
 * - Scans all PRD-N folders for zero velocity (no successful runs)
 * - Detects blockers at 2/4/7 day thresholds
 * - Tracks escalation state: not_escalated, level1, level2, level3
 * - Stores blocker metadata in .ralph/PRD-N/blocker-status.json
 * - Prevents duplicate escalations (only escalate once per level)
 *
 * Configuration:
 * - .ralph/automation-config.json for escalation thresholds and channels
 *
 * Usage:
 * - Manual: node scripts/check-blockers.js
 * - CLI: ralph automation check-blockers
 * - Cron: 0 8 * * * node /path/to/scripts/check-blockers.js
 */

const fs = require("fs");
const path = require("path");

// ============================================================================
// Configuration Constants
// ============================================================================

// Default escalation thresholds (days)
const DEFAULT_THRESHOLDS = {
  level1_days: 2,
  level2_days: 4,
  level3_days: 7,
};

// Escalation levels
const ESCALATION_LEVELS = {
  NOT_ESCALATED: 0,
  LEVEL1: 1,
  LEVEL2: 2,
  LEVEL3: 3,
};

// ============================================================================
// Logging Utilities
// ============================================================================

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix =
    level === "ERROR"
      ? "  \u274c"
      : level === "SUCCESS"
      ? "  \u2705"
      : level === "WARN"
      ? "  \u26a0\ufe0f"
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
 * @returns {Object} Automation config with defaults
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    log("WARN", "Automation config not found, using defaults");
    return {
      blockerEscalation: {
        enabled: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Ensure blockerEscalation exists with defaults
    if (!config.blockerEscalation) {
      config.blockerEscalation = {
        enabled: true,
        thresholds: DEFAULT_THRESHOLDS,
      };
    }

    if (!config.blockerEscalation.thresholds) {
      config.blockerEscalation.thresholds = DEFAULT_THRESHOLDS;
    }

    return config;
  } catch (error) {
    log("ERROR", `Failed to parse automation config: ${error.message}`);
    return {
      blockerEscalation: {
        enabled: true,
        thresholds: DEFAULT_THRESHOLDS,
      },
    };
  }
}

// ============================================================================
// PRD Directory Scanning
// ============================================================================

/**
 * Get all PRD directories
 * @returns {Array<{prdId: number, path: string}>} List of PRD directories
 */
function getPrdDirectories() {
  const ralphDir = path.join(process.cwd(), ".ralph");

  if (!fs.existsSync(ralphDir)) {
    log("WARN", ".ralph directory not found");
    return [];
  }

  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdDirs = [];

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.match(/^PRD-\d+$/)) {
      const prdId = parseInt(entry.name.replace("PRD-", ""), 10);
      prdDirs.push({
        prdId,
        path: path.join(ralphDir, entry.name),
      });
    }
  }

  // Sort by PRD ID
  prdDirs.sort((a, b) => a.prdId - b.prdId);

  return prdDirs;
}

// ============================================================================
// Progress Analysis
// ============================================================================

/**
 * Parse progress.md to find last successful run
 * @param {string} progressPath - Path to progress.md
 * @returns {Object|null} { date: Date, commit: string } or null if not found
 */
function getLastSuccessfulRun(progressPath) {
  if (!fs.existsSync(progressPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(progressPath, "utf-8");
    const lines = content.split("\n");

    // Look for entries with successful commits
    // Format: "- Commit: <hash> <subject>" or "Commit: <hash>"
    // A successful run has a commit line with an actual hash (not "none")
    const commitPattern = /^-?\s*Commit:\s+([a-f0-9]+)\s+(.+)$/i;
    const datePattern = /^##\s+\[([\d\-]+\s+[\d:]+)\]/; // Date from ## [Date/Time] header
    const runDatePattern = /^##\s+([\d]{4}-[\d]{2}-[\d]{2})/; // Date from ## YYYY-MM-DD format

    let lastSuccessfulRun = null;
    let currentEntryDate = null;

    for (const line of lines) {
      // Try to extract date from section headers
      const dateMatch = line.match(datePattern) || line.match(runDatePattern);
      if (dateMatch) {
        currentEntryDate = dateMatch[1];
      }

      // Look for successful commits
      const commitMatch = line.match(commitPattern);
      if (commitMatch && commitMatch[1] !== "none") {
        const commit = commitMatch[1];
        let date = null;

        if (currentEntryDate) {
          // Try to parse the date
          const parsedDate = new Date(currentEntryDate);
          if (!isNaN(parsedDate.getTime())) {
            date = parsedDate;
          }
        }

        // If we couldn't extract date, try to get it from the line context
        if (!date) {
          // Use current date as fallback but mark as uncertain
          date = new Date();
        }

        // Track the most recent successful run
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

/**
 * Check if PRD is active (has plan.md and is not completed)
 * @param {string} prdPath - Path to PRD directory
 * @returns {boolean} True if PRD is active
 */
function isPrdActive(prdPath) {
  const planPath = path.join(prdPath, "plan.md");
  const completedMarker = path.join(prdPath, ".completed");
  const mergedMarker = path.join(prdPath, ".merged");

  // Not active if no plan exists
  if (!fs.existsSync(planPath)) {
    return false;
  }

  // Not active if already completed or merged
  if (fs.existsSync(completedMarker) || fs.existsSync(mergedMarker)) {
    return false;
  }

  return true;
}

/**
 * Get PRD metadata (team, priority, title) from prd.md
 * @param {string} prdPath - Path to PRD directory
 * @returns {Object} PRD metadata
 */
function getPrdMetadata(prdPath) {
  const prdMdPath = path.join(prdPath, "prd.md");

  if (!fs.existsSync(prdMdPath)) {
    return { title: "Unknown", team: "unknown", priority: "normal" };
  }

  try {
    const content = fs.readFileSync(prdMdPath, "utf-8");

    // Extract title from first header
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].replace(/^Product Requirements Document:\s*/i, "").trim() : "Unknown";

    // Extract team
    const teamMatch = content.match(/\*\*Team:\*\*\s*(.+)/i);
    const team = teamMatch ? teamMatch[1].trim() : "unknown";

    // Extract priority
    const priorityMatch = content.match(/\*\*Priority:\*\*\s*(.+)/i);
    const priority = priorityMatch ? priorityMatch[1].trim().toLowerCase() : "normal";

    return { title, team, priority };
  } catch (error) {
    return { title: "Unknown", team: "unknown", priority: "normal" };
  }
}

// ============================================================================
// Blocker Status Management
// ============================================================================

/**
 * Load existing blocker status
 * @param {string} prdPath - Path to PRD directory
 * @returns {Object|null} Blocker status or null
 */
function loadBlockerStatus(prdPath) {
  const statusPath = path.join(prdPath, "blocker-status.json");

  if (!fs.existsSync(statusPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(statusPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    log("WARN", `Failed to parse blocker-status.json: ${error.message}`);
    return null;
  }
}

/**
 * Save blocker status
 * @param {string} prdPath - Path to PRD directory
 * @param {Object} status - Blocker status object
 */
function saveBlockerStatus(prdPath, status) {
  const statusPath = path.join(prdPath, "blocker-status.json");

  try {
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    log("SUCCESS", `Updated blocker-status.json for PRD-${status.prd_id}`);
  } catch (error) {
    log("ERROR", `Failed to save blocker-status.json: ${error.message}`);
  }
}

/**
 * Calculate days between two dates
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date (defaults to now)
 * @returns {number} Number of days
 */
function calculateDaysBlocked(startDate, endDate = new Date()) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((endDate - startDate) / msPerDay);
}

/**
 * Determine escalation level based on days blocked
 * @param {number} daysBlocked - Number of days blocked
 * @param {Object} thresholds - Escalation thresholds
 * @returns {number} Escalation level (0-3)
 */
function determineEscalationLevel(daysBlocked, thresholds) {
  if (daysBlocked >= thresholds.level3_days) {
    return ESCALATION_LEVELS.LEVEL3;
  }
  if (daysBlocked >= thresholds.level2_days) {
    return ESCALATION_LEVELS.LEVEL2;
  }
  if (daysBlocked >= thresholds.level1_days) {
    return ESCALATION_LEVELS.LEVEL1;
  }
  return ESCALATION_LEVELS.NOT_ESCALATED;
}

/**
 * Get escalation level name
 * @param {number} level - Escalation level
 * @returns {string} Level name
 */
function getEscalationLevelName(level) {
  switch (level) {
    case ESCALATION_LEVELS.LEVEL3:
      return "level3";
    case ESCALATION_LEVELS.LEVEL2:
      return "level2";
    case ESCALATION_LEVELS.LEVEL1:
      return "level1";
    default:
      return "not_escalated";
  }
}

/**
 * Create or update blocker status for a PRD
 * @param {Object} prd - PRD info { prdId, path }
 * @param {Object} config - Automation config
 * @returns {Object|null} Updated blocker status or null if not blocked
 */
function checkPrdBlocker(prd, config) {
  const thresholds = config.blockerEscalation?.thresholds || DEFAULT_THRESHOLDS;

  // Check if PRD is active
  if (!isPrdActive(prd.path)) {
    // If PRD is completed/inactive, clear any existing blocker status
    const existingStatus = loadBlockerStatus(prd.path);
    if (existingStatus && existingStatus.is_blocked) {
      existingStatus.is_blocked = false;
      existingStatus.resolved_at = new Date().toISOString();
      existingStatus.resolution_reason = "PRD marked as completed";
      saveBlockerStatus(prd.path, existingStatus);
    }
    return null;
  }

  // Get last successful run
  const progressPath = path.join(prd.path, "progress.md");
  const lastRun = getLastSuccessfulRun(progressPath);

  // If no progress file or no successful runs, use PRD creation time
  let blockerSince = null;
  let lastSuccessfulRunDate = null;

  if (lastRun) {
    lastSuccessfulRunDate = lastRun.date.toISOString();
    blockerSince = lastRun.date;
  } else {
    // Check if progress.md exists but has no commits
    if (fs.existsSync(progressPath)) {
      // Use file creation/modification time
      const stats = fs.statSync(progressPath);
      blockerSince = stats.mtime;
      lastSuccessfulRunDate = null;
    } else {
      // Check plan.md creation time
      const planPath = path.join(prd.path, "plan.md");
      if (fs.existsSync(planPath)) {
        const stats = fs.statSync(planPath);
        blockerSince = stats.mtime;
        lastSuccessfulRunDate = null;
      } else {
        // PRD exists but no plan yet - not blocked
        return null;
      }
    }
  }

  // Calculate days blocked
  const now = new Date();
  const daysBlocked = calculateDaysBlocked(blockerSince, now);

  // Determine escalation level
  const escalationLevel = determineEscalationLevel(daysBlocked, thresholds);

  // Not blocked if under threshold
  if (escalationLevel === ESCALATION_LEVELS.NOT_ESCALATED) {
    // Check if there was a previous blocker status to clear
    const existingStatus = loadBlockerStatus(prd.path);
    if (existingStatus && existingStatus.is_blocked) {
      existingStatus.is_blocked = false;
      existingStatus.resolved_at = new Date().toISOString();
      existingStatus.resolution_reason = "Activity resumed";
      saveBlockerStatus(prd.path, existingStatus);
    }
    return null;
  }

  // Load existing status to check for escalation changes
  const existingStatus = loadBlockerStatus(prd.path);

  // Get PRD metadata
  const metadata = getPrdMetadata(prd.path);

  // Create new or updated status
  const newStatus = {
    prd_id: prd.prdId,
    is_blocked: true,
    blocker_since: blockerSince.toISOString(),
    days_blocked: daysBlocked,
    escalation_level: escalationLevel,
    escalation_level_name: getEscalationLevelName(escalationLevel),
    escalation_history: existingStatus?.escalation_history || [],
    last_successful_run: lastSuccessfulRunDate,
    last_checked: now.toISOString(),
    metadata: {
      title: metadata.title,
      team: metadata.team,
      priority: metadata.priority,
    },
  };

  // Check if we need to add a new escalation entry
  // Only add if escalation level increased
  const previousLevel = existingStatus?.escalation_level || 0;

  if (escalationLevel > previousLevel) {
    // New escalation!
    const escalationEntry = {
      level: escalationLevel,
      level_name: getEscalationLevelName(escalationLevel),
      date: now.toISOString(),
      days_at_escalation: daysBlocked,
      alerted: [], // Will be populated by send-alerts script
      alert_sent: false, // Will be set to true by send-alerts script
    };

    newStatus.escalation_history.push(escalationEntry);
    newStatus.last_escalation_date = now.toISOString();
    newStatus.needs_alert = true;

    log(
      "WARN",
      `PRD-${prd.prdId}: Escalated to ${getEscalationLevelName(escalationLevel)} (${daysBlocked} days blocked)`
    );
  } else {
    // Same or lower level - just update status
    newStatus.needs_alert = false;
  }

  // Preserve resolution fields if they exist
  if (existingStatus?.resolved_at) {
    newStatus.resolved_at = existingStatus.resolved_at;
    newStatus.resolution_reason = existingStatus.resolution_reason;
  }

  // Save updated status
  saveBlockerStatus(prd.path, newStatus);

  return newStatus;
}

// ============================================================================
// Main Execution
// ============================================================================

/**
 * Main function to check all PRDs for blockers
 */
async function main() {
  console.log("=".repeat(60));
  console.log("  Blocker Detection - 3-Level Escalation System");
  console.log("=".repeat(60));

  // Check for dry run mode
  if (process.env.RALPH_DRY_RUN === "1") {
    console.log("[DRY RUN] Will analyze but not update blocker status files");
  }

  // Load configuration
  console.log("\n[1/4] Loading configuration...");
  const config = loadAutomationConfig();

  if (!config.blockerEscalation?.enabled) {
    log("INFO", "Blocker escalation is disabled in config");
    process.exit(0);
  }

  const thresholds = config.blockerEscalation.thresholds;
  log(
    "INFO",
    `Thresholds: Level 1 = ${thresholds.level1_days}d, Level 2 = ${thresholds.level2_days}d, Level 3 = ${thresholds.level3_days}d`
  );

  // Scan PRD directories
  console.log("\n[2/4] Scanning PRD directories...");
  const prdDirs = getPrdDirectories();
  log("INFO", `Found ${prdDirs.length} PRD directories`);

  if (prdDirs.length === 0) {
    log("WARN", "No PRD directories found in .ralph/");
    process.exit(0);
  }

  // Check each PRD for blockers
  console.log("\n[3/4] Checking PRDs for blockers...");
  const blockers = [];
  const newEscalations = [];
  let activeCount = 0;

  for (const prd of prdDirs) {
    if (!isPrdActive(prd.path)) {
      continue;
    }

    activeCount++;

    // Skip dry run updates
    if (process.env.RALPH_DRY_RUN === "1") {
      // Still analyze but don't save
      const progressPath = path.join(prd.path, "progress.md");
      const lastRun = getLastSuccessfulRun(progressPath);

      if (!lastRun) {
        log("INFO", `PRD-${prd.prdId}: No successful runs found`);
      } else {
        const daysBlocked = calculateDaysBlocked(lastRun.date);
        if (daysBlocked >= thresholds.level1_days) {
          log("WARN", `PRD-${prd.prdId}: Would be blocked (${daysBlocked} days since last commit)`);
        }
      }
      continue;
    }

    const status = checkPrdBlocker(prd, config);

    if (status) {
      blockers.push(status);

      if (status.needs_alert) {
        newEscalations.push(status);
      }
    }
  }

  // Summary
  console.log("\n[4/4] Summary");
  console.log("=".repeat(60));
  log("INFO", `Active PRDs: ${activeCount}`);
  log("INFO", `Blocked PRDs: ${blockers.length}`);

  if (blockers.length > 0) {
    console.log("\nBlocked PRDs:");
    for (const blocker of blockers) {
      const emoji =
        blocker.escalation_level === 3 ? "\ud83d\udea8" : blocker.escalation_level === 2 ? "\u26a0\ufe0f" : "\ud83d\udd34";
      console.log(
        `  ${emoji} PRD-${blocker.prd_id}: ${blocker.days_blocked} days (${blocker.escalation_level_name})`
      );
    }
  } else {
    log("SUCCESS", "No blockers detected!");
  }

  if (newEscalations.length > 0) {
    console.log("\nNew Escalations (alerts pending):");
    for (const escalation of newEscalations) {
      console.log(
        `  \ud83d\udce2 PRD-${escalation.prd_id}: Escalated to ${escalation.escalation_level_name}`
      );
    }
    log("INFO", `${newEscalations.length} new escalation(s) need alerts`);
  }

  console.log("=".repeat(60));

  // Exit with appropriate code
  if (newEscalations.length > 0) {
    // Non-zero exit to indicate new escalations for alerting
    process.exit(2);
  }

  process.exit(0);
}

// ============================================================================
// Module Exports
// ============================================================================

module.exports = {
  // Main entry
  main,
  // Configuration
  loadAutomationConfig,
  DEFAULT_THRESHOLDS,
  ESCALATION_LEVELS,
  // PRD scanning
  getPrdDirectories,
  isPrdActive,
  getPrdMetadata,
  // Progress analysis
  getLastSuccessfulRun,
  // Blocker status
  loadBlockerStatus,
  saveBlockerStatus,
  calculateDaysBlocked,
  determineEscalationLevel,
  getEscalationLevelName,
  checkPrdBlocker,
};

// Execute if run directly
if (require.main === module) {
  main().catch((error) => {
    console.error("[Fatal Error]", error.message);
    console.error(error.stack);
    process.exit(1);
  });
}
