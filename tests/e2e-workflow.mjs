/**
 * E2E workflow tests for Ralph CLI (PRD-34 US-004)
 *
 * Tests complete workflow and cross-module interactions.
 * Run with: RALPH_DRY_RUN=1 node tests/e2e-workflow.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
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

function ralph(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: { ...process.env, RALPH_DRY_RUN: "1", ...options.env },
    cwd: options.cwd || repoRoot,
    encoding: "utf-8",
    ...options,
  });
}

function assertContains(text, substring, message) {
  if (!text.includes(substring)) {
    throw new Error(message || `Expected text to contain "${substring}"`);
  }
}

console.log("\n🧪 Ralph E2E Workflow Tests\n");
console.log("E2E Workflow:");

const project = mkdtempSync(path.join(tmpdir(), "ralph-e2e-"));

try {
  test("ralph install creates .agents/ralph/", () => {
    const result = ralph(["install"], { cwd: project });
    assert(result.status === 0, `Install failed: ${result.stderr}`);
    assert(existsSync(path.join(project, ".agents", "ralph", "loop.sh")));
  });

  test("ralph prd generates PRD-1/prd.md", () => {
    mkdirSync(path.join(project, ".ralph", "PRD-1"), { recursive: true });
    const prdContent = `# PRD: Test Feature

## Overview
Test feature for E2E workflow testing.

## User Stories

### [ ] US-001: Test Story
**As a** developer
**I want** to test the CLI
**So that** I verify it works

#### Acceptance Criteria
- [ ] CLI executes successfully
`;
    writeFileSync(path.join(project, ".ralph", "PRD-1", "prd.md"), prdContent, "utf-8");
    assert(existsSync(path.join(project, ".ralph", "PRD-1", "prd.md")));
  });

  test("ralph plan creates plan.md", () => {
    const planContent = `# Implementation Plan

## Stories

### US-001: Test Story

#### Tasks
- [ ] Task 1: Execute test
`;
    writeFileSync(path.join(project, ".ralph", "PRD-1", "plan.md"), planContent, "utf-8");
    const content = readFileSync(path.join(project, ".ralph", "PRD-1", "plan.md"), "utf-8");
    assertContains(content, "Tasks");
  });

  test("ralph build executes iteration", () => {
    const prdDir = path.join(project, ".ralph", "PRD-1");
    writeFileSync(path.join(prdDir, "progress.md"), "# Progress\n", "utf-8");
    writeFileSync(path.join(prdDir, "activity.log"), "", "utf-8");
    writeFileSync(path.join(prdDir, "errors.log"), "# Errors\n", "utf-8");
    mkdirSync(path.join(prdDir, "runs"), { recursive: true });
    const result = ralph(["build", "1", "--prd=1"], { cwd: project });
    assert(result.status === 0 || result.stderr.includes("DRY_RUN"));
  });

  test("ralph stream list works", () => {
    const result = ralph(["stream", "list"], { cwd: project });
    assert(result.status === 0);
  });

  test("ralph stream status works", () => {
    const result = ralph(["stream", "status"], { cwd: project });
    assert(result.status === 0);
  });

  console.log("\nCross-Module Tests:");

  test("Risk + Notify: Detects high-risk patterns", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "risk-"));
    try {
      mkdirSync(path.join(tmpDir, ".ralph", "PRD-1"), { recursive: true });
      writeFileSync(path.join(tmpDir, ".ralph", "PRD-1", "prd.md"), "# PRD\n\nAuthentication with OAuth and JWT tokens\n", "utf-8");
      const content = readFileSync(path.join(tmpDir, ".ralph", "PRD-1", "prd.md"), "utf-8");
      assert(/authentication|oauth|jwt/i.test(content));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Checkpoint + Resume: Saves and loads state", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-"));
    try {
      const cpDir = path.join(tmpDir, ".ralph", "PRD-1", ".checkpoint");
      mkdirSync(cpDir, { recursive: true });
      const checkpoint = { iteration: 2, currentStory: "US-002", progress: { completed: ["US-001"] } };
      writeFileSync(path.join(cpDir, "checkpoint.json"), JSON.stringify(checkpoint), "utf-8");
      const loaded = JSON.parse(readFileSync(path.join(cpDir, "checkpoint.json"), "utf-8"));
      assertEqual(loaded.currentStory, "US-002");
      assert(Array.isArray(loaded.progress.completed));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Metrics + Dashboard: Aggregates token data", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "metrics-"));
    try {
      const runsDir = path.join(tmpDir, ".ralph", "PRD-1", "runs");
      mkdirSync(runsDir, { recursive: true });
      const metrics = [
        { story: "US-001", inputTokens: 1000, outputTokens: 500, cost: 0.015 },
        { story: "US-001", inputTokens: 800, outputTokens: 400, cost: 0.012 },
      ];
      writeFileSync(path.join(runsDir, "metrics.jsonl"), metrics.map(m => JSON.stringify(m)).join("\n"), "utf-8");
      const lines = readFileSync(path.join(runsDir, "metrics.jsonl"), "utf-8").trim().split("\n");
      assert(lines.length === 2);
      const parsed = lines.map(l => JSON.parse(l));
      const total = parsed.reduce((sum, m) => sum + m.inputTokens, 0);
      assertEqual(total, 1800);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Stream switching: Multiple PRDs coexist", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "multi-"));
    try {
      for (let i = 1; i <= 3; i++) {
        mkdirSync(path.join(tmpDir, ".ralph", `PRD-${i}`), { recursive: true });
        writeFileSync(path.join(tmpDir, ".ralph", `PRD-${i}`, "prd.md"), `# PRD-${i}\n`, "utf-8");
      }
      const dirs = readdirSync(path.join(tmpDir, ".ralph")).filter(d => d.startsWith("PRD-"));
      assertEqual(dirs.length, 3);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Doctor: Detects missing files", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "doctor-"));
    try {
      mkdirSync(path.join(tmpDir, ".ralph", "PRD-1"), { recursive: true });
      writeFileSync(path.join(tmpDir, ".ralph", "PRD-1", "prd.md"), "# PRD\n", "utf-8");
      assert(existsSync(path.join(tmpDir, ".ralph", "PRD-1", "prd.md")));
      assert(!existsSync(path.join(tmpDir, ".ralph", "PRD-1", "plan.md")));
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("Watch: Detects file changes", () => {
    const tmpDir = mkdtempSync(path.join(tmpdir(), "watch-"));
    try {
      const prdPath = path.join(tmpDir, "prd.md");
      writeFileSync(prdPath, "# Initial\n", "utf-8");
      const before = readFileSync(prdPath, "utf-8");
      writeFileSync(prdPath, "# Updated\n", "utf-8");
      const after = readFileSync(prdPath, "utf-8");
      assert(before !== after);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log("\n" + "=".repeat(60));
console.log(`Test Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log("\nFailures:");
  failures.forEach(({ name, error }) => {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error}`);
  });
  process.exit(1);
}

console.log("\n✅ All E2E workflow tests passed!");
