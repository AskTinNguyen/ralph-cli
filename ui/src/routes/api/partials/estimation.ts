/**
 * Estimation Partials Routes
 *
 * HTML partial endpoints for estimation UI components.
 * Returns HTML fragments for estimate summary, breakdown, comparison, history, accuracy, and rollback stats.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getRalphRoot, getStreams } from "../../../services/state-reader.js";
import { getStreamEstimate } from "../../../services/estimate-reader.js";
import { escapeHtml } from "../../utils/html-helpers.js";
import { formatDuration, formatTokens, formatCost } from "../../utils/formatters.js";

// Import CommonJS accuracy and estimate modules
const require = createRequire(import.meta.url);
const { generateAccuracyReport, loadEstimates } = require("../../../../../lib/estimate/accuracy.js");
const { getRollbackAnalytics } = require("../../../../../lib/estimate/metrics.js");

const estimationPartials = new Hono();

/**
 * GET /estimate-summary
 *
 * Returns HTML card showing estimate totals (duration range, tokens range, cost range, confidence).
 * Query params:
 *   - id: Stream/PRD ID
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 */
estimationPartials.get("/estimate-summary", (c) => {
  const id = c.req.query("id");
  const model = (c.req.query("model") || "sonnet") as "sonnet" | "opus";

  if (!id) {
    return c.html(
      '<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>'
    );
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
  const confidenceClass =
    totals.confidence === "high"
      ? "confidence-high"
      : totals.confidence === "medium"
        ? "confidence-medium"
        : "confidence-low";
  const confidenceDots =
    totals.confidence === "high" ? "●●●" : totals.confidence === "medium" ? "●●○" : "●○○";

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
        <option value="sonnet" ${model === "sonnet" ? "selected" : ""}>Sonnet</option>
        <option value="opus" ${model === "opus" ? "selected" : ""}>Opus</option>
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
    ${result.cached ? `<span class="estimate-cached" title="Cached at ${result.cachedAt}">&#128274; Cached</span>` : ""}
  </div>

  <div class="estimate-loading htmx-indicator">Calculating...</div>
</div>
`;

  return c.html(html);
});

/**
 * GET /estimate-breakdown
 *
 * Returns HTML table with story-by-story estimate breakdown.
 * Query params:
 *   - id: Stream/PRD ID
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 */
estimationPartials.get("/estimate-breakdown", (c) => {
  const id = c.req.query("id");
  const model = (c.req.query("model") || "sonnet") as "sonnet" | "opus";

  if (!id) {
    return c.html(
      '<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>'
    );
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

  const rowsHtml = estimates
    .map((est: {
      completed: boolean;
      complexity: number;
      complexityLevel: string;
      confidence: string;
      usedHistory: boolean;
      storyId: string;
      title: string;
      taskCount: number;
      duration: number;
      durationOptimistic: number;
      durationPessimistic: number;
      tokens: number;
      tokensOptimistic: number;
      tokensPessimistic: number;
      cost: number;
      costOptimistic: number;
      costPessimistic: number;
    }) => {
      const statusClass = est.completed ? "completed" : "pending";
      const statusLabel = est.completed ? "Done" : "Pending";
      const complexityClass =
        est.complexity <= 3
          ? "complexity-low"
          : est.complexity <= 6
            ? "complexity-medium"
            : "complexity-high";
      const confidenceClass =
        est.confidence === "high"
          ? "confidence-high"
          : est.confidence === "medium"
            ? "confidence-medium"
            : "confidence-low";
      const confidenceDots =
        est.confidence === "high" ? "●●●" : est.confidence === "medium" ? "●●○" : "●○○";

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
    <span class="confidence-indicator ${confidenceClass}" title="${est.confidence}${est.usedHistory ? " (historical)" : ""}">${confidenceDots}</span>
  </td>
  <td class="estimate-status-cell">
    <span class="status-badge ${statusClass}">${statusLabel}</span>
  </td>
</tr>
`;
    })
    .join("");

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
 * GET /estimate-comparison
 *
 * Returns HTML table comparing estimated vs actual results for completed stories.
 * Query params:
 *   - id: Stream/PRD ID
 */
estimationPartials.get("/estimate-comparison", (c) => {
  const id = c.req.query("id");

  if (!id) {
    return c.html(
      '<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No PRD ID provided</p></div>'
    );
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
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">${escapeHtml(report.error || "Unknown error")}</p>
</div>
`);
  }

  if (!report.hasData || !report.comparisons || report.comparisons.length === 0) {
    return c.html(`
<div class="rams-card" style="text-align: center; padding: var(--rams-space-6);">
  <h3 class="rams-h3" style="margin-bottom: var(--rams-space-2);">No comparison data available</h3>
  <p class="rams-text-muted">${escapeHtml(report.message || "No matching estimate-to-actual pairs found.")}</p>
  <p class="rams-text-muted" style="font-size: var(--rams-text-sm);">Complete some builds after running estimates to see comparisons.</p>
</div>
`);
  }

  function getDeviationClass(deviation: number): string {
    const abs = Math.abs(deviation);
    if (abs < 20) return "deviation-good";
    if (abs < 50) return "deviation-warning";
    return "deviation-bad";
  }

  function formatDeviation(deviation: number): string {
    const sign = deviation >= 0 ? "+" : "";
    return `${sign}${deviation.toFixed(0)}%`;
  }

  const rowsHtml = report.comparisons
    .map((comp: {
      storyId: string;
      title?: string;
      estimated: { duration: number; tokens: number; cost: number };
      actual: { duration: number; tokens: number };
      deviation: { duration: number; tokens: number };
    }) => {
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
    })
    .join("");

  let summaryHtml = "";
  if (report.accuracy && report.accuracy.sampleCount > 0) {
    const acc = report.accuracy;
    const avgDurationDeviation = acc.mape.duration !== null ? acc.mape.duration.toFixed(1) : "N/A";
    const avgTokensDeviation = acc.mape.tokens !== null ? acc.mape.tokens.toFixed(1) : "N/A";

    summaryHtml = `
<div class="comparison-summary">
  <h4>Accuracy Summary</h4>
  <div class="comparison-summary-stats">
    <div class="comparison-stat">
      <span class="comparison-stat-label">Average Time Deviation:</span>
      <span class="comparison-stat-value">+${avgDurationDeviation}%</span>
    </div>
    <div class="comparison-stat">
      <span class="comparison-stat-label">Average Token Deviation:</span>
      <span class="comparison-stat-value">+${avgTokensDeviation}%</span>
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
 * GET /accuracy-widget
 *
 * Returns a compact widget showing overall estimation accuracy metrics.
 */
estimationPartials.get("/accuracy-widget", (c) => {
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

  const allStreams = getStreams();
  let allComparisons: { deviation: { duration: number }; actualTimestamp: string }[] = [];

  for (const stream of allStreams) {
    const prdFolder = path.join(ralphRoot, `PRD-${stream.id}`);
    if (fs.existsSync(prdFolder)) {
      const report = generateAccuracyReport(prdFolder);
      if (report.success && report.hasData && report.comparisons) {
        allComparisons = allComparisons.concat(report.comparisons);
      }
    }
  }

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

  function calculateAccuracy(comparisons: { deviation: { duration: number } }[]): {
    mape: { duration: number | null };
    sampleCount: number;
  } {
    const validComparisons = comparisons.filter((c) => c.deviation.duration !== undefined);

    if (validComparisons.length === 0) {
      return { mape: { duration: null }, sampleCount: 0 };
    }

    const durationDeviations = validComparisons.map((c) => Math.abs(c.deviation.duration));
    const sum = durationDeviations.reduce((a, b) => a + b, 0);
    const avg = sum / durationDeviations.length;

    return {
      mape: { duration: avg },
      sampleCount: validComparisons.length,
    };
  }

  function detectTrend(comparisons: { deviation: { duration: number }; actualTimestamp: string }[]): {
    trend: string;
    trendIndicator: string;
    description: string;
  } {
    if (comparisons.length < 3) {
      return { trend: "insufficient_data", trendIndicator: "?", description: "Not enough data" };
    }

    const sorted = [...comparisons].sort(
      (a, b) => new Date(a.actualTimestamp).getTime() - new Date(b.actualTimestamp).getTime()
    );

    const recentCount = Math.max(5, Math.floor(sorted.length / 3));
    const splitPoint = Math.max(sorted.length - recentCount, Math.floor(sorted.length / 2));
    const recent = sorted.slice(splitPoint);
    const older = sorted.slice(0, splitPoint);

    if (older.length === 0) {
      return { trend: "insufficient_data", trendIndicator: "?", description: "Not enough older data" };
    }

    const recentAccuracy = calculateAccuracy(recent);
    const olderAccuracy = calculateAccuracy(older);

    const recentMape = recentAccuracy.mape.duration;
    const olderMape = olderAccuracy.mape.duration;

    if (recentMape === null || olderMape === null) {
      return { trend: "insufficient_data", trendIndicator: "?", description: "Cannot calculate trend" };
    }

    const improvement = ((olderMape - recentMape) / olderMape) * 100;

    if (improvement > 10) {
      return { trend: "improving", trendIndicator: "\u2191", description: "improving" };
    }
    if (improvement < -10) {
      return { trend: "degrading", trendIndicator: "\u2193", description: "degrading" };
    }
    return { trend: "stable", trendIndicator: "\u2192", description: "stable" };
  }

  const accuracy = calculateAccuracy(allComparisons);
  const trend = detectTrend(allComparisons);

  const avgDeviation = accuracy.mape.duration !== null ? accuracy.mape.duration.toFixed(1) : "N/A";

  // Generate sparkline data
  const sparklineComparisons = [...allComparisons]
    .sort((a, b) => new Date(a.actualTimestamp).getTime() - new Date(b.actualTimestamp).getTime())
    .slice(-20);

  let sparklineSvg = "";
  if (sparklineComparisons.length >= 2) {
    const sparklineData = sparklineComparisons.map((c) => Math.abs(c.deviation.duration));
    const maxDeviation = Math.max(...sparklineData);
    const minDeviation = Math.min(...sparklineData);
    const range = maxDeviation - minDeviation || 1;

    const width = 100;
    const height = 30;
    const padding = 2;

    const points = sparklineData
      .map((value, index) => {
        const x = (index / (sparklineData.length - 1)) * (width - 2 * padding) + padding;
        const y = height - padding - ((value - minDeviation) / range) * (height - 2 * padding);
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

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

  const trendClass =
    trend.trend === "improving"
      ? "trend-good"
      : trend.trend === "degrading"
        ? "trend-bad"
        : "trend-stable";

  const html = `
<div class="accuracy-widget">
  <div class="accuracy-widget-header">
    <h3>Estimation Accuracy</h3>
    <a href="/streams.html" class="accuracy-widget-link" title="View details">Details \u2192</a>
  </div>
  <div class="accuracy-widget-content">
    <div class="accuracy-widget-main">
      <div class="accuracy-widget-metric">
        <span class="accuracy-widget-label">Average Deviation</span>
        <span class="accuracy-widget-value">\u00B1${avgDeviation}%</span>
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
 * GET /rollback-stats
 *
 * Returns HTML fragment for rollback statistics.
 */
estimationPartials.get("/rollback-stats", (c) => {
  const streamId = c.req.query("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.html(`
<div class="rollback-stats empty-state">
  <p>Ralph directory not found.</p>
</div>
`);
  }

  const prdFolder = streamId ? path.join(ralphRoot, `PRD-${streamId}`) : null;

  if (streamId && !fs.existsSync(prdFolder!)) {
    return c.html(`
<div class="rollback-stats empty-state">
  <p>Stream PRD-${escapeHtml(streamId)} not found.</p>
</div>
`);
  }

  const analytics = streamId
    ? getRollbackAnalytics(prdFolder)
    : { success: true, hasData: false, total: 0 };

  if (!analytics.success) {
    return c.html(`
<div class="rollback-stats error-state">
  <p>Error loading rollback stats: ${escapeHtml(analytics.error || "Unknown error")}</p>
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

  const reasonsHtml = Object.entries(
    analytics.byReason as Record<string, { count: number; successful: number; avgAttempts: number }>
  )
    .sort(([, a], [, b]) => b.count - a.count)
    .slice(0, 5)
    .map(([reason, stats]) => {
      const recoveryRate = stats.count > 0 ? Math.round((stats.successful / stats.count) * 100) : 0;
      const reasonLabel = reason.replace(/-/g, " ").replace(/_/g, " ");
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
    .join("");

  const timelineHtml = (
    analytics.timeline as Array<{
      timestamp: string;
      storyId: string;
      reason: string;
      success: boolean;
      attempt: number;
    }>
  )
    .slice(0, 5)
    .map((event) => {
      const time = new Date(event.timestamp).toLocaleString("en-US", {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const statusClass = event.success ? "success" : "error";
      const statusIcon = event.success ? "\u2713" : "\u2717";
      return `
<div class="rollback-timeline-item">
  <span class="rollback-timeline-status ${statusClass}">${statusIcon}</span>
  <span class="rollback-timeline-story">${escapeHtml(event.storyId)}</span>
  <span class="rollback-timeline-reason">${escapeHtml(event.reason.replace(/-/g, " "))}</span>
  <span class="rollback-timeline-time">${time}</span>
</div>
`;
    })
    .join("");

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
    <div class="rollback-stat ${analytics.successRate >= 50 ? "success" : "warning"}">
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

  ${
    reasonsHtml
      ? `
  <div class="rollback-breakdown">
    <h4>By Failure Type</h4>
    <div class="rollback-reasons">
      ${reasonsHtml}
    </div>
  </div>
  `
      : ""
  }

  ${
    timelineHtml
      ? `
  <div class="rollback-timeline">
    <h4>Recent Events</h4>
    <div class="rollback-timeline-list">
      ${timelineHtml}
    </div>
  </div>
  `
      : ""
  }
</div>
`;

  return c.html(html);
});

export { estimationPartials };
