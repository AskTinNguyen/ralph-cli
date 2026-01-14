/**
 * State file validation checks for ralph doctor
 *
 * Validates PRD markdown structure, plan.md format, progress.md consistency,
 * and detects orphaned run logs.
 */
const fs = require("fs");
const path = require("path");

/**
 * Read file contents or return null if not exists
 * @param {string} filePath - Path to file
 * @returns {string|null} - File contents or null
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Validate PRD markdown structure
 * Checks for:
 * - Valid markdown headers
 * - Story format (### [ ] US-XXX: Title or ### [x] US-XXX: Title)
 * - Acceptance criteria format (- [ ] or - [x])
 *
 * @param {string} prdPath - Path to prd.md file
 * @returns {object} Validation result with errors and warnings
 */
function validatePRD(prdPath) {
  const result = {
    name: "PRD Validation",
    path: prdPath,
    valid: true,
    exists: false,
    errors: [],
    warnings: [],
    stats: {
      totalStories: 0,
      completedStories: 0,
      totalCriteria: 0,
      completedCriteria: 0,
    },
  };

  const content = readFile(prdPath);
  if (!content) {
    result.valid = false;
    result.errors.push({
      type: "file_not_found",
      message: `PRD file not found: ${prdPath}`,
      line: null,
    });
    return result;
  }

  result.exists = true;
  const lines = content.split("\n");

  // Check for title header
  const hasTitleHeader = lines.some((line) => /^# .+/.test(line));
  if (!hasTitleHeader) {
    result.warnings.push({
      type: "missing_title",
      message: "PRD is missing a title header (# Title)",
      line: null,
    });
  }

  // Check for Overview section
  const hasOverview = lines.some((line) => /^## Overview/i.test(line));
  if (!hasOverview) {
    result.warnings.push({
      type: "missing_overview",
      message: "PRD is missing an Overview section",
      line: null,
    });
  }

  // Check for User Stories section
  const hasUserStories = lines.some((line) => /^## User Stories/i.test(line));
  if (!hasUserStories) {
    result.warnings.push({
      type: "missing_user_stories",
      message: "PRD is missing a User Stories section",
      line: null,
    });
  }

  // Validate story format and track stats
  const storyPattern = /^### \[([ x])\] (US-\d+):\s*(.*)$/;
  const criteriaPattern = /^- \[([ x])\]\s+(.+)$/;
  let inStory = false;
  let currentStoryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for story headers
    const storyMatch = line.match(storyPattern);
    if (storyMatch) {
      inStory = true;
      currentStoryId = storyMatch[2];
      result.stats.totalStories++;

      if (storyMatch[1] === "x") {
        result.stats.completedStories++;
      }

      // Check for proper story ID format
      if (!/^US-\d{3}$/.test(storyMatch[2])) {
        result.warnings.push({
          type: "story_id_format",
          message: `Story ID format should be US-XXX (3 digits): ${storyMatch[2]}`,
          line: lineNum,
        });
      }

      // Check for empty title
      if (!storyMatch[3] || storyMatch[3].trim() === "") {
        result.errors.push({
          type: "empty_story_title",
          message: `Story ${storyMatch[2]} has an empty title`,
          line: lineNum,
        });
        result.valid = false;
      }
    }

    // Check for malformed story headers (common mistakes)
    if (line.match(/^### \[/) && !storyMatch) {
      // Starts like a story but doesn't match pattern
      result.errors.push({
        type: "malformed_story_header",
        message: `Malformed story header (expected: ### [ ] US-XXX: Title)`,
        line: lineNum,
      });
      result.valid = false;
    }

    // Check for acceptance criteria within a story
    const criteriaMatch = line.match(criteriaPattern);
    if (criteriaMatch && inStory) {
      result.stats.totalCriteria++;
      if (criteriaMatch[1] === "x") {
        result.stats.completedCriteria++;
      }
    }

    // Check for unclosed brackets in checkboxes
    if (line.match(/- \[[^\]]*$/) || line.match(/^### \[[^\]]*$/)) {
      result.errors.push({
        type: "unclosed_bracket",
        message: "Unclosed bracket in checkbox",
        line: lineNum,
      });
      result.valid = false;
    }
  }

  // Warn if no stories found
  if (result.stats.totalStories === 0) {
    result.warnings.push({
      type: "no_stories",
      message: "PRD contains no user stories",
      line: null,
    });
  }

  return result;
}

/**
 * Validate plan.md format and structure
 * Checks for:
 * - Summary section
 * - Tasks section with story headers
 * - Task checkboxes format
 * - Scope/Acceptance/Verification blocks
 *
 * @param {string} planPath - Path to plan.md file
 * @returns {object} Validation result with errors and warnings
 */
function validatePlan(planPath) {
  const result = {
    name: "Plan Validation",
    path: planPath,
    valid: true,
    exists: false,
    errors: [],
    warnings: [],
    stats: {
      totalTasks: 0,
      completedTasks: 0,
      storyIds: [],
    },
  };

  const content = readFile(planPath);
  if (!content) {
    result.valid = false;
    result.errors.push({
      type: "file_not_found",
      message: `Plan file not found: ${planPath}`,
      line: null,
    });
    return result;
  }

  result.exists = true;
  const lines = content.split("\n");

  // Check for title header
  const hasTitleHeader = lines.some((line) => /^# Implementation Plan/i.test(line));
  if (!hasTitleHeader) {
    result.warnings.push({
      type: "missing_title",
      message: "Plan is missing '# Implementation Plan' header",
      line: null,
    });
  }

  // Check for Summary section
  const hasSummary = lines.some((line) => /^## Summary/i.test(line));
  if (!hasSummary) {
    result.warnings.push({
      type: "missing_summary",
      message: "Plan is missing a Summary section",
      line: null,
    });
  }

  // Check for Tasks section
  const hasTasks = lines.some((line) => /^## Tasks/i.test(line));
  if (!hasTasks) {
    result.warnings.push({
      type: "missing_tasks",
      message: "Plan is missing a Tasks section",
      line: null,
    });
  }

  // Validate story sections and tasks
  const storyHeaderPattern = /^### (US-\d+):\s*(.*)$/;
  const taskPattern = /^- \[([ x])\]\s+(.+)$/;
  let currentStoryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for story headers
    const storyMatch = line.match(storyHeaderPattern);
    if (storyMatch) {
      currentStoryId = storyMatch[1];
      if (!result.stats.storyIds.includes(currentStoryId)) {
        result.stats.storyIds.push(currentStoryId);
      }
    }

    // Check for tasks
    const taskMatch = line.match(taskPattern);
    if (taskMatch) {
      result.stats.totalTasks++;
      if (taskMatch[1] === "x") {
        result.stats.completedTasks++;
      }
    }

    // Check for malformed task checkboxes
    if (line.match(/^- \[/) && !taskMatch && !line.match(/^- \[([ x])\]\s*$/)) {
      // Starts like a task but doesn't match - could be a formatting issue
      if (line.match(/^- \[[^\]]*$/)) {
        result.errors.push({
          type: "unclosed_task_bracket",
          message: "Unclosed bracket in task checkbox",
          line: lineNum,
        });
        result.valid = false;
      }
    }

    // Check for orphaned Scope/Acceptance/Verification without task
    if (
      (line.match(/^\s+-\s+Scope:/) ||
        line.match(/^\s+-\s+Acceptance:/) ||
        line.match(/^\s+-\s+Verification:/)) &&
      i > 0
    ) {
      // These should follow a task or another sub-item
      const prevLine = lines[i - 1];
      if (
        !prevLine.match(taskPattern) &&
        !prevLine.match(/^\s+-\s+(Scope|Acceptance|Verification):/)
      ) {
        result.warnings.push({
          type: "orphaned_task_detail",
          message: `Task detail (${line.trim().split(":")[0]}) appears orphaned`,
          line: lineNum,
        });
      }
    }
  }

  // Warn if no tasks found
  if (result.stats.totalTasks === 0) {
    result.warnings.push({
      type: "no_tasks",
      message: "Plan contains no tasks",
      line: null,
    });
  }

  return result;
}

/**
 * Validate progress.md format and consistency
 * Checks for:
 * - Progress entry format
 * - Required fields (Run, Commit, Verification)
 * - Timestamp consistency
 *
 * @param {string} progressPath - Path to progress.md file
 * @returns {object} Validation result with errors and warnings
 */
function validateProgress(progressPath) {
  const result = {
    name: "Progress Validation",
    path: progressPath,
    valid: true,
    exists: false,
    errors: [],
    warnings: [],
    stats: {
      totalEntries: 0,
      entriesWithCommit: 0,
      entriesWithVerification: 0,
      runIds: [],
    },
  };

  const content = readFile(progressPath);
  if (!content) {
    // Progress file not existing is okay - it's created during first run
    result.warnings.push({
      type: "file_not_found",
      message: `Progress file not found (will be created on first run): ${progressPath}`,
      line: null,
    });
    return result;
  }

  result.exists = true;
  const lines = content.split("\n");

  // Check for title header
  const hasTitleHeader = lines.some((line) => /^# Progress Log/i.test(line));
  if (!hasTitleHeader) {
    result.warnings.push({
      type: "missing_title",
      message: "Progress log is missing '# Progress Log' header",
      line: null,
    });
  }

  // Parse progress entries
  const entryHeaderPattern = /^## \[([^\]]+)\] - (US-\d+):\s*(.*)$/;
  const runPattern = /^Run:\s*(.+)$/;
  const commitPattern = /^- Commit:\s*(.+)$/;
  const verificationPattern = /^- Verification:$/;
  let inEntry = false;
  let currentEntryLine = null;
  let hasRun = false;
  let hasCommit = false;
  let hasVerification = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for entry headers
    const entryMatch = line.match(entryHeaderPattern);
    if (entryMatch) {
      // Validate previous entry if exists
      if (inEntry) {
        if (!hasRun) {
          result.warnings.push({
            type: "missing_run",
            message: "Progress entry missing Run field",
            line: currentEntryLine,
          });
        }
        if (!hasCommit) {
          result.warnings.push({
            type: "missing_commit",
            message: "Progress entry missing Commit field",
            line: currentEntryLine,
          });
        } else {
          result.stats.entriesWithCommit++;
        }
        if (hasVerification) {
          result.stats.entriesWithVerification++;
        }
      }

      // Start new entry
      inEntry = true;
      currentEntryLine = lineNum;
      hasRun = false;
      hasCommit = false;
      hasVerification = false;
      result.stats.totalEntries++;

      // Validate timestamp format
      const timestamp = entryMatch[1];
      if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(timestamp)) {
        result.warnings.push({
          type: "invalid_timestamp",
          message: `Invalid timestamp format (expected: YYYY-MM-DD HH:MM): ${timestamp}`,
          line: lineNum,
        });
      }
    }

    // Check for Run field
    if (line.match(runPattern) && inEntry) {
      hasRun = true;
      const runIdMatch = line.match(/Run:\s*(\d{8}-\d{6}-\d+)/);
      if (runIdMatch && !result.stats.runIds.includes(runIdMatch[1])) {
        result.stats.runIds.push(runIdMatch[1]);
      }
    }

    // Check for Commit field
    if (line.match(commitPattern)) {
      hasCommit = true;
    }

    // Check for Verification field
    if (line.match(verificationPattern)) {
      hasVerification = true;
    }

    // Check for entry separator
    if (line === "---" && inEntry) {
      // End of current entry
      if (!hasRun) {
        result.warnings.push({
          type: "missing_run",
          message: "Progress entry missing Run field",
          line: currentEntryLine,
        });
      }
      if (!hasCommit) {
        result.warnings.push({
          type: "missing_commit",
          message: "Progress entry missing Commit field",
          line: currentEntryLine,
        });
      } else {
        result.stats.entriesWithCommit++;
      }
      if (hasVerification) {
        result.stats.entriesWithVerification++;
      }
      inEntry = false;
    }
  }

  // Validate final entry if exists
  if (inEntry) {
    if (!hasRun) {
      result.warnings.push({
        type: "missing_run",
        message: "Progress entry missing Run field",
        line: currentEntryLine,
      });
    }
    if (!hasCommit) {
      result.warnings.push({
        type: "missing_commit",
        message: "Progress entry missing Commit field",
        line: currentEntryLine,
      });
    } else {
      result.stats.entriesWithCommit++;
    }
    if (hasVerification) {
      result.stats.entriesWithVerification++;
    }
  }

  return result;
}

/**
 * Find orphaned run logs that don't have matching progress entries
 *
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {object} Result with orphaned run files
 */
function findOrphanedRuns(ralphDir) {
  const result = {
    name: "Orphaned Run Detection",
    path: ralphDir,
    orphanedRuns: [],
    validRuns: [],
    errors: [],
  };

  // Get all PRD directories
  let prdDirs;
  try {
    const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
    prdDirs = entries
      .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
      .map((e) => path.join(ralphDir, e.name));
  } catch (err) {
    result.errors.push({
      type: "read_error",
      message: `Could not read ralph directory: ${err.message}`,
    });
    return result;
  }

  for (const prdDir of prdDirs) {
    const runsDir = path.join(prdDir, "runs");
    const progressPath = path.join(prdDir, "progress.md");

    // Get run IDs from progress.md
    const progressContent = readFile(progressPath);
    const referencedRunIds = new Set();

    if (progressContent) {
      // Extract all run IDs referenced in progress.md
      const runIdPattern = /\d{8}-\d{6}-\d+/g;
      let match;
      while ((match = runIdPattern.exec(progressContent)) !== null) {
        referencedRunIds.add(match[0]);
      }
    }

    // Check runs directory
    try {
      if (!fs.existsSync(runsDir)) {
        continue;
      }

      const runFiles = fs.readdirSync(runsDir);
      for (const runFile of runFiles) {
        // Extract run ID from filename (e.g., run-20260113-205928-9672-iter-1.log)
        const runIdMatch = runFile.match(/run-(\d{8}-\d{6}-\d+)/);
        if (runIdMatch) {
          const runId = runIdMatch[1];
          const runFilePath = path.join(runsDir, runFile);

          if (referencedRunIds.has(runId)) {
            result.validRuns.push(runFilePath);
          } else {
            // This run is not referenced in progress.md
            result.orphanedRuns.push({
              path: runFilePath,
              runId: runId,
              prdDir: path.basename(prdDir),
            });
          }
        }
      }
    } catch (err) {
      result.errors.push({
        type: "read_error",
        message: `Could not read runs directory ${runsDir}: ${err.message}`,
      });
    }
  }

  return result;
}

/**
 * Run all state checks for all PRD directories
 * @param {string} ralphDir - Path to .ralph directory
 * @returns {object} Aggregated results
 */
function runAllChecks(ralphDir) {
  const checks = [];
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  // Get all PRD directories
  let prdDirs = [];
  try {
    if (fs.existsSync(ralphDir)) {
      const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
      prdDirs = entries
        .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
        .map((e) => ({
          name: e.name,
          path: path.join(ralphDir, e.name),
        }));
    }
  } catch (err) {
    checks.push({
      name: "Directory Access",
      valid: false,
      errors: [{ type: "read_error", message: `Cannot read ralph directory: ${err.message}` }],
    });
    errors++;
  }

  if (prdDirs.length === 0) {
    checks.push({
      name: "PRD Detection",
      valid: true,
      warnings: [{ type: "no_prds", message: "No PRD directories found in .ralph/" }],
    });
    warnings++;
  }

  // Validate each PRD directory
  for (const prdInfo of prdDirs) {
    const prdPath = path.join(prdInfo.path, "prd.md");
    const planPath = path.join(prdInfo.path, "plan.md");
    const progressPath = path.join(prdInfo.path, "progress.md");

    // Validate PRD
    const prdResult = validatePRD(prdPath);
    prdResult.prdName = prdInfo.name;
    checks.push(prdResult);

    if (prdResult.valid && prdResult.exists) {
      passed++;
    } else if (prdResult.exists) {
      errors += prdResult.errors.length;
    }
    warnings += prdResult.warnings.length;

    // Validate Plan
    const planResult = validatePlan(planPath);
    planResult.prdName = prdInfo.name;
    checks.push(planResult);

    if (planResult.valid && planResult.exists) {
      passed++;
    } else if (planResult.exists) {
      errors += planResult.errors.length;
    }
    warnings += planResult.warnings.length;

    // Validate Progress
    const progressResult = validateProgress(progressPath);
    progressResult.prdName = prdInfo.name;
    checks.push(progressResult);

    if (progressResult.valid && progressResult.exists) {
      passed++;
    }
    warnings += progressResult.warnings.length;
    errors += progressResult.errors.length;
  }

  // Find orphaned runs
  const orphanedResult = findOrphanedRuns(ralphDir);
  if (orphanedResult.orphanedRuns.length > 0) {
    orphanedResult.warnings = orphanedResult.orphanedRuns.map((run) => ({
      type: "orphaned_run",
      message: `Run log ${run.path} not referenced in progress.md`,
      runId: run.runId,
      prdDir: run.prdDir,
    }));
    warnings += orphanedResult.orphanedRuns.length;
  }
  checks.push(orphanedResult);
  errors += orphanedResult.errors.length;

  return {
    category: "state",
    checks,
    passed,
    warnings,
    errors,
    summary: {
      prdCount: prdDirs.length,
      orphanedRuns: orphanedResult.orphanedRuns.length,
      validRuns: orphanedResult.validRuns.length,
    },
  };
}

module.exports = {
  validatePRD,
  validatePlan,
  validateProgress,
  findOrphanedRuns,
  runAllChecks,
};
