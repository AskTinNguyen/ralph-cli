/**
 * Ralph audit command
 * Token cost tracking audit and verification
 */
const fs = require("fs");
const path = require("path");
const { error: errorOut, info, dim, pc, hasFlag, parseFlag } = require("../cli");
const { loadTokenCache } = require("../tokens/cache");
const { aggregateCostByModel } = require("../tokens/calculator");
const {
  loadSubscriptionConfig,
  getCurrentBillingBreakdown,
  calculateTrackingAccuracy,
} = require("../tokens/subscription");

module.exports = {
  name: "audit",
  description: "Audit token cost tracking accuracy and data quality",
  usage: "ralph audit cost [--prd=N] [--json] [--verbose]",

  help: `
${pc.bold("ralph audit cost")} ${pc.dim("[options]")}
${pc.bold("ralph audit verify")} ${pc.dim("[options]")}

Audit token cost tracking to identify data quality issues and estimate true costs.

${pc.bold("Usage:")}
  ${pc.cyan("ralph audit cost")}              Full cost audit across all PRDs
  ${pc.cyan("ralph audit cost --prd=1")}      Audit specific PRD
  ${pc.cyan("ralph audit cost --verbose")}    Show detailed per-PRD breakdown
  ${pc.cyan("ralph audit verify")}            Verify cost tracking accuracy
  ${pc.cyan("ralph audit verify --expected=250")}  Compare against known costs

${pc.bold("Options:")}
  ${pc.yellow("--prd=N")}         Audit specific PRD only
  ${pc.yellow("--json")}          Output as JSON
  ${pc.yellow("--verbose, -v")}   Show detailed breakdown
  ${pc.yellow("--expected=N")}    Expected total cost for verification
  ${pc.yellow("--help, -h")}      Show this help

${pc.bold("What Gets Audited:")}
  • Total tracked cost vs estimated untracked
  • Data quality score (% runs with high confidence)
  • Model attribution (% Opus vs Sonnet vs Unknown)
  • Cache token usage breakdown
  • Extraction success rate
  • PRD coverage (% with token data)

${pc.bold("Examples:")}
  ${pc.dim("ralph audit cost")}              Run full audit
  ${pc.dim("ralph audit cost --prd=5")}      Audit PRD-5 only
  ${pc.dim("ralph audit cost -v")}           Detailed per-PRD audit
`,

  /**
   * Run the audit command
   */
  async run(args, env, options) {
    // Check for help flag
    if (hasFlag(args, "help") || hasFlag(args, "h")) {
      console.log(this.help);
      return 0;
    }

    // Parse flags
    const jsonFlag = hasFlag(args, "json");
    const verboseFlag = hasFlag(args, "verbose") || hasFlag(args, "v");
    const prdNumber = parseFlag(args, "prd");
    const expectedCost = parseFlag(args, "expected");

    // Get subcommand
    const subcommand = args.find((arg) => !arg.startsWith("-"));

    if (!subcommand || (subcommand !== "cost" && subcommand !== "verify")) {
      console.log(this.help);
      return 0;
    }

    // Run cost audit
    const ralphDir = path.join(options.cwd || process.cwd(), ".ralph");

    if (!fs.existsSync(ralphDir)) {
      errorOut(".ralph directory not found");
      info("Run 'ralph plan' to create your first PRD");
      return 1;
    }

    const auditResults = this.auditCostTracking(ralphDir, {
      prdFilter: prdNumber ? parseInt(prdNumber, 10) : null,
      verbose: verboseFlag,
    });

    if (subcommand === "verify") {
      return this.displayVerificationReport(auditResults, {
        expectedCost: expectedCost ? parseFloat(expectedCost) : null,
        json: jsonFlag,
        verbose: verboseFlag,
      });
    }

    if (jsonFlag) {
      console.log(JSON.stringify(auditResults, null, 2));
    } else {
      this.displayAuditReport(auditResults, verboseFlag);
    }

    return 0;
  },

  /**
   * Audit cost tracking data quality
   */
  auditCostTracking(ralphDir, options = {}) {
    const { prdFilter = null, verbose = false } = options;

    // Find all PRD folders
    const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
    const allPrdFolders = entries
      .filter((e) => e.isDirectory() && /^PRD-\d+$/.test(e.name))
      .map((e) => {
        const match = e.name.match(/^PRD-(\d+)$/);
        return {
          name: e.name,
          number: parseInt(match[1], 10),
          path: path.join(ralphDir, e.name),
        };
      })
      .sort((a, b) => a.number - b.number);

    // Filter by PRD if specified
    const prdFolders = prdFilter
      ? allPrdFolders.filter((p) => p.number === prdFilter)
      : allPrdFolders;

    const results = {
      totalPrds: allPrdFolders.length,
      prdsAudited: prdFolders.length,
      prdsWithData: 0,
      prdsWithoutData: 0,
      totalRuns: 0,
      runsWithHighConfidence: 0,
      runsWithMediumConfidence: 0,
      runsWithLowConfidence: 0,
      runsWithModelNull: 0,
      totalTrackedCost: 0,
      byModel: {
        opus: { runs: 0, cost: 0 },
        sonnet: { runs: 0, cost: 0 },
        haiku: { runs: 0, cost: 0 },
        unknown: { runs: 0, cost: 0 },
      },
      cacheTokens: {
        totalCreation: 0,
        totalRead: 0,
        costSavings: 0,
      },
      prdDetails: [],
    };

    for (const prd of prdFolders) {
      const tokensPath = path.join(prd.path, "tokens.json");

      if (!fs.existsSync(tokensPath)) {
        results.prdsWithoutData++;
        if (verbose) {
          results.prdDetails.push({
            prd: prd.name,
            status: "no_data",
            runs: 0,
            cost: 0,
          });
        }
        continue;
      }

      results.prdsWithData++;

      try {
        const tokensData = JSON.parse(fs.readFileSync(tokensPath, "utf-8"));

        if (!tokensData.runs || tokensData.runs.length === 0) {
          results.prdsWithoutData++;
          continue;
        }

        const prdDetail = {
          prd: prd.name,
          status: "has_data",
          runs: tokensData.runs.length,
          cost: tokensData.totals?.totalCost || 0,
          highConfidence: 0,
          mediumConfidence: 0,
          lowConfidence: 0,
          modelNull: 0,
          models: {},
        };

        results.totalRuns += tokensData.runs.length;
        results.totalTrackedCost += prdDetail.cost;

        for (const run of tokensData.runs) {
          // Classify confidence level
          if (run.estimated) {
            prdDetail.lowConfidence++;
            results.runsWithLowConfidence++;
          } else if (run.model && run.model !== "null" && run.model !== "unknown") {
            prdDetail.highConfidence++;
            results.runsWithHighConfidence++;
          } else {
            prdDetail.mediumConfidence++;
            results.runsWithMediumConfidence++;
          }

          // Track model attribution
          const model = run.model && run.model !== "null" ? run.model : "unknown";
          if (!prdDetail.models[model]) {
            prdDetail.models[model] = { runs: 0, cost: 0 };
          }
          prdDetail.models[model].runs++;
          prdDetail.models[model].cost += run.cost || 0;

          if (results.byModel[model]) {
            results.byModel[model].runs++;
            results.byModel[model].cost += run.cost || 0;
          }

          if (!run.model || run.model === "null" || run.model === "unknown") {
            prdDetail.modelNull++;
            results.runsWithModelNull++;
          }

          // Track cache tokens
          if (run.cacheCreationInputTokens) {
            results.cacheTokens.totalCreation += run.cacheCreationInputTokens;
          }
          if (run.cacheReadInputTokens) {
            results.cacheTokens.totalRead += run.cacheReadInputTokens;
          }
        }

        if (verbose) {
          results.prdDetails.push(prdDetail);
        }
      } catch (err) {
        // Ignore invalid JSON
        results.prdsWithoutData++;
      }
    }

    // Calculate data quality score
    const totalConfidenceRuns = results.runsWithHighConfidence + results.runsWithMediumConfidence;
    results.dataQualityScore =
      results.totalRuns > 0 ? Math.round((totalConfidenceRuns / results.totalRuns) * 100) : 0;

    // Calculate estimated true cost (if unknown runs were actually Opus)
    const unknownCost = results.byModel.unknown.cost;
    const opusMultiplier = 5; // Opus is ~5x more expensive than Sonnet
    results.estimatedTrueCost = {
      conservative: results.totalTrackedCost,
      realistic: results.totalTrackedCost + unknownCost * 1.5, // Assume 50% were Opus
      pessimistic: results.totalTrackedCost + unknownCost * (opusMultiplier - 1), // All unknown were Opus
    };

    return results;
  },

  /**
   * Display audit report in terminal
   */
  displayAuditReport(results, verbose) {
    console.log("");
    console.log(pc.bold(pc.cyan("Token Cost Audit Report")));
    console.log("━".repeat(60));
    console.log("");

    // Subscription & Billing Section (Phase 4.3)
    const ralphDir = path.join(process.cwd(), ".ralph");
    const subscriptionConfig = loadSubscriptionConfig(ralphDir);
    const billingBreakdown = getCurrentBillingBreakdown(ralphDir);

    if (subscriptionConfig && billingBreakdown) {
      console.log(pc.bold("💳 Subscription & Billing"));
      console.log(`  Period: ${pc.cyan(billingBreakdown.period)}`);
      console.log(`  Subscription: ${pc.green(`$${billingBreakdown.subscriptionCost.toFixed(2)}`)} ${pc.dim("(fixed monthly)")}`);
      console.log(`  API overage: ${pc.yellow(`$${billingBreakdown.apiOverageCost.toFixed(2)}`)} ${pc.dim("(token-based)")}`);
      console.log(`  Total: ${pc.bold(`$${billingBreakdown.totalCost.toFixed(2)}`)}`);

      // Show tracking accuracy against API overage
      const trackingAccuracy = calculateTrackingAccuracy(ralphDir, results.totalTrackedCost);
      if (trackingAccuracy.accuracy !== null) {
        const accuracyColor = trackingAccuracy.accuracy >= 80 ? pc.green : trackingAccuracy.accuracy >= 50 ? pc.yellow : pc.red;
        console.log(`  Tracked vs overage: ${accuracyColor(`${trackingAccuracy.accuracy.toFixed(1)}%`)} ${pc.dim(`(${trackingAccuracy.message})`)}`);
      }
      console.log("");
    }

    // Tracked Costs Section
    console.log(pc.bold("💰 Tracked Costs"));
    console.log(`  Total tracked: ${pc.green(`$${results.totalTrackedCost.toFixed(6)}`)}`);
    console.log(`  Total runs: ${pc.cyan(results.totalRuns)}`);
    console.log(
      `  PRDs with data: ${pc.cyan(results.prdsWithData)} / ${results.totalPrds} ${pc.dim(`(${Math.round((results.prdsWithData / results.totalPrds) * 100)}%)`)}`
    );
    console.log("");

    // Data Quality Section
    console.log(pc.bold("📊 Data Quality"));
    const qualityColor =
      results.dataQualityScore >= 70 ? pc.green : results.dataQualityScore >= 40 ? pc.yellow : pc.red;
    console.log(`  Quality score: ${qualityColor(results.dataQualityScore + "%")}`);
    console.log(
      `  High confidence: ${pc.green(results.runsWithHighConfidence)} runs ${pc.dim(`(${results.totalRuns > 0 ? Math.round((results.runsWithHighConfidence / results.totalRuns) * 100) : 0}%)`)}`
    );
    console.log(
      `  Medium confidence: ${pc.yellow(results.runsWithMediumConfidence)} runs ${pc.dim(`(${results.totalRuns > 0 ? Math.round((results.runsWithMediumConfidence / results.totalRuns) * 100) : 0}%)`)}`
    );
    console.log(
      `  Low confidence (estimated): ${pc.red(results.runsWithLowConfidence)} runs ${pc.dim(`(${results.totalRuns > 0 ? Math.round((results.runsWithLowConfidence / results.totalRuns) * 100) : 0}%)`)}`
    );
    console.log("");

    // Data Quality Issues
    if (
      results.runsWithModelNull > 0 ||
      results.runsWithLowConfidence > 0 ||
      results.prdsWithoutData > 0
    ) {
      console.log(pc.bold(pc.yellow("⚠️  Data Quality Issues")));
      if (results.runsWithModelNull > 0) {
        console.log(
          `  ${pc.yellow("⚠")} ${results.runsWithModelNull} runs with model=null ${pc.dim("(defaulted to Sonnet pricing)")}`
        );
      }
      if (results.runsWithLowConfidence > 0) {
        console.log(
          `  ${pc.yellow("⚠")} ${results.runsWithLowConfidence} runs with estimated=true ${pc.dim("(token extraction failed)")}`
        );
      }
      if (results.prdsWithoutData > 0) {
        console.log(`  ${pc.yellow("⚠")} ${results.prdsWithoutData} PRDs with no token data`);
      }
      console.log("");
    }

    // Model Attribution
    console.log(pc.bold("🤖 Model Attribution"));
    const totalModelRuns =
      results.byModel.opus.runs +
      results.byModel.sonnet.runs +
      results.byModel.haiku.runs +
      results.byModel.unknown.runs;

    if (results.byModel.opus.runs > 0) {
      const pct = Math.round((results.byModel.opus.runs / totalModelRuns) * 100);
      console.log(
        `  Opus: ${pc.cyan(results.byModel.opus.runs)} runs ${pc.dim(`(${pct}%)`)} - ${pc.green(`$${results.byModel.opus.cost.toFixed(6)}`)}`
      );
    }
    if (results.byModel.sonnet.runs > 0) {
      const pct = Math.round((results.byModel.sonnet.runs / totalModelRuns) * 100);
      console.log(
        `  Sonnet: ${pc.cyan(results.byModel.sonnet.runs)} runs ${pc.dim(`(${pct}%)`)} - ${pc.green(`$${results.byModel.sonnet.cost.toFixed(6)}`)}`
      );
    }
    if (results.byModel.haiku.runs > 0) {
      const pct = Math.round((results.byModel.haiku.runs / totalModelRuns) * 100);
      console.log(
        `  Haiku: ${pc.cyan(results.byModel.haiku.runs)} runs ${pc.dim(`(${pct}%)`)} - ${pc.green(`$${results.byModel.haiku.cost.toFixed(6)}`)}`
      );
    }
    if (results.byModel.unknown.runs > 0) {
      const pct = Math.round((results.byModel.unknown.runs / totalModelRuns) * 100);
      console.log(
        `  ${pc.yellow("Unknown")}: ${pc.cyan(results.byModel.unknown.runs)} runs ${pc.dim(`(${pct}%)`)} - ${pc.green(`$${results.byModel.unknown.cost.toFixed(6)}`)} ${pc.yellow("⚠")}`
      );
    }
    console.log("");

    // Cache Tokens
    if (results.cacheTokens.totalCreation > 0 || results.cacheTokens.totalRead > 0) {
      console.log(pc.bold("💾 Prompt Cache Usage"));
      if (results.cacheTokens.totalCreation > 0) {
        console.log(
          `  Cache write tokens: ${pc.cyan(results.cacheTokens.totalCreation.toLocaleString())}`
        );
      }
      if (results.cacheTokens.totalRead > 0) {
        console.log(
          `  Cache read tokens: ${pc.cyan(results.cacheTokens.totalRead.toLocaleString())}`
        );
        // Estimate savings (cache read is 10% of input cost)
        const avgInputPrice = 3; // Sonnet input price
        const fullCost = (results.cacheTokens.totalRead / 1_000_000) * avgInputPrice;
        const cacheCost = (results.cacheTokens.totalRead / 1_000_000) * (avgInputPrice * 0.1);
        const savings = fullCost - cacheCost;
        console.log(`  Estimated savings: ${pc.green(`$${savings.toFixed(6)}`)}`);
      }
      console.log("");
    }

    // Estimated True Cost
    console.log(pc.bold("📈 Estimated True Cost Range"));
    console.log(
      `  Conservative: ${pc.green(`$${results.estimatedTrueCost.conservative.toFixed(6)}`)} ${pc.dim("(current tracking)")}`
    );
    console.log(
      `  Realistic: ${pc.yellow(`$${results.estimatedTrueCost.realistic.toFixed(6)}`)} ${pc.dim("(if 50% unknown = Opus)")}`
    );
    console.log(
      `  Pessimistic: ${pc.red(`$${results.estimatedTrueCost.pessimistic.toFixed(6)}`)} ${pc.dim("(if all unknown = Opus)")}`
    );
    console.log("");

    // Recommendations
    console.log(pc.bold("💡 Recommendations"));

    if (results.prdsWithoutData > 0) {
      console.log(
        `  ${pc.cyan("→")} Run ${pc.bold("node lib/tokens/backfill.js")} to recover missing data`
      );
    }

    if (results.runsWithModelNull > 0) {
      console.log(
        `  ${pc.cyan("→")} Run ${pc.bold("node lib/tokens/fix-model-attribution.js")} to fix model detection`
      );
    }

    if (results.dataQualityScore < 50) {
      console.log(
        `  ${pc.cyan("→")} Improve log capture for better token extraction (see Phase 3.1)`
      );
    }

    if (results.cacheTokens.totalCreation === 0 && results.totalRuns > 10) {
      console.log(`  ${pc.cyan("→")} Cache tokens not being tracked - update extraction patterns`);
    }

    console.log("");

    // Per-PRD Details (verbose mode)
    if (verbose && results.prdDetails.length > 0) {
      console.log("━".repeat(60));
      console.log(pc.bold("📁 Per-PRD Breakdown"));
      console.log("");

      for (const detail of results.prdDetails) {
        if (detail.status === "no_data") {
          console.log(`  ${pc.dim(detail.prd)}: ${pc.yellow("No data")}`);
          continue;
        }

        console.log(`  ${pc.bold(detail.prd)}:`);
        console.log(`    Runs: ${detail.runs} | Cost: $${detail.cost.toFixed(6)}`);
        console.log(
          `    Confidence: ${pc.green(detail.highConfidence)} high, ${pc.yellow(detail.mediumConfidence)} medium, ${pc.red(detail.lowConfidence)} low`
        );

        if (Object.keys(detail.models).length > 0) {
          const modelStrs = Object.entries(detail.models)
            .map(([model, data]) => `${model}:${data.runs}`)
            .join(", ");
          console.log(`    Models: ${modelStrs}`);
        }

        console.log("");
      }
    }
  },

  /**
   * Display cost verification report (Phase 4.2)
   */
  displayVerificationReport(results, options = {}) {
    const { expectedCost = null, json = false, verbose = false } = options;

    if (json) {
      const report = {
        trackedCost: results.totalTrackedCost,
        expectedCost,
        accuracy: expectedCost ? (results.totalTrackedCost / expectedCost) * 100 : null,
        dataQuality: {
          score: results.dataQualityScore,
          highConfidence: results.runsWithHighConfidence,
          mediumConfidence: results.runsWithMediumConfidence,
          lowConfidence: results.runsWithLowConfidence,
        },
        modelAttribution: {
          opus: results.byModel.opus,
          sonnet: results.byModel.sonnet,
          haiku: results.byModel.haiku,
          unknown: results.byModel.unknown,
        },
        estimatedTrueCost: results.estimatedTrueCost,
        prdsTracked: `${results.prdsWithData}/${results.totalPrds}`,
      };
      console.log(JSON.stringify(report, null, 2));
      return 0;
    }

    console.log("");
    console.log(pc.bold(pc.cyan("Cost Verification Report")));
    console.log("━".repeat(60));
    console.log("");

    // Extraction Success Rate
    console.log(pc.bold("📊 Extraction Success Rate"));
    const totalConfidenceRuns = results.runsWithHighConfidence + results.runsWithMediumConfidence;
    const successRate = results.totalRuns > 0 ? Math.round((totalConfidenceRuns / results.totalRuns) * 100) : 0;

    console.log(
      `  ${pc.green("✓")} High confidence: ${results.runsWithHighConfidence} runs ${pc.dim(`(${results.totalRuns > 0 ? Math.round((results.runsWithHighConfidence / results.totalRuns) * 100) : 0}%)`)}`
    );
    console.log(
      `  ${pc.yellow("~")} Medium confidence: ${results.runsWithMediumConfidence} runs ${pc.dim(`(${results.totalRuns > 0 ? Math.round((results.runsWithMediumConfidence / results.totalRuns) * 100) : 0}%)`)}`
    );
    console.log(
      `  ${pc.red("✗")} Low confidence (estimated): ${results.runsWithLowConfidence} runs ${pc.dim(`(${results.totalRuns > 0 ? Math.round((results.runsWithLowConfidence / results.totalRuns) * 100) : 0}%)`)}`
    );
    console.log("");

    // Model Attribution
    console.log(pc.bold("🤖 Model Attribution"));
    const totalModelRuns =
      results.byModel.opus.runs +
      results.byModel.sonnet.runs +
      results.byModel.haiku.runs +
      results.byModel.unknown.runs;

    if (results.byModel.opus.runs > 0) {
      console.log(
        `  Opus: ${results.byModel.opus.runs} runs ($${results.byModel.opus.cost.toFixed(6)})`
      );
    }
    if (results.byModel.sonnet.runs > 0) {
      console.log(
        `  Sonnet: ${results.byModel.sonnet.runs} runs ($${results.byModel.sonnet.cost.toFixed(6)})`
      );
    }
    if (results.byModel.haiku.runs > 0) {
      console.log(
        `  Haiku: ${results.byModel.haiku.runs} runs ($${results.byModel.haiku.cost.toFixed(6)})`
      );
    }
    if (results.byModel.unknown.runs > 0) {
      console.log(
        `  ${pc.yellow("Unknown")}: ${results.byModel.unknown.runs} runs ($${results.byModel.unknown.cost.toFixed(6)}) ${pc.yellow("⚠")}`
      );
    }
    console.log("");

    // Pricing Used
    console.log(pc.bold("💵 Pricing Used"));
    console.log(`  Opus: $15/$75 per 1M (Jan 2026)`);
    console.log(`  Sonnet: $3/$15 per 1M (Jan 2026)`);
    console.log(`  Haiku: $0.25/$1.25 per 1M (Jan 2026)`);
    if (results.cacheTokens.totalCreation > 0 || results.cacheTokens.totalRead > 0) {
      console.log(`  Cache write: $3.75/$0.75/$0.0625 per 1M (Opus/Sonnet/Haiku)`);
      console.log(`  Cache read: $1.50/$0.30/$0.025 per 1M (Opus/Sonnet/Haiku)`);
    }
    console.log("");

    // Subscription & Billing (Phase 4.3)
    const ralphDir = path.join(process.cwd(), ".ralph");
    const subscriptionConfig = loadSubscriptionConfig(ralphDir);
    const billingBreakdown = getCurrentBillingBreakdown(ralphDir);

    if (subscriptionConfig && billingBreakdown) {
      console.log(pc.bold("💳 Subscription & Billing"));
      console.log(`  Period: ${pc.cyan(billingBreakdown.period)}`);
      console.log(`  Subscription: ${pc.green(`$${billingBreakdown.subscriptionCost.toFixed(2)}`)} ${pc.dim("(fixed monthly)")}`);
      console.log(`  API overage: ${pc.yellow(`$${billingBreakdown.apiOverageCost.toFixed(2)}`)} ${pc.dim("(token-based charges)")}`);
      console.log(`  Total billing: ${pc.bold(`$${billingBreakdown.totalCost.toFixed(2)}`)}`);
      console.log("");
    }

    // Cost Comparison
    console.log(pc.bold("💰 Cost Tracking Accuracy"));
    console.log(`  Tracked cost: ${pc.green(`$${results.totalTrackedCost.toFixed(6)}`)}`);

    // Use API overage for comparison if available, otherwise use expectedCost
    let comparisonCost = expectedCost;
    let comparisonLabel = "Expected cost";

    if (billingBreakdown && billingBreakdown.apiOverageCost > 0) {
      comparisonCost = billingBreakdown.apiOverageCost;
      comparisonLabel = "API overage (actual)";
    }

    if (comparisonCost) {
      const accuracy = (results.totalTrackedCost / comparisonCost) * 100;
      const missing = comparisonCost - results.totalTrackedCost;
      const accuracyColor = accuracy >= 80 ? pc.green : accuracy >= 50 ? pc.yellow : pc.red;

      console.log(`  ${comparisonLabel}: ${pc.cyan(`$${comparisonCost.toFixed(2)}`)}`);
      console.log(`  Accuracy: ${accuracyColor(`${accuracy.toFixed(1)}%`)}`);
      console.log(`  Missing: ${pc.red(`$${missing.toFixed(2)}`)} ${pc.dim(`(${(100 - accuracy).toFixed(1)}%)`)}`);

      if (billingBreakdown) {
        const trackingAccuracy = calculateTrackingAccuracy(ralphDir, results.totalTrackedCost);
        if (trackingAccuracy.message) {
          console.log(`  ${pc.dim(trackingAccuracy.message)}`);
        }
      }
    }
    console.log("");

    // Estimated True Cost Range
    console.log(pc.bold("📈 Estimated True Cost Range"));
    console.log(
      `  Conservative: ${pc.green(`$${results.estimatedTrueCost.conservative.toFixed(6)}`)} ${pc.dim("(current tracking)")}`
    );
    console.log(
      `  Realistic: ${pc.yellow(`$${results.estimatedTrueCost.realistic.toFixed(6)}`)} ${pc.dim("(if 50% unknown = Opus)")}`
    );
    console.log(
      `  Pessimistic: ${pc.red(`$${results.estimatedTrueCost.pessimistic.toFixed(6)}`)} ${pc.dim("(if all unknown = Opus)")}`
    );
    console.log("");

    // Recommendations
    console.log(pc.bold("💡 Recommendations"));

    if (results.dataQualityScore < 70) {
      console.log(
        `  ${pc.yellow("→")} Data quality is ${results.dataQualityScore}% (target: 70%+)`
      );
      console.log(`    Run backfill and fix-model-attribution scripts to improve`);
    } else {
      console.log(`  ${pc.green("✓")} Good data quality (${results.dataQualityScore}%)`);
    }

    if (expectedCost) {
      const accuracy = (results.totalTrackedCost / expectedCost) * 100;
      if (accuracy < 80) {
        console.log(
          `  ${pc.yellow("→")} Tracking only ${accuracy.toFixed(1)}% of expected costs`
        );
        console.log(`    Consider implementing Phase 3 & 4 improvements for better accuracy`);
      } else {
        console.log(`  ${pc.green("✓")} Good tracking accuracy (${accuracy.toFixed(1)}%)`);
      }
    }

    if (results.byModel.unknown.runs > 0) {
      console.log(
        `  ${pc.yellow("→")} ${results.byModel.unknown.runs} runs with unknown model`
      );
      console.log(`    Run: node lib/tokens/fix-model-attribution.js`);
    }

    console.log("");

    return 0;
  },
};
