/**
 * Terminal Executor
 *
 * Executes terminal commands via Open Interpreter or direct shell execution.
 * Provides safe command execution with output streaming.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type {
  VoiceIntent,
  ExecutionResult,
  InterpreterOptions,
} from "../types.js";

/**
 * Command execution event types
 */
export type ExecutionEventType =
  | "start"
  | "stdout"
  | "stderr"
  | "exit"
  | "error";

/**
 * Command execution event
 */
export interface ExecutionEvent {
  type: ExecutionEventType;
  data: string;
  timestamp: Date;
}

/**
 * Dangerous command patterns that require confirmation
 */
const DANGEROUS_PATTERNS = [
  /rm\s+-rf/i,
  /rm\s+-r/i,
  /rmdir/i,
  /del\s+\/[sq]/i, // Windows delete
  /format\s+/i,
  /mkfs/i,
  /dd\s+if=/i,
  />\s*\/dev\//i,
  /chmod\s+777/i,
  /curl.*\|\s*(ba)?sh/i, // Piping curl to shell
  /wget.*\|\s*(ba)?sh/i,
  /sudo\s+rm/i,
  /:\(\)\s*{\s*:\|:&\s*};:/i, // Fork bomb
];

/**
 * Commands that should never be executed
 */
const BLOCKED_PATTERNS = [
  /:\(\)\s*{\s*:\|:&\s*};:/i, // Fork bomb
  />\s*\/dev\/sda/i,
  /dd\s+.*of=\/dev\/sd/i,
  /mkfs.*\/dev\/sd[a-z]$/i,
];

/**
 * Terminal Executor class
 */
export class TerminalExecutor {
  private defaultCwd: string;
  private defaultTimeout: number;
  private useOpenInterpreter: boolean;

  constructor(options: Partial<InterpreterOptions> = {}) {
    this.defaultCwd = options.cwd || process.cwd();
    this.defaultTimeout = options.timeout || 60000; // 1 minute default
    this.useOpenInterpreter = false; // Start with direct shell, can enable later
  }

  /**
   * Execute a terminal command
   */
  async execute(
    intent: VoiceIntent,
    options: InterpreterOptions = {}
  ): Promise<ExecutionResult> {
    const command = intent.command;

    if (!command) {
      return {
        success: false,
        error: "No command provided",
        action: intent.action,
        intent,
      };
    }

    // Check for blocked commands
    if (this.isBlocked(command)) {
      return {
        success: false,
        error: "This command is blocked for safety reasons",
        action: intent.action,
        intent,
      };
    }

    // Check if command requires confirmation
    if (this.isDangerous(command) && !options.autoApprove) {
      return {
        success: false,
        error: "This command requires confirmation before execution",
        action: intent.action,
        intent,
      };
    }

    const startTime = Date.now();
    const cwd = options.cwd || this.defaultCwd;
    const timeout = options.timeout || this.defaultTimeout;

    try {
      if (this.useOpenInterpreter) {
        return await this.executeWithOpenInterpreter(command, intent, {
          cwd,
          timeout,
          env: options.env,
          stream: options.stream,
        });
      } else {
        return await this.executeWithShell(command, intent, {
          cwd,
          timeout,
          env: options.env,
        });
      }
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
   * Execute command with direct shell
   */
  private async executeWithShell(
    command: string,
    intent: VoiceIntent,
    options: {
      cwd: string;
      timeout: number;
      env?: Record<string, string>;
    }
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn("sh", ["-c", command], {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
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
        const duration_ms = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            error: `Command timed out after ${options.timeout}ms`,
            output: stdout,
            exitCode: code ?? -1,
            duration_ms,
            action: intent.action,
            intent,
          });
          return;
        }

        const success = code === 0;
        resolve({
          success,
          output: stdout || stderr,
          error: success ? undefined : stderr || `Exit code: ${code}`,
          exitCode: code ?? -1,
          duration_ms,
          action: intent.action,
          intent,
        });
      });

      // Handle error
      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: error.message,
          duration_ms: Date.now() - startTime,
          action: intent.action,
          intent,
        });
      });
    });
  }

  /**
   * Execute command with Open Interpreter
   */
  private async executeWithOpenInterpreter(
    command: string,
    intent: VoiceIntent,
    options: {
      cwd: string;
      timeout: number;
      env?: Record<string, string>;
      stream?: boolean;
    }
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let output = "";
      let timedOut = false;

      // Use Open Interpreter CLI with auto-run flag
      const args = [
        "-m",
        "interpreter",
        "--auto_run",
        "-y", // Auto-approve
        "-e", // Execute directly
        command,
      ];

      const child = spawn("python3", args, {
        cwd: options.cwd,
        env: { ...process.env, ...options.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeout);

      // Collect output
      if (child.stdout) {
        child.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });
      }

      if (child.stderr) {
        child.stderr.on("data", (data: Buffer) => {
          output += data.toString();
        });
      }

      // Handle exit
      child.on("exit", (code) => {
        clearTimeout(timeoutId);
        const duration_ms = Date.now() - startTime;

        if (timedOut) {
          resolve({
            success: false,
            error: `Command timed out after ${options.timeout}ms`,
            output,
            exitCode: code ?? -1,
            duration_ms,
            action: intent.action,
            intent,
          });
          return;
        }

        resolve({
          success: code === 0,
          output,
          exitCode: code ?? -1,
          duration_ms,
          action: intent.action,
          intent,
        });
      });

      // Handle error
      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `Open Interpreter error: ${error.message}`,
          duration_ms: Date.now() - startTime,
          action: intent.action,
          intent,
        });
      });
    });
  }

  /**
   * Execute command with streaming output
   */
  executeStreaming(
    intent: VoiceIntent,
    options: InterpreterOptions = {}
  ): { eventEmitter: EventEmitter; cancel: () => void } {
    const eventEmitter = new EventEmitter();
    const command = intent.command;
    let child: ChildProcess | null = null;

    if (!command) {
      setTimeout(() => {
        eventEmitter.emit("error", {
          type: "error",
          data: "No command provided",
          timestamp: new Date(),
        });
      }, 0);
      return { eventEmitter, cancel: () => {} };
    }

    const cwd = options.cwd || this.defaultCwd;
    const timeout = options.timeout || this.defaultTimeout;

    child = spawn("sh", ["-c", command], {
      cwd,
      env: { ...process.env, ...options.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Emit start event
    eventEmitter.emit("start", {
      type: "start",
      data: command,
      timestamp: new Date(),
    } as ExecutionEvent);

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (child) {
        child.kill("SIGTERM");
        eventEmitter.emit("error", {
          type: "error",
          data: `Command timed out after ${timeout}ms`,
          timestamp: new Date(),
        } as ExecutionEvent);
      }
    }, timeout);

    // Stream stdout
    if (child.stdout) {
      child.stdout.on("data", (data: Buffer) => {
        eventEmitter.emit("stdout", {
          type: "stdout",
          data: data.toString(),
          timestamp: new Date(),
        } as ExecutionEvent);
      });
    }

    // Stream stderr
    if (child.stderr) {
      child.stderr.on("data", (data: Buffer) => {
        eventEmitter.emit("stderr", {
          type: "stderr",
          data: data.toString(),
          timestamp: new Date(),
        } as ExecutionEvent);
      });
    }

    // Handle exit
    child.on("exit", (code, signal) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("exit", {
        type: "exit",
        data: JSON.stringify({ code, signal }),
        timestamp: new Date(),
      } as ExecutionEvent);
    });

    // Handle error
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("error", {
        type: "error",
        data: error.message,
        timestamp: new Date(),
      } as ExecutionEvent);
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
   * Check if a command is blocked
   */
  isBlocked(command: string): boolean {
    return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
  }

  /**
   * Check if a command is dangerous and requires confirmation
   */
  isDangerous(command: string): boolean {
    return DANGEROUS_PATTERNS.some((pattern) => pattern.test(command));
  }

  /**
   * Enable or disable Open Interpreter
   */
  setUseOpenInterpreter(enabled: boolean): void {
    this.useOpenInterpreter = enabled;
  }

  /**
   * Check if Open Interpreter is available
   */
  async checkOpenInterpreter(): Promise<{
    available: boolean;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const child = spawn("python3", ["-c", "import interpreter; print('ok')"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0 && output.includes("ok")) {
          resolve({ available: true });
        } else {
          resolve({
            available: false,
            error: "Open Interpreter not installed. Run: pip install open-interpreter",
          });
        }
      });

      child.on("error", () => {
        resolve({
          available: false,
          error: "Python3 not found or Open Interpreter not installed",
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
}

/**
 * Create a TerminalExecutor instance
 */
export function createTerminalExecutor(
  options: Partial<InterpreterOptions> = {}
): TerminalExecutor {
  return new TerminalExecutor(options);
}

// Export singleton instance
export const terminalExecutor = new TerminalExecutor();
