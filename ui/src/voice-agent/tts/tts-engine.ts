/**
 * TTS Engine Interface
 *
 * Abstract interface for text-to-speech engines.
 * Implementations can use Piper, macOS `say`, espeak, or cloud providers.
 *
 * Note: All types are now defined in ./types.ts and re-exported here
 * for backward compatibility.
 */

// Re-export all types from the unified types module
export type {
  TTSProviderType,
  TTSConfig,
  TTSResult,
  TTSEngine,
  VoiceConfigSettings,
  TTSProviderCapabilities,
  TTSProviderStatus,
} from "./types.js";

export { DEFAULT_TTS_CONFIG, DEFAULT_VOICE_CONFIG } from "./types.js";

// Legacy type alias for backward compatibility
import type { TTSProviderType } from "./types.js";
export type TTSProvider = TTSProviderType;

// Import types needed for createTTSEngine
import type { TTSConfig, TTSEngine } from "./types.js";

/**
 * TTS Engine factory
 *
 * Creates a TTS engine with automatic fallback chain support.
 * Uses the new TTSFactory under the hood for consistent behavior.
 *
 * @deprecated Use createTTSEngineWithFallback from ./tts-factory.js for more control
 */
export async function createTTSEngine(
  config: Partial<TTSConfig> = {}
): Promise<TTSEngine> {
  // Delegate to the new factory
  const { createTTSEngine: factoryCreate } = await import("./tts-factory.js");
  return factoryCreate(config);
}

// Re-export factory functions for convenience
export {
  createTTSEngineWithFallback,
  getTTSFactory,
  createTTSFactory,
  type TTSFactoryResult,
  TTSFactory,
} from "./tts-factory.js";

// Re-export config manager functions
export {
  getConfigManager,
  loadVoiceConfig,
  saveVoiceConfig,
  updateVoiceConfig,
  TTSConfigManager,
} from "./config-manager.js";

// Re-export provider registry functions
export {
  checkProviderAvailability,
  getAvailableProviders,
  getProviderCapabilities,
  getAllProviderCapabilities,
  getBestAvailableProvider,
  isValidProvider,
  PROVIDER_CAPABILITIES,
} from "./provider-registry.js";
