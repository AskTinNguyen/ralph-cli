/**
 * Dashboard Partials Routes
 *
 * HTML partial endpoints for dashboard UI components.
 * Returns HTML fragments for alerts, summary cards, and streams grid.
 */

import { Hono } from "hono";
import { getTokenSummary, getStreamTokens, getBudgetStatus } from "../../../services/token-reader.js";
import { getStreams } from "../../../services/state-reader.js";
import { getSuccessRateTrends, getWeekOverWeek } from "../../../services/trends.js";
import { getCriticalAlerts } from "../../../services/alerts-reader.js";
import { escapeHtml } from "../../utils/html-helpers.js";
import { formatCurrency } from "../../utils/formatters.js";

const dashboardPartials = new Hono();

/**
 * GET /critical-alerts
 *
 * Returns HTML fragment for critical alerts banner (budget, stalled, failures, checkpoints).
 * Shows at top of dashboard when issues require attention.
 */
dashboardPartials.get("/critical-alerts", (c) => {
  const alerts = getCriticalAlerts();

  if (alerts.length === 0) {
    return c.html("");
  }

  const alertItems = alerts
    .map((alert: { type: string; message: string; action?: string }) => {
      let icon: string;
      switch (alert.type) {
        case "budget":
          icon = "\uD83D\uDCB0";
          break;
        case "stalled":
          icon = "\u23F8\uFE0F";
          break;
        case "failures":
          icon = "\u274C";
          break;
        default:
          icon = "\u26A0\uFE0F";
      }

      return `
      <div class="critical-alert-item ${alert.type}">
        <div class="critical-alert-icon">${icon}</div>
        <div class="critical-alert-content">
          <div class="critical-alert-message">${escapeHtml(alert.message)}</div>
          ${alert.action ? `<p class="critical-alert-action">${escapeHtml(alert.action)}</p>` : ""}
        </div>
      </div>
    `;
    })
    .join("");

  return c.html(`
    <div class="critical-alerts-banner">
      ${alertItems}
    </div>
  `);
});

/**
 * GET /cost-summary-card
 *
 * Returns HTML fragment for the total cost metric card.
 * Shows aggregate cost across all streams with budget progress.
 */
dashboardPartials.get("/cost-summary-card", (c) => {
  const summary = getTokenSummary();
  const budget = getBudgetStatus();

  // Determine budget status
  const budgetPercentage = budget.daily.hasLimit ? budget.daily.percentage : 0;

  let progressClass: string;
  if (budgetPercentage >= 100) {
    progressClass = "budget-critical";
  } else if (budgetPercentage >= 90) {
    progressClass = "budget-warning";
  } else {
    progressClass = "budget-ok";
  }

  const budgetText = budget.daily.hasLimit
    ? `${budgetPercentage}% of daily budget`
    : "No daily budget set";

  return c.html(`
    <div class="rams-card">
      <div class="metric-summary-label">Total Cost Today</div>
      <div class="metric-summary-value">${formatCurrency(budget.daily.spent)}</div>
      ${
        budget.daily.hasLimit
          ? `
        <div class="metric-summary-progress">
          <div class="metric-summary-progress-bar ${progressClass}" style="width: ${Math.min(budgetPercentage, 100)}%"></div>
        </div>
      `
          : ""
      }
      <div class="metric-summary-subtext">${budgetText}</div>
      <div class="metric-summary-subtext" style="margin-top: 4px;">
        ${summary.byStream.reduce((sum, s) => sum + s.runCount, 0)} runs across ${summary.byStream.length} PRDs
      </div>
    </div>
  `);
});

/**
 * GET /success-rate-card
 *
 * Returns HTML fragment for the success rate metric card.
 * Shows 7-day success rate with delta from previous period.
 */
dashboardPartials.get("/success-rate-card", (c) => {
  const trends = getSuccessRateTrends("7d");
  const weekOverWeek = getWeekOverWeek();

  const successRate = trends.overallSuccessRate?.toFixed(1) || "0.0";
  const delta = weekOverWeek.delta || 0;

  let deltaClass = "";
  let deltaText = "\u2014";
  if (delta > 0) {
    deltaClass = "positive";
    deltaText = `\u25B2 +${delta.toFixed(1)}%`;
  } else if (delta < 0) {
    deltaClass = "negative";
    deltaText = `\u25BC ${delta.toFixed(1)}%`;
  }

  return c.html(`
    <div class="rams-card">
      <div class="metric-summary-label">Success Rate (7d)</div>
      <div class="metric-summary-value">
        ${successRate}%
        ${delta !== 0 ? `<span class="metric-summary-delta ${deltaClass}">${deltaText} from last week</span>` : ""}
      </div>
      <div class="metric-summary-subtext">
        ${trends.totalPassed || 0} passed / ${trends.totalRuns || 0} total
      </div>
    </div>
  `);
});

/**
 * GET /active-streams-card
 *
 * Returns HTML fragment for the active streams metric card.
 * Shows count of running streams with status breakdown.
 */
dashboardPartials.get("/active-streams-card", (c) => {
  const streams = getStreams();

  const runningCount = streams.filter((s) => s.status === "running").length;
  const readyCount = streams.filter((s) => s.status === "ready" || s.status === "in_progress")
    .length;
  const completedCount = streams.filter((s) => s.status === "completed" || s.status === "merged")
    .length;

  const runningBadges = streams
    .filter((s) => s.status === "running")
    .slice(0, 5)
    .map((s) => `<span class="rams-badge rams-badge-success">PRD-${s.id}</span>`)
    .join("");

  return c.html(`
    <div class="rams-card">
      <div class="metric-summary-label">Active Streams</div>
      <div class="metric-summary-value">${runningCount} running</div>
      <div class="metric-summary-subtext">
        ${readyCount} ready, ${completedCount} completed
      </div>
      ${
        runningBadges
          ? `
        <div style="margin-top: var(--rams-space-3); display: flex; gap: var(--rams-space-2); flex-wrap: wrap;">
          ${runningBadges}
        </div>
      `
          : ""
      }
    </div>
  `);
});

/**
 * GET /streams-grid
 *
 * Returns HTML fragment for the streams grid with inline metrics.
 * Shows all streams as expandable cards with quick actions.
 */
dashboardPartials.get("/streams-grid", (c) => {
  const filterParam = c.req.query("filter");
  let streams = getStreams();

  // Apply filter
  if (filterParam === "running") {
    streams = streams.filter((s) => s.status === "running");
  } else if (filterParam === "ready") {
    streams = streams.filter((s) => s.status === "ready" || s.status === "in_progress");
  } else if (filterParam === "completed") {
    streams = streams.filter((s) => s.status === "completed" || s.status === "merged");
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
      const successfulRuns = stream.runs?.filter((r) => r.status === "completed").length || 0;
      const totalRuns = stream.runs?.length || runCount;
      const successRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 100) : 0;

      const progress =
        stream.totalStories > 0
          ? Math.round((stream.completedStories / stream.totalStories) * 100)
          : 0;

      let statusBadge: string;
      switch (stream.status) {
        case "running":
          statusBadge =
            '<span class="rams-badge rams-badge-success stream-item-active">\uD83D\uDD04 RUNNING</span>';
          break;
        case "completed":
          statusBadge = '<span class="rams-badge rams-badge-info">\u2705 DONE</span>';
          break;
        case "merged":
          statusBadge = '<span class="rams-badge rams-badge-info">\u2705 MERGED</span>';
          break;
        case "ready":
          statusBadge = '<span class="rams-badge">\uD83D\uDCCB READY</span>';
          break;
        default:
          statusBadge = '<span class="rams-badge rams-badge-muted">\u23F8\uFE0F IDLE</span>';
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
            \uD83D\uDCCA Details
          </a>
          ${
            stream.status !== "running" && stream.status !== "completed" && stream.status !== "merged"
              ? `
            <button
              class="stream-card-action-btn primary"
              hx-post="/api/stream/${stream.id}/build"
              hx-vals='{"iterations": 5}'
              hx-swap="none"
            >
              \uD83D\uDD28 Build
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

export { dashboardPartials };
