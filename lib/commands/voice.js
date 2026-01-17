/**
 * Ralph voice command
 * Voice control for Claude Code terminal CLI
 */
const path = require("path");
const { success, error, info, dim, warn, pc } = require("../cli");

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
 * Parse command line arguments
 * @param {string[]} args - Arguments array (first element is the command name "voice")
 */
function parseArgs(args) {
  const result = {
    text: null,
    noTts: false,
    help: false,
  };

  const textParts = [];

  // Skip the first argument which is the command name ("voice")
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--no-tts") {
      result.noTts = true;
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
 * Start interactive voice session (placeholder for US-002)
 */
async function startInteractiveSession(options = {}) {
  info("Starting interactive voice session...");
  info("Press Ctrl+C to exit.");
  console.log("");

  // Note: Full mic recording implementation comes in US-002
  // For now, this is a placeholder that shows the session is ready
  dim(
    "Microphone recording not yet implemented. Use: ralph voice \"your question\""
  );
  dim('Or wait for US-002 implementation.');
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
    // In US-002, this will be replaced with actual mic recording loop
    setTimeout(() => {
      info("Interactive mode requires microphone support (US-002).");
      info('Use text mode instead: ralph voice "your question"');
      resolve(0);
    }, 100);
  });
}

module.exports = {
  name: "voice",
  description: "Voice control for Claude Code terminal",
  usage: 'ralph voice ["<text>"] [--no-tts]',

  help: `
${pc.bold("ralph voice")} ${pc.dim('[options] ["<text>"]')}

Voice control for Claude Code terminal CLI.

${pc.bold("Usage:")}
  ${pc.green("ralph voice")}                     Start interactive voice session
  ${pc.green('ralph voice "your question"')}     Send text directly to Claude
  ${pc.green("ralph voice --help")}              Show this help message

${pc.bold("Options:")}
  ${pc.yellow("--no-tts")}                        Disable audio output (text-only mode)
  ${pc.yellow("--help, -h")}                      Show this help message

${pc.bold("Examples:")}
  ${pc.dim('ralph voice "what is 2 plus 2"')}    Send a question to Claude
  ${pc.dim('ralph voice "explain this code" --no-tts')}   Text-only response
  ${pc.dim("ralph voice")}                       Start mic recording (requires US-002)

${pc.bold("Requirements:")}
  - Claude Code CLI must be installed and authenticated
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
