/**
 * Search index builder
 *
 * Builds and maintains a unified search index from all registered projects.
 * Indexes: guardrails, progress logs, evaluations, run summaries
 */
const fs = require("fs");
const path = require("path");
const { getIndexPath, ensureGlobalRegistry } = require("../registry/structure");
const { loadRegistry } = require("../registry/projects");

/**
 * Get the unified search index path
 * @returns {string}
 */
function getSearchIndexPath() {
  return path.join(getIndexPath(), "search.json");
}

/**
 * Load the search index from disk
 * @returns {Object} - Index object with entries array
 */
function loadSearchIndex() {
  ensureGlobalRegistry();
  const indexPath = getSearchIndexPath();

  try {
    if (fs.existsSync(indexPath)) {
      const content = fs.readFileSync(indexPath, "utf-8");
      return JSON.parse(content);
    }
  } catch {
    // ignore
  }

  return {
    version: "1.0.0",
    entries: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Save the search index to disk
 * @param {Object} index - Index object
 */
function saveSearchIndex(index) {
  ensureGlobalRegistry();
  const indexPath = getSearchIndexPath();

  index.updatedAt = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Extract guardrails from a project
 * @param {string} projectPath - Project directory path
 * @param {Object} project - Project metadata
 * @returns {Object[]} - Array of search entries
 */
function extractGuardrails(projectPath, project) {
  const entries = [];
  const guardrailsPath = path.join(projectPath, ".ralph", "guardrails.md");

  if (!fs.existsSync(guardrailsPath)) {
    return entries;
  }

  try {
    const content = fs.readFileSync(guardrailsPath, "utf-8");
    const mtime = fs.statSync(guardrailsPath).mtime;

    // Parse guardrails (### Sign: patterns)
    const signRegex = /### Sign: ([^\n]+)\n([\s\S]*?)(?=###|$)/g;
    let match;
    while ((match = signRegex.exec(content)) !== null) {
      const title = match[1].trim();
      const body = match[2].trim();

      // Extract trigger and instruction
      const triggerMatch = body.match(/\*\*Trigger\*\*:\s*(.+)/);
      const instructionMatch = body.match(/\*\*Instruction\*\*:\s*(.+)/);
      const addedAfterMatch = body.match(/\*\*Added after\*\*:\s*(.+)/);

      entries.push({
        id: `${project.id}-guardrail-${entries.length}`,
        projectId: project.id,
        projectName: project.name,
        projectPath: project.path,
        type: "guardrail",
        title,
        trigger: triggerMatch ? triggerMatch[1].trim() : "",
        instruction: instructionMatch ? instructionMatch[1].trim() : "",
        addedAfter: addedAfterMatch ? addedAfterMatch[1].trim() : "",
        content: body,
        searchableText: `${title} ${body}`.toLowerCase(),
        source: guardrailsPath,
        modifiedAt: mtime.toISOString(),
        indexedAt: new Date().toISOString(),
      });
    }
  } catch {
    // ignore
  }

  return entries;
}

/**
 * Extract progress entries from a project
 * @param {string} projectPath - Project directory path
 * @param {Object} project - Project metadata
 * @returns {Object[]} - Array of search entries
 */
function extractProgress(projectPath, project) {
  const entries = [];
  const ralphDir = path.join(projectPath, ".ralph");

  if (!fs.existsSync(ralphDir)) {
    return entries;
  }

  const progressFiles = [];

  // Root progress.md
  const rootProgress = path.join(ralphDir, "progress.md");
  if (fs.existsSync(rootProgress)) {
    progressFiles.push(rootProgress);
  }

  // PRD-N progress.md files
  try {
    const dirs = fs.readdirSync(ralphDir);
    for (const dir of dirs) {
      if (dir.startsWith("PRD-")) {
        const progressPath = path.join(ralphDir, dir, "progress.md");
        if (fs.existsSync(progressPath)) {
          progressFiles.push(progressPath);
        }
      }
    }
  } catch {
    // ignore
  }

  for (const progressFile of progressFiles) {
    try {
      const content = fs.readFileSync(progressFile, "utf-8");
      const mtime = fs.statSync(progressFile).mtime;

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

        // Parse date
        let entryDate = null;
        try {
          // Expected format: YYYY-MM-DD HH:MM:SS or similar
          const dateParts = dateTime.match(/(\d{4})-(\d{2})-(\d{2})/);
          if (dateParts) {
            entryDate = new Date(dateParts[0]).toISOString();
          }
        } catch {
          // ignore
        }

        entries.push({
          id: `${project.id}-progress-${entries.length}`,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          type: "progress",
          title: `${storyId}: ${title}`,
          storyId,
          dateTime,
          entryDate,
          learnings,
          content: body,
          searchableText: `${storyId} ${title} ${body}`.toLowerCase(),
          source: progressFile,
          modifiedAt: mtime.toISOString(),
          indexedAt: new Date().toISOString(),
        });
      }
    } catch {
      // ignore
    }
  }

  return entries;
}

/**
 * Extract evaluations from a project
 * @param {string} projectPath - Project directory path
 * @param {Object} project - Project metadata
 * @returns {Object[]} - Array of search entries
 */
function extractEvaluations(projectPath, project) {
  const entries = [];
  const evalDir = path.join(projectPath, ".ralph", "evaluations");

  if (!fs.existsSync(evalDir)) {
    return entries;
  }

  try {
    const files = fs.readdirSync(evalDir);
    for (const file of files) {
      if (!file.startsWith("eval-") || !file.endsWith(".md")) {
        continue;
      }

      const evalPath = path.join(evalDir, file);
      try {
        const content = fs.readFileSync(evalPath, "utf-8");
        const mtime = fs.statSync(evalPath).mtime;

        // Extract run ID from filename
        const runId = file.replace("eval-", "").replace(".md", "");

        // Extract grade and score
        const gradeMatch = content.match(/Grade:\s*([A-F][+-]?)/);
        const scoreMatch = content.match(/Score:\s*(\d+)\/100/);
        const statusMatch = content.match(/Status:\s*(\w+)/);

        // Extract recommendations
        const recsMatch = content.match(/## Recommendations\n([\s\S]*?)(?=##|$)/);
        const recommendations = recsMatch ? recsMatch[1].trim() : "";

        entries.push({
          id: `${project.id}-evaluation-${runId}`,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          type: "evaluation",
          title: `Evaluation: ${runId}`,
          runId,
          grade: gradeMatch ? gradeMatch[1] : null,
          score: scoreMatch ? parseInt(scoreMatch[1], 10) : null,
          status: statusMatch ? statusMatch[1].toLowerCase() : null,
          recommendations,
          content,
          searchableText: `evaluation ${runId} ${content}`.toLowerCase(),
          source: evalPath,
          modifiedAt: mtime.toISOString(),
          indexedAt: new Date().toISOString(),
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return entries;
}

/**
 * Extract run summaries from a project
 * @param {string} projectPath - Project directory path
 * @param {Object} project - Project metadata
 * @returns {Object[]} - Array of search entries
 */
function extractRunSummaries(projectPath, project) {
  const entries = [];
  const runsDir = path.join(projectPath, ".ralph", "runs");

  if (!fs.existsSync(runsDir)) {
    return entries;
  }

  try {
    const files = fs.readdirSync(runsDir);
    for (const file of files) {
      if (!file.startsWith("run-") || !file.endsWith(".md")) {
        continue;
      }

      const runPath = path.join(runsDir, file);
      try {
        const content = fs.readFileSync(runPath, "utf-8");
        const mtime = fs.statSync(runPath).mtime;

        // Extract run ID from filename
        const runId = file.replace("run-", "").replace(".md", "");

        // Extract status
        const statusMatch = content.match(/[Ss]tatus:\s*(\w+)/);
        const storyMatch = content.match(/[Ss]tory:\s*(US-\d+[^\n]*)/);
        const modeMatch = content.match(/[Mm]ode:\s*(\w+)/);

        entries.push({
          id: `${project.id}-run-${runId}`,
          projectId: project.id,
          projectName: project.name,
          projectPath: project.path,
          type: "run",
          title: `Run: ${runId}`,
          runId,
          status: statusMatch ? statusMatch[1].toLowerCase() : null,
          story: storyMatch ? storyMatch[1].trim() : null,
          mode: modeMatch ? modeMatch[1].toLowerCase() : null,
          content,
          searchableText: `run ${runId} ${content}`.toLowerCase(),
          source: runPath,
          modifiedAt: mtime.toISOString(),
          indexedAt: new Date().toISOString(),
        });
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }

  return entries;
}

/**
 * Build or rebuild the search index for all registered projects
 * @param {Object} options - Build options
 * @param {string[]} options.types - Types to index (default: all)
 * @returns {Object} - Index statistics
 */
function buildIndex(options = {}) {
  const registry = loadRegistry();
  const types = options.types || ["guardrail", "progress", "evaluation", "run"];

  const index = {
    version: "1.0.0",
    entries: [],
    stats: {
      projects: 0,
      guardrails: 0,
      progress: 0,
      evaluations: 0,
      runs: 0,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  for (const project of registry.projects) {
    if (!fs.existsSync(project.path)) {
      continue;
    }

    index.stats.projects++;

    if (types.includes("guardrail")) {
      const guardrails = extractGuardrails(project.path, project);
      index.entries.push(...guardrails);
      index.stats.guardrails += guardrails.length;
    }

    if (types.includes("progress")) {
      const progress = extractProgress(project.path, project);
      index.entries.push(...progress);
      index.stats.progress += progress.length;
    }

    if (types.includes("evaluation")) {
      const evaluations = extractEvaluations(project.path, project);
      index.entries.push(...evaluations);
      index.stats.evaluations += evaluations.length;
    }

    if (types.includes("run")) {
      const runs = extractRunSummaries(project.path, project);
      index.entries.push(...runs);
      index.stats.runs += runs.length;
    }
  }

  saveSearchIndex(index);
  return index.stats;
}

/**
 * Update the index for a single project
 * @param {string} projectPath - Project directory path
 * @returns {Object} - Updated entry counts
 */
function indexSingleProject(projectPath) {
  const registry = loadRegistry();
  const project = registry.projects.find((p) => p.path === projectPath);

  if (!project) {
    return null;
  }

  const index = loadSearchIndex();

  // Remove old entries for this project
  index.entries = index.entries.filter((e) => e.projectId !== project.id);

  // Add new entries
  const guardrails = extractGuardrails(projectPath, project);
  const progress = extractProgress(projectPath, project);
  const evaluations = extractEvaluations(projectPath, project);
  const runs = extractRunSummaries(projectPath, project);

  index.entries.push(...guardrails, ...progress, ...evaluations, ...runs);

  saveSearchIndex(index);

  return {
    guardrails: guardrails.length,
    progress: progress.length,
    evaluations: evaluations.length,
    runs: runs.length,
    total: guardrails.length + progress.length + evaluations.length + runs.length,
  };
}

module.exports = {
  getSearchIndexPath,
  loadSearchIndex,
  saveSearchIndex,
  extractGuardrails,
  extractProgress,
  extractEvaluations,
  extractRunSummaries,
  buildIndex,
  indexSingleProject,
};
