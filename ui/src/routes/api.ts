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

export { api };
