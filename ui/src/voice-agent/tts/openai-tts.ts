/**
 * OpenAI TTS Engine
 *
 * Text-to-speech implementation using OpenAI's TTS API.
 * High-quality, natural-sounding voice synthesis with multiple voice options.
 */

import type { TTSConfig, TTSEngine, TTSResult } from "./tts-engine.js";

/**
 * OpenAI TTS voice options
 * https://platform.openai.com/docs/guides/text-to-speech
 */
export type OpenAIVoice = "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer";

/**
 * OpenAI TTS models
 */
export type OpenAITTSModel = "tts-1" | "tts-1-hd";

/**
 * All available OpenAI voices
 */
export const OPENAI_VOICES: OpenAIVoice[] = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
];

/**
 * Extended TTS config for OpenAI
 */
export interface OpenAITTSConfig extends TTSConfig {
  /** OpenAI voice (alloy, echo, fable, onyx, nova, shimmer) */
  openaiVoice?: OpenAIVoice;
  /** Model (tts-1 for speed, tts-1-hd for quality) */
  openaiModel?: OpenAITTSModel;
  /** Speed (0.25 to 4.0, default 1.0) */
  speed?: number;
}

/**
 * Default OpenAI voice
 */
const DEFAULT_VOICE: OpenAIVoice = "alloy";

/**
 * Default OpenAI TTS model (tts-1 for lower latency)
 */
const DEFAULT_MODEL: OpenAITTSModel = "tts-1";

/**
 * OpenAI API base URL
 */
const API_BASE_URL = "https://api.openai.com/v1";

/**
 * OpenAI TTS Engine class
 */
export class OpenAITTSEngine implements TTSEngine {
  private config: TTSConfig;
  private openaiConfig: OpenAITTSConfig;
  private apiKey: string | undefined;
  private speaking: boolean = false;
  private currentAudio: { abort?: () => void } | null = null;
  private queue: string[] = [];
  private processing: boolean = false;

  constructor(config: TTSConfig, openaiConfig?: Partial<OpenAITTSConfig>) {
    this.config = config;
    this.openaiConfig = {
      ...config,
      openaiVoice: openaiConfig?.openaiVoice || DEFAULT_VOICE,
      openaiModel: openaiConfig?.openaiModel || DEFAULT_MODEL,
      speed: this.normalizeSpeed(openaiConfig?.speed ?? 1.0),
    };
    this.apiKey = process.env.OPENAI_API_KEY;
  }

  /**
   * Normalize speed to OpenAI's valid range (0.25 to 4.0)
   */
  private normalizeSpeed(speed: number): number {
    return Math.max(0.25, Math.min(4.0, speed));
  }

  /**
   * Map voice name to OpenAI voice
   * If the voice name matches an OpenAI voice, use it directly.
   * Otherwise, return the configured openaiVoice or default.
   */
  private getOpenAIVoice(): OpenAIVoice {
    const voiceLower = this.config.voice.toLowerCase();
    if (OPENAI_VOICES.includes(voiceLower as OpenAIVoice)) {
      return voiceLower as OpenAIVoice;
    }
    return this.openaiConfig.openaiVoice || DEFAULT_VOICE;
  }

  /**
   * Speak text using OpenAI TTS API
   */
  async speak(text: string): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      return { success: true, duration_ms: 0 };
    }

    // Check for API key
    if (!this.apiKey) {
      console.warn("[OpenAI TTS] No API key found, falling back to macOS TTS");
      return this.fallbackToMacOS(text);
    }

    // Stop any current speech
    this.stop();

    const startTime = Date.now();
    this.speaking = true;

    try {
      const voice = this.getOpenAIVoice();
      const url = `${API_BASE_URL}/audio/speech`;

      const controller = new AbortController();
      this.currentAudio = { abort: () => controller.abort() };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.openaiConfig.openaiModel || DEFAULT_MODEL,
          input: text,
          voice: voice,
          speed: this.openaiConfig.speed || 1.0,
          response_format: "mp3",
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        console.error(`[OpenAI TTS] API error: ${response.status} - ${errorText}`);
        return this.fallbackToMacOS(text, startTime);
      }

      // Get audio buffer
      const audioBuffer = await response.arrayBuffer();
      const duration_ms = Date.now() - startTime;

      this.speaking = false;
      this.currentAudio = null;

      // Note: On server-side, we return the audio buffer info
      // The client will need to play this audio
      // For now, we return success with the synthesis duration
      return {
        success: true,
        duration_ms,
        interrupted: false,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if it was an abort
      if (errorMessage.includes("abort")) {
        return {
          success: true,
          duration_ms: Date.now() - startTime,
          interrupted: true,
        };
      }

      console.error(`[OpenAI TTS] Error: ${errorMessage}`);
      return this.fallbackToMacOS(text, startTime);
    }
  }

  /**
   * Fallback to macOS TTS when OpenAI fails
   */
  private async fallbackToMacOS(text: string, startTime?: number): Promise<TTSResult> {
    const start = startTime || Date.now();

    try {
      const { MacOSTTSEngine } = await import("./macos-tts.js");
      const macOSEngine = new MacOSTTSEngine(this.config);
      const result = await macOSEngine.speak(text);

      // Adjust duration to include any time spent trying OpenAI
      if (startTime) {
        result.duration_ms = (result.duration_ms || 0) + (Date.now() - startTime - (result.duration_ms || 0));
      }

      return result;
    } catch (fallbackError) {
      return {
        success: false,
        error: `OpenAI TTS failed and macOS fallback failed: ${fallbackError}`,
        duration_ms: Date.now() - start,
      };
    }
  }

  /**
   * Stop current speech
   */
  stop(): void {
    if (this.currentAudio?.abort) {
      this.currentAudio.abort();
    }
    this.currentAudio = null;
    this.speaking = false;
  }

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean {
    return this.speaking;
  }

  /**
   * Check if OpenAI TTS API is available
   */
  async checkAvailable(): Promise<{ available: boolean; error?: string }> {
    if (!this.apiKey) {
      return {
        available: false,
        error: "OPENAI_API_KEY environment variable not set",
      };
    }

    try {
      // Use the models endpoint to verify API key is valid
      const response = await fetch(`${API_BASE_URL}/models`, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
      });

      if (response.ok) {
        return { available: true };
      } else {
        return {
          available: false,
          error: `OpenAI API returned ${response.status}`,
        };
      }
    } catch (error) {
      return {
        available: false,
        error: `Cannot reach OpenAI API: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Get available voices from OpenAI
   * OpenAI has a fixed set of voices, no API call needed
   */
  async getVoices(): Promise<string[]> {
    // OpenAI has a fixed set of voices
    return [...OPENAI_VOICES];
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };

    // Update speed if rate changes (map WPM to speed factor)
    if (config.rate !== undefined) {
      // Map rate (150-300 WPM) to speed (0.75-1.5)
      // 200 WPM is the baseline (1.0 speed)
      const speed = config.rate / 200;
      this.openaiConfig.speed = this.normalizeSpeed(speed);
    }
  }

  /**
   * Update OpenAI-specific configuration
   */
  updateOpenAIConfig(config: Partial<OpenAITTSConfig>): void {
    this.openaiConfig = { ...this.openaiConfig, ...config };
    if (config.speed !== undefined) {
      this.openaiConfig.speed = this.normalizeSpeed(config.speed);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig {
    return { ...this.config };
  }

  /**
   * Get OpenAI-specific configuration
   */
  getOpenAIConfig(): OpenAITTSConfig {
    return { ...this.openaiConfig };
  }

  /**
   * Synthesize audio and return buffer (for streaming/caching use cases)
   */
  async synthesize(text: string): Promise<{ audio: ArrayBuffer; format: string } | null> {
    if (!text || text.trim().length === 0) {
      return null;
    }

    if (!this.apiKey) {
      console.warn("[OpenAI TTS] No API key found for synthesis");
      return null;
    }

    try {
      const voice = this.getOpenAIVoice();
      const url = `${API_BASE_URL}/audio/speech`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.openaiConfig.openaiModel || DEFAULT_MODEL,
          input: text,
          voice: voice,
          speed: this.openaiConfig.speed || 1.0,
          response_format: "mp3",
        }),
      });

      if (!response.ok) {
        console.error(`[OpenAI TTS] Synthesis failed: ${response.status}`);
        return null;
      }

      const audio = await response.arrayBuffer();
      return { audio, format: "audio/mpeg" };
    } catch (error) {
      console.error(`[OpenAI TTS] Synthesis error: ${error}`);
      return null;
    }
  }

  /**
   * Enqueue text for speaking (non-blocking)
   * Adds text to queue and returns immediately.
   */
  enqueue(text: string): void {
    if (!text || text.trim().length === 0) {
      return;
    }
    this.queue.push(text);
    this.processQueue();
  }

  /**
   * Process the speech queue
   */
  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.queue.length > 0) {
      const text = this.queue.shift();
      if (text) {
        await this.speak(text);
      }
    }

    this.processing = false;
  }

  /**
   * Clear pending items in the queue
   */
  clearQueue(): void {
    this.queue = [];
  }

  /**
   * Get number of items waiting in queue
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if queue is actively processing
   */
  isProcessing(): boolean {
    return this.processing;
  }
}

/**
 * Create an OpenAITTSEngine instance
 */
export function createOpenAITTSEngine(
  config: Partial<TTSConfig> = {},
  openaiConfig: Partial<OpenAITTSConfig> = {}
): OpenAITTSEngine {
  const fullConfig: TTSConfig = {
    voice: config.voice || "alloy",
    rate: config.rate || 200,
    provider: "openai" as TTSConfig["provider"],
    volume: config.volume || 1.0,
  };

  return new OpenAITTSEngine(fullConfig, openaiConfig);
}
