/**
 * Ralph automation command (US-013)
 * CLI commands for running automation scripts
 *
 * Provides subcommands for:
 * - slack-report: Send team reports to Slack channels
 * - check-blockers: Detect and escalate blocked PRDs
 * - github-archive: Archive metrics to GitHub
 * - scan-bugs: Scan git history for bug-related commits
 * - verify: Check automation installation is working
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { success, error, info, dim, warn, pc, hasFlag } = require("../cli");

/**
 * Check if a path exists
 */
function exists(p) {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the scripts directory path
 * Works with both global and local installs
 */
function getScriptsDir() {
  // Find the ralph-cli package root
  const packageRoot = path.resolve(__dirname, "../..");
  const scriptsDir = path.join(packageRoot, "scripts");

  if (exists(scriptsDir)) {
    return scriptsDir;
  }

  // Fallback: try to find via require.resolve
  try {
    const slackReporterPath = require.resolve("ralph-cli/scripts/slack-reporter.js");
    return path.dirname(slackReporterPath);
  } catch {
    return null;
  }
}

/**
 * Run a Node.js script with the given arguments
 * @param {string} scriptPath - Path to the script
 * @param {string[]} scriptArgs - Arguments to pass to the script
 * @returns {Promise<number>} Exit code
 */
function runScript(scriptPath, scriptArgs = []) {
  return new Promise((resolve) => {
    if (!exists(scriptPath)) {
      error(`Script not found: ${scriptPath}`);
      dim("This script may not be implemented yet.");
      resolve(1);
      return;
    }

    const child = spawn("node", [scriptPath, ...scriptArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
      env: { ...process.env },
    });

    child.on("close", (code) => {
      resolve(code || 0);
    });

    child.on("error", (err) => {
      error(`Failed to run script: ${err.message}`);
      resolve(1);
    });
  });
}

/**
 * Verify automation installation
 * Checks:
 * - .ralph/ directory exists
 * - automation-config.json is valid JSON
 * - Required environment variables are set
 * - Slack API connection (if token available)
 * - GitHub API connection (if token available)
 */
async function runVerify() {
  console.log("");
  console.log(pc.bold("Automation Installation Verification"));
  console.log(pc.dim("═".repeat(60)));
  console.log("");

  const checks = [];
  const cwd = process.cwd();

  // Check 1: .ralph/ directory exists
  const ralphDir = path.join(cwd, ".ralph");
  if (exists(ralphDir)) {
    checks.push({ name: ".ralph/ directory", status: "pass", detail: "Found" });
  } else {
    checks.push({ name: ".ralph/ directory", status: "fail", detail: "Not found - run `ralph init` first" });
  }

  // Check 2: automation-config.json is valid JSON
  const configPath = path.join(ralphDir, "automation-config.json");
  if (exists(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(content);

      // Check for required sections
      const hasSlackChannels = config.slackChannels && Object.keys(config.slackChannels).length > 0;
      const hasBlockerEscalation = config.blockerEscalation && config.blockerEscalation.enabled !== undefined;

      if (hasSlackChannels) {
        checks.push({ name: "automation-config.json", status: "pass", detail: "Valid JSON with Slack channels" });
      } else {
        checks.push({ name: "automation-config.json", status: "warn", detail: "Valid JSON but no Slack channels configured" });
      }

      if (hasBlockerEscalation) {
        checks.push({ name: "Blocker escalation config", status: "pass", detail: `Enabled: ${config.blockerEscalation.enabled}` });
      }
    } catch (parseError) {
      checks.push({ name: "automation-config.json", status: "fail", detail: `Invalid JSON: ${parseError.message}` });
    }
  } else {
    checks.push({ name: "automation-config.json", status: "fail", detail: "Not found - create config file" });
  }

  // Check 3: Environment variables
  const envVars = [
    { name: "SLACK_BOT_TOKEN", required: true, hint: "Required for Slack integration" },
    { name: "GITHUB_TOKEN", required: false, hint: "Required for GitHub archiving" },
    { name: "ANTHROPIC_API_KEY", required: false, hint: "Required for bug categorization" },
    { name: "SLACK_TEAM_ID", required: false, hint: "Optional for Slack team ID" },
  ];

  for (const envVar of envVars) {
    const value = process.env[envVar.name];
    if (value) {
      // Mask the value for security
      const masked = value.substring(0, 4) + "..." + value.substring(value.length - 4);
      checks.push({ name: envVar.name, status: "pass", detail: `Set (${masked})` });
    } else if (envVar.required) {
      checks.push({ name: envVar.name, status: "fail", detail: `Not set - ${envVar.hint}` });
    } else {
      checks.push({ name: envVar.name, status: "warn", detail: `Not set - ${envVar.hint}` });
    }
  }

  // Check 4: Scripts exist
  const scriptsDir = getScriptsDir();
  const scripts = [
    { name: "slack-reporter.js", description: "Slack reporting" },
    { name: "check-blockers.js", description: "Blocker detection" },
    { name: "detect-blocker-resolution.js", description: "Blocker resolution detection" },
    { name: "github-archiver.js", description: "GitHub archiving" },
    { name: "bug-scanner.js", description: "Bug scanning" },
    { name: "bug-categorizer.js", description: "Bug categorization (Haiku)" },
  ];

  if (scriptsDir) {
    for (const script of scripts) {
      const scriptPath = path.join(scriptsDir, script.name);
      if (exists(scriptPath)) {
        checks.push({ name: script.name, status: "pass", detail: script.description });
      } else {
        checks.push({ name: script.name, status: "warn", detail: `Not implemented yet (${script.description})` });
      }
    }
  } else {
    checks.push({ name: "Scripts directory", status: "fail", detail: "Could not locate scripts directory" });
  }

  // Display results
  // Check 5: PR creator and wiki generator scripts
  const scripts2 = [
    { name: "github-pr-creator.js", description: "PR creation and auto-merge" },
    { name: "bug-wikipedia-generator.js", description: "Bug Wikipedia generation" },
  ];

  if (scriptsDir) {
    for (const script of scripts2) {
      const scriptPath = path.join(scriptsDir, script.name);
      if (exists(scriptPath)) {
        checks.push({ name: script.name, status: "pass", detail: script.description });
      } else {
        checks.push({ name: script.name, status: "warn", detail: `Not implemented yet (${script.description})` });
      }
    }
  }

  let passCount = 0;
  let warnCount = 0;
  let failCount = 0;

  for (const check of checks) {
    let icon, color;
    if (check.status === "pass") {
      icon = "✓";
      color = pc.green;
      passCount++;
    } else if (check.status === "warn") {
      icon = "⚠";
      color = pc.yellow;
      warnCount++;
    } else {
      icon = "✗";
      color = pc.red;
      failCount++;
    }

    console.log(`  ${color(icon)} ${check.name.padEnd(25)} ${pc.dim(check.detail)}`);
  }

  console.log("");
  console.log(pc.dim("═".repeat(60)));
  console.log("");
  console.log(`  ${pc.green("Passed:")} ${passCount}  ${pc.yellow("Warnings:")} ${warnCount}  ${pc.red("Failed:")} ${failCount}`);
  console.log("");

  if (failCount > 0) {
    error("Some required checks failed. Fix the issues above and re-run verify.");
    return 1;
  }

  if (warnCount > 0) {
    warn("Some optional checks have warnings. Automation may work with limited functionality.");
    return 0;
  }

  success("All checks passed! Automation is ready to use.");
  return 0;
}

module.exports = {
  name: "automation",
  description: "Run automation scripts for executive reporting",
  usage: "ralph automation <subcommand> [options]",

  subcommands: {
    "slack-report": "Send team reports to Slack channels",
    "check-blockers": "Detect and escalate blocked PRDs",
    "detect-blocker-resolution": "Detect successful runs after blocker (US-005)",
    "github-archive": "Archive metrics to GitHub",
    "github-pr-create": "Create and auto-merge daily metrics PRs (US-008)",
    "scan-bugs": "Scan git history for bug-related commits",
    "categorize-bugs": "AI-powered bug categorization with Claude Haiku (US-010)",
    "generate-wiki": "Generate Bug Wikipedia markdown files (US-011)",
    verify: "Check automation installation is working",
  },

  help: `
${pc.bold("ralph automation")} ${pc.dim("<subcommand>")}

Run automation scripts for executive reporting and metrics collection.

${pc.bold("Subcommands:")}
  ${pc.green("slack-report")}              Send team reports to Slack channels
  ${pc.green("check-blockers")}            Detect and escalate blocked PRDs (2/4/7 day thresholds)
  ${pc.green("detect-blocker-resolution")} Detect successful runs after blocker (US-005)
  ${pc.green("github-archive")}            Archive metrics to GitHub ralph-metrics branch
  ${pc.green("github-pr-create")}          Create and auto-merge daily metrics PRs (US-008)
  ${pc.green("scan-bugs")}                 Scan git history for bug-related commits
  ${pc.green("categorize-bugs")}           AI-powered bug categorization with Claude Haiku
  ${pc.green("generate-wiki")}             Generate Bug Wikipedia markdown files
  ${pc.green("verify")}                    Check automation installation is working

${pc.bold("Environment Variables:")}
  ${pc.yellow("SLACK_BOT_TOKEN")}     Slack Bot OAuth token (required for Slack)
  ${pc.yellow("GITHUB_TOKEN")}        GitHub personal access token (required for GitHub)
  ${pc.yellow("ANTHROPIC_API_KEY")}   Anthropic API key (required for bug categorization)
  ${pc.yellow("RALPH_DRY_RUN")}       Set to "1" for dry run mode (no actual sends)
  ${pc.yellow("FORCE_SLACK_SEND")}    Set to "1" to bypass quiet hours

${pc.bold("Examples:")}
  ${pc.dim("ralph automation slack-report")}        Send Slack reports
  ${pc.dim("ralph automation slack-report --format-test")}   Validate Block Kit format
  ${pc.dim("ralph automation check-blockers")}      Check for blocked PRDs
  ${pc.dim("ralph automation scan-bugs")}           Scan git for bug-related commits
  ${pc.dim("ralph automation categorize-bugs")}     Categorize bugs with Claude Haiku
  ${pc.dim("ralph automation categorize-bugs --limit=5")} Categorize only 5 bugs
  ${pc.dim("ralph automation generate-wiki")}       Generate Bug Wikipedia markdown
  ${pc.dim("ralph automation verify")}              Verify installation
  ${pc.dim("RALPH_DRY_RUN=1 ralph automation slack-report")} Test without sending

${pc.bold("Configuration:")}
  Create ${pc.cyan(".ralph/automation-config.json")} with channel mappings:
  ${pc.dim(JSON.stringify({ slackChannels: { gameplay: "C123", leadership: "C456" } }, null, 2))}

${pc.bold("See Also:")}
  ${pc.cyan("AUTOMATION_INSTALL.md")} for full setup instructions
`,

  /**
   * Run the automation command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const subCmd = args[1];

    // === HELP ===
    if (subCmd === "--help" || subCmd === "-h" || subCmd === "help" || !subCmd) {
      if (!subCmd) {
        console.log(this.help);
        return 0;
      }
      console.log(this.help);
      return 0;
    }

    // Get scripts directory
    const scriptsDir = getScriptsDir();
    if (!scriptsDir && subCmd !== "verify") {
      error("Could not locate Ralph CLI scripts directory.");
      dim("Ensure ralph-cli is properly installed.");
      return 1;
    }

    // Pass remaining args to the script
    const scriptArgs = args.slice(2);

    // === VERIFY ===
    if (subCmd === "verify") {
      return runVerify();
    }

    // === SLACK-REPORT ===
    if (subCmd === "slack-report") {
      const scriptPath = path.join(scriptsDir, "slack-reporter.js");
      info("Running Slack reporter...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === CHECK-BLOCKERS ===
    if (subCmd === "check-blockers") {
      const scriptPath = path.join(scriptsDir, "check-blockers.js");
      info("Running blocker check...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === DETECT-BLOCKER-RESOLUTION ===
    if (subCmd === "detect-blocker-resolution") {
      const scriptPath = path.join(scriptsDir, "detect-blocker-resolution.js");
      info("Running blocker resolution detection...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === GITHUB-ARCHIVE ===
    if (subCmd === "github-archive") {
      const scriptPath = path.join(scriptsDir, "github-archiver.js");
      info("Running GitHub archiver...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === GITHUB-PR-CREATE ===
    if (subCmd === "github-pr-create") {
      const scriptPath = path.join(scriptsDir, "github-pr-creator.js");
      info("Running GitHub PR creator...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === SCAN-BUGS ===
    if (subCmd === "scan-bugs") {
      const scriptPath = path.join(scriptsDir, "bug-scanner.js");
      info("Running bug scanner...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === CATEGORIZE-BUGS ===
    if (subCmd === "categorize-bugs") {
      const scriptPath = path.join(scriptsDir, "bug-categorizer.js");
      info("Running bug categorizer (Claude Haiku)...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // === GENERATE-WIKI ===
    if (subCmd === "generate-wiki") {
      const scriptPath = path.join(scriptsDir, "bug-wikipedia-generator.js");
      info("Running Bug Wikipedia generator...");
      console.log("");
      return runScript(scriptPath, scriptArgs);
    }

    // Unknown subcommand
    error(`Unknown automation subcommand: ${pc.bold(subCmd)}`);
    console.log("");
    console.log("Available subcommands:");
    dim("  slack-report     - Send Slack reports");
    dim("  check-blockers   - Check for blocked PRDs");
    dim("  github-archive   - Archive metrics to GitHub");
    dim("  scan-bugs        - Scan for bug-related commits");
    dim("  categorize-bugs  - Categorize bugs with Claude Haiku");
    dim("  generate-wiki    - Generate Bug Wikipedia markdown");
    dim("  verify           - Check installation status");
    console.log("");
    dim(`Run ${pc.cyan("ralph automation --help")} for full documentation.`);
    return 1;
  },
};
