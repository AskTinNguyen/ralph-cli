/**
 * Ralph eval command
 * Evaluate run quality and generate reports
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, warn, pc, hasFlag, hr } = require("../cli");
const evalModule = require("../eval");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "eval",
  description: "Evaluate run quality and generate reports",
  usage: "ralph eval [run-id] [--all]",

  help: `
${pc.bold("ralph eval")} ${pc.dim("[run-id] [options]")}

Evaluate the quality of build runs and generate reports.

${pc.bold("Arguments:")}
  ${pc.dim("[run-id]")}             ID of the run to evaluate (partial match supported)

${pc.bold("Options:")}
  ${pc.yellow("--all")}                Evaluate all runs and generate summary

${pc.bold("Examples:")}
  ${pc.dim("ralph eval 2024-01-15")}   Evaluate specific run
  ${pc.dim("ralph eval --all")}        Evaluate all runs
`,

  async run(args, env, options) {
    const { cwd } = options;

    // Check for help flag
    if (hasFlag(args, "help")) {
      console.log(this.help);
      return 0;
    }

    const runsDir = path.join(cwd, ".ralph", "runs");
    const evalDir = path.join(cwd, ".ralph", "evaluations");

    const evalAll = hasFlag(args, "all");
    const runIdArg = args.slice(1).find((a) => !a.startsWith("--"));

    if (!evalAll && !runIdArg) {
      error(`Usage: ${pc.cyan("ralph eval <run-id>")} or ${pc.cyan("ralph eval --all")}`);
      return 1;
    }

    if (!exists(runsDir)) {
      error(`No runs found at ${pc.cyan(runsDir)}`);
      return 1;
    }

    if (evalAll) {
      return evaluateAll(runsDir, evalDir);
    } else {
      return evaluateSingle(runsDir, evalDir, runIdArg);
    }
  },
};

async function evaluateAll(runsDir, evalDir) {
  info("Evaluating all runs...");
  const summaries = evalModule.listRunSummaries(runsDir);

  if (summaries.length === 0) {
    warn("No run summaries found.");
    return 0;
  }

  const scores = [];
  for (const summaryPath of summaries) {
    const score = evalModule.scoreRun(summaryPath);
    if (score) {
      scores.push(score);
      const report = evalModule.generateRunReport(score);
      const outputPath = path.join(evalDir, `eval-${score.runId}.md`);
      evalModule.saveReport(report, outputPath);
    }
  }

  const aggregate = evalModule.aggregateScores(scores);
  if (aggregate) {
    console.log("");
    console.log(pc.bold("Evaluation Summary"));
    hr("-", 50);
    console.log(`Total Runs:      ${pc.bold(aggregate.totalRuns)}`);
    console.log(`Successful:      ${pc.green(aggregate.successCount)} (${aggregate.successRate}%)`);
    console.log(`Failed:          ${pc.red(aggregate.errorCount)}`);
    console.log(`Average Score:   ${pc.bold(aggregate.avgOverall)}/100 (${aggregate.grade})`);
    console.log(`Avg Duration:    ${evalModule.formatDuration(aggregate.avgDuration)}`);
    hr("-", 50);
    console.log("");

    console.log(pc.bold("Score Breakdown"));
    console.log(`  Success:       ${evalModule.scoreBar(aggregate.avgSuccess)}`);
    console.log(`  Verification:  ${evalModule.scoreBar(aggregate.avgVerification)}`);
    console.log(`  Commit:        ${evalModule.scoreBar(aggregate.avgCommit)}`);
    console.log(`  Efficiency:    ${evalModule.scoreBar(aggregate.avgEfficiency)}`);
    console.log("");

    if (aggregate.failurePatterns && aggregate.failurePatterns.length > 0) {
      console.log(pc.bold("Common Failure Patterns"));
      for (const { pattern, count } of aggregate.failurePatterns) {
        const readable = pattern.replace(/_/g, " ").replace(/errors (\d+)/, "$1 errors");
        console.log(`  - ${readable}: ${pc.yellow(count)}`);
      }
      console.log("");
    }

    const summaryReport = evalModule.generateSummaryReport(scores, aggregate);
    const summaryPath = path.join(evalDir, "summary.md");
    evalModule.saveReport(summaryReport, summaryPath);
    success(`Summary report saved to ${pc.cyan(summaryPath)}`);
  }

  return 0;
}

async function evaluateSingle(runsDir, evalDir, runIdArg) {
  const summaries = evalModule.listRunSummaries(runsDir);
  const matchingSummaries = summaries.filter((s) => s.includes(runIdArg));

  if (matchingSummaries.length === 0) {
    error(`No runs found matching "${pc.bold(runIdArg)}"`);
    return 1;
  }

  if (matchingSummaries.length > 1) {
    warn(`Multiple runs match "${runIdArg}":`);
    for (const s of matchingSummaries) {
      console.log(`  - ${path.basename(s)}`);
    }
    info("Please provide a more specific run ID.");
    return 1;
  }

  const summaryPath = matchingSummaries[0];
  const score = evalModule.scoreRun(summaryPath);

  if (!score) {
    error(`Failed to evaluate run at ${pc.cyan(summaryPath)}`);
    return 1;
  }

  const grade = evalModule.gradeScore(score.overall);
  const gradeColor = grade === "A" ? pc.green : grade === "B" ? pc.blue : grade === "C" ? pc.yellow : grade === "D" ? pc.magenta : pc.red;

  console.log("");
  console.log(pc.bold(`Evaluation: ${score.runId}`));
  hr("-", 50);
  console.log(`Grade:           ${gradeColor(pc.bold(grade))} (${score.overall}/100)`);
  console.log(`Status:          ${score.status === "success" ? pc.green(score.status) : pc.red(score.status)}`);
  console.log(`Mode:            ${score.mode || "N/A"}`);
  console.log(`Story:           ${score.story || "N/A"}`);
  console.log(`Duration:        ${evalModule.formatDuration(score.duration)}`);
  hr("-", 50);
  console.log("");

  console.log(pc.bold("Scores"));
  console.log(`  Success:       ${evalModule.scoreBar(score.successScore)}`);
  console.log(`  Verification:  ${evalModule.scoreBar(score.verificationScore)}`);
  console.log(`  Commit:        ${evalModule.scoreBar(score.commitScore)}`);
  console.log(`  Efficiency:    ${evalModule.scoreBar(score.efficiencyScore)}`);
  console.log("");

  console.log(pc.bold("Details"));
  console.log(`  Commits:       ${score.details.commitCount}`);
  console.log(`  Files changed: ${score.details.changedFilesCount}`);
  console.log(`  Clean tree:    ${score.details.hasUncommittedChanges ? pc.yellow("No") : pc.green("Yes")}`);
  console.log(`  Tests passed:  ${score.details.verificationsPassed}`);
  console.log(`  Tests failed:  ${score.details.verificationsFailed}`);
  console.log(`  Errors:        ${score.details.errorCount}`);
  console.log("");

  const report = evalModule.generateRunReport(score);
  const outputPath = path.join(evalDir, `eval-${score.runId}.md`);
  evalModule.saveReport(report, outputPath);
  success(`Report saved to ${pc.cyan(outputPath)}`);

  return 0;
}
