/**
 * Ralph review command
 * Quality validation for PRDs and implementation plans
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, pc, hasFlag } = require("../cli");
const prdReviewer = require("../review/prd-reviewer");
const planReviewer = require("../review/plan-reviewer");
const reporter = require("../review/reporter");

function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  name: "review",
  description: "Review PRD or plan for quality and completeness",
  usage: "ralph review prd|plan [--prd=N] [--json]",

  help: `
${pc.bold("ralph review")} ${pc.dim("prd|plan [options]")}

Validate PRD or plan quality against industry best practices (Addy Osmani's "Good Spec" principles).

${pc.bold("Subcommands:")}
  ${pc.yellow("prd")}                  Review PRD quality
  ${pc.yellow("plan")}                 Review implementation plan quality

${pc.bold("Options:")}
  ${pc.yellow("--prd=N")}              Specify PRD number (default: latest)
  ${pc.yellow("--json")}               Output results as JSON
  ${pc.yellow("--verbose")}            Show detailed validation info

${pc.bold("Examples:")}
  ${pc.dim("ralph review prd")}        Review latest PRD
  ${pc.dim("ralph review prd --prd=5")} Review PRD-5
  ${pc.dim("ralph review plan")}       Review latest plan
  ${pc.dim("ralph review plan --json")} Review plan with JSON output

${pc.bold("Scoring:")}
  ${pc.green("A (90-100)")}   Production-ready
  ${pc.cyan("B (80-89)")}    Minor improvements needed
  ${pc.yellow("C (70-79)")}    Moderate issues
  ${pc.magenta("D (60-69)")}    Significant rework needed
  ${pc.red("F (<60)")}      Not ready for implementation
`,

  async run(args, env, options) {
    const { cwd } = options;

    // Check for help flag
    if (hasFlag(args, "help")) {
      console.log(this.help);
      return 0;
    }

    const subcommand = args[1];
    if (!subcommand || !["prd", "plan"].includes(subcommand)) {
      error(`Invalid subcommand: ${pc.bold(subcommand || "(none)")}`);
      info(`Usage: ${pc.cyan("ralph review prd")} or ${pc.cyan("ralph review plan")}`);
      return 1;
    }

    const jsonOutput = hasFlag(args, "json");
    const verbose = hasFlag(args, "verbose");

    // Determine PRD folder
    const ralphDir = path.join(cwd, ".ralph");
    if (!exists(ralphDir)) {
      error(`No .ralph directory found in ${pc.cyan(cwd)}`);
      info(`Run ${pc.cyan("ralph prd")} first to create a PRD.`);
      return 1;
    }

    // Get PRD number from options (parsed globally) or find latest
    let prdNumber = options.prdNumber;
    if (!prdNumber) {
      // Find latest PRD
      const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
      const prdDirs = entries
        .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
        .map((e) => ({
          name: e.name,
          num: parseInt(e.name.replace(/PRD-/i, ""), 10),
        }))
        .sort((a, b) => b.num - a.num);

      if (prdDirs.length === 0) {
        error("No PRD directories found.");
        info(`Run ${pc.cyan("ralph prd")} first.`);
        return 1;
      }

      prdNumber = prdDirs[0].num.toString();
    }

    const prdFolder = path.join(ralphDir, `PRD-${prdNumber}`);
    if (!exists(prdFolder)) {
      error(`PRD-${prdNumber} not found at ${pc.cyan(prdFolder)}`);
      return 1;
    }

    // Review based on subcommand
    if (subcommand === "prd") {
      return reviewPRDCommand(prdFolder, jsonOutput, verbose);
    } else if (subcommand === "plan") {
      return reviewPlanCommand(prdFolder, jsonOutput, verbose);
    }

    return 1;
  },
};

/**
 * Review PRD command
 */
function reviewPRDCommand(prdFolder, jsonOutput, verbose) {
  const prdPath = path.join(prdFolder, "prd.md");

  if (!exists(prdPath)) {
    error(`prd.md not found in ${pc.cyan(prdFolder)}`);
    return 1;
  }

  if (!jsonOutput) {
    info(`Reviewing PRD: ${pc.bold(path.basename(prdFolder))}`);
  }

  // Run review
  const result = prdReviewer.reviewPRD(prdPath);

  if (!result.valid) {
    error("PRD review failed:");
    result.issues.forEach((issue) => {
      console.log(`  ${pc.red("✗")} ${issue.message}`);
    });
    return 1;
  }

  // Output results
  if (jsonOutput) {
    console.log(reporter.generateJSONOutput(result));
  } else {
    console.log(reporter.formatTerminalOutput(result));
  }

  // Save markdown report
  const reportPath = reporter.getReportPath(result);
  if (reportPath) {
    reporter.saveReport(result, reportPath);
  }

  // Verbose output
  if (verbose) {
    console.log("");
    console.log(pc.bold("Detailed Breakdown:"));
    console.log(JSON.stringify(result.breakdown, null, 2));
  }

  // Exit code based on grade
  if (result.grade === "F") {
    return 1; // Fail on F grade
  }

  return 0;
}

/**
 * Review plan command
 */
function reviewPlanCommand(prdFolder, jsonOutput, verbose) {
  const planPath = path.join(prdFolder, "plan.md");
  const prdPath = path.join(prdFolder, "prd.md");

  if (!exists(planPath)) {
    error(`plan.md not found in ${pc.cyan(prdFolder)}`);
    info(`Run ${pc.cyan("ralph plan")} first to create a plan.`);
    return 1;
  }

  if (!jsonOutput) {
    info(`Reviewing plan: ${pc.bold(path.basename(prdFolder))}`);
  }

  // Run review (with PRD for cross-validation if available)
  const result = planReviewer.reviewPlan(
    planPath,
    exists(prdPath) ? prdPath : null
  );

  if (!result.valid) {
    error("Plan review failed:");
    result.issues.forEach((issue) => {
      console.log(`  ${pc.red("✗")} ${issue.message}`);
    });
    return 1;
  }

  // Output results
  if (jsonOutput) {
    console.log(reporter.generateJSONOutput(result));
  } else {
    console.log(reporter.formatTerminalOutput(result));
  }

  // Save markdown report
  const reportPath = reporter.getReportPath(result);
  if (reportPath) {
    reporter.saveReport(result, reportPath);
  }

  // Verbose output
  if (verbose) {
    console.log("");
    console.log(pc.bold("Detailed Breakdown:"));
    console.log(JSON.stringify(result.breakdown, null, 2));
  }

  // Exit code based on grade
  if (result.grade === "F") {
    return 1; // Fail on F grade
  }

  return 0;
}
