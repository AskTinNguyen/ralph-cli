#!/usr/bin/env node
/**
 * Tests for TypeScript Executor Loop (lib/executor/loop.js)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import executor module
const executor = require('../lib/executor/loop.js');

// Test utilities
let testDir;
let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    Error: ${err.message}`);
  }
}

function setup() {
  testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'executor-loop-test-'));

  // Create test PRD
  const prdContent = `# PRD

### [ ] US-001: First story

**As a** user
**I want** feature
**So that** benefit

#### Acceptance Criteria
- [ ] Criterion 1

---

### [ ] US-002: Second story

**As a** user
**I want** another feature
**So that** another benefit

#### Acceptance Criteria
- [ ] Criterion 1

---

### [x] US-003: Completed story

**As a** user
**I want** done feature
**So that** done benefit

#### Acceptance Criteria
- [x] Criterion 1
`;

  const planContent = `# Plan

### [ ] US-001: First story
- [ ] Task 1
- [ ] Task 2

### [ ] US-002: Second story
- [ ] Task 1

### [x] US-003: Completed story
- [x] Task 1
`;

  fs.writeFileSync(path.join(testDir, 'prd.md'), prdContent);
  fs.writeFileSync(path.join(testDir, 'plan.md'), planContent);
  fs.writeFileSync(path.join(testDir, 'progress.md'), '# Progress\n');
  fs.writeFileSync(path.join(testDir, 'activity.log'), '');
  fs.mkdirSync(path.join(testDir, 'runs'), { recursive: true });
}

function cleanup() {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

// ============================================================================
// Module Structure Tests
// ============================================================================

console.log('\n=== Module Structure Tests ===');

test('exports runBuild function', () => {
  assert.strictEqual(typeof executor.runBuild, 'function');
});

test('exports BuildState class', () => {
  assert.strictEqual(typeof executor.BuildState, 'function');
});

test('exports parseStories function', () => {
  assert.strictEqual(typeof executor.parseStories, 'function');
});

test('exports selectNextStory function', () => {
  assert.strictEqual(typeof executor.selectNextStory, 'function');
});

test('exports checkpoint functions', () => {
  assert.strictEqual(typeof executor.saveCheckpoint, 'function');
  assert.strictEqual(typeof executor.loadCheckpoint, 'function');
  assert.strictEqual(typeof executor.clearCheckpoint, 'function');
});

test('exports agent functions', () => {
  assert.strictEqual(typeof executor.runAgent, 'function');
  assert.strictEqual(typeof executor.switchAgent, 'function');
});

test('exports DEFAULT_CONFIG', () => {
  assert.strictEqual(typeof executor.DEFAULT_CONFIG, 'object');
  assert.strictEqual(executor.DEFAULT_CONFIG.maxIterations, 5);
  assert.strictEqual(executor.DEFAULT_CONFIG.agent, 'claude');
});

test('exports AGENT_COMMANDS', () => {
  assert.strictEqual(typeof executor.AGENT_COMMANDS, 'object');
  assert.ok(executor.AGENT_COMMANDS.claude);
  assert.ok(executor.AGENT_COMMANDS.codex);
  assert.ok(executor.AGENT_COMMANDS.droid);
});

// ============================================================================
// BuildState Tests
// ============================================================================

console.log('\n=== BuildState Tests ===');

test('BuildState initializes correctly', () => {
  const config = { agent: 'claude' };
  const state = new executor.BuildState(config);

  assert.strictEqual(state.iteration, 0);
  assert.strictEqual(state.currentAgent, 'claude');
  assert.strictEqual(state.consecutiveFailures, 0);
  assert.strictEqual(state.chainPosition, 0);
  assert.ok(state.startTime > 0);
  assert.deepStrictEqual(state.stories, []);
  assert.deepStrictEqual(state.completedStories, []);
  assert.deepStrictEqual(state.failedStories, []);
});

test('BuildState.getElapsedSeconds returns positive number', () => {
  const state = new executor.BuildState({ agent: 'claude' });
  const elapsed = state.getElapsedSeconds();
  assert.strictEqual(typeof elapsed, 'number');
  assert.ok(elapsed >= 0);
});

test('BuildState.toJSON returns valid object', () => {
  const state = new executor.BuildState({ agent: 'claude' });
  state.iteration = 3;
  state.consecutiveFailures = 1;

  const json = state.toJSON();

  assert.strictEqual(json.iteration, 3);
  assert.strictEqual(json.currentAgent, 'claude');
  assert.strictEqual(json.consecutiveFailures, 1);
  assert.strictEqual(json.completedCount, 0);
  assert.strictEqual(json.failedCount, 0);
});

// ============================================================================
// Story Parsing Tests
// ============================================================================

console.log('\n=== Story Parsing Tests ===');

setup();

test('parseStories parses plan.md correctly', () => {
  const stories = executor.parseStories(path.join(testDir, 'plan.md'));

  assert.ok(Array.isArray(stories));
  assert.strictEqual(stories.length, 3);
  assert.strictEqual(stories[0].id, 'US-001');
  assert.strictEqual(stories[0].title, 'First story');
  assert.strictEqual(stories[0].status, 'pending');
  assert.strictEqual(stories[2].status, 'completed');
});

test('selectNextStory returns first pending story', () => {
  const stories = [
    { id: 'US-001', status: 'completed' },
    { id: 'US-002', status: 'pending' },
    { id: 'US-003', status: 'pending' },
  ];

  const next = executor.selectNextStory(stories);

  assert.strictEqual(next.id, 'US-002');
});

test('selectNextStory returns null when all completed', () => {
  const stories = [
    { id: 'US-001', status: 'completed' },
    { id: 'US-002', status: 'completed' },
  ];

  const next = executor.selectNextStory(stories);

  assert.strictEqual(next, null);
});

// ============================================================================
// Checkpoint Tests
// ============================================================================

console.log('\n=== Checkpoint Tests ===');

test('saveCheckpoint creates checkpoint file', () => {
  const state = new executor.BuildState({ agent: 'claude' });
  state.iteration = 2;
  state.currentStory = { id: 'US-001', title: 'Test story' };

  executor.saveCheckpoint(testDir, state);

  const checkpointPath = path.join(testDir, '.checkpoint.json');
  assert.ok(fs.existsSync(checkpointPath));

  const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
  assert.strictEqual(checkpoint.iteration, 2);
  assert.strictEqual(checkpoint.story_id, 'US-001');
  assert.strictEqual(checkpoint.agent, 'claude');
});

test('loadCheckpoint reads checkpoint file', () => {
  const checkpoint = executor.loadCheckpoint(testDir);

  assert.ok(checkpoint);
  assert.strictEqual(checkpoint.iteration, 2);
  assert.strictEqual(checkpoint.story_id, 'US-001');
});

test('clearCheckpoint removes checkpoint file', () => {
  executor.clearCheckpoint(testDir);

  const checkpointPath = path.join(testDir, '.checkpoint.json');
  assert.ok(!fs.existsSync(checkpointPath));
});

test('loadCheckpoint returns null when no checkpoint', () => {
  const result = executor.loadCheckpoint(testDir);
  assert.strictEqual(result, null);
});

// ============================================================================
// Agent Switching Tests
// ============================================================================

console.log('\n=== Agent Switching Tests ===');

test('switchAgent advances to next agent', () => {
  const state = new executor.BuildState({ agent: 'claude' });
  state.currentAgent = 'claude';
  state.consecutiveFailures = 2;

  const config = {
    agentFallbackChain: ['claude', 'codex', 'droid'],
    prdFolder: testDir,
  };

  const switched = executor.switchAgent(state, config);

  assert.strictEqual(switched, true);
  assert.strictEqual(state.currentAgent, 'codex');
  assert.strictEqual(state.chainPosition, 1);
  assert.strictEqual(state.consecutiveFailures, 0);
});

test('switchAgent returns false at end of chain', () => {
  const state = new executor.BuildState({ agent: 'droid' });
  state.currentAgent = 'droid';

  const config = {
    agentFallbackChain: ['claude', 'codex', 'droid'],
    prdFolder: testDir,
  };

  const switched = executor.switchAgent(state, config);

  assert.strictEqual(switched, false);
  assert.strictEqual(state.currentAgent, 'droid');
});

// ============================================================================
// Config Tests
// ============================================================================

console.log('\n=== Config Tests ===');

test('DEFAULT_CONFIG has required fields', () => {
  const config = executor.DEFAULT_CONFIG;

  assert.strictEqual(config.maxIterations, 5);
  assert.strictEqual(config.agent, 'claude');
  assert.deepStrictEqual(config.agentFallbackChain, ['claude', 'codex', 'droid']);
  assert.strictEqual(config.agentSwitchThreshold, 2);
  assert.strictEqual(config.rollbackEnabled, true);
  assert.strictEqual(config.rollbackMaxRetries, 3);
  assert.strictEqual(config.timeoutAgent, 3600000);
  assert.strictEqual(config.timeoutIteration, 5400000);
});

test('AGENT_COMMANDS has all agents', () => {
  const cmds = executor.AGENT_COMMANDS;

  assert.ok(cmds.claude.includes('claude'));
  assert.ok(cmds.codex.includes('codex'));
  assert.ok(cmds.droid.includes('droid'));
});

// ============================================================================
// Integration Tests (Mocked)
// ============================================================================

console.log('\n=== Integration Tests ===');

test('runBuild throws on missing PRD', async () => {
  try {
    await executor.runBuild({ prdPath: '/nonexistent/prd.md' });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('PRD path'));
  }
});

test('runBuild throws on missing plan', async () => {
  try {
    await executor.runBuild({
      prdPath: path.join(testDir, 'prd.md'),
      planPath: '/nonexistent/plan.md',
    });
    assert.fail('Should have thrown');
  } catch (err) {
    assert.ok(err.message.includes('Plan path'));
  }
});

// ============================================================================
// Cleanup and Summary
// ============================================================================

cleanup();

console.log(`\n${'='.repeat(50)}`);
console.log(`Test Results: ${passCount}/${testCount} passed`);
if (failCount > 0) {
  console.log(`${failCount} test(s) failed`);
  process.exit(1);
} else {
  console.log('All tests passed!');
  process.exit(0);
}
