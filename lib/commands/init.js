/**
 * Ralph init command
 * Interactive setup wizard for new projects
 */
const { error, dim, pc } = require("../cli");
const initModule = require("../init");
const { runOnboarding } = require("../onboarding");

module.exports = {
  name: "init",
  description: "Interactive setup wizard for new projects",
  usage: "ralph init",

  help: `
${pc.bold("ralph init")} ${pc.dim("[options]")}

Interactive setup wizard for configuring Ralph in a new project.

This command will:
  - Create the .agents/ralph directory structure
  - Configure your preferred agent (Claude, Codex, or Droid)
  - Set up initial templates and configuration

${pc.bold("Options:")}
  ${pc.yellow("--tour")}    Launch the interactive onboarding tutorial

${pc.bold("Requirements:")}
  - Must be run in an interactive terminal
  - Requires a git repository (will offer to create one)

${pc.bold("Examples:")}
  ${pc.dim("ralph init")}         Start the setup wizard
  ${pc.dim("ralph init --tour")}  Launch onboarding tutorial
`,

  /**
   * Run the init command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd() } = options;
    const { hasFlag } = require("../cli");

    // Check for help flag
    if (hasFlag(args, "help")) {
      console.log(this.help);
      return 0;
    }

    // Check for --tour flag (onboarding tutorial)
    if (hasFlag(args, "tour")) {
      try {
        await runOnboarding({ ...options, skipWelcome: false });
        return 0;
      } catch (err) {
        if (!process.stdin.isTTY) {
          error("Onboarding tutorial requires an interactive terminal.");
          dim("Run this command in a terminal that supports user input.");
          return 1;
        }
        throw err;
      }
    }

    try {
      const result = await initModule.runWizard(cwd);
      if (result.cancelled) {
        return 0;
      }
      return 0;
    } catch (err) {
      // Handle non-TTY gracefully
      if (err.code === "ERR_USE_AFTER_CLOSE" || !process.stdin.isTTY) {
        error("init requires an interactive terminal.");
        dim("Run this command in a terminal that supports user input.");
        return 1;
      }
      throw err;
    }
  },
};
