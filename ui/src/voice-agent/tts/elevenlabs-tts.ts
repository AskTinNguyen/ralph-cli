/**
 * ElevenLabs TTS Engine
 *
 * Text-to-speech implementation using ElevenLabs API.
 * High-quality, natural-sounding voice synthesis.
 * Includes retry logic with exponential backoff for network resilience.
 */

import type { TTSConfig, TTSEngine, TTSResult } from "./tts-engine.js";
import {
  withRetry,
  formatRetryMessage,
  type RetryConfig,
} from "../utils/retry.js";

/**
 * ElevenLabs API voice model
 */
interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category?: string;
  labels?: Record<string, string>;
}

/**
 * ElevenLabs API response for voices
 */
interface ElevenLabsVoicesResponse {
  voices: ElevenLabsVoice[];
}

/**
 * Extended TTS config for ElevenLabs
 */
export interface ElevenLabsTTSConfig extends TTSConfig {
  /** ElevenLabs voice ID (use getVoices() to get available IDs) */
  voiceId?: string;
  /** Model ID (default: eleven_turbo_v2 for low latency) */
  modelId?: string;
  /** Stability (0.0 to 1.0, default 0.5) */
  stability?: number;
  /** Similarity boost (0.0 to 1.0, default 0.75) */
  similarityBoost?: number;
}

/**
 * Default ElevenLabs voice ID (Rachel - a clear, professional voice)
 */
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

/**
 * Default ElevenLabs model (turbo for lower latency)
 */
const DEFAULT_MODEL_ID = "eleven_turbo_v2";

/**
 * ElevenLabs API base URL
 */
const API_BASE_URL = "https://api.elevenlabs.io/v1";

/**
 * Default retry configuration for TTS calls
 */
const DEFAULT_TTS_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000, // 1s, 2s, 4s
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

/**
 * Callback type for retry events
 */
export type TTSRetryCallback = (
  attempt: number,
  maxAttempts: number,
  message: string
) => void;

/**
 * ElevenLabs TTS Engine class
 */
export class ElevenLabsTTSEngine implements TTSEngine {
  private config: TTSConfig;
  private elevenLabsConfig: ElevenLabsTTSConfig;
  private apiKey: string | undefined;
  private speaking: boolean = false;
  private currentAudio: { abort?: () => void } | null = null;
  private voiceCache: Map<string, string> = new Map(); // name -> voice_id mapping
  private queue: string[] = [];
  private processing: boolean = false;
  private retryConfig: Partial<RetryConfig>;
  private onRetryCallback?: TTSRetryCallback;

  constructor(config: TTSConfig, elevenLabsConfig?: Partial<ElevenLabsTTSConfig>) {
    this.config = config;
    this.elevenLabsConfig = {
      ...config,
      voiceId: elevenLabsConfig?.voiceId || DEFAULT_VOICE_ID,
      modelId: elevenLabsConfig?.modelId || DEFAULT_MODEL_ID,
      stability: elevenLabsConfig?.stability ?? 0.5,
      similarityBoost: elevenLabsConfig?.similarityBoost ?? 0.75,
    };
    this.apiKey = process.env.ELEVENLABS_API_KEY;
    this.retryConfig = { ...DEFAULT_TTS_RETRY_CONFIG };
  }

  /**
   * Set callback for retry events (for UI updates)
   */
  setRetryCallback(callback: TTSRetryCallback): void {
    this.onRetryCallback = callback;
  }

  /**
   * Update retry configuration
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * Speak text using ElevenLabs API
   */
  async speak(text: string): Promise<TTSResult> {
    if (!text || text.trim().length === 0) {
      return { success: true, duration_ms: 0 };
    }

    // Check for API key
    if (!this.apiKey) {
      console.warn("[ElevenLabs TTS] No API key found, falling back to macOS TTS");
      return this.fallbackToMacOS(text);
    }

    // Stop any current speech
    this.stop();

    const startTime = Date.now();
    this.speaking = true;

    // Get voice ID from cache or use configured voiceId
    let voiceId = this.elevenLabsConfig.voiceId || DEFAULT_VOICE_ID;

    // If voice name is provided instead of ID, try to look it up
    if (this.config.voice && this.voiceCache.has(this.config.voice)) {
      voiceId = this.voiceCache.get(this.config.voice)!;
    }

    const url = `${API_BASE_URL}/text-to-speech/${voiceId}`;
    const maxAttempts = this.retryConfig.maxAttempts || 3;

    const controller = new AbortController();
    this.currentAudio = { abort: () => controller.abort() };

    // Use retry wrapper for network resilience
    const result = await withRetry(
      async () => {
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Accept": "audio/mpeg",
            "Content-Type": "application/json",
            "xi-api-key": this.apiKey!,
          },
          body: JSON.stringify({
            text: text,
            model_id: this.elevenLabsConfig.modelId,
            voice_settings: {
              stability: this.elevenLabsConfig.stability,
              similarity_boost: this.elevenLabsConfig.similarityBoost,
            },
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        // Get audio buffer
        return await response.arrayBuffer();
      },
      {
        ...this.retryConfig,
        onRetry: (attempt, error, delayMs) => {
          const message = formatRetryMessage(attempt, maxAttempts, 'ElevenLabs TTS');
          console.warn(`[ElevenLabs TTS] ${message}. Waiting ${delayMs}ms...`);
          if (this.onRetryCallback) {
            this.onRetryCallback(attempt, maxAttempts, message);
          }
        },
      }
    );

    this.speaking = false;
    this.currentAudio = null;

    if (!result.success) {
      const errorMessage = result.error?.message || 'Unknown error';

      // Check if it was an abort
      if (errorMessage.includes("abort")) {
        return {
          success: true,
          duration_ms: Date.now() - startTime,
          interrupted: true,
        };
      }

      console.error(`[ElevenLabs TTS] Error after ${result.attempts} attempts: ${errorMessage}`);
      return this.fallbackToMacOS(text, startTime);
    }

    const duration_ms = Date.now() - startTime;

    // Note: On server-side, we return the audio buffer info
    // The client will need to play this audio
    // For now, we return success with the synthesized audio duration estimate
    return {
      success: true,
      duration_ms,
      interrupted: false,
    };
  }

  /**
   * Fallback to macOS TTS when ElevenLabs fails
   */
  private async fallbackToMacOS(text: string, startTime?: number): Promise<TTSResult> {
    const start = startTime || Date.now();

    try {
      const { MacOSTTSEngine } = await import("./macos-tts.js");
      const macOSEngine = new MacOSTTSEngine(this.config);
      const result = await macOSEngine.speak(text);

      // Adjust duration to include any time spent trying ElevenLabs
      if (startTime) {
        result.duration_ms = (result.duration_ms || 0) + (Date.now() - startTime - (result.duration_ms || 0));
      }

      return result;
    } catch (fallbackError) {
      return {
        success: false,
        error: `ElevenLabs failed and macOS fallback failed: ${fallbackError}`,
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
   * Check if ElevenLabs API is available
   */
  async checkAvailable(): Promise<{ available: boolean; error?: string }> {
    if (!this.apiKey) {
      return {
        available: false,
        error: "ELEVENLABS_API_KEY environment variable not set",
      };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/user`, {
        headers: {
          "xi-api-key": this.apiKey,
        },
      });

      if (response.ok) {
        return { available: true };
      } else {
        return {
          available: false,
          error: `ElevenLabs API returned ${response.status}`,
        };
      }
    } catch (error) {
      return {
        available: false,
        error: `Cannot reach ElevenLabs API: ${error instanceof Error ? error.message : error}`,
      };
    }
  }

  /**
   * Get available voices from ElevenLabs
   */
  async getVoices(): Promise<string[]> {
    if (!this.apiKey) {
      console.warn("[ElevenLabs TTS] No API key, returning empty voice list");
      return [];
    }

    try {
      const response = await fetch(`${API_BASE_URL}/voices`, {
        headers: {
          "xi-api-key": this.apiKey,
        },
      });

      if (!response.ok) {
        console.error(`[ElevenLabs TTS] Failed to fetch voices: ${response.status}`);
        return [];
      }

      const data = (await response.json()) as ElevenLabsVoicesResponse;

      // Build voice cache and return names
      this.voiceCache.clear();
      const voiceNames: string[] = [];

      for (const voice of data.voices) {
        this.voiceCache.set(voice.name, voice.voice_id);
        voiceNames.push(voice.name);
      }

      return voiceNames;
    } catch (error) {
      console.error(`[ElevenLabs TTS] Error fetching voices: ${error}`);
      return [];
    }
  }

  /**
   * Get voice ID by name
   */
  getVoiceIdByName(name: string): string | undefined {
    return this.voiceCache.get(name);
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSConfig>): void {
    this.config = { ...this.config, ...config };

    // If voice name changed, try to update voice ID
    if (config.voice && this.voiceCache.has(config.voice)) {
      this.elevenLabsConfig.voiceId = this.voiceCache.get(config.voice);
    }
  }

  /**
   * Update ElevenLabs-specific configuration
   */
  updateElevenLabsConfig(config: Partial<ElevenLabsTTSConfig>): void {
    this.elevenLabsConfig = { ...this.elevenLabsConfig, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig {
    return { ...this.config };
  }

  /**
   * Get ElevenLabs-specific configuration
   */
  getElevenLabsConfig(): ElevenLabsTTSConfig {
    return { ...this.elevenLabsConfig };
  }

  /**
   * Synthesize audio and return buffer (for streaming/caching use cases)
   */
  async synthesize(text: string): Promise<{ audio: ArrayBuffer; format: string } | null> {
    if (!text || text.trim().length === 0) {
      return null;
    }

    if (!this.apiKey) {
      console.warn("[ElevenLabs TTS] No API key found for synthesis");
      return null;
    }

    try {
      let voiceId = this.elevenLabsConfig.voiceId || DEFAULT_VOICE_ID;

      if (this.config.voice && this.voiceCache.has(this.config.voice)) {
        voiceId = this.voiceCache.get(this.config.voice)!;
      }

      const url = `${API_BASE_URL}/text-to-speech/${voiceId}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "audio/mpeg",
          "Content-Type": "application/json",
          "xi-api-key": this.apiKey,
        },
        body: JSON.stringify({
          text: text,
          model_id: this.elevenLabsConfig.modelId,
          voice_settings: {
            stability: this.elevenLabsConfig.stability,
            similarity_boost: this.elevenLabsConfig.similarityBoost,
          },
        }),
      });

      if (!response.ok) {
        console.error(`[ElevenLabs TTS] Synthesis failed: ${response.status}`);
        return null;
      }

      const audio = await response.arrayBuffer();
      return { audio, format: "audio/mpeg" };
    } catch (error) {
      console.error(`[ElevenLabs TTS] Synthesis error: ${error}`);
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
 * Create an ElevenLabsTTSEngine instance
 */
export function createElevenLabsTTSEngine(
  config: Partial<TTSConfig> = {},
  elevenLabsConfig: Partial<ElevenLabsTTSConfig> = {}
): ElevenLabsTTSEngine {
  const fullConfig: TTSConfig = {
    voice: config.voice || "Rachel",
    rate: config.rate || 200,
    provider: "elevenlabs",
    volume: config.volume || 1.0,
  };

  return new ElevenLabsTTSEngine(fullConfig, elevenLabsConfig);
}
