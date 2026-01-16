/**
 * Unit tests for BuildStateManager
 *
 * Tests transactional updates, file locking, and concurrent access safety.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const {
  BuildStateManager,
  acquireLock,
  releaseLock,
  checkStaleLock,
  formatTimestamp,
  LOCK_CONFIG,
} = require("../lib/state/index");

// Test helpers
let testDir;
let testCount = 0;
let passCount = 0;
let failCount = 0;

function createTestDir() {
  testDir = path.join(os.tmpdir(), `ralph-state-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });
  return testDir;
}

function cleanupTestDir() {
  if (testDir && fs.existsSync(testDir)) {
    fs.rmSync(testDir, { recursive: true, force: true });
  }
}

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

async function testAsync(name, fn) {
  testCount++;
  try {
    await fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

// ============================================================================
// Test Suite
// ============================================================================

async function runTests() {
  console.log("\n=== BuildStateManager Tests ===\n");

  // Setup
  createTestDir();

  // ----------------------------------------------------------------------------
  // formatTimestamp tests
  // ----------------------------------------------------------------------------
  console.log("formatTimestamp:");

  test("formats date correctly", () => {
    const date = new Date("2026-01-16T12:30:45.000Z");
    const result = formatTimestamp(date);
    assert.strictEqual(result, "2026-01-16 12:30:45");
  });

  test("uses current date when not provided", () => {
    const result = formatTimestamp();
    assert.match(result, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  // ----------------------------------------------------------------------------
  // Lock tests
  // ----------------------------------------------------------------------------
  console.log("\nacquireLock/releaseLock:");

  await testAsync("acquires lock on unlocked file", async () => {
    const targetPath = path.join(testDir, "test-lock-1.txt");
    fs.writeFileSync(targetPath, "test");

    const result = await acquireLock(targetPath, { maxWaitMs: 1000 });

    assert.strictEqual(result.acquired, true);
    assert.ok(fs.existsSync(result.lockPath));

    // Cleanup
    releaseLock(targetPath);
  });

  await testAsync("releases lock correctly", async () => {
    const targetPath = path.join(testDir, "test-lock-2.txt");
    fs.writeFileSync(targetPath, "test");

    const lockResult = await acquireLock(targetPath);
    assert.strictEqual(lockResult.acquired, true);

    const releaseResult = releaseLock(targetPath);
    assert.strictEqual(releaseResult.released, true);
    assert.ok(!fs.existsSync(lockResult.lockPath));
  });

  await testAsync("waits for lock when held by another", async () => {
    const targetPath = path.join(testDir, "test-lock-3.txt");
    fs.writeFileSync(targetPath, "test");

    // Acquire first lock
    const lock1 = await acquireLock(targetPath);
    assert.strictEqual(lock1.acquired, true);

    // Try to acquire second lock (should timeout quickly)
    const lock2 = await acquireLock(targetPath, { maxWaitMs: 200, maxRetries: 2 });
    assert.strictEqual(lock2.acquired, false);
    assert.ok(lock2.error.includes("Timeout") || lock2.error.includes("retries"));

    // Cleanup
    releaseLock(targetPath);
  });

  await testAsync("detects and cleans stale locks", async () => {
    const targetPath = path.join(testDir, "test-lock-stale.txt");
    fs.writeFileSync(targetPath, "test");

    // Create a fake stale lock with invalid PID
    const lockDir = targetPath + LOCK_CONFIG.lockSuffix;
    fs.mkdirSync(lockDir);
    fs.writeFileSync(
      path.join(lockDir, "pid"),
      JSON.stringify({ pid: 999999999, timestamp: Date.now() - 600000 })
    );

    // Should acquire lock by detecting stale
    const result = await acquireLock(targetPath, { maxWaitMs: 1000 });
    assert.strictEqual(result.acquired, true);

    // Cleanup
    releaseLock(targetPath);
  });

  // ----------------------------------------------------------------------------
  // checkStaleLock tests
  // ----------------------------------------------------------------------------
  console.log("\ncheckStaleLock:");

  await testAsync("returns true for missing PID file", async () => {
    const lockDir = path.join(testDir, "stale-test-1.lock");
    fs.mkdirSync(lockDir);
    const pidFile = path.join(lockDir, "pid");

    const result = await checkStaleLock(lockDir, pidFile);
    assert.strictEqual(result, true);

    fs.rmSync(lockDir, { recursive: true });
  });

  await testAsync("returns true for invalid PID content", async () => {
    const lockDir = path.join(testDir, "stale-test-2.lock");
    fs.mkdirSync(lockDir);
    const pidFile = path.join(lockDir, "pid");
    fs.writeFileSync(pidFile, "not-a-number");

    const result = await checkStaleLock(lockDir, pidFile);
    assert.strictEqual(result, true);

    fs.rmSync(lockDir, { recursive: true });
  });

  await testAsync("returns false for current process PID", async () => {
    const lockDir = path.join(testDir, "stale-test-3.lock");
    fs.mkdirSync(lockDir);
    const pidFile = path.join(lockDir, "pid");
    fs.writeFileSync(
      pidFile,
      JSON.stringify({ pid: process.pid, timestamp: Date.now() })
    );

    const result = await checkStaleLock(lockDir, pidFile);
    assert.strictEqual(result, false);

    fs.rmSync(lockDir, { recursive: true });
  });

  await testAsync("returns true for old timestamp (>5 minutes)", async () => {
    const lockDir = path.join(testDir, "stale-test-4.lock");
    fs.mkdirSync(lockDir);
    const pidFile = path.join(lockDir, "pid");
    fs.writeFileSync(
      pidFile,
      JSON.stringify({ pid: process.pid, timestamp: Date.now() - 400000 }) // 6+ minutes ago
    );

    const result = await checkStaleLock(lockDir, pidFile);
    assert.strictEqual(result, true);

    fs.rmSync(lockDir, { recursive: true });
  });

  // ----------------------------------------------------------------------------
  // BuildStateManager tests
  // ----------------------------------------------------------------------------
  console.log("\nBuildStateManager:");

  await testAsync("creates with correct paths", async () => {
    const prdFolder = path.join(testDir, "PRD-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);

    assert.strictEqual(manager.prdFolder, prdFolder);
    assert.strictEqual(manager.progressPath, path.join(prdFolder, "progress.md"));
    assert.strictEqual(manager.activityPath, path.join(prdFolder, "activity.log"));
  });

  // ----------------------------------------------------------------------------
  // logActivity tests
  // ----------------------------------------------------------------------------
  console.log("\nlogActivity:");

  await testAsync("creates activity log if missing", async () => {
    const prdFolder = path.join(testDir, "PRD-activity-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.logActivity("TEST message");

    assert.strictEqual(result.success, true);
    assert.ok(fs.existsSync(manager.activityPath));

    const content = fs.readFileSync(manager.activityPath, "utf8");
    assert.ok(content.includes("# Activity Log"));
    assert.ok(content.includes("TEST message"));
  });

  await testAsync("appends to existing activity log", async () => {
    const prdFolder = path.join(testDir, "PRD-activity-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);

    await manager.logActivity("First message");
    await manager.logActivity("Second message");

    const content = fs.readFileSync(manager.activityPath, "utf8");
    assert.ok(content.includes("First message"));
    assert.ok(content.includes("Second message"));
  });

  await testAsync("adds timestamp to activity entries", async () => {
    const prdFolder = path.join(testDir, "PRD-activity-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);
    await manager.logActivity("Timestamped entry");

    const content = fs.readFileSync(manager.activityPath, "utf8");
    assert.match(content, /\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\] Timestamped entry/);
  });

  // ----------------------------------------------------------------------------
  // addRunSummary tests
  // ----------------------------------------------------------------------------
  console.log("\naddRunSummary:");

  await testAsync("adds run summary with all fields", async () => {
    const prdFolder = path.join(testDir, "PRD-summary-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.addRunSummary({
      run: "20260116-123456",
      iter: 1,
      mode: "build",
      story: "US-001",
      duration: 120,
      status: "success",
      cost: 0.05,
    });

    assert.strictEqual(result.success, true);

    const content = fs.readFileSync(manager.activityPath, "utf8");
    assert.ok(content.includes("run=20260116-123456"));
    assert.ok(content.includes("iter=1"));
    assert.ok(content.includes("mode=build"));
    assert.ok(content.includes("story=US-001"));
    assert.ok(content.includes("duration=120s"));
    assert.ok(content.includes("status=success"));
    assert.ok(content.includes("cost=0.05"));
  });

  await testAsync("inserts after ## Run Summary header", async () => {
    const prdFolder = path.join(testDir, "PRD-summary-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    // Create initial structure
    const activityPath = path.join(prdFolder, "activity.log");
    fs.writeFileSync(
      activityPath,
      `# Activity Log

## Run Summary

## Events

`
    );

    const manager = new BuildStateManager(prdFolder);
    await manager.addRunSummary({
      run: "20260116-111111",
      iter: 1,
      mode: "build",
      duration: 60,
      status: "success",
    });

    const content = fs.readFileSync(activityPath, "utf8");
    const lines = content.split("\n");

    // Find the Run Summary line and check next line is our entry
    const summaryIndex = lines.findIndex((l) => l.trim() === "## Run Summary");
    assert.ok(summaryIndex >= 0);
    assert.ok(lines[summaryIndex + 1].includes("run=20260116-111111"));
  });

  // ----------------------------------------------------------------------------
  // addIteration tests
  // ----------------------------------------------------------------------------
  console.log("\naddIteration:");

  await testAsync("creates progress log if missing", async () => {
    const prdFolder = path.join(testDir, "PRD-progress-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.addIteration({
      storyId: "US-001",
      storyTitle: "Test Story",
      run: "20260116-test",
      iteration: 1,
      runLog: "/path/to/run.log",
      runSummary: "/path/to/run.md",
      commit: "abc123 feat: test commit",
      postCommitStatus: "clean",
      noCommit: false,
    });

    assert.strictEqual(result.success, true);
    assert.ok(fs.existsSync(manager.progressPath));

    const content = fs.readFileSync(manager.progressPath, "utf8");
    assert.ok(content.includes("# Progress Log"));
    assert.ok(content.includes("US-001"));
    assert.ok(content.includes("Test Story"));
  });

  await testAsync("formats progress entry correctly", async () => {
    const prdFolder = path.join(testDir, "PRD-progress-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);
    await manager.addIteration({
      storyId: "US-002",
      storyTitle: "Another Story",
      run: "20260116-run",
      iteration: 3,
      runLog: "/logs/run.log",
      runSummary: "/logs/run.md",
      commit: "def456 fix: bug fix",
      postCommitStatus: "clean",
      noCommit: false,
      verification: [
        { command: "npm test", result: "PASS" },
        { command: "npm run lint", result: "PASS" },
      ],
      filesChanged: ["src/index.js", "tests/test.js"],
      implementation: "Fixed the bug in the parser",
      learnings: ["Use async/await for cleaner code", "Check edge cases"],
      thread: "thread-123",
    });

    const content = fs.readFileSync(manager.progressPath, "utf8");

    assert.ok(content.includes("## ["));
    assert.ok(content.includes("US-002: Another Story"));
    assert.ok(content.includes("Thread: thread-123"));
    assert.ok(content.includes("Run: 20260116-run (iteration 3)"));
    assert.ok(content.includes("Run log: /logs/run.log"));
    assert.ok(content.includes("Run summary: /logs/run.md"));
    assert.ok(content.includes("- Guardrails reviewed: yes"));
    assert.ok(content.includes("- No-commit run: false"));
    assert.ok(content.includes("- Commit: def456 fix: bug fix"));
    assert.ok(content.includes("- Post-commit status: clean"));
    assert.ok(content.includes("- Verification:"));
    assert.ok(content.includes("  - Command: npm test -> PASS"));
    assert.ok(content.includes("  - Command: npm run lint -> PASS"));
    assert.ok(content.includes("- Files changed:"));
    assert.ok(content.includes("  - src/index.js"));
    assert.ok(content.includes("- What was implemented:"));
    assert.ok(content.includes("Fixed the bug"));
    assert.ok(content.includes("- **Learnings for future iterations:**"));
    assert.ok(content.includes("  - Use async/await"));
  });

  await testAsync("appends multiple iterations", async () => {
    const prdFolder = path.join(testDir, "PRD-progress-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);

    await manager.addIteration({
      storyId: "US-001",
      storyTitle: "First",
      run: "run-1",
      iteration: 1,
      runLog: "/log1",
      runSummary: "/sum1",
      commit: "aaa First commit",
      postCommitStatus: "clean",
      noCommit: false,
    });

    await manager.addIteration({
      storyId: "US-002",
      storyTitle: "Second",
      run: "run-2",
      iteration: 2,
      runLog: "/log2",
      runSummary: "/sum2",
      commit: "bbb Second commit",
      postCommitStatus: "clean",
      noCommit: false,
    });

    const content = fs.readFileSync(manager.progressPath, "utf8");
    assert.ok(content.includes("US-001: First"));
    assert.ok(content.includes("US-002: Second"));

    // Check entries are separated by ---
    const entryCount = (content.match(/^---$/gm) || []).length;
    assert.ok(entryCount >= 2);
  });

  // ----------------------------------------------------------------------------
  // updateStoryStatus tests
  // ----------------------------------------------------------------------------
  console.log("\nupdateStoryStatus:");

  await testAsync("marks story as complete", async () => {
    const prdFolder = path.join(testDir, "PRD-story-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(
      planPath,
      `# Plan

### [ ] US-001: First Story

### [ ] US-002: Second Story
`
    );

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.updateStoryStatus(planPath, "US-001", true);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updated, true);

    const content = fs.readFileSync(planPath, "utf8");
    assert.ok(content.includes("### [x] US-001: First Story"));
    assert.ok(content.includes("### [ ] US-002: Second Story")); // Unchanged
  });

  await testAsync("marks story as incomplete", async () => {
    const prdFolder = path.join(testDir, "PRD-story-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(planPath, `### [x] US-001: Complete Story`);

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.updateStoryStatus(planPath, "US-001", false);

    assert.strictEqual(result.success, true);

    const content = fs.readFileSync(planPath, "utf8");
    assert.ok(content.includes("### [ ] US-001: Complete Story"));
  });

  await testAsync("returns updated=false when story not found", async () => {
    const prdFolder = path.join(testDir, "PRD-story-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(planPath, "# Empty Plan");

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.updateStoryStatus(planPath, "US-999", true);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updated, false);
  });

  // ----------------------------------------------------------------------------
  // updateCriteriaStatus tests
  // ----------------------------------------------------------------------------
  console.log("\nupdateCriteriaStatus:");

  await testAsync("marks criteria as complete", async () => {
    const prdFolder = path.join(testDir, "PRD-criteria-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const prdPath = path.join(prdFolder, "prd.md");
    fs.writeFileSync(
      prdPath,
      `## Acceptance Criteria

- [ ] First criterion
- [ ] Second criterion
`
    );

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.updateCriteriaStatus(prdPath, "First criterion", true);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.updated, true);

    const content = fs.readFileSync(prdPath, "utf8");
    assert.ok(content.includes("- [x] First criterion"));
    assert.ok(content.includes("- [ ] Second criterion")); // Unchanged
  });

  // ----------------------------------------------------------------------------
  // batchUpdate tests
  // ----------------------------------------------------------------------------
  console.log("\nbatchUpdate:");

  await testAsync("executes multiple updates atomically", async () => {
    const prdFolder = path.join(testDir, "PRD-batch-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(planPath, "### [ ] US-001: Test");

    const manager = new BuildStateManager(prdFolder);
    const result = await manager.batchUpdate([
      { type: "activity", data: { message: "Batch activity 1" } },
      { type: "activity", data: { message: "Batch activity 2" } },
      {
        type: "runSummary",
        data: { run: "batch-run", iter: 1, mode: "build", duration: 30, status: "success" },
      },
      {
        type: "storyStatus",
        data: { planPath, storyId: "US-001", completed: true },
      },
    ]);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.results.length, 4);

    const activityContent = fs.readFileSync(manager.activityPath, "utf8");
    assert.ok(activityContent.includes("Batch activity 1"));
    assert.ok(activityContent.includes("Batch activity 2"));
    assert.ok(activityContent.includes("run=batch-run"));

    const planContent = fs.readFileSync(planPath, "utf8");
    assert.ok(planContent.includes("[x] US-001"));
  });

  // ----------------------------------------------------------------------------
  // Concurrent access tests
  // ----------------------------------------------------------------------------
  console.log("\nConcurrent access:");

  await testAsync("handles concurrent writes to activity log", async () => {
    const prdFolder = path.join(testDir, "PRD-concurrent-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);

    // Run 5 concurrent writes
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(manager.logActivity(`Concurrent message ${i}`));
    }

    const results = await Promise.all(promises);

    // All should succeed
    assert.ok(results.every((r) => r.success));

    // All messages should be present
    const content = fs.readFileSync(manager.activityPath, "utf8");
    for (let i = 0; i < 5; i++) {
      assert.ok(content.includes(`Concurrent message ${i}`));
    }
  });

  await testAsync("handles concurrent iteration writes", async () => {
    const prdFolder = path.join(testDir, "PRD-concurrent-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const manager = new BuildStateManager(prdFolder);

    // Run 3 concurrent iteration writes
    const promises = [];
    for (let i = 1; i <= 3; i++) {
      promises.push(
        manager.addIteration({
          storyId: `US-00${i}`,
          storyTitle: `Concurrent Story ${i}`,
          run: `concurrent-run-${i}`,
          iteration: i,
          runLog: `/log${i}`,
          runSummary: `/sum${i}`,
          commit: `commit${i}`,
          postCommitStatus: "clean",
          noCommit: false,
        })
      );
    }

    const results = await Promise.all(promises);

    // All should succeed
    assert.ok(results.every((r) => r.success));

    // All iterations should be present
    const content = fs.readFileSync(manager.progressPath, "utf8");
    for (let i = 1; i <= 3; i++) {
      assert.ok(content.includes(`US-00${i}: Concurrent Story ${i}`));
    }
  });

  // ----------------------------------------------------------------------------
  // CLI tests
  // ----------------------------------------------------------------------------
  console.log("\nCLI:");

  test("CLI log-activity works", () => {
    const prdFolder = path.join(testDir, "PRD-cli-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const cliPath = path.resolve(__dirname, "../lib/state/cli.js");
    const result = execSync(`node "${cliPath}" log-activity "${prdFolder}" "CLI test message"`, {
      encoding: "utf8",
    });

    assert.ok(result.includes("Success"));

    const content = fs.readFileSync(path.join(prdFolder, "activity.log"), "utf8");
    assert.ok(content.includes("CLI test message"));
  });

  test("CLI add-run-summary works", () => {
    const prdFolder = path.join(testDir, "PRD-cli-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const cliPath = path.resolve(__dirname, "../lib/state/cli.js");
    const json = JSON.stringify({ run: "cli-run", iter: 1, mode: "build", duration: 60, status: "success" });
    const result = execSync(`node "${cliPath}" add-run-summary "${prdFolder}" '${json}'`, {
      encoding: "utf8",
    });

    assert.ok(result.includes("Success"));

    const content = fs.readFileSync(path.join(prdFolder, "activity.log"), "utf8");
    assert.ok(content.includes("run=cli-run"));
  });

  test("CLI update-story works", () => {
    const prdFolder = path.join(testDir, "PRD-cli-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(planPath, "### [ ] US-001: CLI Test Story");

    const cliPath = path.resolve(__dirname, "../lib/state/cli.js");
    const result = execSync(`node "${cliPath}" update-story "${planPath}" US-001`, {
      encoding: "utf8",
    });

    assert.ok(result.includes("Success"));

    const content = fs.readFileSync(planPath, "utf8");
    assert.ok(content.includes("[x] US-001"));
  });

  test("CLI --json option works", () => {
    const prdFolder = path.join(testDir, "PRD-cli-4");
    fs.mkdirSync(prdFolder, { recursive: true });

    const cliPath = path.resolve(__dirname, "../lib/state/cli.js");
    const result = execSync(`node "${cliPath}" log-activity "${prdFolder}" "JSON test" --json`, {
      encoding: "utf8",
    });

    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.success, true);
  });

  // Cleanup
  cleanupTestDir();

  // Summary
  console.log(`\n${"=".repeat(50)}`);
  console.log(`Tests: ${testCount} | Passed: ${passCount} | Failed: ${failCount}`);
  console.log("=".repeat(50));

  return failCount > 0 ? 1 : 0;
}

// Run tests
runTests()
  .then((exitCode) => process.exit(exitCode))
  .catch((err) => {
    console.error(`Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
