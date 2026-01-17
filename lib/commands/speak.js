/**
 * Ralph speak command - TTS for text
 * Speaks text using available TTS provider
 */
const { spawn } = require("child_process");
const { success, error, info, dim, pc } = require("../cli");

/**
 * Speak text using available TTS
 */
async function speakText(text, options = {}) {
  const { voice = null, rate = null } = options;

  // Try to use voice-agent TTS factory first
  try {
    const { TTSFactory } = await import("../../ui/dist/voice-agent/tts/tts-factory.js");
    const ttsFactory = new TTSFactory();
    const { engine, provider } = await ttsFactory.getEngine();

    dim(`Using ${provider} TTS...`);
    await engine.speak(text);
    return 0;
  } catch (err) {
    // Fallback to macOS say command
    if (process.platform === "darwin") {
      return new Promise((resolve) => {
        const args = [];
        if (voice) args.push("-v", voice);
        if (rate) args.push("-r", rate);
        args.push(text);

        const child = spawn("say", args, {
          stdio: ["ignore", "inherit", "inherit"],
        });

        child.on("exit", (code) => {
          resolve(code ?? 0);
        });

        child.on("error", (err) => {
          error(`TTS error: ${err.message}`);
          resolve(1);
        });
      });
    } else {
      error("TTS not available on this platform");
      info("Install voice-agent TTS providers or run on macOS");
      return 1;
    }
  }
}

module.exports = {
  name: "speak",
  description: "Speak text using TTS",
  usage: "ralph speak <text>",

  help: `
${pc.bold("ralph speak")} ${pc.dim("<text>")}

Speak text using available TTS provider.

${pc.bold("Usage:")}
  ${pc.green('ralph speak "Hello world"')}
  ${pc.green('echo "Hello world" | ralph speak')}

${pc.bold("Options:")}
  ${pc.yellow("--voice <name>")}    Use specific voice (macOS only)
  ${pc.yellow("--rate <speed>")}    Speech rate (macOS only, default: 200)

${pc.bold("Examples:")}
  ${pc.dim('ralph speak "Task completed successfully"')}
  ${pc.dim('echo "Build finished" | ralph speak')}
  ${pc.dim('ralph speak "Hello" --voice Samantha --rate 180')}
`,

  async run(args, env, options) {
    const path = require("path");
    const fs = require("fs");

    // Parse arguments
    const textParts = [];
    let voice = null;
    let rate = null;
    let autoOn = false;
    let autoOff = false;
    let autoStatus = false;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--voice") {
        voice = args[++i];
      } else if (arg === "--rate") {
        rate = args[++i];
      } else if (arg === "--auto-on") {
        autoOn = true;
      } else if (arg === "--auto-off") {
        autoOff = true;
      } else if (arg === "--auto-status") {
        autoStatus = true;
      } else if (arg === "--help" || arg === "-h") {
        console.log(this.help);
        return 0;
      } else if (!arg.startsWith("-")) {
        textParts.push(arg);
      }
    }

    // Handle auto-speak toggle
    const ralphDir = path.join(process.cwd(), ".ralph");
    const configPath = path.join(ralphDir, "voice-config.json");

    if (autoOn || autoOff || autoStatus) {
      // Ensure .ralph directory exists
      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      // Load or create config
      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {
          // Invalid JSON, start fresh
        }
      }

      if (autoOn) {
        config.autoSpeak = true;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success("Auto-speak mode enabled");
        info("All Claude Code responses will be spoken automatically");
        info(`Run ${pc.cyan("ralph speak --auto-off")} to disable`);
        return 0;
      }

      if (autoOff) {
        config.autoSpeak = false;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success("Auto-speak mode disabled");
        return 0;
      }

      if (autoStatus) {
        const enabled = config.autoSpeak === true;
        info(`Auto-speak mode: ${enabled ? pc.green("enabled") : pc.dim("disabled")}`);
        return 0;
      }
    }

    let text = textParts.join(" ").trim();

    // If no text provided, try to read from stdin
    if (!text) {
      if (!process.stdin.isTTY) {
        // Read from stdin
        const chunks = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        text = Buffer.concat(chunks).toString("utf-8").trim();
      }
    }

    if (!text) {
      error("No text provided to speak");
      info(`Usage: ${pc.cyan('ralph speak "text"')}`);
      return 1;
    }

    return await speakText(text, { voice, rate });
  },
};
