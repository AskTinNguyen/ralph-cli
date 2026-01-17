/**
 * Wake Word Detector - Server-side types and utilities
 *
 * This module provides types and configuration for wake word detection.
 * The actual browser-side implementation is in voice-client.js using
 * Web Speech API for client-side detection.
 *
 * Server-side detection (via Whisper STT) is handled in the voice routes.
 */

/**
 * Wake word detection mode
 */
export type WakeWordMode = "server" | "client" | "disabled";

/**
 * Wake word detection result
 */
export interface WakeWordResult {
  /** Whether the wake word was detected */
  detected: boolean;

  /** Confidence score (0-1) if available */
  confidence?: number;

  /** The phrase that triggered detection */
  phrase?: string;

  /** Processing time in milliseconds */
  duration_ms?: number;
}

/**
 * Wake word detection configuration
 */
export interface WakeWordConfig {
  /** The wake phrase to listen for */
  wakePhrase: string;

  /** Detection mode */
  mode: WakeWordMode;

  /** Server URL for server-side detection */
  serverUrl: string;

  /** Sensitivity threshold (0-1, higher = more sensitive) */
  sensitivity: number;

  /** Audio sample rate for monitoring */
  sampleRate: number;

  /** Whether to enable continuous listening */
  continuous: boolean;
}

/**
 * Default wake word configuration
 */
export const DEFAULT_WAKE_WORD_CONFIG: WakeWordConfig = {
  wakePhrase: "hey claude",
  mode: "client",
  serverUrl: "http://localhost:5001",
  sensitivity: 0.5,
  sampleRate: 16000,
  continuous: true,
};

/**
 * Callback type for wake word detection
 */
export type WakeWordCallback = (result: WakeWordResult) => void;

/**
 * Callback type for state changes
 */
export type WakeWordStateCallback = (state: WakeWordDetectorState) => void;

/**
 * Wake word detector state
 */
export type WakeWordDetectorState =
  | "idle"
  | "starting"
  | "listening"
  | "processing"
  | "error";

/**
 * Wake phrase variants for detection
 * These account for common speech recognition misinterpretations
 */
export const WAKE_PHRASE_VARIANTS = [
  "hey claude",
  "hey cloud", // Common misrecognition
  "hey clod",
  "a claude",
  "hey claud",
  "hey claud e",
  "hay claude",
  "hi claude",
];

/**
 * Check if a transcript contains the wake phrase
 * This utility can be used by both server and client implementations
 */
export function containsWakePhrase(
  transcript: string,
  variants: string[] = WAKE_PHRASE_VARIANTS
): boolean {
  const normalizedTranscript = transcript
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return variants.some((variant) => normalizedTranscript.includes(variant));
}

/**
 * Server-side wake word detection result from STT
 */
export interface ServerWakeWordResult {
  detected: boolean;
  confidence?: number;
  phrase?: string;
  transcription?: string;
}

/**
 * Analyze transcription for wake phrase (server-side utility)
 * Used by the server when processing audio for wake word detection
 */
export function analyzeTranscriptionForWakeWord(
  transcription: string
): ServerWakeWordResult {
  const detected = containsWakePhrase(transcription);

  return {
    detected,
    confidence: detected ? 0.9 : 0,
    phrase: detected ? "hey claude" : undefined,
    transcription,
  };
}
