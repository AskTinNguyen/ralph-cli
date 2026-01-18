#!/usr/bin/env node
/**
 * Language detection and voice routing for Ralph CLI
 * Ported from claude-auto-speak with path adjustments
 */
import { francAll } from 'franc-min';
import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * Language code mapping from ISO 639-3 (franc) to ISO 639-1
 */
const FRANC_TO_ISO = {
  eng: 'en',  // English
  vie: 'vi',  // Vietnamese
  cmn: 'zh',  // Chinese (Mandarin)
  zho: 'zh'   // Chinese
};

/**
 * TTS engine recommendations by language
 */
export const ENGINE_BY_LANGUAGE = {
  vi: 'vieneu',  // Vietnamese should use VieNeu-TTS
  en: 'macos',   // English uses macOS/piper
  zh: 'macos'    // Chinese uses macOS/piper (or espeak-ng)
};

/**
 * Detect language from text using franc-min
 *
 * @param {string} text - Text to detect language from
 * @param {number} minLength - Minimum text length for reliable detection
 * @returns {string} ISO 639-1 language code ('en', 'vi', 'zh')
 */
export function detectLanguage(text, minLength = 20) {
  // Handle empty or very short text
  if (!text || text.trim().length < minLength) {
    return 'en'; // Default to English for short text
  }

  try {
    // Get all language predictions with confidence scores
    const predictions = francAll(text);

    if (!predictions || predictions.length === 0) {
      return 'en';
    }

    // Get top prediction
    const [topLang, topScore] = predictions[0];

    // Check if language is 'und' (undetermined)
    if (topLang === 'und') {
      return 'en';
    }

    // Note: franc returns scores where lower is better (it's a distance metric)
    // For simplicity, we'll just use the top prediction if it's in our mapping
    const isoLang = FRANC_TO_ISO[topLang];

    if (isoLang) {
      return isoLang;
    }

    // Default to English for unsupported languages
    return 'en';
  } catch (error) {
    console.error('Language detection error:', error.message);
    return 'en'; // Fallback to English on error
  }
}

/**
 * Get recommended TTS engine for a detected language
 *
 * @param {string} lang - ISO 639-1 language code
 * @param {object} config - Configuration object
 * @returns {string} Recommended TTS engine
 */
export function getEngineForLanguage(lang, config) {
  // Check if user has custom engine mapping in config
  if (config?.multilingual?.engineByLanguage?.[lang]) {
    return config.multilingual.engineByLanguage[lang];
  }

  // Use default engine mapping
  return ENGINE_BY_LANGUAGE[lang] || 'macos';
}

/**
 * Check if VieNeu-TTS is installed
 *
 * @returns {boolean}
 */
export function isVieneuInstalled() {
  const vieneuVenv = join(homedir(), '.agents', 'ralph', 'vieneu', 'venv', 'bin', 'python3');
  return existsSync(vieneuVenv);
}

/**
 * Check if a language is Vietnamese
 *
 * @param {string} lang - ISO 639-1 language code
 * @returns {boolean}
 */
export function isVietnamese(lang) {
  return lang === 'vi';
}

/**
 * Get list of supported languages
 *
 * @returns {string[]} Array of ISO 639-1 language codes
 */
export function getSupportedLanguages() {
  return Object.values(FRANC_TO_ISO).filter((v, i, a) => a.indexOf(v) === i);
}
