#!/usr/bin/env node
/**
 * Test script for lib/estimate/complexity.js
 * Verifies story text analysis, file scope estimation, and unified complexity analysis
 */

const {
  analyzeStoryText,
  estimateFileScope,
  analyzeComplexity,
  scoreComplexity,
} = require("../lib/estimate/complexity");

console.log("Testing Complexity Analysis Module...\n");

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

// Test 1: analyzeStoryText - basic functionality
console.log("Test 1: analyzeStoryText() - Basic Functionality");
const simpleStory = "Fix a typo in the documentation";
const simpleResult = analyzeStoryText(simpleStory);
test("Returns object with wordCount", typeof simpleResult.wordCount === "number");
test("Word count is correct", simpleResult.wordCount === 6);
test("Returns sentenceCount", typeof simpleResult.sentenceCount === "number");
test("Returns signalScore", typeof simpleResult.signalScore === "number");
test("Returns detectedSignals array", Array.isArray(simpleResult.detectedSignals));
test("Detects 'fix' signal", simpleResult.detectedSignals.some(s => s.signal === "fix"));
test("Detects 'documentation' signal", simpleResult.detectedSignals.some(s => s.signal === "documentation"));
test("Returns textDepthScore", typeof simpleResult.textDepthScore === "number");
test("Short text has low depth score", simpleResult.textDepthScore === 1);
console.log();

// Test 2: analyzeStoryText - complexity signals detection
console.log("Test 2: analyzeStoryText() - Complexity Signals");
const complexStory = `
Refactor the architecture of the authentication system.
This involves a major migration of the database schema and
rewriting the security layer across multiple components.
We need to add validation and error handling throughout.
`;
const complexResult = analyzeStoryText(complexStory);
test("Detects 'refactor' signal", complexResult.detectedSignals.some(s => s.signal === "refactor"));
test("Detects 'architecture' signal", complexResult.detectedSignals.some(s => s.signal === "architecture"));
test("Detects 'migration' signal", complexResult.detectedSignals.some(s => s.signal === "migration"));
test("Detects 'database' signal", complexResult.detectedSignals.some(s => s.signal === "database"));
test("Detects 'security' signal", complexResult.detectedSignals.some(s => s.signal === "security"));
test("Signal score is high (> 5)", complexResult.signalScore > 5);
test("Text depth score is valid (1-3)", complexResult.textDepthScore >= 1 && complexResult.textDepthScore <= 3);
console.log();

// Test 3: analyzeStoryText - null/empty handling
console.log("Test 3: analyzeStoryText() - Edge Cases");
const nullResult = analyzeStoryText(null);
const emptyResult = analyzeStoryText("");
test("Handles null input", nullResult.wordCount === 0);
test("Handles empty string", emptyResult.wordCount === 0);
test("Null returns textDepthScore 0", nullResult.textDepthScore === 0);
console.log();

// Test 4: estimateFileScope - single file
console.log("Test 4: estimateFileScope() - Single File");
const singleFileStory = "Update the `config.js` file to add new settings";
const singleScope = estimateFileScope(singleFileStory);
test("Returns scope string", typeof singleScope.scope === "string");
test("Detects single scope", singleScope.scope === "single");
test("Detects config.js file", singleScope.detectedFiles.includes("config.js"));
test("Estimated file count is 1", singleScope.estimatedFileCount === 1);
test("File scope score is 1", singleScope.fileScopeScore === 1);
console.log();

// Test 5: estimateFileScope - multiple files
console.log("Test 5: estimateFileScope() - Multiple Files");
const multiFileStory = `
Modify \`lib/auth.js\` and \`lib/user.js\` to implement new login flow.
Also update \`routes/api.js\` for the API endpoints.
`;
const multiScope = estimateFileScope(multiFileStory);
test("Detects multi scope", multiScope.scope === "multi");
test("Detects lib/auth.js", multiScope.detectedFiles.includes("lib/auth.js"));
test("Detects lib/user.js", multiScope.detectedFiles.includes("lib/user.js"));
test("Detects routes/api.js", multiScope.detectedFiles.includes("routes/api.js"));
test("Estimated file count >= 3", multiScope.estimatedFileCount >= 3);
test("File scope score is 2.5", multiScope.fileScopeScore === 2.5);
console.log();

// Test 6: estimateFileScope - wide scope keywords
console.log("Test 6: estimateFileScope() - Wide Scope");
const wideStory = "Refactor all files in the codebase to use the new naming convention throughout the entire project";
const wideScope = estimateFileScope(wideStory);
test("Detects wide scope", wideScope.scope === "wide");
test("File scope score is 4", wideScope.fileScopeScore === 4);
test("Detects 'all files' indicator", wideScope.scopeIndicators.some(i => i.keyword === "all files"));
test("Estimated file count >= 16", wideScope.estimatedFileCount >= 16);
console.log();

// Test 7: estimateFileScope - null/empty handling
console.log("Test 7: estimateFileScope() - Edge Cases");
const nullScope = estimateFileScope(null);
test("Handles null input", nullScope.scope === "single");
test("Null returns fileScopeScore 1", nullScope.fileScopeScore === 1);
console.log();

// Test 8: analyzeComplexity - simple story
console.log("Test 8: analyzeComplexity() - Simple Story");
const simpleStoryBlock = `
### US-001: Fix typo
**As a** user
**I want** the typo fixed
**So that** the docs are correct

#### Acceptance Criteria
- [ ] Fix the typo
`;
const simpleAnalysis = analyzeComplexity(simpleStoryBlock, { id: "US-001", taskCount: 1 });
test("Returns finalScore", typeof simpleAnalysis.finalScore === "number");
test("Score is between 1-10", simpleAnalysis.finalScore >= 1 && simpleAnalysis.finalScore <= 10);
test("Simple story has low score (1-3)", simpleAnalysis.finalScore <= 4);
test("Complexity level is low", simpleAnalysis.complexityLevel === "low");
test("Returns breakdown object", typeof simpleAnalysis.breakdown === "object");
test("Returns textAnalysis object", typeof simpleAnalysis.textAnalysis === "object");
test("Returns scopeAnalysis object", typeof simpleAnalysis.scopeAnalysis === "object");
console.log();

// Test 9: analyzeComplexity - complex story
console.log("Test 9: analyzeComplexity() - Complex Story");
const complexStoryBlock = `
### US-002: Refactor Authentication Architecture
**As a** developer
**I want** the auth system refactored
**So that** security is improved

This requires a major migration of the database schema and
rewriting the security layer across multiple components.

#### Acceptance Criteria
- [ ] Migrate database schema
- [ ] Update auth service in \`lib/auth.js\`
- [ ] Modify user service in \`lib/user.js\`
- [ ] Update API routes in \`routes/api.js\`
- [ ] Add integration tests
- [ ] Update documentation
`;
const complexAnalysis = analyzeComplexity(complexStoryBlock, {
  id: "US-002",
  taskCount: 6,
  keywords: ["refactor"]
});
test("Complex story has higher score", complexAnalysis.finalScore > simpleAnalysis.finalScore);
test("Score is >= 5", complexAnalysis.finalScore >= 5);
test("Complexity level is medium or high",
  complexAnalysis.complexityLevel === "medium" || complexAnalysis.complexityLevel === "high");
test("Criteria score is 3 (6 criteria)", complexAnalysis.breakdown.criteriaScore === 3);
test("Keyword multiplier reflects refactor", complexAnalysis.breakdown.keywordMultiplier >= 1.5);
test("Detects architecture signal", complexAnalysis.textAnalysis.detectedSignals.includes("architecture"));
test("Detects security signal", complexAnalysis.textAnalysis.detectedSignals.includes("security"));
test("Scope is multi", complexAnalysis.scopeAnalysis.scope === "multi");
console.log();

// Test 10: analyzeComplexity - extreme story
console.log("Test 10: analyzeComplexity() - Extreme Story");
const extremeStoryBlock = `
### US-003: Complete System Rewrite
**As a** developer
**I want** to rewrite the entire architecture
**So that** we have a new system

This is a massive undertaking that requires refactoring all files,
migrating the database, rewriting the security system, adding new
integration tests across the entire project, and updating documentation
throughout the codebase.

#### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3
- [ ] Criterion 4
- [ ] Criterion 5
- [ ] Criterion 6
- [ ] Criterion 7
- [ ] Criterion 8
`;
const extremeAnalysis = analyzeComplexity(extremeStoryBlock, {
  id: "US-003",
  taskCount: 8,
  keywords: ["refactor", "feature"]
});
test("Extreme story has high score (>= 8)", extremeAnalysis.finalScore >= 7);
test("Complexity level is high", extremeAnalysis.complexityLevel === "high");
console.log();

// Test 11: Legacy scoreComplexity still works
console.log("Test 11: Legacy scoreComplexity() - Backwards Compatibility");
const legacyResult = scoreComplexity({
  id: "US-001",
  taskCount: 3,
  keywords: ["feature"]
});
test("Legacy function returns object", typeof legacyResult === "object");
test("Returns finalScore", typeof legacyResult.finalScore === "number");
test("Returns complexityLevel", typeof legacyResult.complexityLevel === "string");
test("Returns keywordMultiplier", typeof legacyResult.keywordMultiplier === "number");
console.log();

// Summary
console.log("=" .repeat(50));
console.log(`\nTest Summary: ${passed} passed, ${failed} failed`);
console.log();

if (failed > 0) {
  console.log("SOME TESTS FAILED!");
  process.exit(1);
} else {
  console.log("All tests passed!");
  process.exit(0);
}
