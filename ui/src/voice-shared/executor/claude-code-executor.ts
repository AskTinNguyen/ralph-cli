/**
 * Simplified Claude Code Executor for Terminal STT
 *
 * Minimal version without Browser STT dependencies (filters, summarizers, context management).
 */

import { spawn } from "node:child_process";
import type { VoiceIntent, ExecutionResult } from "../types.js";

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
}

/**
 * Simplified Claude Code Executor class
 */
export class ClaudeCodeExecutor {
  private defaultCwd: string;
  private defaultTimeout: number;
  private defaultModel: string;

  constructor(options: Partial<ClaudeCodeOptions> = {}) {
    this.defaultCwd = options.cwd || process.cwd();
    this.defaultTimeout = options.timeout || 300000; // 5 minutes default
    this.defaultModel = options.model || "sonnet";
  }

  /**
   * Execute a Claude Code command
   */
  async execute(
    intent: VoiceIntent,
    options: ClaudeCodeOptions = {}
  ): Promise<ExecutionResult> {
    const prompt = intent.command || intent.originalText || "";

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

    try {
      const result = await this.executeClaudeCode(prompt, {
        cwd,
        timeout,
        model: options.model || this.defaultModel,
      });

      // Prepare text for TTS: use filtered output if available, otherwise full output
      const ttsText = result.output || "";

      return {
        ...result,
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
