/**
 * SSE (Server-Sent Events) Routes
 *
 * Provides real-time event streaming from the file watcher to connected clients.
 * Supports multiple concurrent connections with proper cleanup on disconnect.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { fileWatcher, type FileWatcherEvent, type FileWatcherEventType } from '../services/file-watcher.js';

const sse = new Hono();

/**
 * Track the number of active SSE connections
 */
let activeConnections = 0;

/**
 * GET /api/events
 *
 * Server-Sent Events endpoint for real-time updates.
 * Streams file watcher events to connected clients.
 *
 * Event format:
 *   event: {type}
 *   data: {json}
 *
 * Event types:
 *   - file_changed: A file in .ralph directory was created/modified/deleted
 *   - run_started: A new build run has started
 *   - run_completed: A build run has completed
 *   - progress_updated: Story progress has been updated
 *   - story_updated: A story status has changed
 *   - connected: Initial connection confirmation
 *   - heartbeat: Keep-alive ping (every 30 seconds)
 */
sse.get('/events', (c) => {
  return streamSSE(c, async (stream) => {
    // Increment connection counter
    activeConnections++;
    console.log(`[SSE] Client connected (${activeConnections} active connections)`);

    // Start the file watcher if not already running
    if (!fileWatcher.isActive()) {
      const started = fileWatcher.start();
      if (started) {
        console.log('[SSE] File watcher started for first client');
      } else {
        console.warn('[SSE] Failed to start file watcher');
      }
    }

    // Flag to track if the connection is still active
    let isConnected = true;

    // Create event handlers for each event type
    const eventTypes: FileWatcherEventType[] = [
      'file_changed',
      'run_started',
      'run_completed',
      'progress_updated',
      'story_updated',
    ];

    // Handler function that forwards events to the SSE stream
    const createEventHandler = (eventType: FileWatcherEventType) => {
      return async (event: FileWatcherEvent) => {
        if (!isConnected) return;

        try {
          await stream.writeSSE({
            event: eventType,
            data: JSON.stringify({
              type: event.type,
              timestamp: event.timestamp.toISOString(),
              path: event.path,
              changeType: event.changeType,
              runId: event.runId,
              streamId: event.streamId,
              storyId: event.storyId,
            }),
          });
        } catch (error) {
          // Client likely disconnected
          console.log(`[SSE] Error writing event: ${error}`);
          isConnected = false;
        }
      };
    };

    // Create and register handlers for each event type
    const handlers: Map<FileWatcherEventType, (event: FileWatcherEvent) => Promise<void>> = new Map();
    for (const eventType of eventTypes) {
      const handler = createEventHandler(eventType);
      handlers.set(eventType, handler);
      fileWatcher.on(eventType, handler);
    }

    // Send initial connection confirmation
    try {
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({
          timestamp: new Date().toISOString(),
          watcherActive: fileWatcher.isActive(),
          watchedPath: fileWatcher.getWatchedPath(),
        }),
      });
    } catch (error) {
      console.log(`[SSE] Error sending connected event: ${error}`);
      isConnected = false;
    }

    // Set up heartbeat interval to keep connection alive
    const heartbeatInterval = setInterval(async () => {
      if (!isConnected) {
        clearInterval(heartbeatInterval);
        return;
      }

      try {
        await stream.writeSSE({
          event: 'heartbeat',
          data: JSON.stringify({
            timestamp: new Date().toISOString(),
          }),
        });
      } catch (error) {
        // Client disconnected
        console.log(`[SSE] Heartbeat failed, client disconnected`);
        isConnected = false;
        clearInterval(heartbeatInterval);
      }
    }, 30000); // Send heartbeat every 30 seconds

    // Wait for abort signal (client disconnect)
    try {
      await stream.sleep(Number.MAX_SAFE_INTEGER);
    } catch {
      // Stream closed or aborted
    }

    // Cleanup on disconnect
    isConnected = false;
    clearInterval(heartbeatInterval);

    // Remove all event listeners
    for (const [eventType, handler] of handlers) {
      fileWatcher.off(eventType, handler);
    }
    handlers.clear();

    // Decrement connection counter
    activeConnections--;
    console.log(`[SSE] Client disconnected (${activeConnections} active connections)`);

    // Optionally stop the file watcher if no clients are connected
    // Note: We keep it running for a bit in case clients reconnect quickly
    if (activeConnections === 0) {
      // We could stop the watcher here, but it's lightweight to keep running
      // fileWatcher.stop();
      console.log('[SSE] No active connections, file watcher remains active');
    }
  });
});

/**
 * GET /api/events/status
 *
 * Returns the current status of the SSE service.
 * Useful for debugging and monitoring.
 */
sse.get('/events/status', (c) => {
  return c.json({
    activeConnections,
    watcherActive: fileWatcher.isActive(),
    watchedPath: fileWatcher.getWatchedPath(),
  });
});

export { sse };
