/**
 * Voice Agent Module for Electron App
 *
 * Central export point for voice agent functionality.
 * Adapted from ui/src/voice-agent for standalone Electron app.
 */

// Types
export * from './types';

// STT
export {
  WhisperClient,
  createWhisperClient,
  whisperClient,
} from './stt/whisper-client';

// LLM
export {
  OllamaClient,
  createOllamaClient,
  ollamaClient,
  type OllamaChatMessage,
  type OllamaChatOptions,
  type OllamaChatResponse,
  type OllamaModel,
} from './llm/ollama-client';

export {
  IntentClassifier,
  createIntentClassifier,
  intentClassifier,
  type ClassificationResult,
} from './llm/intent-classifier';

export {
  EntityExtractor,
  createEntityExtractor,
  entityExtractor,
  type ExtractedEntities,
  type ExtractionResult,
} from './llm/entity-extractor';

// Executors
export {
  TerminalExecutor,
  createTerminalExecutor,
  terminalExecutor,
  type ExecutionEvent,
  type ExecutionEventType,
} from './executor/terminal-executor';

export {
  AppleScriptExecutor,
  createAppleScriptExecutor,
  appleScriptExecutor,
  type AppControlAction,
  type AppControlEvent,
} from './executor/applescript-executor';

export {
  RalphExecutor,
  createRalphExecutor,
  ralphExecutor,
  type RalphCommand,
  type RalphExecutorOptions as RalphExecOptions,
  type RalphExecutionEvent,
} from './executor/ralph-executor';

export {
  ActionRouter,
  createActionRouter,
  actionRouter,
  type PipelineEvent,
  type PipelineEventType,
  type PipelineResult,
} from './executor/action-router';

// TTS
export {
  MacOSTTSEngine,
  createMacOSTTSEngine,
  macOSTTSEngine,
} from './tts/macos-tts';

export {
  TTSEngine,
  createTTSEngine,
} from './tts/tts-engine';

// Utils
export {
  VoiceErrorHandler,
  createErrorHandler,
  errorHandler,
  VoiceErrorCode,
  type VoiceError,
  type RecoveryAction,
  type ErrorStats,
} from './utils/error-handler';

// Filter
export {
  OutputFilter,
  createOutputFilter,
} from './filter/output-filter';

// State
export {
  ConversationStateManager,
  createConversationStateManager,
  conversationStateManager,
  type ConversationEntry,
  type ConversationSession,
  type ConversationManagerConfig,
} from './state/conversation-manager';

// Context
export {
  ConversationContext,
  createConversationContext,
} from './context/conversation-context';

// Ralph status
export {
  StatusHandler,
  createStatusHandler,
  statusHandler,
  type StatusQueryResult,
  type StatusQueryType,
  type StreamStatus,
} from './ralph/status-handler';
