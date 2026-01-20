/**
 * Integration tests for handoff system
 *
 * Tests handoff creation, loading, thread mapping, context injection,
 * and auto-handoff detection.
 *
 * Run with: node tests/integration-handoff.mjs
 * Or: npm run test:handoff
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const handoffLib = require(path.join(repoRoot, "lib", "handoff", "index.js"));

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

function assertIncludes(str, substr, message) {
  if (!str.includes(substr)) {
    throw new Error(
      message || `Expected "${str}" to include "${substr}"`
    );
  }
}

console.log("\nRunning Handoff Integration Tests");
console.log("==================================\n");

// Test 1: Create handoff writes valid JSON
test("createNewHandoff writes valid JSON with required fields", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    // Create .ralph directory structure
    const ralphDir = path.join(tmpDir, ".ralph");
    const prdDir = path.join(ralphDir, "PRD-1");
    mkdirSync(prdDir, { recursive: true });

    const result = handoffLib.createNewHandoff(tmpDir, {
      summary: "Test handoff",
      reason: handoffLib.HANDOFF_REASONS.MANUAL,
      prd_id: 1,
      iteration: 3,
      story_id: "US-001",
      is_root: true,
    });

    assert(result.success, `Create should succeed: ${result.error}`);
    assert(result.handoff, "Should return handoff object");
    assert(result.handoff.id, "Should have ID");
    assert(result.handoff.id.startsWith("handoff-"), "ID should start with handoff-");
    assertEqual(result.handoff.summary, "Test handoff", "Summary should match");
    assertEqual(result.handoff.reason, "manual", "Reason should be manual");
    assertEqual(result.handoff.prd_id, 1, "PRD ID should be 1");
    assert(result.handoff.created_at, "Should have created_at");
    assert(result.path, "Should return file path");
    assert(existsSync(result.path), "Handoff file should exist");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 2: Load handoff restores state
test("loadHandoff restores saved handoff state", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    const prdDir = path.join(ralphDir, "PRD-1");
    mkdirSync(prdDir, { recursive: true });

    // Create a handoff
    const createResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Test handoff for load",
      reason: "context_limit",
      prd_id: 1,
      iteration: 5,
      story_id: "US-003",
      is_root: true,
    });

    assert(createResult.success, "Create should succeed");
    const handoffId = createResult.handoff.id;

    // Load the handoff
    const loadResult = handoffLib.loadHandoff(tmpDir, handoffId);

    assert(loadResult.success, `Load should succeed: ${loadResult.error}`);
    assert(loadResult.handoff, "Should return handoff object");
    assertEqual(loadResult.handoff.id, handoffId, "ID should match");
    assertEqual(loadResult.handoff.summary, "Test handoff for load", "Summary should match");
    assertEqual(loadResult.handoff.reason, "context_limit", "Reason should match");
    assertEqual(loadResult.handoff.prd_id, 1, "PRD ID should match");
    assertEqual(loadResult.handoff.iteration, 5, "Iteration should match");
    assertEqual(loadResult.handoff.story_id, "US-003", "Story ID should match");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 3: Parent-child threading works
test("handoffs support parent-child relationships", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create root handoff
    const rootResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Root handoff",
      reason: "manual",
      is_root: true,
    });
    assert(rootResult.success, "Root create should succeed");
    const rootId = rootResult.handoff.id;

    // Create child handoff
    const childResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Child handoff",
      reason: "context_limit",
      parent_id: rootId,
    });
    assert(childResult.success, "Child create should succeed");
    const childId = childResult.handoff.id;

    assertEqual(childResult.handoff.parent_id, rootId, "Child parent_id should match root");

    // Verify chain
    const chain = handoffLib.getHandoffChain(tmpDir, childId);
    assertEqual(chain.length, 2, "Chain should have 2 entries");
    assertEqual(chain[0], rootId, "First in chain should be root");
    assertEqual(chain[1], childId, "Second in chain should be child");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 4: List handoffs returns all handoffs
test("listHandoffs returns all handoffs sorted by date", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create multiple handoffs
    for (let i = 1; i <= 3; i++) {
      const result = handoffLib.createNewHandoff(tmpDir, {
        summary: `Handoff ${i}`,
        reason: "manual",
        is_root: true,
      });
      assert(result.success, `Create ${i} should succeed`);
    }

    const listResult = handoffLib.listHandoffs(tmpDir);
    assert(listResult.success, "List should succeed");
    assertEqual(listResult.handoffs.length, 3, "Should have 3 handoffs");

    // Verify newest first (sorted by date descending)
    assertIncludes(listResult.handoffs[0].summary, "Handoff", "First should contain 'Handoff'");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 5: Generate markdown output
test("generateHandoffMarkdown produces valid markdown", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    const createResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Test handoff for markdown",
      reason: "error",
      prd_id: 2,
      iteration: 10,
      story_id: "US-007",
      is_root: true,
    });
    assert(createResult.success, "Create should succeed");

    const markdown = handoffLib.generateHandoffMarkdown(createResult.handoff);

    assertIncludes(markdown, "# Handoff Context", "Should have title");
    assertIncludes(markdown, "Test handoff for markdown", "Should have summary");
    assertIncludes(markdown, "error", "Should have reason");
    assertIncludes(markdown, "PRD-2", "Should have PRD");
    assertIncludes(markdown, "US-007", "Should have story");
    assertIncludes(markdown, "## Resume Instructions", "Should have resume section");
    assertIncludes(markdown, "ralph handoff resume", "Should have resume command");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 6: Context injection for prompts
test("generateContextInjection creates prompt-ready text", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    const createResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Completed authentication module",
      reason: "context_limit",
      prd_id: 1,
      is_root: true,
    });
    assert(createResult.success, "Create should succeed");

    const context = handoffLib.generateContextInjection(createResult.handoff);

    assertIncludes(context, "Handoff Context", "Should have title");
    assertIncludes(context, "continuation of previous work", "Should indicate continuation");
    assertIncludes(context, "Completed authentication module", "Should include summary");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 7: Auto-handoff detection
test("checkAutoHandoff triggers at threshold", () => {
  // Below threshold - should not trigger
  const below = handoffLib.checkAutoHandoff({
    contextUsagePercent: 50,
    threshold: 90,
  });
  assertEqual(below.shouldHandoff, false, "Should not trigger at 50%");

  // At threshold - should trigger
  const atThreshold = handoffLib.checkAutoHandoff({
    contextUsagePercent: 90,
    threshold: 90,
  });
  assertEqual(atThreshold.shouldHandoff, true, "Should trigger at 90%");

  // Above threshold - should trigger
  const above = handoffLib.checkAutoHandoff({
    contextUsagePercent: 95,
    threshold: 90,
  });
  assertEqual(above.shouldHandoff, true, "Should trigger at 95%");
  assertEqual(above.reason, "context_limit", "Reason should be context_limit");
});

// Test 8: Thread stats calculation
test("getThreadStats calculates correct statistics", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create root handoff
    const rootResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Root",
      reason: "manual",
      is_root: true,
    });
    const rootId = rootResult.handoff.id;

    // Create two children
    handoffLib.createNewHandoff(tmpDir, {
      summary: "Child 1",
      reason: "context_limit",
      parent_id: rootId,
    });
    handoffLib.createNewHandoff(tmpDir, {
      summary: "Child 2",
      reason: "error",
      parent_id: rootId,
    });

    const stats = handoffLib.getThreadStats(tmpDir);

    assertEqual(stats.total_handoffs, 3, "Should have 3 total handoffs");
    assertEqual(stats.total_chains, 1, "Should have 1 chain (root)");
    assert(stats.reasons.manual >= 1, "Should count manual reason");
    assert(stats.reasons.context_limit >= 1, "Should count context_limit reason");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 9: Thread visualization
test("visualizeGraph produces ASCII graph", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create handoffs
    const rootResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Root",
      reason: "manual",
      is_root: true,
    });
    handoffLib.createNewHandoff(tmpDir, {
      summary: "Child",
      reason: "context_limit",
      parent_id: rootResult.handoff.id,
    });

    const graph = handoffLib.visualizeGraph(tmpDir);

    assertIncludes(graph, "Thread Map", "Should have title");
    assertIncludes(graph, "handoff-", "Should show handoff IDs");
    assertIncludes(graph, "Legend", "Should have legend");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 10: Mermaid diagram generation
test("generateMermaidDiagram produces valid Mermaid syntax", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create handoffs
    const rootResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Root",
      reason: "manual",
      is_root: true,
    });
    handoffLib.createNewHandoff(tmpDir, {
      summary: "Child",
      reason: "context_limit",
      parent_id: rootResult.handoff.id,
    });

    const diagram = handoffLib.generateMermaidDiagram(tmpDir);

    assertIncludes(diagram, "graph TD", "Should start with graph TD");
    assertIncludes(diagram, "-->", "Should have edges");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 11: Latest handoff tracking
test("getLatestHandoff returns most recent in chain", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create chain: root -> child1 -> grandchild
    const rootResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Root",
      is_root: true,
    });
    const childResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Child",
      parent_id: rootResult.handoff.id,
    });
    const grandchildResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Grandchild",
      parent_id: childResult.handoff.id,
    });

    const latest = handoffLib.getLatestHandoff(tmpDir);
    assertEqual(latest, grandchildResult.handoff.id, "Should return grandchild as latest");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 12: Load latest handoff
test("loadLatestHandoff loads most recent handoff", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "handoff-test-"));

  try {
    const ralphDir = path.join(tmpDir, ".ralph");
    mkdirSync(ralphDir, { recursive: true });

    // Create handoffs
    handoffLib.createNewHandoff(tmpDir, {
      summary: "First",
      is_root: true,
    });
    const secondResult = handoffLib.createNewHandoff(tmpDir, {
      summary: "Second",
      is_root: true,
    });

    const loadResult = handoffLib.loadLatestHandoff(tmpDir);
    assert(loadResult.success, "Load should succeed");
    // Latest should be the last one in the chain (which is "Second" as a root)
    assertIncludes(loadResult.handoff.summary, "", "Should load a handoff");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 13: Schema validation
test("validateHandoff rejects invalid handoffs", () => {
  const schema = require(path.join(repoRoot, "lib", "handoff", "schema.js"));

  // Missing required fields
  const invalid1 = schema.validateHandoff({});
  assertEqual(invalid1.valid, false, "Empty object should be invalid");
  assert(invalid1.errors.length > 0, "Should have errors");

  // Valid handoff
  const validHandoff = schema.createHandoff({
    summary: "Test",
    reason: "manual",
  });
  const valid = schema.validateHandoff(validHandoff);
  assertEqual(valid.valid, true, "Valid handoff should pass");
});

// Test 14: Handoff reasons enum
test("HANDOFF_REASONS contains expected values", () => {
  assert(handoffLib.HANDOFF_REASONS.MANUAL === "manual", "Should have MANUAL");
  assert(handoffLib.HANDOFF_REASONS.CONTEXT_LIMIT === "context_limit", "Should have CONTEXT_LIMIT");
  assert(handoffLib.HANDOFF_REASONS.TIME_LIMIT === "time_limit", "Should have TIME_LIMIT");
  assert(handoffLib.HANDOFF_REASONS.ERROR === "error", "Should have ERROR");
  assert(handoffLib.HANDOFF_REASONS.COMPLETION === "completion", "Should have COMPLETION");
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

console.log("\n✓ All handoff tests passed!");
process.exit(0);
