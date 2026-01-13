/**
 * File Watcher Service
 *
 * Watches the .ralph directory for changes and emits events.
 * Uses EventEmitter pattern for subscribe/unsubscribe interface.
 */

import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import type { FileChangedEvent, SSEEventType } from '../types.js';
import { getRalphRoot } from './state-reader.js';

/**
 * Event types emitted by the file watcher
 */
export type FileWatcherEventType =
  | 'file_changed'
  | 'run_started'
  | 'run_completed'
  | 'progress_updated'
  | 'story_updated';

/**
 * Event data for file watcher events
 */
export interface FileWatcherEvent {
  type: FileWatcherEventType;
  timestamp: Date;
  path?: string;
  changeType?: 'create' | 'modify' | 'delete';
  runId?: string;
  streamId?: string;
  storyId?: string;
}

/**
 * File watcher service singleton
 */
class FileWatcher extends EventEmitter {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private debounceMs: number = 100;
  private isWatching: boolean = false;
  private watchedPath: string | null = null;

  /**
   * Start watching the .ralph directory
   */
  start(): boolean {
    if (this.isWatching) {
      return true;
    }

    const ralphRoot = getRalphRoot();
    if (!ralphRoot) {
      console.error('[FileWatcher] Cannot start: .ralph directory not found');
      return false;
    }

    try {
      this.watchedPath = ralphRoot;

      // Use recursive watch for the entire .ralph directory
      this.watcher = fs.watch(
        ralphRoot,
        { recursive: true },
        (eventType, filename) => {
          if (filename) {
            this.handleFileChange(eventType, filename);
          }
        }
      );

      this.watcher.on('error', (error) => {
        console.error('[FileWatcher] Watch error:', error.message);
        this.emit('error', error);
      });

      this.watcher.on('close', () => {
        this.isWatching = false;
        this.watchedPath = null;
      });

      this.isWatching = true;
      console.log(`[FileWatcher] Started watching ${ralphRoot}`);
      return true;
    } catch (error) {
      console.error('[FileWatcher] Failed to start:', error);
      return false;
    }
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    this.isWatching = false;
    this.watchedPath = null;
    console.log('[FileWatcher] Stopped watching');
  }

  /**
   * Check if watcher is active
   */
  isActive(): boolean {
    return this.isWatching;
  }

  /**
   * Get the path being watched
   */
  getWatchedPath(): string | null {
    return this.watchedPath;
  }

  /**
   * Handle file change with debouncing
   */
  private handleFileChange(eventType: string, filename: string): void {
    // Create a unique key for debouncing
    const debounceKey = `${eventType}:${filename}`;

    // Clear existing timer if any
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounced handler
    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      this.processFileChange(eventType, filename);
    }, this.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Process file change after debounce
   */
  private processFileChange(eventType: string, filename: string): void {
    const fullPath = this.watchedPath ? path.join(this.watchedPath, filename) : filename;
    const changeType = this.determineChangeType(eventType, fullPath);

    // Create base event
    const event: FileWatcherEvent = {
      type: 'file_changed',
      timestamp: new Date(),
      path: filename,
      changeType,
    };

    // Emit generic file_changed event
    this.emit('file_changed', event);

    // Detect and emit specific events based on file patterns
    this.detectSpecificEvents(filename, changeType, event);
  }

  /**
   * Determine the type of change based on event and file existence
   */
  private determineChangeType(
    eventType: string,
    fullPath: string
  ): 'create' | 'modify' | 'delete' {
    if (eventType === 'rename') {
      // rename can mean create or delete
      try {
        fs.accessSync(fullPath);
        return 'create';
      } catch {
        return 'delete';
      }
    }
    return 'modify';
  }

  /**
   * Detect and emit specific events based on file patterns
   */
  private detectSpecificEvents(
    filename: string,
    changeType: 'create' | 'modify' | 'delete',
    baseEvent: FileWatcherEvent
  ): void {
    // Normalize path separators
    const normalizedPath = filename.replace(/\\/g, '/');

    // Detect run started: new .log file in runs/ directory
    // Pattern: PRD-N/runs/run-*.log or runs/run-*.log
    const runLogMatch = normalizedPath.match(
      /(?:PRD-(\d+)\/)?runs\/run-(\d{8})-(\d{6})-(\d+)-iter-(\d+)\.log$/i
    );

    if (runLogMatch && changeType === 'create') {
      const streamId = runLogMatch[1] || undefined;
      const runId = `${runLogMatch[2]}-${runLogMatch[3]}-${runLogMatch[4]}`;

      this.emit('run_started', {
        ...baseEvent,
        type: 'run_started',
        runId,
        streamId,
      });
      return;
    }

    // Detect run completed: new .md summary file in runs/ directory
    // Pattern: PRD-N/runs/run-*.md or runs/run-*.md
    const runSummaryMatch = normalizedPath.match(
      /(?:PRD-(\d+)\/)?runs\/run-(\d{8})-(\d{6})-(\d+)-iter-(\d+)\.md$/i
    );

    if (runSummaryMatch && changeType === 'create') {
      const streamId = runSummaryMatch[1] || undefined;
      const runId = `${runSummaryMatch[2]}-${runSummaryMatch[3]}-${runSummaryMatch[4]}`;

      this.emit('run_completed', {
        ...baseEvent,
        type: 'run_completed',
        runId,
        streamId,
      });
      return;
    }

    // Detect PRD update (story status change)
    // Pattern: PRD-N/prd.md
    const prdMatch = normalizedPath.match(/PRD-(\d+)\/prd\.md$/i);

    if (prdMatch && changeType === 'modify') {
      const streamId = prdMatch[1];

      this.emit('progress_updated', {
        ...baseEvent,
        type: 'progress_updated',
        streamId,
      });
      return;
    }

    // Detect plan update
    // Pattern: PRD-N/plan.md
    const planMatch = normalizedPath.match(/PRD-(\d+)\/plan\.md$/i);

    if (planMatch && changeType === 'modify') {
      const streamId = planMatch[1];

      this.emit('file_changed', {
        ...baseEvent,
        type: 'file_changed',
        streamId,
      });
      return;
    }

    // Detect progress log update
    // Pattern: PRD-N/progress.md
    const progressMatch = normalizedPath.match(/PRD-(\d+)\/progress\.md$/i);

    if (progressMatch && (changeType === 'modify' || changeType === 'create')) {
      const streamId = progressMatch[1];

      this.emit('progress_updated', {
        ...baseEvent,
        type: 'progress_updated',
        streamId,
      });
      return;
    }

    // Detect activity log update
    // Pattern: PRD-N/activity.log or activity.log
    if (normalizedPath.endsWith('activity.log')) {
      this.emit('file_changed', {
        ...baseEvent,
        type: 'file_changed',
      });
      return;
    }

    // Detect lock file changes (build start/stop)
    // Pattern: locks/*.lock
    const lockMatch = normalizedPath.match(/locks\/(\d+)\.lock$/);

    if (lockMatch) {
      const streamId = lockMatch[1];
      const eventType = changeType === 'delete' ? 'run_completed' : 'run_started';

      this.emit(eventType, {
        ...baseEvent,
        type: eventType as FileWatcherEventType,
        streamId,
      });
    }
  }

  /**
   * Set debounce interval in milliseconds
   */
  setDebounceMs(ms: number): void {
    this.debounceMs = Math.max(10, Math.min(1000, ms));
  }
}

// Export singleton instance
export const fileWatcher = new FileWatcher();

// Export class for testing
export { FileWatcher };
