/**
 * Ralph estimate command
 * Estimate time and cost for PRD
 */
const { success, error, info, dim, warn, pc, hasFlag, hr } = require("../cli");

module.exports = {
  name: "estimate",
  description: "Estimate time and cost for PRD",
  usage: "ralph estimate [--prd=N] [--json] [--accuracy]",

  help: `
${pc.bold("ralph estimate")} ${pc.dim("[options]")}

Estimate time and cost to complete stories in a PRD.

${pc.bold("Options:")}
  ${pc.yellow("--prd")} ${pc.dim("<N>")}           Use PRD-N folder (default: most recent)
  ${pc.yellow("--json")}               Output as JSON
  ${pc.yellow("--accuracy")}           Show estimation accuracy report
  ${pc.yellow("--pricing")} ${pc.dim("<spec>")}    Custom pricing (format: "input:X,output:Y")
  ${pc.yellow("--model")} ${pc.dim("<name>")}      Model for pricing (opus, sonnet, haiku)

${pc.bold("Examples:")}
  ${pc.dim("ralph estimate")}                        Estimate current PRD
  ${pc.dim("ralph estimate --prd=1")}                Estimate PRD-1
  ${pc.dim("ralph estimate --json")}                 Output as JSON
  ${pc.dim("ralph estimate --accuracy")}             Show accuracy report
  ${pc.dim('ralph estimate --pricing "input:3,output:15"')}  Custom pricing
`,

  async run(args, env, options) {
    const { cwd, prdNumber: initialPrdNumber, modelOverride, estimatePricing } = options;
    const estimateModule = require("../estimate");
    const path = require("path");
    const ralphDir = path.join(cwd, ".ralph");

    let prdNumber = initialPrdNumber;
    const jsonOutput = hasFlag(args, "json");
    const accuracyMode = hasFlag(args, "accuracy");

    if (accuracyMode) {
      let prdFolder = null;

      if (prdNumber) {
        prdFolder = estimateModule.getPRDFolder(ralphDir, prdNumber);
        if (!prdFolder) {
          error(`PRD-${prdNumber} not found in ${pc.cyan(ralphDir)}`);
          return 1;
        }
      } else {
        const activePRD = estimateModule.findActivePRD(ralphDir);
        if (!activePRD) {
          error(`No PRD found with plan.md. Run ${pc.cyan("ralph plan")} first.`);
          return 1;
        }
        prdFolder = activePRD.folder;
        prdNumber = activePRD.number;
      }

      const report = estimateModule.accuracy.generateAccuracyReport(prdFolder);

      if (!report.success) {
        error(report.error);
        return 1;
      }

      if (jsonOutput) {
        console.log(estimateModule.accuracy.formatAccuracyJSON(report));
      } else {
        console.log("");
        console.log(pc.bold(`Estimation Accuracy Report for PRD-${prdNumber}`));
        console.log(pc.dim("─".repeat(80)));
        console.log("");

        if (!report.hasData) {
          warn(report.message);
          console.log("");
          dim("Tips to start tracking accuracy:");
          console.log("  1. Run `ralph estimate` before starting a build");
          console.log("  2. Complete builds to generate actual metrics");
          console.log("  3. Run `ralph estimate --accuracy` to compare");
          console.log("");
        } else {
          console.log(estimateModule.accuracy.formatAccuracyReport(report));
          console.log("");

          if (report.trend) {
            const trendColor =
              report.trend.trend === "improving"
                ? pc.green
                : report.trend.trend === "degrading"
                  ? pc.red
                  : pc.yellow;
            console.log(
              trendColor(`Trend: ${report.trend.trendIndicator} ${report.trend.description}`)
            );
          }
          console.log("");
        }
      }

      return 0;
    }

    // Parse custom pricing if provided
    let customPricing = null;
    if (estimatePricing) {
      const pricingParts = estimatePricing.split(",");
      customPricing = {};
      for (const part of pricingParts) {
        const [key, value] = part.split(":");
        if (key && value) {
          const numValue = parseFloat(value);
          if (!isNaN(numValue)) {
            customPricing[key.trim().toLowerCase()] = numValue;
          }
        }
      }
      if (!customPricing.input && !customPricing.output) {
        error(`Invalid --pricing format. Use: --pricing "input:X,output:Y" ($/1M tokens)`);
        return 1;
      }
      if (!customPricing.input) customPricing.input = 3.0;
      if (!customPricing.output) customPricing.output = 15.0;
    }

    const model = modelOverride || "sonnet";

    let prdFolder = null;

    if (prdNumber) {
      prdFolder = estimateModule.getPRDFolder(ralphDir, prdNumber);
      if (!prdFolder) {
        error(`PRD-${prdNumber} not found in ${pc.cyan(ralphDir)}`);
        return 1;
      }
    } else {
      const activePRD = estimateModule.findActivePRD(ralphDir);
      if (!activePRD) {
        error(`No PRD found with plan.md. Run ${pc.cyan("ralph plan")} first.`);
        return 1;
      }
      prdFolder = activePRD.folder;
      prdNumber = activePRD.number;
    }

    const result = estimateModule.estimate({
      prdFolder,
      repoRoot: cwd,
      model: model,
      customPricing: customPricing,
    });

    if (!result.success) {
      error(result.error);
      return 1;
    }

    // Save estimate for accuracy tracking
    if (!jsonOutput) {
      const saveResult = estimateModule.accuracy.saveEstimate(prdFolder, result);
      if (!saveResult.success) {
        warn(`Could not save estimate for accuracy tracking: ${saveResult.error}`);
      }
    }

    if (jsonOutput) {
      const jsonResult = {
        ...result,
        pricing: customPricing || { model: model, source: "default" },
      };
      console.log(estimateModule.formatEstimate(jsonResult, { json: true }));
    } else {
      console.log("");
      console.log(pc.bold(`Build Estimate for PRD-${prdNumber}`));
      console.log(pc.dim("─".repeat(70)));
      console.log("");
      console.log(estimateModule.formatEstimate(result));
      console.log("");

      if (customPricing) {
        info(
          `Using custom pricing: $${customPricing.input}/M input, $${customPricing.output}/M output`
        );
      } else {
        dim(`Using ${model} pricing (use --pricing to override)`);
      }

      const conf = result.totals.confidence;
      if (conf === "low") {
        warn("Confidence: Low (no historical data). Estimates may vary significantly.");
      } else if (conf === "medium") {
        info("Confidence: Medium (limited historical data).");
      } else {
        success("Confidence: High (sufficient historical data).");
      }

      console.log("");
      console.log(pc.dim("Expected range for pending stories:"));
      console.log(
        pc.dim(
          `  Time: ${estimateModule.formatDuration(result.totals.durationOptimistic)} - ${estimateModule.formatDuration(result.totals.durationPessimistic)}`
        )
      );
      console.log(
        pc.dim(
          `  Cost: ${estimateModule.formatter.formatCost(result.totals.costOptimistic)} - ${estimateModule.formatter.formatCost(result.totals.costPessimistic)}`
        )
      );
      console.log("");
    }

    return 0;
  },
};
