/**
 * Ralph voice command
 * Voice control for Claude Code terminal CLI
 */
const path = require("path");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const { success, error, info, dim, warn, pc } = require("../cli");

const execAsync = promisify(exec);

// STT server configuration
const STT_PORT = 5001;
const STT_HEALTH_TIMEOUT = 10000; // 10 seconds
const STT_HEALTH_POLL_INTERVAL = 500; // 500ms between health checks
const STT_SERVER_PATH = path.join(__dirname, "../../ui/python/stt_server.py");
const STT_VENV_PATH = path.join(__dirname, "../../ui/python/venv");

// Track spawned STT server process
let sttServerProcess = null;

// Lazy import voice-agent modules from ui/dist
let ClaudeCodeExecutor = null;
let TTSFactory = null;

/**
 * Load voice-agent modules dynamically
 * These are ESM modules, so we need dynamic import
 */
async function loadVoiceModules() {
  if (ClaudeCodeExecutor && TTSFactory) {
    return { ClaudeCodeExecutor, TTSFactory };
  }

  const uiDistPath = path.join(__dirname, "../../ui/dist/voice-agent");

  try {
    const executorModule = await import(
      path.join(uiDistPath, "executor/claude-code-executor.js")
    );
    const ttsModule = await import(path.join(uiDistPath, "tts/tts-factory.js"));

    ClaudeCodeExecutor = executorModule.ClaudeCodeExecutor;
    TTSFactory = ttsModule.TTSFactory;

    return { ClaudeCodeExecutor, TTSFactory };
  } catch (err) {
    throw new Error(
      `Failed to load voice modules. Run 'cd ui && npm run build' first.\n${err.message}`
    );
  }
}

/**
 * Check if STT server is running by hitting health endpoint
 * @returns {Promise<{running: boolean, healthy: boolean, model?: string}>}
 */
async function checkSTTServerHealth() {
  try {
    const response = await fetch(`http://localhost:${STT_PORT}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(2000), // 2s timeout for health check
    });

    if (!response.ok) {
      return { running: true, healthy: false };
    }

    const data = await response.json();
    return {
      running: true,
      healthy: data.status === "healthy",
      model: data.model,
      modelLoaded: data.model_loaded,
    };
  } catch (err) {
    // Server not running or not responding
    return { running: false, healthy: false };
  }
}

/**
 * Check if Python and required dependencies are available
 * @returns {Promise<{available: boolean, error?: string, pythonPath?: string}>}
 */
async function checkPythonDependencies() {
  const fs = require("fs");

  // Check if venv exists
  const venvPython =
    process.platform === "win32"
      ? path.join(STT_VENV_PATH, "Scripts", "python.exe")
      : path.join(STT_VENV_PATH, "bin", "python");

  if (!fs.existsSync(venvPython)) {
    return {
      available: false,
      error: `Python virtual environment not found at ${STT_VENV_PATH}`,
      installInstructions: `To set up the STT server:
  cd ui/python
  python3 -m venv venv
  source venv/bin/activate  # On Windows: venv\\Scripts\\activate
  pip install -r requirements.txt`,
    };
  }

  // Check if whisper is installed in venv
  try {
    await execAsync(`"${venvPython}" -c "import whisper"`, { timeout: 5000 });
  } catch (err) {
    return {
      available: false,
      error: "OpenAI Whisper not installed in Python environment",
      installInstructions: `To install Whisper dependencies:
  cd ui/python
  source venv/bin/activate  # On Windows: venv\\Scripts\\activate
  pip install -r requirements.txt`,
    };
  }

  // Check if flask is installed
  try {
    await execAsync(`"${venvPython}" -c "import flask"`, { timeout: 5000 });
  } catch (err) {
    return {
      available: false,
      error: "Flask not installed in Python environment",
      installInstructions: `To install Flask:
  cd ui/python
  source venv/bin/activate  # On Windows: venv\\Scripts\\activate
  pip install flask flask-cors`,
    };
  }

  return { available: true, pythonPath: venvPython };
}

/**
 * Wait for STT server to become healthy with timeout
 * @param {number} timeoutMs - Maximum time to wait
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function waitForSTTServerHealth(timeoutMs = STT_HEALTH_TIMEOUT) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const health = await checkSTTServerHealth();
    if (health.running && health.healthy) {
      return { success: true };
    }
    // Wait before next poll
    await new Promise((resolve) => setTimeout(resolve, STT_HEALTH_POLL_INTERVAL));
  }

  return {
    success: false,
    error: `STT server did not become healthy within ${timeoutMs / 1000}s`,
  };
}

/**
 * Start the STT server if not running
 * @returns {Promise<{success: boolean, alreadyRunning?: boolean, error?: string}>}
 */
async function startSTTServer() {
  // First check if server is already running
  const health = await checkSTTServerHealth();
  if (health.running && health.healthy) {
    return { success: true, alreadyRunning: true };
  }

  // Check Python dependencies
  const deps = await checkPythonDependencies();
  if (!deps.available) {
    return {
      success: false,
      error: deps.error,
      installInstructions: deps.installInstructions,
    };
  }

  const fs = require("fs");

  // Check if server script exists
  if (!fs.existsSync(STT_SERVER_PATH)) {
    return {
      success: false,
      error: `STT server script not found at ${STT_SERVER_PATH}`,
    };
  }

  // Start the server
  dim(`Starting STT server on port ${STT_PORT}...`);

  try {
    sttServerProcess = spawn(deps.pythonPath, [STT_SERVER_PATH, "--port", String(STT_PORT)], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    // Don't wait for the process to exit
    sttServerProcess.unref();

    // Capture any early errors
    let startupError = null;
    sttServerProcess.stderr.on("data", (data) => {
      const msg = data.toString();
      // Only capture actual errors, not Flask's normal startup messages
      if (msg.includes("Error") || msg.includes("error:") || msg.includes("Traceback")) {
        startupError = msg;
      }
    });

    // Wait a moment for potential immediate failures
    await new Promise((resolve) => setTimeout(resolve, 1000));

    if (startupError) {
      return {
        success: false,
        error: `STT server failed to start: ${startupError}`,
      };
    }

    // Wait for health check to pass
    dim("Waiting for STT server to be ready...");
    const healthResult = await waitForSTTServerHealth(STT_HEALTH_TIMEOUT);

    if (!healthResult.success) {
      // Try to kill the process if it failed to become healthy
      if (sttServerProcess && sttServerProcess.pid) {
        try {
          process.kill(sttServerProcess.pid, "SIGTERM");
        } catch (e) {
          // Ignore - process might already be dead
        }
      }
      return {
        success: false,
        error: healthResult.error,
      };
    }

    return { success: true, alreadyRunning: false };
  } catch (err) {
    return {
      success: false,
      error: `Failed to start STT server: ${err.message}`,
    };
  }
}

/**
 * Stop any running STT server
 * @returns {Promise<{success: boolean, wasRunning: boolean, error?: string}>}
 */
async function stopSTTServer() {
  // Check if server is running
  const health = await checkSTTServerHealth();
  if (!health.running) {
    return { success: true, wasRunning: false };
  }

  // Find and kill processes listening on STT_PORT
  try {
    if (process.platform === "win32") {
      // Windows: use netstat and taskkill
      const { stdout } = await execAsync(
        `netstat -ano | findstr :${STT_PORT} | findstr LISTENING`
      );
      const lines = stdout.trim().split("\n");
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && !isNaN(parseInt(pid))) {
          await execAsync(`taskkill /PID ${pid} /F`);
        }
      }
    } else {
      // Unix: use lsof to find process
      try {
        const { stdout } = await execAsync(`lsof -ti:${STT_PORT}`);
        const pids = stdout.trim().split("\n").filter(Boolean);
        for (const pid of pids) {
          if (pid && !isNaN(parseInt(pid))) {
            process.kill(parseInt(pid), "SIGTERM");
          }
        }
      } catch (e) {
        // lsof might not find anything if server just stopped
      }
    }

    // Wait a moment for process to terminate
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify it's stopped
    const healthAfter = await checkSTTServerHealth();
    if (healthAfter.running) {
      return {
        success: false,
        wasRunning: true,
        error: "Failed to stop STT server - it may still be running",
      };
    }

    return { success: true, wasRunning: true };
  } catch (err) {
    return {
      success: false,
      wasRunning: true,
      error: `Failed to stop STT server: ${err.message}`,
    };
  }
}

/**
 * Ensure STT server is running before voice operations
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function ensureSTTServer() {
  const result = await startSTTServer();

  if (!result.success) {
    if (result.installInstructions) {
      error(result.error);
      console.log("");
      console.log(result.installInstructions);
      console.log("");
    } else {
      error(result.error);
    }
    return { success: false, error: result.error };
  }

  if (result.alreadyRunning) {
    info(`STT server already running on port ${STT_PORT}`);
  } else {
    success(`STT server started on port ${STT_PORT}`);
  }

  return { success: true };
}

/**
 * Parse command line arguments
 * @param {string[]} args - Arguments array (first element is the command name "voice")
 */
function parseArgs(args) {
  const result = {
    text: null,
    noTts: false,
    help: false,
    sttStop: false,
  };

  const textParts = [];

  // Skip the first argument which is the command name ("voice")
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--no-tts") {
      result.noTts = true;
    } else if (arg === "--stt-stop") {
      result.sttStop = true;
    } else if (!arg.startsWith("-")) {
      textParts.push(arg);
    }
  }

  if (textParts.length > 0) {
    result.text = textParts.join(" ");
  }

  return result;
}

/**
 * Execute text mode: send prompt to Claude and optionally speak response
 */
async function executeTextMode(text, options = {}) {
  const { noTts = false } = options;

  const { ClaudeCodeExecutor, TTSFactory } = await loadVoiceModules();

  const executor = new ClaudeCodeExecutor({
    cwd: process.cwd(),
    timeout: 300000, // 5 minutes
  });

  // Check if Claude Code is available
  const availability = await executor.checkAvailable();
  if (!availability.available) {
    error(availability.error);
    return 1;
  }

  info(`Sending to Claude: "${text}"`);

  // Create intent object for executor
  const intent = {
    action: "claude_code",
    originalText: text,
    command: text,
    confidence: 1.0,
  };

  // Execute the command
  const result = await executor.execute(intent, {
    cwd: process.cwd(),
  });

  if (!result.success) {
    error(`Error: ${result.error}`);
    return 1;
  }

  // Display the response
  console.log("");
  console.log(result.output || result.filteredOutput || "No response");
  console.log("");

  // Speak the response if TTS is enabled
  if (!noTts) {
    const ttsText = result.ttsText || result.filteredOutput || result.output;
    if (ttsText && ttsText.trim()) {
      try {
        const ttsFactory = new TTSFactory();
        const { engine } = await ttsFactory.getEngine();
        dim("Speaking response...");
        await engine.speak(ttsText);
      } catch (ttsErr) {
        warn(`TTS unavailable: ${ttsErr.message}`);
      }
    }
  }

  return 0;
}

/**
 * Start interactive voice session (placeholder for US-003)
 */
async function startInteractiveSession(options = {}) {
  info("Starting interactive voice session...");
  info("Press Ctrl+C to exit.");
  console.log("");

  // Note: Full mic recording implementation comes in US-003
  // For now, this is a placeholder that shows the session is ready
  dim(
    "Microphone recording not yet implemented. Use: ralph voice \"your question\""
  );
  dim('Or wait for US-003 implementation.');
  console.log("");

  // Keep the process alive until SIGINT
  return new Promise((resolve) => {
    // This will be resolved by the SIGINT handler
    process.on("SIGINT", () => {
      console.log("");
      info("Voice session ended.");
      resolve(0);
    });

    // For now, just exit after showing the message
    // In US-003, this will be replaced with actual mic recording loop
    setTimeout(() => {
      info("Interactive mode requires microphone support (US-003).");
      info('Use text mode instead: ralph voice "your question"');
      resolve(0);
    }, 100);
  });
}

module.exports = {
  name: "voice",
  description: "Voice control for Claude Code terminal",
  usage: 'ralph voice ["<text>"] [--no-tts] [--stt-stop]',

  help: `
${pc.bold("ralph voice")} ${pc.dim('[options] ["<text>"]')}

Voice control for Claude Code terminal CLI.

${pc.bold("Usage:")}
  ${pc.green("ralph voice")}                     Start interactive voice session
  ${pc.green('ralph voice "your question"')}     Send text directly to Claude
  ${pc.green("ralph voice --stt-stop")}          Stop the STT server
  ${pc.green("ralph voice --help")}              Show this help message

${pc.bold("Options:")}
  ${pc.yellow("--no-tts")}                        Disable audio output (text-only mode)
  ${pc.yellow("--stt-stop")}                      Stop any running STT server
  ${pc.yellow("--help, -h")}                      Show this help message

${pc.bold("STT Server:")}
  The STT server (Whisper) is automatically started when running voice commands.
  It runs on port 5001 and provides speech-to-text transcription.

${pc.bold("Examples:")}
  ${pc.dim('ralph voice "what is 2 plus 2"')}    Send a question to Claude
  ${pc.dim('ralph voice "explain this code" --no-tts')}   Text-only response
  ${pc.dim("ralph voice")}                       Start mic recording
  ${pc.dim("ralph voice --stt-stop")}            Stop the STT server

${pc.bold("Requirements:")}
  - Claude Code CLI must be installed and authenticated
  - Python 3.8+ with openai-whisper (for STT)
  - macOS: TTS uses built-in 'say' command
  - Other platforms: Install piper or configure TTS provider

${pc.bold("Configuration:")}
  Voice settings are stored in .ralph/voice-config.json
`,

  /**
   * Run the voice command
   * @param {string[]} args - Command arguments
   * @param {Object} env - Environment variables
   * @param {Object} options - Additional options
   * @returns {Promise<number>} Exit code
   */
  async run(args, env, options) {
    const parsed = parseArgs(args);

    // Show help
    if (parsed.help) {
      console.log(this.help);
      return 0;
    }

    // Handle --stt-stop flag
    if (parsed.sttStop) {
      const result = await stopSTTServer();
      if (result.success) {
        if (result.wasRunning) {
          success("STT server stopped");
        } else {
          info("STT server was not running");
        }
        return 0;
      } else {
        error(result.error);
        return 1;
      }
    }

    // Set up SIGINT handler for graceful exit
    let sigintReceived = false;
    const sigintHandler = () => {
      if (sigintReceived) {
        // Second Ctrl+C, force exit
        process.exit(1);
      }
      sigintReceived = true;
      console.log("");
      info("Exiting voice session... (press Ctrl+C again to force quit)");
    };
    process.on("SIGINT", sigintHandler);

    try {
      // Ensure STT server is running before any voice operation
      const sttResult = await ensureSTTServer();
      if (!sttResult.success) {
        return 1;
      }

      // Text mode: direct prompt
      if (parsed.text) {
        return await executeTextMode(parsed.text, {
          noTts: parsed.noTts,
        });
      }

      // Interactive mode: mic recording (placeholder)
      return await startInteractiveSession({
        noTts: parsed.noTts,
      });
    } catch (err) {
      if (err.message.includes("Failed to load voice modules")) {
        error(err.message);
        return 1;
      }
      error(`Voice command failed: ${err.message}`);
      return 1;
    } finally {
      process.removeListener("SIGINT", sigintHandler);
    }
  },
};
