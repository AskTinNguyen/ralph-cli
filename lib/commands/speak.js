/**
 * Ralph speak command - TTS for text
 * Speaks text using available TTS provider
 *
 * Includes voice queue coordination to prevent concurrent TTS across terminals
 *
 * VieNeu-TTS support added for Vietnamese voice cloning
 * Source: claude-auto-speak 45a1ee0, eb16cab, 554c00c
 */
const { spawn, execSync } = require("child_process");
const { success, error, info, dim, pc, warn } = require("../cli");

/**
 * Get voice configuration from voice-config.json
 * @returns {Object} Voice configuration object
 */
function getVoiceConfig() {
  const path = require("path");
  const fs = require("fs");
  const os = require("os");

  // Try project-local config first
  let configPath = path.join(process.cwd(), ".ralph", "voice-config.json");

  // Walk up to find .ralph directory
  let current = process.cwd();
  while (current !== path.dirname(current)) {
    const candidate = path.join(current, ".ralph", "voice-config.json");
    if (fs.existsSync(candidate)) {
      configPath = candidate;
      break;
    }
    current = path.dirname(current);
  }

  const defaultConfig = {
    ttsEngine: "macos", // "macos", "piper", "vieneu"
    voice: null,
    rate: 175,
    // VieNeu-TTS settings
    vieneuVoice: "Vinh", // Default preset voice
    vieneuModel: "vieneu-0.3b", // "vieneu-0.3b" (faster) or "vieneu-0.5b" (higher quality)
    // Multilingual settings
    multilingual: {
      enabled: true,
      autoDetect: true,
    },
  };

  if (!fs.existsSync(configPath)) {
    return defaultConfig;
  }

  try {
    const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return { ...defaultConfig, ...config };
  } catch (err) {
    return defaultConfig;
  }
}

/**
 * Get configured voice from voice-config.json (legacy function)
 */
function getConfiguredVoice() {
  const config = getVoiceConfig();
  return config.voice || null;
}

/**
 * Speak text using VieNeu-TTS (Vietnamese voice cloning)
 * @param {string} text - Text to speak
 * @param {Object} config - Voice configuration
 * @returns {Promise<number>} Exit code
 */
async function speakWithVieneu(text, config) {
  const path = require("path");
  const fs = require("fs");
  const os = require("os");

  const vieneuDir = path.join(os.homedir(), ".agents", "ralph", "vieneu");
  const vieneuVenv = path.join(vieneuDir, "venv", "bin", "python3");
  const vieneuScript = path.join(__dirname, "../../.agents/ralph/vieneu-tts.py");

  // Check if VieNeu is installed
  if (!fs.existsSync(vieneuVenv)) {
    error("VieNeu-TTS not installed");
    info("Run: " + pc.cyan(".agents/ralph/setup/vieneu-setup.sh"));
    return 1;
  }

  if (!fs.existsSync(vieneuScript)) {
    error("VieNeu-TTS wrapper script not found");
    info("Expected at: " + pc.dim(vieneuScript));
    return 1;
  }

  const voice = config.vieneuVoice || "Vinh";
  const model = config.vieneuModel || "vieneu-0.3b";

  // Generate temp wav file
  const tmpdir = os.tmpdir();
  const tempFile = path.join(tmpdir, `speak-${Date.now()}.wav`);

  try {
    // Run vieneu-tts.py to generate audio
    const args = [
      vieneuScript,
      "--text", text,
      "--voice", voice,
      "--output", tempFile,
      "--model", model.replace("vieneu-", ""),
    ];

    dim(`Using VieNeu-TTS (voice: ${voice}, model: ${model})...`);

    execSync(`"${vieneuVenv}" ${args.map(a => `"${a}"`).join(" ")}`, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Play the audio
    if (process.platform === "darwin") {
      execSync(`afplay "${tempFile}"`, { stdio: "inherit" });
    } else {
      execSync(`aplay "${tempFile}"`, { stdio: "inherit" });
    }

    // Clean up
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }

    return 0;
  } catch (err) {
    if (fs.existsSync(tempFile)) {
      fs.unlinkSync(tempFile);
    }
    error(`VieNeu-TTS error: ${err.message}`);
    return 1;
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
 * Supports VieNeu-TTS for Vietnamese voice cloning
 */
async function speakText(text, options = {}) {
  const { voice = null, rate = null, skipLock = false, engine = null } = options;

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
    // Get voice configuration
    const config = getVoiceConfig();
    let ttsEngine = engine || config.ttsEngine || "macos";

    // Auto-detect language and route to VieNeu for Vietnamese
    if (config.multilingual?.enabled && config.multilingual?.autoDetect && !engine) {
      try {
        const { detectLanguage, isVieneuInstalled } = await import("../../.agents/ralph/language-voice-mapper.mjs");
        const detectedLang = detectLanguage(text);

        if (detectedLang === "vi" && isVieneuInstalled()) {
          dim(`Detected Vietnamese, routing to VieNeu-TTS...`);
          ttsEngine = "vieneu";
        }
      } catch (langErr) {
        // Language detection failed, continue with configured engine
      }
    }

    // Use VieNeu-TTS for Vietnamese voice cloning
    if (ttsEngine === "vieneu") {
      return await speakWithVieneu(text, config);
    }

    // Try to use voice-shared TTS factory first (for piper)
    try {
      const { TTSFactory } = await import("../../ui/dist/voice-shared/tts/tts-factory.js");

      // Get configured voice if no voice specified
      const configuredVoice = voice || getConfiguredVoice();

      // Create factory and get engine with specified voice
      const ttsFactory = new TTSFactory();
      const { engine: ttsEngineInstance, provider } = await ttsFactory.getEngine(undefined, configuredVoice);

      dim(`Using ${provider} TTS...`);

      // Show voice being used if available
      if (configuredVoice && provider === "piper") {
        dim(`Voice: ${configuredVoice}`);
      }

      await ttsEngineInstance.speak(text);
      return 0;
    } catch (err) {
      // Fallback to macOS say command
      if (process.platform === "darwin") {
        return new Promise((resolve) => {
          const args = [];
          if (voice) args.push("-v", voice);
          if (rate) args.push("-r", rate || config.rate || "175");
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
  ${pc.yellow("--voice <name>")}           Use specific voice (one-time)
  ${pc.yellow("--rate <speed>")}           Speech rate (macOS only, default: 175)
  ${pc.yellow("--list-voices")}            List all available Piper voices
  ${pc.yellow("--set-voice <name>")}       Set default Piper voice in config
  ${pc.yellow("--get-voice")}              Show current default voice
  ${pc.yellow("--auto-on")}                Enable auto-speak mode
  ${pc.yellow("--auto-off")}               Disable auto-speak mode
  ${pc.yellow("--auto-status")}            Check auto-speak status
  ${pc.yellow("--auto-mode")}              Show current auto-speak mode
  ${pc.yellow("--auto-mode=<mode>")}       Set auto-speak mode (short|medium|full|adaptive)
  ${pc.yellow("--queue-status")}           Show voice queue lock status
  ${pc.yellow("--skip-lock")}              Skip queue lock (use with caution)

${pc.bold("TTS Engine Options:")}
  ${pc.yellow("--get-tts-engine")}         Show current TTS engine
  ${pc.yellow("--set-tts-engine <name>")}  Set TTS engine (macos|piper|vieneu)

${pc.bold("VieNeu-TTS Options (Vietnamese Voice Cloning):")}
  ${pc.yellow("--list-vieneu-voices")}     List available VieNeu voices
  ${pc.yellow("--set-vieneu-voice <n>")}   Set VieNeu voice (preset or cloned)
  ${pc.yellow("--set-vieneu-model <m>")}   Set VieNeu model (vieneu-0.3b|vieneu-0.5b)
  ${pc.yellow("--engine vieneu")}          Use VieNeu for this command only

${pc.bold("Examples:")}
  ${pc.dim('ralph speak "Task completed successfully"')}
  ${pc.dim('echo "Build finished" | ralph speak')}
  ${pc.dim('ralph speak "Hello" --voice alba')}
  ${pc.dim('ralph speak --list-voices')}
  ${pc.dim('ralph speak --set-voice ryan')}
  ${pc.dim('ralph speak --auto-mode=adaptive')}

${pc.bold("VieNeu Examples:")}
  ${pc.dim('ralph speak --set-tts-engine vieneu')}
  ${pc.dim('ralph speak --set-vieneu-voice Vinh')}
  ${pc.dim('ralph speak "Xin chao the gioi"')}
  ${pc.dim('ralph speak --engine vieneu "Xin chao"')}
  ${pc.dim('ralph speak --list-vieneu-voices')}

${pc.bold("VieNeu Preset Voices:")}
  Binh, Tuyen, Vinh, Doan, Ly, Ngoc

${pc.bold("Multilingual Options:")}
  ${pc.yellow("--multilingual-on")}          Enable auto language detection
  ${pc.yellow("--multilingual-off")}         Disable auto language detection
  ${pc.yellow("--multilingual-status")}      Show multilingual status

${pc.bold("VieNeu Setup:")}
  Run: ${pc.cyan(".agents/ralph/setup/vieneu-setup.sh")}
`,

  async run(args, env, options) {
    const path = require("path");
    const fs = require("fs");
    const os = require("os");

    // Parse arguments
    const textParts = [];
    let voice = null;
    let rate = null;
    let autoOn = false;
    let autoOff = false;
    let autoStatus = false;
    let autoModeGet = false;
    let autoModeSet = null;
    let listVoices = false;
    let setVoice = null;
    let getVoice = false;
    let skipLock = false;
    let showQueueStatus = false;
    // VieNeu options
    let getTtsEngine = false;
    let setTtsEngine = null;
    let listVieneuVoices = false;
    let setVieneuVoice = null;
    let setVieneuModel = null;
    let engineOverride = null;
    // Multilingual options
    let multilingualOn = false;
    let multilingualOff = false;
    let multilingualStatus = false;

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
      } else if (arg === "--auto-mode") {
        autoModeGet = true;
      } else if (arg.startsWith("--auto-mode=")) {
        autoModeSet = arg.split("=")[1];
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
      // VieNeu options
      } else if (arg === "--get-tts-engine") {
        getTtsEngine = true;
      } else if (arg === "--set-tts-engine") {
        setTtsEngine = args[++i];
      } else if (arg === "--list-vieneu-voices") {
        listVieneuVoices = true;
      } else if (arg === "--set-vieneu-voice") {
        setVieneuVoice = args[++i];
      } else if (arg === "--set-vieneu-model") {
        setVieneuModel = args[++i];
      } else if (arg === "--engine") {
        engineOverride = args[++i];
      // Multilingual options
      } else if (arg === "--multilingual-on") {
        multilingualOn = true;
      } else if (arg === "--multilingual-off") {
        multilingualOff = true;
      } else if (arg === "--multilingual-status") {
        multilingualStatus = true;
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

    // Handle TTS engine get/set
    const ralphDir = path.join(process.cwd(), ".ralph");
    const configPath = path.join(ralphDir, "voice-config.json");

    if (getTtsEngine) {
      const config = getVoiceConfig();
      const engine = config.ttsEngine || "macos";
      info(`TTS engine: ${pc.cyan(engine)}`);
      console.log("");
      console.log(pc.dim("Available engines:"));
      console.log(`  ${pc.yellow("macos")}   macOS say command (default)`);
      console.log(`  ${pc.yellow("piper")}   Piper neural TTS`);
      console.log(`  ${pc.yellow("vieneu")}  VieNeu-TTS (Vietnamese voice cloning)`);
      return 0;
    }

    if (setTtsEngine) {
      const validEngines = ["macos", "piper", "vieneu"];
      if (!validEngines.includes(setTtsEngine)) {
        error(`Invalid TTS engine: ${setTtsEngine}`);
        info(`Valid engines: ${validEngines.join(", ")}`);
        return 1;
      }

      // Check if VieNeu is installed
      if (setTtsEngine === "vieneu") {
        const vieneuVenv = path.join(os.homedir(), ".agents", "ralph", "vieneu", "venv", "bin", "python3");
        if (!fs.existsSync(vieneuVenv)) {
          warn("VieNeu-TTS is not installed yet");
          info("Run: " + pc.cyan(".agents/ralph/setup/vieneu-setup.sh"));
        }
      }

      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {}
      }

      config.ttsEngine = setTtsEngine;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      success(`TTS engine set to: ${pc.cyan(setTtsEngine)}`);

      if (setTtsEngine === "vieneu") {
        info("VieNeu preset voices: Binh, Tuyen, Vinh, Doan, Ly, Ngoc");
        info(`Current voice: ${pc.cyan(config.vieneuVoice || "Vinh")}`);
      }
      return 0;
    }

    // Handle VieNeu voices listing
    if (listVieneuVoices) {
      console.log("");
      console.log(pc.bold("VieNeu-TTS Voices:"));
      console.log("");
      console.log(pc.green("Preset voices (no cloning needed):"));
      const presetVoices = ["Binh", "Tuyen", "Vinh", "Doan", "Ly", "Ngoc"];
      for (const v of presetVoices) {
        console.log(`  ${pc.green("✓")} ${pc.cyan(v)}`);
      }
      console.log("");

      // Check for cloned voices
      const referencesDir = path.join(os.homedir(), ".agents", "ralph", "vieneu", "references");
      if (fs.existsSync(referencesDir)) {
        const clonedVoices = fs.readdirSync(referencesDir)
          .filter(f => f.endsWith(".wav"))
          .map(f => f.replace(".wav", ""));

        if (clonedVoices.length > 0) {
          console.log(pc.green("Cloned voices:"));
          for (const v of clonedVoices) {
            console.log(`  ${pc.green("✓")} ${pc.cyan(v)} ${pc.dim("(custom)")}`);
          }
          console.log("");
        }
      }

      const config = getVoiceConfig();
      info(`Current voice: ${pc.cyan(config.vieneuVoice || "Vinh")}`);
      info(`Current model: ${pc.cyan(config.vieneuModel || "vieneu-0.3b")}`);
      return 0;
    }

    // Handle VieNeu voice set
    if (setVieneuVoice) {
      const presetVoices = ["Binh", "Tuyen", "Vinh", "Doan", "Ly", "Ngoc"];
      const referencesDir = path.join(os.homedir(), ".agents", "ralph", "vieneu", "references");

      // Check if it's a preset voice
      const isPreset = presetVoices.some(v => v.toLowerCase() === setVieneuVoice.toLowerCase());

      // Check if it's a cloned voice
      let isCloned = false;
      if (fs.existsSync(referencesDir)) {
        const clonedVoices = fs.readdirSync(referencesDir)
          .filter(f => f.endsWith(".wav"))
          .map(f => f.replace(".wav", "").toLowerCase());
        isCloned = clonedVoices.includes(setVieneuVoice.toLowerCase());
      }

      if (!isPreset && !isCloned) {
        error(`Voice '${setVieneuVoice}' not found`);
        info(`Preset voices: ${presetVoices.join(", ")}`);
        info(`Run ${pc.cyan("ralph speak --list-vieneu-voices")} to see all voices`);
        return 1;
      }

      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {}
      }

      // Use correct casing for preset voices
      if (isPreset) {
        config.vieneuVoice = presetVoices.find(v => v.toLowerCase() === setVieneuVoice.toLowerCase());
      } else {
        config.vieneuVoice = setVieneuVoice;
      }

      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      success(`VieNeu voice set to: ${pc.cyan(config.vieneuVoice)}`);
      info(`Test it: ${pc.cyan('ralph speak "Xin chao the gioi"')}`);
      return 0;
    }

    // Handle VieNeu model set
    if (setVieneuModel) {
      const validModels = ["vieneu-0.3b", "vieneu-0.5b", "0.3b", "0.5b"];
      if (!validModels.includes(setVieneuModel)) {
        error(`Invalid VieNeu model: ${setVieneuModel}`);
        info("Valid models: vieneu-0.3b (faster), vieneu-0.5b (higher quality)");
        return 1;
      }

      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {}
      }

      // Normalize model name
      config.vieneuModel = setVieneuModel.startsWith("vieneu-") ? setVieneuModel : `vieneu-${setVieneuModel}`;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      success(`VieNeu model set to: ${pc.cyan(config.vieneuModel)}`);
      return 0;
    }

    // Handle multilingual options
    if (multilingualOn || multilingualOff || multilingualStatus) {
      if (!fs.existsSync(ralphDir)) {
        fs.mkdirSync(ralphDir, { recursive: true });
      }

      let config = {};
      if (fs.existsSync(configPath)) {
        try {
          config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        } catch (err) {}
      }

      // Ensure multilingual object exists
      if (!config.multilingual) {
        config.multilingual = { enabled: true, autoDetect: true };
      }

      if (multilingualOn) {
        config.multilingual.enabled = true;
        config.multilingual.autoDetect = true;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success("Multilingual auto-detection enabled");
        info("Vietnamese text will auto-route to VieNeu-TTS");

        // Check if VieNeu is installed
        const vieneuVenv = path.join(os.homedir(), ".agents", "ralph", "vieneu", "venv", "bin", "python3");
        if (!fs.existsSync(vieneuVenv)) {
          warn("VieNeu-TTS is not installed");
          info("Run: " + pc.cyan(".agents/ralph/setup/vieneu-setup.sh"));
        }
        return 0;
      }

      if (multilingualOff) {
        config.multilingual.enabled = false;
        config.multilingual.autoDetect = false;
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success("Multilingual auto-detection disabled");
        return 0;
      }

      if (multilingualStatus) {
        const enabled = config.multilingual?.enabled !== false;
        const autoDetect = config.multilingual?.autoDetect !== false;
        console.log("");
        console.log(pc.bold("Multilingual Settings:"));
        console.log(`  Enabled: ${enabled ? pc.green("yes") : pc.dim("no")}`);
        console.log(`  Auto-detect: ${autoDetect ? pc.green("yes") : pc.dim("no")}`);
        console.log("");

        // Check VieNeu installation
        const vieneuVenv = path.join(os.homedir(), ".agents", "ralph", "vieneu", "venv", "bin", "python3");
        const vieneuInstalled = fs.existsSync(vieneuVenv);
        console.log(`  VieNeu-TTS: ${vieneuInstalled ? pc.green("installed") : pc.yellow("not installed")}`);

        if (enabled && autoDetect) {
          console.log("");
          info("Vietnamese text will auto-route to VieNeu-TTS");
        }
        return 0;
      }
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

    // Handle auto-mode get/set
    if (autoModeGet || autoModeSet) {
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

      if (autoModeGet) {
        // Show current mode
        let currentMode = "short";
        if (typeof config.autoSpeak === "object" && config.autoSpeak.mode) {
          currentMode = config.autoSpeak.mode;
        } else if (config.autoSpeak === true) {
          currentMode = "short (legacy)";
        }
        console.log(`Auto-speak mode: ${pc.cyan(currentMode)}`);
        console.log("");
        console.log(pc.dim("Available modes:"));
        console.log(`  ${pc.yellow("short")}     ~30 words, 1-2 sentences (default)`);
        console.log(`  ${pc.yellow("medium")}    ~100 words, bulleted list`);
        console.log(`  ${pc.yellow("full")}      ~200 words, comprehensive summary`);
        console.log(`  ${pc.yellow("adaptive")}  Auto-detect based on response complexity`);
        return 0;
      }

      if (autoModeSet) {
        const validModes = ["short", "medium", "full", "adaptive"];
        if (!validModes.includes(autoModeSet)) {
          error(`Invalid mode: ${autoModeSet}`);
          info(`Valid modes: ${validModes.join(", ")}`);
          return 1;
        }

        // Ensure autoSpeak is an object with new format
        if (typeof config.autoSpeak !== "object") {
          config.autoSpeak = {
            enabled: config.autoSpeak === true,
            mode: autoModeSet,
          };
        } else {
          config.autoSpeak.mode = autoModeSet;
        }

        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success(`Auto-speak mode set to: ${pc.cyan(autoModeSet)}`);

        if (autoModeSet === "adaptive") {
          info("Summaries will auto-adjust based on response complexity");
        } else {
          info(`Summaries will use ${autoModeSet} format`);
        }
        return 0;
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
        // Preserve existing mode if using new format, otherwise default to short
        if (typeof config.autoSpeak === "object") {
          config.autoSpeak.enabled = true;
        } else {
          config.autoSpeak = { enabled: true, mode: "short" };
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success("Auto-speak mode enabled");
        const mode = config.autoSpeak.mode || "short";
        info(`All Claude Code responses will be spoken automatically (mode: ${pc.cyan(mode)})`);
        info(`Run ${pc.cyan("ralph speak --auto-off")} to disable`);
        info(`Change mode with ${pc.cyan("ralph speak --auto-mode=adaptive")}`);
        return 0;
      }

      if (autoOff) {
        // Preserve mode setting when disabling
        if (typeof config.autoSpeak === "object") {
          config.autoSpeak.enabled = false;
        } else {
          config.autoSpeak = { enabled: false, mode: "short" };
        }
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
        success("Auto-speak mode disabled");
        return 0;
      }

      if (autoStatus) {
        let enabled = false;
        let mode = "short";
        if (typeof config.autoSpeak === "object") {
          enabled = config.autoSpeak.enabled !== false;
          mode = config.autoSpeak.mode || "short";
        } else {
          enabled = config.autoSpeak === true;
        }
        info(`Auto-speak: ${enabled ? pc.green("enabled") : pc.dim("disabled")} (mode: ${pc.cyan(mode)})`);
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

    return await speakText(text, { voice, rate, skipLock, engine: engineOverride });
  },
};
