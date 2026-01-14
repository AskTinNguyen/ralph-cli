/**
 * Main Parallel Orchestrator Module
 *
 * Coordinates parallel story execution using subagents.
 * Entry point for `ralph build N --parallel=M`.
 *
 * Workflow: analyze → batch → execute → merge → commit
 *
 * Error Handling:
 * - Automatic retry for failed subagents (once before marking as failed)
 * - Sequential fallback when merge conflicts cannot be resolved
 * - Preserve successful commits when some stories fail
 * - Log all errors to errors.log
 */
const fs = require("fs");
const path = require("path");
const { parseStories, buildDependencyGraph, getBatches } = require("./analyzer");
const { executeParallel, logError } = require("./executor");
const { detectConflicts, resolveConflicts } = require("./merger");
const { commitStoriesSequentially, sortResultsByStoryId } = require("./committer");

/**
 * Execute conflicting stories sequentially after merge failure
 *
 * This is the fallback mechanism when AI merge cannot resolve conflicts.
 * Stories are re-executed one at a time in order.
 *
 * @param {Array} storyIds - Array of story IDs that had conflicts
 * @param {Array} allStories - All parsed stories
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Results of sequential execution
 */
async function executeConflictingStoriesSequentially(storyIds, allStories, options) {
  const results = [];

  for (const storyId of storyIds) {
    const story = allStories.find((s) => s.id === storyId);
    if (!story) {
      results.push({
        storyId,
        status: "failed",
        error: `Story ${storyId} not found in stories list`,
        filesModified: [],
        potentialConflicts: [],
        executionMode: "sequential-fallback",
      });
      continue;
    }

    console.log(`[parallel] Executing ${storyId} sequentially...`);

    try {
      // Execute single story with maxConcurrency=1 (sequential)
      const singleResult = await executeParallel([story], {
        ...options,
        maxConcurrency: 1,
        maxRetries: 0, // Don't retry in sequential fallback
      });

      if (singleResult.length > 0) {
        results.push({
          ...singleResult[0],
          executionMode: "sequential-fallback",
        });
      }
    } catch (err) {
      results.push({
        storyId,
        status: "failed",
        error: `Sequential execution failed: ${err.message}`,
        filesModified: [],
        potentialConflicts: [],
        executionMode: "sequential-fallback",
      });
    }
  }

  return { results };
}

/**
 * Run parallel story execution
 *
 * @param {Object} options - Run options
 * @param {string} options.prdPath - Path to PRD file
 * @param {string} options.planPath - Path to plan file
 * @param {string} options.progressPath - Path to progress file
 * @param {string} options.guardrailsPath - Path to guardrails file
 * @param {string} options.errorsLogPath - Path to errors log
 * @param {string} options.activityLogPath - Path to activity log
 * @param {string} options.repoRoot - Repository root directory
 * @param {number} options.maxConcurrency - Max concurrent agents (default: 3)
 * @param {number} options.maxIterations - Max stories to process (default: all)
 * @param {boolean} options.noCommit - Skip commits (dry run mode)
 * @param {string} options.agentCmd - Agent command template
 * @param {string} options.runId - Run ID for tracking
 * @param {string} options.promptTemplate - Path to parallel prompt template
 * @param {number} options.timeout - Timeout per agent in ms (default: 600000)
 * @returns {Promise<Object>} Run result with status, commits, and failures
 */
async function runParallel(options = {}) {
  const {
    prdPath,
    planPath,
    progressPath,
    guardrailsPath,
    errorsLogPath,
    activityLogPath,
    repoRoot,
    maxConcurrency = 3,
    maxIterations = Infinity,
    noCommit = false,
    agentCmd,
    runId,
    promptTemplate,
    timeout = 600000,
  } = options;

  // Validate required paths
  if (!prdPath || !fs.existsSync(prdPath)) {
    return {
      success: false,
      error: `PRD not found: ${prdPath}`,
      commits: [],
      failures: [],
      batches: [],
    };
  }

  if (!planPath || !fs.existsSync(planPath)) {
    return {
      success: false,
      error: `Plan not found: ${planPath}`,
      commits: [],
      failures: [],
      batches: [],
    };
  }

  if (!repoRoot) {
    return {
      success: false,
      error: "repoRoot is required",
      commits: [],
      failures: [],
      batches: [],
    };
  }

  const result = {
    success: true,
    commits: [],
    failures: [],
    batches: [],
    mergeResults: [],
    totalStories: 0,
    processedStories: 0,
    startTime: Date.now(),
    endTime: null,
  };

  try {
    // Step 1: Analyze PRD and extract stories
    console.log("\n[parallel] Analyzing PRD and building dependency graph...");
    const stories = parseStories(prdPath);
    const graph = buildDependencyGraph(stories);
    const batches = getBatches(graph, stories);

    result.totalStories = stories.filter((s) => s.status.toLowerCase() !== "x").length;

    if (batches.length === 0) {
      console.log("[parallel] No incomplete stories found.");
      return {
        ...result,
        success: true,
        message: "No incomplete stories to process",
      };
    }

    console.log(`[parallel] Found ${result.totalStories} incomplete stories in ${batches.length} batches`);
    for (let i = 0; i < batches.length; i++) {
      console.log(`  Batch ${i + 1}: ${batches[i].join(", ")}`);
    }
    result.batches = batches;

    // Step 2: Process batches
    let storiesProcessed = 0;
    const allResults = [];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];

      // Check iteration limit
      if (storiesProcessed >= maxIterations) {
        console.log(`[parallel] Reached max iterations (${maxIterations}). Stopping.`);
        break;
      }

      // Limit batch size to remaining iterations
      const remainingIterations = maxIterations - storiesProcessed;
      const storiesToProcess = batch.slice(0, remainingIterations);

      console.log(`\n[parallel] Processing batch ${batchIndex + 1}/${batches.length}: ${storiesToProcess.join(", ")}`);

      // Get story objects for this batch
      const batchStories = storiesToProcess
        .map((id) => stories.find((s) => s.id === id))
        .filter(Boolean);

      // Execute stories in parallel
      const batchResults = await executeParallel(batchStories, {
        maxConcurrency,
        timeout,
        agentCmd,
        prdPath,
        planPath,
        progressPath,
        guardrailsPath,
        errorsLogPath,
        activityLogPath,
        repoRoot,
        runId,
        promptTemplate,
      });

      console.log(`[parallel] Batch ${batchIndex + 1} complete: ${batchResults.length} stories executed`);

      // Track results
      allResults.push(...batchResults);
      storiesProcessed += batchResults.length;

      // Log individual results
      for (const res of batchResults) {
        if (res.status === "success") {
          console.log(`  - ${res.storyId}: SUCCESS (${res.filesModified.length} files)`);
        } else {
          console.log(`  - ${res.storyId}: FAILED - ${res.error}`);
          result.failures.push({
            storyId: res.storyId,
            error: res.error,
            batch: batchIndex + 1,
          });
        }
      }

      // Step 3: Detect and resolve conflicts
      const conflicts = detectConflicts(batchResults);
      if (conflicts.conflictedFiles.length > 0) {
        console.log(`\n[parallel] Detected ${conflicts.conflictedFiles.length} file conflicts, resolving...`);

        const mergeResult = await resolveConflicts(batchResults, {
          agentCmd,
          repoRoot,
          timeout: 300000, // 5 minute timeout for merges
        });

        result.mergeResults.push({
          batch: batchIndex + 1,
          ...mergeResult,
        });

        if (mergeResult.failed.length > 0) {
          console.log(`[parallel] ${mergeResult.failed.length} merge conflicts could not be resolved`);

          // Fall back to sequential execution for conflicting stories
          console.log(`[parallel] Falling back to sequential execution for conflicting stories...`);

          for (const fail of mergeResult.failed) {
            // Find stories involved in this conflict
            const conflictingStories = fail.stories || [];

            // Log the merge failure to errors.log
            logError(
              errorsLogPath,
              `merge-${fail.file}`,
              `Merge conflict on ${fail.file} between stories ${conflictingStories.join(", ")}: ${fail.error}`,
              0
            );

            // Re-execute conflicting stories sequentially
            if (conflictingStories.length > 0) {
              console.log(`[parallel] Re-executing stories ${conflictingStories.join(", ")} sequentially...`);

              const sequentialResult = await executeConflictingStoriesSequentially(
                conflictingStories,
                stories,
                {
                  timeout,
                  agentCmd,
                  prdPath,
                  planPath,
                  progressPath,
                  guardrailsPath,
                  errorsLogPath,
                  activityLogPath,
                  repoRoot,
                  runId,
                  promptTemplate,
                }
              );

              // Update batch results with sequential execution results
              for (const seqResult of sequentialResult.results) {
                // Find and replace the original result
                const existingIndex = batchResults.findIndex(
                  (r) => r.storyId === seqResult.storyId
                );
                if (existingIndex >= 0) {
                  batchResults[existingIndex] = seqResult;
                }

                if (seqResult.status === "success") {
                  console.log(`  - ${seqResult.storyId}: SUCCESS (sequential)`);
                } else {
                  console.log(`  - ${seqResult.storyId}: FAILED (sequential) - ${seqResult.error}`);
                  result.failures.push({
                    storyId: seqResult.storyId,
                    error: seqResult.error || "Sequential execution failed",
                    batch: batchIndex + 1,
                    fallback: "sequential",
                  });
                }
              }
            } else {
              // No stories to re-execute, just log the failure
              result.failures.push({
                storyId: `merge-${fail.file}`,
                error: fail.error,
                batch: batchIndex + 1,
              });
            }
          }
        }
      }

      // Step 4: Commit stories in order
      if (!noCommit) {
        console.log(`\n[parallel] Committing stories in order...`);

        const commitResult = await commitStoriesSequentially(batchResults, {
          prdPath,
          progressPath,
          repoRoot,
          noCommit: false,
        });

        // Track committed stories
        for (const commit of commitResult.committed) {
          result.commits.push({
            storyId: commit.storyId,
            hash: commit.hash,
            subject: commit.subject,
            batch: batchIndex + 1,
          });
          console.log(`  - ${commit.storyId}: ${commit.hash} ${commit.subject}`);
        }

        // Track failed commits
        for (const fail of commitResult.failed) {
          result.failures.push({
            storyId: fail.storyId,
            error: fail.error || "Commit failed",
            batch: batchIndex + 1,
          });
        }
      } else {
        console.log(`\n[parallel] Skipping commits (--no-commit mode)`);
      }
    }

    result.processedStories = storiesProcessed;
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;

    // Determine final status
    if (result.failures.length > 0) {
      result.success = result.commits.length > 0;
      result.status = result.commits.length > 0 ? "partial" : "failed";
    } else {
      result.status = "success";
    }

    console.log(`\n[parallel] Complete!`);
    console.log(`  Stories processed: ${result.processedStories}/${result.totalStories}`);
    console.log(`  Commits: ${result.commits.length}`);
    console.log(`  Failures: ${result.failures.length}`);
    console.log(`  Duration: ${Math.round(result.duration / 1000)}s`);

    return result;
  } catch (err) {
    result.success = false;
    result.error = err.message;
    result.endTime = Date.now();
    result.duration = result.endTime - result.startTime;
    console.error(`[parallel] Error: ${err.message}`);
    return result;
  }
}

/**
 * Format run result as markdown
 *
 * @param {Object} result - Run result from runParallel
 * @returns {string} Markdown formatted report
 */
function formatResultMarkdown(result) {
  const lines = [
    "# Parallel Execution Report",
    "",
    `**Status:** ${result.status || (result.success ? "success" : "failed")}`,
    `**Duration:** ${Math.round((result.duration || 0) / 1000)}s`,
    `**Stories:** ${result.processedStories}/${result.totalStories}`,
    `**Commits:** ${result.commits.length}`,
    `**Failures:** ${result.failures.length}`,
    "",
  ];

  if (result.batches && result.batches.length > 0) {
    lines.push("## Batches", "");
    for (let i = 0; i < result.batches.length; i++) {
      lines.push(`- Batch ${i + 1}: ${result.batches[i].join(", ")}`);
    }
    lines.push("");
  }

  if (result.commits.length > 0) {
    lines.push("## Commits", "");
    lines.push("");
    lines.push("| Story | Hash | Message |");
    lines.push("|-------|------|---------|");
    for (const commit of result.commits) {
      lines.push(`| ${commit.storyId || "N/A"} | \`${commit.hash}\` | ${commit.subject} |`);
    }
    lines.push("");
  }

  if (result.failures.length > 0) {
    lines.push("## Failures", "");
    lines.push("");
    lines.push("The following stories failed during execution:");
    lines.push("");

    // Group failures by type for clearer reporting
    const executionFailures = result.failures.filter((f) => !f.storyId.startsWith("merge-"));
    const mergeFailures = result.failures.filter((f) => f.storyId.startsWith("merge-"));

    if (executionFailures.length > 0) {
      lines.push("### Execution Failures", "");
      for (const fail of executionFailures) {
        const fallbackNote = fail.fallback ? ` (after ${fail.fallback} fallback)` : "";
        lines.push(`- **${fail.storyId}**${fallbackNote}:`);
        lines.push(`  - Batch: ${fail.batch || "N/A"}`);
        lines.push(`  - Error: ${fail.error}`);
        lines.push("");
      }
    }

    if (mergeFailures.length > 0) {
      lines.push("### Merge Failures", "");
      for (const fail of mergeFailures) {
        lines.push(`- **${fail.storyId.replace("merge-", "")}**:`);
        lines.push(`  - Batch: ${fail.batch || "N/A"}`);
        lines.push(`  - Error: ${fail.error}`);
        lines.push("");
      }
    }
  }

  if (result.mergeResults && result.mergeResults.length > 0) {
    const totalResolved = result.mergeResults.reduce((sum, m) => sum + (m.resolved?.length || 0), 0);
    const totalFailed = result.mergeResults.reduce((sum, m) => sum + (m.failed?.length || 0), 0);

    if (totalResolved > 0 || totalFailed > 0) {
      lines.push("## Merge Summary", "");
      lines.push(`- Conflicts resolved: ${totalResolved}`);
      lines.push(`- Conflicts failed: ${totalFailed}`);
      lines.push("");
    }
  }

  if (result.error) {
    lines.push("## Error", "", `\`\`\``, result.error, `\`\`\``, "");
  }

  // Add troubleshooting hints if there were failures
  if (result.failures.length > 0) {
    lines.push("## Troubleshooting", "");
    lines.push("- Check `errors.log` for detailed error information");
    lines.push("- Try running failed stories sequentially: `ralph build 1 --prd=N`");
    lines.push("- For merge conflicts, consider reducing `--parallel` concurrency");
    lines.push("");
  }

  return lines.join("\n");
}

module.exports = {
  runParallel,
  formatResultMarkdown,
  executeConflictingStoriesSequentially,
  // Re-export submodules for convenience
  parseStories,
  buildDependencyGraph,
  getBatches,
  executeParallel,
  detectConflicts,
  resolveConflicts,
  commitStoriesSequentially,
  sortResultsByStoryId,
  logError,
};
