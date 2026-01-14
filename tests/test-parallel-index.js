/**
 * Test suite for lib/parallel/index.js (Main Orchestrator)
 */
const fs = require("fs");
const path = require("path");

// Test utilities
let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertExists(value, message) {
  if (value === undefined || value === null) {
    throw new Error(`${message}: expected value to exist`);
  }
}

// Load the module
const parallelModule = require("../lib/parallel");

// Test 1: Module exports all expected functions
test("module exports runParallel", () => {
  assertExists(parallelModule.runParallel, "runParallel should exist");
  assertEqual(typeof parallelModule.runParallel, "function", "runParallel type");
});

test("module exports formatResultMarkdown", () => {
  assertExists(parallelModule.formatResultMarkdown, "formatResultMarkdown should exist");
  assertEqual(typeof parallelModule.formatResultMarkdown, "function", "formatResultMarkdown type");
});

test("module re-exports submodule functions", () => {
  assertExists(parallelModule.parseStories, "parseStories should exist");
  assertExists(parallelModule.buildDependencyGraph, "buildDependencyGraph should exist");
  assertExists(parallelModule.getBatches, "getBatches should exist");
  assertExists(parallelModule.executeParallel, "executeParallel should exist");
  assertExists(parallelModule.detectConflicts, "detectConflicts should exist");
  assertExists(parallelModule.resolveConflicts, "resolveConflicts should exist");
  assertExists(parallelModule.commitStoriesSequentially, "commitStoriesSequentially should exist");
  assertExists(parallelModule.sortResultsByStoryId, "sortResultsByStoryId should exist");
});

// Test 2: runParallel handles missing PRD
test("runParallel handles missing PRD", async () => {
  const result = await parallelModule.runParallel({
    prdPath: "/nonexistent/prd.md",
    planPath: "/nonexistent/plan.md",
    repoRoot: "/tmp",
  });

  assertEqual(result.success, false, "should fail");
  assertEqual(result.error.includes("PRD not found"), true, "error should mention PRD");
});

// Test 3: runParallel handles missing plan
test("runParallel handles missing plan", async () => {
  // Use a real PRD path but fake plan
  const prdPath = path.join(__dirname, "..", ".ralph", "PRD-6", "prd.md");

  if (!fs.existsSync(prdPath)) {
    console.log("  (skipped - no PRD-6 available)");
    return;
  }

  const result = await parallelModule.runParallel({
    prdPath,
    planPath: "/nonexistent/plan.md",
    repoRoot: "/tmp",
  });

  assertEqual(result.success, false, "should fail");
  assertEqual(result.error.includes("Plan not found"), true, "error should mention plan");
});

// Test 4: runParallel requires repoRoot
test("runParallel requires repoRoot", async () => {
  const prdPath = path.join(__dirname, "..", ".ralph", "PRD-6", "prd.md");
  const planPath = path.join(__dirname, "..", ".ralph", "PRD-6", "plan.md");

  if (!fs.existsSync(prdPath)) {
    console.log("  (skipped - no PRD-6 available)");
    return;
  }

  const result = await parallelModule.runParallel({
    prdPath,
    planPath,
    // No repoRoot
  });

  assertEqual(result.success, false, "should fail");
  assertEqual(result.error.includes("repoRoot"), true, "error should mention repoRoot");
});

// Test 5: formatResultMarkdown generates proper markdown
test("formatResultMarkdown generates proper markdown", () => {
  const result = {
    success: true,
    status: "success",
    commits: [
      { storyId: "US-001", hash: "abc123", subject: "feat(US-001): First story" }
    ],
    failures: [],
    batches: [["US-001", "US-002"], ["US-003"]],
    totalStories: 3,
    processedStories: 1,
    duration: 5000,
  };

  const markdown = parallelModule.formatResultMarkdown(result);

  assertEqual(markdown.includes("# Parallel Execution Report"), true, "should have title");
  assertEqual(markdown.includes("**Status:** success"), true, "should have status");
  assertEqual(markdown.includes("## Commits"), true, "should have commits section");
  assertEqual(markdown.includes("abc123"), true, "should include commit hash");
  assertEqual(markdown.includes("## Batches"), true, "should have batches section");
});

// Test 6: formatResultMarkdown handles failures
test("formatResultMarkdown handles failures", () => {
  const result = {
    success: false,
    status: "failed",
    commits: [],
    failures: [
      { storyId: "US-001", error: "Test error" }
    ],
    batches: [],
    totalStories: 1,
    processedStories: 0,
    duration: 1000,
    error: "Overall failure reason",
  };

  const markdown = parallelModule.formatResultMarkdown(result);

  assertEqual(markdown.includes("## Failures"), true, "should have failures section");
  assertEqual(markdown.includes("US-001"), true, "should include story ID");
  assertEqual(markdown.includes("Test error"), true, "should include error message");
  assertEqual(markdown.includes("## Error"), true, "should have error section");
});

// Summary
console.log(`\nTests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);

process.exit(testsFailed > 0 ? 1 : 0);
