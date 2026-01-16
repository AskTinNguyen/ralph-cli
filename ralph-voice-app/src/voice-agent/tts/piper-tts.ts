/**
 * Piper TTS Engine
 *
 * Text-to-speech implementation using Piper neural TTS.
 * High quality voices with fast local inference.
 */

import { spawn, type ChildProcess, execSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TTSConfig, TTSEngine, TTSResult } from "./tts-engine";

/** Piper voice directory */
const PIPER_VOICE_DIR = join(homedir(), ".local", "share", "piper-voices");

/** Available Piper voices (name -> model file) */
const PIPER_VOICES: Record<string, string> = {
  // American voices
  lessac: "en_US-lessac-medium.onnx",      // American female, professional
  ryan: "en_US-ryan-medium.onnx",          // American male, casual
  libritts: "en_US-libritts_r-medium.onnx", // Multi-speaker, high quality
  hfc_female: "en_US-hfc_female-medium.onnx", // American female, clear
  // British voices
  alba: "en_GB-alba-medium.onnx",          // Scottish, distinctive
  jenny: "en_GB-jenny_dioco-medium.onnx",  // British female, natural
};

/**
 * Piper TTS Engine class
 */
export class PiperTTSEngine implements TTSEngine {
  private config: TTSConfig;
  private currentProcess: ChildProcess | null = null;
  private speaking: boolean = false;
  private piperVoice: string;

  constructor(config: TTSConfig) {
    this.config = { ...config, provider: "piper" as any };
    // Map voice name to Piper voice (default to lessac)
    this.piperVoice = this.mapVoice(config.voice);
  }

  /**
   * Map config voice name to Piper voice
   */
  private mapVoice(voice: string): string {
    const lower = voice.toLowerCase();
    if (PIPER_VOICES[lower]) {
      return lower;
    }
    // Default mappings for common macOS voice names
    if (lower.includes("female") || lower === "samantha" || lower === "karen") {
      return "lessac";
    }
    if (lower.includes("male") || lower === "alex" || lower === "daniel") {
      return "ryan";
    }
    if (lower.includes("british") || lower === "moira") {
      return "jenny";
    }
    if (lower.includes("scottish")) {
      return "alba";
    }
    return "alba"; // Default to Alba (Scottish)
  }

  /**
   * Get the model path for a Piper voice
   */
  private getModelPath(voice: string): string {
    const modelFile = PIPER_VOICES[voice] || PIPER_VOICES["lessac"];
    return join(PIPER_VOICE_DIR, modelFile);
  }

  /**
   * Speak text using Piper TTS
   */
  async speak(text: string): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      return { success: true, duration_ms: 0 };
    }

    // Stop any current speech
    this.stop();

    const startTime = Date.now();
    const modelPath = this.getModelPath(this.piperVoice);

    // Check if model exists
    if (!existsSync(modelPath)) {
      return {
        success: false,
        error: `Piper voice model not found: ${modelPath}. Run: pip3 install piper-tts && download voice models.`,
        duration_ms: 0,
      };
    }

    return new Promise((resolve) => {
      this.speaking = true;

      // Create temp wav file path
      const wavFile = `/tmp/piper-tts-${Date.now()}.wav`;

      // Run piper to generate audio
      const piper = spawn("piper", ["--model", modelPath, "--output_file", wavFile], {
        stdio: ["pipe", "ignore", "pipe"],
      });

      // Send text to piper's stdin
      piper.stdin?.write(text);
      piper.stdin?.end();

      let stderr = "";
      if (piper.stderr) {
        piper.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      }

      piper.on("exit", (code) => {
        if (code !== 0) {
          this.speaking = false;
          this.currentProcess = null;
          resolve({
            success: false,
            error: stderr || `Piper exit code: ${code}`,
            duration_ms: Date.now() - startTime,
          });
          return;
        }

        // Play the generated audio
        this.currentProcess = spawn("afplay", [wavFile], {
          stdio: ["ignore", "ignore", "pipe"],
        });

        this.currentProcess.on("exit", (playCode, signal) => {
          const duration_ms = Date.now() - startTime;
          this.speaking = false;
          this.currentProcess = null;

          // Clean up temp file
          try {
            execSync(`rm -f ${wavFile}`, { stdio: "ignore" });
          } catch {}

          if (signal === "SIGTERM" || signal === "SIGKILL") {
            resolve({
              success: true,
              duration_ms,
              interrupted: true,
            });
          } else {
            resolve({
              success: playCode === 0,
              error: playCode !== 0 ? `Audio playback failed` : undefined,
              duration_ms,
              interrupted: false,
            });
          }
        });

        this.currentProcess.on("error", (error) => {
          this.speaking = false;
          this.currentProcess = null;
          resolve({
            success: false,
            error: `Audio playback error: ${error.message}`,
            duration_ms: Date.now() - startTime,
          });
        });
      });

      piper.on("error", (error) => {
        this.speaking = false;
        resolve({
          success: false,
          error: `Piper TTS error: ${error.message}. Is piper-tts installed?`,
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
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Check if Piper is available
   */
  async checkAvailable(): Promise<{ available: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("which", ["piper"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      child.on("exit", (code) => {
        if (code === 0) {
          // Also check if at least one voice model exists
          if (existsSync(PIPER_VOICE_DIR)) {
            const voices = this.getInstalledVoices();
            if (voices.length > 0) {
              resolve({ available: true });
            } else {
              resolve({
                available: false,
                error: `No Piper voice models found in ${PIPER_VOICE_DIR}`,
              });
            }
          } else {
            resolve({
              available: false,
              error: `Piper voice directory not found: ${PIPER_VOICE_DIR}`,
            });
          }
        } else {
          resolve({
            available: false,
            error: "Piper TTS not installed. Run: pip3 install piper-tts",
          });
        }
      });

      child.on("error", () => {
        resolve({
          available: false,
          error: "Could not check for Piper TTS.",
        });
      });

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
   * Get installed Piper voices
   */
  private getInstalledVoices(): string[] {
    try {
      if (!existsSync(PIPER_VOICE_DIR)) return [];
      const files = readdirSync(PIPER_VOICE_DIR);
      return files
        .filter((f) => f.endsWith(".onnx"))
        .map((f) => {
          // Extract voice name from filename like "en_US-lessac-medium.onnx"
          const match = f.match(/en_\w+-(\w+)-/);
          return match ? match[1] : f.replace(".onnx", "");
        });
    } catch {
      return [];
    }
  }

  /**
   * Get available voices
   */
  async getVoices(): Promise<string[]> {
    const installed = this.getInstalledVoices();
    if (installed.length > 0) {
      return installed;
    }
    // Return known voices even if not installed
    return Object.keys(PIPER_VOICES);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.voice) {
      this.piperVoice = this.mapVoice(config.voice);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig {
    return { ...this.config, voice: this.piperVoice };
  }

  /**
   * Speak with custom options (one-time override)
   */
  async speakWithOptions(
    text: string,
    options: { voice?: string; rate?: number }
  ): Promise<TTSResult> {
    const originalVoice = this.piperVoice;

    if (options.voice) {
      this.piperVoice = this.mapVoice(options.voice);
    }

    const result = await this.speak(text);

    this.piperVoice = originalVoice;
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

      if (result.interrupted) {
        break;
      }
    }

    return results;
  }
}

/**
 * Create a PiperTTSEngine instance
 */
export function createPiperTTSEngine(
  config: Partial<TTSConfig> = {}
): PiperTTSEngine {
  const fullConfig: TTSConfig = {
    voice: config.voice || "lessac",
    rate: config.rate || 200,
    provider: "piper" as any,
    volume: config.volume || 1.0,
  };

  return new PiperTTSEngine(fullConfig);
}

// Export singleton instance
export const piperTTSEngine = createPiperTTSEngine();
