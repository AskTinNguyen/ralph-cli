/**
 * Wizard Process Manager Service
 *
 * Manages the Ralph CLI PRD and plan generation processes for the wizard.
 * Tracks multiple concurrent generation processes (one per stream).
 * Uses EventEmitter pattern for streaming output.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { EventEmitter } from "node:events";
import { getRalphRoot } from "./state-reader.js";

/**
 * Generation phase information
 */
export type GenerationPhase =
  | "starting"
  | "analyzing"
  | "generating"
  | "writing"
  | "complete"
  | "error";

/**
 * Generation status for a stream
 */
export interface GenerationStatus {
  status: "idle" | "generating" | "complete" | "error";
  phase?: GenerationPhase;
  progress?: number;
  error?: string;
  type?: "prd" | "plan";
  startedAt?: Date;
  output: string[];
}

/**
 * Output event data for SSE streaming
 */
export interface WizardOutputEvent {
  type: "phase" | "output" | "complete" | "error";
  streamId: string;
  data: {
    phase?: GenerationPhase;
    progress?: number;
    text?: string;
    success?: boolean;
    message?: string;
  };
  timestamp: Date;
}

/**
 * Internal process state for a generation
 */
interface GenerationProcess {
  process: ChildProcess;
  pid: number;
  streamId: string;
  type: "prd" | "plan";
  startedAt: Date;
  phase: GenerationPhase;
  progress: number;
  output: string[];
  eventEmitter: EventEmitter;
}

/**
 * Wizard Process Manager service singleton
 * Manages PRD and plan generation processes for multiple streams
 */
class WizardProcessManager {
  private processes: Map<string, GenerationProcess> = new Map();
  private completedStatuses: Map<string, GenerationStatus> = new Map();

  /**
   * Get a unique key for a stream's generation process
   */
  private getKey(streamId: string): string {
    return `stream-${streamId}`;
  }

  /**
   * Start PRD generation for a stream
   * @param description The feature description to generate PRD for (required)
   * @returns Initial generation status with eventEmitter for streaming and process PID
   *
   * Note: ralph prd auto-creates a new PRD-N folder. The created PRD ID
   * will be emitted via the 'prd-created' event on the eventEmitter.
   */
  startPrdGeneration(
    description: string
  ): { success: boolean; status: GenerationStatus; eventEmitter?: EventEmitter; pid?: number } {
    // Use a temporary key for new PRD generation (will be updated once we know the ID)
    const tempKey = `new-prd-${Date.now()}`;

    const ralphRoot = getRalphRoot();
    if (!ralphRoot) {
      return {
        success: false,
        status: {
          status: "error",
          error: '.ralph directory not found. Run "ralph install" first.',
          output: [],
        },
      };
    }

    if (!description || description.trim().length < 20) {
      return {
        success: false,
        status: {
          status: "error",
          error: "Description must be at least 20 characters",
          output: [],
        },
      };
    }

    const projectRoot = path.dirname(ralphRoot);

    // Build command arguments for ralph prd - pass description as argument
    // ralph prd expects: ralph prd "Your feature description"
    // Use --headless flag for non-interactive (piped) mode - required for server/UI use
    // Use --model=opus to use Claude Opus for PRD generation
    const args = ["prd", "--headless", "--model=opus", description];

    try {
      // Spawn the ralph prd process
      // IMPORTANT: stdin must be "ignore" - Claude will hang waiting for input if stdin is piped
      const childProcess = spawn("ralph", args, {
        cwd: projectRoot,
        env: { ...process.env },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (!childProcess.pid) {
        return {
          success: false,
          status: {
            status: "error",
            error: "Failed to start PRD generation: no PID assigned",
            output: [],
          },
        };
      }

      const eventEmitter = new EventEmitter();

      // Store process state with temporary key (will update streamId when we parse output)
      const processState: GenerationProcess = {
        process: childProcess,
        pid: childProcess.pid,
        streamId: "pending", // Will be updated when we parse "Creating new PRD folder: PRD-N"
        type: "prd",
        startedAt: new Date(),
        phase: "starting",
        progress: 0,
        output: [],
        eventEmitter,
      };

      this.processes.set(tempKey, processState);

      // Set up output handlers with PRD ID detection
      this.setupPrdOutputHandlers(childProcess, processState, tempKey, eventEmitter);

      console.log(
        `[WizardProcessManager] Started PRD generation (PID: ${childProcess.pid})`
      );

      return {
        success: true,
        status: {
          status: "generating",
          type: "prd",
          phase: "starting",
          progress: 0,
          startedAt: processState.startedAt,
          output: [],
        },
        eventEmitter,
        pid: childProcess.pid,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        status: {
          status: "error",
          error: `Failed to start PRD generation: ${errorMessage}`,
          output: [],
        },
      };
    }
  }

  /**
   * Start plan generation for a stream
   * @param streamId The stream ID (e.g., "1" for PRD-1)
   * @returns Initial generation status
   */
  startPlanGeneration(
    streamId: string
  ): { success: boolean; status: GenerationStatus; eventEmitter?: EventEmitter } {
    const key = this.getKey(streamId);

    // Check if already generating
    if (this.processes.has(key)) {
      const existing = this.processes.get(key)!;
      return {
        success: false,
        status: {
          status: "generating",
          type: existing.type,
          phase: existing.phase,
          progress: existing.progress,
          startedAt: existing.startedAt,
          output: existing.output,
          error: "Generation already in progress for this stream",
        },
      };
    }

    const ralphRoot = getRalphRoot();
    if (!ralphRoot) {
      return {
        success: false,
        status: {
          status: "error",
          error: '.ralph directory not found. Run "ralph install" first.',
          output: [],
        },
      };
    }

    const projectRoot = path.dirname(ralphRoot);

    // Build command arguments for ralph plan
    const args = ["plan", `--prd=${streamId}`];

    try {
      // Spawn the ralph plan process with headless mode
      const childProcess = spawn("ralph", args, {
        cwd: projectRoot,
        env: {
          ...process.env,
          RALPH_HEADLESS: "1",  // Enable headless mode for non-interactive execution
          CI: "true",           // Signal non-interactive environment
        },
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (!childProcess.pid) {
        return {
          success: false,
          status: {
            status: "error",
            error: "Failed to start plan generation: no PID assigned",
            output: [],
          },
        };
      }

      const eventEmitter = new EventEmitter();

      // Store process state
      const processState: GenerationProcess = {
        process: childProcess,
        pid: childProcess.pid,
        streamId,
        type: "plan",
        startedAt: new Date(),
        phase: "starting",
        progress: 0,
        output: [],
        eventEmitter,
      };

      this.processes.set(key, processState);

      // Clear any previous completed status
      this.completedStatuses.delete(key);

      // Set up output handlers
      this.setupOutputHandlers(childProcess, processState, key, eventEmitter);

      console.log(
        `[WizardProcessManager] Started plan generation for stream ${streamId} (PID: ${childProcess.pid})`
      );
      console.log(
        `[WizardProcessManager] Command: ralph plan --prd=${streamId}`
      );
      console.log(
        `[WizardProcessManager] Working directory: ${projectRoot}`
      );

      return {
        success: true,
        status: {
          status: "generating",
          type: "plan",
          phase: "starting",
          progress: 0,
          startedAt: processState.startedAt,
          output: [],
        },
        eventEmitter,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        status: {
          status: "error",
          error: `Failed to start plan generation: ${errorMessage}`,
          output: [],
        },
      };
    }
  }

  /**
   * Set up stdout/stderr handlers for a process
   */
  private setupOutputHandlers(
    childProcess: ChildProcess,
    processState: GenerationProcess,
    key: string,
    eventEmitter: EventEmitter
  ): void {
    console.log(`[WizardProcessManager] Setting up output handlers for ${processState.streamId} (${processState.type})`);

    // Handle stdout
    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        console.log(`[WizardProcessManager] STDOUT (${processState.streamId}): ${text.substring(0, 300).replace(/\n/g, '\\n')}`);
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          processState.output.push(line);

          // Parse phase/progress from output
          const phaseInfo = this.parseOutputForPhase(line);
          if (phaseInfo.phase) {
            processState.phase = phaseInfo.phase;
          }
          if (phaseInfo.progress !== undefined) {
            processState.progress = phaseInfo.progress;
          }

          // Emit output event
          const event: WizardOutputEvent = {
            type: "output",
            streamId: processState.streamId,
            data: { text: line },
            timestamp: new Date(),
          };
          eventEmitter.emit("output", event);

          // Emit phase update if changed
          if (phaseInfo.phase) {
            const phaseEvent: WizardOutputEvent = {
              type: "phase",
              streamId: processState.streamId,
              data: {
                phase: phaseInfo.phase,
                progress: phaseInfo.progress ?? processState.progress,
              },
              timestamp: new Date(),
            };
            eventEmitter.emit("phase", phaseEvent);
          }
        }
      });
    }

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          processState.output.push(`[stderr] ${line}`);

          const event: WizardOutputEvent = {
            type: "output",
            streamId: processState.streamId,
            data: { text: `[stderr] ${line}` },
            timestamp: new Date(),
          };
          eventEmitter.emit("output", event);
        }
      });
    }

    // Handle exit
    childProcess.on("exit", (code, signal) => {
      const success = code === 0;

      // Store completed status
      const completedStatus: GenerationStatus = {
        status: success ? "complete" : "error",
        type: processState.type,
        phase: success ? "complete" : "error",
        progress: success ? 100 : processState.progress,
        startedAt: processState.startedAt,
        output: processState.output,
        error: success ? undefined : `Process exited with code ${code}`,
      };
      this.completedStatuses.set(key, completedStatus);

      // Emit complete/error event
      const event: WizardOutputEvent = {
        type: success ? "complete" : "error",
        streamId: processState.streamId,
        data: {
          success,
          message: success
            ? `${processState.type.toUpperCase()} generation completed`
            : `${processState.type.toUpperCase()} generation failed with code ${code}`,
        },
        timestamp: new Date(),
      };
      eventEmitter.emit(success ? "complete" : "error", event);

      // Clean up
      this.processes.delete(key);

      console.log(
        `[WizardProcessManager] ${processState.type.toUpperCase()} generation for stream ${processState.streamId} ${success ? "completed" : "failed"} (code: ${code})`
      );
    });

    // Handle error
    childProcess.on("error", (error: Error) => {
      const errorStatus: GenerationStatus = {
        status: "error",
        type: processState.type,
        phase: "error",
        progress: processState.progress,
        startedAt: processState.startedAt,
        output: processState.output,
        error: error.message,
      };
      this.completedStatuses.set(key, errorStatus);

      const event: WizardOutputEvent = {
        type: "error",
        streamId: processState.streamId,
        data: { message: error.message },
        timestamp: new Date(),
      };
      eventEmitter.emit("error", event);

      this.processes.delete(key);

      console.log(
        `[WizardProcessManager] ${processState.type.toUpperCase()} generation for stream ${processState.streamId} errored: ${error.message}`
      );
    });
  }

  /**
   * Set up stdout/stderr handlers for PRD generation process
   * Includes detection of created PRD ID from output
   */
  private setupPrdOutputHandlers(
    childProcess: ChildProcess,
    processState: GenerationProcess,
    tempKey: string,
    eventEmitter: EventEmitter
  ): void {
    let detectedStreamId: string | null = null;

    // Handle stdout
    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          processState.output.push(line);

          // Detect PRD folder creation: "Creating new PRD folder: PRD-N"
          const prdMatch = line.match(/Creating new PRD folder:\s*PRD-(\d+)/i);
          if (prdMatch && !detectedStreamId) {
            detectedStreamId = prdMatch[1];
            processState.streamId = detectedStreamId;

            // Re-register with proper key
            const properKey = this.getKey(detectedStreamId);
            this.processes.set(properKey, processState);
            this.processes.delete(tempKey);

            console.log(
              `[WizardProcessManager] Detected PRD-${detectedStreamId} creation`
            );

            // Emit prd-created event so the API can return the actual ID
            eventEmitter.emit("prd-created", {
              streamId: detectedStreamId,
              timestamp: new Date(),
            });
          }

          // Parse phase/progress from output
          const phaseInfo = this.parseOutputForPhase(line);
          if (phaseInfo.phase) {
            processState.phase = phaseInfo.phase;
          }
          if (phaseInfo.progress !== undefined) {
            processState.progress = phaseInfo.progress;
          }

          // Emit output event
          const event: WizardOutputEvent = {
            type: "output",
            streamId: processState.streamId,
            data: { text: line },
            timestamp: new Date(),
          };
          eventEmitter.emit("output", event);

          // Emit phase update if changed
          if (phaseInfo.phase) {
            const phaseEvent: WizardOutputEvent = {
              type: "phase",
              streamId: processState.streamId,
              data: {
                phase: phaseInfo.phase,
                progress: phaseInfo.progress ?? processState.progress,
              },
              timestamp: new Date(),
            };
            eventEmitter.emit("phase", phaseEvent);
          }
        }
      });
    }

    // Handle stderr
    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data: Buffer) => {
        const text = data.toString();
        const lines = text.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          processState.output.push(`[stderr] ${line}`);

          const event: WizardOutputEvent = {
            type: "output",
            streamId: processState.streamId,
            data: { text: `[stderr] ${line}` },
            timestamp: new Date(),
          };
          eventEmitter.emit("output", event);
        }
      });
    }

    // Handle exit
    childProcess.on("exit", (code, signal) => {
      const success = code === 0;

      // Determine final key (use detected ID if available)
      const finalKey = detectedStreamId ? this.getKey(detectedStreamId) : tempKey;

      // Store completed status
      const completedStatus: GenerationStatus = {
        status: success ? "complete" : "error",
        type: processState.type,
        phase: success ? "complete" : "error",
        progress: success ? 100 : processState.progress,
        startedAt: processState.startedAt,
        output: processState.output,
        error: success ? undefined : `Process exited with code ${code}`,
      };
      this.completedStatuses.set(finalKey, completedStatus);

      // Emit complete/error event
      const event: WizardOutputEvent = {
        type: success ? "complete" : "error",
        streamId: processState.streamId,
        data: {
          success,
          message: success
            ? `PRD generation completed`
            : `PRD generation failed with code ${code}`,
        },
        timestamp: new Date(),
      };
      eventEmitter.emit(success ? "complete" : "error", event);

      // Clean up
      this.processes.delete(finalKey);
      this.processes.delete(tempKey); // Ensure temp key is also cleaned

      console.log(
        `[WizardProcessManager] PRD generation ${detectedStreamId ? `for stream ${detectedStreamId}` : ""} ${success ? "completed" : "failed"} (code: ${code})`
      );
    });

    // Handle error
    childProcess.on("error", (error: Error) => {
      const finalKey = detectedStreamId ? this.getKey(detectedStreamId) : tempKey;

      const errorStatus: GenerationStatus = {
        status: "error",
        type: processState.type,
        phase: "error",
        progress: processState.progress,
        startedAt: processState.startedAt,
        output: processState.output,
        error: error.message,
      };
      this.completedStatuses.set(finalKey, errorStatus);

      const event: WizardOutputEvent = {
        type: "error",
        streamId: processState.streamId,
        data: { message: error.message },
        timestamp: new Date(),
      };
      eventEmitter.emit("error", event);

      this.processes.delete(finalKey);
      this.processes.delete(tempKey);

      console.log(
        `[WizardProcessManager] PRD generation errored: ${error.message}`
      );
    });
  }

  /**
   * Parse output line to detect phase changes
   */
  private parseOutputForPhase(line: string): { phase?: GenerationPhase; progress?: number } {
    const lowerLine = line.toLowerCase();

    // Detect [PROGRESS] prefixed lines from loop.sh (highest priority)
    if (line.includes("[PROGRESS]")) {
      if (lowerLine.includes("analyzing")) {
        return { phase: "analyzing", progress: 20 };
      }
      if (lowerLine.includes("generating")) {
        return { phase: "generating", progress: 50 };
      }
      if (lowerLine.includes("writing")) {
        return { phase: "writing", progress: 80 };
      }
      if (lowerLine.includes("complete")) {
        return { phase: "complete", progress: 100 };
      }
      if (lowerLine.includes("error") || lowerLine.includes("failed")) {
        return { phase: "error" };
      }
    }

    // Detect common phase patterns (fallback for other output)
    if (lowerLine.includes("analyzing") || lowerLine.includes("reading")) {
      return { phase: "analyzing", progress: 20 };
    }
    if (lowerLine.includes("generating") || lowerLine.includes("creating")) {
      return { phase: "generating", progress: 50 };
    }
    if (lowerLine.includes("writing") || lowerLine.includes("saving")) {
      return { phase: "writing", progress: 80 };
    }
    if (lowerLine.includes("complete") || lowerLine.includes("done") || lowerLine.includes("success")) {
      return { phase: "complete", progress: 100 };
    }
    if (lowerLine.includes("error") || lowerLine.includes("failed")) {
      return { phase: "error" };
    }

    return {};
  }

  /**
   * Get the current generation status for a stream
   * @param streamId The stream ID
   * @returns Current generation status
   */
  getStatus(streamId: string): GenerationStatus {
    const key = this.getKey(streamId);

    // Check if currently generating
    const activeProcess = this.processes.get(key);
    if (activeProcess) {
      return {
        status: "generating",
        type: activeProcess.type,
        phase: activeProcess.phase,
        progress: activeProcess.progress,
        startedAt: activeProcess.startedAt,
        output: activeProcess.output,
      };
    }

    // Check for completed status
    const completed = this.completedStatuses.get(key);
    if (completed) {
      return completed;
    }

    // No activity
    return {
      status: "idle",
      output: [],
    };
  }

  /**
   * Get the event emitter for a stream's generation (for SSE streaming)
   * @param streamId The stream ID
   * @returns EventEmitter or null if no active generation
   */
  getEventEmitter(streamId: string): EventEmitter | null {
    const key = this.getKey(streamId);
    const process = this.processes.get(key);
    return process?.eventEmitter ?? null;
  }

  /**
   * Cancel an in-progress generation
   * @param streamId The stream ID
   * @returns Whether cancellation was successful
   */
  cancel(streamId: string): { success: boolean; message: string } {
    const key = this.getKey(streamId);
    const processState = this.processes.get(key);

    if (!processState) {
      return {
        success: false,
        message: "No generation in progress for this stream",
      };
    }

    try {
      // Send SIGTERM for graceful termination
      processState.process.kill("SIGTERM");

      // Update status
      const cancelledStatus: GenerationStatus = {
        status: "error",
        type: processState.type,
        phase: "error",
        progress: processState.progress,
        startedAt: processState.startedAt,
        output: [...processState.output, "[Cancelled by user]"],
        error: "Generation cancelled by user",
      };
      this.completedStatuses.set(key, cancelledStatus);

      // Emit error event
      const event: WizardOutputEvent = {
        type: "error",
        streamId,
        data: { message: "Generation cancelled by user" },
        timestamp: new Date(),
      };
      processState.eventEmitter.emit("error", event);

      console.log(
        `[WizardProcessManager] Cancelled ${processState.type} generation for stream ${streamId}`
      );

      return {
        success: true,
        message: `${processState.type.toUpperCase()} generation cancelled`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to cancel generation: ${errorMessage}`,
      };
    }
  }

  /**
   * Cancel a generation process by its PID.
   * More reliable than key-based cancellation as PID is available immediately.
   * @param pid The process ID to kill
   * @returns Whether cancellation was successful
   */
  cancelByPid(pid: number): { success: boolean; message: string } {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`[WizardProcessManager] Cancelled process by PID: ${pid}`);
      return { success: true, message: `Process ${pid} terminated` };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") {
        // Process doesn't exist (already terminated)
        return { success: true, message: `Process ${pid} already terminated` };
      }
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.log(`[WizardProcessManager] Failed to cancel PID ${pid}: ${errorMessage}`);
      return { success: false, message: `Failed to kill process ${pid}: ${errorMessage}` };
    }
  }

  /**
   * Check if a stream has an active generation process
   * @param streamId The stream ID
   * @returns Whether generation is in progress
   */
  isGenerating(streamId: string): boolean {
    const key = this.getKey(streamId);
    return this.processes.has(key);
  }

  /**
   * Clear completed status for a stream
   * @param streamId The stream ID
   */
  clearStatus(streamId: string): void {
    const key = this.getKey(streamId);
    this.completedStatuses.delete(key);
  }
}

// Export singleton instance
export const wizardProcessManager = new WizardProcessManager();

// Export class for testing
export { WizardProcessManager };
