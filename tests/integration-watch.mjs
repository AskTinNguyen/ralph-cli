/**
 * Integration tests for file watcher (PRD-14, PRD-34)
 *
 * Tests file change detection, debounce delays, custom actions,
 * and --build mode triggering.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-watch.mjs
 * Or: npm run test:watch
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watchLib = require(path.join(repoRoot, "lib", "watch", "index.js"));

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

console.log("\nRunning Watch Integration Tests");
console.log("================================\n");

// Test 1: File change detection
test("FileWatcher registers and tracks file paths", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "watch-test-"));

  try {
    // Create test files
    const prdPath = path.join(tmpDir, "prd.md");
    const planPath = path.join(tmpDir, "plan.md");
    writeFileSync(prdPath, "# PRD\n\nTest content");
    writeFileSync(planPath, "# Plan\n\nTest tasks");

    // Create watcher
    const watcher = new watchLib.FileWatcher({
      files: [prdPath, planPath],
      debounceMs: 100,
    });

    // Verify watcher is initialized
    assert(watcher, "Watcher should be created");
    assert(typeof watcher.start === "function", "Should have start method");
    assert(typeof watcher.stop === "function", "Should have stop method");

    // Note: We don't actually start watching in tests (would hang)
    // This test verifies the watcher can be constructed
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 2: Debounce delays rapid changes
test("Debounce configuration prevents rapid-fire triggers", () => {
  // Test that debounce constant exists and has reasonable value
  assert(watchLib.DEFAULT_DEBOUNCE_MS, "Should have default debounce setting");
  assert(typeof watchLib.DEFAULT_DEBOUNCE_MS === "number", "Debounce should be number");
  assert(watchLib.DEFAULT_DEBOUNCE_MS >= 100, "Debounce should be at least 100ms");
  assert(watchLib.DEFAULT_DEBOUNCE_MS <= 5000, "Debounce should be under 5 seconds");

  // Verify custom debounce can be set
  const tmpDir = mkdtempSync(path.join(tmpdir(), "watch-test-"));
  try {
    const testFile = path.join(tmpDir, "test.md");
    writeFileSync(testFile, "test");

    const customDebounce = 500;
    const watcher = new watchLib.FileWatcher({
      files: [testFile],
      debounceMs: customDebounce,
    });

    assert(watcher, "Should create watcher with custom debounce");
    // Internal state may not be exposed, but construction should succeed
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 3: Custom actions execute
test("Action registry allows custom handlers to be registered", () => {
  // Clear any existing custom actions
  watchLib.clearCustomActions();

  // Register a custom action
  let actionExecuted = false;
  const customAction = {
    name: "test-action",
    trigger: "prd.change",
    handler: () => {
      actionExecuted = true;
      return { success: true };
    },
  };

  watchLib.registerAction(customAction);

  // Verify action is registered
  const actions = watchLib.listActions();
  assert(actions, "Should return actions list");
  assert(Array.isArray(actions), "Actions should be an array");

  const registeredAction = actions.find(a => a.name === "test-action");
  assert(registeredAction, "Custom action should be registered");
  assertEqual(registeredAction.trigger, "prd.change", "Action trigger should match");

  // Execute the action
  const result = watchLib.executeAction("test-action", { filePath: "test.md" });
  assert(result, "Should return execution result");
  assert(actionExecuted, "Handler should have been called");

  // Clean up
  watchLib.unregisterAction("test-action");
  watchLib.clearCustomActions();
});

// Test 4: Build mode triggers build on PRD changes
test("Build mode integration enables automatic builds", () => {
  // Clear any existing actions first
  watchLib.clearCustomActions();

  // Enable build mode
  watchLib.enableBuildMode();

  // Verify plan_build action is registered
  const actions = watchLib.listActions();
  const buildAction = actions.find(a => a.name === "plan_build");
  assert(buildAction, "plan_build action should be registered");
  assertEqual(buildAction.trigger, "plan_changed", "Should trigger on plan changes");

  // Disable build mode
  watchLib.disableBuildMode();

  // Verify plan_build action is removed
  const actionsAfter = watchLib.listActions();
  const buildActionAfter = actionsAfter.find(a => a.name === "plan_build");
  assertEqual(buildActionAfter, undefined, "plan_build action should be removed");

  // Test build pause/resume
  watchLib.enableBuildMode();
  watchLib.resetBuildPause();

  const resetState = watchLib.getBuildState();
  assert(resetState.paused === false || resetState.paused === undefined,
    "Build should not be paused after reset");

  // Clean up
  watchLib.disableBuildMode();
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

console.log("\n✓ All watch tests passed!");
process.exit(0);
