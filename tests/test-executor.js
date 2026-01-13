#!/usr/bin/env node
/**
 * Test suite for lib/parallel/executor.js
 */
const path = require("path");
const fs = require("fs");
const { executeParallel, parseAgentOutput, extractFilesFromOutput } = require("../lib/parallel/executor");

const testsPassed = [];
const testsFailed = [];

function test(name, fn) {
  try {
    fn();
    testsPassed.push(name);
    console.log(`✓ ${name}`);
  } catch (err) {
    testsFailed.push({ name, error: err.message });
    console.error(`✗ ${name}: ${err.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

// Test 1: parseAgentOutput with valid JSON result
test("parseAgentOutput() - parses valid JSON result", () => {
  const output = `
Some agent output here...

<parallel-result>
{
  "storyId": "US-001",
  "status": "success",
  "filesModified": ["lib/test.js", "src/index.ts"],
  "potentialConflicts": ["package.json"],
  "duration": 5000
}
</parallel-result>

More output...
  `;

  const result = parseAgentOutput(output, "US-001", 4500);

  assert(result.storyId === "US-001", "storyId should be US-001");
  assert(result.status === "success", "status should be success");
  assert(result.filesModified.length === 2, "should have 2 modified files");
  assert(result.filesModified.includes("lib/test.js"), "should include lib/test.js");
  assert(result.potentialConflicts.length === 1, "should have 1 conflict");
  assert(result.duration === 5000, "should use duration from JSON");
});

// Test 2: parseAgentOutput without result block
test("parseAgentOutput() - handles missing result block", () => {
  const output = `
Created file: lib/utils/helper.js
Modified file: src/main.ts
All done!
  `;

  const result = parseAgentOutput(output, "US-002", 3000);

  assert(result.storyId === "US-002", "storyId should be US-002");
  assert(result.status === "success", "status should default to success");
  assert(result.duration === 3000, "should use provided duration");
  // Should extract files from output
  assert(result.filesModified.length >= 1, "should extract at least 1 file");
});

// Test 3: extractFilesFromOutput
test("extractFilesFromOutput() - extracts files from text", () => {
  const output = `
Created file: lib/parallel/executor.js
Modified src/index.ts
Updated package.json
Working with \`tests/test-executor.js\` file
  `;

  const files = extractFilesFromOutput(output);

  assert(files.length >= 3, `should extract at least 3 files, got ${files.length}`);
  assert(files.includes("lib/parallel/executor.js"), "should include lib/parallel/executor.js");
  assert(files.includes("tests/test-executor.js"), "should include tests/test-executor.js");
});

// Test 4: parseAgentOutput with failed status
test("parseAgentOutput() - handles failed status", () => {
  const output = `
<parallel-result>
{
  "storyId": "US-003",
  "status": "failed",
  "filesModified": [],
  "potentialConflicts": [],
  "error": "Tests failed",
  "duration": 2000
}
</parallel-result>
  `;

  const result = parseAgentOutput(output, "US-003", 1500);

  assert(result.status === "failed", "status should be failed");
  assert(result.error === "Tests failed", "error should be set");
  assert(result.filesModified.length === 0, "should have no modified files");
});

// Test 5: executeParallel with empty stories
test("executeParallel() - handles empty stories array", async () => {
  const results = await executeParallel([], {
    agentCmd: "echo test",
    prdPath: "/tmp/prd.md",
    planPath: "/tmp/plan.md",
    repoRoot: "/tmp",
  });

  assert(Array.isArray(results), "should return an array");
  assert(results.length === 0, "should return empty array");
});

// Test 6: executeParallel missing required options
test("executeParallel() - throws on missing required options", async () => {
  let threw = false;
  try {
    await executeParallel([{ id: "US-001", title: "Test" }], {
      agentCmd: "echo test",
      // Missing prdPath and planPath
    });
  } catch (err) {
    threw = true;
    assert(err.message.includes("required"), "error should mention required");
  }
  assert(threw, "should throw error");
});

// Summary
console.log("\n" + "=".repeat(50));
console.log(`Tests passed: ${testsPassed.length}`);
console.log(`Tests failed: ${testsFailed.length}`);

if (testsFailed.length > 0) {
  console.log("\nFailed tests:");
  testsFailed.forEach(({ name, error }) => {
    console.log(`  - ${name}: ${error}`);
  });
  process.exit(1);
} else {
  console.log("\n✓ All tests passed!");
  process.exit(0);
}
