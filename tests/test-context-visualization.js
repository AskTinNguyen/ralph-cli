#!/usr/bin/env node
/**
 * Test script for lib/context visualization (US-003)
 * Verifies context logging, summary formatting, and budget warnings
 */

const {
  selectRelevantFiles,
  selectWithBudget,
  formatContextSummary,
  getCompactSummary,
  getBudgetStatus,
  clearCaches,
  clearTokenCache,
} = require("../lib/context");

console.log("Testing Context Visualization (US-003)...\n");

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
clearTokenCache();

const projectRoot = process.cwd();

// Test 1: Selection includes reasons for each file
console.log("Test 1: Selection includes selection reasons");
const storyWithPath = "Update lib/context/selector.js to improve file selection";
const selection1 = selectRelevantFiles(storyWithPath, {
  projectRoot,
  limit: 5,
});
test("Selection has files array", Array.isArray(selection1.files));
test("Files have reasons property", selection1.files.every((f) => Array.isArray(f.reasons)));
// Check that selector.js has "direct mention" reason
const selectorFile = selection1.files.find((f) => f.file.includes("selector.js"));
test("selector.js included in selection", selectorFile !== undefined);
if (selectorFile) {
  test("selector.js has 'direct mention' reason", selectorFile.reasons.includes("direct mention"));
}
console.log();

// Test 2: Summary includes comprehensive metadata
console.log("Test 2: Summary includes comprehensive metadata");
const selection2 = selectRelevantFiles("Update scoring algorithm", {
  projectRoot,
  limit: 10,
});
test("Summary has totalFiles", typeof selection2.summary.totalFiles === "number");
test("Summary has totalTokens", typeof selection2.summary.totalTokens === "number");
test("Summary has avgScore", typeof selection2.summary.avgScore === "number");
test("Summary has scannedFiles", typeof selection2.summary.scannedFiles === "number");
test("Summary has matchedFiles", typeof selection2.summary.matchedFiles === "number");
console.log();

// Test 3: Budget-aware selection includes budget status
console.log("Test 3: Budget-aware selection includes budget status");
const budgetSelection = selectRelevantFiles("Update context module", {
  projectRoot,
  limit: 20,
  budget: 5000,
});
test("Budget summary has budget field", budgetSelection.summary.budget === 5000);
test("Budget summary has budgetRemaining", typeof budgetSelection.summary.budgetRemaining === "number");
test("Budget summary has budgetUtilization", typeof budgetSelection.summary.budgetUtilization === "number");
test("Budget summary has budgetStatus", budgetSelection.summary.budgetStatus !== undefined);
test("Budget status has level", ["ok", "info", "warning", "critical"].includes(budgetSelection.summary.budgetStatus.level));
console.log();

// Test 4: formatContextSummary generates markdown
console.log("Test 4: formatContextSummary generates valid markdown");
const markdown = formatContextSummary(selection2);
test("Returns non-empty string", typeof markdown === "string" && markdown.length > 0);
test("Contains ## Context Files header", markdown.includes("## Context Files"));
test("Contains ### Summary section", markdown.includes("### Summary"));
test("Contains ### Included Files section", markdown.includes("### Included Files"));
test("Contains table headers", markdown.includes("| File |") && markdown.includes("| Score |"));
test("Contains metric rows", markdown.includes("| Files included |"));
console.log();

// Test 5: formatContextSummary shows reasons column
console.log("Test 5: formatContextSummary shows selection reasons");
const markdownWithReasons = formatContextSummary(selection1, { showReasons: true });
test("Contains Reason column header", markdownWithReasons.includes("| Reason |"));
// Check that actual reasons are in output
test("Contains 'direct mention' in output", markdownWithReasons.includes("direct mention"));
console.log();

// Test 6: formatContextSummary handles budget warnings
console.log("Test 6: formatContextSummary handles budget warnings");
// Create high-utilization selection
const highBudgetSelection = selectRelevantFiles("Update all JavaScript files", {
  projectRoot,
  limit: 100,
  budget: 100, // Very small budget to trigger warning
});
const warningMarkdown = formatContextSummary(highBudgetSelection);
// Should show warning if budget utilization is high
if (highBudgetSelection.summary.budgetStatus && highBudgetSelection.summary.budgetStatus.level !== "ok") {
  test("Warning markdown contains status message", warningMarkdown.includes(highBudgetSelection.summary.budgetStatus.level) || warningMarkdown.includes("budget"));
} else {
  test("No warning needed (utilization ok)", true);
}
console.log();

// Test 7: formatContextSummary shows truncated files section
console.log("Test 7: formatContextSummary shows truncated files section");
const truncatedSelection = selectRelevantFiles("Update large files", {
  projectRoot,
  limit: 20,
  budget: 2000,
});
const truncatedMarkdown = formatContextSummary(truncatedSelection, { showTruncated: true });
if (truncatedSelection.truncated && truncatedSelection.truncated.length > 0) {
  test("Shows Truncated Files section", truncatedMarkdown.includes("### Truncated Files"));
} else {
  test("No truncated files to show", true);
}
console.log();

// Test 8: formatContextSummary shows skipped files section
console.log("Test 8: formatContextSummary shows skipped files section");
const skippedSelection = selectRelevantFiles("Update all project files", {
  projectRoot,
  limit: 5,
  budget: 1000, // Very tight budget
});
const skippedMarkdown = formatContextSummary(skippedSelection, { showSkipped: true });
if (skippedSelection.skipped && skippedSelection.skipped.length > 0) {
  test("Shows Skipped Files section", skippedMarkdown.includes("### Skipped Files"));
} else {
  test("No skipped files to show", true);
}
console.log();

// Test 9: getCompactSummary returns concise output
console.log("Test 9: getCompactSummary returns concise output");
const compact = getCompactSummary(selection2);
test("Returns non-empty string", typeof compact === "string" && compact.length > 0);
test("Contains file count", compact.includes("files"));
test("Contains token count", compact.includes("tokens"));
test("Is single line", !compact.includes("\n"));

const compactBudget = getCompactSummary(budgetSelection);
test("Budget compact includes percentage", compactBudget.includes("% of budget"));
console.log();

// Test 10: getBudgetStatus thresholds
console.log("Test 10: getBudgetStatus returns correct threshold levels");
const statusOk = getBudgetStatus(5000, 80000); // 6.25%
test("Under 80% returns 'ok'", statusOk.level === "ok");
test("Ok status has green color", statusOk.color === "green");
test("Ok status has no message", statusOk.message === null);

const statusInfo = getBudgetStatus(68000, 80000); // 85%
test("80-90% returns 'info'", statusInfo.level === "info");
test("Info status has yellow color", statusInfo.color === "yellow");
test("Info status has message", statusInfo.message !== null);
test("Info message includes percentage", statusInfo.message.includes("85%"));

const statusWarning = getBudgetStatus(75000, 80000); // ~94%
test("90-95% returns 'warning'", statusWarning.level === "warning");
test("Warning status has orange color", statusWarning.color === "orange");

const statusCritical = getBudgetStatus(78000, 80000); // 97.5%
test("95%+ returns 'critical'", statusCritical.level === "critical");
test("Critical status has red color", statusCritical.color === "red");
test("Critical message includes 'Critical'", statusCritical.message.includes("Critical"));
console.log();

// Test 11: formatContextSummary handles edge cases
console.log("Test 11: formatContextSummary handles edge cases");
const nullMarkdown = formatContextSummary(null);
test("Handles null selection", nullMarkdown.includes("No context files selected"));

const emptyMarkdown = formatContextSummary({ files: [], summary: { totalFiles: 0, totalTokens: 0, avgScore: 0, scannedFiles: 0, matchedFiles: 0 } });
test("Handles empty files array", emptyMarkdown.includes("## Context Files"));
console.log();

// Test 12: selectWithBudget convenience function
console.log("Test 12: selectWithBudget convenience function");
const modelSelection = selectWithBudget("Update scorer module", {
  projectRoot,
  limit: 10,
  model: "sonnet",
});
test("Returns files array", Array.isArray(modelSelection.files));
test("Returns summary", modelSelection.summary !== undefined);
test("Returns budgetInfo", modelSelection.budgetInfo !== undefined);
test("BudgetInfo has model limit", modelSelection.budgetInfo.total === 200000);
test("BudgetInfo has context allocation", modelSelection.budgetInfo.context === 80000);
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
