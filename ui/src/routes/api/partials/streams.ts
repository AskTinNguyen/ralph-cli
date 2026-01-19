/**
 * Stream Partials Routes
 *
 * HTML partial endpoints for stream-related UI components.
 * Returns HTML fragments for HTMX partial updates.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import type { Stream } from "../../../types.js";
import {
  getStreams,
  getStreamDetails,
  getRalphRoot,
} from "../../../services/state-reader.js";
import { getStreamTokens } from "../../../services/token-reader.js";
import { listRunLogs, getRunSummary } from "../../../services/log-parser.js";
import { wizardProcessManager } from "../../../services/wizard-process-manager.js";
import { escapeHtml } from "../../utils/html-helpers.js";
import { formatCurrency } from "../../utils/formatters.js";

const streamPartials = new Hono();

/**
 * GET /streams-summary
 *
 * Returns HTML fragment for the streams summary section showing aggregate stats.
 */
streamPartials.get("/streams-summary", (c) => {
  const streams = getStreams();

  const totalStreams = streams.length;
  const runningStreams = streams.filter((s) => s.status === "running").length;
  const completedStreams = streams.filter((s) => s.status === "completed").length;

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
 * Helper to format status for display
 */
function formatStatus(status: string): string {
  const statusMap: Record<string, string> = {
    idle: "Idle",
    running: "Running",
    merged: "Merged",
    completed: "Completed",
    in_progress: "In Progress",
    ready: "Ready",
    error: "Error",
    no_prd: "No PRD",
    no_stories: "No Stories",
    not_found: "Not Found",
  };
  return (
    statusMap[status] ||
    status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " ")
  );
}

/**
 * Helper to check if a stream has a worktree initialized
 */
function hasWorktree(ralphRoot: string | null, streamId: string): boolean {
  if (!ralphRoot) return false;
  const worktreesPath = path.join(ralphRoot, "worktrees");
  const worktreePath = path.join(worktreesPath, `PRD-${streamId}`);
  return fs.existsSync(worktreePath);
}

/**
 * GET /streams
 *
 * Returns HTML fragment for the streams list grid.
 */
streamPartials.get("/streams", (c) => {
  const showClosed = c.req.query("showClosed") === "true";
  let streams = getStreams();

  // Filter out closed streams unless showClosed=true
  if (!showClosed) {
    streams = streams.filter((s) => !s.closed);
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

  // Categorize streams into 4 groups:
  // 1. In Progress = actively running
  // 2. Completed = merged or completed status
  // 3. Idle = has some progress but paused (not running, not completed)
  // 4. Not Started = no progress yet (0 stories completed, not completed/merged)
  const inProgressStreams = streams.filter((s) => s.status === "running");
  const completedStreams = streams.filter(
    (s) => s.status === "completed" || s.merged
  );
  const idleStreams = streams.filter(
    (s) =>
      s.status !== "running" &&
      s.status !== "completed" &&
      !s.merged &&
      s.completedStories > 0
  );
  const notStartedStreams = streams.filter(
    (s) =>
      s.status !== "running" &&
      s.status !== "completed" &&
      !s.merged &&
      s.completedStories === 0
  );

  // Helper to render a stream card
  function renderStreamCard(stream: Stream): string {
    const completionPercentage =
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0;

    const statusLabel = formatStatus(stream.status);
    const worktreeInitialized = hasWorktree(ralphRoot, stream.id);
    const isCompleted = stream.status === "completed";
    const isRunning = stream.status === "running";
    const isMerged = stream.merged;
    const isFullyComplete =
      stream.totalStories > 0 &&
      stream.completedStories === stream.totalStories;

    // Determine if this stream should be visually muted (finished states)
    const isFinishedState = isMerged || (isCompleted && !worktreeInitialized);

    // Build action buttons based on stream state
    let actionButtonsHtml = "";
    let menuItemsHtml = "";

    const escapedName = escapeHtml(stream.name)
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;");

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
        const buildDisabled =
          !stream.hasPlan ||
          isMerged ||
          (isCompleted && !worktreeInitialized) ||
          !worktreeInitialized ||
          isFullyComplete;
        const buildTitle = !stream.hasPlan
          ? "Generate plan first (use menu)"
          : isMerged
            ? "Already merged to main"
            : isCompleted && !worktreeInitialized
              ? "Already completed"
              : isFullyComplete
                ? "All stories completed"
                : !worktreeInitialized
                  ? "Initialize worktree first (use menu)"
                  : "Start build iterations";
        actionButtonsHtml += `
          <button class="rams-btn rams-btn-primary" onclick="toggleBuildForm('${stream.id}', event)" title="${buildTitle}" ${buildDisabled ? "disabled" : ""}>
            Build
          </button>`;

        // Merge button logic:
        // - Only show when worktree exists and not running
        // - Disabled only if: already merged OR no progress at all
        // - Shows warning for partial completion but allows merge
        if (worktreeInitialized) {
          const hasAnyProgress =
            stream.completedStories > 0 || stream.hasProgress;
          const mergeDisabled = isMerged || !hasAnyProgress;
          const mergeTitle = isMerged
            ? "Already merged to main"
            : !hasAnyProgress
              ? "No progress to merge yet"
              : !isFullyComplete
                ? `Merge ${stream.completedStories}/${stream.totalStories} stories to main`
                : "Merge to main branch";
          const mergeClass = isFullyComplete
            ? "rams-btn-success"
            : "rams-btn-warning";
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
          View Estimate
        </button>`;
    }

    // View PRD (always available if PRD exists)
    if (stream.hasPrd) {
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); window.open('/editor.html?file=.ralph/PRD-${stream.id}/prd.md', '_blank');">
          View PRD
        </button>`;
    }

    // View Plan (if plan exists)
    if (stream.hasPlan) {
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); window.open('/editor.html?file=.ralph/PRD-${stream.id}/plan.md', '_blank');">
          View Plan
        </button>`;
    }

    // Generate Plan (if plan doesn't exist)
    if (
      !stream.hasPlan &&
      stream.hasPrd &&
      !wizardProcessManager.isGenerating(stream.id)
    ) {
      const planDisabled = isMerged || isCompleted;
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); triggerPlanGeneration('${stream.id}', event);"
                ${planDisabled ? "disabled" : ""}>
          Generate Plan
        </button>`;
    }

    // Init Worktree (if not initialized)
    if (!worktreeInitialized && !isRunning) {
      const initDisabled = isMerged || isCompleted;
      menuItemsHtml += `
        <button class="threedots-menu-item"
                onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}'); initStream('${stream.id}', event);"
                ${initDisabled ? "disabled" : ""}>
          Init Worktree
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
          Close Stream
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
    let badgeClass: string;
    if (stream.status === "running") {
      badgeClass = "rams-badge-running";
    } else if (stream.status === "completed") {
      badgeClass = "rams-badge-success";
    } else if (stream.status === "idle") {
      badgeClass = "rams-badge-idle";
    } else {
      badgeClass = "rams-badge-pending";
    }

    // Card styling - muted for finished states
    const cardStyle = isFinishedState
      ? "cursor: pointer; margin-bottom: var(--rams-space-4); opacity: 0.6; filter: grayscale(30%);"
      : "cursor: pointer; margin-bottom: var(--rams-space-4);";

    // PRD/Plan readiness badges
    const prdBadgeLabel = stream.hasPrd ? "Ready PRD" : "Missing PRD";
    const planBadgeLabel = stream.hasPlan ? "Ready Plan" : "Not Ready Plan";

    // Determine if editing should be allowed (Not Started = no completed stories and not running/completed/merged)
    const isNotStarted =
      !isRunning && !isCompleted && !isMerged && stream.completedStories === 0;
    const editableParam = isNotStarted ? "" : "&readonly=true";

    // Clickable badge styles
    const clickableBadgeStyle = "cursor: pointer; transition: opacity 0.2s;";
    const clickableBadgeHover =
      'onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1"';

    return `
<div class="rams-card" style="${cardStyle} position: relative;" onclick="showStreamDetail('${stream.id}', '${escapeHtml(stream.name).replace(/'/g, "\\'")}')">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
    <span class="rams-label">PRD-${stream.id}</span>
    <div style="display: flex; gap: var(--rams-space-2);">
      <span class="rams-badge ${badgeClass}"><span class="rams-badge-dot"></span>${statusLabel}</span>
      ${isMerged ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Merged</span>' : ""}
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
    ${
      stream.hasPrd
        ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=prd${editableParam}';" title="View PRD${isNotStarted ? " (editable)" : ""}"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
        : `<span class="rams-badge rams-badge-muted"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
    }
    ${
      stream.hasPlan
        ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=plan${editableParam}';" title="View Plan${isNotStarted ? " (editable)" : ""}"><span class="rams-badge-dot"></span>${planBadgeLabel}</span>`
        : `<span class="rams-badge rams-badge-needs-plan" ${stream.hasPrd ? `onclick="event.stopPropagation(); triggerPlanGeneration('${stream.id}', event);" title="Click to generate plan"` : ""}><span class="rams-badge-dot"></span> ${planBadgeLabel}</span>`
    }
    ${worktreeInitialized ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Worktree</span>' : ""}
  </div>
  <div class="stream-actions-wrapper" style="display: flex; gap: var(--rams-space-2); flex-wrap: wrap;">
    ${actionButtonsHtml}
    ${
      menuItemsHtml
        ? `
    <div class="threedots-menu-container">
      <button class="threedots-btn" onclick="event.stopPropagation(); toggleThreeDotsMenu('${stream.id}');" title="More actions">
        :
      </button>
      <div class="threedots-menu" id="threedots-menu-${stream.id}">
        ${menuItemsHtml}
      </div>
    </div>
    `
        : ""
    }
  </div>
  ${buildFormHtml}
</div>
`;
  }

  // Build sections HTML
  const inProgressSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">In Progress</h3>
    <span class="rams-badge rams-badge-running">${inProgressStreams.length}</span>
  </div>
  ${
    inProgressStreams.length > 0
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
  ${
    idleStreams.length > 0
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
  ${
    notStartedStreams.length > 0
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
  ${
    completedStreams.length > 0
      ? `<div class="rams-card-grid" style="grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));">${completedStreams.map(renderStreamCard).join("")}</div>`
      : '<div class="rams-text-muted" style="padding: var(--rams-space-4); text-align: center;">No completed PRDs yet.</div>'
  }
</div>`;

  return c.html(
    `${inProgressSection}${idleSection}${notStartedSection}${completedSection}`
  );
});

/**
 * GET /streams-progress
 *
 * Returns HTML fragment for the progress-focused view.
 * Separates streams into In Progress (running) and Idle (not running) categories.
 */
streamPartials.get("/streams-progress", (c) => {
  const showClosed = c.req.query("showClosed") === "true";
  let streams = getStreams();

  // Filter out closed streams unless showClosed=true
  if (!showClosed) {
    streams = streams.filter((s) => !s.closed);
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

  // Categorize streams into 4 groups:
  // 1. In Progress = actively running
  // 2. Completed = merged or completed status
  // 3. Idle = has some progress but paused (not running, not completed)
  // 4. Not Started = no progress yet (0 stories completed, not completed/merged)
  const inProgressStreams = streams.filter((s) => s.status === "running");
  const completedStreams = streams.filter(
    (s) => s.status === "completed" || s.merged
  );
  const idleStreams = streams.filter(
    (s) =>
      s.status !== "running" &&
      s.status !== "completed" &&
      !s.merged &&
      s.completedStories > 0
  );
  const notStartedStreams = streams.filter(
    (s) =>
      s.status !== "running" &&
      s.status !== "completed" &&
      !s.merged &&
      s.completedStories === 0
  );

  // Helper function to render stream item
  function renderStreamItem(stream: Stream, isInProgress: boolean): string {
    // Fetch full stream details to get stories
    const streamDetails = getStreamDetails(stream.id);
    const stories = streamDetails?.stories || [];

    const percentage =
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0;

    const statusLabel =
      stream.status.charAt(0).toUpperCase() +
      stream.status.slice(1).replace(/_/g, " ");
    let badgeClass: string;
    if (stream.status === "running") {
      badgeClass = "rams-badge-running";
    } else if (stream.status === "completed") {
      badgeClass = "rams-badge-success";
    } else if (stream.status === "in_progress") {
      badgeClass = "rams-badge-in-progress";
    } else if (stream.status === "idle") {
      badgeClass = "rams-badge-idle";
    } else {
      badgeClass = "rams-badge-pending";
    }

    const itemClass = isInProgress ? "stream-item-active" : "stream-item-idle";
    const escapedName = escapeHtml(stream.name)
      .replace(/'/g, "\\'")
      .replace(/"/g, "&quot;");

    const worktreeInitialized = hasWorktree(ralphRoot, stream.id);
    const isCompleted = stream.status === "completed";
    const isRunning = stream.status === "running";
    const isMerged = stream.merged;
    const isFullyComplete =
      stream.totalStories > 0 &&
      stream.completedStories === stream.totalStories;

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
              View Details
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
          const planTitle = planDisabled
            ? "Cannot generate plan for completed PRD"
            : "Generate implementation plan from PRD";
          actionButtonsHtml += `
            <button class="rams-btn rams-btn-primary" onclick="triggerPlanGeneration('${stream.id}', event)" title="${planTitle}" ${planDisabled ? "disabled" : ""}>
              Plan
            </button>`;
        }
      }

      // Show Init/Build buttons for non-running streams
      if (!worktreeInitialized) {
        const initDisabled = isMerged || isCompleted;
        const initTitle = isMerged
          ? "Already merged to main"
          : isCompleted
            ? "Already completed"
            : "Initialize git worktree for parallel building";
        actionButtonsHtml += `
          <button class="rams-btn rams-btn-secondary" onclick="initStream('${stream.id}', event)" title="${initTitle}" ${initDisabled ? "disabled" : ""}>
            Init
          </button>`;
      }

      const buildDisabled =
        !stream.hasPlan ||
        isMerged ||
        (isCompleted && !worktreeInitialized) ||
        !worktreeInitialized ||
        isFullyComplete;
      const buildTitle = !stream.hasPlan
        ? "Generate plan first (click Plan button)"
        : isMerged
          ? "Already merged to main"
          : isCompleted && !worktreeInitialized
            ? "Already completed"
            : isFullyComplete
              ? "All stories completed"
              : !worktreeInitialized
                ? "Initialize worktree first (click Init)"
                : "Start build iterations";
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
      const mergeTitle = isMerged
        ? "Already merged to main"
        : !hasAnyProgress
          ? "No progress to merge yet"
          : !isFullyComplete
            ? `Merge ${stream.completedStories}/${stream.totalStories} stories to main`
            : "Merge to main branch";
      const mergeClass = isFullyComplete
        ? "rams-btn-success"
        : "rams-btn-warning";
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
    const isNotStarted =
      !isRunning && !isCompleted && !isMerged && stream.completedStories === 0;
    const editableParam = isNotStarted ? "" : "&readonly=true";

    // Clickable badge styles
    const clickableBadgeStyle = "cursor: pointer; transition: opacity 0.2s;";
    const clickableBadgeHover =
      'onmouseover="this.style.opacity=0.8" onmouseout="this.style.opacity=1"';

    // Show close button for 0% streams (not started)
    const showCloseButton =
      percentage === 0 && !isRunning && !isMerged && !isCompleted;
    const closeButtonHtml = showCloseButton
      ? `
      <button class="rams-btn rams-btn-danger rams-btn-sm"
              onclick="closeStream('${stream.id}', event)"
              style="margin-left: var(--rams-space-2); padding: 4px 8px; font-size: 12px;"
              title="Close this PRD (hide from list)">
        x
      </button>
    `
      : "";

    // Render stories section
    const storiesHtml =
      stories.length > 0
        ? stories
            .map((story) => {
              const criteriaTotal = story.acceptanceCriteria.length;
              const criteriaCompleted = story.acceptanceCriteria.filter(
                (acItem) => acItem.completed
              ).length;
              const storyPercentage =
                criteriaTotal > 0
                  ? Math.round((criteriaCompleted / criteriaTotal) * 100)
                  : 0;

              let storyStatusLabel: string;
              if (story.status === "completed") {
                storyStatusLabel = "Completed";
              } else if (story.status === "in-progress") {
                storyStatusLabel = "In Progress";
              } else {
                storyStatusLabel = "Pending";
              }
              let storyStatusIcon: string;
              if (story.status === "completed") {
                storyStatusIcon = "check";
              } else if (story.status === "in-progress") {
                storyStatusIcon = "hourglass";
              } else {
                storyStatusIcon = "circle";
              }

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
            })
            .join("")
        : '<div class="rams-text-muted" style="padding: var(--rams-space-3); text-align: center;">No stories defined</div>';

    // Wrap in <details> for expandable behavior
    return `
      <details class="stream-item-expandable ${itemClass}" ${isInProgress ? "open" : ""}>
        <summary class="stream-item-header" onclick="event.stopPropagation();">
          <span class="expand-chevron">></span>
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
              ${isMerged ? '<span class="rams-badge rams-badge-info" style="display: block; margin-top: var(--rams-space-1);"><span class="rams-badge-dot"></span>Merged</span>' : ""}
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
            ${
              stream.hasPrd
                ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=prd${editableParam}';" title="View PRD${isNotStarted ? " (editable)" : ""}"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
                : `<span class="rams-badge rams-badge-muted"><span class="rams-badge-dot"></span>${prdBadgeLabel}</span>`
            }
            ${
              stream.hasPlan
                ? `<span class="rams-badge rams-badge-success" style="${clickableBadgeStyle}" ${clickableBadgeHover} onclick="event.stopPropagation(); window.location.href='/editor.html?prd=${stream.id}&file=plan${editableParam}';" title="View Plan${isNotStarted ? " (editable)" : ""}"><span class="rams-badge-dot"></span>${planBadgeLabel}</span>`
                : `<span class="rams-badge rams-badge-needs-plan" ${stream.hasPrd ? `onclick="event.stopPropagation(); triggerPlanGeneration('${stream.id}', event);" title="Click to generate plan"` : ""}><span class="rams-badge-dot"></span> ${planBadgeLabel}</span>`
            }
            ${worktreeInitialized ? '<span class="rams-badge rams-badge-info"><span class="rams-badge-dot"></span>Worktree</span>' : ""}
          </div>
          <div class="stories-list">
            ${storiesHtml}
          </div>
        </div>
      </details>
    `;
  }

  // Build In Progress section
  const inProgressSection = `
<div style="margin-bottom: var(--rams-space-6);">
  <div style="display: flex; align-items: center; gap: var(--rams-space-3); margin-bottom: var(--rams-space-4);">
    <h3 class="rams-h3" style="margin: 0;">In Progress</h3>
    <span class="rams-badge rams-badge-running">${inProgressStreams.length}</span>
  </div>
  ${
    inProgressStreams.length > 0
      ? inProgressStreams.map((s) => renderStreamItem(s, true)).join("")
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
  ${
    idleStreams.length > 0
      ? idleStreams.map((s) => renderStreamItem(s, false)).join("")
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
  ${
    notStartedStreams.length > 0
      ? notStartedStreams.map((s) => renderStreamItem(s, false)).join("")
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
  ${
    completedStreams.length > 0
      ? completedStreams.map((s) => renderStreamItem(s, false)).join("")
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
 * GET /streams-timeline
 *
 * Returns HTML fragment for the streams timeline view.
 * Shows streams as horizontal progress bars with timing information.
 */
streamPartials.get("/streams-timeline", (c) => {
  const streams = getStreams();

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
  const globalTimeSpan =
    globalMinTime && globalMaxTime
      ? globalMaxTime.getTime() - globalMinTime.getTime()
      : 0;

  // Format duration helper
  function formatDurationMs(ms: number): string {
    if (ms < 1000) return "< 1s";
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
  }

  // Format time helper
  function formatTime(date: Date): string {
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }

  // Format date helper
  function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  }

  // Build timeline rows
  const timelineRows = streamTimings
    .map((stream) => {
      const statusLabel = formatStatus(stream.status);

      // Calculate position and width based on time
      let leftPercent = 0;
      let widthPercent = 100;

      if (
        globalTimeSpan > 0 &&
        stream.firstRunStart &&
        stream.lastRunEnd &&
        globalMinTime
      ) {
        const startOffset =
          stream.firstRunStart.getTime() - globalMinTime.getTime();
        const duration =
          stream.lastRunEnd.getTime() - stream.firstRunStart.getTime();
        leftPercent = (startOffset / globalTimeSpan) * 100;
        widthPercent = Math.max((duration / globalTimeSpan) * 100, 2); // Minimum 2% width
      }

      // Time info
      const timeInfo =
        stream.firstRunStart && stream.lastRunEnd
          ? `${formatDate(stream.firstRunStart)} ${formatTime(stream.firstRunStart)} - ${formatTime(stream.lastRunEnd)}`
          : "Not started";

      const durationInfo =
        stream.totalDurationMs > 0
          ? formatDurationMs(stream.totalDurationMs)
          : "-";

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
    .join("");

  // Time axis labels
  const timeAxisHtml =
    globalMinTime && globalMaxTime
      ? `
<div class="timeline-axis">
  <span class="timeline-axis-start">${formatDate(globalMinTime)} ${formatTime(globalMinTime)}</span>
  <span class="timeline-axis-end">${formatDate(globalMaxTime)} ${formatTime(globalMaxTime)}</span>
</div>`
      : "";

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
 * GET /stream-detail
 *
 * Returns HTML fragment for a specific stream's detail view.
 * Query params:
 *   - id: Stream ID
 */
streamPartials.get("/stream-detail", (c) => {
  const id = c.req.query("id");

  if (!id) {
    return c.html(
      `<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No stream ID provided</p></div>`
    );
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
    stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

  // Format status for human-friendly display
  const statusLabel = formatStatus(stream.status);

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

            let runStatusClass: string;
            if (run.status === "completed") {
              runStatusClass = "rams-badge-success";
            } else if (run.status === "failed") {
              runStatusClass = "rams-badge-error";
            } else {
              runStatusClass = "rams-badge-warning";
            }
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
  document.querySelectorAll('.stream-tab-content').forEach(cEl => cEl.classList.remove('active'));
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
 * GET /streams-grid
 *
 * Returns HTML fragment for the streams grid with inline metrics.
 * Shows all streams as expandable cards with quick actions.
 */
streamPartials.get("/streams-grid", (c) => {
  const filterParam = c.req.query("filter");
  let streams = getStreams();

  // Apply filter
  if (filterParam === "running") {
    streams = streams.filter((s) => s.status === "running");
  } else if (filterParam === "ready") {
    streams = streams.filter(
      (s) => s.status === "ready" || s.status === "in_progress"
    );
  } else if (filterParam === "completed") {
    streams = streams.filter(
      (s) => s.status === "completed" || s.status === "merged"
    );
  }

  if (streams.length === 0) {
    return c.html(`
      <div class="rams-card" style="text-align: center; padding: var(--rams-space-8);">
        <p class="rams-text-muted">No streams found.</p>
      </div>
    `);
  }

  const streamCards = streams
    .map((stream) => {
      const streamTokens = getStreamTokens(stream.id);
      const cost = streamTokens?.totalCost || 0;
      const runCount = streamTokens?.runCount || 0;

      // Calculate success rate from runs
      const successfulRuns =
        stream.runs?.filter((r) => r.status === "completed").length || 0;
      const totalRuns = stream.runs?.length || runCount;
      const successRate =
        totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;

      const progress =
        stream.totalStories > 0
          ? Math.round((stream.completedStories / stream.totalStories) * 100)
          : 0;

      let statusBadge: string;
      if (stream.status === "running") {
        statusBadge =
          '<span class="rams-badge rams-badge-success stream-item-active">RUNNING</span>';
      } else if (stream.status === "completed") {
        statusBadge = '<span class="rams-badge rams-badge-info">DONE</span>';
      } else if (stream.status === "merged") {
        statusBadge = '<span class="rams-badge rams-badge-info">MERGED</span>';
      } else if (stream.status === "ready") {
        statusBadge = '<span class="rams-badge">READY</span>';
      } else {
        statusBadge = '<span class="rams-badge rams-badge-muted">IDLE</span>';
      }

      return `
      <div class="rams-card ${stream.status === "running" ? "stream-item-active" : ""}">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: var(--rams-space-3);">
          <h3 class="rams-h3" style="margin: 0;">PRD-${stream.id}: ${escapeHtml(stream.name)}</h3>
          ${statusBadge}
        </div>

        ${
          progress > 0
            ? `
          <div class="rams-progress" style="margin-bottom: var(--rams-space-3);">
            <div class="rams-progress-bar" style="width: ${progress}%"></div>
          </div>
        `
            : ""
        }

        <div class="stream-card-inline-metrics">
          <div class="stream-metric-item">
            <span class="stream-metric-label">Stories:</span>
            <span class="stream-metric-value">${stream.completedStories}/${stream.totalStories}</span>
          </div>
          <div class="stream-metric-item">
            <span class="stream-metric-label">Cost:</span>
            <span class="stream-metric-value cost">${formatCurrency(cost)}</span>
          </div>
          ${
            totalRuns > 0
              ? `
            <div class="stream-metric-item">
              <span class="stream-metric-label">Success:</span>
              <span class="stream-metric-value success">${successRate}%</span>
            </div>
          `
              : ""
          }
        </div>

        <div class="stream-card-actions">
          <a href="/streams.html?stream=${stream.id}" class="stream-card-action-btn">
            Details
          </a>
          ${
            stream.status !== "running" &&
            stream.status !== "completed" &&
            stream.status !== "merged"
              ? `
            <button
              class="stream-card-action-btn primary"
              hx-post="/api/stream/${stream.id}/build"
              hx-vals='{"iterations": 5}'
              hx-swap="none"
            >
              Build
            </button>
          `
              : ""
          }
        </div>
      </div>
    `;
    })
    .join("");

  return c.html(`
    <div class="dashboard-streams-grid">
      ${streamCards}
    </div>
  `);
});

export { streamPartials };
