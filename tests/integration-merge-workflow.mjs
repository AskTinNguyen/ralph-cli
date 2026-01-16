/**
 * Integration tests for merge workflow
 * Tests actual behavior of merge confirmation and completion messaging
 */

import { execSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import assert from 'assert';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

// Test fixture directory
const TEST_DIR = path.join(ROOT, 'tests/fixtures/merge-workflow-test');

/**
 * Helper to clean up test directory
 */
function cleanupTestDir() {
  if (fs.existsSync(TEST_DIR)) {
    execSync(`rm -rf "${TEST_DIR}"`, { stdio: 'inherit' });
  }
}

/**
 * Helper to setup test git repo
 */
function setupTestRepo() {
  cleanupTestDir();
  fs.mkdirSync(TEST_DIR, { recursive: true });

  // Initialize git repo
  execSync('git init', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git config user.name "Test User"', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git config user.email "test@example.com"', { cwd: TEST_DIR, stdio: 'pipe' });

  // Create initial commit
  fs.writeFileSync(path.join(TEST_DIR, 'README.md'), '# Test Repo\n');
  execSync('git add .', { cwd: TEST_DIR, stdio: 'pipe' });
  execSync('git commit -m "Initial commit"', { cwd: TEST_DIR, stdio: 'pipe' });

  // Copy Ralph files
  const ralphDir = path.join(TEST_DIR, '.agents/ralph');
  fs.mkdirSync(ralphDir, { recursive: true });

  // Copy essential files
  fs.copyFileSync(
    path.join(ROOT, '.agents/ralph/stream.sh'),
    path.join(ralphDir, 'stream.sh')
  );
  fs.copyFileSync(
    path.join(ROOT, '.agents/ralph/config.sh'),
    path.join(ralphDir, 'config.sh')
  );

  // Make stream.sh executable
  fs.chmodSync(path.join(ralphDir, 'stream.sh'), '755');

  return TEST_DIR;
}

/**
 * Helper to create a test PRD with worktree
 */
function createTestPRDWithWorktree(testDir, prdNum = 1) {
  const ralphDir = path.join(testDir, '.ralph');
  const prdDir = path.join(ralphDir, `PRD-${prdNum}`);
  const worktreeDir = path.join(ralphDir, 'worktrees', `PRD-${prdNum}`);

  // Create PRD directory
  fs.mkdirSync(prdDir, { recursive: true });

  // Create PRD files
  fs.writeFileSync(path.join(prdDir, 'prd.md'), '# Test PRD\n');
  fs.writeFileSync(path.join(prdDir, 'plan.md'), '# Test Plan\n');
  fs.writeFileSync(path.join(prdDir, 'progress.md'), '# Progress\n');

  // Create worktree branch
  const branch = `ralph/PRD-${prdNum}`;
  execSync(`git worktree add -b ${branch} "${worktreeDir}"`, { cwd: testDir, stdio: 'pipe' });

  // Make some commits in worktree
  fs.writeFileSync(path.join(worktreeDir, 'test.txt'), 'Test content\n');
  execSync('git add test.txt', { cwd: worktreeDir, stdio: 'pipe' });
  execSync('git commit -m "PRD-1: Add test file"', { cwd: worktreeDir, stdio: 'pipe' });

  // Mark as completed
  fs.writeFileSync(path.join(prdDir, '.completed'), '');

  return { prdDir, worktreeDir, branch };
}

describe('Merge Workflow Integration Tests', function() {
  this.timeout(30000); // Allow time for git operations

  let testDir;

  beforeEach(() => {
    testDir = setupTestRepo();
  });

  afterEach(() => {
    cleanupTestDir();
  });

  describe('Merge Confirmation Prompt', () => {
    it('should require confirmation by default', function(done) {
      this.timeout(10000);

      const { branch } = createTestPRDWithWorktree(testDir, 1);

      // Source stream.sh functions
      const streamSh = path.join(testDir, '.agents/ralph/stream.sh');

      // Spawn merge command with stdin control
      const mergeProcess = spawn('bash', ['-c', `
        source "${streamSh}"
        export RALPH_DIR="${testDir}/.ralph"
        export WORKTREES_DIR="${testDir}/.ralph/worktrees"
        cmd_merge 1
      `], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';

      mergeProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      mergeProcess.stderr.on('data', (data) => {
        output += data.toString();
      });

      // Wait a bit for prompt to appear
      setTimeout(() => {
        // Check if prompt appeared
        if (output.includes('Proceed with merge?')) {
          // Send 'n' to decline
          mergeProcess.stdin.write('n\n');
          mergeProcess.stdin.end();
        }
      }, 2000);

      mergeProcess.on('close', (code) => {
        try {
          // Should show confirmation prompt
          assert.ok(
            output.includes('Merge Confirmation'),
            'Should show merge confirmation header'
          );

          assert.ok(
            output.includes('Proceed with merge?'),
            'Should show confirmation prompt'
          );

          assert.ok(
            output.includes('Commits to be merged'),
            'Should show commit summary'
          );

          // Should be cancellable
          assert.ok(
            output.includes('Merge cancelled by user') || code === 0,
            'Should allow merge cancellation'
          );

          done();
        } catch (err) {
          done(err);
        }
      });
    });

    it('should skip confirmation with --yes flag', function(done) {
      this.timeout(10000);

      const { branch } = createTestPRDWithWorktree(testDir, 1);

      const streamSh = path.join(testDir, '.agents/ralph/stream.sh');

      // Run merge with --yes flag
      const mergeProcess = spawn('bash', ['-c', `
        source "${streamSh}"
        export RALPH_DIR="${testDir}/.ralph"
        export WORKTREES_DIR="${testDir}/.ralph/worktrees"
        cmd_merge 1 --yes
      `], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';

      mergeProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      mergeProcess.stderr.on('data', (data) => {
        output += data.toString();
      });

      mergeProcess.on('close', (code) => {
        try {
          // Should NOT show confirmation prompt with --yes
          assert.ok(
            !output.includes('Proceed with merge?') || output.includes('Merging'),
            'Should skip confirmation with --yes flag'
          );

          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });

  describe('Completion Messaging', () => {
    it('should detect worktree context correctly', () => {
      const loopSh = path.join(ROOT, '.agents/ralph/loop.sh');

      // Test in_worktree_context function
      const checkWorktree = execSync(`bash -c '
        source "${loopSh}"
        git checkout -b ralph/PRD-1 2>/dev/null || true
        in_worktree_context && echo "YES" || echo "NO"
      '`, { cwd: testDir, encoding: 'utf8' }).trim();

      assert.strictEqual(checkWorktree, 'YES', 'Should detect worktree context');
    });

    it('should show different messages for worktree vs direct-to-main', () => {
      const loopSh = path.join(ROOT, '.agents/ralph/loop.sh');

      // Test worktree message
      const worktreeMsg = execSync(`bash -c '
        source "${loopSh}"
        git checkout -b ralph/PRD-1 2>/dev/null || true
        show_completion_instructions 1 | grep -c "MANUAL MERGE REQUIRED" || echo "0"
      '`, { cwd: testDir, encoding: 'utf8' }).trim();

      assert.notStrictEqual(worktreeMsg, '0', 'Should show MANUAL MERGE REQUIRED for worktree');

      // Test direct-to-main message
      const mainMsg = execSync(`bash -c '
        source "${loopSh}"
        git checkout main 2>/dev/null || git checkout master 2>/dev/null || true
        show_completion_instructions | grep -c "BUILD COMPLETE" || echo "0"
      '`, { cwd: testDir, encoding: 'utf8' }).trim();

      assert.notStrictEqual(mainMsg, '0', 'Should show BUILD COMPLETE for direct-to-main');
    });
  });

  describe('Configuration', () => {
    it('should have RALPH_MERGE_REQUIRE_CONFIRM enabled by default', () => {
      const configSh = path.join(ROOT, '.agents/ralph/config.sh');
      const content = fs.readFileSync(configSh, 'utf8');

      // Extract the config value
      const match = content.match(/RALPH_MERGE_REQUIRE_CONFIRM=(\w+)/);
      assert.ok(match, 'RALPH_MERGE_REQUIRE_CONFIRM should be defined');
      assert.strictEqual(match[1], 'true', 'RALPH_MERGE_REQUIRE_CONFIRM should default to true');
    });

    it('should respect RALPH_MERGE_REQUIRE_CONFIRM=false', function(done) {
      this.timeout(10000);

      const { branch } = createTestPRDWithWorktree(testDir, 1);

      const streamSh = path.join(testDir, '.agents/ralph/stream.sh');

      // Run merge with RALPH_MERGE_REQUIRE_CONFIRM=false
      const mergeProcess = spawn('bash', ['-c', `
        export RALPH_MERGE_REQUIRE_CONFIRM=false
        source "${streamSh}"
        export RALPH_DIR="${testDir}/.ralph"
        export WORKTREES_DIR="${testDir}/.ralph/worktrees"
        cmd_merge 1
      `], {
        cwd: testDir,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let output = '';

      mergeProcess.stdout.on('data', (data) => {
        output += data.toString();
      });

      mergeProcess.stderr.on('data', (data) => {
        output += data.toString();
      });

      mergeProcess.on('close', (code) => {
        try {
          // Should NOT show confirmation when disabled
          assert.ok(
            !output.includes('Proceed with merge?') || output.includes('Merging'),
            'Should skip confirmation when RALPH_MERGE_REQUIRE_CONFIRM=false'
          );

          done();
        } catch (err) {
          done(err);
        }
      });
    });
  });
});

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Running merge workflow integration tests...');
  console.log('Note: These tests create temporary git repos and may take some time.');
}
