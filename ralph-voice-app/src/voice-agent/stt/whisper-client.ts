/**
 * Whisper STT Client
 *
 * HTTP client for communicating with the local Whisper STT server.
 * Handles audio transcription requests and server health checks.
 */

import type {
  TranscriptionResult,
  STTServerStatus,
  VoiceAgentConfig,
} from '../types';

/**
 * Client for the Whisper Speech-to-Text server
 */
export class WhisperClient {
  private baseUrl: string;
  private language?: string;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.baseUrl = config.sttServerUrl || 'http://localhost:5001';
    this.language = config.language;
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
    try {
      // Build URL with optional language parameter
      const url = new URL(`${this.baseUrl}/transcribe`);
      const lang = options.language || this.language;
      if (lang) {
        url.searchParams.set('language', lang);
      }

      // Create form data with audio file
      const formData = new FormData();
      let arrayBuffer: ArrayBuffer;
      if (audioData instanceof Buffer) {
        // Convert Buffer to ArrayBuffer
        arrayBuffer = audioData.buffer.slice(
          audioData.byteOffset,
          audioData.byteOffset + audioData.byteLength
        ) as ArrayBuffer;
      } else {
        arrayBuffer = audioData as ArrayBuffer;
      }

      // Create a Blob from the ArrayBuffer for FormData
      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      const filename = options.filename || 'audio.wav';
      formData.append('file', blob, filename);

      const response = await fetch(url.toString(), {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string };
        return {
          success: false,
          text: '',
          error: errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        };
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
        return {
          success: false,
          text: '',
          error: data.error || 'Transcription failed',
        };
      }

      return {
        success: true,
        text: data.text || '',
        language: data.language,
        duration_ms: data.duration_ms,
        segments: data.segments,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        text: '',
        error: `Transcription request failed: ${errorMessage}`,
      };
    }
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
    try {
      const url = new URL(`${this.baseUrl}/transcribe`);
      if (this.language) {
        url.searchParams.set('language', this.language);
      }

      let arrayBuffer: ArrayBuffer;
      if (audioData instanceof Buffer) {
        arrayBuffer = audioData.buffer.slice(
          audioData.byteOffset,
          audioData.byteOffset + audioData.byteLength
        ) as ArrayBuffer;
      } else {
        arrayBuffer = audioData as ArrayBuffer;
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': contentType,
        },
        body: arrayBuffer,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as { error?: string };
        return {
          success: false,
          text: '',
          error: errorData.error || `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      const data = await response.json() as {
        success?: boolean;
        text?: string;
        language?: string;
        duration_ms?: number;
        segments?: Array<{ start: number; end: number; text: string }>;
        error?: string;
      };

      return {
        success: data.success ?? false,
        text: data.text || '',
        language: data.language,
        duration_ms: data.duration_ms,
        segments: data.segments,
        error: data.error,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        success: false,
        text: '',
        error: `Transcription request failed: ${errorMessage}`,
      };
    }
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
