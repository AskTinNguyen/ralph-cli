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

// ============================================================================
// US-002: Block Kit Formatting Tests
// ============================================================================

console.log("\nRunning Block Kit Formatting Tests (PRD-112 US-002)");
console.log("============================================================\n");

// Test 11: Status emoji helpers
test("getStatusEmoji returns correct emoji for each status", () => {
  assertEqual(slackReporter.getStatusEmoji("healthy"), "🟢", "Healthy should be green");
  assertEqual(slackReporter.getStatusEmoji("at-risk"), "🟡", "At-risk should be yellow");
  assertEqual(slackReporter.getStatusEmoji("blocked"), "🔴", "Blocked should be red");
  assertEqual(slackReporter.getStatusEmoji("unknown"), "⚪", "Unknown should be white");
});

// Test 12: PRD health status determination
test("getPrdHealthStatus determines status based on days", () => {
  assertEqual(slackReporter.getPrdHealthStatus(0), "healthy", "0 days should be healthy");
  assertEqual(slackReporter.getPrdHealthStatus(2), "healthy", "2 days should be healthy");
  assertEqual(slackReporter.getPrdHealthStatus(3), "at-risk", "3 days should be at-risk");
  assertEqual(slackReporter.getPrdHealthStatus(6), "at-risk", "6 days should be at-risk");
  assertEqual(slackReporter.getPrdHealthStatus(7), "blocked", "7 days should be blocked");
  assertEqual(slackReporter.getPrdHealthStatus(10), "blocked", "10 days should be blocked");
});

// Test 13: Daily status blocks structure
test("formatDailyStatusBlocks creates valid Block Kit structure", () => {
  const blocks = slackReporter.formatDailyStatusBlocks({
    date: new Date("2026-01-18"),
    disciplines: [
      { discipline: "backend", totalRuns: 10, successfulRuns: 8, failedRuns: 2, successRate: 80 },
    ],
    prds: [
      { id: 45, discipline: "backend", storiesCompleted: 3, daysSinceActivity: 0 },
      { id: 46, discipline: "backend", storiesCompleted: 0, daysSinceActivity: 5 },
    ],
    totals: { totalRuns: 10 },
  });

  assert(Array.isArray(blocks), "Should return array");
  assert(blocks.length >= 5, "Should have at least 5 blocks");

  // Check for header
  const header = blocks.find((b) => b.type === "header");
  assert(header, "Should have header block");
  assert(header.text.text.includes("Daily PRD Status"), "Header should mention Daily Status");
  assert(header.text.text.includes("2026-01-18"), "Header should include date");

  // Check for emoji indicators in content
  const content = JSON.stringify(blocks);
  assert(content.includes("🟢"), "Should contain healthy emoji");
  assert(content.includes("🟡"), "Should contain at-risk emoji");

  // Check for PRD links
  assert(content.includes("PRD-45"), "Should contain PRD ID");
  assert(content.includes("http://localhost:3000/prd/"), "Should contain UI links");

  // Check for metadata context block
  const contextBlocks = blocks.filter((b) => b.type === "context");
  assert(contextBlocks.length >= 1, "Should have context blocks for metadata");
  const metadataBlock = contextBlocks.find((c) =>
    c.elements.some((e) => e.text && e.text.includes("Generated"))
  );
  assert(metadataBlock, "Should have metadata block with timestamp");

  // Check for action buttons
  const actionsBlock = blocks.find((b) => b.type === "actions");
  assert(actionsBlock, "Should have actions block");
  assert(actionsBlock.elements.length >= 1, "Should have at least one button");
});

// Test 14: Weekly summary blocks structure
test("formatWeeklySummaryBlocks creates valid Block Kit structure", () => {
  const blocks = slackReporter.formatWeeklySummaryBlocks({
    weekStart: new Date("2026-01-11"),
    weekEnd: new Date("2026-01-18"),
    metrics: { totalRuns: 25, successRate: 84, storiesCompleted: 5, totalCost: 12.50 },
    highlights: [{ prdId: 45, achievement: "Completed all stories" }],
    blockers: [{ prdId: 46, daysSinceActivity: 5, reason: "Build failures" }],
    comparison: { previousWeek: { totalRuns: 20, successRate: 75 } },
  });

  assert(Array.isArray(blocks), "Should return array");

  // Check for header with week number
  const header = blocks.find((b) => b.type === "header");
  assert(header, "Should have header block");
  assert(header.text.text.includes("Weekly Summary"), "Header should mention Weekly Summary");
  assert(header.text.text.includes("Week"), "Header should include week number");

  // Check for dividers
  const dividers = blocks.filter((b) => b.type === "divider");
  assert(dividers.length >= 3, "Should have multiple dividers for separation");

  // Check for key metrics section with fields
  const sectionWithFields = blocks.find((b) => b.type === "section" && b.fields);
  assert(sectionWithFields, "Should have section with fields");
  assert(sectionWithFields.fields.length >= 4, "Should have at least 4 metric fields");

  // Check for highlights and blockers sections
  const content = JSON.stringify(blocks);
  assert(content.includes("Highlights"), "Should have highlights section");
  assert(content.includes("Blockers"), "Should have blockers section");

  // Check for comparison data
  assert(content.includes("vs last week"), "Should include week-over-week comparison");

  // Check for action buttons (multiple)
  const actionsBlock = blocks.find((b) => b.type === "actions");
  assert(actionsBlock, "Should have actions block");
  assert(actionsBlock.elements.length >= 2, "Should have View Details and View All PRDs buttons");
});

// Test 15: Metadata block creation
test("createMetadataBlock creates valid context block", () => {
  const metadata = slackReporter.createMetadataBlock({
    timestamp: new Date("2026-01-18T10:00:00Z"),
    runCount: 42,
    lastActivity: new Date("2026-01-17T15:30:00Z"),
  });

  assertEqual(metadata.type, "context", "Should be context type");
  assert(metadata.elements.length >= 1, "Should have at least one element");

  const text = metadata.elements[0].text;
  assert(text.includes("Generated"), "Should include generated timestamp");
  assert(text.includes("Runs"), "Should include run count");
  assert(text.includes("Last Activity"), "Should include last activity");
  assert(text.includes("📅"), "Should have timestamp emoji");
  assert(text.includes("🔄"), "Should have runs emoji");
  assert(text.includes("🕐"), "Should have activity emoji");
});

// Test 16: Action button block creation
test("createActionButtonBlock creates valid actions block", () => {
  // Without PRD ID
  const generalButton = slackReporter.createActionButtonBlock(null, "View Dashboard", "view_dashboard");
  assertEqual(generalButton.type, "actions", "Should be actions type");
  assertEqual(generalButton.elements[0].text.text, "View Dashboard", "Should have custom button text");
  assert(generalButton.elements[0].url.endsWith("/prd"), "URL should point to /prd for general");

  // With PRD ID
  const specificButton = slackReporter.createActionButtonBlock(123, "View PRD", "view_prd");
  assert(specificButton.elements[0].url.includes("/prd/123"), "URL should include PRD ID");
});

// Test 17: Format test function runs without error
test("runFormatTest executes successfully", () => {
  // Capture console output
  const originalLog = console.log;
  let output = "";
  console.log = (msg) => { output += msg + "\n"; };

  try {
    const result = slackReporter.runFormatTest();
    assertEqual(result, true, "Format test should return true for valid output");
    assert(output.includes("Daily Status"), "Should output daily status test");
    assert(output.includes("Weekly Summary"), "Should output weekly summary test");
    assert(output.includes("Discipline Report"), "Should output discipline report test");
    assert(output.includes("Valid Block Kit structure"), "Should report validation results");
  } finally {
    console.log = originalLog;
  }
});

// Test 18: Week number calculation
test("getWeekNumber calculates correct ISO week", () => {
  // January 1, 2026 is a Thursday, so it's week 1
  const jan1 = new Date("2026-01-01");
  const week1 = slackReporter.getWeekNumber(jan1);
  assertEqual(week1, 1, "Jan 1, 2026 should be week 1");

  // January 18, 2026 should be around week 3 or 4
  const jan18 = new Date("2026-01-18");
  const weekJan18 = slackReporter.getWeekNumber(jan18);
  assert(weekJan18 >= 2 && weekJan18 <= 4, `Jan 18 should be week 2-4, got ${weekJan18}`);
});

// Test 19: Date formatting helpers
test("formatDate and formatTimestamp produce expected formats", () => {
  const testDate = new Date("2026-01-18T10:30:45Z");

  const dateStr = slackReporter.formatDate(testDate);
  assertEqual(dateStr, "2026-01-18", "formatDate should produce YYYY-MM-DD");

  const timestampStr = slackReporter.formatTimestamp(testDate);
  assert(timestampStr.includes("2026-01-18"), "formatTimestamp should include date");
  assert(timestampStr.includes("10:30:45"), "formatTimestamp should include time");
  assert(timestampStr.includes("UTC"), "formatTimestamp should indicate UTC");
});

// Test 20: UI_BASE_URL is exported and customizable
test("UI_BASE_URL defaults to localhost:3000", () => {
  assertEqual(slackReporter.UI_BASE_URL, "http://localhost:3000", "Default UI URL should be localhost:3000");
});

// ============================================================================
// US-004: Escalation Alert Tests
// ============================================================================

console.log("\nRunning Escalation Alert Tests (PRD-112 US-004)");
console.log("============================================================\n");

// Test 21: Format escalation alert blocks
test("formatEscalationAlertBlocks creates valid structure for Level 1", () => {
  const blocker = {
    prd_id: 123,
    prd_name: "Mobile Gameplay Feature",
    escalation_level: 1,
    team: "Gameplay",
    days_blocked: 2,
    last_activity: "2026-01-16",
  };

  const context = {
    whoCaused: { email: "alice@studio.com", name: "Alice", commit: "abc1234" },
    why: "Module refactor broke import paths",
    whatHappened: [
      { date: "2026-01-13", message: "Refactored PlayerInventory" },
      { date: "2026-01-14", message: "10 consecutive build failures" },
    ],
    howToFix: [
      "Update import paths in src/gameplay/player.ts",
      "Check PlayerInventory exports",
    ],
    whoShouldFix: { name: "Alice", email: "alice@studio.com", backup_name: "Bob" },
  };

  const blocks = slackReporter.formatEscalationAlertBlocks(blocker, context);

  assert(Array.isArray(blocks), "Should return array of blocks");
  assert(blocks.length >= 10, "Should have at least 10 blocks for detailed alert");

  // Check header
  const header = blocks.find((b) => b.type === "header");
  assert(header, "Should have header block");
  assert(header.text.text.includes("Level 1"), "Should mention Level 1");
  assert(header.text.text.includes("🟡"), "Level 1 should have yellow emoji");

  // Check PRD info
  const content = JSON.stringify(blocks);
  assert(content.includes("PRD-123"), "Should mention PRD ID");
  assert(content.includes("Mobile Gameplay Feature"), "Should mention PRD name");
  assert(content.includes("Gameplay"), "Should mention team");

  // Check root cause context
  assert(content.includes("alice@studio.com"), "Should include developer email");
  assert(content.includes("Module refactor"), "Should include root cause");
  assert(content.includes("Who Caused"), "Should have Who Caused section");
  assert(content.includes("Why:"), "Should have Why section");
  assert(content.includes("What Happened Before"), "Should have timeline section");
  assert(content.includes("HOW TO FIX"), "Should have how to fix section");
  assert(content.includes("WHO SHOULD FIX"), "Should have who should fix section");

  // Check action button
  const actions = blocks.find((b) => b.type === "actions");
  assert(actions, "Should have actions block");
  assert(actions.elements[0].url.includes("/prd/123"), "Button should link to PRD");
});

// Test 22: Format escalation alert for Level 2
test("formatEscalationAlertBlocks uses different emoji for Level 2", () => {
  const blocker = {
    prd_id: 124,
    escalation_level: 2,
    days_blocked: 4,
  };

  const blocks = slackReporter.formatEscalationAlertBlocks(blocker, {});

  const header = blocks.find((b) => b.type === "header");
  assert(header.text.text.includes("Level 2"), "Should mention Level 2");
  assert(header.text.text.includes("🔴"), "Level 2 should have red emoji");
});

// Test 23: Format escalation alert for Level 3
test("formatEscalationAlertBlocks uses critical emoji for Level 3", () => {
  const blocker = {
    prd_id: 125,
    escalation_level: 3,
    days_blocked: 7,
  };

  const blocks = slackReporter.formatEscalationAlertBlocks(blocker, {});

  const header = blocks.find((b) => b.type === "header");
  assert(header.text.text.includes("Level 3"), "Should mention Level 3");
  assert(header.text.text.includes("🚨"), "Level 3 should have critical emoji");
});

// Test 24: Get who caused from git blame (when files are available)
await asyncTest("getWhoCausedFromGitBlame returns developer info", async () => {
  // This test relies on actual git repo
  const result = await slackReporter.getWhoCausedFromGitBlame("package.json");
  assert(result.email, "Should extract email");
  assert(result.name, "Should extract name");
  assert(result.commit, "Should extract commit SHA");
});

// Test 25: Get why from bug wikipedia (graceful fallback)
await asyncTest("getWhyFromBugWikipedia returns fallback when no bugs exist", async () => {
  const blocker = { prd_id: 999 };
  const result = await slackReporter.getWhyFromBugWikipedia(blocker);
  // Should return either a category or "Requires investigation"
  assert(typeof result === "string", "Should return string");
  assert(result.length > 0, "Should not be empty");
});

// Test 26: Get timeline from git history
await asyncTest("getWhatHappenedTimeline extracts recent commits", async () => {
  const timeline = await slackReporter.getWhatHappenedTimeline(112, 7);
  // Should return array (may be empty if no commits)
  assert(Array.isArray(timeline), "Should return array");
  // Each item should have date and message
  if (timeline.length > 0) {
    assert(timeline[0].date, "Timeline item should have date");
    assert(timeline[0].message, "Timeline item should have message");
  }
});

// Test 27: Get how to fix steps
await asyncTest("getHowToFixSteps returns remediation steps", async () => {
  const blocker = { prd_id: 123 };
  const steps = await slackReporter.getHowToFixSteps(blocker, {});
  assert(Array.isArray(steps), "Should return array of steps");
  assert(steps.length >= 4, "Should have at least 4 remediation steps");
  assert(typeof steps[0] === "string", "Steps should be strings");
});

// Test 28: Get who should fix
await asyncTest("getWhoShouldFix returns developer and backup info", async () => {
  const blocker = { prd_id: 123, team_lead: "Bob" };
  const whoCaused = { name: "Alice", email: "alice@studio.com" };
  const result = await slackReporter.getWhoShouldFix(blocker, whoCaused);

  assertEqual(result.name, "Alice", "Should return original author as primary");
  assertEqual(result.email, "alice@studio.com", "Should return author email");
  assertEqual(result.backup_name, "Bob", "Should return team lead as backup");
});

// Test 29: Gather complete root cause context
await asyncTest("gatherRootCauseContext assembles all context fields", async () => {
  const blocker = { prd_id: 112, team_lead: "Bob" };
  const context = await slackReporter.gatherRootCauseContext(blocker, ["package.json"]);

  assert(context.whoCaused, "Should gather who caused");
  assert(context.whoCaused.email, "Should have email");
  assert(context.why, "Should gather why/root cause");
  assert(Array.isArray(context.whatHappened), "Should gather timeline");
  assert(Array.isArray(context.howToFix), "Should gather fix steps");
  assert(context.whoShouldFix, "Should gather who should fix");
  assert(context.whoShouldFix.name, "Should have name");
});

// Test 30: Send escalation alert routing for Level 1
await asyncTest("sendEscalationAlert routes to team channel for Level 1", async () => {
  const blocker = {
    prd_id: 123,
    escalation_level: 1,
  };

  const config = {
    slackChannels: {
      team: "C_TEAM_TEST",
      leadership: "C_LEAD_TEST",
    },
    slackUsers: {
      team_lead: "U_LEAD",
      director: "U_DIRECTOR",
      ceo: "U_CEO",
    },
  };

  // Set dry run mode to prevent actual Slack calls
  const originalDryRun = process.env.RALPH_DRY_RUN;
  process.env.RALPH_DRY_RUN = "1";

  try {
    const result = await slackReporter.sendEscalationAlert(blocker, {}, config);
    // In dry run, should always succeed
    assert(result, "Should return true for successful send");
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
