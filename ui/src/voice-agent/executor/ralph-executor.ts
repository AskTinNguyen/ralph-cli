/**
 * Ralph Executor
 *
 * Executes Ralph CLI commands for PRD creation, planning, and building.
 * Provides safe execution with validation and streaming output.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import type { VoiceIntent, ExecutionResult } from "../types.js";

/**
 * Ralph command types
 */
export type RalphCommand =
  | "prd"
  | "plan"
  | "build"
  | "stream"
  | "factory"
  | "init"
  | "install"
  | "error"
  | "help";

/**
 * Ralph execution options
 */
export interface RalphExecutorOptions {
  /** Working directory for Ralph commands */
  cwd?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** PRD number to operate on */
  prdNumber?: number;
  /** Number of build iterations */
  iterations?: number;
  /** Use headless mode (required for server/UI execution) */
  headless?: boolean;
  /** Additional CLI flags */
  flags?: string[];
}

/**
 * Ralph execution event
 */
export interface RalphExecutionEvent {
  type: "start" | "stdout" | "stderr" | "exit" | "error";
  command?: RalphCommand;
  data?: string;
  exitCode?: number;
  timestamp: Date;
}

/**
 * Valid Ralph commands with their descriptions
 */
const RALPH_COMMANDS: Record<RalphCommand, { description: string; requiresPrd?: boolean }> = {
  prd: { description: "Generate a PRD document" },
  plan: { description: "Create implementation plan from PRD", requiresPrd: true },
  build: { description: "Execute build iterations", requiresPrd: true },
  stream: { description: "Parallel stream operations" },
  factory: { description: "Factory mode meta-orchestration" },
  init: { description: "Initialize Ralph in a project" },
  install: { description: "Install Ralph to a project" },
  error: { description: "Look up error codes" },
  help: { description: "Show help information" },
};

/**
 * Commands that modify the project (require caution)
 */
const MODIFYING_COMMANDS: RalphCommand[] = ["prd", "plan", "build", "init", "install"];

/**
 * Ralph Executor class
 */
export class RalphExecutor {
  private defaultCwd: string;
  private defaultTimeout: number;
  private ralphPath: string;

  constructor(options: Partial<RalphExecutorOptions> = {}) {
    this.defaultCwd = options.cwd || process.cwd();
    this.defaultTimeout = options.timeout || 300000; // 5 minute default for builds
    this.ralphPath = "ralph"; // Assumes ralph is in PATH
  }

  /**
   * Execute a Ralph command
   */
  async execute(
    intent: VoiceIntent,
    options: RalphExecutorOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    // Parse Ralph command from intent
    const parsed = this.parseIntent(intent);

    if (!parsed.command) {
      return {
        success: false,
        error: "Could not determine Ralph command from intent",
        action: intent.action,
        intent,
        duration_ms: Date.now() - startTime,
      };
    }

    // Validate command
    if (!RALPH_COMMANDS[parsed.command]) {
      return {
        success: false,
        error: `Unknown Ralph command: ${parsed.command}`,
        action: intent.action,
        intent,
        duration_ms: Date.now() - startTime,
      };
    }

    // Build CLI arguments
    const args = this.buildArgs(parsed.command, {
      ...options,
      ...parsed.options,
    });

    const cwd = options.cwd || this.defaultCwd;
    const timeout = options.timeout || this.defaultTimeout;

    return this.executeCommand(args, intent, { cwd, timeout, startTime });
  }

  /**
   * Parse intent into Ralph command and options
   */
  private parseIntent(intent: VoiceIntent): {
    command?: RalphCommand;
    options: Partial<RalphExecutorOptions>;
  } {
    const text = (intent.command || intent.originalText || "").toLowerCase();
    const options: Partial<RalphExecutorOptions> = {};

    // Extract PRD number if mentioned
    const prdMatch = text.match(/prd[- ]?(\d+)/i);
    if (prdMatch) {
      options.prdNumber = parseInt(prdMatch[1], 10);
    }

    // Extract iteration count for build
    const iterMatch = text.match(/(\d+)\s*(iterations?|times?)/i);
    if (iterMatch) {
      options.iterations = parseInt(iterMatch[1], 10);
    }

    // Also check for "build N" pattern
    const buildMatch = text.match(/build\s+(\d+)/i);
    if (buildMatch && !options.iterations) {
      options.iterations = parseInt(buildMatch[1], 10);
    }

    // Determine command
    let command: RalphCommand | undefined;

    if (text.includes("prd") && (text.includes("create") || text.includes("generate") || text.includes("write"))) {
      command = "prd";
    } else if (text.includes("plan") || text.includes("planning")) {
      command = "plan";
    } else if (text.includes("build") || text.includes("execute") || text.includes("run iteration")) {
      command = "build";
    } else if (text.includes("stream")) {
      command = "stream";
    } else if (text.includes("factory")) {
      command = "factory";
    } else if (text.includes("init")) {
      command = "init";
    } else if (text.includes("install")) {
      command = "install";
    } else if (text.includes("error")) {
      command = "error";
    } else if (text.includes("help")) {
      command = "help";
    }

    // Check parameters
    if (intent.parameters?.command) {
      const paramCmd = intent.parameters.command.toLowerCase() as RalphCommand;
      if (RALPH_COMMANDS[paramCmd]) {
        command = paramCmd;
      }
    }

    return { command, options };
  }

  /**
   * Build CLI arguments for Ralph command
   */
  private buildArgs(command: RalphCommand, options: RalphExecutorOptions): string[] {
    const args: string[] = [command];

    switch (command) {
      case "prd":
        // PRD generation - always use headless for server execution
        if (options.headless !== false) {
          args.push("--headless");
        }
        break;

      case "plan":
        // Plan creation
        if (options.prdNumber) {
          args.push(`--prd=${options.prdNumber}`);
        }
        break;

      case "build":
        // Build iterations
        if (options.iterations) {
          args.push(options.iterations.toString());
        } else {
          args.push("1"); // Default to 1 iteration
        }
        if (options.prdNumber) {
          args.push(`--prd=${options.prdNumber}`);
        }
        break;

      case "stream":
        // Stream commands need subcommand
        if (options.flags && options.flags.length > 0) {
          args.push(...options.flags);
        } else {
          args.push("status"); // Default to status
        }
        break;

      case "factory":
        // Factory commands need subcommand
        if (options.flags && options.flags.length > 0) {
          args.push(...options.flags);
        } else {
          args.push("list"); // Default to list
        }
        break;

      case "error":
        // Error lookup
        if (options.flags && options.flags.length > 0) {
          args.push(...options.flags);
        }
        break;
    }

    // Add any additional flags
    if (options.flags) {
      for (const flag of options.flags) {
        if (!args.includes(flag)) {
          args.push(flag);
        }
      }
    }

    return args;
  }

  /**
   * Execute Ralph CLI command
   */
  private async executeCommand(
    args: string[],
    intent: VoiceIntent,
    options: { cwd: string; timeout: number; startTime: number }
  ): Promise<ExecutionResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawn(this.ralphPath, args, {
        cwd: options.cwd,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
      });

      // For headless mode, close stdin immediately
      child.stdin?.end();

      // Set up timeout
      const timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeout);

      // Collect stdout
      child.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      // Collect stderr
      child.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      // Handle exit
      child.on("exit", (code) => {
        clearTimeout(timeoutId);
        const duration_ms = Date.now() - options.startTime;

        if (timedOut) {
          resolve({
            success: false,
            error: `Ralph command timed out after ${options.timeout}ms`,
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
          output: stdout || "Command completed",
          error: success ? undefined : stderr || `Exit code: ${code}`,
          exitCode: code ?? -1,
          duration_ms,
          action: intent.action,
          intent,
        });
      });

      // Handle spawn error
      child.on("error", (error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: `Failed to execute ralph: ${error.message}`,
          duration_ms: Date.now() - options.startTime,
          action: intent.action,
          intent,
        });
      });
    });
  }

  /**
   * Execute with streaming output
   */
  executeStreaming(
    intent: VoiceIntent,
    options: RalphExecutorOptions = {}
  ): { eventEmitter: EventEmitter; cancel: () => void } {
    const eventEmitter = new EventEmitter();
    let child: ChildProcess | null = null;

    // Parse intent
    const parsed = this.parseIntent(intent);

    if (!parsed.command) {
      setTimeout(() => {
        eventEmitter.emit("error", {
          type: "error",
          data: "Could not determine Ralph command",
          timestamp: new Date(),
        } as RalphExecutionEvent);
      }, 0);
      return { eventEmitter, cancel: () => {} };
    }

    const args = this.buildArgs(parsed.command, {
      ...options,
      ...parsed.options,
      headless: true, // Always headless for streaming
    });

    const cwd = options.cwd || this.defaultCwd;
    const timeout = options.timeout || this.defaultTimeout;

    // Emit start
    eventEmitter.emit("start", {
      type: "start",
      command: parsed.command,
      data: `ralph ${args.join(" ")}`,
      timestamp: new Date(),
    } as RalphExecutionEvent);

    child = spawn(this.ralphPath, args, {
      cwd,
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Close stdin for headless
    child.stdin?.end();

    // Set up timeout
    const timeoutId = setTimeout(() => {
      if (child) {
        child.kill("SIGTERM");
        eventEmitter.emit("error", {
          type: "error",
          command: parsed.command,
          data: `Command timed out after ${timeout}ms`,
          timestamp: new Date(),
        } as RalphExecutionEvent);
      }
    }, timeout);

    // Stream stdout
    child.stdout?.on("data", (data: Buffer) => {
      eventEmitter.emit("stdout", {
        type: "stdout",
        command: parsed.command,
        data: data.toString(),
        timestamp: new Date(),
      } as RalphExecutionEvent);
    });

    // Stream stderr
    child.stderr?.on("data", (data: Buffer) => {
      eventEmitter.emit("stderr", {
        type: "stderr",
        command: parsed.command,
        data: data.toString(),
        timestamp: new Date(),
      } as RalphExecutionEvent);
    });

    // Handle exit
    child.on("exit", (code) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("exit", {
        type: "exit",
        command: parsed.command,
        exitCode: code ?? -1,
        timestamp: new Date(),
      } as RalphExecutionEvent);
    });

    // Handle error
    child.on("error", (error) => {
      clearTimeout(timeoutId);
      eventEmitter.emit("error", {
        type: "error",
        command: parsed.command,
        data: error.message,
        timestamp: new Date(),
      } as RalphExecutionEvent);
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
   * Check if a command modifies the project
   */
  isModifyingCommand(command: RalphCommand): boolean {
    return MODIFYING_COMMANDS.includes(command);
  }

  /**
   * Get command description
   */
  getCommandDescription(command: RalphCommand): string {
    return RALPH_COMMANDS[command]?.description || "Unknown command";
  }

  /**
   * Check if command requires PRD
   */
  requiresPrd(command: RalphCommand): boolean {
    return RALPH_COMMANDS[command]?.requiresPrd || false;
  }

  /**
   * Check if Ralph CLI is available
   */
  async checkAvailable(): Promise<{ available: boolean; version?: string; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.ralphPath, ["--version"], {
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0) {
          const version = output.trim() || "unknown";
          resolve({ available: true, version });
        } else {
          resolve({
            available: false,
            error: "Ralph CLI not found. Run: npm install -g ralph-cli",
          });
        }
      });

      child.on("error", () => {
        resolve({
          available: false,
          error: "Ralph CLI not found. Run: npm install -g ralph-cli",
        });
      });

      // Timeout
      setTimeout(() => {
        child.kill();
        resolve({ available: false, error: "Check timed out" });
      }, 5000);
    });
  }

  /**
   * Get list of available PRDs
   */
  async listPrds(): Promise<{ prds: number[]; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(this.ralphPath, ["stream", "list"], {
        cwd: this.defaultCwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let output = "";

      child.stdout?.on("data", (data: Buffer) => {
        output += data.toString();
      });

      child.on("exit", (code) => {
        if (code === 0) {
          // Parse PRD numbers from output
          const prdMatches = output.match(/PRD-(\d+)/g) || [];
          const prds = prdMatches
            .map((m) => parseInt(m.replace("PRD-", ""), 10))
            .sort((a, b) => a - b);
          resolve({ prds });
        } else {
          resolve({ prds: [], error: "Failed to list PRDs" });
        }
      });

      child.on("error", (error) => {
        resolve({ prds: [], error: error.message });
      });

      setTimeout(() => {
        child.kill();
        resolve({ prds: [], error: "List timed out" });
      }, 10000);
    });
  }

  /**
   * Set Ralph CLI path
   */
  setRalphPath(path: string): void {
    this.ralphPath = path;
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
 * Create a RalphExecutor instance
 */
export function createRalphExecutor(
  options: Partial<RalphExecutorOptions> = {}
): RalphExecutor {
  return new RalphExecutor(options);
}

// Export singleton instance
export const ralphExecutor = new RalphExecutor();
