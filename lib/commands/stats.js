/**
 * Ralph stats command
 * Performance metrics dashboard with subcommands
 */
const fs = require("fs");
const path = require("path");
const {
  success, error, info, dim, warn, pc,
  hasFlag, parseFlag, formatDuration, formatCost, formatTokens, trendArrow, hr,
} = require("../cli");

/**
 * Check if a path exists
 */
function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  name: "stats",
  description: "Performance metrics dashboard",
  usage: "ralph stats [--global] [--json] [--tokens]",

  subcommands: {
    rollback: "Rollback & recovery statistics",
    switches: "Agent switch analytics",
  },

  help: `
${pc.bold("ralph stats")} ${pc.dim("[subcommand] [options]")}

Display performance metrics and analytics.

${pc.bold("Subcommands:")}
  ${pc.green("rollback")}              Show rollback & recovery statistics
  ${pc.green("switches")}              Show agent switch analytics

${pc.bold("Options:")}
  ${pc.yellow("--global")}              Show cross-project metrics
  ${pc.yellow("--json")}                Output as JSON
  ${pc.yellow("--tokens")}              Show token usage and cost metrics
  ${pc.yellow("--no-cache")}            Regenerate metrics instead of using cache

${pc.bold("Examples:")}
  ${pc.dim("ralph stats")}              Local project metrics
  ${pc.dim("ralph stats --global")}     Cross-project aggregate
  ${pc.dim("ralph stats --tokens")}     Token/cost breakdown
  ${pc.dim("ralph stats rollback")}     Rollback statistics
  ${pc.dim("ralph stats switches")}     Agent switch analytics
`,

  /**
   * Run the stats command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd() } = options;
    const subCmd = args[1];

    // Parse flags
    const globalFlag = hasFlag(args, "global") || hasFlag(args, "g");
    const jsonFlag = hasFlag(args, "json");
    const noCache = hasFlag(args, "no-cache");
    const tokensFlag = hasFlag(args, "tokens");

    // Handle subcommands
    if (subCmd === "rollback") {
      return runRollbackStats(args, cwd, jsonFlag);
    }

    if (subCmd === "switches") {
      return runSwitchesStats(args, cwd, jsonFlag);
    }

    // Handle --tokens flag
    if (tokensFlag) {
      return runTokenStats(args, cwd, jsonFlag);
    }

    // Handle --global flag
    if (globalFlag) {
      return runGlobalStats(cwd, jsonFlag);
    }

    // Default: local project stats
    return runLocalStats(cwd, jsonFlag, noCache);
  },
};

/**
 * Run rollback statistics subcommand
 */
async function runRollbackStats(args, cwd, jsonFlag) {
  const metricsModule = require("../estimate/metrics");
  const ralphDir = path.join(cwd, ".ralph");

  if (!exists(ralphDir)) {
    warn("No .ralph directory found. Run some build iterations first.");
    return 0;
  }

  // Get all PRD directories
  const prdDirs = fs.readdirSync(ralphDir)
    .filter(d => d.match(/^PRD-\d+$/))
    .sort((a, b) => {
      const numA = parseInt(a.split('-')[1]);
      const numB = parseInt(b.split('-')[1]);
      return numB - numA;
    });

  if (prdDirs.length === 0) {
    warn("No PRD directories found. Run some build iterations first.");
    return 0;
  }

  // Parse flags
  const prdFlag = args.find(a => a.startsWith("--prd="));
  const specificPrd = prdFlag ? prdFlag.split("=")[1] : null;

  // Filter PRD directories if specific one requested
  const targetDirs = specificPrd
    ? prdDirs.filter(d => d === `PRD-${specificPrd}`)
    : prdDirs;

  if (specificPrd && targetDirs.length === 0) {
    warn(`PRD-${specificPrd} not found.`);
    return 1;
  }

  // Aggregate rollback stats across selected PRDs
  const aggregatedStats = {
    totalRollbacks: 0,
    successful: 0,
    failed: 0,
    recoveryRate: 0,
    avgAttempts: 0,
    byReason: {},
    byStory: {},
    byStream: {},
  };

  let totalAttempts = 0;

  for (const prdDir of targetDirs) {
    const prdPath = path.join(ralphDir, prdDir);
    const analytics = metricsModule.getRollbackAnalytics(prdPath);

    if (!analytics.hasData) continue;

    const prdNum = prdDir.replace("PRD-", "");
    aggregatedStats.byStream[prdNum] = {
      rollbacks: analytics.total,
      recoveryRate: analytics.successRate,
      avgAttempts: analytics.avgAttempts,
    };

    aggregatedStats.totalRollbacks += analytics.total;
    aggregatedStats.successful += analytics.successful;
    aggregatedStats.failed += analytics.failed;
    totalAttempts += analytics.total * analytics.avgAttempts;

    // Aggregate by reason
    for (const [reason, stats] of Object.entries(analytics.byReason)) {
      if (!aggregatedStats.byReason[reason]) {
        aggregatedStats.byReason[reason] = { count: 0, successful: 0 };
      }
      aggregatedStats.byReason[reason].count += stats.count;
      aggregatedStats.byReason[reason].successful += stats.successful;
    }

    // Aggregate by story
    for (const [storyId, stats] of Object.entries(analytics.byStory)) {
      if (!aggregatedStats.byStory[storyId]) {
        aggregatedStats.byStory[storyId] = { rollbacks: 0, maxAttempts: 0 };
      }
      aggregatedStats.byStory[storyId].rollbacks += stats.rollbacks;
      aggregatedStats.byStory[storyId].maxAttempts = Math.max(
        aggregatedStats.byStory[storyId].maxAttempts,
        stats.maxAttempts
      );
    }
  }

  // Calculate overall rates
  aggregatedStats.recoveryRate = aggregatedStats.totalRollbacks > 0
    ? Math.round((aggregatedStats.successful / aggregatedStats.totalRollbacks) * 100)
    : 0;
  aggregatedStats.avgAttempts = aggregatedStats.totalRollbacks > 0
    ? Math.round((totalAttempts / aggregatedStats.totalRollbacks) * 100) / 100
    : 0;

  // JSON output
  if (jsonFlag) {
    console.log(JSON.stringify(aggregatedStats, null, 2));
    return 0;
  }

  // Human-readable output
  console.log("");
  console.log(pc.bold("Rollback & Recovery Statistics"));
  console.log(pc.dim("=".repeat(70)));
  console.log("");

  if (aggregatedStats.totalRollbacks === 0) {
    success("No rollbacks recorded. All builds succeeded without test failures!");
    return 0;
  }

  // Summary
  console.log(pc.bold(pc.cyan("Summary")));
  hr("-", 70);

  const recoveryColor = aggregatedStats.recoveryRate >= 50 ? pc.green : pc.yellow;
  console.log(`  Total Rollbacks:   ${pc.bold(aggregatedStats.totalRollbacks)}`);
  console.log(`  Recovered:         ${pc.green(aggregatedStats.successful)}`);
  console.log(`  Failed:            ${pc.red(aggregatedStats.failed)}`);
  console.log(`  Recovery Rate:     ${recoveryColor(aggregatedStats.recoveryRate + "%")}`);
  console.log(`  Avg Attempts:      ${aggregatedStats.avgAttempts}`);
  console.log("");

  // By Failure Type
  if (Object.keys(aggregatedStats.byReason).length > 0) {
    console.log(pc.bold(pc.cyan("By Failure Type")));
    hr("-", 70);
    console.log(pc.dim(`${"TYPE".padEnd(25)} ${"COUNT".padStart(7)} ${"RECOVERED".padStart(10)} ${"RATE".padStart(8)}`));
    hr("-", 70);

    const sortedReasons = Object.entries(aggregatedStats.byReason)
      .sort(([, a], [, b]) => b.count - a.count);

    for (const [reason, stats] of sortedReasons) {
      const rate = stats.count > 0 ? Math.round((stats.successful / stats.count) * 100) : 0;
      const rateColor = rate >= 50 ? pc.green : pc.yellow;
      const reasonLabel = reason.replace(/-/g, " ").replace(/_/g, " ");
      console.log(`  ${reasonLabel.padEnd(23)} ${String(stats.count).padStart(7)} ${String(stats.successful).padStart(10)} ${rateColor(`${rate}%`.padStart(8))}`);
    }
    console.log("");
  }

  // By Stream (if multiple)
  if (Object.keys(aggregatedStats.byStream).length > 1) {
    console.log(pc.bold(pc.cyan("By Stream")));
    hr("-", 70);
    console.log(pc.dim(`${"STREAM".padEnd(15)} ${"ROLLBACKS".padStart(10)} ${"RECOVERY".padStart(10)} ${"AVG TRIES".padStart(10)}`));
    hr("-", 70);

    const sortedStreams = Object.entries(aggregatedStats.byStream)
      .sort(([, a], [, b]) => b.rollbacks - a.rollbacks);

    for (const [streamId, stats] of sortedStreams) {
      const rateColor = stats.recoveryRate >= 50 ? pc.green : pc.yellow;
      console.log(`  PRD-${streamId.padEnd(11)} ${String(stats.rollbacks).padStart(10)} ${rateColor(`${stats.recoveryRate}%`.padStart(10))} ${String(stats.avgAttempts).padStart(10)}`);
    }
    console.log("");
  }

  // Recommendations
  hr("-", 70);
  if (aggregatedStats.recoveryRate < 50) {
    warn("Low recovery rate. Consider:");
    console.log(`  ${pc.dim("→")} Review test failure patterns in the error logs`);
    console.log(`  ${pc.dim("→")} Check if retry prompts have enough context`);
    console.log(`  ${pc.dim("→")} Increase ROLLBACK_MAX_RETRIES if failures are close to recovering`);
  } else {
    success(`Good recovery rate (${aggregatedStats.recoveryRate}%). Rollback mechanism is working well.`);
  }
  console.log("");

  return 0;
}

/**
 * Run switches statistics subcommand
 */
async function runSwitchesStats(args, cwd, jsonFlag) {
  const metricsModule = require("../estimate/metrics");
  const ralphDir = path.join(cwd, ".ralph");

  if (!exists(ralphDir)) {
    warn("No .ralph directory found. Run some build iterations first.");
    return 0;
  }

  // Collect metrics from all PRD-N folders
  const prdDirs = fs.readdirSync(ralphDir)
    .filter((dir) => /^PRD-\d+$/.test(dir))
    .map((dir) => path.join(ralphDir, dir));

  if (prdDirs.length === 0) {
    warn("No PRD directories found. Run some build iterations first.");
    return 0;
  }

  // Aggregate metrics across all streams
  let allMetrics = [];
  for (const prdDir of prdDirs) {
    const result = metricsModule.loadMetrics(prdDir);
    if (result.success && result.metrics.length > 0) {
      allMetrics = allMetrics.concat(result.metrics);
    }
  }

  if (allMetrics.length === 0) {
    warn("No metrics data found. Run some build iterations first.");
    return 0;
  }

  // Get analytics
  const agentRates = metricsModule.getAgentSuccessRates(allMetrics);
  const switchAnalytics = metricsModule.getSwitchAnalytics(allMetrics);
  const optimalAgents = metricsModule.getOptimalAgentsByStoryType(allMetrics);
  const defaultSuggestion = metricsModule.suggestDefaultAgentChange(allMetrics, "claude");

  if (jsonFlag) {
    console.log(JSON.stringify({
      agentRates,
      switchAnalytics,
      optimalAgents,
      defaultSuggestion,
    }, null, 2));
    return 0;
  }

  console.log("");
  console.log(pc.bold("Agent Switch Analytics"));
  console.log(pc.dim("=".repeat(60)));
  console.log("");

  // Overview
  console.log(pc.bold(pc.cyan("Overview")));
  hr("-", 40);
  console.log(`Total Iterations:       ${pc.bold(switchAnalytics.totalIterations)}`);
  console.log(`Iterations w/ Switches: ${pc.bold(switchAnalytics.iterationsWithSwitches)}`);
  console.log(`Total Switches:         ${pc.bold(switchAnalytics.totalSwitches)}`);
  console.log(`Avg Switches/Iteration: ${pc.bold(switchAnalytics.avgSwitchesPerIteration)}`);
  console.log("");

  // Agent Success Rates
  const agents = Object.keys(agentRates);
  if (agents.length > 0) {
    console.log(pc.bold(pc.cyan("Agent Success Rates")));
    hr("-", 60);
    console.log(pc.dim(`${"AGENT".padEnd(12)} ${"TOTAL".padStart(6)} ${"SUCCESS".padStart(8)} ${"RATE".padStart(8)} ${"AVG DUR".padStart(10)}`));
    hr("-", 60);

    const sortedAgents = agents.sort((a, b) => agentRates[b].successRate - agentRates[a].successRate);
    for (const agent of sortedAgents) {
      const stats = agentRates[agent];
      const total = String(stats.total).padStart(6);
      const successStr = String(stats.success).padStart(8);
      const rateStr = `${stats.successRate}%`.padStart(8);
      const durStr = `${stats.avgDuration}s`.padStart(10);
      const rateColor = stats.successRate >= 80 ? pc.green : stats.successRate >= 50 ? pc.yellow : pc.red;

      console.log(`${agent.padEnd(12)} ${total} ${successStr} ${rateColor(rateStr)} ${durStr}`);
    }
    console.log("");
  }

  // Default Agent Suggestion
  console.log(pc.bold(pc.cyan("Default Agent Recommendation")));
  hr("-", 40);
  if (defaultSuggestion.shouldChange) {
    console.log(`${pc.yellow("⚠")} Recommend changing default agent:`);
    console.log(`  Current: ${pc.dim(defaultSuggestion.currentDefault)}`);
    console.log(`  Suggested: ${pc.green(defaultSuggestion.suggestedDefault)}`);
    console.log(`  Improvement: ${pc.green(`+${defaultSuggestion.improvement}%`)}`);
    console.log(`  Confidence: ${defaultSuggestion.confidence}%`);
  } else {
    console.log(`${pc.green("✓")} ${defaultSuggestion.reason}`);
  }
  console.log("");

  console.log(pc.dim("=".repeat(60)));
  success("Switch analytics generated.");
  return 0;
}

/**
 * Run token usage statistics
 */
async function runTokenStats(args, cwd, jsonFlag) {
  const tokensModule = require("../tokens");
  const metricsModule = require("../estimate/metrics");
  const ralphDir = path.join(cwd, ".ralph");

  if (!exists(ralphDir)) {
    warn("No .ralph directory found. Run some build iterations first.");
    return 0;
  }

  // Collect token data from all PRD-N folders
  const prdDirs = fs.readdirSync(ralphDir)
    .filter((dir) => /^PRD-\d+$/.test(dir))
    .map((dir) => ({
      id: dir.replace("PRD-", ""),
      path: path.join(ralphDir, dir),
    }));

  if (prdDirs.length === 0) {
    warn("No PRD directories found. Run some build iterations first.");
    return 0;
  }

  // Aggregate token data across all streams
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  let totalRuns = 0;
  let totalEstimated = 0;
  const byModel = {};
  const byStream = [];
  const modelSuccessRates = {};

  for (const prdDir of prdDirs) {
    const cache = tokensModule.loadTokenCache(prdDir.path);
    if (!cache || !cache.totals) continue;

    const streamCost = cache.totals.totalCost || 0;
    const streamInputTokens = cache.totals.totalInputTokens || 0;
    const streamOutputTokens = cache.totals.totalOutputTokens || 0;
    const streamRuns = cache.totals.runCount || 0;
    const streamEstimated = cache.totals.estimatedCount || 0;

    totalInputTokens += streamInputTokens;
    totalOutputTokens += streamOutputTokens;
    totalCost += streamCost;
    totalRuns += streamRuns;
    totalEstimated += streamEstimated;

    byStream.push({
      id: prdDir.id,
      inputTokens: streamInputTokens,
      outputTokens: streamOutputTokens,
      cost: streamCost,
      runs: streamRuns,
    });

    // Aggregate by model
    if (cache.byModel) {
      for (const [model, data] of Object.entries(cache.byModel)) {
        if (!byModel[model]) {
          byModel[model] = { inputTokens: 0, outputTokens: 0, cost: 0, runs: 0 };
        }
        byModel[model].inputTokens += data.inputTokens || 0;
        byModel[model].outputTokens += data.outputTokens || 0;
        byModel[model].cost += data.totalCost || 0;
        byModel[model].runs += data.runs || 0;
      }
    }

    // Load metrics to get success/failure rates by model
    const metricsResult = metricsModule.loadMetrics(prdDir.path);
    if (metricsResult.success && metricsResult.metrics.length > 0) {
      for (const m of metricsResult.metrics) {
        const model = m.model || "unknown";
        if (!modelSuccessRates[model]) {
          modelSuccessRates[model] = { success: 0, error: 0, total: 0 };
        }
        modelSuccessRates[model].total++;
        if (m.status === "success") {
          modelSuccessRates[model].success++;
        } else {
          modelSuccessRates[model].error++;
        }
      }
    }
  }

  // Merge success rates into byModel
  for (const [model, rates] of Object.entries(modelSuccessRates)) {
    if (!byModel[model]) {
      byModel[model] = { inputTokens: 0, outputTokens: 0, cost: 0, runs: 0 };
    }
    byModel[model].successCount = rates.success;
    byModel[model].errorCount = rates.error;
    byModel[model].successRate = rates.total > 0 ? Math.round((rates.success / rates.total) * 100) : null;
  }

  if (jsonFlag) {
    console.log(JSON.stringify({
      totalInputTokens,
      totalOutputTokens,
      totalCost,
      totalRuns,
      totalEstimated,
      avgCostPerRun: totalRuns > 0 ? totalCost / totalRuns : 0,
      byModel,
      byStream,
      modelSuccessRates,
    }, null, 2));
    return 0;
  }

  console.log("");
  console.log(pc.bold("Token Usage & Cost Metrics"));
  console.log(pc.dim("=".repeat(60)));
  console.log("");

  // Overview
  console.log(pc.bold(pc.cyan("Overview")));
  hr("-", 40);
  console.log(`Input Tokens:    ${pc.bold(formatTokens(totalInputTokens))}`);
  console.log(`Output Tokens:   ${pc.bold(formatTokens(totalOutputTokens))}`);
  console.log(`Total Tokens:    ${pc.bold(formatTokens(totalInputTokens + totalOutputTokens))}`);
  console.log(`Total Cost:      ${pc.green(formatCost(totalCost))}`);
  console.log(`Total Runs:      ${pc.bold(totalRuns)}`);
  console.log(`Avg Cost/Run:    ${formatCost(totalRuns > 0 ? totalCost / totalRuns : 0)}`);
  if (totalEstimated > 0) {
    console.log(`Estimated Runs:  ${pc.yellow(totalEstimated)} (${Math.round((totalEstimated / totalRuns) * 100)}%)`);
  }
  console.log("");

  // By Model
  const models = Object.keys(byModel);
  if (models.length > 0) {
    console.log(pc.bold(pc.cyan("By Model")));
    hr("-", 70);
    console.log(pc.dim(`${"MODEL".padEnd(12)} ${"TOKENS".padStart(10)} ${"COST".padStart(10)} ${"RUNS".padStart(6)} ${"SUCCESS".padStart(10)}`));
    hr("-", 70);

    for (const model of models) {
      const data = byModel[model];
      const tokens = formatTokens(data.inputTokens + data.outputTokens);
      const cost = formatCost(data.cost);
      const runs = String(data.runs).padStart(6);
      const successRate = data.successRate != null ? `${data.successRate}%` : "N/A";
      const successColor = data.successRate >= 80 ? pc.green : data.successRate >= 60 ? pc.yellow : pc.red;
      console.log(`${model.padEnd(12)} ${tokens.padStart(10)} ${cost.padStart(10)} ${runs} ${data.successRate != null ? successColor(successRate.padStart(10)) : pc.dim(successRate.padStart(10))}`);
    }
    console.log("");
  }

  // By Stream
  if (byStream.length > 0) {
    console.log(pc.bold(pc.cyan("By Stream")));
    hr("-", 60);
    console.log(pc.dim(`${"STREAM".padEnd(10)} ${"TOKENS".padStart(12)} ${"COST".padStart(10)} ${"RUNS".padStart(6)}`));
    hr("-", 60);

    for (const stream of byStream.slice(0, 10)) {
      const name = `PRD-${stream.id}`;
      const tokens = formatTokens(stream.inputTokens + stream.outputTokens);
      const cost = formatCost(stream.cost);
      const runs = String(stream.runs).padStart(6);
      console.log(`${name.padEnd(10)} ${tokens.padStart(12)} ${cost.padStart(10)} ${runs}`);
    }
    if (byStream.length > 10) {
      console.log(pc.dim(`  ... and ${byStream.length - 10} more streams`));
    }
    console.log("");
  }

  console.log(pc.dim("=".repeat(60)));
  success("Token stats generated.");
  return 0;
}

/**
 * Run global (cross-project) statistics
 */
async function runGlobalStats(cwd, jsonFlag) {
  const statsModule = require("../stats");
  const registryModule = require("../registry");
  const { formatDuration: fmtDur } = require("../eval/reporter");

  // Cross-project metrics
  registryModule.ensureGlobalRegistry();
  const projects = registryModule.listProjects();

  if (projects.length === 0) {
    warn("No projects registered in the global registry.");
    info(`Use ${pc.cyan("ralph registry add")} to register projects first.`);
    return 0;
  }

  info(`Aggregating metrics across ${pc.bold(projects.length)} projects...`);
  const metrics = statsModule.aggregateGlobalMetrics(projects);

  if (jsonFlag) {
    console.log(JSON.stringify(metrics, null, 2));
    return 0;
  }

  console.log("");
  console.log(pc.bold("Global Performance Metrics"));
  console.log(pc.dim("=".repeat(60)));
  console.log("");

  // Overview
  console.log(pc.bold(pc.cyan("Overview")));
  hr("-", 40);
  console.log(`Projects:        ${pc.bold(metrics.projectCount)}`);
  console.log(`Total Runs:      ${pc.bold(metrics.totalRuns)}`);
  console.log(`Successful:      ${pc.green(metrics.successCount)} (${metrics.successRate || 0}%)`);
  console.log(`Failed:          ${pc.red(metrics.failedCount)}`);
  console.log(`Avg Duration:    ${fmtDur(metrics.avgDuration)}`);
  console.log(`Total Guardrails:${pc.bold(metrics.totalGuardrails)}`);
  console.log("");

  // Top projects
  if (metrics.topProjects && metrics.topProjects.length > 0) {
    console.log(pc.bold(pc.cyan("Top Projects by Activity")));
    hr("-", 60);
    console.log(pc.dim(`${"PROJECT".padEnd(25)} ${"RUNS".padStart(6)} ${"SUCCESS".padStart(8)} ${"TREND".padStart(10)}`));
    hr("-", 60);

    for (const proj of metrics.topProjects.slice(0, 10)) {
      const name = proj.name.length > 23 ? proj.name.slice(0, 22) + "…" : proj.name;
      const runs = String(proj.runs).padStart(6);
      const rate = proj.successRate !== null ? `${proj.successRate}%`.padStart(8) : "N/A".padStart(8);
      const trend = proj.successRateTrend ? trendArrow(proj.successRateTrend, true) : pc.dim("-");

      console.log(`${name.padEnd(25)} ${runs} ${proj.successRate !== null ? pc.green(rate) : pc.dim(rate)} ${trend.padStart(10)}`);
    }
    console.log("");
  }

  console.log(pc.dim("=".repeat(60)));
  success("Global stats generated.");
  return 0;
}

/**
 * Run local project statistics (default)
 */
async function runLocalStats(cwd, jsonFlag, noCache) {
  const statsModule = require("../stats");
  const { formatDuration: fmtDur } = require("../eval/reporter");
  const ralphDir = path.join(cwd, ".ralph");
  const runsDir = path.join(ralphDir, "runs");

  if (!exists(runsDir)) {
    warn("No runs directory found. Run some build iterations first.");
    return 0;
  }

  // Check cache
  let metrics;
  const cache = statsModule.loadMetricsCache(cwd);
  if (!noCache && cache && statsModule.isCacheValid(cwd, cache)) {
    metrics = cache;
    dim("Using cached metrics (use --no-cache to regenerate)");
  } else {
    metrics = statsModule.aggregateProjectMetrics(cwd);
    statsModule.saveMetricsCache(metrics, cwd);
  }

  if (jsonFlag) {
    console.log(JSON.stringify(metrics, null, 2));
    return 0;
  }

  console.log("");
  console.log(pc.bold("Performance Metrics Dashboard"));
  console.log(pc.dim("=".repeat(60)));
  console.log("");

  // Overview section
  console.log(pc.bold(pc.cyan("Overview")));
  hr("-", 40);
  console.log(`Total Runs:      ${pc.bold(metrics.totalRuns)}`);
  console.log(`Successful:      ${pc.green(metrics.successCount)} (${metrics.successRate || 0}%)`);
  console.log(`Failed:          ${pc.red(metrics.failedCount)}`);
  console.log(`Guardrails:      ${pc.bold(metrics.guardrailCount)}`);
  console.log("");

  // Duration section
  console.log(pc.bold(pc.cyan("Duration")));
  hr("-", 40);
  console.log(`Average:         ${fmtDur(metrics.avgDuration)}`);
  console.log(`Min:             ${fmtDur(metrics.minDuration)}`);
  console.log(`Max:             ${fmtDur(metrics.maxDuration)}`);
  console.log(`Total:           ${fmtDur(metrics.totalDuration)}`);
  console.log("");

  // Trends section
  console.log(pc.bold(pc.cyan("Trends (Week over Week)")));
  hr("-", 40);
  console.log(`Success Rate:    ${trendArrow(metrics.successRateTrend, true)}`);
  console.log(`Avg Duration:    ${trendArrow(metrics.durationTrend, false)}`);
  console.log(`Runs per Day:    ${pc.bold(metrics.runsPerDay)}`);
  console.log("");

  // Mode breakdown
  if (metrics.modeStats && Object.keys(metrics.modeStats).length > 0) {
    console.log(pc.bold(pc.cyan("By Mode")));
    hr("-", 40);
    for (const [mode, stats] of Object.entries(metrics.modeStats)) {
      const rate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
      console.log(`${mode.padEnd(15)} ${String(stats.total).padStart(4)} runs  ${pc.green(`${rate}%`)} success`);
    }
    console.log("");
  }

  // Time range
  if (metrics.firstRun || metrics.lastRun) {
    hr("-", 40);
    if (metrics.firstRun) {
      dim(`First run: ${metrics.firstRun}`);
    }
    if (metrics.lastRun) {
      dim(`Last run:  ${metrics.lastRun}`);
    }
  }

  console.log(pc.dim("=".repeat(60)));
  success(`Metrics cached to ${pc.cyan(".ralph/metrics/stats.json")}`);
  return 0;
}
