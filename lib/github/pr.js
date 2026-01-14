/**
 * Pull Request creation logic for Ralph CLI
 * Handles branch creation, push, and PR creation via gh CLI
 */

const { spawnSync, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

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
 * Generate PR body from stream info
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
  const prBody = options.body || generatePRBody(streamId, info);

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

module.exports = {
  createPullRequest,
  ensureBranch,
  pushBranch,
  getBranchName,
  getBaseBranch,
  getRemoteRepo,
  getStreamInfo,
  generatePRBody,
  isGhAvailable,
  isGhAuthenticated,
};
