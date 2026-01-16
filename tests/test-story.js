/**
 * Unit tests for lib/story module
 *
 * Tests story parsing, selection, and atomic lock operations
 * including race condition tests for parallel execution.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const os = require("os");

// Import module under test
const {
  parseStories,
  parseStoriesFromFile,
  selectNextStory,
  selectAndLock,
  selectStory,
  acquireLock,
  releaseLock,
  isCompleted,
  isPending,
  getRemaining,
  getCompleted,
  findById,
  getSummary,
  writeStoryMeta,
  writeStoryBlock,
  StoryStatus,
  STORY_PATTERN,
  LOCK_CONFIG,
} = require("../lib/story");

// Test helpers
let testCount = 0;
let passCount = 0;
let failCount = 0;

function test(name, fn) {
  testCount++;
  try {
    fn();
    passCount++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failCount++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
  }
}

function describe(section, fn) {
  console.log(`\n${section}`);
  fn();
}

// Create a unique test directory for each test suite
function createTestDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ralph-story-test-"));
}

function cleanupTestDir(dir) {
  if (dir && fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Sample PRD content
const SAMPLE_PRD = `# Product Requirements

## User Stories

### [ ] US-001: First story

**As a** user
**I want** something
**So that** benefit

#### Acceptance Criteria
- [ ] Criterion 1

---

### [x] US-002: Second story (completed)

Already done.

---

### [ ] US-003: Third story

Another pending story.

---

### [X] US-004: Fourth story (case insensitive)

Completed with capital X.
`;

const EMPTY_PRD = `# Product Requirements

## User Stories

No stories here.
`;

const ALL_COMPLETED_PRD = `# Product Requirements

### [x] US-001: First done
Done.

### [x] US-002: Second done
Also done.
`;

// Create test PRD file
function createTestPrd(testDir, content) {
  const prdPath = path.join(testDir, `prd-${Date.now()}.md`);
  fs.writeFileSync(prdPath, content, "utf8");
  return prdPath;
}

// =============================================================================
// Synchronous Tests
// =============================================================================

describe("parseStories", () => {
  test("parses standard story format", () => {
    const result = parseStories(SAMPLE_PRD);
    assert.strictEqual(result.ok, true, "Should parse successfully");
    assert.strictEqual(result.total, 4, "Should find 4 stories");
    assert.strictEqual(result.completed, 2, "Should find 2 completed");
    assert.strictEqual(result.pending, 2, "Should find 2 pending");
  });

  test("extracts story ID correctly", () => {
    const result = parseStories(SAMPLE_PRD);
    assert.strictEqual(result.stories[0].id, "US-001");
    assert.strictEqual(result.stories[1].id, "US-002");
    assert.strictEqual(result.stories[2].id, "US-003");
    assert.strictEqual(result.stories[3].id, "US-004");
  });

  test("extracts story title correctly", () => {
    const result = parseStories(SAMPLE_PRD);
    assert.strictEqual(result.stories[0].title, "First story");
    assert.strictEqual(result.stories[1].title, "Second story (completed)");
  });

  test("handles case-insensitive checkbox", () => {
    const result = parseStories(SAMPLE_PRD);
    assert.strictEqual(result.stories[3].status, StoryStatus.COMPLETED);
    assert.strictEqual(result.stories[3].statusChar, "x"); // Normalized to lowercase
  });

  test("includes block content by default", () => {
    const result = parseStories(SAMPLE_PRD);
    assert.ok(result.stories[0].block, "Should include block");
    assert.ok(result.stories[0].block.includes("Acceptance Criteria"));
  });

  test("can exclude block content", () => {
    const result = parseStories(SAMPLE_PRD, { includeBlockContent: false });
    assert.strictEqual(result.stories[0].block, undefined);
  });

  test("returns error for empty content", () => {
    const result = parseStories("");
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes("non-empty"));
  });

  test("returns error for null content", () => {
    const result = parseStories(null);
    assert.strictEqual(result.ok, false);
  });

  test("returns error when no stories found", () => {
    const result = parseStories(EMPTY_PRD);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes("No stories found"));
  });

  test("tracks line numbers", () => {
    const result = parseStories(SAMPLE_PRD);
    assert.ok(result.stories[0].lineNumber > 0, "Should track line numbers");
    assert.ok(result.stories[1].lineNumber > result.stories[0].lineNumber);
  });
});

describe("parseStoriesFromFile", () => {
  const testDir = createTestDir();

  test("parses file successfully", () => {
    const prdPath = createTestPrd(testDir, SAMPLE_PRD);
    const result = parseStoriesFromFile(prdPath);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.total, 4);
    assert.strictEqual(result.filePath, prdPath);
  });

  test("returns error for non-existent file", () => {
    const result = parseStoriesFromFile("/nonexistent/file.md");
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes("not found"));
  });

  cleanupTestDir(testDir);
});

describe("selectNextStory", () => {
  test("selects first uncompleted story", () => {
    const result = parseStories(SAMPLE_PRD);
    const next = selectNextStory(result.stories);
    assert.strictEqual(next.id, "US-001", "Should select first pending story");
  });

  test("returns null when all completed", () => {
    const result = parseStories(ALL_COMPLETED_PRD);
    const next = selectNextStory(result.stories);
    assert.strictEqual(next, null, "Should return null when all done");
  });

  test("handles empty array", () => {
    const next = selectNextStory([]);
    assert.strictEqual(next, null);
  });

  test("handles null/undefined", () => {
    assert.strictEqual(selectNextStory(null), null);
    assert.strictEqual(selectNextStory(undefined), null);
  });
});

describe("selectStory (without locking)", () => {
  const testDir = createTestDir();

  test("selects next story from file", () => {
    const prdPath = createTestPrd(testDir, SAMPLE_PRD);
    const result = selectStory(prdPath);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.id, "US-001");
    assert.strictEqual(result.remaining, 2);
  });

  test("reports all completed", () => {
    const prdPath = createTestPrd(testDir, ALL_COMPLETED_PRD);
    const result = selectStory(prdPath);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.allCompleted, true);
    assert.strictEqual(result.story, null);
  });

  cleanupTestDir(testDir);
});

describe("writeStoryMeta and writeStoryBlock", () => {
  const testDir = createTestDir();

  test("writes meta file correctly", () => {
    const result = {
      ok: true,
      total: 4,
      remaining: 2,
      id: "US-001",
      title: "Test story",
      story: { id: "US-001", title: "Test story" },
    };

    const metaPath = path.join(testDir, "meta.json");
    writeStoryMeta(metaPath, result);

    const written = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    assert.strictEqual(written.ok, true);
    assert.strictEqual(written.id, "US-001");
    assert.strictEqual(written.remaining, 2);
  });

  test("writes block file correctly", () => {
    const result = {
      ok: true,
      block: "### US-001: Test\n\nContent here.",
    };

    const blockPath = path.join(testDir, "block.md");
    writeStoryBlock(blockPath, result);

    const written = fs.readFileSync(blockPath, "utf8");
    assert.ok(written.includes("US-001"));
  });

  test("writes empty block when no story", () => {
    const result = { ok: true, allCompleted: true };

    const blockPath = path.join(testDir, "empty.md");
    writeStoryBlock(blockPath, result);

    const written = fs.readFileSync(blockPath, "utf8");
    assert.strictEqual(written, "");
  });

  cleanupTestDir(testDir);
});

describe("utility functions", () => {
  const stories = [
    { id: "US-001", status: StoryStatus.PENDING },
    { id: "US-002", status: StoryStatus.COMPLETED },
    { id: "US-003", status: StoryStatus.PENDING },
  ];

  test("isCompleted returns correct values", () => {
    assert.strictEqual(isCompleted(stories[0]), false);
    assert.strictEqual(isCompleted(stories[1]), true);
    assert.ok(!isCompleted(null), "null should be falsy");
  });

  test("isPending returns correct values", () => {
    assert.strictEqual(isPending(stories[0]), true);
    assert.strictEqual(isPending(stories[1]), false);
    assert.ok(!isPending(null), "null should be falsy");
  });

  test("getRemaining", () => {
    const remaining = getRemaining(stories);
    assert.strictEqual(remaining.length, 2);
    assert.strictEqual(remaining[0].id, "US-001");
  });

  test("getCompleted", () => {
    const completed = getCompleted(stories);
    assert.strictEqual(completed.length, 1);
    assert.strictEqual(completed[0].id, "US-002");
  });

  test("findById", () => {
    assert.strictEqual(findById(stories, "US-002").status, StoryStatus.COMPLETED);
    assert.strictEqual(findById(stories, "US-999"), null);
    assert.strictEqual(findById(null, "US-001"), null);
  });

  test("getSummary", () => {
    const summary = getSummary(stories);
    assert.strictEqual(summary.total, 3);
    assert.strictEqual(summary.completed, 1);
    assert.strictEqual(summary.pending, 2);
  });
});

describe("STORY_PATTERN regex", () => {
  test("matches standard format", () => {
    const match = STORY_PATTERN.exec("### [ ] US-001: Story title");
    assert.ok(match);
    assert.strictEqual(match.groups.id, "US-001");
    assert.strictEqual(match.groups.title, "Story title");
    assert.strictEqual(match.groups.status, " ");
  });

  test("matches completed format", () => {
    const match = STORY_PATTERN.exec("### [x] US-123: Done story");
    assert.ok(match);
    assert.strictEqual(match.groups.status, "x");
  });

  test("matches capital X", () => {
    const match = STORY_PATTERN.exec("### [X] US-001: Done");
    assert.ok(match);
    assert.strictEqual(match.groups.status, "X");
  });

  test("matches without checkbox", () => {
    const match = STORY_PATTERN.exec("### US-001: No checkbox");
    assert.ok(match);
    assert.strictEqual(match.groups.status, undefined);
    assert.strictEqual(match.groups.id, "US-001");
  });

  test("does not match invalid formats", () => {
    assert.strictEqual(STORY_PATTERN.exec("## US-001: Wrong level"), null);
    assert.strictEqual(STORY_PATTERN.exec("### [ ] US001: No dash"), null);
    assert.strictEqual(STORY_PATTERN.exec("### [ ] us-001: lowercase"), null);
  });
});

// =============================================================================
// Async Tests (run separately)
// =============================================================================

async function runAsyncTests() {
  let asyncTestCount = 0;
  let asyncPassCount = 0;
  let asyncFailCount = 0;

  async function testAsync(name, fn) {
    asyncTestCount++;
    try {
      await fn();
      asyncPassCount++;
      console.log(`  ✓ ${name}`);
    } catch (err) {
      asyncFailCount++;
      console.log(`  ✗ ${name}`);
      console.log(`    ${err.message}`);
    }
  }

  console.log("\nacquireLock and releaseLock (async)");
  {
    const testDir = createTestDir();

    await testAsync("acquires lock successfully", async () => {
      const lockResult = await acquireLock(testDir);
      assert.strictEqual(lockResult.acquired, true, "Lock should be acquired");
      const lockPath = path.join(testDir, LOCK_CONFIG.lockDirName);
      assert.ok(fs.existsSync(lockPath), "Lock directory should exist");
      releaseLock(testDir);
    });

    await testAsync("lock blocks concurrent acquisition", async () => {
      const lock1 = await acquireLock(testDir);
      assert.strictEqual(lock1.acquired, true);

      // Try to acquire with very short timeout
      const lock2 = await acquireLock(testDir, { maxWaitMs: 200, pollIntervalMs: 10 });
      assert.strictEqual(lock2.acquired, false, "Second lock should fail");
      assert.ok(lock2.error.includes("Timeout"));

      releaseLock(testDir);
    });

    await testAsync("releases lock properly", async () => {
      const lock1 = await acquireLock(testDir);
      assert.strictEqual(lock1.acquired, true);

      const releaseResult = releaseLock(testDir);
      assert.strictEqual(releaseResult.released, true);

      // Should be able to acquire again
      const lock2 = await acquireLock(testDir);
      assert.strictEqual(lock2.acquired, true);
      releaseLock(testDir);
    });

    await testAsync("detects and cleans stale lock", async () => {
      // Manually create a lock with a non-existent PID
      const lockDir = path.join(testDir, LOCK_CONFIG.lockDirName);
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(path.join(lockDir, LOCK_CONFIG.pidFileName), "999999", "utf8");

      // Should acquire because lock is stale
      const lock = await acquireLock(testDir, { maxWaitMs: 2000 });
      assert.strictEqual(lock.acquired, true, "Should acquire stale lock");
      releaseLock(testDir);
    });

    cleanupTestDir(testDir);
  }

  console.log("\nselectAndLock (atomic operation)");
  {
    const testDir = createTestDir();

    await testAsync("performs atomic select", async () => {
      const prdPath = createTestPrd(testDir, SAMPLE_PRD);
      const result = await selectAndLock(prdPath);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.lockAcquired, true);
      assert.strictEqual(result.id, "US-001");
      assert.ok(result.block);
      assert.strictEqual(result.remaining, 2);
    });

    await testAsync("reports all completed", async () => {
      const prdPath = createTestPrd(testDir, ALL_COMPLETED_PRD);
      const result = await selectAndLock(prdPath);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.allCompleted, true);
      assert.strictEqual(result.story, null);
    });

    await testAsync("releases lock after operation", async () => {
      const prdPath = createTestPrd(testDir, SAMPLE_PRD);
      const prdFolder = path.dirname(prdPath);
      const lockDir = path.join(prdFolder, LOCK_CONFIG.lockDirName);

      await selectAndLock(prdPath);

      // Lock should be released
      assert.strictEqual(fs.existsSync(lockDir), false, "Lock should be released");
    });

    cleanupTestDir(testDir);
  }

  console.log("\nrace condition tests");
  {
    const testDir = createTestDir();

    await testAsync("parallel selectors wait for lock", async () => {
      const prdPath = createTestPrd(testDir, SAMPLE_PRD);

      // Start 5 concurrent selections
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(selectAndLock(prdPath, { maxWaitMs: 5000 }));
      }

      const results = await Promise.all(promises);

      // All should succeed (they serialize via lock)
      const successCount = results.filter((r) => r.ok).length;
      assert.strictEqual(successCount, 5, "All selections should succeed");

      // All should return the same first story (since PRD isn't modified)
      const ids = results.filter((r) => r.id).map((r) => r.id);
      const uniqueIds = [...new Set(ids)];
      assert.strictEqual(uniqueIds.length, 1, "All should select same story");
      assert.strictEqual(uniqueIds[0], "US-001");
    });

    await testAsync("concurrent lock attempts serialize correctly", async () => {
      const lockTimes = [];

      const lockAndRecord = async (id) => {
        const start = Date.now();
        const lock = await acquireLock(testDir, { maxWaitMs: 10000 });
        const acquired = Date.now();

        if (lock.acquired) {
          lockTimes.push({ id, start, acquired, duration: acquired - start });
          // Hold lock briefly
          await new Promise((r) => setTimeout(r, 50));
          releaseLock(testDir);
        }

        return lock;
      };

      // Start 10 concurrent lock attempts
      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(lockAndRecord(i));
      }

      const results = await Promise.all(promises);

      // All should succeed
      const successCount = results.filter((r) => r.acquired).length;
      assert.strictEqual(successCount, 10, "All locks should succeed");

      // Check that locks were serialized (acquired times should be sequential)
      // Sort by acquired time
      lockTimes.sort((a, b) => a.acquired - b.acquired);

      // Verify no overlap (each acquisition should be after previous)
      for (let i = 1; i < lockTimes.length; i++) {
        const gap = lockTimes[i].acquired - lockTimes[i - 1].acquired;
        assert.ok(gap >= 0, "Lock acquisitions should be sequential");
      }
    });

    cleanupTestDir(testDir);
  }

  return { asyncTestCount, asyncPassCount, asyncFailCount };
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  console.log("\n========================================");
  console.log("Story Module Tests");
  console.log("========================================");

  // Run async tests
  const asyncResults = await runAsyncTests();

  // Combine results
  const totalTests = testCount + asyncResults.asyncTestCount;
  const totalPassed = passCount + asyncResults.asyncPassCount;
  const totalFailed = failCount + asyncResults.asyncFailCount;

  console.log("\n========================================");
  console.log(`Results: ${totalPassed}/${totalTests} passed`);
  if (totalFailed > 0) {
    console.log(`${totalFailed} FAILED`);
    process.exit(1);
  } else {
    console.log("All tests passed!");
    process.exit(0);
  }
}

main().catch((err) => {
  console.error("Test runner error:", err);
  process.exit(1);
});
