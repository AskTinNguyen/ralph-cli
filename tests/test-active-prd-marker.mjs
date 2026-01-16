#!/usr/bin/env node

/**
 * Integration tests for Active PRD Marker (Layer 2)
 * Tests sequential mode enforcement in stream.sh
 *
 * Test scenarios:
 * 1. Sequential mode disabled - allows concurrent builds
 * 2. Sequential mode enabled - blocks concurrent PRDs
 * 3. Set active PRD marker - creates file correctly
 * 4. Clear active PRD marker - removes file
 * 5. Has active PRD - detects marker presence
 * 6. Is PRD active - checks specific PRD number
 * 7. Concurrent build attempt - blocks with error
 * 8. Marker cleanup on exit - trap removes marker
 * 9. Sequential builds allowed - PRD-1 then PRD-2
 * 10. PRD number formats - handles PRD-2 and 2
 * 11. Stale marker handling - detects stale markers
 * 12. Active PRD info display - shows correct PRD
 */

import { execSync, spawn } from 'child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import assert from 'assert';

class ActivePRDMarkerTest {
  constructor() {
    this.testDir = null;
    this.ralphDir = null;
    this.passCount = 0;
    this.failCount = 0;
  }

  /**
   * Set up a Ralph directory structure for testing
   */
  setupTestRepo() {
    // Create temp directory
    this.testDir = mkdtempSync(join(tmpdir(), 'ralph-marker-test-'));
    this.ralphDir = join(this.testDir, '.ralph');

    console.log(`📁 Test directory: ${this.testDir}`);

    // Create Ralph directory structure
    execSync(`mkdir -p "${this.ralphDir}/locks"`, { cwd: this.testDir });

    // Create PRD directories
    ['PRD-1', 'PRD-2', 'PRD-3'].forEach(prd => {
      const prdDir = join(this.ralphDir, prd);
      execSync(`mkdir -p "${prdDir}"`, { cwd: this.testDir });
      writeFileSync(join(prdDir, 'prd.md'), `# ${prd}\n`);
      writeFileSync(join(prdDir, 'plan.md'), `# Plan ${prd}\n`);
    });
  }

  /**
   * Extract and create test wrapper for Active PRD functions
   */
  createMarkerFunctions() {
    // Read stream.sh to extract functions
    const streamShPath = join(process.cwd(), '.agents/ralph/stream.sh');
    const streamShContent = readFileSync(streamShPath, 'utf8');

    // Extract the Active PRD Marker section (lines 449-501)
    // Start from ACTIVE_PRD_FILE definition, end at get_active_prd_info closing brace
    const startPattern = /ACTIVE_PRD_FILE="\$RALPH_DIR\/\.active-prd"/;
    const startMatch = streamShContent.search(startPattern);

    if (startMatch === -1) {
      throw new Error('Could not find ACTIVE_PRD_FILE definition in stream.sh');
    }

    // Find the end after get_active_prd_info function
    const endPattern = /get_active_prd_info\(\) \{[\s\S]*?\n\}/;
    const afterStart = streamShContent.slice(startMatch);
    const endMatch = afterStart.match(endPattern);

    if (!endMatch) {
      throw new Error('Could not find get_active_prd_info function in stream.sh');
    }

    const markerSection = afterStart.slice(0, afterStart.indexOf(endMatch[0]) + endMatch[0].length);

    // Create test wrapper script
    const testScript = `#!/bin/bash
set -euo pipefail

RALPH_DIR="${this.ralphDir}"

# Extract Active PRD Marker functions
${markerSection}

# Handle subcommands
case "\${1:-}" in
  get)
    get_active_prd
    ;;
  set)
    set_active_prd "\${2:-}"
    ;;
  clear)
    clear_active_prd
    ;;
  has)
    has_active_prd && echo "true" || echo "false"
    ;;
  is-active)
    is_prd_active "\${2:-}" && echo "true" || echo "false"
    ;;
  info)
    get_active_prd_info
    ;;
  *)
    echo "Usage: \$0 {get|set|clear|has|is-active|info} [prd]" >&2
    exit 1
    ;;
esac
`;

    const scriptPath = join(this.testDir, 'marker.sh');
    writeFileSync(scriptPath, testScript);
    execSync(`chmod +x "${scriptPath}"`, { cwd: this.testDir });

    return scriptPath;
  }

  /**
   * Helper to run marker script
   */
  runMarker(command, args = []) {
    const scriptPath = join(this.testDir, 'marker.sh');
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
   * Get marker file path
   */
  getMarkerPath() {
    return join(this.ralphDir, '.active-prd');
  }

  /**
   * Check if marker file exists
   */
  markerExists() {
    return existsSync(this.getMarkerPath());
  }

  /**
   * Read marker file content
   */
  readMarker() {
    if (!this.markerExists()) {
      return null;
    }
    return readFileSync(this.getMarkerPath(), 'utf8').trim();
  }

  /**
   * Simulate sequential mode check in cmd_build
   */
  checkSequentialMode(requestedPRD, sequentialMode = true) {
    // This simulates the check in stream.sh:1127-1149
    // Read stream.sh to extract functions
    const streamShPath = join(process.cwd(), '.agents/ralph/stream.sh');
    const streamShContent = readFileSync(streamShPath, 'utf8');

    // Extract the Active PRD Marker section
    const startPattern = /ACTIVE_PRD_FILE="\$RALPH_DIR\/\.active-prd"/;
    const startMatch = streamShContent.search(startPattern);
    const afterStart = streamShContent.slice(startMatch);
    const endPattern = /get_active_prd_info\(\) \{[\s\S]*?\n\}/;
    const endMatch = afterStart.match(endPattern);
    const markerSection = afterStart.slice(0, afterStart.indexOf(endMatch[0]) + endMatch[0].length);

    const checkScript = `#!/bin/bash
set -euo pipefail

RALPH_DIR="${this.ralphDir}"
RALPH_SEQUENTIAL_MODE="${sequentialMode}"

# Include marker functions
${markerSection}

# Simulate the check from cmd_build (stream.sh:1127-1149)
if [[ "\${RALPH_SEQUENTIAL_MODE:-false}" == "true" ]]; then
  if has_active_prd && ! is_prd_active "${requestedPRD}"; then
    active_prd=\$(get_active_prd_info)
    echo "BLOCKED: Another PRD is building: \$active_prd"
    exit 1
  fi
fi

echo "ALLOWED"
exit 0
`;

    const checkScriptPath = join(this.testDir, 'check-sequential.sh');
    writeFileSync(checkScriptPath, checkScript);
    execSync(`chmod +x "${checkScriptPath}"`, { cwd: this.testDir });

    try {
      const output = execSync(checkScriptPath, {
        cwd: this.testDir,
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return { allowed: true, output: output.trim() };
    } catch (error) {
      return {
        allowed: false,
        output: error.stdout?.toString().trim() || '',
        stderr: error.stderr?.toString().trim() || ''
      };
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
   * Test 1: Set active PRD marker - creates file correctly
   */
  testSetMarker() {
    this.test('Set active PRD marker - creates file', () => {
      // Set PRD-2 as active
      const result = this.runMarker('set', ['PRD-2']);
      assert.strictEqual(result.success, true, 'Should succeed');

      // Check marker file exists
      assert.strictEqual(this.markerExists(), true, 'Marker file should exist');

      // Check marker content (should be just the number)
      const content = this.readMarker();
      assert.strictEqual(content, '2', 'Marker should contain PRD number');
    });
  }

  /**
   * Test 2: Set marker with numeric format
   */
  testSetMarkerNumeric() {
    this.test('Set marker with numeric format (2 vs PRD-2)', () => {
      // Clean any existing marker
      if (this.markerExists()) {
        unlinkSync(this.getMarkerPath());
      }

      // Set with numeric format
      const result = this.runMarker('set', ['2']);
      assert.strictEqual(result.success, true, 'Should succeed with numeric format');

      // Check content
      const content = this.readMarker();
      assert.strictEqual(content, '2', 'Marker should contain just the number');
    });
  }

  /**
   * Test 3: Get active PRD
   */
  testGetMarker() {
    this.test('Get active PRD - returns marker content', () => {
      // Set marker first
      this.runMarker('set', ['PRD-3']);

      // Get marker
      const result = this.runMarker('get');
      assert.strictEqual(result.success, true, 'Should succeed');
      assert.strictEqual(result.output, '3', 'Should return PRD number');
    });
  }

  /**
   * Test 4: Get when no marker exists
   */
  testGetNoMarker() {
    this.test('Get active PRD when none exists - returns empty', () => {
      // Clear marker
      if (this.markerExists()) {
        unlinkSync(this.getMarkerPath());
      }

      // Get marker
      const result = this.runMarker('get');
      assert.strictEqual(result.success, true, 'Should succeed');
      assert.strictEqual(result.output, '', 'Should return empty string');
    });
  }

  /**
   * Test 5: Clear active PRD marker
   */
  testClearMarker() {
    this.test('Clear active PRD marker - removes file', () => {
      // Set marker first
      this.runMarker('set', ['PRD-2']);
      assert.strictEqual(this.markerExists(), true, 'Marker should exist initially');

      // Clear marker
      const result = this.runMarker('clear');
      assert.strictEqual(result.success, true, 'Should succeed');

      // Check file removed
      assert.strictEqual(this.markerExists(), false, 'Marker file should be removed');
    });
  }

  /**
   * Test 6: Has active PRD - detects marker presence
   */
  testHasActivePRD() {
    this.test('Has active PRD - detects marker presence', () => {
      // Clear first
      if (this.markerExists()) {
        unlinkSync(this.getMarkerPath());
      }

      // Check when no marker
      let result = this.runMarker('has');
      assert.strictEqual(result.output, 'false', 'Should return false when no marker');

      // Set marker
      this.runMarker('set', ['PRD-2']);

      // Check when marker exists
      result = this.runMarker('has');
      assert.strictEqual(result.output, 'true', 'Should return true when marker exists');
    });
  }

  /**
   * Test 7: Is PRD active - checks specific PRD number
   */
  testIsPRDActive() {
    this.test('Is PRD active - checks specific PRD number', () => {
      // Set PRD-2 as active
      this.runMarker('set', ['PRD-2']);

      // Check if PRD-2 is active (should be true)
      let result = this.runMarker('is-active', ['PRD-2']);
      assert.strictEqual(result.output, 'true', 'PRD-2 should be active');

      // Check if PRD-3 is active (should be false)
      result = this.runMarker('is-active', ['PRD-3']);
      assert.strictEqual(result.output, 'false', 'PRD-3 should not be active');

      // Check with numeric format
      result = this.runMarker('is-active', ['2']);
      assert.strictEqual(result.output, 'true', 'Numeric format should work');
    });
  }

  /**
   * Test 8: Get active PRD info - formatted display
   */
  testGetActivePRDInfo() {
    this.test('Get active PRD info - formatted display', () => {
      // Clear first
      if (this.markerExists()) {
        unlinkSync(this.getMarkerPath());
      }

      // Check when no marker
      let result = this.runMarker('info');
      assert.strictEqual(result.output, 'none', 'Should return "none" when no active PRD');

      // Set marker
      this.runMarker('set', ['PRD-2']);

      // Check info
      result = this.runMarker('info');
      assert.strictEqual(result.output, 'PRD-2', 'Should return formatted PRD-N');
    });
  }

  /**
   * Test 9: Sequential mode disabled - allows concurrent builds
   */
  testSequentialModeDisabled() {
    this.test('Sequential mode disabled - allows concurrent builds', () => {
      // Set PRD-1 as active
      this.runMarker('set', ['PRD-1']);

      // Try to build PRD-2 with sequential mode OFF
      const result = this.checkSequentialMode('PRD-2', false);

      // Should be allowed
      assert.strictEqual(result.allowed, true, 'Should allow when sequential mode disabled');
      assert.match(result.output, /ALLOWED/, 'Should show ALLOWED message');
    });
  }

  /**
   * Test 10: Sequential mode enabled - blocks concurrent PRDs
   */
  testSequentialModeBlocks() {
    this.test('Sequential mode enabled - blocks concurrent PRDs', () => {
      // Set PRD-1 as active
      this.runMarker('set', ['PRD-1']);

      // Try to build PRD-2 with sequential mode ON
      const result = this.checkSequentialMode('PRD-2', true);

      // Should be blocked
      assert.strictEqual(result.allowed, false, 'Should block when another PRD is active');
      assert.match(result.output, /BLOCKED/, 'Should show BLOCKED message');
      assert.match(result.output, /PRD-1/, 'Should mention the active PRD');
    });
  }

  /**
   * Test 11: Sequential mode - allows same PRD to continue
   */
  testSequentialModeSamePRD() {
    this.test('Sequential mode - allows same PRD to continue', () => {
      // Set PRD-2 as active
      this.runMarker('set', ['PRD-2']);

      // Try to continue building PRD-2 (same PRD)
      const result = this.checkSequentialMode('PRD-2', true);

      // Should be allowed (same PRD can continue)
      assert.strictEqual(result.allowed, true, 'Should allow same PRD to continue');
      assert.match(result.output, /ALLOWED/, 'Should show ALLOWED message');
    });
  }

  /**
   * Test 12: Sequential mode - allows first PRD when none active
   */
  testSequentialModeFirstPRD() {
    this.test('Sequential mode - allows first PRD when none active', () => {
      // Clear any active marker
      if (this.markerExists()) {
        unlinkSync(this.getMarkerPath());
      }

      // Try to build PRD-1 when no PRD is active
      const result = this.checkSequentialMode('PRD-1', true);

      // Should be allowed (no active PRD to conflict with)
      assert.strictEqual(result.allowed, true, 'Should allow when no active PRD');
      assert.match(result.output, /ALLOWED/, 'Should show ALLOWED message');
    });
  }

  /**
   * Test 13: Marker cleanup simulation
   */
  testMarkerCleanup() {
    this.test('Marker cleanup - simulates trap on exit', () => {
      // Set marker
      this.runMarker('set', ['PRD-2']);
      assert.strictEqual(this.markerExists(), true, 'Marker should exist');

      // Simulate cleanup (what trap would do)
      this.runMarker('clear');

      // Check removed
      assert.strictEqual(this.markerExists(), false, 'Marker should be removed by cleanup');
    });
  }

  /**
   * Test 14: Marker persistence across operations
   */
  testMarkerPersistence() {
    this.test('Marker persistence - survives multiple reads', () => {
      // Set marker
      this.runMarker('set', ['PRD-3']);

      // Multiple reads shouldn't affect marker
      for (let i = 0; i < 5; i++) {
        const result = this.runMarker('get');
        assert.strictEqual(result.output, '3', `Read ${i + 1} should return 3`);
      }

      // Marker should still exist
      assert.strictEqual(this.markerExists(), true, 'Marker should persist');
      assert.strictEqual(this.readMarker(), '3', 'Content should remain unchanged');
    });
  }

  /**
   * Test 15: Overwriting active marker
   */
  testOverwriteMarker() {
    this.test('Overwrite marker - updates to new PRD', () => {
      // Set PRD-1
      this.runMarker('set', ['PRD-1']);
      assert.strictEqual(this.readMarker(), '1', 'Should be PRD-1');

      // Overwrite with PRD-2
      this.runMarker('set', ['PRD-2']);
      assert.strictEqual(this.readMarker(), '2', 'Should be updated to PRD-2');

      // Verify via get
      const result = this.runMarker('get');
      assert.strictEqual(result.output, '2', 'Get should return updated value');
    });
  }

  /**
   * Test 16: Sequential workflow - PRD-1 then PRD-2
   */
  testSequentialWorkflow() {
    this.test('Sequential workflow - PRD-1 completes, then PRD-2 starts', () => {
      // Clear initial state
      if (this.markerExists()) {
        unlinkSync(this.getMarkerPath());
      }

      // Step 1: Start PRD-1
      this.runMarker('set', ['PRD-1']);
      let result = this.checkSequentialMode('PRD-1', true);
      assert.strictEqual(result.allowed, true, 'PRD-1 should start');

      // Step 2: Try PRD-2 while PRD-1 is active (should block)
      result = this.checkSequentialMode('PRD-2', true);
      assert.strictEqual(result.allowed, false, 'PRD-2 should be blocked while PRD-1 active');

      // Step 3: PRD-1 completes (cleanup)
      this.runMarker('clear');

      // Step 4: PRD-2 starts (should succeed now)
      result = this.checkSequentialMode('PRD-2', true);
      assert.strictEqual(result.allowed, true, 'PRD-2 should start after PRD-1 completes');

      // Step 5: Set PRD-2 as active
      this.runMarker('set', ['PRD-2']);
      assert.strictEqual(this.readMarker(), '2', 'PRD-2 should now be active');
    });
  }

  /**
   * Test 17: Invalid PRD format handling
   */
  testInvalidPRDFormat() {
    this.test('Invalid PRD format - handles edge cases', () => {
      // Test with various formats
      this.runMarker('set', ['PRD-5']);
      assert.strictEqual(this.readMarker(), '5', 'Should extract number from PRD-5');

      // Numeric only
      this.runMarker('set', ['10']);
      assert.strictEqual(this.readMarker(), '10', 'Should handle numeric format');

      // The function extracts numbers, so "PRD-99" -> "99"
      this.runMarker('set', ['PRD-99']);
      assert.strictEqual(this.readMarker(), '99', 'Should handle large numbers');
    });
  }

  /**
   * Test 18: Concurrent PRD detection messages
   */
  testConcurrentPRDMessages() {
    this.test('Concurrent PRD messages - shows helpful info', () => {
      // Set PRD-1 as active
      this.runMarker('set', ['PRD-1']);

      // Try to start PRD-2
      const result = this.checkSequentialMode('PRD-2', true);

      // Check error message content
      assert.strictEqual(result.allowed, false, 'Should be blocked');
      assert.match(result.output, /BLOCKED/i, 'Should show BLOCKED');
      assert.match(result.output, /Another PRD/i, 'Should explain another PRD is building');
      assert.match(result.output, /PRD-1/, 'Should identify which PRD is active');
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
    console.log('\n🧪 Active PRD Marker Tests (Layer 2)\n');
    console.log('═══════════════════════════════════════════════════════\n');

    try {
      // Setup
      this.setupTestRepo();
      this.createMarkerFunctions();

      // Run tests
      this.testSetMarker();
      this.testSetMarkerNumeric();
      this.testGetMarker();
      this.testGetNoMarker();
      this.testClearMarker();
      this.testHasActivePRD();
      this.testIsPRDActive();
      this.testGetActivePRDInfo();
      this.testSequentialModeDisabled();
      this.testSequentialModeBlocks();
      this.testSequentialModeSamePRD();
      this.testSequentialModeFirstPRD();
      this.testMarkerCleanup();
      this.testMarkerPersistence();
      this.testOverwriteMarker();
      this.testSequentialWorkflow();
      this.testInvalidPRDFormat();
      this.testConcurrentPRDMessages();

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
  const tester = new ActivePRDMarkerTest();
  tester.runAll().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
  });
}

export default ActivePRDMarkerTest;
