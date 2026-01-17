/**
 * TTS Type Definitions
 *
 * Single source of truth for all TTS-related types.
 * All other files should import from this module.
 */

/**
 * TTS provider types - all supported providers
 */
export type TTSProviderType =
  | "piper"       // Local neural TTS (high quality, offline)
  | "macos"       // macOS `say` command (offline, zero latency)
  | "openai"      // OpenAI TTS API (cloud, high quality)
  | "elevenlabs"  // ElevenLabs API (cloud, natural voices)
  | "system"      // System default (alias for platform default)
  | "espeak";     // espeak-ng (cross-platform, offline)

/**
 * Platform types
 */
export type Platform = "darwin" | "linux" | "win32";

/**
 * Provider capability definition
 */
export interface TTSProviderCapabilities {
  /** Provider identifier */
  id: TTSProviderType;

  /** Human-readable name */
  displayName: string;

  /** Short description */
  description: string;

  /** Whether this provider requires internet */
  isCloud: boolean;

  /** Whether this provider requires an API key */
  requiresApiKey: boolean;

  /** Environment variable name for API key (if required) */
  apiKeyEnvVar?: string;

  /** Platforms where this provider is supported */
  supportedPlatforms: Platform[];

  /** Default voice for this provider */
  defaultVoice: string;

  /** Default speech rate (words per minute) */
  defaultRate: number;

  /** Whether this provider supports streaming */
  supportsStreaming: boolean;

  /** Quality tier: local-low, local-high, cloud */
  quality: "local-low" | "local-high" | "cloud";
}

/**
 * Provider availability status
 */
export interface TTSProviderStatus {
  /** Provider ID */
  id: TTSProviderType;

  /** Whether provider is available */
  available: boolean;

  /** Reason if not available */
  reason?: string;

  /** Whether API key is present (for cloud providers) */
  hasApiKey?: boolean;

  /** Whether runtime dependencies are installed (for local providers) */
  hasDependencies?: boolean;
}

/**
 * TTS configuration for a provider
 */
export interface TTSConfig {
  /** Voice name (provider-specific) */
  voice: string;

  /** Speech rate in words per minute (typically 150-250) */
  rate: number;

  /** Provider to use */
  provider: TTSProviderType;

  /** Volume level (0.0 to 1.0) */
  volume: number;
}

/**
 * Voice configuration settings (persisted to disk)
 */
export interface VoiceConfigSettings {
  /** Active TTS provider */
  provider: TTSProviderType;

  /** Voice name for the active provider */
  voice: string;

  /** Speech rate in words per minute */
  rate: number;

  /** Volume level (0.0 to 1.0) */
  volume: number;

  /** Whether TTS is enabled */
  enabled: boolean;

  /** Fallback chain when primary provider fails */
  fallbackChain: TTSProviderType[];

  /** Per-provider voice preferences */
  providerVoices?: Partial<Record<TTSProviderType, string>>;
}

/**
 * TTS result from speaking
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
 * All TTS engine implementations must implement this interface
 */
export interface TTSEngine {
  /** Speak text (blocking - waits for completion) */
  speak(text: string): Promise<TTSResult>;

  /** Stop current speech and clear queue */
  stop(): void;

  /** Check if currently speaking */
  isSpeaking(): boolean;

  /** Check if engine is available */
  checkAvailable(): Promise<{ available: boolean; error?: string }>;

  /** Get available voices */
  getVoices(): Promise<string[]>;

  /** Update configuration */
  updateConfig(config: Partial<TTSConfig>): void;

  /** Get current configuration */
  getConfig(): TTSConfig;

  /** Enqueue text for speaking (non-blocking) */
  enqueue(text: string): void;

  /** Clear pending items in the queue */
  clearQueue(): void;

  /** Get number of items waiting in queue */
  getQueueLength(): number;

  /** Check if queue is actively processing */
  isProcessing(): boolean;
}

/**
 * Default voice configuration
 */
export const DEFAULT_VOICE_CONFIG: VoiceConfigSettings = {
  provider: "piper",
  voice: "alba",
  rate: 200,
  volume: 1.0,
  enabled: true,
  fallbackChain: ["piper", "macos", "system"],
  providerVoices: {
    piper: "alba",
    macos: "Samantha",
    openai: "alloy",
    elevenlabs: "Rachel",
    system: "default",
    espeak: "en",
  },
};

/**
 * Default TTS configuration (for engine instances)
 */
export const DEFAULT_TTS_CONFIG: TTSConfig = {
  voice: "alba",
  rate: 200,
  provider: "piper",
  volume: 1.0,
};
