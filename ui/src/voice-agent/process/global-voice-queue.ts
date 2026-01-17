/**
 * Global Voice Queue - Cross-Process Coordination
 *
 * Manages a file-based queue system to coordinate voice agent access
 * across multiple Claude Code CLI sessions running in different terminals.
 *
 * This prevents "noisy spam" from concurrent voice agents by ensuring
 * only one CLI session can actively use the voice agent at a time.
 *
 * Pattern based on Ralph's merge queue in .agents/ralph/stream.sh
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

/**
 * Queue entry stored in filesystem
 */
export interface QueueEntry {
  cliId: string;
  pid: number;
  timestamp: number;
  requestedAt: string;
  terminalId?: string;
  priority?: number; // Lower = higher priority (default: 100)
}

/**
 * Current lock holder info
 */
export interface LockHolder {
  cliId: string;
  pid: number;
  acquiredAt: string;
  terminalId?: string;
}

/**
 * Queue status information
 */
export interface QueueStatus {
  isLockHeld: boolean;
  lockHolder: LockHolder | null;
  queueLength: number;
  queueEntries: Array<QueueEntry & { position: number; waitTime: number }>;
  myPosition: number | null; // null if not in queue
  amIHolder: boolean;
}

/**
 * Queue event types
 */
export type QueueEventType =
  | "lock_acquired"
  | "lock_released"
  | "queue_position_changed"
  | "queue_joined"
  | "queue_left";

export interface QueueEvent {
  type: QueueEventType;
  cliId: string;
  data: Record<string, unknown>;
  timestamp: Date;
}

/**
 * Global Voice Queue Manager
 *
 * Uses filesystem-based coordination to manage voice agent access
 * across multiple processes.
 */
export class GlobalVoiceQueue extends EventEmitter {
  private readonly lockDir: string;
  private readonly queueDir: string;
  private readonly lockFile: string;
  private readonly cliId: string;
  private readonly pid: number;
  private readonly terminalId: string;

  private pollInterval: NodeJS.Timeout | null = null;
  private fsWatcher: fs.FSWatcher | null = null;
  private lastKnownPosition: number | null = null;

  // Default poll interval for queue status checks (ms)
  private static readonly POLL_INTERVAL = 500;
  // Lock acquisition timeout (ms)
  private static readonly LOCK_TIMEOUT = 30000;
  // Stale lock threshold - if lock holder's PID is dead (ms)
  private static readonly STALE_THRESHOLD = 60000;

  constructor(options: {
    ralphRoot?: string;
    cliId?: string;
    terminalId?: string;
  } = {}) {
    super();

    // Determine Ralph root directory
    const ralphRoot = options.ralphRoot || this.findRalphRoot();
    this.lockDir = path.join(ralphRoot, "locks", "voice");
    this.queueDir = path.join(this.lockDir, "queue");
    this.lockFile = path.join(this.lockDir, "voice.lock");

    // Generate or use provided CLI identifier
    this.cliId = options.cliId || this.generateCliId();
    this.pid = process.pid;
    this.terminalId = options.terminalId || process.env.TERM_SESSION_ID ||
      process.env.WINDOWID || `terminal-${process.ppid}`;

    // Ensure directories exist
    this.ensureDirectories();
  }

  /**
   * Find the Ralph root directory
   */
  private findRalphRoot(): string {
    // Check environment variable first
    if (process.env.RALPH_ROOT) {
      return process.env.RALPH_ROOT;
    }

    // Look for .ralph directory starting from cwd and walking up
    let current = process.cwd();
    while (current !== path.dirname(current)) {
      const ralphDir = path.join(current, ".ralph");
      if (fs.existsSync(ralphDir)) {
        return ralphDir;
      }
      current = path.dirname(current);
    }

    // Default to home directory
    return path.join(os.homedir(), ".ralph");
  }

  /**
   * Generate a unique CLI identifier
   */
  private generateCliId(): string {
    // Use a combination of hostname, PID, and timestamp for uniqueness
    const hostname = os.hostname().substring(0, 8);
    const shortUuid = randomUUID().substring(0, 8);
    return `cli-${hostname}-${this.pid}-${shortUuid}`;
  }

  /**
   * Ensure lock directories exist
   */
  private ensureDirectories(): void {
    if (!fs.existsSync(this.lockDir)) {
      fs.mkdirSync(this.lockDir, { recursive: true });
    }
    if (!fs.existsSync(this.queueDir)) {
      fs.mkdirSync(this.queueDir, { recursive: true });
    }
  }

  /**
   * Check if a process is still running
   */
  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Parse a queue entry file
   */
  private parseQueueEntry(filePath: string): QueueEntry | null {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const data: Record<string, string> = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length > 0) {
          data[key.trim()] = valueParts.join("=").trim();
        }
      }

      if (!data.CLI_ID || !data.PID || !data.TIMESTAMP) {
        return null;
      }

      return {
        cliId: data.CLI_ID,
        pid: parseInt(data.PID, 10),
        timestamp: parseInt(data.TIMESTAMP, 10),
        requestedAt: data.REQUESTED_AT || new Date(parseInt(data.TIMESTAMP, 10) * 1000).toISOString(),
        terminalId: data.TERMINAL_ID,
        priority: data.PRIORITY ? parseInt(data.PRIORITY, 10) : 100,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse the lock file
   */
  private parseLockHolder(): LockHolder | null {
    try {
      if (!fs.existsSync(this.lockFile)) {
        return null;
      }

      const content = fs.readFileSync(this.lockFile, "utf-8");
      const lines = content.split("\n");
      const data: Record<string, string> = {};

      for (const line of lines) {
        const [key, ...valueParts] = line.split("=");
        if (key && valueParts.length > 0) {
          data[key.trim()] = valueParts.join("=").trim();
        }
      }

      if (!data.CLI_ID || !data.PID) {
        return null;
      }

      return {
        cliId: data.CLI_ID,
        pid: parseInt(data.PID, 10),
        acquiredAt: data.ACQUIRED_AT || new Date().toISOString(),
        terminalId: data.TERMINAL_ID,
      };
    } catch {
      return null;
    }
  }

  /**
   * Write a queue entry file
   */
  private writeQueueEntry(entry: QueueEntry): string {
    const fileName = `${entry.cliId}-${entry.timestamp}.wait`;
    const filePath = path.join(this.queueDir, fileName);

    const content = [
      `CLI_ID=${entry.cliId}`,
      `PID=${entry.pid}`,
      `TIMESTAMP=${entry.timestamp}`,
      `REQUESTED_AT=${entry.requestedAt}`,
      `TERMINAL_ID=${entry.terminalId || ""}`,
      `PRIORITY=${entry.priority || 100}`,
    ].join("\n");

    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  /**
   * Write the lock file atomically using exclusive create (wx flag)
   * This is the Node.js equivalent of flock - it fails if file exists
   * Returns true if lock was acquired, false if already held
   */
  private writeLockFileAtomic(holder: LockHolder): boolean {
    const content = [
      `CLI_ID=${holder.cliId}`,
      `PID=${holder.pid}`,
      `ACQUIRED_AT=${holder.acquiredAt}`,
      `TERMINAL_ID=${holder.terminalId || ""}`,
    ].join("\n");

    try {
      // wx = O_WRONLY | O_CREAT | O_EXCL - fails atomically if file exists
      fs.writeFileSync(this.lockFile, content, { flag: "wx", encoding: "utf-8" });
      return true;
    } catch (err: unknown) {
      if (err && typeof err === "object" && "code" in err && err.code === "EEXIST") {
        // File already exists - lock is held
        return false;
      }
      // Other error (permissions, disk full, etc.) - rethrow
      throw err;
    }
  }

  /**
   * Clean up stale queue entries (dead processes)
   */
  private cleanupStaleEntries(): void {
    try {
      const files = fs.readdirSync(this.queueDir);

      for (const file of files) {
        if (!file.endsWith(".wait")) continue;

        const filePath = path.join(this.queueDir, file);
        const entry = this.parseQueueEntry(filePath);

        if (!entry || !this.isProcessAlive(entry.pid)) {
          try {
            fs.unlinkSync(filePath);
            console.log(`[GlobalVoiceQueue] Cleaned up stale entry: ${file}`);
          } catch {
            // Ignore cleanup errors
          }
        }
      }
    } catch {
      // Directory might not exist yet
    }
  }

  /**
   * Clean up stale lock (dead holder process)
   */
  private cleanupStaleLock(): boolean {
    const holder = this.parseLockHolder();
    if (!holder) return false;

    if (!this.isProcessAlive(holder.pid)) {
      try {
        fs.unlinkSync(this.lockFile);
        console.log(`[GlobalVoiceQueue] Cleaned up stale lock from dead process ${holder.pid}`);
        return true;
      } catch {
        return false;
      }
    }

    return false;
  }

  /**
   * Get all queue entries sorted by priority then timestamp
   */
  private getQueueEntries(): QueueEntry[] {
    this.cleanupStaleEntries();

    try {
      const files = fs.readdirSync(this.queueDir);
      const entries: QueueEntry[] = [];

      for (const file of files) {
        if (!file.endsWith(".wait")) continue;

        const filePath = path.join(this.queueDir, file);
        const entry = this.parseQueueEntry(filePath);

        if (entry && this.isProcessAlive(entry.pid)) {
          entries.push(entry);
        }
      }

      // Sort by priority (lower first), then by timestamp (older first)
      return entries.sort((a, b) => {
        const priorityDiff = (a.priority || 100) - (b.priority || 100);
        if (priorityDiff !== 0) return priorityDiff;
        return a.timestamp - b.timestamp;
      });
    } catch {
      return [];
    }
  }

  /**
   * Get current queue status
   */
  getStatus(): QueueStatus {
    this.cleanupStaleLock();
    const holder = this.parseLockHolder();
    const entries = this.getQueueEntries();
    const now = Date.now();

    const queueEntriesWithMeta = entries.map((entry, index) => ({
      ...entry,
      position: index + 1,
      waitTime: Math.floor((now - entry.timestamp * 1000) / 1000),
    }));

    const myEntry = queueEntriesWithMeta.find((e) => e.cliId === this.cliId);

    return {
      isLockHeld: holder !== null,
      lockHolder: holder,
      queueLength: entries.length,
      queueEntries: queueEntriesWithMeta,
      myPosition: myEntry?.position ?? null,
      amIHolder: holder?.cliId === this.cliId,
    };
  }

  /**
   * Join the queue to request voice access
   */
  joinQueue(priority?: number): { success: boolean; position: number; message: string } {
    // Check if already in queue
    const status = this.getStatus();
    if (status.myPosition !== null) {
      return {
        success: true,
        position: status.myPosition,
        message: `Already in queue at position ${status.myPosition}`,
      };
    }

    // Check if already holding the lock
    if (status.amIHolder) {
      return {
        success: true,
        position: 0,
        message: "Already holding voice lock",
      };
    }

    const entry: QueueEntry = {
      cliId: this.cliId,
      pid: this.pid,
      timestamp: Math.floor(Date.now() / 1000),
      requestedAt: new Date().toISOString(),
      terminalId: this.terminalId,
      priority: priority ?? 100,
    };

    this.writeQueueEntry(entry);

    // Get updated position
    const newStatus = this.getStatus();
    const position = newStatus.myPosition ?? 1;

    this.emit("queue_joined", {
      type: "queue_joined",
      cliId: this.cliId,
      data: { position },
      timestamp: new Date(),
    } as QueueEvent);

    console.log(`[GlobalVoiceQueue] Joined queue at position ${position}`);

    return {
      success: true,
      position,
      message: `Joined queue at position ${position}`,
    };
  }

  /**
   * Leave the queue (give up waiting)
   */
  leaveQueue(): { success: boolean; message: string } {
    try {
      const files = fs.readdirSync(this.queueDir);

      for (const file of files) {
        if (file.startsWith(this.cliId) && file.endsWith(".wait")) {
          fs.unlinkSync(path.join(this.queueDir, file));
        }
      }

      this.emit("queue_left", {
        type: "queue_left",
        cliId: this.cliId,
        data: {},
        timestamp: new Date(),
      } as QueueEvent);

      console.log(`[GlobalVoiceQueue] Left queue`);

      return { success: true, message: "Left queue successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to leave queue: ${errorMessage}` };
    }
  }

  /**
   * Try to acquire the voice lock
   * Only succeeds if we're first in queue or queue is empty
   */
  tryAcquireLock(): { success: boolean; message: string } {
    this.ensureDirectories();

    // First, try atomic lock acquisition
    // This is the KEY difference - we try to acquire FIRST, then check status
    const holder: LockHolder = {
      cliId: this.cliId,
      pid: this.pid,
      acquiredAt: new Date().toISOString(),
      terminalId: this.terminalId,
    };

    // Attempt atomic lock acquisition
    if (this.writeLockFileAtomic(holder)) {
      // Successfully acquired lock atomically
      // Remove ourselves from queue if we were waiting
      this.leaveQueue();

      this.emit("lock_acquired", {
        type: "lock_acquired",
        cliId: this.cliId,
        data: { holder },
        timestamp: new Date(),
      } as QueueEvent);

      console.log(`[GlobalVoiceQueue] Acquired voice lock atomically`);
      return { success: true, message: "Lock acquired" };
    }

    // Lock file exists - check if it's us or stale
    const existingHolder = this.parseLockHolder();

    // Check if we already hold the lock
    if (existingHolder?.cliId === this.cliId) {
      return { success: true, message: "Already holding lock" };
    }

    // Check if lock is stale (holder process is dead)
    if (existingHolder && !this.isProcessAlive(existingHolder.pid)) {
      // Stale lock - try to clean up and retry
      try {
        fs.unlinkSync(this.lockFile);
        console.log(`[GlobalVoiceQueue] Cleaned up stale lock from dead process ${existingHolder.pid}`);
        // Retry acquisition (recursive, but bounded by stale lock cleanup)
        return this.tryAcquireLock();
      } catch {
        // Someone else might have cleaned it up and acquired - that's fine
      }
    }

    // Lock is held by another active process
    // Join queue if not already there
    const status = this.getStatus();
    if (status.myPosition === null) {
      this.joinQueue();
    }

    return {
      success: false,
      message: existingHolder
        ? `Lock held by ${existingHolder.cliId} (PID: ${existingHolder.pid})`
        : "Lock held by another process",
    };
  }


  /**
   * Release the voice lock
   */
  releaseLock(): { success: boolean; message: string } {
    const holder = this.parseLockHolder();

    if (!holder) {
      return { success: true, message: "Lock not held" };
    }

    if (holder.cliId !== this.cliId) {
      return {
        success: false,
        message: `Lock held by different CLI: ${holder.cliId}`,
      };
    }

    try {
      fs.unlinkSync(this.lockFile);

      this.emit("lock_released", {
        type: "lock_released",
        cliId: this.cliId,
        data: {},
        timestamp: new Date(),
      } as QueueEvent);

      console.log(`[GlobalVoiceQueue] Released voice lock`);

      return { success: true, message: "Lock released successfully" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return { success: false, message: `Failed to release lock: ${errorMessage}` };
    }
  }

  /**
   * Wait for lock acquisition with timeout
   * Automatically joins queue and waits for turn
   */
  async waitForLock(options: {
    timeout?: number;
    priority?: number;
    onPositionChange?: (position: number) => void;
  } = {}): Promise<{ success: boolean; message: string }> {
    const timeout = options.timeout ?? GlobalVoiceQueue.LOCK_TIMEOUT;
    const startTime = Date.now();

    // First try immediate acquisition
    const immediate = this.tryAcquireLock();
    if (immediate.success) {
      return immediate;
    }

    // Join queue if not already
    const status = this.getStatus();
    if (status.myPosition === null) {
      this.joinQueue(options.priority);
    }

    // Poll for lock availability
    return new Promise((resolve) => {
      const checkLock = () => {
        if (Date.now() - startTime > timeout) {
          this.leaveQueue();
          resolve({
            success: false,
            message: `Timeout waiting for lock after ${timeout}ms`,
          });
          return;
        }

        const result = this.tryAcquireLock();
        if (result.success) {
          resolve(result);
          return;
        }

        // Check position and notify
        const currentStatus = this.getStatus();
        if (
          currentStatus.myPosition !== null &&
          currentStatus.myPosition !== this.lastKnownPosition
        ) {
          this.lastKnownPosition = currentStatus.myPosition;
          options.onPositionChange?.(currentStatus.myPosition);

          this.emit("queue_position_changed", {
            type: "queue_position_changed",
            cliId: this.cliId,
            data: { position: currentStatus.myPosition },
            timestamp: new Date(),
          } as QueueEvent);
        }

        // Continue polling
        setTimeout(checkLock, GlobalVoiceQueue.POLL_INTERVAL);
      };

      checkLock();
    });
  }

  /**
   * Start watching for queue changes
   */
  startWatching(): void {
    if (this.pollInterval || this.fsWatcher) {
      return; // Already watching
    }

    // Use fs.watch for immediate notifications
    try {
      this.fsWatcher = fs.watch(this.lockDir, { recursive: true }, () => {
        const status = this.getStatus();
        if (
          status.myPosition !== null &&
          status.myPosition !== this.lastKnownPosition
        ) {
          this.lastKnownPosition = status.myPosition;
          this.emit("queue_position_changed", {
            type: "queue_position_changed",
            cliId: this.cliId,
            data: { position: status.myPosition },
            timestamp: new Date(),
          } as QueueEvent);
        }
      });
    } catch {
      // Fall back to polling if watch fails
    }

    // Also poll periodically as backup
    this.pollInterval = setInterval(() => {
      const status = this.getStatus();
      if (
        status.myPosition !== null &&
        status.myPosition !== this.lastKnownPosition
      ) {
        this.lastKnownPosition = status.myPosition;
        this.emit("queue_position_changed", {
          type: "queue_position_changed",
          cliId: this.cliId,
          data: { position: status.myPosition },
          timestamp: new Date(),
        } as QueueEvent);
      }
    }, GlobalVoiceQueue.POLL_INTERVAL * 2);
  }

  /**
   * Stop watching for queue changes
   */
  stopWatching(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.fsWatcher) {
      this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }

  /**
   * Clean up on shutdown
   */
  cleanup(): void {
    this.stopWatching();
    this.leaveQueue();

    // Release lock if we hold it
    const holder = this.parseLockHolder();
    if (holder?.cliId === this.cliId) {
      this.releaseLock();
    }
  }

  /**
   * Get CLI identifier for this instance
   */
  getCliId(): string {
    return this.cliId;
  }

  /**
   * Format queue status for display
   */
  formatStatus(): string {
    const status = this.getStatus();
    const lines: string[] = [];

    lines.push("╭─── Voice Queue Status ───╮");

    if (status.isLockHeld && status.lockHolder) {
      const holder = status.lockHolder;
      lines.push(`│ Lock: HELD               │`);
      lines.push(`│ By: ${holder.cliId.substring(0, 20).padEnd(20)} │`);
      if (status.amIHolder) {
        lines.push(`│ (You have the lock)      │`);
      }
    } else {
      lines.push(`│ Lock: AVAILABLE          │`);
    }

    lines.push(`├──────────────────────────┤`);
    lines.push(`│ Queue: ${String(status.queueLength).padStart(2)} waiting       │`);

    if (status.queueLength > 0) {
      for (const entry of status.queueEntries.slice(0, 5)) {
        const isMe = entry.cliId === this.cliId ? "*" : " ";
        const cliShort = entry.cliId.substring(0, 15).padEnd(15);
        lines.push(`│ ${isMe}${entry.position}. ${cliShort} ${entry.waitTime}s │`);
      }
      if (status.queueLength > 5) {
        lines.push(`│ ... and ${status.queueLength - 5} more         │`);
      }
    }

    if (status.myPosition !== null && !status.amIHolder) {
      lines.push(`├──────────────────────────┤`);
      lines.push(`│ Your position: ${String(status.myPosition).padStart(2)}        │`);
    }

    lines.push("╰──────────────────────────╯");

    return lines.join("\n");
  }
}

// Export factory function for creating queue instances
export function createGlobalVoiceQueue(options?: {
  ralphRoot?: string;
  cliId?: string;
  terminalId?: string;
}): GlobalVoiceQueue {
  return new GlobalVoiceQueue(options);
}

// Export singleton for simple use cases
let defaultQueue: GlobalVoiceQueue | null = null;

export function getGlobalVoiceQueue(): GlobalVoiceQueue {
  if (!defaultQueue) {
    defaultQueue = new GlobalVoiceQueue();
  }
  return defaultQueue;
}

// Handle process exit cleanup
process.on("exit", () => {
  defaultQueue?.cleanup();
});

process.on("SIGINT", () => {
  defaultQueue?.cleanup();
  process.exit(0);
});

process.on("SIGTERM", () => {
  defaultQueue?.cleanup();
  process.exit(0);
});
