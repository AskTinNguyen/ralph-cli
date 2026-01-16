/**
 * TTS Engine Interface
 *
 * Abstract interface for text-to-speech engines.
 * Implementations can use Piper, macOS `say`, espeak, or cloud providers.
 */

/**
 * TTS provider types
 */
export type TTSProvider = "piper" | "macos" | "espeak" | "system";

/**
 * TTS configuration
 */
export interface TTSConfig {
  /** Voice name (e.g., "alba", "jenny", "Samantha") */
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
 * Uses Piper with Alba (Scottish) voice for natural-sounding speech
 */
export const DEFAULT_TTS_CONFIG: TTSConfig = {
  voice: "alba",
  rate: 200,
  provider: "piper",
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
   * Speak text (blocking - waits for completion)
   */
  speak(text: string): Promise<TTSResult>;

  /**
   * Stop current speech and clear queue
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

  /**
   * Enqueue text for speaking (non-blocking)
   * Adds text to queue and returns immediately.
   * Use for streaming TTS where you want continuous speech.
   */
  enqueue(text: string): void;

  /**
   * Clear pending items in the queue
   * Does not stop currently speaking item.
   */
  clearQueue(): void;

  /**
   * Get number of items waiting in queue
   */
  getQueueLength(): number;

  /**
   * Check if queue is actively processing
   */
  isProcessing(): boolean;
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
      const { PiperTTSEngine } = await import("./piper-tts.js");
      const engine = new PiperTTSEngine(fullConfig);
      // Check if Piper is available, fall back to macOS if not
      const available = await engine.checkAvailable();
      if (available.available) {
        return engine;
      }
      console.warn("Piper TTS not available, falling back to macOS:", available.error);
      const { MacOSTTSEngine } = await import("./macos-tts.js");
      return new MacOSTTSEngine({ ...fullConfig, provider: "macos", voice: "Samantha" });
    }
    case "macos": {
      const { MacOSTTSEngine } = await import("./macos-tts.js");
      return new MacOSTTSEngine(fullConfig);
    }
    case "espeak":
    case "system":
    default: {
      // Fall back to macOS on Mac, or a stub on other platforms
      const { MacOSTTSEngine } = await import("./macos-tts.js");
      return new MacOSTTSEngine(fullConfig);
    }
  }
}
