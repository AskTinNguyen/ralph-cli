#!/usr/bin/env node
/**
 * Test script for context directive parsing (@include, @exclude)
 * Tests parseDirectives, matchesAnyPattern, expandPatterns and selectRelevantFiles with directives
 */

const {
  parseDirectives,
  matchesAnyPattern,
  expandPatterns,
  selectRelevantFiles,
} = require("../lib/context/selector");

const { clearCaches } = require("../lib/context/scorer");

console.log("Testing Context Directive Parsing...\n");

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

// Test 1: parseDirectives - basic @include parsing
console.log("Test 1: parseDirectives() - @include Parsing");
const story1 = "Update the scorer module @include lib/context/scorer.js";
const directives1 = parseDirectives(story1);
test("Extracts single @include", directives1.includes.length === 1);
test("Correct include path", directives1.includes[0] === "lib/context/scorer.js");
test("No excludes", directives1.excludes.length === 0);
console.log();

// Test 2: parseDirectives - basic @exclude parsing
console.log("Test 2: parseDirectives() - @exclude Parsing");
const story2 = "Refactor code @exclude **/test/**";
const directives2 = parseDirectives(story2);
test("Extracts single @exclude", directives2.excludes.length === 1);
test("Correct exclude pattern", directives2.excludes[0] === "**/test/**");
test("No includes", directives2.includes.length === 0);
console.log();

// Test 3: parseDirectives - multiple directives
console.log("Test 3: parseDirectives() - Multiple Directives");
const story3 = `
Update the context module
@include lib/context/selector.js
@include lib/context/scorer.js
@exclude **/*.test.js
@exclude **/node_modules/**
`;
const directives3 = parseDirectives(story3);
test("Extracts two includes", directives3.includes.length === 2);
test("First include correct", directives3.includes[0] === "lib/context/selector.js");
test("Second include correct", directives3.includes[1] === "lib/context/scorer.js");
test("Extracts two excludes", directives3.excludes.length === 2);
test("First exclude correct", directives3.excludes[0] === "**/*.test.js");
test("Second exclude correct", directives3.excludes[1] === "**/node_modules/**");
console.log();

// Test 4: parseDirectives - empty/null input
console.log("Test 4: parseDirectives() - Edge Cases");
const emptyDirectives = parseDirectives("");
test("Empty string returns empty arrays", emptyDirectives.includes.length === 0 && emptyDirectives.excludes.length === 0);
const nullDirectives = parseDirectives(null);
test("Null returns empty arrays", nullDirectives.includes.length === 0 && nullDirectives.excludes.length === 0);
const noDirectives = parseDirectives("Just a regular story with no directives");
test("No directives returns empty arrays", noDirectives.includes.length === 0 && noDirectives.excludes.length === 0);
console.log();

// Test 5: matchesAnyPattern - exact matches
console.log("Test 5: matchesAnyPattern() - Exact Matches");
test("Exact path match", matchesAnyPattern("lib/context/scorer.js", ["lib/context/scorer.js"]));
test("No match for different path", !matchesAnyPattern("lib/context/index.js", ["lib/context/scorer.js"]));
test("Partial filename match", matchesAnyPattern("lib/context/scorer.js", ["scorer.js"]));
console.log();

// Test 6: matchesAnyPattern - glob patterns
console.log("Test 6: matchesAnyPattern() - Glob Patterns");
test("Matches **/*.js pattern", matchesAnyPattern("lib/context/scorer.js", ["**/*.js"]));
test("Matches lib/**/*.js pattern", matchesAnyPattern("lib/context/scorer.js", ["lib/**/*.js"]));
test("Matches *.test.js pattern", matchesAnyPattern("lib/context/scorer.test.js", ["**/*.test.js"]));
test("Does not match wrong extension", !matchesAnyPattern("lib/context/scorer.js", ["**/*.ts"]));
test("Does not match wrong directory", !matchesAnyPattern("src/context/scorer.js", ["lib/**/*.js"]));
console.log();

// Test 7: matchesAnyPattern - multiple patterns
console.log("Test 7: matchesAnyPattern() - Multiple Patterns");
test("Matches first pattern", matchesAnyPattern("lib/foo.js", ["lib/**/*.js", "src/**/*.ts"]));
test("Matches second pattern", matchesAnyPattern("src/bar.ts", ["lib/**/*.js", "src/**/*.ts"]));
test("Matches none", !matchesAnyPattern("tests/test.py", ["lib/**/*.js", "src/**/*.ts"]));
console.log();

// Test 8: expandPatterns - basic expansion
console.log("Test 8: expandPatterns() - Basic Pattern Expansion");
const mockFiles = [
  "lib/context/selector.js",
  "lib/context/scorer.js",
  "lib/context/index.js",
  "lib/tokens/extractor.js",
  "tests/test-context.js",
  "src/app.ts",
];
const expanded1 = expandPatterns(["lib/context/scorer.js"], mockFiles);
test("Exact match expansion", expanded1.length === 1 && expanded1[0] === "lib/context/scorer.js");
const expanded2 = expandPatterns(["lib/context/**/*.js"], mockFiles);
test("Glob expansion for lib/context", expanded2.length === 3);
const expanded3 = expandPatterns(["**/*.ts"], mockFiles);
test("Glob expansion for .ts files", expanded3.length === 1 && expanded3[0] === "src/app.ts");
console.log();

// Test 9: expandPatterns - partial filename matching
console.log("Test 9: expandPatterns() - Partial Filename Matching");
const expanded4 = expandPatterns(["scorer.js"], mockFiles);
test("Partial filename matches", expanded4.length === 1 && expanded4.includes("lib/context/scorer.js"));
const expanded5 = expandPatterns(["index.js"], mockFiles);
test("Partial index.js match", expanded5.length === 1 && expanded5.includes("lib/context/index.js"));
console.log();

// Test 10: expandPatterns - empty/no matches
console.log("Test 10: expandPatterns() - Edge Cases");
const expandedEmpty = expandPatterns([], mockFiles);
test("Empty patterns returns empty array", expandedEmpty.length === 0);
const expandedNull = expandPatterns(null, mockFiles);
test("Null patterns returns empty array", expandedNull.length === 0);
const expandedNoMatch = expandPatterns(["nonexistent/**/*.xyz"], mockFiles);
test("No matches returns empty array", expandedNoMatch.length === 0);
console.log();

// Test 11: selectRelevantFiles - with @include directive in story
console.log("Test 11: selectRelevantFiles() - @include Directive");
const storyWithInclude = "Update config @include package.json";
const projectRoot = process.cwd();
const selectionInclude = selectRelevantFiles(storyWithInclude, {
  projectRoot,
  limit: 20,
});
// package.json should be in the results due to @include
const packageJsonIncluded = selectionInclude.files.some(f => f.file === "package.json");
test("@include forces package.json into results", packageJsonIncluded);
const packageJsonFile = selectionInclude.files.find(f => f.file === "package.json");
test("@include file has directive reason", packageJsonFile && packageJsonFile.reasons && packageJsonFile.reasons.includes("@include directive"));
test("Directives object is populated", selectionInclude.directives && selectionInclude.directives.includes.length > 0);
console.log();

// Test 12: selectRelevantFiles - with @exclude directive in story
console.log("Test 12: selectRelevantFiles() - @exclude Directive");
const storyWithExclude = "Update tests @exclude **/*.test.js";
const selectionExclude = selectRelevantFiles(storyWithExclude, {
  projectRoot,
  limit: 50,
});
// No .test.js files should be in results
const testFilesIncluded = selectionExclude.files.filter(f => f.file.endsWith(".test.js"));
test("@exclude removes test files", testFilesIncluded.length === 0);
test("Excludes are recorded in directives", selectionExclude.directives && selectionExclude.directives.excludes.length > 0);
test("Excluded files are tracked", selectionExclude.directives && selectionExclude.directives.excludedFiles);
console.log();

// Test 13: selectRelevantFiles - CLI include/exclude options
console.log("Test 13: selectRelevantFiles() - CLI Include/Exclude Options");
const storyPlain = "Update context module";
const selectionWithOptions = selectRelevantFiles(storyPlain, {
  projectRoot,
  limit: 20,
  include: ["package.json"],
  exclude: ["tests/**/*.js"],
});
const pkgIncluded = selectionWithOptions.files.some(f => f.file === "package.json");
test("CLI --include forces file into results", pkgIncluded);
const testsExcluded = selectionWithOptions.files.filter(f => f.file.startsWith("tests/")).length === 0;
test("CLI --exclude removes test directory", testsExcluded);
console.log();

// Test 14: selectRelevantFiles - merging story directives with CLI options
console.log("Test 14: selectRelevantFiles() - Merging Story and CLI Directives");
const storyWithDirective = "Update @include lib/context/index.js";
const selectionMerged = selectRelevantFiles(storyWithDirective, {
  projectRoot,
  limit: 20,
  include: ["package.json"], // CLI adds this
  exclude: ["tests/**/*.js"], // CLI excludes tests
});
const indexIncluded = selectionMerged.files.some(f => f.file === "lib/context/index.js");
const pkgMergedIncluded = selectionMerged.files.some(f => f.file === "package.json");
test("Story @include is respected", indexIncluded);
test("CLI include is merged", pkgMergedIncluded);
test("All includes are in directives", selectionMerged.directives.includes.length >= 2);
console.log();

// Test 15: parseArgs from CLI
console.log("Test 15: CLI parseArgs() - Include/Exclude Flags");
const { parseArgs } = require("../lib/context/cli");
const args1 = parseArgs(["--story", "test", "--include", "lib/foo.js"]);
test("Single --include parsed", args1.include.length === 1 && args1.include[0] === "lib/foo.js");
const args2 = parseArgs(["--story", "test", "--include", "lib/foo.js", "--include", "lib/bar.js"]);
test("Multiple --include parsed", args2.include.length === 2);
const args3 = parseArgs(["--story", "test", "--exclude", "**/*.test.js"]);
test("Single --exclude parsed", args3.exclude.length === 1);
const args4 = parseArgs(["--story", "test", "-i", "lib/foo.js", "-e", "tests/**"]);
test("Short flags -i and -e work", args4.include.length === 1 && args4.exclude.length === 1);
console.log();

// Summary
console.log("==========================================");
console.log(`Total: ${passed + failed} tests`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log("==========================================");

process.exit(failed > 0 ? 1 : 0);
