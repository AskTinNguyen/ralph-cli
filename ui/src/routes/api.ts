/**
 * API Routes
 *
 * REST API endpoints for status, progress, and streams.
 * Provides data to the UI for displaying Ralph CLI state.
 */

import { Hono } from 'hono';
import type { RalphStatus, ProgressStats, Stream, Story, LogEntry, LogLevel, BuildOptions } from '../types.js';
import { getRalphRoot, getMode, getStreams, getStreamDetails } from '../services/state-reader.js';
import { parseStories, countStoriesByStatus, getCompletionPercentage } from '../services/markdown-parser.js';
import { parseActivityLog, parseRunLog, listRunLogs, getRunSummary } from '../services/log-parser.js';
import { getTokenSummary, getStreamTokens, getStoryTokens, getRunTokens, getTokenTrends, getBudgetStatus } from '../services/token-reader.js';
import { processManager } from '../services/process-manager.js';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const api = new Hono();

/**
 * GET /api/status
 *
 * Returns overall Ralph status including mode, progress stats, and current run info.
 */
api.get('/status', (c) => {
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
  if (mode === 'multi') {
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
      completionPercentage: totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0,
    };
  } else if (mode === 'single' && rootPath) {
    // Read single PRD file
    const prdPath = path.join(rootPath, 'prd.md');
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, 'utf-8');
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
    const locksPath = path.join(rootPath, 'locks');
    if (fs.existsSync(locksPath)) {
      try {
        const locks = fs.readdirSync(locksPath);
        isRunning = locks.some((lock) => lock.endsWith('.lock'));
      } catch {
        // Ignore errors
      }
    }
  }

  const status: RalphStatus = {
    mode,
    rootPath,
    progress,
    isRunning,
  };

  return c.json(status);
});

/**
 * GET /api/progress
 *
 * Returns story list with completion status for the active stream.
 * In multi-stream mode, uses the most recently modified PRD.
 */
api.get('/progress', (c) => {
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

  if (mode === 'multi') {
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
  } else if (mode === 'single') {
    // Read single PRD file
    const prdPath = path.join(rootPath, 'prd.md');
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, 'utf-8');
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
 * GET /api/streams
 *
 * Returns all streams with status information.
 */
api.get('/streams', (c) => {
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
api.get('/streams/:id', (c) => {
  const id = c.req.param('id');

  const stream = getStreamDetails(id);

  if (!stream) {
    return c.json(
      {
        error: 'not_found',
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Compute additional stats
  const completionPercentage =
    stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

  const inProgressStories = stream.stories.filter((s) => s.status === 'in-progress').length;
  const pendingStories = stream.stories.filter((s) => s.status === 'pending').length;

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
api.get('/logs/activity', (c) => {
  // Parse query parameters
  const streamId = c.req.query('streamId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const levelFilter = c.req.query('level') as LogLevel | undefined;

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
api.get('/logs/run/:runId', (c) => {
  const runId = c.req.param('runId');
  const streamId = c.req.query('streamId');
  const iterationStr = c.req.query('iteration');
  const limit = parseInt(c.req.query('limit') || '200', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const levelFilter = c.req.query('level') as LogLevel | undefined;

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
        error: 'not_found',
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
api.get('/logs/runs', (c) => {
  const streamId = c.req.query('streamId');

  if (!streamId) {
    return c.json(
      {
        error: 'bad_request',
        message: 'streamId query parameter is required',
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
const VALID_AGENTS = ['claude', 'codex', 'droid'] as const;

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
api.post('/build/start', async (c) => {
  let body: {
    iterations?: number;
    stream?: string;
    agent?: string;
    noCommit?: boolean;
  };

  // Try to parse as JSON first, then fall back to form data
  const contentType = c.req.header('content-type') || '';
  try {
    if (contentType.includes('application/json')) {
      body = await c.req.json();
    } else {
      // Parse form-encoded data
      const formData = await c.req.parseBody();
      body = {
        iterations: formData.iterations ? parseInt(formData.iterations as string, 10) : undefined,
        stream: formData.stream && formData.stream !== '' ? (formData.stream as string) : undefined,
        agent: formData.agent as string | undefined,
        noCommit: formData.noCommit === 'true' || formData.noCommit === 'on',
      };
    }
  } catch {
    return c.json(
      {
        error: 'bad_request',
        message: 'Invalid request body',
      },
      400
    );
  }

  // Validate iterations
  const iterations = body.iterations;
  if (iterations === undefined || iterations === null) {
    return c.json(
      {
        error: 'bad_request',
        message: 'Missing required parameter: iterations',
      },
      400
    );
  }

  if (typeof iterations !== 'number' || !Number.isInteger(iterations)) {
    return c.json(
      {
        error: 'bad_request',
        message: 'Parameter iterations must be an integer',
      },
      400
    );
  }

  if (iterations < 1 || iterations > 100) {
    return c.json(
      {
        error: 'bad_request',
        message: 'Parameter iterations must be between 1 and 100',
      },
      400
    );
  }

  // Validate agent if provided
  if (body.agent !== undefined && body.agent !== null) {
    if (!VALID_AGENTS.includes(body.agent as (typeof VALID_AGENTS)[number])) {
      return c.json(
        {
          error: 'bad_request',
          message: `Invalid agent: ${body.agent}. Must be one of: ${VALID_AGENTS.join(', ')}`,
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
        error: 'conflict',
        message: 'A build is already running. Stop it first before starting a new one.',
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
    options.agent = body.agent as BuildOptions['agent'];
  }
  if (body.noCommit !== undefined) {
    options.noCommit = body.noCommit;
  }

  // Check budget before starting build
  const budgetStatus = getBudgetStatus();
  if (budgetStatus.shouldPause) {
    let reason = 'Budget exceeded';
    if (budgetStatus.daily.exceeded && budgetStatus.daily.limit !== null) {
      reason = `Daily budget exceeded ($${budgetStatus.daily.spent.toFixed(2)}/$${budgetStatus.daily.limit.toFixed(2)})`;
    } else if (budgetStatus.monthly.exceeded && budgetStatus.monthly.limit !== null) {
      reason = `Monthly budget exceeded ($${budgetStatus.monthly.spent.toFixed(2)}/$${budgetStatus.monthly.limit.toFixed(2)})`;
    }
    return c.json(
      {
        error: 'budget_exceeded',
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

  // Start the build
  const status = processManager.startBuild(iterations, options);

  // Check if there was an error starting
  if (status.state === 'error') {
    return c.json(
      {
        error: 'internal_error',
        message: status.error || 'Failed to start build',
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
api.post('/build/stop', (c) => {
  // Check if a build is running
  if (!processManager.isRunning()) {
    return c.json(
      {
        error: 'not_found',
        message: 'No build is currently running',
      },
      404
    );
  }

  const status = processManager.stopBuild();

  // Check for errors
  if (status.error && status.state === 'error') {
    return c.json(
      {
        error: 'internal_error',
        message: status.error,
      },
      500
    );
  }

  return c.json({
    success: true,
    message: 'Build stop signal sent',
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
api.get('/build/status', (c) => {
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
api.post('/plan/start', async (c) => {
  // Check if build is already running (plan and build share the process manager)
  if (processManager.isRunning()) {
    const currentStatus = processManager.getBuildStatus();
    return c.json(
      {
        error: 'conflict',
        message: 'A process is already running. Stop it first before starting a new one.',
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
        error: 'internal_error',
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
  const args = ['plan'];
  if (body.stream) {
    args.push(`--prd=${body.stream}`);
  }

  try {
    const childProcess = spawn('ralph', args, {
      cwd: projectRoot,
      env: { ...process.env },
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    if (!childProcess.pid) {
      return c.json(
        {
          error: 'internal_error',
          message: 'Failed to start plan process: no PID assigned',
        },
        500
      );
    }

    const command = `ralph ${args.join(' ')}`;
    console.log(`[API] Started plan: ${command} (PID: ${childProcess.pid})`);

    return c.json({
      success: true,
      status: {
        state: 'running',
        pid: childProcess.pid,
        startedAt: new Date().toISOString(),
        command,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return c.json(
      {
        error: 'internal_error',
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
api.get('/partials/progress', (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();
  const requestedStreamId = c.req.query('streamId');

  // Handle missing .ralph directory
  if (!rootPath) {
    return c.html(`
<div class="empty-state empty-state-setup">
  <div class="empty-icon">&#128194;</div>
  <h3>No .ralph directory found</h3>
  <p>Run <code>ralph init</code> or <code>ralph prd</code> to get started.</p>
</div>
`);
  }

  let totalStories = 0;
  let completedStories = 0;
  let inProgressStories = 0;
  let pendingStories = 0;

  if (mode === 'multi') {
    const streams = getStreams();

    // If a specific stream is requested, use that; otherwise aggregate all streams
    if (requestedStreamId) {
      const stream = streams.find(s => s.id === requestedStreamId);
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
  } else if (mode === 'single' && rootPath) {
    const prdPath = path.join(rootPath, 'prd.md');
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, 'utf-8');
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
<div class="empty-state">
  <h3>No stories found</h3>
  <p>Create a PRD with user stories using <code>ralph prd</code> to track progress.</p>
</div>
`);
  }

  const html = `
<div class="progress-wrapper">
  <div class="progress-stats">
    <span>${completedStories} of ${totalStories} stories completed</span>
    <span class="progress-percentage">${percentage}%</span>
  </div>
  <div class="progress-bar">
    <div class="progress-fill" style="width: ${percentage}%"></div>
  </div>
  <div class="progress-counts">
    <div class="progress-count">
      <span class="dot completed"></span>
      <span>${completedStories} Completed</span>
    </div>
    <div class="progress-count">
      <span class="dot in-progress"></span>
      <span>${inProgressStories} In Progress</span>
    </div>
    <div class="progress-count">
      <span class="dot pending"></span>
      <span>${pendingStories} Pending</span>
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
api.get('/partials/stories', (c) => {
  const rootPath = getRalphRoot();
  const mode = getMode();
  const requestedStreamId = c.req.query('streamId');

  let stories: Story[] = [];

  if (!rootPath) {
    return c.html(`
<div class="empty-state empty-state-setup">
  <div class="empty-icon">&#128221;</div>
  <h3>No .ralph directory found</h3>
  <p>Run <code>ralph init</code> or <code>ralph prd</code> to create a PRD and get started.</p>
</div>
`);
  }

  if (mode === 'multi') {
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
  } else if (mode === 'single') {
    const prdPath = path.join(rootPath, 'prd.md');
    if (fs.existsSync(prdPath)) {
      try {
        const prdContent = fs.readFileSync(prdPath, 'utf-8');
        stories = parseStories(prdContent);
      } catch {
        // Return empty stories
      }
    }
  }

  if (stories.length === 0) {
    return c.html(`
<div class="empty-state">
  <div class="empty-icon">&#128203;</div>
  <h3>No stories found</h3>
  <p>Add user stories to your PRD file or create a new PRD with <code>ralph prd</code>.</p>
</div>
`);
  }

  const storyCards = stories
    .map((story) => {
      const statusClass = story.status;
      const statusLabel =
        story.status === 'in-progress'
          ? 'In Progress'
          : story.status.charAt(0).toUpperCase() + story.status.slice(1);

      const criteriaHtml =
        story.acceptanceCriteria.length > 0
          ? `
<div class="acceptance-criteria">
  ${story.acceptanceCriteria
    .slice(0, 3)
    .map(
      (ac) => `
  <div class="criteria-item ${ac.completed ? 'completed' : ''}">${escapeHtml(ac.text)}</div>
`
    )
    .join('')}
  ${story.acceptanceCriteria.length > 3 ? `<div class="criteria-item">+${story.acceptanceCriteria.length - 3} more</div>` : ''}
</div>
`
          : '';

      return `
<div class="story-card">
  <div class="story-header">
    <span class="story-id">${escapeHtml(story.id)}</span>
    <span class="status-badge ${statusClass}">${statusLabel}</span>
  </div>
  <div class="story-title">${escapeHtml(story.title)}</div>
  ${criteriaHtml}
</div>
`;
    })
    .join('');

  return c.html(`<div class="stories-grid">${storyCards}</div>`);
});

/**
 * GET /api/partials/status-indicator
 *
 * Returns HTML fragment for the status indicator in the footer.
 */
api.get('/partials/status-indicator', (c) => {
  const rootPath = getRalphRoot();

  let isRunning = false;
  if (rootPath) {
    const locksPath = path.join(rootPath, 'locks');
    if (fs.existsSync(locksPath)) {
      try {
        const locks = fs.readdirSync(locksPath);
        isRunning = locks.some((lock) => lock.endsWith('.lock'));
      } catch {
        // Ignore errors
      }
    }
  }

  const statusClass = isRunning ? 'running' : 'idle';
  const statusText = isRunning ? 'Running' : 'Idle';

  return c.html(`<span class="status-indicator ${statusClass}">${statusText}</span>`);
});

/**
 * GET /api/partials/activity-logs
 *
 * Returns HTML fragment for the activity logs list.
 * Query params:
 *   - level: Filter by minimum log level (error, warning, info)
 */
api.get('/partials/activity-logs', (c) => {
  const mode = getMode();
  const levelFilter = c.req.query('level') as LogLevel | undefined;
  const requestedStreamId = c.req.query('streamId');

  // Get the stream ID (from query param or most recent in multi mode)
  let streamId: string | undefined = requestedStreamId;
  if (!streamId && mode === 'multi') {
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
<div class="empty-state">
  <div class="empty-icon">&#128196;</div>
  <h3>No activity logs found</h3>
  <p>Activity will appear here when you run <code>ralph build</code>.</p>
</div>
`);
  }

  const logEntriesHtml = entries
    .map((entry) => {
      const timestamp = entry.timestamp.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      return `
<div class="log-entry ${entry.level}">
  <span class="log-timestamp">${timestamp}</span>
  <span class="log-level ${entry.level}">${entry.level}</span>
  <span class="log-message">${escapeHtml(entry.message)}</span>
</div>
`;
    })
    .join('');

  return c.html(`<div class="log-entries">${logEntriesHtml}</div>`);
});

/**
 * GET /api/partials/run-list
 *
 * Returns HTML fragment for the expandable run logs list.
 */
api.get('/partials/run-list', (c) => {
  const mode = getMode();
  const requestedStreamId = c.req.query('streamId');

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

  if (mode === 'multi') {
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
<div class="empty-state">
  <div class="empty-icon">&#128640;</div>
  <h3>No runs recorded yet</h3>
  <p>Build runs will appear here when you execute <code>ralph build</code>.</p>
</div>
`);
  }

  // Sort by most recent first and limit to 10 runs
  runs = [...runs].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime()).slice(0, 10);

  const runListHtml = runs
    .map((run, index) => {
      const timestamp = run.startedAt.toLocaleString('en-US', {
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      const statusClass = run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'error' : 'in-progress';
      const storyInfo = run.storyId ? `${run.storyId}: ${run.storyTitle || ''}` : 'Unknown story';

      // Create a unique ID for the run details container
      const runDetailsId = `run-details-${index}`;

      return `
<div class="run-item" data-run-id="${escapeHtml(run.id)}">
  <div class="run-header" onclick="this.parentElement.classList.toggle('expanded')">
    <div class="run-info">
      <span class="status-badge ${statusClass}">${run.status}</span>
      <span class="run-id">iter ${run.iteration}</span>
      <span class="run-story">${escapeHtml(storyInfo)}</span>
    </div>
    <div style="display: flex; align-items: center; gap: var(--spacing-md);">
      <span class="run-timestamp">${timestamp}</span>
      <span class="run-expand-icon">&#9660;</span>
    </div>
  </div>
  <div class="run-details" id="${runDetailsId}"
       hx-get="/api/partials/run-log-content?runId=${encodeURIComponent(run.id)}&streamId=${streamId || ''}&iteration=${run.iteration}"
       hx-trigger="intersect once"
       hx-swap="innerHTML">
    <div class="loading">Loading run log...</div>
  </div>
</div>
`;
    })
    .join('');

  return c.html(`<div class="run-list">${runListHtml}</div>`);
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
api.get('/partials/run-log-content', (c) => {
  const runId = c.req.query('runId');
  const streamId = c.req.query('streamId');
  const iterationStr = c.req.query('iteration');

  if (!runId) {
    return c.html(`<p class="empty-state">No run ID provided</p>`);
  }

  const iteration = iterationStr ? parseInt(iterationStr, 10) : undefined;
  const entries = parseRunLog(runId, streamId, iteration);

  if (entries.length === 0) {
    return c.html(`<p class="empty-state">Run log content not available</p>`);
  }

  // Limit to first 100 entries for performance
  const limitedEntries = entries.slice(0, 100);

  const logContentHtml = limitedEntries
    .map((entry) => {
      const timestamp = entry.timestamp.toLocaleString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      });

      return `
<div class="log-entry ${entry.level}">
  <span class="log-timestamp">${timestamp}</span>
  <span class="log-level ${entry.level}">${entry.level}</span>
  <span class="log-message">${escapeHtml(entry.message)}</span>
</div>
`;
    })
    .join('');

  const hasMore = entries.length > 100 ? `<p style="color: var(--text-muted); font-size: 0.75rem; margin-top: var(--spacing-sm);">Showing first 100 of ${entries.length} entries</p>` : '';

  return c.html(`<div class="run-log-content">${logContentHtml}${hasMore}</div>`);
});

/**
 * GET /api/partials/streams-summary
 *
 * Returns HTML fragment for the streams summary section showing aggregate stats.
 */
api.get('/partials/streams-summary', (c) => {
  const streams = getStreams();

  const totalStreams = streams.length;
  const runningStreams = streams.filter((s) => s.status === 'running').length;
  const completedStreams = streams.filter((s) => s.status === 'completed').length;
  const idleStreams = streams.filter((s) => s.status === 'idle').length;

  // Calculate total stories across all streams
  let totalStories = 0;
  let completedStories = 0;
  for (const stream of streams) {
    totalStories += stream.totalStories;
    completedStories += stream.completedStories;
  }

  const overallPercentage = totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

  if (totalStreams === 0) {
    return c.html(`
<div class="empty-state empty-state-setup">
  <div class="empty-icon">&#128295;</div>
  <h3>No streams yet</h3>
  <p>Create your first PRD with <code>ralph prd</code> or click the 'New Stream' button.</p>
</div>
`);
  }

  const html = `
<div class="streams-summary">
  <div class="summary-stat">
    <div class="summary-stat-value">${totalStreams}</div>
    <div class="summary-stat-label">Total Streams</div>
  </div>
  <div class="summary-stat ${runningStreams > 0 ? 'running' : ''}">
    <div class="summary-stat-value">${runningStreams}</div>
    <div class="summary-stat-label">Running</div>
  </div>
  <div class="summary-stat ${completedStreams > 0 ? 'completed' : ''}">
    <div class="summary-stat-value">${completedStreams}</div>
    <div class="summary-stat-label">Completed</div>
  </div>
  <div class="summary-stat">
    <div class="summary-stat-value">${overallPercentage}%</div>
    <div class="summary-stat-label">Overall Progress</div>
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
api.get('/partials/streams', (c) => {
  const streams = getStreams();
  const ralphRoot = getRalphRoot();

  if (streams.length === 0) {
    return c.html(`
<div class="empty-state">
  <div class="empty-icon">&#128203;</div>
  <h3>No streams found</h3>
  <p>Create a PRD with <code>ralph prd</code> or use the 'New Stream' button to get started.</p>
</div>
`);
  }

  // Check which streams have worktrees initialized
  const worktreesPath = ralphRoot ? path.join(ralphRoot, 'worktrees') : null;
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
      const isCompleted = stream.status === 'completed';
      const isRunning = stream.status === 'running';

      // Build action buttons based on stream state
      let actionButtonsHtml = '';

      // Init button - show if worktree not initialized
      if (!worktreeInitialized) {
        actionButtonsHtml += `
          <button class="btn btn-secondary btn-sm" onclick="initStream('${stream.id}', event)" title="Initialize git worktree">
            Init
          </button>`;
      }

      // Build button - always show (opens inline form)
      actionButtonsHtml += `
        <button class="btn btn-primary btn-sm" onclick="toggleBuildForm('${stream.id}', event)" title="Start build iterations" ${isRunning ? 'disabled' : ''}>
          ${isRunning ? 'Running...' : 'Build'}
        </button>`;

      // Merge button - only show when worktree exists (nothing to merge without worktree)
      if (worktreeInitialized) {
        const escapedName = escapeHtml(stream.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
        actionButtonsHtml += `
          <button class="btn btn-warning btn-sm" onclick="mergeStream('${stream.id}', '${escapedName}', event)" title="Merge to main branch">
            Merge
          </button>`;
      }

      // Build form (hidden by default)
      const buildFormHtml = `
        <div id="build-form-${stream.id}" class="build-form" style="display: none;" onclick="event.stopPropagation()">
          <label for="iterations-${stream.id}">Iterations:</label>
          <input type="number" id="iterations-${stream.id}" name="iterations" value="1" min="1" max="100" />
          <button class="btn btn-primary btn-sm" onclick="startStreamBuild('${stream.id}', event)">Start</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleBuildForm('${stream.id}', event)">Cancel</button>
        </div>`;

      return `
<div class="stream-card" onclick="showStreamDetail('${stream.id}', '${escapeHtml(stream.name).replace(/'/g, "\\'")}')">
  <div class="stream-header">
    <span class="stream-id">PRD-${stream.id}</span>
    <span class="status-badge ${stream.status}">${statusLabel}</span>
  </div>
  <div class="stream-title">${escapeHtml(stream.name)}</div>
  <div class="stream-progress">
    <div class="stream-progress-bar">
      <div class="stream-progress-fill" style="width: ${completionPercentage}%"></div>
    </div>
    <div class="stream-progress-text">${stream.completedStories} of ${stream.totalStories} stories completed (${completionPercentage}%)</div>
  </div>
  <div class="stream-meta">
    <div class="stream-files">
      <span class="stream-file-badge ${stream.hasPrd ? 'present' : 'missing'}">PRD</span>
      <span class="stream-file-badge ${stream.hasPlan ? 'present' : 'missing'}">Plan</span>
      <span class="stream-file-badge ${stream.hasProgress ? 'present' : 'missing'}">Progress</span>
      ${worktreeInitialized ? '<span class="stream-file-badge present">Worktree</span>' : ''}
    </div>
  </div>
  <div class="stream-card-actions">
    ${actionButtonsHtml}
  </div>
  ${buildFormHtml}
</div>
`;
    })
    .join('');

  return c.html(`<div class="streams-grid">${streamCards}</div>`);
});

/**
 * GET /api/partials/stream-detail
 *
 * Returns HTML fragment for a specific stream's detail view.
 * Query params:
 *   - id: Stream ID
 */
api.get('/partials/stream-detail', (c) => {
  const id = c.req.query('id');

  if (!id) {
    return c.html(`<div class="empty-state"><p>No stream ID provided</p></div>`);
  }

  const stream = getStreamDetails(id);

  if (!stream) {
    return c.html(`
<div class="empty-state">
  <h3>Stream not found</h3>
  <p>PRD-${escapeHtml(id)} does not exist.</p>
</div>
`);
  }

  const completionPercentage =
    stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

  const statusLabel = stream.status.charAt(0).toUpperCase() + stream.status.slice(1);

  // Build stories list HTML
  const storiesHtml = stream.stories.length > 0
    ? stream.stories.map((story) => {
        const storyStatusLabel =
          story.status === 'in-progress'
            ? 'In Progress'
            : story.status.charAt(0).toUpperCase() + story.status.slice(1);

        const criteriaHtml =
          story.acceptanceCriteria.length > 0
            ? `<div class="acceptance-criteria">
                ${story.acceptanceCriteria
                  .slice(0, 3)
                  .map((ac) => `<div class="criteria-item ${ac.completed ? 'completed' : ''}">${escapeHtml(ac.text)}</div>`)
                  .join('')}
                ${story.acceptanceCriteria.length > 3 ? `<div class="criteria-item">+${story.acceptanceCriteria.length - 3} more</div>` : ''}
              </div>`
            : '';

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
      }).join('')
    : '<div class="empty-state"><p>No stories found in this PRD.</p></div>';

  // Build runs list HTML
  const runsHtml = stream.runs.length > 0
    ? stream.runs.slice(0, 10).map((run) => {
        const timestamp = run.startedAt.toLocaleString('en-US', {
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        });

        const runStatusClass = run.status === 'completed' ? 'completed' : run.status === 'failed' ? 'error' : 'in-progress';
        const storyInfo = run.storyId ? `${run.storyId}: ${run.storyTitle || ''}` : 'Unknown story';

        return `
<div class="run-item">
  <div class="run-header" onclick="this.parentElement.classList.toggle('expanded')">
    <div class="run-info">
      <span class="status-badge ${runStatusClass}">${run.status}</span>
      <span class="run-id">iter ${run.iteration}</span>
      <span class="run-story">${escapeHtml(storyInfo)}</span>
    </div>
    <div style="display: flex; align-items: center; gap: var(--spacing-md);">
      <span class="run-timestamp">${timestamp}</span>
      <span class="run-expand-icon">&#9660;</span>
    </div>
  </div>
  <div class="run-details"
       hx-get="/api/partials/run-log-content?runId=${encodeURIComponent(run.id)}&streamId=${stream.id}&iteration=${run.iteration}"
       hx-trigger="intersect once"
       hx-swap="innerHTML">
    <div class="loading">Loading run log...</div>
  </div>
</div>
`;
      }).join('')
    : '<div class="empty-state"><p>No runs found for this stream.</p></div>';

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

<script>
function switchStreamTab(btn, tabName) {
  // Update tab buttons
  document.querySelectorAll('.stream-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');

  // Update tab content
  document.querySelectorAll('.stream-tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('stream-tab-' + tabName).classList.add('active');
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
api.get('/partials/build-status', (c) => {
  const status = processManager.getBuildStatus();

  let statusClass = 'idle';
  let statusText = 'Idle';
  let detailsHtml = '';

  switch (status.state) {
    case 'running':
      statusClass = 'running';
      statusText = 'Running...';
      if (status.command) {
        detailsHtml = `
          <div class="build-status-info">
            <div class="build-status-command">${escapeHtml(status.command)}</div>
            ${status.startedAt ? `<div class="build-status-details">Started: ${status.startedAt.toLocaleTimeString()}</div>` : ''}
          </div>
        `;
      }
      break;
    case 'completed':
      statusClass = 'completed';
      statusText = 'Completed';
      break;
    case 'error':
      statusClass = 'error';
      statusText = 'Error';
      if (status.error) {
        detailsHtml = `<div class="build-status-details">${escapeHtml(status.error)}</div>`;
      }
      break;
    default:
      statusClass = 'idle';
      statusText = 'Idle';
  }

  const html = `
<div class="build-status ${statusClass}">
  <span class="build-status-dot"></span>
  <span class="build-status-text">${statusText}</span>
</div>
${detailsHtml}
`;

  return c.html(html);
});

/**
 * GET /api/partials/stream-options
 *
 * Returns HTML options for the stream selector dropdown.
 */
api.get('/partials/stream-options', (c) => {
  const streams = getStreams();

  let optionsHtml = '<option value="">Default (latest)</option>';

  for (const stream of streams) {
    const completionPercentage =
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0;
    optionsHtml += `<option value="${stream.id}">PRD-${stream.id}: ${escapeHtml(stream.name)} (${completionPercentage}%)</option>`;
  }

  return c.html(optionsHtml);
});

/**
 * Helper function to escape HTML characters
 */
function escapeHtml(text: string): string {
  const htmlEscapes: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
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
  if (relativePath.includes('..')) {
    return null;
  }

  // Decode URL-encoded path
  const decodedPath = decodeURIComponent(relativePath);

  // Reject paths that still have traversal after decoding
  if (decodedPath.includes('..')) {
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
api.get('/files/*', (c) => {
  // Extract the path from the wildcard match
  const requestedPath = c.req.path.replace(/^\/api\/files\//, '');

  if (!requestedPath) {
    return c.json(
      {
        error: 'bad_request',
        message: 'File path is required',
      },
      400
    );
  }

  // Validate the path is within .ralph
  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: 'forbidden',
        message: 'Access denied: path is outside .ralph directory',
      },
      403
    );
  }

  // Check if file exists
  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: 'not_found',
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
        error: 'bad_request',
        message: 'Cannot read a directory',
      },
      400
    );
  }

  try {
    const content = fs.readFileSync(validatedPath, 'utf-8');
    return c.text(content);
  } catch (err) {
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to read file',
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
api.put('/files/*', async (c) => {
  // Extract the path from the wildcard match
  const requestedPath = c.req.path.replace(/^\/api\/files\//, '');

  if (!requestedPath) {
    return c.json(
      {
        error: 'bad_request',
        message: 'File path is required',
      },
      400
    );
  }

  // Validate the path is within .ralph
  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: 'forbidden',
        message: 'Access denied: path is outside .ralph directory',
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
          error: 'internal_error',
          message: 'Failed to create parent directory',
        },
        500
      );
    }
  }

  try {
    fs.writeFileSync(validatedPath, content, 'utf-8');
    return c.json({
      success: true,
      message: 'File updated successfully',
      path: requestedPath,
    });
  } catch (err) {
    return c.json(
      {
        error: 'internal_error',
        message: 'Failed to write file',
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
    const childProcess = spawn('ralph', args, {
      cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    childProcess.on('error', (error: Error) => {
      resolve({
        success: false,
        stdout: '',
        stderr: error.message,
        code: null,
      });
    });

    childProcess.on('exit', (code) => {
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
api.post('/stream/new', (c) => {
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_found',
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
    const prdPath = path.join(streamPath, 'prd.md');

    // Create the directory
    fs.mkdirSync(streamPath, { recursive: true });

    // Create the prd.md file with template
    fs.writeFileSync(prdPath, PRD_TEMPLATE, 'utf-8');

    return c.json({
      success: true,
      id: nextId,
      path: streamPath,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      {
        error: 'internal_error',
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
api.post('/stream/:id/init', async (c) => {
  const id = c.req.param('id');

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: 'not_found',
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_found',
        message: '.ralph directory not found',
      },
      404
    );
  }

  // Project root is the parent of .ralph
  const projectRoot = path.dirname(ralphRoot);

  const result = await executeRalphCommand(['stream', 'init', id], projectRoot);

  if (result.success) {
    return c.json({
      success: true,
      message: `Stream PRD-${id} worktree initialized`,
      output: result.stdout,
    });
  } else {
    return c.json(
      {
        error: result.code === null ? 'spawn_error' : 'command_failed',
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
api.post('/stream/:id/merge', async (c) => {
  const id = c.req.param('id');

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: 'not_found',
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: 'not_found',
        message: '.ralph directory not found',
      },
      404
    );
  }

  // Project root is the parent of .ralph
  const projectRoot = path.dirname(ralphRoot);

  const result = await executeRalphCommand(['stream', 'merge', id], projectRoot);

  if (result.success) {
    return c.json({
      success: true,
      message: `Stream PRD-${id} merged to main`,
      output: result.stdout,
    });
  } else {
    return c.json(
      {
        error: result.code === null ? 'spawn_error' : 'command_failed',
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
api.post('/stream/:id/build', async (c) => {
  const id = c.req.param('id');

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: 'not_found',
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
        error: 'bad_request',
        message: 'Invalid JSON body',
      },
      400
    );
  }

  // Validate iterations
  const iterations = body.iterations;
  if (!iterations || typeof iterations !== 'number' || iterations < 1) {
    return c.json(
      {
        error: 'bad_request',
        message: 'iterations must be a positive number',
      },
      400
    );
  }

  // Validate agent if provided
  const validAgents = ['claude', 'codex', 'droid'];
  if (body.agent && !validAgents.includes(body.agent)) {
    return c.json(
      {
        error: 'bad_request',
        message: `agent must be one of: ${validAgents.join(', ')}`,
      },
      400
    );
  }

  // Build options with stream set
  const options: Partial<BuildOptions> = {
    stream: id,
    agent: body.agent as BuildOptions['agent'],
    noCommit: body.noCommit,
  };

  // Check budget before starting build
  const budgetStatus = getBudgetStatus();
  if (budgetStatus.shouldPause) {
    let reason = 'Budget exceeded';
    if (budgetStatus.daily.exceeded && budgetStatus.daily.limit !== null) {
      reason = `Daily budget exceeded ($${budgetStatus.daily.spent.toFixed(2)}/$${budgetStatus.daily.limit.toFixed(2)})`;
    } else if (budgetStatus.monthly.exceeded && budgetStatus.monthly.limit !== null) {
      reason = `Monthly budget exceeded ($${budgetStatus.monthly.spent.toFixed(2)}/$${budgetStatus.monthly.limit.toFixed(2)})`;
    }
    return c.json(
      {
        error: 'budget_exceeded',
        message: `${reason}. Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
      },
      403
    );
  }

  // Start the build using process manager
  const status = processManager.startBuild(iterations, options);

  // Check if build was started successfully or if already running
  if (status.error && status.state === 'running') {
    return c.json(
      {
        error: 'conflict',
        message: 'A build is already running',
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

  if (status.state === 'error') {
    return c.json(
      {
        error: 'start_failed',
        message: status.error || 'Failed to start build',
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
api.post('/files/*/open', async (c) => {
  // Extract the path from the wildcard match
  const requestedPath = c.req.path.replace(/^\/api\/files\//, '').replace(/\/open$/, '');

  if (!requestedPath) {
    return c.json(
      {
        error: 'bad_request',
        message: 'File path is required',
      },
      400
    );
  }

  // Validate the path is within .ralph
  const validatedPath = validateFilePath(requestedPath);

  if (!validatedPath) {
    return c.json(
      {
        error: 'forbidden',
        message: 'Access denied: path is outside .ralph directory',
      },
      403
    );
  }

  // Check if file exists
  if (!fs.existsSync(validatedPath)) {
    return c.json(
      {
        error: 'not_found',
        message: `File not found: ${requestedPath}`,
      },
      404
    );
  }

  try {
    // Try to open in VSCode first, fall back to system default
    const { exec } = await import('node:child_process');
    const platform = process.platform;

    let command: string;
    if (platform === 'darwin') {
      // macOS - try VSCode, then fall back to 'open'
      command = `code "${validatedPath}" 2>/dev/null || open -t "${validatedPath}"`;
    } else if (platform === 'win32') {
      // Windows - try VSCode, then fall back to notepad
      command = `code "${validatedPath}" 2>nul || notepad "${validatedPath}"`;
    } else {
      // Linux - try VSCode, then xdg-open
      command = `code "${validatedPath}" 2>/dev/null || xdg-open "${validatedPath}"`;
    }

    exec(command, (error) => {
      if (error) {
        console.error('Failed to open file:', error);
      }
    });

    return c.json({
      success: true,
      message: 'File opened in external editor',
      path: requestedPath,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';
    return c.json(
      {
        error: 'internal_error',
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
api.get('/tokens/summary', (c) => {
  const summary = getTokenSummary();
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
  });
});

/**
 * GET /api/tokens/stream/:id
 *
 * Returns detailed token metrics for a specific stream.
 * Includes per-story breakdown, per-model breakdown, and all runs.
 */
api.get('/tokens/stream/:id', (c) => {
  const id = c.req.param('id');

  const streamTokens = getStreamTokens(id);

  if (!streamTokens) {
    return c.json(
      {
        error: 'not_found',
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
api.get('/tokens/story/:streamId/:storyId', (c) => {
  const streamId = c.req.param('streamId');
  const storyId = c.req.param('storyId');

  const storyTokens = getStoryTokens(streamId, storyId);

  if (!storyTokens) {
    return c.json(
      {
        error: 'not_found',
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
api.get('/tokens/runs', (c) => {
  const streamId = c.req.query('streamId');
  const limit = parseInt(c.req.query('limit') || '50', 10);
  const offset = parseInt(c.req.query('offset') || '0', 10);
  const from = c.req.query('from');
  const to = c.req.query('to');

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
api.get('/tokens/trends', (c) => {
  const periodParam = c.req.query('period') || '7d';
  const streamId = c.req.query('streamId');

  // Validate period
  const validPeriods = ['7d', '30d', '90d', 'all'] as const;
  const period = validPeriods.includes(periodParam as typeof validPeriods[number])
    ? (periodParam as '7d' | '30d' | '90d' | 'all')
    : '7d';

  const trends = getTokenTrends(period, streamId);

  return c.json(trends);
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
api.get('/partials/token-summary', (c) => {
  const summary = getTokenSummary();

  // Calculate previous period cost for trend
  const trends = getTokenTrends('7d');
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
  let trendDirection: 'up' | 'down' | 'neutral' = 'neutral';
  let trendPercentage = 0;
  if (previousCost > 0 && currentCost > 0) {
    trendPercentage = Math.round(((currentCost - previousCost) / previousCost) * 100);
    if (trendPercentage > 5) {
      trendDirection = 'up';
    } else if (trendPercentage < -5) {
      trendDirection = 'down';
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
    return '$0.00';
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
<div class="empty-state empty-state-setup">
  <div class="empty-icon">&#128200;</div>
  <h3>No token data yet</h3>
  <p>Token consumption data will appear here after running <code>ralph build</code> commands.</p>
</div>
`);
  }

  // Trend indicator HTML
  let trendHtml = '';
  if (trendDirection === 'up') {
    trendHtml = `<span class="token-trend up" title="Cost trend vs previous period">&#9650; +${trendPercentage}%</span>`;
  } else if (trendDirection === 'down') {
    trendHtml = `<span class="token-trend down" title="Cost trend vs previous period">&#9660; ${trendPercentage}%</span>`;
  } else {
    trendHtml = `<span class="token-trend neutral" title="Cost trend vs previous period">&#8212; 0%</span>`;
  }

  const totalTokens = summary.totalInputTokens + summary.totalOutputTokens;

  const html = `
<div class="token-summary-cards">
  <div class="token-card">
    <div class="token-card-label">Total Tokens</div>
    <div class="token-card-value">${formatTokens(totalTokens)}</div>
    <div class="token-card-breakdown">
      <span class="token-input" title="Input tokens">&#8593; ${formatTokens(summary.totalInputTokens)}</span>
      <span class="token-output" title="Output tokens">&#8595; ${formatTokens(summary.totalOutputTokens)}</span>
    </div>
  </div>

  <div class="token-card token-card-highlight">
    <div class="token-card-label">Total Cost</div>
    <div class="token-card-value">${formatCurrency(summary.totalCost)}</div>
    <div class="token-card-breakdown">
      ${trendHtml}
    </div>
  </div>

  <div class="token-card">
    <div class="token-card-label">Avg Cost / Story</div>
    <div class="token-card-value">${formatCurrency(summary.avgCostPerStory)}</div>
    <div class="token-card-breakdown">
      <span class="token-muted">per completed story</span>
    </div>
  </div>

  <div class="token-card">
    <div class="token-card-label">Avg Cost / Run</div>
    <div class="token-card-value">${formatCurrency(summary.avgCostPerRun)}</div>
    <div class="token-card-breakdown">
      <span class="token-muted">per build iteration</span>
    </div>
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
api.get('/partials/token-streams', (c) => {
  const summary = getTokenSummary();
  const streams = getStreams();

  if (summary.byStream.length === 0) {
    return c.html(`
<div class="empty-state">
  <div class="empty-icon">&#128203;</div>
  <h3>No streams found</h3>
  <p>Create a PRD with <code>ralph prd</code> to start tracking token usage.</p>
</div>
`);
  }

  // Find max cost for progress bar scaling
  const maxCost = Math.max(...summary.byStream.map(s => s.totalCost), 0.01);

  // Format currency
  const formatCurrency = (cost: number): string => {
    if (cost >= 1) {
      return `$${cost.toFixed(2)}`;
    } else if (cost >= 0.01) {
      return `$${cost.toFixed(3)}`;
    } else if (cost > 0) {
      return `$${cost.toFixed(4)}`;
    }
    return '$0.00';
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
  const enrichedStreams = summary.byStream.map(stream => {
    // Find matching stream to get completedStories
    const fullStream = streams.find(s => s.id === stream.streamId);
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

  const tableRows = enrichedStreams.map(stream => {
    const costPercentage = maxCost > 0 ? Math.round((stream.totalCost / maxCost) * 100) : 0;
    const efficiencyDisplay = stream.efficiencyScore !== null
      ? formatCurrency(stream.efficiencyScore)
      : '<span class="token-muted">N/A</span>';
    // For sorting, use a high number for N/A so they sort to the end
    const efficiencySortValue = stream.efficiencyScore !== null ? stream.efficiencyScore : 999999;

    return `
<tr class="token-stream-row token-stream-clickable"
    data-stream-id="${escapeHtml(stream.streamId)}"
    data-stream-name="${escapeHtml(stream.streamName)}"
    data-stories="${stream.storyCount}"
    data-runs="${stream.runCount}"
    data-input="${stream.inputTokens}"
    data-output="${stream.outputTokens}"
    data-cost="${stream.totalCost}"
    data-efficiency="${efficiencySortValue}"
    onclick="showTokenStreamDetail('${escapeHtml(stream.streamId)}', '${escapeHtml(stream.streamName).replace(/'/g, "\\'")}')">
  <td>
    <span class="stream-id">PRD-${escapeHtml(stream.streamId)}</span>
    <span class="stream-name">${escapeHtml(stream.streamName)}</span>
  </td>
  <td class="token-count">${stream.storyCount}</td>
  <td class="token-count">${stream.runCount}</td>
  <td class="token-count" title="Input tokens">
    <span class="token-input">&#8593;</span> ${formatTokens(stream.inputTokens)}
  </td>
  <td class="token-count" title="Output tokens">
    <span class="token-output">&#8595;</span> ${formatTokens(stream.outputTokens)}
  </td>
  <td class="token-cost">
    <div class="token-cost-bar">
      <div class="token-cost-fill" style="width: ${costPercentage}%"></div>
    </div>
    <span class="token-cost-value">${formatCurrency(stream.totalCost)}</span>
  </td>
  <td class="token-efficiency" title="Cost per completed story">${efficiencyDisplay}</td>
</tr>
`;
  }).join('');

  const html = `
<div class="token-table-container">
  <table class="token-table token-table-sortable" id="token-streams-table">
    <thead>
      <tr>
        <th class="sortable" data-sort="stream" data-sort-type="string">
          Stream <span class="sort-icon"></span>
        </th>
        <th class="token-count-header sortable" data-sort="stories" data-sort-type="number">
          Stories <span class="sort-icon"></span>
        </th>
        <th class="token-count-header sortable" data-sort="runs" data-sort-type="number">
          Runs <span class="sort-icon"></span>
        </th>
        <th class="token-count-header sortable" data-sort="input" data-sort-type="number">
          Input <span class="sort-icon"></span>
        </th>
        <th class="token-count-header sortable" data-sort="output" data-sort-type="number">
          Output <span class="sort-icon"></span>
        </th>
        <th class="token-cost-header sortable" data-sort="cost" data-sort-type="number">
          Cost <span class="sort-icon"></span>
        </th>
        <th class="token-efficiency-header sortable" data-sort="efficiency" data-sort-type="number" title="Cost per completed story">
          Efficiency <span class="sort-icon"></span>
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
 * Returns HTML fragment for the token usage by model breakdown.
 */
api.get('/partials/token-models', (c) => {
  const summary = getTokenSummary();

  const modelEntries = Object.entries(summary.byModel);

  if (modelEntries.length === 0) {
    return c.html(`
<div class="empty-state">
  <div class="empty-icon">&#129302;</div>
  <h3>No model data yet</h3>
  <p>Model breakdown will appear here after running builds with different Claude models.</p>
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
    return '$0.00';
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

  // Find max cost for progress bar scaling
  const maxCost = Math.max(...modelEntries.map(([, metrics]) => metrics.totalCost), 0.01);

  const modelCards = modelEntries.map(([model, metrics]) => {
    const costPercentage = maxCost > 0 ? Math.round((metrics.totalCost / maxCost) * 100) : 0;
    const modelName = model || 'unknown';
    const displayName = modelName.charAt(0).toUpperCase() + modelName.slice(1);
    const totalTokens = metrics.inputTokens + metrics.outputTokens;

    return `
<div class="token-model-card">
  <div class="token-model-header">
    <span class="token-model-name">${escapeHtml(displayName)}</span>
    <span class="token-model-runs">${metrics.runCount || 0} runs</span>
  </div>
  <div class="token-model-stats">
    <div class="token-model-stat">
      <span class="token-model-stat-label">Tokens</span>
      <span class="token-model-stat-value">${formatTokens(totalTokens)}</span>
    </div>
    <div class="token-model-stat">
      <span class="token-model-stat-label">Cost</span>
      <span class="token-model-stat-value">${formatCurrency(metrics.totalCost)}</span>
    </div>
  </div>
  <div class="token-model-bar">
    <div class="token-model-bar-fill" style="width: ${costPercentage}%"></div>
  </div>
  <div class="token-model-breakdown">
    <span class="token-input" title="Input tokens">&#8593; ${formatTokens(metrics.inputTokens)}</span>
    <span class="token-output" title="Output tokens">&#8595; ${formatTokens(metrics.outputTokens)}</span>
  </div>
</div>
`;
  }).join('');

  return c.html(`<div class="token-models-grid">${modelCards}</div>`);
});

/**
 * GET /api/partials/token-stories/:streamId
 *
 * Returns HTML fragment for expandable per-story token breakdown within a stream.
 * Shows story ID, title, status, runs, tokens, and cost with accordion expand/collapse.
 * Highlights stories with unusually high token consumption.
 */
api.get('/partials/token-stories/:streamId', (c) => {
  const streamId = c.req.param('streamId');
  const streamTokens = getStreamTokens(streamId);
  const streamDetails = getStreamDetails(streamId);

  if (!streamTokens || !streamDetails) {
    return c.html(`
<div class="empty-state">
  <div class="empty-icon">&#128203;</div>
  <h3>Stream not found</h3>
  <p>PRD-${escapeHtml(streamId)} does not exist or has no token data.</p>
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
    return '$0.00';
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
  const storyTokenData = stories.map(story => {
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
    const tokensPerCriterion = criteriaCount > 0
      ? Math.round(tokenData.totalTokens / criteriaCount)
      : 0;

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
<div class="empty-state">
  <div class="empty-icon">&#128221;</div>
  <h3>No stories found</h3>
  <p>This stream has no user stories defined.</p>
</div>
`);
  }

  // Calculate average tokens to identify high consumption stories
  const avgTokens = storyTokenData.reduce((sum, s) => sum + s.totalTokens, 0) / storyTokenData.length;
  const highConsumptionThreshold = avgTokens * 1.5; // 50% above average is "high"

  // Find max cost for scaling
  const maxCost = Math.max(...storyTokenData.map(s => s.totalCost), 0.01);

  // Get runs for this stream to link to individual run logs
  const runs = streamTokens.runs || [];

  // Build story accordion HTML
  const storyItems = storyTokenData.map(story => {
    const isHighConsumption = story.totalTokens > highConsumptionThreshold && story.totalTokens > 0;
    const costPercentage = maxCost > 0 ? Math.round((story.totalCost / maxCost) * 100) : 0;

    // Status badge class
    const statusClass = story.status === 'completed' ? 'completed' :
                        story.status === 'in-progress' ? 'in-progress' : 'pending';
    const statusLabel = story.status === 'in-progress' ? 'In Progress' :
                        story.status.charAt(0).toUpperCase() + story.status.slice(1);

    // Get runs for this story
    const storyRuns = runs.filter(run => run.storyId === story.id);

    // Build run list HTML for expanded view
    const runListHtml = storyRuns.length > 0
      ? storyRuns.map(run => {
          const runDate = new Date(run.timestamp);
          const dateStr = runDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const timeStr = runDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
          const estimatedLabel = run.estimated ? '<span class="token-estimated" title="Estimated tokens">~</span>' : '';

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
        }).join('')
      : '<div class="token-story-no-runs">No runs recorded for this story.</div>';

    return `
<div class="token-story-accordion${isHighConsumption ? ' high-consumption' : ''}" data-story-id="${escapeHtml(story.id)}">
  <div class="token-story-header" onclick="toggleTokenStory(this)">
    <div class="token-story-info">
      <span class="token-story-expand-icon">&#9654;</span>
      <span class="token-story-id">${escapeHtml(story.id)}</span>
      <span class="status-badge ${statusClass}">${statusLabel}</span>
      <span class="token-story-title">${escapeHtml(story.title)}</span>
      ${isHighConsumption ? '<span class="token-high-badge" title="High token consumption">&#9888; High</span>' : ''}
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
  }).join('');

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
api.get('/tokens/budget', (c) => {
  const status = getBudgetStatus();
  return c.json(status);
});

/**
 * GET /api/partials/token-budget
 *
 * Returns HTML fragment for budget progress bars.
 * Shows daily and monthly budget consumption with color-coded progress bars.
 */
api.get('/partials/token-budget', (c) => {
  const status = getBudgetStatus();

  // If no budgets are configured, show configuration hint
  if (!status.daily.hasLimit && !status.monthly.hasLimit) {
    return c.html(`
<div class="budget-section budget-not-configured">
  <div class="budget-hint">
    <span class="budget-hint-icon">&#128176;</span>
    <div class="budget-hint-text">
      <strong>Budget tracking not configured</strong>
      <p>Set <code>RALPH_BUDGET_DAILY</code> and/or <code>RALPH_BUDGET_MONTHLY</code> in <code>.agents/ralph/config.sh</code> to enable budget tracking.</p>
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
    return '$0.00';
  };

  // Get color class based on percentage
  const getColorClass = (percentage: number): string => {
    if (percentage >= 100) return 'budget-exceeded';
    if (percentage >= 90) return 'budget-critical';
    if (percentage >= 80) return 'budget-warning';
    return 'budget-ok';
  };

  // Build daily budget HTML
  let dailyHtml = '';
  if (status.daily.hasLimit && status.daily.limit !== null) {
    const dailyColorClass = getColorClass(status.daily.percentage);
    const dailyBarWidth = Math.min(status.daily.percentage, 100);
    const dailyStatusIcon = status.daily.exceeded ? '&#9888;' : '&#10003;';
    const dailyStatusText = status.daily.exceeded ? 'Exceeded' : 'OK';

    dailyHtml = `
<div class="budget-item">
  <div class="budget-header">
    <span class="budget-label">Daily Budget</span>
    <span class="budget-values">
      ${formatCurrency(status.daily.spent)} / ${formatCurrency(status.daily.limit)}
    </span>
  </div>
  <div class="budget-progress-container">
    <div class="budget-progress-bar ${dailyColorClass}" style="width: ${dailyBarWidth}%"></div>
  </div>
  <div class="budget-footer">
    <span class="budget-percentage ${dailyColorClass}">${status.daily.percentage}%</span>
    <span class="budget-status ${dailyColorClass}">
      <span class="budget-status-icon">${dailyStatusIcon}</span>
      ${dailyStatusText}
    </span>
    ${status.daily.remaining !== null && !status.daily.exceeded ? `<span class="budget-remaining">${formatCurrency(status.daily.remaining)} remaining</span>` : ''}
  </div>
</div>
`;
  }

  // Build monthly budget HTML
  let monthlyHtml = '';
  if (status.monthly.hasLimit && status.monthly.limit !== null) {
    const monthlyColorClass = getColorClass(status.monthly.percentage);
    const monthlyBarWidth = Math.min(status.monthly.percentage, 100);
    const monthlyStatusIcon = status.monthly.exceeded ? '&#9888;' : '&#10003;';
    const monthlyStatusText = status.monthly.exceeded ? 'Exceeded' : 'OK';

    monthlyHtml = `
<div class="budget-item">
  <div class="budget-header">
    <span class="budget-label">Monthly Budget</span>
    <span class="budget-values">
      ${formatCurrency(status.monthly.spent)} / ${formatCurrency(status.monthly.limit)}
    </span>
  </div>
  <div class="budget-progress-container">
    <div class="budget-progress-bar ${monthlyColorClass}" style="width: ${monthlyBarWidth}%"></div>
  </div>
  <div class="budget-footer">
    <span class="budget-percentage ${monthlyColorClass}">${status.monthly.percentage}%</span>
    <span class="budget-status ${monthlyColorClass}">
      <span class="budget-status-icon">${monthlyStatusIcon}</span>
      ${monthlyStatusText}
    </span>
    ${status.monthly.remaining !== null && !status.monthly.exceeded ? `<span class="budget-remaining">${formatCurrency(status.monthly.remaining)} remaining</span>` : ''}
  </div>
</div>
`;
  }

  // Show warning banner if build pause is enabled and budget exceeded
  let pauseWarningHtml = '';
  if (status.pauseOnExceeded && status.shouldPause) {
    pauseWarningHtml = `
<div class="budget-pause-warning">
  <span class="budget-pause-icon">&#128721;</span>
  <div class="budget-pause-text">
    <strong>Builds Paused</strong>
    <p>Budget exceeded and <code>RALPH_BUDGET_PAUSE_ON_EXCEEDED=true</code> is set. New builds will be blocked until budget resets.</p>
  </div>
</div>
`;
  }

  // Show alerts if any thresholds were crossed
  let alertsHtml = '';
  const allAlerts = [
    ...status.daily.alerts.map(a => ({ ...a, period: 'daily' })),
    ...status.monthly.alerts.map(a => ({ ...a, period: 'monthly' })),
  ];

  // Only show the highest alert for each period
  const highestDailyAlert = status.daily.alerts[status.daily.alerts.length - 1];
  const highestMonthlyAlert = status.monthly.alerts[status.monthly.alerts.length - 1];

  if (highestDailyAlert || highestMonthlyAlert) {
    const alertItems = [];
    if (highestDailyAlert) {
      const alertClass = highestDailyAlert.threshold >= 100 ? 'alert-error' : highestDailyAlert.threshold >= 90 ? 'alert-critical' : 'alert-warning';
      alertItems.push(`<div class="budget-alert ${alertClass}"><span class="budget-alert-icon">&#9888;</span> ${escapeHtml(highestDailyAlert.message)}</div>`);
    }
    if (highestMonthlyAlert) {
      const alertClass = highestMonthlyAlert.threshold >= 100 ? 'alert-error' : highestMonthlyAlert.threshold >= 90 ? 'alert-critical' : 'alert-warning';
      alertItems.push(`<div class="budget-alert ${alertClass}"><span class="budget-alert-icon">&#9888;</span> ${escapeHtml(highestMonthlyAlert.message)}</div>`);
    }
    alertsHtml = `<div class="budget-alerts">${alertItems.join('')}</div>`;
  }

  const html = `
<div class="budget-section">
  ${pauseWarningHtml}
  ${alertsHtml}
  <div class="budget-items">
    ${dailyHtml}
    ${monthlyHtml}
  </div>
</div>
`;

  return c.html(html);
});

export { api };
