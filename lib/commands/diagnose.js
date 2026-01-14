/**
 * Ralph diagnose command
 * Detect failure patterns and provide fixes
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, dim, warn, pc, hasFlag, parseFlag, parseNumericFlag, hr } = require("../cli");
const diagnoseModule = require("../diagnose");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "diagnose",
  description: "Detect failure patterns and provide fixes",
  usage: "ralph diagnose [--run id] [--json] [--limit N]",

  help: `
${pc.bold("ralph diagnose")} ${pc.dim("[options]")}

Analyze build runs to detect failure patterns and suggest fixes.

${pc.bold("Options:")}
  ${pc.yellow("--run")} ${pc.dim("<id>")}        Analyze a specific run only
  ${pc.yellow("--json")}              Output results as JSON
  ${pc.yellow("--limit")} ${pc.dim("<N>")}        Limit number of errors to analyze (default: 500)

${pc.bold("Examples:")}
  ${pc.dim("ralph diagnose")}                    Analyze all runs
  ${pc.dim("ralph diagnose --run 2024-01")}      Analyze specific run
  ${pc.dim("ralph diagnose --json")}             Output as JSON
`,

  async run(args, env, options) {
    const { cwd } = options;

    const runIdFilter = parseFlag(args, "run");
    const jsonFlag = hasFlag(args, "json");
    const limitValue = parseNumericFlag(args, "limit", 500);

    const results = diagnoseModule.diagnose(cwd, {
      runId: runIdFilter,
      limit: limitValue,
    });

    if (!results.success) {
      error(results.error);
      return 1;
    }

    if (jsonFlag) {
      console.log(JSON.stringify(results, null, 2));
      return 0;
    }

    // Console output
    console.log("");
    console.log(pc.bold("Failure Pattern Diagnosis"));
    console.log(pc.dim("=".repeat(70)));

    if (runIdFilter) {
      info(`Analyzing run: ${pc.bold(runIdFilter)}`);
    } else {
      info("Analyzing all runs");
    }
    console.log("");

    // Summary
    console.log(pc.bold(pc.cyan("Summary")));
    hr("-", 50);
    console.log(`Total Errors:     ${pc.bold(results.summary.totalErrors)}`);
    console.log(`Unique Patterns:  ${pc.bold(results.summary.totalClusters)}`);
    console.log(`Affected Runs:    ${pc.bold(results.summary.uniqueRuns)}`);
    console.log("");

    if (results.patterns.length === 0) {
      success("No failure patterns detected. All systems operational.");
      return 0;
    }

    // Type breakdown
    if (Object.keys(results.summary.typeBreakdown).length > 0) {
      console.log(pc.bold(pc.cyan("Error Type Breakdown")));
      hr("-", 50);
      for (const [type, stats] of Object.entries(results.summary.typeBreakdown)) {
        const typeLabel = type.replace(/_/g, " ");
        console.log(`  ${typeLabel.padEnd(25)} ${String(stats.count).padStart(4)} errors in ${stats.clusters} patterns`);
      }
      console.log("");
    }

    // Top failure patterns
    console.log(pc.bold(pc.cyan("Top Failure Patterns")));
    hr("-", 70);
    console.log(pc.dim(`${"ROOT CAUSE".padEnd(25)} ${"COUNT".padStart(6)} ${"RUNS".padStart(6)} ${"SEVERITY".padStart(10)}`));
    hr("-", 70);

    for (const pattern of results.patterns.slice(0, 10)) {
      const label = pattern.rootCauseLabel.length > 23 ? pattern.rootCauseLabel.slice(0, 22) + "…" : pattern.rootCauseLabel;
      const count = String(pattern.count).padStart(6);
      const runs = String(pattern.runs.length).padStart(6);
      const severityColor = pattern.severity === "critical" ? pc.red : pattern.severity === "high" ? pc.yellow : pattern.severity === "medium" ? pc.cyan : pc.dim;
      const severity = severityColor(pattern.severity.toUpperCase().padStart(10));

      console.log(`${label.padEnd(25)} ${count} ${runs} ${severity}`);

      const shortError = pattern.representative.length > 65 ? pattern.representative.slice(0, 62) + "..." : pattern.representative;
      dim(`  ${pc.dim("→")} ${shortError}`);
    }

    hr("-", 70);
    console.log("");

    // Remediation suggestions
    if (results.suggestions.length > 0) {
      console.log(pc.bold(pc.cyan("Recommended Actions")));
      hr("-", 70);
      console.log("");

      for (const suggestion of results.suggestions.slice(0, 5)) {
        const severityColor = suggestion.severity === "critical" ? pc.red : suggestion.severity === "high" ? pc.yellow : suggestion.severity === "medium" ? pc.cyan : pc.dim;

        console.log(`${severityColor("●")} ${pc.bold(suggestion.label)} (${suggestion.totalOccurrences} occurrences)`);

        for (const step of suggestion.remediation.slice(0, 2)) {
          console.log(`  ${pc.dim("→")} ${step}`);
        }
        console.log("");
      }

      hr("-", 70);
    }

    // Agent recommendations
    const ralphDir = path.join(cwd, ".ralph");
    if (exists(ralphDir)) {
      try {
        const metricsModule = require("../estimate/metrics");
        const prdDirs = fs.readdirSync(ralphDir)
          .filter(d => d.match(/^PRD-\d+$/))
          .map(d => path.join(ralphDir, d));

        let allMetrics = [];
        for (const prdDir of prdDirs) {
          const result = metricsModule.loadMetrics(prdDir);
          if (result.success && result.metrics.length > 0) {
            allMetrics = allMetrics.concat(result.metrics);
          }
        }

        if (allMetrics.length > 0) {
          const agentStats = metricsModule.getAgentSuccessRates(allMetrics);
          const agents = Object.keys(agentStats);

          if (agents.length > 0) {
            console.log(pc.bold(pc.cyan("Agent Performance Analysis")));
            hr("-", 70);
            console.log("");

            console.log(pc.dim(`${"AGENT".padEnd(15)} ${"SUCCESS RATE".padStart(13)} ${"RUNS".padStart(6)} ${"STORIES".padStart(8)}`));
            hr("-", 50);

            const sortedAgents = agents.sort((a, b) => (agentStats[b].successRate || 0) - (agentStats[a].successRate || 0));
            for (const agent of sortedAgents) {
              const stats = agentStats[agent];
              const rateStr = `${stats.successRate}%`.padStart(13);
              const runsStr = String(stats.total).padStart(6);
              const storiesStr = String(stats.storyCount || 0).padStart(8);
              const rateColor = stats.successRate >= 70 ? pc.green : stats.successRate >= 50 ? pc.yellow : pc.red;
              console.log(`${agent.padEnd(15)} ${rateColor(rateStr)} ${runsStr} ${storiesStr}`);
            }

            console.log("");
            const bestAgent = sortedAgents[0];
            const bestStats = agentStats[bestAgent];
            if (bestStats && bestStats.total >= 3) {
              info(`Recommended agent: ${pc.bold(bestAgent)} (${bestStats.successRate}% success rate over ${bestStats.total} runs)`);
            }
            console.log("");
            hr("-", 70);
          }
        }
      } catch {
        // Ignore metrics errors
      }
    }

    // Save report
    const reportPath = path.join(cwd, ".ralph", "diagnosis.md");
    diagnoseModule.saveDiagnosisReport(results, reportPath);
    success(`Full report saved to ${pc.cyan(reportPath)}`);

    return 0;
  },
};
