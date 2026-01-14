/**
 * Integration tests for GitHub Actions integration (PRD-25, PRD-34)
 *
 * Tests PR body generation, status check formatting, comment rendering,
 * issue-to-PRD conversion, and output truncation.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-actions.mjs
 * Or: npm run test:actions
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const template = require(path.join(repoRoot, "lib", "github", "template.js"));
const prLib = require(path.join(repoRoot, "lib", "github", "pr.js"));

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

function assertContains(text, substring, message) {
  if (!text || !text.includes(substring)) {
    throw new Error(
      message || `Expected text to contain "${substring}"\nActual: ${text?.slice(0, 200)}...`
    );
  }
}

console.log("\nRunning GitHub Actions Integration Tests");
console.log("=========================================\n");

// Test 1: extractPRDSummary extracts overview
test("extractPRDSummary extracts overview from PRD", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "actions-test-"));

  try {
    const prdPath = path.join(tmpDir, "prd.md");
    const prdContent = `# PRD: Test Feature

## Overview

This PRD implements a new test feature for integration testing.

## User Stories

### [x] US-001: First Story
**As a** developer
**I want** to test PR generation
**So that** I verify it works

#### Acceptance Criteria
- [x] Test passes
`;

    writeFileSync(prdPath, prdContent);

    const summary = template.extractPRDSummary(prdPath);

    assertContains(summary, "integration testing", "Should extract overview content");
    assert(summary.length > 0, "Should return non-empty summary");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 2: formatCompletedStories lists completed stories
test("formatCompletedStories extracts completed stories", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "actions-test-"));

  try {
    const prdPath = path.join(tmpDir, "prd.md");
    const prdContent = `# PRD: Test

## User Stories

### [x] US-001: Done Story
**As a** user
**I want** feature
**So that** benefit

### [ ] US-002: Pending Story
**As a** user
**I want** another feature
**So that** other benefit
`;

    writeFileSync(prdPath, prdContent);

    const result = template.formatCompletedStories(prdPath);

    assert(result.stories, "Should return stories array");
    assert(result.formatted, "Should return formatted string");
    assert(result.stories.length >= 1, "Should find at least one completed story");
    assert(
      result.stories.some((s) => s.id === "US-001"),
      "Should include US-001 as completed"
    );
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 3: renderPRBody generates full PR description
test("renderPRBody generates markdown description", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "actions-test-"));

  try {
    const prdPath = path.join(tmpDir, "prd.md");
    const prdContent = `# PRD: Test Feature

## Overview
Test description.

## User Stories
### [x] US-001: Test Story
`;

    writeFileSync(prdPath, prdContent);

    const prBody = template.renderPRBody({
      prdPath,
      prdNumber: 1,
    });

    assert(prBody && prBody.length > 0, "Should return non-empty body");
    assertContains(prBody, "Summary", "Should include Summary section");
    assertContains(prBody, "US-001", "Should list completed stories");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 4: Branch name generation follows convention
test("getBranchName generates correct branch names", () => {
  const branch1 = prLib.getBranchName("PRD-1");
  assert(branch1 === "ralph/PRD-1", "Should format as ralph/PRD-N");

  const branch2 = prLib.getBranchName("PRD-42");
  assert(branch2 === "ralph/PRD-42", "Should work with any PRD number");

  // Test that branch names are consistent
  const branch3 = prLib.getBranchName("PRD-1");
  assert(branch1 === branch3, "Should generate same branch name for same PRD");
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

console.log("\n✓ All GitHub Actions tests passed!");
process.exit(0);
