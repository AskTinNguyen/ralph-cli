/**
 * Ralph routing command
 * Analyze routing outcomes and suggest improvements
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, dim, warn, pc, hasFlag, parseFlag, hr } = require("../cli");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "routing",
  description: "Analyze routing outcomes and suggest improvements",
  usage: "ralph routing <command> [options]",

  subcommands: {
    analyze: "Analyze routing outcomes and success rates",
    suggest: "Suggest threshold adjustments",
    learn: "Generate guardrails from routing patterns",
  },

  help: `
${pc.bold("ralph routing")} ${pc.dim("<command>")}

${pc.bold(pc.cyan("Commands:"))}
  ${pc.green("analyze")} ${pc.dim("[--prd N] [--json]")}      Analyze routing outcomes and success rates by model/complexity
  ${pc.green("suggest")} ${pc.dim("[--prd N] [--json]")}      Suggest routing threshold adjustments based on data
  ${pc.green("learn")} ${pc.dim("[--prd N]")}                 Generate guardrails from routing failure patterns

${pc.bold(pc.cyan("Options:"))}
  ${pc.yellow("--prd")} ${pc.dim("<N>")}                       Analyze specific PRD (default: all PRDs)
  ${pc.yellow("--json")}                            Output as JSON for machine parsing

${pc.bold(pc.cyan("Examples:"))}
  ${pc.dim("ralph routing analyze")}              Show success rates by model/complexity
  ${pc.dim("ralph routing suggest --prd=1")}     Get threshold suggestions for PRD-1
  ${pc.dim("ralph routing learn")}               Add routing learnings to guardrails
`,

  async run(args, env, options) {
    const { cwd, prdNumber: globalPrdNumber } = options;
    const routingAnalysis = require("../tokens/routing-analysis");
    const metricsModule = require("../estimate/metrics");
    const estimateModule = require("../estimate");
    const subCmd = args[1];

    const jsonFlag = hasFlag(args, "json");
    let localPrdNumber = globalPrdNumber;

    // Parse --prd flag from args
    for (let i = 2; i < args.length; i++) {
      const arg = args[i];
      if (arg === "--prd" && args[i + 1]) {
        localPrdNumber = args[i + 1];
        i++;
      } else if (arg.startsWith("--prd=")) {
        localPrdNumber = arg.split("=")[1];
      }
    }

    const ralphDir = path.join(cwd, ".ralph");

    if (!subCmd || subCmd === "help" || subCmd === "--help") {
      console.log(this.help);
      return 0;
    }

    // Collect metrics from specified PRD or all PRDs
    let allMetrics = [];

    if (localPrdNumber) {
      const prdFolder = estimateModule.getPRDFolder(ralphDir, localPrdNumber);
      if (!prdFolder) {
        error(`PRD-${localPrdNumber} not found in ${pc.cyan(ralphDir)}`);
        return 1;
      }
      const result = metricsModule.loadMetrics(prdFolder);
      if (result.success) {
        allMetrics = result.metrics;
      }
    } else {
      const prdDirs = exists(ralphDir) ? fs.readdirSync(ralphDir)
        .filter((dir) => /^PRD-\d+$/i.test(dir))
        .map((dir) => path.join(ralphDir, dir)) : [];

      for (const prdDir of prdDirs) {
        const result = metricsModule.loadMetrics(prdDir);
        if (result.success && result.metrics.length > 0) {
          allMetrics = allMetrics.concat(result.metrics);
        }
      }
    }

    if (subCmd === "analyze") {
      const analysis = routingAnalysis.analyzeRoutingOutcomes(allMetrics);

      if (jsonFlag) {
        console.log(routingAnalysis.formatAnalysisJSON(analysis));
      } else {
        if (!analysis.hasData) {
          warn(analysis.message);
          info("Run builds with model routing enabled to start collecting data.");
          return 0;
        }

        console.log("");
        console.log(pc.bold("Routing Analysis"));
        console.log(pc.dim("=".repeat(60)));
        console.log(routingAnalysis.formatAnalysis(analysis));
      }
      return 0;
    }

    if (subCmd === "suggest") {
      const analysis = routingAnalysis.analyzeRoutingOutcomes(allMetrics);

      if (jsonFlag) {
        console.log(JSON.stringify({
          hasData: analysis.hasData,
          recommendations: analysis.recommendations || [],
          patterns: analysis.patterns || [],
        }, null, 2));
        return 0;
      }

      if (!analysis.hasData) {
        warn(analysis.message);
        info("Run builds with model routing enabled to start collecting data.");
        return 0;
      }

      console.log("");
      console.log(pc.bold("Routing Threshold Suggestions"));
      console.log(pc.dim("=".repeat(60)));
      console.log("");

      if (analysis.recommendations.length === 0) {
        success("No threshold adjustments recommended at this time.");
        dim("Current routing configuration appears optimal for your workload.");
        console.log("");

        if (analysis.summary) {
          console.log(pc.bold("Current Performance"));
          hr("-", 40);
          console.log(`Overall success rate: ${pc.green(`${analysis.summary.overallRate}%`)}`);
          if (analysis.summary.bestPerforming) {
            console.log(`Best performing model: ${pc.bold(analysis.summary.bestPerforming.model)} (${analysis.summary.bestPerforming.rate}%)`);
          }
        }
      } else {
        for (const rec of analysis.recommendations) {
          console.log(pc.bold(pc.yellow("→ " + rec.type.replace(/_/g, " ").toUpperCase())));
          console.log(`  ${rec.reason}`);
          if (rec.target) {
            console.log(`  Target: ${pc.cyan(rec.target)}`);
            if (rec.currentExpected !== undefined && rec.suggested !== undefined) {
              console.log(`  Suggested change: ${rec.currentExpected} → ${pc.bold(rec.suggested)}`);
            }
          }
          if (rec.impact) {
            dim(`  Impact: ${rec.impact}`);
          }
          console.log("");
        }

        info("To apply changes, edit your config file:");
        dim(`  ${path.join(cwd, ".agents", "ralph", "config.sh")}`);
      }
      return 0;
    }

    if (subCmd === "learn") {
      const analysis = routingAnalysis.analyzeRoutingOutcomes(allMetrics);

      if (!analysis.hasData) {
        warn(analysis.message);
        info("Run builds with model routing enabled to start collecting data.");
        return 0;
      }

      const guardrailEntry = routingAnalysis.generateGuardrailEntry(analysis);

      if (!guardrailEntry) {
        success("No significant patterns to learn from at this time.");
        dim("Keep running builds to accumulate more routing data.");
        return 0;
      }

      console.log("");
      console.log(pc.bold("Generated Guardrail Entry"));
      console.log(pc.dim("=".repeat(60)));
      console.log("");
      console.log(`${pc.bold("Sign:")} ${guardrailEntry.title}`);
      console.log(`${pc.bold("Trigger:")} ${guardrailEntry.trigger}`);
      console.log(`${pc.bold("Instruction:")} ${guardrailEntry.instruction}`);
      console.log("");

      try {
        const { confirm, isCancel } = await import("@clack/prompts");
        const shouldAdd = await confirm({
          message: "Add this to your guardrails?",
          initialValue: true,
        });

        if (isCancel(shouldAdd) || !shouldAdd) {
          dim("Guardrail not added.");
          return 0;
        }

        const guardrailsPath = path.join(ralphDir, "guardrails.md");
        const result = routingAnalysis.appendGuardrail(guardrailsPath, guardrailEntry);

        if (result.success) {
          success(`Added guardrail to ${pc.cyan(guardrailsPath)}`);
        } else {
          warn(result.error);
        }
      } catch {
        dim("Run interactively to add guardrail automatically.");
      }
      return 0;
    }

    error(`Unknown routing command: ${pc.bold(subCmd)}`);
    info(`Run ${pc.cyan("ralph routing help")} for usage.`);
    return 1;
  },
};
