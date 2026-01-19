#!/usr/bin/env node
/**
 * Historical Context CLI
 *
 * Generates markdown context from historical run logs for injection into
 * the build prompt. This helps agents learn from previous iterations and
 * avoid repeating failed approaches.
 *
 * Usage:
 *   node context-cli.js --prd-folder <path> --story-id <id> --mode <mode> --token-budget <n>
 *
 * Modes:
 *   - off: No historical context (returns empty string)
 *   - smart: Focused context on failures and current story (recommended)
 *   - full: Complete historical context for all runs
 */
const { buildIndex, getRunsForStory, getFailedRuns } = require("./indexer");

// Default configuration
const DEFAULT_TOKEN_BUDGET = 4000;
const DEFAULT_MAX_RUNS = 10;
const TOKENS_PER_CHAR = 0.25; // Rough estimate: 4 chars per token

/**
 * Estimate token count for a string
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
function estimateTokens(text) {
  return Math.ceil(text.length * TOKENS_PER_CHAR);
}

/**
 * Score a run for relevance to the current context
 * Higher scores = more relevant
 * @param {Object} run - Run object from indexer
 * @param {string} currentStoryId - The story being worked on
 * @returns {number} Relevance score
 */
function scoreRun(run, currentStoryId) {
  let score = 0;

  // Same story: highest priority
  if (run.storyId && run.storyId === currentStoryId) {
    score += 10;
  }

  // Failures are more valuable for learning
  if (run.status === "error" || run.status === "failure" || run.status === "failed") {
    score += 8;
  }

  // Recent runs are more relevant (decay based on iteration)
  if (run.iteration) {
    score += Math.max(0, 5 - Math.floor(run.iteration / 3));
  }

  // Runs with retries indicate difficulty
  if (run.retryCount && run.retryCount > 0) {
    score += 2;
  }

  return score;
}

/**
 * Format a single run for context output
 * @param {Object} run - Run object from indexer
 * @param {boolean} verbose - Include full details
 * @returns {string} Formatted markdown
 */
function formatRun(run, verbose = false) {
  const lines = [];

  // Header with status indicator
  const statusEmoji = run.status === "success" ? "✅" : "❌";
  lines.push(`### ${statusEmoji} Iteration ${run.iteration}: ${run.storyId || "Unknown"}`);

  // Basic info
  lines.push(`- **Status**: ${run.status}`);
  if (run.storyTitle) {
    lines.push(`- **Story**: ${run.storyTitle}`);
  }
  if (run.duration) {
    lines.push(`- **Duration**: ${run.duration}s`);
  }

  // Commits (important for understanding what was attempted)
  if (run.commits && run.commits.length > 0) {
    lines.push("- **Commits**:");
    for (const commit of run.commits.slice(0, 3)) {
      lines.push(`  - \`${commit.hash}\` ${commit.message}`);
    }
    if (run.commits.length > 3) {
      lines.push(`  - ... and ${run.commits.length - 3} more`);
    }
  }

  // Changed files (helps understand scope)
  if (run.changedFiles && run.changedFiles.length > 0 && verbose) {
    lines.push("- **Files changed**:");
    for (const file of run.changedFiles.slice(0, 5)) {
      lines.push(`  - ${file}`);
    }
    if (run.changedFiles.length > 5) {
      lines.push(`  - ... and ${run.changedFiles.length - 5} more`);
    }
  }

  // Retry info (indicates difficulty)
  if (run.retryCount && run.retryCount > 0) {
    lines.push(`- **Retries**: ${run.retryCount}`);
  }

  // Model/routing info (for context)
  if (run.routingDecision && verbose) {
    lines.push(`- **Model**: ${run.routingDecision.model} (complexity: ${run.routingDecision.complexityScore}/10)`);
  }

  return lines.join("\n");
}

/**
 * Generate smart context focused on failures and current story
 * @param {string} prdFolder - Path to PRD folder
 * @param {string} storyId - Current story ID
 * @param {number} tokenBudget - Maximum tokens for context
 * @returns {string} Markdown context
 */
function generateSmartContext(prdFolder, storyId, tokenBudget) {
  const sections = [];
  let usedTokens = 0;

  // Header
  const header = `> Historical context from previous runs (mode: smart)\n`;
  usedTokens += estimateTokens(header);
  sections.push(header);

  // Get runs for this story (highest priority)
  const storyRuns = getRunsForStory(prdFolder, storyId, { maxRuns: DEFAULT_MAX_RUNS });
  const storyFailures = storyRuns.filter((r) =>
    r.status === "error" || r.status === "failure" || r.status === "failed"
  );

  // Get all failures (for learning from other stories)
  const allFailures = getFailedRuns(prdFolder, null, { maxRuns: DEFAULT_MAX_RUNS });
  const otherFailures = allFailures.filter((r) => r.storyId !== storyId);

  // Section 1: Failures for current story (most important)
  if (storyFailures.length > 0) {
    let sectionHeader = `\n## Previous Failures for ${storyId}\n\n`;
    sectionHeader += `This story has failed ${storyFailures.length} time(s). Review these approaches to avoid repeating them:\n\n`;
    usedTokens += estimateTokens(sectionHeader);

    if (usedTokens < tokenBudget) {
      sections.push(sectionHeader);

      for (const run of storyFailures) {
        const formatted = formatRun(run, true);
        const runTokens = estimateTokens(formatted);

        if (usedTokens + runTokens > tokenBudget) break;

        sections.push(formatted + "\n");
        usedTokens += runTokens;
      }
    }
  }

  // Section 2: Successful approaches for current story
  const storySuccesses = storyRuns.filter((r) => r.status === "success");
  if (storySuccesses.length > 0 && usedTokens < tokenBudget * 0.8) {
    const sectionHeader = `\n## Successful Approaches for ${storyId}\n\n`;
    usedTokens += estimateTokens(sectionHeader);

    if (usedTokens < tokenBudget) {
      sections.push(sectionHeader);

      // Only include the most recent success
      const latestSuccess = storySuccesses[0];
      const formatted = formatRun(latestSuccess, false);
      const runTokens = estimateTokens(formatted);

      if (usedTokens + runTokens <= tokenBudget) {
        sections.push(formatted + "\n");
        usedTokens += runTokens;
      }
    }
  }

  // Section 3: Failures from other stories (patterns to avoid)
  if (otherFailures.length > 0 && usedTokens < tokenBudget * 0.9) {
    let sectionHeader = `\n## Recent Failures from Other Stories\n\n`;
    sectionHeader += `These failures may contain patterns or gotchas relevant to your work:\n\n`;
    usedTokens += estimateTokens(sectionHeader);

    if (usedTokens < tokenBudget) {
      sections.push(sectionHeader);

      // Include up to 3 other failures
      for (const run of otherFailures.slice(0, 3)) {
        const formatted = formatRun(run, false);
        const runTokens = estimateTokens(formatted);

        if (usedTokens + runTokens > tokenBudget) break;

        sections.push(formatted + "\n");
        usedTokens += runTokens;
      }
    }
  }

  // No historical context available
  if (sections.length === 1) {
    return ""; // Only header, no actual content
  }

  return sections.join("\n");
}

/**
 * Generate full context with all available history
 * @param {string} prdFolder - Path to PRD folder
 * @param {string} storyId - Current story ID
 * @param {number} tokenBudget - Maximum tokens for context
 * @returns {string} Markdown context
 */
function generateFullContext(prdFolder, storyId, tokenBudget) {
  const sections = [];
  let usedTokens = 0;

  // Header
  const header = `> Historical context from previous runs (mode: full)\n`;
  usedTokens += estimateTokens(header);
  sections.push(header);

  // Build full index
  const index = buildIndex(prdFolder, { maxRuns: DEFAULT_MAX_RUNS });

  // Summary section
  const summary = `\n## Run Summary\n\n` +
    `- Total runs indexed: ${index.totalRuns}\n` +
    `- Successful: ${index.successfulRuns}\n` +
    `- Failed: ${index.failedRuns}\n` +
    `- Stories covered: ${Object.keys(index.byStory).length}\n\n`;
  usedTokens += estimateTokens(summary);
  sections.push(summary);

  // Score and sort all runs
  const scoredRuns = index.runs
    .map((run) => ({ run, score: scoreRun(run, storyId) }))
    .sort((a, b) => b.score - a.score);

  // Include runs by relevance score
  const runsSection = `## Runs by Relevance\n\n`;
  usedTokens += estimateTokens(runsSection);
  sections.push(runsSection);

  for (const { run } of scoredRuns) {
    const formatted = formatRun(run, true);
    const runTokens = estimateTokens(formatted);

    if (usedTokens + runTokens > tokenBudget) break;

    sections.push(formatted + "\n");
    usedTokens += runTokens;
  }

  return sections.join("\n");
}

/**
 * Generate historical context based on mode
 * @param {Object} options - Generation options
 * @param {string} options.prdFolder - Path to PRD folder
 * @param {string} options.storyId - Current story ID
 * @param {string} options.mode - Context mode: off, smart, or full
 * @param {number} options.tokenBudget - Maximum tokens for context
 * @returns {string} Markdown context
 */
function generateContext(options) {
  const {
    prdFolder,
    storyId,
    mode = "smart",
    tokenBudget = DEFAULT_TOKEN_BUDGET,
  } = options;

  if (mode === "off") {
    return "";
  }

  if (mode === "full") {
    return generateFullContext(prdFolder, storyId, tokenBudget);
  }

  // Default to smart mode
  return generateSmartContext(prdFolder, storyId, tokenBudget);
}

// CLI handling
if (require.main === module) {
  const args = process.argv.slice(2);

  // Parse arguments
  const options = {
    prdFolder: null,
    storyId: null,
    mode: "smart",
    tokenBudget: DEFAULT_TOKEN_BUDGET,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--prd-folder" && args[i + 1]) {
      options.prdFolder = args[++i];
    } else if (arg.startsWith("--prd-folder=")) {
      options.prdFolder = arg.split("=").slice(1).join("=");
    } else if (arg === "--story-id" && args[i + 1]) {
      options.storyId = args[++i];
    } else if (arg.startsWith("--story-id=")) {
      options.storyId = arg.split("=").slice(1).join("=");
    } else if (arg === "--mode" && args[i + 1]) {
      options.mode = args[++i];
    } else if (arg.startsWith("--mode=")) {
      options.mode = arg.split("=").slice(1).join("=");
    } else if (arg === "--token-budget" && args[i + 1]) {
      options.tokenBudget = parseInt(args[++i], 10);
    } else if (arg.startsWith("--token-budget=")) {
      options.tokenBudget = parseInt(arg.split("=").slice(1).join("="), 10);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Historical Context Generator

Usage:
  node context-cli.js --prd-folder <path> --story-id <id> [options]

Options:
  --prd-folder <path>   Path to PRD-N folder (required)
  --story-id <id>       Current story ID, e.g., US-001 (required)
  --mode <mode>         Context mode: off, smart (default), or full
  --token-budget <n>    Maximum tokens for context (default: ${DEFAULT_TOKEN_BUDGET})
  --help, -h            Show this help message

Modes:
  off     No historical context (returns empty string)
  smart   Focused context on failures and current story (recommended)
  full    Complete historical context for all runs
`);
      process.exit(0);
    }
  }

  // Validate required args
  if (!options.prdFolder) {
    console.error("Error: --prd-folder is required");
    process.exit(1);
  }

  if (!options.storyId) {
    console.error("Error: --story-id is required");
    process.exit(1);
  }

  // Validate mode
  if (!["off", "smart", "full"].includes(options.mode)) {
    console.error(`Error: Invalid mode "${options.mode}". Must be: off, smart, or full`);
    process.exit(1);
  }

  // Generate and output context
  try {
    const context = generateContext(options);
    process.stdout.write(context);
  } catch (err) {
    console.error(`Error generating context: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  generateContext,
  generateSmartContext,
  generateFullContext,
  scoreRun,
  formatRun,
  estimateTokens,
  DEFAULT_TOKEN_BUDGET,
  DEFAULT_MAX_RUNS,
};
