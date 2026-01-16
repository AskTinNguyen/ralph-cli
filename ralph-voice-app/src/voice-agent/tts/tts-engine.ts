/**
 * TTS Engine Interface
 *
 * Abstract interface for text-to-speech engines.
 * Implementations can use macOS `say`, espeak, or cloud providers.
 */

/**
 * TTS provider types
 */
export type TTSProvider = "macos" | "piper" | "espeak" | "system";

/**
 * TTS configuration
 */
export interface TTSConfig {
  /** Voice name (e.g., "Samantha", "Daniel") */
  voice: string;

  /** Speech rate (words per minute, typically 150-250) */
  rate: number;

  /** Provider to use */
  provider: TTSProvider;

  /** Volume (0.0 to 1.0) */
  volume: number;
}

/**
 * Default TTS configuration
 */
export const DEFAULT_TTS_CONFIG: TTSConfig = {
  voice: "Samantha",
  rate: 200,
  provider: "macos",
  volume: 1.0,
};

/**
 * TTS result
 */
export interface TTSResult {
  /** Whether speech was successful */
  success: boolean;

  /** Error message if failed */
  error?: string;

  /** Duration of speech in milliseconds */
  duration_ms?: number;

  /** Whether speech was interrupted */
  interrupted?: boolean;
}

/**
 * TTS Engine interface
 */
export interface TTSEngine {
  /**
   * Speak text
   */
  speak(text: string): Promise<TTSResult>;

  /**
   * Stop current speech
   */
  stop(): void;

  /**
   * Check if currently speaking
   */
  isSpeaking(): boolean;

  /**
   * Check if engine is available
   */
  checkAvailable(): Promise<{ available: boolean; error?: string }>;

  /**
   * Get available voices
   */
  getVoices(): Promise<string[]>;

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSConfig>): void;

  /**
   * Get current configuration
   */
  getConfig(): TTSConfig;
}

/**
 * TTS Engine factory
 */
export async function createTTSEngine(
  config: Partial<TTSConfig> = {}
): Promise<TTSEngine> {
  const fullConfig = { ...DEFAULT_TTS_CONFIG, ...config };

  // Import the appropriate engine based on provider
  switch (fullConfig.provider) {
    case "piper": {
      const { PiperTTSEngine } = await import("./piper-tts");
      return new PiperTTSEngine(fullConfig);
    }
    case "macos": {
      const { MacOSTTSEngine } = await import("./macos-tts");
      return new MacOSTTSEngine(fullConfig);
    }
    case "espeak":
    case "system":
    default: {
      // Fall back to macOS on Mac, or a stub on other platforms
      const { MacOSTTSEngine } = await import("./macos-tts");
      return new MacOSTTSEngine(fullConfig);
    }
  }
}
