/**
 * Process Manager Service
 *
 * Manages the Ralph CLI build process lifecycle.
 * Spawns, tracks, and terminates build processes.
 * Uses EventEmitter pattern for streaming output.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { BuildOptions, BuildStatus } from '../types.js';
import { getRalphRoot } from './state-reader.js';

/**
 * Event types emitted by the process manager
 */
export type ProcessManagerEventType = 'output' | 'exit' | 'error';

/**
 * Output event data
 */
export interface OutputEvent {
  type: 'stdout' | 'stderr';
  data: string;
  timestamp: Date;
}

/**
 * Exit event data
 */
export interface ExitEvent {
  code: number | null;
  signal: NodeJS.Signals | null;
  timestamp: Date;
}

/**
 * Error event data
 */
export interface ErrorEvent {
  message: string;
  error?: Error;
  timestamp: Date;
}

/**
 * Internal process state
 */
interface ProcessState {
  process: ChildProcess;
  pid: number;
  startedAt: Date;
  command: string;
  options: BuildOptions;
}

/**
 * Process Manager service singleton
 */
class ProcessManager extends EventEmitter {
  private currentProcess: ProcessState | null = null;
  private lastExitCode: number | null = null;
  private lastError: string | null = null;

  /**
   * Start a build process with the given options
   * @param iterations Number of build iterations to run
   * @param options Build configuration options
   * @returns BuildStatus with current state, or error if already running
   */
  startBuild(iterations: number, options: Partial<BuildOptions> = {}): BuildStatus {
    // Check if a build is already running
    if (this.currentProcess !== null) {
      return {
        state: 'running',
        pid: this.currentProcess.pid,
        startedAt: this.currentProcess.startedAt,
        command: this.currentProcess.command,
        options: this.currentProcess.options,
        error: 'A build is already running. Stop it first before starting a new one.',
      };
    }

    // Find the ralph root to determine the project directory
    const ralphRoot = getRalphRoot();
    if (!ralphRoot) {
      return {
        state: 'error',
        error: 'Cannot start build: .ralph directory not found. Run "ralph install" first.',
      };
    }

    // Project root is the parent of .ralph
    const projectRoot = path.dirname(ralphRoot);

    // Build the command arguments
    const args = ['build', String(iterations)];

    // Add optional flags
    if (options.stream) {
      args.push(`--prd=${options.stream}`);
    }

    if (options.agent) {
      args.push(`--agent=${options.agent}`);
    }

    if (options.noCommit) {
      args.push('--no-commit');
    }

    const fullOptions: BuildOptions = {
      iterations,
      stream: options.stream,
      agent: options.agent,
      noCommit: options.noCommit,
    };

    const command = `ralph ${args.join(' ')}`;

    try {
      // Spawn the ralph process
      const childProcess = spawn('ralph', args, {
        cwd: projectRoot,
        env: { ...process.env },
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      if (!childProcess.pid) {
        return {
          state: 'error',
          error: 'Failed to start build process: no PID assigned',
        };
      }

      // Store process state
      this.currentProcess = {
        process: childProcess,
        pid: childProcess.pid,
        startedAt: new Date(),
        command,
        options: fullOptions,
      };

      // Clear previous state
      this.lastExitCode = null;
      this.lastError = null;

      // Set up stdout handler
      if (childProcess.stdout) {
        childProcess.stdout.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              const event: OutputEvent = {
                type: 'stdout',
                data: line,
                timestamp: new Date(),
              };
              this.emit('output', event);
            }
          }
        });
      }

      // Set up stderr handler
      if (childProcess.stderr) {
        childProcess.stderr.on('data', (data: Buffer) => {
          const lines = data.toString().split('\n');
          for (const line of lines) {
            if (line.trim()) {
              const event: OutputEvent = {
                type: 'stderr',
                data: line,
                timestamp: new Date(),
              };
              this.emit('output', event);
            }
          }
        });
      }

      // Set up exit handler
      childProcess.on('exit', (code, signal) => {
        this.lastExitCode = code;
        this.currentProcess = null;

        const event: ExitEvent = {
          code,
          signal,
          timestamp: new Date(),
        };
        this.emit('exit', event);
      });

      // Set up error handler
      childProcess.on('error', (error: Error) => {
        this.lastError = error.message;
        this.currentProcess = null;

        const event: ErrorEvent = {
          message: error.message,
          error,
          timestamp: new Date(),
        };
        this.emit('error', event);
      });

      console.log(`[ProcessManager] Started build: ${command} (PID: ${childProcess.pid})`);

      return {
        state: 'running',
        pid: childProcess.pid,
        startedAt: this.currentProcess.startedAt,
        command,
        options: fullOptions,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = errorMessage;

      return {
        state: 'error',
        error: `Failed to start build: ${errorMessage}`,
      };
    }
  }

  /**
   * Stop the currently running build process
   * @returns BuildStatus with result of the stop operation
   */
  stopBuild(): BuildStatus {
    if (this.currentProcess === null) {
      return {
        state: 'idle',
        error: 'No build is currently running',
      };
    }

    const { pid, command, options, startedAt } = this.currentProcess;

    try {
      // Send SIGTERM for graceful termination
      this.currentProcess.process.kill('SIGTERM');

      console.log(`[ProcessManager] Sent SIGTERM to build process (PID: ${pid})`);

      // Note: The process state will be cleared in the 'exit' handler
      // We return a transitional state here
      return {
        state: 'running',
        pid,
        startedAt,
        command,
        options,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        state: 'error',
        pid,
        startedAt,
        command,
        options,
        error: `Failed to stop build: ${errorMessage}`,
      };
    }
  }

  /**
   * Force kill the currently running build process
   * @returns BuildStatus with result of the kill operation
   */
  killBuild(): BuildStatus {
    if (this.currentProcess === null) {
      return {
        state: 'idle',
        error: 'No build is currently running',
      };
    }

    const { pid, command, options, startedAt } = this.currentProcess;

    try {
      // Send SIGKILL for immediate termination
      this.currentProcess.process.kill('SIGKILL');

      console.log(`[ProcessManager] Sent SIGKILL to build process (PID: ${pid})`);

      return {
        state: 'running',
        pid,
        startedAt,
        command,
        options,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      return {
        state: 'error',
        pid,
        startedAt,
        command,
        options,
        error: `Failed to kill build: ${errorMessage}`,
      };
    }
  }

  /**
   * Get the current build status
   * @returns Current BuildStatus
   */
  getBuildStatus(): BuildStatus {
    if (this.currentProcess !== null) {
      return {
        state: 'running',
        pid: this.currentProcess.pid,
        startedAt: this.currentProcess.startedAt,
        command: this.currentProcess.command,
        options: this.currentProcess.options,
      };
    }

    // No process running, check last known state
    if (this.lastError !== null) {
      return {
        state: 'error',
        error: this.lastError,
      };
    }

    if (this.lastExitCode !== null) {
      return {
        state: this.lastExitCode === 0 ? 'completed' : 'error',
        error: this.lastExitCode !== 0 ? `Process exited with code ${this.lastExitCode}` : undefined,
      };
    }

    return {
      state: 'idle',
    };
  }

  /**
   * Check if a build is currently running
   * @returns true if a build is running
   */
  isRunning(): boolean {
    return this.currentProcess !== null;
  }

  /**
   * Get the PID of the running process
   * @returns PID or null if no process is running
   */
  getPid(): number | null {
    return this.currentProcess?.pid ?? null;
  }

  /**
   * Reset the last known state (useful after acknowledging errors)
   */
  resetState(): void {
    this.lastExitCode = null;
    this.lastError = null;
  }
}

// Export singleton instance
export const processManager = new ProcessManager();

// Export class for testing
export { ProcessManager };
