/**
 * Integration tests for agent switcher (PRD-18, PRD-34)
 *
 * Tests fallback chain parsing, agent availability, next agent selection,
 * metrics-based routing, and build loop integration.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-switcher.mjs
 * Or: npm run test:switcher
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const switcher = require(path.join(repoRoot, "lib", "agents", "switcher.js"));

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

function assertArrayEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

console.log("\nRunning Agent Switcher Integration Tests");
console.log("=========================================\n");

// Enable test mode to mock agent availability (agents aren't installed in CI)
switcher.enableTestMode(['claude', 'codex', 'droid']);

// Test 1: Fallback chain parsing and order
test("parseChain handles various input formats correctly", () => {
  // Space-separated string
  const chain1 = switcher.parseChain("claude codex droid");
  assertArrayEqual(chain1, ["claude", "codex", "droid"], "Should parse space-separated string");

  // Multiple spaces
  const chain2 = switcher.parseChain("claude  codex   droid");
  assertArrayEqual(chain2, ["claude", "codex", "droid"], "Should handle multiple spaces");

  // Empty/null returns default
  const chain3 = switcher.parseChain("");
  assertArrayEqual(chain3, switcher.DEFAULT_CHAIN, "Empty string should return default chain");

  const chain4 = switcher.parseChain(null);
  assertArrayEqual(chain4, switcher.DEFAULT_CHAIN, "Null should return default chain");

  // Already array returns as-is
  const chain5 = switcher.parseChain(["custom1", "custom2"]);
  assert(Array.isArray(chain5), "Should accept array input");
});

// Test 2: Chain exhaustion returns null
test("getNextAgent returns null when all agents tried or unavailable", () => {
  // Create a chain with non-existent agents
  const fakeChain = ["nonexistent1", "nonexistent2", "nonexistent3"];

  // Starting from first agent
  const next1 = switcher.getNextAgent(fakeChain, "nonexistent1");
  assertEqual(next1, null, "Should return null when no agents are available");

  // Try with current agent not in chain
  const next2 = switcher.getNextAgent(fakeChain, "unknown");
  assertEqual(next2, null, "Should return null when starting agent not in chain and none available");

  // Empty chain
  const next3 = switcher.getNextAgent([], "claude");
  assertEqual(next3, null, "Should return null for empty chain");
});

// Test 3: Metrics-based agent selection
test("suggestAgentForStory uses historical metrics to recommend agent", () => {
  const metrics = [
    { storyId: "US-001", agent: "claude", status: "success", duration: 120 },
    { storyId: "US-002", agent: "claude", status: "success", duration: 150 },
    { storyId: "US-003", agent: "codex", status: "error", duration: 90 },
    { storyId: "US-004", agent: "claude", status: "success", duration: 110 },
    { storyId: "BUG-001", agent: "codex", status: "success", duration: 80 },
    { storyId: "BUG-002", agent: "codex", status: "success", duration: 75 },
  ];

  const chain = ["claude", "codex", "droid"];

  // Suggest for US- story type (claude has better track record)
  const suggestion1 = switcher.suggestAgentForStory("US-005", metrics, chain);
  assertEqual(suggestion1.agent, "claude", "Should suggest claude for US- stories based on success rate");
  assert(suggestion1.confidence > 0, "Should have confidence > 0 with data");
  assert(suggestion1.reason, "Should provide reason");
  assert(suggestion1.dataPoints > 0, "Should report number of data points");

  // Suggest for BUG- story type (codex has 100% success)
  const suggestion2 = switcher.suggestAgentForStory("BUG-003", metrics, chain);
  assertEqual(suggestion2.agent, "codex", "Should suggest codex for BUG- stories based on success rate");

  // Suggest for unknown story type (should use default)
  const suggestion3 = switcher.suggestAgentForStory("FEAT-001", metrics, chain);
  assert(suggestion3.agent, "Should return an agent even without data");
  assertEqual(suggestion3.dataPoints, 0, "Should report 0 data points for unknown type");
});

// Test 4: Build loop integration - validate chain configuration
test("validateChain checks agent availability and warns on issues", () => {
  // Test with default chain (at least one agent should be available in CI)
  const validation1 = switcher.validateChain(switcher.DEFAULT_CHAIN);
  assertEqual(validation1.valid, true, "Default chain should be valid (at least one agent available)");
  assert(Array.isArray(validation1.errors), "Should have errors array");
  assert(Array.isArray(validation1.warnings), "Should have warnings array");
  assert(Array.isArray(validation1.available), "Should list available agents");

  // Test with empty chain
  const validation2 = switcher.validateChain([]);
  assertEqual(validation2.valid, false, "Empty chain should be invalid");
  assert(validation2.errors.length > 0, "Should have error for empty chain");

  // Test with non-existent agents only
  const validation3 = switcher.validateChain(["fake1", "fake2"]);
  assertEqual(validation3.valid, false, "Chain with no available agents should be invalid");
  assert(validation3.errors.some((e) => e.includes("No agents")), "Should error when no agents available");

  // Test duplicate detection
  const validation4 = switcher.validateChain(["claude", "claude", "codex"]);
  assert(
    validation4.warnings.some((w) => w.includes("Duplicate")),
    "Should warn about duplicate agents"
  );
});

// Test 5: Verify behavior when no agents are available
test("handles scenario when no agents are available", () => {
  // Temporarily disable all agents
  switcher.enableTestMode([]);

  // getNextAgent should return null
  const next = switcher.getNextAgent(["claude", "codex"], "claude");
  assertEqual(next, null, "Should return null when no agents available");

  // validateChain should be invalid
  const validation = switcher.validateChain(["claude", "codex"]);
  assertEqual(validation.valid, false, "Chain should be invalid with no available agents");

  // suggestAgentForStory should return default with confidence 0
  const suggestion = switcher.suggestAgentForStory("US-001", [], ["claude"]);
  assertEqual(suggestion.confidence, 0, "Should have 0 confidence with no available agents");

  // Restore test mode with all agents
  switcher.enableTestMode(['claude', 'codex', 'droid']);
});

// Cleanup test mode
switcher.disableTestMode();

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

console.log("\n✓ All agent switcher tests passed!");
process.exit(0);
