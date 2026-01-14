/**
 * Test suite for lib/parallel/committer.js
 *
 * Tests the sequential commit application module that handles
 * committing parallel story results in story ID order.
 */
const committer = require("../lib/parallel/committer");
const fs = require("fs");
const path = require("path");

// Test results tracking
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`\u2713 ${message}`);
    passedTests++;
  } else {
    console.error(`\u2717 ${message}`);
    failedTests++;
  }
}

function assertEquals(actual, expected, message) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`\u2713 ${message}`);
    passedTests++;
  } else {
    console.error(`\u2717 ${message}`);
    console.error(`  Expected: ${JSON.stringify(expected)}`);
    console.error(`  Actual: ${JSON.stringify(actual)}`);
    failedTests++;
  }
}

// =====================================================
// Test 1: sortResultsByStoryId - basic sorting
// =====================================================
console.log("\nTest 1: sortResultsByStoryId() - sorts by story number");
const unsortedResults = [
  { storyId: "US-003", status: "success" },
  { storyId: "US-001", status: "success" },
  { storyId: "US-010", status: "success" },
  { storyId: "US-002", status: "success" },
];

const sorted = committer.sortResultsByStoryId(unsortedResults);
assertEquals(
  sorted.map((r) => r.storyId),
  ["US-001", "US-002", "US-003", "US-010"],
  "Results sorted by story number"
);

// =====================================================
// Test 2: sortResultsByStoryId - preserves original
// =====================================================
console.log("\nTest 2: sortResultsByStoryId() - preserves original array");
assert(
  unsortedResults[0].storyId === "US-003",
  "Original array not modified"
);

// =====================================================
// Test 3: sortResultsByStoryId - empty array
// =====================================================
console.log("\nTest 3: sortResultsByStoryId() - handles empty array");
const emptySorted = committer.sortResultsByStoryId([]);
assertEquals(emptySorted, [], "Empty array returns empty array");

// =====================================================
// Test 4: markStoryComplete - basic functionality
// =====================================================
console.log("\nTest 4: markStoryComplete() - marks story complete in PRD");

// Create a temporary PRD file
const tmpDir = path.join(process.cwd(), ".ralph", ".tmp");
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}

const testPrdPath = path.join(tmpDir, "test-prd.md");
const testPrdContent = `# Test PRD

## User Stories

### [ ] US-001: First Story

Some content here.

### [ ] US-002: Second Story

More content.

### [x] US-003: Already Complete

Done.
`;

fs.writeFileSync(testPrdPath, testPrdContent, "utf-8");

// Test marking US-001 complete
const marked = committer.markStoryComplete("US-001", testPrdPath);
assert(marked === true, "Returns true on success");

const updatedContent = fs.readFileSync(testPrdPath, "utf-8");
assert(
  updatedContent.includes("### [x] US-001: First Story"),
  "Story US-001 marked complete"
);
assert(
  updatedContent.includes("### [ ] US-002: Second Story"),
  "Story US-002 unchanged"
);

// =====================================================
// Test 5: markStoryComplete - already complete story
// =====================================================
console.log("\nTest 5: markStoryComplete() - handles already complete story");
const markedAgain = committer.markStoryComplete("US-003", testPrdPath);
assert(markedAgain === false, "Returns false for already complete story");

// =====================================================
// Test 6: markStoryComplete - non-existent story
// =====================================================
console.log("\nTest 6: markStoryComplete() - handles non-existent story");
const markedNonExistent = committer.markStoryComplete("US-999", testPrdPath);
assert(markedNonExistent === false, "Returns false for non-existent story");

// =====================================================
// Test 7: updateProgress - creates entry
// =====================================================
console.log("\nTest 7: updateProgress() - creates progress entry");

const testProgressPath = path.join(tmpDir, "test-progress.md");
if (fs.existsSync(testProgressPath)) {
  fs.unlinkSync(testProgressPath);
}

const progressSuccess = committer.updateProgress(
  {
    storyId: "US-001",
    storyTitle: "First Story",
    hash: "abc123",
    subject: "feat(US-001): First Story",
    filesModified: ["src/index.js", "tests/test.js"],
    runId: "test-run-001",
  },
  testProgressPath
);

assert(progressSuccess === true, "Returns true on success");
assert(fs.existsSync(testProgressPath), "Progress file created");

const progressContent = fs.readFileSync(testProgressPath, "utf-8");
assert(progressContent.includes("US-001: First Story"), "Contains story ID and title");
assert(progressContent.includes("abc123"), "Contains commit hash");
assert(progressContent.includes("src/index.js"), "Contains file list");

// =====================================================
// Test 8: updateProgress - appends to existing
// =====================================================
console.log("\nTest 8: updateProgress() - appends to existing file");

const progressSuccess2 = committer.updateProgress(
  {
    storyId: "US-002",
    storyTitle: "Second Story",
    hash: "def456",
    subject: "feat(US-002): Second Story",
    filesModified: ["src/utils.js"],
    runId: "test-run-001",
  },
  testProgressPath
);

const progressContent2 = fs.readFileSync(testProgressPath, "utf-8");
assert(progressContent2.includes("US-001: First Story"), "Still contains first entry");
assert(progressContent2.includes("US-002: Second Story"), "Contains second entry");

// =====================================================
// Test 9: getStoryTitle - from results
// =====================================================
console.log("\nTest 9: getStoryTitle() - gets title from results");

const resultsWithTitle = [
  { storyId: "US-001", storyTitle: "Test Story Title" },
];
const title = committer.getStoryTitle("US-001", resultsWithTitle, testPrdPath);
assert(title === "Test Story Title", "Returns title from results");

// =====================================================
// Test 10: getStoryTitle - from PRD
// =====================================================
console.log("\nTest 10: getStoryTitle() - gets title from PRD");

const resultsWithoutTitle = [{ storyId: "US-002" }];
const titleFromPrd = committer.getStoryTitle("US-002", resultsWithoutTitle, testPrdPath);
assert(titleFromPrd === "Second Story", "Returns title from PRD");

// =====================================================
// Test 11: commitStoriesSequentially - validation
// =====================================================
console.log("\nTest 11: commitStoriesSequentially() - validates required options");

(async () => {
  try {
    await committer.commitStoriesSequentially([], {});
    assert(false, "Should throw on missing options");
  } catch (err) {
    assert(err.message.includes("required"), "Throws error for missing options");
  }

  // =====================================================
  // Test 12: commitStoriesSequentially - no successful results
  // =====================================================
  console.log("\nTest 12: commitStoriesSequentially() - handles no successful results");

  const failedResults = [
    { storyId: "US-001", status: "failed", error: "Test error" },
    { storyId: "US-002", status: "failed", error: "Another error" },
  ];

  const noSuccessResult = await committer.commitStoriesSequentially(failedResults, {
    prdPath: testPrdPath,
    repoRoot: process.cwd(),
    noCommit: true,
  });

  assert(noSuccessResult.status === "no-commits", "Status is no-commits");
  assert(noSuccessResult.committed.length === 0, "No committed stories");
  assert(noSuccessResult.failed.length === 2, "All stories in failed list");

  // =====================================================
  // Test 13: commitStoriesSequentially - dry run mode
  // =====================================================
  console.log("\nTest 13: commitStoriesSequentially() - dry run mode");

  // Reset the PRD for this test
  fs.writeFileSync(testPrdPath, testPrdContent, "utf-8");

  const dryRunResults = [
    {
      storyId: "US-002",
      status: "success",
      filesModified: ["src/test.js"],
    },
    {
      storyId: "US-001",
      status: "success",
      filesModified: ["src/index.js"],
    },
  ];

  const dryRunResult = await committer.commitStoriesSequentially(dryRunResults, {
    prdPath: testPrdPath,
    repoRoot: process.cwd(),
    noCommit: true,
  });

  assert(dryRunResult.status === "success", "Dry run succeeds");
  assert(dryRunResult.committed.length === 2, "Both stories in committed list");
  assert(
    dryRunResult.committed[0].storyId === "US-001",
    "Results sorted by story ID (US-001 first)"
  );
  assert(
    dryRunResult.committed[1].storyId === "US-002",
    "Results sorted by story ID (US-002 second)"
  );
  assert(dryRunResult.committed[0].dryRun === true, "Marked as dry run");

  // =====================================================
  // Test 14: commitStoriesSequentially - skips empty files
  // =====================================================
  console.log("\nTest 14: commitStoriesSequentially() - skips stories with no files");

  const mixedResults = [
    {
      storyId: "US-001",
      status: "success",
      filesModified: ["src/test.js"],
    },
    {
      storyId: "US-002",
      status: "success",
      filesModified: [],
    },
  ];

  const mixedResult = await committer.commitStoriesSequentially(mixedResults, {
    prdPath: testPrdPath,
    repoRoot: process.cwd(),
    noCommit: true,
  });

  assert(mixedResult.committed.length === 1, "Only one story committed");
  assert(mixedResult.skipped.length === 1, "One story skipped");
  assert(mixedResult.skipped[0].storyId === "US-002", "US-002 skipped");
  assert(
    mixedResult.skipped[0].reason.includes("No files"),
    "Skipped for no files"
  );

  // =====================================================
  // Test 15: commitStoriesSequentially - partial success
  // =====================================================
  console.log("\nTest 15: commitStoriesSequentially() - handles partial success");

  const partialResults = [
    {
      storyId: "US-001",
      status: "success",
      filesModified: ["src/good.js"],
    },
    {
      storyId: "US-002",
      status: "failed",
      error: "Execution failed",
    },
  ];

  const partialResult = await committer.commitStoriesSequentially(partialResults, {
    prdPath: testPrdPath,
    repoRoot: process.cwd(),
    noCommit: true,
  });

  assert(partialResult.status === "partial", "Status is partial");
  assert(partialResult.committed.length === 1, "One story committed");
  assert(partialResult.failed.length === 1, "One story failed");

  // =====================================================
  // Test 16: getGitStatus - returns status
  // =====================================================
  console.log("\nTest 16: getGitStatus() - returns git status");

  const gitStatus = committer.getGitStatus(process.cwd());
  assert(typeof gitStatus === "string", "Returns string");

  // =====================================================
  // Cleanup
  // =====================================================
  console.log("\nCleaning up test files...");
  try {
    fs.unlinkSync(testPrdPath);
    fs.unlinkSync(testProgressPath);
    console.log("Cleanup complete.");
  } catch (err) {
    console.log(`Cleanup note: ${err.message}`);
  }

  // =====================================================
  // Summary
  // =====================================================
  console.log("\n" + "=".repeat(50));
  console.log(`Tests passed: ${passedTests}`);
  console.log(`Tests failed: ${failedTests}`);
  console.log("=".repeat(50));

  process.exit(failedTests > 0 ? 1 : 0);
})();
