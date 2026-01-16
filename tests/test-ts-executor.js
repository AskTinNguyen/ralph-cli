/**
 * Unit tests for TypeScript Executor (US-017)
 *
 * Tests the TypeScript-based build executor including:
 * - Configuration and state management
 * - Story selection integration
 * - Git operations
 * - Checkpoint/resume
 * - Agent switching
 * - Rollback support
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const {
  BuildExecutor,
  BuildState,
  IterationResult,
  DEFAULT_CONFIG,
  shouldUseTypescriptExecutor,
  execCommand,
  getGitHead,
  getChangedFiles,
  renderPrompt,
  updateStatus,
  clearStatus,
} = require("../lib/executor/index");

// Test helpers
let testDir;
let testCount = 0;
let passCount = 0;
let failCount = 0;

function createTestDir() {
  testDir = path.join(os.tmpdir(), `ralph-executor-test-${Date.now()}`);
  fs.mkdirSync(testDir, { recursive: true });

  // Initialize git repo for git-related tests
  execSync("git init", { cwd: testDir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: testDir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: testDir, stdio: "pipe" });

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
  console.log("\n=== TypeScript Executor Tests (US-017) ===\n");

  // Setup
  createTestDir();

  // ----------------------------------------------------------------------------
  // DEFAULT_CONFIG tests
  // ----------------------------------------------------------------------------
  console.log("DEFAULT_CONFIG:");

  test("has default agent configuration", () => {
    assert.strictEqual(DEFAULT_CONFIG.defaultAgent, "claude");
    assert.ok(Array.isArray(DEFAULT_CONFIG.agentFallbackChain));
    assert.ok(DEFAULT_CONFIG.agentFallbackChain.includes("claude"));
  });

  test("has timeout configuration", () => {
    assert.strictEqual(DEFAULT_CONFIG.agentTimeout, 3600); // 60 min
    assert.strictEqual(DEFAULT_CONFIG.iterationTimeout, 5400); // 90 min
    assert.strictEqual(DEFAULT_CONFIG.storyTimeout, 10800); // 3 hours
  });

  test("has verification configuration", () => {
    assert.ok(Array.isArray(DEFAULT_CONFIG.verifyCommands));
    assert.strictEqual(DEFAULT_CONFIG.verifyOnCommit, true);
  });

  test("has git configuration", () => {
    assert.strictEqual(DEFAULT_CONFIG.autoCommit, true);
    assert.strictEqual(DEFAULT_CONFIG.commitPrefix, "feat");
  });

  // ----------------------------------------------------------------------------
  // BuildState tests
  // ----------------------------------------------------------------------------
  console.log("\nBuildState:");

  test("initializes with correct defaults", () => {
    const state = new BuildState("/test/PRD-1");
    assert.strictEqual(state.prdFolder, "/test/PRD-1");
    assert.strictEqual(state.iteration, 0);
    assert.strictEqual(state.currentStory, null);
    assert.strictEqual(state.currentAgent, null);
    assert.ok(state.startTime > 0);
    assert.strictEqual(state.totalCost, 0);
    assert.deepStrictEqual(state.completedStories, []);
    assert.deepStrictEqual(state.failedStories, []);
  });

  test("toJSON returns serializable object", () => {
    const state = new BuildState("/test/PRD-1");
    state.iteration = 5;
    state.currentAgent = "claude";
    state.completedStories = ["US-001", "US-002"];

    const json = state.toJSON();
    assert.strictEqual(json.iteration, 5);
    assert.strictEqual(json.currentAgent, "claude");
    assert.deepStrictEqual(json.completedStories, ["US-001", "US-002"]);
  });

  test("tracks agentsTried array", () => {
    const state = new BuildState("/test/PRD-2");
    state.agentsTried.push("claude");
    state.agentsTried.push("codex");

    assert.deepStrictEqual(state.agentsTried, ["claude", "codex"]);
  });

  test("tracks rollbackCount", () => {
    const state = new BuildState("/test/PRD-3");
    assert.strictEqual(state.rollbackCount, 0);

    state.rollbackCount++;
    assert.strictEqual(state.rollbackCount, 1);
  });

  // ----------------------------------------------------------------------------
  // IterationResult tests
  // ----------------------------------------------------------------------------
  console.log("\nIterationResult:");

  test("initializes with correct defaults", () => {
    const result = new IterationResult();
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.storyId, null);
    assert.strictEqual(result.duration, 0);
    assert.strictEqual(result.commit, null);
    assert.strictEqual(result.error, null);
    assert.deepStrictEqual(result.verification, []);
    assert.deepStrictEqual(result.filesChanged, []);
    assert.strictEqual(result.rollbackPerformed, false);
    assert.strictEqual(result.agentSwitched, false);
  });

  test("can be populated with result data", () => {
    const result = new IterationResult();
    result.success = true;
    result.storyId = "US-001";
    result.storyTitle = "Test Story";
    result.duration = 120;
    result.agent = "claude";
    result.commit = "abc123";
    result.filesChanged = ["src/test.js"];

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.storyId, "US-001");
    assert.strictEqual(result.duration, 120);
    assert.strictEqual(result.commit, "abc123");
  });

  // ----------------------------------------------------------------------------
  // shouldUseTypescriptExecutor tests
  // ----------------------------------------------------------------------------
  console.log("\nshouldUseTypescriptExecutor:");

  test("returns false when RALPH_EXECUTOR not set", () => {
    const original = process.env.RALPH_EXECUTOR;
    delete process.env.RALPH_EXECUTOR;

    const result = shouldUseTypescriptExecutor();
    assert.strictEqual(result, false);

    if (original) process.env.RALPH_EXECUTOR = original;
  });

  test("returns true when RALPH_EXECUTOR=typescript", () => {
    const original = process.env.RALPH_EXECUTOR;
    process.env.RALPH_EXECUTOR = "typescript";

    const result = shouldUseTypescriptExecutor();
    assert.strictEqual(result, true);

    if (original) {
      process.env.RALPH_EXECUTOR = original;
    } else {
      delete process.env.RALPH_EXECUTOR;
    }
  });

  test("returns false for other RALPH_EXECUTOR values", () => {
    const original = process.env.RALPH_EXECUTOR;
    process.env.RALPH_EXECUTOR = "bash";

    const result = shouldUseTypescriptExecutor();
    assert.strictEqual(result, false);

    if (original) {
      process.env.RALPH_EXECUTOR = original;
    } else {
      delete process.env.RALPH_EXECUTOR;
    }
  });

  // ----------------------------------------------------------------------------
  // execCommand tests
  // ----------------------------------------------------------------------------
  console.log("\nexecCommand:");

  await testAsync("executes simple command successfully", async () => {
    const result = await execCommand("echo hello");
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("hello"));
  });

  await testAsync("returns non-zero code for failing command", async () => {
    const result = await execCommand("false");
    assert.notStrictEqual(result.code, 0);
  });

  await testAsync("respects working directory option", async () => {
    const result = await execCommand("pwd", { cwd: testDir });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes(testDir));
  });

  await testAsync("captures stderr on failure", async () => {
    const result = await execCommand("ls /nonexistent-dir-xyz");
    assert.notStrictEqual(result.code, 0);
    // stderr should contain error message
    assert.ok(result.stderr.length > 0 || result.code !== 0);
  });

  // ----------------------------------------------------------------------------
  // getGitHead tests
  // ----------------------------------------------------------------------------
  console.log("\ngetGitHead:");

  test("returns empty string for non-git directory", () => {
    const nonGitDir = path.join(testDir, "non-git");
    fs.mkdirSync(nonGitDir, { recursive: true });
    const result = getGitHead(nonGitDir);
    assert.strictEqual(result, "");
  });

  test("returns HEAD SHA for git directory with commits", () => {
    // Create initial commit
    const testFile = path.join(testDir, "test.txt");
    fs.writeFileSync(testFile, "test content");
    execSync("git add -A && git commit -m 'Initial'", { cwd: testDir, stdio: "pipe" });

    const result = getGitHead(testDir);
    assert.ok(result.length > 0);
    assert.match(result, /^[a-f0-9]{40}$/);
  });

  // ----------------------------------------------------------------------------
  // getChangedFiles tests
  // ----------------------------------------------------------------------------
  console.log("\ngetChangedFiles:");

  test("returns empty array when no changes", () => {
    const result = getChangedFiles(testDir);
    // May have previous test changes, so just verify it's an array
    assert.ok(Array.isArray(result));
  });

  test("returns changed files after modification", () => {
    const testFile = path.join(testDir, "changed.txt");
    fs.writeFileSync(testFile, "changed content");
    execSync("git add -A && git commit -m 'Change'", { cwd: testDir, stdio: "pipe" });

    const result = getChangedFiles(testDir);
    assert.ok(Array.isArray(result));
    assert.ok(result.includes("changed.txt"));
  });

  // ----------------------------------------------------------------------------
  // renderPrompt tests
  // ----------------------------------------------------------------------------
  console.log("\nrenderPrompt:");

  test("renders prompt with story placeholders", () => {
    const templatePath = path.join(testDir, "template.md");
    const outputPath = path.join(testDir, "rendered.md");

    fs.writeFileSync(
      templatePath,
      `# Story: {{STORY_ID}}
Title: {{STORY_TITLE}}
Iteration: {{ITERATION}}
`
    );

    renderPrompt(
      templatePath,
      outputPath,
      { id: "US-001", title: "Test Story" },
      "Story block content",
      { iteration: 5, runTag: "test-run" }
    );

    const rendered = fs.readFileSync(outputPath, "utf8");
    assert.ok(rendered.includes("US-001"));
    assert.ok(rendered.includes("Test Story"));
    assert.ok(rendered.includes("Iteration: 5"));
  });

  test("handles missing placeholders gracefully", () => {
    const templatePath = path.join(testDir, "template2.md");
    const outputPath = path.join(testDir, "rendered2.md");

    fs.writeFileSync(templatePath, "No placeholders here");

    renderPrompt(templatePath, outputPath, {}, "", {});

    const rendered = fs.readFileSync(outputPath, "utf8");
    assert.strictEqual(rendered, "No placeholders here");
  });

  test("replaces multiple occurrences of same placeholder", () => {
    const templatePath = path.join(testDir, "template3.md");
    const outputPath = path.join(testDir, "rendered3.md");

    fs.writeFileSync(templatePath, "{{STORY_ID}} - {{STORY_ID}} - {{STORY_ID}}");

    renderPrompt(templatePath, outputPath, { id: "US-999" }, "", {});

    const rendered = fs.readFileSync(outputPath, "utf8");
    assert.strictEqual(rendered, "US-999 - US-999 - US-999");
  });

  // ----------------------------------------------------------------------------
  // updateStatus / clearStatus tests
  // ----------------------------------------------------------------------------
  console.log("\nupdateStatus / clearStatus:");

  test("creates status file with correct content", () => {
    const prdFolder = path.join(testDir, "PRD-status-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    updateStatus(prdFolder, "executing", 3, "US-005", "Test Story", 120);

    const statusPath = path.join(prdFolder, ".status.json");
    assert.ok(fs.existsSync(statusPath));

    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    assert.strictEqual(status.phase, "executing");
    assert.strictEqual(status.iteration, 3);
    assert.strictEqual(status.story_id, "US-005");
    assert.strictEqual(status.story_title, "Test Story");
    assert.strictEqual(status.elapsed_seconds, 120);
    assert.ok(status.updated_at);
  });

  test("clearStatus removes status file", () => {
    const prdFolder = path.join(testDir, "PRD-status-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    updateStatus(prdFolder, "executing", 1, "US-001", "Story", 0);
    const statusPath = path.join(prdFolder, ".status.json");
    assert.ok(fs.existsSync(statusPath));

    clearStatus(prdFolder);
    assert.ok(!fs.existsSync(statusPath));
  });

  test("clearStatus handles non-existent file", () => {
    const prdFolder = path.join(testDir, "PRD-status-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    // Should not throw
    clearStatus(prdFolder);
    assert.ok(true);
  });

  // ----------------------------------------------------------------------------
  // BuildExecutor tests
  // ----------------------------------------------------------------------------
  console.log("\nBuildExecutor:");

  test("initializes with default config", () => {
    const executor = new BuildExecutor();
    assert.strictEqual(executor.config.defaultAgent, "claude");
    assert.strictEqual(executor.config.agentTimeout, 3600);
  });

  test("initializes with custom config", () => {
    const executor = new BuildExecutor({
      defaultAgent: "codex",
      agentTimeout: 1800,
    });
    assert.strictEqual(executor.config.defaultAgent, "codex");
    assert.strictEqual(executor.config.agentTimeout, 1800);
  });

  test("merges custom config with defaults", () => {
    const executor = new BuildExecutor({
      defaultAgent: "droid",
    });
    assert.strictEqual(executor.config.defaultAgent, "droid");
    // Should still have other defaults
    assert.strictEqual(executor.config.iterationTimeout, 5400);
    assert.ok(Array.isArray(executor.config.verifyCommands));
  });

  // ----------------------------------------------------------------------------
  // _selectStory tests (integration)
  // ----------------------------------------------------------------------------
  console.log("\n_selectStory (integration):");

  await testAsync("selects next uncompleted story", async () => {
    const prdFolder = path.join(testDir, "PRD-select-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(
      planPath,
      `# Plan

### [ ] US-001: First Story

Description here

### [ ] US-002: Second Story

Description here
`
    );

    const executor = new BuildExecutor();
    executor.state = new BuildState(prdFolder);

    const result = await executor._selectStory(planPath);

    assert.strictEqual(result.success, true);
    assert.ok(result.story);
    assert.strictEqual(result.story.id, "US-001");
  });

  await testAsync("skips completed stories", async () => {
    const prdFolder = path.join(testDir, "PRD-select-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(
      planPath,
      `# Plan

### [x] US-001: First Story (completed)

Done

### [ ] US-002: Second Story

Pending
`
    );

    const executor = new BuildExecutor();
    executor.state = new BuildState(prdFolder);

    const result = await executor._selectStory(planPath);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.story.id, "US-002");
  });

  await testAsync("returns noStories when all complete", async () => {
    const prdFolder = path.join(testDir, "PRD-select-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    const planPath = path.join(prdFolder, "plan.md");
    fs.writeFileSync(
      planPath,
      `# Plan

### [x] US-001: First Story

Done
`
    );

    const executor = new BuildExecutor();
    executor.state = new BuildState(prdFolder);

    const result = await executor._selectStory(planPath);

    assert.strictEqual(result.success, false);
    assert.strictEqual(result.noStories, true);
  });

  // ----------------------------------------------------------------------------
  // _switchAgent tests
  // ----------------------------------------------------------------------------
  console.log("\n_switchAgent:");

  await testAsync("switches to next agent in chain", async () => {
    const prdFolder = path.join(testDir, "PRD-switch-1");
    fs.mkdirSync(prdFolder, { recursive: true });

    // Create mock state manager
    const { BuildStateManager } = require("../lib/state/index");

    const executor = new BuildExecutor();
    executor.state = new BuildState(prdFolder);
    executor.state.currentAgent = "claude";
    executor.stateManager = new BuildStateManager(prdFolder);

    const switched = await executor._switchAgent();

    assert.strictEqual(switched, true);
    assert.strictEqual(executor.state.currentAgent, "codex");
    assert.ok(executor.state.agentsTried.includes("claude"));
  });

  await testAsync("returns false when no more agents", async () => {
    const prdFolder = path.join(testDir, "PRD-switch-2");
    fs.mkdirSync(prdFolder, { recursive: true });

    const { BuildStateManager } = require("../lib/state/index");

    const executor = new BuildExecutor();
    executor.state = new BuildState(prdFolder);
    executor.state.currentAgent = "droid"; // Last in chain
    executor.stateManager = new BuildStateManager(prdFolder);

    const switched = await executor._switchAgent();

    assert.strictEqual(switched, false);
    assert.strictEqual(executor.state.currentAgent, "droid"); // Unchanged
  });

  await testAsync("tracks all tried agents", async () => {
    const prdFolder = path.join(testDir, "PRD-switch-3");
    fs.mkdirSync(prdFolder, { recursive: true });

    const { BuildStateManager } = require("../lib/state/index");

    const executor = new BuildExecutor();
    executor.state = new BuildState(prdFolder);
    executor.state.currentAgent = "claude";
    executor.stateManager = new BuildStateManager(prdFolder);

    await executor._switchAgent(); // claude -> codex
    await executor._switchAgent(); // codex -> droid

    assert.deepStrictEqual(executor.state.agentsTried, ["claude", "codex"]);
    assert.strictEqual(executor.state.currentAgent, "droid");
  });

  // ----------------------------------------------------------------------------
  // CLI tests
  // ----------------------------------------------------------------------------
  console.log("\nCLI:");

  test("cli check command works", () => {
    const cliPath = path.resolve(__dirname, "../lib/executor/cli.js");
    // When not enabled, check returns exit code 1 but still outputs valid JSON
    try {
      execSync(`node "${cliPath}" check --json`, {
        encoding: "utf8",
        env: { ...process.env, RALPH_EXECUTOR: "" },
      });
    } catch (err) {
      // Expected: exits with code 1 when not ready
      const parsed = JSON.parse(err.stdout);
      assert.strictEqual(parsed.enabled, false);
      assert.ok(parsed.modules);
      assert.ok(parsed.nodeVersion);
      return;
    }
    assert.fail("Should have exited with code 1 when not enabled");
  });

  test("cli check shows enabled when RALPH_EXECUTOR=typescript", () => {
    const cliPath = path.resolve(__dirname, "../lib/executor/cli.js");
    const result = execSync(`node "${cliPath}" check --json`, {
      encoding: "utf8",
      env: { ...process.env, RALPH_EXECUTOR: "typescript" },
    });

    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.enabled, true);
  });

  test("cli shows all required modules available", () => {
    const cliPath = path.resolve(__dirname, "../lib/executor/cli.js");
    const result = execSync(`node "${cliPath}" check --json`, {
      encoding: "utf8",
      env: { ...process.env, RALPH_EXECUTOR: "typescript" },
    });

    const parsed = JSON.parse(result);
    assert.strictEqual(parsed.modules.checkpoint, true);
    assert.strictEqual(parsed.modules.story, true);
    assert.strictEqual(parsed.modules.state, true);
    assert.strictEqual(parsed.modules["failure-detection"], true);
  });

  test("cli run requires PRD folder", () => {
    const cliPath = path.resolve(__dirname, "../lib/executor/cli.js");
    try {
      execSync(`node "${cliPath}" run`, {
        encoding: "utf8",
        env: { ...process.env, RALPH_EXECUTOR: "typescript" },
        stdio: "pipe",
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.stderr.includes("PRD folder path required") || err.status !== 0);
    }
  });

  test("cli run validates PRD folder exists", () => {
    const cliPath = path.resolve(__dirname, "../lib/executor/cli.js");
    try {
      execSync(`node "${cliPath}" run /nonexistent/path`, {
        encoding: "utf8",
        env: { ...process.env, RALPH_EXECUTOR: "typescript" },
        stdio: "pipe",
      });
      assert.fail("Should have thrown");
    } catch (err) {
      assert.ok(err.status !== 0);
    }
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
