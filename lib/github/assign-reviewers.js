#!/usr/bin/env node
/**
 * Helper script to auto-assign reviewers and labels to a PR
 * Called by stream.sh after PR creation
 *
 * Usage: node assign-reviewers.js <stream_id> <pr_url> <cwd> <base_branch>
 *
 * Output format (one per line):
 *   reviewers: user1, user2 (or "none")
 *   teams: org/team1, org/team2 (or "none")
 *   labels: label1, label2
 *   warning: <message> (optional, can have multiple)
 */

const pr = require('./pr');

const streamId = process.argv[2];
const prUrl = process.argv[3];
const cwd = process.argv[4] || process.cwd();
const baseBranch = process.argv[5] || 'main';

if (!streamId || !prUrl) {
  console.error('Usage: node assign-reviewers.js <stream_id> <pr_url> [cwd] [base_branch]');
  process.exit(1);
}

const result = pr.autoAssignReviewers(streamId, prUrl, {
  cwd,
  baseBranch,
});

if (!result.success) {
  console.error(result.error || 'Unknown error');
  process.exit(1);
}

// Output results for stream.sh to parse
console.log(`reviewers: ${result.reviewers && result.reviewers.length > 0 ? result.reviewers.join(', ') : 'none'}`);
console.log(`teams: ${result.teams && result.teams.length > 0 ? result.teams.join(', ') : 'none'}`);
console.log(`labels: ${result.labels ? result.labels.join(', ') : 'none'}`);

if (result.warnings && result.warnings.length > 0) {
  for (const warning of result.warnings) {
    console.log(`warning: ${warning}`);
  }
}
