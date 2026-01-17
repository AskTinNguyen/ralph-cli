/**
 * TTS Config Manager
 *
 * Manages persistent voice configuration settings.
 * Saves/loads from .ralph/voice-config.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TTSProviderType, VoiceConfigSettings } from "./types.js";
import { DEFAULT_VOICE_CONFIG } from "./types.js";
import { isValidProvider, PROVIDER_CAPABILITIES } from "./provider-registry.js";

/**
 * Get the config file path
 * Uses RALPH_ROOT env var if set, otherwise looks for .ralph directory
 */
function getConfigPath(): string {
  const ralphRoot = process.env.RALPH_ROOT || join(process.cwd(), ".ralph");
  return join(ralphRoot, "voice-config.json");
}

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(configPath: string): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Load voice configuration from disk
 * Returns default config if file doesn't exist or is invalid
 */
export function loadVoiceConfig(): VoiceConfigSettings {
  const configPath = getConfigPath();

  try {
    if (!existsSync(configPath)) {
      return { ...DEFAULT_VOICE_CONFIG };
    }

    const content = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(content) as Partial<VoiceConfigSettings>;

    // Validate and merge with defaults
    return validateAndMergeConfig(parsed);
  } catch (error) {
    console.warn(
      `[TTS ConfigManager] Failed to load config from ${configPath}:`,
      error instanceof Error ? error.message : error
    );
    return { ...DEFAULT_VOICE_CONFIG };
  }
}

/**
 * Save voice configuration to disk
 */
export function saveVoiceConfig(config: VoiceConfigSettings): boolean {
  const configPath = getConfigPath();

  try {
    ensureConfigDir(configPath);

    const content = JSON.stringify(config, null, 2);
    writeFileSync(configPath, content, "utf-8");

    console.log(`[TTS ConfigManager] Config saved to ${configPath}`);
    return true;
  } catch (error) {
    console.error(
      `[TTS ConfigManager] Failed to save config to ${configPath}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/**
 * Update specific fields in the voice configuration
 * Merges with existing config and saves
 */
export function updateVoiceConfig(
  updates: Partial<VoiceConfigSettings>
): VoiceConfigSettings {
  const current = loadVoiceConfig();
  const updated = validateAndMergeConfig({ ...current, ...updates });
  saveVoiceConfig(updated);
  return updated;
}

/**
 * Validate and merge config with defaults
 */
function validateAndMergeConfig(
  input: Partial<VoiceConfigSettings>
): VoiceConfigSettings {
  const config: VoiceConfigSettings = { ...DEFAULT_VOICE_CONFIG };

  // Validate provider
  if (input.provider && isValidProvider(input.provider)) {
    config.provider = input.provider;
  }

  // Validate voice (non-empty string)
  if (input.voice && typeof input.voice === "string" && input.voice.trim()) {
    config.voice = input.voice.trim();
  }

  // Validate rate (50-400 WPM)
  if (typeof input.rate === "number" && input.rate >= 50 && input.rate <= 400) {
    config.rate = input.rate;
  }

  // Validate volume (0.0-1.0)
  if (
    typeof input.volume === "number" &&
    input.volume >= 0 &&
    input.volume <= 1
  ) {
    config.volume = input.volume;
  }

  // Validate enabled (boolean)
  if (typeof input.enabled === "boolean") {
    config.enabled = input.enabled;
  }

  // Validate fallback chain (array of valid providers)
  if (Array.isArray(input.fallbackChain)) {
    const validChain = input.fallbackChain.filter(isValidProvider);
    if (validChain.length > 0) {
      config.fallbackChain = validChain;
    }
  }

  // Validate provider voices (object with valid providers)
  if (input.providerVoices && typeof input.providerVoices === "object") {
    config.providerVoices = { ...DEFAULT_VOICE_CONFIG.providerVoices };
    for (const [provider, voice] of Object.entries(input.providerVoices)) {
      if (isValidProvider(provider) && typeof voice === "string" && voice.trim()) {
        config.providerVoices[provider as TTSProviderType] = voice.trim();
      }
    }
  }

  return config;
}

/**
 * Reset configuration to defaults
 */
export function resetVoiceConfig(): VoiceConfigSettings {
  const config = { ...DEFAULT_VOICE_CONFIG };
  saveVoiceConfig(config);
  return config;
}

/**
 * Get the voice for a specific provider
 * Uses provider-specific setting if available, otherwise provider default
 */
export function getVoiceForProvider(
  config: VoiceConfigSettings,
  provider: TTSProviderType
): string {
  // Check provider-specific voice first
  if (config.providerVoices?.[provider]) {
    return config.providerVoices[provider]!;
  }

  // Fall back to provider default
  return PROVIDER_CAPABILITIES[provider].defaultVoice;
}

/**
 * Set the voice for a specific provider
 */
export function setVoiceForProvider(
  provider: TTSProviderType,
  voice: string
): VoiceConfigSettings {
  const config = loadVoiceConfig();
  if (!config.providerVoices) {
    config.providerVoices = {};
  }
  config.providerVoices[provider] = voice;
  saveVoiceConfig(config);
  return config;
}

/**
 * Get the effective fallback chain
 * Ensures the primary provider is first in the chain
 */
export function getEffectiveFallbackChain(
  config: VoiceConfigSettings
): TTSProviderType[] {
  const chain = [...config.fallbackChain];

  // Ensure primary provider is first
  if (chain[0] !== config.provider) {
    // Remove provider if it's elsewhere in the chain
    const index = chain.indexOf(config.provider);
    if (index > 0) {
      chain.splice(index, 1);
    }
    // Add to front
    chain.unshift(config.provider);
  }

  return chain;
}

/**
 * TTS Config Manager class
 * Provides an OOP interface for config management
 */
export class TTSConfigManager {
  private config: VoiceConfigSettings;
  private autoSave: boolean;

  constructor(autoSave: boolean = true) {
    this.config = loadVoiceConfig();
    this.autoSave = autoSave;
  }

  /**
   * Get current configuration
   */
  getConfig(): VoiceConfigSettings {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  update(updates: Partial<VoiceConfigSettings>): VoiceConfigSettings {
    this.config = validateAndMergeConfig({ ...this.config, ...updates });
    if (this.autoSave) {
      saveVoiceConfig(this.config);
    }
    return { ...this.config };
  }

  /**
   * Set the primary provider
   */
  setProvider(provider: TTSProviderType): void {
    this.update({ provider });
  }

  /**
   * Set the voice for the current provider
   */
  setVoice(voice: string): void {
    this.update({ voice });
  }

  /**
   * Set enabled state
   */
  setEnabled(enabled: boolean): void {
    this.update({ enabled });
  }

  /**
   * Save configuration to disk
   */
  save(): boolean {
    return saveVoiceConfig(this.config);
  }

  /**
   * Reload configuration from disk
   */
  reload(): VoiceConfigSettings {
    this.config = loadVoiceConfig();
    return { ...this.config };
  }

  /**
   * Reset to defaults
   */
  reset(): VoiceConfigSettings {
    this.config = resetVoiceConfig();
    return { ...this.config };
  }

  /**
   * Get the voice for a specific provider
   */
  getVoiceForProvider(provider: TTSProviderType): string {
    return getVoiceForProvider(this.config, provider);
  }

  /**
   * Set the voice for a specific provider
   */
  setVoiceForProvider(provider: TTSProviderType, voice: string): void {
    if (!this.config.providerVoices) {
      this.config.providerVoices = {};
    }
    this.config.providerVoices[provider] = voice;
    if (this.autoSave) {
      saveVoiceConfig(this.config);
    }
  }

  /**
   * Get effective fallback chain
   */
  getFallbackChain(): TTSProviderType[] {
    return getEffectiveFallbackChain(this.config);
  }
}

/**
 * Create a config manager instance
 */
export function createConfigManager(autoSave: boolean = true): TTSConfigManager {
  return new TTSConfigManager(autoSave);
}

/**
 * Singleton config manager instance
 */
let configManagerInstance: TTSConfigManager | null = null;

/**
 * Get the singleton config manager
 */
export function getConfigManager(): TTSConfigManager {
  if (!configManagerInstance) {
    configManagerInstance = new TTSConfigManager(true);
  }
  return configManagerInstance;
}
