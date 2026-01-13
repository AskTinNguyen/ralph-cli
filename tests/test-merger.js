/**
 * Test suite for lib/parallel/merger.js
 */
const merger = require("../lib/parallel/merger");
const fs = require("fs");
const path = require("path");

// Test results tracking
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`✓ ${message}`);
    passedTests++;
  } else {
    console.error(`✗ ${message}`);
    failedTests++;
  }
}

function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`✓ ${message}`);
    passedTests++;
  } else {
    console.error(`✗ ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual: ${JSON.stringify(actual)}`);
    failedTests++;
  }
}

// Test 1: detectConflicts - no conflicts
console.log("\nTest 1: detectConflicts() - no conflicts");
const resultsNoConflict = [
  {
    storyId: "US-001",
    status: "success",
    filesModified: ["lib/parallel/analyzer.js"],
  },
  {
    storyId: "US-002",
    status: "success",
    filesModified: ["lib/parallel/executor.js"],
  },
];

const analysis1 = merger.detectConflicts(resultsNoConflict);
assert(analysis1.conflictedFiles.length === 0, "No conflicts detected");

// Test 2: detectConflicts - with conflicts
console.log("\nTest 2: detectConflicts() - with conflicts");
const resultsWithConflict = [
  {
    storyId: "US-001",
    status: "success",
    filesModified: ["lib/parallel/index.js", "lib/parallel/analyzer.js"],
  },
  {
    storyId: "US-002",
    status: "success",
    filesModified: ["lib/parallel/executor.js"],
  },
  {
    storyId: "US-003",
    status: "success",
    filesModified: ["lib/parallel/index.js", "lib/parallel/merger.js"],
  },
];

const analysis2 = merger.detectConflicts(resultsWithConflict);
assert(analysis2.conflictedFiles.length === 1, "One conflicted file detected");
assert(
  analysis2.conflictedFiles[0].file === "lib/parallel/index.js",
  "Correct file identified"
);
assertEquals(
  analysis2.conflictedFiles[0].stories,
  ["US-001", "US-003"],
  "Correct stories identified"
);

// Test 3: detectConflicts - ignores failed stories
console.log("\nTest 3: detectConflicts() - ignores failed stories");
const resultsWithFailures = [
  {
    storyId: "US-001",
    status: "success",
    filesModified: ["lib/parallel/index.js"],
  },
  {
    storyId: "US-002",
    status: "failed",
    filesModified: ["lib/parallel/index.js"],
  },
];

const analysis3 = merger.detectConflicts(resultsWithFailures);
assert(
  analysis3.conflictedFiles.length === 0,
  "Failed stories don't count as conflicts"
);

// Test 4: parseMergeResult - valid JSON
console.log("\nTest 4: parseMergeResult() - parses valid JSON result");
const validOutput = `Some agent output
<merge-result>
{
  "status": "success",
  "mergedContent": "const x = 1;",
  "reasoning": "No conflicts found"
}
</merge-result>
More output`;

const parsed1 = merger.parseMergeResult(validOutput, "test.js", 1000);
assert(parsed1.status === "success", "Status parsed correctly");
assert(parsed1.mergedContent === "const x = 1;", "Content parsed correctly");
assert(parsed1.reasoning === "No conflicts found", "Reasoning parsed correctly");
assert(parsed1.duration === 1000, "Duration preserved");

// Test 5: parseMergeResult - missing result block
console.log("\nTest 5: parseMergeResult() - handles missing result block");
const invalidOutput = "Some agent output without result block";
const parsed2 = merger.parseMergeResult(invalidOutput, "test.js", 500);
assert(parsed2.status === "failed", "Returns failed status");
assert(
  parsed2.error.includes("No <merge-result> block found"),
  "Correct error message"
);

// Test 6: parseMergeResult - invalid JSON
console.log("\nTest 6: parseMergeResult() - handles invalid JSON");
const malformedOutput = `<merge-result>
{
  "status": "success"
  "mergedContent": "missing comma"
}
</merge-result>`;

const parsed3 = merger.parseMergeResult(malformedOutput, "test.js", 500);
assert(parsed3.status === "failed", "Returns failed status on malformed JSON");
assert(
  parsed3.error.includes("Failed to parse merge result JSON"),
  "Correct error message"
);

// Test 7: generateMergePrompt - template rendering
console.log("\nTest 7: generateMergePrompt() - renders template correctly");
(async () => {
  const prompt = await merger.generateMergePrompt({
    file: "src/test.js",
    stories: ["US-001", "US-002"],
    baseContent: "const a = 1;",
    currentContent: "const a = 2;",
    storyVersions: {
      "US-001": "const a = 2;",
      "US-002": "const a = 2;",
    },
    repoRoot: process.cwd(),
    promptTemplate: null, // Use default
  });

  assert(prompt.includes("src/test.js"), "File path included");
  assert(prompt.includes("US-001, US-002"), "Stories listed");
  assert(prompt.includes("const a = 1;"), "Base content included");
  assert(prompt.includes("const a = 2;"), "Current content included");
  assert(prompt.includes("Story US-001 Version"), "Story versions included");
  assert(prompt.includes("<merge-result>"), "Output format instructions included");

  // Test 8: readFileContent - existing file
  console.log("\nTest 8: readFileContent() - reads existing file");
  const content = merger.readFileContent("package.json", process.cwd());
  assert(content !== null, "Reads existing file");
  assert(content.includes('"name"'), "Contains expected content");

  // Test 9: readFileContent - non-existent file
  console.log("\nTest 9: readFileContent() - handles non-existent file");
  const noContent = merger.readFileContent(
    "does-not-exist-12345.js",
    process.cwd()
  );
  assert(noContent === null, "Returns null for missing file");

  // Test 10: applyMergedContent - success case
  console.log("\nTest 10: applyMergedContent() - writes content successfully");
  const tmpDir = path.join(process.cwd(), ".ralph", ".tmp");
  const testFile = path.join(tmpDir, "test-merge.txt");

  // Clean up first
  if (fs.existsSync(testFile)) {
    fs.unlinkSync(testFile);
  }

  const success = merger.applyMergedContent(
    ".ralph/.tmp/test-merge.txt",
    "merged content",
    process.cwd()
  );
  assert(success === true, "Returns true on success");
  assert(fs.existsSync(testFile), "File created");
  assert(
    fs.readFileSync(testFile, "utf-8") === "merged content",
    "Content written correctly"
  );

  // Clean up
  fs.unlinkSync(testFile);

  // Summary
  console.log("\n" + "=".repeat(50));
  console.log(`Tests passed: ${passedTests}`);
  console.log(`Tests failed: ${failedTests}`);
  console.log("=".repeat(50));

  process.exit(failedTests > 0 ? 1 : 0);
})();
