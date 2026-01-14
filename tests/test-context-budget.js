#!/usr/bin/env node
/**
 * Test script for lib/context/budget.js
 * Verifies token budgeting, model limits, and file truncation
 */

const {
  getModelLimit,
  calculateBudget,
  countFileTokens,
  truncateFile,
  getBudgetStatus,
  selectWithinBudget,
  clearTokenCache,
  MODEL_LIMITS,
  BUDGET_RATIOS,
  BUDGET_THRESHOLDS,
} = require("../lib/context/budget");

const path = require("path");

console.log("Testing Context Budget Module...\n");

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
clearTokenCache();

// Test 1: getModelLimit - model context limits
console.log("Test 1: getModelLimit() - Model Context Limits");
test("Opus returns 200K", getModelLimit("opus") === 200000);
test("Sonnet returns 200K", getModelLimit("sonnet") === 200000);
test("Haiku returns 200K", getModelLimit("haiku") === 200000);
test("Codex returns 128K", getModelLimit("codex") === 128000);
test("GPT-4 returns 128K", getModelLimit("gpt-4") === 128000);
test("Droid returns 128K", getModelLimit("droid") === 128000);
test("Unknown model returns default (128K)", getModelLimit("unknown") === 128000);
test("Null model returns default", getModelLimit(null) === MODEL_LIMITS.default);
test("Claude-opus-4-5 ID works", getModelLimit("claude-opus-4-5-20251101") === 200000);
test("Case insensitive matching", getModelLimit("OPUS") === 200000);
test("Fuzzy matching (claude-3-sonnet)", getModelLimit("claude-3-sonnet") === 200000);
console.log();

// Test 2: calculateBudget - budget allocation
console.log("Test 2: calculateBudget() - Budget Allocation");
const sonetBudget = calculateBudget("sonnet");
test("Returns total tokens", sonetBudget.total === 200000);
test("Context is 40% of total", sonetBudget.context === Math.floor(200000 * 0.4));
test("Output is 30% of total", sonetBudget.output === Math.floor(200000 * 0.3));
test("Prompt is 30% of total", sonetBudget.prompt === Math.floor(200000 * 0.3));
test("Model name is included", sonetBudget.model === "sonnet");
test("Ratios object is included", sonetBudget.ratios && sonetBudget.ratios.context === 0.4);

// Test custom ratios
const customBudget = calculateBudget("sonnet", {
  contextRatio: 0.5,
  outputRatio: 0.25,
  promptRatio: 0.25,
});
test("Custom context ratio works", customBudget.context === Math.floor(200000 * 0.5));
test("Custom output ratio works", customBudget.output === Math.floor(200000 * 0.25));
console.log();

// Test 3: countFileTokens - token counting
console.log("Test 3: countFileTokens() - Token Counting");
const projectRoot = process.cwd();
const indexPath = path.join(projectRoot, "lib/context/index.js");
const tokens = countFileTokens(indexPath);
test("Returns positive number for existing file", tokens > 0);
test("Returns reasonable estimate (~4 chars/token)", tokens > 50 && tokens < 10000);
const missingTokens = countFileTokens("/nonexistent/file.js");
test("Returns 0 for missing file", missingTokens === 0);

// Test caching
const tokens2 = countFileTokens(indexPath);
test("Cached result matches", tokens2 === tokens);
console.log();

// Test 4: truncateFile - file truncation
console.log("Test 4: truncateFile() - File Truncation");

// Test small file that fits
const smallContent = "Line 1\nLine 2\nLine 3\n";
const smallResult = truncateFile(smallContent, 1000);
test("Small file not truncated", smallResult.truncated === false);
test("Small file content unchanged", smallResult.content === smallContent);
test("Original tokens tracked", smallResult.originalTokens > 0);

// Test large file truncation
const largeLines = [];
for (let i = 1; i <= 500; i++) {
  largeLines.push(`Line ${i}: This is a test line with some content for testing truncation.`);
}
const largeContent = largeLines.join("\n");
const largeResult = truncateFile(largeContent, 500); // Very tight budget
test("Large file is truncated", largeResult.truncated === true);
test("Truncated content contains marker", largeResult.content.includes("lines omitted"));
test("Result tokens <= budget", largeResult.resultTokens <= 500);
test("Original tokens > result tokens", largeResult.originalTokens > largeResult.resultTokens);

// Test empty content
const emptyResult = truncateFile("", 1000);
test("Empty content handled", emptyResult.truncated === false);
test("Empty content returns empty string", emptyResult.content === "");
console.log();

// Test 5: getBudgetStatus - budget utilization status
console.log("Test 5: getBudgetStatus() - Budget Utilization Status");

const okStatus = getBudgetStatus(5000, 80000);
test("Under 80% is ok level", okStatus.level === "ok");
test("Ok status has green color", okStatus.color === "green");
test("Ok status has no message", okStatus.message === null);

const infoStatus = getBudgetStatus(68000, 80000); // 85%
test("80-90% is info level", infoStatus.level === "info");
test("Info status has yellow color", infoStatus.color === "yellow");
test("Info status has message", infoStatus.message !== null);

const warningStatus = getBudgetStatus(75000, 80000); // ~94%
test("90-95% is warning level", warningStatus.level === "warning");
test("Warning status has orange color", warningStatus.color === "orange");

const criticalStatus = getBudgetStatus(78000, 80000); // 97.5%
test("95%+ is critical level", criticalStatus.level === "critical");
test("Critical status has red color", criticalStatus.color === "red");

const zeroStatus = getBudgetStatus(100, 0);
test("Zero budget handled gracefully", zeroStatus.level === "ok");
console.log();

// Test 6: selectWithinBudget - budget-aware selection
console.log("Test 6: selectWithinBudget() - Budget-Aware Selection");

const testFiles = [
  { file: "file1.js", score: 10, tokens: 1000 },
  { file: "file2.js", score: 8, tokens: 2000 },
  { file: "file3.js", score: 6, tokens: 1500 },
  { file: "file4.js", score: 4, tokens: 3000 },
  { file: "file5.js", score: 2, tokens: 500 },
];

// Test with generous budget
const generousResult = selectWithinBudget(testFiles, 10000);
test("All files selected with generous budget", generousResult.selected.length === 5);
test("Summary includes total tokens", generousResult.summary.totalTokens === 8000);
test("Summary includes utilization", generousResult.summary.utilization === 80);

// Test with tight budget
const tightResult = selectWithinBudget(testFiles, 3500);
test("Higher scored files prioritized", tightResult.selected[0].file === "file1.js");
test("Budget not exceeded", tightResult.summary.totalTokens <= 3500);
test("Skipped files tracked", tightResult.skipped.length > 0);

// Test with very small budget
const smallBudgetResult = selectWithinBudget(testFiles, 1000);
test("At least one file fits in small budget", smallBudgetResult.selected.length >= 1);
test("First file is highest scored", smallBudgetResult.selected[0].score === 10);
console.log();

// Test 7: Constants and configuration
console.log("Test 7: Constants and Configuration");
test("MODEL_LIMITS has opus", MODEL_LIMITS.opus === 200000);
test("MODEL_LIMITS has default", MODEL_LIMITS.default === 128000);
test("BUDGET_RATIOS context is 0.4", BUDGET_RATIOS.context === 0.4);
test("BUDGET_THRESHOLDS has warning at 0.9", BUDGET_THRESHOLDS.warning === 0.9);
console.log();

// Test 8: Integration with selector
console.log("Test 8: Integration with Selector Module");
const { selectRelevantFiles, selectWithBudget: selectWithBudgetFn } = require("../lib/context/selector");
const { clearCaches } = require("../lib/context/scorer");
clearCaches();

// Test budget option in selectRelevantFiles
const budgetSelection = selectRelevantFiles("Update the context budget module", {
  projectRoot,
  limit: 20,
  budget: 5000, // Small budget
});
test("Budget option works in selectRelevantFiles", budgetSelection.summary.budget === 5000);
test("Budget remaining tracked", typeof budgetSelection.summary.budgetRemaining === "number");
test("Budget utilization tracked", typeof budgetSelection.summary.budgetUtilization === "number");
test("Budget status included", budgetSelection.summary.budgetStatus !== undefined);

// Test selectWithBudget convenience function
const modelSelection = selectWithBudgetFn("Update scorer module", {
  projectRoot,
  limit: 10,
  model: "sonnet",
});
test("selectWithBudget returns budget info", modelSelection.budgetInfo !== undefined);
test("Budget info has model limit", modelSelection.budgetInfo.total === 200000);
test("Budget info has context allocation", modelSelection.budgetInfo.context === 80000);
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
