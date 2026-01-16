#!/usr/bin/env node
/**
 * Model Attribution Fix Script
 *
 * Fixes model attribution for runs with model=null by:
 * 1. Re-scanning logs with improved model detection
 * 2. Checking config.sh for default model
 * 3. Recalculating costs with correct model pricing
 *
 * Usage:
 *   node lib/tokens/fix-model-attribution.js [options]
 *
 * Options:
 *   --dry-run     Show what would be changed without making changes
 *   --prd=N       Only process specific PRD folder
 *   --verbose     Show detailed processing information
 *   --diff        Show before/after cost comparison
 */

const fs = require("fs");
const path = require("path");
const { detectModel } = require("./extractor");
const { calculateCost } = require("./calculator");

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  dryRun: args.includes("--dry-run"),
  verbose: args.includes("--verbose"),
  showDiff: args.includes("--diff"),
  prdFilter: null,
};

for (const arg of args) {
  if (arg.startsWith("--prd=")) {
    options.prdFilter = parseInt(arg.split("=")[1], 10);
  }
}

/**
 * Find all PRD folders with tokens.json
 */
function findPrdFoldersWithTokens(ralphDir) {
  if (!fs.existsSync(ralphDir)) {
    console.error(`❌ .ralph directory not found: ${ralphDir}`);
    return [];
  }

  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdFolders = entries
    .filter((entry) => {
      if (!entry.isDirectory() || !/^PRD-\d+$/.test(entry.name)) {
        return false;
      }
      const tokensPath = path.join(ralphDir, entry.name, "tokens.json");
      return fs.existsSync(tokensPath);
    })
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
 * Load tokens.json for a PRD
 */
function loadTokensJson(prdFolder) {
  const tokensPath = path.join(prdFolder, "tokens.json");
  try {
    const content = fs.readFileSync(tokensPath, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to load tokens.json: ${error.message}`);
    return null;
  }
}

/**
 * Get default model from config.sh
 */
function getDefaultModel(repoRoot) {
  const configPath = path.join(repoRoot, ".agents", "ralph", "config.sh");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const modelMatch = content.match(/^CLAUDE_MODEL\s*=\s*["']?(\w+)["']?/m);

    if (modelMatch) {
      const model = modelMatch[1].toLowerCase();
      // Map config model names to our simplified names
      if (/opus/i.test(model)) return "opus";
      if (/sonnet/i.test(model)) return "sonnet";
      if (/haiku/i.test(model)) return "haiku";
      return model;
    }
  } catch (error) {
    // Ignore
  }

  return null;
}

/**
 * Try to detect model from run log
 */
function detectModelFromLog(prdFolder, runName) {
  const logPath = path.join(prdFolder, "runs", runName.replace(/\.log$/, "") + ".log");

  if (!fs.existsSync(logPath)) {
    return null;
  }

  try {
    const logContent = fs.readFileSync(logPath, "utf-8");
    return detectModel(logContent);
  } catch (error) {
    return null;
  }
}

/**
 * Fix model attribution for a single PRD
 */
function fixPrdModelAttribution(prdFolder, prdName, repoRoot) {
  const tokensData = loadTokensJson(prdFolder);

  if (!tokensData || !tokensData.runs || tokensData.runs.length === 0) {
    return {
      status: "no_data",
      message: "No token data found",
    };
  }

  const defaultModel = getDefaultModel(repoRoot);
  let fixedCount = 0;
  let totalCostBefore = tokensData.totals?.totalCost || 0;
  let totalCostAfter = 0;

  const updatedRuns = tokensData.runs.map((run) => {
    let newModel = run.model;

    // Only fix if model is null, undefined, or "unknown"
    if (!newModel || newModel === "unknown" || newModel === "null") {
      // Try to detect from log first
      const detectedModel = detectModelFromLog(prdFolder, run.runName || `run-${String(run.iteration).padStart(3, "0")}.log`);

      if (detectedModel) {
        newModel = detectedModel;
        fixedCount++;
      } else if (defaultModel) {
        // Fallback to config default
        newModel = defaultModel;
        fixedCount++;
      } else {
        // Last resort: default to sonnet (most common)
        newModel = "sonnet";
        fixedCount++;
      }
    }

    // Recalculate cost with correct model
    const newCost = calculateCost(
      {
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        cacheCreationInputTokens: run.cacheCreationInputTokens || 0,
        cacheReadInputTokens: run.cacheReadInputTokens || 0,
      },
      newModel,
      { repoRoot }
    );

    totalCostAfter += newCost.totalCost;

    return {
      ...run,
      model: newModel,
      cost: newCost.totalCost,
      inputCost: newCost.inputCost,
      outputCost: newCost.outputCost,
      cacheWriteCost: newCost.cacheWriteCost,
      cacheReadCost: newCost.cacheReadCost,
    };
  });

  // Update totals
  const updatedTotals = {
    totalCost: totalCostAfter,
    inputCost: 0,
    outputCost: 0,
    cacheWriteCost: 0,
    cacheReadCost: 0,
    totalInputTokens: tokensData.totals?.totalInputTokens || 0,
    totalOutputTokens: tokensData.totals?.totalOutputTokens || 0,
    totalCacheCreationTokens: tokensData.totals?.totalCacheCreationTokens || 0,
    totalCacheReadTokens: tokensData.totals?.totalCacheReadTokens || 0,
  };

  for (const run of updatedRuns) {
    updatedTotals.inputCost += run.inputCost || 0;
    updatedTotals.outputCost += run.outputCost || 0;
    updatedTotals.cacheWriteCost += run.cacheWriteCost || 0;
    updatedTotals.cacheReadCost += run.cacheReadCost || 0;
  }

  const updatedData = {
    ...tokensData,
    runs: updatedRuns,
    totals: updatedTotals,
    lastUpdated: new Date().toISOString(),
  };

  // Save updated tokens.json if not dry run
  if (!options.dryRun && fixedCount > 0) {
    const tokensPath = path.join(prdFolder, "tokens.json");
    fs.writeFileSync(tokensPath, JSON.stringify(updatedData, null, 2), "utf-8");
  }

  return {
    status: fixedCount > 0 ? "fixed" : "no_changes",
    message: `Fixed ${fixedCount} runs`,
    fixedCount,
    totalRunsBefore: tokensData.runs.length,
    totalCostBefore,
    totalCostAfter,
    costDelta: totalCostAfter - totalCostBefore,
  };
}

/**
 * Main fix process
 */
function main() {
  const repoRoot = process.cwd();
  const ralphDir = path.join(repoRoot, ".ralph");

  console.log("🔧 Model Attribution Fix");
  console.log("━".repeat(50));
  console.log("");

  if (options.dryRun) {
    console.log("🔍 DRY RUN MODE - No changes will be made");
    console.log("");
  }

  const prdFolders = findPrdFoldersWithTokens(ralphDir);

  if (prdFolders.length === 0) {
    console.log("❌ No PRD folders with tokens.json found");
    return 1;
  }

  console.log(`📁 Found ${prdFolders.length} PRD folders with token data`);
  console.log("");

  const results = {
    total: 0,
    fixed: 0,
    noChanges: 0,
    failed: 0,
    totalRunsFixed: 0,
    totalCostBefore: 0,
    totalCostAfter: 0,
  };

  for (const prdFolder of prdFolders) {
    // Skip if filtering by specific PRD
    if (options.prdFilter !== null && prdFolder.number !== options.prdFilter) {
      continue;
    }

    results.total++;

    if (options.verbose) {
      console.log(`\n🔍 ${prdFolder.name}`);
    } else {
      process.stdout.write(`  ${prdFolder.name}: `);
    }

    const result = fixPrdModelAttribution(prdFolder.path, prdFolder.name, repoRoot);

    if (result.status === "fixed") {
      results.fixed++;
      results.totalRunsFixed += result.fixedCount;
      results.totalCostBefore += result.totalCostBefore;
      results.totalCostAfter += result.totalCostAfter;

      if (options.verbose) {
        console.log(`  ✅ ${result.message}`);
        if (options.showDiff) {
          console.log(`  💰 Before: $${result.totalCostBefore.toFixed(6)}`);
          console.log(`  💰 After: $${result.totalCostAfter.toFixed(6)}`);
          const delta = result.costDelta;
          const sign = delta >= 0 ? "+" : "";
          console.log(`  📊 Delta: ${sign}$${delta.toFixed(6)}`);
        }
      } else {
        const msg = `✅ ${result.fixedCount} runs`;
        if (options.showDiff) {
          const delta = result.costDelta;
          const sign = delta >= 0 ? "+" : "";
          console.log(`${msg} (${sign}$${delta.toFixed(4)})`);
        } else {
          console.log(msg);
        }
      }
    } else if (result.status === "no_changes") {
      results.noChanges++;
      if (options.verbose) {
        console.log("  ✓ No changes needed");
      } else {
        console.log("✓ No changes");
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
  console.log("📈 Fix Summary");
  console.log("━".repeat(50));
  console.log(`Total PRDs processed: ${results.total}`);
  console.log(`  ✅ Fixed: ${results.fixed}`);
  console.log(`  ✓ No changes: ${results.noChanges}`);
  console.log(`  ❌ Failed: ${results.failed}`);
  console.log("");
  console.log(`Total runs fixed: ${results.totalRunsFixed}`);

  if (results.fixed > 0 && options.showDiff) {
    console.log("");
    console.log("💰 Cost Impact:");
    console.log(`  Before: $${results.totalCostBefore.toFixed(6)}`);
    console.log(`  After: $${results.totalCostAfter.toFixed(6)}`);
    const delta = results.totalCostAfter - results.totalCostBefore;
    const sign = delta >= 0 ? "+" : "";
    const percent = results.totalCostBefore > 0 ? ((delta / results.totalCostBefore) * 100).toFixed(1) : "0";
    console.log(`  Delta: ${sign}$${delta.toFixed(6)} (${sign}${percent}%)`);
  }

  if (options.dryRun && results.fixed > 0) {
    console.log("");
    console.log("💡 Run without --dry-run to save changes");
  }

  return results.failed > 0 ? 1 : 0;
}

// Run if executed directly
if (require.main === module) {
  process.exit(main());
}

module.exports = { fixPrdModelAttribution, getDefaultModel, detectModelFromLog };
