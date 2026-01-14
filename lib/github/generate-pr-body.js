#!/usr/bin/env node
/**
 * CLI helper to generate PR body from stream data
 * Usage: node generate-pr-body.js <streamId> <ralphDir> <cwd> [baseBranch]
 */

const template = require('./template');
const path = require('path');

const streamId = process.argv[2];
const ralphDir = process.argv[3];
const cwd = process.argv[4];
const baseBranch = process.argv[5] || 'main';

if (!streamId || !ralphDir || !cwd) {
  console.error('Usage: node generate-pr-body.js <streamId> <ralphDir> <cwd> [baseBranch]');
  process.exit(1);
}

const streamDir = path.join(ralphDir, streamId);
const prdPath = path.join(streamDir, 'prd.md');
const runsDir = path.join(streamDir, 'runs');

const body = template.renderPRBody({
  streamId,
  prdPath,
  runsDir,
  cwd,
  baseBranch,
});

console.log(body);
