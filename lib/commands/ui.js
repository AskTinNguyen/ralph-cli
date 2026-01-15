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

/**
 * Check if a port is in use
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const net = require("net");
    const server = net.createServer();

    server.once("error", (err) => {
      if (err.code === "EADDRINUSE") {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.once("listening", () => {
      server.close();
      resolve(false);
    });

    server.listen(port);
  });
}

/**
 * Check if a URL is responding (indicates Ralph UI is running)
 */
async function isRalphUIRunning(port) {
  try {
    const http = require("http");
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${port}/api/status`, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on("error", () => resolve(false));
      req.setTimeout(1000, () => {
        req.destroy();
        resolve(false);
      });
    });
  } catch {
    return false;
  }
}

/**
 * Find an available port starting from the given port
 */
async function findAvailablePort(startPort, maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    const inUse = await isPortInUse(port);
    if (!inUse) {
      return port;
    }
  }
  return null;
}

module.exports = {
  name: "ui",
  description: "Start the Ralph UI server",
  usage: "ralph ui [port] [--open]\n       ralph gui view prd <number> [--port=3000]",

  help: `
${pc.bold("ralph ui")} ${pc.dim("[port] [options]")}
${pc.bold("ralph gui")} ${pc.dim("view prd <number> [options]")}

Start the Ralph UI dashboard server or open specific views.

${pc.bold("Arguments:")}
  ${pc.dim("[port]")}              Port number (default: 3000)
  ${pc.dim("<number>")}            PRD number to view

${pc.bold("Options:")}
  ${pc.yellow("--open")}             Open browser automatically after server starts
  ${pc.yellow("--port=N")}           Use specific port (default: 3000)

${pc.bold("Examples:")}
  ${pc.dim("ralph ui")}              Start on default port 3000
  ${pc.dim("ralph ui 8080")}         Start on port 8080
  ${pc.dim("ralph ui --open")}       Start and open browser
  ${pc.dim("ralph gui view prd 61")} Start server and open PRD-61 in editor
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

    // Check for subcommand pattern: gui view prd <number>
    let targetUrl = null;
    let prdNumber = null;
    const positionalArgs = getPositionalArgs(args, 1);

    if (positionalArgs[0] === "view" && positionalArgs[1] === "prd" && positionalArgs[2]) {
      prdNumber = positionalArgs[2];
      if (!/^\d+$/.test(prdNumber)) {
        error(`Invalid PRD number: ${pc.bold(prdNumber)}`);
        info("PRD number must be a positive integer.");
        return 1;
      }
      targetUrl = `/editor.html?prd=${prdNumber}&file=prd`;
      info(`Opening PRD-${prdNumber} in editor...`);
    }

    // Parse flags - open browser if --open flag, gui command (via options), or targetUrl
    const openBrowser = hasFlag(args, "open") || options.uiOpenBrowser || targetUrl !== null;

    // Parse port from arguments or --port flag
    let port = 3000;
    const portFlagMatch = args.find(a => a.startsWith("--port="));
    if (portFlagMatch) {
      port = parseInt(portFlagMatch.split("=")[1], 10);
    } else if (!prdNumber) {
      // Only parse port from positional args if we're NOT in "view prd" mode
      const portArg = positionalArgs.find(a => /^\d+$/.test(a));
      if (portArg) {
        port = parseInt(portArg, 10);
      }
    }

    if (port < 1 || port > 65535) {
      error(`Invalid port number: ${pc.bold(port)}`);
      info("Port must be between 1 and 65535.");
      return 1;
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

    // Smart port handling
    const portInUse = await isPortInUse(port);

    if (portInUse) {
      // Check if Ralph UI is already running on this port
      const ralphRunning = await isRalphUIRunning(port);

      if (ralphRunning) {
        // Ralph UI already running - just open browser
        success(`Ralph UI already running on port ${pc.bold(port)}`);
        const serverUrl = `http://localhost:${port}`;
        const openUrl = targetUrl ? `${serverUrl}${targetUrl}` : serverUrl;

        if (openBrowser) {
          info("Opening browser...");
          const openBrowserFn = (url) => {
            const platform = os.platform();
            let openCmd, openArgs;
            if (platform === "darwin") {
              openCmd = "open";
              openArgs = [url];
            } else if (platform === "win32") {
              openCmd = "cmd";
              openArgs = ["/c", "start", url];
            } else {
              openCmd = "xdg-open";
              openArgs = [url];
            }
            spawn(openCmd, openArgs, { detached: true, stdio: "ignore" }).unref();
          };
          openBrowserFn(openUrl);
        } else {
          info(`Access at: ${pc.cyan(openUrl)}`);
        }
        return 0;
      } else {
        // Port in use by something else - find available port
        info(`Port ${pc.bold(port)} is in use, finding available port...`);
        const availablePort = await findAvailablePort(port);

        if (!availablePort) {
          error(`Could not find available port between ${port} and ${port + 9}`);
          info(`Try specifying a different port: ${pc.cyan(`ralph ui --port=8080`)}`);
          return 1;
        }

        port = availablePort;
        info(`Using port ${pc.bold(port)}`);
      }
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
    const openUrl = targetUrl ? `${serverUrl}${targetUrl}` : serverUrl;

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
            openBrowserFn(openUrl);
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
