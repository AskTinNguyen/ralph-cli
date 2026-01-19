/**
 * Miscellaneous Partials Routes
 *
 * HTML partial endpoints for basic UI fragments on the dashboard.
 * Returns HTML fragments for HTMX partial updates.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { Story, LogLevel } from "../../../types.js";
import {
  getRalphRoot,
  getMode,
  getStreams,
  getStreamDetails,
} from "../../../services/state-reader.js";
import {
  parseStories,
  countStoriesByStatus,
} from "../../../services/markdown-parser.js";
import { parseActivityLog, parseRunLog } from "../../../services/log-parser.js";
import { processManager } from "../../../services/process-manager.js";
import { escapeHtml } from "../../utils/html-helpers.js";

const miscPartials = new Hono();

/**
 * GET /progress
 *
 * Returns HTML fragment for the progress bar section.
 * Query params:
 *   - streamId: Optional stream ID to show progress for specific stream
 */
miscPartials.get("/progress", (c) => {
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

  const percentage =
    totalStories > 0 ? Math.round((completedStories / totalStories) * 100) : 0;

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
 * GET /stories
 *
 * Returns HTML fragment for the story cards grid.
 * Query params:
 *   - streamId: Optional stream ID to show stories for specific stream
 */
miscPartials.get("/stories", (c) => {
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
      let badgeClass: string;
      if (story.status === "completed") {
        badgeClass = "rams-badge-success";
      } else if (story.status === "in-progress") {
        badgeClass = "rams-badge-warning";
      } else {
        badgeClass = "rams-badge-muted";
      }

      let statusLabel: string;
      if (story.status === "in-progress") {
        statusLabel = "In Progress";
      } else {
        statusLabel = story.status.charAt(0).toUpperCase() + story.status.slice(1);
      }

      let criteriaHtml = "";
      if (story.acceptanceCriteria.length > 0) {
        const criteriaItems = story.acceptanceCriteria
          .slice(0, 3)
          .map((ac) => {
            const completedStyle = ac.completed ? "text-decoration: line-through;" : "";
            const completedClass = ac.completed ? "rams-text-muted" : "";
            return `<div class="rams-text-sm ${completedClass}" style="padding: var(--rams-space-1) 0; ${completedStyle}">${escapeHtml(ac.text)}</div>`;
          })
          .join("");

        const moreCount = story.acceptanceCriteria.length - 3;
        const moreHtml =
          moreCount > 0
            ? `<div class="rams-text-sm rams-text-muted" style="padding: var(--rams-space-1) 0;">+${moreCount} more</div>`
            : "";

        criteriaHtml = `
<div style="margin-top: var(--rams-space-3); padding-top: var(--rams-space-3); border-top: 1px solid var(--rams-gray-200);">
  ${criteriaItems}
  ${moreHtml}
</div>
`;
      }

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

  return c.html(
    `<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));">${storyCards}</div>`
  );
});

/**
 * GET /status-indicator
 *
 * Returns HTML fragment for the status indicator in the footer.
 */
miscPartials.get("/status-indicator", (c) => {
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

  return c.html(
    `<span class="rams-badge ${statusClass}"><span class="rams-badge-dot"></span>${statusText}</span>`
  );
});

/**
 * GET /terminal-commands
 *
 * Returns HTML fragment showing helpful terminal commands for log viewing.
 * Query params:
 *   - streamId: Optional stream ID to show stream-specific commands
 */
miscPartials.get("/terminal-commands", (c) => {
  const streamId = c.req.query("streamId");

  // Build commands based on whether a stream is selected
  let commands: Array<{ comment: string; command: string }>;

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
    <span style="transform: rotate(0deg); transition: transform 0.2s; display: inline-block;">&#9654;</span>
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
 * GET /activity-logs
 *
 * Returns HTML fragment for the activity logs list.
 * Query params:
 *   - level: Filter by minimum log level (error, warning, info)
 *   - streamId: Optional stream ID
 */
miscPartials.get("/activity-logs", (c) => {
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

      let levelBadge: string;
      if (entry.level === "error") {
        levelBadge = "rams-badge-error";
      } else if (entry.level === "warning") {
        levelBadge = "rams-badge-warning";
      } else {
        levelBadge = "rams-badge-info";
      }
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
 * GET /run-list
 *
 * Returns HTML fragment for the expandable run logs list.
 * Query params:
 *   - streamId: Optional stream ID
 */
miscPartials.get("/run-list", (c) => {
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
  runs = [...runs]
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
    .slice(0, 10);

  const runListHtml = runs
    .map((run, index) => {
      const timestamp = run.startedAt.toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      let statusClass: string;
      if (run.status === "completed") {
        statusClass = "rams-badge-success";
      } else if (run.status === "failed") {
        statusClass = "rams-badge-error";
      } else {
        statusClass = "rams-badge-warning";
      }

      const storyInfo = run.storyId
        ? `${run.storyId}: ${run.storyTitle || ""}`
        : "Unknown story";

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
 * GET /run-log-content
 *
 * Returns HTML fragment for the content of a specific run log.
 * Query params:
 *   - runId: The run ID
 *   - streamId: The stream ID
 *   - iteration: The iteration number
 */
miscPartials.get("/run-log-content", (c) => {
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

      let levelBadge: string;
      if (entry.level === "error") {
        levelBadge = "rams-badge-error";
      } else if (entry.level === "warning") {
        levelBadge = "rams-badge-warning";
      } else {
        levelBadge = "rams-badge-info";
      }

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
 * GET /build-status
 *
 * Returns HTML fragment for the build status display in the Command Center.
 */
miscPartials.get("/build-status", (c) => {
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
 * GET /stream-options
 *
 * Returns HTML options for the stream selector dropdown.
 * Supports two views via query param `view`:
 * - "current" (default): All streams in flat list
 * - "progress": Grouped by completion status
 */
miscPartials.get("/stream-options", (c) => {
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
      optionsHtml += '<optgroup label="Completed (100%)">';
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
      optionsHtml += '<optgroup label="In Progress (1-99%)">';
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
      optionsHtml += '<optgroup label="Not Started (0%)">';
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

export { miscPartials };
