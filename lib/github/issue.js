/**
 * GitHub Issue Creation Module
 *
 * Creates and manages GitHub issues for Ralph CLI error reporting.
 * Integrates with the error management system to auto-create issues
 * for critical failures.
 */
const { execSync, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const errorModule = require("../error");

/**
 * Configuration for issue creation
 */
const DEFAULT_CONFIG = {
  enabled: false, // Disabled by default, opt-in via RALPH_AUTO_ISSUES=true
  dedupHours: 24, // Deduplication window in hours
  maxLogLines: 50, // Maximum log lines to include
  baseLabels: ["ralph-error"], // Always applied labels
};

/**
 * Get configuration from environment and config file
 * @returns {object} Configuration object
 */
function getConfig() {
  const config = { ...DEFAULT_CONFIG };

  // Check environment variables
  if (process.env.RALPH_AUTO_ISSUES === "true") {
    config.enabled = true;
  }
  if (process.env.RALPH_ISSUE_DEDUP_HOURS) {
    config.dedupHours = parseInt(process.env.RALPH_ISSUE_DEDUP_HOURS, 10) || 24;
  }
  if (process.env.RALPH_ISSUE_REPO) {
    config.repo = process.env.RALPH_ISSUE_REPO;
  }

  return config;
}

/**
 * Get repository owner and name from git remote
 * @param {string} [cwd] - Working directory
 * @returns {object|null} { owner, repo } or null
 */
function getRepoInfo(cwd = process.cwd()) {
  try {
    const config = getConfig();

    // Use override if provided
    if (config.repo) {
      const [owner, repo] = config.repo.split("/");
      return { owner, repo };
    }

    // Get from git remote
    const remote = execSync("git config --get remote.origin.url", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    // Parse GitHub URL formats
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    let match = remote.match(/github\.com[/:]([\w-]+)\/([\w-]+?)(?:\.git)?$/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Check if gh CLI is available and authenticated
 * @returns {boolean}
 */
function isGhAvailable() {
  try {
    const result = spawnSync("gh", ["auth", "status"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.status === 0;
  } catch (err) {
    return false;
  }
}

/**
 * Search for existing duplicate issues
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {string} errorCode - Error code
 * @param {string} [storyId] - Story ID
 * @returns {object|null} Existing issue or null
 */
function findDuplicateIssue(owner, repo, errorCode, storyId = null) {
  const config = getConfig();

  try {
    // Build search query
    let query = `repo:${owner}/${repo} is:issue is:open "${errorCode}"`;
    if (storyId) {
      query += ` "${storyId}"`;
    }

    const result = spawnSync(
      "gh",
      ["issue", "list", "--search", query, "--json", "number,title,createdAt,url"],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    if (result.status !== 0) {
      return null;
    }

    const issues = JSON.parse(result.stdout || "[]");

    // Filter by time window
    const cutoff = Date.now() - config.dedupHours * 60 * 60 * 1000;

    for (const issue of issues) {
      const createdAt = new Date(issue.createdAt).getTime();
      if (createdAt > cutoff) {
        return issue;
      }
    }

    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Get last N lines from a log file
 * @param {string} logPath - Path to log file
 * @param {number} [lines=50] - Number of lines
 * @returns {string} Log content
 */
function getLogTail(logPath, lines = 50) {
  try {
    if (!fs.existsSync(logPath)) {
      return "(log file not found)";
    }

    const content = fs.readFileSync(logPath, "utf8");
    const allLines = content.split("\n");
    const tailLines = allLines.slice(-lines);

    return tailLines.join("\n");
  } catch (err) {
    return `(error reading log: ${err.message})`;
  }
}

/**
 * Create a GitHub issue for an error
 * @param {string} errorCode - Error code (e.g., "RALPH-401")
 * @param {object} context - Context information
 * @param {string} [context.prd] - PRD ID
 * @param {string} [context.story] - Story ID
 * @param {string} [context.agent] - Current agent
 * @param {string[]} [context.agentChain] - Agents tried
 * @param {string} [context.runId] - Run ID
 * @param {string} [context.logPath] - Path to log file
 * @param {string} [context.cwd] - Working directory
 * @returns {object} Result { success, issueUrl, duplicate, error }
 */
async function createIssue(errorCode, context = {}) {
  const config = getConfig();

  // Check if enabled
  if (!config.enabled) {
    return {
      success: false,
      error: "Auto-issue creation is disabled. Set RALPH_AUTO_ISSUES=true to enable.",
      skipped: true,
    };
  }

  // Validate error code
  if (!errorModule.isValid(errorCode)) {
    return {
      success: false,
      error: `Invalid error code: ${errorCode}`,
    };
  }

  // Check if this error should create issues
  if (!errorModule.shouldCreateIssue(errorCode)) {
    return {
      success: false,
      error: `Error ${errorCode} is not configured for auto-issue creation`,
      skipped: true,
    };
  }

  // Check gh availability
  if (!isGhAvailable()) {
    return {
      success: false,
      error: "GitHub CLI (gh) is not available or not authenticated",
    };
  }

  // Get repo info
  const cwd = context.cwd || process.cwd();
  const repoInfo = getRepoInfo(cwd);
  if (!repoInfo) {
    return {
      success: false,
      error: "Could not determine GitHub repository from git remote",
    };
  }

  const { owner, repo } = repoInfo;

  // Check for duplicate
  const duplicate = findDuplicateIssue(owner, repo, errorCode, context.story);
  if (duplicate) {
    // Add comment to existing issue instead
    await addCommentToIssue(owner, repo, duplicate.number, errorCode, context);
    return {
      success: true,
      duplicate: true,
      issueUrl: duplicate.url,
      issueNumber: duplicate.number,
      message: `Found existing issue #${duplicate.number}, added comment`,
    };
  }

  // Get log content if path provided
  let logs = null;
  if (context.logPath) {
    logs = getLogTail(context.logPath, config.maxLogLines);
  }

  // Format issue body
  const body = errorModule.formatForIssue(errorCode, {
    ...context,
    logs,
  });

  // Get labels
  const labels = [...config.baseLabels, ...errorModule.getLabels(errorCode)];

  // Get error definition for title
  const errorDef = errorModule.lookup(errorCode);
  const title = `[${errorCode}] ${errorDef?.message || "Error"}`;

  // Create issue via gh CLI
  try {
    const labelArgs = labels.flatMap((l) => ["--label", l]);
    const result = spawnSync(
      "gh",
      ["issue", "create", "--repo", `${owner}/${repo}`, "--title", title, "--body", body, ...labelArgs],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        cwd,
      }
    );

    if (result.status !== 0) {
      return {
        success: false,
        error: result.stderr || "Failed to create issue",
      };
    }

    // Parse issue URL from output
    const issueUrl = result.stdout.trim();
    const issueMatch = issueUrl.match(/\/issues\/(\d+)/);
    const issueNumber = issueMatch ? parseInt(issueMatch[1], 10) : null;

    return {
      success: true,
      issueUrl,
      issueNumber,
      message: `Created issue #${issueNumber}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Add a comment to an existing issue
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {number} issueNumber - Issue number
 * @param {string} errorCode - Error code
 * @param {object} context - Context information
 * @returns {object} Result
 */
async function addCommentToIssue(owner, repo, issueNumber, errorCode, context = {}) {
  try {
    const comment = [
      `## Duplicate occurrence of ${errorCode}`,
      "",
      `- **Time:** ${new Date().toISOString()}`,
      context.prd ? `- **PRD:** ${context.prd}` : null,
      context.story ? `- **Story:** ${context.story}` : null,
      context.agent ? `- **Agent:** ${context.agent}` : null,
      "",
      "This error occurred again during a Ralph build.",
    ]
      .filter(Boolean)
      .join("\n");

    const result = spawnSync(
      "gh",
      ["issue", "comment", String(issueNumber), "--repo", `${owner}/${repo}`, "--body", comment],
      {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }
    );

    return {
      success: result.status === 0,
      error: result.status !== 0 ? result.stderr : null,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
    };
  }
}

/**
 * Check if auto-issue creation is enabled
 * @returns {boolean}
 */
function isEnabled() {
  return getConfig().enabled;
}

/**
 * Get issue creation status/config
 * @returns {object} Status object
 */
function getStatus() {
  const config = getConfig();
  const ghAvailable = isGhAvailable();
  const repoInfo = getRepoInfo();

  return {
    enabled: config.enabled,
    ghAvailable,
    repo: repoInfo ? `${repoInfo.owner}/${repoInfo.repo}` : null,
    dedupHours: config.dedupHours,
    canCreateIssues: config.enabled && ghAvailable && repoInfo !== null,
  };
}

module.exports = {
  createIssue,
  findDuplicateIssue,
  addCommentToIssue,
  getRepoInfo,
  isGhAvailable,
  isEnabled,
  getStatus,
  getConfig,
  getLogTail,
};
