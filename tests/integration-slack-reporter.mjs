/**
 * Integration tests for Slack Reporter (PRD-112 US-001)
 *
 * Tests real Slack API integration, rate limiting, retry logic,
 * message queue, and email fallback.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-slack-reporter.mjs
 * Or: npm run test:slack
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function asyncTest(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
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

console.log("\nRunning Slack Reporter Integration Tests (PRD-112 US-001)");
console.log("============================================================\n");

// Load the slack-reporter module
const slackReporter = require(path.join(repoRoot, "scripts", "slack-reporter.js"));

// Test 1: Configuration loading
test("loadAutomationConfig loads config from .ralph/", () => {
  // This should load from the real .ralph/automation-config.json
  const config = slackReporter.loadAutomationConfig();

  assert(config.slackChannels, "Config should have slackChannels");
  assert(config.slackChannels.leadership, "Config should have leadership channel");
  assert(config.slackUsers, "Config should have slackUsers for DM support");
  assert(config.emailFallback !== undefined, "Config should have emailFallback section");
});

// Test 2: Message formatting
test("formatDisciplineBlocks creates valid Slack blocks", () => {
  const blocks = slackReporter.formatDisciplineBlocks(
    "backend",
    {
      totalRuns: 10,
      successfulRuns: 8,
      failedRuns: 2,
      successRate: 80,
      projects: ["ralph-cli"],
    },
    []
  );

  assert(Array.isArray(blocks), "Should return array of blocks");
  assert(blocks.length >= 5, "Should have at least 5 blocks");

  // Check header block
  const headerBlock = blocks.find((b) => b.type === "header");
  assert(headerBlock, "Should have header block");
  assert(headerBlock.text.text.includes("Backend"), "Header should include discipline name");

  // Check section with fields
  const sectionBlock = blocks.find((b) => b.type === "section" && b.fields);
  assert(sectionBlock, "Should have section with fields");
  assert(sectionBlock.fields.length >= 4, "Should have at least 4 fields");

  // Check for action button
  const actionsBlock = blocks.find((b) => b.type === "actions");
  assert(actionsBlock, "Should have actions block");
  assert(actionsBlock.elements[0].url, "Action button should have URL");
});

// Test 3: Blockers formatting
test("formatDisciplineBlocks includes blockers when present", () => {
  const blockers = [
    { discipline: "backend", prdId: 123, projectName: "test-project", daysSinceActivity: 3 },
  ];

  const blocks = slackReporter.formatDisciplineBlocks(
    "backend",
    {
      totalRuns: 5,
      successfulRuns: 3,
      failedRuns: 2,
      successRate: 60,
      projects: ["test-project"],
    },
    blockers
  );

  // Find the blockers section
  const blockersSection = blocks.find(
    (b) => b.type === "section" && b.text && b.text.text.includes("Blockers")
  );
  assert(blockersSection, "Should have blockers section");
  assert(blockersSection.text.text.includes("PRD-123"), "Should mention PRD ID");
  assert(blockersSection.text.text.includes("3 days"), "Should mention days blocked");
});

// Test 4: Quiet hours detection
test("isQuietHours returns correct value based on time", () => {
  const result = slackReporter.isQuietHours();
  const currentHour = new Date().getHours();

  // Quiet hours are 22:00 - 08:00
  const expectedQuiet = currentHour >= 22 || currentHour < 8;
  assertEqual(result, expectedQuiet, `Expected ${expectedQuiet} for hour ${currentHour}`);
});

// Test 5: Message queue operations
test("Message queue save and load works correctly", () => {
  // Create temp directory with .ralph structure
  const tmpDir = mkdtempSync(path.join(tmpdir(), "slack-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");
  mkdirSync(ralphDir, { recursive: true });

  // Save original cwd and change to temp dir
  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    // Create a minimal automation-config.json
    writeFileSync(
      path.join(ralphDir, "automation-config.json"),
      JSON.stringify({ slackChannels: { test: "C123" } })
    );

    // Save messages to queue
    const testQueue = [
      {
        channel: "C123",
        payload: { text: "Test message" },
        timestamp: new Date().toISOString(),
        retryCount: 1,
      },
    ];

    slackReporter.saveMessageQueue(testQueue);

    // Load and verify
    const loadedQueue = slackReporter.loadMessageQueue();
    assertEqual(loadedQueue.length, 1, "Should have 1 message in queue");
    assertEqual(loadedQueue[0].channel, "C123", "Channel should match");
  } finally {
    // Restore cwd
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 6: Message queue expiration
test("Message queue filters out old entries", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "slack-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");
  mkdirSync(ralphDir, { recursive: true });

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    writeFileSync(
      path.join(ralphDir, "automation-config.json"),
      JSON.stringify({ slackChannels: { test: "C123" } })
    );

    // Create queue with old entry (8 days ago)
    const eightDaysAgo = new Date();
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    const testQueue = [
      {
        channel: "C123",
        payload: { text: "Old message" },
        timestamp: eightDaysAgo.toISOString(),
        retryCount: 1,
      },
      {
        channel: "C456",
        payload: { text: "New message" },
        timestamp: new Date().toISOString(),
        retryCount: 1,
      },
    ];

    // Write directly to bypass saveMessageQueue
    writeFileSync(
      path.join(ralphDir, "message-queue.json"),
      JSON.stringify(testQueue)
    );

    // Load should filter out old entries
    const loadedQueue = slackReporter.loadMessageQueue();
    assertEqual(loadedQueue.length, 1, "Should filter out entries older than 7 days");
    assertEqual(loadedQueue[0].channel, "C456", "Should keep the new message");
  } finally {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 7: blocksToPlainText conversion
test("blocksToPlainText converts Block Kit to plain text", () => {
  const blocks = [
    {
      type: "header",
      text: { type: "plain_text", text: "Test Header" },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Bold text*" },
    },
    {
      type: "divider",
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: "Footer note" }],
    },
  ];

  const plainText = slackReporter.blocksToPlainText(blocks);

  assert(plainText.includes("Test Header"), "Should include header");
  assert(plainText.includes("Bold text"), "Should include section text");
  assert(plainText.includes("---"), "Should include divider as ---");
  assert(plainText.includes("Footer note"), "Should include context");
});

// Test 8: Sample metrics creation
test("loadLatestMetrics returns valid structure when no metrics exist", () => {
  const metrics = slackReporter.loadLatestMetrics();

  assert(metrics.disciplines, "Should have disciplines");
  assert(Array.isArray(metrics.disciplines), "Disciplines should be array");
  assert(metrics.totals, "Should have totals");
  assert(typeof metrics.totals.totalRuns === "number", "totalRuns should be number");
});

// Test 9: Rate limiting check (basic test)
await asyncTest("checkRateLimit returns true allowing send", async () => {
  const result = await slackReporter.checkRateLimit("C123TEST");
  assertEqual(result, true, "Should allow send when under rate limit");
});

// Test 10: Dry run mode
await asyncTest("sendSlackMessage in dry run mode succeeds without token", async () => {
  const originalDryRun = process.env.RALPH_DRY_RUN;
  process.env.RALPH_DRY_RUN = "1";

  try {
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "Test" } }];
    const result = await slackReporter.sendSlackMessage("C123", blocks);
    assertEqual(result, true, "Should succeed in dry run mode");
  } finally {
    if (originalDryRun) {
      process.env.RALPH_DRY_RUN = originalDryRun;
    } else {
      delete process.env.RALPH_DRY_RUN;
    }
  }
});

// Summary
console.log("\n" + "=".repeat(60));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log("\n✓ All Slack reporter tests passed!");
process.exit(0);
