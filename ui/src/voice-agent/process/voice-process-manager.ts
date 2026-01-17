/**
 * Voice Process Manager Service
 *
 * Manages the lifecycle of voice agent processes including:
 * - Whisper STT server
 * - Voice sessions
 * - Command execution
 * - Cross-process queue coordination (prevents concurrent voice agents)
 *
 * Uses EventEmitter pattern for streaming output to clients.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import type {
  VoiceSession,
  VoiceSessionState,
  VoiceActionRecord,
  VoiceIntent,
  ExecutionResult,
  VoiceAgentConfig,
  DEFAULT_VOICE_CONFIG,
} from "../types.js";
import {
  GlobalVoiceQueue,
  createGlobalVoiceQueue,
  type QueueStatus,
  type QueueEvent,
} from "./global-voice-queue.js";

/**
 * Voice event types for SSE streaming
 */
export type VoiceEventType =
  | "session_start"
  | "state_change"
  | "transcription"
  | "intent"
  | "confirmation_required"
  | "execution_start"
  | "execution_output"
  | "execution_complete"
  | "error"
  | "queue_status"
  | "queue_position_changed"
  | "voice_access_granted"
  | "voice_access_denied"
  | "voice_access_waiting";

/**
 * Voice event data for SSE streaming
 */
export interface VoiceEvent {
  type: VoiceEventType;
  sessionId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * STT server process state
 */
interface STTServerProcess {
  process: ChildProcess;
  pid: number;
  port: number;
  model: string;
  startedAt: Date;
  ready: boolean;
}

/**
 * Voice session internal state
 */
interface SessionState {
  session: VoiceSession;
  eventEmitter: EventEmitter;
}

/**
 * Voice Process Manager singleton
 *
 * Now includes cross-process queue coordination to prevent multiple
 * Claude Code CLI sessions from triggering concurrent voice agents.
 */
class VoiceProcessManager {
  private sttServer: STTServerProcess | null = null;
  private sessions: Map<string, SessionState> = new Map();
  private config: VoiceAgentConfig;
  private queue: GlobalVoiceQueue;
  private hasVoiceLock: boolean = false;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.config = {
      sttServerUrl: config.sttServerUrl || "http://localhost:5001",
      ollamaUrl: config.ollamaUrl || "http://localhost:11434",
      ollamaModel: config.ollamaModel || "qwen2.5:1.5b",
      confirmationRequired: config.confirmationRequired || ["file_operation", "app_control"],
      maxRecordingDuration: config.maxRecordingDuration || 30,
      silenceThreshold: config.silenceThreshold || 0.01,
      silenceTimeout: config.silenceTimeout || 1500,
    };

    // Initialize cross-process queue
    this.queue = createGlobalVoiceQueue();

    // Listen for queue events and forward to sessions
    this.setupQueueEventForwarding();
  }

  /**
   * Forward queue events to all active sessions
   */
  private setupQueueEventForwarding(): void {
    this.queue.on("queue_position_changed", (event: QueueEvent) => {
      for (const [sessionId] of this.sessions) {
        this.emitEvent(sessionId, "queue_position_changed", {
          position: event.data.position,
          cliId: event.cliId,
        });
      }
    });

    this.queue.on("lock_acquired", (event: QueueEvent) => {
      this.hasVoiceLock = true;
      for (const [sessionId] of this.sessions) {
        this.emitEvent(sessionId, "voice_access_granted", {
          cliId: event.cliId,
        });
      }
    });

    this.queue.on("lock_released", (event: QueueEvent) => {
      this.hasVoiceLock = false;
    });
  }

  /**
   * Start the Whisper STT server
   */
  async startSTTServer(
    options: {
      port?: number;
      model?: string;
      preload?: boolean;
    } = {}
  ): Promise<{ success: boolean; message: string; pid?: number }> {
    if (this.sttServer) {
      return {
        success: false,
        message: `STT server already running (PID: ${this.sttServer.pid})`,
        pid: this.sttServer.pid,
      };
    }

    const port = options.port || 5001;
    const model = options.model || "base";

    // Find the Python script path
    const scriptPath = path.join(
      process.cwd(),
      "ui",
      "python",
      "stt_server.py"
    );

    // Build command arguments
    const args = ["stt_server.py", "--port", port.toString(), "--model", model];
    if (options.preload) {
      args.push("--preload");
    }

    try {
      const childProcess = spawn("python3", args, {
        cwd: path.join(process.cwd(), "ui", "python"),
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      if (!childProcess.pid) {
        return {
          success: false,
          message: "Failed to start STT server: no PID assigned",
        };
      }

      this.sttServer = {
        process: childProcess,
        pid: childProcess.pid,
        port,
        model,
        startedAt: new Date(),
        ready: false,
      };

      // Set up output handlers
      this.setupSTTServerHandlers(childProcess);

      console.log(
        `[VoiceProcessManager] Started STT server (PID: ${childProcess.pid}, port: ${port}, model: ${model})`
      );

      // Wait for server to be ready
      await this.waitForSTTServer(port);

      return {
        success: true,
        message: `STT server started on port ${port}`,
        pid: childProcess.pid,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to start STT server: ${errorMessage}`,
      };
    }
  }

  /**
   * Wait for STT server to be ready
   */
  private async waitForSTTServer(
    port: number,
    timeoutMs: number = 30000
  ): Promise<void> {
    const startTime = Date.now();
    const url = `http://localhost:${port}/health`;

    while (Date.now() - startTime < timeoutMs) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          if (this.sttServer) {
            this.sttServer.ready = true;
          }
          console.log("[VoiceProcessManager] STT server is ready");
          return;
        }
      } catch {
        // Server not ready yet, continue waiting
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    console.warn("[VoiceProcessManager] STT server readiness check timed out");
  }

  /**
   * Set up handlers for STT server process
   */
  private setupSTTServerHandlers(childProcess: ChildProcess): void {
    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data: Buffer) => {
        console.log(`[STT Server] ${data.toString().trim()}`);
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data: Buffer) => {
        console.error(`[STT Server Error] ${data.toString().trim()}`);
      });
    }

    childProcess.on("exit", (code, signal) => {
      console.log(
        `[VoiceProcessManager] STT server exited (code: ${code}, signal: ${signal})`
      );
      this.sttServer = null;
    });

    childProcess.on("error", (error) => {
      console.error(`[VoiceProcessManager] STT server error: ${error.message}`);
      this.sttServer = null;
    });
  }

  /**
   * Stop the STT server
   */
  stopSTTServer(): { success: boolean; message: string } {
    if (!this.sttServer) {
      return {
        success: false,
        message: "STT server is not running",
      };
    }

    try {
      this.sttServer.process.kill("SIGTERM");
      console.log(
        `[VoiceProcessManager] Stopped STT server (PID: ${this.sttServer.pid})`
      );
      this.sttServer = null;
      return {
        success: true,
        message: "STT server stopped",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        message: `Failed to stop STT server: ${errorMessage}`,
      };
    }
  }

  /**
   * Get STT server status
   */
  getSTTServerStatus(): {
    running: boolean;
    pid?: number;
    port?: number;
    model?: string;
    ready?: boolean;
    uptime?: number;
  } {
    if (!this.sttServer) {
      return { running: false };
    }

    return {
      running: true,
      pid: this.sttServer.pid,
      port: this.sttServer.port,
      model: this.sttServer.model,
      ready: this.sttServer.ready,
      uptime: Date.now() - this.sttServer.startedAt.getTime(),
    };
  }

  /**
   * Create a new voice session
   */
  createSession(): { session: VoiceSession; eventEmitter: EventEmitter } {
    const sessionId = randomUUID();
    const now = new Date();

    const session: VoiceSession = {
      id: sessionId,
      state: "idle",
      startedAt: now,
      lastActivity: now,
      history: [],
    };

    const eventEmitter = new EventEmitter();

    this.sessions.set(sessionId, { session, eventEmitter });

    // Emit session start event
    this.emitEvent(sessionId, "session_start", {
      sessionId,
      state: session.state,
    });

    console.log(`[VoiceProcessManager] Created session: ${sessionId}`);

    return { session, eventEmitter };
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: string): VoiceSession | null {
    const state = this.sessions.get(sessionId);
    return state?.session || null;
  }

  /**
   * Get event emitter for a session
   */
  getEventEmitter(sessionId: string): EventEmitter | null {
    const state = this.sessions.get(sessionId);
    return state?.eventEmitter || null;
  }

  /**
   * Update session state
   */
  updateSessionState(sessionId: string, newState: VoiceSessionState): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      console.warn(`[VoiceProcessManager] Session not found: ${sessionId}`);
      return;
    }

    const oldState = state.session.state;
    state.session.state = newState;
    state.session.lastActivity = new Date();

    this.emitEvent(sessionId, "state_change", {
      oldState,
      newState,
    });

    console.log(
      `[VoiceProcessManager] Session ${sessionId} state: ${oldState} -> ${newState}`
    );
  }

  /**
   * Add an action record to session history
   */
  addActionRecord(sessionId: string, record: VoiceActionRecord): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      console.warn(`[VoiceProcessManager] Session not found: ${sessionId}`);
      return;
    }

    state.session.history.push(record);
    state.session.lastActivity = new Date();
  }

  /**
   * Set pending intent for confirmation
   */
  setPendingIntent(sessionId: string, intent: VoiceIntent): void {
    const state = this.sessions.get(sessionId);
    if (!state) {
      console.warn(`[VoiceProcessManager] Session not found: ${sessionId}`);
      return;
    }

    state.session.pendingIntent = intent;
    this.updateSessionState(sessionId, "confirming");

    this.emitEvent(sessionId, "confirmation_required", {
      intent,
    });
  }

  /**
   * Clear pending intent
   */
  clearPendingIntent(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.session.pendingIntent = undefined;
  }

  /**
   * Emit an event for a session
   */
  emitEvent(
    sessionId: string,
    type: VoiceEventType,
    data: Record<string, unknown>
  ): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    const event: VoiceEvent = {
      type,
      sessionId,
      data,
      timestamp: new Date(),
    };

    state.eventEmitter.emit(type, event);
    state.eventEmitter.emit("event", event); // Generic event for SSE streaming
  }

  /**
   * Close a session
   */
  closeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;

    state.eventEmitter.removeAllListeners();
    this.sessions.delete(sessionId);

    console.log(`[VoiceProcessManager] Closed session: ${sessionId}`);
  }

  /**
   * Get all active session IDs
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Check if required services are running
   */
  async checkServices(): Promise<{
    sttServer: boolean;
    ollama: boolean;
    messages: string[];
  }> {
    const messages: string[] = [];
    let sttServer = false;
    let ollama = false;

    // Check STT server
    try {
      const sttUrl = new URL("/health", this.config.sttServerUrl);
      const sttResponse = await fetch(sttUrl.toString());
      sttServer = sttResponse.ok;
      if (!sttServer) {
        messages.push(`STT server not healthy at ${this.config.sttServerUrl}`);
      }
    } catch {
      messages.push(`STT server not reachable at ${this.config.sttServerUrl}`);
    }

    // Check Ollama
    try {
      const ollamaUrl = new URL("/api/tags", this.config.ollamaUrl);
      const ollamaResponse = await fetch(ollamaUrl.toString());
      ollama = ollamaResponse.ok;
      if (!ollama) {
        messages.push(`Ollama not healthy at ${this.config.ollamaUrl}`);
      }
    } catch {
      messages.push(`Ollama not reachable at ${this.config.ollamaUrl}`);
    }

    return { sttServer, ollama, messages };
  }

  /**
   * Get current configuration
   */
  getConfig(): VoiceAgentConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(updates: Partial<VoiceAgentConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  // ============================================
  // Cross-Process Queue Management
  // ============================================

  /**
   * Request voice access through the global queue.
   * This must be called before using voice features to ensure
   * only one CLI session uses voice at a time.
   *
   * @param options Configuration for the request
   * @returns Result indicating if access was granted or queued
   */
  async requestVoiceAccess(options: {
    timeout?: number;
    priority?: number;
    waitForTurn?: boolean;
    onPositionChange?: (position: number) => void;
  } = {}): Promise<{
    granted: boolean;
    message: string;
    queuePosition?: number;
  }> {
    const { timeout = 30000, priority, waitForTurn = true, onPositionChange } = options;

    // First, try to acquire immediately
    const immediateResult = this.queue.tryAcquireLock();
    if (immediateResult.success) {
      this.hasVoiceLock = true;
      console.log("[VoiceProcessManager] Voice access granted immediately");
      return { granted: true, message: "Voice access granted" };
    }

    // If not waiting, just report queue position
    if (!waitForTurn) {
      const joinResult = this.queue.joinQueue(priority);
      return {
        granted: false,
        message: `Queued for voice access at position ${joinResult.position}`,
        queuePosition: joinResult.position,
      };
    }

    // Wait for our turn
    console.log("[VoiceProcessManager] Waiting for voice access...");
    const waitResult = await this.queue.waitForLock({
      timeout,
      priority,
      onPositionChange: (pos) => {
        onPositionChange?.(pos);
        // Emit to all sessions
        for (const [sessionId] of this.sessions) {
          this.emitEvent(sessionId, "voice_access_waiting", {
            position: pos,
          });
        }
      },
    });

    if (waitResult.success) {
      this.hasVoiceLock = true;
      console.log("[VoiceProcessManager] Voice access granted after waiting");
      return { granted: true, message: "Voice access granted" };
    }

    return {
      granted: false,
      message: waitResult.message,
      queuePosition: this.queue.getStatus().myPosition ?? undefined,
    };
  }

  /**
   * Release voice access, allowing the next CLI in queue to proceed.
   * Should be called when done with voice operations.
   */
  releaseVoiceAccess(): { success: boolean; message: string } {
    if (!this.hasVoiceLock) {
      return { success: true, message: "Not holding voice access" };
    }

    const result = this.queue.releaseLock();
    if (result.success) {
      this.hasVoiceLock = false;
      console.log("[VoiceProcessManager] Voice access released");
    }
    return result;
  }

  /**
   * Check if this process currently has voice access
   */
  hasVoiceAccess(): boolean {
    return this.hasVoiceLock;
  }

  /**
   * Get current queue status
   */
  getQueueStatus(): QueueStatus {
    return this.queue.getStatus();
  }

  /**
   * Get formatted queue status for display
   */
  getQueueStatusFormatted(): string {
    return this.queue.formatStatus();
  }

  /**
   * Get the CLI identifier for this process
   */
  getCliId(): string {
    return this.queue.getCliId();
  }

  /**
   * Join the voice queue without blocking
   * Useful for registering interest in voice access
   */
  joinVoiceQueue(priority?: number): {
    success: boolean;
    position: number;
    message: string;
  } {
    return this.queue.joinQueue(priority);
  }

  /**
   * Leave the voice queue (give up waiting)
   */
  leaveVoiceQueue(): { success: boolean; message: string } {
    return this.queue.leaveQueue();
  }

  /**
   * Start watching for queue changes
   * Useful for long-running sessions that want real-time updates
   */
  startQueueWatcher(): void {
    this.queue.startWatching();
  }

  /**
   * Stop watching for queue changes
   */
  stopQueueWatcher(): void {
    this.queue.stopWatching();
  }

  /**
   * Clean up all resources including queue state
   * Should be called on process shutdown
   */
  cleanup(): void {
    // Release voice lock if held
    if (this.hasVoiceLock) {
      this.releaseVoiceAccess();
    }

    // Clean up queue resources
    this.queue.cleanup();

    // Close all sessions
    for (const sessionId of this.sessions.keys()) {
      this.closeSession(sessionId);
    }

    // Stop STT server if running
    if (this.sttServer) {
      this.stopSTTServer();
    }

    console.log("[VoiceProcessManager] Cleanup complete");
  }

  /**
   * Create a session with automatic voice queue handling.
   * This is the recommended way to create sessions when queue
   * coordination is needed.
   *
   * @param options Session creation options
   */
  async createSessionWithQueueAccess(options: {
    timeout?: number;
    priority?: number;
  } = {}): Promise<{
    session: VoiceSession | null;
    eventEmitter: EventEmitter | null;
    granted: boolean;
    message: string;
    queuePosition?: number;
  }> {
    // Request voice access first
    const accessResult = await this.requestVoiceAccess({
      timeout: options.timeout,
      priority: options.priority,
      waitForTurn: true,
    });

    if (!accessResult.granted) {
      return {
        session: null,
        eventEmitter: null,
        granted: false,
        message: accessResult.message,
        queuePosition: accessResult.queuePosition,
      };
    }

    // Create the session now that we have access
    const { session, eventEmitter } = this.createSession();

    return {
      session,
      eventEmitter,
      granted: true,
      message: "Session created with voice access",
    };
  }
}

// Export singleton instance
export const voiceProcessManager = new VoiceProcessManager();

// Handle process cleanup
process.on("exit", () => {
  voiceProcessManager.cleanup();
});

process.on("SIGINT", () => {
  voiceProcessManager.cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  voiceProcessManager.cleanup();
  process.exit(0);
});

// Export class for testing
export { VoiceProcessManager };
