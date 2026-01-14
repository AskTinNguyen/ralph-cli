#!/usr/bin/env node
/**
 * Status Check and Review Comments for PR Validation
 *
 * This script handles:
 * 1. Creating/updating GitHub status checks via Checks API
 * 2. Adding review comments for test failures on PR files
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
 * Get PR info from GitHub event
 * @returns {Object} PR info (owner, repo, number, headSha)
 */
function getPRFromEvent() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) {
    throw new Error('GITHUB_EVENT_PATH not found');
  }

  const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    throw new Error('No pull_request in event payload');
  }

  const [owner, repo] = (process.env.GITHUB_REPOSITORY || '').split('/');
  if (!owner || !repo) {
    throw new Error('GITHUB_REPOSITORY not set');
  }

  return {
    owner,
    repo,
    number: pr.number,
    headSha: pr.head.sha,
    title: pr.title,
    baseRef: pr.base.ref,
    headRef: pr.head.ref
  };
}

/**
 * Create a check run using the Checks API
 * @param {Object} params - Check run parameters
 * @returns {Promise<Object>} Created check run
 */
async function createCheckRun(params) {
  const { owner, repo, name, headSha, status, conclusion, title, summary, text } = params;

  const path = `/repos/${owner}/${repo}/check-runs`;
  const data = {
    name: name || 'Ralph PR Validation',
    head_sha: headSha,
    status: status || 'completed',
    output: {
      title: title || 'PR Validation',
      summary: summary || '',
      text: text || ''
    }
  };

  // Only include conclusion if status is completed
  if (status === 'completed' || !status) {
    data.conclusion = conclusion || 'neutral';
  }

  if (status === 'in_progress') {
    data.started_at = new Date().toISOString();
  } else {
    data.completed_at = new Date().toISOString();
  }

  return githubRequest('POST', path, data);
}

/**
 * Update an existing check run
 * @param {Object} params - Check run parameters
 * @returns {Promise<Object>} Updated check run
 */
async function updateCheckRun(params) {
  const { owner, repo, checkRunId, status, conclusion, title, summary, text } = params;

  const path = `/repos/${owner}/${repo}/check-runs/${checkRunId}`;
  const data = {
    status: status || 'completed',
    output: {
      title: title || 'PR Validation',
      summary: summary || '',
      text: text || ''
    }
  };

  if (status === 'completed') {
    data.conclusion = conclusion || 'neutral';
    data.completed_at = new Date().toISOString();
  }

  return githubRequest('PATCH', path, data);
}

/**
 * Parse test output for error locations
 * Attempts to extract file:line information from common test output formats
 * @param {string} output - Test output
 * @returns {Array<Object>} Array of {file, line, message} objects
 */
function parseTestErrors(output) {
  const errors = [];
  const lines = output.split('\n');

  // Common patterns for test failures:
  // 1. Jest/Mocha: "at Object.<anonymous> (path/file.js:line:col)"
  // 2. ESLint: "path/file.js:line:col - error message"
  // 3. TypeScript: "path/file.ts(line,col): error TS..."
  // 4. Node assertion: "AssertionError ... at path/file.js:line:col"

  const patterns = [
    // Jest/Mocha stack trace
    /at\s+(?:.*?)\s+\(([^)]+):(\d+):\d+\)/g,
    // ESLint/Standard format
    /^([^\s:]+):(\d+):\d+\s*[-:]\s*(.+)/gm,
    // TypeScript format
    /([^\s(]+)\((\d+),\d+\):\s*error\s+TS\d+:\s*(.+)/gm,
    // Generic file:line format
    /([^\s:]+\.(?:js|ts|jsx|tsx)):(\d+)/g
  ];

  for (const pattern of patterns) {
    let match;
    const regex = new RegExp(pattern.source, pattern.flags);
    while ((match = regex.exec(output)) !== null) {
      const [, file, line, message] = match;
      // Skip node_modules and internal files
      if (!file.includes('node_modules') && !file.startsWith('internal/')) {
        errors.push({
          file: file.replace(/^\.\//, ''),
          line: parseInt(line, 10),
          message: message || 'Test failure'
        });
      }
    }
  }

  // Dedupe by file+line
  const seen = new Set();
  return errors.filter(e => {
    const key = `${e.file}:${e.line}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 10); // Limit to 10 comments
}

/**
 * Get files changed in a PR
 * @param {string} owner - Repo owner
 * @param {string} repo - Repo name
 * @param {number} prNumber - PR number
 * @returns {Promise<Array>} Array of changed files
 */
async function getPRFiles(owner, repo, prNumber) {
  const path = `/repos/${owner}/${repo}/pulls/${prNumber}/files`;
  const files = await githubRequest('GET', path);
  return files.map(f => f.filename);
}

/**
 * Create a review comment on a PR
 * @param {Object} params - Comment parameters
 * @returns {Promise<Object>} Created comment
 */
async function createReviewComment(params) {
  const { owner, repo, prNumber, commitId, path, line, body } = params;

  const apiPath = `/repos/${owner}/${repo}/pulls/${prNumber}/comments`;
  const data = {
    body: body,
    commit_id: commitId,
    path: path,
    line: line,
    side: 'RIGHT'
  };

  return githubRequest('POST', apiPath, data);
}

/**
 * Create a general review (not on specific lines)
 * @param {Object} params - Review parameters
 * @returns {Promise<Object>} Created review
 */
async function createReview(params) {
  const { owner, repo, prNumber, commitId, body, event } = params;

  const path = `/repos/${owner}/${repo}/pulls/${prNumber}/reviews`;
  const data = {
    commit_id: commitId,
    body: body,
    event: event || 'COMMENT' // APPROVE, REQUEST_CHANGES, COMMENT
  };

  return githubRequest('POST', path, data);
}

/**
 * Add review comments for test failures
 * @param {Object} prInfo - PR information
 * @param {string} testOutput - Test output
 * @returns {Promise<Array>} Created comments
 */
async function addReviewComments(prInfo, testOutput) {
  const { owner, repo, number, headSha } = prInfo;

  // Parse errors from test output
  const errors = parseTestErrors(testOutput);
  if (errors.length === 0) {
    console.log('No specific file errors found in test output');
    return [];
  }

  // Get PR files to validate error locations
  const prFiles = await getPRFiles(owner, repo, number);

  // Filter errors to only files in the PR
  const relevantErrors = errors.filter(e => prFiles.includes(e.file));

  if (relevantErrors.length === 0) {
    console.log('No errors in PR files');
    // Create a general review comment instead
    await createReview({
      owner,
      repo,
      prNumber: number,
      commitId: headSha,
      body: `## Test Failures\n\nTests failed but errors were not in files changed by this PR.\n\n<details>\n<summary>Test Output</summary>\n\n\`\`\`\n${testOutput.substring(0, 5000)}\n\`\`\`\n\n</details>`,
      event: 'COMMENT'
    });
    return [];
  }

  console.log(`Adding ${relevantErrors.length} review comments`);

  const comments = [];
  for (const error of relevantErrors) {
    try {
      const comment = await createReviewComment({
        owner,
        repo,
        prNumber: number,
        commitId: headSha,
        path: error.file,
        line: error.line,
        body: `:x: **Test Failure**\n\n${error.message}`
      });
      comments.push(comment);
    } catch (e) {
      // Line might not exist in diff, skip
      console.log(`Skipping comment on ${error.file}:${error.line}: ${e.message}`);
    }
  }

  return comments;
}

/**
 * Report status check result
 * @param {Object} prInfo - PR information
 * @param {string} status - pending, success, failure
 * @param {string} summary - Summary message
 * @param {string} output - Detailed output
 * @returns {Promise<Object>} Check run result
 */
async function reportStatusCheck(prInfo, status, summary, output) {
  const { owner, repo, headSha } = prInfo;

  let conclusion;
  let checkStatus;

  switch (status) {
    case 'pending':
      checkStatus = 'in_progress';
      break;
    case 'true':
    case 'success':
      checkStatus = 'completed';
      conclusion = 'success';
      break;
    case 'false':
    case 'failure':
      checkStatus = 'completed';
      conclusion = 'failure';
      break;
    default:
      checkStatus = 'completed';
      conclusion = 'neutral';
  }

  const checkRun = await createCheckRun({
    owner,
    repo,
    name: 'Ralph PR Validation',
    headSha,
    status: checkStatus,
    conclusion,
    title: summary || 'PR Validation',
    summary: summary || '',
    text: output ? `\`\`\`\n${output.substring(0, 65000)}\n\`\`\`` : ''
  });

  console.log(`Check run created: ${checkRun.html_url}`);

  // Write check run ID to GITHUB_OUTPUT if available
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `check_run_id=${checkRun.id}\n`);
  }

  return checkRun;
}

/**
 * Main function
 */
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';

  const prInfo = getPRFromEvent();
  console.log(`PR #${prInfo.number}: ${prInfo.title}`);
  console.log(`Head SHA: ${prInfo.headSha}`);

  if (command === 'add-comments') {
    // Add review comments mode
    const testOutput = process.env.CHECK_OUTPUT || '';
    const comments = await addReviewComments(prInfo, testOutput);
    console.log(`Added ${comments.length} review comments`);
    console.log(JSON.stringify({ commentsAdded: comments.length }));
  } else {
    // Status check mode (default)
    const success = process.env.CHECK_SUCCESS || 'neutral';
    const summary = process.env.CHECK_SUMMARY || 'Ralph PR Validation';
    const output = process.env.CHECK_OUTPUT || '';

    const checkRun = await reportStatusCheck(prInfo, success, summary, output);
    console.log(JSON.stringify({
      checkRunId: checkRun.id,
      checkRunUrl: checkRun.html_url,
      status: checkRun.status,
      conclusion: checkRun.conclusion
    }));
  }
}

// CLI execution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    });
}

// Export for use as module
module.exports = {
  githubRequest,
  getPRFromEvent,
  createCheckRun,
  updateCheckRun,
  parseTestErrors,
  getPRFiles,
  createReviewComment,
  createReview,
  addReviewComments,
  reportStatusCheck
};
