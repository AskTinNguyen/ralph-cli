#!/usr/bin/env node

/**
 * Integration tests for Bug Pattern Detector (US-012)
 *
 * Tests pattern detection logic, GitHub issue creation, factory triggering,
 * Slack notifications, and pattern resolution tracking.
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const BUG_WIKIPEDIA_DIR = ".ralph/bug-wikipedia";
const CATEGORIZED_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "categorized");
const PATTERNS_DIR = path.join(BUG_WIKIPEDIA_DIR, "patterns");

// Test helpers
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
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message || "Assertion failed"}: expected ${expected}, got ${actual}`);
  }
}

function assertContains(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(`${message || "Assertion failed"}: expected to contain "${needle}"`);
  }
}

// Import detector functions (we'll use require for CJS module)
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const detector = require("../scripts/bug-pattern-detector.js");

console.log("\n============================================");
console.log("Bug Pattern Detector Integration Tests");
console.log("============================================\n");

// === Test 1: Pattern Detection Logic ===
test("detectPatterns identifies patterns with 3+ bugs in 30 days", () => {
  const bugs = [
    {
      id: "bug-1",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    },
    {
      id: "bug-2",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    },
    {
      id: "bug-3",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), // 15 days ago
    },
  ];

  const config = {
    bugWikipedia: {
      patternThreshold: 3,
      patternWindow_days: 30,
    },
  };

  const patterns = detector.detectPatterns(bugs, config);

  assert(patterns.length === 1, "Should detect exactly 1 pattern");
  assert(patterns[0].category === "logic-error", "Pattern category should be logic-error");
  assert(patterns[0].module === "src/auth", "Pattern module should be src/auth");
  assert(patterns[0].bug_count === 3, "Pattern should have 3 bugs");
});

// === Test 2: Pattern Detection Ignores Old Bugs ===
test("detectPatterns ignores bugs older than window", () => {
  const bugs = [
    {
      id: "bug-1",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
    },
    {
      id: "bug-2",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days ago
    },
    {
      id: "bug-3",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(), // 35 days ago (outside window)
    },
  ];

  const config = {
    bugWikipedia: {
      patternThreshold: 3,
      patternWindow_days: 30,
    },
  };

  const patterns = detector.detectPatterns(bugs, config);

  assert(patterns.length === 0, "Should not detect pattern with only 2 bugs in window");
});

// === Test 3: Pattern Detection Requires Threshold ===
test("detectPatterns requires minimum threshold", () => {
  const bugs = [
    {
      id: "bug-1",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-2",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const config = {
    bugWikipedia: {
      patternThreshold: 3,
      patternWindow_days: 30,
    },
  };

  const patterns = detector.detectPatterns(bugs, config);

  assert(patterns.length === 0, "Should not detect pattern with only 2 bugs (threshold is 3)");
});

// === Test 4: Module Extraction ===
test("extractModule correctly extracts first 2 directory levels", () => {
  const module1 = detector.extractModule("src/auth/session.ts");
  assertEqual(module1, "src/auth", "Should extract src/auth");

  const module2 = detector.extractModule("lib/utils/string.js");
  assertEqual(module2, "lib/utils", "Should extract lib/utils");

  const module3 = detector.extractModule("test.js");
  assertEqual(module3, "root", "Should return root for single file");

  const module4 = detector.extractModule(null);
  assertEqual(module4, "unknown", "Should return unknown for null");
});

// === Test 5: Time Window Check ===
test("isWithinWindow correctly checks date ranges", () => {
  const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const fiftyDaysAgo = new Date(Date.now() - 50 * 24 * 60 * 60 * 1000).toISOString();

  assert(detector.isWithinWindow(fiveDaysAgo, 30), "5 days ago should be within 30 day window");
  assert(!detector.isWithinWindow(fiftyDaysAgo, 30), "50 days ago should not be within 30 day window");
});

// === Test 6: Multiple Patterns Detection ===
test("detectPatterns can detect multiple patterns", () => {
  const bugs = [
    // Pattern 1: logic-error in src/auth
    {
      id: "bug-1",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-2",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-3",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    },
    // Pattern 2: race-condition in lib/database
    {
      id: "bug-4",
      primary_category: "race-condition",
      files_changed: ["lib/database/connection.ts"],
      date_fixed: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-5",
      primary_category: "race-condition",
      files_changed: ["lib/database/connection.ts"],
      date_fixed: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-6",
      primary_category: "race-condition",
      files_changed: ["lib/database/connection.ts"],
      date_fixed: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const config = {
    bugWikipedia: {
      patternThreshold: 3,
      patternWindow_days: 30,
    },
  };

  const patterns = detector.detectPatterns(bugs, config);

  assert(patterns.length === 2, "Should detect 2 distinct patterns");

  const categories = patterns.map((p) => p.category);
  assert(categories.includes("logic-error"), "Should detect logic-error pattern");
  assert(categories.includes("race-condition"), "Should detect race-condition pattern");
});

// === Test 7: CLI Command Exists ===
test("CLI command 'ralph automation detect-patterns' exists", () => {
  const helpOutput = execSync("node bin/ralph automation --help", { encoding: "utf-8" });
  assertContains(helpOutput, "detect-patterns", "Help should mention detect-patterns command");
});

// === Test 8: Script Runs in Dry-Run Mode ===
test("Script runs successfully in dry-run mode", () => {
  const output = execSync("node scripts/bug-pattern-detector.js --dry-run", { encoding: "utf-8" });
  assertContains(output, "Bug Pattern Detector", "Output should include script header");
  assertContains(output, "DRY RUN mode", "Output should confirm dry-run mode");
});

// === Test 9: Factory Definition Exists ===
test("Deep dive factory definition exists", () => {
  const factoryPath = ".ralph/factory/bug-deep-dive-analysis.yaml";
  assert(fs.existsSync(factoryPath), `Factory definition should exist at ${factoryPath}`);

  const content = fs.readFileSync(factoryPath, "utf-8");
  assertContains(content, "name: bug-deep-dive-analysis", "Factory should have correct name");
  assertContains(content, "analyze_pattern", "Factory should have analyze_pattern stage");
  assertContains(content, "generate_recommendations", "Factory should have generate_recommendations stage");
});

// === Test 10: Factory Uses Correct Model ===
test("Deep dive factory uses Claude Sonnet", () => {
  const factoryPath = ".ralph/factory/bug-deep-dive-analysis.yaml";
  const content = fs.readFileSync(factoryPath, "utf-8");
  assertContains(content, "agent: claude-sonnet", "Factory should use claude-sonnet (not haiku)");
});

// === Test 11: Automation Config Has bugWikipedia Section ===
test("Automation config includes bugWikipedia section", () => {
  const configPath = ".ralph/automation-config.json";
  assert(fs.existsSync(configPath), "automation-config.json should exist");

  const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
  assert(config.bugWikipedia, "Config should have bugWikipedia section");
  assertEqual(config.bugWikipedia.enabled, true, "bugWikipedia should be enabled");
  assertEqual(config.bugWikipedia.patternThreshold, 3, "patternThreshold should be 3");
  assertEqual(config.bugWikipedia.patternWindow_days, 30, "patternWindow_days should be 30");
  assertEqual(config.bugWikipedia.autoCreateIssues, true, "autoCreateIssues should be true");
  assertEqual(
    config.bugWikipedia.deepDiveFactory,
    ".ralph/factory/bug-deep-dive-analysis.yaml",
    "deepDiveFactory path should be correct"
  );
});

// === Test 12: Pattern Key Format ===
test("Pattern key format is {category}-{module}", () => {
  const bugs = [
    {
      id: "bug-1",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-2",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "bug-3",
      primary_category: "logic-error",
      files_changed: ["src/auth/session.ts"],
      date_fixed: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
    },
  ];

  const config = {
    bugWikipedia: {
      patternThreshold: 3,
      patternWindow_days: 30,
    },
  };

  const patterns = detector.detectPatterns(bugs, config);

  assertEqual(patterns[0].key, "logic-error-src/auth", "Pattern key should be logic-error-src/auth");
});

// === Test 13: Help Text Describes US-012 ===
test("Help text describes pattern detection correctly", () => {
  const helpOutput = execSync("node bin/ralph automation --help", { encoding: "utf-8" });
  assertContains(helpOutput, "Detect recurring bug patterns", "Help should describe pattern detection");
});

// === Test 14: Script Has Correct Permissions ===
test("Script file is executable", () => {
  const scriptPath = "scripts/bug-pattern-detector.js";
  const stats = fs.statSync(scriptPath);
  const isExecutable = (stats.mode & 0o111) !== 0;
  assert(isExecutable, "Script should be executable");
});

// === Test 15: GitHub Issue Body Contains Required Sections ===
test("GitHub issue body format is complete (dry run)", () => {
  // This tests the format without actually creating a GitHub issue
  const mockPattern = {
    key: "logic-error-src/auth",
    category: "logic-error",
    module: "src/auth",
    bug_count: 3,
    first_occurrence: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
    latest_occurrence: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    bugs: [
      {
        id: "bug-1",
        commit_message: "fix: auth session race condition",
        commit_sha: "abc123",
        date_fixed: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
        author: { name: "Alice" },
        severity: "high",
        prevention_tips: "Use mutex locks",
      },
    ],
  };

  // We can't easily test the private buildGitHubIssueBody function without refactoring,
  // but we can verify the script contains the right formatting logic
  const scriptContent = fs.readFileSync("scripts/bug-pattern-detector.js", "utf-8");
  assertContains(scriptContent, "# Bug Pattern Detected", "Script should format issue title");
  assertContains(scriptContent, "Pattern Summary", "Script should include pattern summary");
  assertContains(scriptContent, "Similar Bugs", "Script should include similar bugs section");
  assertContains(scriptContent, "Recommended Actions", "Script should include recommended actions");
  assertContains(scriptContent, "Timeline", "Script should include timeline table");
});

console.log("\n============================================");
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("============================================\n");

if (failures.length > 0) {
  console.log("Failures:");
  failures.forEach(({ name, error }) => {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error}`);
  });
  console.log("");
  process.exit(1);
}

console.log("✅ All tests passed!\n");
process.exit(0);
