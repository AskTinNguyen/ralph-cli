#!/usr/bin/env node
/**
 * Token Data Backfill Script
 *
 * Recovers missing token data by re-scanning all run logs
 * and rebuilding tokens.json files for PRDs.
 *
 * Usage:
 *   node lib/tokens/backfill.js [options]
 *
 * Options:
 *   --dry-run     Show what would be updated without making changes
 *   --prd=N       Only process specific PRD folder (e.g., --prd=1)
 *   --verbose     Show detailed processing information
 */

const fs = require("fs");
const path = require("path");
const { extractTokensWithFallback, detectModel } = require("./extractor");
const { calculateCost } = require("./calculator");
const { saveTokenCache, loadTokenCache } = require("./cache");

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes("--dry-run"),
  verbose: args.includes("--verbose"),
  prdFilter: null,
};

for (const arg of args) {
  if (arg.startsWith("--prd=")) {
    options.prdFilter = parseInt(arg.split("=")[1], 10);
  }
}

/**
 * Find all PRD folders in .ralph directory
 */
function findPrdFolders(ralphDir) {
  if (!fs.existsSync(ralphDir)) {
    console.error(`❌ .ralph directory not found: ${ralphDir}`);
    return [];
  }

  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdFolders = entries
    .filter((entry) => entry.isDirectory() && /^PRD-\d+$/.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(/^PRD-(\d+)$/);
      return {
        name: entry.name,
        number: parseInt(match[1], 10),
        path: path.join(ralphDir, entry.name),
      };
    })
    .sort((a, b) => a.number - b.number);

  return prdFolders;
}

/**
 * Find all run log files in a PRD folder
 */
function findRunLogs(prdFolder) {
  const runsDir = path.join(prdFolder, "runs");

  if (!fs.existsSync(runsDir)) {
    return [];
  }

  const files = fs.readdirSync(runsDir);
  const logFiles = files
    .filter((file) => file.endsWith(".log"))
    .map((file) => ({
      name: file,
      path: path.join(runsDir, file),
      stat: fs.statSync(path.join(runsDir, file)),
    }))
    .sort((a, b) => a.stat.mtime - b.stat.mtime); // Sort by modification time

  return logFiles;
}

/**
 * Extract tokens from a single run log
 */
function extractTokensFromRunLog(logPath, runName) {
  try {
    const logContent = fs.readFileSync(logPath, "utf-8");
    const tokens = extractTokensWithFallback(logContent, { useEstimation: true });

    // Try to extract iteration number from run name (e.g., run-001.log → 1)
    const iterationMatch = runName.match(/run-0*(\d+)/);
    const iteration = iterationMatch ? parseInt(iterationMatch[1], 10) : null;

    return {
      runName,
      iteration,
      timestamp: fs.statSync(logPath).mtime.toISOString(),
      inputTokens: tokens.inputTokens || 0,
      outputTokens: tokens.outputTokens || 0,
      cacheCreationInputTokens: tokens.cacheCreationInputTokens || 0,
      cacheReadInputTokens: tokens.cacheReadInputTokens || 0,
      model: tokens.model || "sonnet", // Default to sonnet if not detected
      estimated: tokens.estimated || false,
    };
  } catch (error) {
    if (options.verbose) {
      console.warn(`  ⚠️  Failed to extract from ${runName}: ${error.message}`);
    }
    return null;
  }
}

/**
 * Rebuild tokens.json for a PRD folder
 */
function rebuildTokensJson(prdFolder, prdName) {
  const logFiles = findRunLogs(prdFolder);

  if (logFiles.length === 0) {
    return {
      status: "no_logs",
      message: "No run logs found",
      runsProcessed: 0,
    };
  }

  const runs = [];
  let successCount = 0;
  let estimatedCount = 0;

  for (const logFile of logFiles) {
    const runData = extractTokensFromRunLog(logFile.path, logFile.name);
    if (runData) {
      runs.push(runData);
      successCount++;
      if (runData.estimated) estimatedCount++;
    }
  }

  if (runs.length === 0) {
    return {
      status: "extraction_failed",
      message: "Token extraction failed for all logs",
      runsProcessed: 0,
    };
  }

  // Calculate costs for each run
  const runsWithCost = runs.map((run) => {
    const cost = calculateCost(
      {
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        cacheCreationInputTokens: run.cacheCreationInputTokens,
        cacheReadInputTokens: run.cacheReadInputTokens,
      },
      run.model,
      { repoRoot: path.resolve(prdFolder, "../..") }
    );

    return {
      ...run,
      cost: cost.totalCost,
      inputCost: cost.inputCost,
      outputCost: cost.outputCost,
      cacheWriteCost: cost.cacheWriteCost,
      cacheReadCost: cost.cacheReadCost,
    };
  });

  // Calculate totals
  const totals = {
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
  };

  for (const run of runsWithCost) {
    totals.totalCost += run.cost;
    totals.inputCost += run.inputCost;
    totals.outputCost += run.outputCost;
    totals.cacheWriteCost += run.cacheWriteCost;
    totals.cacheReadCost += run.cacheReadCost;
    totals.totalInputTokens += run.inputTokens;
    totals.totalOutputTokens += run.outputTokens;
    totals.totalCacheCreationTokens += run.cacheCreationInputTokens;
    totals.totalCacheReadTokens += run.cacheReadInputTokens;
  }

  const tokenData = {
    prd: prdName,
    runs: runsWithCost,
    totals,
    lastUpdated: new Date().toISOString(),
  };

  // Save tokens.json if not dry run
  if (!options.dryRun) {
    const tokensPath = path.join(prdFolder, "tokens.json");
    fs.writeFileSync(tokensPath, JSON.stringify(tokenData, null, 2), "utf-8");
  }

  return {
    status: "success",
    message: `Processed ${runs.length} runs (${estimatedCount} estimated)`,
    runsProcessed: runs.length,
    estimatedRuns: estimatedCount,
    totalCost: totals.totalCost,
  };
}

/**
 * Main backfill process
 */
function main() {
  const repoRoot = process.cwd();
  const ralphDir = path.join(repoRoot, ".ralph");

  console.log("🔄 Token Data Backfill");
  console.log("━".repeat(50));
  console.log("");

  if (options.dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made");
    console.log("");
  }

  const prdFolders = findPrdFolders(ralphDir);

  if (prdFolders.length === 0) {
    console.log("❌ No PRD folders found in .ralph directory");
    return 1;
  }

  console.log(`📁 Found ${prdFolders.length} PRD folders`);
  console.log("");

  const results = {
    total: 0,
    success: 0,
    noLogs: 0,
    failed: 0,
    totalRuns: 0,
    totalCost: 0,
  };

  for (const prdFolder of prdFolders) {
    // Skip if filtering by specific PRD
    if (options.prdFilter !== null && prdFolder.number !== options.prdFilter) {
      continue;
    }

    results.total++;

    // Check if tokens.json already exists
    const tokensPath = path.join(prdFolder.path, "tokens.json");
    const hasExisting = fs.existsSync(tokensPath);

    if (options.verbose) {
      console.log(`\n📊 ${prdFolder.name}`);
      if (hasExisting && !options.dryRun) {
        console.log("  ℹ️  Existing tokens.json will be replaced");
      }
    } else {
      process.stdout.write(`  ${prdFolder.name}: `);
    }

    const result = rebuildTokensJson(prdFolder.path, prdFolder.name);

    if (result.status === "success") {
      results.success++;
      results.totalRuns += result.runsProcessed;
      results.totalCost += result.totalCost;

      if (options.verbose) {
        console.log(`  ✅ ${result.message}`);
        console.log(`  💰 Total cost: $${result.totalCost.toFixed(6)}`);
      } else {
        console.log(`✅ ${result.runsProcessed} runs ($${result.totalCost.toFixed(4)})`);
      }
    } else if (result.status === "no_logs") {
      results.noLogs++;
      if (options.verbose) {
        console.log(`  ⚠️  ${result.message}`);
      } else {
        console.log("⚠️  No logs");
      }
    } else {
      results.failed++;
      if (options.verbose) {
        console.log(`  ❌ ${result.message}`);
      } else {
        console.log(`❌ ${result.message}`);
      }
    }
  }

  console.log("");
  console.log("━".repeat(50));
  console.log("📈 Backfill Summary");
  console.log("━".repeat(50));
  console.log(`Total PRDs processed: ${results.total}`);
  console.log(`  ✅ Success: ${results.success}`);
  console.log(`  ⚠️  No logs: ${results.noLogs}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log("");
  console.log(`Total runs processed: ${results.totalRuns}`);
  console.log(`Total cost tracked: $${results.totalCost.toFixed(6)}`);

  if (options.dryRun) {
    console.log("");
    console.log("💡 Run without --dry-run to save changes");
  }

  return results.failed > 0 ? 1 : 0;
}

// Run if executed directly
if (require.main === module) {
  process.exit(main());
}

module.exports = { findPrdFolders, findRunLogs, extractTokensFromRunLog, rebuildTokensJson };
