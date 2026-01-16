#!/usr/bin/env node
/**
 * Unit tests for lib/failure-detection module (US-013)
 *
 * Tests all 40+ failure detection patterns extracted from loop.sh
 * Run with: node tests/test-failure-detection.js
 */

const {
  detectFailure,
  detectTestFailure,
  detectLintFailure,
  detectTypeFailure,
  detectBuildFailure,
  classifyFailureType,
  extractErrorContext,
  formatResult,
  getCategories,
  getPatternCounts,
  ALL_PATTERNS,
  TEST_PATTERNS,
  LINT_PATTERNS,
  TYPE_PATTERNS,
  BUILD_PATTERNS,
  RUNTIME_PATTERNS,
  GIT_PATTERNS,
} = require("../lib/failure-detection");

console.log("Testing Failure Detection Module (US-013)...\n");

let passed = 0;
let failed = 0;

function test(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ FAILED: ${name}`);
    failed++;
  }
}

// ============================================================================
// Test 1: Pattern Count Verification (40+ patterns requirement)
// ============================================================================
console.log("Test 1: Pattern Count Verification");
const counts = getPatternCounts();
test(`Total patterns >= 40 (got ${counts.total})`, counts.total >= 40);
test(`Test patterns >= 10 (got ${counts.test})`, counts.test >= 10);
test(`Lint patterns >= 10 (got ${counts.lint})`, counts.lint >= 10);
test(`Type patterns >= 5 (got ${counts.type})`, counts.type >= 5);
test(`Build patterns >= 5 (got ${counts.build})`, counts.build >= 5);
test(`Runtime patterns >= 5 (got ${counts.runtime})`, counts.runtime >= 5);
test(`Git patterns >= 3 (got ${counts.git})`, counts.git >= 3);
console.log();

// ============================================================================
// Test 2: Basic Detection Functionality
// ============================================================================
console.log("Test 2: Basic Detection Functionality");
const emptyResult = detectFailure("");
test("Empty string returns no failures", emptyResult.hasFailure === false);
test("Empty string returns empty matches", emptyResult.matches.length === 0);

const nullResult = detectFailure(null);
test("Null input returns no failures", nullResult.hasFailure === false);

const cleanLog = "Build completed successfully\nAll tests passed\n";
const cleanResult = detectFailure(cleanLog);
test("Clean log returns no failures", cleanResult.hasFailure === false);
console.log();

// ============================================================================
// Test 3: Jest/Vitest Test Failure Patterns
// ============================================================================
console.log("Test 3: Jest/Vitest Test Failure Patterns");
const jestFailLog = `
FAIL src/components/Button.test.js
  ● Button › renders correctly
    expect(received).toBe(expected)
Tests: 2 failed, 5 passed, 7 total
`;
const jestResult = detectTestFailure(jestFailLog);
test("Detects Jest test failures", jestResult.hasFailure === true);
test("Detects 'Tests: N failed' pattern", jestResult.matches.some((m) => m.matchedLine.includes("failed")));
test("Category is test", jestResult.matches.every((m) => m.category === "test"));
console.log();

// ============================================================================
// Test 4: Mocha Test Failure Patterns
// ============================================================================
console.log("Test 4: Mocha Test Failure Patterns");
const mochaFailLog = `
  3 passing (1s)
  2 failing

  1) Test suite should work
     AssertionError: expected true to equal false
`;
const mochaResult = detectTestFailure(mochaFailLog);
test("Detects Mocha test failures", mochaResult.hasFailure === true);
test("Detects 'N failing' pattern", mochaResult.matches.some((m) => m.matchedLine.includes("failing")));
test("Detects AssertionError", mochaResult.matches.some((m) => m.matchedLine.includes("AssertionError")));
console.log();

// ============================================================================
// Test 5: Pytest Failure Patterns
// ============================================================================
console.log("Test 5: Pytest Failure Patterns");
const pytestFailLog = `
============================= test session starts ==============================
FAILED test_example.py::test_addition - AssertionError
================================= FAILURES =================================
`;
const pytestResult = detectTestFailure(pytestFailLog);
test("Detects Pytest test failures", pytestResult.hasFailure === true);
test("Detects 'FAILED test' pattern", pytestResult.matches.some((m) => m.matchedLine.includes("FAILED")));
console.log();

// ============================================================================
// Test 6: Go Test Failure Patterns
// ============================================================================
console.log("Test 6: Go Test Failure Patterns");
const goFailLog = `
=== RUN   TestExample
--- FAIL: TestExample (0.00s)
    example_test.go:15: expected 5, got 3
FAIL	github.com/example/pkg	0.005s
`;
const goResult = detectTestFailure(goFailLog);
test("Detects Go test failures", goResult.hasFailure === true);
test("Detects '--- FAIL:' pattern", goResult.matches.some((m) => m.matchedLine.includes("--- FAIL:")));
test("Detects 'FAIL\\t' pattern", goResult.matches.some((m) => m.matchedLine.match(/^FAIL\t/)));
console.log();

// ============================================================================
// Test 7: npm Test Failure Patterns
// ============================================================================
console.log("Test 7: npm Test Failure Patterns");
const npmFailLog = `
npm ERR! Test failed. See above for more details.
npm ERR! code ELIFECYCLE
npm ERR! errno 1
`;
const npmResult = detectTestFailure(npmFailLog);
test("Detects npm test failures", npmResult.hasFailure === true);
test("Detects 'npm ERR! test' pattern", npmResult.matches.some((m) => m.matchedLine.includes("npm ERR!")));
console.log();

// ============================================================================
// Test 8: ESLint Failure Patterns
// ============================================================================
console.log("Test 8: ESLint Failure Patterns");
const eslintFailLog = `
/src/index.js
  10:5  error  Unexpected console statement  no-console
  15:3  error  'x' is not defined           no-undef

✖ 2 errors and 0 warnings
`;
const eslintResult = detectLintFailure(eslintFailLog);
test("Detects ESLint failures", eslintResult.hasFailure === true);
test("Detects 'error' keyword", eslintResult.matches.some((m) => m.matchedLine.includes("error")));
console.log();

// ============================================================================
// Test 9: Prettier Failure Patterns
// ============================================================================
console.log("Test 9: Prettier Failure Patterns");
const prettierFailLog = `
Checking formatting...
[error] src/index.js: Prettier check failed
`;
const prettierResult = detectLintFailure(prettierFailLog);
test("Detects Prettier failures", prettierResult.hasFailure === true);
console.log();

// ============================================================================
// Test 10: TypeScript Error Patterns
// ============================================================================
console.log("Test 10: TypeScript Error Patterns");
const tsFailLog = `
src/index.ts:10:5 - error TS2339: Property 'foo' does not exist on type 'Bar'.
src/utils.ts:5:10 - error TS2304: Cannot find name 'undefined_var'.
Type 'string' is not assignable to type 'number'.
`;
const tsResult = detectTypeFailure(tsFailLog);
test("Detects TypeScript errors", tsResult.hasFailure === true);
test("Detects 'error TS' pattern", tsResult.matches.some((m) => m.matchedLine.includes("error TS")));
test("Detects type assignment errors", tsResult.matches.some((m) => m.matchedLine.includes("is not assignable")));
console.log();

// ============================================================================
// Test 11: Module Not Found Patterns
// ============================================================================
console.log("Test 11: Module Not Found Patterns");
const moduleFailLog = `
Error: Cannot find module './missing-file'
Require stack:
- /app/src/index.js
`;
const moduleResult = detectTypeFailure(moduleFailLog);
test("Detects module not found errors", moduleResult.hasFailure === true);
test("Detects 'Cannot find module' pattern", moduleResult.matches.some((m) => m.matchedLine.includes("Cannot find module")));
console.log();

// ============================================================================
// Test 12: mypy (Python) Type Patterns
// ============================================================================
console.log("Test 12: mypy (Python) Type Patterns");
const mypyFailLog = `
src/main.py:10: error: Argument 1 to "foo" has incompatible type "str"
Found 3 errors in 2 files (checked 5 source files)
`;
const mypyResult = detectTypeFailure(mypyFailLog);
test("Detects mypy errors", mypyResult.hasFailure === true);
console.log();

// ============================================================================
// Test 13: Build Failure Patterns
// ============================================================================
console.log("Test 13: Build Failure Patterns");
const buildFailLog = `
npm ERR! Failed at the build script.
Build failed with exit code 1
make[2]: *** [Makefile:123: target] Error 1
`;
const buildResult = detectBuildFailure(buildFailLog);
test("Detects build failures", buildResult.hasFailure === true);
test("Detects npm ERR!", buildResult.matches.some((m) => m.matchedLine.includes("npm ERR!")));
test("Detects 'build failed'", buildResult.matches.some((m) => m.matchedLine.toLowerCase().includes("build failed")));
console.log();

// ============================================================================
// Test 14: Runtime Error Patterns
// ============================================================================
console.log("Test 14: Runtime Error Patterns");
const runtimeFailLog = `
Error: Connection refused at 127.0.0.1:3000
ENOENT: no such file or directory, open '/missing.txt'
Process crashed with signal SIGSEGV
panic: runtime error: index out of range
fatal error: unexpected signal during runtime execution
`;
const runtimeResult = detectFailure(runtimeFailLog, { categories: ["runtime"] });
test("Detects runtime errors", runtimeResult.hasFailure === true);
test("Detects ENOENT", runtimeResult.matches.some((m) => m.matchedLine.includes("ENOENT")));
test("Detects panic", runtimeResult.matches.some((m) => m.matchedLine.includes("panic")));
test("Detects fatal", runtimeResult.matches.some((m) => m.matchedLine.includes("fatal")));
console.log();

// ============================================================================
// Test 15: Git Error Patterns
// ============================================================================
console.log("Test 15: Git Error Patterns");
const gitFailLog = `
fatal: not a git repository (or any parent up to mount point /)
error: cannot lock ref 'refs/heads/main'
CONFLICT (content): Merge conflict in src/index.js
! [rejected] main -> main (fetch first)
`;
const gitResult = detectFailure(gitFailLog, { categories: ["git"] });
test("Detects git errors", gitResult.hasFailure === true);
test("Detects fatal:", gitResult.matches.some((m) => m.matchedLine.includes("fatal:")));
test("Detects CONFLICT", gitResult.matches.some((m) => m.matchedLine.includes("CONFLICT")));
test("Detects [rejected]", gitResult.matches.some((m) => m.matchedLine.includes("[rejected]")));
console.log();

// ============================================================================
// Test 16: Category Filtering
// ============================================================================
console.log("Test 16: Category Filtering");
const mixedLog = `
Tests: 1 failed
error TS2339: Property does not exist
eslint error in file
`;
const testOnlyResult = detectFailure(mixedLog, { categories: ["test"] });
test("Category filter: test only", testOnlyResult.matches.every((m) => m.category === "test"));

const multiCatResult = detectFailure(mixedLog, { categories: ["test", "type"] });
test("Category filter: multiple categories",
  multiCatResult.matches.some((m) => m.category === "test") &&
  multiCatResult.matches.some((m) => m.category === "type")
);
console.log();

// ============================================================================
// Test 17: Severity Filtering
// ============================================================================
console.log("Test 17: Severity Filtering");
const severityLog = `
panic: critical error
Error: something went wrong
`;
const highSeverityResult = detectFailure(severityLog, { minSeverity: 4 });
test("Severity filter excludes low severity", highSeverityResult.matches.every((m) => m.severity >= 4));
console.log();

// ============================================================================
// Test 18: Classify Failure Type
// ============================================================================
console.log("Test 18: Classify Failure Type");
test("Classifies test failure", classifyFailureType("Tests: 2 failed") === "test");
test("Classifies lint failure", classifyFailureType("eslint error found") === "lint");
test("Classifies type failure", classifyFailureType("error TS2339: Property") === "type");
test("Classifies build failure", classifyFailureType("npm ERR! Build failed") === "build");
test("Classifies git failure", classifyFailureType("fatal: not a git repository") === "git");
test("Classifies unknown for clean log", classifyFailureType("Success!") === "unknown");
console.log();

// ============================================================================
// Test 19: Extract Error Context
// ============================================================================
console.log("Test 19: Extract Error Context");
const contextLog = `
Starting build...
Running tests...
Error: Test failed at line 10
Expected true but got false
AssertionError: values do not match
Build finished with errors
`;
const context = extractErrorContext(contextLog);
test("Extracts error context", context.length > 0);
test("Context includes error lines", context.some((line) => line.includes("Error")));
test("Context has reasonable length", context.length <= 10);

const emptyContext = extractErrorContext("");
test("Empty log returns empty context", emptyContext.length === 0);

const cleanContext = extractErrorContext("Success\nAll good\n");
test("Clean log returns fallback lines", cleanContext.length > 0);
console.log();

// ============================================================================
// Test 20: Format Result
// ============================================================================
console.log("Test 20: Format Result");
const formattedClean = formatResult({ hasFailure: false, matches: [], summary: { total: 0 } }, { color: false });
test("Clean result shows no failures", formattedClean.includes("No failures detected"));

const formattedFail = formatResult(detectFailure("Tests: 1 failed\nAssertionError"), { color: false });
test("Failure result shows count", formattedFail.includes("failure"));
test("Failure result shows category", formattedFail.includes("test"));
console.log();

// ============================================================================
// Test 21: Line Number Tracking
// ============================================================================
console.log("Test 21: Line Number Tracking");
const lineLog = `Line 1
Line 2
Tests: 1 failed
Line 4`;
const lineResult = detectFailure(lineLog);
test("Tracks line numbers (1-indexed)", lineResult.matches[0].lineNumber === 3);
console.log();

// ============================================================================
// Test 22: Context Lines
// ============================================================================
console.log("Test 22: Context Lines");
const contextLineLog = `Before 1
Before 2
Tests: 1 failed
After 1
After 2`;
const contextResult = detectFailure(contextLineLog, { contextLines: 2 });
const firstMatch = contextResult.matches[0];
test("Captures context before", firstMatch.context.before.length === 2);
test("Captures context after", firstMatch.context.after.length === 2);
test("Context before is correct", firstMatch.context.before.includes("Before 2"));
test("Context after is correct", firstMatch.context.after.includes("After 1"));
console.log();

// ============================================================================
// Test 23: Edge Cases
// ============================================================================
console.log("Test 23: Edge Cases");
// Very long line
const longLine = "Error: " + "x".repeat(500);
const longResult = detectFailure(longLine);
test("Handles very long lines", longResult.hasFailure === true);

// Unicode in log
const unicodeLog = "✗ Test failed: 日本語テスト";
const unicodeResult = detectFailure(unicodeLog);
test("Handles unicode characters", unicodeResult.hasFailure === true);

// Multiple matches on same line
const multiMatchLog = "Tests: 1 failed with AssertionError";
const multiResult = detectFailure(multiMatchLog);
test("Handles multiple patterns on same line", multiResult.matches.length >= 1);
console.log();

// ============================================================================
// Test 24: Summary Statistics
// ============================================================================
console.log("Test 24: Summary Statistics");
const summaryLog = `
Tests: 1 failed
eslint error
error TS2339
`;
const summaryResult = detectFailure(summaryLog);
test("Summary has total count", typeof summaryResult.summary.total === "number");
test("Summary has byCategory", typeof summaryResult.summary.byCategory === "object");
test("Summary has bySeverity", typeof summaryResult.summary.bySeverity === "object");
test("Summary has highestSeverity", typeof summaryResult.summary.highestSeverity === "number");
test("Summary has highestSeverityLevel", typeof summaryResult.summary.highestSeverityLevel === "string");
console.log();

// ============================================================================
// Test 25: Get Categories
// ============================================================================
console.log("Test 25: Get Categories");
const categories = getCategories();
test("Has test category", categories.test !== undefined);
test("Has lint category", categories.lint !== undefined);
test("Has type category", categories.type !== undefined);
test("Has build category", categories.build !== undefined);
test("Has runtime category", categories.runtime !== undefined);
test("Has git category", categories.git !== undefined);
test("Categories have names", categories.test.name !== undefined);
test("Categories have patterns", Array.isArray(categories.test.patterns));
console.log();

// ============================================================================
// Test 26: Individual Detect Functions
// ============================================================================
console.log("Test 26: Individual Detect Functions");
test("detectTestFailure works", detectTestFailure("Tests: 1 failed").hasFailure === true);
test("detectLintFailure works", detectLintFailure("eslint error").hasFailure === true);
test("detectTypeFailure works", detectTypeFailure("error TS2339").hasFailure === true);
test("detectBuildFailure works", detectBuildFailure("npm ERR! build").hasFailure === true);
console.log();

// ============================================================================
// Test 27: Pattern Definitions Quality
// ============================================================================
console.log("Test 27: Pattern Definitions Quality");
test("All patterns have pattern field", ALL_PATTERNS.every((p) => p.pattern instanceof RegExp));
test("All patterns have category", ALL_PATTERNS.every((p) => typeof p.category === "string"));
test("All patterns have severity", ALL_PATTERNS.every((p) => typeof p.severity === "number"));
test("All patterns have description", ALL_PATTERNS.every((p) => typeof p.description === "string"));
test("All severity values valid (1-4)", ALL_PATTERNS.every((p) => p.severity >= 1 && p.severity <= 4));
console.log();

// ============================================================================
// Test 28: Rust Error Patterns
// ============================================================================
console.log("Test 28: Rust Error Patterns");
const rustFailLog = `
error[E0425]: cannot find value \`x\` in this scope
 --> src/main.rs:2:5
  |
2 |     x
  |     ^ not found in this scope

error: could not compile \`myproject\` due to previous error
`;
const rustResult = detectTypeFailure(rustFailLog);
test("Detects Rust compiler errors", rustResult.hasFailure === true);
test("Detects 'error[E' pattern", rustResult.matches.some((m) => m.matchedLine.includes("error[E")));
console.log();

// ============================================================================
// Test 29: JavaScript TypeError Patterns
// ============================================================================
console.log("Test 29: JavaScript TypeError Patterns");
const typeErrorLog = `
TypeError: Cannot read properties of undefined (reading 'map')
    at Array.forEach (<anonymous>)
    at processData (/app/src/index.js:10:15)
`;
const typeErrorResult = detectTypeFailure(typeErrorLog);
test("Detects JavaScript TypeError", typeErrorResult.hasFailure === true);
console.log();

// ============================================================================
// Test 30: Bun Test Patterns
// ============================================================================
console.log("Test 30: Bun Test Patterns");
const bunFailLog = `
bun test v1.0.0
✗ test suite › should work
  expect(received).toBe(expected)

1 test, 1 fail
`;
const bunResult = detectTestFailure(bunFailLog);
test("Detects Bun test failures", bunResult.hasFailure === true);
console.log();

// ============================================================================
// Summary
// ============================================================================
console.log("=".repeat(60));
console.log(`\nTest Summary: ${passed} passed, ${failed} failed`);
console.log(`Pattern count: ${counts.total} patterns total`);
console.log();

if (failed > 0) {
  console.log("SOME TESTS FAILED!");
  process.exit(1);
} else {
  console.log("All tests passed!");
  process.exit(0);
}
