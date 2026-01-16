/**
 * Voice Agent TypeScript Interfaces
 *
 * Type definitions for the voice-controlled desktop automation system.
 */

/**
 * Action types that the voice agent can perform
 */
export type VoiceActionType =
  | 'terminal'         // Execute terminal commands via Open Interpreter
  | 'app_control'      // Control Mac apps via AppleScript (Phase 2)
  | 'ralph_command'    // Execute Ralph CLI commands
  | 'web_search'       // Search the web
  | 'file_operation'   // File system operations
  | 'unknown';         // Unrecognized intent

/**
 * Intent extracted from voice command
 */
export interface VoiceIntent {
  /** The type of action to perform */
  action: VoiceActionType;

  /** Target of the action (e.g., app name, file path) */
  target?: string;

  /** The command to execute */
  command?: string;

  /** Additional parameters for the action */
  parameters?: Record<string, string>;

  /** Confidence score from 0 to 1 */
  confidence: number;

  /** Original transcribed text */
  originalText?: string;

  /** Whether this action requires confirmation */
  requiresConfirmation?: boolean;
}

/**
 * Transcription result from Whisper STT
 */
export interface TranscriptionResult {
  /** Whether transcription succeeded */
  success: boolean;

  /** Transcribed text */
  text: string;

  /** Detected language code */
  language?: string;

  /** Processing time in milliseconds */
  duration_ms?: number;

  /** Error message if failed */
  error?: string;

  /** Individual segments with timestamps */
  segments?: TranscriptionSegment[];
}

/**
 * A segment of transcribed audio with timing info
 */
export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

/**
 * Result from executing a voice command
 */
export interface ExecutionResult {
  /** Whether execution succeeded */
  success: boolean;

  /** Output from the executed command */
  output?: string;

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

/**
 * Voice agent session state
 */
export type VoiceSessionState =
  | 'idle'           // Waiting for voice input
  | 'listening'      // Recording audio
  | 'transcribing'   // Processing audio to text
  | 'classifying'    // Determining intent
  | 'confirming'     // Waiting for user confirmation
  | 'executing'      // Running the command
  | 'error';         // Error state

/**
 * Voice agent session info
 */
export interface VoiceSession {
  /** Unique session ID */
  id: string;

  /** Current state */
  state: VoiceSessionState;

  /** Timestamp when session started */
  startedAt: Date;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Action history for this session */
  history: VoiceActionRecord[];

  /** Current pending intent (if confirming) */
  pendingIntent?: VoiceIntent;
}

/**
 * Record of a voice action
 */
export interface VoiceActionRecord {
  /** Unique action ID */
  id: string;

  /** Timestamp */
  timestamp: Date;

  /** Original transcription */
  transcription: string;

  /** Extracted intent */
  intent: VoiceIntent;

  /** Execution result */
  result?: ExecutionResult;

  /** Whether user confirmed (if confirmation was required) */
  confirmed?: boolean;
}

/**
 * Whisper STT server status
 */
export interface STTServerStatus {
  /** Whether server is healthy */
  healthy: boolean;

  /** Loaded model name */
  model: string;

  /** Whether model is loaded in memory */
  modelLoaded: boolean;

  /** Server URL */
  url: string;
}

/**
 * Ollama LLM server status
 */
export interface LLMServerStatus {
  /** Whether server is healthy */
  healthy: boolean;

  /** Loaded model name */
  model: string;

  /** Server URL */
  url: string;
}

/**
 * Voice agent configuration
 */
export interface VoiceAgentConfig {
  /** Whisper STT server URL */
  sttServerUrl: string;

  /** Ollama server URL */
  ollamaUrl: string;

  /** Ollama model to use for intent classification */
  ollamaModel: string;

  /** Language for STT (optional, auto-detect if not set) */
  language?: string;

  /** Actions that require confirmation before execution */
  confirmationRequired: VoiceActionType[];

  /** Maximum recording duration in seconds */
  maxRecordingDuration: number;

  /** Silence detection threshold (0-1) */
  silenceThreshold: number;

  /** Auto-stop recording after silence (ms) */
  silenceTimeout: number;
}

/**
 * Default voice agent configuration
 */
export const DEFAULT_VOICE_CONFIG: VoiceAgentConfig = {
  sttServerUrl: 'http://localhost:5001',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'qwen2.5:1.5b',
  confirmationRequired: ['file_operation', 'app_control'],
  maxRecordingDuration: 30,
  silenceThreshold: 0.01,
  silenceTimeout: 1500,
};

/**
 * WebSocket message types for voice agent
 */
export type VoiceWSMessageType =
  | 'start_recording'
  | 'stop_recording'
  | 'audio_data'
  | 'transcription'
  | 'intent'
  | 'confirm'
  | 'reject'
  | 'execution_start'
  | 'execution_output'
  | 'execution_complete'
  | 'error'
  | 'state_change';

/**
 * WebSocket message for voice agent
 */
export interface VoiceWSMessage {
  type: VoiceWSMessageType;
  sessionId?: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Open Interpreter execution options
 */
export interface InterpreterOptions {
  /** Working directory for command execution */
  cwd?: string;

  /** Environment variables */
  env?: Record<string, string>;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Whether to stream output */
  stream?: boolean;

  /** Whether to auto-approve commands (dangerous!) */
  autoApprove?: boolean;
}

/**
 * AppleScript executor options (Phase 2)
 */
export interface AppleScriptOptions {
  /** Target application name */
  app?: string;

  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Ralph CLI executor options
 */
export interface RalphExecutorOptions {
  /** PRD number to target */
  prdNumber?: number;

  /** Working directory */
  cwd?: string;

  /** Whether to use headless mode */
  headless?: boolean;
}
