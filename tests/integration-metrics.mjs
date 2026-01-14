/**
 * Integration tests for metrics aggregation (PRD-28, PRD-34)
 *
 * Tests metrics.jsonl aggregation, success rate calculation, cost estimation,
 * velocity trends, burndown chart data, and filtering.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-metrics.mjs
 * Or: npm run test:metrics
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const metricsLib = require(path.join(repoRoot, "lib", "estimate", "metrics.js"));

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

console.log("\nRunning Metrics Integration Tests");
console.log("==================================\n");

// Test 1: Metrics.jsonl aggregation
test("loadMetrics aggregates all records from metrics.jsonl", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "metrics-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    // Create sample metrics file
    const runsDir = path.join(prdFolder, "runs");
    mkdirSync(runsDir, { recursive: true });

    const metricsPath = path.join(runsDir, "metrics.jsonl");
    const records = [
      { timestamp: "2026-01-14T10:00:00Z", storyId: "US-001", status: "success", duration: 300, inputTokens: 1000, outputTokens: 500, agent: "claude" },
      { timestamp: "2026-01-14T11:00:00Z", storyId: "US-002", status: "success", duration: 400, inputTokens: 1500, outputTokens: 600, agent: "codex" },
      { timestamp: "2026-01-14T12:00:00Z", storyId: "US-003", status: "error", duration: 200, inputTokens: 800, outputTokens: 300, agent: "claude" },
    ];

    writeFileSync(metricsPath, records.map(r => JSON.stringify(r)).join("\n") + "\n");

    // Load metrics
    const result = metricsLib.loadMetrics(prdFolder);

    assert(result.success, "Load should succeed");
    assertEqual(result.metrics.length, 3, "Should load 3 metrics");
    assertEqual(result.skipped, 0, "Should skip 0 lines");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 2: Success rate calculation
test("getMetricsSummary calculates success rate correctly", () => {
  const metrics = [
    { status: "success", duration: 300 },
    { status: "success", duration: 400 },
    { status: "error", duration: 200 },
    { status: "success", duration: 350 },
  ];

  const summary = metricsLib.getMetricsSummary(metrics);

  assertEqual(summary.count, 4, "Should count 4 metrics");
  assertEqual(summary.successCount, 3, "Should have 3 successes");
  assertEqual(summary.errorCount, 1, "Should have 1 error");

  // Success rate should be 75% (3/4)
  const successRate = (summary.successCount / summary.count) * 100;
  assertEqual(Math.round(successRate), 75, "Success rate should be 75%");
});

// Test 3: Cost estimation from token counts
test("getMetricsSummary aggregates token counts for cost estimation", () => {
  const metrics = [
    { status: "success", inputTokens: 1000, outputTokens: 500 },
    { status: "success", inputTokens: 1500, outputTokens: 600 },
    { status: "error", inputTokens: 800, outputTokens: 300 },
  ];

  const summary = metricsLib.getMetricsSummary(metrics);

  assertEqual(summary.totalInputTokens, 3300, "Should sum input tokens");
  assertEqual(summary.totalOutputTokens, 1400, "Should sum output tokens");

  // Cost calculation (example: $0.003/1k input, $0.015/1k output for Claude Sonnet)
  const inputCost = (summary.totalInputTokens / 1000) * 0.003;
  const outputCost = (summary.totalOutputTokens / 1000) * 0.015;
  const totalCost = inputCost + outputCost;

  assert(totalCost > 0, "Should have non-zero cost");
  assert(totalCost < 1, "Should be under $1 for this sample");
});

// Test 4: Velocity trends (stories completed over time)
test("filterByDateRange supports velocity trend analysis", () => {
  const metrics = [
    { timestamp: "2026-01-10T10:00:00Z", storyId: "US-001", status: "success" },
    { timestamp: "2026-01-11T10:00:00Z", storyId: "US-002", status: "success" },
    { timestamp: "2026-01-12T10:00:00Z", storyId: "US-003", status: "success" },
    { timestamp: "2026-01-13T10:00:00Z", storyId: "US-004", status: "error" },
    { timestamp: "2026-01-14T10:00:00Z", storyId: "US-005", status: "success" },
  ];

  // Filter last 3 days
  const filtered = metricsLib.filterByDateRange(metrics, {
    start: "2026-01-12T00:00:00Z",
    end: "2026-01-14T23:59:59Z",
  });

  assertEqual(filtered.length, 3, "Should have 3 metrics in date range");

  // Count successful stories (velocity)
  const successfulStories = filtered.filter(m => m.status === "success").length;
  assertEqual(successfulStories, 2, "Should have 2 successful stories in range");
});

// Test 5: Burndown chart data (remaining stories over time)
test("filterByStory and getStoryAverages support burndown charts", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "metrics-test-"));
  const prdFolder = path.join(tmpDir, ".ralph", "PRD-1");

  try {
    // Create metrics with story completion timestamps
    const runsDir = path.join(prdFolder, "runs");
    mkdirSync(runsDir, { recursive: true });

    const metricsPath = path.join(runsDir, "metrics.jsonl");
    const records = [
      { timestamp: "2026-01-14T09:00:00Z", storyId: "US-001", status: "success", duration: 300 },
      { timestamp: "2026-01-14T10:00:00Z", storyId: "US-001", status: "success", duration: 320 },
      { timestamp: "2026-01-14T11:00:00Z", storyId: "US-002", status: "success", duration: 400 },
      { timestamp: "2026-01-14T12:00:00Z", storyId: "US-003", status: "error", duration: 200 },
    ];

    writeFileSync(metricsPath, records.map(r => JSON.stringify(r)).join("\n") + "\n");

    const { metrics } = metricsLib.loadMetrics(prdFolder);

    // Get story-specific metrics
    const us001Metrics = metricsLib.filterByStory(metrics, "US-001");
    assertEqual(us001Metrics.length, 2, "US-001 should have 2 iterations");

    // Get averages for estimation
    const us001Avg = metricsLib.getStoryAverages(metrics, "US-001");
    assert(us001Avg !== null, "Should have averages for US-001");
    assertEqual(us001Avg.sampleCount, 2, "Should have 2 successful samples");
    assertEqual(us001Avg.avgDuration, 310, "Average duration should be 310s");

    // Burndown: track unique completed stories over time
    const completedStories = new Set(
      metrics.filter(m => m.status === "success").map(m => m.storyId)
    );
    assertEqual(completedStories.size, 2, "Should have 2 unique completed stories");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 6: Filtering by PRD, date, agent
test("Multiple filter functions work together", () => {
  const metrics = [
    { timestamp: "2026-01-10T10:00:00Z", storyId: "US-001", status: "success", agent: "claude" },
    { timestamp: "2026-01-11T10:00:00Z", storyId: "US-002", status: "success", agent: "codex" },
    { timestamp: "2026-01-12T10:00:00Z", storyId: "US-003", status: "error", agent: "claude" },
    { timestamp: "2026-01-13T10:00:00Z", storyId: "US-004", status: "success", agent: "claude" },
  ];

  // Filter by agent
  const claudeMetrics = metricsLib.filterByAgent(metrics, "claude");
  assertEqual(claudeMetrics.length, 3, "Should have 3 Claude iterations");

  // Filter by status
  const successMetrics = metricsLib.filterByStatus(claudeMetrics, "success");
  assertEqual(successMetrics.length, 2, "Should have 2 successful Claude iterations");

  // Filter by date range
  const recentSuccess = metricsLib.filterByDateRange(successMetrics, {
    start: "2026-01-12T00:00:00Z",
  });
  assertEqual(recentSuccess.length, 1, "Should have 1 recent successful Claude iteration");
  assertEqual(recentSuccess[0].storyId, "US-004", "Should be US-004");
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

console.log("\n✓ All metrics tests passed!");
process.exit(0);
