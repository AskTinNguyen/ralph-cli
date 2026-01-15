/**
 * Ralph error command
 * Error code lookup and reference
 */
const { error: errorOut, info, dim, pc, hasFlag, parseFlag } = require("../cli");
const errorModule = require("../error");

module.exports = {
  name: "error",
  description: "Look up error codes and remediation steps",
  usage: "ralph error [code] [--list] [--category=X] [--json]",

  help: `
${pc.bold("ralph error")} ${pc.dim("[code] [options]")}

Look up error codes, view remediation steps, and browse all errors.

${pc.bold("Usage:")}
  ${pc.cyan("ralph error RALPH-001")}        Look up specific error code
  ${pc.cyan("ralph error --list")}           List all error codes
  ${pc.cyan("ralph error --list --category=BUILD")}   Filter by category

${pc.bold("Options:")}
  ${pc.yellow("--list, -l")}         List all error codes
  ${pc.yellow("--category=X")}       Filter by category (CONFIG, PRD, BUILD, GIT, AGENT, STREAM, INTERNAL)
  ${pc.yellow("--severity=X")}       Filter by severity (critical, error, warning, info)
  ${pc.yellow("--auto-issue")}       Show only errors that trigger auto-issue creation
  ${pc.yellow("--json")}             Output as JSON
  ${pc.yellow("--compact, -c")}      Use compact output format

${pc.bold("Error Code Ranges:")}
  ${pc.blue("001-099")}   CONFIG    Configuration errors
  ${pc.magenta("100-199")}   PRD       PRD/Plan errors
  ${pc.red("200-299")}   BUILD     Build failures
  ${pc.green("300-399")}   GIT       Git errors
  ${pc.yellow("400-499")}   AGENT     Agent failures
  ${pc.cyan("500-599")}   STREAM    Stream errors
  ${pc.bgRed("900-999")}   INTERNAL  Internal errors

${pc.bold("Examples:")}
  ${pc.dim("ralph error RALPH-401")}              View agent fallback error details
  ${pc.dim("ralph error --list --category=BUILD")} List all build errors
  ${pc.dim("ralph error --list --auto-issue")}    Show errors that create GitHub issues
`,

  /**
   * Run the error command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    // Check for help flag
    if (hasFlag(args, "help") || hasFlag(args, "h")) {
      console.log(this.help);
      return 0;
    }

    // Parse flags
    const listFlag = hasFlag(args, "list") || hasFlag(args, "l");
    const jsonFlag = hasFlag(args, "json");
    const compactFlag = hasFlag(args, "compact") || hasFlag(args, "c");
    const autoIssueFlag = hasFlag(args, "auto-issue");
    const category = parseFlag(args, "category");
    const severity = parseFlag(args, "severity");

    // Get non-flag arguments (error code)
    const code = args.find((arg) => arg.startsWith("RALPH-"));

    // List mode
    if (listFlag || (!code && !args.find((a) => !a.startsWith("-")))) {
      return this.listErrors({
        category,
        severity,
        autoIssueOnly: autoIssueFlag,
        json: jsonFlag,
      });
    }

    // Lookup mode - need a code
    if (!code) {
      errorOut("Please provide an error code (e.g., RALPH-001) or use --list");
      console.log(dim("Run 'ralph error --help' for usage information"));
      return 1;
    }

    // Validate code format
    if (!errorModule.isValid(code)) {
      errorOut(`Invalid error code format: ${code}`);
      console.log(dim("Error codes must be in format: RALPH-NNN (e.g., RALPH-001)"));
      return 1;
    }

    // Check if code exists
    if (!errorModule.exists(code)) {
      errorOut(`Error code not found: ${code}`);
      console.log(dim("Run 'ralph error --list' to see all available codes"));
      return 1;
    }

    // Format and display
    const output = errorModule.format(code, { json: jsonFlag, compact: compactFlag });

    if (jsonFlag) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(output);
    }

    return 0;
  },

  /**
   * List errors with filtering
   * @param {Object} options - Filter options
   * @returns {number} Exit code
   */
  listErrors(options) {
    const { category, severity, autoIssueOnly, json } = options;

    // Validate category if provided
    if (category) {
      const validCategories = errorModule.getCategories();
      if (!validCategories.includes(category.toUpperCase())) {
        errorOut(`Invalid category: ${category}`);
        console.log(dim(`Valid categories: ${validCategories.join(", ")}`));
        return 1;
      }
    }

    // Validate severity if provided
    if (severity) {
      const validSeverities = ["critical", "error", "warning", "info"];
      if (!validSeverities.includes(severity.toLowerCase())) {
        errorOut(`Invalid severity: ${severity}`);
        console.log(dim(`Valid severities: ${validSeverities.join(", ")}`));
        return 1;
      }
    }

    // Get filtered list
    const output = errorModule.list({
      category: category?.toUpperCase(),
      severity: severity?.toLowerCase(),
      autoIssueOnly,
      json,
    });

    if (json) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(output);
    }

    return 0;
  },
};
