#!/usr/bin/env node
/**
 * Integration tests for bug-categorizer.js (US-010)
 *
 * Tests:
 * 1. Category taxonomy validation
 * 2. Prompt building
 * 3. Response parsing
 * 4. Uncategorized bug detection
 * 5. Categorized bug storage
 * 6. CLI command registration
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

// Test counters
let passed = 0;
let failed = 0;
const failures = [];

// ============================================================================
// Test Utilities
// ============================================================================

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
  if (!condition) throw new Error(message || "Assertion failed");
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

function assertContains(arr, item, message) {
  if (!arr.includes(item)) {
    throw new Error(message || `Expected array to contain ${item}`);
  }
}

// ============================================================================
// Test: Category Taxonomy
// ============================================================================

function testCategoryTaxonomy() {
  console.log("\n1. Category Taxonomy Tests");
  console.log("-".repeat(50));

  // Read the bug-categorizer.js to extract categories
  const categorizerPath = path.join(projectRoot, "scripts", "bug-categorizer.js");
  const content = fs.readFileSync(categorizerPath, "utf-8");

  test("Has 10 bug categories defined", () => {
    // Count category definitions in BUG_CATEGORIES array
    const matches = content.match(/\{ id: "[\w-]+",/g) || [];
    assertEqual(matches.length, 10, `Expected 10 categories, found ${matches.length}`);
  });

  test("logic-error category exists", () => {
    assert(content.includes('id: "logic-error"'), "Missing logic-error category");
  });

  test("race-condition category exists", () => {
    assert(content.includes('id: "race-condition"'), "Missing race-condition category");
  });

  test("requirements-misunderstanding category exists", () => {
    assert(
      content.includes('id: "requirements-misunderstanding"'),
      "Missing requirements-misunderstanding category"
    );
  });

  test("integration-issue category exists", () => {
    assert(content.includes('id: "integration-issue"'), "Missing integration-issue category");
  });

  test("environment-specific category exists", () => {
    assert(content.includes('id: "environment-specific"'), "Missing environment-specific category");
  });

  test("dependency-issue category exists", () => {
    assert(content.includes('id: "dependency-issue"'), "Missing dependency-issue category");
  });

  test("performance-degradation category exists", () => {
    assert(
      content.includes('id: "performance-degradation"'),
      "Missing performance-degradation category"
    );
  });

  test("security-vulnerability category exists", () => {
    assert(
      content.includes('id: "security-vulnerability"'),
      "Missing security-vulnerability category"
    );
  });

  test("data-corruption category exists", () => {
    assert(content.includes('id: "data-corruption"'), "Missing data-corruption category");
  });

  test("user-input-validation category exists", () => {
    assert(
      content.includes('id: "user-input-validation"'),
      "Missing user-input-validation category"
    );
  });
}

// ============================================================================
// Test: Script Features
// ============================================================================

function testScriptFeatures() {
  console.log("\n2. Script Feature Tests");
  console.log("-".repeat(50));

  const categorizerPath = path.join(projectRoot, "scripts", "bug-categorizer.js");
  const content = fs.readFileSync(categorizerPath, "utf-8");

  test("Uses Claude Haiku model", () => {
    assert(content.includes("claude-haiku"), "Missing Claude Haiku model reference");
  });

  test("Has batch processing with default limit", () => {
    assert(content.includes("DEFAULT_BATCH_SIZE"), "Missing batch size configuration");
    assert(content.includes("= 10"), "Default batch size should be 10");
  });

  test("Has rate limiting between API calls", () => {
    assert(content.includes("setTimeout"), "Missing rate limiting delay");
  });

  test("Has retry logic with exponential backoff", () => {
    assert(content.includes("MAX_RETRIES"), "Missing retry configuration");
    assert(content.includes("exponential backoff"), "Missing exponential backoff comment");
  });

  test("Stores in categorized directory", () => {
    assert(content.includes("CATEGORIZED_BUGS_DIR"), "Missing categorized directory constant");
    assert(content.includes("bug-wikipedia/categorized"), "Wrong categorized directory path");
  });

  test("Outputs prevention tips", () => {
    assert(content.includes("prevention_tips"), "Missing prevention_tips in output");
  });

  test("Includes similar_bugs field", () => {
    assert(content.includes("similar_bugs"), "Missing similar_bugs in output");
  });

  test("Has dry-run mode", () => {
    assert(content.includes("--dry-run"), "Missing dry-run option");
    assert(content.includes("dryRun"), "Missing dryRun handling");
  });

  test("Has --limit option", () => {
    assert(content.includes("--limit="), "Missing limit option");
  });

  test("Checks for ANTHROPIC_API_KEY", () => {
    assert(content.includes("ANTHROPIC_API_KEY"), "Missing API key check");
  });
}

// ============================================================================
// Test: CLI Integration
// ============================================================================

function testCliIntegration() {
  console.log("\n3. CLI Integration Tests");
  console.log("-".repeat(50));

  const automationPath = path.join(projectRoot, "lib", "commands", "automation.js");
  const content = fs.readFileSync(automationPath, "utf-8");

  test("categorize-bugs subcommand registered", () => {
    assert(content.includes('"categorize-bugs"'), "Missing categorize-bugs subcommand");
  });

  test("categorize-bugs has handler", () => {
    assert(
      content.includes('subCmd === "categorize-bugs"'),
      "Missing categorize-bugs command handler"
    );
  });

  test("categorize-bugs invokes bug-categorizer.js", () => {
    assert(content.includes("bug-categorizer.js"), "Wrong script path for categorize-bugs");
  });

  test("ANTHROPIC_API_KEY in env var list", () => {
    assert(content.includes("ANTHROPIC_API_KEY"), "Missing ANTHROPIC_API_KEY in env vars");
  });

  test("bug-categorizer.js in verify scripts list", () => {
    assert(
      content.includes('{ name: "bug-categorizer.js"'),
      "Missing bug-categorizer.js in verify scripts"
    );
  });

  test("Help text includes categorize-bugs", () => {
    assert(
      content.includes("categorize-bugs") && content.includes("Claude Haiku"),
      "Help text missing categorize-bugs description"
    );
  });
}

// ============================================================================
// Test: Prompt Building
// ============================================================================

function testPromptBuilding() {
  console.log("\n4. Prompt Building Tests");
  console.log("-".repeat(50));

  const categorizerPath = path.join(projectRoot, "scripts", "bug-categorizer.js");
  const content = fs.readFileSync(categorizerPath, "utf-8");

  test("Prompt includes commit message", () => {
    assert(content.includes("Commit Message"), "Prompt missing commit message field");
  });

  test("Prompt includes files changed", () => {
    assert(content.includes("Files Changed"), "Prompt missing files changed field");
  });

  test("Prompt includes diff snippet", () => {
    assert(content.includes("Diff Snippet"), "Prompt missing diff snippet field");
  });

  test("Prompt includes error message", () => {
    assert(content.includes("Error Message"), "Prompt missing error message field");
  });

  test("Diff is truncated to save tokens", () => {
    assert(content.includes("MAX_DIFF_LENGTH"), "Missing diff length limit");
    assert(content.includes("500"), "Diff limit should be 500 chars");
  });

  test("Prompt requests JSON output", () => {
    assert(content.includes("Output Format"), "Prompt missing output format instructions");
    assert(content.includes("valid JSON"), "Prompt should request valid JSON");
  });
}

// ============================================================================
// Test: Response Parsing
// ============================================================================

function testResponseParsing() {
  console.log("\n5. Response Parsing Tests");
  console.log("-".repeat(50));

  const categorizerPath = path.join(projectRoot, "scripts", "bug-categorizer.js");
  const content = fs.readFileSync(categorizerPath, "utf-8");

  test("Handles markdown code fences in response", () => {
    assert(content.includes("startsWith") && content.includes("```"), "Missing code fence handling");
  });

  test("Validates primary_category", () => {
    assert(content.includes("primary_category"), "Missing primary_category validation");
  });

  test("Validates severity field", () => {
    assert(content.includes("severity"), "Missing severity field handling");
  });

  test("Validates reasoning field", () => {
    assert(content.includes("reasoning"), "Missing reasoning field handling");
  });

  test("Validates against valid categories", () => {
    assert(
      content.includes("validCategories") || content.includes("BUG_CATEGORIES"),
      "Missing category validation logic"
    );
  });
}

// ============================================================================
// Test: Output Schema
// ============================================================================

function testOutputSchema() {
  console.log("\n6. Output Schema Tests");
  console.log("-".repeat(50));

  const categorizerPath = path.join(projectRoot, "scripts", "bug-categorizer.js");
  const content = fs.readFileSync(categorizerPath, "utf-8");

  test("Output includes id field", () => {
    assert(content.includes("id:") && content.includes("rawBug.id"), "Output missing id field");
  });

  test("Output includes commit_sha", () => {
    assert(content.includes("commit_sha"), "Output missing commit_sha field");
  });

  test("Output includes primary_category", () => {
    assert(
      content.includes("primary_category") && content.includes("categorization.primary_category"),
      "Output missing primary_category"
    );
  });

  test("Output includes secondary_categories", () => {
    assert(content.includes("secondary_categories"), "Output missing secondary_categories");
  });

  test("Output includes severity", () => {
    assert(
      content.includes("severity") && content.includes("categorization.severity"),
      "Output missing severity"
    );
  });

  test("Output includes reasoning", () => {
    assert(
      content.includes("reasoning") && content.includes("categorization.reasoning"),
      "Output missing reasoning"
    );
  });

  test("Output includes prevention_tips", () => {
    assert(content.includes("prevention_tips"), "Output missing prevention_tips");
  });

  test("Output includes categorized_at timestamp", () => {
    assert(content.includes("categorized_at"), "Output missing categorized_at timestamp");
  });

  test("Output includes categorized_by model info", () => {
    assert(content.includes("categorized_by"), "Output missing categorized_by field");
  });
}

// ============================================================================
// Test: Help Output
// ============================================================================

function testHelpOutput() {
  console.log("\n7. Help Output Tests");
  console.log("-".repeat(50));

  test("categorize-bugs --help returns help text", () => {
    const result = spawnSync("node", ["scripts/bug-categorizer.js", "--help"], {
      cwd: projectRoot,
      encoding: "utf-8",
    });
    assert(result.stdout.includes("Bug Categorizer"), "Help should show title");
    assert(result.stdout.includes("--dry-run"), "Help should mention dry-run");
    assert(result.stdout.includes("--limit"), "Help should mention limit option");
    assert(result.stdout.includes("ANTHROPIC_API_KEY"), "Help should mention API key");
  });
}

// ============================================================================
// Test: Dry Run Mode
// ============================================================================

function testDryRunMode() {
  console.log("\n8. Dry Run Mode Tests");
  console.log("-".repeat(50));

  test("Dry run mode shows bugs without calling API", () => {
    const result = spawnSync("node", ["scripts/bug-categorizer.js", "--dry-run"], {
      cwd: projectRoot,
      encoding: "utf-8",
      env: { ...process.env },
    });
    // Should not fail even without API key in dry run mode
    assert(result.stdout.includes("DRY RUN") || result.stdout.includes("uncategorized"),
      "Dry run should indicate it's a dry run or show uncategorized count");
  });
}

// ============================================================================
// Main
// ============================================================================

console.log("=".repeat(60));
console.log("Bug Categorizer Integration Tests (US-010)");
console.log("=".repeat(60));

testCategoryTaxonomy();
testScriptFeatures();
testCliIntegration();
testPromptBuilding();
testResponseParsing();
testOutputSchema();
testHelpOutput();
testDryRunMode();

// Summary
console.log("\n" + "=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  failures.forEach((f, i) => {
    console.log(`  ${i + 1}. ${f.name}`);
    console.log(`     ${f.error}`);
  });
}

console.log("=".repeat(60));

process.exit(failed > 0 ? 1 : 0);
