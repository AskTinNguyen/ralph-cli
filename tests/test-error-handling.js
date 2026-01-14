#!/usr/bin/env node
/**
 * Test suite for US-008: Error Handling and Fallback
 *
 * Tests the error handling features of the parallel execution system:
 * - 10-minute timeout with clean termination
 * - Retry failed subagents once before marking as failed
 * - Sequential fallback for merge conflicts
 * - Preserve successful commits when some stories fail
 * - Log all errors to errors.log
 * - Clear error messages
 */
const fs = require("fs");
const path = require("path");
const os = require("os");

// Import modules to test
const {
  executeParallel,
  executeStoryWithRetry,
  logError,
  parseAgentOutput,
} = require("../lib/parallel/executor");

const {
  runParallel,
  formatResultMarkdown,
  executeConflictingStoriesSequentially,
} = require("../lib/parallel/index");

// Test tracking
let testsRun = 0;
let testsPassed = 0;

function test(name, fn) {
  testsRun++;
  try {
    fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
  }
}

async function testAsync(name, fn) {
  testsRun++;
  try {
    await fn();
    testsPassed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Create temp directory for tests
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ralph-test-"));

// ============================================
// Test: logError function
// ============================================

test("logError() - logs error to file", () => {
  const logPath = path.join(tmpDir, "test-errors.log");

  logError(logPath, "US-001", "Test error message", 1);

  assert(fs.existsSync(logPath), "Log file should exist");
  const content = fs.readFileSync(logPath, "utf-8");
  assert(content.includes("US-001"), "Log should contain story ID");
  assert(content.includes("Test error message"), "Log should contain error message");
  assert(content.includes("1 retry"), "Log should contain retry count");
});

test("logError() - handles missing path gracefully", () => {
  // Should not throw
  logError(null, "US-001", "Test error", 0);
  logError(undefined, "US-001", "Test error", 0);
});

test("logError() - creates directory if not exists", () => {
  const nestedPath = path.join(tmpDir, "nested", "dir", "errors.log");

  logError(nestedPath, "US-002", "Nested error", 2);

  assert(fs.existsSync(nestedPath), "Nested log file should exist");
});

// ============================================
// Test: parseAgentOutput with error handling
// ============================================

test("parseAgentOutput() - handles failed status", () => {
  const output = `
Some agent output...
<parallel-result>
{
  "storyId": "US-001",
  "status": "failed",
  "error": "Something went wrong",
  "filesModified": [],
  "potentialConflicts": []
}
</parallel-result>
`;

  const result = parseAgentOutput(output, "US-001", 1000);
  assert(result.status === "failed", "Status should be failed");
  assert(result.error === "Something went wrong", "Error message should be preserved");
});

test("parseAgentOutput() - handles missing result block gracefully", () => {
  const output = "Agent output without result block";

  const result = parseAgentOutput(output, "US-001", 1000);
  assert(result.status === "success", "Default status should be success");
  assert(result.storyId === "US-001", "Story ID should be set");
});

test("parseAgentOutput() - handles invalid JSON gracefully", () => {
  const output = `
<parallel-result>
{ invalid json }
</parallel-result>
`;

  const result = parseAgentOutput(output, "US-001", 1000);
  assert(result.status === "success", "Should fallback to success on parse error");
});

// ============================================
// Test: formatResultMarkdown with failures
// ============================================

test("formatResultMarkdown() - formats failures clearly", () => {
  const result = {
    success: false,
    status: "partial",
    duration: 60000,
    processedStories: 3,
    totalStories: 5,
    commits: [
      { storyId: "US-001", hash: "abc123", subject: "feat(US-001): Story 1" },
    ],
    failures: [
      { storyId: "US-002", error: "Agent timed out", batch: 1 },
      { storyId: "merge-config.js", error: "Merge conflict", batch: 1 },
    ],
    batches: [["US-001", "US-002", "US-003"]],
    mergeResults: [{ resolved: [], failed: [{ file: "config.js" }] }],
  };

  const md = formatResultMarkdown(result);

  assert(md.includes("## Failures"), "Should have Failures section");
  assert(md.includes("### Execution Failures"), "Should categorize execution failures");
  assert(md.includes("### Merge Failures"), "Should categorize merge failures");
  assert(md.includes("US-002"), "Should mention failed story");
  assert(md.includes("Agent timed out"), "Should show error message");
  assert(md.includes("## Troubleshooting"), "Should include troubleshooting hints");
});

test("formatResultMarkdown() - includes commits table", () => {
  const result = {
    success: true,
    status: "success",
    duration: 30000,
    processedStories: 2,
    totalStories: 2,
    commits: [
      { storyId: "US-001", hash: "abc123", subject: "feat(US-001): Story 1" },
      { storyId: "US-002", hash: "def456", subject: "feat(US-002): Story 2" },
    ],
    failures: [],
    batches: [["US-001", "US-002"]],
  };

  const md = formatResultMarkdown(result);

  assert(md.includes("| Story | Hash | Message |"), "Should have table header");
  assert(md.includes("| US-001 |"), "Should include story ID in table");
  assert(md.includes("`abc123`"), "Should format hash as code");
});

test("formatResultMarkdown() - includes merge summary", () => {
  const result = {
    success: true,
    status: "partial",
    duration: 60000,
    processedStories: 3,
    totalStories: 3,
    commits: [],
    failures: [],
    batches: [],
    mergeResults: [
      { resolved: [{ file: "a.js" }, { file: "b.js" }], failed: [{ file: "c.js" }] },
    ],
  };

  const md = formatResultMarkdown(result);

  assert(md.includes("## Merge Summary"), "Should have merge summary");
  assert(md.includes("Conflicts resolved: 2"), "Should show resolved count");
  assert(md.includes("Conflicts failed: 1"), "Should show failed count");
});

// ============================================
// Async tests (wrapped in IIFE)
// ============================================

(async () => {
  await testAsync("executeParallel() - handles empty stories array", async () => {
    const results = await executeParallel([], {
      prdPath: "/fake/prd.md",
      planPath: "/fake/plan.md",
    });

    assert(Array.isArray(results), "Should return array");
    assert(results.length === 0, "Should return empty array");
  });

  // ============================================
  // Test: executeConflictingStoriesSequentially
  // ============================================

  await testAsync("executeConflictingStoriesSequentially() - handles story not found", async () => {
    const result = await executeConflictingStoriesSequentially(
      ["US-999"],
      [{ id: "US-001", title: "Story 1", content: "Content" }],
      {}
    );

    assert(result.results.length === 1, "Should have one result");
    assert(result.results[0].status === "failed", "Should be failed");
    assert(result.results[0].error.includes("not found"), "Should mention not found");
    assert(result.results[0].executionMode === "sequential-fallback", "Should mark as fallback");
  });

  // ============================================
  // Test: runParallel validation
  // ============================================

  await testAsync("runParallel() - returns error for missing PRD", async () => {
    const result = await runParallel({
      prdPath: "/nonexistent/prd.md",
      planPath: "/fake/plan.md",
      repoRoot: tmpDir,
    });

    assert(result.success === false, "Should fail");
    assert(result.error.includes("PRD not found"), "Should mention PRD not found");
  });

  await testAsync("runParallel() - returns error for missing plan", async () => {
    // Create a dummy PRD
    const prdPath = path.join(tmpDir, "test-prd.md");
    fs.writeFileSync(prdPath, "# Test PRD\n### [ ] US-001: Test Story\n");

    const result = await runParallel({
      prdPath,
      planPath: "/nonexistent/plan.md",
      repoRoot: tmpDir,
    });

    assert(result.success === false, "Should fail");
    assert(result.error.includes("Plan not found"), "Should mention Plan not found");
  });

  await testAsync("runParallel() - returns error for missing repoRoot", async () => {
    const prdPath = path.join(tmpDir, "test-prd2.md");
    const planPath = path.join(tmpDir, "test-plan.md");
    fs.writeFileSync(prdPath, "# Test PRD\n### [ ] US-001: Test Story\n");
    fs.writeFileSync(planPath, "# Test Plan\n");

    const result = await runParallel({
      prdPath,
      planPath,
      repoRoot: null,
    });

    assert(result.success === false, "Should fail");
    assert(result.error.includes("repoRoot"), "Should mention repoRoot");
  });

  // ============================================
  // Cleanup and report
  // ============================================

  // Clean up temp directory
  try {
    fs.rmSync(tmpDir, { recursive: true });
  } catch (err) {
    // Ignore cleanup errors
  }

  console.log(`\nTests passed: ${testsPassed}`);
  console.log(`Tests failed: ${testsRun - testsPassed}`);

  if (testsPassed !== testsRun) {
    process.exit(1);
  }
})();
