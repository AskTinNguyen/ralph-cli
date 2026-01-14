/**
 * Git Fallback - Extract story completion from git history
 *
 * Used when PRDs were implemented manually without ralph build,
 * so no run logs exist with story tracking data.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

/**
 * Check if a PRD branch exists in git history
 * @param {number} prdId - PRD number
 * @returns {boolean} True if ralph/PRD-N branch exists
 */
function prdBranchExists(prdId) {
  try {
    execSync(`git rev-parse --verify ralph/PRD-${prdId}`, {
      stdio: 'ignore',
      encoding: 'utf-8'
    });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get merge commit for a PRD if it was merged
 * @param {number} prdId - PRD number
 * @returns {string|null} Merge commit hash or null
 */
function getPrdMergeCommit(prdId) {
  try {
    const result = execSync(
      `git log --all --merges --grep="PRD-${prdId}" --format="%H" -n 1`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim();
    return result || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get all commits for a PRD branch
 * Handles both active branches and merged branches
 *
 * @param {number} prdId - PRD number
 * @returns {Object[]} Array of commit objects
 */
function getPrdCommits(prdId) {
  const commits = [];

  // First, try to get commits from merge (works for merged PRDs)
  const mergeCommit = getPrdMergeCommit(prdId);
  if (mergeCommit) {
    try {
      // Get commits from merge: first parent to second parent
      // This gets all commits that were merged in from the PRD branch
      const gitCommand = `git log ${mergeCommit}^1..${mergeCommit}^2 --format="%H|%ai|%s|%b" --reverse`;

      const output = execSync(gitCommand, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const lines = output.trim().split('\n').filter(l => l);

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 3) {
          const hash = parts[0];
          const timestamp = parts[1];
          const subject = parts[2];
          const body = parts.length > 3 ? parts.slice(3).join('|') : '';

          commits.push({
            hash: hash.trim(),
            timestamp: timestamp.trim(),
            subject: subject.trim(),
            body: body.trim()
          });
        }
      }

      if (commits.length > 0) {
        return commits;
      }
    } catch (e) {
      // Merge commit method failed, try branch method
    }
  }

  // Fallback: try to get from active branch
  if (prdBranchExists(prdId)) {
    try {
      // Get commits only on this branch, not in main
      const gitCommand = `git log main..ralph/PRD-${prdId} --format="%H|%ai|%s|%b" --reverse`;

      const output = execSync(gitCommand, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const lines = output.trim().split('\n').filter(l => l);

      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 3) {
          const hash = parts[0];
          const timestamp = parts[1];
          const subject = parts[2];
          const body = parts.length > 3 ? parts.slice(3).join('|') : '';

          commits.push({
            hash: hash.trim(),
            timestamp: timestamp.trim(),
            subject: subject.trim(),
            body: body.trim()
          });
        }
      }
    } catch (e) {
      // Branch method also failed
    }
  }

  return commits;
}

/**
 * Extract story ID from commit message
 * Looks for patterns like:
 * - "feat(trends): add success rate trends (US-001)"
 * - "US-002: Cost trends dashboard"
 * - "feat: implement US-003 velocity metrics"
 *
 * @param {string} subject - Commit subject line
 * @param {string} body - Commit body
 * @returns {string|null} Story ID (e.g., "US-001") or null
 */
function extractStoryId(subject, body = '') {
  const text = subject + ' ' + body;

  // Pattern: US-XXX or US-XXXX
  const match = text.match(/\b(US-\d{3,4})\b/i);
  if (match) {
    return match[1].toUpperCase();
  }

  return null;
}

/**
 * Parse story title from PRD file
 * @param {string} prdPath - Path to PRD directory
 * @param {string} storyId - Story ID (e.g., "US-001")
 * @returns {string} Story title or generic title
 */
function getStoryTitle(prdPath, storyId) {
  const prdFile = path.join(prdPath, 'prd.md');

  if (!fs.existsSync(prdFile)) {
    return `Story ${storyId}`;
  }

  try {
    const content = fs.readFileSync(prdFile, 'utf-8');
    const lines = content.split('\n');

    // Look for: ### [ ] US-001: Story title
    const pattern = new RegExp(`^###\\s*\\[.\\]\\s*${storyId}[:\\s]+(.+)$`, 'i');

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
  } catch (e) {
    // Ignore read errors
  }

  return `Story ${storyId}`;
}

/**
 * Get completed stories from git history for a PRD
 * Returns synthetic run objects compatible with aggregator
 *
 * @param {string} prdPath - Path to PRD-N directory
 * @returns {Object[]} Array of synthetic run objects
 */
function getCompletedStoriesFromGit(prdPath) {
  const prdId = path.basename(prdPath).replace('PRD-', '');
  const commits = getPrdCommits(prdId);

  if (commits.length === 0) {
    return [];
  }

  const storyRuns = [];
  const seenStories = new Set();

  for (const commit of commits) {
    const storyId = extractStoryId(commit.subject, commit.body);

    if (!storyId || seenStories.has(storyId)) {
      continue;
    }

    seenStories.add(storyId);

    // Create synthetic run object matching parser.js structure
    const syntheticRun = {
      runId: `git-${commit.hash.substring(0, 8)}`,
      iteration: storyRuns.length + 1,
      mode: 'build',
      story: `${storyId}: ${getStoryTitle(prdPath, storyId)}`,
      storyId: storyId,
      startedAt: commit.timestamp,
      endedAt: commit.timestamp,
      duration: null, // Unknown from git
      status: 'success',
      logPath: null,
      headBefore: null,
      headAfter: commit.hash,
      commits: [commit.hash],
      changedFiles: [],
      uncommittedChanges: [],
      inputTokens: null,
      outputTokens: null,
      tokenModel: 'unknown',
      tokenEstimated: true,
      prdId: prdId,
      source: 'git-fallback' // Mark as git-derived
    };

    storyRuns.push(syntheticRun);
  }

  return storyRuns;
}

/**
 * Check if a PRD has only plan runs (no build runs with stories)
 * @param {Object[]} runs - Parsed runs from run logs
 * @returns {boolean} True if only plan runs exist
 */
function hasOnlyPlanRuns(runs) {
  if (runs.length === 0) {
    return true;
  }

  const buildRuns = runs.filter(r => r.mode === 'build' && r.story);
  return buildRuns.length === 0;
}

/**
 * Get story completion data with git fallback
 * Primary: Use run logs if available
 * Fallback: Use git history if only plan runs or no runs
 *
 * @param {string} prdPath - Path to PRD-N directory
 * @param {Object[]} existingRuns - Runs from run logs
 * @returns {Object[]} Combined runs (existing + git fallback if needed)
 */
function getStoriesWithFallback(prdPath, existingRuns = []) {
  // If we have build runs with stories, use them
  if (!hasOnlyPlanRuns(existingRuns)) {
    return existingRuns;
  }

  // Otherwise, try git fallback
  const gitStories = getCompletedStoriesFromGit(prdPath);

  if (gitStories.length === 0) {
    // No git data either, return existing (might be plan-only or empty)
    return existingRuns;
  }

  // Combine: keep plan runs, add git stories
  const planRuns = existingRuns.filter(r => r.mode === 'plan');
  return [...planRuns, ...gitStories];
}

module.exports = {
  prdBranchExists,
  getPrdMergeCommit,
  getPrdCommits,
  extractStoryId,
  getStoryTitle,
  getCompletedStoriesFromGit,
  hasOnlyPlanRuns,
  getStoriesWithFallback
};
