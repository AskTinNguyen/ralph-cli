/**
 * Ralph completions command
 * Generate shell completions
 */
const { success, error, info, warn, pc, hasFlag, parseFlag } = require("../cli");
const completionsModule = require("../completions");

module.exports = {
  name: "completions",
  description: "Generate shell completions",
  usage: "ralph completions [bash|zsh|fish] [--install]",

  help: `
${pc.bold("ralph completions")} ${pc.dim("[shell] [options]")}

Generate or install shell completion scripts.

${pc.bold("Arguments:")}
  ${pc.dim("[shell]")}              Shell type: bash, zsh, or fish (auto-detected if omitted)

${pc.bold("Options:")}
  ${pc.yellow("--install")}          Auto-install completions to shell config

${pc.bold("Examples:")}
  ${pc.dim("ralph completions")}              Output completions for detected shell
  ${pc.dim("ralph completions bash")}         Output bash completions
  ${pc.dim("ralph completions --install")}    Auto-install completions
`,

  /**
   * Run the completions command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    // Parse flags
    const installFlag = hasFlag(args, "install");

    // Get shell argument (non-flag argument after 'completions')
    let shellArg = null;
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (!arg.startsWith("-") && !shellArg) {
        shellArg = arg;
        break;
      }
    }

    // Validate shell argument if provided
    if (shellArg && !completionsModule.SHELLS.includes(shellArg)) {
      error(`Unknown shell: ${pc.bold(shellArg)}`);
      info(`Supported shells: ${pc.cyan(completionsModule.SHELLS.join(", "))}`);
      return 1;
    }

    // Detect shell if not specified
    const shell = shellArg || completionsModule.detectShell();
    if (!shell) {
      error("Could not detect shell type.");
      info(`Please specify a shell: ${pc.cyan("ralph completions bash|zsh|fish")}`);
      info("\nManual installation:");
      console.log(completionsModule.getManualInstructions("bash"));
      return 1;
    }

    if (installFlag) {
      // Auto-install mode
      info(`Installing ${pc.bold(shell)} completions...`);
      const result = completionsModule.install(shell);

      if (result.success) {
        success(`\n✓ Completions installed successfully!`);
        console.log(`  Path: ${pc.cyan(result.path)}`);
        console.log("");
        info(result.message);
        if (result.postInstallNote) {
          warn(`\nNote: ${result.postInstallNote}`);
        }
        return 0;
      } else {
        error(result.message);
        console.log("\nManual installation:");
        console.log(completionsModule.getManualInstructions(shell));
        return 1;
      }
    } else {
      // Output mode - print script to stdout
      try {
        const script = completionsModule.generate(shell);
        console.log(script);
        return 0;
      } catch (err) {
        error(err.message);
        return 1;
      }
    }
  },
};
