/**
 * Ralph registry command
 * Manage project registry
 */
const { success, error, info, dim, warn, pc, hr } = require("../cli");

module.exports = {
  name: "registry",
  description: "Manage project registry",
  usage: "ralph registry <command> [--tags t1,t2]",

  subcommands: {
    add: "Register current project",
    list: "List registered projects",
    remove: "Remove current project",
    update: "Update project metadata",
  },

  help: `
${pc.bold("ralph registry")} ${pc.dim("<command>")}

${pc.bold(pc.cyan("Commands:"))}
  ${pc.green("add")} ${pc.dim("[--tags t1,t2]")}     Register current project in global registry
  ${pc.green("list")} ${pc.dim("[--tags t1,t2]")}    List all registered projects
  ${pc.green("remove")}                 Remove current project from registry
  ${pc.green("update")}                 Update project metadata and stats

${pc.bold(pc.cyan("Options:"))}
  ${pc.yellow("--tags")} ${pc.dim("t1,t2,...")}        Tags for categorization (e.g., typescript, cli, api)

${pc.bold(pc.cyan("Examples:"))}
  ${pc.dim("ralph registry add --tags typescript,cli")}
  ${pc.dim("ralph registry list --tags typescript")}
`,

  async run(args, env, options) {
    const { cwd, rawArgs = [] } = options;
    const registryModule = require("../registry");
    const fs = require("fs");
    const path = require("path");
    const subCmd = args[1];

    function exists(p) {
      try { fs.accessSync(p); return true; } catch { return false; }
    }

    // Parse --tags flag
    let tags = [];
    const argsToCheck = rawArgs.length > 0 ? rawArgs : args;
    for (let i = 0; i < argsToCheck.length; i++) {
      if (argsToCheck[i].startsWith("--tags=")) {
        tags = argsToCheck[i]
          .split("=")
          .slice(1)
          .join("=")
          .split(",")
          .map((t) => t.trim().toLowerCase());
      } else if (argsToCheck[i] === "--tags" && argsToCheck[i + 1]) {
        tags = argsToCheck[i + 1].split(",").map((t) => t.trim().toLowerCase());
      }
    }

    if (!subCmd || subCmd === "help" || subCmd === "--help") {
      console.log(this.help);
      return 0;
    }

    registryModule.ensureGlobalRegistry();

    if (subCmd === "add") {
      const ralphDir = path.join(cwd, ".ralph");
      if (!exists(ralphDir)) {
        warn(`No .ralph directory found at ${pc.cyan(cwd)}`);
        info("Run some Ralph loops first to generate data.");
      }

      const existing = registryModule.findProjectByPath(cwd);
      if (existing) {
        info(`Project already registered: ${pc.bold(existing.name)}`);
        info("Updating metadata and stats...");
      }

      const project = registryModule.addProject(cwd, { tags });
      const indexed = registryModule.indexProject(cwd);

      console.log("");
      console.log(pc.bold("Project Registered"));
      hr("-", 50);
      console.log(`Name:         ${pc.bold(project.name)}`);
      console.log(`Path:         ${pc.dim(project.path)}`);
      console.log(`ID:           ${pc.dim(project.id)}`);
      console.log(
        `Tags:         ${project.tags.length > 0 ? pc.cyan(project.tags.join(", ")) : pc.dim("none")}`
      );
      hr("-", 50);

      if (indexed) {
        console.log(pc.bold("Stats"));
        console.log(`  Guardrails:  ${indexed.stats.guardrailCount}`);
        console.log(`  Progress:    ${indexed.stats.progressCount}`);
        console.log(`  Runs:        ${indexed.stats.runCount}`);
        console.log(
          `  Success:     ${indexed.stats.successRate !== null ? indexed.stats.successRate + "%" : "N/A"}`
        );
        console.log("");
      }

      success(`Registered in ${pc.cyan("~/.ralph/registry.json")}`);
      return 0;
    }

    if (subCmd === "list") {
      const projects = registryModule.listProjects({ tags });

      if (projects.length === 0) {
        if (tags.length > 0) {
          warn(`No projects found with tags: ${tags.join(", ")}`);
        } else {
          warn("No projects registered yet.");
          info(`Use ${pc.cyan("ralph registry add")} to register the current project.`);
        }
        return 0;
      }

      console.log("");
      console.log(pc.bold(`Registered Projects (${projects.length})`));
      hr("-", 80);

      console.log(
        pc.dim(
          `${"NAME".padEnd(20)} ${"RUNS".padStart(6)} ${"SUCCESS".padStart(8)} ${"GUARDRAILS".padStart(11)} ${"TAGS".padEnd(20)}`
        )
      );
      hr("-", 80);

      for (const project of projects) {
        const name = project.name.length > 18 ? project.name.slice(0, 17) + "…" : project.name;
        const runs = String(project.stats.runCount || 0).padStart(6);
        const successRate =
          project.stats.successRate !== null
            ? `${project.stats.successRate}%`.padStart(8)
            : "N/A".padStart(8);
        const guardrails = String(project.stats.guardrailCount || 0).padStart(11);
        const tagsStr = project.tags.slice(0, 3).join(", ");
        const tagsDisplay = tagsStr.length > 18 ? tagsStr.slice(0, 17) + "…" : tagsStr;

        console.log(
          `${name.padEnd(20)} ${runs} ${project.stats.successRate !== null ? pc.green(successRate) : pc.dim(successRate)} ${guardrails} ${pc.cyan(tagsDisplay)}`
        );
      }

      hr("-", 80);
      console.log("");

      if (tags.length > 0) {
        dim(`Filtered by tags: ${tags.join(", ")}`);
      }
      return 0;
    }

    if (subCmd === "remove") {
      const existing = registryModule.findProjectByPath(cwd);
      if (!existing) {
        warn("Current project is not registered.");
        return 0;
      }

      const removed = registryModule.removeProject(cwd);
      if (removed) {
        success(`Removed ${pc.bold(existing.name)} from registry.`);
      } else {
        error("Failed to remove project from registry.");
        return 1;
      }
      return 0;
    }

    if (subCmd === "update") {
      const existing = registryModule.findProjectByPath(cwd);
      if (!existing) {
        warn("Current project is not registered.");
        info(`Use ${pc.cyan("ralph registry add")} to register it first.`);
        return 0;
      }

      info(`Updating ${pc.bold(existing.name)}...`);

      if (tags.length > 0) {
        registryModule.updateProject(cwd, { tags });
      }

      const updated = registryModule.indexProject(cwd);

      if (updated) {
        console.log("");
        console.log(pc.bold("Updated Stats"));
        hr("-", 40);
        console.log(`  Guardrails:  ${updated.stats.guardrailCount}`);
        console.log(`  Progress:    ${updated.stats.progressCount}`);
        console.log(`  Runs:        ${updated.stats.runCount}`);
        console.log(
          `  Success:     ${updated.stats.successRate !== null ? updated.stats.successRate + "%" : "N/A"}`
        );
        if (tags.length > 0) {
          console.log(`  Tags:        ${pc.cyan(updated.tags.join(", "))}`);
        }
        console.log("");
        success("Project metadata updated.");
      }
      return 0;
    }

    error(`Unknown registry command: ${pc.bold(subCmd)}`);
    info(`Run ${pc.cyan("ralph registry help")} for usage.`);
    return 1;
  },
};
