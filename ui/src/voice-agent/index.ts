/**
 * Voice Agent Module Exports
 *
 * Central export point for all voice agent functionality.
 */

// Types
export * from "./types.js";

// STT
export {
  WhisperClient,
  createWhisperClient,
  whisperClient,
} from "./stt/whisper-client.js";

// LLM
export {
  OllamaClient,
  createOllamaClient,
  ollamaClient,
  type OllamaChatMessage,
  type OllamaChatOptions,
  type OllamaChatResponse,
  type OllamaModel,
} from "./llm/ollama-client.js";

export {
  IntentClassifier,
  createIntentClassifier,
  intentClassifier,
  type ClassificationResult,
} from "./llm/intent-classifier.js";

export {
  EntityExtractor,
  createEntityExtractor,
  entityExtractor,
  type ExtractedEntities,
  type ExtractionResult,
} from "./llm/entity-extractor.js";

// Executors
export {
  TerminalExecutor,
  createTerminalExecutor,
  terminalExecutor,
  type ExecutionEvent,
  type ExecutionEventType,
} from "./executor/terminal-executor.js";

export {
  AppleScriptExecutor,
  createAppleScriptExecutor,
  appleScriptExecutor,
  type AppControlAction,
  type AppControlEvent,
} from "./executor/applescript-executor.js";

export {
  RalphExecutor,
  createRalphExecutor,
  ralphExecutor,
  type RalphCommand,
  type RalphExecutorOptions,
  type RalphExecutionEvent,
} from "./executor/ralph-executor.js";

export {
  ActionRouter,
  createActionRouter,
  actionRouter,
  type PipelineEvent,
  type PipelineEventType,
  type PipelineResult,
} from "./executor/action-router.js";

// Utils
export {
  VoiceErrorHandler,
  createErrorHandler,
  errorHandler,
  VoiceErrorCode,
  type VoiceError,
  type RecoveryAction,
  type ErrorStats,
} from "./utils/error-handler.js";

// Process Management
export {
  VoiceProcessManager,
  voiceProcessManager,
  type VoiceEvent,
  type VoiceEventType,
} from "./process/voice-process-manager.js";
