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

/** Default fallback voices (used if no models installed) */
const DEFAULT_PIPER_VOICES: Record<string, string> = {
  // American voices
  lessac: "en_US-lessac-medium.onnx",
  ryan: "en_US-ryan-medium.onnx",
  libritts: "en_US-libritts_r-medium.onnx",
  hfc_female: "en_US-hfc_female-medium.onnx",
  // British voices
  alba: "en_GB-alba-medium.onnx",
  jenny: "en_GB-jenny_dioco-medium.onnx",
};

/** Cache for discovered voices */
let discoveredVoicesCache: Record<string, string> | null = null;
let lastDiscoveryTime = 0;
const CACHE_TTL_MS = 30000; // 30 seconds

/**
 * Voice info structure for detailed voice listing
 */
export interface PiperVoiceInfo {
  id: string;           // Short name (e.g., "alba")
  filename: string;     // Full filename (e.g., "en_GB-alba-medium.onnx")
  language: string;     // Language code (e.g., "en_GB")
  name: string;         // Display name (e.g., "Alba")
  quality: string;      // Quality level (e.g., "medium", "high")
  installed: boolean;   // Whether the model file exists
}

/**
 * Discover all installed Piper voice models dynamically
 * Returns a map of voice name -> model filename
 */
function discoverInstalledVoices(): Record<string, string> {
  const now = Date.now();

  // Return cached result if still valid
  if (discoveredVoicesCache && (now - lastDiscoveryTime) < CACHE_TTL_MS) {
    return discoveredVoicesCache;
  }

  const voices: Record<string, string> = {};

  try {
    if (!existsSync(PIPER_VOICE_DIR)) {
      discoveredVoicesCache = DEFAULT_PIPER_VOICES;
      lastDiscoveryTime = now;
      return DEFAULT_PIPER_VOICES;
    }

    const files = readdirSync(PIPER_VOICE_DIR);

    for (const file of files) {
      if (!file.endsWith(".onnx")) continue;

      // Parse voice name from filename patterns:
      // - en_US-lessac-medium.onnx -> lessac
      // - en_GB-alba-medium.onnx -> alba
      // - en_US-ljspeech-high.onnx -> ljspeech
      // - de_DE-thorsten-medium.onnx -> thorsten
      const match = file.match(/^([a-z]{2}_[A-Z]{2})-([^-]+)-([^.]+)\.onnx$/);

      if (match) {
        const [, , voiceName] = match;
        const key = voiceName.toLowerCase();

        // Use simple voice name as key
        if (!voices[key]) {
          voices[key] = file;
        }
      } else {
        // Fallback for non-standard naming - use filename without extension
        const key = file.replace(".onnx", "").toLowerCase().replace(/[^a-z0-9_]/g, "_");
        if (!voices[key]) {
          voices[key] = file;
        }
      }
    }

    // If no voices found, use defaults
    if (Object.keys(voices).length === 0) {
      discoveredVoicesCache = DEFAULT_PIPER_VOICES;
      lastDiscoveryTime = now;
      return DEFAULT_PIPER_VOICES;
    }

    discoveredVoicesCache = voices;
    lastDiscoveryTime = now;
    return voices;
  } catch {
    discoveredVoicesCache = DEFAULT_PIPER_VOICES;
    lastDiscoveryTime = now;
    return DEFAULT_PIPER_VOICES;
  }
}

/**
 * Get detailed info for all discovered voices
 */
export function getVoiceDetails(): PiperVoiceInfo[] {
  const voices = discoverInstalledVoices();
  const voiceInfos: PiperVoiceInfo[] = [];

  for (const [id, filename] of Object.entries(voices)) {
    const match = filename.match(/^([a-z]{2}_[A-Z]{2})-([^-]+)-([^.]+)\.onnx$/);
    const installed = existsSync(join(PIPER_VOICE_DIR, filename));

    voiceInfos.push({
      id,
      filename,
      language: match ? match[1] : "unknown",
      name: id.charAt(0).toUpperCase() + id.slice(1),
      quality: match ? match[3] : "medium",
      installed,
    });
  }

  // Sort by installed status (installed first), then by name
  return voiceInfos.sort((a, b) => {
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Clear the voice discovery cache to force re-scan
 */
export function clearVoiceCache(): void {
  discoveredVoicesCache = null;
  lastDiscoveryTime = 0;
}

/**
 * Get the current Piper voices map (uses dynamic discovery)
 */
function getPiperVoices(): Record<string, string> {
  return discoverInstalledVoices();
}

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
    const voices = getPiperVoices();

    // Direct match
    if (voices[lower]) {
      return lower;
    }

    // Check for partial match (e.g., "alba" might be stored as "alba" or similar)
    for (const key of Object.keys(voices)) {
      if (key.includes(lower) || lower.includes(key)) {
        return key;
      }
    }

    // Default mappings for common macOS voice names
    if (lower.includes("female") || lower === "samantha" || lower === "karen") {
      return voices["lessac"] ? "lessac" : Object.keys(voices)[0];
    }
    if (lower.includes("male") || lower === "alex" || lower === "daniel") {
      return voices["ryan"] ? "ryan" : Object.keys(voices)[0];
    }
    if (lower.includes("british") || lower === "moira") {
      return voices["jenny"] ? "jenny" : Object.keys(voices)[0];
    }
    if (lower.includes("scottish")) {
      return voices["alba"] ? "alba" : Object.keys(voices)[0];
    }

    // Default to alba, or first available voice
    return voices["alba"] ? "alba" : Object.keys(voices)[0] || "lessac";
  }

  /**
   * Get the model path for a Piper voice
   */
  private getModelPath(voice: string): string {
    const voices = getPiperVoices();
    const modelFile = voices[voice] || voices["lessac"] || voices[Object.keys(voices)[0]] || DEFAULT_PIPER_VOICES["lessac"];
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
   * Get installed Piper voices (uses dynamic discovery)
   */
  private getInstalledVoices(): string[] {
    const voices = getPiperVoices();
    return Object.keys(voices);
  }

  /**
   * Get available voices (dynamically discovered)
   */
  async getVoices(): Promise<string[]> {
    return Object.keys(getPiperVoices());
  }

  /**
   * Get detailed voice information for UI
   */
  getVoiceDetails(): PiperVoiceInfo[] {
    return getVoiceDetails();
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
