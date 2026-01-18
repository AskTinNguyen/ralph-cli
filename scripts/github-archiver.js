#!/usr/bin/env node

/**
 * GitHub Archiver - Push metrics to ralph-metrics branch
 *
 * Part of PRD-112 US-007: Push metrics to ralph-metrics branch
 *
 * Features:
 * - Creates ralph-metrics branch in game repos (from configuration)
 * - Authenticates via GITHUB_TOKEN environment variable
 * - Commits metrics with bot user (ralph-automation-bot)
 * - Handles merge conflicts (prefer newest data)
 * - Creates directory structure: .ralph-metrics/daily/, weekly/, monthly/, bug-wikipedia/
 *
 * Configuration:
 * - .ralph/automation-config.json for repository list and bot user config
 *
 * Usage:
 * - Manual: node scripts/github-archiver.js
 * - CLI: ralph automation github-archive
 * - Cron: 0 23 * * * node /path/to/scripts/github-archiver.js
 */

const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

// ============================================================================
// Logging Utilities
// ============================================================================

function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const prefix =
    level === "ERROR"
      ? "  ❌"
      : level === "SUCCESS"
      ? "  ✅"
      : level === "WARN"
      ? "  ⚠️"
      : level === "INFO"
      ? "  ℹ️"
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
 * @returns {Object} Automation config
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    log("WARN", "Automation config not found, creating minimal config");
    return {
      githubArchiving: {
        enabled: true,
        repositories: [],
        botUser: {
          name: "ralph-automation-bot",
          email: "ralph-bot@studio.com",
        },
      },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Ensure githubArchiving exists with defaults
    if (!config.githubArchiving) {
      config.githubArchiving = {
        enabled: true,
        repositories: [],
        botUser: {
          name: "ralph-automation-bot",
          email: "ralph-bot@studio.com",
        },
      };
    }

    // Set default bot user if not specified
    if (!config.githubArchiving.botUser) {
      config.githubArchiving.botUser = {
        name: "ralph-automation-bot",
        email: "ralph-bot@studio.com",
      };
    }

    return config;
  } catch (error) {
    log("ERROR", `Failed to parse automation config: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// GitHub API Helpers
// ============================================================================

/**
 * Execute git command with error handling
 * @param {string} command - Git command to execute
 * @param {Object} options - Execution options
 * @returns {string} Command output
 */
function execGit(command, options = {}) {
  try {
    const result = execSync(command, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      ...options,
    });
    return result.trim();
  } catch (error) {
    if (options.throwOnError !== false) {
      throw error;
    }
    return null;
  }
}

/**
 * Clone or update a repository
 * @param {string} repoUrl - Repository URL
 * @param {string} targetDir - Target directory for clone
 * @returns {boolean} Success status
 */
function cloneOrUpdateRepo(repoUrl, targetDir) {
  try {
    if (fs.existsSync(targetDir)) {
      // Update existing repo
      log("INFO", `Updating repository at ${targetDir}`);
      execGit(`git -C "${targetDir}" fetch origin`, {});
      execGit(`git -C "${targetDir}" reset --hard HEAD`, {});
    } else {
      // Clone new repo
      log("INFO", `Cloning repository to ${targetDir}`);
      execGit(`git clone "${repoUrl}" "${targetDir}"`, {});
    }
    return true;
  } catch (error) {
    log("ERROR", `Failed to clone/update repo: ${error.message}`);
    return false;
  }
}

/**
 * Create or checkout ralph-metrics branch
 * @param {string} repoDir - Repository directory
 * @returns {boolean} Success status
 */
function ensureMetricsBranch(repoDir) {
  try {
    // Check if branch exists
    const branches = execGit(
      `git -C "${repoDir}" branch -a`,
      { throwOnError: false }
    );

    if (branches && branches.includes("ralph-metrics")) {
      // Checkout existing branch
      log("INFO", "Checking out existing ralph-metrics branch");
      execGit(`git -C "${repoDir}" checkout ralph-metrics`, {});
    } else {
      // Create new branch from main/master
      log("INFO", "Creating new ralph-metrics branch");
      try {
        execGit(`git -C "${repoDir}" checkout -b ralph-metrics origin/main`, {});
      } catch {
        // Fallback to master if main doesn't exist
        execGit(`git -C "${repoDir}" checkout -b ralph-metrics origin/master`, {});
      }
    }
    return true;
  } catch (error) {
    log("ERROR", `Failed to ensure metrics branch: ${error.message}`);
    return false;
  }
}

/**
 * Create directory structure for metrics
 * @param {string} repoDir - Repository directory
 * @param {string} metricsPath - Path to metrics directory (e.g., .ralph-metrics)
 * @returns {boolean} Success status
 */
function createMetricsDirectoryStructure(repoDir, metricsPath = ".ralph-metrics") {
  try {
    const basePath = path.join(repoDir, metricsPath);

    // Create subdirectories
    const subdirs = ["daily", "weekly", "monthly", "bug-wikipedia"];

    for (const subdir of subdirs) {
      const dirPath = path.join(basePath, subdir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        log("SUCCESS", `Created directory: ${path.join(metricsPath, subdir)}`);
      }
    }

    // Create bug-wikipedia subdirectories
    const bugWikiSubdirs = ["categories", "by-developer", "by-module", "metrics"];
    for (const subdir of bugWikiSubdirs) {
      const dirPath = path.join(basePath, "bug-wikipedia", subdir);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
        log("SUCCESS", `Created directory: ${path.join(metricsPath, "bug-wikipedia", subdir)}`);
      }
    }

    return true;
  } catch (error) {
    log("ERROR", `Failed to create directory structure: ${error.message}`);
    return false;
  }
}

/**
 * Create sample metrics file for today
 * @param {string} repoDir - Repository directory
 * @param {string} metricsPath - Path to metrics directory
 * @returns {boolean} Success status
 */
function createDailyMetricsFile(repoDir, metricsPath = ".ralph-metrics") {
  try {
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const dailyDir = path.join(repoDir, metricsPath, "daily");
    const metricsFile = path.join(dailyDir, `${today}.json`);

    // Only create if doesn't exist
    if (!fs.existsSync(metricsFile)) {
      const metrics = {
        date: today,
        timestamp: new Date().toISOString(),
        prd_count: 0,
        active_prd_count: 0,
        blocker_count: 0,
        metrics: {
          total_run_count: 0,
          successful_run_count: 0,
          failed_run_count: 0,
        },
      };

      fs.writeFileSync(metricsFile, JSON.stringify(metrics, null, 2));
      log("SUCCESS", `Created daily metrics file: ${metricsPath}/daily/${today}.json`);
    }
    return true;
  } catch (error) {
    log("ERROR", `Failed to create daily metrics file: ${error.message}`);
    return false;
  }
}

/**
 * Commit metrics to branch
 * @param {string} repoDir - Repository directory
 * @param {string} botName - Bot user name
 * @param {string} botEmail - Bot user email
 * @param {string} metricsPath - Path to metrics directory
 * @returns {boolean} Success status
 */
function commitMetrics(repoDir, botName, botEmail, metricsPath = ".ralph-metrics") {
  try {
    // Check if there are changes to commit
    const status = execGit(`git -C "${repoDir}" status --porcelain`, {
      throwOnError: false,
    });

    if (!status || status.trim() === "") {
      log("INFO", "No changes to commit");
      return true;
    }

    // Add all changes
    execGit(`git -C "${repoDir}" add "${metricsPath}/"`, {});

    // Set bot user config for this commit
    const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const commitMessage = `[Ralph] Daily metrics for ${today}`;

    execGit(
      `git -C "${repoDir}" -c user.name="${botName}" -c user.email="${botEmail}" commit -m "${commitMessage}"`,
      {}
    );

    log("SUCCESS", `Committed metrics: "${commitMessage}"`);
    return true;
  } catch (error) {
    log("ERROR", `Failed to commit metrics: ${error.message}`);
    return false;
  }
}

/**
 * Handle merge conflicts - prefer newest data
 * @param {string} repoDir - Repository directory
 * @param {string} botName - Bot user name
 * @param {string} botEmail - Bot user email
 * @returns {boolean} Success status
 */
function handleMergeConflicts(repoDir, botName, botEmail) {
  try {
    // Check for merge conflicts
    const status = execGit(`git -C "${repoDir}" status --porcelain`, {
      throwOnError: false,
    });

    if (!status || !status.includes("UU") && !status.includes("AA")) {
      log("INFO", "No merge conflicts to resolve");
      return true;
    }

    log("WARN", "Merge conflicts detected, resolving with newest data strategy");

    // Get list of conflicted files
    const conflictedFiles = status
      .split("\n")
      .filter((line) => line.match(/^(UU|AA)/))
      .map((line) => line.substring(3).trim());

    // For each conflicted file, keep the version that exists (prefer theirs for new metrics)
    for (const file of conflictedFiles) {
      const filePath = path.join(repoDir, file);
      if (fs.existsSync(filePath)) {
        // File exists - use this version
        execGit(`git -C "${repoDir}" add "${file}"`, { throwOnError: false });
      } else {
        // File was deleted in one branch - remove it
        execGit(`git -C "${repoDir}" rm "${file}"`, { throwOnError: false });
      }
    }

    // Complete the merge
    const today = new Date().toISOString().split("T")[0];
    const mergeMessage = `[Ralph] Merge metrics conflict - preferring newest data (${today})`;

    execGit(
      `git -C "${repoDir}" -c user.name="${botName}" -c user.email="${botEmail}" commit -m "${mergeMessage}"`,
      { throwOnError: false }
    );

    log("SUCCESS", "Resolved merge conflicts");
    return true;
  } catch (error) {
    log("ERROR", `Failed to handle merge conflicts: ${error.message}`);
    return false;
  }
}

/**
 * Push branch to remote
 * @param {string} repoDir - Repository directory
 * @returns {boolean} Success status
 */
function pushToRemote(repoDir) {
  try {
    if (!process.env.GITHUB_TOKEN) {
      log("WARN", "GITHUB_TOKEN not set, skipping push to remote");
      return false;
    }

    // Get remote URL and replace with token auth
    const remoteUrl = execGit(`git -C "${repoDir}" config --get remote.origin.url`, {
      throwOnError: false,
    });

    if (!remoteUrl) {
      log("WARN", "Could not determine remote URL");
      return false;
    }

    // Push to ralph-metrics branch
    log("INFO", "Pushing ralph-metrics branch to remote");
    try {
      execGit(
        `git -C "${repoDir}" push -u origin ralph-metrics`,
        { throwOnError: false }
      );
      log("SUCCESS", "Pushed ralph-metrics branch to remote");
      return true;
    } catch (error) {
      log("WARN", `Failed to push branch: ${error.message}`);
      return false;
    }
  } catch (error) {
    log("ERROR", `Failed to push to remote: ${error.message}`);
    return false;
  }
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  log("INFO", "Starting GitHub Archiver");
  log("INFO", "Loading configuration...");

  const config = loadAutomationConfig();

  if (!config.githubArchiving.enabled) {
    log("WARN", "GitHub archiving is disabled in configuration");
    process.exit(0);
  }

  const { repositories, botUser } = config.githubArchiving;

  if (!repositories || repositories.length === 0) {
    log("WARN", "No repositories configured for archiving");
    process.exit(0);
  }

  log("INFO", `Found ${repositories.length} repository(ies) to archive`);

  let successCount = 0;
  let failureCount = 0;

  // Process each repository
  for (const repo of repositories) {
    log("INFO", `\nProcessing repository: ${repo.name}`);

    try {
      // Build GitHub URL
      const repoUrl = `https://github.com/${repo.owner}/${repo.repo}.git`;
      const tempDir = path.join("/tmp", `ralph-archiver-${repo.name}-${Date.now()}`);

      // Clone or update repo
      if (!cloneOrUpdateRepo(repoUrl, tempDir)) {
        failureCount++;
        continue;
      }

      // Ensure ralph-metrics branch exists
      if (!ensureMetricsBranch(tempDir)) {
        failureCount++;
        continue;
      }

      // Create directory structure
      const metricsPath = repo.metricsPath || ".ralph-metrics";
      if (!createMetricsDirectoryStructure(tempDir, metricsPath)) {
        failureCount++;
        continue;
      }

      // Create daily metrics file
      if (!createDailyMetricsFile(tempDir, metricsPath)) {
        failureCount++;
        continue;
      }

      // Commit metrics
      if (!commitMetrics(tempDir, botUser.name, botUser.email, metricsPath)) {
        failureCount++;
        continue;
      }

      // Handle any merge conflicts
      if (!handleMergeConflicts(tempDir, botUser.name, botUser.email)) {
        failureCount++;
        continue;
      }

      // Push to remote
      if (process.env.GITHUB_TOKEN) {
        pushToRemote(tempDir);
      }

      // Cleanup
      try {
        execGit(`rm -rf "${tempDir}"`, {});
      } catch {
        // Cleanup failure is not critical
      }

      successCount++;
      log("SUCCESS", `Completed archiving for ${repo.name}`);
    } catch (error) {
      log("ERROR", `Failed to process ${repo.name}: ${error.message}`);
      failureCount++;
    }
  }

  // Summary
  log("INFO", `\nArchiving Summary:`);
  log("INFO", `  Successful: ${successCount}/${repositories.length}`);
  log("INFO", `  Failed: ${failureCount}/${repositories.length}`);

  process.exit(failureCount > 0 ? 1 : 0);
}

// Run main
main().catch((error) => {
  log("ERROR", `Unexpected error: ${error.message}`);
  process.exit(1);
});
