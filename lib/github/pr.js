/**
 * Pull Request creation logic for Ralph CLI
 * Handles branch creation, push, and PR creation via gh CLI
 */

const { spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const template = require('./template');

/**
 * Get the branch name for a stream
 * @param {string} streamId - Stream ID (e.g., "PRD-1")
 * @returns {string} Branch name
 */
function getBranchName(streamId) {
  return `ralph/${streamId}`;
}

/**
 * Check if gh CLI is available
 * @returns {boolean}
 */
function isGhAvailable() {
  try {
    const result = spawnSync('gh', ['--version'], { encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if gh CLI is authenticated
 * @returns {boolean}
 */
function isGhAuthenticated() {
  try {
    const result = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Get the base branch (main or master)
 * @param {string} cwd - Working directory
 * @returns {string} Base branch name
 */
function getBaseBranch(cwd) {
  try {
    // Check if main exists
    const mainResult = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/main'], {
      cwd,
      encoding: 'utf8',
    });
    if (mainResult.status === 0) {
      return 'main';
    }

    // Check if master exists
    const masterResult = spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/master'], {
      cwd,
      encoding: 'utf8',
    });
    if (masterResult.status === 0) {
      return 'master';
    }
  } catch {
    // Fall back to main
  }
  return 'main';
}

/**
 * Check if a branch exists locally
 * @param {string} branchName - Branch name
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
function branchExistsLocally(branchName, cwd) {
  const result = spawnSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`], {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0;
}

/**
 * Check if a branch exists on remote
 * @param {string} branchName - Branch name
 * @param {string} cwd - Working directory
 * @returns {boolean}
 */
function branchExistsRemote(branchName, cwd) {
  const result = spawnSync('git', ['ls-remote', '--heads', 'origin', branchName], {
    cwd,
    encoding: 'utf8',
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

/**
 * Get the current branch name
 * @param {string} cwd - Working directory
 * @returns {string|null}
 */
function getCurrentBranch(cwd) {
  try {
    const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    if (result.status === 0) {
      return result.stdout.trim();
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Ensure branch exists and is checked out
 * @param {string} streamId - Stream ID
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, branch: string, error?: string }}
 */
function ensureBranch(streamId, cwd) {
  const branchName = getBranchName(streamId);

  // Check if we're already on this branch
  const currentBranch = getCurrentBranch(cwd);
  if (currentBranch === branchName) {
    return { success: true, branch: branchName };
  }

  // Check if branch exists locally
  if (branchExistsLocally(branchName, cwd)) {
    // Checkout existing branch
    const result = spawnSync('git', ['checkout', branchName], {
      cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return {
        success: false,
        branch: branchName,
        error: `Failed to checkout branch: ${result.stderr || result.stdout}`,
      };
    }
    return { success: true, branch: branchName };
  }

  // Create new branch from current HEAD
  const result = spawnSync('git', ['checkout', '-b', branchName], {
    cwd,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return {
      success: false,
      branch: branchName,
      error: `Failed to create branch: ${result.stderr || result.stdout}`,
    };
  }

  return { success: true, branch: branchName, created: true };
}

/**
 * Push branch to remote
 * @param {string} branchName - Branch name
 * @param {string} cwd - Working directory
 * @param {boolean} setUpstream - Whether to set upstream tracking
 * @returns {{ success: boolean, error?: string }}
 */
function pushBranch(branchName, cwd, setUpstream = true) {
  const args = ['push'];
  if (setUpstream) {
    args.push('-u', 'origin', branchName);
  } else {
    args.push('origin', branchName);
  }

  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    return {
      success: false,
      error: `Failed to push: ${result.stderr || result.stdout}`,
    };
  }

  return { success: true };
}

/**
 * Get the remote repository URL
 * @param {string} cwd - Working directory
 * @returns {{ owner: string, repo: string }|null}
 */
function getRemoteRepo(cwd) {
  try {
    const result = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd,
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      return null;
    }

    const url = result.stdout.trim();

    // Parse SSH URL: git@github.com:owner/repo.git
    const sshMatch = url.match(/git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    // Parse HTTPS URL: https://github.com/owner/repo.git
    const httpsMatch = url.match(/https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Get stream information (PRD title, completed stories)
 * @param {string} streamId - Stream ID
 * @param {string} ralphDir - .ralph directory path
 * @returns {{ title: string, overview: string, completedStories: string[] }}
 */
function getStreamInfo(streamId, ralphDir) {
  const streamDir = path.join(ralphDir, streamId);
  const prdPath = path.join(streamDir, 'prd.md');

  let title = streamId;
  let overview = '';
  const completedStories = [];

  try {
    if (fs.existsSync(prdPath)) {
      const prdContent = fs.readFileSync(prdPath, 'utf8');

      // Extract title from first heading
      const titleMatch = prdContent.match(/^#\s+(?:PRD:?\s*)?(.+)$/m);
      if (titleMatch) {
        title = titleMatch[1].trim();
      }

      // Extract overview section
      const overviewMatch = prdContent.match(/##\s+Overview\s*\n+([\s\S]*?)(?=\n##|\n$|$)/);
      if (overviewMatch) {
        overview = overviewMatch[1].trim().split('\n')[0]; // First paragraph
      }

      // Extract completed stories
      const storyMatches = prdContent.matchAll(/###\s+\[x\]\s+(US-\d+):\s*(.+)/gi);
      for (const match of storyMatches) {
        completedStories.push(`${match[1]}: ${match[2].trim()}`);
      }
    }
  } catch {
    // Ignore errors, use defaults
  }

  return { title, overview, completedStories };
}

/**
 * Generate PR body from stream info (basic version for backward compatibility)
 * @param {string} streamId - Stream ID
 * @param {{ title: string, overview: string, completedStories: string[] }} info - Stream info
 * @returns {string}
 */
function generatePRBody(streamId, info) {
  const lines = [
    '## Summary',
    '',
    `This PR was automatically generated by Ralph CLI from ${streamId}.`,
    '',
  ];

  if (info.overview) {
    lines.push(info.overview, '');
  }

  if (info.completedStories.length > 0) {
    lines.push('### Completed Stories', '');
    for (const story of info.completedStories) {
      lines.push(`- [x] ${story}`);
    }
    lines.push('');
  }

  lines.push('---', '*Generated by [Ralph CLI](https://github.com/AskTinNguyen/ralph-cli)*');

  return lines.join('\n');
}

/**
 * Generate smart PR body with PRD summary, completed stories, files changed, and test results
 * @param {string} streamId - Stream ID
 * @param {string} ralphDir - Path to .ralph directory
 * @param {string} cwd - Working directory
 * @param {string} [baseBranch='main'] - Base branch for comparison
 * @returns {string}
 */
function generateSmartPRBody(streamId, ralphDir, cwd, baseBranch = 'main') {
  const streamDir = path.join(ralphDir, streamId);
  const prdPath = path.join(streamDir, 'prd.md');
  const runsDir = path.join(streamDir, 'runs');

  return template.renderPRBody({
    streamId,
    prdPath,
    runsDir,
    cwd,
    baseBranch,
  });
}

/**
 * Create a pull request for a stream
 * @param {string} streamId - Stream ID (e.g., "PRD-1")
 * @param {Object} options - Options
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.ralphDir] - .ralph directory path
 * @param {string} [options.title] - Custom PR title
 * @param {string} [options.body] - Custom PR body
 * @param {string} [options.base] - Base branch (default: main or master)
 * @param {boolean} [options.dryRun] - Dry run mode (don't create PR)
 * @returns {{ success: boolean, url?: string, error?: string, preview?: Object }}
 */
function createPullRequest(streamId, options = {}) {
  const cwd = options.cwd || process.cwd();
  const ralphDir = options.ralphDir || path.join(cwd, '.ralph');
  const baseBranch = options.base || getBaseBranch(cwd);

  // Validate gh CLI
  if (!isGhAvailable()) {
    return {
      success: false,
      error: 'GitHub CLI (gh) is not installed. Install it from https://cli.github.com/',
    };
  }

  if (!isGhAuthenticated()) {
    return {
      success: false,
      error: 'GitHub CLI is not authenticated. Run: gh auth login',
    };
  }

  // Get stream info for PR content
  const info = getStreamInfo(streamId, ralphDir);
  const branchName = getBranchName(streamId);

  // Check if branch exists
  if (!branchExistsLocally(branchName, cwd)) {
    return {
      success: false,
      error: `Branch ${branchName} does not exist. Initialize the stream first with: ralph stream init ${streamId.replace('PRD-', '')}`,
    };
  }

  // Prepare PR details
  const prTitle = options.title || `${streamId}: ${info.title}`;
  // Use smart PR body by default (includes files changed, test results)
  const prBody = options.body || generateSmartPRBody(streamId, ralphDir, cwd, baseBranch);

  // Dry run mode
  if (options.dryRun) {
    return {
      success: true,
      preview: {
        title: prTitle,
        body: prBody,
        head: branchName,
        base: baseBranch,
        remote: getRemoteRepo(cwd),
      },
    };
  }

  // Push branch to remote
  const pushResult = pushBranch(branchName, cwd);
  if (!pushResult.success) {
    return pushResult;
  }

  // Create PR using gh CLI
  const result = spawnSync(
    'gh',
    [
      'pr',
      'create',
      '--title',
      prTitle,
      '--body',
      prBody,
      '--base',
      baseBranch,
      '--head',
      branchName,
    ],
    {
      cwd,
      encoding: 'utf8',
    }
  );

  if (result.status !== 0) {
    const error = result.stderr || result.stdout;

    // Check for common errors
    if (error.includes('already exists')) {
      // PR already exists - try to get its URL
      const listResult = spawnSync(
        'gh',
        ['pr', 'list', '--head', branchName, '--json', 'url', '--jq', '.[0].url'],
        { cwd, encoding: 'utf8' }
      );
      if (listResult.status === 0 && listResult.stdout.trim()) {
        return {
          success: true,
          url: listResult.stdout.trim(),
          existing: true,
        };
      }
    }

    return {
      success: false,
      error: `Failed to create PR: ${error}`,
    };
  }

  // Extract PR URL from output
  const url = result.stdout.trim();

  return {
    success: true,
    url,
  };
}

/**
 * Parse CODEOWNERS file and find owners for changed files
 * @param {string[]} changedFiles - Array of changed file paths
 * @param {string} cwd - Working directory
 * @returns {{ owners: string[], teams: string[] }}
 */
function getCodeOwners(changedFiles, cwd) {
  const owners = new Set();
  const teams = new Set();

  // Look for CODEOWNERS in common locations
  const codeownersPaths = [
    path.join(cwd, '.github', 'CODEOWNERS'),
    path.join(cwd, 'CODEOWNERS'),
    path.join(cwd, 'docs', 'CODEOWNERS'),
  ];

  let codeownersContent = null;
  for (const p of codeownersPaths) {
    try {
      if (fs.existsSync(p)) {
        codeownersContent = fs.readFileSync(p, 'utf8');
        break;
      }
    } catch {
      // Continue to next path
    }
  }

  if (!codeownersContent) {
    return { owners: [], teams: [] };
  }

  // Parse CODEOWNERS file
  // Format: pattern @owner1 @owner2 @org/team
  const rules = [];
  for (const line of codeownersContent.split('\n')) {
    const trimmed = line.trim();
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    // Split into pattern and owners
    const parts = trimmed.split(/\s+/);
    if (parts.length < 2) {
      continue;
    }

    const pattern = parts[0];
    const lineOwners = parts.slice(1).filter((p) => p.startsWith('@'));

    rules.push({ pattern, owners: lineOwners });
  }

  // Match changed files against rules (last matching rule wins, like git)
  for (const file of changedFiles) {
    // Find all matching rules, take the last one
    let matchedOwners = [];
    for (const rule of rules) {
      if (matchesCodeownersPattern(file, rule.pattern)) {
        matchedOwners = rule.owners;
      }
    }

    for (const owner of matchedOwners) {
      if (owner.includes('/')) {
        // Team: @org/team-name
        teams.add(owner);
      } else {
        // Individual: @username
        owners.add(owner);
      }
    }
  }

  return {
    owners: [...owners].map((o) => o.replace(/^@/, '')),
    teams: [...teams].map((t) => t.replace(/^@/, '')),
  };
}

/**
 * Match a file path against a CODEOWNERS pattern
 * Supports: *, **, ?, and directory patterns
 * @param {string} filePath - File path to match
 * @param {string} pattern - CODEOWNERS pattern
 * @returns {boolean}
 */
function matchesCodeownersPattern(filePath, pattern) {
  // Normalize paths
  const normalizedPath = filePath.replace(/^\//, '');

  // Handle exact matches
  if (pattern === normalizedPath) {
    return true;
  }

  // Track if pattern is root-relative
  const isRootRelative = pattern.startsWith('/');
  let matchPattern = isRootRelative ? pattern.slice(1) : pattern;

  // Handle directory patterns (ending with /)
  // /src/ should match src/file.js and src/dir/file.js
  if (matchPattern.endsWith('/')) {
    const dirPattern = matchPattern.slice(0, -1);
    if (normalizedPath.startsWith(dirPattern + '/') || normalizedPath === dirPattern) {
      return true;
    }
    // Also handle case without trailing slash for root-relative
    if (isRootRelative) {
      return false; // Root-relative dir pattern must match from start
    }
  }

  // Convert glob pattern to regex
  let regex = matchPattern
    // Escape special regex chars except * and ?
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // ** matches anything including /
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    // * matches anything except /
    .replace(/\*/g, '[^/]*')
    // ? matches single char except /
    .replace(/\?/g, '[^/]')
    // Restore globstar
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  // Root-relative patterns must match from the start
  // Non-root patterns can match anywhere in path
  if (isRootRelative || pattern.startsWith('**')) {
    regex = '^' + regex;
  } else {
    regex = '(?:^|/)' + regex;
  }

  // Match end of path or end of string (for directory patterns)
  regex = regex + '(?:/.*)?$';

  try {
    const re = new RegExp(regex);
    return re.test(normalizedPath);
  } catch {
    // If regex is invalid, fall back to simple match
    return normalizedPath.includes(matchPattern);
  }
}

/**
 * Get changed files for a branch compared to base
 * @param {string} branchName - Branch name
 * @param {string} baseBranch - Base branch
 * @param {string} cwd - Working directory
 * @returns {string[]}
 */
function getChangedFiles(branchName, baseBranch, cwd) {
  try {
    const result = spawnSync('git', ['diff', '--name-only', `${baseBranch}...${branchName}`], {
      cwd,
      encoding: 'utf8',
    });
    if (result.status === 0 && result.stdout) {
      return result.stdout.trim().split('\n').filter(Boolean);
    }
  } catch {
    // Ignore
  }
  return [];
}

/**
 * Assign reviewers to a pull request
 * @param {string|number} prNumber - PR number
 * @param {string[]} reviewers - List of reviewer usernames
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, error?: string }}
 */
function assignReviewers(prNumber, reviewers, cwd) {
  if (!reviewers || reviewers.length === 0) {
    return { success: true }; // Nothing to do
  }

  // Filter out any empty strings and the current user (can't review own PR)
  const validReviewers = reviewers.filter((r) => r && r.trim());
  if (validReviewers.length === 0) {
    return { success: true };
  }

  // Build args for gh pr edit --add-reviewer
  const args = ['pr', 'edit', String(prNumber), '--add-reviewer', validReviewers.join(',')];

  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    // Check for common errors
    const error = result.stderr || result.stdout || '';

    // If user can't be added (permissions, not found, etc.), warn but don't fail
    if (error.includes('Could not resolve') || error.includes('not found')) {
      return {
        success: true,
        warning: `Some reviewers could not be added: ${error}`,
      };
    }

    return {
      success: false,
      error: `Failed to assign reviewers: ${error}`,
    };
  }

  return { success: true };
}

/**
 * Assign a team as reviewer to a pull request
 * @param {string|number} prNumber - PR number
 * @param {string[]} teams - List of team slugs (org/team-name format)
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, error?: string }}
 */
function assignTeam(prNumber, teams, cwd) {
  if (!teams || teams.length === 0) {
    return { success: true }; // Nothing to do
  }

  // Teams are specified as org/team-name in CODEOWNERS
  // gh pr edit expects just team slug for same org or org/team for cross-org
  const validTeams = teams.filter((t) => t && t.trim());
  if (validTeams.length === 0) {
    return { success: true };
  }

  // Build args for gh pr edit --add-reviewer (teams work the same way)
  const args = ['pr', 'edit', String(prNumber), '--add-reviewer', validTeams.join(',')];

  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const error = result.stderr || result.stdout || '';

    // Team assignment often fails due to permissions - warn but don't fail
    if (
      error.includes('Could not resolve') ||
      error.includes('not found') ||
      error.includes('permission')
    ) {
      return {
        success: true,
        warning: `Some teams could not be added: ${error}`,
      };
    }

    return {
      success: false,
      error: `Failed to assign teams: ${error}`,
    };
  }

  return { success: true };
}

/**
 * Add labels to a pull request
 * @param {string|number} prNumber - PR number
 * @param {string[]} labels - List of labels to add
 * @param {string} cwd - Working directory
 * @returns {{ success: boolean, error?: string }}
 */
function addLabels(prNumber, labels, cwd) {
  if (!labels || labels.length === 0) {
    return { success: true }; // Nothing to do
  }

  const validLabels = labels.filter((l) => l && l.trim());
  if (validLabels.length === 0) {
    return { success: true };
  }

  // Build args for gh pr edit --add-label
  const args = ['pr', 'edit', String(prNumber), '--add-label', validLabels.join(',')];

  const result = spawnSync('gh', args, {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    const error = result.stderr || result.stdout || '';

    // Label doesn't exist - warn but don't fail
    if (error.includes('not found') || error.includes('label')) {
      return {
        success: true,
        warning: `Some labels could not be added (may not exist): ${error}`,
      };
    }

    return {
      success: false,
      error: `Failed to add labels: ${error}`,
    };
  }

  return { success: true };
}

/**
 * Get PR number from URL
 * @param {string} url - PR URL
 * @returns {string|null}
 */
function getPRNumberFromUrl(url) {
  const match = url.match(/\/pull\/(\d+)/);
  return match ? match[1] : null;
}

/**
 * Auto-assign reviewers and labels to a PR based on CODEOWNERS and stream info
 * @param {string} streamId - Stream ID
 * @param {string} prUrl - PR URL
 * @param {Object} options - Options
 * @param {string} [options.cwd] - Working directory
 * @param {string} [options.baseBranch] - Base branch
 * @param {string[]} [options.additionalLabels] - Additional labels to add
 * @returns {{ success: boolean, reviewers?: string[], teams?: string[], labels?: string[], warnings?: string[], error?: string }}
 */
function autoAssignReviewers(streamId, prUrl, options = {}) {
  const cwd = options.cwd || process.cwd();
  const baseBranch = options.baseBranch || getBaseBranch(cwd);
  const branchName = getBranchName(streamId);

  const prNumber = getPRNumberFromUrl(prUrl);
  if (!prNumber) {
    return { success: false, error: 'Could not extract PR number from URL' };
  }

  const warnings = [];

  // Get changed files and find code owners
  const changedFiles = getChangedFiles(branchName, baseBranch, cwd);
  const { owners, teams } = getCodeOwners(changedFiles, cwd);

  // Assign individual reviewers
  if (owners.length > 0) {
    const reviewResult = assignReviewers(prNumber, owners, cwd);
    if (!reviewResult.success) {
      return reviewResult;
    }
    if (reviewResult.warning) {
      warnings.push(reviewResult.warning);
    }
  }

  // Assign team reviewers
  if (teams.length > 0) {
    const teamResult = assignTeam(prNumber, teams, cwd);
    if (!teamResult.success) {
      return teamResult;
    }
    if (teamResult.warning) {
      warnings.push(teamResult.warning);
    }
  }

  // Add labels
  const labels = ['ralph-generated', streamId];
  if (options.additionalLabels) {
    labels.push(...options.additionalLabels);
  }

  const labelResult = addLabels(prNumber, labels, cwd);
  if (!labelResult.success) {
    return labelResult;
  }
  if (labelResult.warning) {
    warnings.push(labelResult.warning);
  }

  return {
    success: true,
    reviewers: owners,
    teams,
    labels,
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

module.exports = {
  createPullRequest,
  ensureBranch,
  pushBranch,
  getBranchName,
  getBaseBranch,
  getRemoteRepo,
  getStreamInfo,
  generatePRBody,
  generateSmartPRBody,
  isGhAvailable,
  isGhAuthenticated,
  // Review assignment functions (US-003)
  getCodeOwners,
  getChangedFiles,
  assignReviewers,
  assignTeam,
  addLabels,
  autoAssignReviewers,
  getPRNumberFromUrl,
  matchesCodeownersPattern,
};
