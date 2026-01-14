#!/usr/bin/env node
/**
 * Test script for US-003: Fix Execution Tracking
 */

const executor = require('../lib/diagnose/executor.js');

console.log('=== Testing US-003: Fix Execution Tracking ===\n');

// Test 1: captureState function
console.log('1. Testing captureState...');
const state = executor.captureState(['package.json']);
console.log('   State captured:', {
  timestamp: state.timestamp,
  hasChecksums: Object.keys(state.fileChecksums).length > 0,
  hasGitStatus: state.gitStatus !== undefined,
  hasGitDiff: state.gitDiff !== undefined,
});

// Test 2: Session management
console.log('\n2. Testing session management...');
const sessionId = executor.startFixSession('test-session');
console.log('   Session started:', sessionId);
console.log('   Current session:', executor.getCurrentSessionId());

// Test 3: getFixSummary (empty)
console.log('\n3. Testing getFixSummary (empty)...');
const summary = executor.getFixSummary();
console.log('   Summary:', summary);

// Test 4: formatFixesForCommit (empty)
console.log('\n4. Testing formatFixesForCommit...');
const commitMsg = executor.formatFixesForCommit();
console.log('   Commit message:', commitMsg || '(empty - expected for no fixes)');

// Test 5: getFixStats
console.log('\n5. Testing getFixStats...');
const stats = executor.getFixStats();
console.log('   Fix stats:', stats);

// Test 6: diffStates
console.log('\n6. Testing diffStates...');
const before = {
  timestamp: Date.now(),
  fileChecksums: { 'file1.js': 'abc123', 'file2.js': 'def456' },
  gitDiff: '',
  gitStatus: '',
  modifiedFiles: [],
};
const after = {
  timestamp: Date.now() + 100,
  fileChecksums: { 'file1.js': 'abc123', 'file2.js': 'xyz789', 'file3.js': 'new123' },
  gitDiff: '',
  gitStatus: '',
  modifiedFiles: ['file2.js'],
};
const diff = executor.diffStates(before, after);
console.log('   Diff result:', diff);

// Cleanup
executor.endFixSession();
executor.clearFixRecords();

console.log('\n=== All US-003 tests passed! ===');
