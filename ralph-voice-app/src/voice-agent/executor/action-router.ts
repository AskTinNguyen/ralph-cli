/**
 * Action Router
 *
 * Routes voice intents to the appropriate executor based on action type.
 * Coordinates the full voice command pipeline: transcribe -> classify -> execute.
 * Includes status query handling and conversation context for multi-turn support.
 */

import { EventEmitter } from "node:events";
import { createWhisperClient, type WhisperClient } from "../stt/whisper-client";
import {
  createIntentClassifier,
  type IntentClassifier,
} from "../llm/intent-classifier";
import {
  createTerminalExecutor,
  type TerminalExecutor,
} from "./terminal-executor";
import {
  createAppleScriptExecutor,
  type AppleScriptExecutor,
} from "./applescript-executor";
import {
  createRalphExecutor,
  type RalphExecutor,
} from "./ralph-executor";
import {
  createClaudeCodeExecutor,
  type ClaudeCodeExecutor,
} from "./claude-code-executor";
import { createTTSEngine, type TTSEngine } from "../tts/tts-engine";
import {
  createStatusHandler,
  type StatusHandler,
  type StatusQueryResult,
} from "../ralph/status-handler";
import {
  createConversationContext,
  type ConversationContext,
  type ClarificationRequest,
} from "../context/conversation-context";
import type {
  VoiceIntent,
  ExecutionResult,
  TranscriptionResult,
  VoiceAgentConfig,
  VoiceActionType,
  InterpreterOptions,
} from "../types";

/**
 * Pipeline stage events
 */
export type PipelineEventType =
  | "transcription_start"
  | "transcription_complete"
  | "classification_start"
  | "classification_complete"
  | "execution_start"
  | "execution_output"
  | "execution_complete"
  | "error";

/**
 * Pipeline event data
 */
export interface PipelineEvent {
  type: PipelineEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Full pipeline result
 */
export interface PipelineResult {
  /** Whether the full pipeline succeeded */
  success: boolean;

  /** Transcription result */
  transcription?: TranscriptionResult;

  /** Classified intent */
  intent?: VoiceIntent;

  /** Execution result */
  execution?: ExecutionResult;

  /** Error message if failed */
  error?: string;

  /** Stage where failure occurred */
  failedStage?: "transcription" | "classification" | "execution";

  /** Total pipeline duration in milliseconds */
  duration_ms: number;
}

/**
 * Action Router class
 *
 * Orchestrates the voice command pipeline and routes to appropriate executors.
 * Includes status query handling and conversation context for multi-turn support.
 */
export class ActionRouter {
  private whisperClient: WhisperClient;
  private intentClassifier: IntentClassifier;
  private terminalExecutor: TerminalExecutor;
  private appleScriptExecutor: AppleScriptExecutor;
  private ralphExecutor: RalphExecutor;
  private claudeCodeExecutor: ClaudeCodeExecutor;
  private ttsEngine: TTSEngine | null = null;
  private statusHandler: StatusHandler;
  private conversationContext: ConversationContext;
  private config: VoiceAgentConfig;
  private ttsEnabled: boolean = true;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.config = {
      sttServerUrl: config.sttServerUrl || "http://localhost:5001",
      ollamaUrl: config.ollamaUrl || "http://localhost:11434",
      ollamaModel: config.ollamaModel || "qwen2.5:1.5b",
      confirmationRequired: config.confirmationRequired || [
        "file_operation",
      ],
      maxRecordingDuration: config.maxRecordingDuration || 30,
      silenceThreshold: config.silenceThreshold || 0.01,
      silenceTimeout: config.silenceTimeout || 1500,
    };

    this.whisperClient = createWhisperClient(this.config);
    this.intentClassifier = createIntentClassifier(this.config);
    this.terminalExecutor = createTerminalExecutor();
    this.appleScriptExecutor = createAppleScriptExecutor();
    this.ralphExecutor = createRalphExecutor();
    this.claudeCodeExecutor = createClaudeCodeExecutor();
    this.statusHandler = createStatusHandler();
    this.conversationContext = createConversationContext();

    // Initialize TTS engine asynchronously
    this.initTTS();
  }

  /**
   * Initialize the TTS engine
   * Reads TTS_PROVIDER env var: "piper" | "macos" (default: "piper")
   * For Piper, also reads TTS_VOICE: "lessac" | "ryan" | "alba" (default: "alba")
   */
  private async initTTS(): Promise<void> {
    try {
      const provider = (process.env.TTS_PROVIDER || "piper") as "piper" | "macos";
      const voice = process.env.TTS_VOICE || (provider === "piper" ? "alba" : "Samantha");

      this.ttsEngine = await createTTSEngine({ provider, voice });
      const available = await this.ttsEngine.checkAvailable();
      if (!available.available) {
        console.warn(`TTS (${provider}) not available:`, available.error);
        // Fall back to macOS if Piper not available
        if (provider === "piper") {
          console.log("Falling back to macOS TTS...");
          this.ttsEngine = await createTTSEngine({ provider: "macos" });
          const macosAvailable = await this.ttsEngine.checkAvailable();
          if (!macosAvailable.available) {
            this.ttsEnabled = false;
          }
        } else {
          this.ttsEnabled = false;
        }
      } else {
        console.log(`TTS initialized: ${provider}${provider === "piper" ? ` (voice: ${voice})` : ""}`);
      }
    } catch (error) {
      console.warn("Failed to initialize TTS:", error);
      this.ttsEnabled = false;
    }
  }

  /**
   * Process audio through the full pipeline: transcribe -> classify -> execute
   */
  async processAudio(
    audioData: Buffer | ArrayBuffer,
    options: {
      language?: string;
      autoExecute?: boolean;
      executorOptions?: InterpreterOptions;
    } = {}
  ): Promise<PipelineResult> {
    const startTime = Date.now();

    // Stage 1: Transcription
    const transcription = await this.whisperClient.transcribe(
      audioData instanceof Buffer ? audioData : Buffer.from(new Uint8Array(audioData)),
      { language: options.language }
    );

    if (!transcription.success || !transcription.text) {
      return {
        success: false,
        transcription,
        error: transcription.error || "Transcription failed",
        failedStage: "transcription",
        duration_ms: Date.now() - startTime,
      };
    }

    // Stage 2: Intent Classification
    const classification = await this.intentClassifier.classifyWithFallback(
      transcription.text
    );

    if (!classification.success || !classification.intent) {
      return {
        success: false,
        transcription,
        error: classification.error || "Intent classification failed",
        failedStage: "classification",
        duration_ms: Date.now() - startTime,
      };
    }

    const intent = classification.intent;

    // Check if action requires confirmation
    if (
      this.requiresConfirmation(intent) &&
      !options.autoExecute
    ) {
      return {
        success: true,
        transcription,
        intent,
        error: "Action requires confirmation",
        duration_ms: Date.now() - startTime,
      };
    }

    // Stage 3: Execution (if auto-execute enabled)
    if (options.autoExecute) {
      const execution = await this.execute(intent, options.executorOptions);
      return {
        success: execution.success,
        transcription,
        intent,
        execution,
        error: execution.error,
        failedStage: execution.success ? undefined : "execution",
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      success: true,
      transcription,
      intent,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Process text through classification and optional execution
   */
  async processText(
    text: string,
    options: {
      autoExecute?: boolean;
      executorOptions?: InterpreterOptions;
    } = {}
  ): Promise<{
    success: boolean;
    intent?: VoiceIntent;
    execution?: ExecutionResult;
    error?: string;
    duration_ms: number;
  }> {
    const startTime = Date.now();

    // Stage 1: Intent Classification
    const classification = await this.intentClassifier.classifyWithFallback(text);

    if (!classification.success || !classification.intent) {
      return {
        success: false,
        error: classification.error || "Intent classification failed",
        duration_ms: Date.now() - startTime,
      };
    }

    const intent = classification.intent;

    // Check if action requires confirmation
    if (this.requiresConfirmation(intent) && !options.autoExecute) {
      return {
        success: true,
        intent,
        error: "Action requires confirmation",
        duration_ms: Date.now() - startTime,
      };
    }

    // Execute if auto-execute enabled
    if (options.autoExecute) {
      const execution = await this.execute(intent, options.executorOptions);
      return {
        success: execution.success,
        intent,
        execution,
        error: execution.error,
        duration_ms: Date.now() - startTime,
      };
    }

    return {
      success: true,
      intent,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Process audio with streaming events
   */
  processAudioStreaming(
    audioData: Buffer | ArrayBuffer,
    options: {
      language?: string;
      autoExecute?: boolean;
      executorOptions?: InterpreterOptions;
    } = {}
  ): EventEmitter {
    const eventEmitter = new EventEmitter();

    // Run pipeline asynchronously
    (async () => {
      const startTime = Date.now();

      try {
        // Stage 1: Transcription
        this.emitEvent(eventEmitter, "transcription_start", {});

        const transcription = await this.whisperClient.transcribe(
          audioData instanceof Buffer ? audioData : Buffer.from(new Uint8Array(audioData)),
          { language: options.language }
        );

        this.emitEvent(eventEmitter, "transcription_complete", {
          success: transcription.success,
          text: transcription.text,
          language: transcription.language,
          duration_ms: transcription.duration_ms,
        });

        if (!transcription.success || !transcription.text) {
          this.emitEvent(eventEmitter, "error", {
            stage: "transcription",
            error: transcription.error || "Transcription failed",
          });
          return;
        }

        // Stage 2: Classification
        this.emitEvent(eventEmitter, "classification_start", {
          text: transcription.text,
        });

        const classification = await this.intentClassifier.classifyWithFallback(
          transcription.text
        );

        this.emitEvent(eventEmitter, "classification_complete", {
          success: classification.success,
          intent: classification.intent,
          duration_ms: classification.duration_ms,
        });

        if (!classification.success || !classification.intent) {
          this.emitEvent(eventEmitter, "error", {
            stage: "classification",
            error: classification.error || "Classification failed",
          });
          return;
        }

        const intent = classification.intent;

        // Check confirmation requirement
        if (this.requiresConfirmation(intent) && !options.autoExecute) {
          this.emitEvent(eventEmitter, "execution_complete", {
            success: false,
            requiresConfirmation: true,
            intent,
          });
          return;
        }

        // Stage 3: Execution
        if (options.autoExecute) {
          this.emitEvent(eventEmitter, "execution_start", { intent });

          const execution = await this.execute(intent, options.executorOptions);

          this.emitEvent(eventEmitter, "execution_complete", {
            success: execution.success,
            output: execution.output,
            error: execution.error,
            exitCode: execution.exitCode,
            duration_ms: execution.duration_ms,
          });
        }
      } catch (error) {
        this.emitEvent(eventEmitter, "error", {
          error: error instanceof Error ? error.message : "Pipeline error",
        });
      }
    })();

    return eventEmitter;
  }

  /**
   * Execute an intent
   */
  async execute(
    intent: VoiceIntent,
    options: InterpreterOptions = {}
  ): Promise<ExecutionResult> {
    switch (intent.action) {
      case "claude_code":
        return this.executeClaudeCode(intent, options);

      case "terminal":
        return this.terminalExecutor.execute(intent, options);

      case "ralph_command":
        return this.executeRalphCommand(intent, options);

      case "app_control":
        return this.executeAppControl(intent);

      case "web_search":
        return this.executeWebSearch(intent);

      case "file_operation":
        return this.executeFileOperation(intent, options);

      case "unknown":
      default:
        return {
          success: false,
          error: `Unknown action type: ${intent.action}`,
          action: intent.action,
          intent,
        };
    }
  }

  /**
   * Execute a Claude Code command with TTS response
   */
  private async executeClaudeCode(
    intent: VoiceIntent,
    options: InterpreterOptions = {}
  ): Promise<ExecutionResult & { filteredOutput?: string; ttsText?: string }> {
    const startTime = Date.now();

    // Execute via Claude Code executor
    const result = await this.claudeCodeExecutor.execute(intent, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout || 300000, // 5 minutes default
      includeContext: true,
      sessionId: "voice-session", // Could be made configurable
    });

    // Speak the response via TTS if enabled
    if (this.ttsEnabled && this.ttsEngine && result.ttsText) {
      try {
        await this.ttsEngine.speak(result.ttsText);
      } catch (error) {
        console.warn("TTS failed:", error);
      }
    }

    return {
      ...result,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Execute a Ralph CLI command
   * Handles status queries and conversation context for ambiguous commands
   */
  private async executeRalphCommand(
    intent: VoiceIntent,
    options: InterpreterOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Check if this is a status query
    if (intent.parameters?.command === 'status' || intent.parameters?.queryType) {
      const statusResult = await this.statusHandler.handleQuery({
        prdNumber: intent.parameters?.prdNumber,
        queryType: intent.parameters?.queryType,
      });

      return {
        success: statusResult.success,
        output: statusResult.summary,
        error: statusResult.error,
        action: intent.action,
        intent,
        duration_ms: Date.now() - startTime,
      };
    }

    // Check for ambiguous commands and try to resolve
    if (intent.parameters?.ambiguous === 'true' || intent.parameters?.needsContext === 'true') {
      const resolved = this.conversationContext.resolveAmbiguity(intent);

      // If we got a clarification request, return it as an error requiring user input
      if ('type' in resolved && resolved.type === 'clarification') {
        return {
          success: false,
          error: resolved.question,
          output: JSON.stringify({
            needsClarification: true,
            question: resolved.question,
            options: resolved.options,
          }),
          action: intent.action,
          intent,
          duration_ms: Date.now() - startTime,
        };
      }

      // Use the resolved intent
      const result = await this.ralphExecutor.execute(resolved as VoiceIntent, {
        cwd: options.cwd || process.cwd(),
        timeout: options.timeout,
        headless: true,
      });

      // Record in conversation context
      this.conversationContext.addTurn({
        text: intent.originalText || '',
        intent: resolved as VoiceIntent,
        timestamp: new Date(),
        result,
      });

      return result;
    }

    // Execute normal Ralph command
    const result = await this.ralphExecutor.execute(intent, {
      cwd: options.cwd || process.cwd(),
      timeout: options.timeout,
      headless: true, // Always headless for server execution
    });

    // Record in conversation context
    this.conversationContext.addTurn({
      text: intent.originalText || '',
      intent,
      timestamp: new Date(),
      result,
    });

    return result;
  }

  /**
   * Execute app control via AppleScript (macOS only)
   */
  private async executeAppControl(intent: VoiceIntent): Promise<ExecutionResult> {
    return this.appleScriptExecutor.execute(intent);
  }

  /**
   * Execute web search (placeholder - opens browser)
   */
  private async executeWebSearch(intent: VoiceIntent): Promise<ExecutionResult> {
    const query = intent.parameters?.query || intent.originalText;

    if (!query) {
      return {
        success: false,
        error: "No search query provided",
        action: intent.action,
        intent,
      };
    }

    // Open browser with search query
    const encodedQuery = encodeURIComponent(query);
    const url = `https://www.google.com/search?q=${encodedQuery}`;

    const terminalIntent: VoiceIntent = {
      ...intent,
      action: "terminal",
      command: `open "${url}"`,
    };

    return this.terminalExecutor.execute(terminalIntent, { timeout: 5000 });
  }

  /**
   * Execute file operation
   */
  private async executeFileOperation(
    intent: VoiceIntent,
    options: InterpreterOptions = {}
  ): Promise<ExecutionResult> {
    // File operations are executed through terminal with extra caution
    if (!intent.command) {
      return {
        success: false,
        error: "No file operation command specified",
        action: intent.action,
        intent,
      };
    }

    // Check if dangerous
    if (this.terminalExecutor.isDangerous(intent.command)) {
      return {
        success: false,
        error: "This file operation requires explicit confirmation",
        action: intent.action,
        intent,
      };
    }

    return this.terminalExecutor.execute(intent, options);
  }

  /**
   * Check if an action type requires confirmation
   */
  requiresConfirmation(intent: VoiceIntent): boolean {
    // Check if the action type requires confirmation
    if (this.config.confirmationRequired.includes(intent.action)) {
      return true;
    }

    // Check if the intent itself flagged confirmation required
    if (intent.requiresConfirmation) {
      return true;
    }

    // Check if the command is dangerous
    if (
      intent.command &&
      intent.action === "terminal" &&
      this.terminalExecutor.isDangerous(intent.command)
    ) {
      return true;
    }

    return false;
  }

  /**
   * Emit a pipeline event
   */
  private emitEvent(
    eventEmitter: EventEmitter,
    type: PipelineEventType,
    data: Record<string, unknown>
  ): void {
    const event: PipelineEvent = {
      type,
      data,
      timestamp: new Date(),
    };
    eventEmitter.emit(type, event);
    eventEmitter.emit("event", event);
  }

  /**
   * Check if all services are available
   */
  async checkServices(): Promise<{
    stt: boolean;
    llm: boolean;
    appleScript: boolean;
    ralph: boolean;
    claudeCode: boolean;
    tts: boolean;
    openInterpreter: boolean;
    messages: string[];
  }> {
    const messages: string[] = [];

    // Check STT server
    const sttStatus = await this.whisperClient.checkHealth();
    if (!sttStatus.healthy) {
      messages.push(`STT server not healthy at ${sttStatus.url}`);
    }

    // Check LLM (Ollama)
    const llmCheck = await this.intentClassifier.checkModel();
    if (!llmCheck.available) {
      messages.push(llmCheck.error || "LLM model not available");
    }

    // Check AppleScript (macOS)
    const appleScriptCheck = await this.appleScriptExecutor.checkAvailable();
    if (!appleScriptCheck.available) {
      messages.push(appleScriptCheck.error || "AppleScript not available (macOS only)");
    }

    // Check Ralph CLI
    const ralphCheck = await this.ralphExecutor.checkAvailable();
    if (!ralphCheck.available) {
      messages.push(ralphCheck.error || "Ralph CLI not available");
    }

    // Check Open Interpreter
    const oiCheck = await this.terminalExecutor.checkOpenInterpreter();
    if (!oiCheck.available) {
      messages.push(oiCheck.error || "Open Interpreter not available");
    }

    // Check Claude Code CLI
    const claudeCodeCheck = await this.claudeCodeExecutor.checkAvailable();
    if (!claudeCodeCheck.available) {
      messages.push(claudeCodeCheck.error || "Claude Code CLI not available");
    }

    // Check TTS
    let ttsAvailable = false;
    if (this.ttsEngine) {
      const ttsCheck = await this.ttsEngine.checkAvailable();
      ttsAvailable = ttsCheck.available;
      if (!ttsCheck.available) {
        messages.push(ttsCheck.error || "TTS not available");
      }
    } else {
      messages.push("TTS engine not initialized");
    }

    return {
      stt: sttStatus.healthy,
      llm: llmCheck.available,
      appleScript: appleScriptCheck.available,
      ralph: ralphCheck.available,
      claudeCode: claudeCodeCheck.available,
      tts: ttsAvailable,
      openInterpreter: oiCheck.available,
      messages,
    };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<VoiceAgentConfig>): void {
    this.config = { ...this.config, ...updates };

    if (updates.sttServerUrl) {
      this.whisperClient.setServerUrl(updates.sttServerUrl);
    }
    if (updates.ollamaModel) {
      this.intentClassifier.setModel(updates.ollamaModel);
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): VoiceAgentConfig {
    return { ...this.config };
  }

  /**
   * Get status for Ralph PRDs
   */
  async getStatus(params: {
    prdNumber?: string;
    queryType?: string;
  } = {}): Promise<StatusQueryResult> {
    return this.statusHandler.handleQuery(params);
  }

  /**
   * Get conversation context summary
   */
  getConversationSummary(): {
    turnCount: number;
    currentPrd?: string;
    lastCommand?: string;
  } {
    return this.conversationContext.getSummary();
  }

  /**
   * Clear conversation context
   */
  clearConversationContext(): void {
    this.conversationContext.clear();
  }

  /**
   * Set current PRD in conversation context
   */
  setCurrentPrd(prdNumber: string): void {
    this.conversationContext.setCurrentPrd(prdNumber);
  }

  /**
   * Enable or disable TTS
   */
  setTTSEnabled(enabled: boolean): void {
    this.ttsEnabled = enabled;
  }

  /**
   * Check if TTS is enabled
   */
  isTTSEnabled(): boolean {
    return this.ttsEnabled;
  }

  /**
   * Stop current TTS playback
   */
  stopTTS(): void {
    if (this.ttsEngine) {
      this.ttsEngine.stop();
    }
  }

  /**
   * Check if TTS is currently speaking
   */
  isTTSSpeaking(): boolean {
    return this.ttsEngine?.isSpeaking() ?? false;
  }

  /**
   * Speak text via TTS (manual trigger)
   */
  async speak(text: string): Promise<{ success: boolean; error?: string }> {
    if (!this.ttsEngine) {
      return { success: false, error: "TTS engine not initialized" };
    }

    if (!this.ttsEnabled) {
      return { success: false, error: "TTS is disabled" };
    }

    const result = await this.ttsEngine.speak(text);
    return result;
  }

  /**
   * Get available TTS voices
   */
  async getTTSVoices(): Promise<string[]> {
    if (!this.ttsEngine) {
      return [];
    }
    return this.ttsEngine.getVoices();
  }

  /**
   * Get Claude Code executor for direct access
   */
  getClaudeCodeExecutor(): ClaudeCodeExecutor {
    return this.claudeCodeExecutor;
  }
}

/**
 * Create an ActionRouter instance
 */
export function createActionRouter(
  config: Partial<VoiceAgentConfig> = {}
): ActionRouter {
  return new ActionRouter(config);
}

// Export singleton instance
export const actionRouter = new ActionRouter();
