/**
 * Project indexer
 *
 * Indexes guardrails, progress entries, and evaluations from projects.
 */
const fs = require("fs");
const path = require("path");
const { updateProject, getProject, loadRegistry, saveRegistry } = require("./projects");
const { getIndexPath } = require("./structure");

/**
 * Count guardrails in a project's guardrails.md file
 * @param {string} projectPath - Project directory path
 * @returns {number} - Number of guardrails found
 */
function countGuardrails(projectPath) {
  const guardrailsPath = path.join(projectPath, ".ralph", "guardrails.md");
  if (!fs.existsSync(guardrailsPath)) {
    return 0;
  }

  try {
    const content = fs.readFileSync(guardrailsPath, "utf-8");
    // Count ### Sign: patterns
    const matches = content.match(/^### Sign:/gm);
    return matches ? matches.length : 0;
  } catch {
    return 0;
  }
}

/**
 * Count progress entries in project's progress files
 * @param {string} projectPath - Project directory path
 * @returns {number} - Number of progress entries found
 */
function countProgressEntries(projectPath) {
  const ralphDir = path.join(projectPath, ".ralph");
  if (!fs.existsSync(ralphDir)) {
    return 0;
  }

  let count = 0;

  // Check for progress.md in root .ralph/
  const rootProgress = path.join(ralphDir, "progress.md");
  if (fs.existsSync(rootProgress)) {
    try {
      const content = fs.readFileSync(rootProgress, "utf-8");
      // Count ## [Date/Time] patterns
      const matches = content.match(/^## \[\d{4}-\d{2}-\d{2}/gm);
      count += matches ? matches.length : 0;
    } catch {
      // ignore
    }
  }

  // Check PRD-N directories
  try {
    const entries = fs.readdirSync(ralphDir);
    for (const entry of entries) {
      if (entry.startsWith("PRD-")) {
        const progressPath = path.join(ralphDir, entry, "progress.md");
        if (fs.existsSync(progressPath)) {
          try {
            const content = fs.readFileSync(progressPath, "utf-8");
            const matches = content.match(/^## \[\d{4}-\d{2}-\d{2}/gm);
            count += matches ? matches.length : 0;
          } catch {
            // ignore
          }
        }
      }
    }
  } catch {
    // ignore
  }

  return count;
}

/**
 * Count runs in project's runs directory
 * @param {string} projectPath - Project directory path
 * @returns {Object} - Object with total, success, and failed counts
 */
function countRuns(projectPath) {
  const runsDir = path.join(projectPath, ".ralph", "runs");
  if (!fs.existsSync(runsDir)) {
    return { total: 0, success: 0, failed: 0 };
  }

  try {
    const files = fs.readdirSync(runsDir);
    const summaries = files.filter((f) => f.endsWith(".md"));

    let success = 0;
    let failed = 0;

    for (const summary of summaries) {
      const summaryPath = path.join(runsDir, summary);
      try {
        const content = fs.readFileSync(summaryPath, "utf-8");
        if (content.includes("Status: Success") || content.includes("status: success")) {
          success++;
        } else if (content.includes("Status: Error") || content.includes("status: error")) {
          failed++;
        }
      } catch {
        // ignore
      }
    }

    return {
      total: summaries.length,
      success,
      failed,
    };
  } catch {
    return { total: 0, success: 0, failed: 0 };
  }
}

/**
 * Count evaluations in project's evaluations directory
 * @param {string} projectPath - Project directory path
 * @returns {number} - Number of evaluations found
 */
function countEvaluations(projectPath) {
  const evalDir = path.join(projectPath, ".ralph", "evaluations");
  if (!fs.existsSync(evalDir)) {
    return 0;
  }

  try {
    const files = fs.readdirSync(evalDir);
    return files.filter((f) => f.startsWith("eval-") && f.endsWith(".md")).length;
  } catch {
    return 0;
  }
}

/**
 * Get comprehensive stats for a project
 * @param {string} projectPath - Project directory path
 * @returns {Object} - Stats object
 */
function getProjectStats(projectPath) {
  const guardrailCount = countGuardrails(projectPath);
  const progressCount = countProgressEntries(projectPath);
  const runs = countRuns(projectPath);
  const evaluationCount = countEvaluations(projectPath);

  const successRate = runs.total > 0 ? Math.round((runs.success / runs.total) * 100) : null;

  return {
    guardrailCount,
    progressCount,
    runCount: runs.total,
    successCount: runs.success,
    failedCount: runs.failed,
    evaluationCount,
    successRate,
  };
}

/**
 * Index a project - update its stats and index its knowledge
 * @param {string} projectPath - Project directory path
 * @returns {Object} - Updated project entry
 */
function indexProject(projectPath) {
  const stats = getProjectStats(projectPath);

  // Update project stats in registry
  const updated = updateProject(projectPath, { stats });

  // If project wasn't in registry, it returns null
  if (!updated) {
    return null;
  }

  // Index guardrails for search
  indexGuardrails(projectPath, updated.id);

  // Index progress entries for search
  indexProgress(projectPath, updated.id);

  return updated;
}

/**
 * Extract guardrails from a project and add to search index
 * @param {string} projectPath - Project directory path
 * @param {string} projectId - Project ID for reference
 */
function indexGuardrails(projectPath, projectId) {
  const guardrailsPath = path.join(projectPath, ".ralph", "guardrails.md");
  if (!fs.existsSync(guardrailsPath)) {
    return;
  }

  try {
    const content = fs.readFileSync(guardrailsPath, "utf-8");
    const indexDir = getIndexPath();
    const indexPath = path.join(indexDir, "guardrails.json");

    // Load existing index
    let index = { entries: [] };
    if (fs.existsSync(indexPath)) {
      try {
        index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
      } catch {
        index = { entries: [] };
      }
    }

    // Remove old entries for this project
    index.entries = index.entries.filter((e) => e.projectId !== projectId);

    // Parse guardrails and add to index
    const signRegex = /### Sign: ([^\n]+)\n([\s\S]*?)(?=###|$)/g;
    let match;
    while ((match = signRegex.exec(content)) !== null) {
      const title = match[1].trim();
      const body = match[2].trim();

      // Extract trigger and instruction
      const triggerMatch = body.match(/\*\*Trigger\*\*:\s*(.+)/);
      const instructionMatch = body.match(/\*\*Instruction\*\*:\s*(.+)/);

      index.entries.push({
        projectId,
        type: "guardrail",
        title,
        trigger: triggerMatch ? triggerMatch[1].trim() : "",
        instruction: instructionMatch ? instructionMatch[1].trim() : "",
        content: body,
        indexedAt: new Date().toISOString(),
      });
    }

    // Save index
    index.updatedAt = new Date().toISOString();
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  } catch {
    // ignore indexing errors
  }
}

/**
 * Extract progress entries from a project and add to search index
 * @param {string} projectPath - Project directory path
 * @param {string} projectId - Project ID for reference
 */
function indexProgress(projectPath, projectId) {
  const indexDir = getIndexPath();
  const indexPath = path.join(indexDir, "progress.json");

  // Load existing index
  let index = { entries: [] };
  if (fs.existsSync(indexPath)) {
    try {
      index = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    } catch {
      index = { entries: [] };
    }
  }

  // Remove old entries for this project
  index.entries = index.entries.filter((e) => e.projectId !== projectId);

  // Find all progress.md files
  const ralphDir = path.join(projectPath, ".ralph");
  if (!fs.existsSync(ralphDir)) {
    return;
  }

  const progressFiles = [];

  // Root progress.md
  const rootProgress = path.join(ralphDir, "progress.md");
  if (fs.existsSync(rootProgress)) {
    progressFiles.push(rootProgress);
  }

  // PRD-N progress.md files
  try {
    const entries = fs.readdirSync(ralphDir);
    for (const entry of entries) {
      if (entry.startsWith("PRD-")) {
        const progressPath = path.join(ralphDir, entry, "progress.md");
        if (fs.existsSync(progressPath)) {
          progressFiles.push(progressPath);
        }
      }
    }
  } catch {
    // ignore
  }

  // Parse each progress file
  for (const progressFile of progressFiles) {
    try {
      const content = fs.readFileSync(progressFile, "utf-8");

      // Match progress entries
      const entryRegex = /## \[([^\]]+)\] - (US-\d+):\s*([^\n]+)\n([\s\S]*?)(?=## \[|---\n*$|$)/g;
      let match;
      while ((match = entryRegex.exec(content)) !== null) {
        const dateTime = match[1].trim();
        const storyId = match[2].trim();
        const title = match[3].trim();
        const body = match[4].trim();

        // Extract learnings
        const learningsMatch = body.match(
          /\*\*Learnings for future iterations:\*\*\n([\s\S]*?)(?=---|\n\n##|$)/
        );
        const learnings = learningsMatch ? learningsMatch[1].trim() : "";

        index.entries.push({
          projectId,
          type: "progress",
          dateTime,
          storyId,
          title,
          learnings,
          content: body,
          source: progressFile,
          indexedAt: new Date().toISOString(),
        });
      }
    } catch {
      // ignore
    }
  }

  // Save index
  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

module.exports = {
  countGuardrails,
  countProgressEntries,
  countRuns,
  countEvaluations,
  getProjectStats,
  indexProject,
  indexGuardrails,
  indexProgress,
};
