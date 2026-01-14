#!/usr/bin/env node
/**
 * CLI wrapper for model router
 * Used by loop.sh to get routing decisions
 *
 * Usage:
 *   node router-cli.js --story <path> [--override <model>] [--repo-root <path>]
 *   node router-cli.js --score <N>
 *
 * Output: JSON with model selection
 */

const fs = require("fs");
const path = require("path");
const router = require("./router");

function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let storyPath = null;
  let override = null;
  let repoRoot = process.cwd();
  let score = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--story" || arg === "-s") {
      storyPath = args[++i];
    } else if (arg === "--override" || arg === "-o") {
      override = args[++i];
    } else if (arg === "--repo-root" || arg === "-r") {
      repoRoot = args[++i];
    } else if (arg === "--score") {
      score = parseFloat(args[++i]);
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Model Router CLI

Usage:
  node router-cli.js --story <path> [--override <model>] [--repo-root <path>]
  node router-cli.js --score <N>

Options:
  --story, -s      Path to story markdown file
  --override, -o   Force specific model (haiku, sonnet, opus)
  --repo-root, -r  Repository root for config loading (default: cwd)
  --score          Get model for specific complexity score (1-10)
  --help, -h       Show this help

Output: JSON object with routing decision

Examples:
  # Get routing for a story file
  node router-cli.js --story story.md

  # Force opus model
  node router-cli.js --story story.md --override opus

  # Get model for complexity score 7
  node router-cli.js --score 7
`);
      process.exit(0);
    }
  }

  // Handle --score mode
  if (score !== null) {
    if (isNaN(score) || score < 1 || score > 10) {
      console.error(JSON.stringify({ error: "Score must be between 1 and 10" }));
      process.exit(1);
    }
    const model = router.getModelForComplexity(score);
    console.log(JSON.stringify({
      model,
      score,
      reason: `complexity ${score}/10`,
      override: false,
    }));
    process.exit(0);
  }

  // Handle --story mode
  if (!storyPath) {
    console.error(JSON.stringify({ error: "Missing --story or --score argument" }));
    process.exit(1);
  }

  // Read story content
  let storyBlock = "";
  try {
    if (fs.existsSync(storyPath)) {
      storyBlock = fs.readFileSync(storyPath, "utf-8");
    }
  } catch (err) {
    console.error(JSON.stringify({ error: `Failed to read story: ${err.message}` }));
    process.exit(1);
  }

  // Get routing decision
  const decision = router.getRoutingDecision(storyBlock, {
    override,
    repoRoot,
  });

  // Output as JSON
  console.log(JSON.stringify({
    model: decision.model,
    score: decision.score,
    reason: decision.reason,
    override: decision.override,
    breakdown: decision.complexityBreakdown || null,
  }));
}

main();
