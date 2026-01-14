#!/usr/bin/env node
/**
 * Comment Build Results on GitHub Issue
 *
 * This script posts build results as a comment on the triggering GitHub issue
 * using the GitHub API.
 */

const https = require('https');
const fs = require('fs');

/**
 * Make a GitHub API request
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {Object} data - Request body (for POST/PATCH)
 * @returns {Promise<Object>} API response
 */
function githubRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      reject(new Error('GITHUB_TOKEN not set'));
      return;
    }

    const options = {
      hostname: 'api.github.com',
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ralph-action',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    };

    if (data) {
      options.headers['Content-Type'] = 'application/json';
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const response = body ? JSON.parse(body) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(response);
          } else {
            reject(new Error(`GitHub API error ${res.statusCode}: ${response.message || body}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse response: ${body}`));
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

/**
 * Format build results as markdown comment
 * @param {Object} results - Build results
 * @returns {string} Markdown formatted comment
 */
function formatResultsComment(results) {
  const statusIcon = results.success ? ':white_check_mark:' : ':x:';
  const statusText = results.success ? 'Success' : 'Failed';

  let comment = `## ${statusIcon} Ralph Build Results

| Metric | Value |
|--------|-------|
| **Status** | ${statusText} |
| **Stories Completed** | ${results.storiesCompleted || 0} |
| **Duration** | ${formatDuration(results.duration || 0)} |
| **Exit Code** | ${results.exitCode || 0} |
`;

  if (results.prdNum) {
    comment += `| **PRD** | PRD-${results.prdNum} |\n`;
  }

  if (results.prUrl) {
    comment += `\n### Pull Request\n\n:link: ${results.prUrl}\n`;
  }

  if (results.buildLog) {
    comment += `\n<details>
<summary>Build Log</summary>

\`\`\`
${results.buildLog.substring(0, 5000)}${results.buildLog.length > 5000 ? '\n... (truncated)' : ''}
\`\`\`

</details>\n`;
  }

  if (results.errors && results.errors.length > 0) {
    comment += `\n### Errors\n\n`;
    for (const error of results.errors) {
      comment += `- ${error}\n`;
    }
  }

  comment += `\n---\n*Powered by [Ralph CLI](https://github.com/AskTinNguyen/ralph-cli)*`;

  return comment;
}

/**
 * Format duration in human-readable format
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted duration
 */
function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * Post comment on GitHub issue
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} issueNumber - Issue number
 * @param {string} body - Comment body
 * @returns {Promise<Object>} Created comment
 */
async function postIssueComment(owner, repo, issueNumber, body) {
  const path = `/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
  return githubRequest('POST', path, { body });
}

/**
 * Get issue number from GitHub event
 * @returns {Object} Issue info (owner, repo, number)
 */
function getIssueFromEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error('GITHUB_EVENT_PATH not found');
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  if (!event.issue) {
    throw new Error('No issue in event payload');
  }

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY not set');
  }

  return {
    owner,
    repo,
    number: event.issue.number,
    title: event.issue.title
  };
}

/**
 * Parse build results from environment variables or arguments
 * @param {string[]} args - Command line arguments
 * @returns {Object} Build results
 */
function parseResults(args) {
  // Try to parse from JSON argument first
  if (args[0] && args[0].startsWith('{')) {
    try {
      return JSON.parse(args[0]);
    } catch (e) {
      // Fall through to environment variables
    }
  }

  // Read from environment variables (set by action outputs)
  return {
    success: process.env.BUILD_SUCCESS === 'true',
    storiesCompleted: parseInt(process.env.STORIES_COMPLETED || '0', 10),
    duration: parseInt(process.env.BUILD_DURATION || '0', 10),
    exitCode: parseInt(process.env.BUILD_EXIT_CODE || '0', 10),
    prdNum: process.env.PRD_NUM || null,
    prUrl: process.env.PR_URL || null,
    buildLog: process.env.BUILD_LOG || null
  };
}

/**
 * Main function to comment results on issue
 * @param {Object} results - Build results
 * @returns {Promise<Object>} Comment result
 */
async function commentResults(results) {
  const issueInfo = getIssueFromEvent();
  const comment = formatResultsComment(results);

  console.log(`Posting results to issue #${issueInfo.number}...`);

  const response = await postIssueComment(
    issueInfo.owner,
    issueInfo.repo,
    issueInfo.number,
    comment
  );

  console.log(`Comment posted: ${response.html_url}`);
  return {
    commentId: response.id,
    commentUrl: response.html_url,
    issueNumber: issueInfo.number
  };
}

// CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  const results = parseResults(args);

  commentResults(results)
    .then(result => {
      console.log(JSON.stringify(result));
      process.exit(0);
    })
    .catch(error => {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    });
}

// Export for use as module
module.exports = {
  githubRequest,
  formatResultsComment,
  formatDuration,
  postIssueComment,
  getIssueFromEvent,
  parseResults,
  commentResults
};
