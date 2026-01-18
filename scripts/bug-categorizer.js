#!/usr/bin/env node

/**
 * Bug Categorizer - AI-powered bug categorization with Claude Haiku
 *
 * Part of PRD-112 US-010: AI-powered bug categorization with Claude Haiku
 *
 * Features:
 * - Uses Claude Haiku to analyze each bug commit
 * - Input: commit message, diff, error message, files changed
 * - Output: JSON with primary category, secondary categories, severity, reasoning
 * - Stores categorization in .ralph/bug-wikipedia/categorized/bug-{sha}.json
 * - Includes prevention tips in output
 * - Batch processes bugs with rate limiting (max 10 per run)
 *
 * Categories:
 * - logic-error (wrong algorithm, off-by-one)
 * - race-condition (concurrency issues)
 * - requirements-misunderstanding
 * - integration-issue (API mismatch)
 * - environment-specific
 * - dependency-issue
 * - performance-degradation
 * - security-vulnerability
 * - data-corruption
 * - user-input-validation
 *
 * Configuration:
 * - ANTHROPIC_API_KEY environment variable required
 * - .ralph/automation-config.json for bugWikipedia settings
 *
 * Usage:
 * - Manual: node scripts/bug-categorizer.js
 * - CLI: ralph automation categorize-bugs
 * - With limit: node scripts/bug-categorizer.js --limit=5
 * - Dry run: node scripts/bug-categorizer.js --dry-run
 */

const fs = require("fs");
const path = require("path");

// ============================================================================
// Configuration Constants
// ============================================================================

// Bug categories (from PRD-112 US-010)
const BUG_CATEGORIES = [
  { id: "logic-error", description: "Wrong algorithm, off-by-one errors, incorrect logic" },
  { id: "race-condition", description: "Concurrency issues, race conditions, deadlocks" },
  { id: "requirements-misunderstanding", description: "Misinterpretation of requirements" },
  { id: "integration-issue", description: "API mismatch, interface incompatibility" },
  { id: "environment-specific", description: "Platform-specific bugs, environment issues" },
  { id: "dependency-issue", description: "Third-party library bugs, version conflicts" },
  { id: "performance-degradation", description: "Slowness, memory leaks, resource exhaustion" },
  { id: "security-vulnerability", description: "Security flaws, injection, authentication issues" },
  { id: "data-corruption", description: "Data integrity issues, incorrect state" },
  { id: "user-input-validation", description: "Input validation failures, edge cases" },
];

// Default batch size (max bugs per run to avoid rate limits)
const DEFAULT_BATCH_SIZE = 10;

// Maximum diff length to send to API (to manage token costs)
const MAX_DIFF_LENGTH = 500;

// Bug Wikipedia directories
const BUG_WIKIPEDIA_DIR = ".ralph/bug-wikipedia";
const RAW_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "raw");
const CATEGORIZED_BUGS_DIR = path.join(BUG_WIKIPEDIA_DIR, "categorized");

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// ============================================================================
// Logging Utilities
// ============================================================================

function log(level, message, data = null) {
  const prefix =
    level === "ERROR"
      ? "  ❌"
      : level === "SUCCESS"
      ? "  ✅"
      : level === "WARN"
      ? "  ⚠️"
      : "  ℹ️";

  console.log(`${prefix} ${message}`);

  if (data && process.env.RALPH_DEBUG === "1") {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ============================================================================
// Configuration Loading
// ============================================================================

/**
 * Load automation configuration
 * @returns {Object} Automation config with defaults
 */
function loadAutomationConfig() {
  const configPath = path.join(process.cwd(), ".ralph", "automation-config.json");

  if (!fs.existsSync(configPath)) {
    log("WARN", "Automation config not found, using defaults");
    return {
      bugWikipedia: {
        enabled: true,
        batchSize: DEFAULT_BATCH_SIZE,
      },
    };
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const config = JSON.parse(content);

    // Ensure bugWikipedia exists with defaults
    if (!config.bugWikipedia) {
      config.bugWikipedia = {
        enabled: true,
        batchSize: DEFAULT_BATCH_SIZE,
      };
    }

    return config;
  } catch (error) {
    log("ERROR", `Failed to parse automation config: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 * @returns {Object} Parsed options
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: null,
    dryRun: false,
    help: false,
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--limit=")) {
      const value = parseInt(arg.split("=")[1], 10);
      if (!isNaN(value) && value > 0) {
        options.limit = value;
      }
    }
  }

  return options;
}

/**
 * Show help message
 */
function showHelp() {
  console.log(`
Bug Categorizer - AI-powered bug categorization with Claude Haiku

Usage: node scripts/bug-categorizer.js [options]

Options:
  --help, -h      Show this help message
  --dry-run       Preview what would be categorized without calling API
  --limit=N       Limit to N bugs per run (default: 10)

Environment Variables:
  ANTHROPIC_API_KEY   Required for Claude Haiku API calls
  RALPH_DEBUG=1       Enable debug logging

Examples:
  node scripts/bug-categorizer.js
  node scripts/bug-categorizer.js --limit=5
  node scripts/bug-categorizer.js --dry-run
  ANTHROPIC_API_KEY=sk-... node scripts/bug-categorizer.js
`);
}

// ============================================================================
// Bug File Operations
// ============================================================================

/**
 * Get list of raw bug files that haven't been categorized yet
 * @returns {Array<string>} Array of bug file paths
 */
function getUncategorizedBugs() {
  const rawDir = path.join(process.cwd(), RAW_BUGS_DIR);
  const categorizedDir = path.join(process.cwd(), CATEGORIZED_BUGS_DIR);

  if (!fs.existsSync(rawDir)) {
    return [];
  }

  // Create categorized directory if needed
  if (!fs.existsSync(categorizedDir)) {
    fs.mkdirSync(categorizedDir, { recursive: true });
  }

  const rawFiles = fs.readdirSync(rawDir).filter((f) => f.endsWith(".json"));
  const categorizedFiles = new Set(
    fs.existsSync(categorizedDir)
      ? fs.readdirSync(categorizedDir).filter((f) => f.endsWith(".json"))
      : []
  );

  // Filter out already categorized bugs
  return rawFiles
    .filter((f) => !categorizedFiles.has(f))
    .map((f) => path.join(rawDir, f));
}

/**
 * Load raw bug data from file
 * @param {string} filePath - Path to bug JSON file
 * @returns {Object|null} Bug data or null if invalid
 */
function loadBugData(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    log("WARN", `Failed to load bug data from ${filePath}: ${error.message}`);
    return null;
  }
}

/**
 * Save categorized bug data
 * @param {Object} categorizedBug - Categorized bug data
 */
function saveCategorizedBug(categorizedBug) {
  const categorizedDir = path.join(process.cwd(), CATEGORIZED_BUGS_DIR);

  if (!fs.existsSync(categorizedDir)) {
    fs.mkdirSync(categorizedDir, { recursive: true });
  }

  const fileName = `${categorizedBug.id}.json`;
  const filePath = path.join(categorizedDir, fileName);

  try {
    fs.writeFileSync(filePath, JSON.stringify(categorizedBug, null, 2));
    log("SUCCESS", `Saved categorized bug: ${categorizedBug.id}`);
  } catch (error) {
    log("ERROR", `Failed to save categorized bug: ${error.message}`);
  }
}

// ============================================================================
// Claude Haiku API Integration
// ============================================================================

/**
 * Build the prompt for Claude Haiku
 * @param {Object} bug - Raw bug data
 * @returns {string} Formatted prompt
 */
function buildCategorizationPrompt(bug) {
  // Truncate diff to manage token costs
  const diffSnippet = bug.diff
    ? bug.diff.substring(0, MAX_DIFF_LENGTH) + (bug.diff.length > MAX_DIFF_LENGTH ? "..." : "")
    : "No diff available";

  const categoriesList = BUG_CATEGORIES.map((c) => `- ${c.id}: ${c.description}`).join("\n");

  return `Analyze this bug fix commit and categorize its root cause.

## Bug Information

**Commit Message:** ${bug.commit_message || "No message"}
**Files Changed:** ${bug.files_changed?.join(", ") || "Unknown"}
**Error Message:** ${bug.error_message || "No error message captured"}
**Diff Snippet:**
\`\`\`
${diffSnippet}
\`\`\`

## Available Categories

${categoriesList}

## Instructions

1. Analyze the commit message, files changed, and diff to determine the root cause
2. Select a primary_category from the list above
3. Optionally select secondary_categories if multiple apply
4. Determine severity: "critical", "high", "medium", or "low"
5. Explain your reasoning briefly
6. Provide actionable prevention_tips

## Output Format

Respond with ONLY a valid JSON object (no markdown code fences, no explanation outside the JSON):

{
  "primary_category": "<category-id>",
  "secondary_categories": ["<category-id>", ...],
  "severity": "<critical|high|medium|low>",
  "reasoning": "<1-2 sentence explanation>",
  "prevention_tips": "<actionable tip to prevent this bug type>",
  "similar_bugs": []
}`;
}

/**
 * Call Claude Haiku API for bug categorization
 * @param {Object} bug - Raw bug data
 * @param {Object} anthropic - Anthropic SDK client
 * @returns {Object|null} Categorization result or null on failure
 */
async function categorizeBugWithHaiku(bug, anthropic) {
  const prompt = buildCategorizationPrompt(bug);

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const message = await anthropic.messages.create({
        model: "claude-haiku-3-5-20241022",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      // Extract text content
      const responseText = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");

      // Parse JSON response
      const categorization = parseCategorizationResponse(responseText);
      if (categorization) {
        return categorization;
      }

      log("WARN", `Invalid response format on attempt ${attempt}`);
    } catch (error) {
      log("WARN", `API call failed on attempt ${attempt}: ${error.message}`);

      if (attempt < MAX_RETRIES) {
        // Use exponential backoff for retries
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  return null;
}

/**
 * Parse categorization response from Claude
 * @param {string} responseText - Raw response text
 * @returns {Object|null} Parsed categorization or null
 */
function parseCategorizationResponse(responseText) {
  try {
    // Try to extract JSON from response (handle potential markdown fences)
    let jsonStr = responseText.trim();

    // Remove markdown code fences if present
    if (jsonStr.startsWith("```")) {
      const lines = jsonStr.split("\n");
      // Remove first line (```json or ```) and last line (```)
      lines.shift();
      if (lines[lines.length - 1].trim() === "```") {
        lines.pop();
      }
      jsonStr = lines.join("\n");
    }

    const result = JSON.parse(jsonStr);

    // Validate required fields
    if (!result.primary_category || !result.severity || !result.reasoning) {
      log("WARN", "Missing required fields in categorization response");
      return null;
    }

    // Validate primary_category is valid
    const validCategories = BUG_CATEGORIES.map((c) => c.id);
    if (!validCategories.includes(result.primary_category)) {
      log("WARN", `Invalid primary_category: ${result.primary_category}`);
      return null;
    }

    // Ensure arrays exist
    result.secondary_categories = result.secondary_categories || [];
    result.similar_bugs = result.similar_bugs || [];

    return result;
  } catch (error) {
    log("WARN", `Failed to parse categorization response: ${error.message}`);
    return null;
  }
}

/**
 * Create categorized bug object combining raw data with categorization
 * @param {Object} rawBug - Raw bug data
 * @param {Object} categorization - Categorization result from Haiku
 * @returns {Object} Complete categorized bug object
 */
function createCategorizedBug(rawBug, categorization) {
  return {
    id: rawBug.id,
    commit_sha: rawBug.commit_sha,
    commit_message: rawBug.commit_message,
    author: rawBug.author,
    date_fixed: rawBug.date_fixed,
    files_changed: rawBug.files_changed,
    related_issues: rawBug.related_issues,
    github_url: rawBug.github_url,
    error_message: rawBug.error_message,
    primary_category: categorization.primary_category,
    secondary_categories: categorization.secondary_categories,
    severity: categorization.severity,
    reasoning: categorization.reasoning,
    prevention_tips: categorization.prevention_tips,
    similar_bugs: categorization.similar_bugs,
    categorized_at: new Date().toISOString(),
    categorized_by: "claude-haiku-3-5-20241022",
  };
}

// ============================================================================
// Main Execution
// ============================================================================

async function main() {
  const options = parseArgs();

  if (options.help) {
    showHelp();
    process.exit(0);
  }

  console.log("");
  log("INFO", "Starting bug categorizer...");
  console.log("");

  // Load configuration
  const config = loadAutomationConfig();

  if (!config.bugWikipedia?.enabled) {
    log("INFO", "Bug Wikipedia disabled in automation config, exiting");
    process.exit(0);
  }

  // Determine batch size
  const batchSize = options.limit || config.bugWikipedia?.batchSize || DEFAULT_BATCH_SIZE;
  log("INFO", `Batch size: ${batchSize} bugs per run`);

  // Get uncategorized bugs
  const uncategorizedPaths = getUncategorizedBugs();

  if (uncategorizedPaths.length === 0) {
    log("SUCCESS", "No uncategorized bugs found");
    process.exit(0);
  }

  log("INFO", `Found ${uncategorizedPaths.length} uncategorized bugs`);

  // Limit to batch size
  const bugsToProcess = uncategorizedPaths.slice(0, batchSize);
  log("INFO", `Processing ${bugsToProcess.length} bugs this run`);

  // Dry run mode
  if (options.dryRun) {
    console.log("");
    log("INFO", "DRY RUN - Would categorize the following bugs:");
    for (const bugPath of bugsToProcess) {
      const bug = loadBugData(bugPath);
      if (bug) {
        console.log(`  - ${bug.id}: ${bug.commit_message?.substring(0, 60)}...`);
      }
    }
    console.log("");
    log("INFO", "Dry run complete. No API calls made.");
    process.exit(0);
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    log("ERROR", "ANTHROPIC_API_KEY environment variable not set");
    log("INFO", "Set your API key: export ANTHROPIC_API_KEY=sk-...");
    process.exit(1);
  }

  // Load Anthropic SDK
  let Anthropic;
  try {
    Anthropic = require("@anthropic-ai/sdk").default;
  } catch (err) {
    log("ERROR", "@anthropic-ai/sdk not installed");
    log("INFO", "Install the SDK: npm install @anthropic-ai/sdk");
    process.exit(1);
  }

  // Initialize Anthropic client
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  // Process bugs
  let successCount = 0;
  let failCount = 0;

  console.log("");
  for (const bugPath of bugsToProcess) {
    const rawBug = loadBugData(bugPath);
    if (!rawBug) {
      failCount++;
      continue;
    }

    log("INFO", `Categorizing ${rawBug.id}...`);

    const categorization = await categorizeBugWithHaiku(rawBug, anthropic);

    if (categorization) {
      const categorizedBug = createCategorizedBug(rawBug, categorization);
      saveCategorizedBug(categorizedBug);
      log(
        "SUCCESS",
        `${rawBug.id} -> ${categorization.primary_category} (${categorization.severity})`
      );
      successCount++;
    } else {
      log("ERROR", `Failed to categorize ${rawBug.id}`);
      failCount++;
    }

    // Small delay between API calls to be respectful of rate limits
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  // Summary
  console.log("");
  log("INFO", "Categorization complete");
  log("SUCCESS", `Successfully categorized: ${successCount}`);
  if (failCount > 0) {
    log("WARN", `Failed to categorize: ${failCount}`);
  }

  const remainingCount = uncategorizedPaths.length - bugsToProcess.length;
  if (remainingCount > 0) {
    log("INFO", `Remaining uncategorized: ${remainingCount} (run again to process more)`);
  }

  console.log("");
}

// Run main function
main().catch((error) => {
  log("ERROR", `Bug categorizer failed: ${error.message}`);
  process.exit(1);
});
