/**
 * Handoff Context Extractor
 *
 * Extracts current state from various sources to create a comprehensive
 * handoff context. Gathers information from:
 * - Checkpoint files
 * - Progress logs
 * - Plan files
 * - Git state
 * - Event logs
 * - Cost tracking
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Extract current context from a PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {Object} options - Extraction options
 * @returns {Object} Extracted context
 */
function extractContext(prdFolder, options = {}) {
  const context = {
    prd_id: extractPrdId(prdFolder),
    git_sha: null,
    iteration: null,
    story_id: null,
    completed_stories: [],
    remaining_stories: [],
    current_story: null,
    phase: "unknown",
    agent: options.agent || "claude",
    model: options.model || null,
    events: [],
    learnings: [],
    critical_files: [],
    blockers: [],
    summary: "",
  };

  // Extract from checkpoint if exists
  const checkpointData = extractFromCheckpoint(prdFolder);
  if (checkpointData) {
    Object.assign(context, checkpointData);
  }

  // Extract from progress.md
  const progressData = extractFromProgress(prdFolder);
  if (progressData) {
    context.completed_stories = progressData.completed_stories;
    context.events = progressData.events;
    context.learnings = [...context.learnings, ...progressData.learnings];
  }

  // Extract from plan.md
  const planData = extractFromPlan(prdFolder);
  if (planData) {
    context.remaining_stories = planData.remaining_stories;
    context.critical_files = planData.critical_files;
  }

  // Get current git state
  context.git_sha = getGitSha();

  // Extract from events log
  const eventsData = extractFromEvents(prdFolder);
  if (eventsData) {
    context.blockers = eventsData.blockers;
    context.events = [...context.events, ...eventsData.recentEvents];
  }

  // Extract from status file
  const statusData = extractFromStatus(prdFolder);
  if (statusData) {
    context.phase = statusData.phase;
    context.current_story = statusData.story_id || context.current_story;
  }

  // Generate summary
  context.summary = generateSummary(context);

  return context;
}

/**
 * Extract PRD ID from folder path
 * @param {string} prdFolder - Path to PRD folder
 * @returns {number|null} PRD ID
 */
function extractPrdId(prdFolder) {
  const match = prdFolder.match(/PRD-(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extract context from checkpoint.json
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object|null} Checkpoint data
 */
function extractFromCheckpoint(prdFolder) {
  const checkpointPath = path.join(prdFolder, "checkpoint.json");
  if (!fs.existsSync(checkpointPath)) {
    return null;
  }

  try {
    const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, "utf8"));
    return {
      iteration: checkpoint.iteration,
      story_id: checkpoint.story_id,
      git_sha: checkpoint.git_sha,
      completed_stories: checkpoint.loop_state?.stories_completed || [],
      current_story: checkpoint.loop_state?.current_story || checkpoint.story_id,
      agent: checkpoint.loop_state?.agent,
    };
  } catch {
    return null;
  }
}

/**
 * Extract context from progress.md
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object|null} Progress data
 */
function extractFromProgress(prdFolder) {
  const progressPath = path.join(prdFolder, "progress.md");
  if (!fs.existsSync(progressPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(progressPath, "utf8");
    const completed_stories = [];
    const events = [];
    const learnings = [];

    // Extract completed stories (look for commit lines)
    const commitMatches = content.matchAll(/- Commit: ([a-f0-9]+) (.+?) \((US-\d+)\)/g);
    for (const match of commitMatches) {
      completed_stories.push({
        id: match[3],
        commit: match[1],
        message: match[2],
      });
    }

    // Extract story completions from headers
    const storyMatches = content.matchAll(/## \[[\d-: ]+\] - (US-\d+): (.+)/g);
    for (const match of storyMatches) {
      if (!completed_stories.find((s) => s.id === match[1])) {
        completed_stories.push({
          id: match[1],
          title: match[2],
        });
      }
    }

    // Extract learnings
    const learningMatches = content.matchAll(/- Learnings[^:]*: (.+)/gi);
    for (const match of learningMatches) {
      learnings.push({
        type: "progress",
        content: match[1].trim(),
      });
    }

    // Extract recent events (run logs)
    const runMatches = content.matchAll(/Run: (\d{8}-\d{6}-\d+) \(iteration (\d+)\)/g);
    for (const match of runMatches) {
      events.push({
        type: "run",
        run_id: match[1],
        iteration: parseInt(match[2], 10),
      });
    }

    return {
      completed_stories,
      events,
      learnings,
    };
  } catch {
    return null;
  }
}

/**
 * Extract context from plan.md
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object|null} Plan data
 */
function extractFromPlan(prdFolder) {
  const planPath = path.join(prdFolder, "plan.md");
  if (!fs.existsSync(planPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(planPath, "utf8");
    const remaining_stories = [];
    const critical_files = [];

    // Extract uncompleted stories ([ ] not [x])
    const storyMatches = content.matchAll(/### \[ \] (US-\d+): (.+)/g);
    for (const match of storyMatches) {
      remaining_stories.push({
        id: match[1],
        title: match[2].trim(),
      });
    }

    // Extract file references from plan
    const fileMatches = content.matchAll(/`([^`]+\.[a-z]+)`/gi);
    const seenFiles = new Set();
    for (const match of fileMatches) {
      const file = match[1];
      // Filter to likely source files
      if (
        (file.endsWith(".js") ||
          file.endsWith(".ts") ||
          file.endsWith(".jsx") ||
          file.endsWith(".tsx") ||
          file.endsWith(".py") ||
          file.endsWith(".sh") ||
          file.endsWith(".md")) &&
        !seenFiles.has(file)
      ) {
        seenFiles.add(file);
        critical_files.push(file);
      }
    }

    return {
      remaining_stories,
      critical_files: critical_files.slice(0, 20), // Limit to 20 files
    };
  } catch {
    return null;
  }
}

/**
 * Extract context from .events.log
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object|null} Events data
 */
function extractFromEvents(prdFolder) {
  const eventsPath = path.join(prdFolder, ".events.log");
  if (!fs.existsSync(eventsPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(eventsPath, "utf8");
    const lines = content.trim().split("\n").slice(-50); // Last 50 lines
    const blockers = [];
    const recentEvents = [];

    for (const line of lines) {
      // Parse event line format: [timestamp] LEVEL message | details
      const match = line.match(/^\[([^\]]+)\] (\w+) (.+?)(?:\s*\|(.+))?$/);
      if (!match) continue;

      const [, timestamp, level, message, details] = match;
      const event = {
        timestamp,
        level,
        message,
        details: details?.trim(),
      };

      recentEvents.push(event);

      // Identify blockers from ERROR events
      if (level === "ERROR") {
        blockers.push({
          type: "error",
          message,
          timestamp,
          details: details?.trim(),
        });
      }
    }

    return {
      blockers: blockers.slice(-5), // Last 5 errors as potential blockers
      recentEvents: recentEvents.slice(-20), // Last 20 events
    };
  } catch {
    return null;
  }
}

/**
 * Extract context from .status.json
 * @param {string} prdFolder - Path to PRD folder
 * @returns {Object|null} Status data
 */
function extractFromStatus(prdFolder) {
  const statusPath = path.join(prdFolder, ".status.json");
  if (!fs.existsSync(statusPath)) {
    return null;
  }

  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    return {
      phase: status.phase,
      story_id: status.story_id,
      story_title: status.story_title,
      iteration: status.iteration,
      elapsed_seconds: status.elapsed_seconds,
    };
  } catch {
    return null;
  }
}

/**
 * Get current git SHA
 * @returns {string|null} Git SHA
 */
function getGitSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Get git diff summary
 * @returns {Object} Diff summary
 */
function getGitDiffSummary() {
  try {
    const staged = execSync("git diff --cached --stat", { encoding: "utf8" }).trim();
    const unstaged = execSync("git diff --stat", { encoding: "utf8" }).trim();
    const untracked = execSync("git ls-files --others --exclude-standard", { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean);

    return {
      staged: staged || null,
      unstaged: unstaged || null,
      untracked,
    };
  } catch {
    return { staged: null, unstaged: null, untracked: [] };
  }
}

/**
 * Get recent git commits
 * @param {number} count - Number of commits to retrieve
 * @returns {Array} Recent commits
 */
function getRecentCommits(count = 5) {
  try {
    const output = execSync(`git log --oneline -${count}`, { encoding: "utf8" });
    return output
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, ...messageParts] = line.split(" ");
        return {
          sha: sha,
          message: messageParts.join(" "),
        };
      });
  } catch {
    return [];
  }
}

/**
 * Generate a summary from extracted context
 * @param {Object} context - Extracted context
 * @returns {string} Human-readable summary
 */
function generateSummary(context) {
  const parts = [];

  if (context.prd_id) {
    parts.push(`Working on PRD-${context.prd_id}`);
  }

  if (context.iteration) {
    parts.push(`at iteration ${context.iteration}`);
  }

  if (context.completed_stories.length > 0) {
    parts.push(`${context.completed_stories.length} stories completed`);
  }

  if (context.remaining_stories.length > 0) {
    parts.push(`${context.remaining_stories.length} stories remaining`);
  }

  if (context.current_story) {
    parts.push(`currently on ${context.current_story}`);
  }

  if (context.blockers.length > 0) {
    parts.push(`${context.blockers.length} blockers identified`);
  }

  return parts.join(", ") || "No context available";
}

/**
 * Extract modified files since a given commit
 * @param {string} sinceCommit - Commit SHA to compare from
 * @returns {Array} List of modified files
 */
function getModifiedFilesSince(sinceCommit) {
  if (!sinceCommit) return [];

  try {
    const output = execSync(`git diff --name-only ${sinceCommit}..HEAD`, {
      encoding: "utf8",
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Create a handoff-ready context object
 * @param {string} prdFolder - Path to PRD folder
 * @param {Object} options - Options
 * @returns {Object} Handoff-ready context
 */
function createHandoffContext(prdFolder, options = {}) {
  const context = extractContext(prdFolder, options);

  // Get git diff for uncommitted changes
  const gitDiff = getGitDiffSummary();

  // Get recent commits
  const recentCommits = getRecentCommits(5);

  return {
    ...context,
    git_diff: gitDiff,
    recent_commits: recentCommits,
    extracted_at: new Date().toISOString(),
  };
}

module.exports = {
  extractContext,
  extractPrdId,
  extractFromCheckpoint,
  extractFromProgress,
  extractFromPlan,
  extractFromEvents,
  extractFromStatus,
  getGitSha,
  getGitDiffSummary,
  getRecentCommits,
  generateSummary,
  getModifiedFilesSince,
  createHandoffContext,
};
