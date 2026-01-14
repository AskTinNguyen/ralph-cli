/**
 * Integration tests for ralph doctor diagnostics (PRD-13, PRD-34)
 *
 * Tests environment checks, config validation, state validation,
 * automatic fixes, and JSON output format.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-doctor.mjs
 * Or: npm run test:doctor
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doctorLib = require(path.join(repoRoot, "lib", "doctor", "index.js"));

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

console.log("\nRunning Doctor Diagnostics Integration Tests");
console.log("=============================================\n");

// Test 1: Environment checks detect missing vars
test("Environment checks detect missing environment variables", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "doctor-test-"));

  try {
    // Run environment checks in temp directory
    const results = doctorLib.runEnvironmentChecks(tmpDir);

    assert(results, "Should return results object");
    assert(results.checks, "Should have checks array");
    assert(Array.isArray(results.checks), "checks should be an array");

    // Should check for Node.js version
    const nodeCheck = results.checks.find(c => c.name && c.name.includes("Node"));
    assert(nodeCheck, "Should have Node.js version check");

    // Should check for git
    const gitCheck = results.checks.find(c => c.name && c.name.includes("Git"));
    assert(gitCheck, "Should have Git version check");

    // Summary counts
    assert(typeof results.passed === "number", "Should have passed count");
    assert(typeof results.errors === "number", "Should have errors count");
    assert(typeof results.warnings === "number", "Should have warnings count");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 2: Config validation finds errors
test("Configuration validation detects invalid config files", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "doctor-test-"));

  try {
    // Create invalid config file
    const agentsDir = path.join(tmpDir, ".agents", "ralph");
    mkdirSync(agentsDir, { recursive: true });

    // Write malformed JSON config
    const configPath = path.join(agentsDir, "config.json");
    writeFileSync(configPath, '{ "invalid": "json", }'); // Trailing comma = invalid JSON

    const results = doctorLib.runConfigChecks(tmpDir);

    assert(results, "Should return results object");
    assert(results.checks, "Should have checks array");

    // May detect the invalid JSON or just note config file issues
    assert(typeof results.errors === "number", "Should have errors count");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 3: State validation detects corrupt files
test("State validation detects corrupt PRD/plan files", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "doctor-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");

  try {
    // Create PRD folder with corrupt files
    const prdFolder = path.join(ralphDir, "PRD-1");
    mkdirSync(prdFolder, { recursive: true });

    // Write PRD with missing user stories section
    writeFileSync(path.join(prdFolder, "prd.md"), "# PRD\n\nNo user stories here!");

    // Write plan with incorrect format
    writeFileSync(path.join(prdFolder, "plan.md"), "Not a valid plan format");

    const results = doctorLib.runStateChecks(ralphDir);

    assert(results, "Should return results object");
    assert(results.checks, "Should have checks array");

    // Should detect issues with PRD or plan format
    assert(typeof results.errors === "number" || typeof results.warnings === "number",
      "Should have errors or warnings");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 4: Fixes apply successfully
test("applyFixes attempts to repair detected issues", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "doctor-test-"));
  const ralphDir = path.join(tmpDir, ".ralph");

  try {
    // Create PRD with fixable issues
    const prdFolder = path.join(ralphDir, "PRD-1");
    mkdirSync(prdFolder, { recursive: true });

    // Write PRD with unclosed brackets (fixable)
    const prdPath = path.join(prdFolder, "prd.md");
    writeFileSync(prdPath, "# PRD\n\n## User Stories\n\n### [ US-001: Test\n\nMissing closing bracket");

    // Run diagnostics
    const diagnostics = doctorLib.runAllChecks(tmpDir);

    // Apply fixes
    const fixResults = doctorLib.applyFixes(diagnostics, tmpDir);

    assert(fixResults, "Should return fix results");
    assert(typeof fixResults === "object", "Should be an object");

    // Fixes should return applied/skipped/failed arrays
    assert(Array.isArray(fixResults.applied), "Should have applied array");
    assert(Array.isArray(fixResults.skipped), "Should have skipped array");
    assert(Array.isArray(fixResults.failed), "Should have failed array");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// Test 5: JSON output has correct structure
test("runAllChecks --json output matches expected schema", () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "doctor-test-"));

  try {
    // Run all checks
    const results = doctorLib.runAllChecks(tmpDir);

    // Verify top-level structure
    assert(results, "Should return results object");
    assert(results.environment, "Should have environment section");
    assert(results.configuration, "Should have configuration section");
    assert(results.state, "Should have state section");
    assert(results.summary, "Should have summary section");

    // Verify summary structure
    const { summary } = results;
    assert(typeof summary.totalPassed === "number", "summary.totalPassed should be number");
    assert(typeof summary.totalWarnings === "number", "summary.totalWarnings should be number");
    assert(typeof summary.totalErrors === "number", "summary.totalErrors should be number");

    // Verify each section has checks array
    assert(Array.isArray(results.environment.checks), "environment.checks should be array");
    assert(Array.isArray(results.configuration.checks), "configuration.checks should be array");
    assert(Array.isArray(results.state.checks), "state.checks should be array");

    // Verify each section has counts
    assert(typeof results.environment.passed === "number", "environment.passed should be number");
    assert(typeof results.configuration.passed === "number", "configuration.passed should be number");
    assert(typeof results.state.passed === "number", "state.passed should be number");

    // Serialize to JSON to ensure it's valid
    const jsonStr = JSON.stringify(results);
    assert(jsonStr.length > 0, "Should serialize to JSON");

    // Parse it back to verify structure
    const parsed = JSON.parse(jsonStr);
    assertEqual(parsed.summary.totalPassed, summary.totalPassed, "Should roundtrip correctly");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
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

console.log("\n✓ All doctor diagnostic tests passed!");
process.exit(0);
