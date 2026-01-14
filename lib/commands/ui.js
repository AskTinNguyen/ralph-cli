/**
 * Ralph ui command
 * Start the Ralph UI server
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { success, error, info, dim, pc, hasFlag, getPositionalArgs } = require("../cli");

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

module.exports = {
  name: "ui",
  description: "Start the Ralph UI server",
  usage: "ralph ui [port] [--open]",

  help: `
${pc.bold("ralph ui")} ${pc.dim("[port] [options]")}

Start the Ralph UI dashboard server.

${pc.bold("Arguments:")}
  ${pc.dim("[port]")}              Port number (default: 3000)

${pc.bold("Options:")}
  ${pc.yellow("--open")}             Open browser automatically after server starts

${pc.bold("Examples:")}
  ${pc.dim("ralph ui")}              Start on default port 3000
  ${pc.dim("ralph ui 8080")}         Start on port 8080
  ${pc.dim("ralph ui --open")}       Start and open browser
`,

  /**
   * Run the ui command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Options including cwd, repoRoot
   * @returns {Promise<number>} Exit code (never returns normally - runs until killed)
   */
  async run(args, env, options) {
    const { cwd = process.cwd(), repoRoot } = options;

    // Check for help flag
    if (hasFlag(args, "help")) {
      console.log(this.help);
      return 0;
    }

    // Parse flags
    const openBrowser = hasFlag(args, "open");

    // Parse port from arguments
    let port = 3000;
    const positionalArgs = getPositionalArgs(args, 1);
    const portArg = positionalArgs.find(a => /^\d+$/.test(a));
    if (portArg) {
      port = parseInt(portArg, 10);
      if (port < 1 || port > 65535) {
        error(`Invalid port number: ${pc.bold(portArg)}`);
        info("Port must be between 1 and 65535.");
        return 1;
      }
    }

    const uiDir = path.join(repoRoot, "ui");
    const serverPath = path.join(uiDir, "src", "server.ts");

    // Check that ui directory exists
    if (!exists(uiDir)) {
      error(`UI directory not found at ${pc.cyan(uiDir)}`);
      return 1;
    }

    // Check that server.ts exists
    if (!exists(serverPath)) {
      error(`Server file not found at ${pc.cyan(serverPath)}`);
      return 1;
    }

    info(`Starting Ralph UI server on port ${pc.bold(port)}...`);

    // Function to open browser based on platform
    const openBrowserFn = (url) => {
      const platform = os.platform();
      let openCmd;
      let openArgs;

      if (platform === "darwin") {
        openCmd = "open";
        openArgs = [url];
      } else if (platform === "win32") {
        openCmd = "cmd";
        openArgs = ["/c", "start", url];
      } else {
        // Linux and others
        openCmd = "xdg-open";
        openArgs = [url];
      }

      spawn(openCmd, openArgs, {
        detached: true,
        stdio: "ignore",
      }).unref();
    };

    // Spawn the server process
    const serverEnv = { ...env, PORT: String(port), RALPH_ROOT: cwd };

    // Use npx tsx to run TypeScript directly
    const serverProcess = spawn("npx", ["tsx", "src/server.ts"], {
      cwd: uiDir,
      env: serverEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let serverStarted = false;
    const serverUrl = `http://localhost:${port}`;

    return new Promise((resolve) => {
      serverProcess.stdout.on("data", (data) => {
        const output = data.toString();
        process.stdout.write(output);

        // Check if server has started
        if (!serverStarted && output.includes("running at")) {
          serverStarted = true;
          success(`Server running at ${pc.cyan(serverUrl)}`);

          if (openBrowser) {
            info("Opening browser...");
            openBrowserFn(serverUrl);
          }
        }
      });

      serverProcess.stderr.on("data", (data) => {
        const output = data.toString();

        // Check for EADDRINUSE error
        if (output.includes("EADDRINUSE") || output.includes("address already in use")) {
          error(`Port ${pc.bold(port)} is already in use.`);
          info(`Try a different port: ${pc.cyan(`ralph ui ${port + 1}`)}`);
          info(`Or stop the process using port ${port} and try again.`);
          serverProcess.kill();
          resolve(1);
          return;
        }

        process.stderr.write(output);
      });

      serverProcess.on("error", (err) => {
        if (err.code === "ENOENT") {
          error("npx command not found. Make sure Node.js is installed.");
        } else {
          error(`Failed to start server: ${err.message}`);
        }
        resolve(1);
      });

      serverProcess.on("close", (code) => {
        if (code !== 0 && code !== null) {
          error(`Server exited with code ${code}`);
          resolve(code);
        } else {
          resolve(0);
        }
      });

      // Handle graceful shutdown
      const cleanup = () => {
        dim("\nStopping server...");
        serverProcess.kill();
        resolve(0);
      };

      process.on("SIGINT", cleanup);
      process.on("SIGTERM", cleanup);
    });
  },
};
