/**
 * Ralph doctor command
 * Environment and setup diagnostics
 */
const { success, error, info, dim, pc, hasFlag } = require("../cli");
const doctorModule = require("../doctor");
const reporter = require("../doctor/reporter");

module.exports = {
  name: "doctor",
  description: "Environment and setup diagnostics",
  usage: "ralph doctor [--verbose] [--fix] [--json]",

  help: `
${pc.bold("ralph doctor")} ${pc.dim("[options]")}

Run diagnostics to check environment, configuration, and state.

${pc.bold("Options:")}
  ${pc.yellow("--verbose, -v")}   Show detailed output for all checks
  ${pc.yellow("--fix")}           Attempt to automatically fix detected issues
  ${pc.yellow("--json")}          Output results as JSON

${pc.bold("Examples:")}
  ${pc.dim("ralph doctor")}              Quick health check
  ${pc.dim("ralph doctor --verbose")}    Show all details
  ${pc.dim("ralph doctor --fix")}        Attempt auto-fixes
`,

  /**
   * Run the doctor command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd() } = options;

    // Parse flags
    const verboseFlag = hasFlag(args, "verbose") || hasFlag(args, "v");
    const jsonFlag = hasFlag(args, "json");
    const fixFlag = hasFlag(args, "fix");

    // Run all diagnostics
    const results = doctorModule.runAllChecks(cwd);

    // Handle --fix flag
    if (fixFlag) {
      const fixResults = doctorModule.applyFixes(results, cwd);

      if (jsonFlag) {
        console.log(JSON.stringify({ diagnostics: results, fixes: fixResults }, null, 2));
      } else {
        // First show diagnostic results
        if (verboseFlag) {
          console.log(reporter.formatTerminalVerbose(results));
        } else {
          console.log(reporter.formatTerminal(results));
        }

        // Then show fix results
        console.log(reporter.formatFixResults(fixResults));
      }

      return 0;
    }

    // Regular output (no --fix)
    if (jsonFlag) {
      console.log(reporter.formatJSON(results));
    } else if (verboseFlag) {
      console.log(reporter.formatTerminalVerbose(results));
    } else {
      console.log(reporter.formatTerminal(results));
    }

    // Exit with error code if there are errors
    const hasErrors = results.summary && results.summary.totalErrors > 0;
    return hasErrors ? 1 : 0;
  },
};
