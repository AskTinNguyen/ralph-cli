/**
 * API Routes
 *
 * REST API endpoints for status, progress, and streams.
 * Provides data to the UI for displaying Ralph CLI state.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { RalphStatus, ProgressStats, Stream, Story, LogEntry, LogLevel, BuildOptions, FixStats, FixRecord, FixTypeStats } from '../types.js';
import { getRalphRoot, getMode, getStreams, getStreamDetails } from '../services/state-reader.js';
import { parseStories, countStoriesByStatus, getCompletionPercentage } from '../services/markdown-parser.js';
import { parseActivityLog, parseRunLog, listRunLogs, getRunSummary } from '../services/log-parser.js';
import { getTokenSummary, getStreamTokens, getStoryTokens, getRunTokens, getTokenTrends, getBudgetStatus, calculateModelEfficiency, compareModels, getModelRecommendations, getAllRunsForEfficiency } from '../services/token-reader.js';
import { getStreamEstimate } from '../services/estimate-reader.js';
import { processManager } from '../services/process-manager.js';
import { wizardProcessManager, type WizardOutputEvent } from '../services/wizard-process-manager.js';
import { getSuccessRateTrends, getWeekOverWeek, getFilterOptions, formatForChart, getCostTrends, getCostTrendsWithBudget, getCostFilterOptions, formatCostForChart, formatModelBreakdownForChart, getVelocityTrends, getBurndown, getStreamVelocityComparison, formatVelocityForChart, formatBurndownForChart, formatStreamComparisonForChart, getExportData, exportToCsv } from '../services/trends.js';
import type { ExportOptions } from '../services/trends.js';
import { createRequire } from 'node:module';

// Import CommonJS accuracy and estimate modules
const require = createRequire(import.meta.url);
const { generateAccuracyReport, loadEstimates, saveEstimate } = require('../../../lib/estimate/accuracy.js');
const { estimate } = require('../../../lib/estimate/index.js');
// Rollback analytics (US-004)
const { getRollbackAnalytics, getRollbackStats, loadMetrics } = require('../../../lib/estimate/metrics.js');
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const api = new Hono();

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

    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.split('\n');

    const fixes: FixRecord[] = [];
    // Match AUTO_FIX log entries
    // Format: [timestamp] AUTO_FIX type=X command="Y" status=success|failure duration=Nms
    const pattern = /^\[([^\]]+)\] AUTO_FIX type=(\w+) command="([^"]*)" status=(\w+) duration=(\d+)ms(?:\s+error="([^"]*)")?/;

    for (const line of lines) {
      const match = line.match(pattern);
      if (match) {
        fixes.push({
          id: `fix-${Date.parse(match[1]) || Date.now()}-${fixes.length}`,
          type: match[2],
          command: match[3] || null,
          status: match[4] as 'success' | 'failure' | 'skipped',
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

      if (fix.status === 'success') {
        stats.succeeded++;
      } else if (fix.status !== 'skipped') {
        stats.failed++;
      }

      if (!stats.byType[fix.type]) {
        stats.byType[fix.type] = { attempted: 0, succeeded: 0, failed: 0 };
      }
      stats.byType[fix.type].attempted++;
      if (fix.status === 'success') {
        stats.byType[fix.type].succeeded++;
      } else if (fix.status !== 'skipped') {
        stats.byType[fix.type].failed++;
      }
    }

    return stats;
  } catch {
    return null;
  }
}

/**
 * GET /api/status
 *
 * Returns overall Ralph status including mode, progress stats, and current run info.
 */
api.get("/status", (c) => {
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
        totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0,
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
    if (mode === 'multi') {
      const streams = getStreams();
      if (streams.length > 0) {
        // Use the last/active stream
        const activeStream = streams[streams.length - 1];
        const streamPath = path.join(rootPath, `PRD-${activeStream.id}`);
        const activityLogPath = path.join(streamPath, 'activity.log');
        const stats = parseFixStatsFromLog(activityLogPath);
        if (stats) {
          fixStats = stats;
        }
      }
    } else if (mode === 'single') {
      // Single mode: check root .ralph/activity.log
      const activityLogPath = path.join(rootPath, 'activity.log');
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
 * GET /api/progress
 *
 * Returns story list with completion status for the active stream.
 * In multi-stream mode, uses the most recently modified PRD.
 */
api.get("/progress", (c) => {
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
 * GET /api/fixes
 *
 * Returns fix statistics for auto-remediation tracking (US-003).
 * Supports optional stream parameter to get fixes for a specific stream.
 */
api.get('/fixes', (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();
  const streamParam = c.req.query('stream');

  if (!rootPath) {
    return c.json({
      fixStats: null,
      message: 'No Ralph root found',
    });
  }

  let fixStats: FixStats | null = null;

  if (streamParam) {
    // Get fixes for specific stream
    const streamPath = path.join(rootPath, `PRD-${streamParam}`);
    const activityLogPath = path.join(streamPath, 'activity.log');
    fixStats = parseFixStatsFromLog(activityLogPath);
  } else if (mode === 'multi') {
    // Aggregate fixes across all streams
    const streams = getStreams();
    const allFixes: FixRecord[] = [];

    for (const stream of streams) {
      const streamPath = path.join(rootPath, `PRD-${stream.id}`);
      const activityLogPath = path.join(streamPath, 'activity.log');
      const stats = parseFixStatsFromLog(activityLogPath);
      if (stats) {
        allFixes.push(...stats.records);
      }
    }

    if (allFixes.length > 0) {
      fixStats = {
        attempted: allFixes.length,
        succeeded: allFixes.filter(f => f.status === 'success').length,
        failed: allFixes.filter(f => f.status === 'failure').length,
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
        if (fix.status === 'success') {
          fixStats.byType[fix.type].succeeded++;
        } else if (fix.status !== 'skipped') {
          fixStats.byType[fix.type].failed++;
        }
      }
    }
  } else if (mode === 'single') {
    const activityLogPath = path.join(rootPath, 'activity.log');
    fixStats = parseFixStatsFromLog(activityLogPath);
  }

  return c.json({
    fixStats,
    mode,
    stream: streamParam || null,
  });
});

/**
 * GET /api/streams
 *
 * Returns all streams with status information.
 */
api.get("/streams", (c) => {
  const streams = getStreams();

  // Map to response format with additional computed fields
  const response = streams.map((stream) => ({
    id: stream.id,
    name: stream.name,
    status: stream.status,
    hasPrd: stream.hasPrd,
    hasPlan: stream.hasPlan,
    hasProgress: stream.hasProgress,
    totalStories: stream.totalStories,
    completedStories: stream.completedStories,
    completionPercentage:
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0,
  }));

  return c.json({
    streams: response,
    count: streams.length,
  });
});

/**
 * GET /api/streams/:id
 *
 * Returns detailed information for a specific stream.
 */
api.get("/streams/:id", (c) => {
  const id = c.req.param("id");

  const stream = getStreamDetails(id);

  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Compute additional stats
  const completionPercentage =
    stream.totalStories > 0 ? Math.round((stream.completedStories / stream.totalStories) * 100) : 0;

  const inProgressStories = stream.stories.filter((s) => s.status === "in-progress").length;
  const pendingStories = stream.stories.filter((s) => s.status === "pending").length;

  return c.json({
    id: stream.id,
    name: stream.name,
    path: stream.path,
    status: stream.status,
    hasPrd: stream.hasPrd,
    hasPlan: stream.hasPlan,
    hasProgress: stream.hasProgress,
    stories: stream.stories,
    stats: {
      total: stream.totalStories,
      completed: stream.completedStories,
      inProgress: inProgressStories,
      pending: pendingStories,
      completionPercentage,
    },
    runs: stream.runs.map((run) => ({
      id: run.id,
      iteration: run.iteration,
      startedAt: run.startedAt.toISOString(),
      status: run.status,
      storyId: run.storyId,
      storyTitle: run.storyTitle,
      logPath: run.logPath,
      hasSummary: !!run.summaryPath,
    })),
    lastRun: stream.lastRun
      ? {
          id: stream.lastRun.id,
          iteration: stream.lastRun.iteration,
          startedAt: stream.lastRun.startedAt.toISOString(),
          status: stream.lastRun.status,
        }
      : null,
  });
});

/**
 * Estimate API Endpoints
 *
 * REST API endpoints for PRD estimation data.
 */

/**
 * GET /api/estimate/:prdId
 *
 * Returns JSON estimate for the specified PRD.
 * Query params:
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 *   - force: Force fresh calculation, bypass cache (default: false)
 *
 * Response includes all fields from `ralph estimate --json`:
 *   - estimates[]: Array of story estimates with complexity, duration, tokens, cost
 *   - totals: Aggregate totals for pending stories
 *   - cached: Whether result was served from cache
 *   - cachedAt: Cache timestamp if applicable
 */
api.get('/estimate/:prdId', (c) => {
  const prdId = c.req.param('prdId');
  const model = c.req.query('model') || 'sonnet';
  const force = c.req.query('force') === 'true';

  // Validate model parameter
  if (model !== 'sonnet' && model !== 'opus') {
    return c.json(
      {
        error: 'bad_request',
        message: 'Invalid model parameter. Must be "sonnet" or "opus".',
      },
      400
    );
  }

  const result = getStreamEstimate(prdId, { model, force });

  if (!result.success) {
    return c.json(
      {
        error: 'not_found',
        message: result.error || `PRD-${prdId} not found or missing plan.md`,
      },
      404
    );
  }

  return c.json({
    prdId,
    estimates: result.estimates,
    totals: result.totals,
    cached: result.cached,
    cachedAt: result.cachedAt,
    planModifiedAt: result.planModifiedAt,
  });
});

/**
 * GET /api/streams/:id/estimate
 *
 * Alternative endpoint for getting PRD estimates.
 * Consistent with existing streams API pattern.
 * Query params same as /api/estimate/:prdId
 */
api.get('/streams/:id/estimate', (c) => {
  const id = c.req.param('id');
  const model = c.req.query('model') || 'sonnet';
  const force = c.req.query('force') === 'true';

  // Validate model parameter
  if (model !== 'sonnet' && model !== 'opus') {
    return c.json(
      {
        error: 'bad_request',
        message: 'Invalid model parameter. Must be "sonnet" or "opus".',
      },
      400
    );
  }

  const result = getStreamEstimate(id, { model, force });

  if (!result.success) {
    return c.json(
      {
        error: 'not_found',
        message: result.error || `PRD-${id} not found or missing plan.md`,
      },
      404
    );
  }

  return c.json({
    prdId: id,
    estimates: result.estimates,
    totals: result.totals,
    cached: result.cached,
    cachedAt: result.cachedAt,
    planModifiedAt: result.planModifiedAt,
  });
});

/**
 * GET /api/estimate/:prdId/accuracy
 *
 * Returns JSON accuracy report comparing estimates vs actual results.
 * Calls generateAccuracyReport from lib/estimate/accuracy.js
 *
 * Response includes:
 *   - comparisons[]: Array of estimate-to-actual comparisons with deviations
 *   - accuracy: Overall MAPE metrics
 *   - trend: Trend analysis (improving/stable/degrading)
 *   - summary: Metadata about estimates and metrics count
 *
 * Returns empty data structure (not 404) if no comparisons exist.
 */
api.get('/estimate/:prdId/accuracy', (c) => {
  const prdId = c.req.param('prdId');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_found',
        message: 'Ralph root directory not found',
      },
      404
    );
  }

  const prdFolder = path.join(ralphRoot, `PRD-${prdId}`);

  if (!fs.existsSync(prdFolder)) {
    return c.json(
      {
        error: 'not_found',
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const report = generateAccuracyReport(prdFolder);

  if (!report.success) {
    return c.json(
      {
        error: 'internal_error',
        message: report.error || 'Failed to generate accuracy report',
      },
      500
    );
  }

  // Return report even if no data exists (empty comparisons array)
  return c.json({
    prdId,
    hasData: report.hasData || false,
    message: report.message || null,
    comparisons: report.comparisons || [],
    accuracy: report.accuracy || null,
    trend: report.trend || null,
    summary: report.summary || null,
  });
});

/**
 * GET /api/estimate/:prdId/history
 *
 * Returns historical estimates for a PRD with pagination support.
 * Query params:
 *   - limit: Maximum number of estimates to return (default: 10)
 *   - offset: Number of estimates to skip (default: 0)
 *
 * Response includes:
 *   - estimates[]: Array of saved estimates with timestamps
 *   - total: Total number of estimates available
 *   - limit: Limit used
 *   - offset: Offset used
 */
api.get('/estimate/:prdId/history', (c) => {
  const prdId = c.req.param('prdId');
  const limit = parseInt(c.req.query('limit') || '10', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_found',
        message: 'Ralph root directory not found',
      },
      404
    );
  }

  const prdFolder = path.join(ralphRoot, `PRD-${prdId}`);

  if (!fs.existsSync(prdFolder)) {
    return c.json(
      {
        error: 'not_found',
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const result = loadEstimates(prdFolder);

  if (!result.success) {
    return c.json(
      {
        error: 'internal_error',
        message: result.error || 'Failed to load estimates',
      },
      500
    );
  }

  // Sort by timestamp descending (newest first)
  const sortedEstimates = (result.estimates || []).sort(
    (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply pagination
  const total = sortedEstimates.length;
  const validLimit = Math.min(Math.max(1, limit), 100); // Cap at 100
  const validOffset = Math.max(0, offset);
  const paginatedEstimates = sortedEstimates.slice(validOffset, validOffset + validLimit);

  return c.json({
    prdId,
    estimates: paginatedEstimates,
    total,
    limit: validLimit,
    offset: validOffset,
  });
});

/**
 * POST /api/estimate/:prdId/run
 *
 * Triggers a fresh estimate calculation and updates the cache.
 * Query params:
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 *   - force: Always true for POST (forces recalculation)
 * Returns: JSON estimate with cached: false and fresh cachedAt timestamp
 */
api.post('/estimate/:prdId/run', (c) => {
  const prdId = c.req.param('prdId');
  const model = c.req.query('model') || 'sonnet';

  // Validate model parameter
  if (model !== 'sonnet' && model !== 'opus') {
    return c.json(
      {
        error: 'bad_request',
        message: 'Invalid model parameter. Must be "sonnet" or "opus".',
      },
      400
    );
  }

  // Force fresh calculation
  const result = getStreamEstimate(prdId, { model, force: true });

  if (!result.success) {
    return c.json(
      {
        error: 'not_found',
        message: result.error || `PRD-${prdId} not found or missing plan.md`,
      },
      404
    );
  }

  return c.json({
    prdId,
    estimates: result.estimates,
    totals: result.totals,
    cached: false,
    cachedAt: result.cachedAt,
    planModifiedAt: result.planModifiedAt,
  });
});

/**
 * Log API Endpoints
 *
 * REST API endpoints for activity and run logs.
 */

/**
 * GET /api/logs/activity
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
api.get("/logs/activity", (c) => {
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
    entries = entries.filter((entry) => levelPriority[entry.level] >= minPriority);
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
 * GET /api/logs/run/:runId
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
api.get("/logs/run/:runId", (c) => {
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
    entries = entries.filter((entry) => levelPriority[entry.level] >= minPriority);
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
 * GET /api/logs/runs
 *
 * Lists all available run logs for a stream.
 * Query params:
 *   - streamId: Stream ID (required)
 *
 * Returns array of run info objects.
 */
api.get("/logs/runs", (c) => {
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

/**
 * Build Control API Endpoints
 *
 * REST API endpoints for starting, stopping, and monitoring Ralph builds.
 */

/**
 * Valid agent types for builds
 */
const VALID_AGENTS = ["claude", "codex", "droid"] as const;

/**
 * POST /api/build/start
 *
 * Start a new build process.
 * Request body: { iterations: number, stream?: string, agent?: string, noCommit?: boolean }
 *
 * Returns:
 *   - 200 with { success: true, status: BuildStatus } on success
 *   - 400 for invalid parameters
 *   - 409 Conflict if build already running
 */
api.post("/build/start", async (c) => {
  let body: {
    iterations?: number;
    stream?: string;
    agent?: string;
    noCommit?: boolean;
  };

  // Try to parse as JSON first, then fall back to form data
  const contentType = c.req.header("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else {
      // Parse form-encoded data
      const formData = await c.req.parseBody();
      body = {
        iterations: formData.iterations ? parseInt(formData.iterations as string, 10) : undefined,
        stream: formData.stream && formData.stream !== "" ? (formData.stream as string) : undefined,
        agent: formData.agent as string | undefined,
        noCommit: formData.noCommit === "true" || formData.noCommit === "on",
      };
    }
  } catch {
    return c.json(
      {
        error: "bad_request",
        message: "Invalid request body",
      },
      400
    );
  }

  // Validate iterations
  const iterations = body.iterations;
  if (iterations === undefined || iterations === null) {
    return c.json(
      {
        error: "bad_request",
        message: "Missing required parameter: iterations",
      },
      400
    );
  }

  if (typeof iterations !== "number" || !Number.isInteger(iterations)) {
    return c.json(
      {
        error: "bad_request",
        message: "Parameter iterations must be an integer",
      },
      400
    );
  }

  if (iterations < 1 || iterations > 100) {
    return c.json(
      {
        error: "bad_request",
        message: "Parameter iterations must be between 1 and 100",
      },
      400
    );
  }

  // Validate agent if provided
  if (body.agent !== undefined && body.agent !== null) {
    if (!VALID_AGENTS.includes(body.agent as (typeof VALID_AGENTS)[number])) {
      return c.json(
        {
          error: "bad_request",
          message: `Invalid agent: ${body.agent}. Must be one of: ${VALID_AGENTS.join(", ")}`,
        },
        400
      );
    }
  }

  // Check if build is already running
  if (processManager.isRunning()) {
    const currentStatus = processManager.getBuildStatus();
    return c.json(
      {
        error: "conflict",
        message: "A build is already running. Stop it first before starting a new one.",
        status: {
          state: currentStatus.state,
          pid: currentStatus.pid,
          startedAt: currentStatus.startedAt?.toISOString(),
          command: currentStatus.command,
          options: currentStatus.options,
        },
      },
      409
    );
  }

  // Build options
  const options: Partial<BuildOptions> = {};
  if (body.stream) {
    options.stream = body.stream;
  }
  if (body.agent) {
    options.agent = body.agent as BuildOptions["agent"];
  }
  if (body.noCommit !== undefined) {
    options.noCommit = body.noCommit;
  }

  // Check budget before starting build
  const budgetStatus = getBudgetStatus();
  if (budgetStatus.shouldPause) {
    let reason = "Budget exceeded";
    if (budgetStatus.daily.exceeded && budgetStatus.daily.limit !== null) {
      reason = `Daily budget exceeded ($${budgetStatus.daily.spent.toFixed(2)}/$${budgetStatus.daily.limit.toFixed(2)})`;
    } else if (budgetStatus.monthly.exceeded && budgetStatus.monthly.limit !== null) {
      reason = `Monthly budget exceeded ($${budgetStatus.monthly.spent.toFixed(2)}/$${budgetStatus.monthly.limit.toFixed(2)})`;
    }
    return c.json(
      {
        error: "budget_exceeded",
        message: `${reason}. Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
        budgetStatus: {
          daily: {
            spent: budgetStatus.daily.spent,
            limit: budgetStatus.daily.limit,
            exceeded: budgetStatus.daily.exceeded,
          },
          monthly: {
            spent: budgetStatus.monthly.spent,
            limit: budgetStatus.monthly.limit,
            exceeded: budgetStatus.monthly.exceeded,
          },
        },
      },
      403
    );
  }

  // Auto-save estimate before starting build
  // This creates a snapshot for later accuracy comparison
  if (body.stream) {
    try {
      const ralphRoot = getRalphRoot();
      if (ralphRoot) {
        const prdFolder = path.join(ralphRoot, `PRD-${body.stream}`);
        const planPath = path.join(prdFolder, 'plan.md');

        // Only save estimate if plan exists
        if (fs.existsSync(planPath)) {
          const estimateResult = estimate(prdFolder, {
            model: body.agent === 'opus' ? 'opus' : 'sonnet',
          });

          if (estimateResult.success) {
            const saveResult = saveEstimate(prdFolder, estimateResult);
            if (saveResult.success) {
              console.log(`[AUTO-SAVE] Saved estimate for PRD-${body.stream} before build`);
            } else {
              console.warn(`[AUTO-SAVE] Failed to save estimate: ${saveResult.error}`);
            }
          }
        }
      }
    } catch (err) {
      // Log error but don't block the build
      console.warn(`[AUTO-SAVE] Error saving estimate: ${err}`);
    }
  }

  // Start the build
  const status = processManager.startBuild(iterations, options);

  // Check if there was an error starting
  if (status.state === "error") {
    return c.json(
      {
        error: "internal_error",
        message: status.error || "Failed to start build",
      },
      500
    );
  }

  return c.json({
    success: true,
    status: {
      state: status.state,
      pid: status.pid,
      startedAt: status.startedAt?.toISOString(),
      command: status.command,
      options: status.options,
    },
  });
});

/**
 * POST /api/build/stop
 *
 * Stop the currently running build process.
 *
 * Returns:
 *   - 200 with { success: true } on success
 *   - 404 if no build is running
 */
api.post("/build/stop", (c) => {
  // Check if a build is running
  if (!processManager.isRunning()) {
    return c.json(
      {
        error: "not_found",
        message: "No build is currently running",
      },
      404
    );
  }

  const status = processManager.stopBuild();

  // Check for errors
  if (status.error && status.state === "error") {
    return c.json(
      {
        error: "internal_error",
        message: status.error,
      },
      500
    );
  }

  return c.json({
    success: true,
    message: "Build stop signal sent",
  });
});

/**
 * GET /api/build/status
 *
 * Get the current build status.
 *
 * Returns:
 *   - 200 with current build state
 */
api.get("/build/status", (c) => {
  const status = processManager.getBuildStatus();

  return c.json({
    state: status.state,
    pid: status.pid,
    startedAt: status.startedAt?.toISOString(),
    command: status.command,
    options: status.options,
    error: status.error,
  });
});

/**
 * POST /api/plan/start
 *
 * Start a new plan process (ralph plan command).
 * Request body: { stream?: string } - optional stream to plan for
 *
 * Note: This is a simplified implementation that runs ralph plan.
 * For a full implementation, the process manager would need to be
 * extended to handle plan processes separately from build processes.
 *
 * Returns:
 *   - 200 with { success: true, status: BuildStatus } on success
 *   - 409 Conflict if a process is already running
 */
api.post("/plan/start", async (c) => {
  // Check if build is already running (plan and build share the process manager)
  if (processManager.isRunning()) {
    const currentStatus = processManager.getBuildStatus();
    return c.json(
      {
        error: "conflict",
        message: "A process is already running. Stop it first before starting a new one.",
        status: {
          state: currentStatus.state,
          pid: currentStatus.pid,
          startedAt: currentStatus.startedAt?.toISOString(),
          command: currentStatus.command,
        },
      },
      409
    );
  }

  // For plan, we spawn the process directly since it's not a build
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "internal_error",
        message: 'Cannot start plan: .ralph directory not found. Run "ralph install" first.',
      },
      500
    );
  }

  // Get optional stream parameter
  let body: { stream?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is ok for plan
  }

  const projectRoot = path.dirname(ralphRoot);

  // Spawn the ralph plan process
  const args = ["plan"];
  if (body.stream) {
    args.push(`--prd=${body.stream}`);
  }

  try {
    const childProcess = spawn("ralph", args, {
      cwd: projectRoot,
      env: { ...process.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!childProcess.pid) {
      return c.json(
        {
          error: "internal_error",
          message: "Failed to start plan process: no PID assigned",
        },
        500
      );
    }

    const command = `ralph ${args.join(" ")}`;
    console.log(`[API] Started plan: ${command} (PID: ${childProcess.pid})`);

    return c.json({
      success: true,
      status: {
        state: "running",
        pid: childProcess.pid,
        startedAt: new Date().toISOString(),
        command,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to start plan: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * HTML Partial Endpoints for HTMX
 *
 * These endpoints return HTML fragments for HTMX to swap into the page.
 */

/**
 * GET /api/partials/progress
 *
 * Returns HTML fragment for the progress bar section.
 * Query params:
 *   - streamId: Optional stream ID to show progress for specific stream
 */
api.get("/partials/progress", (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();
  const requestedStreamId = c.req.query("streamId");

  // Handle missing .ralph directory
  if (!rootPath) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128194;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No .ralph directory found</h3>
  <p class="rams-text-muted">Run <code class="rams-code">ralph init</code> or <code class="rams-code">ralph prd</code> to get started.</p>
</div>
`);
  }

  let totalStories = 0;
  let completedStories = 0;
  let inProgressStories = 0;
  let pendingStories = 0;

  if (mode === "multi") {
    const streams = getStreams();

    // If a specific stream is requested, use that; otherwise aggregate all streams
    if (requestedStreamId) {
      const stream = streams.find((s) => s.id === requestedStreamId);
      if (stream) {
        totalStories = stream.totalStories;
        completedStories = stream.completedStories;
        const details = getStreamDetails(requestedStreamId);
        if (details) {
          const counts = countStoriesByStatus(details.stories);
          inProgressStories = counts.inProgress;
          pendingStories = counts.pending;
        } else {
          pendingStories = totalStories - completedStories;
        }
      }
    } else {
      // Aggregate all streams
      for (const stream of streams) {
        totalStories += stream.totalStories;
        completedStories += stream.completedStories;
      }
      pendingStories = totalStories - completedStories;
    }
  } else if (mode === "single" && rootPath) {
    const prdPath = path.join(rootPath, "prd.md");
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, "utf-8");
        const stories = parseStories(prdContent);
        const counts = countStoriesByStatus(stories);
        totalStories = counts.total;
        completedStories = counts.completed;
        inProgressStories = counts.inProgress;
        pendingStories = counts.pending;
      } catch {
        // Use default values
      }
    }
  }

  const percentage = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

  // Handle case when there are no stories yet
  if (totalStories === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No stories found</h3>
  <p class="rams-text-muted">Create a PRD with user stories using <code class="rams-code">ralph prd</code> to track progress.</p>
</div>
`);
  }

  const html = `
<div class="rams-card">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
    <span class="rams-text-sm">${completedStories} of ${totalStories} stories completed</span>
    <span class="rams-label">${percentage}%</span>
  </div>
  <div class="rams-progress" style="margin-bottom: var(--rams-space-4);">
    <div class="rams-progress-fill" style="width: ${percentage}%"></div>
  </div>
  <div style="display: flex; gap: var(--rams-space-6); flex-wrap: wrap;">
    <div style="display: flex; align-items: center; gap: var(--rams-space-2);">
      <span class="rams-badge-dot" style="background: var(--rams-success);"></span>
      <span class="rams-text-sm">${completedStories} Completed</span>
    </div>
    <div style="display: flex; align-items: center; gap: var(--rams-space-2);">
      <span class="rams-badge-dot" style="background: var(--rams-warning);"></span>
      <span class="rams-text-sm">${inProgressStories} In Progress</span>
    </div>
    <div style="display: flex; align-items: center; gap: var(--rams-space-2);">
      <span class="rams-badge-dot" style="background: var(--rams-gray-400);"></span>
      <span class="rams-text-sm">${pendingStories} Pending</span>
    </div>
  </div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/stories
 *
 * Returns HTML fragment for the story cards grid.
 * Query params:
 *   - streamId: Optional stream ID to show stories for specific stream
 */
api.get("/partials/stories", (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();
  const requestedStreamId = c.req.query("streamId");

  let stories: Story[] = [];

  if (!rootPath) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128221;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No .ralph directory found</h3>
  <p class="rams-text-muted">Run <code class="rams-code">ralph init</code> or <code class="rams-code">ralph prd</code> to create a PRD and get started.</p>
</div>
`);
  }

  if (mode === "multi") {
    const streams = getStreams();

    // If a specific stream is requested, use that; otherwise use most recent stream
    if (requestedStreamId) {
      const details = getStreamDetails(requestedStreamId);
      if (details) {
        stories = details.stories;
      }
    } else if (streams.length > 0) {
      const activeStream = streams[streams.length - 1];
      const details = getStreamDetails(activeStream.id);
      if (details) {
        stories = details.stories;
      }
    }
  } else if (mode === "single") {
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

  if (stories.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128203;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No stories found</h3>
  <p class="rams-text-muted">Add user stories to your PRD file or create a new PRD with <code class="rams-code">ralph prd</code>.</p>
</div>
`);
  }

  const storyCards = stories
    .map((story) => {
      const badgeClass = story.status === 'completed' ? 'rams-badge-success' :
                         story.status === 'in-progress' ? 'rams-badge-warning' : 'rams-badge-muted';
      const statusLabel =
        story.status === "in-progress"
          ? "In Progress"
          : story.status.charAt(0).toUpperCase() + story.status.slice(1);

      const criteriaHtml =
        story.acceptanceCriteria.length > 0
          ? `
<div style="margin-top: var(--rams-space-3); padding-top: var(--rams-space-3); border-top: 1px solid var(--rams-gray-200);">
  ${story.acceptanceCriteria
    .slice(0, 3)
    .map(
      (ac) => `
  <div class="rams-text-sm ${ac.completed ? "rams-text-muted" : ""}" style="padding: var(--rams-space-1) 0; ${ac.completed ? "text-decoration: line-through;" : ""}">${escapeHtml(ac.text)}</div>
`
    )
    .join("")}
  ${story.acceptanceCriteria.length > 3 ? `<div class="rams-text-sm rams-text-muted" style="padding: var(--rams-space-1) 0;">+${story.acceptanceCriteria.length - 3} more</div>` : ""}
</div>
`
          : "";

      return `
<div class="rams-card" style="margin-bottom: var(--rams-space-4);">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-2);">
    <span class="rams-label">${escapeHtml(story.id)}</span>
    <span class="rams-badge ${badgeClass}"><span class="rams-badge-dot"></span>${statusLabel}</span>
  </div>
  <div class="rams-text-sm" style="font-weight: 500;">${escapeHtml(story.title)}</div>
  ${criteriaHtml}
</div>
`;
    })
    .join("");

  return c.html(`<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">${storyCards}</div>`);
});

/**
 * GET /api/partials/status-indicator
 *
 * Returns HTML fragment for the status indicator in the footer.
 */
api.get("/partials/status-indicator", (c) => {
  const rootPath = getRalphRoot();

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

  const statusClass = isRunning ? "rams-badge-warning" : "rams-badge-success";
  const statusText = isRunning ? "Running" : "Idle";

  return c.html(`<span class="rams-badge ${statusClass}"><span class="rams-badge-dot"></span>${statusText}</span>`);
});

/**
 * GET /api/partials/terminal-commands
 *
 * Returns HTML fragment showing helpful terminal commands for log viewing.
 * Query params:
 *   - streamId: Optional stream ID to show stream-specific commands
 */
api.get("/partials/terminal-commands", (c) => {
  const streamId = c.req.query("streamId");

  // Build commands based on whether a stream is selected
  let commands: Array<{ comment: string; command: string }> = [];

  if (streamId) {
    commands = [
      {
        comment: "# Watch live logs for this stream",
        command: `tail -f .ralph/PRD-${streamId}/runs/*.log 2>/dev/null || echo "No logs yet"`,
      },
      {
        comment: "# View latest run log",
        command: `ls -t .ralph/PRD-${streamId}/runs/*.log 2>/dev/null | head -1 | xargs cat`,
      },
      {
        comment: "# Check stream progress",
        command: `cat .ralph/PRD-${streamId}/progress.md`,
      },
    ];
  } else {
    commands = [
      {
        comment: "# Watch all logs across streams",
        command: "tail -f .ralph/PRD-*/runs/*.log 2>/dev/null",
      },
      {
        comment: "# List all run logs",
        command: "ls -la .ralph/PRD-*/runs/*.log 2>/dev/null | tail -20",
      },
      {
        comment: "# Check activity log",
        command: "cat .ralph/activity.log 2>/dev/null | tail -50",
      },
    ];
  }

  const commandsHtml = commands
    .map(
      (cmd) => `
<div style="margin-bottom: var(--rams-space-3); padding: var(--rams-space-3); background: var(--rams-gray-900); border-radius: var(--rams-radius-sm);">
  <code class="rams-code" style="color: var(--rams-gray-500); display: block; margin-bottom: var(--rams-space-1);">${escapeHtml(cmd.comment)}</code>
  <code class="rams-code" style="color: var(--rams-gray-200); display: block;">${escapeHtml(cmd.command)}</code>
</div>
`
    )
    .join("");

  return c.html(`
<div class="rams-card" style="padding: var(--rams-space-4);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">Terminal Commands</h3>
  <p class="rams-text-muted" style="margin-bottom: var(--rams-space-4);">Run these commands in your terminal to view logs directly:</p>
  ${commandsHtml}
</div>
`);
});

/**
 * GET /api/partials/activity-logs
 *
 * Returns HTML fragment for the activity logs list.
 * Query params:
 *   - level: Filter by minimum log level (error, warning, info)
 */
api.get("/partials/activity-logs", (c) => {
  const mode = getMode();
  const levelFilter = c.req.query("level") as LogLevel | undefined;
  const requestedStreamId = c.req.query("streamId");

  // Get the stream ID (from query param or most recent in multi mode)
  let streamId: string | undefined = requestedStreamId;
  if (!streamId && mode === "multi") {
    const streams = getStreams();
    if (streams.length > 0) {
      streamId = streams[streams.length - 1].id;
    }
  }

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
    entries = entries.filter((entry) => levelPriority[entry.level] >= minPriority);
  }

  // Limit to most recent 50 entries
  entries = entries.slice(0, 50);

  if (entries.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128196;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No activity logs found</h3>
  <p class="rams-text-muted">Activity will appear here when you run <code class="rams-code">ralph build</code>.</p>
</div>
`);
  }

  const logEntriesHtml = entries
    .map((entry) => {
      const timestamp = entry.timestamp.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      const levelBadge = entry.level === 'error' ? 'rams-badge-error' :
                         entry.level === 'warning' ? 'rams-badge-warning' : 'rams-badge-info';

      return `
<div class="rams-card" style="padding: var(--rams-space-3); margin-bottom: var(--rams-space-2); display: flex; gap: var(--rams-space-3); align-items: flex-start;">
  <span class="rams-text-sm rams-text-muted" style="white-space: nowrap;">${timestamp}</span>
  <span class="rams-badge ${levelBadge}" style="font-size: 10px; padding: 2px 6px;">${entry.level}</span>
  <span class="rams-text-sm" style="flex: 1;">${escapeHtml(entry.message)}</span>
</div>
`;
    })
    .join("");

  return c.html(`<div>${logEntriesHtml}</div>`);
});

/**
 * GET /api/partials/run-list
 *
 * Returns HTML fragment for the expandable run logs list.
 */
api.get("/partials/run-list", (c) => {
  const mode = getMode();
  const requestedStreamId = c.req.query("streamId");

  // Get the stream ID and runs
  let streamId: string | undefined = requestedStreamId;
  let runs: Array<{
    id: string;
    iteration: number;
    startedAt: Date;
    status: string;
    storyId?: string;
    storyTitle?: string;
    logPath: string;
    summaryPath?: string;
  }> = [];

  if (mode === "multi") {
    const streams = getStreams();
    if (streams.length > 0) {
      // Use requested stream or default to most recent
      const targetStreamId = streamId || streams[streams.length - 1].id;
      streamId = targetStreamId;
      const details = getStreamDetails(targetStreamId);
      if (details) {
        runs = details.runs;
      }
    }
  }

  if (runs.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128640;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No runs recorded yet</h3>
  <p class="rams-text-muted">Build runs will appear here when you execute <code class="rams-code">ralph build</code>.</p>
</div>
`);
  }

  // Sort by most recent first and limit to 10 runs
  runs = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 10);

  const runListHtml = runs
    .map((run, index) => {
      const timestamp = run.startedAt.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const statusClass =
        run.status === "completed"
          ? "rams-badge-success"
          : run.status === "failed"
            ? "rams-badge-error"
            : "rams-badge-warning";
      const storyInfo = run.storyId ? `${run.storyId}: ${run.storyTitle || ""}` : "Unknown story";

      // Create a unique ID for the run details container
      const runDetailsId = `run-details-${index}`;

      return `
<div class="rams-card" style="margin-bottom: var(--rams-space-3); padding: 0; overflow: hidden;" data-run-id="${escapeHtml(run.id)}">
  <div style="padding: var(--rams-space-3) var(--rams-space-4); cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--rams-gray-50);" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
    <div style="display: flex; align-items: center; gap: var(--rams-space-3);">
      <span class="rams-badge ${statusClass}"><span class="rams-badge-dot"></span>${run.status}</span>
      <span class="rams-label">iter ${run.iteration}</span>
      <span class="rams-text-sm">${escapeHtml(storyInfo)}</span>
    </div>
    <div style="display: flex; align-items: center; gap: var(--rams-space-3);">
      <span class="rams-text-sm rams-text-muted">${timestamp}</span>
      <span style="font-size: 10px; color: var(--rams-gray-400);">&#9660;</span>
    </div>
  </div>
  <div style="display: none; padding: var(--rams-space-4); border-top: 1px solid var(--rams-border);" id="${runDetailsId}"
       hx-get="/api/partials/run-log-content?runId=${encodeURIComponent(run.id)}&streamId=${streamId || ""}&iteration=${run.iteration}"
       hx-trigger="intersect once"
       hx-swap="innerHTML">
    <div class="rams-text-sm rams-text-muted">Loading run log...</div>
  </div>
</div>
`;
    })
    .join("");

  return c.html(`<div>${runListHtml}</div>`);
});

/**
 * GET /api/partials/run-log-content
 *
 * Returns HTML fragment for the content of a specific run log.
 * Query params:
 *   - runId: The run ID
 *   - streamId: The stream ID
 *   - iteration: The iteration number
 */
api.get("/partials/run-log-content", (c) => {
  const runId = c.req.query("runId");
  const streamId = c.req.query("streamId");
  const iterationStr = c.req.query("iteration");

  if (!runId) {
    return c.html(`<p class="rams-text-muted">No run ID provided</p>`);
  }

  const iteration = iterationStr ? parseInt(iterationStr, 10) : undefined;
  const entries = parseRunLog(runId, streamId, iteration);

  if (entries.length === 0) {
    return c.html(`<p class="rams-text-muted">Run log content not available</p>`);
  }

  // Limit to first 100 entries for performance
  const limitedEntries = entries.slice(0, 100);

  const logContentHtml = limitedEntries
    .map((entry) => {
      const timestamp = entry.timestamp.toLocaleString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });

      const levelBadge = entry.level === 'error' ? 'rams-badge-error' :
                         entry.level === 'warning' ? 'rams-badge-warning' : 'rams-badge-info';

      return `
<div style="display: flex; gap: var(--rams-space-3); align-items: flex-start; padding: var(--rams-space-2) 0; border-bottom: 1px solid var(--rams-gray-100); font-family: var(--rams-font-mono); font-size: var(--rams-text-sm);">
  <span class="rams-text-muted" style="white-space: nowrap;">${timestamp}</span>
  <span class="rams-badge ${levelBadge}" style="font-size: 10px; padding: 1px 6px;">${entry.level}</span>
  <span style="flex: 1; word-break: break-word;">${escapeHtml(entry.message)}</span>
</div>
`;
    })
    .join("");

  const hasMore =
    entries.length > 100
      ? `<p class="rams-text-muted" style="font-size: var(--rams-text-xs); margin-top: var(--rams-space-2);">Showing first 100 of ${entries.length} entries</p>`
      : "";

  return c.html(`<div>${logContentHtml}${hasMore}</div>`);
});

/**
 * GET /api/partials/streams-summary
 *
 * Returns HTML fragment for the streams summary section showing aggregate stats.
 */
api.get("/partials/streams-summary", (c) => {
  const streams = getStreams();

  const totalStreams = streams.length;
  const runningStreams = streams.filter((s) => s.status === "running").length;
  const completedStreams = streams.filter((s) => s.status === "completed").length;
  const idleStreams = streams.filter((s) => s.status === "idle").length;

  // Calculate total stories across all streams
  let totalStories = 0;
  let completedStories = 0;
  for (const stream of streams) {
    totalStories += stream.totalStories;
    completedStories += stream.completedStories;
  }

  const overallPercentage =
    totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

  if (totalStreams === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128295;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No streams yet</h3>
  <p class="rams-text-muted">Create your first PRD with <code class="rams-code">ralph prd</code> or click the 'New Stream' button.</p>
</div>
`);
  }

  const html = `
<div class="rams-card-grid">
  <div class="rams-metric-card">
    <div class="rams-metric-value">${totalStreams}</div>
    <div class="rams-metric-label">Total Streams</div>
  </div>
  <div class="rams-metric-card${runningStreams > 0 ? " rams-metric-highlight" : ""}">
    <div class="rams-metric-value">${runningStreams}</div>
    <div class="rams-metric-label">Running</div>
  </div>
  <div class="rams-metric-card${completedStreams > 0 ? " rams-metric-success" : ""}">
    <div class="rams-metric-value">${completedStreams}</div>
    <div class="rams-metric-label">Completed</div>
  </div>
  <div class="rams-metric-card">
    <div class="rams-metric-value">${overallPercentage}%</div>
    <div class="rams-metric-label">Overall Progress</div>
  </div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/streams
 *
 * Returns HTML fragment for the streams list grid.
 */
api.get("/partials/streams", (c) => {
  const streams = getStreams();
  const ralphRoot = getRalphRoot();

  if (streams.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128203;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No streams found</h3>
  <p class="rams-text-muted">Create a PRD with <code class="rams-code">ralph prd</code> or use the 'New Stream' button to get started.</p>
</div>
`);
  }

  // Check which streams have worktrees initialized
  const worktreesPath = ralphRoot ? path.join(ralphRoot, "worktrees") : null;
  const hasWorktree = (streamId: string): boolean => {
    if (!worktreesPath) return false;
    const worktreePath = path.join(worktreesPath, `PRD-${streamId}`);
    return fs.existsSync(worktreePath);
  };

  const streamCards = streams
    .map((stream) => {
      const completionPercentage =
        stream.totalStories > 0
          ? Math.round((stream.completedStories / stream.totalStories) * 100)
          : 0;

      const statusLabel = stream.status.charAt(0).toUpperCase() + stream.status.slice(1);
      const worktreeInitialized = hasWorktree(stream.id);
      const isCompleted = stream.status === "completed";
      const isRunning = stream.status === "running";
      const isMerged = stream.merged;
      const isInProgress = stream.status === "in_progress";
      const isIdle = stream.status === "idle" || stream.status === "ready";
      const isFullyComplete = stream.totalStories > 0 && stream.completedStories === stream.totalStories;

      // Determine if this stream should be visually muted (finished states)
      const isFinishedState = isMerged || (isCompleted && !worktreeInitialized);

      // Build action buttons based on stream state
      let actionButtonsHtml = "";

      // Init button logic:
      // - Show if worktree not initialized
      // - Disabled if merged or completed (direct-to-main)
      if (!worktreeInitialized) {
        const initDisabled = isMerged || isCompleted;
        const initTitle = isMerged ? "Already merged to main" :
                         isCompleted ? "Already completed" :
                         "Initialize git worktree for parallel building";
        actionButtonsHtml += `
          <button class="rams-btn rams-btn-secondary" onclick="initStream('${stream.id}', event)" title="${initTitle}" ${initDisabled ? "disabled" : ""}>
            Init
          </button>`;
      }

      // Build button logic:
      // - Disabled if: merged, running, completed (no worktree), or no worktree initialized (must init first)
      // - Also disabled if 100% complete (all stories done)
      const buildDisabled = isMerged || isRunning || (isCompleted && !worktreeInitialized) ||
                           (!worktreeInitialized && !isRunning) || isFullyComplete;
      const buildTitle = isMerged ? "Already merged to main" :
                        isRunning ? "Build in progress" :
                        (isCompleted && !worktreeInitialized) ? "Already completed" :
                        isFullyComplete ? "All stories completed" :
                        !worktreeInitialized ? "Initialize worktree first (click Init)" :
                        "Start build iterations";
      actionButtonsHtml += `
        <button class="rams-btn rams-btn-primary" onclick="toggleBuildForm('${stream.id}', event)" title="${buildTitle}" ${buildDisabled ? "disabled" : ""}>
          ${isRunning ? "Running..." : "Build"}
        </button>`;

      // Estimate button - show if plan exists
      // Disabled if merged or completed (direct-to-main)
      if (stream.hasPlan) {
        const escapedName = escapeHtml(stream.name).replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const estimateDisabled = isMerged || (isCompleted && !worktreeInitialized);
        const estimateTitle = isMerged ? "Already merged to main" :
                             (isCompleted && !worktreeInitialized) ? "Already completed" :
                             "View estimates for this PRD";
        actionButtonsHtml += `
        <button class="rams-btn rams-btn-secondary"
                onclick="event.stopPropagation(); showStreamDetailAndEstimate('${stream.id}', '${escapedName}');"
                title="${estimateTitle}"
                ${estimateDisabled ? "disabled" : ""}>
          Estimate
        </button>`;
      }

      // Merge button logic:
      // - Only show when worktree exists
      // - Disabled if: already merged, running, or not 100% complete
      if (worktreeInitialized) {
        const escapedName = escapeHtml(stream.name).replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const mergeDisabled = isMerged || isRunning || !isFullyComplete;
        const mergeTitle = isMerged ? "Already merged to main" :
                          isRunning ? "Wait for build to complete" :
                          !isFullyComplete ? `Complete all stories first (${stream.completedStories}/${stream.totalStories})` :
                          "Merge to main branch";
        actionButtonsHtml += `
          <button class="rams-btn rams-btn-warning" onclick="mergeStream('${stream.id}', '${escapedName}', event)" title="${mergeTitle}" ${mergeDisabled ? "disabled" : ""}>
            Merge
          </button>`;
      }

      // Build form (hidden by default)
      const buildFormHtml = `
        <div id="build-form-${stream.id}" class="rams-card" style="display: none; padding: var(--rams-space-4); margin-top: var(--rams-space-3);" onclick="event.stopPropagation()">
          <label class="rams-form-label" for="iterations-${stream.id}">Iterations:</label>
          <input type="number" class="rams-input" id="iterations-${stream.id}" name="iterations" value="1" min="1" max="100" style="width: 80px; margin: 0 var(--rams-space-2);" />
          <button class="rams-btn rams-btn-primary" onclick="startStreamBuild('${stream.id}', event)">Start</button>
          <button class="rams-btn rams-btn-secondary" onclick="toggleBuildForm('${stream.id}', event)">Cancel</button>
        </div>`;

      // Map status to Rams badge class
      const badgeClass = stream.status === 'running' ? 'rams-badge-running' :
                         stream.status === 'completed' ? 'rams-badge-success' :
                         stream.status === 'idle' ? 'rams-badge-idle' : 'rams-badge-pending';

      // Card styling - muted for finished states
      const cardStyle = isFinishedState
        ? "cursor: pointer; margin-bottom: var(--rams-space-4); opacity: 0.6; filter: grayscale(30%);"
        : "cursor: pointer; margin-bottom: var(--rams-space-4);";

      return `
<div class="rams-card" style="${cardStyle}" onclick="showStreamDetail('${stream.id}', '${escapeHtml(stream.name).replace(/'/g, "\\'")}')">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
    <span class="rams-label">PRD-${stream.id}</span>
    <div style="display: flex; gap: var(--rams-space-2);">
      <span class="rams-badge ${badgeClass}"><span class="rams-badge-dot"></span>${statusLabel}</span>
      ${isMerged ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Merged</span>' : ''}
    </div>
  </div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-3);">${escapeHtml(stream.name)}</h3>
  <div style="margin-bottom: var(--rams-space-3);">
    <div class="rams-progress" style="margin-bottom: var(--rams-space-2);">
      <div class="rams-progress-fill" style="width: ${completionPercentage}%"></div>
    </div>
    <span class="rams-text-sm rams-text-muted">${stream.completedStories} of ${stream.totalStories} stories completed (${completionPercentage}%)</span>
  </div>
  <div style="display: flex; gap: var(--rams-space-2); flex-wrap: wrap; margin-bottom: var(--rams-space-3);">
    <span class="rams-badge ${stream.hasPrd ? "rams-badge-success" : "rams-badge-muted"}"><span class="rams-badge-dot"></span>PRD</span>
    <span class="rams-badge ${stream.hasPlan ? "rams-badge-success" : "rams-badge-muted"}"><span class="rams-badge-dot"></span>Plan</span>
    <span class="rams-badge ${stream.hasProgress ? "rams-badge-success" : "rams-badge-muted"}"><span class="rams-badge-dot"></span>Progress</span>
    ${worktreeInitialized ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Worktree</span>' : ""}
  </div>
  <div style="display: flex; gap: var(--rams-space-2); flex-wrap: wrap;">
    ${actionButtonsHtml}
  </div>
  ${buildFormHtml}
</div>
`;
    })
    .join("");

  return c.html(`<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">${streamCards}</div>`);
});

/**
 * GET /api/partials/streams-timeline
 *
 * Returns HTML fragment for the streams timeline view.
 * Shows streams as horizontal progress bars with timing information.
 */
api.get('/partials/streams-timeline', (c) => {
  const streams = getStreams();
  const ralphRoot = getRalphRoot();

  if (streams.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128203;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No streams found</h3>
  <p class="rams-text-muted">Create a PRD with <code class="rams-code">ralph prd</code> or use the 'New Stream' button to get started.</p>
</div>
`);
  }

  // Collect timing data for all streams
  interface StreamTimingData {
    id: string;
    name: string;
    status: string;
    totalStories: number;
    completedStories: number;
    completionPercentage: number;
    firstRunStart: Date | null;
    lastRunEnd: Date | null;
    totalDurationMs: number;
    runCount: number;
  }

  const streamTimings: StreamTimingData[] = [];
  let globalMinTime: Date | null = null;
  let globalMaxTime: Date | null = null;

  for (const stream of streams) {
    const runLogs = listRunLogs(stream.id);
    let firstRunStart: Date | null = null;
    let lastRunEnd: Date | null = null;
    let totalDurationMs = 0;

    for (const run of runLogs) {
      const summary = getRunSummary(run.runId, stream.id, run.iteration);
      if (summary) {
        const startTime = new Date(summary.startedAt);
        const endTime = new Date(summary.endedAt);

        if (!firstRunStart || startTime < firstRunStart) {
          firstRunStart = startTime;
        }
        if (!lastRunEnd || endTime > lastRunEnd) {
          lastRunEnd = endTime;
        }
        totalDurationMs += summary.duration * 1000;

        // Track global time range
        if (!globalMinTime || startTime < globalMinTime) {
          globalMinTime = startTime;
        }
        if (!globalMaxTime || endTime > globalMaxTime) {
          globalMaxTime = endTime;
        }
      }
    }

    const completionPercentage =
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0;

    streamTimings.push({
      id: stream.id,
      name: stream.name,
      status: stream.status,
      totalStories: stream.totalStories,
      completedStories: stream.completedStories,
      completionPercentage,
      firstRunStart,
      lastRunEnd,
      totalDurationMs,
      runCount: runLogs.length,
    });
  }

  // Calculate global time span for positioning
  const globalTimeSpan = globalMinTime && globalMaxTime
    ? globalMaxTime.getTime() - globalMinTime.getTime()
    : 0;

  // Format duration helper
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return '< 1s';
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      const remainingMins = minutes % 60;
      return `${hours}h ${remainingMins}m`;
    } else if (minutes > 0) {
      const remainingSecs = seconds % 60;
      return `${minutes}m ${remainingSecs}s`;
    }
    return `${seconds}s`;
  };

  // Format time helper
  const formatTime = (date: Date): string => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  // Format date helper
  const formatDate = (date: Date): string => {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  };

  // Build timeline rows
  const timelineRows = streamTimings
    .map((stream) => {
      const statusLabel = stream.status.charAt(0).toUpperCase() + stream.status.slice(1);

      // Calculate position and width based on time
      let leftPercent = 0;
      let widthPercent = 100;

      if (globalTimeSpan > 0 && stream.firstRunStart && stream.lastRunEnd && globalMinTime) {
        const startOffset = stream.firstRunStart.getTime() - globalMinTime.getTime();
        const duration = stream.lastRunEnd.getTime() - stream.firstRunStart.getTime();
        leftPercent = (startOffset / globalTimeSpan) * 100;
        widthPercent = Math.max((duration / globalTimeSpan) * 100, 2); // Minimum 2% width
      }

      // Time info
      const timeInfo = stream.firstRunStart && stream.lastRunEnd
        ? `${formatDate(stream.firstRunStart)} ${formatTime(stream.firstRunStart)} - ${formatTime(stream.lastRunEnd)}`
        : 'Not started';

      const durationInfo = stream.totalDurationMs > 0
        ? formatDuration(stream.totalDurationMs)
        : '-';

      return `
<div class="timeline-row" onclick="showStreamDetail('${stream.id}', '${escapeHtml(stream.name).replace(/'/g, "\\'")}')">
  <div class="timeline-label">
    <span class="timeline-id">PRD-${stream.id}</span>
    <span class="timeline-name">${escapeHtml(stream.name)}</span>
  </div>
  <div class="timeline-bar-container">
    <div class="timeline-bar-track">
      <div class="timeline-bar ${stream.status}" style="left: ${leftPercent}%; width: ${widthPercent}%;">
        <div class="timeline-progress-fill" style="width: ${stream.completionPercentage}%;"></div>
      </div>
    </div>
  </div>
  <div class="timeline-stats">
    <span class="timeline-progress-text">${stream.completedStories}/${stream.totalStories}</span>
    <span class="timeline-percentage">${stream.completionPercentage}%</span>
  </div>
  <div class="timeline-time">
    <span class="timeline-duration">${durationInfo}</span>
    <span class="timeline-timespan">${timeInfo}</span>
  </div>
  <div class="timeline-status">
    <span class="status-badge ${stream.status}">${statusLabel}</span>
  </div>
</div>
`;
    })
    .join('');

  // Time axis labels
  const timeAxisHtml = globalMinTime && globalMaxTime
    ? `
<div class="timeline-axis">
  <span class="timeline-axis-start">${formatDate(globalMinTime)} ${formatTime(globalMinTime)}</span>
  <span class="timeline-axis-end">${formatDate(globalMaxTime)} ${formatTime(globalMaxTime)}</span>
</div>`
    : '';

  return c.html(`
<div class="streams-timeline">
  <div class="timeline-header">
    <div class="timeline-header-label">Stream</div>
    <div class="timeline-header-bar">Progress Timeline</div>
    <div class="timeline-header-stats">Stories</div>
    <div class="timeline-header-time">Duration</div>
    <div class="timeline-header-status">Status</div>
  </div>
  ${timeAxisHtml}
  <div class="timeline-body">
    ${timelineRows}
  </div>
</div>
`);
});

/**
 * GET /api/partials/stream-detail
 *
 * Returns HTML fragment for a specific stream's detail view.
 * Query params:
 *   - id: Stream ID
 */
api.get("/partials/stream-detail", (c) => {
  const id = c.req.query("id");

  if (!id) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No stream ID provided</p></div>`);
  }

  const stream = getStreamDetails(id);

  if (!stream) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">Stream not found</h3>
  <p class="rams-text-muted">PRD-${escapeHtml(id)} does not exist.</p>
</div>
`);
  }

  const completionPercentage =
    stream.totalStories > 0 ? Math.round((stream.completedStories / stream.totalStories) * 100) : 0;

  const statusLabel = stream.status.charAt(0).toUpperCase() + stream.status.slice(1);

  // Build stories list HTML
  const storiesHtml =
    stream.stories.length > 0
      ? stream.stories
          .map((story) => {
            const storyStatusLabel =
              story.status === "in-progress"
                ? "In Progress"
                : story.status.charAt(0).toUpperCase() + story.status.slice(1);

            const criteriaHtml =
              story.acceptanceCriteria.length > 0
                ? `<div class="acceptance-criteria">
                ${story.acceptanceCriteria
                  .slice(0, 3)
                  .map(
                    (ac) =>
                      `<div class="criteria-item ${ac.completed ? "completed" : ""}">${escapeHtml(ac.text)}</div>`
                  )
                  .join("")}
                ${story.acceptanceCriteria.length > 3 ? `<div class="criteria-item">+${story.acceptanceCriteria.length - 3} more</div>` : ""}
              </div>`
                : "";

            return `
<div class="story-card">
  <div class="story-header">
    <span class="story-id">${escapeHtml(story.id)}</span>
    <span class="status-badge ${story.status}">${storyStatusLabel}</span>
  </div>
  <div class="story-title">${escapeHtml(story.title)}</div>
  ${criteriaHtml}
</div>
`;
          })
          .join("")
      : '<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No stories found in this PRD.</p></div>';

  // Build runs list HTML
  const runsHtml =
    stream.runs.length > 0
      ? stream.runs
          .slice(0, 10)
          .map((run) => {
            const timestamp = run.startedAt.toLocaleString("en-US", {
              month: "short",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });

            const runStatusClass =
              run.status === "completed"
                ? "rams-badge-success"
                : run.status === "failed"
                  ? "rams-badge-error"
                  : "rams-badge-warning";
            const storyInfo = run.storyId
              ? `${run.storyId}: ${run.storyTitle || ""}`
              : "Unknown story";

            // Show retry badge if retries occurred
            const retryBadge =
              run.retryCount && run.retryCount > 0
                ? `<span class="rams-badge rams-badge-info" style="margin-left: var(--rams-space-2);" title="Succeeded after ${run.retryCount} retry attempt(s), ${run.retryTime || 0}s total wait">&#8635; ${run.retryCount}</span>`
                : "";

            return `
<div class="rams-card" style="margin-bottom: var(--rams-space-3); padding: 0; overflow: hidden;">
  <div style="padding: var(--rams-space-3) var(--rams-space-4); cursor: pointer; display: flex; justify-content: space-between; align-items: center; background: var(--rams-gray-50);" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'">
    <div style="display: flex; align-items: center; gap: var(--rams-space-3);">
      <span class="rams-badge ${runStatusClass}"><span class="rams-badge-dot"></span>${run.status}</span>
      <span class="rams-label">iter ${run.iteration}</span>
      <span class="rams-text-sm">${escapeHtml(storyInfo)}</span>
      ${retryBadge}
    </div>
    <div style="display: flex; align-items: center; gap: var(--rams-space-3);">
      <span class="rams-text-sm rams-text-muted">${timestamp}</span>
      <span style="font-size: 10px; color: var(--rams-gray-400);">&#9660;</span>
    </div>
  </div>
  <div style="display: none; padding: var(--rams-space-4); border-top: 1px solid var(--rams-border);"
       hx-get="/api/partials/run-log-content?runId=${encodeURIComponent(run.id)}&streamId=${stream.id}&iteration=${run.iteration}"
       hx-trigger="intersect once"
       hx-swap="innerHTML">
    <div class="rams-text-sm rams-text-muted">Loading run log...</div>
  </div>
</div>
`;
          })
          .join("")
      : '<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No runs found for this stream.</p></div>';

  const html = `
<div class="stream-detail-header">
  <div class="stream-detail-info">
    <div class="stream-detail-title">${escapeHtml(stream.name)}</div>
    <div class="stream-detail-meta">
      <span class="stream-id">PRD-${stream.id}</span>
      <span class="status-badge ${stream.status}">${statusLabel}</span>
      <span>${stream.completedStories} / ${stream.totalStories} stories (${completionPercentage}%)</span>
    </div>
  </div>
</div>

<div class="stream-progress" style="margin-bottom: var(--spacing-lg);">
  <div class="stream-progress-bar" style="height: 12px;">
    <div class="stream-progress-fill" style="width: ${completionPercentage}%"></div>
  </div>
</div>

<div class="stream-detail-tabs">
  <button class="stream-tab active" onclick="switchStreamTab(this, 'stories')">Stories (${stream.totalStories})</button>
  <button class="stream-tab" onclick="switchStreamTab(this, 'runs')">Runs (${stream.runs.length})</button>
  <button class="stream-tab" onclick="switchStreamTab(this, 'estimate')">Estimate</button>
  <button class="stream-tab" onclick="switchStreamTab(this, 'rollback')">Rollback</button>
</div>

<div id="stream-tab-stories" class="stream-tab-content active">
  <div class="stories-grid">
    ${storiesHtml}
  </div>
</div>

<div id="stream-tab-runs" class="stream-tab-content">
  <div class="run-list">
    ${runsHtml}
  </div>
</div>

<div id="stream-tab-estimate" class="stream-tab-content">
  <div class="estimate-view-toggle">
    <button class="estimate-view-btn active" onclick="switchEstimateView(this, 'pre-run')">Pre-run Estimates</button>
    <button class="estimate-view-btn" onclick="switchEstimateView(this, 'comparison')">Estimate vs Actual</button>
    <button class="estimate-view-btn" onclick="switchEstimateView(this, 'history')">History</button>
  </div>

  <div id="estimate-view-pre-run" class="estimate-view-content active">
    <div id="estimate-summary-container"
         hx-get="/api/partials/estimate-summary?id=${stream.id}"
         hx-trigger="intersect once"
         hx-swap="innerHTML">
      <div class="loading">Loading estimate summary...</div>
    </div>
    <div id="estimate-breakdown-container"
         hx-get="/api/partials/estimate-breakdown?id=${stream.id}"
         hx-trigger="intersect once"
         hx-swap="innerHTML"
         style="margin-top: var(--spacing-lg);">
      <div class="loading">Loading story breakdown...</div>
    </div>
  </div>

  <div id="estimate-view-comparison" class="estimate-view-content">
    <div id="estimate-comparison-container"
         hx-get="/api/partials/estimate-comparison?id=${stream.id}"
         hx-trigger="intersect once"
         hx-swap="innerHTML">
      <div class="loading">Loading comparison data...</div>
    </div>
  </div>

  <div id="estimate-view-history" class="estimate-view-content">
    <div id="estimate-history-container"
         hx-get="/api/partials/estimate-history?id=${stream.id}"
         hx-trigger="intersect once"
         hx-swap="innerHTML">
      <div class="loading">Loading estimate history...</div>
    </div>
  </div>
</div>

<div id="stream-tab-rollback" class="stream-tab-content">
  <div id="rollback-stats-container"
       hx-get="/api/partials/rollback-stats?id=${stream.id}"
       hx-trigger="intersect once"
       hx-swap="innerHTML">
    <div class="loading">Loading rollback statistics...</div>
  </div>
</div>

<script>
function switchStreamTab(btn, tabName) {
  // Update tab buttons
  document.querySelectorAll('.stream-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  // Update tab content
  document.querySelectorAll('.stream-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('stream-tab-' + tabName).classList.add('active');
}

function switchEstimateView(btn, viewName) {
  // Update view buttons
  document.querySelectorAll('.estimate-view-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  // Update view content
  document.querySelectorAll('.estimate-view-content').forEach(v => v.classList.remove('active'));
  document.getElementById('estimate-view-' + viewName).classList.add('active');
}
</script>
`;

  return c.html(html);
});

/**
 * GET /api/partials/build-status
 *
 * Returns HTML fragment for the build status display in the Command Center.
 */
api.get("/partials/build-status", (c) => {
  const status = processManager.getBuildStatus();

  let badgeClass = "rams-badge-idle";
  let statusText = "Idle";
  let detailsHtml = "";

  switch (status.state) {
    case "running":
      badgeClass = "rams-badge-running";
      statusText = "Running...";
      if (status.command) {
        detailsHtml = `
          <div style="margin-top: var(--rams-space-2);">
            <div class="rams-text-sm rams-text-muted">${escapeHtml(status.command)}</div>
            ${status.startedAt ? `<div class="rams-text-sm rams-text-muted">Started: ${status.startedAt.toLocaleTimeString()}</div>` : ""}
          </div>
        `;
      }
      break;
    case "completed":
      badgeClass = "rams-badge-success";
      statusText = "Completed";
      break;
    case "error":
      badgeClass = "rams-badge-error";
      statusText = "Error";
      if (status.error) {
        detailsHtml = `<div class="rams-text-sm" style="color: var(--rams-error); margin-top: var(--rams-space-2);">${escapeHtml(status.error)}</div>`;
      }
      break;
    default:
      badgeClass = "rams-badge-idle";
      statusText = "Idle";
  }

  const html = `
<span class="rams-badge ${badgeClass}">
  <span class="rams-badge-dot"></span>
  ${statusText}
</span>
${detailsHtml}
`;

  return c.html(html);
});

/**
 * GET /api/partials/stream-options
 *
 * Returns HTML options for the stream selector dropdown.
 * Supports two views via query param `view`:
 * - "current" (default): All streams in flat list
 * - "progress": Grouped by completion status
 */
api.get("/partials/stream-options", (c) => {
  const streams = getStreams();
  const view = c.req.query("view") || "current";

  let optionsHtml = '<option value="">Default (latest)</option>';

  if (view === "progress") {
    // Categorize streams by completion status
    const completed: typeof streams = [];
    const inProgress: typeof streams = [];
    const notStarted: typeof streams = [];

    for (const stream of streams) {
      const completionPercentage =
        stream.totalStories > 0
          ? Math.round((stream.completedStories / stream.totalStories) * 100)
          : 0;

      // Categorize based on status and completion percentage
      if (
        stream.status === "merged" ||
        stream.status === "completed" ||
        completionPercentage === 100
      ) {
        completed.push(stream);
      } else if (
        stream.status === "running" ||
        stream.status === "in_progress" ||
        (completionPercentage > 0 && completionPercentage < 100)
      ) {
        inProgress.push(stream);
      } else {
        notStarted.push(stream);
      }
    }

    // Render with optgroups
    if (completed.length > 0) {
      optionsHtml += '<optgroup label="✓ Completed (100%)">';
      for (const stream of completed) {
        const completionPercentage =
          stream.totalStories > 0
            ? Math.round((stream.completedStories / stream.totalStories) * 100)
            : 0;
        optionsHtml += `<option value="${stream.id}">PRD-${stream.id}: ${escapeHtml(stream.name)} (${completionPercentage}%)</option>`;
      }
      optionsHtml += "</optgroup>";
    }

    if (inProgress.length > 0) {
      optionsHtml += '<optgroup label="⏳ In Progress (1-99%)">';
      for (const stream of inProgress) {
        const completionPercentage =
          stream.totalStories > 0
            ? Math.round((stream.completedStories / stream.totalStories) * 100)
            : 0;
        optionsHtml += `<option value="${stream.id}">PRD-${stream.id}: ${escapeHtml(stream.name)} (${completionPercentage}%)</option>`;
      }
      optionsHtml += "</optgroup>";
    }

    if (notStarted.length > 0) {
      optionsHtml += '<optgroup label="◯ Not Started (0%)">';
      for (const stream of notStarted) {
        const completionPercentage =
          stream.totalStories > 0
            ? Math.round((stream.completedStories / stream.totalStories) * 100)
            : 0;
        optionsHtml += `<option value="${stream.id}">PRD-${stream.id}: ${escapeHtml(stream.name)} (${completionPercentage}%)</option>`;
      }
      optionsHtml += "</optgroup>";
    }
  } else {
    // Current view: flat list
    for (const stream of streams) {
      const completionPercentage =
        stream.totalStories > 0
          ? Math.round((stream.completedStories / stream.totalStories) * 100)
          : 0;
      optionsHtml += `<option value="${stream.id}">PRD-${stream.id}: ${escapeHtml(stream.name)} (${completionPercentage}%)</option>`;
    }
  }

  return c.html(optionsHtml);
});

/**
 * Helper function to escape HTML characters
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  return text.replace(/[&<>"']/g, (char) => htmlEscapes[char] || char);
}

/**
 * Validate that a file path is within the .ralph directory.
 * Returns the resolved absolute path if valid, or null if the path is invalid/outside .ralph.
 *
 * Security measures:
 * - Normalizes paths to prevent directory traversal
 * - Rejects paths containing '..'
 * - Ensures resolved path starts with ralphRoot
 */
function validateFilePath(relativePath: string): string | null {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return null;
  }

  // Reject paths with directory traversal attempts
  if (relativePath.includes("..")) {
    return null;
  }

  // Decode URL-encoded path
  const decodedPath = decodeURIComponent(relativePath);

  // Reject paths that still have traversal after decoding
  if (decodedPath.includes("..")) {
    return null;
  }

  // Resolve the full path
  const resolvedPath = path.resolve(ralphRoot, decodedPath);

  // Ensure the resolved path is within the ralph root directory
  if (!resolvedPath.startsWith(ralphRoot + path.sep) && resolvedPath !== ralphRoot) {
    return null;
  }

  return resolvedPath;
}

/**
 * File API Endpoints
 *
 * REST API endpoints for reading and writing files within the .ralph directory.
 * Security: All file access is restricted to the .ralph directory only.
 */

/**
 * GET /api/files/:path
 *
 * Read file content from the .ralph directory.
 * The :path parameter should be a relative path within .ralph.
 *
 * Examples:
 *   GET /api/files/PRD-3/prd.md -> Returns content of .ralph/PRD-3/prd.md
 *   GET /api/files/PRD-3/runs/file.log -> Returns content of .ralph/PRD-3/runs/file.log
 *
 * Returns:
 *   - 200 with file content (text/plain) on success
 *   - 403 if path is outside .ralph directory
 *   - 404 if file not found
 */
api.get("/files/*", (c) => {
  // Extract the path from the wildcard match
  const requestedPath = c.req.path.replace(/^\/api\/files\//, "");

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  // Validate the path is within .ralph
  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  // Check if file exists
  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: "not_found",
        message: `File not found: ${requestedPath}`,
      },
      404
    );
  }

  // Check if it's a file (not a directory)
  const stats = fs.statSync(validatedPath);
  if (stats.isDirectory()) {
    return c.json(
      {
        error: "bad_request",
        message: "Cannot read a directory",
      },
      400
    );
  }

  try {
    const content = fs.readFileSync(validatedPath, "utf-8");
    return c.text(content);
  } catch (err) {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to read file",
      },
      500
    );
  }
});

/**
 * PUT /api/files/:path
 *
 * Update file content in the .ralph directory.
 * The :path parameter should be a relative path within .ralph.
 *
 * Request body: Plain text content to write to the file.
 *
 * Examples:
 *   PUT /api/files/PRD-3/prd.md -> Updates .ralph/PRD-3/prd.md
 *
 * Returns:
 *   - 200 on success
 *   - 400 if path is invalid
 *   - 403 if path is outside .ralph directory
 */
api.put("/files/*", async (c) => {
  // Extract the path from the wildcard match
  const requestedPath = c.req.path.replace(/^\/api\/files\//, "");

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  // Validate the path is within .ralph
  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  // Get the request body as text
  const content = await c.req.text();

  // Ensure parent directory exists
  const parentDir = path.dirname(validatedPath);
  if (!fs.existsSync(parentDir)) {
    try {
      fs.mkdirSync(parentDir, { recursive: true });
    } catch (err) {
      return c.json(
        {
          error: "internal_error",
          message: "Failed to create parent directory",
        },
        500
      );
    }
  }

  try {
    fs.writeFileSync(validatedPath, content, "utf-8");
    return c.json({
      success: true,
      message: "File updated successfully",
      path: requestedPath,
    });
  } catch (err) {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to write file",
      },
      500
    );
  }
});

/**
 * Stream Control API Endpoints
 *
 * REST API endpoints for managing streams (PRD folders).
 * Supports creating, initializing, merging, and building streams.
 */

/**
 * Helper function to execute a ralph command and return the result
 */
function executeRalphCommand(
  args: string[],
  cwd: string
): Promise<{ success: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const childProcess = spawn("ralph", args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    childProcess.on("error", (error: Error) => {
      resolve({
        success: false,
        stdout: "",
        stderr: error.message,
        code: null,
      });
    });

    childProcess.on("exit", (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
      });
    });
  });
}

/**
 * PRD template for new streams
 */
const PRD_TEMPLATE = `# Product Requirements Document

## Overview
[Describe what we're building and why]

## User Stories

### [ ] US-001: [Story title]
**As a** [user type]
**I want** [feature]
**So that** [benefit]

#### Acceptance Criteria
- [ ] Criterion 1
`;

/**
 * POST /api/stream/new
 *
 * Create a new PRD-N stream folder.
 * Determines next available N by scanning existing PRD-* folders.
 * Creates .ralph/PRD-N/ directory with empty prd.md template.
 *
 * Returns:
 *   - 200 with { success: true, id: N, path: string }
 *   - 500 on error
 */
api.post("/stream/new", (c) => {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: '.ralph directory not found. Run "ralph install" first.',
      },
      404
    );
  }

  try {
    // Scan existing PRD-* folders to determine next available N
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });
    let maxId = 0;

    for (const entry of entries) {
      const match = entry.name.match(/^PRD-(\d+)$/i);
      if (entry.isDirectory() && match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) {
          maxId = id;
        }
      }
    }

    const nextId = maxId + 1;
    const streamPath = path.join(ralphRoot, `PRD-${nextId}`);
    const prdPath = path.join(streamPath, "prd.md");

    // Create the directory
    fs.mkdirSync(streamPath, { recursive: true });

    // Create the prd.md file with template
    fs.writeFileSync(prdPath, PRD_TEMPLATE, "utf-8");

    return c.json({
      success: true,
      id: nextId,
      path: streamPath,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to create stream: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * POST /api/stream/:id/init
 *
 * Initialize git worktree for the stream.
 * Executes: `ralph stream init N` via child_process.spawn
 *
 * Returns:
 *   - 200 on success
 *   - 404 if stream doesn't exist
 *   - 500 on error
 */
api.post("/stream/:id/init", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: ".ralph directory not found",
      },
      404
    );
  }

  // Project root is the parent of .ralph
  const projectRoot = path.dirname(ralphRoot);

  const result = await executeRalphCommand(["stream", "init", id], projectRoot);

  if (result.success) {
    return c.json({
      success: true,
      message: `Stream PRD-${id} worktree initialized`,
      output: result.stdout,
    });
  } else {
    return c.json(
      {
        error: result.code === null ? "spawn_error" : "command_failed",
        message:
          result.code === null
            ? `Failed to spawn ralph command: ${result.stderr}`
            : `ralph stream init ${id} failed with exit code ${result.code}`,
        stderr: result.stderr,
      },
      500
    );
  }
});

/**
 * POST /api/stream/:id/merge
 *
 * Merge stream back to main branch.
 * Executes: `ralph stream merge N` via child_process.spawn
 *
 * Returns:
 *   - 200 on success
 *   - 404 if stream doesn't exist
 *   - 500 on error
 */
api.post("/stream/:id/merge", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: ".ralph directory not found",
      },
      404
    );
  }

  // Project root is the parent of .ralph
  const projectRoot = path.dirname(ralphRoot);

  const result = await executeRalphCommand(["stream", "merge", id], projectRoot);

  if (result.success) {
    return c.json({
      success: true,
      message: `Stream PRD-${id} merged to main`,
      output: result.stdout,
    });
  } else {
    return c.json(
      {
        error: result.code === null ? "spawn_error" : "command_failed",
        message:
          result.code === null
            ? `Failed to spawn ralph command: ${result.stderr}`
            : `ralph stream merge ${id} failed with exit code ${result.code}`,
        stderr: result.stderr,
      },
      500
    );
  }
});

/**
 * POST /api/stream/:id/build
 *
 * Start build in specific stream context.
 * Request body: { iterations: number, agent?: string, noCommit?: boolean }
 * Uses processManager.startBuild() with stream option set.
 *
 * Returns:
 *   - 200 with build status
 *   - 404 if stream doesn't exist
 *   - 409 if already running
 */
api.post("/stream/:id/build", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Parse request body
  let body: { iterations?: number; agent?: string; noCommit?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "bad_request",
        message: "Invalid JSON body",
      },
      400
    );
  }

  // Validate iterations
  const iterations = body.iterations;
  if (!iterations || typeof iterations !== "number" || iterations < 1) {
    return c.json(
      {
        error: "bad_request",
        message: "iterations must be a positive number",
      },
      400
    );
  }

  // Validate agent if provided
  const validAgents = ["claude", "codex", "droid"];
  if (body.agent && !validAgents.includes(body.agent)) {
    return c.json(
      {
        error: "bad_request",
        message: `agent must be one of: ${validAgents.join(", ")}`,
      },
      400
    );
  }

  // Build options with stream set
  const options: Partial<BuildOptions> = {
    stream: id,
    agent: body.agent as BuildOptions["agent"],
    noCommit: body.noCommit,
  };

  // Check budget before starting build
  const budgetStatus = getBudgetStatus();
  if (budgetStatus.shouldPause) {
    let reason = "Budget exceeded";
    if (budgetStatus.daily.exceeded && budgetStatus.daily.limit !== null) {
      reason = `Daily budget exceeded ($${budgetStatus.daily.spent.toFixed(2)}/$${budgetStatus.daily.limit.toFixed(2)})`;
    } else if (budgetStatus.monthly.exceeded && budgetStatus.monthly.limit !== null) {
      reason = `Monthly budget exceeded ($${budgetStatus.monthly.spent.toFixed(2)}/$${budgetStatus.monthly.limit.toFixed(2)})`;
    }
    return c.json(
      {
        error: "budget_exceeded",
        message: `${reason}. Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
      },
      403
    );
  }

  // Start the build using process manager
  const status = processManager.startBuild(iterations, options);

  // Check if build was started successfully or if already running
  if (status.error && status.state === "running") {
    return c.json(
      {
        error: "conflict",
        message: "A build is already running",
        status: {
          state: status.state,
          pid: status.pid,
          startedAt: status.startedAt?.toISOString(),
          command: status.command,
        },
      },
      409
    );
  }

  if (status.state === "error") {
    return c.json(
      {
        error: "start_failed",
        message: status.error || "Failed to start build",
      },
      500
    );
  }

  return c.json({
    success: true,
    message: `Build started for stream PRD-${id}`,
    status: {
      state: status.state,
      pid: status.pid,
      startedAt: status.startedAt?.toISOString(),
      command: status.command,
      options: status.options,
    },
  });
});

/**
 * POST /api/files/:path/open
 *
 * Open file in user's default text editor or VSCode.
 * The :path parameter should be a relative path within .ralph.
 *
 * Returns:
 *   - 200 on success
 *   - 403 if path is outside .ralph directory
 *   - 404 if file not found
 *   - 500 on error
 */
api.post("/files/*/open", async (c) => {
  // Extract the path from the wildcard match
  const requestedPath = c.req.path.replace(/^\/api\/files\//, "").replace(/\/open$/, "");

  if (!requestedPath) {
    return c.json(
      {
        error: "bad_request",
        message: "File path is required",
      },
      400
    );
  }

  // Validate the path is within .ralph
  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: "forbidden",
        message: "Access denied: path is outside .ralph directory",
      },
      403
    );
  }

  // Check if file exists
  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: "not_found",
        message: `File not found: ${requestedPath}`,
      },
      404
    );
  }

  try {
    // Try to open in VSCode first, fall back to system default
    const { exec } = await import("node:child_process");
    const platform = process.platform;

    let command: string;
    if (platform === "darwin") {
      // macOS - try VSCode, then fall back to 'open'
      command = `code "${validatedPath}" 2>/dev/null || open -t "${validatedPath}"`;
    } else if (platform === "win32") {
      // Windows - try VSCode, then fall back to notepad
      command = `code "${validatedPath}" 2>nul || notepad "${validatedPath}"`;
    } else {
      // Linux - try VSCode, then xdg-open
      command = `code "${validatedPath}" 2>/dev/null || xdg-open "${validatedPath}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.error("Failed to open file:", error);
      }
    });

    return c.json({
      success: true,
      message: "File opened in external editor",
      path: requestedPath,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to open file: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * Token API Endpoints
 *
 * REST API endpoints for token consumption and cost tracking.
 */

/**
 * GET /api/tokens/summary
 *
 * Returns overall token/cost summary across all streams.
 * Response includes:
 *   - totalInputTokens, totalOutputTokens, totalCost
 *   - avgCostPerStory, avgCostPerRun
 *   - byStream: array of per-stream summaries
 *   - byModel: object keyed by model name
 */
api.get("/tokens/summary", (c) => {
  const summary = getTokenSummary();

  // Calculate efficiency metrics for all runs
  const allRuns = getAllRunsForEfficiency();
  const efficiency = calculateModelEfficiency(allRuns);
  const recommendations = getModelRecommendations(efficiency);

  return c.json({
    summary: {
      totalInputTokens: summary.totalInputTokens,
      totalOutputTokens: summary.totalOutputTokens,
      totalCost: summary.totalCost,
      avgCostPerStory: summary.avgCostPerStory,
      avgCostPerRun: summary.avgCostPerRun,
    },
    byStream: summary.byStream,
    byModel: summary.byModel,
    efficiency,
    recommendations,
  });
});

/**
 * GET /api/tokens/stream/:id
 *
 * Returns detailed token metrics for a specific stream.
 * Includes per-story breakdown, per-model breakdown, and all runs.
 */
api.get("/tokens/stream/:id", (c) => {
  const id = c.req.param("id");

  const streamTokens = getStreamTokens(id);

  if (!streamTokens) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  return c.json(streamTokens);
});

/**
 * GET /api/tokens/story/:streamId/:storyId
 *
 * Returns token metrics for a specific story within a stream.
 * Includes all runs for that story.
 */
api.get("/tokens/story/:streamId/:storyId", (c) => {
  const streamId = c.req.param("streamId");
  const storyId = c.req.param("storyId");

  const storyTokens = getStoryTokens(streamId, storyId);

  if (!storyTokens) {
    return c.json(
      {
        error: "not_found",
        message: `Story ${storyId} in stream PRD-${streamId} not found`,
      },
      404
    );
  }

  return c.json(storyTokens);
});

/**
 * GET /api/tokens/runs
 *
 * Returns token data for recent runs.
 * Query params:
 *   - streamId: Filter to specific stream (optional)
 *   - limit: Max number of runs to return (default: 50)
 *   - offset: Number of runs to skip for pagination (default: 0)
 *   - from: Filter runs from this date (ISO format, optional)
 *   - to: Filter runs until this date (ISO format, optional)
 */
api.get("/tokens/runs", (c) => {
  const streamId = c.req.query("streamId");
  const limit = parseInt(c.req.query("limit") || "50", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const from = c.req.query("from");
  const to = c.req.query("to");

  // Validate limit and offset
  const validLimit = Math.min(Math.max(1, limit), 500); // Cap at 500
  const validOffset = Math.max(0, offset);

  const result = getRunTokens({
    streamId: streamId || undefined,
    limit: validLimit,
    offset: validOffset,
    from: from || undefined,
    to: to || undefined,
  });

  return c.json({
    runs: result.runs,
    pagination: {
      total: result.total,
      limit: validLimit,
      offset: validOffset,
      hasMore: validOffset + validLimit < result.total,
    },
  });
});

/**
 * GET /api/tokens/trends
 *
 * Returns time-series token data for charts.
 * Query params:
 *   - period: Time period ('7d', '30d', '90d', 'all'). Default: '7d'
 *   - streamId: Optional stream ID to filter by (if not provided, returns aggregate)
 *
 * Returns data points grouped by day with:
 *   - date, inputTokens, outputTokens, totalCost, runCount
 */
api.get("/tokens/trends", (c) => {
  const periodParam = c.req.query("period") || "7d";
  const streamId = c.req.query("streamId");

  // Validate period
  const validPeriods = ["7d", "30d", "90d", "all"] as const;
  const period = validPeriods.includes(periodParam as (typeof validPeriods)[number])
    ? (periodParam as "7d" | "30d" | "90d" | "all")
    : "7d";

  const trends = getTokenTrends(period, streamId);

  return c.json(trends);
});

/**
 * GET /api/tokens/efficiency
 *
 * Returns efficiency metrics for all models.
 */
api.get("/tokens/efficiency", (c) => {
  const allRuns = getAllRunsForEfficiency();
  const efficiency = calculateModelEfficiency(allRuns);
  const recommendations = getModelRecommendations(efficiency);

  return c.json({
    efficiency,
    recommendations,
  });
});

/**
 * GET /api/tokens/compare
 *
 * Compare efficiency between two models.
 * Query params:
 *   - modelA: First model name (e.g., 'sonnet', 'opus', 'haiku')
 *   - modelB: Second model name
 *   - streamA: Optional stream ID for model A (for A/B stream comparison)
 *   - streamB: Optional stream ID for model B (for A/B stream comparison)
 */
api.get("/tokens/compare", (c) => {
  const modelA = c.req.query("modelA");
  const modelB = c.req.query("modelB");
  const streamA = c.req.query("streamA");
  const streamB = c.req.query("streamB");

  if (!modelA || !modelB) {
    return c.json(
      {
        error: "Both modelA and modelB query parameters are required",
      },
      400
    );
  }

  // Get runs - optionally filtered by stream for A/B comparison
  let runsA: ReturnType<typeof getAllRunsForEfficiency>;
  let runsB: ReturnType<typeof getAllRunsForEfficiency>;

  const allRuns = getAllRunsForEfficiency();

  if (streamA && streamB) {
    // A/B comparison between two streams (potentially using different models)
    runsA = allRuns.filter((r) => r.streamId === streamA);
    runsB = allRuns.filter((r) => r.streamId === streamB);
  } else {
    // Compare models across all streams
    runsA = allRuns.filter((r) => (r.model || "unknown").toLowerCase() === modelA.toLowerCase());
    runsB = allRuns.filter((r) => (r.model || "unknown").toLowerCase() === modelB.toLowerCase());
  }

  // Calculate efficiency for each set
  const efficiencyA = calculateModelEfficiency(runsA);
  const efficiencyB = calculateModelEfficiency(runsB);

  // Get metrics for the specified models
  const metricsA = streamA ? Object.values(efficiencyA)[0] : efficiencyA[modelA.toLowerCase()];
  const metricsB = streamB ? Object.values(efficiencyB)[0] : efficiencyB[modelB.toLowerCase()];

  const comparison = compareModels(metricsA, metricsB);

  return c.json({
    comparison,
    modelA: {
      name: modelA,
      streamId: streamA,
      metrics: metricsA || null,
      runCount: runsA.length,
    },
    modelB: {
      name: modelB,
      streamId: streamB,
      metrics: metricsB || null,
      runCount: runsB.length,
    },
  });
});

/**
 * Token Dashboard Partial Endpoints for HTMX
 *
 * These endpoints return HTML fragments for the token dashboard.
 */

/**
 * GET /api/partials/token-summary
 *
 * Returns HTML fragment for the token summary cards.
 * Shows total tokens consumed (input/output breakdown),
 * total estimated cost with currency formatting,
 * and cost trend indicator (up/down vs previous period).
 */
api.get("/partials/token-summary", (c) => {
  const summary = getTokenSummary();

  // Calculate previous period cost for trend
  const trends = getTokenTrends("7d");
  let previousCost = 0;
  let currentCost = 0;
  const dataPoints = trends.dataPoints;

  if (dataPoints.length >= 2) {
    // Split data points into two halves for comparison
    const midpoint = Math.floor(dataPoints.length / 2);
    for (let i = 0; i < midpoint; i++) {
      previousCost += dataPoints[i].totalCost;
    }
    for (let i = midpoint; i < dataPoints.length; i++) {
      currentCost += dataPoints[i].totalCost;
    }
  }

  // Determine trend direction
  let trendDirection: "up" | "down" | "neutral" = "neutral";
  let trendPercentage = 0;
  if (previousCost > 0 && currentCost > 0) {
    trendPercentage = Math.round(((currentCost - previousCost) / previousCost) * 100);
    if (trendPercentage > 5) {
      trendDirection = "up";
    } else if (trendPercentage < -5) {
      trendDirection = "down";
    }
  }

  // Format currency
  const formatCurrency = (cost: number): string => {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(4)}`;
    }
    return "$0.00";
  };

  // Format token counts
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(2)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  // Handle empty state
  if (summary.totalInputTokens === 0 && summary.totalOutputTokens === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128200;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No token data yet</h3>
  <p class="rams-text-muted">Token consumption data will appear here after running <code class="rams-code">ralph build</code> commands.</p>
</div>
`);
  }

  // Trend indicator HTML
  let trendHtml = "";
  const trendColor = trendDirection === "up" ? "var(--rams-warning)" : trendDirection === "down" ? "var(--rams-success)" : "var(--rams-text-muted)";
  if (trendDirection === "up") {
    trendHtml = `<span style="color: ${trendColor};" title="Cost trend vs previous period">&#9650; +${trendPercentage}%</span>`;
  } else if (trendDirection === "down") {
    trendHtml = `<span style="color: ${trendColor};" title="Cost trend vs previous period">&#9660; ${trendPercentage}%</span>`;
  } else {
    trendHtml = `<span style="color: ${trendColor};" title="Cost trend vs previous period">&#8212; 0%</span>`;
  }

  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;

  const html = `
<div class="rams-card-grid">
  <div class="rams-metric-card">
    <div class="rams-metric-label">Total Tokens</div>
    <div class="rams-metric-value">${formatTokens(totalTokens)}</div>
    <div class="rams-text-muted" style="font-size: 0.875rem;">
      <span title="Input tokens">&#8593; ${formatTokens(summary.totalInputTokens)}</span>
      <span title="Output tokens">&#8595; ${formatTokens(summary.totalOutputTokens)}</span>
    </div>
  </div>

  <div class="rams-metric-card rams-metric-highlight">
    <div class="rams-metric-label">Total Cost</div>
    <div class="rams-metric-value">${formatCurrency(summary.totalCost)}</div>
    <div style="font-size: 0.875rem;">
      ${trendHtml}
    </div>
  </div>

  <div class="rams-metric-card">
    <div class="rams-metric-label">Avg Cost / Story</div>
    <div class="rams-metric-value">${formatCurrency(summary.avgCostPerStory)}</div>
    <div class="rams-text-muted" style="font-size: 0.875rem;">per completed story</div>
  </div>

  <div class="rams-metric-card">
    <div class="rams-metric-label">Avg Cost / Run</div>
    <div class="rams-metric-value">${formatCurrency(summary.avgCostPerRun)}</div>
    <div class="rams-text-muted" style="font-size: 0.875rem;">per build iteration</div>
  </div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/token-streams
 *
 * Returns HTML fragment for the token usage by stream table.
 * Includes sortable headers, clickable rows for stream detail, and efficiency score.
 */
api.get("/partials/token-streams", (c) => {
  const summary = getTokenSummary();
  const streams = getStreams();

  if (summary.byStream.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128203;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No streams found</h3>
  <p class="rams-text-muted">Create a PRD with <code class="rams-code">ralph prd</code> to start tracking token usage.</p>
</div>
`);
  }

  // Find max cost for progress bar scaling
  const maxCost = Math.max(...summary.byStream.map((s) => s.totalCost), 0.01);

  // Format currency
  const formatCurrency = (cost: number): string => {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(4)}`;
    }
    return "$0.00";
  };

  // Format token counts
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(2)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  // Build enriched stream data with completed stories count
  const enrichedStreams = summary.byStream.map((stream) => {
    // Find matching stream to get completedStories
    const fullStream = streams.find((s) => s.id === stream.streamId);
    const completedStories = fullStream?.completedStories || 0;

    // Calculate efficiency score (cost per completed story)
    // Lower is better, N/A if no completed stories
    const efficiencyScore = completedStories > 0 ? stream.totalCost / completedStories : null;

    return {
      ...stream,
      completedStories,
      efficiencyScore,
    };
  });

  const tableRows = enrichedStreams
    .map((stream) => {
      const costPercentage = maxCost > 0 ? Math.round((stream.totalCost / maxCost) * 100) : 0;
      const efficiencyDisplay =
        stream.efficiencyScore !== null
          ? formatCurrency(stream.efficiencyScore)
          : '<span class="rams-text-muted">N/A</span>';
      // For sorting, use a high number for N/A so they sort to the end
      const efficiencySortValue = stream.efficiencyScore !== null ? stream.efficiencyScore : 999999;

      return `
<tr style="cursor: pointer; transition: background 0.2s;"
    onmouseover="this.style.background='var(--rams-bg-secondary)'"
    onmouseout="this.style.background='transparent'"
    data-stream-id="${escapeHtml(stream.streamId)}"
    data-stream-name="${escapeHtml(stream.streamName)}"
    data-stories="${stream.storyCount}"
    data-runs="${stream.runCount}"
    data-input="${stream.inputTokens}"
    data-output="${stream.outputTokens}"
    data-cost="${stream.totalCost}"
    data-efficiency="${efficiencySortValue}"
    onclick="showTokenStreamDetail('${escapeHtml(stream.streamId)}', '${escapeHtml(stream.streamName).replace(/'/g, "\\'")}')">
  <td style="padding: var(--rams-space-3);">
    <span class="rams-label" style="display: block;">PRD-${escapeHtml(stream.streamId)}</span>
    <span class="rams-text-muted" style="font-size: 0.875rem;">${escapeHtml(stream.streamName)}</span>
  </td>
  <td style="padding: var(--rams-space-3); text-align: center;">${stream.storyCount}</td>
  <td style="padding: var(--rams-space-3); text-align: center;">${stream.runCount}</td>
  <td style="padding: var(--rams-space-3); text-align: center;" title="Input tokens">
    <span style="color: var(--rams-accent);">&#8593;</span> ${formatTokens(stream.inputTokens)}
  </td>
  <td style="padding: var(--rams-space-3); text-align: center;" title="Output tokens">
    <span style="color: var(--rams-warning);">&#8595;</span> ${formatTokens(stream.outputTokens)}
  </td>
  <td style="padding: var(--rams-space-3);">
    ${formatCurrency(stream.totalCost)}
  </td>
  <td style="padding: var(--rams-space-3);" title="Cost per completed story">${efficiencyDisplay}</td>
</tr>
`;
    })
    .join("");

  const html = `
<div class="rams-card" style="overflow-x: auto;">
  <table class="rams-table" id="token-streams-table" style="width: 100%;">
    <thead>
      <tr>
        <th style="padding: var(--rams-space-3); text-align: left; font-weight: 600; border-bottom: 2px solid var(--rams-border);">
          Stream
        </th>
        <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600; border-bottom: 2px solid var(--rams-border);">
          Stories
        </th>
        <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600; border-bottom: 2px solid var(--rams-border);">
          Runs
        </th>
        <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600; border-bottom: 2px solid var(--rams-border);">
          Input
        </th>
        <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600; border-bottom: 2px solid var(--rams-border);">
          Output
        </th>
        <th style="padding: var(--rams-space-3); text-align: left; font-weight: 600; border-bottom: 2px solid var(--rams-border);">
          Cost
        </th>
        <th style="padding: var(--rams-space-3); text-align: left; font-weight: 600; border-bottom: 2px solid var(--rams-border);" title="Cost per completed story">
          Efficiency
        </th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
  </table>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/token-models
 *
 * Returns HTML fragment for the token usage by model breakdown with efficiency metrics.
 * Shows model comparison, efficiency scores, and recommendations.
 */
api.get("/partials/token-models", (c) => {
  const summary = getTokenSummary();

  // Calculate efficiency metrics
  const allRuns = getAllRunsForEfficiency();
  const efficiency = calculateModelEfficiency(allRuns);
  const recommendations = getModelRecommendations(efficiency);

  const modelEntries = Object.entries(summary.byModel);

  if (modelEntries.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#129302;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No model data yet</h3>
  <p class="rams-text-muted">Model breakdown will appear here after running builds with different Claude models.</p>
</div>
`);
  }

  // Format currency
  const formatCurrency = (cost: number): string => {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(4)}`;
    }
    return "$0.00";
  };

  // Format token counts
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(2)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  // Find max cost and best efficiency for scaling
  const maxCost = Math.max(...modelEntries.map(([, metrics]) => metrics.totalCost), 0.01);

  const modelCards = modelEntries
    .map(([model, metrics]) => {
      const costPercentage = maxCost > 0 ? Math.round((metrics.totalCost / maxCost) * 100) : 0;
      const modelName = model || "unknown";
      const displayName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
      const totalTokens = metrics.inputTokens + metrics.outputTokens;

      // Get efficiency data for this model
      const efficiencyData = efficiency[modelName.toLowerCase()];
      const successRate = efficiencyData?.successRate ?? 0;
      const costPerStory = efficiencyData?.costPerStory ?? 0;
      const tokensPerRun = efficiencyData?.tokensPerRun ?? 0;
      const efficiencyScore = efficiencyData?.efficiencyScore;

      // Determine if this is the recommended model
      const isBestOverall = recommendations.bestOverall === modelName.toLowerCase();
      const isBestCost = recommendations.bestCost === modelName.toLowerCase();
      const isBestSuccess = recommendations.bestSuccess === modelName.toLowerCase();

      // Build badge HTML
      let badges = "";
      if (isBestOverall) {
        badges +=
          '<span class="rams-badge rams-badge-success" style="margin-left: var(--rams-space-2);" title="Best overall efficiency">&#9733; Best</span>';
      }
      if (isBestCost && !isBestOverall) {
        badges +=
          '<span class="rams-badge" style="margin-left: var(--rams-space-2); background: var(--rams-accent); color: white;" title="Most cost-effective">$ Cost</span>';
      }
      if (isBestSuccess && !isBestOverall) {
        badges +=
          '<span class="rams-badge rams-badge-info" style="margin-left: var(--rams-space-2);" title="Highest success rate">&#10003; Reliable</span>';
      }

      const successRateColor = successRate >= 80 ? "var(--rams-success)" : successRate >= 50 ? "var(--rams-warning)" : "var(--rams-error)";

      return `
<div class="rams-card" style="margin-bottom: var(--rams-space-4);${isBestOverall ? " border-left: 3px solid var(--rams-success);" : ""}">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
    <div>
      <span style="font-weight: 600; font-size: 1.125rem;">${escapeHtml(displayName)}</span>
      ${badges}
    </div>
    <span class="rams-text-muted">${metrics.runCount || 0} runs</span>
  </div>
  <div class="rams-card-grid" style="margin-bottom: var(--rams-space-3);">
    <div>
      <div class="rams-text-muted" style="font-size: 0.75rem;">Tokens</div>
      <div style="font-weight: 600;">${formatTokens(totalTokens)}</div>
    </div>
    <div>
      <div class="rams-text-muted" style="font-size: 0.75rem;">Cost</div>
      <div style="font-weight: 600;">${formatCurrency(metrics.totalCost)}</div>
    </div>
  </div>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(100px, 1fr)); gap: var(--rams-space-3); margin-bottom: var(--rams-space-3);">
    <div>
      <div class="rams-text-muted" style="font-size: 0.75rem;">Success Rate</div>
      <div style="font-weight: 600; color: ${successRateColor};">${successRate}%</div>
    </div>
    <div>
      <div class="rams-text-muted" style="font-size: 0.75rem;">Cost/Story</div>
      <div style="font-weight: 600;">${formatCurrency(costPerStory)}</div>
    </div>
    <div>
      <div class="rams-text-muted" style="font-size: 0.75rem;">Tokens/Run</div>
      <div style="font-weight: 600;">${formatTokens(tokensPerRun)}</div>
    </div>
    ${
      efficiencyScore != null
        ? `
    <div>
      <div class="rams-text-muted" style="font-size: 0.75rem;" title="Lower is better - combines cost, tokens, and success rate">Efficiency</div>
      <div style="font-weight: 600;">${(efficiencyScore / 1000).toFixed(1)}K</div>
    </div>
    `
        : ""
    }
  </div>
  <div class="rams-text-muted" style="font-size: 0.875rem;">
    <span style="color: var(--rams-accent);" title="Input tokens">&#8593; ${formatTokens(metrics.inputTokens)}</span>
    <span style="color: var(--rams-warning);" title="Output tokens">&#8595; ${formatTokens(metrics.outputTokens)}</span>
  </div>
</div>
`;
    })
    .join("");

  // Build recommendations section
  let recommendationsHtml = "";
  if (recommendations.hasData && recommendations.recommendations.length > 0) {
    const recItems = recommendations.recommendations
      .map((rec) => {
        const confidenceColor =
          rec.confidence === "high"
            ? "var(--rams-success)"
            : rec.confidence === "medium"
              ? "var(--rams-warning)"
              : "var(--rams-text-muted)";
        return `
      <div class="rams-card" style="margin-bottom: var(--rams-space-3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-2);">
          <span class="rams-label">${escapeHtml(rec.taskType.replace(/-/g, " "))}</span>
          <span class="rams-badge" style="background: ${confidenceColor}; color: white;">${rec.confidence}</span>
        </div>
        <div style="margin-bottom: var(--rams-space-2);">Use <strong>${escapeHtml(rec.recommendedModel)}</strong></div>
        <div class="rams-text-muted" style="font-size: 0.875rem;">${escapeHtml(rec.reason)}</div>
      </div>
      `;
      })
      .join("");

    recommendationsHtml = `
    <div style="margin-top: var(--rams-space-6);">
      <h4 class="rams-h4" style="margin-bottom: var(--rams-space-4);">Recommendations by Task Type</h4>
      <div class="rams-card-grid">
        ${recItems}
      </div>
    </div>
    `;
  }

  // Build A/B comparison section if multiple models exist
  let comparisonHtml = "";
  if (modelEntries.length >= 2) {
    const modelOptions = modelEntries
      .map(([model]) => {
        const displayName = model.charAt(0).toUpperCase() + model.slice(1);
        return `<option value="${escapeHtml(model)}">${escapeHtml(displayName)}</option>`;
      })
      .join("");

    comparisonHtml = `
    <div style="margin-top: var(--rams-space-6);">
      <h4 class="rams-h4" style="margin-bottom: var(--rams-space-4);">A/B Model Comparison</h4>
      <div style="display: flex; align-items: center; gap: var(--rams-space-4); margin-bottom: var(--rams-space-4); flex-wrap: wrap;">
        <div>
          <label for="compare-model-a" class="rams-text-muted" style="font-size: 0.875rem;">Model A:</label>
          <select id="compare-model-a" class="rams-select" onchange="updateModelComparison()">
            ${modelOptions}
          </select>
        </div>
        <span class="rams-text-muted">vs</span>
        <div>
          <label for="compare-model-b" class="rams-text-muted" style="font-size: 0.875rem;">Model B:</label>
          <select id="compare-model-b" class="rams-select" onchange="updateModelComparison()">
            ${modelOptions}
          </select>
        </div>
      </div>
      <div id="model-comparison-result">
        <p class="rams-text-muted">Select different models to compare their efficiency metrics.</p>
      </div>
    </div>
    `;
  }

  return c.html(`
<div class="rams-card-grid">${modelCards}</div>
${recommendationsHtml}
${comparisonHtml}
`);
});

/**
 * GET /api/partials/token-stories/:streamId
 *
 * Returns HTML fragment for expandable per-story token breakdown within a stream.
 * Shows story ID, title, status, runs, tokens, and cost with accordion expand/collapse.
 * Highlights stories with unusually high token consumption.
 */
api.get("/partials/token-stories/:streamId", (c) => {
  const streamId = c.req.param("streamId");
  const streamTokens = getStreamTokens(streamId);
  const streamDetails = getStreamDetails(streamId);

  if (!streamTokens || !streamDetails) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128203;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">Stream not found</h3>
  <p class="rams-text-muted">PRD-${escapeHtml(streamId)} does not exist or has no token data.</p>
</div>
`);
  }

  // Format currency
  const formatCurrency = (cost: number): string => {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(4)}`;
    }
    return "$0.00";
  };

  // Format token counts
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1_000_000) {
      return `${(tokens / 1_000_000).toFixed(2)}M`;
    } else if (tokens >= 1_000) {
      return `${(tokens / 1_000).toFixed(1)}K`;
    }
    return tokens.toString();
  };

  // Get stories from stream details
  const stories = streamDetails.stories || [];

  // Map byStory data to include story title and status
  const storyTokenData = stories.map((story) => {
    const tokenData = streamTokens.byStory?.[story.id] || {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCost: 0,
      runs: 0,
      estimatedCount: 0,
    };

    // Calculate tokens per acceptance criterion
    const criteriaCount = story.acceptanceCriteria?.length || 0;
    const tokensPerCriterion =
      criteriaCount > 0 ? Math.round(tokenData.totalTokens / criteriaCount) : 0;

    return {
      id: story.id,
      title: story.title,
      status: story.status,
      inputTokens: tokenData.inputTokens,
      outputTokens: tokenData.outputTokens,
      totalTokens: tokenData.totalTokens,
      totalCost: tokenData.totalCost,
      runs: tokenData.runs,
      estimatedCount: tokenData.estimatedCount,
      criteriaCount,
      tokensPerCriterion,
    };
  });

  if (storyTokenData.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-4);">&#128221;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No stories found</h3>
  <p class="rams-text-muted">This stream has no user stories defined.</p>
</div>
`);
  }

  // Calculate average tokens to identify high consumption stories
  const avgTokens =
    storyTokenData.reduce((sum, s) => sum + s.totalTokens, 0) / storyTokenData.length;
  const highConsumptionThreshold = avgTokens * 1.5; // 50% above average is "high"

  // Find max cost for scaling
  const maxCost = Math.max(...storyTokenData.map((s) => s.totalCost), 0.01);

  // Get runs for this stream to link to individual run logs
  const runs = streamTokens.runs || [];

  // Build story accordion HTML
  const storyItems = storyTokenData
    .map((story) => {
      const isHighConsumption =
        story.totalTokens > highConsumptionThreshold && story.totalTokens > 0;
      const costPercentage = maxCost > 0 ? Math.round((story.totalCost / maxCost) * 100) : 0;

      // Status badge class
      const statusClass =
        story.status === "completed"
          ? "completed"
          : story.status === "in-progress"
            ? "in-progress"
            : "pending";
      const statusLabel =
        story.status === "in-progress"
          ? "In Progress"
          : story.status.charAt(0).toUpperCase() + story.status.slice(1);

      // Get runs for this story
      const storyRuns = runs.filter((run) => run.storyId === story.id);

      // Build run list HTML for expanded view
      const runListHtml =
        storyRuns.length > 0
          ? storyRuns
              .map((run) => {
                const runDate = new Date(run.timestamp);
                const dateStr = runDate.toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                });
                const timeStr = runDate.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                });
                const estimatedLabel = run.estimated
                  ? '<span class="token-estimated" title="Estimated tokens">~</span>'
                  : "";

                return `
<div class="token-story-run">
  <div class="token-story-run-info">
    <span class="token-story-run-id">${escapeHtml(run.runId.substring(0, 15))}...</span>
    <span class="token-story-run-time">${dateStr} ${timeStr}</span>
  </div>
  <div class="token-story-run-stats">
    <span class="token-input" title="Input tokens">&#8593; ${formatTokens(run.inputTokens)}</span>
    <span class="token-output" title="Output tokens">&#8595; ${formatTokens(run.outputTokens)}</span>
    <span class="token-story-run-cost">${formatCurrency(run.cost)}${estimatedLabel}</span>
  </div>
</div>
`;
              })
              .join("")
          : '<div class="token-story-no-runs">No runs recorded for this story.</div>';

      return `
<div class="token-story-accordion${isHighConsumption ? " high-consumption" : ""}" data-story-id="${escapeHtml(story.id)}">
  <div class="token-story-header" onclick="toggleTokenStory(this)">
    <div class="token-story-info">
      <span class="token-story-expand-icon">&#9654;</span>
      <span class="token-story-id">${escapeHtml(story.id)}</span>
      <span class="status-badge ${statusClass}">${statusLabel}</span>
      <span class="token-story-title">${escapeHtml(story.title)}</span>
      ${isHighConsumption ? '<span class="token-high-badge" title="High token consumption">&#9888; High</span>' : ""}
    </div>
    <div class="token-story-summary">
      <span class="token-story-runs">${story.runs} runs</span>
      <span class="token-story-tokens">
        <span class="token-input" title="Input tokens">&#8593; ${formatTokens(story.inputTokens)}</span>
        <span class="token-output" title="Output tokens">&#8595; ${formatTokens(story.outputTokens)}</span>
      </span>
      <span class="token-story-cost">
        <div class="token-cost-bar mini">
          <div class="token-cost-fill" style="width: ${costPercentage}%"></div>
        </div>
        <span class="token-cost-value">${formatCurrency(story.totalCost)}</span>
      </span>
    </div>
  </div>
  <div class="token-story-content" style="display: none;">
    <div class="token-story-metrics">
      <div class="token-story-metric">
        <span class="token-story-metric-label">Acceptance Criteria</span>
        <span class="token-story-metric-value">${story.criteriaCount}</span>
      </div>
      <div class="token-story-metric">
        <span class="token-story-metric-label">Avg Tokens/Criterion</span>
        <span class="token-story-metric-value">${formatTokens(story.tokensPerCriterion)}</span>
      </div>
      <div class="token-story-metric">
        <span class="token-story-metric-label">Total Tokens</span>
        <span class="token-story-metric-value">${formatTokens(story.totalTokens)}</span>
      </div>
      <div class="token-story-metric">
        <span class="token-story-metric-label">Estimated Runs</span>
        <span class="token-story-metric-value">${story.estimatedCount} of ${story.runs}</span>
      </div>
    </div>
    <div class="token-story-runs-section">
      <h4>Run History</h4>
      <div class="token-story-runs-list">
        ${runListHtml}
      </div>
    </div>
  </div>
</div>
`;
    })
    .join("");

  const html = `
<div class="token-stories-container">
  <div class="token-stories-header">
    <h3>Per-Story Token Breakdown</h3>
    <div class="token-stories-actions">
      <button class="btn btn-sm" onclick="expandAllTokenStories()">Expand All</button>
      <button class="btn btn-sm" onclick="collapseAllTokenStories()">Collapse All</button>
    </div>
  </div>
  <div class="token-stories-list">
    ${storyItems}
  </div>
</div>

<script>
function toggleTokenStory(headerEl) {
  var accordion = headerEl.parentElement;
  var content = accordion.querySelector('.token-story-content');
  var icon = accordion.querySelector('.token-story-expand-icon');

  if (content.style.display === 'none') {
    content.style.display = 'block';
    icon.innerHTML = '&#9660;';
    accordion.classList.add('expanded');
  } else {
    content.style.display = 'none';
    icon.innerHTML = '&#9654;';
    accordion.classList.remove('expanded');
  }
}

function expandAllTokenStories() {
  document.querySelectorAll('.token-story-accordion').forEach(function(accordion) {
    var content = accordion.querySelector('.token-story-content');
    var icon = accordion.querySelector('.token-story-expand-icon');
    content.style.display = 'block';
    icon.innerHTML = '&#9660;';
    accordion.classList.add('expanded');
  });
}

function collapseAllTokenStories() {
  document.querySelectorAll('.token-story-accordion').forEach(function(accordion) {
    var content = accordion.querySelector('.token-story-content');
    var icon = accordion.querySelector('.token-story-expand-icon');
    content.style.display = 'none';
    icon.innerHTML = '&#9654;';
    accordion.classList.remove('expanded');
  });
}
</script>
`;

  return c.html(html);
});

/**
 * GET /api/tokens/budget
 *
 * Returns budget status including daily/monthly limits and current spending.
 */
api.get("/tokens/budget", (c) => {
  const status = getBudgetStatus();
  return c.json(status);
});

/**
 * GET /api/tokens/export
 *
 * Export token and cost data in CSV or JSON format.
 * Query params:
 *   - format: 'csv' or 'json' (default: 'csv')
 *   - from: Start date for filtering (ISO format, optional)
 *   - to: End date for filtering (ISO format, optional)
 *   - streamId: Filter to specific stream (optional)
 *
 * Returns:
 *   - CSV: Content-Disposition attachment with filename including date range
 *   - JSON: Token data as JSON object
 */
api.get("/tokens/export", (c) => {
  const format = c.req.query("format") || "csv";
  const from = c.req.query("from");
  const to = c.req.query("to");
  const streamId = c.req.query("streamId");

  // Get all runs with optional date filtering
  const result = getRunTokens({
    streamId: streamId || undefined,
    limit: 10000, // Get all runs
    offset: 0,
    from: from || undefined,
    to: to || undefined,
  });

  const runs = result.runs;

  // Get summary data
  const summary = getTokenSummary();

  // Build filename with date range
  const now = new Date();
  const formatDate = (date: Date): string => {
    return date.toISOString().split("T")[0];
  };

  let filename = "token-report";
  if (from || to) {
    const fromStr = from ? formatDate(new Date(from)) : "start";
    const toStr = to ? formatDate(new Date(to)) : formatDate(now);
    filename += `-${fromStr}-to-${toStr}`;
  } else {
    filename += `-${formatDate(now)}`;
  }
  if (streamId) {
    filename += `-stream-${streamId}`;
  }

  if (format === "json") {
    // JSON export
    const exportData = {
      exportedAt: now.toISOString(),
      dateRange: {
        from: from || null,
        to: to || null,
      },
      streamId: streamId || null,
      summary: {
        totalInputTokens: summary.totalInputTokens,
        totalOutputTokens: summary.totalOutputTokens,
        totalCost: summary.totalCost,
        avgCostPerStory: summary.avgCostPerStory,
        avgCostPerRun: summary.avgCostPerRun,
        totalRuns: runs.length,
      },
      byStream: summary.byStream,
      byModel: summary.byModel,
      runs: runs,
    };

    c.header("Content-Disposition", `attachment; filename="${filename}.json"`);
    c.header("Content-Type", "application/json");
    return c.body(JSON.stringify(exportData, null, 2));
  } else {
    // CSV export
    const csvRows: string[] = [];

    // Header row
    csvRows.push(
      "Run ID,Stream ID,Story ID,Model,Input Tokens,Output Tokens,Total Tokens,Cost (USD),Estimated,Timestamp"
    );

    // Data rows
    for (const run of runs) {
      const totalTokens = run.inputTokens + run.outputTokens;
      const row = [
        run.runId,
        run.streamId || "",
        run.storyId || "",
        run.model || "unknown",
        run.inputTokens.toString(),
        run.outputTokens.toString(),
        totalTokens.toString(),
        run.cost.toFixed(6),
        run.estimated ? "true" : "false",
        run.timestamp,
      ]
        .map((field) => {
          // Escape fields containing commas or quotes
          if (typeof field === "string" && (field.includes(",") || field.includes('"'))) {
            return `"${field.replace(/"/g, '""')}"`;
          }
          return field;
        })
        .join(",");

      csvRows.push(row);
    }

    // Add summary section
    csvRows.push("");
    csvRows.push("Summary");
    csvRows.push(`Total Input Tokens,${summary.totalInputTokens}`);
    csvRows.push(`Total Output Tokens,${summary.totalOutputTokens}`);
    csvRows.push(`Total Cost (USD),${summary.totalCost.toFixed(6)}`);
    csvRows.push(`Average Cost per Story,${summary.avgCostPerStory.toFixed(6)}`);
    csvRows.push(`Average Cost per Run,${summary.avgCostPerRun.toFixed(6)}`);
    csvRows.push(`Total Runs,${runs.length}`);

    c.header("Content-Disposition", `attachment; filename="${filename}.csv"`);
    c.header("Content-Type", "text/csv");
    return c.body(csvRows.join("\n"));
  }
});

/**
 * GET /api/partials/token-budget
 *
 * Returns HTML fragment for budget progress bars.
 * Shows daily and monthly budget consumption with color-coded progress bars.
 */
api.get("/partials/token-budget", (c) => {
  const status = getBudgetStatus();

  // If no budgets are configured, show configuration hint
  if (!status.daily.hasLimit && !status.monthly.hasLimit) {
    return c.html(`
<div class="rams-card" style="padding: var(--rams-space-6);">
  <div style="display: flex; align-items: flex-start; gap: var(--rams-space-4);">
    <span style="font-size: 32px;">&#128176;</span>
    <div>
      <strong style="display: block; margin-bottom: var(--rams-space-2);">Budget tracking not configured</strong>
      <p class="rams-text-muted">Set <code class="rams-code">RALPH_BUDGET_DAILY</code> and/or <code class="rams-code">RALPH_BUDGET_MONTHLY</code> in <code class="rams-code">.agents/ralph/config.sh</code> to enable budget tracking.</p>
    </div>
  </div>
</div>
`);
  }

  // Format currency
  const formatCurrency = (cost: number): string => {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(4)}`;
    }
    return "$0.00";
  };

  // Get color class based on percentage
  const getColorClass = (percentage: number): string => {
    if (percentage >= 100) return "budget-exceeded";
    if (percentage >= 90) return "budget-critical";
    if (percentage >= 80) return "budget-warning";
    return "budget-ok";
  };

  // Build daily budget HTML
  let dailyHtml = "";
  if (status.daily.hasLimit && status.daily.limit !== null) {
    const dailyColorClass = getColorClass(status.daily.percentage);
    const dailyBarWidth = Math.min(status.daily.percentage, 100);
    const dailyStatusIcon = status.daily.exceeded ? "&#9888;" : "&#10003;";
    const dailyStatusText = status.daily.exceeded ? "Exceeded" : "OK";

    const dailyStatusColor = status.daily.exceeded ? "var(--rams-error)" : "var(--rams-success)";
    dailyHtml = `
<div class="rams-card" style="margin-bottom: var(--rams-space-4);">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
    <span class="rams-label">Daily Budget</span>
    <span class="rams-text-muted">
      ${formatCurrency(status.daily.spent)} / ${formatCurrency(status.daily.limit)}
    </span>
  </div>
  <div class="rams-progress" style="margin-bottom: var(--rams-space-3);">
    <div class="rams-progress-fill" style="width: ${dailyBarWidth}%; background: ${dailyStatusColor};"></div>
  </div>
  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
    <span style="color: ${dailyStatusColor};">${status.daily.percentage}%</span>
    <span style="color: ${dailyStatusColor};">
      ${dailyStatusIcon} ${dailyStatusText}
    </span>
    ${status.daily.remaining !== null && !status.daily.exceeded ? `<span class="rams-text-muted">${formatCurrency(status.daily.remaining)} remaining</span>` : ""}
  </div>
</div>
`;
  }

  // Build monthly budget HTML
  let monthlyHtml = "";
  if (status.monthly.hasLimit && status.monthly.limit !== null) {
    const monthlyColorClass = getColorClass(status.monthly.percentage);
    const monthlyBarWidth = Math.min(status.monthly.percentage, 100);
    const monthlyStatusIcon = status.monthly.exceeded ? "&#9888;" : "&#10003;";
    const monthlyStatusText = status.monthly.exceeded ? "Exceeded" : "OK";

    const monthlyStatusColor = status.monthly.exceeded ? "var(--rams-error)" : "var(--rams-success)";
    monthlyHtml = `
<div class="rams-card" style="margin-bottom: var(--rams-space-4);">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
    <span class="rams-label">Monthly Budget</span>
    <span class="rams-text-muted">
      ${formatCurrency(status.monthly.spent)} / ${formatCurrency(status.monthly.limit)}
    </span>
  </div>
  <div class="rams-progress" style="margin-bottom: var(--rams-space-3);">
    <div class="rams-progress-fill" style="width: ${monthlyBarWidth}%; background: ${monthlyStatusColor};"></div>
  </div>
  <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.875rem;">
    <span style="color: ${monthlyStatusColor};">${status.monthly.percentage}%</span>
    <span style="color: ${monthlyStatusColor};">
      ${monthlyStatusIcon} ${monthlyStatusText}
    </span>
    ${status.monthly.remaining !== null && !status.monthly.exceeded ? `<span class="rams-text-muted">${formatCurrency(status.monthly.remaining)} remaining</span>` : ""}
  </div>
</div>
`;
  }

  // Show warning banner if build pause is enabled and budget exceeded
  let pauseWarningHtml = "";
  if (status.pauseOnExceeded && status.shouldPause) {
    pauseWarningHtml = `
<div class="rams-card" style="background: var(--rams-error-bg); border-left: 3px solid var(--rams-error); margin-bottom: var(--rams-space-4);">
  <div style="display: flex; align-items: flex-start; gap: var(--rams-space-3);">
    <span style="font-size: 24px;">&#128721;</span>
    <div>
      <strong style="display: block; color: var(--rams-error);">Builds Paused</strong>
      <p class="rams-text-muted">Budget exceeded and <code class="rams-code">RALPH_BUDGET_PAUSE_ON_EXCEEDED=true</code> is set. New builds will be blocked until budget resets.</p>
    </div>
  </div>
</div>
`;
  }

  // Show alerts if any thresholds were crossed
  let alertsHtml = "";
  const allAlerts = [
    ...status.daily.alerts.map((a) => ({ ...a, period: "daily" })),
    ...status.monthly.alerts.map((a) => ({ ...a, period: "monthly" })),
  ];

  // Only show the highest alert for each period
  const highestDailyAlert = status.daily.alerts[status.daily.alerts.length - 1];
  const highestMonthlyAlert = status.monthly.alerts[status.monthly.alerts.length - 1];

  if (highestDailyAlert || highestMonthlyAlert) {
    const alertItems = [];
    if (highestDailyAlert) {
      const alertColor =
        highestDailyAlert.threshold >= 100
          ? "var(--rams-error)"
          : highestDailyAlert.threshold >= 90
            ? "var(--rams-warning)"
            : "var(--rams-warning)";
      alertItems.push(
        `<div class="rams-badge" style="background: ${alertColor}; color: white; margin-right: var(--rams-space-2);">&#9888; ${escapeHtml(highestDailyAlert.message)}</div>`
      );
    }
    if (highestMonthlyAlert) {
      const alertColor =
        highestMonthlyAlert.threshold >= 100
          ? "var(--rams-error)"
          : highestMonthlyAlert.threshold >= 90
            ? "var(--rams-warning)"
            : "var(--rams-warning)";
      alertItems.push(
        `<div class="rams-badge" style="background: ${alertColor}; color: white;">&#9888; ${escapeHtml(highestMonthlyAlert.message)}</div>`
      );
    }
    alertsHtml = `<div style="margin-bottom: var(--rams-space-4); display: flex; flex-wrap: wrap; gap: var(--rams-space-2);">${alertItems.join("")}</div>`;
  }

  const html = `
<div>
  ${pauseWarningHtml}
  ${alertsHtml}
  <div>
    ${dailyHtml}
    ${monthlyHtml}
  </div>
</div>
`;

  return c.html(html);
});

/**
 * Estimate Partials Section
 *
 * HTML partials for displaying estimation data in the UI.
 */

/**
 * Helper function to format duration in human-readable format
 */
function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Helper function to format token counts
 */
function formatTokens(tokens: number): string {
  if (tokens >= 1000000) {
    return `${(tokens / 1000000).toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}K`;
  }
  return tokens.toFixed(0);
}

/**
 * Helper function to format currency
 */
function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/**
 * GET /api/partials/estimate-summary
 *
 * Returns HTML card showing estimate totals (duration range, tokens range, cost range, confidence).
 * Query params:
 *   - id: Stream/PRD ID
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 */
api.get('/partials/estimate-summary', (c) => {
  const id = c.req.query('id');
  const model = (c.req.query('model') || 'sonnet') as 'sonnet' | 'opus';

  if (!id) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>`);
  }

  const result = getStreamEstimate(id, { model });

  if (!result.success || !result.totals) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">Estimate not available</h3>
  <p class="rams-text-muted">${escapeHtml(result.error || `Unable to generate estimate for PRD-${id}`)}</p>
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">Make sure plan.md exists and contains user stories.</p>
</div>
`);
  }

  const { totals } = result;
  const confidenceClass = totals.confidence === 'high' ? 'confidence-high' : totals.confidence === 'medium' ? 'confidence-medium' : 'confidence-low';
  const confidenceDots = totals.confidence === 'high' ? '●●●' : totals.confidence === 'medium' ? '●●○' : '●○○';

  // Format ranges
  const durationRange = `${formatDuration(totals.durationOptimistic)} - ${formatDuration(totals.durationPessimistic)}`;
  const tokensRange = `${formatTokens(totals.tokensOptimistic)} - ${formatTokens(totals.tokensPessimistic)}`;
  const costRange = `${formatCost(totals.costOptimistic)} - ${formatCost(totals.costPessimistic)}`;

  const html = `
<div class="estimate-summary-container">
  <div class="estimate-header">
    <h4>Pre-run Estimate</h4>
    <div class="estimate-actions">
      <select class="estimate-model-select"
              onchange="htmx.ajax('GET', '/api/partials/estimate-summary?id=${id}&model=' + this.value, '#estimate-summary-container'); htmx.ajax('GET', '/api/partials/estimate-breakdown?id=${id}&model=' + this.value, '#estimate-breakdown-container');"
              title="Select pricing model">
        <option value="sonnet" ${model === 'sonnet' ? 'selected' : ''}>Sonnet</option>
        <option value="opus" ${model === 'opus' ? 'selected' : ''}>Opus</option>
      </select>
      <button class="btn-icon estimate-refresh"
              onclick="htmx.ajax('GET', '/api/partials/estimate-summary?id=${id}&model=${model}&force=true', '#estimate-summary-container'); htmx.ajax('GET', '/api/partials/estimate-breakdown?id=${id}&model=${model}&force=true', '#estimate-breakdown-container');"
              title="Refresh estimate (bypass cache)">
        &#8635;
      </button>
    </div>
  </div>

  <div class="estimate-summary-cards">
    <div class="estimate-card">
      <div class="estimate-card-label">Duration</div>
      <div class="estimate-card-value">${formatDuration(totals.duration)}</div>
      <div class="estimate-card-range">${durationRange}</div>
    </div>

    <div class="estimate-card">
      <div class="estimate-card-label">Tokens</div>
      <div class="estimate-card-value">${formatTokens(totals.tokens)}</div>
      <div class="estimate-card-range">${tokensRange}</div>
    </div>

    <div class="estimate-card">
      <div class="estimate-card-label">Cost (${escapeHtml(totals.model)})</div>
      <div class="estimate-card-value">${formatCost(totals.cost)}</div>
      <div class="estimate-card-range">${costRange}</div>
    </div>

    <div class="estimate-card">
      <div class="estimate-card-label">Confidence</div>
      <div class="estimate-card-value confidence-indicator ${confidenceClass}" title="${totals.confidence}">${confidenceDots}</div>
      <div class="estimate-card-range">${totals.historicalSamples} historical samples</div>
    </div>
  </div>

  <div class="estimate-meta">
    <span class="estimate-stories">${totals.pending} pending of ${totals.stories} stories</span>
    ${result.cached ? `<span class="estimate-cached" title="Cached at ${result.cachedAt}">&#128274; Cached</span>` : ''}
  </div>

  <div class="estimate-loading htmx-indicator">Calculating...</div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/estimate-breakdown
 *
 * Returns HTML table with story-by-story estimate breakdown.
 * Query params:
 *   - id: Stream/PRD ID
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 */
api.get('/partials/estimate-breakdown', (c) => {
  const id = c.req.query('id');
  const model = (c.req.query('model') || 'sonnet') as 'sonnet' | 'opus';

  if (!id) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>`);
  }

  const result = getStreamEstimate(id, { model });

  if (!result.success || !result.estimates || result.estimates.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">No story estimates available</p>
</div>
`);
  }

  const { estimates } = result;

  // Build table rows
  const rowsHtml = estimates.map((est) => {
    const statusClass = est.completed ? 'completed' : 'pending';
    const statusLabel = est.completed ? 'Done' : 'Pending';
    const complexityClass = est.complexity <= 3 ? 'complexity-low' : est.complexity <= 6 ? 'complexity-medium' : 'complexity-high';
    const confidenceClass = est.confidence === 'high' ? 'confidence-high' : est.confidence === 'medium' ? 'confidence-medium' : 'confidence-low';
    const confidenceDots = est.confidence === 'high' ? '●●●' : est.confidence === 'medium' ? '●●○' : '●○○';

    // Range tooltips
    const durationTooltip = `Optimistic: ${formatDuration(est.durationOptimistic)}, Pessimistic: ${formatDuration(est.durationPessimistic)}`;
    const tokensTooltip = `Optimistic: ${formatTokens(est.tokensOptimistic)}, Pessimistic: ${formatTokens(est.tokensPessimistic)}`;
    const costTooltip = `Optimistic: ${formatCost(est.costOptimistic)}, Pessimistic: ${formatCost(est.costPessimistic)}`;

    return `
<tr class="${statusClass}">
  <td class="estimate-story-cell">
    <span class="estimate-story-id">${escapeHtml(est.storyId)}</span>
    <span class="estimate-story-title" title="${escapeHtml(est.title)}">${escapeHtml(est.title)}</span>
  </td>
  <td class="estimate-tasks-cell">${est.taskCount}</td>
  <td class="estimate-complexity-cell">
    <span class="complexity-badge ${complexityClass}" title="${est.complexityLevel}">${est.complexity}</span>
  </td>
  <td class="estimate-duration-cell" title="${durationTooltip}">${formatDuration(est.duration)}</td>
  <td class="estimate-tokens-cell" title="${tokensTooltip}">${formatTokens(est.tokens)}</td>
  <td class="estimate-cost-cell" title="${costTooltip}">${formatCost(est.cost)}</td>
  <td class="estimate-confidence-cell">
    <span class="confidence-indicator ${confidenceClass}" title="${est.confidence}${est.usedHistory ? ' (historical)' : ''}">${confidenceDots}</span>
  </td>
  <td class="estimate-status-cell">
    <span class="status-badge ${statusClass}">${statusLabel}</span>
  </td>
</tr>
`;
  }).join('');

  const html = `
<div class="estimate-breakdown-container">
  <div class="estimate-table-container">
    <table class="estimate-table">
      <thead>
        <tr>
          <th class="estimate-story-header">Story</th>
          <th class="estimate-tasks-header">Tasks</th>
          <th class="estimate-complexity-header">Complexity</th>
          <th class="estimate-duration-header">Time</th>
          <th class="estimate-tokens-header">Tokens</th>
          <th class="estimate-cost-header">Cost</th>
          <th class="estimate-confidence-header">Confidence</th>
          <th class="estimate-status-header">Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/estimate-comparison
 *
 * Returns HTML table comparing estimated vs actual results for completed stories.
 * Query params:
 *   - id: Stream/PRD ID
 *
 * Shows side-by-side comparison with deviation percentages.
 * Color coding: green (<20%), yellow (20-50%), red (>50%)
 */
api.get('/partials/estimate-comparison', (c) => {
  const id = c.req.query('id');

  if (!id) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>`);
  }

  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">Ralph root directory not found</p>
</div>
`);
  }

  const prdFolder = path.join(ralphRoot, `PRD-${id}`);

  if (!fs.existsSync(prdFolder)) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">PRD-${id} not found</p>
</div>
`);
  }

  const report = generateAccuracyReport(prdFolder);

  if (!report.success) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">Error generating accuracy report</p>
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">${escapeHtml(report.error || 'Unknown error')}</p>
</div>
`);
  }

  if (!report.hasData || !report.comparisons || report.comparisons.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No comparison data available</h3>
  <p class="rams-text-muted">${escapeHtml(report.message || 'No matching estimate-to-actual pairs found.')}</p>
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">Complete some builds after running estimates to see comparisons.</p>
</div>
`);
  }

  // Helper to get deviation color class
  const getDeviationClass = (deviation: number): string => {
    const abs = Math.abs(deviation);
    if (abs < 20) return 'deviation-good';
    if (abs < 50) return 'deviation-warning';
    return 'deviation-bad';
  };

  // Helper to format deviation with sign
  const formatDeviation = (deviation: number): string => {
    const sign = deviation >= 0 ? '+' : '';
    return `${sign}${deviation.toFixed(0)}%`;
  };

  // Build table rows
  const rowsHtml = report.comparisons.map((comp: any) => {
    const durationDeviationClass = getDeviationClass(comp.deviation.duration);
    const tokensDeviationClass = getDeviationClass(comp.deviation.tokens);

    return `
<tr>
  <td class="comparison-story-cell">
    <span class="comparison-story-id">${escapeHtml(comp.storyId)}</span>
    <span class="comparison-story-title" title="${escapeHtml(comp.title || comp.storyId)}">${escapeHtml(comp.title || comp.storyId)}</span>
  </td>
  <td class="comparison-time-est">${formatDuration(comp.estimated.duration)}</td>
  <td class="comparison-time-actual">${formatDuration(comp.actual.duration)}</td>
  <td class="comparison-time-deviation ${durationDeviationClass}">${formatDeviation(comp.deviation.duration)}</td>
  <td class="comparison-tokens-est">${formatTokens(comp.estimated.tokens)}</td>
  <td class="comparison-tokens-actual">${formatTokens(comp.actual.tokens)}</td>
  <td class="comparison-tokens-deviation ${tokensDeviationClass}">${formatDeviation(comp.deviation.tokens)}</td>
  <td class="comparison-cost-est">${formatCost(comp.estimated.cost)}</td>
</tr>
`;
  }).join('');

  // Build summary stats HTML
  let summaryHtml = '';
  if (report.accuracy && report.accuracy.sampleCount > 0) {
    const acc = report.accuracy;
    const avgDurationDeviation = acc.mape.duration !== null ? acc.mape.duration.toFixed(1) : 'N/A';
    const avgTokensDeviation = acc.mape.tokens !== null ? acc.mape.tokens.toFixed(1) : 'N/A';

    summaryHtml = `
<div class="comparison-summary">
  <h4>Accuracy Summary</h4>
  <div class="comparison-summary-stats">
    <div class="comparison-stat">
      <span class="comparison-stat-label">Average Time Deviation:</span>
      <span class="comparison-stat-value">±${avgDurationDeviation}%</span>
    </div>
    <div class="comparison-stat">
      <span class="comparison-stat-label">Average Token Deviation:</span>
      <span class="comparison-stat-value">±${avgTokensDeviation}%</span>
    </div>
    <div class="comparison-stat">
      <span class="comparison-stat-label">Sample Count:</span>
      <span class="comparison-stat-value">${acc.sampleCount}</span>
    </div>
  </div>
</div>
`;
  }

  const html = `
<div class="comparison-container">
  <div class="comparison-table-container">
    <table class="comparison-table">
      <thead>
        <tr>
          <th class="comparison-story-header" rowspan="2">Story</th>
          <th class="comparison-time-header" colspan="3">Time</th>
          <th class="comparison-tokens-header" colspan="3">Tokens</th>
          <th class="comparison-cost-header" rowspan="2">Est. Cost</th>
        </tr>
        <tr>
          <th class="comparison-subheader">Estimated</th>
          <th class="comparison-subheader">Actual</th>
          <th class="comparison-subheader">Deviation</th>
          <th class="comparison-subheader">Estimated</th>
          <th class="comparison-subheader">Actual</th>
          <th class="comparison-subheader">Deviation</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </div>

  ${summaryHtml}

  <div class="comparison-legend">
    <span class="comparison-legend-item"><span class="deviation-indicator deviation-good"></span> Good (&lt;20%)</span>
    <span class="comparison-legend-item"><span class="deviation-indicator deviation-warning"></span> Fair (20-50%)</span>
    <span class="comparison-legend-item"><span class="deviation-indicator deviation-bad"></span> Poor (&gt;50%)</span>
  </div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/estimate-history
 *
 * Returns HTML list of past estimates with timestamps.
 * Query params:
 *   - id: Stream/PRD ID
 *   - limit: Number of estimates to show (default: 10)
 *
 * Each item shows: Date/time, total cost, total duration, confidence
 * Expandable to show story-level details
 */
api.get('/partials/estimate-history', (c) => {
  const id = c.req.query('id');
  const limit = parseInt(c.req.query('limit') || '10', 10);

  if (!id) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>`);
  }

  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">Ralph root directory not found</p>
</div>
`);
  }

  const prdFolder = path.join(ralphRoot, `PRD-${id}`);

  if (!fs.existsSync(prdFolder)) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">PRD-${id} not found</p>
</div>
`);
  }

  const result = loadEstimates(prdFolder);

  if (!result.success) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);">
  <p class="rams-text-muted">Error loading estimate history</p>
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">${escapeHtml(result.error || 'Unknown error')}</p>
</div>
`);
  }

  const estimates = result.estimates || [];

  if (estimates.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No estimate history</h3>
  <p class="rams-text-muted">No saved estimates found for PRD-${id}.</p>
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">Estimates are automatically saved when you run builds or manually trigger estimates.</p>
</div>
`);
  }

  // Sort by timestamp descending (newest first)
  const sortedEstimates = estimates.sort(
    (a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Take only the requested limit
  const limitedEstimates = sortedEstimates.slice(0, Math.min(limit, 50));

  // Helper to format timestamp
  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Helper to get confidence label
  const getConfidenceLabel = (confidence: number): string => {
    if (confidence >= 0.7) return 'High';
    if (confidence >= 0.4) return 'Medium';
    return 'Low';
  };

  // Helper to get confidence class
  const getConfidenceClass = (confidence: number): string => {
    if (confidence >= 0.7) return 'confidence-high';
    if (confidence >= 0.4) return 'confidence-medium';
    return 'confidence-low';
  };

  // Build history items HTML
  const historyItemsHtml = limitedEstimates.map((estimate: any, index: number) => {
    const timestamp = formatTimestamp(estimate.timestamp);
    const totals = estimate.totals || {};
    const duration = formatDuration(totals.duration || 0);
    const cost = formatCost(totals.cost || 0);
    const confidence = totals.confidence || 0;
    const confidenceLabel = getConfidenceLabel(confidence);
    const confidenceClass = getConfidenceClass(confidence);

    // Calculate story count
    const storyCount = (estimate.stories || []).length;
    const pendingStories = (estimate.stories || []).filter((s: any) => !s.completed).length;

    // Generate unique ID for this estimate item
    const estimateId = `estimate-${index}`;
    const detailsId = `details-${estimateId}`;

    // Build story details table
    const storiesHtml = (estimate.stories || []).map((story: any) => {
      const statusIcon = story.completed ? '✓' : '○';
      const statusClass = story.completed ? 'story-completed' : 'story-pending';

      return `
<tr class="${statusClass}">
  <td class="history-story-status">${statusIcon}</td>
  <td class="history-story-id">${escapeHtml(story.storyId)}</td>
  <td class="history-story-title">${escapeHtml(story.title || story.storyId)}</td>
  <td class="history-story-time">${formatDuration(story.estimatedDuration || 0)}</td>
  <td class="history-story-tokens">${formatTokens(story.estimatedTokens || 0)}</td>
  <td class="history-story-cost">${formatCost(story.estimatedCost || 0)}</td>
  <td class="history-story-confidence ${getConfidenceClass(story.confidence || 0)}">${getConfidenceLabel(story.confidence || 0)}</td>
</tr>
`;
    }).join('');

    return `
<div class="history-item" data-estimate-id="${estimateId}" data-estimate-index="${index}">
  <div class="history-item-header">
    <div class="history-item-select">
      <input type="checkbox" class="history-compare-checkbox" id="compare-${estimateId}" value="${index}" onchange="updateCompareButton()">
    </div>
    <div class="history-item-main" onclick="toggleHistoryDetails('${detailsId}')">
      <div class="history-item-timestamp">
        <span class="history-timestamp-icon">📅</span>
        <span class="history-timestamp-text">${timestamp}</span>
      </div>
      <div class="history-item-stats">
        <span class="history-stat">
          <span class="history-stat-label">Stories:</span>
          <span class="history-stat-value">${pendingStories}/${storyCount}</span>
        </span>
        <span class="history-stat">
          <span class="history-stat-label">Duration:</span>
          <span class="history-stat-value">${duration}</span>
        </span>
        <span class="history-stat">
          <span class="history-stat-label">Cost:</span>
          <span class="history-stat-value">${cost}</span>
        </span>
        <span class="history-stat">
          <span class="history-stat-label">Confidence:</span>
          <span class="history-stat-value ${confidenceClass}">${confidenceLabel}</span>
        </span>
      </div>
    </div>
    <div class="history-item-actions">
      <button class="history-expand-btn" title="Toggle details" onclick="toggleHistoryDetails('${detailsId}')">
        <span class="expand-icon">▼</span>
      </button>
    </div>
  </div>
  <div class="history-item-details" id="${detailsId}" style="display: none;">
    <div class="history-details-table-container">
      <table class="history-details-table">
        <thead>
          <tr>
            <th></th>
            <th>Story ID</th>
            <th>Title</th>
            <th>Time</th>
            <th>Tokens</th>
            <th>Cost</th>
            <th>Confidence</th>
          </tr>
        </thead>
        <tbody>
          ${storiesHtml}
        </tbody>
      </table>
    </div>
  </div>
</div>
`;
  }).join('');

  // Store estimates as JSON for comparison
  const estimatesJson = JSON.stringify(limitedEstimates);

  const html = `
<div class="history-container">
  <div class="history-header">
    <h3>Estimate History</h3>
    <div class="history-header-actions">
      <p class="history-subtitle">${estimates.length} estimate${estimates.length === 1 ? '' : 's'} recorded</p>
      <button id="compare-estimates-btn" class="compare-estimates-btn" onclick="showCompareModal()" disabled>
        Compare Selected (0)
      </button>
    </div>
  </div>
  <div class="history-list">
    ${historyItemsHtml}
  </div>
  ${estimates.length > limit ? `
  <div class="history-load-more">
    <button
      class="load-more-btn"
      hx-get="/api/partials/estimate-history?id=${id}&limit=${limit + 10}"
      hx-target=".history-container"
      hx-swap="outerHTML"
    >
      Load More
    </button>
  </div>
  ` : ''}
</div>

<!-- Comparison Modal -->
<div id="estimate-compare-modal" class="modal" style="display: none;">
  <div class="modal-content estimate-compare-modal-content">
    <div class="modal-header">
      <h3>Compare Estimates</h3>
      <button class="modal-close" onclick="closeCompareModal()">&times;</button>
    </div>
    <div class="modal-body" id="compare-modal-body">
      <div class="loading">Preparing comparison...</div>
    </div>
  </div>
</div>

<script>
// Store estimates data for comparison
window.historyEstimates = ${estimatesJson};

function toggleHistoryDetails(detailsId) {
  const details = document.getElementById(detailsId);
  const header = details.previousElementSibling;
  const btn = header.querySelector('.expand-icon');

  if (details.style.display === 'none') {
    details.style.display = 'block';
    btn.textContent = '▲';
  } else {
    details.style.display = 'none';
    btn.textContent = '▼';
  }
}

function updateCompareButton() {
  const checkboxes = document.querySelectorAll('.history-compare-checkbox:checked');
  const btn = document.getElementById('compare-estimates-btn');
  const count = checkboxes.length;

  btn.textContent = \`Compare Selected (\${count})\`;
  btn.disabled = count !== 2;

  // Limit selection to 2
  if (count >= 2) {
    document.querySelectorAll('.history-compare-checkbox:not(:checked)').forEach(cb => {
      cb.disabled = true;
    });
  } else {
    document.querySelectorAll('.history-compare-checkbox').forEach(cb => {
      cb.disabled = false;
    });
  }
}

function showCompareModal() {
  const checkboxes = document.querySelectorAll('.history-compare-checkbox:checked');
  if (checkboxes.length !== 2) {
    alert('Please select exactly 2 estimates to compare');
    return;
  }

  const indices = Array.from(checkboxes).map(cb => parseInt(cb.value));
  const estimate1 = window.historyEstimates[indices[0]];
  const estimate2 = window.historyEstimates[indices[1]];

  const modal = document.getElementById('estimate-compare-modal');
  const modalBody = document.getElementById('compare-modal-body');

  // Generate comparison HTML
  const comparisonHtml = generateComparisonHtml(estimate1, estimate2);
  modalBody.innerHTML = comparisonHtml;

  modal.style.display = 'flex';
}

function closeCompareModal() {
  document.getElementById('estimate-compare-modal').style.display = 'none';
}

function generateComparisonHtml(est1, est2) {
  const date1 = new Date(est1.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
  const date2 = new Date(est2.timestamp).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  const formatDuration = (seconds) => {
    if (!seconds) return '0s';
    if (seconds < 60) return Math.round(seconds) + 's';
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return secs > 0 ? \`\${mins}m \${secs}s\` : \`\${mins}m\`;
  };

  const formatCost = (cost) => {
    if (!cost) return '$0.00';
    return '$' + cost.toFixed(2);
  };

  const formatTokens = (tokens) => {
    if (!tokens) return '0';
    if (tokens >= 1000000) return (tokens / 1000000).toFixed(1) + 'M';
    if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
    return Math.round(tokens).toString();
  };

  const calculateDelta = (val1, val2) => {
    if (!val1 || !val2) return 0;
    return ((val2 - val1) / val1) * 100;
  };

  const formatDelta = (delta) => {
    const sign = delta >= 0 ? '+' : '';
    return \`\${sign}\${delta.toFixed(1)}%\`;
  };

  const getDeltaClass = (delta) => {
    if (Math.abs(delta) < 5) return 'delta-neutral';
    return delta > 0 ? 'delta-increase' : 'delta-decrease';
  };

  // Calculate totals delta
  const durationDelta = calculateDelta(est1.totals.duration, est2.totals.duration);
  const tokensDelta = calculateDelta(est1.totals.tokens, est2.totals.tokens);
  const costDelta = calculateDelta(est1.totals.cost, est2.totals.cost);

  // Build story comparison rows
  const storyMap = new Map();
  (est1.stories || []).forEach(s => {
    storyMap.set(s.storyId, { est1: s, est2: null });
  });
  (est2.stories || []).forEach(s => {
    if (storyMap.has(s.storyId)) {
      storyMap.get(s.storyId).est2 = s;
    } else {
      storyMap.set(s.storyId, { est1: null, est2: s });
    }
  });

  const storyRowsHtml = Array.from(storyMap.entries()).map(([storyId, { est1: s1, est2: s2 }]) => {
    const dur1 = s1?.estimatedDuration || 0;
    const dur2 = s2?.estimatedDuration || 0;
    const durDelta = dur1 && dur2 ? calculateDelta(dur1, dur2) : null;

    const tok1 = s1?.estimatedTokens || 0;
    const tok2 = s2?.estimatedTokens || 0;
    const tokDelta = tok1 && tok2 ? calculateDelta(tok1, tok2) : null;

    const cost1 = s1?.estimatedCost || 0;
    const cost2 = s2?.estimatedCost || 0;
    const costDelta = cost1 && cost2 ? calculateDelta(cost1, cost2) : null;

    const isNew = !s1;
    const isRemoved = !s2;

    return \`
<tr class="\${isNew ? 'story-new' : isRemoved ? 'story-removed' : ''}">
  <td>\${storyId}\${isNew ? ' <span class="badge-new">NEW</span>' : isRemoved ? ' <span class="badge-removed">REMOVED</span>' : ''}</td>
  <td>\${s1 ? formatDuration(dur1) : '—'}</td>
  <td>\${s2 ? formatDuration(dur2) : '—'}</td>
  <td class="\${durDelta !== null ? getDeltaClass(durDelta) : ''}">\${durDelta !== null ? formatDelta(durDelta) : '—'}</td>
  <td>\${s1 ? formatTokens(tok1) : '—'}</td>
  <td>\${s2 ? formatTokens(tok2) : '—'}</td>
  <td class="\${tokDelta !== null ? getDeltaClass(tokDelta) : ''}">\${tokDelta !== null ? formatDelta(tokDelta) : '—'}</td>
  <td>\${s1 ? formatCost(cost1) : '—'}</td>
  <td>\${s2 ? formatCost(cost2) : '—'}</td>
  <td class="\${costDelta !== null ? getDeltaClass(costDelta) : ''}">\${costDelta !== null ? formatDelta(costDelta) : '—'}</td>
</tr>
\`;
  }).join('');

  return \`
<div class="comparison-timestamps">
  <div class="comparison-timestamp">
    <strong>Estimate 1:</strong> \${date1}
  </div>
  <div class="comparison-timestamp">
    <strong>Estimate 2:</strong> \${date2}
  </div>
</div>

<div class="comparison-totals">
  <h4>Totals Comparison</h4>
  <table class="totals-comparison-table">
    <thead>
      <tr>
        <th></th>
        <th>Estimate 1</th>
        <th>Estimate 2</th>
        <th>Change</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Duration</strong></td>
        <td>\${formatDuration(est1.totals.duration)}</td>
        <td>\${formatDuration(est2.totals.duration)}</td>
        <td class="\${getDeltaClass(durationDelta)}">\${formatDelta(durationDelta)}</td>
      </tr>
      <tr>
        <td><strong>Tokens</strong></td>
        <td>\${formatTokens(est1.totals.tokens)}</td>
        <td>\${formatTokens(est2.totals.tokens)}</td>
        <td class="\${getDeltaClass(tokensDelta)}">\${formatDelta(tokensDelta)}</td>
      </tr>
      <tr>
        <td><strong>Cost</strong></td>
        <td>\${formatCost(est1.totals.cost)}</td>
        <td>\${formatCost(est2.totals.cost)}</td>
        <td class="\${getDeltaClass(costDelta)}">\${formatDelta(costDelta)}</td>
      </tr>
    </tbody>
  </table>
</div>

<div class="comparison-stories">
  <h4>Story-by-Story Comparison</h4>
  <div class="comparison-stories-table-container">
    <table class="stories-comparison-table">
      <thead>
        <tr>
          <th rowspan="2">Story ID</th>
          <th colspan="3">Duration</th>
          <th colspan="3">Tokens</th>
          <th colspan="3">Cost</th>
        </tr>
        <tr>
          <th>Est 1</th>
          <th>Est 2</th>
          <th>Δ</th>
          <th>Est 1</th>
          <th>Est 2</th>
          <th>Δ</th>
          <th>Est 1</th>
          <th>Est 2</th>
          <th>Δ</th>
        </tr>
      </thead>
      <tbody>
        \${storyRowsHtml}
      </tbody>
    </table>
  </div>
</div>
\`;
}

// Close modal on outside click
window.onclick = function(event) {
  const modal = document.getElementById('estimate-compare-modal');
  if (event.target === modal) {
    closeCompareModal();
  }
}
</script>
`;

  return c.html(html);
});

/**
 * GET /api/partials/accuracy-widget
 *
 * Returns a compact widget showing overall estimation accuracy metrics.
 * Displays: average deviation %, trend indicator, sample count
 * Links to detailed accuracy view.
 *
 * Shows "Insufficient data" state when < 3 samples.
 */
api.get('/partials/accuracy-widget', (c) => {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.html(`
<div class="rams-card" style="padding: var(--rams-space-4);">
  <div style="margin-bottom: var(--rams-space-2);">
    <h3 class="rams-h4">Estimation Accuracy</h3>
  </div>
  <div>
    <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">Ralph root not found</p>
  </div>
</div>
`);
  }

  // Get all streams and collect accuracy data
  const streams = getStreams();
  let allComparisons: any[] = [];

  for (const stream of streams) {
    const prdFolder = path.join(ralphRoot, `PRD-${stream.id}`);
    if (fs.existsSync(prdFolder)) {
      const report = generateAccuracyReport(prdFolder);
      if (report.success && report.hasData && report.comparisons) {
        allComparisons = allComparisons.concat(report.comparisons);
      }
    }
  }

  // Need at least 3 samples for meaningful metrics
  if (allComparisons.length < 3) {
    return c.html(`
<div class="rams-card" style="padding: var(--rams-space-4);">
  <div style="margin-bottom: var(--rams-space-2);">
    <h3 class="rams-h4">Estimation Accuracy</h3>
  </div>
  <div>
    <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">Insufficient data</p>
    <p class="rams-text-muted" style="font-size: var(--rams-text-xs);">Need at least 3 completed stories with estimates</p>
  </div>
</div>
`);
  }

  // Calculate overall accuracy metrics
  const calculateAccuracy = (comparisons: any[]) => {
    const validComparisons = comparisons.filter(
      (c: any) => c.estimated.duration > 0 && c.estimated.tokens > 0
    );

    if (validComparisons.length === 0) {
      return { mape: { duration: null }, sampleCount: 0 };
    }

    const durationDeviations = validComparisons.map((c: any) => Math.abs(c.deviation.duration));
    const sum = durationDeviations.reduce((a: number, b: number) => a + b, 0);
    const avg = sum / durationDeviations.length;

    return {
      mape: { duration: avg },
      sampleCount: validComparisons.length,
    };
  };

  // Detect trend
  const detectTrend = (comparisons: any[]) => {
    if (comparisons.length < 3) {
      return { trend: 'insufficient_data', trendIndicator: '?', description: 'Not enough data' };
    }

    // Sort by timestamp
    const sorted = [...comparisons].sort(
      (a: any, b: any) => new Date(a.actualTimestamp).getTime() - new Date(b.actualTimestamp).getTime()
    );

    // Split into recent and older
    const recentCount = Math.max(5, Math.floor(sorted.length / 3));
    const splitPoint = Math.max(sorted.length - recentCount, Math.floor(sorted.length / 2));
    const recent = sorted.slice(splitPoint);
    const older = sorted.slice(0, splitPoint);

    if (older.length === 0) {
      return { trend: 'insufficient_data', trendIndicator: '?', description: 'Not enough older data' };
    }

    const recentAccuracy = calculateAccuracy(recent);
    const olderAccuracy = calculateAccuracy(older);

    const recentMape = recentAccuracy.mape.duration;
    const olderMape = olderAccuracy.mape.duration;

    if (recentMape === null || olderMape === null) {
      return { trend: 'insufficient_data', trendIndicator: '?', description: 'Cannot calculate trend' };
    }

    // Determine trend based on improvement threshold (10% change)
    const improvement = ((olderMape - recentMape) / olderMape) * 100;

    let trend, trendIndicator, description;
    if (improvement > 10) {
      trend = 'improving';
      trendIndicator = '↑';
      description = 'improving';
    } else if (improvement < -10) {
      trend = 'degrading';
      trendIndicator = '↓';
      description = 'degrading';
    } else {
      trend = 'stable';
      trendIndicator = '→';
      description = 'stable';
    }

    return { trend, trendIndicator, description, improvement };
  };

  const accuracy = calculateAccuracy(allComparisons);
  const trend = detectTrend(allComparisons);

  const avgDeviation = accuracy.mape.duration !== null ? accuracy.mape.duration.toFixed(1) : 'N/A';

  // Generate sparkline data (last 20 comparisons)
  const sparklineComparisons = [...allComparisons]
    .sort((a: any, b: any) => new Date(a.actualTimestamp).getTime() - new Date(b.actualTimestamp).getTime())
    .slice(-20);

  let sparklineSvg = '';
  if (sparklineComparisons.length >= 2) {
    const sparklineData = sparklineComparisons.map((c: any) => Math.abs(c.deviation.duration));
    const maxDeviation = Math.max(...sparklineData);
    const minDeviation = Math.min(...sparklineData);
    const range = maxDeviation - minDeviation || 1;

    const width = 100;
    const height = 30;
    const padding = 2;

    // Normalize points to SVG coordinates
    const points = sparklineData.map((value: number, index: number) => {
      const x = (index / (sparklineData.length - 1)) * (width - 2 * padding) + padding;
      const y = height - padding - ((value - minDeviation) / range) * (height - 2 * padding);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(' ');

    sparklineSvg = `
<svg class="accuracy-sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <polyline
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    points="${points}"
  />
</svg>
`;
  }

  const trendClass = trend.trend === 'improving' ? 'trend-good' :
                     trend.trend === 'degrading' ? 'trend-bad' :
                     'trend-stable';

  const html = `
<div class="accuracy-widget">
  <div class="accuracy-widget-header">
    <h3>Estimation Accuracy</h3>
    <a href="/streams.html" class="accuracy-widget-link" title="View details">Details →</a>
  </div>
  <div class="accuracy-widget-content">
    <div class="accuracy-widget-main">
      <div class="accuracy-widget-metric">
        <span class="accuracy-widget-label">Average Deviation</span>
        <span class="accuracy-widget-value">±${avgDeviation}%</span>
      </div>
      <div class="accuracy-widget-trend ${trendClass}">
        <span class="accuracy-widget-trend-indicator">${trend.trendIndicator}</span>
        <span class="accuracy-widget-trend-label">${escapeHtml(trend.description)}</span>
      </div>
    </div>
    ${sparklineSvg}
    <div class="accuracy-widget-footer">
      <span class="accuracy-widget-sample-count">${accuracy.sampleCount} samples</span>
    </div>
  </div>
</div>
`;

  return c.html(html);
});

/**
 * GET /api/partials/rollback-stats
 *
 * Returns HTML fragment for rollback statistics (US-004).
 * Shows total rollbacks, recovery rate, breakdown by reason, and recent events.
 */
api.get('/partials/rollback-stats', (c) => {
  const streamId = c.req.query('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.html(`
<div class="rollback-stats empty-state">
  <p>Ralph directory not found.</p>
</div>
`);
  }

  // Get PRD folder path
  const prdFolder = streamId
    ? path.join(ralphRoot, `PRD-${streamId}`)
    : null;

  if (streamId && !fs.existsSync(prdFolder!)) {
    return c.html(`
<div class="rollback-stats empty-state">
  <p>Stream PRD-${escapeHtml(streamId)} not found.</p>
</div>
`);
  }

  // Load rollback analytics
  const analytics = streamId
    ? getRollbackAnalytics(prdFolder)
    : { success: true, hasData: false, total: 0 };

  if (!analytics.success) {
    return c.html(`
<div class="rollback-stats error-state">
  <p>Error loading rollback stats: ${escapeHtml(analytics.error || 'Unknown error')}</p>
</div>
`);
  }

  if (!analytics.hasData) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <div style="font-size: 48px; margin-bottom: var(--rams-space-3); color: var(--rams-success);">&#10003;</div>
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No Rollbacks</h3>
  <p class="rams-text-muted">No rollback events recorded for this stream. This means all builds succeeded without test failures!</p>
</div>
`);
  }

  // Build breakdown by reason HTML
  const reasonsHtml = Object.entries(analytics.byReason as Record<string, {count: number, successful: number, avgAttempts: number}>)
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([reason, stats]) => {
      const recoveryRate = stats.count > 0 ? Math.round((stats.successful / stats.count) * 100) : 0;
      const reasonLabel = reason.replace(/-/g, ' ').replace(/_/g, ' ');
      return `
<div class="rollback-reason-item">
  <div class="rollback-reason-name">${escapeHtml(reasonLabel)}</div>
  <div class="rollback-reason-stats">
    <span class="rollback-reason-count">${stats.count}</span>
    <span class="rollback-reason-rate">${recoveryRate}% recovered</span>
  </div>
</div>
`;
    })
    .join('');

  // Build timeline HTML (last 5 events)
  const timelineHtml = (analytics.timeline as Array<{timestamp: string, storyId: string, reason: string, success: boolean, attempt: number}>)
    .slice(0, 5)
    .map((event) => {
      const time = new Date(event.timestamp).toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const statusClass = event.success ? 'success' : 'error';
      const statusIcon = event.success ? '✓' : '✗';
      return `
<div class="rollback-timeline-item">
  <span class="rollback-timeline-status ${statusClass}">${statusIcon}</span>
  <span class="rollback-timeline-story">${escapeHtml(event.storyId)}</span>
  <span class="rollback-timeline-reason">${escapeHtml(event.reason.replace(/-/g, ' '))}</span>
  <span class="rollback-timeline-time">${time}</span>
</div>
`;
    })
    .join('');

  const html = `
<div class="rollback-stats">
  <div class="rollback-stats-header">
    <h3>Rollback & Recovery</h3>
  </div>

  <div class="rollback-summary">
    <div class="rollback-stat">
      <div class="rollback-stat-value">${analytics.total}</div>
      <div class="rollback-stat-label">Total Rollbacks</div>
    </div>
    <div class="rollback-stat ${analytics.successRate >= 50 ? 'success' : 'warning'}">
      <div class="rollback-stat-value">${analytics.successRate}%</div>
      <div class="rollback-stat-label">Recovery Rate</div>
    </div>
    <div class="rollback-stat">
      <div class="rollback-stat-value">${analytics.avgAttempts}</div>
      <div class="rollback-stat-label">Avg Attempts</div>
    </div>
    <div class="rollback-stat">
      <div class="rollback-stat-value">${Object.keys(analytics.byStory as object).length}</div>
      <div class="rollback-stat-label">Stories Affected</div>
    </div>
  </div>

  ${reasonsHtml ? `
  <div class="rollback-breakdown">
    <h4>By Failure Type</h4>
    <div class="rollback-reasons">
      ${reasonsHtml}
    </div>
  </div>
  ` : ''}

  ${timelineHtml ? `
  <div class="rollback-timeline">
    <h4>Recent Events</h4>
    <div class="rollback-timeline-list">
      ${timelineHtml}
    </div>
  </div>
  ` : ''}
</div>
`;

  return c.html(html);
});

/**
 * GET /api/rollback-stats
 *
 * Returns JSON with rollback statistics for a stream or all streams (US-004).
 */
api.get('/rollback-stats', (c) => {
  const streamId = c.req.query('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ success: false, error: 'Ralph directory not found' });
  }

  if (streamId) {
    // Get stats for a specific stream
    const prdFolder = path.join(ralphRoot, `PRD-${streamId}`);
    if (!fs.existsSync(prdFolder)) {
      return c.json({ success: false, error: `Stream PRD-${streamId} not found` });
    }

    const analytics = getRollbackAnalytics(prdFolder);
    return c.json({
      success: true,
      streamId,
      ...analytics,
    });
  }

  // Get aggregated stats for all streams
  const streams = getStreams();
  const allStats = {
    totalRollbacks: 0,
    totalRecovered: 0,
    totalFailed: 0,
    byStream: {} as Record<string, {rollbacks: number, recoveryRate: number}>,
    byReason: {} as Record<string, {count: number, successful: number}>,
  };

  for (const stream of streams) {
    const prdFolder = path.join(ralphRoot, `PRD-${stream.id}`);
    if (!fs.existsSync(prdFolder)) continue;

    const analytics = getRollbackAnalytics(prdFolder);
    if (!analytics.hasData) continue;

    allStats.totalRollbacks += analytics.total;
    allStats.totalRecovered += analytics.successful;
    allStats.totalFailed += analytics.failed;

    allStats.byStream[stream.id] = {
      rollbacks: analytics.total,
      recoveryRate: analytics.successRate,
    };

    // Aggregate by reason
    for (const [reason, stats] of Object.entries(analytics.byReason as Record<string, {count: number, successful: number}>)) {
      if (!allStats.byReason[reason]) {
        allStats.byReason[reason] = { count: 0, successful: 0 };
      }
      allStats.byReason[reason].count += stats.count;
      allStats.byReason[reason].successful += stats.successful;
    }
  }

  const overallRecoveryRate = allStats.totalRollbacks > 0
    ? Math.round((allStats.totalRecovered / allStats.totalRollbacks) * 100)
    : 0;

  return c.json({
    success: true,
    total: allStats.totalRollbacks,
    recovered: allStats.totalRecovered,
    failed: allStats.totalFailed,
    recoveryRate: overallRecoveryRate,
    byStream: allStats.byStream,
    byReason: allStats.byReason,
  });
});

// ============================================
// SUCCESS RATE TRENDS ENDPOINTS (US-001)
// ============================================

/**
 * GET /api/trends/success-rate
 *
 * Returns success rate trend data for visualization.
 * Query params:
 *   - period: '7d' or '30d' (default: '7d')
 *   - prd: PRD ID to filter by (optional)
 *   - agent: Agent name to filter by (optional)
 *   - developer: Developer to filter by (optional)
 */
api.get("/trends/success-rate", (c) => {
  const periodParam = c.req.query("period") || "7d";
  const period = periodParam === "30d" ? "30d" : "7d";
  const prd = c.req.query("prd");
  const agent = c.req.query("agent");
  const developer = c.req.query("developer");

  const trends = getSuccessRateTrends(period, { prd, agent, developer });
  const chartData = formatForChart(trends);
  const weekOverWeek = getWeekOverWeek({ prd, agent, developer });

  return c.json({
    trends,
    chartData,
    weekOverWeek,
  });
});

/**
 * GET /api/trends/filters
 *
 * Returns available filter options for success rate trends.
 */
api.get("/trends/filters", (c) => {
  const options = getFilterOptions();
  return c.json(options);
});

/**
 * GET /api/trends/cost
 *
 * Returns cost trend data for visualization.
 * Query params:
 *   - period: '7d' or '30d' (default: '30d')
 *   - groupBy: 'day' or 'week' (default: 'day')
 *   - prd: PRD ID to filter by (optional)
 *   - model: Model name to filter by (optional)
 *   - budget: Daily budget in dollars for comparison (optional)
 */
api.get("/trends/cost", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const groupBy = (c.req.query("groupBy") || "day") as "day" | "week";
  const prd = c.req.query("prd");
  const model = c.req.query("model");
  const budgetParam = c.req.query("budget");

  const filters = { prd, model, groupBy };

  // If budget is provided, return data with budget comparison
  if (budgetParam) {
    const dailyBudget = parseFloat(budgetParam);
    if (isNaN(dailyBudget) || dailyBudget <= 0) {
      return c.json(
        {
          error: "bad_request",
          message: "Invalid budget parameter. Must be a positive number.",
        },
        400
      );
    }

    const trends = getCostTrendsWithBudget(period, dailyBudget, filters);
    const chartData = formatCostForChart(trends, {
      showBudget: true,
      dailyBudget,
    });
    const modelBreakdownChart = formatModelBreakdownForChart(trends.byModel);

    return c.json({
      trends,
      chartData,
      modelBreakdownChart,
      period,
      filters: trends.filters,
    });
  }

  // Return standard cost trends
  const trends = getCostTrends(period, filters);
  const chartData = formatCostForChart(trends);
  const modelBreakdownChart = formatModelBreakdownForChart(trends.byModel);

  return c.json({
    trends,
    chartData,
    modelBreakdownChart,
    period,
    filters: trends.filters,
  });
});

/**
 * GET /api/trends/cost/filters
 *
 * Returns available filter options for cost trends.
 */
api.get("/trends/cost/filters", (c) => {
  const options = getCostFilterOptions();
  return c.json(options);
});

/**
 * GET /api/partials/cost-chart
 *
 * Returns HTML fragment for the cost trend summary section.
 */
api.get("/partials/cost-chart", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const prd = c.req.query("prd");
  const model = c.req.query("model");
  const budgetParam = c.req.query("budget");

  const filters = { prd, model };
  let trends;

  if (budgetParam) {
    const dailyBudget = parseFloat(budgetParam);
    if (!isNaN(dailyBudget) && dailyBudget > 0) {
      trends = getCostTrendsWithBudget(period, dailyBudget, filters);
    } else {
      trends = getCostTrends(period, filters);
    }
  } else {
    trends = getCostTrends(period, filters);
  }

  // Format variance for display
  const hasBudget = "totalVariance" in trends;
  const totalVariance = hasBudget ? (trends as unknown as { totalVariance: number }).totalVariance : 0;
  const varianceClass = hasBudget && totalVariance >= 0 ? "positive" : "negative";
  const varianceSign = hasBudget && totalVariance >= 0 ? "+" : "";

  // Calculate total tokens from byModel breakdown
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  if (trends.byModel) {
    for (const model of Object.keys(trends.byModel)) {
      const modelData = trends.byModel[model] as { inputTokens?: number; outputTokens?: number };
      totalInputTokens += modelData.inputTokens || 0;
      totalOutputTokens += modelData.outputTokens || 0;
    }
  }

  // Format token numbers with commas for readability
  const formatNumber = (num: number) => num.toLocaleString('en-US');

  const varianceColor = hasBudget && totalVariance >= 0 ? "var(--rams-success)" : "var(--rams-error)";
  const html = `
    <div class="rams-card-grid" style="margin-bottom: var(--rams-space-4);">
      <div class="rams-metric-card">
        <div class="rams-metric-value">$${trends.totalCost.toFixed(2)}</div>
        <div class="rams-metric-label">Total Cost</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.totalRuns}</div>
        <div class="rams-metric-label">Total Runs</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.totalStories}</div>
        <div class="rams-metric-label">Stories</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">$${trends.avgCostPerStory.toFixed(4)}</div>
        <div class="rams-metric-label">Avg Cost/Story</div>
        <div class="rams-text-muted" style="font-size: 0.75rem;">${formatNumber(totalInputTokens)} in / ${formatNumber(totalOutputTokens)} out tokens</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">$${trends.avgCostPerRun.toFixed(4)}</div>
        <div class="rams-metric-label">Avg Cost/Run</div>
      </div>
      ${hasBudget ? `
      <div class="rams-metric-card">
        <div class="rams-metric-value" style="color: ${varianceColor};">${varianceSign}$${Math.abs(totalVariance).toFixed(2)}</div>
        <div class="rams-metric-label">vs Budget</div>
      </div>
      ` : ""}
    </div>
    <div class="rams-text-muted" style="font-size: 0.875rem;">
      Showing data for ${period === "7d" ? "last 7 days" : "last 30 days"} &bull; ${trends.dailyMetrics.length} data points
    </div>
  `;

  return c.html(html);
});

/**
 * GET /api/partials/cost-filters
 *
 * Returns HTML fragment for cost trend filter dropdowns.
 */
api.get("/partials/cost-filters", (c) => {
  const options = getCostFilterOptions();

  const prdOptions = options.prds
    .map((prd) => `<option value="${prd}">PRD-${prd}</option>`)
    .join("");

  const modelOptions = options.models
    .map((model) => `<option value="${model}">${model}</option>`)
    .join("");

  const html = `
    <div style="display: flex; gap: var(--rams-space-4); flex-wrap: wrap; align-items: center;">
      <div>
        <label for="cost-prd-filter" class="rams-text-muted" style="font-size: 0.875rem; display: block; margin-bottom: var(--rams-space-1);">PRD:</label>
        <select id="cost-prd-filter" class="rams-select" onchange="updateCostChart()">
          <option value="all" selected>All PRDs</option>
          ${prdOptions}
        </select>
      </div>
      <div>
        <label for="cost-model-filter" class="rams-text-muted" style="font-size: 0.875rem; display: block; margin-bottom: var(--rams-space-1);">Model:</label>
        <select id="cost-model-filter" class="rams-select" onchange="updateCostChart()">
          <option value="all" selected>All Models</option>
          ${modelOptions}
        </select>
      </div>
      <div>
        <label for="cost-budget-input" class="rams-text-muted" style="font-size: 0.875rem; display: block; margin-bottom: var(--rams-space-1);">Budget ($/day):</label>
        <input type="number" id="cost-budget-input" class="rams-input" min="0" step="0.01" placeholder="Optional" onchange="updateCostChart()" style="width: 100px;">
      </div>
    </div>
  `;

  return c.html(html);
});

/**
 * GET /api/partials/success-rate-chart
 *
 * Returns HTML fragment for the success rate trend chart section.
 */
api.get("/partials/success-rate-chart", (c) => {
  const periodParam = c.req.query("period") || "7d";
  const period = periodParam === "30d" ? "30d" : "7d";
  const prd = c.req.query("prd");
  const agent = c.req.query("agent");

  const trends = getSuccessRateTrends(period, { prd, agent });
  const weekOverWeek = getWeekOverWeek({ prd, agent });

  // Calculate trend arrow and color
  let trendArrow = "→";
  let trendClass = "stable";
  if (weekOverWeek.delta !== null && weekOverWeek.delta !== 0) {
    if (weekOverWeek.delta > 0) {
      trendArrow = "↑";
      trendClass = "improved";
    } else {
      trendArrow = "↓";
      trendClass = "declined";
    }
  }

  const deltaText = weekOverWeek.delta !== null
    ? `${weekOverWeek.delta > 0 ? "+" : ""}${weekOverWeek.delta}%`
    : "N/A";

  // Build significant changes HTML
  let changesHtml = "";
  if (trends.significantChanges.length > 0) {
    const changeItems = trends.significantChanges
      .slice(0, 3) // Show max 3
      .map((change) => {
        const icon = change.direction === "improved" ? "↑" : "↓";
        const changeColor = change.direction === "improved" ? "var(--rams-success)" : "var(--rams-error)";
        const formattedDate = new Date(change.date).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });
        return `<div style="display: flex; align-items: center; gap: var(--rams-space-2); padding: var(--rams-space-2) 0; border-bottom: 1px solid var(--rams-border);">
          <span style="color: ${changeColor}; font-weight: 600;">${icon}</span>
          <span class="rams-text-muted">${formattedDate}</span>
          <span style="color: ${changeColor}; font-weight: 600;">${change.delta > 0 ? "+" : ""}${change.delta}%</span>
        </div>`;
      })
      .join("");
    changesHtml = `<div class="rams-card" style="margin-top: var(--rams-space-4);">
      <h4 class="rams-h4" style="margin-bottom: var(--rams-space-3);">Significant Changes</h4>
      ${changeItems}
    </div>`;
  }

  // Build summary card
  const trendColor = trendClass === "improved" ? "var(--rams-success)" : trendClass === "declined" ? "var(--rams-error)" : "var(--rams-text-muted)";
  const html = `
    <div class="rams-card-grid" style="margin-bottom: var(--rams-space-4);">
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.overallSuccessRate !== null ? trends.overallSuccessRate + "%" : "N/A"}</div>
        <div class="rams-metric-label">Success Rate</div>
        <div style="font-size: 0.875rem; color: ${trendColor};">
          <span>${trendArrow}</span>
          <span>${deltaText}</span>
          <span class="rams-text-muted" style="margin-left: var(--rams-space-1);">vs last week</span>
        </div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.totalRuns}</div>
        <div class="rams-metric-label">Total Runs</div>
        <div class="rams-text-muted" style="font-size: 0.875rem;">${trends.totalPassed} passed, ${trends.totalFailed} failed</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.dailyMetrics.length}</div>
        <div class="rams-metric-label">Active Days</div>
        <div class="rams-text-muted" style="font-size: 0.875rem;">${period === "7d" ? "Last 7 days" : "Last 30 days"}</div>
      </div>
    </div>
    ${changesHtml}
  `;

  return c.html(html);
});

/**
 * GET /api/partials/success-rate-filters
 *
 * Returns HTML fragment for the filter dropdown options.
 */
api.get("/partials/success-rate-filters", (c) => {
  const options = getFilterOptions();

  // Build PRD options
  let prdOptions = '<option value="all">All PRDs</option>';
  for (const prd of options.prds) {
    prdOptions += `<option value="${prd}">PRD-${prd}</option>`;
  }

  // Build agent options
  let agentOptions = '<option value="all">All Agents</option>';
  for (const agent of options.agents) {
    const displayName = agent.charAt(0).toUpperCase() + agent.slice(1);
    agentOptions += `<option value="${agent}">${displayName}</option>`;
  }

  const html = `
    <div style="display: flex; gap: var(--rams-space-4); flex-wrap: wrap; align-items: center;">
      <div>
        <label for="trend-prd-filter" class="rams-text-muted" style="font-size: 0.875rem; display: block; margin-bottom: var(--rams-space-1);">PRD:</label>
        <select id="trend-prd-filter" class="rams-select" onchange="updateSuccessRateChart()">
          ${prdOptions}
        </select>
      </div>
      <div>
        <label for="trend-agent-filter" class="rams-text-muted" style="font-size: 0.875rem; display: block; margin-bottom: var(--rams-space-1);">Agent:</label>
        <select id="trend-agent-filter" class="rams-select" onchange="updateSuccessRateChart()">
          ${agentOptions}
        </select>
      </div>
    </div>
  `;

  return c.html(html);
});

// ============================================
// VELOCITY METRICS ENDPOINTS (US-003)
// ============================================

/**
 * GET /api/trends/velocity
 *
 * Returns velocity trend data for visualization.
 * Query params:
 *   - period: '7d' or '30d' (default: '30d')
 *   - prd: PRD ID to filter by (optional)
 *   - groupBy: 'day' or 'week' (default: 'day')
 */
api.get("/trends/velocity", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const prd = c.req.query("prd");
  const groupBy = (c.req.query("groupBy") || "day") as "day" | "week";

  const filters = { prd, groupBy };
  const trends = getVelocityTrends(period, filters);
  const chartData = formatVelocityForChart(trends);

  return c.json({
    trends,
    chartData,
    period,
    filters: trends.filters,
  });
});

/**
 * GET /api/trends/burndown/:prdId
 *
 * Returns burndown chart data for a specific PRD.
 */
api.get("/trends/burndown/:prdId", (c) => {
  const prdId = c.req.param("prdId");

  const burndown = getBurndown(prdId);

  if (!burndown) {
    return c.json(
      {
        error: "not_found",
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const chartData = formatBurndownForChart(burndown);

  return c.json({
    burndown,
    chartData,
  });
});

/**
 * GET /api/trends/streams
 *
 * Returns velocity comparison across all streams.
 * Query params:
 *   - period: '7d' or '30d' (default: '30d')
 */
api.get("/trends/streams", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";

  const comparison = getStreamVelocityComparison(period);
  const chartData = formatStreamComparisonForChart(comparison);

  return c.json({
    comparison,
    chartData,
  });
});

/**
 * GET /api/partials/velocity-chart
 *
 * Returns HTML fragment for the velocity summary section.
 */
api.get("/partials/velocity-chart", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const prd = c.req.query("prd");

  const trends = getVelocityTrends(period, { prd });

  const html = `
    <div class="rams-card-grid" style="margin-bottom: var(--rams-space-4);">
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.totalStories}</div>
        <div class="rams-metric-label">Stories Completed</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.storiesPerDay}</div>
        <div class="rams-metric-label">Stories/Day</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.storiesPerWeek}</div>
        <div class="rams-metric-label">Stories/Week</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.avgTimePerStoryMinutes} min</div>
        <div class="rams-metric-label">Avg Time/Story</div>
      </div>
      <div class="rams-metric-card">
        <div class="rams-metric-value">${trends.totalRuns}</div>
        <div class="rams-metric-label">Total Runs</div>
      </div>
    </div>
    <div class="rams-text-muted" style="font-size: 0.875rem;">
      Showing data for ${period === "7d" ? "last 7 days" : "last 30 days"} &bull; ${trends.velocityMetrics.length} data points
    </div>
  `;

  return c.html(html);
});

/**
 * GET /api/partials/burndown-chart/:prdId
 *
 * Returns HTML fragment for burndown chart summary.
 */
api.get("/partials/burndown-chart/:prdId", (c) => {
  const prdId = c.req.param("prdId");

  const burndown = getBurndown(prdId);

  if (!burndown) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">PRD-${prdId} not found</p></div>`);
  }

  // Calculate status
  let statusColor = "var(--rams-success)";
  let statusText = "On Track";
  if (burndown.remainingStories === 0) {
    statusColor = "var(--rams-accent)";
    statusText = "Complete";
  } else if (burndown.velocity < 0.5 && burndown.remainingStories > 0) {
    statusColor = "var(--rams-warning)";
    statusText = "At Risk";
  }

  const html = `
    <div class="rams-card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-4);">
        <h3 class="rams-h3">PRD-${prdId} Burndown</h3>
        <span class="rams-badge" style="background: ${statusColor}; color: white;">${statusText}</span>
      </div>
      <div class="rams-card-grid">
        <div>
          <div class="rams-metric-value">${burndown.completedStories}/${burndown.totalStories}</div>
          <div class="rams-text-muted" style="font-size: 0.875rem;">Stories Done</div>
        </div>
        <div>
          <div class="rams-metric-value">${burndown.percentComplete}%</div>
          <div class="rams-text-muted" style="font-size: 0.875rem;">Complete</div>
        </div>
        <div>
          <div class="rams-metric-value">${burndown.velocity}</div>
          <div class="rams-text-muted" style="font-size: 0.875rem;">Velocity (stories/day)</div>
        </div>
        <div>
          <div class="rams-metric-value">${burndown.estimatedCompletion || "N/A"}</div>
          <div class="rams-text-muted" style="font-size: 0.875rem;">Est. Completion</div>
        </div>
      </div>
    </div>
  `;

  return c.html(html);
});

/**
 * GET /api/partials/stream-comparison
 *
 * Returns HTML fragment for stream velocity comparison.
 */
api.get("/partials/stream-comparison", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";

  const comparison = getStreamVelocityComparison(period);

  if (comparison.streams.length === 0) {
    return c.html(`<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No streams with velocity data found.</p></div>`);
  }

  const streamRows = comparison.streams
    .map((stream) => `
      <tr style="border-bottom: 1px solid var(--rams-border);">
        <td style="padding: var(--rams-space-3);">${stream.name}</td>
        <td style="padding: var(--rams-space-3); text-align: center;">${stream.totalStories}</td>
        <td style="padding: var(--rams-space-3); text-align: center;">${stream.storiesPerDay}</td>
        <td style="padding: var(--rams-space-3); text-align: center;">${stream.avgTimePerStoryMinutes} min</td>
        <td style="padding: var(--rams-space-3);">
          <div class="rams-progress" style="min-width: 100px;">
            <div class="rams-progress-fill" style="width: ${stream.percentComplete}%"></div>
          </div>
          <span class="rams-text-muted" style="font-size: 0.75rem;">${stream.percentComplete}%</span>
        </td>
        <td style="padding: var(--rams-space-3);">${stream.estimatedCompletion || "N/A"}</td>
      </tr>
    `)
    .join("");

  const html = `
    <div class="rams-card" style="margin-bottom: var(--rams-space-4); padding: var(--rams-space-3);">
      <span class="rams-text-muted">Overall: ${comparison.overall.avgStoriesPerDay} stories/day across ${comparison.streamCount} streams</span>
    </div>
    <div class="rams-card" style="overflow-x: auto;">
      <table style="width: 100%;">
        <thead>
          <tr style="border-bottom: 2px solid var(--rams-border);">
            <th style="padding: var(--rams-space-3); text-align: left; font-weight: 600;">Stream</th>
            <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600;">Stories</th>
            <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600;">Velocity</th>
            <th style="padding: var(--rams-space-3); text-align: center; font-weight: 600;">Avg Time</th>
            <th style="padding: var(--rams-space-3); text-align: left; font-weight: 600;">Progress</th>
            <th style="padding: var(--rams-space-3); text-align: left; font-weight: 600;">Est. Completion</th>
          </tr>
        </thead>
        <tbody>
          ${streamRows}
        </tbody>
      </table>
    </div>
  `;

  return c.html(html);
});

/**
 * GET /api/partials/velocity-filters
 *
 * Returns HTML fragment for velocity trend filter dropdowns.
 */
api.get("/partials/velocity-filters", (c) => {
  const options = getFilterOptions();

  const prdOptions = options.prds
    .map((prd) => `<option value="${prd}">PRD-${prd}</option>`)
    .join("");

  const html = `
    <div style="display: flex; gap: var(--rams-space-4); flex-wrap: wrap; align-items: center;">
      <div>
        <label for="velocity-prd-filter" class="rams-text-muted" style="font-size: 0.875rem; display: block; margin-bottom: var(--rams-space-1);">PRD:</label>
        <select id="velocity-prd-filter" class="rams-select" onchange="updateVelocityChart()">
          <option value="all" selected>All PRDs</option>
          ${prdOptions}
        </select>
      </div>
    </div>
  `;

  return c.html(html);
});

// ============================================
// EXPORT ENDPOINTS (US-004)
// ============================================

/**
 * GET /api/trends/export
 *
 * Export trend data in CSV or JSON format.
 * Query params:
 *   - format: 'csv' or 'json' (default: 'json')
 *   - metrics: 'all', 'success-rate', 'cost', or 'velocity' (default: 'all')
 *   - period: '7d' or '30d' (default: '30d')
 *   - prd: PRD ID to filter by (optional)
 */
api.get("/trends/export", (c) => {
  const format = (c.req.query("format") || "json") as "csv" | "json";
  const metrics = (c.req.query("metrics") || "all") as "all" | "success-rate" | "cost" | "velocity";
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const prd = c.req.query("prd");

  const options: ExportOptions = {
    format,
    metrics,
    period,
    prd,
  };

  const exportData = getExportData(options);

  if (format === "csv") {
    const csv = exportToCsv(exportData, metrics);
    const filename = `ralph-trends-${metrics}-${period}-${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }

  // JSON format
  const filename = `ralph-trends-${metrics}-${period}-${new Date().toISOString().split("T")[0]}.json`;

  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

/**
 * GET /api/partials/export-controls
 *
 * Returns HTML fragment for export controls.
 */
api.get("/partials/export-controls", (c) => {
  const html = `
    <div class="export-controls">
      <div class="export-header">
        <h3>Export Reports</h3>
        <p class="export-description">Download trend data for sharing with stakeholders.</p>
      </div>
      <div class="export-options">
        <div class="control-group">
          <label for="export-format">Format:</label>
          <select id="export-format">
            <option value="csv" selected>CSV (Spreadsheet)</option>
            <option value="json">JSON (Data)</option>
          </select>
        </div>
        <div class="control-group">
          <label for="export-metrics">Metrics:</label>
          <select id="export-metrics">
            <option value="all" selected>All Metrics</option>
            <option value="success-rate">Success Rate Only</option>
            <option value="cost">Cost Only</option>
            <option value="velocity">Velocity Only</option>
          </select>
        </div>
        <div class="control-group">
          <label for="export-period">Period:</label>
          <select id="export-period">
            <option value="7d">Last 7 days</option>
            <option value="30d" selected>Last 30 days</option>
          </select>
        </div>
      </div>
      <div class="export-actions">
        <button class="export-button export-csv" onclick="exportData('csv')">
          <span class="export-icon">&#8615;</span> Download CSV
        </button>
        <button class="export-button export-json" onclick="exportData('json')">
          <span class="export-icon">&#123;&#125;</span> Download JSON
        </button>
      </div>
    </div>
  `;

  return c.html(html);
});

/**
 * =============================================================================
 * Wizard API Endpoints
 *
 * Endpoints for the New Stream Wizard flow.
 * Supports PRD generation, plan generation, and real-time status streaming.
 * =============================================================================
 */

/**
 * POST /api/stream/wizard/start
 *
 * Start the wizard flow by initiating PRD generation.
 * Request body: { description: string }
 *
 * ralph prd will auto-create a new PRD-N folder.
 * Waits briefly for the PRD folder to be created, then returns the stream ID.
 *
 * Returns:
 *   - 200 with { success: true, streamId: string, message: string }
 *   - 400 if description is missing or too short
 *   - 404 if .ralph directory not found
 *   - 500 on error
 */
api.post("/stream/wizard/start", async (c) => {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: '.ralph directory not found. Run "ralph install" first.',
      },
      404
    );
  }

  // Parse request body
  let body: { description?: string } = {};
  try {
    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    }
  } catch {
    // Proceed with empty description
  }

  // Validate description
  if (!body.description || body.description.trim().length < 20) {
    return c.json(
      {
        error: "validation_error",
        message: "Description must be at least 20 characters",
      },
      400
    );
  }

  try {
    // Start PRD generation - ralph prd will create the PRD-N folder
    const result = wizardProcessManager.startPrdGeneration(body.description);

    if (!result.success) {
      return c.json(
        {
          error: "generation_failed",
          message: result.status.error || "Failed to start PRD generation",
        },
        500
      );
    }

    // Wait for the PRD folder to be created (ralph prd outputs this early)
    // Timeout after 10 seconds if no folder is created
    const streamId = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for PRD folder creation"));
      }, 10000);

      if (result.eventEmitter) {
        result.eventEmitter.once("prd-created", async (data: { streamId: string }) => {
          clearTimeout(timeout);
          console.log(`[API] PRD-${data.streamId} creation announced`);

          // VALIDATION: Wait for folder to actually exist on disk
          const expectedPath = path.join(ralphRoot, `PRD-${data.streamId}`);
          const maxRetries = 10;
          const retryDelay = 200;

          for (let i = 0; i < maxRetries; i++) {
            if (fs.existsSync(expectedPath)) {
              console.log(`[API] PRD-${data.streamId} folder verified`);
              resolve(data.streamId);
              return;
            }
            await new Promise(r => setTimeout(r, retryDelay));
          }

          reject(new Error(`PRD-${data.streamId} folder not found on disk`));
        });

        // Also listen for errors
        result.eventEmitter.once("error", (event: { data: { message?: string } }) => {
          clearTimeout(timeout);
          reject(new Error(event.data.message || "PRD generation failed"));
        });
      } else {
        clearTimeout(timeout);
        reject(new Error("No event emitter available"));
      }
    });

    const streamPath = path.join(ralphRoot, `PRD-${streamId}`);

    return c.json({
      success: true,
      streamId,
      path: streamPath,
      message: "PRD generation started",
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to start wizard: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * GET /api/stream/:id/generation-status
 *
 * Get the current generation status for a stream.
 * Checks if ralph process is running, and file existence for completion.
 *
 * Returns:
 *   - 200 with { status, phase?, progress?, error? }
 *   - 404 if stream doesn't exist
 */
api.get("/stream/:id/generation-status", (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: ".ralph directory not found",
      },
      404
    );
  }

  const streamPath = path.join(ralphRoot, `PRD-${id}`);
  if (!fs.existsSync(streamPath)) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Get status from wizard process manager
  const status = wizardProcessManager.getStatus(id);

  // If idle, check file existence to determine actual status
  if (status.status === "idle") {
    const prdPath = path.join(streamPath, "prd.md");
    const planPath = path.join(streamPath, "plan.md");

    const hasPrd = fs.existsSync(prdPath);
    const hasPlan = fs.existsSync(planPath);

    // Check if PRD has content (not just template)
    let prdHasContent = false;
    if (hasPrd) {
      try {
        const content = fs.readFileSync(prdPath, "utf-8");
        // Check if it has user stories with actual content
        prdHasContent = content.includes("US-001") && content.length > 500;
      } catch {
        // Ignore read errors
      }
    }

    return c.json({
      status: "idle",
      prdExists: hasPrd,
      prdHasContent,
      planExists: hasPlan,
      phase: hasPlan ? "complete" : hasPrd && prdHasContent ? "prd_complete" : "not_started",
    });
  }

  return c.json({
    status: status.status,
    type: status.type,
    phase: status.phase,
    progress: status.progress,
    error: status.error,
    startedAt: status.startedAt?.toISOString(),
  });
});

/**
 * POST /api/stream/:id/cancel
 *
 * Cancel an ongoing generation process for a stream.
 * Stops the running PRD or plan generation process.
 */
api.post("/stream/:id/cancel", (c) => {
  const id = c.req.param("id");

  // Try to cancel using wizard process manager
  const result = wizardProcessManager.cancel(id);

  if (result.success) {
    return c.json({ success: true, message: result.message });
  }

  return c.json(
    { error: "cancel_failed", message: result.message },
    400
  );
});

/**
 * GET /api/stream/:id/prd
 *
 * Get the PRD content for a stream.
 * Returns the raw markdown content of the prd.md file.
 */
api.get("/stream/:id/prd", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_found", message: ".ralph not found" }, 404);
  }

  const prdPath = path.join(ralphRoot, `PRD-${id}`, "prd.md");

  if (!fs.existsSync(prdPath)) {
    return c.json({ error: "not_found", message: "PRD not found" }, 404);
  }

  const content = fs.readFileSync(prdPath, "utf-8");
  return c.json({ success: true, content });
});

/**
 * PUT /api/stream/:id/prd
 *
 * Update the PRD content for a stream.
 * Overwrites the prd.md file with the provided content.
 */
api.put("/stream/:id/prd", async (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_found", message: ".ralph not found" }, 404);
  }

  const prdPath = path.join(ralphRoot, `PRD-${id}`, "prd.md");

  if (!fs.existsSync(path.dirname(prdPath))) {
    return c.json({ error: "not_found", message: "Stream not found" }, 404);
  }

  const body = await c.req.json();

  if (body.content === undefined) {
    return c.json({ error: "bad_request", message: "Content required" }, 400);
  }

  fs.writeFileSync(prdPath, body.content, "utf-8");
  return c.json({ success: true, message: "PRD updated" });
});

/**
 * POST /api/stream/:id/generate-plan
 *
 * Trigger plan generation for a stream.
 * Executes `ralph plan --prd=:id` asynchronously.
 *
 * Returns:
 *   - 200 with { success: true, message }
 *   - 404 if stream doesn't exist
 *   - 409 if generation already in progress
 *   - 500 on error
 */
api.post("/stream/:id/generate-plan", (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: ".ralph directory not found",
      },
      404
    );
  }

  const streamPath = path.join(ralphRoot, `PRD-${id}`);
  if (!fs.existsSync(streamPath)) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Check if PRD exists
  const prdPath = path.join(streamPath, "prd.md");
  if (!fs.existsSync(prdPath)) {
    return c.json(
      {
        error: "precondition_failed",
        message: "PRD must be generated before creating a plan",
      },
      412
    );
  }

  // Check if already generating
  if (wizardProcessManager.isGenerating(id)) {
    return c.json(
      {
        error: "conflict",
        message: "Generation already in progress for this stream",
      },
      409
    );
  }

  // Start plan generation
  const result = wizardProcessManager.startPlanGeneration(id);

  if (!result.success) {
    return c.json(
      {
        error: "generation_failed",
        message: result.status.error || "Failed to start plan generation",
      },
      500
    );
  }

  return c.json({
    success: true,
    message: "Plan generation started",
  });
});

/**
 * GET /api/stream/:id/generation-stream
 *
 * Server-Sent Events endpoint for real-time generation progress.
 * Query param: type=prd|plan to indicate what's being generated.
 *
 * Stream events:
 *   - { type: 'phase', data: { phase, progress } }
 *   - { type: 'output', data: { text } }
 *   - { type: 'complete', data: { success: true } }
 *   - { type: 'error', data: { message } }
 */
api.get("/stream/:id/generation-stream", (c) => {
  const id = c.req.param("id");
  const generationType = c.req.query("type") as "prd" | "plan" | undefined;

  // Validate stream exists
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: ".ralph directory not found",
      },
      404
    );
  }

  const streamPath = path.join(ralphRoot, `PRD-${id}`);
  if (!fs.existsSync(streamPath)) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  return streamSSE(c, async (stream) => {
    // Get the event emitter for this stream
    let eventEmitter = wizardProcessManager.getEventEmitter(id);
    let isConnected = true;

    // Send initial connection event
    try {
      const status = wizardProcessManager.getStatus(id);
      await stream.writeSSE({
        event: "connected",
        data: JSON.stringify({
          streamId: id,
          type: generationType,
          status: status.status,
          phase: status.phase,
          progress: status.progress,
          timestamp: new Date().toISOString(),
        }),
      });
    } catch (error) {
      console.log(`[SSE] Error sending connected event: ${error}`);
      isConnected = false;
    }

    // If no active generation, check status and close
    if (!eventEmitter) {
      const status = wizardProcessManager.getStatus(id);
      try {
        await stream.writeSSE({
          event: status.status === "complete" ? "complete" : "idle",
          data: JSON.stringify({
            streamId: id,
            status: status.status,
            phase: status.phase,
            message: status.status === "complete"
              ? "Generation already complete"
              : "No active generation",
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        // Ignore
      }
      return;
    }

    // Set up event handlers
    const handlers: { event: string; handler: (event: WizardOutputEvent) => Promise<void> }[] = [];

    const createHandler = (eventType: string) => {
      return async (event: WizardOutputEvent) => {
        if (!isConnected) return;
        try {
          await stream.writeSSE({
            event: eventType,
            data: JSON.stringify({
              type: event.type,
              streamId: event.streamId,
              data: event.data,
              timestamp: event.timestamp.toISOString(),
            }),
          });
        } catch (error) {
          console.log(`[SSE] Error writing ${eventType} event: ${error}`);
          isConnected = false;
        }
      };
    };

    // Register handlers for all event types
    for (const eventType of ["phase", "output", "complete", "error"]) {
      const handler = createHandler(eventType);
      handlers.push({ event: eventType, handler });
      eventEmitter.on(eventType, handler);
    }

    // Set up heartbeat
    const heartbeatInterval = setInterval(async () => {
      if (!isConnected) {
        clearInterval(heartbeatInterval);
        return;
      }
      try {
        await stream.writeSSE({
          event: "heartbeat",
          data: JSON.stringify({ timestamp: new Date().toISOString() }),
        });
      } catch {
        isConnected = false;
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    // Keep stream alive until disconnected or generation completes
    try {
      while (isConnected && wizardProcessManager.isGenerating(id)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Send final status if still connected
      if (isConnected) {
        const finalStatus = wizardProcessManager.getStatus(id);
        await stream.writeSSE({
          event: finalStatus.status === "complete" ? "complete" : "status",
          data: JSON.stringify({
            streamId: id,
            status: finalStatus.status,
            phase: finalStatus.phase,
            progress: finalStatus.progress,
            error: finalStatus.error,
            timestamp: new Date().toISOString(),
          }),
        });
      }
    } catch (error) {
      console.log(`[SSE] Stream loop ended: ${error}`);
    }

    // Cleanup
    isConnected = false;
    clearInterval(heartbeatInterval);

    // Remove event listeners
    for (const { event, handler } of handlers) {
      eventEmitter?.off(event, handler);
    }

    console.log(`[SSE] Generation stream for PRD-${id} disconnected`);
  });
});

/**
 * POST /api/stream/:id/generation-cancel
 *
 * Cancel an in-progress generation.
 * Kills the ralph process if running.
 *
 * Returns:
 *   - 200 with { success: true }
 *   - 404 if stream doesn't exist
 *   - 409 if no generation in progress
 */
api.post("/stream/:id/generation-cancel", (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: ".ralph directory not found",
      },
      404
    );
  }

  const streamPath = path.join(ralphRoot, `PRD-${id}`);
  if (!fs.existsSync(streamPath)) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Check if generating
  if (!wizardProcessManager.isGenerating(id)) {
    return c.json(
      {
        error: "conflict",
        message: "No generation in progress for this stream",
      },
      409
    );
  }

  // Cancel the generation
  const result = wizardProcessManager.cancel(id);

  if (!result.success) {
    return c.json(
      {
        error: "cancel_failed",
        message: result.message,
      },
      500
    );
  }

  return c.json({
    success: true,
    message: result.message,
  });
});

export { api };
