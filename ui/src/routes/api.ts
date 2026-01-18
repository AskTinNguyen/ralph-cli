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
import { getCriticalAlerts } from '../services/alerts-reader.js';
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

// Sub-routers for modular API organization
import { agents } from './api/agents.js';
import { checkpoint } from './api/checkpoint.js';
import { wizard } from './api/wizard.js';
import { trends } from './api/trends.js';
import { tokens } from './api/tokens.js';
import { realtime } from './api/realtime.js';
import { streams } from './api/streams.js';
import { estimation } from './api/estimation.js';
import { kanban } from './api/kanban.js';
import blockerResolution from './api/blocker-resolution.js';

// Partials sub-routers for HTML fragments
import { tokenPartials } from './api/partials/tokens.js';
import { trendsPartials } from './api/partials/trends.js';
import { dashboardPartials } from './api/partials/dashboard.js';
import { estimationPartials } from './api/partials/estimation.js';

// Shared utilities
import { formatDuration, formatTokens, formatCost } from './utils/formatters.js';

const api = new Hono();

// Mount sub-routers for modular API organization
api.route('/agents', agents);
api.route('/', checkpoint);
api.route('/', wizard);
api.route('/trends', trends);
api.route('/tokens', tokens);
api.route('/', realtime);
api.route('/streams', streams);
api.route('/kanban', kanban);
api.route('/', estimation);
api.route('/blocker', blockerResolution);

// Mount partials sub-routers for HTML fragments
api.route('/partials', tokenPartials);
api.route('/partials', trendsPartials);
api.route('/partials', dashboardPartials);
api.route('/partials', estimationPartials);

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
<details class="rams-card" style="padding: var(--rams-space-4); cursor: pointer;">
  <summary style="list-style: none; display: flex; align-items: center; gap: var(--rams-space-2); user-select: none;">
    <span style="transform: rotate(0deg); transition: transform 0.2s; display: inline-block;">▶</span>
    <h3 class="rams-h3" style="margin: 0;">Terminal Commands</h3>
    <span class="rams-badge" style="margin-left: auto; background: var(--rams-gray-800); color: var(--rams-gray-400);">Hint</span>
  </summary>
  <div style="margin-top: var(--rams-space-4);">
    <p class="rams-text-muted" style="margin-bottom: var(--rams-space-4);">Run these commands in your terminal to view logs directly:</p>
    ${commandsHtml}
  </div>
  <style>
    details[open] > summary > span:first-of-type {
      transform: rotate(90deg);
    }
  </style>
</details>
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

  // Parse activity logs - try stream-specific first, fall back to global
  let entries = parseActivityLog(streamId);

  // If no stream-specific entries found, also try global activity log
  if (entries.length === 0 && streamId) {
    entries = parseActivityLog(undefined);
  }

  // If stream specified but we got global entries, add note
  // This helps users understand the source of logs

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
      const levelText = entry.level.toUpperCase();

      return `
<div class="rams-card" style="padding: var(--rams-space-3); margin-bottom: var(--rams-space-2); display: flex; gap: var(--rams-space-3); align-items: flex-start;">
  <span class="rams-text-sm rams-text-muted" style="white-space: nowrap;">${timestamp}</span>
  <span class="rams-badge ${levelBadge}" style="font-size: 10px; padding: 2px 6px;">${levelText}</span>
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
  const showClosed = c.req.query('showClosed') === 'true';
  let streams = getStreams();

  // Filter out closed streams unless showClosed=true
  if (!showClosed) {
    streams = streams.filter(s => !s.closed);
  }

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

  // Categorize streams into 4 groups:
  // 1. In Progress = actively running
  // 2. Completed = merged or completed status
  // 3. Idle = has some progress but paused (not running, not completed)
  // 4. Not Started = no progress yet (0 stories completed, not completed/merged)
  const inProgressStreams = streams.filter(s => s.status === 'running');
  const completedStreams = streams.filter(s => s.status === 'completed' || s.merged);
  const idleStreams = streams.filter(s =>
    s.status !== 'running' &&
    s.status !== 'completed' &&
    !s.merged &&
    s.completedStories > 0
  );
  const notStartedStreams = streams.filter(s =>
    s.status !== 'running' &&
    s.status !== 'completed' &&
    !s.merged &&
    s.completedStories === 0
  );

  // Helper to format status for display
  const formatStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      'idle': 'Idle',
      'running': 'Running',
      'merged': 'Merged',
      'completed': 'Completed',
      'in_progress': 'In Progress',
      'ready': 'Ready',
      'error': 'Error',
      'no_prd': 'No PRD',
      'no_stories': 'No Stories',
      'not_found': 'Not Found',
    };
    return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  };

  // Helper to render a stream card
  const renderStreamCard = (stream: Stream) => {
    const completionPercentage =
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0;

    const statusLabel = formatStatus(stream.status);
    const worktreeInitialized = hasWorktree(stream.id);
    const isCompleted = stream.status === "completed";
    const isRunning = stream.status === "running";
    const isMerged = stream.merged;
    const isFullyComplete = stream.totalStories > 0 && stream.completedStories === stream.totalStories;

    // Determine if this stream should be visually muted (finished states)
    const isFinishedState = isMerged || (isCompleted && !worktreeInitialized);

    // Build action buttons based on stream state
    let actionButtonsHtml = "";
    let menuItemsHtml = "";

    const escapedName = escapeHtml(stream.name).replace(/'/g, "\\'").replace(/"/g, "&quot;");

    if (isRunning) {
      // Show Pause/Cancel buttons for running streams
      actionButtonsHtml = `
        <button class="rams-btn rams-btn-warning" onclick="pauseStream('${stream.id}', event)" title="Gracefully stop after current iteration">
          Pause
        </button>
        <button class="rams-btn rams-btn-secondary" onclick="cancelStream('${stream.id}', event)" title="Immediately terminate build">
          Cancel
        </button>`;
    } else {
      // Check if plan is being generated
      const isGeneratingPlan = wizardProcessManager.isGenerating(stream.id);

      if (isGeneratingPlan) {
        // Show generating state with auto-connect to SSE and View Details link
        actionButtonsHtml += `
          <button id="plan-btn-${stream.id}" class="rams-btn rams-btn-primary" disabled>
            <span class="rams-spinner"></span> 0%
          </button>
          <a id="plan-details-link-${stream.id}" href="#" class="rams-text-sm"
             style="margin-left: 8px; color: var(--rams-accent); text-decoration: underline; cursor: pointer;"
             onclick="event.preventDefault(); event.stopPropagation(); showPlanProgress('${stream.id}', event);">
            View Details →
          </a>
          <script>
            (function() {
              var btn = document.getElementById('plan-btn-${stream.id}');
              if (btn && typeof connectToPlanSSE === 'function') {
                connectToPlanSSE('${stream.id}', btn);
              }
            })();
          </script>`;
      } else {
        // Build button logic:
        // - Disabled if: no plan, merged, completed (no worktree), or no worktree initialized (must init first)
        // - Also disabled if 100% complete (all stories done)
        const buildDisabled = !stream.hasPlan || isMerged || (isCompleted && !worktreeInitialized) ||
                             (!worktreeInitialized) || isFullyComplete;
        const buildTitle = !stream.hasPlan ? "Generate plan first (use menu)" :
                          isMerged ? "Already merged to main" :
                          (isCompleted && !worktreeInitialized) ? "Already completed" :
                          isFullyComplete ? "All stories completed" :
                          !worktreeInitialized ? "Initialize worktree first (use menu)" :
                          "Start build iterations";
        actionButtonsHtml += `
          <button class="rams-btn rams-btn-primary" onclick="toggleBuildForm('${stream.id}', event)" title="${buildTitle}" ${buildDisabled ? "disabled" : ""}>
            Build
          </button>`;

        // Merge button logic:
        // - Only show when worktree exists and not running
        // - Disabled only if: already merged OR no progress at all
        // - Shows warning for partial completion but allows merge
        if (worktreeInitialized) {
          const hasAnyProgress = stream.completedStories > 0 || stream.hasProgress;
          const mergeDisabled = isMerged || !hasAnyProgress;
          const mergeTitle = isMerged ? "Already merged to main" :
                            !hasAnyProgress ? "No progress to merge yet" :
                            !isFullyComplete ? `Merge ${stream.completedStories}/${stream.totalStories} stories to main` :
                            "Merge to main branch";
          const mergeClass = isFullyComplete ? "rams-btn-success" : "rams-btn-warning";
          actionButtonsHtml += `
            <button class="rams-btn ${mergeClass}" onclick="mergeStream('${stream.id}', '${escapedName}', event)" title="${mergeTitle}" ${mergeDisabled ? "disabled" : ""}>
              Merge
            </button>`;
        }
      }
    }

    // Build ThreeDots menu items
    // View Estimate
    if (stream.hasPlan) {
      const estimateDisabled = isMerged || (isCompleted && !worktreeInitialized);
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); showStreamDetailAndEstimate('${stream.id}', '${escapedName}');"
                ${estimateDisabled ? "disabled" : ""}>
          📊 View Estimate
        </button>`;
    }

    // View PRD (always available if PRD exists)
    if (stream.hasPrd) {
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); window.open('/editor.html?file=.ralph/PRD-${stream.id}/prd.md', '_blank');">
          📄 View PRD
        </button>`;
    }

    // View Plan (if plan exists)
    if (stream.hasPlan) {
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); window.open('/editor.html?file=.ralph/PRD-${stream.id}/plan.md', '_blank');">
          📋 View Plan
        </button>`;
    }

    // Generate Plan (if plan doesn't exist)
    if (!stream.hasPlan && stream.hasPrd && !wizardProcessManager.isGenerating(stream.id)) {
      const planDisabled = isMerged || isCompleted;
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); triggerPlanGeneration('${stream.id}', event);"
                ${planDisabled ? "disabled" : ""}>
          📋 Generate Plan
        </button>`;
    }

    // Init Worktree (if not initialized)
    if (!worktreeInitialized && !isRunning) {
      const initDisabled = isMerged || isCompleted;
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); initStream('${stream.id}', event);"
                ${initDisabled ? "disabled" : ""}>
          🔄 Init Worktree
        </button>`;
    }

    // Divider before danger zone
    if (menuItemsHtml) {
      menuItemsHtml += `<div class="threedots-menu-divider"></div>`;
    }

    // Close/Archive Stream
    if (!stream.closed) {
      menuItemsHtml += `
        <button class="threedots-menu-item danger"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); closeStream('${stream.id}', event);">
          🗑️ Close Stream
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

    // PRD/Plan readiness badges
    const prdBadgeLabel = stream.hasPrd ? "Ready PRD" : "Missing PRD";
    const planBadgeLabel = stream.hasPlan ? "Ready Plan" : "Not Ready Plan";

    // Determine if editing should be allowed (Not Started = no completed stories and not running/completed/merged)
    const isNotStarted = !isRunning && !isCompleted && !isMerged && stream.completedStories === 0;
    const editableParam = isNotStarted ? '' : '&readonly=true';

    // Clickable badge styles
    const clickableBadgeStyle = 'cursor: pointer; transition: opacity 0.2s;';
    const clickableBadgeHover = 'onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1"';

    return `
<div class="rams-card" style="${cardStyle} position: relative;" onclick="showStreamDetail('${stream.id}', '${escapeHtml(stream.name).replace(/'/g, "\\'")}')">
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
    ${stream.hasPrd
      ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=prd${editableParam}';" title="View PRD${isNotStarted ? ' (editable)' : ''}"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
      : `<span class="rams-badge rams-badge-muted"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
    }
    ${stream.hasPlan
      ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=plan${editableParam}';" title="View Plan${isNotStarted ? ' (editable)' : ''}"><span class="rams-badge-dot"></span>${planBadgeLabel}</span>`
      : `<span class="rams-badge rams-badge-needs-plan" ${stream.hasPrd ? `onclick="event.stopPropagation(); triggerPlanGeneration('${stream.id}', event);" title="Click to generate plan"` : ''}><span class="rams-badge-dot"></span>⚡ ${planBadgeLabel}</span>`
    }
    ${worktreeInitialized ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Worktree</span>' : ""}
  </div>
  <div class="stream-actions-wrapper" style="display: flex; gap: var(--rams-space-2); flex-wrap: wrap;">
    ${actionButtonsHtml}
    ${menuItemsHtml ? `
    <div class="threedots-menu-container">
      <button class="threedots-btn" onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}');" title="More actions">
        ⋮
      </button>
      <div class="threedots-menu" id="threedots-menu-${stream.id}">
        ${menuItemsHtml}
      </div>
    </div>
    ` : ''}
  </div>
  ${buildFormHtml}
</div>
`;
  };

  // Build sections HTML
  const inProgressSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">In Progress</h3>
    <span class="rams-badge rams-badge-running">${inProgressStreams.length}</span>
  </div>
  ${inProgressStreams.length > 0
    ? `<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">${inProgressStreams.map(renderStreamCard).join("")}</div>`
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No PRDs are currently running. Start a build to see activity here.</div>'
  }
</div>`;

  const idleSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">Idle</h3>
    <span class="rams-badge rams-badge-pending">${idleStreams.length}</span>
  </div>
  ${idleStreams.length > 0
    ? `<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">${idleStreams.map(renderStreamCard).join("")}</div>`
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No idle PRDs.</div>'
  }
</div>`;

  const notStartedSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">Not Started</h3>
    <span class="rams-badge rams-badge-idle">${notStartedStreams.length}</span>
  </div>
  ${notStartedStreams.length > 0
    ? `<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">${notStartedStreams.map(renderStreamCard).join("")}</div>`
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No PRDs waiting to start. Create a new stream to get started.</div>'
  }
</div>`;

  const completedSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">Completed</h3>
    <span class="rams-badge rams-badge-success">${completedStreams.length}</span>
  </div>
  ${completedStreams.length > 0
    ? `<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">${completedStreams.map(renderStreamCard).join("")}</div>`
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No completed PRDs yet.</div>'
  }
</div>`;

  return c.html(`${inProgressSection}${idleSection}${notStartedSection}${completedSection}`);
});

/**
 * GET /api/partials/streams-progress
 *
 * Returns HTML fragment for the progress-focused view.
 * Separates streams into In Progress (running) and Idle (not running) categories.
 */
api.get("/partials/streams-progress", (c) => {
  const showClosed = c.req.query('showClosed') === 'true';
  let streams = getStreams();

  // Filter out closed streams unless showClosed=true
  if (!showClosed) {
    streams = streams.filter(s => !s.closed);
  }

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

  // Categorize streams into 4 groups:
  // 1. In Progress = actively running
  // 2. Completed = merged or completed status
  // 3. Idle = has some progress but paused (not running, not completed)
  // 4. Not Started = no progress yet (0 stories completed, not completed/merged)
  const inProgressStreams = streams.filter(s => s.status === 'running');
  const completedStreams = streams.filter(s => s.status === 'completed' || s.merged);
  const idleStreams = streams.filter(s =>
    s.status !== 'running' &&
    s.status !== 'completed' &&
    !s.merged &&
    s.completedStories > 0
  );
  const notStartedStreams = streams.filter(s =>
    s.status !== 'running' &&
    s.status !== 'completed' &&
    !s.merged &&
    s.completedStories === 0
  );

  // Helper function to render stream item
  const renderStreamItem = (stream: Stream, isInProgress: boolean) => {
    // Fetch full stream details to get stories
    const streamDetails = getStreamDetails(stream.id);
    const stories = streamDetails?.stories || [];

    const percentage = stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

    const statusLabel = stream.status.charAt(0).toUpperCase() + stream.status.slice(1).replace(/_/g, ' ');
    const badgeClass = stream.status === 'running' ? 'rams-badge-running' :
                       stream.status === 'completed' ? 'rams-badge-success' :
                       stream.status === 'in_progress' ? 'rams-badge-in-progress' :
                       stream.status === 'idle' ? 'rams-badge-idle' : 'rams-badge-pending';

    const itemClass = isInProgress ? 'stream-item-active' : 'stream-item-idle';
    const escapedName = escapeHtml(stream.name).replace(/'/g, "\\'").replace(/"/g, "&quot;");

    const worktreeInitialized = hasWorktree(stream.id);
    const isCompleted = stream.status === "completed";
    const isRunning = stream.status === "running";
    const isMerged = stream.merged;
    const isFullyComplete = stream.totalStories > 0 && stream.completedStories === stream.totalStories;

    // Build action buttons based on stream state
    let actionButtonsHtml = "";

    if (isRunning) {
      // Show Pause/Cancel buttons for running streams
      actionButtonsHtml = `
        <button class="rams-btn rams-btn-warning" onclick="pauseStream('${stream.id}', event)" title="Gracefully stop after current iteration">
          Pause
        </button>
        <button class="rams-btn rams-btn-secondary" onclick="cancelStream('${stream.id}', event)" title="Immediately terminate build">
          Cancel
        </button>`;
    } else {
      // Show Plan button if plan doesn't exist (before Init/Build)
      if (!stream.hasPlan && stream.hasPrd) {
        const planDisabled = isMerged || isCompleted;
        const isGeneratingPlan = wizardProcessManager.isGenerating(stream.id);

        if (isGeneratingPlan) {
          // Show generating state with auto-connect to SSE and View Details link
          actionButtonsHtml += `
            <button id="plan-btn-${stream.id}" class="rams-btn rams-btn-primary" disabled>
              <span class="rams-spinner"></span> 0%
            </button>
            <a id="plan-details-link-${stream.id}" href="#" class="rams-text-sm"
               style="margin-left: 8px; color: var(--rams-accent); text-decoration: underline; cursor: pointer;"
               onclick="event.preventDefault(); event.stopPropagation(); showPlanProgress('${stream.id}', event);">
              View Details →
            </a>
            <script>
              (function() {
                var btn = document.getElementById('plan-btn-${stream.id}');
                if (btn && typeof connectToPlanSSE === 'function') {
                  connectToPlanSSE('${stream.id}', btn);
                }
              })();
            </script>`;
        } else {
          // Show normal Plan button
          const planTitle = planDisabled ? "Cannot generate plan for completed PRD" :
                           "Generate implementation plan from PRD";
          actionButtonsHtml += `
            <button class="rams-btn rams-btn-primary" onclick="triggerPlanGeneration('${stream.id}', event)" title="${planTitle}" ${planDisabled ? "disabled" : ""}>
              📋 Plan
            </button>`;
        }
      }

      // Show Init/Build buttons for non-running streams
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

      const buildDisabled = !stream.hasPlan || isMerged || (isCompleted && !worktreeInitialized) ||
                           (!worktreeInitialized) || isFullyComplete;
      const buildTitle = !stream.hasPlan ? "Generate plan first (click Plan button)" :
                        isMerged ? "Already merged to main" :
                        (isCompleted && !worktreeInitialized) ? "Already completed" :
                        isFullyComplete ? "All stories completed" :
                        !worktreeInitialized ? "Initialize worktree first (click Init)" :
                        "Start build iterations";
      actionButtonsHtml += `
        <button class="rams-btn rams-btn-primary" onclick="toggleBuildFormProgress('${stream.id}', event)" title="${buildTitle}" ${buildDisabled ? "disabled" : ""}>
          Build
        </button>`;
    }

    // Merge button for non-running streams with worktree
    // - Disabled only if: already merged OR no progress at all
    // - Shows warning for partial completion but allows merge
    if (worktreeInitialized && !isRunning) {
      const hasAnyProgress = stream.completedStories > 0 || stream.hasProgress;
      const mergeDisabled = isMerged || !hasAnyProgress;
      const mergeTitle = isMerged ? "Already merged to main" :
                        !hasAnyProgress ? "No progress to merge yet" :
                        !isFullyComplete ? `Merge ${stream.completedStories}/${stream.totalStories} stories to main` :
                        "Merge to main branch";
      const mergeClass = isFullyComplete ? "rams-btn-success" : "rams-btn-warning";
      actionButtonsHtml += `
        <button class="rams-btn ${mergeClass}" onclick="mergeStream('${stream.id}', '${escapedName}', event)" title="${mergeTitle}" ${mergeDisabled ? "disabled" : ""}>
          Merge
        </button>`;
    }

    // Build form (hidden by default)
    const buildFormHtml = `
      <div id="build-form-progress-${stream.id}" class="rams-card" style="display: none; padding: var(--rams-space-3); margin: var(--rams-space-3) 0;" onclick="event.stopPropagation()">
        <label class="rams-form-label" for="iterations-progress-${stream.id}">Iterations:</label>
        <input type="number" class="rams-input" id="iterations-progress-${stream.id}" value="1" min="1" max="100" style="width: 80px; margin: 0 var(--rams-space-2);" />
        <button class="rams-btn rams-btn-primary" onclick="startStreamBuildProgress('${stream.id}', event)">Start</button>
        <button class="rams-btn rams-btn-secondary" onclick="toggleBuildFormProgress('${stream.id}', event)">Cancel</button>
      </div>`;

    // PRD/Plan readiness badges
    const prdBadgeLabel = stream.hasPrd ? "Ready PRD" : "Missing PRD";
    const planBadgeLabel = stream.hasPlan ? "Ready Plan" : "Not Ready Plan";

    // Determine if editing should be allowed (Not Started = no completed stories and not running/completed/merged)
    const isNotStarted = !isRunning && !isCompleted && !isMerged && stream.completedStories === 0;
    const editableParam = isNotStarted ? '' : '&readonly=true';

    // Clickable badge styles
    const clickableBadgeStyle = 'cursor: pointer; transition: opacity 0.2s;';
    const clickableBadgeHover = 'onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1"';

    // Show close button for 0% streams (not started)
    const showCloseButton = percentage === 0 && !isRunning && !isMerged && !isCompleted;
    const closeButtonHtml = showCloseButton ? `
      <button class="rams-btn rams-btn-danger rams-btn-sm"
              onclick="closeStream('${stream.id}', event)"
              style="margin-left: var(--rams-space-2); padding: 4px 8px; font-size: 12px;"
              title="Close this PRD (hide from list)">
        ✕
      </button>
    ` : '';

    // Render stories section
    const storiesHtml = stories.length > 0 ? stories.map(story => {
      const criteriaTotal = story.acceptanceCriteria.length;
      const criteriaCompleted = story.acceptanceCriteria.filter(c => c.completed).length;
      const storyPercentage = criteriaTotal > 0
        ? Math.round((criteriaCompleted / criteriaTotal) * 100)
        : 0;

      const storyStatusLabel = story.status === 'completed' ? 'Completed' :
                               story.status === 'in-progress' ? 'In Progress' :
                               'Pending';
      const storyStatusIcon = story.status === 'completed' ? '✓' :
                              story.status === 'in-progress' ? '⏳' :
                              '○';

      return `
        <div class="story-item story-${story.status}">
          <div class="story-header">
            <span class="story-id">${escapeHtml(story.id)}</span>
            <h4 class="story-title">${escapeHtml(story.title)}</h4>
          </div>
          <div class="story-progress-row">
            <div class="rams-progress rams-progress-thick" style="flex: 1;">
              <div class="rams-progress-bar" style="width: ${storyPercentage}%"></div>
            </div>
            <span class="story-percentage">${storyPercentage}%</span>
          </div>
          <div class="story-meta">
            <span class="rams-badge rams-badge-${story.status}">
              ${storyStatusIcon} ${storyStatusLabel}
            </span>
            <span class="rams-text-xs rams-text-muted">
              ${criteriaCompleted}/${criteriaTotal} criteria
            </span>
          </div>
        </div>
      `;
    }).join('') : '<div class="rams-text-muted" style="padding: var(--rams-space-3); text-align: center;">No stories defined</div>';

    // Wrap in <details> for expandable behavior
    return `
      <details class="stream-item-expandable ${itemClass}" ${isInProgress ? 'open' : ''}>
        <summary class="stream-item-header" onclick="event.stopPropagation();">
          <span class="expand-chevron">▶</span>
          <div style="min-width: 80px;">
            <span class="rams-label">PRD-${stream.id}</span>
          </div>
          <div style="flex: 1; min-width: 200px;">
            <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">${escapeHtml(stream.name)}</h3>
            <div class="rams-progress rams-progress-thick">
              <div class="rams-progress-bar" style="width: ${percentage}%"></div>
            </div>
          </div>
          <div style="min-width: 120px; text-align: right;">
            <div class="rams-metric-value-sm">${percentage}%</div>
            <div class="rams-text-xs rams-text-muted">
              ${stream.completedStories} / ${stream.totalStories}
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: var(--rams-space-2);">
            <div>
              <span class="rams-badge ${badgeClass}">
                <span class="rams-badge-dot"></span>${statusLabel}
              </span>
              ${isMerged ? '<span class="rams-badge rams-badge-info" style="display: block; margin-top: var(--rams-space-1);"><span class="rams-badge-dot"></span>Merged</span>' : ''}
            </div>
            ${closeButtonHtml}
          </div>
        </summary>

        <div class="stream-item-content">
          <div class="stream-item-actions" style="display: flex; gap: var(--rams-space-2); flex-wrap: wrap; padding: var(--rams-space-3) 0; border-bottom: 1px solid var(--rams-gray-100); margin-bottom: var(--rams-space-3);">
            ${actionButtonsHtml}
          </div>
          ${buildFormHtml}
          <div class="stream-item-readiness" style="display: flex; gap: var(--rams-space-2); margin-bottom: var(--rams-space-3);">
            ${stream.hasPrd
              ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=prd${editableParam}';" title="View PRD${isNotStarted ? ' (editable)' : ''}"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
              : `<span class="rams-badge rams-badge-muted"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
            }
            ${stream.hasPlan
              ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=plan${editableParam}';" title="View Plan${isNotStarted ? ' (editable)' : ''}"><span class="rams-badge-dot"></span>${planBadgeLabel}</span>`
              : `<span class="rams-badge rams-badge-needs-plan" ${stream.hasPrd ? `onclick="event.stopPropagation(); triggerPlanGeneration('${stream.id}', event);" title="Click to generate plan"` : ''}><span class="rams-badge-dot"></span>⚡ ${planBadgeLabel}</span>`
            }
            ${worktreeInitialized ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Worktree</span>' : ''}
          </div>
          <div class="stories-list">
            ${storiesHtml}
          </div>
        </div>
      </details>
    `;
  };

  // Build In Progress section
  const inProgressSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">In Progress</h3>
    <span class="rams-badge rams-badge-running">${inProgressStreams.length}</span>
  </div>
  ${inProgressStreams.length > 0
    ? inProgressStreams.map(s => renderStreamItem(s, true)).join('')
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No PRDs are currently running. Start a build to see activity here.</div>'
  }
</div>`;

  // Build Idle section
  const idleSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">Idle</h3>
    <span class="rams-badge rams-badge-pending">${idleStreams.length}</span>
  </div>
  ${idleStreams.length > 0
    ? idleStreams.map(s => renderStreamItem(s, false)).join('')
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No idle PRDs.</div>'
  }
</div>`;

  // Build Not Started section
  const notStartedSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">Not Started</h3>
    <span class="rams-badge rams-badge-idle">${notStartedStreams.length}</span>
  </div>
  ${notStartedStreams.length > 0
    ? notStartedStreams.map(s => renderStreamItem(s, false)).join('')
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No PRDs waiting to start. Create a new stream to get started.</div>'
  }
</div>`;

  // Build Completed section
  const completedSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">Completed</h3>
    <span class="rams-badge rams-badge-success">${completedStreams.length}</span>
  </div>
  ${completedStreams.length > 0
    ? completedStreams.map(s => renderStreamItem(s, false)).join('')
    : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No completed PRDs yet.</div>'
  }
</div>`;

  return c.html(`
    <div class="streams-progress-view">
      ${inProgressSection}
      ${idleSection}
      ${notStartedSection}
      ${completedSection}
    </div>
  `);
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

  // Helper to format status for display
  const formatTimelineStatus = (status: string): string => {
    const statusMap: Record<string, string> = {
      'idle': 'Idle',
      'running': 'Running',
      'merged': 'Merged',
      'completed': 'Completed',
      'in_progress': 'In Progress',
      'ready': 'Ready',
      'error': 'Error',
    };
    return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  };

  // Build timeline rows
  const timelineRows = streamTimings
    .map((stream) => {
      const statusLabel = formatTimelineStatus(stream.status);

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

  // Format status for human-friendly display
  const statusMap: Record<string, string> = {
    'idle': 'Idle',
    'running': 'Running',
    'merged': 'Merged',
    'completed': 'Completed',
    'in_progress': 'In Progress',
    'ready': 'Ready',
    'error': 'Error',
  };
  const statusLabel = statusMap[stream.status] || stream.status.charAt(0).toUpperCase() + stream.status.slice(1).replace(/_/g, ' ');

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
 * Authorship Tracking API Endpoints
 *
 * REST API endpoints for managing authorship metadata.
 * Tracks which content was written by AI agents vs humans.
 */

// Import authorship functions (dynamic import for lazy loading)
let authorshipReader: typeof import('../services/authorship-reader.js') | null = null;

async function getAuthorshipReader() {
  if (!authorshipReader) {
    authorshipReader = await import('../services/authorship-reader.js');
  }
  return authorshipReader;
}

/**
 * GET /api/authorship/:path
 *
 * Get authorship metadata for a file.
 * The :path parameter should be a relative path within .ralph (e.g., PRD-3/prd.md)
 *
 * Returns:
 *   - 200 with authorship metadata (JSON)
 *   - 200 with null if no authorship data exists
 *   - 400 if path is invalid
 *   - 403 if path is outside .ralph directory
 */
api.get("/authorship/*", async (c) => {
  const rawPath = c.req.path.replace(/^\/api\/authorship\//, "");
  const requestedPath = decodeURIComponent(rawPath);

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

  try {
    const reader = await getAuthorshipReader();
    const metadata = reader.loadAuthorship(requestedPath);

    return c.json({
      success: true,
      metadata,
      path: requestedPath,
    });
  } catch (err) {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to load authorship metadata",
      },
      500
    );
  }
});

/**
 * PUT /api/authorship/:path
 *
 * Update authorship metadata for a file.
 * The :path parameter should be a relative path within .ralph (e.g., PRD-3/prd.md)
 *
 * Request body: JSON with:
 *   - content: The current file content (for reconciliation)
 *   - author: The author type making the change
 *   - metadata: Optional - full metadata object to save directly
 *
 * Returns:
 *   - 200 on success with updated metadata
 *   - 400 if path or body is invalid
 *   - 403 if path is outside .ralph directory
 */
api.put("/authorship/*", async (c) => {
  const rawPath = c.req.path.replace(/^\/api\/authorship\//, "");
  const requestedPath = decodeURIComponent(rawPath);

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

  try {
    const body = await c.req.json();
    const reader = await getAuthorshipReader();

    let metadata;

    if (body.metadata) {
      // Direct metadata update
      metadata = body.metadata;
    } else if (body.content !== undefined && body.author) {
      // Reconcile authorship with new content
      const oldMeta = reader.loadAuthorship(requestedPath);
      metadata = reader.reconcileAuthorship(
        oldMeta,
        body.content,
        body.author,
        requestedPath
      );
    } else {
      return c.json(
        {
          error: "bad_request",
          message: "Request must include either 'metadata' or both 'content' and 'author'",
        },
        400
      );
    }

    // Save the metadata
    reader.saveAuthorship(requestedPath, metadata);

    return c.json({
      success: true,
      metadata,
      path: requestedPath,
    });
  } catch (err) {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to save authorship metadata",
      },
      500
    );
  }
});

/**
 * POST /api/authorship/:path/initialize
 *
 * Initialize authorship metadata for a file that doesn't have any.
 * Marks all existing content with the specified default author.
 *
 * Request body: JSON with:
 *   - defaultAuthor: The author type for existing content (default: 'unknown')
 *
 * Returns:
 *   - 200 on success with new metadata
 *   - 400 if path is invalid
 *   - 403 if path is outside .ralph directory
 *   - 404 if file doesn't exist
 */
api.post("/authorship/*/initialize", async (c) => {
  const rawPath = c.req.path.replace(/^\/api\/authorship\//, "").replace(/\/initialize$/, "");
  const requestedPath = decodeURIComponent(rawPath);

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
    const body = await c.req.json().catch(() => ({}));
    const defaultAuthor = body.defaultAuthor || 'unknown';

    const reader = await getAuthorshipReader();
    const content = fs.readFileSync(validatedPath, 'utf-8');

    const metadata = reader.initializeAuthorship(content, requestedPath, defaultAuthor);
    reader.saveAuthorship(requestedPath, metadata);

    return c.json({
      success: true,
      metadata,
      path: requestedPath,
    });
  } catch (err) {
    return c.json(
      {
        error: "internal_error",
        message: "Failed to initialize authorship metadata",
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
 * POST /api/stream/:id/stop
 *
 * Stop a running build for a specific stream.
 * Request body: { force?: boolean }
 *   - force: false (default) = graceful stop (SIGTERM, waits for current iteration)
 *   - force: true = immediate termination (SIGKILL)
 *
 * Returns:
 *   - 200 with stop status
 *   - 404 if stream doesn't exist
 *   - 409 if stream not running
 */
api.post("/stream/:id/stop", async (c) => {
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

  // Check if stream is running
  if (stream.status !== "running") {
    return c.json(
      {
        error: "not_running",
        message: `Stream PRD-${id} is not currently running`,
      },
      409
    );
  }

  // Parse request body
  let body: { force?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    // No body or invalid JSON is okay, defaults to graceful stop
  }

  const force = body.force === true;

  // Stop the build
  const status = force ? processManager.killBuild() : processManager.stopBuild();

  if (status.state === "idle" && status.error) {
    return c.json(
      {
        error: "not_running",
        message: status.error,
      },
      409
    );
  }

  if (status.state === "error") {
    return c.json(
      {
        error: "stop_failed",
        message: status.error || "Failed to stop build",
      },
      500
    );
  }

  return c.json({
    success: true,
    message: force
      ? `Build for PRD-${id} terminated immediately`
      : `Stop signal sent to PRD-${id} build (will complete current iteration)`,
    status: {
      state: status.state,
      pid: status.pid,
      startedAt: status.startedAt?.toISOString(),
      command: status.command,
    },
  });
});

/**
 * POST /api/streams/:id/close
 *
 * Mark a stream as closed (inactive). Creates a .closed marker file.
 * Only allowed for streams at 0% completion that are not running, merged, or completed.
 *
 * Returns:
 *   - 200 on success
 *   - 400 if stream has progress or is in an invalid state
 *   - 404 if stream not found
 */
api.post("/streams/:id/close", async (c) => {
  const streamId = c.req.param('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_initialized", message: "Ralph not initialized" }, 500);
  }

  const streamPath = path.join(ralphRoot, `PRD-${streamId}`);

  if (!fs.existsSync(streamPath)) {
    return c.json({ error: "not_found", message: `Stream PRD-${streamId} not found` }, 404);
  }

  // Get stream details to validate state
  const streams = getStreams();
  const stream = streams.find(s => s.id === streamId);

  if (!stream) {
    return c.json({ error: "not_found", message: `Stream PRD-${streamId} not found` }, 404);
  }

  // Validate: can only close streams at 0% that are not running/merged/completed
  if (stream.completedStories > 0) {
    return c.json(
      { error: "invalid_state", message: "Cannot close stream with completed stories" },
      400
    );
  }

  if (stream.status === 'running') {
    return c.json(
      { error: "invalid_state", message: "Cannot close a running stream" },
      400
    );
  }

  if (stream.merged) {
    return c.json(
      { error: "invalid_state", message: "Cannot close a merged stream" },
      400
    );
  }

  if (stream.status === 'completed') {
    return c.json(
      { error: "invalid_state", message: "Cannot close a completed stream" },
      400
    );
  }

  // Create .closed marker file
  const closedMarkerPath = path.join(streamPath, '.closed');
  try {
    fs.writeFileSync(closedMarkerPath, new Date().toISOString());
    return c.json({ success: true, message: `Stream PRD-${streamId} closed` });
  } catch (error) {
    return c.json(
      { error: "write_failed", message: `Failed to create .closed marker: ${error}` },
      500
    );
  }
});

/**
 * POST /api/streams/:id/restore
 *
 * Restore a closed stream by removing the .closed marker file.
 *
 * Returns:
 *   - 200 on success
 *   - 404 if stream not found or not closed
 */
api.post("/streams/:id/restore", async (c) => {
  const streamId = c.req.param('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_initialized", message: "Ralph not initialized" }, 500);
  }

  const streamPath = path.join(ralphRoot, `PRD-${streamId}`);
  const closedMarkerPath = path.join(streamPath, '.closed');

  if (!fs.existsSync(closedMarkerPath)) {
    return c.json(
      { error: "not_found", message: `Stream PRD-${streamId} is not closed` },
      404
    );
  }

  try {
    fs.unlinkSync(closedMarkerPath);
    return c.json({ success: true, message: `Stream PRD-${streamId} restored` });
  } catch (error) {
    return c.json(
      { error: "delete_failed", message: `Failed to remove .closed marker: ${error}` },
      500
    );
  }
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

    // Store PID immediately (available before folder creation)
    const processPid = result.pid;

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
      sseEndpoint: `/api/stream/${streamId}/generation-stream?type=prd`,
      pid: processPid,
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
 * POST /api/wizard/cancel-pid/:pid
 *
 * Cancel a generation process by its PID.
 * More reliable than stream-based cancellation as PID is available immediately
 * after process starts, before the stream ID is determined.
 */
api.post("/wizard/cancel-pid/:pid", (c) => {
  const pidStr = c.req.param("pid");
  const pid = parseInt(pidStr, 10);

  if (isNaN(pid) || pid <= 0) {
    return c.json(
      { error: "invalid_pid", message: "Invalid PID" },
      400
    );
  }

  const result = wizardProcessManager.cancelByPid(pid);

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

/**
 * GET /api/prd/:id/content
 *
 * Get the content of a PRD file (prd.md, plan.md, or progress.md)
 *
 * Query params:
 *   - file: 'prd' | 'plan' | 'progress' (default: 'prd')
 *
 * Returns:
 *   - 200 with { content: string, path: string }
 *   - 404 if PRD or file not found
 */
api.get('/prd/:id/content', (c) => {
  const prdId = c.req.param('id');
  const fileType = c.req.query('file') || 'prd';

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_configured',
        message: 'Ralph root directory not found',
      },
      500
    );
  }
  const prdFolder = path.join(ralphRoot, `.ralph/PRD-${prdId}`);

  if (!fs.existsSync(prdFolder)) {
    return c.json(
      {
        error: 'not_found',
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const fileMap: Record<string, string> = {
    prd: 'prd.md',
    plan: 'plan.md',
    progress: 'progress.md',
  };

  const fileName = fileMap[fileType] || 'prd.md';
  const filePath = path.join(prdFolder, fileName);

  if (!fs.existsSync(filePath)) {
    return c.json(
      {
        error: 'not_found',
        message: `File ${fileName} not found in PRD-${prdId}`,
      },
      404
    );
  }

  const content = fs.readFileSync(filePath, 'utf-8');

  return c.json({
    content,
    path: filePath,
    prdId,
    fileType,
  });
});

/**
 * POST /api/prd/:id/content
 *
 * Save content to a PRD file (prd.md, plan.md, or progress.md)
 *
 * Body:
 *   - content: string (required)
 *   - file: 'prd' | 'plan' | 'progress' (default: 'prd')
 *
 * Returns:
 *   - 200 with { success: true, path: string }
 *   - 400 if content is missing
 *   - 404 if PRD not found
 */
api.post('/prd/:id/content', async (c) => {
  const prdId = c.req.param('id');
  const body = await c.req.json();
  const { content, file: fileType = 'prd' } = body;

  if (typeof content !== 'string') {
    return c.json(
      {
        error: 'invalid_request',
        message: 'content must be a string',
      },
      400
    );
  }

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_configured',
        message: 'Ralph root directory not found',
      },
      500
    );
  }
  const prdFolder = path.join(ralphRoot, `.ralph/PRD-${prdId}`);

  if (!fs.existsSync(prdFolder)) {
    return c.json(
      {
        error: 'not_found',
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const fileMap: Record<string, string> = {
    prd: 'prd.md',
    plan: 'plan.md',
    progress: 'progress.md',
  };

  const fileName = fileMap[fileType] || 'prd.md';
  const filePath = path.join(prdFolder, fileName);

  try {
    fs.writeFileSync(filePath, content, 'utf-8');

    return c.json({
      success: true,
      path: filePath,
      prdId,
      fileType,
    });
  } catch (error: any) {
    return c.json(
      {
        error: 'write_failed',
        message: error.message || 'Failed to write file',
      },
      500
    );
  }
});

// Agent endpoints moved to ./api/agents.ts

/**
 * Real-Time Status API (US-003)
 *
 * Endpoints for live build status and events.
 */

/**
 * GET /api/streams/:id/status
 *
 * Returns current build status from .status.json file.
 * Updated every second during active builds.
 *
 * Returns:
 *   - phase: 'planning' | 'executing' | 'committing' | 'verifying'
 *   - story_id: Current story being worked on
 *   - story_title: Title of current story
 *   - iteration: Current iteration number
 *   - elapsed_seconds: Seconds since build started
 *   - updated_at: ISO timestamp of last update
 *   - 404 if no status file exists (build not running)
 */
api.get('/streams/:id/status', (c) => {
  const id = c.req.param('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      { error: 'not_found', message: 'Ralph root not found' },
      404
    );
  }

  const statusPath = path.join(ralphRoot, `PRD-${id}`, '.status.json');

  // Also check worktree path if exists
  const worktreeStatusPath = path.join(
    ralphRoot,
    'worktrees',
    `PRD-${id}`,
    '.ralph',
    `PRD-${id}`,
    '.status.json'
  );

  let effectivePath = statusPath;
  if (fs.existsSync(worktreeStatusPath)) {
    effectivePath = worktreeStatusPath;
  }

  if (!fs.existsSync(effectivePath)) {
    return c.json(
      { error: 'not_found', message: 'No active build status found' },
      404
    );
  }

  try {
    const content = fs.readFileSync(effectivePath, 'utf-8');
    const status = JSON.parse(content);

    return c.json({
      phase: status.phase || 'unknown',
      story_id: status.story_id || null,
      story_title: status.story_title || null,
      iteration: status.iteration || 0,
      elapsed_seconds: status.elapsed_seconds || 0,
      updated_at: status.updated_at || new Date().toISOString(),
    });
  } catch (error) {
    return c.json(
      { error: 'parse_error', message: 'Failed to parse status file' },
      500
    );
  }
});

/**
 * GET /api/streams/:id/events
 *
 * Returns recent events from .events.log file.
 * Query params:
 *   - limit: Number of events to return (default: 10, max: 100)
 *
 * Returns array of events:
 *   - timestamp: ISO timestamp
 *   - level: 'ERROR' | 'WARN' | 'INFO' | 'RETRY'
 *   - message: Event message
 *   - details: Optional key=value metadata
 */
api.get('/streams/:id/events', (c) => {
  const id = c.req.param('id');
  const limit = Math.min(parseInt(c.req.query('limit') || '10', 10), 100);
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      { error: 'not_found', message: 'Ralph root not found' },
      404
    );
  }

  const eventsPath = path.join(ralphRoot, `PRD-${id}`, '.events.log');

  // Also check worktree path if exists
  const worktreeEventsPath = path.join(
    ralphRoot,
    'worktrees',
    `PRD-${id}`,
    '.ralph',
    `PRD-${id}`,
    '.events.log'
  );

  let effectivePath = eventsPath;
  if (fs.existsSync(worktreeEventsPath)) {
    effectivePath = worktreeEventsPath;
  }

  if (!fs.existsSync(effectivePath)) {
    return c.json({ events: [], count: 0 });
  }

  try {
    const content = fs.readFileSync(effectivePath, 'utf-8');
    const lines = content.trim().split('\n').filter(line => line.length > 0);

    // Get last N lines
    const recentLines = lines.slice(-limit);

    // Parse event lines: [timestamp] LEVEL message | details
    const events = recentLines.map(line => {
      const match = line.match(/^\[([^\]]+)\]\s+(\w+)\s+(.+)$/);
      if (!match) {
        return { timestamp: new Date().toISOString(), level: 'INFO', message: line, details: null };
      }

      const [, timestamp, level, rest] = match;
      let message = rest;
      let details: string | null = null;

      // Split on " | " for details
      if (rest.includes(' | ')) {
        const parts = rest.split(' | ');
        message = parts[0];
        details = parts.slice(1).join(' | ');
      }

      // Parse timestamp
      let isoTimestamp: string;
      try {
        isoTimestamp = new Date(timestamp.replace(' ', 'T')).toISOString();
      } catch {
        isoTimestamp = new Date().toISOString();
      }

      return {
        timestamp: isoTimestamp,
        level: level.toUpperCase(),
        message: message.trim(),
        details,
      };
    });

    return c.json({
      events: events.reverse(), // Most recent first
      count: events.length,
      total: lines.length,
    });
  } catch (error) {
    return c.json(
      { error: 'read_error', message: 'Failed to read events log' },
      500
    );
  }
});

/**
 * GET /api/partials/live-status-widget
 *
 * Returns HTML partial for live status widget.
 * Shows phase, story, elapsed time, and recent events.
 * Auto-hides when no build is running.
 *
 * Query params:
 *   - streamId: Stream to show status for
 */
api.get('/partials/live-status-widget', (c) => {
  let streamId = c.req.query('streamId');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.html(`<div id="live-status-widget" class="rams-hidden"></div>`);
  }

  // If no streamId provided, auto-detect any running build
  if (!streamId) {
    // Check for any PRD with an active .status.json file
    try {
      const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith('PRD-')) {
          const id = entry.name.replace('PRD-', '');
          const statusPath = path.join(ralphRoot, entry.name, '.status.json');
          if (fs.existsSync(statusPath)) {
            // Check if file was modified in the last 30 seconds (active build)
            const stat = fs.statSync(statusPath);
            const age = Date.now() - stat.mtimeMs;
            if (age < 30000) {
              streamId = id;
              break;
            }
          }
        }
      }
      // Also check worktrees for running builds
      if (!streamId) {
        const worktreesPath = path.join(ralphRoot, 'worktrees');
        if (fs.existsSync(worktreesPath)) {
          const worktreeEntries = fs.readdirSync(worktreesPath, { withFileTypes: true });
          for (const entry of worktreeEntries) {
            if (entry.isDirectory() && entry.name.startsWith('PRD-')) {
              const id = entry.name.replace('PRD-', '');
              const statusPath = path.join(worktreesPath, entry.name, '.ralph', entry.name, '.status.json');
              if (fs.existsSync(statusPath)) {
                const stat = fs.statSync(statusPath);
                const age = Date.now() - stat.mtimeMs;
                if (age < 30000) {
                  streamId = id;
                  break;
                }
              }
            }
          }
        }
      }
    } catch {
      // Continue without auto-detection
    }
  }

  // If still no streamId found, hide the widget
  if (!streamId) {
    return c.html(`<div id="live-status-widget" class="rams-hidden"></div>`);
  }

  // Check for status file
  const statusPath = path.join(ralphRoot, `PRD-${streamId}`, '.status.json');
  const worktreeStatusPath = path.join(
    ralphRoot,
    'worktrees',
    `PRD-${streamId}`,
    '.ralph',
    `PRD-${streamId}`,
    '.status.json'
  );

  let effectivePath = statusPath;
  if (fs.existsSync(worktreeStatusPath)) {
    effectivePath = worktreeStatusPath;
  }

  // If no status file, build is not running - return hidden widget
  if (!fs.existsSync(effectivePath)) {
    return c.html(`<div id="live-status-widget" class="rams-hidden"></div>`);
  }

  // Parse status
  let status: { phase?: string; story_id?: string; story_title?: string; iteration?: number; elapsed_seconds?: number } = {};
  try {
    const content = fs.readFileSync(effectivePath, 'utf-8');
    status = JSON.parse(content);
  } catch {
    return c.html(`<div id="live-status-widget" class="rams-hidden"></div>`);
  }

  // Load recent events
  const eventsPath = path.join(ralphRoot, `PRD-${streamId}`, '.events.log');
  const worktreeEventsPath = path.join(
    ralphRoot,
    'worktrees',
    `PRD-${streamId}`,
    '.ralph',
    `PRD-${streamId}`,
    '.events.log'
  );

  let effectiveEventsPath = eventsPath;
  if (fs.existsSync(worktreeEventsPath)) {
    effectiveEventsPath = worktreeEventsPath;
  }

  let recentEvents: Array<{ level: string; message: string; timestamp: string }> = [];
  if (fs.existsSync(effectiveEventsPath)) {
    try {
      const content = fs.readFileSync(effectiveEventsPath, 'utf-8');
      const lines = content.trim().split('\n').filter(line => line.length > 0);
      const recent = lines.slice(-5); // Last 5 events

      recentEvents = recent.map(line => {
        const match = line.match(/^\[([^\]]+)\]\s+(\w+)\s+(.+)$/);
        if (!match) return { level: 'INFO', message: line, timestamp: '' };
        const [, timestamp, level, rest] = match;
        const message = rest.includes(' | ') ? rest.split(' | ')[0] : rest;
        return { level: level.toUpperCase(), message: message.trim(), timestamp };
      }).reverse();
    } catch {
      // Continue without events
    }
  }

  // Format elapsed time
  const elapsed = status.elapsed_seconds || 0;
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;
  const elapsedStr = `${minutes}m ${seconds}s`;

  // Phase badge color
  const phaseColors: Record<string, string> = {
    planning: 'rams-badge-info',
    executing: 'rams-badge-running',
    committing: 'rams-badge-warning',
    verifying: 'rams-badge-success',
  };
  const phaseClass = phaseColors[status.phase || ''] || 'rams-badge-idle';

  // Event icon and color
  const eventIcons: Record<string, { icon: string; class: string }> = {
    ERROR: { icon: '✗', class: 'text-red' },
    WARN: { icon: '⚠', class: 'text-yellow' },
    INFO: { icon: 'ℹ', class: 'text-dim' },
    RETRY: { icon: '↻', class: 'text-cyan' },
  };

  // Build events HTML
  let eventsHtml = '';
  if (recentEvents.length > 0) {
    eventsHtml = `
      <div class="live-status-events">
        <div class="rams-label">Recent Events</div>
        <div class="live-events-list">
          ${recentEvents.map(evt => {
            const { icon, class: colorClass } = eventIcons[evt.level] || eventIcons.INFO;
            return `<div class="live-event-item ${colorClass}"><span class="live-event-icon">${icon}</span> ${evt.message}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  return c.html(`
    <div id="live-status-widget" class="rams-card live-status-widget">
      <div class="live-status-header">
        <span class="rams-badge ${phaseClass}">
          <span class="rams-badge-dot"></span>
          ${status.phase || 'running'}
        </span>
        <span class="live-status-elapsed">⏱ ${elapsedStr}</span>
      </div>
      <div class="live-status-body">
        <div class="live-status-story">
          ${status.story_id ? `<span class="story-id">${status.story_id}</span>` : ''}
          ${status.story_title ? `<span class="story-title">${status.story_title}</span>` : '<span class="story-title">Build in progress...</span>'}
        </div>
        <div class="live-status-iteration">
          Iteration ${status.iteration || 1}
        </div>
      </div>
      ${eventsHtml}
    </div>
  `);
});

// ============================================================================
// US-006: Checkpoint endpoints moved to ./api/checkpoint.ts

/**
 * GET /api/streams/:id/cost
 *
 * Returns cost tracking data for a stream (US-007).
 * Reads from .cost.json in the PRD folder.
 *
 * Response:
 *   - total_cost: Total accumulated cost in dollars
 *   - total_input_tokens: Total input tokens used
 *   - total_output_tokens: Total output tokens used
 *   - iterations: Array of per-iteration cost data
 *   - has_data: Whether cost tracking data exists
 */
api.get('/streams/:id/cost', (c) => {
  const id = c.req.param('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: 'Ralph root not found' }, 500);
  }

  // Determine PRD folder path
  let prdFolder = path.join(ralphRoot, `PRD-${id}`);
  const worktreePath = path.join(ralphRoot, 'worktrees', `PRD-${id}`, '.ralph', `PRD-${id}`);

  if (!fs.existsSync(prdFolder) && fs.existsSync(worktreePath)) {
    prdFolder = worktreePath;
  }

  const costPath = path.join(prdFolder, '.cost.json');

  if (!fs.existsSync(costPath)) {
    return c.json({
      has_data: false,
      total_cost: 0,
      total_input_tokens: 0,
      total_output_tokens: 0,
      iterations: [],
    });
  }

  try {
    const content = fs.readFileSync(costPath, 'utf-8');
    const costData = JSON.parse(content);
    return c.json({
      has_data: true,
      ...costData,
    });
  } catch (err) {
    return c.json({ error: `Failed to read cost data: ${(err as Error).message}` }, 500);
  }
});

/**
 * GET /api/partials/cost-display
 *
 * Returns HTML partial for cost display (US-007).
 * Shows running cost and token usage.
 *
 * Query params:
 *   - streamId: Stream to show cost for
 */
api.get('/partials/cost-display', (c) => {
  const streamId = c.req.query('streamId');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot || !streamId) {
    return c.html(`<div id="cost-display" class="rams-hidden"></div>`);
  }

  // Determine PRD folder path
  let prdFolder = path.join(ralphRoot, `PRD-${streamId}`);
  const worktreePath = path.join(ralphRoot, 'worktrees', `PRD-${streamId}`, '.ralph', `PRD-${streamId}`);

  if (!fs.existsSync(prdFolder) && fs.existsSync(worktreePath)) {
    prdFolder = worktreePath;
  }

  const costPath = path.join(prdFolder, '.cost.json');

  if (!fs.existsSync(costPath)) {
    return c.html(`<div id="cost-display" class="rams-hidden"></div>`);
  }

  try {
    const content = fs.readFileSync(costPath, 'utf-8');
    const costData = JSON.parse(content);

    const totalCost = costData.total_cost || 0;
    const inputTokens = costData.total_input_tokens || 0;
    const outputTokens = costData.total_output_tokens || 0;
    const iterationCount = costData.iterations?.length || 0;

    // Format cost
    const formattedCost = totalCost < 0.01
      ? `$${totalCost.toFixed(4)}`
      : `$${totalCost.toFixed(2)}`;

    // Format tokens (K for thousands, M for millions)
    const formatTokens = (count: number): string => {
      if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
      if (count >= 1000) return `${(count / 1000).toFixed(1)}K`;
      return count.toString();
    };

    return c.html(`
      <div id="cost-display" class="cost-display" data-stream-id="${streamId}">
        <div class="cost-display-header">
          <span class="cost-display-icon">💰</span>
          <span class="cost-display-title">Build Cost</span>
        </div>
        <div class="cost-display-content">
          <div class="cost-display-total">
            <span class="cost-value">${formattedCost}</span>
            <span class="cost-label">total</span>
          </div>
          <div class="cost-display-details">
            <div class="cost-detail">
              <span class="cost-detail-value">${formatTokens(inputTokens)}</span>
              <span class="cost-detail-label">input</span>
            </div>
            <div class="cost-detail">
              <span class="cost-detail-value">${formatTokens(outputTokens)}</span>
              <span class="cost-detail-label">output</span>
            </div>
            <div class="cost-detail">
              <span class="cost-detail-value">${iterationCount}</span>
              <span class="cost-detail-label">iters</span>
            </div>
          </div>
        </div>
      </div>
    `);
  } catch (err) {
    return c.html(`<div id="cost-display" class="rams-hidden"></div>`);
  }
});

/**
 * GET /api/streams/:id/budget
 *
 * Returns budget configuration and status for a stream (US-008).
 * Reads from .budget.json and .cost.json in the PRD folder.
 *
 * Response:
 *   - has_budget: Whether budget is configured
 *   - limit: Budget limit in dollars
 *   - current_cost: Current accumulated cost
 *   - percentage: Percentage of budget used
 *   - enforce: Whether to enforce budget limits
 *   - warnings: Array of warning thresholds
 */
api.get('/streams/:id/budget', (c) => {
  const id = c.req.param('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: 'Ralph root not found' }, 500);
  }

  // Determine PRD folder path
  let prdFolder = path.join(ralphRoot, `PRD-${id}`);
  const worktreePath = path.join(ralphRoot, 'worktrees', `PRD-${id}`, '.ralph', `PRD-${id}`);

  if (!fs.existsSync(prdFolder) && fs.existsSync(worktreePath)) {
    prdFolder = worktreePath;
  }

  const budgetPath = path.join(prdFolder, '.budget.json');
  const costPath = path.join(prdFolder, '.cost.json');

  if (!fs.existsSync(budgetPath)) {
    return c.json({
      has_budget: false,
      limit: 0,
      current_cost: 0,
      percentage: 0,
      enforce: false,
      warnings: [],
    });
  }

  try {
    const budgetContent = fs.readFileSync(budgetPath, 'utf-8');
    const budget = JSON.parse(budgetContent);

    let currentCost = 0;
    if (fs.existsSync(costPath)) {
      const costContent = fs.readFileSync(costPath, 'utf-8');
      const cost = JSON.parse(costContent);
      currentCost = cost.total_cost || 0;
    }

    const percentage = budget.limit > 0 ? Math.round((currentCost / budget.limit) * 100) : 0;

    return c.json({
      has_budget: true,
      limit: budget.limit || 0,
      current_cost: currentCost,
      percentage: percentage,
      enforce: budget.enforce !== false,
      warnings: budget.warnings || [0.75, 0.90],
    });
  } catch (err) {
    return c.json({ error: `Failed to read budget data: ${(err as Error).message}` }, 500);
  }
});

/**
 * GET /api/partials/budget-display
 *
 * Returns HTML partial for budget display (US-008).
 * Shows budget progress bar with color coding.
 *
 * Query params:
 *   - streamId: Stream to show budget for
 */
api.get('/partials/budget-display', (c) => {
  const streamId = c.req.query('streamId');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot || !streamId) {
    return c.html(`<div id="budget-display" class="rams-hidden"></div>`);
  }

  // Determine PRD folder path
  let prdFolder = path.join(ralphRoot, `PRD-${streamId}`);
  const worktreePath = path.join(ralphRoot, 'worktrees', `PRD-${streamId}`, '.ralph', `PRD-${streamId}`);

  if (!fs.existsSync(prdFolder) && fs.existsSync(worktreePath)) {
    prdFolder = worktreePath;
  }

  const budgetPath = path.join(prdFolder, '.budget.json');
  const costPath = path.join(prdFolder, '.cost.json');

  if (!fs.existsSync(budgetPath)) {
    return c.html(`<div id="budget-display" class="rams-hidden"></div>`);
  }

  try {
    const budgetContent = fs.readFileSync(budgetPath, 'utf-8');
    const budget = JSON.parse(budgetContent);

    let currentCost = 0;
    if (fs.existsSync(costPath)) {
      const costContent = fs.readFileSync(costPath, 'utf-8');
      const cost = JSON.parse(costContent);
      currentCost = cost.total_cost || 0;
    }

    const limit = budget.limit || 0;
    const percentage = limit > 0 ? Math.min(Math.round((currentCost / limit) * 100), 100) : 0;
    const actualPercentage = limit > 0 ? Math.round((currentCost / limit) * 100) : 0;

    // Determine color based on percentage
    let colorClass = 'budget-ok';
    let statusIcon = '✓';
    if (actualPercentage >= 100) {
      colorClass = 'budget-exceeded';
      statusIcon = '⛔';
    } else if (actualPercentage >= 90) {
      colorClass = 'budget-critical';
      statusIcon = '⚠';
    } else if (actualPercentage >= 75) {
      colorClass = 'budget-warning';
      statusIcon = '⚠';
    }

    const formattedCost = currentCost < 0.01
      ? `$${currentCost.toFixed(4)}`
      : `$${currentCost.toFixed(2)}`;
    const formattedLimit = `$${limit.toFixed(2)}`;

    return c.html(`
      <div id="budget-display" class="budget-display ${colorClass}" data-stream-id="${streamId}">
        <div class="budget-display-header">
          <span class="budget-display-icon">${statusIcon}</span>
          <span class="budget-display-title">Budget</span>
          <span class="budget-display-percentage">${actualPercentage}%</span>
        </div>
        <div class="budget-display-content">
          <div class="budget-progress-container">
            <div class="budget-progress-bar" style="width: ${percentage}%"></div>
          </div>
          <div class="budget-display-values">
            <span class="budget-current">${formattedCost}</span>
            <span class="budget-separator">/</span>
            <span class="budget-limit">${formattedLimit}</span>
          </div>
        </div>
      </div>
    `);
  } catch (err) {
    return c.html(`<div id="budget-display" class="rams-hidden"></div>`);
  }
});

/**
 * GET /api/partials/checkpoint-banner
 *
 * Returns HTML partial for checkpoint banner.
 * Shows checkpoint info and Resume/Clear buttons.
 *
 * Query params:
 *   - streamId: Stream to show checkpoint for
 */
api.get('/partials/checkpoint-banner', (c) => {
  const streamId = c.req.query('streamId');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot || !streamId) {
    return c.html(`<div id="checkpoint-banner" class="rams-hidden"></div>`);
  }

  // Determine PRD folder path
  let prdFolder = path.join(ralphRoot, `PRD-${streamId}`);
  const worktreePath = path.join(ralphRoot, 'worktrees', `PRD-${streamId}`, '.ralph', `PRD-${streamId}`);

  if (!fs.existsSync(prdFolder) && fs.existsSync(worktreePath)) {
    prdFolder = worktreePath;
  }

  const checkpointPath = path.join(prdFolder, 'checkpoint.json');

  if (!fs.existsSync(checkpointPath)) {
    return c.html(`<div id="checkpoint-banner" class="rams-hidden"></div>`);
  }

  try {
    const content = fs.readFileSync(checkpointPath, 'utf-8');
    const checkpoint = JSON.parse(content);

    // Calculate time ago
    let timeAgo = 'unknown';
    if (checkpoint.created_at) {
      const created = new Date(checkpoint.created_at);
      const diffMs = Date.now() - created.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      const diffHours = Math.floor(diffMins / 60);
      const diffDays = Math.floor(diffHours / 24);

      if (diffMins < 1) timeAgo = 'just now';
      else if (diffMins < 60) timeAgo = `${diffMins}m ago`;
      else if (diffHours < 24) timeAgo = `${diffHours}h ago`;
      else timeAgo = `${diffDays}d ago`;
    }

    const iteration = checkpoint.iteration || 1;
    const storyId = checkpoint.story_id || 'unknown';
    const agent = checkpoint.loop_state?.agent || 'unknown';

    return c.html(`
      <div id="checkpoint-banner" class="checkpoint-banner" data-stream-id="${streamId}">
        <div class="checkpoint-banner-icon">⚠️</div>
        <div class="checkpoint-banner-content">
          <div class="checkpoint-banner-title">Build interrupted</div>
          <div class="checkpoint-banner-details">
            Iteration <strong>${iteration}</strong> • Story <strong>${storyId}</strong> • Agent: ${agent}
            <br>
            <span class="checkpoint-banner-time">Last checkpoint: ${timeAgo}</span>
          </div>
        </div>
        <div class="checkpoint-banner-actions">
          <button
            class="btn btn-primary"
            hx-post="/api/streams/${streamId}/resume"
            hx-swap="none"
            hx-on::after-request="if(event.detail.successful) { this.closest('.checkpoint-banner').classList.add('rams-hidden'); window.location.reload(); }"
          >
            Resume
          </button>
          <button
            class="btn btn-secondary"
            hx-post="/api/streams/${streamId}/checkpoint/clear"
            hx-swap="none"
            hx-on::after-request="if(event.detail.successful) { this.closest('.checkpoint-banner').classList.add('rams-hidden'); }"
          >
            Clear
          </button>
        </div>
      </div>
    `);
  } catch {
    return c.html(`<div id="checkpoint-banner" class="rams-hidden"></div>`);
  }
});

/**
 * GET /api/partials/critical-alerts
 *
 * Returns HTML fragment for critical alerts banner (budget, stalled, failures, checkpoints).
 * Shows at top of dashboard when issues require attention.
 */
api.get("/partials/critical-alerts", (c) => {
  const { getCriticalAlerts } = require('../services/alerts-reader.js');
  const alerts = getCriticalAlerts();

  if (alerts.length === 0) {
    return c.html('');
  }

  const alertItems = alerts.map((alert: { type: string; message: string; action?: string }) => {
    const icon = alert.type === 'budget' ? '💰' :
                 alert.type === 'stalled' ? '⏸️' :
                 alert.type === 'failures' ? '❌' :
                 '⚠️';

    return `
      <div class="critical-alert-item ${alert.type}">
        <div class="critical-alert-icon">${icon}</div>
        <div class="critical-alert-content">
          <div class="critical-alert-message">${escapeHtml(alert.message)}</div>
          ${alert.action ? `<p class="critical-alert-action">${escapeHtml(alert.action)}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');

  return c.html(`
    <div class="critical-alerts-banner">
      ${alertItems}
    </div>
  `);
});

/**
 * GET /api/partials/cost-summary-card
 *
 * Returns HTML fragment for the total cost metric card.
 * Shows aggregate cost across all streams with budget progress.
 */
api.get("/partials/cost-summary-card", (c) => {
  const summary = getTokenSummary();
  const budget = getBudgetStatus();

  const formatCurrency = (cost: number): string => {
    if (cost >= 1) return `$${cost.toFixed(2)}`;
    if (cost >= 0.01) return `$${cost.toFixed(3)}`;
    if (cost > 0) return `$${cost.toFixed(4)}`;
    return "$0.00";
  };

  // Determine budget status
  const budgetPercentage = budget.daily.hasLimit
    ? budget.daily.percentage
    : 0;

  const progressClass = budgetPercentage >= 100
    ? 'budget-critical'
    : budgetPercentage >= 90
    ? 'budget-warning'
    : 'budget-ok';

  const budgetText = budget.daily.hasLimit
    ? `${budgetPercentage}% of daily budget`
    : 'No daily budget set';

  return c.html(`
    <div class="rams-card">
      <div class="metric-summary-label">Total Cost Today</div>
      <div class="metric-summary-value">${formatCurrency(budget.daily.spent)}</div>
      ${budget.daily.hasLimit ? `
        <div class="metric-summary-progress">
          <div class="metric-summary-progress-bar ${progressClass}" style="width: ${Math.min(budgetPercentage, 100)}%"></div>
        </div>
      ` : ''}
      <div class="metric-summary-subtext">${budgetText}</div>
      <div class="metric-summary-subtext" style="margin-top: 4px;">
        ${summary.byStream.reduce((sum, s) => sum + s.runCount, 0)} runs across ${summary.byStream.length} PRDs
      </div>
    </div>
  `);
});

/**
 * GET /api/partials/success-rate-card
 *
 * Returns HTML fragment for the success rate metric card.
 * Shows 7-day success rate with delta from previous period.
 */
api.get("/partials/success-rate-card", (c) => {
  const trends = getSuccessRateTrends('7d');
  const weekOverWeek = getWeekOverWeek();

  const successRate = trends.overallSuccessRate?.toFixed(1) || '0.0';
  const delta = weekOverWeek.delta || 0;
  const deltaClass = delta > 0 ? 'positive' : delta < 0 ? 'negative' : '';
  const deltaText = delta > 0 ? `▲ +${delta.toFixed(1)}%` : delta < 0 ? `▼ ${delta.toFixed(1)}%` : '—';

  return c.html(`
    <div class="rams-card">
      <div class="metric-summary-label">Success Rate (7d)</div>
      <div class="metric-summary-value">
        ${successRate}%
        ${delta !== 0 ? `<span class="metric-summary-delta ${deltaClass}">${deltaText} from last week</span>` : ''}
      </div>
      <div class="metric-summary-subtext">
        ${trends.totalPassed || 0} passed / ${trends.totalRuns || 0} total
      </div>
    </div>
  `);
});

/**
 * GET /api/partials/active-streams-card
 *
 * Returns HTML fragment for the active streams metric card.
 * Shows count of running streams with status breakdown.
 */
api.get("/partials/active-streams-card", (c) => {
  const streams = getStreams();

  const runningCount = streams.filter(s => s.status === 'running').length;
  const readyCount = streams.filter(s => s.status === 'ready' || s.status === 'in_progress').length;
  const completedCount = streams.filter(s => s.status === 'completed' || s.status === 'merged').length;

  const runningBadges = streams
    .filter(s => s.status === 'running')
    .slice(0, 5)
    .map(s => `<span class="rams-badge rams-badge-success">PRD-${s.id}</span>`)
    .join('');

  return c.html(`
    <div class="rams-card">
      <div class="metric-summary-label">Active Streams</div>
      <div class="metric-summary-value">${runningCount} running</div>
      <div class="metric-summary-subtext">
        ${readyCount} ready, ${completedCount} completed
      </div>
      ${runningBadges ? `
        <div style="margin-top: var(--rams-space-3); display: flex; gap: var(--rams-space-2); flex-wrap: wrap;">
          ${runningBadges}
        </div>
      ` : ''}
    </div>
  `);
});

/**
 * GET /api/trends/cost
 *
 * Returns JSON data for cost trend chart.
 */
api.get("/api/trends/cost", (c) => {
  const periodParam = c.req.query('period') || '7d';
  const period: '7d' | '30d' = periodParam === '30d' ? '30d' : '7d';
  const trend = getCostTrends(period);

  // Format for Chart.js
  const labels: string[] = [];
  const values: number[] = [];

  for (const point of trend.dailyMetrics) {
    labels.push(point.date);
    values.push(point.cost);
  }

  return c.json({ labels, values, period });
});

/**
 * GET /api/trends/velocity
 *
 * Returns JSON data for velocity trend chart.
 */
api.get("/api/trends/velocity", (c) => {
  const periodParam = c.req.query('period') || '7d';
  const period: '7d' | '30d' = periodParam === '30d' ? '30d' : '7d';
  const trend = getVelocityTrends(period);

  // Format for Chart.js
  const labels: string[] = [];
  const values: number[] = [];

  for (const point of trend.velocityMetrics) {
    labels.push(point.date);
    values.push(point.storiesCompleted);
  }

  return c.json({ labels, values, period });
});

/**
 * GET /api/trends/success-rate
 *
 * Returns JSON data for success rate trend chart.
 */
api.get("/api/trends/success-rate", (c) => {
  const periodParam = c.req.query('period') || '7d';
  const period: '7d' | '30d' = periodParam === '30d' ? '30d' : '7d';
  const trend = getSuccessRateTrends(period);

  // Format for Chart.js
  const labels: string[] = [];
  const values: number[] = [];

  for (const point of trend.dailyMetrics) {
    labels.push(point.date);
    values.push(point.successRate ?? 0);
  }

  return c.json({ labels, values, period });
});

/**
 * GET /api/partials/streams-grid
 *
 * Returns HTML fragment for the streams grid with inline metrics.
 * Shows all streams as expandable cards with quick actions.
 */
api.get("/partials/streams-grid", (c) => {
  const filterParam = c.req.query('filter');
  let streams = getStreams();

  // Apply filter
  if (filterParam === 'running') {
    streams = streams.filter(s => s.status === 'running');
  } else if (filterParam === 'ready') {
    streams = streams.filter(s => s.status === 'ready' || s.status === 'in_progress');
  } else if (filterParam === 'completed') {
    streams = streams.filter(s => s.status === 'completed' || s.status === 'merged');
  }

  if (streams.length === 0) {
    return c.html(`
      <div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
        <p class="rams-text-muted">No streams found.</p>
      </div>
    `);
  }

  const formatCurrency = (cost: number): string => {
    if (cost >= 1) return `$${cost.toFixed(2)}`;
    if (cost >= 0.01) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(4)}`;
  };

  const streamCards = streams.map(stream => {
    const streamTokens = getStreamTokens(stream.id);
    const cost = streamTokens?.totalCost || 0;
    const runCount = streamTokens?.runCount || 0;

    // Calculate success rate from runs
    const successfulRuns = stream.runs?.filter(r => r.status === 'completed').length || 0;
    const totalRuns = stream.runs?.length || runCount;
    const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;

    const progress = stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

    const statusBadge = stream.status === 'running'
      ? '<span class="rams-badge rams-badge-success stream-item-active">🔄 RUNNING</span>'
      : stream.status === 'completed'
      ? '<span class="rams-badge rams-badge-info">✅ DONE</span>'
      : stream.status === 'merged'
      ? '<span class="rams-badge rams-badge-info">✅ MERGED</span>'
      : stream.status === 'ready'
      ? '<span class="rams-badge">📋 READY</span>'
      : '<span class="rams-badge rams-badge-muted">⏸️ IDLE</span>';

    return `
      <div class="rams-card ${stream.status === 'running' ? 'stream-item-active' : ''}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
          <h3 class="rams-h3" style="margin: 0;">PRD-${stream.id}: ${escapeHtml(stream.name)}</h3>
          ${statusBadge}
        </div>

        ${progress > 0 ? `
          <div class="rams-progress" style="margin-bottom: var(--rams-space-3);">
            <div class="rams-progress-bar" style="width: ${progress}%"></div>
          </div>
        ` : ''}

        <div class="stream-card-inline-metrics">
          <div class="stream-metric-item">
            <span class="stream-metric-label">Stories:</span>
            <span class="stream-metric-value">${stream.completedStories}/${stream.totalStories}</span>
          </div>
          <div class="stream-metric-item">
            <span class="stream-metric-label">Cost:</span>
            <span class="stream-metric-value cost">${formatCurrency(cost)}</span>
          </div>
          ${totalRuns > 0 ? `
            <div class="stream-metric-item">
              <span class="stream-metric-label">Success:</span>
              <span class="stream-metric-value success">${successRate}%</span>
            </div>
          ` : ''}
        </div>

        <div class="stream-card-actions">
          <a href="/streams.html?stream=${stream.id}" class="stream-card-action-btn">
            📊 Details
          </a>
          ${stream.status !== 'running' && stream.status !== 'completed' && stream.status !== 'merged' ? `
            <button
              class="stream-card-action-btn primary"
              hx-post="/api/stream/${stream.id}/build"
              hx-vals='{"iterations": 5}'
              hx-swap="none"
            >
              🔨 Build
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  return c.html(`
    <div class="dashboard-streams-grid">
      ${streamCards}
    </div>
  `);
});

/**
 * GET /api/streams/:id/workflow-graph
 *
 * Get workflow graph data for visualization (Cytoscape.js format)
 *
 * Returns:
 *   - dispatcher: Dispatcher node (PRD) data
 *   - stats: Story and agent statistics
 *   - elements: Cytoscape graph elements (nodes + edges)
 */
api.get('/streams/:id/workflow-graph', (c) => {
  const id = c.req.param('id');
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      { error: 'not_found', message: 'Ralph root not found' },
      404
    );
  }

  const prdDir = path.join(ralphRoot, `PRD-${id}`);
  const planPath = path.join(prdDir, 'plan.md');
  const progressPath = path.join(prdDir, 'progress.md');
  const statusPath = path.join(prdDir, '.status.json');

  // Also check worktree paths
  const worktreePrdDir = path.join(ralphRoot, 'worktrees', `PRD-${id}`, '.ralph', `PRD-${id}`);
  const worktreePlanPath = path.join(worktreePrdDir, 'plan.md');
  const worktreeProgressPath = path.join(worktreePrdDir, 'progress.md');
  const worktreeStatusPath = path.join(worktreePrdDir, '.status.json');

  // Use worktree paths if they exist
  const effectivePlanPath = fs.existsSync(worktreePlanPath) ? worktreePlanPath : planPath;
  const effectiveProgressPath = fs.existsSync(worktreeProgressPath) ? worktreeProgressPath : progressPath;
  const effectiveStatusPath = fs.existsSync(worktreeStatusPath) ? worktreeStatusPath : statusPath;

  if (!fs.existsSync(effectivePlanPath)) {
    return c.json(
      { error: 'not_found', message: 'Plan file not found' },
      404
    );
  }

  try {
    // Parse plan.md to get all stories
    const planContent = fs.readFileSync(effectivePlanPath, 'utf-8');

    // Parse stories from plan.md (format: ### US-XXX: Title or ### [ ] US-XXX: Title)
    const stories: { id: string; title: string; status: string; acceptanceCriteria: any[] }[] = [];
    const lines = planContent.split('\n');

    for (const line of lines) {
      // Match story headings with or without checkbox
      // Pattern: ### US-001: Title or ### [ ] US-001: Title or ### [x] US-001: Title
      const storyMatch = line.match(/^###\s*(?:\[([ xX])\]\s*)?(US-\d+):\s*(.+)$/i);

      if (storyMatch) {
        const checkbox = storyMatch[1]; // May be undefined for plan.md format
        const storyId = storyMatch[2].toUpperCase();
        const storyTitle = storyMatch[3].trim();
        const isCompleted = checkbox && checkbox.toLowerCase() === 'x';

        stories.push({
          id: storyId,
          title: storyTitle,
          status: isCompleted ? 'completed' : 'pending',
          acceptanceCriteria: []
        });
      }
    }

    // Parse progress.md to get completion status
    const progressStories = new Map<string, { status: string; progress: number }>();
    if (fs.existsSync(effectiveProgressPath)) {
      const progressContent = fs.readFileSync(effectiveProgressPath, 'utf-8');
      const lines = progressContent.split('\n');

      for (const line of lines) {
        // Match story completion markers: ## [x] US-001: Title or ## [ ] US-001: Title
        const storyMatch = line.match(/^##\s*\[([ xX])\]\s*(US-\d+):/i);
        if (storyMatch) {
          const storyId = storyMatch[2].toUpperCase();
          const isCompleted = storyMatch[1].toLowerCase() === 'x';
          progressStories.set(storyId, {
            status: isCompleted ? 'completed' : 'in_progress',
            progress: isCompleted ? 1.0 : 0.5,
          });
        }
      }
    }

    // Get current build status
    let currentStoryId: string | null = null;
    let currentIteration = 0;
    let currentModel = 'sonnet';

    if (fs.existsSync(effectiveStatusPath)) {
      const statusContent = fs.readFileSync(effectiveStatusPath, 'utf-8');
      const status = JSON.parse(statusContent);
      currentStoryId = status.story_id || null;
      currentIteration = status.iteration || 0;
      // Try to infer model from status (may not be available)
      currentModel = status.model || 'sonnet';
    }

    // Build graph nodes
    const nodes: any[] = [];
    const edges: any[] = [];

    // Dispatcher node (PRD)
    const dispatcherId = `PRD-${id}`;
    const completedCount = stories.filter(s =>
      progressStories.get(s.id)?.status === 'completed' || s.status === 'completed'
    ).length;

    nodes.push({
      data: {
        id: dispatcherId,
        type: 'dispatcher',
        label: `PRD-${id}`,
        total_stories: stories.length,
        completed_stories: completedCount,
      },
      classes: ['dispatcher', 'status-running'],
    });

    // Story nodes
    let inProgressCount = 0;
    for (const story of stories) {
      const progressData = progressStories.get(story.id);
      const status = progressData?.status || story.status || 'ready';
      const progress = progressData?.progress || 0;

      if (status === 'in_progress') {
        inProgressCount++;
      }

      nodes.push({
        data: {
          id: story.id,
          type: 'story',
          label: story.title.substring(0, 30) + (story.title.length > 30 ? '...' : ''),
          status: status,
          progress: progress,
          iterations: 0,
          cost: 0,
        },
        classes: ['story', `status-${status}`],
      });

      // Edge from dispatcher to story
      edges.push({
        data: {
          id: `edge-${dispatcherId}-to-${story.id}`,
          source: dispatcherId,
          target: story.id,
          type: 'story-path',
        },
        classes: [],
      });
    }

    // Add active agent node if there's a running build
    let activeAgents = 0;
    if (currentStoryId && currentIteration > 0) {
      const agentId = `agent-${id}-${currentStoryId}-active`;
      nodes.push({
        data: {
          id: agentId,
          type: 'agent',
          label: `Iter ${currentIteration}`,
          parent_story: currentStoryId,
          model: currentModel,
          tokens_budget: 50000,
          tokens_used: 0,
          elapsed_seconds: 0,
          phase: 'executing',
        },
        classes: ['agent', `model-${currentModel}`],
      });

      // Edge from dispatcher to current story (active path)
      edges.push({
        data: {
          id: `edge-active-${agentId}`,
          source: dispatcherId,
          target: currentStoryId,
          type: 'agent-path',
        },
        classes: ['active'],
      });

      activeAgents = 1;
    }

    // Return graph data
    return c.json({
      dispatcher_id: dispatcherId,
      dispatcher: {
        id: dispatcherId,
        label: `PRD-${id}`,
        total_stories: stories.length,
        completed_stories: completedCount,
      },
      stats: {
        total_stories: stories.length,
        completed_stories: completedCount,
        inprogress_stories: inProgressCount,
        active_agents: activeAgents,
      },
      elements: {
        nodes: nodes,
        edges: edges,
      },
    });

  } catch (error: any) {
    console.error('Error generating workflow graph:', error);
    return c.json(
      { error: 'internal_error', message: error.message },
      500
    );
  }
});

/**
 * GET /api/test-greeting
 *
 * Test page for greeting component visual verification.
 * Displays greeting component with different props to verify rendering.
 */
import { renderGreeting } from './utils/greeting.js';

api.get('/test-greeting', async (c) => {
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Greeting Component Test</title>
      <link rel="stylesheet" href="/css/rams-ui.css">
      <style>
        body {
          margin: 0;
          padding: 40px;
          background: var(--rams-gray-100);
          font-family: var(--rams-font-sans);
        }
        .test-container {
          max-width: 1200px;
          margin: 0 auto;
        }
        .test-section {
          margin-bottom: 60px;
        }
        .test-section h2 {
          font-size: var(--rams-text-2xl);
          font-weight: 600;
          margin-bottom: var(--rams-space-6);
          color: var(--rams-gray-900);
        }
        .test-case {
          margin-bottom: var(--rams-space-8);
        }
        .test-case-label {
          font-size: var(--rams-text-sm);
          font-weight: 500;
          color: var(--rams-gray-600);
          margin-bottom: var(--rams-space-4);
          font-family: var(--rams-font-mono);
        }
        .greeting-wrapper {
          display: inline-block;
          margin: var(--rams-space-4) 0;
        }
        .code-example {
          background: var(--rams-gray-900);
          color: var(--rams-gray-100);
          padding: var(--rams-space-4);
          border-radius: var(--rams-radius-md);
          font-family: var(--rams-font-mono);
          font-size: var(--rams-text-sm);
          margin-top: var(--rams-space-4);
        }
      </style>
    </head>
    <body>
      <div class="test-container">
        <h1 style="font-size: 3rem; font-weight: 700; margin-bottom: 40px; color: var(--rams-black);">
          Greeting Component Test
        </h1>

        <div class="test-section">
          <h2>Standard Cases</h2>

          <div class="test-case">
            <div class="test-case-label">renderGreeting("Alice")</div>
            <div class="greeting-wrapper">
              ${renderGreeting("Alice")}
            </div>
            <div class="code-example">Expected: "Hello, Alice!" with kinetic typography animation</div>
          </div>

          <div class="test-case">
            <div class="test-case-label">renderGreeting("") (empty string fallback)</div>
            <div class="greeting-wrapper">
              ${renderGreeting("")}
            </div>
            <div class="code-example">Expected: "Hello, Guest!" (fallback behavior)</div>
          </div>

          <div class="test-case">
            <div class="test-case-label">renderGreeting() (undefined fallback)</div>
            <div class="greeting-wrapper">
              ${renderGreeting()}
            </div>
            <div class="code-example">Expected: "Hello, Guest!" (fallback behavior)</div>
          </div>
        </div>

        <div class="test-section">
          <h2>Edge Cases</h2>

          <div class="test-case">
            <div class="test-case-label">renderGreeting("Mary Jane Watson")</div>
            <div class="greeting-wrapper">
              ${renderGreeting("Mary Jane Watson")}
            </div>
            <div class="code-example">Expected: Multi-word name with proper spacing</div>
          </div>

          <div class="test-case">
            <div class="test-case-label">renderGreeting("X")</div>
            <div class="greeting-wrapper">
              ${renderGreeting("X")}
            </div>
            <div class="code-example">Expected: Single character name</div>
          </div>
        </div>

        <div class="test-section">
          <h2>Typography & Animation Verification</h2>
          <p style="color: var(--rams-gray-600); margin-bottom: 20px;">
            Verify the following:
          </p>
          <ul style="color: var(--rams-gray-700); line-height: 1.8;">
            <li><strong>Monospace font</strong> on name (IBM Plex Mono)</li>
            <li><strong>Electric lime (#CCFF00) exclamation mark</strong> with glow effect</li>
            <li><strong>Letter-by-letter animation</strong> with staggered delays (50ms between letters)</li>
            <li><strong>Scanline texture overlay</strong> for retro-terminal aesthetic</li>
            <li><strong>Blinking cursor</strong> after the name (green, step animation)</li>
            <li><strong>High-contrast black background</strong> with white border</li>
            <li><strong>Box shadow</strong> with layered borders</li>
          </ul>
        </div>
      </div>
    </body>
    </html>
  `;

  return c.html(html);
});

export { api };
