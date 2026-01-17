/**
 * Kanban Board API Route
 *
 * Renders the full Kanban board HTML with all columns and cards.
 */

import { Hono } from "hono";
import { getStreams } from "../../../services/state-reader.js";

const board = new Hono();

/**
 * Format elapsed time from a start date to now
 * Returns format like "2m 34s" or "1h 23m"
 */
function formatElapsedTime(startedAt: Date): string {
  const now = new Date();
  const elapsedMs = now.getTime() - startedAt.getTime();
  const elapsedSec = Math.floor(elapsedMs / 1000);

  if (elapsedSec < 60) {
    return `${elapsedSec}s`;
  }

  const minutes = Math.floor(elapsedSec / 60);
  const seconds = elapsedSec % 60;

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

/**
 * GET /api/kanban/board
 *
 * Returns rendered Kanban board HTML with all PRDs organized into columns.
 */
board.get("/", (c) => {
  const allStreams = getStreams();

  // Categorize streams by status
  const ready: typeof allStreams = [];
  const planning: typeof allStreams = [];
  const building: typeof allStreams = [];
  const completed: typeof allStreams = [];

  for (const stream of allStreams) {
    if (stream.status === "ready") {
      ready.push(stream);
    } else if (stream.status === "idle" && stream.hasPlan) {
      // Planning stage: has plan but not started building
      planning.push(stream);
    } else if (stream.status === "in_progress" || stream.status === "running") {
      building.push(stream);
    } else if (stream.status === "completed" || stream.status === "merged") {
      completed.push(stream);
    } else if (!stream.hasPlan && stream.hasPrd) {
      // PRD exists but no plan yet = ready
      ready.push(stream);
    }
  }

  // If no PRDs exist at all, show global empty state
  if (allStreams.length === 0) {
    return c.html(`
      <div class="kanban-global-empty">
        <img src="/ralph-logo-bw.png" alt="Ralph rover" class="kanban-global-empty-icon" />
        <h2>No PRDs Found</h2>
        <p>No rovers deployed yet. Create your first PRD to begin the mission.</p>
        <div class="kanban-global-empty-code">ralph prd</div>
        <a href="/docs/" class="rams-btn rams-btn-primary">View Documentation</a>
      </div>
    `);
  }

  // Render Kanban board
  return c.html(`
    <div class="kanban-board">
      ${renderColumn("ready", "Launch Pad", ready)}
      ${renderColumn("planning", "Transit", planning)}
      ${renderColumn("building", "Active Mission", building)}
      ${renderColumn("completed", "Destination", completed)}
    </div>
  `);
});

/**
 * Render a single Kanban column
 */
function renderColumn(stage: string, title: string, streams: ReturnType<typeof getStreams>): string {
  const count = streams.length;

  if (count === 0) {
    return `
      <div class="kanban-column" data-stage="${stage}">
        <div class="kanban-column-header">
          <div class="kanban-column-title">${title}</div>
          <div class="kanban-column-count">0</div>
        </div>
        <div class="kanban-empty-state">
          <svg class="kanban-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="10" stroke-width="2"/>
            <path d="M12 6v6l4 2" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <div>No rovers at this stage</div>
        </div>
      </div>
    `;
  }

  const cards = streams.map((stream) => renderCard(stream)).join("\n");

  return `
    <div class="kanban-column" data-stage="${stage}">
      <div class="kanban-column-header">
        <div class="kanban-column-title">${title}</div>
        <div class="kanban-column-count">${count}</div>
      </div>
      <div class="kanban-cards">
        ${cards}
      </div>
    </div>
  `;
}

/**
 * Render a single PRD card
 */
function renderCard(stream: ReturnType<typeof getStreams>[0]): string {
  const completionPct =
    stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

  // Determine progress tier for color
  let tier = "low";
  if (completionPct >= 67) {
    tier = "high";
  } else if (completionPct >= 34) {
    tier = "medium";
  }

  // Extract PRD title from name (fallback to name if no title)
  const title = stream.name || `PRD-${stream.id}`;

  // Check if this is an active build
  const isRunning = stream.status === "running";
  const roverClass = isRunning ? "spinning" : "";

  // Calculate elapsed time for running builds
  let elapsedTimeBadge = "";
  if (isRunning && stream.startedAt) {
    const elapsed = formatElapsedTime(stream.startedAt);
    elapsedTimeBadge = `<span class="elapsed-time-badge">⏱ ${elapsed}</span>`;
  }

  // Build hover overlay content
  let overlayContent = "";
  if (isRunning) {
    overlayContent = `
      <div class="kanban-card-overlay">
        <div class="kanban-card-overlay-text">
          <strong>Status:</strong> Active build in progress
        </div>
        <div class="kanban-card-overlay-text">
          <strong>Progress:</strong> ${completionPct}% complete (${stream.completedStories}/${stream.totalStories} stories)
        </div>
      </div>
    `;
  } else if (completionPct > 0 && completionPct < 100) {
    overlayContent = `
      <div class="kanban-card-overlay">
        <div class="kanban-card-overlay-text">
          <strong>Status:</strong> Paused
        </div>
        <div class="kanban-card-overlay-text">
          <strong>Progress:</strong> ${completionPct}% complete (${stream.completedStories}/${stream.totalStories} stories)
        </div>
      </div>
    `;
  }

  return `
    <a
      href="/streams.html?prd=${stream.id}"
      class="kanban-card"
      data-status="${stream.status}"
      role="link"
      aria-label="View details for PRD-${stream.id}: ${title}"
    >
      <div class="kanban-card-prd-name">PRD-${stream.id}</div>
      <img src="/ralph-logo-bw.png" alt="Rover" class="kanban-card-rover-icon ${roverClass}" />
      <div class="kanban-card-title">${title}</div>
      <div class="kanban-card-progress">
        <div class="progress-bar-container">
          <div
            class="progress-bar-fill"
            data-tier="${tier}"
            style="width: ${completionPct}%"
          ></div>
        </div>
      </div>
      <div class="kanban-card-stats">
        ${stream.completedStories}/${stream.totalStories} stories
        ${elapsedTimeBadge}
      </div>
      ${overlayContent}
    </a>
  `;
}

export { board };
