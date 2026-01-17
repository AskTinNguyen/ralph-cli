/**
 * TTS Provider Registry
 *
 * Central registry of all TTS providers with their capabilities,
 * availability checking, and API key detection.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  TTSProviderType,
  TTSProviderCapabilities,
  TTSProviderStatus,
  Platform,
} from "./types.js";

/**
 * Piper voice directory
 */
const PIPER_VOICE_DIR = join(homedir(), ".local", "share", "piper-voices");

/**
 * Static capability definitions for all providers
 */
export const PROVIDER_CAPABILITIES: Record<TTSProviderType, TTSProviderCapabilities> = {
  piper: {
    id: "piper",
    displayName: "Piper",
    description: "High-quality local neural TTS",
    isCloud: false,
    requiresApiKey: false,
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultVoice: "alba",
    defaultRate: 200,
    supportsStreaming: false,
    quality: "local-high",
  },
  macos: {
    id: "macos",
    displayName: "macOS",
    description: "Built-in macOS text-to-speech",
    isCloud: false,
    requiresApiKey: false,
    supportedPlatforms: ["darwin"],
    defaultVoice: "Samantha",
    defaultRate: 200,
    supportsStreaming: false,
    quality: "local-high",
  },
  openai: {
    id: "openai",
    displayName: "OpenAI",
    description: "OpenAI TTS API (high quality)",
    isCloud: true,
    requiresApiKey: true,
    apiKeyEnvVar: "OPENAI_API_KEY",
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultVoice: "alloy",
    defaultRate: 200,
    supportsStreaming: true,
    quality: "cloud",
  },
  elevenlabs: {
    id: "elevenlabs",
    displayName: "ElevenLabs",
    description: "ElevenLabs TTS API (natural voices)",
    isCloud: true,
    requiresApiKey: true,
    apiKeyEnvVar: "ELEVENLABS_API_KEY",
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultVoice: "Rachel",
    defaultRate: 200,
    supportsStreaming: true,
    quality: "cloud",
  },
  system: {
    id: "system",
    displayName: "System",
    description: "Platform default TTS",
    isCloud: false,
    requiresApiKey: false,
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultVoice: "default",
    defaultRate: 200,
    supportsStreaming: false,
    quality: "local-low",
  },
  espeak: {
    id: "espeak",
    displayName: "eSpeak",
    description: "Cross-platform open source TTS",
    isCloud: false,
    requiresApiKey: false,
    supportedPlatforms: ["darwin", "linux", "win32"],
    defaultVoice: "en",
    defaultRate: 175,
    supportsStreaming: false,
    quality: "local-low",
  },
};

/**
 * Get the current platform
 */
export function getCurrentPlatform(): Platform {
  return process.platform as Platform;
}

/**
 * Check if a provider's API key is available
 */
export function hasApiKey(provider: TTSProviderType): boolean {
  const capabilities = PROVIDER_CAPABILITIES[provider];
  if (!capabilities.requiresApiKey) {
    return true;
  }
  const envVar = capabilities.apiKeyEnvVar;
  if (!envVar) {
    return true;
  }
  return !!process.env[envVar];
}

/**
 * Check if a command is available on the system
 */
async function commandExists(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const which = process.platform === "win32" ? "where" : "which";
    const child = spawn(which, [command], { stdio: ["ignore", "pipe", "pipe"] });

    child.on("exit", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));

    setTimeout(() => {
      child.kill();
      resolve(false);
    }, 3000);
  });
}

/**
 * Check if Piper voice models are installed
 */
function hasPiperVoices(): boolean {
  try {
    if (!existsSync(PIPER_VOICE_DIR)) {
      return false;
    }
    const files = readdirSync(PIPER_VOICE_DIR);
    return files.some((f) => f.endsWith(".onnx"));
  } catch {
    return false;
  }
}

/**
 * Check if a provider is available at runtime
 */
export async function checkProviderAvailability(
  provider: TTSProviderType
): Promise<TTSProviderStatus> {
  const capabilities = PROVIDER_CAPABILITIES[provider];
  const platform = getCurrentPlatform();

  // Check platform support
  if (!capabilities.supportedPlatforms.includes(platform)) {
    return {
      id: provider,
      available: false,
      reason: `Not supported on ${platform}`,
    };
  }

  // Check API key for cloud providers
  if (capabilities.requiresApiKey) {
    const keyPresent = hasApiKey(provider);
    if (!keyPresent) {
      return {
        id: provider,
        available: false,
        reason: `API key not set (${capabilities.apiKeyEnvVar})`,
        hasApiKey: false,
      };
    }
    return {
      id: provider,
      available: true,
      hasApiKey: true,
    };
  }

  // Check local provider dependencies
  switch (provider) {
    case "piper": {
      const hasPiper = await commandExists("piper");
      if (!hasPiper) {
        return {
          id: provider,
          available: false,
          reason: "Piper not installed (run: pip3 install piper-tts)",
          hasDependencies: false,
        };
      }
      const hasVoices = hasPiperVoices();
      if (!hasVoices) {
        return {
          id: provider,
          available: false,
          reason: `No voice models found in ${PIPER_VOICE_DIR}`,
          hasDependencies: false,
        };
      }
      return { id: provider, available: true, hasDependencies: true };
    }

    case "macos": {
      if (platform !== "darwin") {
        return {
          id: provider,
          available: false,
          reason: "macOS only",
        };
      }
      const hasSay = await commandExists("say");
      return {
        id: provider,
        available: hasSay,
        reason: hasSay ? undefined : "macOS 'say' command not found",
        hasDependencies: hasSay,
      };
    }

    case "espeak": {
      const hasEspeak = await commandExists("espeak-ng") || await commandExists("espeak");
      return {
        id: provider,
        available: hasEspeak,
        reason: hasEspeak ? undefined : "espeak-ng not installed",
        hasDependencies: hasEspeak,
      };
    }

    case "system": {
      // System falls back to platform default
      if (platform === "darwin") {
        const hasSay = await commandExists("say");
        return { id: provider, available: hasSay, hasDependencies: hasSay };
      }
      // On Linux/Windows, try espeak
      const hasEspeak = await commandExists("espeak-ng") || await commandExists("espeak");
      return { id: provider, available: hasEspeak, hasDependencies: hasEspeak };
    }

    default:
      return { id: provider, available: false, reason: "Unknown provider" };
  }
}

/**
 * Get all available providers (runtime check)
 */
export async function getAvailableProviders(): Promise<TTSProviderStatus[]> {
  const providers = Object.keys(PROVIDER_CAPABILITIES) as TTSProviderType[];
  const results = await Promise.all(providers.map(checkProviderAvailability));
  return results;
}

/**
 * Get capabilities for a provider
 */
export function getProviderCapabilities(
  provider: TTSProviderType
): TTSProviderCapabilities {
  return PROVIDER_CAPABILITIES[provider];
}

/**
 * Get all provider capabilities
 */
export function getAllProviderCapabilities(): TTSProviderCapabilities[] {
  return Object.values(PROVIDER_CAPABILITIES);
}

/**
 * Get the best available provider based on quality preference
 * @param preferCloud - Whether to prefer cloud providers over local ones
 */
export async function getBestAvailableProvider(
  preferCloud: boolean = false
): Promise<TTSProviderType | null> {
  const statuses = await getAvailableProviders();
  const available = statuses.filter((s) => s.available);

  if (available.length === 0) {
    return null;
  }

  // Sort by quality
  const sorted = available.sort((a, b) => {
    const capA = PROVIDER_CAPABILITIES[a.id];
    const capB = PROVIDER_CAPABILITIES[b.id];

    // If preferring cloud, cloud providers come first
    if (preferCloud) {
      if (capA.isCloud && !capB.isCloud) return -1;
      if (!capA.isCloud && capB.isCloud) return 1;
    } else {
      // Prefer local providers
      if (!capA.isCloud && capB.isCloud) return -1;
      if (capA.isCloud && !capB.isCloud) return 1;
    }

    // Then sort by quality
    const qualityOrder = { cloud: 0, "local-high": 1, "local-low": 2 };
    return qualityOrder[capA.quality] - qualityOrder[capB.quality];
  });

  return sorted[0]?.id || null;
}

/**
 * Validate a provider type string
 */
export function isValidProvider(provider: string): provider is TTSProviderType {
  return provider in PROVIDER_CAPABILITIES;
}
