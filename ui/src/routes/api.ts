/**
 * API Routes
 *
 * REST API endpoints for status, progress, and streams.
 * Provides data to the UI for displaying Ralph CLI state.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Stream } from '../types.js';
import { getRalphRoot, getMode, getStreams, getStreamDetails } from '../services/state-reader.js';
// parseStories, countStoriesByStatus moved to partials/misc.ts
// parseActivityLog, parseRunLog moved to partials/misc.ts
import { getTokenSummary, getStreamTokens, getStoryTokens, getRunTokens, getTokenTrends, getBudgetStatus, calculateModelEfficiency, compareModels, getModelRecommendations, getAllRunsForEfficiency } from '../services/token-reader.js';
import { getStreamEstimate } from '../services/estimate-reader.js';
// processManager moved to partials/misc.ts
import { wizardProcessManager, type WizardOutputEvent } from '../services/wizard-process-manager.js';
import { getSuccessRateTrends, getWeekOverWeek, getFilterOptions, formatForChart, getCostTrends, getCostTrendsWithBudget, getCostFilterOptions, formatCostForChart, formatModelBreakdownForChart, getVelocityTrends, getBurndown, getStreamVelocityComparison, formatVelocityForChart, formatBurndownForChart, formatStreamComparisonForChart, getExportData, exportToCsv } from '../services/trends.js';
import { getCriticalAlerts } from '../services/alerts-reader.js';
import type { ExportOptions } from '../services/trends.js';
import { createRequire } from 'node:module';

// Import CommonJS accuracy and estimate modules
const require = createRequire(import.meta.url);
const { generateAccuracyReport, loadEstimates } = require('../../../lib/estimate/accuracy.js');
// Rollback analytics (US-004)
const { getRollbackAnalytics, getRollbackStats, loadMetrics } = require('../../../lib/estimate/metrics.js');
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
import { streamControl } from './api/stream-control.js';
import { statusApi } from './api/status.js';
import { buildApi } from './api/build.js';
import { filesApi } from './api/files.js';
import { workflowApi } from './api/workflow.js';

// Partials sub-routers for HTML fragments
import { tokenPartials } from './api/partials/tokens.js';
import { trendsPartials } from './api/partials/trends.js';
import { dashboardPartials } from './api/partials/dashboard.js';
import { estimationPartials } from './api/partials/estimation.js';
import { streamPartials } from './api/partials/streams.js';
import { miscPartials } from './api/partials/misc.js';

// Shared utilities
import { formatDuration, formatTokens, formatCost, formatCurrency } from './utils/formatters.js';
import { escapeHtml } from './utils/html-helpers.js';

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
api.route('/', streamControl);
api.route('/', statusApi);
api.route('/', buildApi);
api.route('/', filesApi);
api.route('/streams', workflowApi);

// Mount partials sub-routers for HTML fragments
api.route('/partials', tokenPartials);
api.route('/partials', trendsPartials);
api.route('/partials', dashboardPartials);
api.route('/partials', estimationPartials);
api.route('/partials', streamPartials);
api.route('/partials', miscPartials);


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
