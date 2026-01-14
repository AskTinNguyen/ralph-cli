/**
 * PR Template rendering for Ralph CLI
 * Generates smart PR descriptions with PRD summary, completed stories, files changed, and test results
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * Extract PRD summary (Overview section) from PRD file
 * @param {string} prdPath - Path to prd.md file
 * @returns {string} Overview text or empty string if not found
 */
function extractPRDSummary(prdPath) {
  try {
    if (!fs.existsSync(prdPath)) {
      return '';
    }

    const content = fs.readFileSync(prdPath, 'utf8');

    // Extract Overview section content
    const overviewMatch = content.match(/##\s+Overview\s*\n+([\s\S]*?)(?=\n##|\n$|$)/i);
    if (overviewMatch && overviewMatch[1]) {
      // Get the overview content, trim it, and take meaningful lines
      const overview = overviewMatch[1]
        .trim()
        .split('\n')
        .filter((line) => line.trim() && !line.startsWith('<!--'))
        .join('\n')
        .trim();
      return overview;
    }
  } catch {
    // Ignore errors
  }
  return '';
}

/**
 * Extract and format completed stories from PRD file
 * @param {string} prdPath - Path to prd.md file
 * @returns {{ stories: Array<{id: string, title: string}>, formatted: string }}
 */
function formatCompletedStories(prdPath) {
  const stories = [];
  let formatted = '';

  try {
    if (!fs.existsSync(prdPath)) {
      return { stories, formatted };
    }

    const content = fs.readFileSync(prdPath, 'utf8');

    // Match completed stories: ### [x] US-001: Story title
    const storyMatches = content.matchAll(/###\s+\[x\]\s+(US-\d+):\s*(.+)/gi);
    for (const match of storyMatches) {
      stories.push({
        id: match[1],
        title: match[2].trim(),
      });
    }

    if (stories.length > 0) {
      formatted = stories.map((s) => `- [x] ${s.id}: ${s.title}`).join('\n');
    }
  } catch {
    // Ignore errors
  }

  return { stories, formatted };
}

/**
 * Get key files changed using git diff
 * @param {string} cwd - Working directory
 * @param {string} [baseBranch='main'] - Base branch to compare against
 * @param {number} [maxFiles=10] - Maximum number of files to return
 * @returns {{ files: Array<{path: string, insertions: number, deletions: number}>, summary: string, formatted: string }}
 */
function getKeyFiles(cwd, baseBranch = 'main', maxFiles = 10) {
  const files = [];
  let summary = '';
  let formatted = '';

  try {
    // Get the current branch
    const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    const currentBranch = branchResult.status === 0 ? branchResult.stdout.trim() : '';

    // Find merge base with base branch to get accurate diff
    let compareRef = baseBranch;
    const mergeBaseResult = spawnSync('git', ['merge-base', baseBranch, currentBranch || 'HEAD'], {
      cwd,
      encoding: 'utf8',
    });
    if (mergeBaseResult.status === 0) {
      compareRef = mergeBaseResult.stdout.trim();
    }

    // Get file stats with numstat
    const result = spawnSync('git', ['diff', '--numstat', compareRef], {
      cwd,
      encoding: 'utf8',
    });

    if (result.status === 0 && result.stdout.trim()) {
      const lines = result.stdout.trim().split('\n');
      let totalInsertions = 0;
      let totalDeletions = 0;

      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 3) {
          const insertions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
          const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
          const filePath = parts[2];

          // Skip binary files (shown as - -)
          if (parts[0] !== '-' || parts[1] !== '-') {
            files.push({
              path: filePath,
              insertions,
              deletions,
            });
            totalInsertions += insertions;
            totalDeletions += deletions;
          }
        }
      }

      // Sort by total changes (insertions + deletions) descending
      files.sort((a, b) => b.insertions + b.deletions - (a.insertions + a.deletions));

      // Generate summary
      summary = `${files.length} files changed, +${totalInsertions}/-${totalDeletions}`;

      // Format key files (top N by changes)
      const keyFiles = files.slice(0, maxFiles);
      if (keyFiles.length > 0) {
        formatted = keyFiles
          .map((f) => {
            const changes = f.insertions + f.deletions;
            const changeStr = `+${f.insertions}/-${f.deletions}`;
            return `- \`${f.path}\` (${changeStr})`;
          })
          .join('\n');

        if (files.length > maxFiles) {
          formatted += `\n- *...and ${files.length - maxFiles} more files*`;
        }
      }
    }
  } catch {
    // Ignore errors
  }

  return { files, summary, formatted };
}

/**
 * Parse test results from run logs
 * @param {string} runsDir - Path to runs directory
 * @returns {{ unit: string, integration: string, lint: string, summary: string }}
 */
function formatTestResults(runsDir) {
  const results = {
    unit: 'N/A',
    integration: 'N/A',
    lint: 'N/A',
    summary: '',
  };

  try {
    if (!fs.existsSync(runsDir)) {
      return results;
    }

    // Get the most recent run log
    const runFiles = fs
      .readdirSync(runsDir)
      .filter((f) => f.endsWith('.log') || f.endsWith('.md'))
      .sort()
      .reverse();

    if (runFiles.length === 0) {
      return results;
    }

    // Read recent run logs to find test results
    const logContent = [];
    for (const file of runFiles.slice(0, 5)) {
      try {
        const content = fs.readFileSync(path.join(runsDir, file), 'utf8');
        logContent.push(content);
      } catch {
        // Skip unreadable files
      }
    }

    const combinedLogs = logContent.join('\n');

    // Look for test patterns
    // npm test / jest / mocha patterns
    const testPassMatch = combinedLogs.match(/(\d+)\s*(?:tests?\s*)?pass(?:ed|ing)?/i);
    const testFailMatch = combinedLogs.match(/(\d+)\s*(?:tests?\s*)?fail(?:ed|ing)?/i);

    if (testPassMatch || testFailMatch) {
      const passed = testPassMatch ? parseInt(testPassMatch[1], 10) : 0;
      const failed = testFailMatch ? parseInt(testFailMatch[1], 10) : 0;
      results.unit = failed > 0 ? `${passed} passed, ${failed} failed` : `${passed} passed`;
    }

    // Look for lint patterns
    const lintErrorMatch = combinedLogs.match(/(\d+)\s*(?:lint\s*)?errors?/i);
    const lintWarnMatch = combinedLogs.match(/(\d+)\s*(?:lint\s*)?warnings?/i);

    if (lintErrorMatch || lintWarnMatch) {
      const errors = lintErrorMatch ? parseInt(lintErrorMatch[1], 10) : 0;
      const warnings = lintWarnMatch ? parseInt(lintWarnMatch[1], 10) : 0;
      if (errors === 0 && warnings === 0) {
        results.lint = 'Clean';
      } else if (errors === 0) {
        results.lint = `${warnings} warnings`;
      } else {
        results.lint = `${errors} errors, ${warnings} warnings`;
      }
    }

    // Look for TypeScript compilation
    const tscMatch = combinedLogs.match(/(?:tsc|typescript).*(?:error|pass|success|clean)/i);
    if (tscMatch) {
      if (tscMatch[0].match(/error/i)) {
        results.integration = 'TypeScript errors';
      } else {
        results.integration = 'TypeScript clean';
      }
    }

    // Build summary
    const summaryParts = [];
    if (results.unit !== 'N/A') summaryParts.push(`Tests: ${results.unit}`);
    if (results.lint !== 'N/A') summaryParts.push(`Lint: ${results.lint}`);
    if (results.integration !== 'N/A') summaryParts.push(results.integration);
    results.summary = summaryParts.join(' | ');
  } catch {
    // Ignore errors
  }

  return results;
}

/**
 * Load custom PR template if exists, otherwise return null
 * @param {string} prdDir - Path to PRD directory
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {string|null} Template content or null
 */
function loadTemplate(prdDir, ralphDir) {
  // Check for PRD-specific template first
  const prdTemplate = path.join(prdDir, 'PR_TEMPLATE.md');
  if (fs.existsSync(prdTemplate)) {
    try {
      return fs.readFileSync(prdTemplate, 'utf8');
    } catch {
      // Fall through
    }
  }

  // Check for project-level template in .ralph
  const projectTemplate = path.join(ralphDir, 'PR_TEMPLATE.md');
  if (fs.existsSync(projectTemplate)) {
    try {
      return fs.readFileSync(projectTemplate, 'utf8');
    } catch {
      // Fall through
    }
  }

  // Check for default template in .agents/ralph
  const agentsDir = path.dirname(path.dirname(__dirname));
  const defaultTemplate = path.join(agentsDir, '.agents', 'ralph', 'PR_TEMPLATE.md');
  if (fs.existsSync(defaultTemplate)) {
    try {
      return fs.readFileSync(defaultTemplate, 'utf8');
    } catch {
      // Fall through
    }
  }

  return null;
}

/**
 * Render PR body with smart content
 * @param {Object} options - Render options
 * @param {string} options.streamId - Stream ID (e.g., "PRD-1")
 * @param {string} options.prdPath - Path to prd.md
 * @param {string} options.runsDir - Path to runs directory
 * @param {string} options.cwd - Working directory for git operations
 * @param {string} [options.baseBranch='main'] - Base branch for comparison
 * @returns {string} Rendered PR body
 */
function renderPRBody(options) {
  const { streamId, prdPath, runsDir, cwd, baseBranch = 'main' } = options;

  // Extract all components
  const prdSummary = extractPRDSummary(prdPath);
  const { stories, formatted: storiesFormatted } = formatCompletedStories(prdPath);
  const { summary: filesSummary, formatted: filesFormatted } = getKeyFiles(cwd, baseBranch);
  const testResults = formatTestResults(runsDir);

  // Build PR body
  const lines = ['## Summary', '', `This PR was automatically generated by Ralph CLI from ${streamId}.`, ''];

  // Add PRD summary if available
  if (prdSummary) {
    lines.push(prdSummary, '');
  }

  // Add completed stories section
  if (stories.length > 0) {
    lines.push('### Completed Stories', '', storiesFormatted, '');
  }

  // Add changes section
  if (filesSummary) {
    lines.push('### Changes', '', filesSummary, '');

    if (filesFormatted) {
      lines.push('<details>', '<summary>Key Files</summary>', '', filesFormatted, '', '</details>', '');
    }
  }

  // Add test results section
  if (testResults.summary) {
    lines.push('### Test Results', '');
    if (testResults.unit !== 'N/A') {
      lines.push(`- **Unit Tests:** ${testResults.unit}`);
    }
    if (testResults.integration !== 'N/A') {
      lines.push(`- **Integration:** ${testResults.integration}`);
    }
    if (testResults.lint !== 'N/A') {
      lines.push(`- **Lint:** ${testResults.lint}`);
    }
    lines.push('');
  }

  // Add footer
  lines.push('---', '*Generated by [Ralph CLI](https://github.com/AskTinNguyen/ralph-cli)*');

  return lines.join('\n');
}

module.exports = {
  extractPRDSummary,
  formatCompletedStories,
  getKeyFiles,
  formatTestResults,
  loadTemplate,
  renderPRBody,
};
