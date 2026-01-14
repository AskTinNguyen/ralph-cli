/**
 * Sequential Commit Application module
 *
 * Handles committing parallel story results in story ID order.
 * Ensures clean git history with one commit per story.
 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Sort execution results by story ID (US-001 before US-002, etc.)
 *
 * @param {Array} results - Array of execution results
 * @returns {Array} Sorted results
 */
function sortResultsByStoryId(results) {
  return [...results].sort((a, b) => {
    // Extract numeric portion from story ID (e.g., US-001 -> 1)
    const numA = parseInt(a.storyId.replace(/\D/g, ""), 10);
    const numB = parseInt(b.storyId.replace(/\D/g, ""), 10);
    return numA - numB;
  });
}

/**
 * Stage only files from a specific story for committing
 *
 * @param {Array} files - Array of file paths to stage
 * @param {string} repoRoot - Repository root directory
 * @returns {Promise<Object>} Result with success status and staged files
 */
async function stageFilesForStory(files, repoRoot) {
  if (!files || files.length === 0) {
    return {
      success: true,
      stagedFiles: [],
      message: "No files to stage",
    };
  }

  const stagedFiles = [];
  const errors = [];

  for (const file of files) {
    try {
      const fullPath = path.isAbsolute(file) ? file : path.join(repoRoot, file);

      // Check if file exists (could have been deleted)
      const exists = fs.existsSync(fullPath);

      // Git add works for both existing and deleted files
      execSync(`git add "${file}"`, {
        cwd: repoRoot,
        stdio: "pipe",
      });

      stagedFiles.push(file);
    } catch (err) {
      errors.push({
        file,
        error: err.message,
      });
    }
  }

  return {
    success: errors.length === 0,
    stagedFiles,
    errors: errors.length > 0 ? errors : null,
    message: errors.length > 0 ? `Failed to stage ${errors.length} file(s)` : "All files staged",
  };
}

/**
 * Create a commit with the standard message format
 *
 * @param {string} storyId - Story ID (e.g., "US-001")
 * @param {string} storyTitle - Story title
 * @param {string} repoRoot - Repository root directory
 * @returns {Promise<Object>} Result with success status, hash, and subject
 */
async function createCommit(storyId, storyTitle, repoRoot) {
  const message = `feat(${storyId}): ${storyTitle}`;

  try {
    // Check if there are staged changes
    const status = execSync("git diff --cached --name-only", {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();

    if (!status) {
      return {
        success: false,
        error: "No staged changes to commit",
        hash: null,
        subject: null,
      };
    }

    // Create commit
    execSync(`git commit -m "${message}"`, {
      cwd: repoRoot,
      stdio: "pipe",
    });

    // Get commit hash and subject
    const result = execSync('git show -s --format="%h %s" HEAD', {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();

    const [hash, ...subjectParts] = result.split(" ");
    const subject = subjectParts.join(" ");

    return {
      success: true,
      hash,
      subject,
      message,
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      hash: null,
      subject: null,
    };
  }
}

/**
 * Mark a story as complete in the PRD file
 *
 * @param {string} storyId - Story ID (e.g., "US-001")
 * @param {string} prdPath - Path to PRD file
 * @returns {boolean} True if successful
 */
function markStoryComplete(storyId, prdPath) {
  try {
    let content = fs.readFileSync(prdPath, "utf-8");

    // Pattern to match story heading: ### [ ] US-001: Title
    const pattern = new RegExp(
      `(###\\s+)\\[\\s*\\]\\s+(${storyId}:.*)$`,
      "m"
    );

    if (pattern.test(content)) {
      content = content.replace(pattern, "$1[x] $2");
      fs.writeFileSync(prdPath, content, "utf-8");
      return true;
    }

    // Story may already be marked complete or pattern doesn't match
    return false;
  } catch (err) {
    console.error(`Failed to mark story ${storyId} complete: ${err.message}`);
    return false;
  }
}

/**
 * Mark acceptance criteria as complete in the PRD file
 *
 * @param {string} storyId - Story ID (e.g., "US-001")
 * @param {Array} criteria - Array of criteria descriptions to check off
 * @param {string} prdPath - Path to PRD file
 * @returns {number} Number of criteria marked complete
 */
function markAcceptanceCriteriaComplete(storyId, criteria, prdPath) {
  try {
    let content = fs.readFileSync(prdPath, "utf-8");
    let markedCount = 0;

    // Find the story section
    const storyPattern = new RegExp(`###\\s+\\[[\\sxX]\\]\\s+${storyId}:[\\s\\S]*?(?=###|$)`, "m");
    const storyMatch = content.match(storyPattern);

    if (!storyMatch) {
      return 0;
    }

    // Mark each criterion
    for (const criterion of criteria) {
      // Escape special regex characters in criterion text
      const escapedCriterion = criterion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const criteriaPattern = new RegExp(`(- \\[)\\s*(\\]\\s*${escapedCriterion})`, "g");

      if (criteriaPattern.test(content)) {
        content = content.replace(criteriaPattern, "$1x$2");
        markedCount++;
      }
    }

    if (markedCount > 0) {
      fs.writeFileSync(prdPath, content, "utf-8");
    }

    return markedCount;
  } catch (err) {
    console.error(`Failed to mark criteria for ${storyId}: ${err.message}`);
    return 0;
  }
}

/**
 * Update progress.md with commit details
 *
 * @param {Object} commitInfo - Commit information
 * @param {string} commitInfo.storyId - Story ID
 * @param {string} commitInfo.storyTitle - Story title
 * @param {string} commitInfo.hash - Commit hash
 * @param {string} commitInfo.subject - Commit subject
 * @param {Array} commitInfo.filesModified - Files modified
 * @param {string} commitInfo.runId - Run ID
 * @param {string} progressPath - Path to progress.md
 * @returns {boolean} True if successful
 */
function updateProgress(commitInfo, progressPath) {
  try {
    const { storyId, storyTitle, hash, subject, filesModified, runId } = commitInfo;

    const timestamp = new Date().toISOString().replace("T", " ").split(".")[0];
    const filesList = filesModified
      .map((f) => `  - ${f}`)
      .join("\n");

    const entry = `
## [${timestamp}] - ${storyId}: ${storyTitle}
Thread: Parallel Executor (Sequential Commit)
Run: ${runId || "N/A"}
- Commit: ${hash} ${subject}
- Files committed:
${filesList || "  - (no files)"}
- Story committed as part of parallel batch execution

---
`;

    // Append to progress file
    if (fs.existsSync(progressPath)) {
      fs.appendFileSync(progressPath, entry, "utf-8");
    } else {
      // Create progress file with header
      const header = `# Progress Log\n\n---\n`;
      fs.writeFileSync(progressPath, header + entry, "utf-8");
    }

    return true;
  } catch (err) {
    console.error(`Failed to update progress: ${err.message}`);
    return false;
  }
}

/**
 * Get story title from story ID using results or PRD
 *
 * @param {string} storyId - Story ID
 * @param {Array} results - Execution results (may contain title)
 * @param {string} prdPath - Path to PRD file
 * @returns {string} Story title
 */
function getStoryTitle(storyId, results, prdPath) {
  // First try to get from results
  const result = results.find((r) => r.storyId === storyId);
  if (result && result.storyTitle) {
    return result.storyTitle;
  }

  // Try to parse from PRD
  try {
    const content = fs.readFileSync(prdPath, "utf-8");
    const pattern = new RegExp(`###\\s+\\[[\\sxX]\\]\\s+${storyId}:\\s*(.+)$`, "m");
    const match = content.match(pattern);
    if (match) {
      return match[1].trim();
    }
  } catch (err) {
    // Ignore errors
  }

  return "Unknown Story";
}

/**
 * Commit stories sequentially after parallel batch execution
 *
 * This is the main function that:
 * 1. Sorts results by story ID
 * 2. For each successful story:
 *    - Stages only that story's files
 *    - Creates commit with proper message
 *    - Marks story complete in PRD
 *    - Updates progress.md
 * 3. Handles partial success (some fail, others commit)
 *
 * @param {Array} results - Array of parallel execution results
 * @param {Object} options - Commit options
 * @param {string} options.prdPath - Path to PRD file
 * @param {string} options.progressPath - Path to progress.md
 * @param {string} options.repoRoot - Repository root directory
 * @param {string} options.runId - Run ID for tracking
 * @param {boolean} options.noCommit - If true, skip actual commits (dry run)
 * @returns {Promise<Object>} Commit summary with committed/failed arrays
 */
async function commitStoriesSequentially(results, options = {}) {
  const { prdPath, progressPath, repoRoot, runId, noCommit = false } = options;

  if (!prdPath || !repoRoot) {
    throw new Error("prdPath and repoRoot are required");
  }

  // Filter to successful results only
  const successfulResults = results.filter((r) => r.status === "success");

  if (successfulResults.length === 0) {
    return {
      status: "no-commits",
      message: "No successful stories to commit",
      committed: [],
      failed: results.map((r) => ({
        storyId: r.storyId,
        reason: r.error || "Story execution failed",
      })),
      skipped: [],
    };
  }

  // Sort by story ID
  const sortedResults = sortResultsByStoryId(successfulResults);

  const committed = [];
  const failed = [];
  const skipped = [];

  // Process each story in order
  for (const result of sortedResults) {
    const { storyId, filesModified } = result;
    const storyTitle = getStoryTitle(storyId, results, prdPath);

    // Skip if no files modified
    if (!filesModified || filesModified.length === 0) {
      skipped.push({
        storyId,
        reason: "No files modified",
      });
      continue;
    }

    if (noCommit) {
      // Dry run - don't actually commit
      committed.push({
        storyId,
        storyTitle,
        hash: "dry-run",
        subject: `feat(${storyId}): ${storyTitle}`,
        filesModified,
        dryRun: true,
      });

      // Still mark story complete in PRD during dry run
      markStoryComplete(storyId, prdPath);
      continue;
    }

    try {
      // Stage files for this story
      const stageResult = await stageFilesForStory(filesModified, repoRoot);

      if (!stageResult.success || stageResult.stagedFiles.length === 0) {
        failed.push({
          storyId,
          reason: stageResult.message || "Failed to stage files",
          errors: stageResult.errors,
        });
        continue;
      }

      // Create commit
      const commitResult = await createCommit(storyId, storyTitle, repoRoot);

      if (!commitResult.success) {
        failed.push({
          storyId,
          reason: commitResult.error || "Failed to create commit",
        });
        continue;
      }

      // Mark story complete in PRD
      markStoryComplete(storyId, prdPath);

      // Update progress.md
      if (progressPath) {
        updateProgress(
          {
            storyId,
            storyTitle,
            hash: commitResult.hash,
            subject: commitResult.subject,
            filesModified: stageResult.stagedFiles,
            runId,
          },
          progressPath
        );
      }

      committed.push({
        storyId,
        storyTitle,
        hash: commitResult.hash,
        subject: commitResult.subject,
        filesModified: stageResult.stagedFiles,
      });
    } catch (err) {
      failed.push({
        storyId,
        reason: err.message,
      });
    }
  }

  // Add originally failed stories to the failed list
  for (const result of results) {
    if (result.status !== "success") {
      failed.push({
        storyId: result.storyId,
        reason: result.error || "Story execution failed",
      });
    }
  }

  return {
    status: failed.length === 0 ? "success" : "partial",
    message:
      failed.length === 0
        ? `All ${committed.length} stories committed successfully`
        : `${committed.length} committed, ${failed.length} failed`,
    committed,
    failed,
    skipped,
  };
}

/**
 * Get git status for verification
 *
 * @param {string} repoRoot - Repository root directory
 * @returns {string} Git status output
 */
function getGitStatus(repoRoot) {
  try {
    return execSync("git status --porcelain", {
      cwd: repoRoot,
      encoding: "utf-8",
    }).trim();
  } catch (err) {
    return `Error: ${err.message}`;
  }
}

/**
 * Reset staged changes (useful for error recovery)
 *
 * @param {string} repoRoot - Repository root directory
 * @returns {boolean} True if successful
 */
function resetStagedChanges(repoRoot) {
  try {
    execSync("git reset HEAD", {
      cwd: repoRoot,
      stdio: "pipe",
    });
    return true;
  } catch (err) {
    return false;
  }
}

module.exports = {
  sortResultsByStoryId,
  stageFilesForStory,
  createCommit,
  markStoryComplete,
  markAcceptanceCriteriaComplete,
  updateProgress,
  getStoryTitle,
  commitStoriesSequentially,
  getGitStatus,
  resetStagedChanges,
};
