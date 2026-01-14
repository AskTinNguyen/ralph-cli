/**
 * Ralph experiment command
 * Create and manage A/B experiments
 */
const { success, error, info, dim, warn, pc, parseFlag, hr } = require("../cli");

module.exports = {
  name: "experiment",
  description: "Create and manage A/B experiments",
  usage: "ralph experiment <command> [options]",

  subcommands: {
    create: "Create a new A/B experiment",
    list: "List all experiments",
    status: "Show experiment details",
    start: "Start an experiment",
    pause: "Pause an experiment",
    conclude: "Conclude an experiment",
    analyze: "Analyze results with statistics",
  },

  help: `
${pc.bold("ralph experiment")} ${pc.dim("<command>")}

${pc.bold(pc.cyan("Commands:"))}
  ${pc.green("create")} ${pc.dim("<name>")}                 Create a new A/B experiment
  ${pc.green("list")} ${pc.dim("[--status <status>]")}    List all experiments
  ${pc.green("status")} ${pc.dim("<name>")}                Show experiment details and statistics
  ${pc.green("start")} ${pc.dim("<name>")}                 Start an experiment (enable traffic split)
  ${pc.green("pause")} ${pc.dim("<name>")}                 Pause an experiment
  ${pc.green("conclude")} ${pc.dim("<name>")}              Conclude an experiment
  ${pc.green("analyze")} ${pc.dim("<name> [options]")}     Analyze results with statistics

${pc.bold(pc.cyan("Analyze Options:"))}
  ${pc.yellow("--json")}                     Export results as JSON
  ${pc.yellow("--csv")}                      Export results as CSV
  ${pc.yellow("--confidence")} ${pc.dim("<N>")}           Min confidence % for winner (default: 95)

${pc.bold(pc.cyan("Examples:"))}
  ${pc.dim("ralph experiment create claude-vs-codex")}
  ${pc.dim("ralph experiment start claude-vs-codex")}
  ${pc.dim("ralph experiment status claude-vs-codex")}
  ${pc.dim("ralph experiment analyze claude-vs-codex")}
  ${pc.dim("ralph experiment analyze claude-vs-codex --json > results.json")}
  ${pc.dim("ralph experiment list --status running")}
`,

  async run(args, env, options) {
    const { cwd } = options;
    const experimentModule = require("../experiment");
    const subCmd = args[1];
    const experimentName = args[2];

    if (!subCmd || subCmd === "help" || subCmd === "--help") {
      console.log(this.help);
      return 0;
    }

    if (subCmd === "create") {
      if (!experimentName) {
        error("Experiment name is required.");
        info(`Usage: ${pc.cyan("ralph experiment create <name>")}`);
        return 1;
      }

      if (!process.stdin.isTTY) {
        error("Experiment creation requires an interactive terminal.");
        info("Run this command in a terminal that supports user input.");
        return 1;
      }

      const { intro, outro, text, select, isCancel } = await import("@clack/prompts");
      intro("Create A/B Experiment");

      const controlAgent = await select({
        message: "Select the control variant agent:",
        options: [
          { value: "claude", label: "Claude" },
          { value: "codex", label: "Codex" },
          { value: "droid", label: "Droid" },
        ],
        initialValue: "claude",
      });

      if (isCancel(controlAgent)) {
        outro("Cancelled.");
        return 0;
      }

      const treatmentAgent = await select({
        message: "Select the treatment variant agent:",
        options: [
          { value: "codex", label: "Codex" },
          { value: "claude", label: "Claude" },
          { value: "droid", label: "Droid" },
        ].filter((o) => o.value !== controlAgent),
        initialValue: controlAgent === "claude" ? "codex" : "claude",
      });

      if (isCancel(treatmentAgent)) {
        outro("Cancelled.");
        return 0;
      }

      const trafficSplit = await select({
        message: "Select traffic split:",
        options: [
          { value: "50-50", label: "50/50 (equal split)" },
          { value: "80-20", label: "80/20 (control heavy)" },
          { value: "20-80", label: "20/80 (treatment heavy)" },
          { value: "70-30", label: "70/30" },
          { value: "30-70", label: "30/70" },
        ],
        initialValue: "50-50",
      });

      if (isCancel(trafficSplit)) {
        outro("Cancelled.");
        return 0;
      }

      const [controlWeight, treatmentWeight] = trafficSplit.split("-").map(Number);

      const description = await text({
        message: "Description (optional):",
        placeholder: `Compare ${controlAgent} vs ${treatmentAgent} performance`,
        defaultValue: `Compare ${controlAgent} vs ${treatmentAgent} performance`,
      });

      if (isCancel(description)) {
        outro("Cancelled.");
        return 0;
      }

      const minSamplesChoice = await select({
        message: "Minimum samples before analysis:",
        options: [
          { value: 30, label: "30 (quick test)" },
          { value: 50, label: "50 (small experiment)" },
          { value: 100, label: "100 (recommended)" },
          { value: 200, label: "200 (high confidence)" },
        ],
        initialValue: 100,
      });

      if (isCancel(minSamplesChoice)) {
        outro("Cancelled.");
        return 0;
      }

      const result = experimentModule.createQuickExperiment(
        cwd,
        experimentName,
        controlAgent,
        treatmentAgent,
        {
          description: description || `Compare ${controlAgent} vs ${treatmentAgent} performance`,
          controlWeight,
          treatmentWeight,
          minSamples: minSamplesChoice,
        }
      );

      if (!result.success) {
        error(result.error);
        return 1;
      }

      console.log("");
      console.log(pc.bold("Experiment Created"));
      hr("-", 50);
      console.log(`Name:           ${pc.bold(result.experiment.name)}`);
      console.log(`Status:         ${pc.yellow("draft")}`);
      console.log(`Control:        ${pc.cyan(controlAgent)} (${controlWeight}%)`);
      console.log(`Treatment:      ${pc.cyan(treatmentAgent)} (${treatmentWeight}%)`);
      console.log(`Min Samples:    ${minSamplesChoice}`);
      hr("-", 50);
      console.log("");

      success(`Experiment saved to ${pc.cyan(result.path)}`);
      info(`Run ${pc.cyan(`ralph experiment start ${experimentName}`)} to begin.`);

      outro("Done.");
      return 0;
    }

    if (subCmd === "list") {
      let statusFilter = parseFlag(args, "status");

      const result = experimentModule.listExperiments(cwd, { status: statusFilter });

      if (!result.success) {
        error(result.error);
        return 1;
      }

      if (result.experiments.length === 0) {
        if (statusFilter) {
          warn(`No experiments found with status: ${statusFilter}`);
        } else {
          warn("No experiments found.");
          info(`Create one with ${pc.cyan("ralph experiment create <name>")}`);
        }
        return 0;
      }

      console.log("");
      console.log(pc.bold(`Experiments (${result.experiments.length})`));
      hr("-", 70);
      console.log(
        pc.dim(
          `${"NAME".padEnd(25)} ${"STATUS".padEnd(12)} ${"VARIANTS".padEnd(20)} ${"MIN SAMPLES".padStart(12)}`
        )
      );
      hr("-", 70);

      for (const exp of result.experiments) {
        const name = exp.name.length > 23 ? exp.name.slice(0, 22) + "\u2026" : exp.name;
        const statusColor =
          exp.status === "running" ? pc.green
            : exp.status === "paused" ? pc.yellow
            : exp.status === "concluded" ? pc.cyan
            : pc.dim;
        const status = statusColor(exp.status.padEnd(12));
        const variantNames = Object.keys(exp.variants).join(" vs ");
        const variants = variantNames.length > 18 ? variantNames.slice(0, 17) + "\u2026" : variantNames;
        const minSamples = String(exp.minSamples).padStart(12);

        console.log(`${name.padEnd(25)} ${status} ${variants.padEnd(20)} ${minSamples}`);
      }

      hr("-", 70);
      console.log("");
      return 0;
    }

    if (subCmd === "status") {
      if (!experimentName) {
        error("Experiment name is required.");
        info(`Usage: ${pc.cyan("ralph experiment status <name>")}`);
        return 1;
      }

      const result = experimentModule.loadExperiment(cwd, experimentName);

      if (!result.success) {
        error(result.error);
        return 1;
      }

      const exp = result.experiment;
      const statusColor =
        exp.status === "running" ? pc.green
          : exp.status === "paused" ? pc.yellow
          : exp.status === "concluded" ? pc.cyan
          : pc.dim;

      console.log("");
      console.log(pc.bold(`Experiment: ${exp.name}`));
      console.log(pc.dim("=".repeat(60)));
      console.log("");

      console.log(pc.bold(pc.cyan("Configuration")));
      hr("-", 40);
      console.log(`Status:         ${statusColor(exp.status)}`);
      console.log(`Description:    ${exp.description || pc.dim("(none)")}`);
      console.log(`Min Samples:    ${exp.minSamples}`);
      console.log(`Max Samples:    ${exp.maxSamples || pc.dim("unlimited")}`);
      console.log(`Duration:       ${exp.duration ? `${exp.duration} days` : pc.dim("unlimited")}`);
      console.log(`Created:        ${exp.createdAt}`);
      console.log(`Updated:        ${exp.updatedAt}`);
      console.log("");

      console.log(pc.bold(pc.cyan("Variants")));
      hr("-", 40);

      for (const [variantName, variant] of Object.entries(exp.variants)) {
        const agentColor = variant.agent === "claude" ? pc.cyan : variant.agent === "codex" ? pc.green : pc.yellow;
        console.log(`${variantName.padEnd(15)} ${agentColor(variant.agent.padEnd(10))} ${variant.weight}% weight`);
      }
      console.log("");

      console.log(pc.bold(pc.cyan("Metrics Tracked")));
      hr("-", 40);
      console.log(`  ${exp.metrics.join(", ")}`);
      console.log("");

      if (exp.exclusions && exp.exclusions.length > 0) {
        console.log(pc.bold(pc.cyan("Exclusions")));
        hr("-", 40);
        for (const pattern of exp.exclusions) {
          console.log(`  - ${pattern}`);
        }
        console.log("");
      }

      console.log(pc.dim("=".repeat(60)));
      return 0;
    }

    if (subCmd === "start") {
      if (!experimentName) {
        error("Experiment name is required.");
        info(`Usage: ${pc.cyan("ralph experiment start <name>")}`);
        return 1;
      }

      const result = experimentModule.startExperiment(cwd, experimentName);

      if (!result.success) {
        error(result.error);
        return 1;
      }

      success(`Experiment ${pc.bold(experimentName)} is now ${pc.green("running")}.`);
      info("Stories will now be assigned to variants based on traffic split.");
      return 0;
    }

    if (subCmd === "pause") {
      if (!experimentName) {
        error("Experiment name is required.");
        info(`Usage: ${pc.cyan("ralph experiment pause <name>")}`);
        return 1;
      }

      const result = experimentModule.pauseExperiment(cwd, experimentName);

      if (!result.success) {
        error(result.error);
        return 1;
      }

      success(`Experiment ${pc.bold(experimentName)} is now ${pc.yellow("paused")}.`);
      info("No new stories will be assigned to variants.");
      return 0;
    }

    if (subCmd === "conclude") {
      if (!experimentName) {
        error("Experiment name is required.");
        info(`Usage: ${pc.cyan("ralph experiment conclude <name>")}`);
        return 1;
      }

      const result = experimentModule.concludeExperiment(cwd, experimentName);

      if (!result.success) {
        error(result.error);
        return 1;
      }

      success(`Experiment ${pc.bold(experimentName)} is now ${pc.cyan("concluded")}.`);
      info("No further assignments will be made. Results are final.");
      return 0;
    }

    if (subCmd === "analyze") {
      if (!experimentName) {
        error("Experiment name is required.");
        info(`Usage: ${pc.cyan("ralph experiment analyze <name> [--json|--csv]")}`);
        return 1;
      }

      let outputFormat = "terminal";
      let minConfidence = 95;

      for (let i = 3; i < args.length; i++) {
        if (args[i] === "--json") {
          outputFormat = "json";
        } else if (args[i] === "--csv") {
          outputFormat = "csv";
        } else if (args[i].startsWith("--confidence=")) {
          minConfidence = parseInt(args[i].split("=")[1], 10);
        } else if (args[i] === "--confidence" && args[i + 1]) {
          minConfidence = parseInt(args[++i], 10);
        }
      }

      const analysis = experimentModule.analyzeExperiment(cwd, experimentName, {
        minConfidence,
      });

      if (!analysis.success) {
        error(analysis.error);
        return 1;
      }

      if (outputFormat === "json") {
        console.log(experimentModule.exportAsJSON(analysis));
      } else if (outputFormat === "csv") {
        console.log(experimentModule.exportAsCSV(analysis));
      } else {
        console.log(experimentModule.formatForTerminal(analysis));

        if (!analysis.minSamplesReached) {
          warn(`Minimum samples not reached (${analysis.totalSamples}/${analysis.minSamples}).`);
          info("Results may not be statistically valid yet.");
        }

        if (analysis.winner.winner) {
          success(`Winner: ${pc.bold(analysis.winner.winner)} at ${analysis.winner.confidence}% confidence`);
        } else if (analysis.winner.proposedWinner) {
          info(`Proposed winner: ${pc.bold(analysis.winner.proposedWinner)} (needs higher confidence)`);
        }
      }

      return 0;
    }

    error(`Unknown experiment command: ${pc.bold(subCmd)}`);
    info(`Run ${pc.cyan("ralph experiment help")} for usage.`);
    return 1;
  },
};
