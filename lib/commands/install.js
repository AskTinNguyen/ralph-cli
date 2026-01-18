/**
 * Ralph install command
 * Copy .agents/ralph into current repo
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");
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

    // Auto-speak setup guidance
    await showAutoSpeakSetup(options);

    return 0;
  },
};

/**
 * Check if a command exists
 */
function hasCommand(cmd) {
  try {
    execSync(`command -v ${cmd}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check Ollama installation and qwen model
 */
function checkOllama() {
  if (!hasCommand("ollama")) {
    return { installed: false, hasModel: false };
  }

  try {
    const models = execSync("ollama list", { encoding: "utf-8" });
    const hasQwen = models.includes("qwen2.5:1.5b");
    return { installed: true, hasModel: hasQwen };
  } catch {
    return { installed: true, hasModel: false };
  }
}

/**
 * Check TTS provider availability
 */
function checkTTS() {
  // macOS built-in say command
  if (hasCommand("say")) {
    return { provider: "macos", available: true };
  }

  // Check for VieNeu-TTS
  const vieneuPath = path.join(os.homedir(), ".vieneu-tts", "venv", "bin", "activate");
  if (exists(vieneuPath)) {
    return { provider: "vieneu", available: true };
  }

  // Check for Piper
  if (hasCommand("piper")) {
    return { provider: "piper", available: true };
  }

  return { provider: null, available: false };
}

/**
 * Initialize voice configuration if it doesn't exist
 */
function initVoiceConfig(ralphDir) {
  const voiceConfigPath = path.join(ralphDir, "voice-config.json");

  if (exists(voiceConfigPath)) {
    return false; // Already exists
  }

  const tts = checkTTS();
  const defaultConfig = {
    ttsEngine: tts.provider || "macos",
    voice: null,
    rate: 175,
    vieneuVoice: "Vinh",
    vieneuModel: "vieneu-0.3b",
    multilingual: {
      enabled: true,
      autoDetect: true
    },
    autoSpeak: {
      enabled: false,
      maxWords: 20,
      minConfidence: 0.7
    },
    headlessAlwaysSpeak: true,
    initialDelaySeconds: 5
  };

  fs.writeFileSync(voiceConfigPath, JSON.stringify(defaultConfig, null, 2));
  return true; // Created new config
}

/**
 * Show auto-speak setup guidance after installation
 */
async function showAutoSpeakSetup(options) {
  const { cwd } = options;
  const ralphDir = path.join(cwd, ".ralph");

  // Skip if non-interactive
  if (!process.stdin.isTTY) {
    return;
  }

  try {
    const { note, confirm, isCancel } = await import("@clack/prompts");

    // Check dependencies
    const ollama = checkOllama();
    const jqInstalled = hasCommand("jq");
    const tts = checkTTS();

    // Initialize voice config
    const configCreated = initVoiceConfig(ralphDir);

    // Build status display
    const statusLines = [
      `${pc.bold("Auto-Speak Available")}`,
      "",
      "Ralph can speak Claude's responses using TTS.",
      "",
      `${pc.bold("Dependencies:")}`,
      `  ${ollama.installed ? pc.green("✓") : pc.yellow("○")} Ollama ${ollama.installed ? "(installed)" : "(run: brew install ollama)"}`,
      `  ${ollama.hasModel ? pc.green("✓") : pc.yellow("○")} qwen2.5:1.5b ${ollama.hasModel ? "(ready)" : "(run: ollama pull qwen2.5:1.5b)"}`,
      `  ${jqInstalled ? pc.green("✓") : pc.yellow("○")} jq ${jqInstalled ? "(installed)" : "(run: brew install jq)"}`,
      `  ${tts.available ? pc.green("✓") : pc.yellow("○")} TTS ${tts.available ? `(${tts.provider})` : "(install VieNeu or Piper)"}`,
      "",
      `${pc.bold("Voice Config:")}`,
      `  ${configCreated ? pc.green("✓ Created") : pc.dim("Already exists")} ${pc.cyan(".ralph/voice-config.json")}`,
    ];

    // Only show setup prompt if dependencies are missing or user wants to see instructions
    const allDepsReady = ollama.installed && ollama.hasModel && jqInstalled && tts.available;

    if (!allDepsReady) {
      statusLines.push("", pc.yellow("Install missing dependencies to enable auto-speak."));
    }

    note(statusLines.join("\n"), "Auto-Speak Setup");

    // Ask if user wants setup instructions
    const wantsInstructions = await confirm({
      message: "Show auto-speak setup instructions?",
      initialValue: !allDepsReady,
    });

    if (!isCancel(wantsInstructions) && wantsInstructions) {
      const hookSnippet = `{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "\\"\$CLAUDE_PROJECT_DIR\\"/.agents/ralph/prompt-ack-hook.sh"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "\\"\$CLAUDE_PROJECT_DIR\\"/.agents/ralph/auto-speak-hook.sh"
      }]
    }]
  }
}`;

      const instructions = [
        `${pc.bold("Setup Instructions:")}`,
        "",
        `${pc.bold("1. Install missing dependencies:")}`,
        !ollama.installed ? `   ${pc.cyan("brew install ollama")}` : "",
        !ollama.hasModel ? `   ${pc.cyan("ollama pull qwen2.5:1.5b")}` : "",
        !jqInstalled ? `   ${pc.cyan("brew install jq")}` : "",
        !tts.available ? `   ${pc.cyan("# Install VieNeu-TTS: .agents/ralph/setup/vieneu-setup.sh")}` : "",
        "",
        `${pc.bold("2. Add hooks to Claude Code config:")}`,
        `   ${pc.dim("Option A: Manual (safe)")}`,
        `     • Open ${pc.cyan("~/.claude/settings.local.json")}`,
        `     • Add the hooks section below (merge if hooks already exist)`,
        "",
        `   ${pc.dim("Option B: Automated (advanced)")}`,
        `     • Run: ${pc.cyan(".agents/ralph/setup/post-install.sh")}`,
        `     • Creates backup before modifying config`,
        "",
        `${pc.bold("3. Hook configuration:")}`,
        pc.dim(hookSnippet),
        "",
        `${pc.bold("4. Enable auto-speak:")}`,
        `   ${pc.cyan("ralph speak --auto-on")}`,
        "",
        `${pc.bold("Documentation:")}`,
        `   ${pc.cyan("AUTO-SPEAK-GUIDE.md")} - Full guide`,
        `   ${pc.cyan("ralph speak --help")} - Command reference`,
      ].filter(Boolean).join("\n");

      note(instructions, "Auto-Speak Configuration");

      // Offer to copy hook snippet to clipboard (macOS only)
      if (process.platform === "darwin" && hasCommand("pbcopy")) {
        const wantsCopy = await confirm({
          message: "Copy hook configuration to clipboard?",
          initialValue: true,
        });

        if (!isCancel(wantsCopy) && wantsCopy) {
          const { spawn } = require("child_process");
          const pbcopy = spawn("pbcopy");
          pbcopy.stdin.write(hookSnippet);
          pbcopy.stdin.end();
          success("Hook configuration copied to clipboard");
        }
      }
    }
  } catch (err) {
    // Silently skip in non-interactive or if prompts fail
    dim("Auto-speak setup guidance skipped (non-interactive).");
  }
}

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
