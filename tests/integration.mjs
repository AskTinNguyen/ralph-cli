/**
 * Integration tests for ralph-cli
 *
 * These tests exercise CLI commands end-to-end in a temporary directory
 * using RALPH_DRY_RUN=1 to mock agent interactions.
 *
 * Run with: node tests/integration.mjs
 * Or: npm run test:integration
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "ralph");

// Track test results
let passed = 0;
let failed = 0;
const failures = [];

function runCommand(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large outputs
    ...options,
  });
  return {
    status: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function ralph(args, options = {}) {
  return runCommand(process.execPath, [cliPath, ...args], {
    env: { ...process.env, RALPH_DRY_RUN: "1", ...options.env },
    cwd: options.cwd || repoRoot,
    ...options,
  });
}

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

function assertContains(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(
      message || `Expected text to contain "${substring}"\nActual: ${text.slice(0, 200)}...`
    );
  }
}

function setupTempProjectWithInstall() {
  const base = mkdtempSync(path.join(tmpdir(), "ralph-integration-"));

  // Run ralph install to set up .agents/ralph with loop.sh
  const installResult = ralph(["install"], { cwd: base });
  if (installResult.status !== 0) {
    throw new Error(`Failed to install ralph in temp project: ${installResult.stderr}`);
  }

  // Create .ralph directory
  mkdirSync(path.join(base, ".ralph"), { recursive: true });

  // Create a sample PRD in the old-style location
  const prd = `# PRD: Integration Test
## Overview
Test project for integration testing.

## User Stories

### [ ] US-001: Test Story
**As a** developer
**I want** to test ralph CLI
**So that** I verify it works

#### Acceptance Criteria
- [ ] CLI commands work
- [ ] Files are created
`;

  // Write to .agents/tasks/prd.md (where ralph expects it)
  mkdirSync(path.join(base, ".agents", "tasks"), { recursive: true });
  writeFileSync(path.join(base, ".agents", "tasks", "prd.md"), prd);

  // Create implementation plan
  writeFileSync(
    path.join(base, ".ralph", "IMPLEMENTATION_PLAN.md"),
    `# Implementation Plan\n\n## Tasks\n### US-001: Test Story\n- [ ] Placeholder task\n  - Scope: none\n  - Acceptance: none\n  - Verification: none\n`
  );

  return base;
}

function setupTempProjectWithPRDFolder() {
  const base = mkdtempSync(path.join(tmpdir(), "ralph-integration-"));

  // Run ralph install to set up .agents/ralph with loop.sh
  const installResult = ralph(["install"], { cwd: base });
  if (installResult.status !== 0) {
    throw new Error(`Failed to install ralph in temp project: ${installResult.stderr}`);
  }

  // Create PRD-1 folder structure (new style)
  mkdirSync(path.join(base, ".ralph", "PRD-1"), { recursive: true });

  const prd = `# PRD: PRD Folder Test
## Overview
Test project with PRD folder structure.

## User Stories

### [ ] US-001: Folder Test
**As a** developer
**I want** PRD folders to work
**So that** isolation is maintained

#### Acceptance Criteria
- [ ] PRD is in PRD-1 folder
`;

  writeFileSync(path.join(base, ".ralph", "PRD-1", "prd.md"), prd);

  // Create plan.md in PRD folder
  writeFileSync(
    path.join(base, ".ralph", "PRD-1", "plan.md"),
    `# Implementation Plan\n\n## Tasks\n### US-001: Folder Test\n- [ ] Placeholder task\n  - Scope: none\n  - Acceptance: none\n  - Verification: none\n`
  );

  return base;
}

// ============================================================
// Test Suite: CLI Help and Version
// ============================================================
console.log("\n=== CLI Help and Version ===");

test("ralph --help shows usage", () => {
  const result = ralph(["--help"]);
  assertEqual(result.status, 0, `Exit code: ${result.status}`);
  assertContains(result.stdout, "ralph", "Should show ralph in output");
  assertContains(result.stdout, "Commands:", "Should show commands section");
});

test("ralph help shows usage", () => {
  const result = ralph(["help"]);
  assertEqual(result.status, 0, `Exit code: ${result.status}`);
  assertContains(result.stdout, "install", "Should list install command");
  assertContains(result.stdout, "build", "Should list build command");
});

test("ralph with no args shows help", () => {
  const result = ralph([]);
  // Should still exit 0 and show help
  assertEqual(result.status, 0, `Exit code: ${result.status}`);
});

// ============================================================
// Test Suite: PRD Command (dry run)
// ============================================================
console.log("\n=== PRD Command ===");

test("ralph prd creates PRD file with --out", () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "ralph-prd-"));
  try {
    const outPath = path.join(projectRoot, "output.md");
    const result = ralph(["prd", "Test PRD", "--out", outPath], {
      cwd: projectRoot,
    });
    assertEqual(result.status, 0, `Exit code: ${result.status}, stderr: ${result.stderr}`);
    assert(existsSync(outPath), "PRD file should be created");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ============================================================
// Test Suite: Ping Command (dry run)
// ============================================================
console.log("\n=== Ping Command ===");

test("ralph ping --agent=codex (dry run)", () => {
  const result = ralph(["ping", "--agent=codex"]);
  assertEqual(result.status, 0, `Exit code: ${result.status}`);
});

test("ralph ping --agent=claude (dry run)", () => {
  const result = ralph(["ping", "--agent=claude"]);
  assertEqual(result.status, 0, `Exit code: ${result.status}`);
});

// Note: droid ping may fail if droid CLI is not configured, skip it in dry run
// since it checks for actual CLI availability

// ============================================================
// Test Suite: Build Command (dry run)
// ============================================================
console.log("\n=== Build Command (dry run) ===");

test("ralph build 1 --no-commit in temp project (dry run)", () => {
  const projectRoot = setupTempProjectWithInstall();
  try {
    const result = ralph(["build", "1", "--no-commit", "--agent=codex"], {
      cwd: projectRoot,
    });
    assertEqual(result.status, 0, `Exit code: ${result.status}, stderr: ${result.stderr}`);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("ralph build with --prd flag (dry run)", () => {
  const projectRoot = setupTempProjectWithPRDFolder();
  try {
    const result = ralph(["build", "1", "--no-commit", "--prd=1", "--agent=codex"], {
      cwd: projectRoot,
    });
    assertEqual(result.status, 0, `Exit code: ${result.status}, stderr: ${result.stderr}`);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ============================================================
// Test Suite: Stream Commands
// ============================================================
console.log("\n=== Stream Commands ===");

test("ralph stream list works in repo root", () => {
  // Run in repo root where .ralph exists
  const result = ralph(["stream", "list"]);
  // May show no PRDs or list PRDs, either is valid (exit 0 or informational message)
  // The command itself runs successfully even if no PRDs exist
  assert(
    result.status === 0 || result.stdout.includes("No") || result.stdout.includes("PRD"),
    `Stream list should work. Status: ${result.status}, stdout: ${result.stdout}, stderr: ${result.stderr}`
  );
});

test("ralph stream status works in repo root", () => {
  const result = ralph(["stream", "status"]);
  // Should run and provide status (may show no streams)
  assert(
    result.status === 0 || result.stdout.length > 0,
    `Stream status should work. Status: ${result.status}, stdout: ${result.stdout}`
  );
});

// ============================================================
// Test Suite: Doctor Command
// ============================================================
console.log("\n=== Doctor Command ===");

test("ralph doctor runs diagnostics", () => {
  const result = ralph(["doctor"]);
  // Doctor command may have various outputs, check it runs
  assertEqual(result.status, 0, `Exit code: ${result.status}`);
});

test("ralph doctor --json outputs JSON with expected structure", () => {
  const result = ralph(["doctor", "--json"]);
  assertEqual(result.status, 0, `Exit code: ${result.status}`);

  // The output may have some prefixed text before JSON, find the JSON object
  const stdout = result.stdout;
  const jsonStart = stdout.indexOf("{");
  if (jsonStart === -1) {
    throw new Error(`No JSON object found in output: ${stdout.slice(0, 300)}`);
  }

  const jsonStr = stdout.slice(jsonStart);

  // Verify structure contains expected top-level keys
  // Full JSON parsing may fail if output is large, so just check structure
  assertContains(jsonStr, '"environment":', "Should have environment key");
  assertContains(jsonStr, '"configuration":', "Should have configuration key");
  assertContains(jsonStr, '"state":', "Should have state key");
  assertContains(jsonStr, '"checks":', "Should have checks array");
});

// ============================================================
// Test Suite: Log Command
// ============================================================
console.log("\n=== Log Command ===");

test("ralph log writes to activity.log", () => {
  const projectRoot = setupTempProjectWithInstall();
  try {
    const result = ralph(["log", "Test message"], { cwd: projectRoot });
    assertEqual(result.status, 0, `Exit code: ${result.status}, stderr: ${result.stderr}`);

    const logPath = path.join(projectRoot, ".ralph", "activity.log");
    assert(existsSync(logPath), "Activity log should be created");

    const logContent = readFileSync(logPath, "utf-8");
    assertContains(logContent, "Test message", "Log should contain message");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ============================================================
// Test Suite: Install Command
// ============================================================
console.log("\n=== Install Command ===");

test("ralph install creates .agents/ralph directory", () => {
  const projectRoot = mkdtempSync(path.join(tmpdir(), "ralph-install-"));
  try {
    // Remove any pre-existing .agents directory
    const agentsDir = path.join(projectRoot, ".agents");
    if (existsSync(agentsDir)) {
      rmSync(agentsDir, { recursive: true, force: true });
    }

    const result = ralph(["install"], { cwd: projectRoot });
    assertEqual(result.status, 0, `Exit code: ${result.status}`);

    const ralphDir = path.join(projectRoot, ".agents", "ralph");
    assert(existsSync(ralphDir), ".agents/ralph should be created");

    // Verify loop.sh exists after install
    const loopPath = path.join(ralphDir, "loop.sh");
    assert(existsSync(loopPath), "loop.sh should exist after install");
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

// ============================================================
// Summary
// ============================================================
console.log("\n=== Integration Test Summary ===");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log("\nIntegration tests passed.");
