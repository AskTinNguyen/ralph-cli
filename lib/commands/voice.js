/**
 * Ralph voice command
 * Voice control for Claude Code terminal CLI
 */
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn, exec } = require("child_process");
const { promisify } = require("util");
const { success, error, info, dim, warn, pc } = require("../cli");

const execAsync = promisify(exec);
const fsUnlink = promisify(fs.unlink);

// STT server configuration
const STT_PORT = 5001;
const STT_HEALTH_TIMEOUT = 10000; // 10 seconds
const STT_HEALTH_POLL_INTERVAL = 500; // 500ms between health checks
const STT_SERVER_PATH = path.join(__dirname, "../../ui/python/stt_server.py");
const STT_VENV_PATH = path.join(__dirname, "../../ui/python/venv");

// Track spawned STT server process
let sttServerProcess = null;

// Audio recording configuration
const AUDIO_SAMPLE_RATE = 16000; // 16kHz for Whisper
const AUDIO_CHANNELS = 1; // Mono
const SILENCE_DURATION = 2.0; // seconds of silence before auto-stop
const SILENCE_THRESHOLD = -50; // dB threshold for silence detection

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
 * Detect available audio recording tool (sox or ffmpeg)
 * @returns {Promise<{tool: string, path: string} | null>}
 */
async function detectAudioTool() {
  // Check for sox first (preferred)
  try {
    const { stdout: soxPath } = await execAsync("which sox", { timeout: 5000 });
    if (soxPath.trim()) {
      return { tool: "sox", path: soxPath.trim() };
    }
  } catch (e) {
    // sox not found
  }

  // Check for rec (sox recording command)
  try {
    const { stdout: recPath } = await execAsync("which rec", { timeout: 5000 });
    if (recPath.trim()) {
      return { tool: "rec", path: recPath.trim() };
    }
  } catch (e) {
    // rec not found
  }

  // Check for ffmpeg
  try {
    const { stdout: ffmpegPath } = await execAsync("which ffmpeg", { timeout: 5000 });
    if (ffmpegPath.trim()) {
      return { tool: "ffmpeg", path: ffmpegPath.trim() };
    }
  } catch (e) {
    // ffmpeg not found
  }

  return null;
}

/**
 * Get the default audio input device for ffmpeg on macOS
 * @returns {Promise<string>}
 */
async function getFFmpegAudioDevice() {
  if (process.platform === "darwin") {
    // On macOS, use avfoundation with default audio input
    // List devices to find the default microphone index
    try {
      const { stderr } = await execAsync(
        'ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true',
        { timeout: 5000 }
      );
      // Parse output to find audio devices (after "[AVFoundation indev @ ...]")
      // Default microphone is typically :0 or :1
      // For simplicity, use :0 (default audio input)
      return ":0";
    } catch (e) {
      return ":0";
    }
  } else if (process.platform === "linux") {
    // On Linux, use ALSA default device
    return "default";
  } else if (process.platform === "win32") {
    // On Windows, use DirectShow audio device
    return "audio=Microphone";
  }
  return "default";
}

/**
 * Record audio from microphone
 * @param {Object} options - Recording options
 * @param {string} options.outputPath - Path to save the WAV file
 * @param {Function} options.onStart - Callback when recording starts
 * @param {Function} options.onProgress - Callback for elapsed time updates (seconds)
 * @param {Function} options.onStop - Callback when recording stops
 * @param {AbortSignal} options.signal - Signal to abort recording
 * @returns {Promise<{success: boolean, duration?: number, error?: string}>}
 */
async function recordAudio(options) {
  const {
    outputPath,
    onStart,
    onProgress,
    onStop,
    signal,
  } = options;

  const audioTool = await detectAudioTool();
  if (!audioTool) {
    return {
      success: false,
      error: `No audio recording tool found. Please install sox or ffmpeg:
  macOS: brew install sox (or brew install ffmpeg)
  Linux: sudo apt install sox (or sudo apt install ffmpeg)
  Windows: Download from https://www.ffmpeg.org/download.html`,
    };
  }

  return new Promise((resolve) => {
    let recordingProcess = null;
    let startTime = Date.now();
    let progressInterval = null;
    let stopped = false;

    // Clean up function
    const cleanup = async (result) => {
      if (stopped) return;
      stopped = true;

      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }

      if (recordingProcess && !recordingProcess.killed) {
        // Send SIGINT to gracefully stop recording (ffmpeg needs SIGINT to finalize file)
        recordingProcess.kill("SIGINT");
        // Give ffmpeg time to finalize the WAV file (needs time to flush buffers and write headers)
        await new Promise(r => setTimeout(r, 1000));
      }

      if (onStop) {
        onStop();
      }

      resolve(result);
    };

    // Handle abort signal
    if (signal) {
      signal.addEventListener("abort", () => {
        cleanup({
          success: false,
          error: "Recording aborted",
        });
      });
    }

    try {
      if (audioTool.tool === "sox" || audioTool.tool === "rec") {
        // Use sox/rec for recording with silence detection
        const recCmd = audioTool.tool === "rec" ? audioTool.path : audioTool.path.replace(/sox$/, "rec");

        // sox recording command with silence detection
        // silence 1 0.1 1% = start recording after 0.1s of sound above 1%
        // silence 1 2.0 1% = stop after 2s of silence below 1%
        recordingProcess = spawn(recCmd, [
          "-q", // quiet mode
          "-r", String(AUDIO_SAMPLE_RATE),
          "-c", String(AUDIO_CHANNELS),
          "-b", "16", // 16-bit
          outputPath,
          "silence", "1", "0.1", "1%", // wait for sound
          "1", String(SILENCE_DURATION), "1%", // stop on silence
        ], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else if (audioTool.tool === "ffmpeg") {
        // Use ffmpeg for recording
        (async () => {
          const audioDevice = await getFFmpegAudioDevice();

          const ffmpegArgs = [];

          if (process.platform === "darwin") {
            ffmpegArgs.push(
              "-f", "avfoundation",
              "-i", audioDevice
            );
          } else if (process.platform === "linux") {
            ffmpegArgs.push(
              "-f", "alsa",
              "-i", audioDevice
            );
          } else if (process.platform === "win32") {
            ffmpegArgs.push(
              "-f", "dshow",
              "-i", audioDevice
            );
          }

          ffmpegArgs.push(
            "-acodec", "pcm_s16le", // 16-bit signed PCM (required for proper WAV)
            "-ar", String(AUDIO_SAMPLE_RATE),
            "-ac", String(AUDIO_CHANNELS),
            "-f", "wav", // Explicit WAV format
            "-y", // overwrite output file
            outputPath
          );

          recordingProcess = spawn(audioTool.path, ffmpegArgs, {
            stdio: ["pipe", "pipe", "pipe"],
          });

          // ffmpeg outputs to stderr
          recordingProcess.stderr.on("data", (data) => {
            // Could parse ffmpeg output for duration info
          });

          recordingProcess.on("error", (err) => {
            cleanup({
              success: false,
              error: `Recording error: ${err.message}`,
            });
          });

          recordingProcess.on("close", (code) => {
            if (!stopped) {
              const duration = (Date.now() - startTime) / 1000;
              // Check if file was created and has content
              if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
                cleanup({
                  success: true,
                  duration,
                });
              } else {
                cleanup({
                  success: false,
                  error: "Recording failed - no audio captured",
                });
              }
            }
          });
        })();
      }

      // Set up process event handlers for sox/rec
      if (audioTool.tool === "sox" || audioTool.tool === "rec") {
        recordingProcess.on("error", (err) => {
          cleanup({
            success: false,
            error: `Recording error: ${err.message}`,
          });
        });

        recordingProcess.on("close", (code) => {
          if (!stopped) {
            const duration = (Date.now() - startTime) / 1000;
            if (code === 0 && fs.existsSync(outputPath)) {
              cleanup({
                success: true,
                duration,
              });
            } else {
              cleanup({
                success: false,
                error: `Recording failed with exit code ${code}`,
              });
            }
          }
        });
      }

      // Start progress updates
      if (onStart) {
        onStart();
      }

      progressInterval = setInterval(() => {
        if (!stopped && onProgress) {
          const elapsed = (Date.now() - startTime) / 1000;
          onProgress(elapsed);
        }
      }, 100); // Update every 100ms

    } catch (err) {
      cleanup({
        success: false,
        error: `Failed to start recording: ${err.message}`,
      });
    }
  });
}

/**
 * Wait for Enter key press
 * @returns {Promise<void>}
 */
function waitForEnter() {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      // Non-interactive mode, resolve immediately
      setTimeout(resolve, 100);
      return;
    }

    const wasRaw = process.stdin.isRaw;
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const onData = (key) => {
      // Check for Enter key (carriage return or newline) or Ctrl+C
      if (key[0] === 13 || key[0] === 10 || key[0] === 3) {
        process.stdin.removeListener("data", onData);
        if (wasRaw !== undefined) {
          process.stdin.setRawMode(wasRaw);
        }
        process.stdin.pause();

        // Ctrl+C
        if (key[0] === 3) {
          process.emit("SIGINT");
        }
        resolve();
      }
    };

    process.stdin.on("data", onData);
  });
}

/**
 * Transcribe audio file using the Whisper server
 * @param {string} audioPath - Path to the audio file
 * @returns {Promise<{success: boolean, text?: string, error?: string}>}
 */
async function transcribeAudio(audioPath) {
  try {
    // Read the audio file
    const audioBuffer = fs.readFileSync(audioPath);

    // Send to Whisper server
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: "audio/wav" });
    formData.append("file", blob, "audio.wav");

    const response = await fetch(`http://localhost:${STT_PORT}/transcribe`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return {
        success: false,
        error: errorData.error || `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const data = await response.json();
    if (!data.success) {
      return {
        success: false,
        error: data.error || "Transcription failed",
      };
    }

    return {
      success: true,
      text: data.text || "",
      language: data.language,
      duration_ms: data.duration_ms,
    };
  } catch (err) {
    return {
      success: false,
      error: `Transcription error: ${err.message}`,
    };
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
 * Format elapsed time for display
 * @param {number} seconds - Elapsed time in seconds
 * @returns {string} Formatted time string
 */
function formatElapsedTime(seconds) {
  const secs = Math.floor(seconds);
  const ms = Math.floor((seconds % 1) * 10);
  return `${secs}.${ms}s`;
}

/**
 * Clear the current line and reprint (for progress updates)
 */
function updateProgressLine(message) {
  if (process.stdout.isTTY) {
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(message);
  } else {
    // Non-TTY: just print on new lines occasionally
    console.log(message);
  }
}

/**
 * Run one voice interaction cycle: record → transcribe → Claude → TTS
 * @param {Object} options - Options
 * @param {boolean} options.noTts - Disable TTS output
 * @returns {Promise<{success: boolean, transcription?: string, exitCode: number}>}
 */
async function runVoiceInteraction(options = {}) {
  const { noTts = false } = options;

  // Create temp file for audio recording
  const tempDir = os.tmpdir();
  const audioPath = path.join(tempDir, `ralph-voice-${Date.now()}.wav`);

  try {
    // Check for audio recording tool
    const audioTool = await detectAudioTool();
    if (!audioTool) {
      error(`No audio recording tool found. Please install sox or ffmpeg:`);
      console.log(`  macOS: brew install sox (or brew install ffmpeg)`);
      console.log(`  Linux: sudo apt install sox (or sudo apt install ffmpeg)`);
      return { success: false, exitCode: 1 };
    }

    dim(`Using ${audioTool.tool} for audio recording`);
    console.log("");

    // Show recording prompt
    console.log(pc.cyan("[Recording... speak now]"));
    console.log(pc.dim("Press Enter to stop recording, or wait for silence detection"));
    console.log("");

    // Set up abort controller for stopping recording
    const abortController = new AbortController();
    let recordingComplete = false;

    // Start recording with progress display
    const recordingPromise = recordAudio({
      outputPath: audioPath,
      onStart: () => {
        // Recording started
      },
      onProgress: (elapsed) => {
        if (!recordingComplete) {
          const timeStr = formatElapsedTime(elapsed);
          updateProgressLine(pc.yellow(`Recording: ${timeStr}`));
        }
      },
      onStop: () => {
        recordingComplete = true;
        if (process.stdout.isTTY) {
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
        }
      },
      signal: abortController.signal,
    });

    // Also listen for Enter key to stop recording manually
    const enterPromise = waitForEnter().then(() => {
      if (!recordingComplete) {
        abortController.abort();
      }
    });

    // Wait for recording to complete (either by silence detection or Enter key)
    const recordResult = await recordingPromise;

    // Clear the progress line
    if (process.stdout.isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
    }

    if (!recordResult.success) {
      // Check if it was aborted (manual stop)
      if (recordResult.error === "Recording aborted") {
        info("Recording stopped manually");
      } else {
        error(`Recording failed: ${recordResult.error}`);
        return { success: false, exitCode: 1 };
      }
    }

    // Check if audio file exists and has content
    if (!fs.existsSync(audioPath)) {
      error("No audio file created");
      return { success: false, exitCode: 1 };
    }

    const audioStats = fs.statSync(audioPath);
    if (audioStats.size < 1000) {
      warn("Recording too short - no audio captured");
      return { success: false, exitCode: 0 };
    }

    const duration = recordResult.duration || (audioStats.size / (AUDIO_SAMPLE_RATE * 2)); // Estimate from file size
    success(`Recording complete (${formatElapsedTime(duration)})`);
    console.log("");

    // Transcribe the audio
    dim("Transcribing...");
    const transcription = await transcribeAudio(audioPath);

    if (!transcription.success) {
      error(`Transcription failed: ${transcription.error}`);
      return { success: false, exitCode: 1 };
    }

    const transcribedText = transcription.text.trim();
    if (!transcribedText) {
      warn("No speech detected in recording");
      return { success: false, exitCode: 0 };
    }

    // Display transcription
    console.log("");
    console.log(pc.green(`You said: "${transcribedText}"`));
    console.log("");

    // Send to Claude Code
    const exitCode = await executeTextMode(transcribedText, { noTts });

    return {
      success: true,
      transcription: transcribedText,
      exitCode,
    };
  } finally {
    // Clean up temp audio file
    try {
      if (fs.existsSync(audioPath)) {
        await fsUnlink(audioPath);
      }
    } catch (e) {
      // Ignore cleanup errors
    }
  }
}

/**
 * Start interactive voice session - single recording mode
 * Records audio, transcribes, sends to Claude, speaks response
 */
async function startInteractiveSession(options = {}) {
  const { noTts = false } = options;

  info("Starting voice recording...");
  info("Press Ctrl+C to cancel.");
  console.log("");

  const result = await runVoiceInteraction({ noTts });
  return result.exitCode;
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
