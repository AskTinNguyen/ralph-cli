/**
 * Claude Code Executor
 *
 * Executes voice commands through Claude Code CLI with output filtering for TTS.
 * Uses `claude -p --dangerously-skip-permissions "{prompt}"` for execution.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { VoiceIntent, ExecutionResult } from "../types.js";
import { OutputFilter, createOutputFilter } from "../filter/output-filter.js";
import {
  ConversationStateManager,
  createConversationStateManager,
} from "../state/conversation-manager.js";

/**
 * Claude Code execution options
 */
export interface ClaudeCodeOptions {
  /** Working directory for command execution */
  cwd?: string;

  /** Timeout in milliseconds (default: 5 minutes) */
  timeout?: number;

  /** Model to use (haiku, sonnet, opus) */
  model?: string;

  /** Whether to include conversation context */
  includeContext?: boolean;

  /** Session ID for conversation context */
  sessionId?: string;
}

/**
 * Claude Code execution event types
 */
export type ClaudeCodeEventType =
  | "start"
  | "stdout"
  | "filtered_output"
  | "exit"
  | "error";

/**
 * Claude Code execution event
 */
export interface ClaudeCodeEvent {
  type: ClaudeCodeEventType;
  data: string;
  filteredForTTS?: string;
  timestamp: Date;
}

/**
 * Claude Code Executor class
 */
export class ClaudeCodeExecutor {
  private defaultCwd: string;
  private defaultTimeout: number;
  private outputFilter: OutputFilter;
  private conversationManager: ConversationStateManager;
  private defaultModel: string;

  constructor(options: Partial<ClaudeCodeOptions> = {}) {
    this.defaultCwd = options.cwd || process.cwd();
    this.defaultTimeout = options.timeout || 300000; // 5 minutes default
    this.defaultModel = options.model || "sonnet";
    this.outputFilter = createOutputFilter();
    this.conversationManager = createConversationStateManager();
  }

  /**
   * Execute a Claude Code command
   */
  async execute(
    intent: VoiceIntent,
    options: ClaudeCodeOptions = {}
  ): Promise<ExecutionResult & { filteredOutput?: string; ttsText?: string }> {
    const prompt = this.buildPrompt(intent, options);

    if (!prompt) {
      return {
        success: false,
        error: "No prompt could be constructed from intent",
        action: intent.action,
        intent,
      };
    }

    const startTime = Date.now();
    const cwd = options.cwd || this.defaultCwd;
    const timeout = options.timeout || this.defaultTimeout;
    const sessionId = options.sessionId || "default";

    try {
      const result = await this.executeClaudeCode(prompt, {
        cwd,
        timeout,
        model: options.model || this.defaultModel,
      });

      // Filter output for TTS
      const filteredOutput = this.outputFilter.filter(result.output || "");
      const ttsText = this.outputFilter.generateTTSSummary(
        result.output || "",
        intent.originalText || ""
      );

      // Update conversation context
      if (result.success) {
        this.conversationManager.addToHistory(sessionId, {
          prompt,
          response: result.output || "",
          filteredResponse: filteredOutput,
          success: true,
          timestamp: new Date(),
        });
      }

      return {
        ...result,
        filteredOutput,
        ttsText,
        duration_ms: Date.now() - startTime,
        action: intent.action,
        intent,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Execution failed",
        duration_ms: Date.now() - startTime,
        action: intent.action,
        intent,
      };
    }
  }

  /**
   * Build prompt from intent, optionally including conversation context
   */
  private buildPrompt(intent: VoiceIntent, options: ClaudeCodeOptions): string {
    let prompt = intent.command || intent.originalText || "";

    // If this looks like a follow-up command, inject context
    if (options.includeContext !== false && options.sessionId) {
      const isFollowUp = this.isFollowUpCommand(prompt);

      if (isFollowUp) {
        const context = this.conversationManager.getContextForPrompt(
          options.sessionId
        );
        if (context) {
          prompt = `${context}\n\nFollow-up request: ${prompt}`;
        }
      }
    }

    return prompt;
  }

  /**
   * Check if a command appears to be a follow-up
   */
  private isFollowUpCommand(text: string): boolean {
    const followUpPatterns = [
      /^now\s+/i,
      /^then\s+/i,
      /^also\s+/i,
      /^next\s+/i,
      /^and\s+/i,
      /^fix\s+it/i,
      /^do\s+(that|it)\s+again/i,
      /^commit\s+(that|those|it|the\s+changes)/i,
      /^push\s+(that|those|it)/i,
      /^undo\s+that/i,
      /^revert\s+that/i,
      /^what\s+(did|was)/i,
      /^why\s+did/i,
    ];

    return followUpPatterns.some((pattern) => pattern.test(text.trim()));
  }

  /**
   * Execute Claude Code CLI
   */
  private async executeClaudeCode(
    prompt: string,
    options: {
      cwd: string;
      timeout: number;
      model?: string;
    }
  ): Promise<{ success: boolean; output?: string; error?: string; exitCode?: number }> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      // Build claude command arguments
      const args = [
        "-p", // Print mode
        "--dangerously-skip-permissions", // Skip permission prompts for voice control
      ];

      // Add model if specified
      if (options.model) {
        args.push("--model", options.model);
      }

      // Add the prompt
      args.push(prompt);

      const child = spawn("claude", args, {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeout);

      // Collect stdout
      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          stdout += data.toString();
        });
      }

      // Collect stderr
      if (child.stderr) {
        child.stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
      }

      // Handle exit
      child.on("exit", (code, signal) => {
        clearTimeout(timeoutId);

        if (timedOut) {
          resolve({
            success: false,
            error: `Claude Code timed out after ${options.timeout}ms`,
            output: stdout,
            exitCode: code ?? -1,
          });
          return;
        }

        const success = code === 0;
        resolve({
          success,
          output: stdout || stderr,
          error: success ? undefined : stderr || `Exit code: ${code}`,
          exitCode: code ?? -1,
        });
      });

      // Handle error (command not found, etc.)
      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `Claude Code error: ${error.message}. Make sure Claude Code CLI is installed.`,
        });
      });
    });
  }

  /**
   * Execute with streaming output
   */
  executeStreaming(
    intent: VoiceIntent,
    options: ClaudeCodeOptions = {}
  ): { eventEmitter: EventEmitter; cancel: () => void } {
    const eventEmitter = new EventEmitter();
    const prompt = this.buildPrompt(intent, options);
    let child: ChildProcess | null = null;

    if (!prompt) {
      setTimeout(() => {
        eventEmitter.emit("error", {
          type: "error",
          data: "No prompt could be constructed",
          timestamp: new Date(),
        } as ClaudeCodeEvent);
      }, 0);
      return { eventEmitter, cancel: () => {} };
    }

    const cwd = options.cwd || this.defaultCwd;
    const timeout = options.timeout || this.defaultTimeout;

    // Build args
    const args = ["-p", "--dangerously-skip-permissions"];
    if (options.model) {
      args.push("--model", options.model);
    }
    args.push(prompt);

    child = spawn("claude", args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Emit start event
    eventEmitter.emit("start", {
      type: "start",
      data: prompt,
      timestamp: new Date(),
    } as ClaudeCodeEvent);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (child) {
        child.kill("SIGTERM");
        eventEmitter.emit("error", {
          type: "error",
          data: `Claude Code timed out after ${timeout}ms`,
          timestamp: new Date(),
        } as ClaudeCodeEvent);
      }
    }, timeout);

    let fullOutput = "";

    // Stream stdout
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        fullOutput += text;

        // Emit raw output
        eventEmitter.emit("stdout", {
          type: "stdout",
          data: text,
          timestamp: new Date(),
        } as ClaudeCodeEvent);

        // Emit filtered output for real-time TTS
        const filtered = this.outputFilter.filterChunk(text);
        if (filtered) {
          eventEmitter.emit("filtered_output", {
            type: "filtered_output",
            data: text,
            filteredForTTS: filtered,
            timestamp: new Date(),
          } as ClaudeCodeEvent);
        }
      });
    }

    // Stream stderr
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        eventEmitter.emit("stdout", {
          type: "stdout",
          data: text,
          timestamp: new Date(),
        } as ClaudeCodeEvent);
      });
    }

    // Handle exit
    child.on("exit", (code, signal) => {
      clearTimeout(timeoutId);

      // Generate final TTS summary
      const ttsText = this.outputFilter.generateTTSSummary(
        fullOutput,
        intent.originalText || ""
      );

      eventEmitter.emit("exit", {
        type: "exit",
        data: JSON.stringify({ code, signal }),
        filteredForTTS: ttsText,
        timestamp: new Date(),
      } as ClaudeCodeEvent);
    });

    // Handle error
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("error", {
        type: "error",
        data: error.message,
        timestamp: new Date(),
      } as ClaudeCodeEvent);
    });

    // Return cancel function
    const cancel = () => {
      clearTimeout(timeoutId);
      if (child) {
        child.kill("SIGTERM");
      }
    };

    return { eventEmitter, cancel };
  }

  /**
   * Check if Claude Code CLI is available
   */
  async checkAvailable(): Promise<{ available: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn("claude", ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            error: "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
          });
        }
      });

      child.on("error", () => {
        resolve({
          available: false,
          error: "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
        });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        child.kill();
        resolve({
          available: false,
          error: "Check timed out",
        });
      }, 5000);
    });
  }

  /**
   * Get the conversation manager for external access
   */
  getConversationManager(): ConversationStateManager {
    return this.conversationManager;
  }

  /**
   * Set default working directory
   */
  setDefaultCwd(cwd: string): void {
    this.defaultCwd = cwd;
  }

  /**
   * Set default timeout
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Set default model
   */
  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }
}

/**
 * Create a ClaudeCodeExecutor instance
 */
export function createClaudeCodeExecutor(
  options: Partial<ClaudeCodeOptions> = {}
): ClaudeCodeExecutor {
  return new ClaudeCodeExecutor(options);
}

// Export singleton instance
export const claudeCodeExecutor = new ClaudeCodeExecutor();
