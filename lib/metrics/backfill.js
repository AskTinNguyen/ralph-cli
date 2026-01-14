#!/usr/bin/env node
/**
 * Backfill Script - Create synthetic run logs from git history
 *
 * For PRDs that were implemented manually without ralph build,
 * this script generates run summary files (.md) from git commits
 * so they appear in the metrics dashboard.
 *
 * Usage:
 *   node lib/metrics/backfill.js [prd-id]
 *   node lib/metrics/backfill.js --all
 *   node lib/metrics/backfill.js 15 16 17 28
 */

const fs = require('fs');
const path = require('path');
const {
  getCompletedStoriesFromGit,
  hasOnlyPlanRuns
} = require('./git-fallback');
const { listRunSummaries } = require('../eval/parser');

/**
 * Format date for run ID
 * @param {string} timestamp - Git timestamp
 * @returns {string} YYYYMMDD-HHMMSS format
 */
function formatRunId(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  const pid = Math.floor(Math.random() * 90000) + 10000; // Random 5-digit PID
  return `${year}${month}${day}-${hours}${minutes}${seconds}-${pid}`;
}

/**
 * Generate run summary markdown content
 * @param {Object} syntheticRun - Synthetic run object from git-fallback
 * @param {number} iteration - Iteration number
 * @param {string} logPath - Path to log file
 * @returns {string} Markdown content
 */
function generateRunSummary(syntheticRun, iteration, logPath) {
  const runId = syntheticRun.runId.replace('git-', '');

  return `# Ralph Run Summary

- Run ID: ${runId}
- Iteration: ${iteration}
- Mode: build
- Story: ${syntheticRun.story}
- Started: ${syntheticRun.startedAt}
- Ended: ${syntheticRun.endedAt}
- Duration: N/A (backfilled from git)
- Status: success
- Log: ${logPath}

## Git
- Head (before): (unknown)
- Head (after): ${syntheticRun.headAfter}

### Commits
${syntheticRun.commits.map(c => `- ${c}`).join('\n')}

### Changed Files (commits)
- (backfilled - see git commit)

### Uncommitted Changes
- (clean)

## Token Usage
- Input tokens: (unavailable)
- Output tokens: (unavailable)
- Model: unknown
- Estimated: True
- Total tokens: (unavailable)

## Retry Statistics
- Retry count: 0 (backfilled from git)

## Backfill Info
- Source: git-fallback
- Backfilled: ${new Date().toISOString()}
- Original commit: ${syntheticRun.headAfter}
`;
}

/**
 * Generate log file content
 * @param {Object} syntheticRun - Synthetic run object
 * @returns {string} Log content
 */
function generateLogContent(syntheticRun) {
  return `# Ralph Build Log (Backfilled from Git)

Run ID: ${syntheticRun.runId}
Story: ${syntheticRun.story}
Started: ${syntheticRun.startedAt}

This run was backfilled from git history because the PRD was implemented
manually without using 'ralph build'. The actual implementation was done
in git commit: ${syntheticRun.headAfter}

Status: SUCCESS (backfilled)
`;
}

/**
 * Backfill a single PRD
 * @param {number} prdId - PRD number
 * @param {boolean} dryRun - If true, don't write files
 * @returns {Object} Result { prdId, stories, created, skipped, error }
 */
function backfillPrd(prdId, dryRun = false) {
  const ralphRoot = path.join(process.cwd(), '.ralph');
  const prdPath = path.join(ralphRoot, `PRD-${prdId}`);
  const runsDir = path.join(prdPath, 'runs');

  const result = {
    prdId,
    stories: 0,
    created: 0,
    skipped: 0,
    error: null
  };

  // Check if PRD directory exists
  if (!fs.existsSync(prdPath)) {
    result.error = 'PRD directory not found';
    return result;
  }

  // Create runs directory if it doesn't exist
  if (!fs.existsSync(runsDir)) {
    if (!dryRun) {
      fs.mkdirSync(runsDir, { recursive: true });
    }
  }

  // Check if PRD needs backfill (has only plan runs or no runs)
  const existingRuns = [];
  if (fs.existsSync(runsDir)) {
    const summaryPaths = listRunSummaries(runsDir);
    summaryPaths.forEach(p => {
      const content = fs.readFileSync(p, 'utf-8');
      const modeMatch = content.match(/- Mode:\s*(\w+)/);
      const storyMatch = content.match(/- Story:\s*(.+)/);
      if (modeMatch) {
        existingRuns.push({
          mode: modeMatch[1],
          story: storyMatch ? storyMatch[1] : null
        });
      }
    });
  }

  if (!hasOnlyPlanRuns(existingRuns)) {
    result.skipped = existingRuns.filter(r => r.mode === 'build' && r.story).length;
    result.error = 'PRD already has build runs, skipping';
    return result;
  }

  // Get stories from git
  const gitStories = getCompletedStoriesFromGit(prdPath);

  if (gitStories.length === 0) {
    result.error = 'No stories found in git history';
    return result;
  }

  result.stories = gitStories.length;

  // Create run files for each story
  gitStories.forEach((story, index) => {
    const iteration = index + 1;
    const runId = formatRunId(story.startedAt);
    const logFile = `run-${runId}-iter-${iteration}.log`;
    const summaryFile = `run-${runId}-iter-${iteration}.md`;

    const logPath = path.join(runsDir, logFile);
    const summaryPath = path.join(runsDir, summaryFile);

    // Check if files already exist
    if (fs.existsSync(summaryPath)) {
      result.skipped++;
      return;
    }

    if (dryRun) {
      console.log(`  [DRY RUN] Would create: ${summaryFile}`);
      console.log(`            Story: ${story.story}`);
      result.created++;
      return;
    }

    // Write log file
    const logContent = generateLogContent(story);
    fs.writeFileSync(logPath, logContent, 'utf-8');

    // Write summary file
    const summaryContent = generateRunSummary(story, iteration, logPath);
    fs.writeFileSync(summaryPath, summaryContent, 'utf-8');

    result.created++;
  });

  return result;
}

/**
 * Find all PRDs that need backfilling
 * @returns {number[]} Array of PRD IDs
 */
function findPrdsNeedingBackfill() {
  const ralphRoot = path.join(process.cwd(), '.ralph');

  if (!fs.existsSync(ralphRoot)) {
    return [];
  }

  const needsBackfill = [];
  const entries = fs.readdirSync(ralphRoot);

  for (const entry of entries) {
    if (!entry.startsWith('PRD-')) {
      continue;
    }

    const prdId = parseInt(entry.replace('PRD-', ''), 10);
    const prdPath = path.join(ralphRoot, entry);
    const runsDir = path.join(prdPath, 'runs');

    // Check if has only plan runs
    const existingRuns = [];
    if (fs.existsSync(runsDir)) {
      const summaries = listRunSummaries(runsDir);
      summaries.forEach(p => {
        const content = fs.readFileSync(p, 'utf-8');
        const modeMatch = content.match(/- Mode:\s*(\w+)/);
        const storyMatch = content.match(/- Story:\s*(.+)/);
        if (modeMatch) {
          existingRuns.push({
            mode: modeMatch[1],
            story: storyMatch ? storyMatch[1] : null
          });
        }
      });
    }

    if (hasOnlyPlanRuns(existingRuns)) {
      needsBackfill.push(prdId);
    }
  }

  return needsBackfill.sort((a, b) => a - b);
}

/**
 * Main CLI
 */
function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Ralph Metrics Backfill - Create run logs from git history

Usage:
  node lib/metrics/backfill.js [options] [prd-ids...]

Options:
  --all         Backfill all PRDs that need it
  --dry-run     Show what would be created without writing files
  --help, -h    Show this help message

Examples:
  node lib/metrics/backfill.js 28                # Backfill PRD-28
  node lib/metrics/backfill.js 15 16 17 28       # Backfill multiple PRDs
  node lib/metrics/backfill.js --all             # Backfill all needed PRDs
  node lib/metrics/backfill.js --all --dry-run   # Preview without writing

This script creates synthetic run log files for PRDs that were implemented
manually without using 'ralph build'. It extracts story completion from
git commit history and generates compatible run summary files.
    `);
    process.exit(0);
  }

  const dryRun = args.includes('--dry-run');
  const backfillAll = args.includes('--all');

  let prdIds = [];

  if (backfillAll) {
    console.log('Finding PRDs that need backfilling...\n');
    prdIds = findPrdsNeedingBackfill();

    if (prdIds.length === 0) {
      console.log('No PRDs need backfilling!');
      process.exit(0);
    }

    console.log(`Found ${prdIds.length} PRDs needing backfill: ${prdIds.join(', ')}\n`);
  } else {
    prdIds = args
      .filter(arg => !arg.startsWith('--'))
      .map(arg => parseInt(arg, 10))
      .filter(n => !isNaN(n));

    if (prdIds.length === 0) {
      console.error('Error: No PRD IDs specified');
      console.error('Usage: node lib/metrics/backfill.js [--all] [--dry-run] [prd-ids...]');
      process.exit(1);
    }
  }

  if (dryRun) {
    console.log('=== DRY RUN MODE ===\n');
  }

  const results = [];
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const prdId of prdIds) {
    console.log(`Backfilling PRD-${prdId}...`);
    const result = backfillPrd(prdId, dryRun);
    results.push(result);

    if (result.error) {
      console.log(`  ✗ ${result.error}`);
      totalErrors++;
    } else {
      console.log(`  ✓ Created ${result.created} run logs for ${result.stories} stories`);
      if (result.skipped > 0) {
        console.log(`    (Skipped ${result.skipped} existing runs)`);
      }
      totalCreated += result.created;
      totalSkipped += result.skipped;
    }
    console.log('');
  }

  console.log('=== Summary ===');
  console.log(`PRDs processed: ${prdIds.length}`);
  console.log(`Run logs created: ${totalCreated}`);
  console.log(`Runs skipped: ${totalSkipped}`);
  console.log(`Errors: ${totalErrors}`);

  if (dryRun) {
    console.log('\nThis was a dry run. No files were actually created.');
    console.log('Run without --dry-run to create the files.');
  } else if (totalCreated > 0) {
    console.log('\n✓ Backfill complete! Metrics dashboard should now show data for these PRDs.');
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  backfillPrd,
  findPrdsNeedingBackfill
};
