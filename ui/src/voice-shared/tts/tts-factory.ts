/**
 * TTS Factory
 *
 * Creates TTS engine instances with automatic fallback chain support.
 * Integrates with config manager and provider registry.
 */

import type {
  TTSProviderType,
  TTSEngine,
  TTSConfig,
  VoiceConfigSettings,
  TTSProviderStatus,
} from "./types.js";
import { DEFAULT_TTS_CONFIG } from "./types.js";
import {
  checkProviderAvailability,
  getProviderCapabilities,
  PROVIDER_CAPABILITIES,
  getAvailableProviders,
} from "./provider-registry.js";
import {
  getConfigManager,
  getVoiceForProvider,
  getEffectiveFallbackChain,
} from "./config-manager.js";

/**
 * Factory result with metadata
 */
export interface TTSFactoryResult {
  /** The created TTS engine */
  engine: TTSEngine;

  /** The actual provider used (may differ from requested due to fallback) */
  provider: TTSProviderType;

  /** Whether a fallback was used */
  usedFallback: boolean;

  /** Original requested provider (if fallback was used) */
  requestedProvider?: TTSProviderType;

  /** Error message if primary provider failed */
  fallbackReason?: string;
}

/**
 * Create a TTS engine for a specific provider
 * Does not use fallback - fails if provider unavailable
 */
async function createEngineForProvider(
  provider: TTSProviderType,
  config: TTSConfig
): Promise<TTSEngine> {
  switch (provider) {
    case "piper": {
      const { PiperTTSEngine } = await import("./piper-tts.js");
      return new PiperTTSEngine(config);
    }
    case "macos": {
      const { MacOSTTSEngine } = await import("./macos-tts.js");
      return new MacOSTTSEngine(config);
    }
    case "openai": {
      const { OpenAITTSEngine } = await import("./openai-tts.js");
      return new OpenAITTSEngine(config);
    }
    case "elevenlabs": {
      const { ElevenLabsTTSEngine } = await import("./elevenlabs-tts.js");
      return new ElevenLabsTTSEngine(config);
    }
    case "espeak":
    case "system":
    default: {
      // Fall back to macOS on Mac, or error on other platforms
      if (process.platform === "darwin") {
        const { MacOSTTSEngine } = await import("./macos-tts.js");
        return new MacOSTTSEngine({ ...config, provider: "macos" });
      }
      throw new Error(`Provider ${provider} not supported on this platform`);
    }
  }
}

/**
 * Create a TTS engine with automatic fallback
 *
 * @param requestedProvider - The preferred provider (uses config if not specified)
 * @param voice - The voice to use (uses config if not specified)
 * @returns Factory result with engine and metadata
 */
export async function createTTSEngineWithFallback(
  requestedProvider?: TTSProviderType,
  voice?: string
): Promise<TTSFactoryResult> {
  const configManager = getConfigManager();
  const config = configManager.getConfig();

  // Determine provider and voice
  const primaryProvider = requestedProvider || config.provider;
  const primaryVoice = voice || getVoiceForProvider(config, primaryProvider);

  // Build fallback chain
  const fallbackChain = requestedProvider
    ? [primaryProvider, ...config.fallbackChain.filter((p) => p !== primaryProvider)]
    : getEffectiveFallbackChain(config);

  // Try each provider in the chain
  for (let i = 0; i < fallbackChain.length; i++) {
    const provider = fallbackChain[i];
    const providerVoice = i === 0
      ? primaryVoice
      : getVoiceForProvider(config, provider);

    // Check availability
    const status = await checkProviderAvailability(provider);
    if (!status.available) {
      console.log(
        `[TTS Factory] Provider ${provider} unavailable: ${status.reason}`
      );
      continue;
    }

    // Try to create engine
    try {
      const ttsConfig: TTSConfig = {
        provider,
        voice: providerVoice,
        rate: config.rate,
        volume: config.volume,
      };

      const engine = await createEngineForProvider(provider, ttsConfig);

      // Verify engine is available
      const available = await engine.checkAvailable();
      if (!available.available) {
        console.log(
          `[TTS Factory] Engine ${provider} check failed: ${available.error}`
        );
        continue;
      }

      // Success
      const usedFallback = i > 0;
      if (usedFallback) {
        console.log(
          `[TTS Factory] Using fallback provider ${provider} (requested: ${primaryProvider})`
        );
      } else {
        console.log(`[TTS Factory] Created ${provider} engine with voice ${providerVoice}`);
      }

      return {
        engine,
        provider,
        usedFallback,
        requestedProvider: usedFallback ? primaryProvider : undefined,
        fallbackReason: usedFallback
          ? `Primary provider ${primaryProvider} unavailable`
          : undefined,
      };
    } catch (error) {
      console.warn(
        `[TTS Factory] Failed to create ${provider} engine:`,
        error instanceof Error ? error.message : error
      );
      continue;
    }
  }

  // All providers failed - throw error
  throw new Error(
    `All TTS providers failed. Tried: ${fallbackChain.join(", ")}`
  );
}

/**
 * Simple factory function - creates engine with fallback (legacy API compatibility)
 */
export async function createTTSEngine(
  config: Partial<TTSConfig> = {}
): Promise<TTSEngine> {
  const provider = config.provider || DEFAULT_TTS_CONFIG.provider;
  const voice = config.voice;

  const result = await createTTSEngineWithFallback(provider, voice);
  return result.engine;
}

/**
 * TTS Factory class
 * Provides a stateful factory with caching and management
 */
export class TTSFactory {
  private currentEngine: TTSEngine | null = null;
  private currentProvider: TTSProviderType | null = null;
  private usedFallback: boolean = false;

  /**
   * Create or get the current TTS engine
   * Creates a new engine if none exists or if provider changed
   */
  async getEngine(
    provider?: TTSProviderType,
    voice?: string
  ): Promise<TTSFactoryResult> {
    // Check if we need to create a new engine
    const configManager = getConfigManager();
    const config = configManager.getConfig();
    const requestedProvider = provider || config.provider;

    if (
      this.currentEngine &&
      this.currentProvider === requestedProvider
    ) {
      // Return cached engine
      return {
        engine: this.currentEngine,
        provider: this.currentProvider,
        usedFallback: this.usedFallback,
      };
    }

    // Create new engine
    const result = await createTTSEngineWithFallback(requestedProvider, voice);
    this.currentEngine = result.engine;
    this.currentProvider = result.provider;
    this.usedFallback = result.usedFallback;

    return result;
  }

  /**
   * Force create a new engine (discards cached engine)
   */
  async createEngine(
    provider?: TTSProviderType,
    voice?: string
  ): Promise<TTSFactoryResult> {
    // Stop current engine if speaking
    if (this.currentEngine) {
      this.currentEngine.stop();
      this.currentEngine.clearQueue();
    }

    // Create new engine
    const result = await createTTSEngineWithFallback(provider, voice);
    this.currentEngine = result.engine;
    this.currentProvider = result.provider;
    this.usedFallback = result.usedFallback;

    return result;
  }

  /**
   * Get the current engine (returns null if none created)
   */
  getCurrentEngine(): TTSEngine | null {
    return this.currentEngine;
  }

  /**
   * Get the current provider
   */
  getCurrentProvider(): TTSProviderType | null {
    return this.currentProvider;
  }

  /**
   * Check if a fallback was used for the current engine
   */
  isUsingFallback(): boolean {
    return this.usedFallback;
  }

  /**
   * Dispose of the current engine
   */
  dispose(): void {
    if (this.currentEngine) {
      this.currentEngine.stop();
      this.currentEngine.clearQueue();
    }
    this.currentEngine = null;
    this.currentProvider = null;
    this.usedFallback = false;
  }

  /**
   * Get all available providers with status
   */
  async getAvailableProviders(): Promise<TTSProviderStatus[]> {
    return getAvailableProviders();
  }

  /**
   * Get provider capabilities
   */
  getProviderCapabilities(provider: TTSProviderType) {
    return getProviderCapabilities(provider);
  }
}

/**
 * Singleton factory instance
 */
let factoryInstance: TTSFactory | null = null;

/**
 * Get the singleton TTS factory
 */
export function getTTSFactory(): TTSFactory {
  if (!factoryInstance) {
    factoryInstance = new TTSFactory();
  }
  return factoryInstance;
}

/**
 * Create a new TTS factory instance
 */
export function createTTSFactory(): TTSFactory {
  return new TTSFactory();
}
