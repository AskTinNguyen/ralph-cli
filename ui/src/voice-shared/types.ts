/**
 * Minimal Voice Types for Terminal STT
 *
 * Only includes types needed for Terminal STT command execution.
 * All Browser STT-specific types removed.
 */

/**
 * Action types that can be performed
 */
export type VoiceActionType =
  | 'claude_code'  // Execute via Claude Code CLI
  | 'unknown';

/**
 * Intent extracted from voice command
 */
export interface VoiceIntent {
  /** The type of action to perform */
  action: VoiceActionType;

  /** The command to execute */
  command?: string;

  /** Confidence score from 0 to 1 */
  confidence: number;

  /** Original transcribed text */
  originalText?: string;
}

/**
 * Result from executing a voice command
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Output from the executed command */
  output?: string;

  /** Filtered output suitable for TTS */
  filteredOutput?: string;

  /** Text prepared for TTS */
  ttsText?: string;

  /** Error message if failed */
  error?: string;

  /** Exit code for terminal commands */
  exitCode?: number;

  /** Execution time in milliseconds */
  duration_ms?: number;

  /** The action that was executed */
  action: VoiceActionType;

  /** The original intent */
  intent: VoiceIntent;
}
