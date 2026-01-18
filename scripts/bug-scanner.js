#!/usr/bin/env node

/**
 * Bug Scanner - Scan Git History for Bug-Related Commits
 *
 * Part of PRD-112 US-009: Scan git history for bug-related commits
 *
 * Features:
 * - Scans git history for bug-related keywords: fix, bug, issue, hotfix, patch
 * - Extracts commit data: message, author, date, files changed, diff
 * - Identifies related PRs/issues via commit message references (#123, PRD-45)
 * - Stores raw bug data in .ralph/bug-wikipedia/raw/bug-{sha}.json
 * - Links to original commit: git SHA, GitHub URL
 * - Runs daily to catch new bug fixes
 *
 * Configuration:
 * - .ralph/automation-config.json for bugWikipedia settings
 * - GitHub token for generating commit URLs (optional)
 *
 * Usage:
 * - Manual: node scripts/bug-scanner.js
 * - CLI: ralph automation scan-bugs
 * - Cron: 0 8 * * * node /path/to/scripts/bug-scanner.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// ============================================================================
// Configuration Constants
// ============================================================================

// Bug-related keywords to search for
const BUG_KEYWORDS = ["fix", "bug", "issue", "hotfix", "patch"];

// Issue reference patterns: #123, PRD-45, JIRA-123
const ISSUE_PATTERN = /#(\d+)|([A-Z]+-\d+)/gi;

// Default GitHub base URL (can be overridden for GitHub Enterprise)
const DEFAULT_GITHUB_BASE = "https://github.com";

// Bug Wikipedia directory
const BUG_WIKIPEDIA_DIR = ".ralph/bug-wikipedia";
const RAW_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "raw");
const PROCESSED_BUGS_FILE = path.join(BUG_WIKIPEDIA_DIR, ".processed-commits");

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
      : "  ℹ️";

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
      bugWikipedia: {
        enabled: true,
      },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Ensure bugWikipedia exists with defaults
    if (!config.bugWikipedia) {
      config.bugWikipedia = {
        enabled: true,
      };
    }

    return config;
  } catch (error) {
    log("ERROR", `Failed to parse automation config: ${error.message}`);
    process.exit(1);
  }
}

// ============================================================================
// Bug Scanning & Extraction
// ============================================================================

/**
 * Get list of already processed commits
 * @returns {Set<string>} Set of commit SHAs already processed
 */
function getProcessedCommits() {
  const filePath = path.join(process.cwd(), PROCESSED_BUGS_FILE);

  if (!fs.existsSync(filePath)) {
    return new Set();
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8").trim();
    if (!content) return new Set();
    return new Set(content.split("\n").filter((line) => line.trim()));
  } catch (error) {
    log("WARN", `Failed to read processed commits file: ${error.message}`);
    return new Set();
  }
}

/**
 * Save processed commit SHA
 * @param {string} sha - Commit SHA to mark as processed
 */
function markCommitAsProcessed(sha) {
  const dirPath = path.join(process.cwd(), BUG_WIKIPEDIA_DIR);
  const filePath = path.join(dirPath, ".processed-commits");

  // Create directory if needed
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  try {
    fs.appendFileSync(filePath, sha + "\n");
  } catch (error) {
    log("ERROR", `Failed to mark commit as processed: ${error.message}`);
  }
}

/**
 * Scan git history for bug-related commits
 * @returns {Array<Object>} Array of bug commit objects
 */
function scanGitHistory() {
  try {
    // Get all commits and filter client-side for bug keywords
    // This avoids shell escaping issues with multiple grep patterns
    const output = execSync(
      "git log --format='%H%n%an%n%ae%n%ai%n%s%n%b%n---END---' --all",
      {
        cwd: process.cwd(),
        encoding: "utf-8",
      }
    );

    const allCommits = parseGitLogOutput(output);

    // Filter for bug-related keywords
    const bugCommits = allCommits.filter((commit) => {
      const text = (commit.message + " " + commit.body).toLowerCase();
      return BUG_KEYWORDS.some((keyword) => text.includes(keyword));
    });

    log("SUCCESS", `Found ${bugCommits.length} bug-related commits`);
    return bugCommits;
  } catch (error) {
    log("WARN", `Git log search failed: ${error.message}`);
    return [];
  }
}

/**
 * Parse git log output into commit objects
 * @param {string} output - Raw git log output
 * @returns {Array<Object>} Array of parsed commits
 */
function parseGitLogOutput(output) {
  const commits = [];
  const commitBlocks = output.split("---END---").filter((block) => block.trim());

  for (const block of commitBlocks) {
    const lines = block.trim().split("\n");
    if (lines.length < 4) continue;

    const commit = {
      sha: lines[0].trim(),
      author_name: lines[1].trim(),
      author_email: lines[2].trim(),
      date: lines[3].trim(),
      message: lines[4].trim(),
      body: lines.slice(5).join("\n").trim(),
    };

    if (commit.sha) {
      commits.push(commit);
    }
  }

  return commits;
}

/**
 * Extract files changed in a commit
 * @param {string} sha - Commit SHA
 * @returns {Array<string>} Array of file paths
 */
function getFilesChanged(sha) {
  try {
    const output = execSync(`git show --name-only --format='' ${sha}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
    });

    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch (error) {
    log("WARN", `Failed to get files for ${sha}: ${error.message}`);
    return [];
  }
}

/**
 * Extract diff for a commit
 * @param {string} sha - Commit SHA
 * @returns {string} Diff output (limited to first 2000 chars)
 */
function getDiff(sha) {
  try {
    const output = execSync(`git show --no-patch --format= --unified=1 ${sha}`, {
      cwd: process.cwd(),
      encoding: "utf-8",
      maxBuffer: 10 * 1024 * 1024, // 10 MB buffer
    });

    // Limit diff to 2000 characters to keep JSON files manageable
    return output.substring(0, 2000);
  } catch (error) {
    log("WARN", `Failed to get diff for ${sha}: ${error.message}`);
    return "";
  }
}

/**
 * Extract related issue references from commit message/body
 * @param {string} message - Commit message
 * @param {string} body - Commit body
 * @returns {Array<string>} Array of issue references
 */
function extractRelatedIssues(message, body) {
  const fullText = `${message}\n${body}`;
  const issues = new Set();

  let match;
  while ((match = ISSUE_PATTERN.exec(fullText)) !== null) {
    if (match[1]) {
      // #123 format
      issues.add(`#${match[1]}`);
    } else if (match[2]) {
      // PRD-45 format
      issues.add(match[2]);
    }
  }

  return Array.from(issues);
}

/**
 * Get GitHub repository info from git remote
 * @returns {Object|null} { owner, repo, baseUrl } or null if not a GitHub repo
 */
function getGitHubRepoInfo() {
  try {
    const remoteUrl = execSync("git config --get remote.origin.url", {
      cwd: process.cwd(),
      encoding: "utf-8",
    }).trim();

    // Parse GitHub URLs: https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const httpsMatch = remoteUrl.match(
      /https:\/\/([^/]+)\/([^/]+)\/(.+?)(?:\.git)?$/
    );
    const sshMatch = remoteUrl.match(/git@([^:]+):([^/]+)\/(.+?)(?:\.git)?$/);

    let host, owner, repo;

    if (httpsMatch) {
      [, host, owner, repo] = httpsMatch;
    } else if (sshMatch) {
      [, host, owner, repo] = sshMatch;
    } else {
      return null;
    }

    const baseUrl = `https://${host}`;
    return { owner, repo, baseUrl };
  } catch (error) {
    log("WARN", "Could not determine GitHub repo info");
    return null;
  }
}

/**
 * Generate GitHub commit URL
 * @param {string} sha - Commit SHA
 * @returns {string|null} GitHub commit URL or null
 */
function getGitHubCommitUrl(sha) {
  const repoInfo = getGitHubRepoInfo();
  if (!repoInfo) return null;

  return `${repoInfo.baseUrl}/${repoInfo.owner}/${repoInfo.repo}/commit/${sha}`;
}

// ============================================================================
// Bug Data Storage
// ============================================================================

/**
 * Create bug Wikipedia directory structure
 */
function createBugWikipediaDirectories() {
  const dirPath = path.join(process.cwd(), BUG_WIKIPEDIA_DIR);
  const subdirs = [
    RAW_BUGS_DIR,
    path.join(BUG_WIKIPEDIA_DIR, "categorized"),
    path.join(BUG_WIKIPEDIA_DIR, "categories"),
    path.join(BUG_WIKIPEDIA_DIR, "by-developer"),
    path.join(BUG_WIKIPEDIA_DIR, "by-module"),
    path.join(BUG_WIKIPEDIA_DIR, "patterns"),
    path.join(BUG_WIKIPEDIA_DIR, "metrics"),
  ];

  for (const dir of subdirs) {
    const fullPath = path.join(process.cwd(), dir);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
  }
}

/**
 * Create short ID from SHA (first 8 characters)
 * @param {string} sha - Full commit SHA
 * @returns {string} Short bug ID (e.g., "bug-abc123de")
 */
function createBugId(sha) {
  return `bug-${sha.substring(0, 8)}`;
}

/**
 * Save bug data to .ralph/bug-wikipedia/raw/bug-{sha}.json
 * @param {Object} bugData - Bug data object
 */
function saveBugData(bugData) {
  const bugId = createBugId(bugData.commit_sha);
  const fileName = `${bugId}.json`;
  const filePath = path.join(process.cwd(), RAW_BUGS_DIR, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(bugData, null, 2));
    log("SUCCESS", `Saved bug data: ${bugId}`);
  } catch (error) {
    log("ERROR", `Failed to save bug data: ${error.message}`);
  }
}

/**
 * Create bug data object from commit
 * @param {Object} commit - Commit object from git log
 * @returns {Object} Bug data following schema from PRD
 */
function createBugData(commit) {
  const filesChanged = getFilesChanged(commit.sha);
  const diff = getDiff(commit.sha);
  const relatedIssues = extractRelatedIssues(commit.message, commit.body);
  const githubUrl = getGitHubCommitUrl(commit.sha);

  // Extract error message from body if available (simple heuristic)
  let errorMessage = "";
  if (commit.body.includes("Error:")) {
    const errorMatch = commit.body.match(/Error:\s*(.+?)(?:\n|$)/i);
    if (errorMatch) {
      errorMessage = errorMatch[1].trim();
    }
  }

  const bugId = createBugId(commit.sha);

  return {
    id: bugId,
    commit_sha: commit.sha,
    commit_message: commit.message,
    author: {
      name: commit.author_name,
      email: commit.author_email,
    },
    date_fixed: new Date(commit.date).toISOString(),
    files_changed: filesChanged,
    diff: diff,
    related_issues: relatedIssues,
    github_url: githubUrl,
    error_message: errorMessage,
    scanned_at: new Date().toISOString(),
  };
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  try {
    log("ℹ️", "Starting bug scanner...");

    // Load configuration
    const config = loadAutomationConfig();

    if (!config.bugWikipedia.enabled) {
      log("ℹ️", "Bug Wikipedia disabled in automation config, exiting");
      process.exit(0);
    }

    // Create directory structure
    createBugWikipediaDirectories();

    // Get list of already processed commits
    const processedCommits = getProcessedCommits();
    log("ℹ️", `Previously processed: ${processedCommits.size} commits`);

    // Scan git history for bug-related commits
    const commits = scanGitHistory();

    if (commits.length === 0) {
      log("ℹ️", "No new bug-related commits found");
      process.exit(0);
    }

    // Process new commits
    let newBugsCount = 0;
    for (const commit of commits) {
      if (processedCommits.has(commit.sha)) {
        continue;
      }

      // Create bug data
      const bugData = createBugData(commit);
      saveBugData(bugData);
      markCommitAsProcessed(commit.sha);
      newBugsCount++;
    }

    log("SUCCESS", `Processed ${newBugsCount} new bugs`);
    log("ℹ️", "Bug scanner completed successfully");
  } catch (error) {
    log("ERROR", `Bug scanner failed: ${error.message}`);
    process.exit(1);
  }
}

// Run main function
main();
