/**
 * Ralph install command
 * Copy .agents/ralph into current repo
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { success, error, info, dim, warn, pc, hasFlag } = require("../cli");

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = {
  name: "install",
  description: "Copy .agents/ralph into current repo",
  usage: "ralph install [--skills] [--force] [--import-from <project>]",

  help: `
${pc.bold("ralph install")} ${pc.dim("[options]")}

Install Ralph templates into the current project.

${pc.bold("Options:")}
  ${pc.yellow("--skills")}                   Also install skills (commit, dev-browser, prd)
  ${pc.yellow("--force")}                    Overwrite existing templates
  ${pc.yellow("--import-from")} ${pc.dim("<project>")}   Import guardrails from another project

${pc.bold("Examples:")}
  ${pc.dim("ralph install")}                        Basic install
  ${pc.dim("ralph install --skills")}               Install with skills
  ${pc.dim("ralph install --import-from myapp")}    Install and import guardrails
`,

  async run(args, env, options) {
    const { cwd, repoRoot, globalDir, localDir, installSkills, installForce, importFromProject } = options;

    // Install templates
    if (exists(localDir) && !installForce) {
      dim(`.agents/ralph already exists at ${pc.cyan(localDir)}. Skipping templates.`);
    } else {
      if (!exists(globalDir)) {
        error(`Bundled templates not found at ${pc.cyan(globalDir)}.`);
        return 1;
      }
      fs.mkdirSync(path.dirname(localDir), { recursive: true });
      fs.cpSync(globalDir, localDir, { recursive: true, force: true });
      success(`Installed .agents/ralph to ${pc.cyan(localDir)}`);
    }

    // Copy README and images
    const readmeSrc = path.join(repoRoot, "README.md");
    const diagramSrc = path.join(repoRoot, "diagram.svg");
    const imageSrc = path.join(repoRoot, "ralph.webp");
    if (exists(localDir)) {
      if (exists(readmeSrc)) fs.copyFileSync(readmeSrc, path.join(localDir, "README.md"));
      if (exists(diagramSrc)) fs.copyFileSync(diagramSrc, path.join(localDir, "diagram.svg"));
      if (exists(imageSrc)) fs.copyFileSync(imageSrc, path.join(localDir, "ralph.webp"));
    }

    // Skills installation
    if (installSkills) {
      await runInstallSkills(options);
    } else {
      try {
        const { confirm, isCancel } = await import("@clack/prompts");
        const wantsSkills = await confirm({
          message: "Install skills (commit + dev-browser + prd)?",
          initialValue: true,
        });
        if (!isCancel(wantsSkills) && wantsSkills) {
          await runInstallSkills(options);
        }
      } catch {
        dim("Skipped skills install (non-interactive).");
      }
    }

    // Handle --import-from flag
    if (importFromProject) {
      const importModule = require("../import");
      const registryModule = require("../registry");

      registryModule.ensureGlobalRegistry();
      const projects = registryModule.listProjects();
      const sourceProject = projects.find(
        (p) => p.name.toLowerCase() === importFromProject.toLowerCase() || p.id === importFromProject
      );

      if (!sourceProject) {
        warn(`Project not found: ${pc.bold(importFromProject)}`);
        if (projects.length > 0) {
          info("Available projects:");
          for (const p of projects.slice(0, 5)) {
            dim(`  - ${p.name} (${p.id})`);
          }
        }
      } else {
        info(`Importing guardrails from ${pc.bold(sourceProject.name)}...`);
        const guardrails = importModule.getProjectGuardrails(sourceProject.path);
        if (guardrails.length === 0) {
          dim(`No guardrails found in ${sourceProject.name}.`);
        } else {
          const result = importModule.importGuardrails(guardrails, cwd, sourceProject.name);
          if (result.imported > 0) {
            success(`Imported ${pc.bold(result.imported)} guardrail(s) from ${pc.cyan(sourceProject.name)}`);
          }
          if (result.skipped > 0) {
            dim(`Skipped ${result.skipped} duplicate(s).`);
          }
        }
      }
    }

    return 0;
  },
};

async function runInstallSkills(options) {
  const { cwd, repoRoot, agentOverride, installForce } = options;

  if (!process.stdin.isTTY) {
    error("Skills install requires an interactive terminal.");
    info("Run this command in a terminal that supports user input.");
    return;
  }

  const { intro, outro, select, isCancel } = await import("@clack/prompts");
  intro("Ralph skills install");

  const agent = await select({
    message: "Which agent are you using?",
    options: [
      { value: "codex", label: "codex" },
      { value: "claude", label: "claude" },
      { value: "droid", label: "droid" },
    ],
    initialValue: agentOverride || "codex",
  });
  if (isCancel(agent)) {
    outro("Cancelled.");
    return;
  }

  const scope = await select({
    message: "Where should skills be installed?",
    options: [
      { value: "local", label: "Local (project)" },
      { value: "global", label: "Global (home directory)" },
    ],
    initialValue: "local",
  });
  if (isCancel(scope)) {
    outro("Cancelled.");
    return;
  }

  const home = os.homedir();
  const targetRoot =
    agent === "codex"
      ? scope === "global" ? path.join(home, ".codex", "skills") : path.join(cwd, ".codex", "skills")
      : agent === "claude"
        ? scope === "global" ? path.join(home, ".claude", "skills") : path.join(cwd, ".claude", "skills")
        : scope === "global" ? path.join(home, ".factory", "skills") : path.join(cwd, ".factory", "skills");

  const skillsRoot = path.join(repoRoot, "skills");
  const skillsToInstall = ["commit", "dev-browser", "prd"];
  fs.mkdirSync(targetRoot, { recursive: true });

  const installed = [];
  const skipped = [];

  for (const skill of skillsToInstall) {
    const source = path.join(skillsRoot, skill);
    const target = path.join(targetRoot, skill);
    if (!exists(source)) {
      skipped.push(`${skill} (missing in repo)`);
      continue;
    }
    if (exists(target) && !installForce) {
      skipped.push(`${skill} (already exists)`);
      continue;
    }
    fs.cpSync(source, target, { recursive: true, force: true });
    installed.push(skill);
  }

  if (installed.length) {
    success(`Installed skills to ${pc.cyan(targetRoot)}: ${installed.join(", ")}`);
  }
  if (skipped.length) {
    dim(`Skipped: ${skipped.join(", ")}`);
  }
  outro("Done.");
}
