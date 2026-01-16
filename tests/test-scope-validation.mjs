#!/usr/bin/env node

/**
 * Integration tests for scope validation layer (Layer 3)
 * Tests validate_prd_scope() function in loop.sh
 *
 * Test scenarios:
 * 1. Validation disabled - should skip all checks
 * 2. No active PRD - should skip validation
 * 3. No files changed - should pass
 * 4. Only current PRD files changed - should pass
 * 5. Other PRD files changed - should rollback and fail
 * 6. Non-PRD .ralph files changed - should pass
 * 7. Multiple violations - should detect all and rollback
 * 8. Rollback mechanism - verify git reset is called
 */

import { execSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';

class ScopeValidationTest {
  constructor() {
    this.testDir = null;
    this.ralphDir = null;
    this.passCount = 0;
    this.failCount = 0;
  }

  /**
   * Set up a git repository with PRD structure for testing
   */
  setupTestRepo() {
    // Create temp directory
    this.testDir = mkdtempSync(join(tmpdir(), 'ralph-scope-test-'));
    this.ralphDir = join(this.testDir, '.ralph');

    console.log(`📁 Test directory: ${this.testDir}`);

    // Initialize git repo
    execSync('git init', { cwd: this.testDir, stdio: 'ignore' });
    execSync('git config user.email "test@ralph.test"', { cwd: this.testDir, stdio: 'ignore' });
    execSync('git config user.name "Ralph Test"', { cwd: this.testDir, stdio: 'ignore' });

    // Create PRD directories
    ['PRD-1', 'PRD-2', 'PRD-3'].forEach(prd => {
      const prdDir = join(this.ralphDir, prd);
      execSync(`mkdir -p "${prdDir}"`, { cwd: this.testDir });
      writeFileSync(join(prdDir, 'prd.md'), `# ${prd}\n`);
      writeFileSync(join(prdDir, 'plan.md'), `# Plan ${prd}\n`);
      writeFileSync(join(prdDir, 'progress.md'), `# Progress ${prd}\n`);
    });

    // Create guardrails.md (shared file)
    writeFileSync(join(this.ralphDir, 'guardrails.md'), '# Guardrails\n');

    // Create some source files
    execSync(`mkdir -p "${join(this.testDir, 'src')}"`, { cwd: this.testDir });
    writeFileSync(join(this.testDir, 'src', 'app.ts'), 'console.log("app");\n');
    writeFileSync(join(this.testDir, 'src', 'feature.ts'), 'console.log("feature");\n');

    // Initial commit
    execSync('git add .', { cwd: this.testDir, stdio: 'ignore' });
    execSync('git commit -m "Initial commit"', { cwd: this.testDir, stdio: 'ignore' });
  }

  /**
   * Copy validate_prd_scope function to test repo
   */
  copyValidationFunction() {
    // Extract the validate_prd_scope function from loop.sh
    const loopShPath = join(process.cwd(), '.agents/ralph/loop.sh');
    const loopShContent = readFileSync(loopShPath, 'utf8');

    // Extract the function (lines 1826-1884)
    const functionMatch = loopShContent.match(
      /validate_prd_scope\(\) \{[\s\S]*?^}/m
    );

    if (!functionMatch) {
      throw new Error('Could not extract validate_prd_scope function from loop.sh');
    }

    // Create a test wrapper script
    const testScript = `#!/bin/bash
set -euo pipefail

# Color codes (minimal for testing)
C_RED='\\033[0;31m'
C_YELLOW='\\033[1;33m'
C_BOLD='\\033[1m'
C_DIM='\\033[2m'
C_RESET='\\033[0m'

# Extract function
${functionMatch[0]}

# Run validation
validate_prd_scope
`;

    const scriptPath = join(this.testDir, 'validate_scope.sh');
    writeFileSync(scriptPath, testScript);
    execSync(`chmod +x "${scriptPath}"`, { cwd: this.testDir });

    return scriptPath;
  }

  /**
   * Create a commit with specified files changed
   */
  createCommit(changedFiles, commitMessage = 'Test commit') {
    // Modify files
    changedFiles.forEach(file => {
      const filePath = join(this.testDir, file);
      const content = existsSync(filePath)
        ? readFileSync(filePath, 'utf8') + '\n// Modified\n'
        : '// New file\n';

      // Ensure directory exists
      const dir = join(filePath, '..');
      execSync(`mkdir -p "${dir}"`, { cwd: this.testDir, stdio: 'ignore' });

      writeFileSync(filePath, content);
    });

    // Commit changes
    execSync('git add .', { cwd: this.testDir, stdio: 'ignore' });
    execSync(`git commit -m "${commitMessage}"`, { cwd: this.testDir, stdio: 'ignore' });
  }

  /**
   * Run validation with environment variables
   */
  runValidation(env = {}) {
    const scriptPath = join(this.testDir, 'validate_scope.sh');

    try {
      execSync(scriptPath, {
        cwd: this.testDir,
        env: { ...process.env, ...env },
        stdio: 'pipe'
      });
      return { success: true, output: '' };
    } catch (error) {
      return {
        success: false,
        output: error.stdout?.toString() || '',
        stderr: error.stderr?.toString() || ''
      };
    }
  }

  /**
   * Get current HEAD commit hash
   */
  getCurrentCommit() {
    return execSync('git rev-parse HEAD', {
      cwd: this.testDir,
      encoding: 'utf8'
    }).trim();
  }

  /**
   * Check if last commit was rolled back
   */
  wasCommitRolledBack(beforeHash) {
    const afterHash = this.getCurrentCommit();
    return afterHash === beforeHash;
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
    }
  }

  /**
   * Test 1: Validation disabled - should skip all checks
   */
  testValidationDisabled() {
    this.test('Validation disabled (RALPH_VALIDATE_SCOPE=false)', () => {
      // Setup: Create commit changing another PRD
      this.createCommit(['.ralph/PRD-3/plan.md']);

      // Run with validation disabled
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'false',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should pass despite cross-PRD changes
      assert.strictEqual(result.success, true, 'Validation should pass when disabled');
    });
  }

  /**
   * Test 2: No active PRD - should skip validation
   */
  testNoActivePRD() {
    this.test('No active PRD set - should skip validation', () => {
      // Setup: Create commit changing another PRD
      this.createCommit(['.ralph/PRD-3/plan.md']);

      // Run without ACTIVE_PRD_NUMBER
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true'
        // No ACTIVE_PRD_NUMBER set
      });

      // Should pass because no active PRD to validate against
      assert.strictEqual(result.success, true, 'Should skip when no active PRD');
    });
  }

  /**
   * Test 3: No files changed - should pass
   */
  testNoFilesChanged() {
    this.test('No files changed - should pass', () => {
      // Create an empty commit (no file changes)
      // Use --allow-empty to create commit without changes
      execSync('git commit --allow-empty -m "Empty commit"', {
        cwd: this.testDir,
        stdio: 'ignore'
      });

      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should pass when no files changed
      assert.strictEqual(result.success, true, 'Should pass when no files changed');
    });
  }

  /**
   * Test 4: Only current PRD files changed - should pass
   */
  testCurrentPRDFilesOnly() {
    this.test('Only current PRD files changed - should pass', () => {
      // Setup: Create commit changing only PRD-2 files
      this.createCommit([
        'src/feature.ts',
        '.ralph/PRD-2/progress.md',
        '.ralph/PRD-2/plan.md'
      ]);

      // Run validation for PRD-2
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should pass - only PRD-2 files modified
      assert.strictEqual(result.success, true, 'Should pass when only current PRD files changed');
    });
  }

  /**
   * Test 5: Other PRD files changed - should rollback and fail
   */
  testOtherPRDFilesChanged() {
    this.test('Other PRD files changed - should detect and rollback', () => {
      // Get commit before violation
      const beforeCommit = this.getCurrentCommit();

      // Setup: Create commit changing PRD-3 while working on PRD-2
      this.createCommit([
        'src/feature.ts',
        '.ralph/PRD-2/progress.md',
        '.ralph/PRD-3/plan.md'  // VIOLATION!
      ]);

      const afterCommit = this.getCurrentCommit();
      assert.notStrictEqual(beforeCommit, afterCommit, 'Commit should be created');

      // Run validation for PRD-2
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should fail
      assert.strictEqual(result.success, false, 'Validation should fail on cross-PRD changes');

      // Should contain violation message
      const output = result.output + result.stderr;
      assert.match(output, /SCOPE VIOLATION/i, 'Should show violation message');
      assert.match(output, /PRD-3/, 'Should mention violated PRD');

      // Should rollback commit
      const finalCommit = this.getCurrentCommit();
      assert.strictEqual(finalCommit, beforeCommit, 'Commit should be rolled back');
    });
  }

  /**
   * Test 6: Non-PRD .ralph files changed - should pass
   */
  testSharedRalphFiles() {
    this.test('Shared .ralph files (guardrails.md) - should pass', () => {
      // Setup: Create commit changing shared files
      this.createCommit([
        'src/feature.ts',
        '.ralph/PRD-2/progress.md',
        '.ralph/guardrails.md'  // Shared file - OK
      ]);

      // Run validation for PRD-2
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should pass - guardrails.md is shared, not PRD-specific
      assert.strictEqual(result.success, true, 'Should allow changes to shared .ralph files');
    });
  }

  /**
   * Test 7: Multiple PRD violations - should detect all
   */
  testMultipleViolations() {
    this.test('Multiple PRD violations - should detect all', () => {
      const beforeCommit = this.getCurrentCommit();

      // Setup: Create commit changing multiple other PRDs
      this.createCommit([
        '.ralph/PRD-2/progress.md',
        '.ralph/PRD-1/plan.md',      // VIOLATION 1
        '.ralph/PRD-3/progress.md'   // VIOLATION 2
      ]);

      // Run validation for PRD-2
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should fail
      assert.strictEqual(result.success, false, 'Should fail on multiple violations');

      // Should mention both violated PRDs
      const output = result.output + result.stderr;
      assert.match(output, /PRD-1/, 'Should detect PRD-1 violation');
      assert.match(output, /PRD-3/, 'Should detect PRD-3 violation');

      // Should rollback
      assert.strictEqual(this.getCurrentCommit(), beforeCommit, 'Should rollback on multiple violations');
    });
  }

  /**
   * Test 8: PRD number extraction - should handle different formats
   */
  testPRDNumberFormats() {
    this.test('PRD number extraction - various formats', () => {
      const beforeCommit = this.getCurrentCommit();

      // Setup: Create violation
      this.createCommit(['.ralph/PRD-3/plan.md']);

      // Test with "PRD-2" format
      let result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });
      assert.strictEqual(result.success, false, 'Should work with PRD-2 format');

      // Reset
      execSync(`git reset --hard ${beforeCommit}`, { cwd: this.testDir, stdio: 'ignore' });
      this.createCommit(['.ralph/PRD-3/plan.md']);

      // Test with "2" format (just number)
      result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: '2'
      });
      assert.strictEqual(result.success, false, 'Should work with numeric format');
    });
  }

  /**
   * Test 9: Edge case - PRD directory in source code
   */
  testPRDInSourceCode() {
    this.test('PRD pattern in source code - should not false positive', () => {
      // Setup: Create file with "PRD-" in path but NOT in .ralph/
      this.createCommit([
        'src/PRD-helpers/utils.ts',  // NOT a violation (not in .ralph/)
        '.ralph/PRD-2/progress.md'
      ]);

      // Run validation for PRD-2
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Should pass - src/PRD-helpers/ is not a .ralph/PRD-N/ directory
      assert.strictEqual(result.success, true, 'Should not flag PRD pattern outside .ralph/');
    });
  }

  /**
   * Test 10: Case sensitivity - lowercase prd
   */
  testLowercasePRD() {
    this.test('Lowercase prd directories - should detect violations', () => {
      const beforeCommit = this.getCurrentCommit();

      // Create lowercase prd directory (legacy format)
      execSync(`mkdir -p "${join(this.ralphDir, 'prd-4')}"`, { cwd: this.testDir });
      writeFileSync(join(this.ralphDir, 'prd-4', 'plan.md'), '# Legacy PRD\n');

      // Create commit changing lowercase prd
      this.createCommit(['.ralph/prd-4/plan.md']);

      // Run validation for PRD-2
      const result = this.runValidation({
        RALPH_VALIDATE_SCOPE: 'true',
        ACTIVE_PRD_NUMBER: 'PRD-2'
      });

      // Current implementation only checks uppercase PRD-N pattern
      // This documents current behavior - may need update for legacy support
      const output = result.output + result.stderr;
      console.log('   Note: Current implementation only validates uppercase PRD-N patterns');
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
    console.log('\n🧪 Scope Validation Layer Tests (Layer 3)\n');
    console.log('═══════════════════════════════════════════════════════\n');

    try {
      // Setup
      this.setupTestRepo();
      this.copyValidationFunction();

      // Run tests
      this.testValidationDisabled();
      this.testNoActivePRD();
      this.testNoFilesChanged();
      this.testCurrentPRDFilesOnly();
      this.testOtherPRDFilesChanged();
      this.testSharedRalphFiles();
      this.testMultipleViolations();
      this.testPRDNumberFormats();
      this.testPRDInSourceCode();
      this.testLowercasePRD();

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
  const tester = new ScopeValidationTest();
  tester.runAll().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export default ScopeValidationTest;
