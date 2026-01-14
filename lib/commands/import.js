/**
 * Ralph import command
 * Import guardrails from another project
 */
const { success, error, info, dim, warn, pc, parseFlag, hasFlag, hr } = require("../cli");

module.exports = {
  name: "import",
  description: "Import guardrails from another project",
  usage: "ralph import <type> [--from project]",

  subcommands: {
    guardrails: "Import guardrails from another project",
  },

  help: `
${pc.bold("ralph import")} ${pc.dim("<type>")}

${pc.bold(pc.cyan("Commands:"))}
  ${pc.green("guardrails")} ${pc.dim("[--from project]")}   Import guardrails from another project

${pc.bold(pc.cyan("Options:"))}
  ${pc.yellow("--from")} ${pc.dim("<project>")}            Source project (name or ID)
  ${pc.yellow("--all")}                      Import all guardrails without selection

${pc.bold(pc.cyan("Examples:"))}
  ${pc.dim("ralph import guardrails")}                 Interactive project selection
  ${pc.dim("ralph import guardrails --from myapp")}   Import from specific project
  ${pc.dim("ralph import guardrails --all")}          Import all without prompting
`,

  async run(args, env, options) {
    const { cwd, rawArgs = [] } = options;
    const importModule = require("../import");
    const registryModule = require("../registry");
    const { detectTechStack } = require("../registry/projects");
    const subCmd = args[1];

    // Parse --from flag
    let fromProject = parseFlag(args, "from");
    // Also check rawArgs for --from
    if (!fromProject) {
      const argsToCheck = rawArgs.length > 0 ? rawArgs : args;
      for (let i = 0; i < argsToCheck.length; i++) {
        if (argsToCheck[i].startsWith("--from=")) {
          fromProject = argsToCheck[i].split("=").slice(1).join("=");
        } else if (argsToCheck[i] === "--from" && argsToCheck[i + 1]) {
          fromProject = argsToCheck[i + 1];
          i++;
        }
      }
    }
    const importAll = hasFlag(args, "all");

    if (!subCmd || subCmd === "help" || subCmd === "--help") {
      console.log(this.help);
      return 0;
    }

    if (subCmd === "guardrails") {
      registryModule.ensureGlobalRegistry();

      let projects = registryModule.listProjects();

      if (projects.length === 0) {
        warn("No projects registered in the global registry.");
        info(`Use ${pc.cyan("ralph registry add")} in other projects first.`);
        return 0;
      }

      const currentProject = registryModule.findProjectByPath(cwd);
      projects = projects.filter((p) => p.path !== cwd);

      if (projects.length === 0) {
        warn("No other projects available to import from.");
        info("Register other projects with Ralph first.");
        return 0;
      }

      const targetStack = detectTechStack(cwd);
      const suggestedProjects = importModule.getSuggestedProjects(projects, targetStack);

      let selectedProject = null;

      if (fromProject) {
        selectedProject = suggestedProjects.find(
          (p) => p.name.toLowerCase() === fromProject.toLowerCase() || p.id === fromProject
        );
        if (!selectedProject) {
          error(`Project not found: ${pc.bold(fromProject)}`);
          info("Available projects:");
          for (const p of suggestedProjects.slice(0, 5)) {
            dim(`  - ${p.name} (${p.id})`);
          }
          return 1;
        }
      } else {
        if (!process.stdin.isTTY) {
          error("Interactive import requires a terminal.");
          info(`Use ${pc.cyan("ralph import guardrails --from <project>")} to specify a project.`);
          return 1;
        }
        const { intro, outro, select, isCancel } = await import("@clack/prompts");
        intro("Ralph Guardrails Import");

        console.log("");
        if (targetStack.length > 0) {
          info(`Detected tech stack: ${pc.cyan(targetStack.join(", "))}`);
          console.log("");
        }

        const projectOptions = suggestedProjects.map((p) => {
          const guardrailCount = p.stats?.guardrailCount || 0;
          const matchInfo = p.matchingTags?.length > 0 ? ` (${p.matchingTags.join(", ")})` : "";
          const recommended = p.relevanceScore > 0 ? pc.green(" [Recommended]") : "";
          return {
            value: p.id,
            label: `${p.name}${recommended}`,
            hint: `${guardrailCount} guardrails${matchInfo}`,
          };
        });

        if (projectOptions.length === 0) {
          outro("No projects with guardrails available.");
          return 0;
        }

        const selectedId = await select({
          message: "Select a project to import guardrails from:",
          options: projectOptions,
        });

        if (isCancel(selectedId)) {
          outro("Cancelled.");
          return 0;
        }

        selectedProject = suggestedProjects.find((p) => p.id === selectedId);
      }

      if (!selectedProject) {
        error("No project selected.");
        return 1;
      }

      info(`Loading guardrails from ${pc.bold(selectedProject.name)}...`);

      const guardrails = importModule.getProjectGuardrails(selectedProject.path);

      if (guardrails.length === 0) {
        warn(`No guardrails found in ${selectedProject.name}.`);
        return 0;
      }

      let selectedGuardrails = guardrails;

      if (!importAll) {
        if (!process.stdin.isTTY) {
          error("Interactive guardrail selection requires a terminal.");
          info(`Use ${pc.cyan("--all")} to import all guardrails without prompting.`);
          return 1;
        }
        const { multiselect, isCancel, outro } = await import("@clack/prompts");

        console.log("");
        console.log(pc.bold(`Found ${guardrails.length} guardrail(s) in ${selectedProject.name}:`));
        hr("-", 60);

        for (const g of guardrails) {
          console.log(`  ${pc.cyan("•")} ${pc.bold(g.title)}`);
          if (g.trigger) {
            console.log(`    ${pc.dim("Trigger:")} ${g.trigger}`);
          }
          if (g.instruction) {
            console.log(`    ${pc.dim("Instruction:")} ${g.instruction}`);
          }
          console.log("");
        }
        hr("-", 60);
        console.log("");

        const guardrailOptions = guardrails.map((g, idx) => ({
          value: idx,
          label: g.title,
          hint: g.trigger || g.instruction || "",
        }));

        const selectedIndices = await multiselect({
          message: "Select guardrails to import:",
          options: guardrailOptions,
          required: false,
        });

        if (isCancel(selectedIndices)) {
          outro("Cancelled.");
          return 0;
        }

        if (!selectedIndices || selectedIndices.length === 0) {
          outro("No guardrails selected.");
          return 0;
        }

        selectedGuardrails = selectedIndices.map((idx) => guardrails[idx]);
      }

      const result = importModule.importGuardrails(selectedGuardrails, cwd, selectedProject.name);

      console.log("");
      if (result.imported > 0) {
        success(
          `Imported ${pc.bold(result.imported)} guardrail(s) from ${pc.cyan(selectedProject.name)}`
        );
        info(`Guardrails saved to ${pc.cyan(".ralph/guardrails.md")}`);
      }
      if (result.skipped > 0) {
        dim(`Skipped ${result.skipped} duplicate(s).`);
      }

      const { outro } = await import("@clack/prompts");
      outro("Done.");
      return 0;
    }

    error(`Unknown import type: ${pc.bold(subCmd)}`);
    info(`Run ${pc.cyan("ralph import help")} for usage.`);
    return 1;
  },
};
