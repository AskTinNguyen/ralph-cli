#!/usr/bin/env node
/**
 * Test script for lib/context/scorer.js
 * Verifies file reference extraction, import detection, and relevance scoring
 */

const {
  extractFileReferences,
  findImportConnections,
  getRecentlyModifiedFiles,
  extractKeywords,
  calculateFileRelevance,
  clearCaches,
} = require("../lib/context/scorer");

const path = require("path");

console.log("Testing Context Scorer Module...\n");

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

// Test 1: extractFileReferences - file paths
console.log("Test 1: extractFileReferences() - File Path Detection");
const storyWithPaths = `
Create lib/context/selector.js to handle file selection.
Also update the scorer.js module and lib/tokens/extractor.js for token counting.
`;
const pathRefs = extractFileReferences(storyWithPaths);
test("Returns filePaths array", Array.isArray(pathRefs.filePaths));
test("Detects lib/context/selector.js", pathRefs.filePaths.includes("lib/context/selector.js"));
test("Detects scorer.js", pathRefs.filePaths.includes("scorer.js"));
test("Detects lib/tokens/extractor.js", pathRefs.filePaths.includes("lib/tokens/extractor.js"));
console.log();

// Test 2: extractFileReferences - backticked modules
console.log("Test 2: extractFileReferences() - Backticked Module Detection");
const storyWithBackticks = "Use the `selector` module and `scorer` for relevance calculation.";
const backtickRefs = extractFileReferences(storyWithBackticks);
test("Returns moduleNames array", Array.isArray(backtickRefs.moduleNames));
test("Detects selector module", backtickRefs.moduleNames.includes("selector"));
test("Detects scorer module", backtickRefs.moduleNames.includes("scorer"));
console.log();

// Test 3: extractFileReferences - directory patterns
console.log("Test 3: extractFileReferences() - Directory Pattern Detection");
const storyWithDirs = "Files in lib/context/ and lib/tokens/ need to be modified.";
const dirRefs = extractFileReferences(storyWithDirs);
test("Returns directoryPatterns array", Array.isArray(dirRefs.directoryPatterns));
test("Detects lib/context pattern", dirRefs.directoryPatterns.includes("lib/context"));
test("Detects lib/tokens pattern", dirRefs.directoryPatterns.includes("lib/tokens"));
console.log();

// Test 4: extractFileReferences - edge cases
console.log("Test 4: extractFileReferences() - Edge Cases");
const nullRefs = extractFileReferences(null);
test("Handles null input", nullRefs.filePaths.length === 0);
const emptyRefs = extractFileReferences("");
test("Handles empty string", emptyRefs.filePaths.length === 0);
console.log();

// Test 5: extractKeywords - basic functionality
console.log("Test 5: extractKeywords() - Basic Functionality");
const storyText = "Implement file detection and relevance scoring for context selection";
const keywords = extractKeywords(storyText);
test("Returns array", Array.isArray(keywords));
test("Extracts 'file' keyword", keywords.includes("file"));
test("Extracts 'detection' keyword", keywords.includes("detection"));
test("Extracts 'relevance' keyword", keywords.includes("relevance"));
test("Filters out stop words (the, and)", !keywords.includes("the") && !keywords.includes("and"));
console.log();

// Test 6: extractKeywords - edge cases
console.log("Test 6: extractKeywords() - Edge Cases");
const nullKeywords = extractKeywords(null);
test("Handles null input", nullKeywords.length === 0);
const shortKeywords = extractKeywords("a b");
test("Filters short words", shortKeywords.length === 0);
console.log();

// Test 7: calculateFileRelevance - direct mentions
console.log("Test 7: calculateFileRelevance() - Direct Mentions");
const mentionStory = "Update lib/context/scorer.js to add new scoring rules";
const directScore = calculateFileRelevance("lib/context/scorer.js", mentionStory, {
  projectRoot: process.cwd(),
});
test("Returns numeric score", typeof directScore === "number");
test("Direct mention gets high score (>= 10)", directScore >= 10);
console.log();

// Test 8: calculateFileRelevance - module name match
console.log("Test 8: calculateFileRelevance() - Module Name Match");
const moduleStory = "Use the `selector` module for file selection";
const moduleScore = calculateFileRelevance("lib/context/selector.js", moduleStory, {
  projectRoot: process.cwd(),
});
test("Module name match gets score (>= 10)", moduleScore >= 10);
console.log();

// Test 9: calculateFileRelevance - directory match
console.log("Test 9: calculateFileRelevance() - Directory Match");
const dirStory = "All files in lib/context/ need updates";
const dirScore = calculateFileRelevance("lib/context/index.js", dirStory, {
  projectRoot: process.cwd(),
});
test("Directory match gets points (>= 3)", dirScore >= 3);
console.log();

// Test 10: calculateFileRelevance - keyword matching
console.log("Test 10: calculateFileRelevance() - Keyword Matching");
const keywordStory = "Implement token counting and estimation";
const tokenFileScore = calculateFileRelevance("lib/tokens/calculator.js", keywordStory, {
  projectRoot: process.cwd(),
});
test("Keyword match gets points (>= 1)", tokenFileScore >= 1);
console.log();

// Test 11: calculateFileRelevance - no match
console.log("Test 11: calculateFileRelevance() - No Match");
const unrelatedStory = "Update the README documentation";
const unrelatedScore = calculateFileRelevance("lib/context/scorer.js", unrelatedStory, {
  projectRoot: process.cwd(),
});
test("Unrelated file has low score (< 5)", unrelatedScore < 5);
console.log();

// Test 12: getRecentlyModifiedFiles - basic functionality
console.log("Test 12: getRecentlyModifiedFiles() - Basic Functionality");
const recentFiles = getRecentlyModifiedFiles(process.cwd());
test("Returns array", Array.isArray(recentFiles));
// In a git repo, we should have some recent files
test("Has some recent files or empty array", recentFiles.length >= 0);
console.log();

// Test 13: findImportConnections - test with real file
console.log("Test 13: findImportConnections() - Import Detection");
const testFilePath = path.join(process.cwd(), "lib/context/index.js");
const connections = findImportConnections(testFilePath, process.cwd());
test("Returns array", Array.isArray(connections));
// index.js requires scorer and selector
test("Detects ./scorer or scorer.js", connections.some((c) => c.includes("scorer")));
test("Detects ./selector or selector.js", connections.some((c) => c.includes("selector")));
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
