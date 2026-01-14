/**
 * Ralph log command
 * Append to activity log
 */
const fs = require("fs");
const path = require("path");
const { error, pc } = require("../cli");

module.exports = {
  name: "log",
  description: "Append to activity log",
  usage: 'ralph log "<message>"',

  help: `
${pc.bold("ralph log")} ${pc.dim('"<message>"')}

Append a message to the activity log.

${pc.bold("Examples:")}
  ${pc.dim('ralph log "Started feature development"')}
  ${pc.dim('ralph log "Completed API integration"')}
`,

  /**
   * Run the log command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const { cwd = process.cwd() } = options;

    const message = args.slice(1).join(" ").trim();
    if (!message) {
      error(`Usage: ${pc.cyan('ralph log "message"')}`);
      return 1;
    }

    const activityLog = path.join(cwd, ".ralph", "activity.log");
    fs.mkdirSync(path.dirname(activityLog), { recursive: true });

    const now = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    fs.appendFileSync(activityLog, `[${stamp}] ${message}\n`);
    return 0;
  },
};
