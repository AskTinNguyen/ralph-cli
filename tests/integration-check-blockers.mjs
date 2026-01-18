/**
 * Integration tests for Check Blockers (PRD-112 US-003)
 *
 * Tests 3-level blocker detection, escalation logic,
 * and blocker-status.json file management.
 *
 * Run with: node tests/integration-check-blockers.mjs
 * Or: npm run test:blockers
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

console.log("\nRunning Check Blockers Integration Tests (PRD-112 US-003)");
console.log("============================================================\n");

// Load the check-blockers module
const checkBlockers = require(path.join(repoRoot, "scripts", "check-blockers.js"));

// ============================================================================
// Test: Default Thresholds
// ============================================================================

test("DEFAULT_THRESHOLDS has correct default values", () => {
  assertEqual(checkBlockers.DEFAULT_THRESHOLDS.level1_days, 2, "Level 1 should be 2 days");
  assertEqual(checkBlockers.DEFAULT_THRESHOLDS.level2_days, 4, "Level 2 should be 4 days");
  assertEqual(checkBlockers.DEFAULT_THRESHOLDS.level3_days, 7, "Level 3 should be 7 days");
});

// ============================================================================
// Test: Escalation Level Determination
// ============================================================================

test("determineEscalationLevel returns NOT_ESCALATED for 0-1 days", () => {
  const thresholds = checkBlockers.DEFAULT_THRESHOLDS;

  assertEqual(checkBlockers.determineEscalationLevel(0, thresholds), 0, "0 days should be not escalated");
  assertEqual(checkBlockers.determineEscalationLevel(1, thresholds), 0, "1 day should be not escalated");
});

test("determineEscalationLevel returns LEVEL1 for 2-3 days", () => {
  const thresholds = checkBlockers.DEFAULT_THRESHOLDS;

  assertEqual(checkBlockers.determineEscalationLevel(2, thresholds), 1, "2 days should be level 1");
  assertEqual(checkBlockers.determineEscalationLevel(3, thresholds), 1, "3 days should be level 1");
});

test("determineEscalationLevel returns LEVEL2 for 4-6 days", () => {
  const thresholds = checkBlockers.DEFAULT_THRESHOLDS;

  assertEqual(checkBlockers.determineEscalationLevel(4, thresholds), 2, "4 days should be level 2");
  assertEqual(checkBlockers.determineEscalationLevel(5, thresholds), 2, "5 days should be level 2");
  assertEqual(checkBlockers.determineEscalationLevel(6, thresholds), 2, "6 days should be level 2");
});

test("determineEscalationLevel returns LEVEL3 for 7+ days", () => {
  const thresholds = checkBlockers.DEFAULT_THRESHOLDS;

  assertEqual(checkBlockers.determineEscalationLevel(7, thresholds), 3, "7 days should be level 3");
  assertEqual(checkBlockers.determineEscalationLevel(10, thresholds), 3, "10 days should be level 3");
  assertEqual(checkBlockers.determineEscalationLevel(30, thresholds), 3, "30 days should be level 3");
});

// ============================================================================
// Test: Custom Thresholds
// ============================================================================

test("determineEscalationLevel respects custom thresholds", () => {
  const customThresholds = {
    level1_days: 1,
    level2_days: 3,
    level3_days: 5,
  };

  assertEqual(checkBlockers.determineEscalationLevel(0, customThresholds), 0, "0 days should be not escalated");
  assertEqual(checkBlockers.determineEscalationLevel(1, customThresholds), 1, "1 day should be level 1");
  assertEqual(checkBlockers.determineEscalationLevel(3, customThresholds), 2, "3 days should be level 2");
  assertEqual(checkBlockers.determineEscalationLevel(5, customThresholds), 3, "5 days should be level 3");
});

// ============================================================================
// Test: Escalation Level Names
// ============================================================================

test("getEscalationLevelName returns correct names", () => {
  assertEqual(checkBlockers.getEscalationLevelName(0), "not_escalated", "Level 0 name");
  assertEqual(checkBlockers.getEscalationLevelName(1), "level1", "Level 1 name");
  assertEqual(checkBlockers.getEscalationLevelName(2), "level2", "Level 2 name");
  assertEqual(checkBlockers.getEscalationLevelName(3), "level3", "Level 3 name");
});

// ============================================================================
// Test: Days Calculation
// ============================================================================

test("calculateDaysBlocked calculates correct days", () => {
  const now = new Date();
  const twoDaysAgo = new Date(now);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

  const days = checkBlockers.calculateDaysBlocked(twoDaysAgo, now);
  assertEqual(days, 2, "Should be 2 days");
});

test("calculateDaysBlocked handles same day as 0", () => {
  const now = new Date();
  const days = checkBlockers.calculateDaysBlocked(now, now);
  assertEqual(days, 0, "Same day should be 0 days");
});

test("calculateDaysBlocked handles 7 days correctly", () => {
  const now = new Date();
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const days = checkBlockers.calculateDaysBlocked(sevenDaysAgo, now);
  assertEqual(days, 7, "Should be 7 days");
});

// ============================================================================
// Test: Configuration Loading
// ============================================================================

test("loadAutomationConfig returns defaults when config missing", () => {
  // Create temp directory without config
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");
  mkdirSync(ralphDir, { recursive: true });

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const config = checkBlockers.loadAutomationConfig();

    assert(config.blockerEscalation, "Should have blockerEscalation");
    assert(config.blockerEscalation.enabled === true, "Should be enabled by default");
    assert(config.blockerEscalation.thresholds, "Should have thresholds");
    assertEqual(config.blockerEscalation.thresholds.level1_days, 2, "Default level1");
  } finally {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadAutomationConfig loads custom thresholds from config", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");
  mkdirSync(ralphDir, { recursive: true });

  const config = {
    blockerEscalation: {
      enabled: true,
      thresholds: {
        level1_days: 1,
        level2_days: 3,
        level3_days: 5,
      },
    },
  };

  writeFileSync(path.join(ralphDir, "automation-config.json"), JSON.stringify(config));

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const loadedConfig = checkBlockers.loadAutomationConfig();

    assertEqual(loadedConfig.blockerEscalation.thresholds.level1_days, 1, "Custom level1");
    assertEqual(loadedConfig.blockerEscalation.thresholds.level2_days, 3, "Custom level2");
    assertEqual(loadedConfig.blockerEscalation.thresholds.level3_days, 5, "Custom level3");
  } finally {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test: PRD Directory Scanning
// ============================================================================

test("getPrdDirectories finds PRD directories", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");

  // Create some PRD directories
  mkdirSync(path.join(ralphDir, "PRD-1"), { recursive: true });
  mkdirSync(path.join(ralphDir, "PRD-5"), { recursive: true });
  mkdirSync(path.join(ralphDir, "PRD-10"), { recursive: true });
  mkdirSync(path.join(ralphDir, "other-dir"), { recursive: true }); // Should be ignored

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const dirs = checkBlockers.getPrdDirectories();

    assertEqual(dirs.length, 3, "Should find 3 PRD directories");
    assertEqual(dirs[0].prdId, 1, "First should be PRD-1");
    assertEqual(dirs[1].prdId, 5, "Second should be PRD-5");
    assertEqual(dirs[2].prdId, 10, "Third should be PRD-10");
  } finally {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test: PRD Active Status
// ============================================================================

test("isPrdActive returns false without plan.md", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  try {
    const active = checkBlockers.isPrdActive(prdDir);
    assertEqual(active, false, "Should be inactive without plan.md");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("isPrdActive returns true with plan.md", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });
  writeFileSync(path.join(prdDir, "plan.md"), "# Plan");

  try {
    const active = checkBlockers.isPrdActive(prdDir);
    assertEqual(active, true, "Should be active with plan.md");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("isPrdActive returns false with .completed marker", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });
  writeFileSync(path.join(prdDir, "plan.md"), "# Plan");
  writeFileSync(path.join(prdDir, ".completed"), "");

  try {
    const active = checkBlockers.isPrdActive(prdDir);
    assertEqual(active, false, "Should be inactive with .completed");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("isPrdActive returns false with .merged marker", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });
  writeFileSync(path.join(prdDir, "plan.md"), "# Plan");
  writeFileSync(path.join(prdDir, ".merged"), "");

  try {
    const active = checkBlockers.isPrdActive(prdDir);
    assertEqual(active, false, "Should be inactive with .merged");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test: Progress Parsing
// ============================================================================

test("getLastSuccessfulRun parses commit from progress.md", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  const progressContent = `# Progress Log

## 2026-01-15 10:30 - US-001: Test Story
- Guardrails reviewed: yes
- Commit: abc1234 feat: test commit
- Post-commit status: clean
`;

  writeFileSync(path.join(prdDir, "progress.md"), progressContent);

  try {
    const result = checkBlockers.getLastSuccessfulRun(path.join(prdDir, "progress.md"));

    assert(result !== null, "Should find a successful run");
    assertEqual(result.commit, "abc1234", "Should extract commit hash");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getLastSuccessfulRun returns null for no commits", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  const progressContent = `# Progress Log

## 2026-01-15 10:30 - US-001: Test Story
- Guardrails reviewed: yes
- Commit: none (failed)
`;

  writeFileSync(path.join(prdDir, "progress.md"), progressContent);

  try {
    const result = checkBlockers.getLastSuccessfulRun(path.join(prdDir, "progress.md"));
    assertEqual(result, null, "Should return null for no successful commits");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("getLastSuccessfulRun returns null for missing file", () => {
  const result = checkBlockers.getLastSuccessfulRun("/nonexistent/path/progress.md");
  assertEqual(result, null, "Should return null for missing file");
});

// ============================================================================
// Test: Blocker Status Save/Load
// ============================================================================

test("saveBlockerStatus creates valid JSON file", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  const status = {
    prd_id: 1,
    is_blocked: true,
    blocker_since: "2026-01-15T10:00:00Z",
    days_blocked: 3,
    escalation_level: 1,
    escalation_history: [],
  };

  try {
    checkBlockers.saveBlockerStatus(prdDir, status);

    const saved = JSON.parse(readFileSync(path.join(prdDir, "blocker-status.json"), "utf-8"));
    assertEqual(saved.prd_id, 1, "PRD ID should match");
    assertEqual(saved.is_blocked, true, "is_blocked should match");
    assertEqual(saved.days_blocked, 3, "days_blocked should match");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadBlockerStatus loads existing status", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  const status = {
    prd_id: 1,
    is_blocked: true,
    escalation_level: 2,
    escalation_history: [{ level: 1, date: "2026-01-14" }],
  };

  writeFileSync(path.join(prdDir, "blocker-status.json"), JSON.stringify(status));

  try {
    const loaded = checkBlockers.loadBlockerStatus(prdDir);

    assert(loaded !== null, "Should load status");
    assertEqual(loaded.prd_id, 1, "PRD ID should match");
    assertEqual(loaded.escalation_level, 2, "Escalation level should match");
    assertEqual(loaded.escalation_history.length, 1, "History should have 1 entry");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("loadBlockerStatus returns null for missing file", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const prdDir = path.join(tmpDir, ".ralph", "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  try {
    const loaded = checkBlockers.loadBlockerStatus(prdDir);
    assertEqual(loaded, null, "Should return null for missing file");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test: Blocker Status Schema
// ============================================================================

test("Blocker status file matches PRD schema", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");
  const prdDir = path.join(ralphDir, "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  // Create plan.md to make PRD active
  writeFileSync(path.join(prdDir, "plan.md"), "# Plan");

  // Create progress.md with old commit (5 days ago)
  const fiveDaysAgo = new Date();
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
  const dateStr = fiveDaysAgo.toISOString().split("T")[0];

  const progressContent = `# Progress Log

## ${dateStr} 10:30 - US-001: Test
- Commit: abc1234 feat: test
`;
  writeFileSync(path.join(prdDir, "progress.md"), progressContent);

  // Create config
  writeFileSync(
    path.join(ralphDir, "automation-config.json"),
    JSON.stringify({
      blockerEscalation: { enabled: true, thresholds: checkBlockers.DEFAULT_THRESHOLDS },
    })
  );

  // Create prd.md
  writeFileSync(
    path.join(prdDir, "prd.md"),
    `# Product Requirements Document: Test PRD

**Team:** backend
**Priority:** high
`
  );

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const config = checkBlockers.loadAutomationConfig();
    const prd = { prdId: 1, path: prdDir };
    const status = checkBlockers.checkPrdBlocker(prd, config);

    assert(status !== null, "Should create blocker status");

    // Verify schema matches PRD specification
    assertEqual(typeof status.prd_id, "number", "prd_id should be number");
    assertEqual(typeof status.is_blocked, "boolean", "is_blocked should be boolean");
    assertEqual(typeof status.blocker_since, "string", "blocker_since should be string");
    assertEqual(typeof status.days_blocked, "number", "days_blocked should be number");
    assertEqual(typeof status.escalation_level, "number", "escalation_level should be number");
    assert(Array.isArray(status.escalation_history), "escalation_history should be array");

    // Check escalation history entry
    if (status.escalation_history.length > 0) {
      const entry = status.escalation_history[0];
      assertEqual(typeof entry.level, "number", "history entry should have level");
      assertEqual(typeof entry.date, "string", "history entry should have date");
      assert(Array.isArray(entry.alerted), "history entry should have alerted array");
    }

    // Verify metadata
    assert(status.metadata, "Should have metadata");
    assertEqual(status.metadata.team, "backend", "Team should be extracted");
    assertEqual(status.metadata.priority, "high", "Priority should be extracted");
  } finally {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test: Duplicate Alert Prevention
// ============================================================================

test("checkPrdBlocker prevents duplicate escalations", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "blocker-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");
  const prdDir = path.join(ralphDir, "PRD-1");
  mkdirSync(prdDir, { recursive: true });

  // Create plan.md to make PRD active
  writeFileSync(path.join(prdDir, "plan.md"), "# Plan");

  // Create progress.md with old commit (3 days ago)
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
  const dateStr = threeDaysAgo.toISOString().split("T")[0];

  writeFileSync(
    path.join(prdDir, "progress.md"),
    `# Progress\n## ${dateStr} 10:30 - US-001\n- Commit: abc1234 test\n`
  );

  // Create config
  writeFileSync(
    path.join(ralphDir, "automation-config.json"),
    JSON.stringify({
      blockerEscalation: { enabled: true, thresholds: checkBlockers.DEFAULT_THRESHOLDS },
    })
  );

  const originalCwd = process.cwd();
  process.chdir(tmpDir);

  try {
    const config = checkBlockers.loadAutomationConfig();
    const prd = { prdId: 1, path: prdDir };

    // First check - should escalate
    const status1 = checkBlockers.checkPrdBlocker(prd, config);
    assert(status1.needs_alert === true, "First check should need alert");
    assertEqual(status1.escalation_history.length, 1, "Should have 1 escalation entry");

    // Second check at same level - should NOT add new escalation
    const status2 = checkBlockers.checkPrdBlocker(prd, config);
    assert(status2.needs_alert === false, "Second check should not need alert");
    assertEqual(status2.escalation_history.length, 1, "Should still have 1 entry (no duplicate)");
  } finally {
    process.chdir(originalCwd);
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Test: GitHub Issue Creation (US-006)
// ============================================================================

test("buildGitHubIssueBody creates valid markdown with full context", () => {
  const blocker = {
    prd_id: 123,
    days_blocked: 7,
    blocker_since: "2026-01-11T10:00:00Z",
    last_successful_run: "2026-01-11T10:00:00Z",
    metadata: {
      title: "Test PRD",
      team: "Gameplay",
      priority: "high",
    },
  };

  const context = {
    whoCaused: "@alice (commit abc123)",
    why: "Module refactor broke import paths",
    whatHappened: ["2026-01-13: Refactored PlayerInventory", "2026-01-14: 10 consecutive build failures"],
    howToFix: ["Update import paths in src/gameplay/player.ts", "Check PlayerInventory exports"],
    whoShouldFix: { primary: "@alice", backup: "@bob" },
  };

  const body = checkBlockers.buildGitHubIssueBody(blocker, context);

  assert(body.includes("# Critical Blocker: PRD-123"), "Should include title");
  assert(body.includes("Blocked for 7 days"), "Should include days blocked");
  assert(body.includes("**Team:** Gameplay"), "Should include team");
  assert(body.includes("**Who Caused:** @alice"), "Should include who caused");
  assert(body.includes("**Why:** Module refactor broke import paths"), "Should include why");
  assert(body.includes("**What Happened Before:**"), "Should include what happened");
  assert(body.includes("Update import paths"), "Should include fix steps");
  assert(body.includes("**PRD Details:**"), "Should include PRD link");
  assert(body.includes("blocker-status.json"), "Should include blocker status file reference");
  assert(body.includes("Auto-generated by Ralph"), "Should include footer");
});

test("buildGitHubIssueBody handles missing context gracefully", () => {
  const blocker = {
    prd_id: 456,
    days_blocked: 8,
    blocker_since: "2026-01-10T10:00:00Z",
    metadata: {
      title: "Another PRD",
      team: "Art",
      priority: "high",
    },
  };

  // Empty context
  const body = checkBlockers.buildGitHubIssueBody(blocker, {});

  assert(body.includes("Critical Blocker: PRD-456"), "Should include PRD number");
  assert(body.includes("**Who Caused:** Unknown"), "Should handle missing who caused");
  assert(body.includes("Requires investigation"), "Should handle missing why");
  assert(body.includes("Unable to determine"), "Should handle missing what happened");
  assert(body.includes("Investigate the blocker cause"), "Should include default fix steps");
});

test("createGitHubIssue returns error when GITHUB_TOKEN not set", async () => {
  // Save original env var
  const origToken = process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_TOKEN;

  try {
    const blocker = {
      prd_id: 789,
      metadata: { title: "Test" },
    };

    const result = await checkBlockers.createGitHubIssue(blocker, {});

    assert(result.success === false, "Should fail without token");
    assert(result.error === "GITHUB_TOKEN not set", "Should report token missing");
  } finally {
    // Restore env var
    if (origToken) process.env.GITHUB_TOKEN = origToken;
  }
});

test("GitHub issue creation exports functions", () => {
  assert(typeof checkBlockers.createGitHubIssue === "function", "createGitHubIssue should be exported");
  assert(typeof checkBlockers.closeGitHubIssue === "function", "closeGitHubIssue should be exported");
  assert(typeof checkBlockers.buildGitHubIssueBody === "function", "buildGitHubIssueBody should be exported");
});

// ============================================================================
// Summary
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log("\n✓ All check-blockers tests passed!");
process.exit(0);
