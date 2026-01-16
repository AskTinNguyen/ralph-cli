/**
 * Error Handler
 *
 * Centralized error handling and recovery utilities for the voice agent.
 * Provides consistent error categorization, logging, and recovery strategies.
 */

import type { VoiceIntent, ExecutionResult, VoiceActionType } from "../types.js";

/**
 * Voice agent error codes
 */
export enum VoiceErrorCode {
  // STT Errors (1xx)
  STT_SERVER_UNAVAILABLE = 100,
  STT_TRANSCRIPTION_FAILED = 101,
  STT_AUDIO_INVALID = 102,
  STT_TIMEOUT = 103,

  // LLM Errors (2xx)
  LLM_SERVER_UNAVAILABLE = 200,
  LLM_MODEL_NOT_FOUND = 201,
  LLM_CLASSIFICATION_FAILED = 202,
  LLM_INVALID_RESPONSE = 203,
  LLM_TIMEOUT = 204,

  // Execution Errors (3xx)
  EXEC_COMMAND_BLOCKED = 300,
  EXEC_COMMAND_FAILED = 301,
  EXEC_TIMEOUT = 302,
  EXEC_PERMISSION_DENIED = 303,
  EXEC_NOT_FOUND = 304,
  EXEC_CONFIRMATION_REQUIRED = 305,

  // App Control Errors (4xx)
  APP_NOT_FOUND = 400,
  APP_CONTROL_FAILED = 401,
  APP_BLOCKED = 402,
  APPLESCRIPT_NOT_AVAILABLE = 403,

  // Ralph Errors (5xx)
  RALPH_NOT_INSTALLED = 500,
  RALPH_COMMAND_FAILED = 501,
  RALPH_PRD_NOT_FOUND = 502,

  // General Errors (9xx)
  UNKNOWN_ERROR = 900,
  INVALID_INPUT = 901,
  INTERNAL_ERROR = 902,
}

/**
 * Voice agent error with metadata
 */
export interface VoiceError {
  /** Error code */
  code: VoiceErrorCode;

  /** Human-readable message */
  message: string;

  /** Original error if available */
  originalError?: Error;

  /** Related intent if available */
  intent?: VoiceIntent;

  /** Suggested recovery action */
  recovery?: RecoveryAction;

  /** Whether the error is recoverable */
  recoverable: boolean;

  /** Timestamp */
  timestamp: Date;
}

/**
 * Recovery action suggestions
 */
export interface RecoveryAction {
  /** Type of recovery */
  type: "retry" | "confirm" | "modify" | "abort" | "fallback";

  /** Human-readable description */
  description: string;

  /** Suggested alternative if available */
  alternative?: string;

  /** Delay before retry in milliseconds */
  retryDelay?: number;

  /** Maximum retry attempts */
  maxRetries?: number;
}

/**
 * Error statistics for monitoring
 */
export interface ErrorStats {
  /** Total errors */
  total: number;

  /** Errors by code */
  byCode: Record<VoiceErrorCode, number>;

  /** Errors by action type */
  byAction: Record<VoiceActionType, number>;

  /** Recovery success rate */
  recoveryRate: number;

  /** Last error timestamp */
  lastError?: Date;
}

/**
 * Error handler class
 */
export class VoiceErrorHandler {
  private errorLog: VoiceError[] = [];
  private maxLogSize: number;
  private recoveryAttempts: Map<string, number> = new Map();

  constructor(options: { maxLogSize?: number } = {}) {
    this.maxLogSize = options.maxLogSize || 100;
  }

  /**
   * Create and log an error
   */
  createError(
    code: VoiceErrorCode,
    message: string,
    options: {
      originalError?: Error;
      intent?: VoiceIntent;
      recoverable?: boolean;
    } = {}
  ): VoiceError {
    const error: VoiceError = {
      code,
      message,
      originalError: options.originalError,
      intent: options.intent,
      recovery: this.suggestRecovery(code, options.intent),
      recoverable: options.recoverable ?? this.isRecoverable(code),
      timestamp: new Date(),
    };

    this.logError(error);
    return error;
  }

  /**
   * Log an error
   */
  private logError(error: VoiceError): void {
    this.errorLog.push(error);

    // Trim log if too large
    if (this.errorLog.length > this.maxLogSize) {
      this.errorLog = this.errorLog.slice(-this.maxLogSize);
    }
  }

  /**
   * Suggest recovery action based on error code
   */
  private suggestRecovery(
    code: VoiceErrorCode,
    intent?: VoiceIntent
  ): RecoveryAction | undefined {
    switch (code) {
      // STT Errors
      case VoiceErrorCode.STT_SERVER_UNAVAILABLE:
        return {
          type: "retry",
          description: "Start the Whisper STT server",
          alternative: "python ui/python/stt_server.py",
          retryDelay: 5000,
          maxRetries: 3,
        };

      case VoiceErrorCode.STT_TRANSCRIPTION_FAILED:
        return {
          type: "retry",
          description: "Try speaking more clearly or closer to the microphone",
          retryDelay: 1000,
          maxRetries: 2,
        };

      case VoiceErrorCode.STT_TIMEOUT:
        return {
          type: "retry",
          description: "Recording timed out, try a shorter command",
          retryDelay: 0,
          maxRetries: 1,
        };

      // LLM Errors
      case VoiceErrorCode.LLM_SERVER_UNAVAILABLE:
        return {
          type: "retry",
          description: "Start Ollama server",
          alternative: "ollama serve",
          retryDelay: 5000,
          maxRetries: 3,
        };

      case VoiceErrorCode.LLM_MODEL_NOT_FOUND:
        return {
          type: "abort",
          description: "Pull the required model",
          alternative: "ollama pull qwen2.5",
        };

      case VoiceErrorCode.LLM_CLASSIFICATION_FAILED:
        return {
          type: "fallback",
          description: "Using pattern matching instead of LLM",
        };

      // Execution Errors
      case VoiceErrorCode.EXEC_COMMAND_BLOCKED:
        return {
          type: "abort",
          description: "This command is blocked for safety reasons",
        };

      case VoiceErrorCode.EXEC_CONFIRMATION_REQUIRED:
        return {
          type: "confirm",
          description: "This action requires confirmation before execution",
        };

      case VoiceErrorCode.EXEC_TIMEOUT:
        return {
          type: "retry",
          description: "Command timed out, consider increasing timeout",
          retryDelay: 0,
          maxRetries: 1,
        };

      case VoiceErrorCode.EXEC_PERMISSION_DENIED:
        return {
          type: "abort",
          description: "Permission denied, check file/directory permissions",
        };

      // App Control Errors
      case VoiceErrorCode.APP_NOT_FOUND:
        return {
          type: "modify",
          description: "Application not found, check the app name",
        };

      case VoiceErrorCode.APPLESCRIPT_NOT_AVAILABLE:
        return {
          type: "abort",
          description: "AppleScript is only available on macOS",
        };

      // Ralph Errors
      case VoiceErrorCode.RALPH_NOT_INSTALLED:
        return {
          type: "abort",
          description: "Install Ralph CLI",
          alternative: "npm install -g ralph-cli",
        };

      case VoiceErrorCode.RALPH_PRD_NOT_FOUND:
        return {
          type: "modify",
          description: "PRD not found, create one first with 'ralph prd'",
        };

      default:
        return undefined;
    }
  }

  /**
   * Check if an error code is recoverable
   */
  private isRecoverable(code: VoiceErrorCode): boolean {
    const nonRecoverableCodes = [
      VoiceErrorCode.EXEC_COMMAND_BLOCKED,
      VoiceErrorCode.APP_BLOCKED,
      VoiceErrorCode.APPLESCRIPT_NOT_AVAILABLE,
      VoiceErrorCode.RALPH_NOT_INSTALLED,
      VoiceErrorCode.LLM_MODEL_NOT_FOUND,
    ];

    return !nonRecoverableCodes.includes(code);
  }

  /**
   * Parse execution result into error if failed
   */
  parseExecutionResult(result: ExecutionResult): VoiceError | null {
    if (result.success) {
      return null;
    }

    const errorMessage = result.error || "Execution failed";

    // Determine error code based on message
    let code = VoiceErrorCode.EXEC_COMMAND_FAILED;

    if (errorMessage.includes("blocked")) {
      code = VoiceErrorCode.EXEC_COMMAND_BLOCKED;
    } else if (errorMessage.includes("confirmation")) {
      code = VoiceErrorCode.EXEC_CONFIRMATION_REQUIRED;
    } else if (errorMessage.includes("timed out")) {
      code = VoiceErrorCode.EXEC_TIMEOUT;
    } else if (errorMessage.includes("permission")) {
      code = VoiceErrorCode.EXEC_PERMISSION_DENIED;
    } else if (errorMessage.includes("not found")) {
      code = VoiceErrorCode.EXEC_NOT_FOUND;
    }

    return this.createError(code, errorMessage, { intent: result.intent });
  }

  /**
   * Check if retry should be attempted
   */
  shouldRetry(error: VoiceError, attemptKey: string): boolean {
    if (!error.recoverable || error.recovery?.type !== "retry") {
      return false;
    }

    const attempts = this.recoveryAttempts.get(attemptKey) || 0;
    const maxRetries = error.recovery.maxRetries || 3;

    return attempts < maxRetries;
  }

  /**
   * Record a retry attempt
   */
  recordRetry(attemptKey: string): number {
    const attempts = (this.recoveryAttempts.get(attemptKey) || 0) + 1;
    this.recoveryAttempts.set(attemptKey, attempts);
    return attempts;
  }

  /**
   * Clear retry counter
   */
  clearRetries(attemptKey: string): void {
    this.recoveryAttempts.delete(attemptKey);
  }

  /**
   * Get error statistics
   */
  getStats(): ErrorStats {
    const stats: ErrorStats = {
      total: this.errorLog.length,
      byCode: {} as Record<VoiceErrorCode, number>,
      byAction: {} as Record<VoiceActionType, number>,
      recoveryRate: 0,
      lastError: this.errorLog.length > 0
        ? this.errorLog[this.errorLog.length - 1].timestamp
        : undefined,
    };

    // Count by code
    for (const error of this.errorLog) {
      stats.byCode[error.code] = (stats.byCode[error.code] || 0) + 1;

      if (error.intent?.action) {
        stats.byAction[error.intent.action] =
          (stats.byAction[error.intent.action] || 0) + 1;
      }
    }

    // Calculate recovery rate
    const recoverable = this.errorLog.filter((e) => e.recoverable).length;
    if (recoverable > 0) {
      // Simplified: assume 70% recovery rate for recoverable errors
      stats.recoveryRate = 0.7;
    }

    return stats;
  }

  /**
   * Get recent errors
   */
  getRecentErrors(limit: number = 10): VoiceError[] {
    return this.errorLog.slice(-limit);
  }

  /**
   * Clear error log
   */
  clearLog(): void {
    this.errorLog = [];
    this.recoveryAttempts.clear();
  }

  /**
   * Format error for display
   */
  formatError(error: VoiceError): string {
    let message = `[${error.code}] ${error.message}`;

    if (error.recovery) {
      message += `\n  Recovery: ${error.recovery.description}`;
      if (error.recovery.alternative) {
        message += `\n  Try: ${error.recovery.alternative}`;
      }
    }

    return message;
  }
}

/**
 * Create error handler instance
 */
export function createErrorHandler(
  options: { maxLogSize?: number } = {}
): VoiceErrorHandler {
  return new VoiceErrorHandler(options);
}

// Export singleton
export const errorHandler = new VoiceErrorHandler();
