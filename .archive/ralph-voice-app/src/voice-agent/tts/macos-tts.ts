/**
 * macOS TTS Engine
 *
 * Text-to-speech implementation using macOS `say` command.
 * Zero latency, no dependencies, fully offline.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { TTSConfig, TTSEngine, TTSResult } from "./tts-engine";

/**
 * macOS TTS Engine class
 */
export class MacOSTTSEngine implements TTSEngine {
  private config: TTSConfig;
  private currentProcess: ChildProcess | null = null;
  private speaking: boolean = false;

  constructor(config: TTSConfig) {
    this.config = config;
  }

  /**
   * Speak text using macOS `say` command
   */
  async speak(text: string): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      return { success: true, duration_ms: 0 };
    }

    // Stop any current speech
    this.stop();

    const startTime = Date.now();

    return new Promise((resolve) => {
      this.speaking = true;

      // Build say command arguments
      const args: string[] = [];

      // Voice
      if (this.config.voice) {
        args.push("-v", this.config.voice);
      }

      // Rate (words per minute)
      if (this.config.rate) {
        args.push("-r", String(this.config.rate));
      }

      // Add the text to speak
      args.push(text);

      this.currentProcess = spawn("say", args, {
        stdio: ["ignore", "ignore", "pipe"],
      });

      let stderr = "";

      if (this.currentProcess.stderr) {
        this.currentProcess.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      }

      this.currentProcess.on("exit", (code, signal) => {
        const duration_ms = Date.now() - startTime;
        this.speaking = false;
        this.currentProcess = null;

        if (signal === "SIGTERM" || signal === "SIGKILL") {
          resolve({
            success: true,
            duration_ms,
            interrupted: true,
          });
        } else if (code === 0) {
          resolve({
            success: true,
            duration_ms,
            interrupted: false,
          });
        } else {
          resolve({
            success: false,
            error: stderr || `Exit code: ${code}`,
            duration_ms,
          });
        }
      });

      this.currentProcess.on("error", (error) => {
        this.speaking = false;
        this.currentProcess = null;
        resolve({
          success: false,
          error: `TTS error: ${error.message}`,
          duration_ms: Date.now() - startTime,
        });
      });
    });
  }

  /**
   * Stop current speech
   */
  stop(): void {
    if (this.currentProcess) {
      this.currentProcess.kill("SIGTERM");
      this.currentProcess = null;
    }
    this.speaking = false;
    // Note: Removed aggressive pkill which was killing newly spawned processes
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Check if macOS say command is available
   */
  async checkAvailable(): Promise<{ available: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("which", ["say"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("exit", (code) => {
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            error: "macOS 'say' command not found. This feature requires macOS.",
          });
        }
      });

      child.on("error", () => {
        resolve({
          available: false,
          error: "Could not check for macOS 'say' command.",
        });
      });

      // Timeout
      setTimeout(() => {
        child.kill();
        resolve({
          available: false,
          error: "Check timed out",
        });
      }, 3000);
    });
  }

  /**
   * Get available voices on macOS
   */
  async getVoices(): Promise<string[]> {
    return new Promise((resolve) => {
      const child = spawn("say", ["-v", "?"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });
      }

      child.on("exit", () => {
        // Parse voice list
        // Format: "VoiceName    LanguageCode    # Description"
        const voices = output
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            const parts = line.split(/\s{2,}/);
            return parts[0]?.trim() || "";
          })
          .filter((voice) => voice.length > 0);

        resolve(voices);
      });

      child.on("error", () => {
        // Return common macOS voices as fallback
        resolve([
          "Samantha",
          "Alex",
          "Daniel",
          "Karen",
          "Moira",
          "Rishi",
          "Tessa",
          "Veena",
        ]);
      });

      // Timeout
      setTimeout(() => {
        child.kill();
        resolve(["Samantha", "Alex", "Daniel"]);
      }, 5000);
    });
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig {
    return { ...this.config };
  }

  /**
   * Speak with custom options (one-time override)
   */
  async speakWithOptions(
    text: string,
    options: { voice?: string; rate?: number }
  ): Promise<TTSResult> {
    const originalConfig = { ...this.config };

    if (options.voice) this.config.voice = options.voice;
    if (options.rate) this.config.rate = options.rate;

    const result = await this.speak(text);

    this.config = originalConfig;
    return result;
  }

  /**
   * Queue multiple texts to speak in sequence
   */
  async speakQueue(texts: string[]): Promise<TTSResult[]> {
    const results: TTSResult[] = [];

    for (const text of texts) {
      const result = await this.speak(text);
      results.push(result);

      // Stop if interrupted
      if (result.interrupted) {
        break;
      }
    }

    return results;
  }
}

/**
 * Create a MacOSTTSEngine instance
 */
export function createMacOSTTSEngine(
  config: Partial<TTSConfig> = {}
): MacOSTTSEngine {
  const fullConfig: TTSConfig = {
    voice: config.voice || "Samantha",
    rate: config.rate || 200,
    provider: "macos",
    volume: config.volume || 1.0,
  };

  return new MacOSTTSEngine(fullConfig);
}

// Export singleton instance
export const macOSTTSEngine = createMacOSTTSEngine();
