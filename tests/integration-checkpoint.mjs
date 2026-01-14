/**
 * Integration tests for checkpoint system (PRD-11, PRD-34)
 *
 * Tests checkpoint save/load, rotation, resume flag, validation, and atomic writes.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-checkpoint.mjs
 * Or: npm run test:checkpoint
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkpointLib = require(path.join(repoRoot, "lib", "checkpoint", "index.js"));

// Track test results
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL");
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

console.log("\nRunning Checkpoint Integration Tests");
console.log("=====================================\n");

// Test 1: Save checkpoint writes valid JSON
test("saveCheckpoint writes valid JSON with required fields", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    const result = checkpointLib.saveCheckpoint(prdFolder, {
      prd_id: 1,
      iteration: 3,
      story_id: "US-001",
      git_sha: "abc123def456",
    });

    assert(result.success, "Save should succeed");
    assert(result.path, "Should return checkpoint path");
    assert(existsSync(result.path), "Checkpoint file should exist");

    const content = readFileSync(result.path, "utf8");
    const checkpoint = JSON.parse(content);

    assertEqual(checkpoint.prd_id, 1, "prd_id should be 1");
    assertEqual(checkpoint.iteration, 3, "iteration should be 3");
    assertEqual(checkpoint.story_id, "US-001", "story_id should be US-001");
    assertEqual(checkpoint.git_sha, "abc123def456", "git_sha should match");
    assert(checkpoint.version, "Should have version field");
    assert(checkpoint.created_at, "Should have created_at field");
    assert(checkpoint.loop_state, "Should have loop_state object");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 2: Load checkpoint restores state
test("loadCheckpoint restores saved checkpoint state", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    // Save a checkpoint
    const saveResult = checkpointLib.saveCheckpoint(prdFolder, {
      prd_id: 1,
      iteration: 5,
      story_id: "US-003",
      git_sha: "def789ghi012",
      loop_state: {
        agent: "codex",
        current_story: "US-003",
        stories_completed: ["US-001", "US-002"],
      },
    });

    assert(saveResult.success, "Save should succeed");

    // Load the checkpoint
    const loadResult = checkpointLib.loadCheckpoint(prdFolder);

    assert(loadResult.success, "Load should succeed");
    assert(loadResult.checkpoint, "Should return checkpoint object");
    assertEqual(loadResult.checkpoint.iteration, 5, "iteration should be 5");
    assertEqual(loadResult.checkpoint.story_id, "US-003", "story_id should be US-003");
    assertEqual(loadResult.checkpoint.loop_state.agent, "codex", "agent should be codex");
    assert(loadResult.checkpoint.loop_state, "Should preserve loop_state object");
    assertEqual(loadResult.checkpoint.loop_state.stories_completed.length, 2, "Should have 2 completed stories");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 3: Checkpoint rotation keeps max 3 files
test("rotateCheckpointHistory keeps only last 3 checkpoints", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    // Create 5 checkpoints - should only keep last 3
    for (let i = 1; i <= 5; i++) {
      const result = checkpointLib.saveCheckpoint(prdFolder, {
        prd_id: 1,
        iteration: i,
        story_id: `US-00${i}`,
        git_sha: `sha${i}00000`,
      });
      assert(result.success, `Save ${i} should succeed`);
    }

    const checkpointsDir = checkpointLib.getCheckpointsDir(prdFolder);
    assert(existsSync(checkpointsDir), "Checkpoints directory should exist");

    const historyFiles = readdirSync(checkpointsDir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.startsWith("checkpoint-") && f.name.endsWith(".json"));

    // Should have max 3 history files (oldest 2 were rotated out)
    assert(
      historyFiles.length <= checkpointLib.MAX_CHECKPOINT_HISTORY,
      `Should keep at most ${checkpointLib.MAX_CHECKPOINT_HISTORY} history files, found ${historyFiles.length}`
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 4: Resume flag behavior (via hasCheckpoint check)
test("hasCheckpoint correctly detects checkpoint presence", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    // Initially no checkpoint
    assertEqual(checkpointLib.hasCheckpoint(prdFolder), false, "Should return false when no checkpoint");

    // Save a checkpoint
    checkpointLib.saveCheckpoint(prdFolder, {
      prd_id: 1,
      iteration: 2,
      story_id: "US-001",
      git_sha: "test123",
    });

    // Now checkpoint exists
    assertEqual(checkpointLib.hasCheckpoint(prdFolder), true, "Should return true when checkpoint exists");

    // Clear checkpoint
    checkpointLib.clearCheckpoint(prdFolder);

    // Checkpoint removed
    assertEqual(checkpointLib.hasCheckpoint(prdFolder), false, "Should return false after clear");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 5: Atomic writes prevent corruption
test("saveCheckpoint uses atomic write (temp file + rename)", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    const result = checkpointLib.saveCheckpoint(prdFolder, {
      prd_id: 1,
      iteration: 1,
      story_id: "US-001",
      git_sha: "atomic123",
    });

    assert(result.success, "Save should succeed");

    const checkpointPath = checkpointLib.getCheckpointPath(prdFolder);
    const tempPath = `${checkpointPath}.tmp`;

    // Temp file should not exist after successful save (it was renamed)
    assert(!existsSync(tempPath), "Temp file should not exist after atomic rename");

    // Final checkpoint should exist
    assert(existsSync(checkpointPath), "Final checkpoint file should exist");

    // Verify it's valid JSON
    const content = readFileSync(checkpointPath, "utf8");
    const checkpoint = JSON.parse(content); // Should not throw
    assert(checkpoint.version, "Should have valid checkpoint structure");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Summary
console.log("\n" + "=".repeat(40));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log("\n✓ All checkpoint tests passed!");
process.exit(0);
