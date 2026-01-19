/**
 * Historical Log Indexer
 *
 * Parses run-*.md summary files into structured data for historical context.
 * These summaries are already created by the Ralph build loop and contain
 * structured information about each iteration's results.
 */
const fs = require("fs");
const path = require("path");

/**
 * Parse a single run summary markdown file into structured data
 * @param {string} runSummaryPath - Path to run-*.md file
 * @returns {Object|null} Parsed run data or null if parsing fails
 */
function indexRun(runSummaryPath) {
  try {
    if (!fs.existsSync(runSummaryPath)) {
      return null;
    }

    const content = fs.readFileSync(runSummaryPath, "utf8");
    const run = {
      path: runSummaryPath,
      runId: null,
      iteration: null,
      mode: null,
      storyId: null,
      storyTitle: null,
      started: null,
      ended: null,
      duration: null,
      status: null,
      logPath: null,
      gitHeadBefore: null,
      gitHeadAfter: null,
      commits: [],
      changedFiles: [],
      uncommittedChanges: [],
      tokens: {
        input: null,
        output: null,
        total: null,
        model: null,
      },
      retryCount: 0,
      routingDecision: null,
      costEstimate: null,
      costActual: null,
    };

    // Parse metadata section (- Key: Value format)
    const metadataRegex = /^- (.+?):\s*(.+)$/gm;
    let match;
    while ((match = metadataRegex.exec(content)) !== null) {
      const [, key, value] = match;
      switch (key.toLowerCase()) {
        case "run id":
          run.runId = value.trim();
          break;
        case "iteration":
          run.iteration = parseInt(value.trim(), 10);
          break;
        case "mode":
          run.mode = value.trim();
          break;
        case "story":
          // Format: "US-001: Story title"
          const storyMatch = value.match(/^(US-\d+):\s*(.+)$/i);
          if (storyMatch) {
            run.storyId = storyMatch[1].toUpperCase();
            run.storyTitle = storyMatch[2].trim();
          } else {
            run.storyTitle = value.trim();
          }
          break;
        case "started":
          run.started = value.trim();
          break;
        case "ended":
          run.ended = value.trim();
          break;
        case "duration":
          run.duration = parseInt(value.replace(/s$/, "").trim(), 10);
          break;
        case "status":
          run.status = value.trim().toLowerCase();
          break;
        case "log":
          run.logPath = value.trim();
          break;
        case "head (before)":
          run.gitHeadBefore = value.trim();
          break;
        case "head (after)":
          run.gitHeadAfter = value.trim();
          break;
        case "input tokens":
          run.tokens.input = parseInt(value.trim(), 10);
          break;
        case "output tokens":
          run.tokens.output = parseInt(value.trim(), 10);
          break;
        case "total tokens":
          run.tokens.total = parseInt(value.trim(), 10);
          break;
        case "model":
          run.tokens.model = value.trim();
          break;
        case "retry count":
          run.retryCount = parseInt(value.trim(), 10) || 0;
          break;
      }
    }

    // Parse commits section
    const commitsSection = content.match(/### Commits\n([\s\S]*?)(?=\n###|$)/);
    if (commitsSection) {
      const commitRegex = /^- ([a-f0-9]+)\s+(.+)$/gm;
      let commitMatch;
      while ((commitMatch = commitRegex.exec(commitsSection[1])) !== null) {
        if (commitMatch[1] !== "(none)") {
          run.commits.push({
            hash: commitMatch[1],
            message: commitMatch[2].trim(),
          });
        }
      }
    }

    // Parse changed files section
    const changedSection = content.match(/### Changed Files \(commits\)\n([\s\S]*?)(?=\n###|$)/);
    if (changedSection) {
      const fileRegex = /^- (.+)$/gm;
      let fileMatch;
      while ((fileMatch = fileRegex.exec(changedSection[1])) !== null) {
        if (fileMatch[1] !== "(none)") {
          run.changedFiles.push(fileMatch[1].trim());
        }
      }
    }

    // Parse uncommitted changes section
    const uncommittedSection = content.match(/### Uncommitted Changes\n([\s\S]*?)(?=\n##|$)/);
    if (uncommittedSection) {
      const fileRegex = /^- (.+)$/gm;
      let fileMatch;
      while ((fileMatch = fileRegex.exec(uncommittedSection[1])) !== null) {
        if (fileMatch[1] !== "(none)") {
          run.uncommittedChanges.push(fileMatch[1].trim());
        }
      }
    }

    // Parse routing decision
    const routingSection = content.match(/## Routing Decision\n([\s\S]*?)(?=\n##|$)/);
    if (routingSection) {
      const modelMatch = routingSection[1].match(/- Model:\s*(.+)/);
      const scoreMatch = routingSection[1].match(/- Complexity score:\s*([0-9.]+)/);
      const reasonMatch = routingSection[1].match(/- Reason:\s*(.+)/);
      if (modelMatch || scoreMatch) {
        run.routingDecision = {
          model: modelMatch ? modelMatch[1].trim() : null,
          complexityScore: scoreMatch ? parseFloat(scoreMatch[1]) : null,
          reason: reasonMatch ? reasonMatch[1].trim() : null,
        };
      }
    }

    // Parse cost information
    const costSection = content.match(/## Cost Estimate vs Actual\n([\s\S]*?)(?=\n##|$)/);
    if (costSection) {
      const estimatedMatch = costSection[1].match(/- Estimated cost:\s*\$([0-9.]+)/);
      const actualMatch = costSection[1].match(/- Actual cost:\s*\$([0-9.]+)/);
      if (estimatedMatch) {
        run.costEstimate = parseFloat(estimatedMatch[1]);
      }
      if (actualMatch) {
        run.costActual = parseFloat(actualMatch[1]);
      }
    }

    return run;
  } catch (err) {
    // Return null on any parsing error
    return null;
  }
}

/**
 * Build an index of all runs in a PRD folder
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {Object} options - Options for indexing
 * @param {number} options.maxRuns - Maximum number of runs to index (default: 50)
 * @returns {Object} Index with runs array and byStory mapping
 */
function buildIndex(prdFolder, options = {}) {
  const { maxRuns = 50 } = options;

  const index = {
    prdFolder,
    runs: [],
    byStory: {},
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    lastUpdated: new Date().toISOString(),
  };

  try {
    const runsDir = path.join(prdFolder, "runs");
    if (!fs.existsSync(runsDir)) {
      return index;
    }

    // Get all run summary files, sorted by modification time (newest first)
    const runFiles = fs.readdirSync(runsDir)
      .filter((f) => /^run-.*\.md$/.test(f))
      .map((f) => ({
        name: f,
        path: path.join(runsDir, f),
        mtime: fs.statSync(path.join(runsDir, f)).mtimeMs,
      }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, maxRuns);

    for (const file of runFiles) {
      const run = indexRun(file.path);
      if (run) {
        index.runs.push(run);
        index.totalRuns++;

        if (run.status === "success") {
          index.successfulRuns++;
        } else if (run.status === "error" || run.status === "failure" || run.status === "failed") {
          index.failedRuns++;
        }

        // Index by story
        if (run.storyId) {
          if (!index.byStory[run.storyId]) {
            index.byStory[run.storyId] = [];
          }
          index.byStory[run.storyId].push(run);
        }
      }
    }
  } catch (err) {
    // Return partial index on error
    index.error = err.message;
  }

  return index;
}

/**
 * Get runs for a specific story
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {string} storyId - Story ID (e.g., "US-001")
 * @param {Object} options - Options
 * @param {number} options.maxRuns - Maximum runs to return
 * @returns {Array} Array of run objects for the story
 */
function getRunsForStory(prdFolder, storyId, options = {}) {
  const index = buildIndex(prdFolder, options);
  const normalizedStoryId = storyId.toUpperCase();
  return index.byStory[normalizedStoryId] || [];
}

/**
 * Get failed runs, optionally filtered by story
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {string} storyId - Optional story ID to filter by
 * @param {Object} options - Options
 * @returns {Array} Array of failed run objects
 */
function getFailedRuns(prdFolder, storyId = null, options = {}) {
  const index = buildIndex(prdFolder, options);
  let runs = index.runs.filter((r) =>
    r.status === "error" || r.status === "failure" || r.status === "failed"
  );

  if (storyId) {
    const normalizedStoryId = storyId.toUpperCase();
    runs = runs.filter((r) => r.storyId === normalizedStoryId);
  }

  return runs;
}

/**
 * Get successful runs, optionally filtered by story
 * @param {string} prdFolder - Path to PRD-N folder
 * @param {string} storyId - Optional story ID to filter by
 * @param {Object} options - Options
 * @returns {Array} Array of successful run objects
 */
function getSuccessfulRuns(prdFolder, storyId = null, options = {}) {
  const index = buildIndex(prdFolder, options);
  let runs = index.runs.filter((r) => r.status === "success");

  if (storyId) {
    const normalizedStoryId = storyId.toUpperCase();
    runs = runs.filter((r) => r.storyId === normalizedStoryId);
  }

  return runs;
}

module.exports = {
  indexRun,
  buildIndex,
  getRunsForStory,
  getFailedRuns,
  getSuccessfulRuns,
};
