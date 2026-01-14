/**
 * Ralph ping command
 * Verify agent connection is working
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { success, error, pc } = require("../cli");

module.exports = {
  name: "ping",
  description: "Verify agent connection is working",
  usage: "ralph ping [--agent <claude|codex|droid>]",

  help: `
${pc.bold("ralph ping")} ${pc.dim("[options]")}

Test that the configured agent is responding correctly.

${pc.bold("Options:")}
  ${pc.yellow("--agent")} ${pc.dim("<name>")}    Test specific agent (claude, codex, droid)

${pc.bold("Examples:")}
  ${pc.dim("ralph ping")}               Test default agent
  ${pc.dim("ralph ping --agent codex")} Test Codex agent
`,

  /**
   * Run the ping command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including agentMap, defaultAgent
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const {
      agentMap = {},
      defaultAgent = "claude",
      agentOverride = null,
    } = options;

    const agentName = agentOverride || defaultAgent;
    const agentCmd = agentMap[agentName];

    if (!agentCmd) {
      error("Unknown agent for ping.");
      return 1;
    }

    const agentBin = agentCmd.split(" ")[0];
    const existsResult = spawnSync(`command -v ${agentBin}`, { shell: true, stdio: "ignore" });
    if (existsResult.status !== 0) {
      error(`Agent command not found: ${pc.bold(agentBin)}`);
      return 1;
    }

    const promptFile = path.join(os.tmpdir(), `ralph-ping-${Date.now()}.txt`);
    fs.writeFileSync(promptFile, "Reply with <end>pong</end> only.");

    const escapePath = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
    const rendered = agentCmd.includes("{prompt}")
      ? agentCmd.replace(/\{prompt\}/g, escapePath(promptFile))
      : `cat ${escapePath(promptFile)} | ${agentCmd}`;

    const result = spawnSync(rendered, { shell: true, encoding: "utf-8" });
    const output = `${result.stdout || ""}${result.stderr || ""}`;

    // Cleanup
    try {
      fs.unlinkSync(promptFile);
    } catch {}

    if (!output.includes("<end>pong</end>")) {
      error(`Ping failed: missing ${pc.bold("<end>pong</end>")}.`);
      return 1;
    }

    success("Ping OK.");
    return 0;
  },
};
