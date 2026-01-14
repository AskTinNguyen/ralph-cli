/**
 * Ralph optimize command
 * Analyze and improve prompt templates
 */
const fs = require("fs");
const path = require("path");
const { success, error, info, dim, warn, pc, hasFlag, hr } = require("../cli");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "optimize",
  description: "Analyze and improve prompt templates",
  usage: "ralph optimize <type> [options]",

  subcommands: {
    prompts: "Analyze prompt effectiveness and generate suggestions",
  },

  help: `
${pc.bold("ralph optimize")} ${pc.dim("<type>")}

${pc.bold(pc.cyan("Commands:"))}
  ${pc.green("prompts")}                    Analyze prompt effectiveness and generate suggestions
  ${pc.green("prompts")} ${pc.dim("--init")}           Initialize version tracking for prompt templates
  ${pc.green("prompts")} ${pc.dim("--versions")}       Show prompt version effectiveness comparison
  ${pc.green("prompts")} ${pc.dim("--apply")}          Review and apply suggestions interactively

${pc.bold(pc.cyan("Options:"))}
  ${pc.yellow("--init")}                     Initialize version tracking (adds version comments)
  ${pc.yellow("--versions")}                 Show effectiveness comparison by version
  ${pc.yellow("--apply")}                    Interactively review and apply suggestions

${pc.bold(pc.cyan("Examples:"))}
  ${pc.dim("ralph optimize prompts")}              Generate suggestions based on run analysis
  ${pc.dim("ralph optimize prompts --versions")}   Compare success rates across versions
  ${pc.dim("ralph optimize prompts --apply")}      Apply selected suggestions to templates
`,

  async run(args, env, options) {
    const { cwd } = options;
    const optimizeModule = require("../optimize");
    const subCmd = args[1];

    const applyFlag = hasFlag(args, "apply");
    const versionsFlag = hasFlag(args, "versions");
    const initFlag = hasFlag(args, "init");

    if (!subCmd || subCmd === "help" || subCmd === "--help") {
      console.log(this.help);
      return 0;
    }

    if (subCmd === "prompts") {
      const ralphDir = path.join(cwd, ".ralph");
      const runsDir = path.join(ralphDir, "runs");
      const templatePath = path.join(cwd, ".agents", "ralph", "PROMPT_build.md");
      const suggestionsPath = optimizeModule.getSuggestionsPath(cwd);

      if (initFlag) {
        info("Initializing prompt template versions...");
        const templates = optimizeModule.initializeVersions(cwd);

        if (templates.length === 0) {
          warn("No prompt templates found in .agents/ralph/");
          info(`Run ${pc.cyan("ralph install")} first to set up templates.`);
          return 0;
        }

        console.log("");
        console.log(pc.bold("Prompt Templates"));
        hr("-", 50);
        for (const template of templates) {
          const status =
            template.action === "initialized" ? pc.green("initialized") : pc.dim("exists");
          console.log(`  ${template.name}: v${template.version} (${status})`);
        }
        console.log("");
        success("Version tracking initialized.");
        return 0;
      }

      if (versionsFlag) {
        const versions = optimizeModule.getVersionComparison(cwd);

        if (versions.length === 0) {
          warn("No version metrics found.");
          info(`Run ${pc.cyan("ralph optimize prompts --init")} to initialize version tracking.`);
          return 0;
        }

        console.log("");
        console.log(pc.bold("Prompt Version Effectiveness"));
        console.log(pc.dim("=".repeat(60)));
        console.log("");
        console.log(
          pc.dim(
            `${"VERSION".padEnd(12)} ${"RUNS".padStart(6)} ${"SUCCESS".padStart(9)} ${"AVG DUR".padStart(10)} ${"STATUS".padEnd(10)}`
          )
        );
        hr("-", 60);

        for (const v of versions) {
          const version = v.version.padEnd(12);
          const runs = String(v.runs).padStart(6);
          const rate = v.successRate != null ? `${v.successRate}%`.padStart(9) : "N/A".padStart(9);
          const dur = v.avgDuration != null ? `${v.avgDuration}s`.padStart(10) : "N/A".padStart(10);
          const status = v.isCurrent ? pc.green("current") : pc.dim("previous");

          const rateColor =
            v.successRate >= 70 ? pc.green : v.successRate >= 50 ? pc.yellow : pc.red;
          console.log(
            `${version} ${runs} ${v.successRate != null ? rateColor(rate) : pc.dim(rate)} ${dur} ${status}`
          );
        }
        hr("-", 60);
        console.log("");

        if (versions.length > 1) {
          const best = versions[0];
          const current = versions.find((v) => v.isCurrent);
          if (
            current &&
            best.version !== current.version &&
            best.successRate > (current.successRate || 0)
          ) {
            const improvement = (best.successRate || 0) - (current.successRate || 0);
            warn(`Version ${best.version} has ${improvement}% higher success rate than current.`);
            info("Consider reverting recent prompt changes.");
          }
        }
        return 0;
      }

      if (!exists(runsDir)) {
        warn("No runs directory found. Run some build iterations first.");
        return 0;
      }

      info("Analyzing prompt effectiveness...");
      const result = optimizeModule.generateAllSuggestions(cwd, templatePath);

      if (result.error) {
        error(result.error);
        return 1;
      }

      const { suggestions, analysis, categories } = result;

      optimizeModule.saveSuggestions(suggestions, analysis, suggestionsPath);

      console.log("");
      console.log(pc.bold("Prompt Analysis Summary"));
      console.log(pc.dim("=".repeat(60)));
      console.log(`Template:        ${pc.dim(path.basename(templatePath))}`);
      console.log(`Sections:        ${analysis.sectionCount}`);
      console.log(`Instructions:    ${analysis.instructionCount}`);
      console.log(`Runs analyzed:   ${analysis.runsAnalyzed}`);
      hr("-", 60);
      console.log("");

      if (categories) {
        if (categories.consistentlyFollowed.length > 0) {
          console.log(pc.bold(pc.green("Consistently Followed Instructions")));
          for (const c of categories.consistentlyFollowed.slice(0, 3)) {
            const text = c.text.length > 60 ? c.text.slice(0, 57) + "..." : c.text;
            console.log(`  ${pc.green("✓")} ${text}`);
            dim(`    Follow rate: ${c.followRate}%`);
          }
          console.log("");
        }

        if (categories.consistentlyIgnored.length > 0) {
          console.log(pc.bold(pc.yellow("Consistently Ignored Instructions")));
          for (const c of categories.consistentlyIgnored.slice(0, 3)) {
            const text = c.text.length > 60 ? c.text.slice(0, 57) + "..." : c.text;
            console.log(`  ${pc.yellow("○")} ${text}`);
            dim(`    Follow rate: ${c.followRate}%`);
          }
          console.log("");
        }
      }

      if (suggestions.length === 0) {
        success("No significant improvement suggestions at this time.");
        dim("Continue running iterations to gather more data.");
      } else {
        console.log(pc.bold(`Generated ${suggestions.length} Suggestion(s)`));
        hr("-", 50);

        const byPriority = {
          high: suggestions.filter((s) => s.priority === "high"),
          medium: suggestions.filter((s) => s.priority === "medium"),
          low: suggestions.filter((s) => s.priority === "low"),
        };

        if (byPriority.high.length > 0) {
          console.log(`  ${pc.red("●")} High priority:   ${byPriority.high.length}`);
        }
        if (byPriority.medium.length > 0) {
          console.log(`  ${pc.yellow("●")} Medium priority: ${byPriority.medium.length}`);
        }
        if (byPriority.low.length > 0) {
          console.log(`  ${pc.dim("●")} Low priority:    ${byPriority.low.length}`);
        }
        console.log("");

        success(`Suggestions saved to ${pc.cyan(".ralph/candidates/prompt-suggestions.md")}`);
        console.log("");
        info(`Run ${pc.cyan("ralph optimize prompts --apply")} to review and apply suggestions.`);
      }

      if (applyFlag && suggestions.length > 0) {
        if (!process.stdin.isTTY) {
          error("Interactive apply requires a terminal.");
          info("Run without --apply to just generate suggestions.");
          return 1;
        }
        const { intro, outro, select, isCancel } = await import("@clack/prompts");

        console.log("");
        intro("Apply Prompt Suggestions");

        for (const suggestion of suggestions) {
          console.log("");
          hr("-", 60);
          const priorityColor =
            suggestion.priority === "high"
              ? pc.red
              : suggestion.priority === "medium"
                ? pc.yellow
                : pc.dim;
          console.log(
            `${priorityColor(`[${suggestion.priority}]`)} ${pc.bold(suggestion.type)}: ${suggestion.section}`
          );
          console.log("");

          if (suggestion.instruction) {
            console.log(`${pc.cyan("Instruction:")} "${suggestion.instruction}"`);
          }
          console.log(`${pc.yellow("Why:")} ${suggestion.reason}`);
          console.log(`${pc.green("Suggestion:")} ${suggestion.suggestion}`);
          console.log("");

          if (suggestion.metrics) {
            dim("Metrics:");
            for (const [key, value] of Object.entries(suggestion.metrics)) {
              if (value != null) {
                const label = key.replace(/([A-Z])/g, " $1").trim();
                dim(
                  `  ${label}: ${typeof value === "number" && key.includes("Rate") ? value + "%" : value}`
                );
              }
            }
          }
          console.log("");

          const action = await select({
            message: "What would you like to do?",
            options: [
              { value: "note", label: "Note for later (keep in suggestions)" },
              { value: "dismiss", label: "Dismiss (remove from suggestions)" },
              { value: "skip", label: "Skip for now" },
            ],
          });

          if (isCancel(action)) {
            outro("Review cancelled. Suggestions preserved.");
            return 0;
          }

          if (action === "dismiss") {
            dim(`  Dismissed: ${suggestion.id}`);
            const idx = suggestions.indexOf(suggestion);
            if (idx >= 0) {
              suggestions.splice(idx, 1);
            }
          } else if (action === "note") {
            success(`  Noted: ${suggestion.id}`);
          } else {
            dim(`  Skipped: ${suggestion.id}`);
          }
        }

        optimizeModule.saveSuggestions(suggestions, analysis, suggestionsPath);
        outro(`Done. ${suggestions.length} suggestions remaining.`);
      }

      return 0;
    }

    error(`Unknown optimize type: ${pc.bold(subCmd)}`);
    info(`Run ${pc.cyan("ralph optimize help")} for usage.`);
    return 1;
  },
};
