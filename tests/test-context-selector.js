#!/usr/bin/env node
/**
 * Test script for lib/context/selector.js
 * Verifies file selection, project scanning, and token counting
 */

const {
  selectRelevantFiles,
  getProjectFiles,
  getFilePaths,
  countFileTokens,
  isIncludedFile,
  shouldIgnore,
} = require("../lib/context/selector");

const { clearCaches } = require("../lib/context/scorer");
const path = require("path");

console.log("Testing Context Selector Module...\n");

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

// Clear caches before tests
clearCaches();

// Test 1: isIncludedFile - code files
console.log("Test 1: isIncludedFile() - Code File Detection");
test("Includes .js files", isIncludedFile("foo.js"));
test("Includes .ts files", isIncludedFile("foo.ts"));
test("Includes .jsx files", isIncludedFile("foo.jsx"));
test("Includes .tsx files", isIncludedFile("foo.tsx"));
test("Includes .json files", isIncludedFile("foo.json"));
test("Includes .md files", isIncludedFile("foo.md"));
test("Includes .sh files", isIncludedFile("foo.sh"));
test("Excludes .exe files", !isIncludedFile("foo.exe"));
test("Excludes .png files", !isIncludedFile("foo.png"));
console.log();

// Test 2: shouldIgnore - default patterns
console.log("Test 2: shouldIgnore() - Default Ignore Patterns");
test("Ignores node_modules", shouldIgnore("node_modules/foo.js"));
test("Ignores .git directory", shouldIgnore(".git/config"));
test("Ignores .ralph directory", shouldIgnore(".ralph/PRD-1/plan.md"));
test("Ignores dist directory", shouldIgnore("dist/bundle.js"));
test("Ignores package-lock.json", shouldIgnore("package-lock.json"));
test("Does not ignore lib directory", !shouldIgnore("lib/foo.js"));
test("Does not ignore src directory", !shouldIgnore("src/index.ts"));
console.log();

// Test 3: getProjectFiles - basic functionality
console.log("Test 3: getProjectFiles() - Basic Functionality");
const projectRoot = process.cwd();
const files = getProjectFiles(projectRoot);
test("Returns array", Array.isArray(files));
test("Has some files", files.length > 0);
test("Contains lib/context/index.js", files.includes("lib/context/index.js"));
test("Contains lib/context/scorer.js", files.includes("lib/context/scorer.js"));
test("Does not contain node_modules files", !files.some((f) => f.includes("node_modules")));
console.log();

// Test 4: countFileTokens - basic functionality
console.log("Test 4: countFileTokens() - Token Counting");
const indexPath = path.join(projectRoot, "lib/context/index.js");
const tokens = countFileTokens(indexPath);
test("Returns number", typeof tokens === "number");
test("Returns positive value for existing file", tokens > 0);
const missingTokens = countFileTokens("/nonexistent/file.js");
test("Returns 0 for missing file", missingTokens === 0);
console.log();

// Test 5: selectRelevantFiles - basic selection
console.log("Test 5: selectRelevantFiles() - Basic Selection");
const story = "Update lib/context/scorer.js to improve relevance scoring";
const selection = selectRelevantFiles(story, {
  projectRoot,
  limit: 10,
});
test("Returns object with files array", Array.isArray(selection.files));
test("Returns object with summary", typeof selection.summary === "object");
test("Files have score property", selection.files.every((f) => typeof f.score === "number"));
test("Files have tokens property", selection.files.every((f) => typeof f.tokens === "number"));
test("Files have file property", selection.files.every((f) => typeof f.file === "string"));
console.log();

// Test 6: selectRelevantFiles - relevance ordering
console.log("Test 6: selectRelevantFiles() - Relevance Ordering");
const scorerStory = "Update the scorer.js file with new rules";
const scorerSelection = selectRelevantFiles(scorerStory, {
  projectRoot,
  limit: 5,
});
test("Has files in selection", scorerSelection.files.length > 0);
// scorer.js should be highly ranked due to direct mention
const scorerFile = scorerSelection.files.find((f) => f.file.includes("scorer.js"));
test("scorer.js is in selection", scorerFile !== undefined);
if (scorerFile) {
  test("scorer.js has high score (>= 10)", scorerFile.score >= 10);
}
test("Files sorted by score (descending)", scorerSelection.files.every(
  (f, i, arr) => i === 0 || arr[i - 1].score >= f.score
));
console.log();

// Test 7: selectRelevantFiles - limit enforcement
console.log("Test 7: selectRelevantFiles() - Limit Enforcement");
const limitSelection = selectRelevantFiles("Update all JavaScript files", {
  projectRoot,
  limit: 3,
});
test("Respects limit of 3", limitSelection.files.length <= 3);
const bigLimitSelection = selectRelevantFiles("Update all files", {
  projectRoot,
  limit: 100,
});
test("Returns available files up to limit", bigLimitSelection.files.length <= 100);
console.log();

// Test 8: selectRelevantFiles - summary statistics
console.log("Test 8: selectRelevantFiles() - Summary Statistics");
const summarySelection = selectRelevantFiles("Context selection story", {
  projectRoot,
  limit: 10,
});
test("Summary has totalFiles", typeof summarySelection.summary.totalFiles === "number");
test("Summary has totalTokens", typeof summarySelection.summary.totalTokens === "number");
test("Summary has avgScore", typeof summarySelection.summary.avgScore === "number");
test("Summary has scannedFiles", typeof summarySelection.summary.scannedFiles === "number");
test("Summary has matchedFiles", typeof summarySelection.summary.matchedFiles === "number");
test("totalFiles <= scannedFiles", summarySelection.summary.totalFiles <= summarySelection.summary.scannedFiles);
console.log();

// Test 9: selectRelevantFiles - story object input
console.log("Test 9: selectRelevantFiles() - Story Object Input");
const storyObject = {
  id: "US-001",
  title: "Update scorer module",
  content: "Modify lib/context/scorer.js",
};
const objectSelection = selectRelevantFiles(storyObject, {
  projectRoot,
  limit: 5,
});
test("Handles story object with content", objectSelection.files.length > 0);
console.log();

// Test 10: getFilePaths helper
console.log("Test 10: getFilePaths() - Helper Function");
const pathSelection = selectRelevantFiles("Test story", {
  projectRoot,
  limit: 5,
});
const paths = getFilePaths(pathSelection);
test("Returns array of strings", Array.isArray(paths) && paths.every((p) => typeof p === "string"));
test("Path count matches files count", paths.length === pathSelection.files.length);
test("Returns empty array for null", getFilePaths(null).length === 0);
console.log();

// Test 11: selectRelevantFiles - minScore filtering
console.log("Test 11: selectRelevantFiles() - Minimum Score Filtering");
const lowMinSelection = selectRelevantFiles("Generic story about code", {
  projectRoot,
  limit: 100,
  minScore: 1,
});
const highMinSelection = selectRelevantFiles("Generic story about code", {
  projectRoot,
  limit: 100,
  minScore: 20,
});
test("Lower minScore returns more files", lowMinSelection.files.length >= highMinSelection.files.length);
test("All files meet minScore threshold", highMinSelection.files.every((f) => f.score >= 20));
console.log();

// Summary
console.log("=".repeat(50));
console.log(`\nTest Summary: ${passed} passed, ${failed} failed`);
console.log();

if (failed > 0) {
  console.log("SOME TESTS FAILED!");
  process.exit(1);
} else {
  console.log("All tests passed!");
  process.exit(0);
}
