/**
 * Ralph notify command (US-012)
 * Send test notifications and manage notification configuration
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { success, error, info, dim, pc, hasFlag } = require("../cli");

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
 * Load notification config
 */
function loadConfig(agentDir) {
  const configPath = path.join(agentDir, "notify.config.js");
  if (!exists(configPath)) return null;
  try {
    // Clear require cache for fresh config
    delete require.cache[require.resolve(configPath)];
    return require(configPath);
  } catch {
    return null;
  }
}

/**
 * Check configured channels
 */
function getConfiguredChannels() {
  const channels = [];

  if (process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL) {
    channels.push({
      name: "Slack",
      type: "slack",
      configured: true,
      webhook: process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL,
      channel: process.env.SLACK_CHANNEL || "#ralph-builds",
    });
  } else {
    channels.push({
      name: "Slack",
      type: "slack",
      configured: false,
      hint: "Set SLACK_WEBHOOK environment variable",
    });
  }

  if (process.env.DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK_URL) {
    channels.push({
      name: "Discord",
      type: "discord",
      configured: true,
      webhook: process.env.DISCORD_WEBHOOK || process.env.DISCORD_WEBHOOK_URL,
    });
  } else {
    channels.push({
      name: "Discord",
      type: "discord",
      configured: false,
      hint: "Set DISCORD_WEBHOOK environment variable",
    });
  }

  if (process.env.RALPH_NOTIFY_WEBHOOK) {
    channels.push({
      name: "Webhook",
      type: "webhook",
      configured: true,
      webhook: process.env.RALPH_NOTIFY_WEBHOOK,
    });
  } else {
    channels.push({
      name: "Webhook",
      type: "webhook",
      configured: false,
      hint: "Set RALPH_NOTIFY_WEBHOOK environment variable",
    });
  }

  // Email notification
  if (process.env.RALPH_NOTIFY_EMAIL) {
    channels.push({
      name: "Email",
      type: "email",
      configured: true,
      email: process.env.RALPH_NOTIFY_EMAIL,
    });
  } else {
    channels.push({
      name: "Email",
      type: "email",
      configured: false,
      hint: "Set RALPH_NOTIFY_EMAIL environment variable",
    });
  }

  // CLI is always available
  channels.push({
    name: "CLI",
    type: "cli",
    configured: true,
    hint: "Always enabled",
  });

  return channels;
}

/**
 * Send test notification via bash module
 */
function sendTestNotification(agentDir) {
  return new Promise((resolve) => {
    const notifyScript = path.join(agentDir, "lib", "notify.sh");
    if (!exists(notifyScript)) {
      error("Notification module not found.");
      resolve(1);
      return;
    }

    const testCmd = `
      source "${notifyScript}"
      notify_test
    `;

    const child = spawn("bash", ["-c", testCmd], {
      stdio: "inherit",
      env: { ...process.env },
    });

    child.on("close", (code) => {
      resolve(code || 0);
    });

    child.on("error", () => {
      error("Failed to run notification test.");
      resolve(1);
    });
  });
}

module.exports = {
  name: "notify",
  description: "Manage and test notifications",
  usage: "ralph notify <test|status> [options]",

  subcommands: {
    test: "Send test notification to all channels",
    status: "Show notification configuration status",
  },

  help: `
${pc.bold("ralph notify")} ${pc.dim("<command>")}

Send test notifications and view configuration status.

${pc.bold("Commands:")}
  ${pc.green("test")}     Send test notification to all configured channels
  ${pc.green("status")}   Show which notification channels are configured

${pc.bold("Environment Variables:")}
  ${pc.yellow("SLACK_WEBHOOK")}           Slack webhook URL
  ${pc.yellow("SLACK_CHANNEL")}           Slack channel (default: #ralph-builds)
  ${pc.yellow("DISCORD_WEBHOOK")}         Discord webhook URL
  ${pc.yellow("RALPH_NOTIFY_WEBHOOK")}    Generic webhook URL
  ${pc.yellow("RALPH_NOTIFY_EMAIL")}      Email address for notifications
  ${pc.yellow("RALPH_NOTIFY_ENABLED")}    Enable/disable (default: true)

${pc.bold("Examples:")}
  ${pc.dim("ralph notify test")}         Send test to all channels
  ${pc.dim("ralph notify status")}       Show channel configuration

${pc.bold("Notification Events:")}
  ${pc.cyan("build_start")}     Build started
  ${pc.cyan("build_complete")}  Build completed successfully
  ${pc.cyan("build_failed")}    Build failed
  ${pc.cyan("stalled")}         Build stalled (no activity)
  ${pc.cyan("needs_human")}     Manual intervention required
`,

  /**
   * Run the notify command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd(), templateDir } = options;
    // Use templateDir if provided (from bin/ralph), fall back to local .agents/ralph
    const agentDir = templateDir || path.join(cwd, ".agents", "ralph");
    const subCmd = args[1];

    // === HELP ===
    if (subCmd === "--help" || subCmd === "-h" || subCmd === "help") {
      console.log(this.help);
      return 0;
    }

    // === STATUS ===
    if (subCmd === "status" || !subCmd) {
      console.log("");
      console.log(pc.bold("Notification Channel Status"));
      console.log(pc.dim("═".repeat(60)));

      const channels = getConfiguredChannels();

      for (const channel of channels) {
        const status = channel.configured
          ? pc.green("✓ Configured")
          : pc.dim("○ Not configured");

        console.log(`  ${channel.name.padEnd(12)} ${status}`);

        if (channel.configured && channel.channel) {
          console.log(pc.dim(`             Channel: ${channel.channel}`));
        }
        if (!channel.configured && channel.hint) {
          console.log(pc.dim(`             ${channel.hint}`));
        }
      }

      console.log(pc.dim("═".repeat(60)));
      console.log("");

      // Check global enable
      const enabled = env.RALPH_NOTIFY_ENABLED !== "false";
      if (!enabled) {
        console.log(pc.yellow("⚠ Notifications disabled (RALPH_NOTIFY_ENABLED=false)"));
        console.log("");
      }

      const configuredCount = channels.filter((c) => c.configured).length;
      if (configuredCount > 1) {
        info(`${configuredCount} notification channel(s) configured.`);
        console.log("");
        dim(`Run ${pc.cyan("ralph notify test")} to send a test notification.`);
      } else {
        dim("Configure channels via environment variables.");
        dim(`See ${pc.cyan("ralph notify --help")} for details.`);
      }

      return 0;
    }

    // === TEST ===
    if (subCmd === "test") {
      console.log("");
      console.log(pc.bold("Sending Test Notifications"));
      console.log(pc.dim("═".repeat(60)));

      const channels = getConfiguredChannels();
      const configuredCount = channels.filter((c) => c.configured).length;

      if (configuredCount <= 1) {
        dim("No external channels configured (CLI only).");
        console.log("");
        info("Configure channels with environment variables:");
        dim("  SLACK_WEBHOOK=https://hooks.slack.com/...");
        dim("  DISCORD_WEBHOOK=https://discord.com/api/webhooks/...");
        console.log("");
      }

      // Run the bash test function
      const exitCode = await sendTestNotification(agentDir);
      return exitCode;
    }

    // Unknown subcommand
    error(`Unknown notify command: ${pc.bold(subCmd || "(none)")}`);
    console.log("");
    console.log("Available notify commands:");
    dim("  notify test     - Send test notification");
    dim("  notify status   - Show configuration status");
    return 1;
  },
};
