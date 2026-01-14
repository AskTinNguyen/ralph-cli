/**
 * Ralph improve command
 * Review and apply guardrail candidates
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, dim, warn, pc, hasFlag } = require("../cli");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "improve",
  description: "Review and apply guardrail candidates",
  usage: "ralph improve [--generate] [--apply]",

  help: `
${pc.bold("ralph improve")} ${pc.dim("[options]")}

Analyze failure patterns and generate guardrail candidates.

${pc.bold("Options:")}
  ${pc.yellow("--generate")}         Regenerate candidates from runs
  ${pc.yellow("--apply")}            Apply candidates to guardrails.md

${pc.bold("Examples:")}
  ${pc.dim("ralph improve")}              Interactive review of candidates
  ${pc.dim("ralph improve --generate")}   Generate new candidates from runs
`,

  async run(args, env, options) {
    const { cwd } = options;
    const improveModule = require("../improve");
    const runsDir = path.join(cwd, ".ralph", "runs");
    const errorsLog = path.join(cwd, ".ralph", "errors.log");
    const candidatesDir = path.join(cwd, ".ralph", "candidates");
    const pendingPath = path.join(candidatesDir, "guardrails-pending.md");
    const guardrailsPath = path.join(cwd, ".ralph", "guardrails.md");

    const generateFlag = hasFlag(args, "generate");
    const applyFlag = hasFlag(args, "apply");

    if (generateFlag) {
      info("Analyzing runs for failure patterns...");

      if (!exists(runsDir)) {
        warn("No runs directory found. Run some iterations first.");
        return 0;
      }

      const candidates = improveModule.analyzeAndGenerate(runsDir, errorsLog, {
        minOccurrences: 1,
      });

      if (candidates.length === 0) {
        success("No significant failure patterns detected.");
        return 0;
      }

      improveModule.saveCandidates(candidates, pendingPath);
      success(`Generated ${pc.bold(candidates.length)} guardrail candidates.`);
      info(`Candidates saved to ${pc.cyan(pendingPath)}`);
      console.log("");
      console.log("Run " + pc.cyan("ralph improve") + " to review and apply them.");
      return 0;
    }

    let candidates = improveModule.loadCandidates(pendingPath);

    if (candidates.length === 0 && !applyFlag) {
      info("No pending candidates. Analyzing runs for failure patterns...");

      if (!exists(runsDir)) {
        warn("No runs directory found. Run some iterations first.");
        return 0;
      }

      candidates = improveModule.analyzeAndGenerate(runsDir, errorsLog, {
        minOccurrences: 1,
      });

      if (candidates.length === 0) {
        success("No significant failure patterns detected.");
        return 0;
      }

      improveModule.saveCandidates(candidates, pendingPath);
      info(`Generated ${pc.bold(candidates.length)} guardrail candidates.`);
    }

    if (candidates.length === 0) {
      success("No pending guardrail candidates to review.");
      return 0;
    }

    if (!process.stdin.isTTY) {
      error("Interactive review requires a terminal.");
      info("Pass --generate to just generate candidates without interactive review.");
      return 1;
    }

    const { intro, outro, select, isCancel } = await import("@clack/prompts");
    intro("Ralph Guardrail Review");

    console.log("");
    console.log(pc.bold(`Found ${candidates.length} guardrail candidate(s) to review.`));
    console.log("");

    const accepted = [];
    const rejected = [];

    for (const candidate of candidates) {
      console.log(pc.dim("─".repeat(60)));
      console.log(pc.bold(pc.cyan(`Candidate: ${candidate.title}`)));
      console.log("");
      console.log(`  ${pc.yellow("Trigger:")}     ${candidate.trigger}`);
      console.log(`  ${pc.yellow("Instruction:")} ${candidate.instruction}`);
      console.log(`  ${pc.yellow("Context:")}     ${candidate.context}`);
      console.log("");
      console.log(pc.dim(`  Occurrences: ${candidate.occurrences}`));
      console.log(
        pc.dim(
          `  Affected runs: ${candidate.affectedRuns.slice(0, 3).join(", ")}${candidate.affectedRuns.length > 3 ? "..." : ""}`
        )
      );
      console.log("");

      const action = await select({
        message: "Apply this guardrail?",
        options: [
          { value: "accept", label: "Yes, add to guardrails.md" },
          { value: "skip", label: "Skip for now" },
          { value: "reject", label: "Reject (remove from candidates)" },
        ],
      });

      if (isCancel(action)) {
        outro("Cancelled. Progress saved.");
        const remaining = candidates.filter(
          (c) => !accepted.find((a) => a.id === c.id) && !rejected.find((r) => r.id === c.id)
        );
        improveModule.saveCandidates(remaining, pendingPath);
        return 0;
      }

      if (action === "accept") {
        accepted.push(candidate);
        success(`  ✓ Accepted: ${candidate.title}`);
      } else if (action === "reject") {
        rejected.push(candidate);
        dim(`  ✗ Rejected: ${candidate.title}`);
      } else {
        dim(`  ○ Skipped: ${candidate.title}`);
      }
    }

    if (accepted.length > 0) {
      console.log("");
      info(`Applying ${accepted.length} guardrail(s) to ${pc.cyan(guardrailsPath)}...`);

      if (!exists(guardrailsPath)) {
        fs.mkdirSync(path.dirname(guardrailsPath), { recursive: true });
        fs.writeFileSync(
          guardrailsPath,
          `# Guardrails (Signs)\n\n> Lessons learned from failures. Read before acting.\n\n## Learned Signs\n\n`
        );
      }

      const acceptedAt = new Date().toISOString();
      let guardrailsContent = fs.readFileSync(guardrailsPath, "utf-8");

      for (const candidate of accepted) {
        const entry = improveModule.formatGuardrailEntry(candidate, acceptedAt);
        guardrailsContent += "\n" + entry;
      }

      fs.writeFileSync(guardrailsPath, guardrailsContent);
      success(`Added ${accepted.length} guardrail(s) to ${pc.cyan("guardrails.md")}`);
    }

    const remaining = candidates.filter(
      (c) => !accepted.find((a) => a.id === c.id) && !rejected.find((r) => r.id === c.id)
    );
    improveModule.saveCandidates(remaining, pendingPath);

    console.log("");
    outro(
      `Done. ${accepted.length} applied, ${rejected.length} rejected, ${remaining.length} pending.`
    );
    return 0;
  },
};
