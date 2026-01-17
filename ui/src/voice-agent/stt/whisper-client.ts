/**
 * Whisper STT Client
 *
 * HTTP client for communicating with the local Whisper STT server.
 * Handles audio transcription requests and server health checks.
 * Includes retry logic with exponential backoff for network resilience.
 */

import type {
  TranscriptionResult,
  STTServerStatus,
  VoiceAgentConfig,
  DEFAULT_VOICE_CONFIG,
} from '../types.js';
import {
  withRetry,
  formatRetryMessage,
  type RetryConfig,
} from '../utils/retry.js';

/**
 * Default retry configuration for STT calls
 */
const DEFAULT_STT_RETRY_CONFIG: Partial<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 1000, // 1s, 2s, 4s
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

/**
 * Callback type for retry events
 */
export type STTRetryCallback = (
  attempt: number,
  maxAttempts: number,
  message: string
) => void;

/**
 * Client for the Whisper Speech-to-Text server
 */
export class WhisperClient {
  private baseUrl: string;
  private language?: string;
  private retryConfig: Partial<RetryConfig>;
  private onRetryCallback?: STTRetryCallback;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.baseUrl = config.sttServerUrl || 'http://localhost:5001';
    this.language = config.language;
    this.retryConfig = { ...DEFAULT_STT_RETRY_CONFIG };
  }

  /**
   * Set callback for retry events (for UI updates)
   */
  setRetryCallback(callback: STTRetryCallback): void {
    this.onRetryCallback = callback;
  }

  /**
   * Update retry configuration
   */
  setRetryConfig(config: Partial<RetryConfig>): void {
    this.retryConfig = { ...this.retryConfig, ...config };
  }

  /**
   * Check if the Whisper server is healthy and ready
   */
  async checkHealth(): Promise<STTServerStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        return {
          healthy: false,
          model: 'unknown',
          modelLoaded: false,
          url: this.baseUrl,
        };
      }

      const data = await response.json() as {
        status?: string;
        model?: string;
        model_loaded?: boolean;
      };

      return {
        healthy: data.status === 'healthy',
        model: data.model || 'unknown',
        modelLoaded: data.model_loaded || false,
        url: this.baseUrl,
      };
    } catch (error) {
      return {
        healthy: false,
        model: 'unknown',
        modelLoaded: false,
        url: this.baseUrl,
      };
    }
  }

  /**
   * Transcribe audio data to text
   *
   * @param audioData - Audio data as Buffer or ArrayBuffer
   * @param options - Optional transcription options
   * @returns Transcription result
   */
  async transcribe(
    audioData: Buffer | ArrayBuffer,
    options: {
      language?: string;
      filename?: string;
    } = {}
  ): Promise<TranscriptionResult> {
    // Build URL with optional language parameter
    const url = new URL(`${this.baseUrl}/transcribe`);
    const lang = options.language || this.language;
    if (lang) {
      url.searchParams.set('language', lang);
    }

    // Create form data with audio file
    const formData = new FormData();
    const audioBuffer = audioData instanceof Buffer
      ? audioData
      : Buffer.from(new Uint8Array(audioData));

    // Create a Blob from the buffer for FormData
    const blob = new Blob([audioBuffer], { type: 'audio/wav' });
    const filename = options.filename || 'audio.wav';
    formData.append('file', blob, filename);

    const maxAttempts = this.retryConfig.maxAttempts || 3;

    // Use retry wrapper for network resilience
    const result = await withRetry(
      async () => {
        const response = await fetch(url.toString(), {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as {
          success?: boolean;
          text?: string;
          language?: string;
          duration_ms?: number;
          segments?: Array<{ start: number; end: number; text: string }>;
          error?: string;
        };

        if (!data.success) {
          throw new Error(data.error || 'Transcription failed');
        }

        return data;
      },
      {
        ...this.retryConfig,
        onRetry: (attempt, error, delayMs) => {
          const message = formatRetryMessage(attempt, maxAttempts, 'STT server');
          console.warn(`[WhisperClient] ${message}. Waiting ${delayMs}ms...`);
          if (this.onRetryCallback) {
            this.onRetryCallback(attempt, maxAttempts, message);
          }
        },
      }
    );

    if (!result.success) {
      const errorMessage = result.error?.message || 'Unknown error';
      return {
        success: false,
        text: '',
        error: `Transcription request failed: ${errorMessage}`,
      };
    }

    const data = result.result!;
    return {
      success: true,
      text: data.text || '',
      language: data.language,
      duration_ms: data.duration_ms,
      segments: data.segments,
    };
  }

  /**
   * Transcribe audio from raw binary data (non-FormData)
   *
   * @param audioData - Raw audio bytes
   * @param contentType - MIME type of the audio
   * @returns Transcription result
   */
  async transcribeRaw(
    audioData: Buffer | ArrayBuffer,
    contentType: string = 'audio/wav'
  ): Promise<TranscriptionResult> {
    const url = new URL(`${this.baseUrl}/transcribe`);
    if (this.language) {
      url.searchParams.set('language', this.language);
    }

    const audioBuffer = audioData instanceof Buffer
      ? audioData
      : Buffer.from(new Uint8Array(audioData));

    const maxAttempts = this.retryConfig.maxAttempts || 3;

    // Use retry wrapper for network resilience
    const result = await withRetry(
      async () => {
        const response = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Content-Type': contentType,
          },
          body: audioBuffer,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({})) as { error?: string };
          throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as {
          success?: boolean;
          text?: string;
          language?: string;
          duration_ms?: number;
          segments?: Array<{ start: number; end: number; text: string }>;
          error?: string;
        };

        if (!data.success) {
          throw new Error(data.error || 'Transcription failed');
        }

        return data;
      },
      {
        ...this.retryConfig,
        onRetry: (attempt, error, delayMs) => {
          const message = formatRetryMessage(attempt, maxAttempts, 'STT server');
          console.warn(`[WhisperClient] ${message}. Waiting ${delayMs}ms...`);
          if (this.onRetryCallback) {
            this.onRetryCallback(attempt, maxAttempts, message);
          }
        },
      }
    );

    if (!result.success) {
      const errorMessage = result.error?.message || 'Unknown error';
      return {
        success: false,
        text: '',
        error: `Transcription request failed: ${errorMessage}`,
      };
    }

    const data = result.result!;
    return {
      success: true,
      text: data.text || '',
      language: data.language,
      duration_ms: data.duration_ms,
      segments: data.segments,
    };
  }

  /**
   * Get list of available Whisper models
   */
  async getModels(): Promise<{
    available: string[];
    current: string;
    recommendations: Record<string, string>;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.json() as {
        available: string[];
        current: string;
        recommendations: Record<string, string>;
      };
    } catch (error) {
      return {
        available: ['tiny', 'base', 'small', 'medium', 'large'],
        current: 'unknown',
        recommendations: {},
      };
    }
  }

  /**
   * Update the server URL
   */
  setServerUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Update the default language
   */
  setLanguage(language: string | undefined): void {
    this.language = language;
  }
}

/**
 * Create a WhisperClient instance with default configuration
 */
export function createWhisperClient(
  config: Partial<VoiceAgentConfig> = {}
): WhisperClient {
  return new WhisperClient(config);
}

// Export singleton instance for convenience
export const whisperClient = new WhisperClient();
