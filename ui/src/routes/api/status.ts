/**
 * Status and Log API Routes
 *
 * REST API endpoints for status, progress, fixes, and log retrieval.
 * Provides overall Ralph status, story progress, and activity/run logs.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type {
  RalphStatus,
  ProgressStats,
  Story,
  LogLevel,
  FixStats,
  FixRecord,
} from "../../types.js";
import {
  getRalphRoot,
  getMode,
  getStreams,
  getStreamDetails,
} from "../../services/state-reader.js";
import {
  parseStories,
  countStoriesByStatus,
  getCompletionPercentage,
} from "../../services/markdown-parser.js";
import {
  parseActivityLog,
  parseRunLog,
  listRunLogs,
  getRunSummary,
} from "../../services/log-parser.js";

const statusApi = new Hono();

/**
 * Parse AUTO_FIX entries from an activity.log file
 * @param logPath - Path to activity.log
 * @returns Fix statistics object
 */
function parseFixStatsFromLog(logPath: string): FixStats | null {
  try {
    if (!fs.existsSync(logPath)) {
      return null;
    }

    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.split("\n");

    const fixes: FixRecord[] = [];
    // Match AUTO_FIX log entries
    // Format: [timestamp] AUTO_FIX type=X command="Y" status=success|failure duration=Nms
    const pattern =
      /^\[([^\]]+)\] AUTO_FIX type=(\w+) command="([^"]*)" status=(\w+) duration=(\d+)ms(?:\s+error="([^"]*)")?/;

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        fixes.push({
          id: `fix-${Date.parse(match[1]) || Date.now()}-${fixes.length}`,
          type: match[2],
          command: match[3] || null,
          status: match[4] as "success" | "failure" | "skipped",
          duration: parseInt(match[5], 10),
          error: match[6] || null,
          startTime: Date.parse(match[1]) || Date.now(),
          endTime: null,
          stateChanges: null,
        });
      }
    }

    if (fixes.length === 0) {
      return null;
    }

    // Calculate summary stats
    const stats: FixStats = {
      attempted: fixes.length,
      succeeded: 0,
      failed: 0,
      byType: {},
      totalDuration: 0,
      records: fixes,
    };

    for (const fix of fixes) {
      stats.totalDuration += fix.duration || 0;

      if (fix.status === "success") {
        stats.succeeded++;
      } else if (fix.status !== "skipped") {
        stats.failed++;
      }

      if (!stats.byType[fix.type]) {
        stats.byType[fix.type] = { attempted: 0, succeeded: 0, failed: 0 };
      }
      stats.byType[fix.type].attempted++;
      if (fix.status === "success") {
        stats.byType[fix.type].succeeded++;
      } else if (fix.status !== "skipped") {
        stats.byType[fix.type].failed++;
      }
    }

    return stats;
  } catch {
    return null;
  }
}

/**
 * GET /status
 *
 * Returns overall Ralph status including mode, progress stats, and current run info.
 */
statusApi.get("/status", (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();

  // Initialize default progress stats
  let progress: ProgressStats = {
    totalStories: 0,
    completedStories: 0,
    inProgressStories: 0,
    pendingStories: 0,
    completionPercentage: 0,
  };

  // Calculate progress based on mode
  if (mode === "multi") {
    const streams = getStreams();
    // Aggregate progress across all streams
    let totalStories = 0;
    let completedStories = 0;

    for (const stream of streams) {
      totalStories += stream.totalStories;
      completedStories += stream.completedStories;
    }

    const pendingStories = totalStories - completedStories;
    progress = {
      totalStories,
      completedStories,
      inProgressStories: 0, // Would need to parse all PRDs for accurate count
      pendingStories,
      completionPercentage:
        totalStories > 0
          ? Math.round((completedStories / totalStories) * 100)
          : 0,
    };
  } else if (mode === "single" && rootPath) {
    // Read single PRD file
    const prdPath = path.join(rootPath, "prd.md");
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, "utf-8");
        const stories = parseStories(prdContent);
        const counts = countStoriesByStatus(stories);

        progress = {
          totalStories: counts.total,
          completedStories: counts.completed,
          inProgressStories: counts.inProgress,
          pendingStories: counts.pending,
          completionPercentage: getCompletionPercentage(stories),
        };
      } catch {
        // Use default progress
      }
    }
  }

  // Check for currently running process (by looking for lock files)
  let isRunning = false;
  if (rootPath) {
    const locksPath = path.join(rootPath, "locks");
    if (fs.existsSync(locksPath)) {
      try {
        const locks = fs.readdirSync(locksPath);
        isRunning = locks.some((lock) => lock.endsWith(".lock"));
      } catch {
        // Ignore errors
      }
    }
  }

  // Parse fix statistics from activity.log (US-003)
  let fixStats: FixStats | undefined;
  if (rootPath) {
    // Try multi-stream mode first (active stream's activity.log)
    if (mode === "multi") {
      const streams = getStreams();
      if (streams.length > 0) {
        // Use the last/active stream
        const activeStream = streams[streams.length - 1];
        const streamPath = path.join(rootPath, `PRD-${activeStream.id}`);
        const activityLogPath = path.join(streamPath, "activity.log");
        const stats = parseFixStatsFromLog(activityLogPath);
        if (stats) {
          fixStats = stats;
        }
      }
    } else if (mode === "single") {
      // Single mode: check root .ralph/activity.log
      const activityLogPath = path.join(rootPath, "activity.log");
      const stats = parseFixStatsFromLog(activityLogPath);
      if (stats) {
        fixStats = stats;
      }
    }
  }

  const status: RalphStatus = {
    mode,
    rootPath,
    progress,
    isRunning,
    fixStats,
  };

  return c.json(status);
});

/**
 * GET /progress
 *
 * Returns story list with completion status for the active stream.
 * In multi-stream mode, uses the most recently modified PRD.
 */
statusApi.get("/progress", (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();

  if (!rootPath) {
    return c.json({
      stories: [],
      stats: {
        total: 0,
        completed: 0,
        inProgress: 0,
        pending: 0,
        completionPercentage: 0,
      },
    });
  }

  let stories: Story[] = [];

  if (mode === "multi") {
    // Get the stream with the most recent activity (highest PRD number as proxy)
    const streams = getStreams();
    if (streams.length > 0) {
      // Use the last stream (highest number) as the "active" one
      const activeStream = streams[streams.length - 1];
      const details = getStreamDetails(activeStream.id);
      if (details) {
        stories = details.stories;
      }
    }
  } else if (mode === "single") {
    // Read single PRD file
    const prdPath = path.join(rootPath, "prd.md");
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, "utf-8");
        stories = parseStories(prdContent);
      } catch {
        // Return empty stories
      }
    }
  }

  const counts = countStoriesByStatus(stories);

  return c.json({
    stories,
    stats: {
      total: counts.total,
      completed: counts.completed,
      inProgress: counts.inProgress,
      pending: counts.pending,
      completionPercentage: getCompletionPercentage(stories),
    },
  });
});

/**
 * GET /fixes
 *
 * Returns fix statistics for auto-remediation tracking (US-003).
 * Supports optional stream parameter to get fixes for a specific stream.
 */
statusApi.get("/fixes", (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();
  const streamParam = c.req.query("stream");

  if (!rootPath) {
    return c.json({
      fixStats: null,
      message: "No Ralph root found",
    });
  }

  let fixStats: FixStats | null = null;

  if (streamParam) {
    // Get fixes for specific stream
    const streamPath = path.join(rootPath, `PRD-${streamParam}`);
    const activityLogPath = path.join(streamPath, "activity.log");
    fixStats = parseFixStatsFromLog(activityLogPath);
  } else if (mode === "multi") {
    // Aggregate fixes across all streams
    const streams = getStreams();
    const allFixes: FixRecord[] = [];

    for (const stream of streams) {
      const streamPath = path.join(rootPath, `PRD-${stream.id}`);
      const activityLogPath = path.join(streamPath, "activity.log");
      const stats = parseFixStatsFromLog(activityLogPath);
      if (stats) {
        allFixes.push(...stats.records);
      }
    }

    if (allFixes.length > 0) {
      fixStats = {
        attempted: allFixes.length,
        succeeded: allFixes.filter((f) => f.status === "success").length,
        failed: allFixes.filter((f) => f.status === "failure").length,
        byType: {},
        totalDuration: allFixes.reduce((sum, f) => sum + (f.duration || 0), 0),
        records: allFixes,
      };

      // Calculate byType
      for (const fix of allFixes) {
        if (!fixStats.byType[fix.type]) {
          fixStats.byType[fix.type] = { attempted: 0, succeeded: 0, failed: 0 };
        }
        fixStats.byType[fix.type].attempted++;
        if (fix.status === "success") {
          fixStats.byType[fix.type].succeeded++;
        } else if (fix.status !== "skipped") {
          fixStats.byType[fix.type].failed++;
        }
      }
    }
  } else if (mode === "single") {
    const activityLogPath = path.join(rootPath, "activity.log");
    fixStats = parseFixStatsFromLog(activityLogPath);
  }

  return c.json({
    fixStats,
    mode,
    stream: streamParam || null,
  });
});

/**
 * Log API Endpoints
 *
 * REST API endpoints for activity and run logs.
 */

/**
 * GET /logs/activity
 *
 * Returns parsed activity log entries with optional filtering.
 * Query params:
 *   - streamId: Filter to specific stream (e.g., "3" for PRD-3)
 *   - limit: Maximum number of entries to return (default: 50)
 *   - offset: Number of entries to skip (default: 0)
 *   - level: Filter by minimum log level (error, warning, info, debug)
 *
 * Returns entries in reverse chronological order (newest first).
 */
statusApi.get("/logs/activity", (c) => {
  // Parse query parameters
  const streamId = c.req.query("streamId");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const levelFilter = c.req.query("level") as LogLevel | undefined;

  // Validate limit and offset
  const validLimit = Math.min(Math.max(1, limit), 500); // Cap at 500
  const validOffset = Math.max(0, offset);

  // Parse activity logs
  let entries = parseActivityLog(streamId);

  // Filter by log level if specified
  if (levelFilter) {
    const levelPriority: Record<LogLevel, number> = {
      error: 4,
      warning: 3,
      info: 2,
      debug: 1,
    };

    const minPriority = levelPriority[levelFilter] || 0;
    entries = entries.filter(
      (entry) => levelPriority[entry.level] >= minPriority
    );
  }

  // Apply pagination
  const totalCount = entries.length;
  const paginatedEntries = entries.slice(validOffset, validOffset + validLimit);

  // Transform entries for JSON response (convert Date to ISO string)
  const responseEntries = paginatedEntries.map((entry) => ({
    timestamp: entry.timestamp.toISOString(),
    level: entry.level,
    message: entry.message,
    source: entry.source,
    runId: entry.runId,
  }));

  return c.json({
    entries: responseEntries,
    pagination: {
      total: totalCount,
      limit: validLimit,
      offset: validOffset,
      hasMore: validOffset + validLimit < totalCount,
    },
  });
});

/**
 * GET /logs/run/:runId
 *
 * Returns specific run log content with parsed verification results.
 * Query params:
 *   - streamId: Optional stream ID (searches all streams if not provided)
 *   - iteration: Optional iteration number
 *   - limit: Maximum number of log lines to return (default: 200)
 *   - offset: Number of lines to skip (default: 0)
 *   - level: Filter by minimum log level (error, warning, info, debug)
 *
 * Returns run log data including entries and summary if available.
 */
statusApi.get("/logs/run/:runId", (c) => {
  const runId = c.req.param("runId");
  const streamId = c.req.query("streamId");
  const iterationStr = c.req.query("iteration");
  const limit = parseInt(c.req.query("limit") || "200", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const levelFilter = c.req.query("level") as LogLevel | undefined;

  // Validate limit and offset
  const validLimit = Math.min(Math.max(1, limit), 1000); // Cap at 1000 for run logs
  const validOffset = Math.max(0, offset);

  // Parse iteration if provided
  const iteration = iterationStr ? parseInt(iterationStr, 10) : undefined;

  // Parse run log
  let entries = parseRunLog(runId, streamId, iteration);

  if (entries.length === 0) {
    return c.json(
      {
        error: "not_found",
        message: `Run log for ${runId} not found`,
      },
      404
    );
  }

  // Filter by log level if specified
  if (levelFilter) {
    const levelPriority: Record<LogLevel, number> = {
      error: 4,
      warning: 3,
      info: 2,
      debug: 1,
    };

    const minPriority = levelPriority[levelFilter] || 0;
    entries = entries.filter(
      (entry) => levelPriority[entry.level] >= minPriority
    );
  }

  // Apply pagination
  const totalCount = entries.length;
  const paginatedEntries = entries.slice(validOffset, validOffset + validLimit);

  // Transform entries for JSON response
  const responseEntries = paginatedEntries.map((entry) => ({
    timestamp: entry.timestamp.toISOString(),
    level: entry.level,
    message: entry.message,
    source: entry.source,
    runId: entry.runId,
  }));

  // Try to get summary if streamId and iteration are available
  let summary = null;
  if (streamId && iteration !== undefined) {
    summary = getRunSummary(runId, streamId, iteration);
  }

  return c.json({
    runId,
    streamId: streamId || null,
    iteration: iteration ?? null,
    entries: responseEntries,
    summary,
    pagination: {
      total: totalCount,
      limit: validLimit,
      offset: validOffset,
      hasMore: validOffset + validLimit < totalCount,
    },
  });
});

/**
 * GET /logs/runs
 *
 * Lists all available run logs for a stream.
 * Query params:
 *   - streamId: Stream ID (required)
 *
 * Returns array of run info objects.
 */
statusApi.get("/logs/runs", (c) => {
  const streamId = c.req.query("streamId");

  if (!streamId) {
    return c.json(
      {
        error: "bad_request",
        message: "streamId query parameter is required",
      },
      400
    );
  }

  const runs = listRunLogs(streamId);

  return c.json({
    streamId,
    runs: runs.map((run) => ({
      runId: run.runId,
      iteration: run.iteration,
      logPath: run.logPath,
      hasSummary: run.hasSummary,
    })),
    count: runs.length,
  });
});

export { statusApi };
