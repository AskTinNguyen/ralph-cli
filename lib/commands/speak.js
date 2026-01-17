/**
 * Ralph speak command - TTS for text
 * Speaks text using available TTS provider
 *
 * Includes voice queue coordination to prevent concurrent TTS across terminals
 */
const { spawn } = require("child_process");
const { success, error, info, dim, pc, warn } = require("../cli");

/**
 * Get configured voice from voice-config.json
 */
function getConfiguredVoice() {
  const path = require("path");
  const fs = require("fs");
  const configPath = path.join(process.cwd(), ".ralph", "voice-config.json");

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return config.voice || null;
  } catch (err) {
    return null;
  }
}

/**
 * Voice queue lock management for cross-terminal coordination
 */
class VoiceLock {
  constructor() {
    const path = require("path");
    const os = require("os");

    // Find ralph root
    this.ralphRoot = this.findRalphRoot();
    this.lockDir = path.join(this.ralphRoot, "locks", "voice");
    this.lockFile = path.join(this.lockDir, "voice.lock");
    this.queueDir = path.join(this.lockDir, "queue");

    // Generate CLI identifier
    const hostname = os.hostname().substring(0, 8);
    const shortId = Math.random().toString(36).substring(2, 10);
    this.cliId = `speak-${hostname}-${process.pid}-${shortId}`;
    this.pid = process.pid;
  }

  findRalphRoot() {
    const path = require("path");
    const fs = require("fs");

    if (process.env.RALPH_ROOT) {
      return process.env.RALPH_ROOT;
    }

    let current = process.cwd();
    while (current !== path.dirname(current)) {
      const ralphDir = path.join(current, ".ralph");
      if (fs.existsSync(ralphDir)) {
        return ralphDir;
      }
      current = path.dirname(current);
    }

    const os = require("os");
    return path.join(os.homedir(), ".ralph");
  }

  ensureDirectories() {
    const fs = require("fs");
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
    if (!fs.existsSync(this.queueDir)) {
      fs.mkdirSync(this.queueDir, { recursive: true });
    }
  }

  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  getLockHolder() {
    const fs = require("fs");
    try {
      if (!fs.existsSync(this.lockFile)) {
        return null;
      }

      const content = fs.readFileSync(this.lockFile, "utf-8");
      const lines = content.split("\n");
      const data = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length > 0) {
          data[key.trim()] = valueParts.join("=").trim();
        }
      }

      if (!data.CLI_ID || !data.PID) {
        return null;
      }

      return {
        cliId: data.CLI_ID,
        pid: parseInt(data.PID, 10),
        acquiredAt: data.ACQUIRED_AT,
      };
    } catch {
      return null;
    }
  }

  cleanupStaleLock() {
    const fs = require("fs");
    const holder = this.getLockHolder();
    if (holder && !this.isProcessAlive(holder.pid)) {
      try {
        fs.unlinkSync(this.lockFile);
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }

  tryAcquire() {
    const fs = require("fs");
    this.ensureDirectories();

    // Atomic lock acquisition using wx flag (O_EXCL - fails if exists)
    const content = [
      `CLI_ID=${this.cliId}`,
      `PID=${this.pid}`,
      `ACQUIRED_AT=${new Date().toISOString()}`,
    ].join("\n");

    try {
      // wx = exclusive create - fails atomically if file exists
      fs.writeFileSync(this.lockFile, content, { flag: "wx", encoding: "utf-8" });
      return { success: true };
    } catch (err) {
      if (err.code === "EEXIST") {
        // Lock file exists - check if it's stale
        const holder = this.getLockHolder();

        if (holder && !this.isProcessAlive(holder.pid)) {
          // Stale lock from dead process - clean up and retry
          try {
            fs.unlinkSync(this.lockFile);
            // Retry acquisition
            return this.tryAcquire();
          } catch {
            // Someone else cleaned it up - that's fine, return failure
          }
        }

        return { success: false, holder };
      }
      // Other error (permissions, disk, etc.)
      return { success: false, holder: null, error: err.message };
    }
  }

  release() {
    const fs = require("fs");
    const holder = this.getLockHolder();
    if (holder && holder.cliId === this.cliId) {
      try {
        fs.unlinkSync(this.lockFile);
      } catch {
        // Ignore
      }
    }
  }

  /**
   * Wait for lock with timeout
   */
  async waitForLock(timeoutMs = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const result = this.tryAcquire();
      if (result.success) {
        return { success: true };
      }

      // Wait 200ms before retrying
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const holder = this.getLockHolder();
    return { success: false, holder, timeout: true };
  }
}

// Global lock instance for cleanup
let globalVoiceLock = null;

/**
 * Speak text using available TTS
 * Now includes voice queue coordination
 */
async function speakText(text, options = {}) {
  const { voice = null, rate = null, skipLock = false } = options;

  // Acquire voice lock (unless skipped)
  const voiceLock = new VoiceLock();
  globalVoiceLock = voiceLock;

  if (!skipLock) {
    dim("Checking voice queue...");
    const lockResult = await voiceLock.waitForLock(10000);

    if (!lockResult.success) {
      if (lockResult.timeout) {
        warn("Timeout waiting for voice access");
        if (lockResult.holder) {
          dim(`Lock held by: ${lockResult.holder.cliId} (PID: ${lockResult.holder.pid})`);
        }
      } else if (lockResult.holder) {
        warn(`Voice busy - held by ${lockResult.holder.cliId}`);
      }
      return 1;
    }
  }

  try {
    // Try to use voice-shared TTS factory first
    try {
      const { TTSFactory } = await import("../../ui/dist/voice-shared/tts/tts-factory.js");

      // Get configured voice if no voice specified
      const configuredVoice = voice || getConfiguredVoice();

      // Create factory and get engine with specified voice
      const ttsFactory = new TTSFactory();
      const { engine, provider } = await ttsFactory.getEngine(undefined, configuredVoice);

      dim(`Using ${provider} TTS...`);

      // Show voice being used if available
      if (configuredVoice && provider === "piper") {
        dim(`Voice: ${configuredVoice}`);
      }

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
        info("Install voice-shared TTS providers or run on macOS");
        return 1;
      }
    }
  } finally {
    // Always release lock when done
    if (!skipLock) {
      voiceLock.release();
      globalVoiceLock = null;
    }
  }
}

// Cleanup on exit
process.on("exit", () => {
  if (globalVoiceLock) {
    globalVoiceLock.release();
  }
});

process.on("SIGINT", () => {
  if (globalVoiceLock) {
    globalVoiceLock.release();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  if (globalVoiceLock) {
    globalVoiceLock.release();
  }
  process.exit(0);
});

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
  ${pc.yellow("--voice <name>")}       Use specific voice (one-time)
  ${pc.yellow("--rate <speed>")}       Speech rate (macOS only, default: 200)
  ${pc.yellow("--list-voices")}        List all available Piper voices
  ${pc.yellow("--set-voice <name>")}   Set default voice in config
  ${pc.yellow("--get-voice")}          Show current default voice
  ${pc.yellow("--auto-on")}            Enable auto-speak mode
  ${pc.yellow("--auto-off")}           Disable auto-speak mode
  ${pc.yellow("--auto-status")}        Check auto-speak status
  ${pc.yellow("--queue-status")}       Show voice queue lock status
  ${pc.yellow("--skip-lock")}          Skip queue lock (use with caution)

${pc.bold("Examples:")}
  ${pc.dim('ralph speak "Task completed successfully"')}
  ${pc.dim('echo "Build finished" | ralph speak')}
  ${pc.dim('ralph speak "Hello" --voice alba')}
  ${pc.dim('ralph speak --list-voices')}
  ${pc.dim('ralph speak --set-voice ryan')}
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
    let listVoices = false;
    let setVoice = null;
    let getVoice = false;
    let skipLock = false;
    let showQueueStatus = false;

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
      } else if (arg === "--list-voices") {
        listVoices = true;
      } else if (arg === "--set-voice") {
        setVoice = args[++i];
      } else if (arg === "--get-voice") {
        getVoice = true;
      } else if (arg === "--skip-lock" || arg === "--force") {
        skipLock = true;
      } else if (arg === "--queue-status") {
        showQueueStatus = true;
      } else if (arg === "--help" || arg === "-h") {
        console.log(this.help);
        return 0;
      } else if (!arg.startsWith("-")) {
        textParts.push(arg);
      }
    }

    // Handle queue status check
    if (showQueueStatus) {
      const voiceLock = new VoiceLock();
      const holder = voiceLock.getLockHolder();

      if (holder && voiceLock.isProcessAlive(holder.pid)) {
        console.log(pc.yellow("Voice lock: HELD"));
        console.log(`  By: ${pc.cyan(holder.cliId)}`);
        console.log(`  PID: ${holder.pid}`);
        console.log(`  Since: ${holder.acquiredAt}`);
      } else {
        console.log(pc.green("Voice lock: AVAILABLE"));
      }
      return 0;
    }

    // Handle voice listing
    if (listVoices) {
      try {
        const { getVoiceDetails } = await import("../../ui/dist/voice-shared/tts/piper-tts.js");
        const voices = getVoiceDetails();

        if (voices.length === 0) {
          info("No Piper voices found");
          console.log("");
          info("To install Piper voices:");
          console.log("  1. Install piper: " + pc.cyan("pip3 install piper-tts"));
          console.log("  2. Download voice models to: " + pc.dim("~/.local/share/piper-voices/"));
          return 0;
        }

        console.log("");
        console.log(pc.bold("Available Piper Voices:"));
        console.log("");

        const installedVoices = voices.filter(v => v.installed);
        const notInstalledVoices = voices.filter(v => !v.installed);

        if (installedVoices.length > 0) {
          console.log(pc.green("Installed:"));
          for (const voice of installedVoices) {
            const marker = pc.green("✓");
            const name = pc.cyan(voice.id.padEnd(15));
            const lang = pc.dim(`[${voice.language}]`.padEnd(12));
            const quality = pc.yellow(voice.quality.padEnd(8));
            console.log(`  ${marker} ${name} ${lang} ${quality}`);
          }
          console.log("");
        }

        if (notInstalledVoices.length > 0) {
          console.log(pc.dim("Available (not installed):"));
          for (const voice of notInstalledVoices) {
            const marker = pc.dim("○");
            const name = pc.dim(voice.id.padEnd(15));
            const lang = pc.dim(`[${voice.language}]`.padEnd(12));
            const quality = pc.dim(voice.quality.padEnd(8));
            console.log(`  ${marker} ${name} ${lang} ${quality}`);
          }
          console.log("");
        }

        info(`Use ${pc.cyan("ralph speak --set-voice <name>")} to set default voice`);
        return 0;
      } catch (err) {
        error(`Failed to list voices: ${err.message}`);
        info("Ensure voice-shared is built: " + pc.cyan("cd ui && npm run build"));
        return 1;
      }
    }

    // Handle auto-speak toggle
    const ralphDir = path.join(process.cwd(), ".ralph");
    const configPath = path.join(ralphDir, "voice-config.json");

    // Handle get-voice
    if (getVoice) {
      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {
          // Invalid JSON
        }
      }

      const currentVoice = config.voice || "lessac (default)";
      info(`Current voice: ${pc.cyan(currentVoice)}`);
      return 0;
    }

    // Handle set-voice
    if (setVoice) {
      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {
          // Invalid JSON, start fresh
        }
      }

      // Verify voice exists
      try {
        const { getVoiceDetails } = await import("../../ui/dist/voice-shared/tts/piper-tts.js");
        const voices = getVoiceDetails();
        const voiceExists = voices.some(v => v.id.toLowerCase() === setVoice.toLowerCase());

        if (!voiceExists) {
          error(`Voice '${setVoice}' not found`);
          info(`Run ${pc.cyan("ralph speak --list-voices")} to see available voices`);
          return 1;
        }

        const voice = voices.find(v => v.id.toLowerCase() === setVoice.toLowerCase());
        if (!voice.installed) {
          warn(`Voice '${setVoice}' is not installed yet`);
          info("The voice model needs to be downloaded to ~/.local/share/piper-voices/");
        }

        config.voice = setVoice.toLowerCase();
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success(`Default voice set to: ${pc.cyan(setVoice)}`);
        info(`Test it: ${pc.cyan(`ralph speak "Hello from ${setVoice}"`)}`);
        return 0;
      } catch (err) {
        error(`Failed to set voice: ${err.message}`);
        return 1;
      }
    }

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

    return await speakText(text, { voice, rate, skipLock });
  },
};
