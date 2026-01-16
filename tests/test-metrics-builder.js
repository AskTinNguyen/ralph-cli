#!/usr/bin/env node
/**
 * Tests for metrics builder module (US-014)
 *
 * Run with: node tests/test-metrics-builder.js
 */

const { loadMetrics } = require("../lib/estimate/metrics");
const { buildMetrics, serializeMetrics, parseMetricsInput, validateMetrics } = require("../lib/metrics/builder");
const { parseMetricsLine, createMetricsRecord } = require("../lib/estimate/schema");
const { METRICS_SCHEMA, ALL_METRICS_FIELDS } = require("../lib/metrics/schema");

let passed = 0;
let failed = 0;

function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL");
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("\nMetrics Builder Tests (US-014)");
console.log("================================\n");

// Test 1: Build basic record
test("buildMetrics creates valid record with required fields", () => {
  const record = buildMetrics({
    storyId: "US-001",
    status: "success",
    duration: 120,
    agent: "claude",
  });

  assert(record.storyId === "US-001", "storyId should be US-001");
  assert(record.status === "success", "status should be success");
  assert(record.duration === 120, "duration should be 120");
  assert(record.agent === "claude", "agent should be claude");
  assert(typeof record.timestamp === "string", "timestamp should be a string");
});

// Test 2: Handle null values
test("buildMetrics handles null values correctly", () => {
  const record = buildMetrics({
    storyId: "US-002",
    inputTokens: null,
    outputTokens: "null",
    switchCount: "",
    agents: null,
  });

  assert(record.inputTokens === null, "inputTokens should be null");
  assert(record.outputTokens === null, "outputTokens should be null");
  assert(record.switchCount === null, "switchCount should be null");
  assert(record.agents === null, "agents should be null");
});

// Test 3: Parse agents from comma-separated string
test("buildMetrics parses agents from comma-separated string", () => {
  const record = buildMetrics({
    storyId: "US-003",
    agents: "claude,codex,droid",
    switchCount: 2,
  });

  assert(Array.isArray(record.agents), "agents should be an array");
  assertEqual(record.agents, ["claude", "codex", "droid"], "agents should be parsed correctly");
  assert(record.switchCount === 2, "switchCount should be 2");
});

// Test 4: Parse JSON string input
test("parseMetricsInput parses JSON string", () => {
  const jsonStr = '{"storyId":"US-004","duration":100,"agent":"codex","status":"error"}';
  const record = parseMetricsInput(jsonStr);

  assert(record.storyId === "US-004", "storyId should be US-004");
  assert(record.duration === 100, "duration should be 100");
  assert(record.agent === "codex", "agent should be codex");
  assert(record.status === "error", "status should be error");
});

// Test 5: Validate valid record
test("validateMetrics accepts valid record", () => {
  const record = buildMetrics({
    storyId: "US-005",
    status: "success",
    agent: "claude",
  });

  const validation = validateMetrics(record);
  assert(validation.valid === true, "record should be valid");
  assert(validation.errors.length === 0, "should have no errors");
});

// Test 6: Validate invalid record
test("validateMetrics rejects invalid status", () => {
  const record = buildMetrics({
    storyId: "US-006",
    status: "invalid",
    agent: "claude",
  });

  const validation = validateMetrics(record);
  assert(validation.valid === false, "record should be invalid");
  assert(validation.errors.some((e) => e.includes("status")), "should have status error");
});

// Test 7: Serialize and parse round-trip
test("serializeMetrics output is parseable by existing schema", () => {
  const record = buildMetrics({
    storyId: "US-007",
    storyTitle: "Test story",
    duration: 300,
    inputTokens: 1000,
    outputTokens: 500,
    agent: "claude",
    model: "sonnet",
    status: "success",
    runId: "test-123",
    iteration: 1,
  });

  const serialized = serializeMetrics(record);
  const parsed = parseMetricsLine(serialized);

  assert(parsed !== null, "existing parser should parse the record");
  assert(parsed.storyId === "US-007", "storyId should match");
  assert(parsed.duration === 300, "duration should match");
});

// Test 8: Backward compatibility with existing metrics.jsonl
test("buildMetrics output is compatible with existing metrics format", () => {
  // Load existing metrics
  const result = loadMetrics(".ralph/PRD-67");
  if (!result.success || result.metrics.length === 0) {
    console.log("(skipped - no existing metrics)");
    passed--; // Don't count this test
    return;
  }

  const existing = result.metrics[0];

  // Rebuild using new builder
  const rebuilt = buildMetrics(existing);

  // Verify key fields match
  assert(rebuilt.storyId === existing.storyId, "storyId should match");
  assert(rebuilt.status === existing.status, "status should match");
  assert(rebuilt.agent === existing.agent, "agent should match");
  assert(rebuilt.duration === existing.duration, "duration should match");
});

// Test 9: Handle all schema fields
test("buildMetrics handles all schema fields", () => {
  const fullRecord = buildMetrics({
    storyId: "US-009",
    storyTitle: "Full record test",
    duration: 500,
    inputTokens: 2000,
    outputTokens: 1000,
    agent: "claude",
    model: "opus",
    status: "success",
    runId: "full-test-001",
    iteration: 5,
    retryCount: 2,
    retryTime: 30,
    complexityScore: 7.5,
    routingReason: "high complexity",
    estimatedCost: 0.50,
    actualCost: 0.48,
    rollbackCount: 1,
    rollbackReason: "test failure",
    rollbackSuccess: true,
    switchCount: 1,
    agents: ["claude", "codex"],
    failureType: "timeout",
    experimentName: "test-exp",
    experimentVariant: "control",
    experimentExcluded: false,
    testsPassed: true,
    lintClean: true,
    typeCheckClean: false,
    retryHistory: "attempt=1 status=error duration=10s|attempt=2 status=success duration=20s",
  });

  // Verify all values are set correctly
  assert(fullRecord.storyId === "US-009", "storyId should be set");
  assert(fullRecord.complexityScore === 7.5, "complexityScore should be set");
  assert(fullRecord.rollbackSuccess === true, "rollbackSuccess should be true");
  assert(fullRecord.testsPassed === true, "testsPassed should be true");
  assert(fullRecord.experimentName === "test-exp", "experimentName should be set");
  assert(fullRecord.retryHistory === "attempt=1 status=error duration=10s|attempt=2 status=success duration=20s", "retryHistory should be set");
});

// Test 10: Schema definitions are complete
test("METRICS_SCHEMA covers all expected fields", () => {
  const expectedFields = [
    "storyId", "timestamp", "storyTitle", "duration",
    "inputTokens", "outputTokens", "agent", "model",
    "status", "runId", "iteration", "retryCount", "retryTime",
  ];

  for (const field of expectedFields) {
    assert(METRICS_SCHEMA[field] !== undefined, `Schema should have ${field}`);
  }
});

// Test 11: Handles special characters in strings
test("buildMetrics escapes special characters in strings", () => {
  const record = buildMetrics({
    storyId: "US-011",
    storyTitle: 'Test "quoted" story with special chars: <>&',
    routingReason: "reason with 'quotes' and \"double quotes\"",
  });

  const serialized = serializeMetrics(record);
  const parsed = JSON.parse(serialized);

  assert(parsed.storyTitle.includes('"'), "storyTitle should preserve quotes");
  assert(parsed.routingReason.includes("'"), "routingReason should preserve single quotes");
});

// Summary
console.log("\n" + "=".repeat(40));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failed > 0) {
  process.exit(1);
}

console.log("\n✓ All metrics builder tests passed!");
