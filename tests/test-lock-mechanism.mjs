#!/usr/bin/env node

/**
 * Integration tests for Lock Mechanism (Layer 4)
 * Tests stream lock functions in stream.sh
 *
 * Test scenarios:
 * 1. Acquire lock - creates lock file with PID
 * 2. Release lock - removes lock file
 * 3. Is stream running - checks lock + PID
 * 4. Concurrent same PRD - blocks duplicate builds
 * 5. Concurrent different PRDs - allows parallel builds
 * 6. Stale lock detection - identifies dead PIDs
 * 7. Stale lock cleanup - removes dead PID locks
 * 8. Lock file content - contains valid PID
 * 9. Lock conflict handling - proper error messages
 * 10. Lock persistence - survives process checks
 * 11. Multiple locks - different PRDs independent
 * 12. Lock cleanup on exit - trap removes lock
 * 13. PID validation - rejects invalid PIDs
 * 14. Lock directory creation - auto-creates locks dir
 * 15. Race condition handling - atomic lock operations
 */

import { execSync, spawn, spawnSync } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';

class LockMechanismTest {
  constructor() {
    this.testDir = null;
    this.ralphDir = null;
    this.locksDir = null;
    this.passCount = 0;
    this.failCount = 0;
  }

  /**
   * Set up Ralph directory structure for testing
   */
  setupTestRepo() {
    // Create temp directory
    this.testDir = mkdtempSync(join(tmpdir(), 'ralph-lock-test-'));
    this.ralphDir = join(this.testDir, '.ralph');
    this.locksDir = join(this.ralphDir, 'locks');

    console.log(`📁 Test directory: ${this.testDir}`);

    // Create directory structure
    mkdirSync(this.ralphDir, { recursive: true });
    mkdirSync(this.locksDir, { recursive: true });

    // Create PRD directories
    ['PRD-1', 'PRD-2', 'PRD-3'].forEach(prd => {
      const prdDir = join(this.ralphDir, prd);
      mkdirSync(prdDir, { recursive: true });
      writeFileSync(join(prdDir, 'prd.md'), `# ${prd}\n`);
    });
  }

  /**
   * Extract and create test wrapper for lock functions
   */
  createLockFunctions() {
    // Read stream.sh to extract functions
    const streamShPath = join(process.cwd(), '.agents/ralph/stream.sh');
    const streamShContent = readFileSync(streamShPath, 'utf8');

    // Extract lock functions section (lines 270-356)
    // Start from is_stream_running, end after acquire_lock
    const startPattern = /is_stream_running\(\) \{/;
    const startMatch = streamShContent.search(startPattern);

    if (startMatch === -1) {
      throw new Error('Could not find is_stream_running function in stream.sh');
    }

    // Find release_lock function end
    const afterStart = streamShContent.slice(startMatch);
    const endPattern = /release_lock\(\) \{[\s\S]*?\n\}/;
    const endMatch = afterStart.match(endPattern);

    if (!endMatch) {
      throw new Error('Could not find release_lock function in stream.sh');
    }

    const lockSection = afterStart.slice(0, afterStart.indexOf(endMatch[0]) + endMatch[0].length);

    // Create test wrapper script
    const testScript = `#!/bin/bash
set -euo pipefail

LOCKS_DIR="${this.locksDir}"

# Extract lock functions
${lockSection}

# Handle subcommands
case "\${1:-}" in
  acquire)
    acquire_lock "\${2:-}" && echo "success" || echo "failed"
    ;;
  release)
    release_lock "\${2:-}"
    echo "success"
    ;;
  is-running)
    is_stream_running "\${2:-}" && echo "true" || echo "false"
    ;;
  cleanup-stale)
    cleanup_stale_lock "\${2:-}" && echo "cleaned" || echo "not-stale"
    ;;
  is-stale)
    is_lock_stale "\${2:-}" && echo "true" || echo "false"
    ;;
  *)
    echo "Usage: \$0 {acquire|release|is-running|cleanup-stale|is-stale} <stream_id|lock_file>" >&2
    exit 1
    ;;
esac
`;

    const scriptPath = join(this.testDir, 'lock.sh');
    writeFileSync(scriptPath, testScript);
    execSync(`chmod +x "${scriptPath}"`, { cwd: this.testDir });

    return scriptPath;
  }

  /**
   * Helper to run lock script
   */
  runLock(command, args = []) {
    const scriptPath = join(this.testDir, 'lock.sh');
    const fullCommand = [scriptPath, command, ...args].join(' ');

    try {
      const output = execSync(fullCommand, {
        cwd: this.testDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return { success: true, output: output.trim() };
    } catch (error) {
      return {
        success: false,
        output: error.stdout?.toString().trim() || '',
        stderr: error.stderr?.toString().trim() || '',
        code: error.status
      };
    }
  }

  /**
   * Get lock file path for a stream
   */
  getLockPath(streamId) {
    return join(this.locksDir, `${streamId}.lock`);
  }

  /**
   * Check if lock file exists
   */
  lockExists(streamId) {
    return existsSync(this.getLockPath(streamId));
  }

  /**
   * Read lock file content (PID)
   */
  readLock(streamId) {
    if (!this.lockExists(streamId)) {
      return null;
    }
    return readFileSync(this.getLockPath(streamId), 'utf8').trim();
  }

  /**
   * Create a fake lock file with specific PID
   */
  createFakeLock(streamId, pid) {
    writeFileSync(this.getLockPath(streamId), `${pid}\n`);
  }

  /**
   * Get current process PID
   */
  getCurrentPID() {
    return process.pid;
  }

  /**
   * Check if a PID is running
   */
  isPIDRunning(pid) {
    try {
      // kill -0 checks if process exists without killing it
      execSync(`kill -0 ${pid}`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Spawn a background process and return its PID
   */
  spawnBackgroundProcess() {
    // Spawn a long-running sleep process
    const child = spawn('sleep', ['300'], {
      detached: true,
      stdio: 'ignore'
    });
    child.unref(); // Don't wait for it
    return child.pid;
  }

  /**
   * Kill a process by PID
   */
  killProcess(pid) {
    try {
      execSync(`kill ${pid}`, { stdio: 'ignore' });
      // Wait a moment for process to die
      execSync('sleep 0.1', { stdio: 'ignore' });
    } catch {
      // Already dead or doesn't exist
    }
  }

  /**
   * Test helper
   */
  test(name, fn) {
    try {
      fn();
      this.passCount++;
      console.log(`✅ ${name}`);
    } catch (error) {
      this.failCount++;
      console.error(`❌ ${name}`);
      console.error(`   ${error.message}`);
      if (error.stack) {
        console.error(`   ${error.stack.split('\n').slice(1, 3).join('\n')}`);
      }
    }
  }

  /**
   * Test 1: Acquire lock - creates lock file with PID
   */
  testAcquireLock() {
    this.test('Acquire lock - creates lock file with PID', () => {
      // Acquire lock for PRD-1
      const result = this.runLock('acquire', ['PRD-1']);

      // Should succeed
      assert.strictEqual(result.output, 'success', 'Lock acquisition should succeed');

      // Check lock file exists
      assert.strictEqual(this.lockExists('PRD-1'), true, 'Lock file should exist');

      // Check lock contains a PID
      const pid = this.readLock('PRD-1');
      assert.ok(pid, 'Lock file should contain PID');
      assert.match(pid, /^\d+$/, 'PID should be numeric');

      // Verify PID is valid (should be the script's PID or a child)
      const pidNum = parseInt(pid, 10);
      assert.ok(pidNum > 0, 'PID should be positive');
    });
  }

  /**
   * Test 2: Release lock - removes lock file
   */
  testReleaseLock() {
    this.test('Release lock - removes lock file', () => {
      // Create lock first
      this.runLock('acquire', ['PRD-2']);
      assert.strictEqual(this.lockExists('PRD-2'), true, 'Lock should exist initially');

      // Release lock
      const result = this.runLock('release', ['PRD-2']);
      assert.strictEqual(result.output, 'success', 'Release should succeed');

      // Check lock file removed
      assert.strictEqual(this.lockExists('PRD-2'), false, 'Lock file should be removed');
    });
  }

  /**
   * Test 3: Is stream running - checks lock + PID
   */
  testIsStreamRunning() {
    this.test('Is stream running - checks lock and PID', () => {
      // No lock initially
      let result = this.runLock('is-running', ['PRD-1']);
      assert.strictEqual(result.output, 'false', 'Should be false when no lock');

      // Create lock with a running PID (spawn background process)
      const pid = this.spawnBackgroundProcess();

      try {
        this.createFakeLock('PRD-1', pid);

        // Should be running now
        result = this.runLock('is-running', ['PRD-1']);
        assert.strictEqual(result.output, 'true', 'Should be true when lock exists with running PID');

        // Release lock
        this.runLock('release', ['PRD-1']);

        // Should not be running
        result = this.runLock('is-running', ['PRD-1']);
        assert.strictEqual(result.output, 'false', 'Should be false after release');
      } finally {
        this.killProcess(pid);
      }
    });
  }

  /**
   * Test 4: Concurrent same PRD - blocks duplicate builds
   */
  testConcurrentSamePRD() {
    this.test('Concurrent same PRD - blocks duplicate builds', () => {
      // Create lock with running PID
      const pid = this.spawnBackgroundProcess();

      try {
        this.createFakeLock('PRD-1', pid);
        assert.strictEqual(this.lockExists('PRD-1'), true, 'Initial lock should exist');

        // Try to acquire for same PRD (should fail because lock exists with running PID)
        let result = this.runLock('acquire', ['PRD-1']);
        assert.strictEqual(result.output, 'failed', 'Acquisition should fail when lock exists');

        // Verify original lock still exists
        assert.strictEqual(this.lockExists('PRD-1'), true, 'Lock should still exist');
        assert.strictEqual(this.readLock('PRD-1'), `${pid}`, 'Should have original PID');
      } finally {
        this.killProcess(pid);
      }
    });
  }

  /**
   * Test 5: Concurrent different PRDs - allows parallel builds
   */
  testConcurrentDifferentPRDs() {
    this.test('Concurrent different PRDs - allows parallel builds', () => {
      // Create locks with running PIDs for different PRDs
      const pid1 = this.spawnBackgroundProcess();
      const pid2 = this.spawnBackgroundProcess();

      try {
        // Create locks for different PRDs
        this.createFakeLock('PRD-1', pid1);
        this.createFakeLock('PRD-2', pid2);

        // Both locks should exist
        assert.strictEqual(this.lockExists('PRD-1'), true, 'PRD-1 lock should exist');
        assert.strictEqual(this.lockExists('PRD-2'), true, 'PRD-2 lock should exist');

        // Both should show as running
        let result = this.runLock('is-running', ['PRD-1']);
        assert.strictEqual(result.output, 'true', 'PRD-1 should be running');

        result = this.runLock('is-running', ['PRD-2']);
        assert.strictEqual(result.output, 'true', 'PRD-2 should be running');
      } finally {
        this.killProcess(pid1);
        this.killProcess(pid2);
      }
    });
  }

  /**
   * Test 6: Stale lock detection - identifies dead PIDs
   */
  testStaleLockDetection() {
    this.test('Stale lock detection - identifies dead PIDs', () => {
      // Create fake lock with dead PID (99999 should not exist)
      const deadPID = 99999;
      this.createFakeLock('PRD-1', deadPID);

      // Verify PID is not running
      assert.strictEqual(this.isPIDRunning(deadPID), false, 'Fake PID should not be running');

      // Check if lock is stale
      const lockPath = this.getLockPath('PRD-1');
      const result = this.runLock('is-stale', [lockPath]);

      // Should detect as stale
      assert.strictEqual(result.output, 'true', 'Should detect stale lock');
    });
  }

  /**
   * Test 7: Stale lock cleanup - removes dead PID locks
   */
  testStaleLockCleanup() {
    this.test('Stale lock cleanup - removes dead PID locks', () => {
      // Create fake lock with dead PID
      const deadPID = 99998;
      this.createFakeLock('PRD-1', deadPID);
      assert.strictEqual(this.lockExists('PRD-1'), true, 'Stale lock should exist');

      // Cleanup stale lock
      const lockPath = this.getLockPath('PRD-1');
      const result = this.runLock('cleanup-stale', [lockPath]);

      // Should clean up
      assert.strictEqual(result.output, 'cleaned', 'Should clean up stale lock');

      // Lock should be removed
      assert.strictEqual(this.lockExists('PRD-1'), false, 'Stale lock should be removed');
    });
  }

  /**
   * Test 8: Valid lock not cleaned - preserves running PIDs
   */
  testValidLockNotCleaned() {
    this.test('Valid lock not cleaned - preserves running PIDs', () => {
      // Spawn a background process
      const pid = this.spawnBackgroundProcess();

      try {
        // Verify process is running
        assert.strictEqual(this.isPIDRunning(pid), true, 'Background process should be running');

        // Create lock with running PID
        this.createFakeLock('PRD-1', pid);

        // Try to cleanup (should not clean running PID)
        const lockPath = this.getLockPath('PRD-1');
        const result = this.runLock('cleanup-stale', [lockPath]);

        // Should NOT clean up
        assert.strictEqual(result.output, 'not-stale', 'Should not clean valid lock');

        // Lock should still exist
        assert.strictEqual(this.lockExists('PRD-1'), true, 'Valid lock should remain');
      } finally {
        // Clean up background process
        this.killProcess(pid);
      }
    });
  }

  /**
   * Test 9: Lock file content - contains valid PID
   */
  testLockFileContent() {
    this.test('Lock file content - contains valid PID format', () => {
      // Acquire lock
      this.runLock('acquire', ['PRD-1']);

      // Read lock content
      const content = this.readLock('PRD-1');

      // Should be numeric
      assert.match(content, /^\d+$/, 'Lock should contain only digits');

      // Should be a reasonable PID (< 100000 on most systems)
      const pid = parseInt(content, 10);
      assert.ok(pid > 0 && pid < 100000, 'PID should be in reasonable range');
    });
  }

  /**
   * Test 10: Lock directory auto-creation
   */
  testLockDirectoryCreation() {
    this.test('Lock directory auto-creation', () => {
      // Remove locks directory
      if (existsSync(this.locksDir)) {
        rmSync(this.locksDir, { recursive: true, force: true });
      }
      assert.strictEqual(existsSync(this.locksDir), false, 'Locks dir should not exist');

      // Try to acquire lock (should auto-create directory)
      const result = this.runLock('acquire', ['PRD-1']);

      // Should succeed
      assert.strictEqual(result.output, 'success', 'Should succeed even without locks dir');

      // Directory should be created
      assert.strictEqual(existsSync(this.locksDir), true, 'Locks dir should be auto-created');

      // Lock should exist
      assert.strictEqual(this.lockExists('PRD-1'), true, 'Lock should exist in new directory');
    });
  }

  /**
   * Test 11: Multiple locks independence
   */
  testMultipleLocksIndependence() {
    this.test('Multiple locks - different PRDs independent', () => {
      // Acquire locks for 3 different PRDs
      this.runLock('acquire', ['PRD-1']);
      this.runLock('acquire', ['PRD-2']);
      this.runLock('acquire', ['PRD-3']);

      // All should exist
      assert.strictEqual(this.lockExists('PRD-1'), true, 'PRD-1 lock should exist');
      assert.strictEqual(this.lockExists('PRD-2'), true, 'PRD-2 lock should exist');
      assert.strictEqual(this.lockExists('PRD-3'), true, 'PRD-3 lock should exist');

      // Release PRD-2
      this.runLock('release', ['PRD-2']);

      // PRD-1 and PRD-3 should remain
      assert.strictEqual(this.lockExists('PRD-1'), true, 'PRD-1 should remain');
      assert.strictEqual(this.lockExists('PRD-2'), false, 'PRD-2 should be removed');
      assert.strictEqual(this.lockExists('PRD-3'), true, 'PRD-3 should remain');
    });
  }

  /**
   * Test 12: Empty lock file handling
   */
  testEmptyLockFile() {
    this.test('Empty lock file - detected as stale', () => {
      // Create empty lock file
      writeFileSync(this.getLockPath('PRD-1'), '');

      // Should detect as stale
      const lockPath = this.getLockPath('PRD-1');
      const result = this.runLock('is-stale', [lockPath]);

      assert.strictEqual(result.output, 'true', 'Empty lock should be stale');
    });
  }

  /**
   * Test 13: Lock acquisition after cleanup
   */
  testLockAcquisitionAfterCleanup() {
    this.test('Lock acquisition after cleanup - succeeds', () => {
      // Create stale lock
      this.createFakeLock('PRD-1', 99997);

      // Cleanup stale lock
      const lockPath = this.getLockPath('PRD-1');
      this.runLock('cleanup-stale', [lockPath]);

      // Now try to acquire lock (should succeed)
      const result = this.runLock('acquire', ['PRD-1']);
      assert.strictEqual(result.output, 'success', 'Should acquire after cleanup');

      // Lock should exist with new PID
      assert.strictEqual(this.lockExists('PRD-1'), true, 'New lock should exist');
      const newPID = this.readLock('PRD-1');
      assert.notStrictEqual(newPID, '99997', 'Should have new PID');
    });
  }

  /**
   * Test 14: Lock persistence across checks
   */
  testLockPersistence() {
    this.test('Lock persistence - survives multiple checks', () => {
      // Create lock with running PID
      const pid = this.spawnBackgroundProcess();

      try {
        this.createFakeLock('PRD-1', pid);
        const originalPID = this.readLock('PRD-1');

        // Check is-running multiple times
        for (let i = 0; i < 5; i++) {
          const result = this.runLock('is-running', ['PRD-1']);
          assert.strictEqual(result.output, 'true', `Check ${i + 1} should show running`);
        }

        // Lock should still exist with same PID
        assert.strictEqual(this.lockExists('PRD-1'), true, 'Lock should persist');
        assert.strictEqual(this.readLock('PRD-1'), originalPID, 'PID should not change');
      } finally {
        this.killProcess(pid);
      }
    });
  }

  /**
   * Test 15: Stale lock auto-cleanup on acquire
   */
  testStaleAutoCleanupOnAcquire() {
    this.test('Stale lock auto-cleanup on acquire', () => {
      // Create stale lock
      this.createFakeLock('PRD-1', 99996);
      assert.strictEqual(this.lockExists('PRD-1'), true, 'Stale lock should exist');

      // Try to acquire (should auto-cleanup stale and succeed)
      const result = this.runLock('acquire', ['PRD-1']);

      // Should succeed after cleaning stale lock
      assert.strictEqual(result.output, 'success', 'Should acquire after auto-cleanup');

      // Lock should exist with new valid PID
      const newPID = this.readLock('PRD-1');
      assert.notStrictEqual(newPID, '99996', 'Should have new PID after cleanup');
    });
  }

  /**
   * Clean up test environment
   */
  cleanup() {
    if (this.testDir && existsSync(this.testDir)) {
      rmSync(this.testDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test directory`);
    }
  }

  /**
   * Run all tests
   */
  async runAll() {
    console.log('\n🧪 Lock Mechanism Tests (Layer 4)\n');
    console.log('═══════════════════════════════════════════════════════\n');

    try {
      // Setup
      this.setupTestRepo();
      this.createLockFunctions();

      // Run tests
      this.testAcquireLock();
      this.testReleaseLock();
      this.testIsStreamRunning();
      this.testConcurrentSamePRD();
      this.testConcurrentDifferentPRDs();
      this.testStaleLockDetection();
      this.testStaleLockCleanup();
      this.testValidLockNotCleaned();
      this.testLockFileContent();
      this.testLockDirectoryCreation();
      this.testMultipleLocksIndependence();
      this.testEmptyLockFile();
      this.testLockAcquisitionAfterCleanup();
      this.testLockPersistence();
      this.testStaleAutoCleanupOnAcquire();

      // Results
      console.log('\n═══════════════════════════════════════════════════════');
      console.log(`\n✅ Passed: ${this.passCount}`);
      console.log(`❌ Failed: ${this.failCount}`);
      console.log(`📊 Total:  ${this.passCount + this.failCount}\n`);

      if (this.failCount > 0) {
        process.exit(1);
      }
    } finally {
      this.cleanup();
    }
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new LockMechanismTest();
  tester.runAll().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export default LockMechanismTest;
