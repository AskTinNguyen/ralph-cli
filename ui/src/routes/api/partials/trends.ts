/**
 * Trends Partials Routes
 *
 * HTML partial endpoints for trend chart UI components.
 * Returns HTML fragments for success rate, cost, velocity, and export controls.
 */

import { Hono } from "hono";
import {
  getSuccessRateTrends,
  getWeekOverWeek,
  getFilterOptions,
  getCostTrends,
  getCostTrendsWithBudget,
  getCostFilterOptions,
  getVelocityTrends,
  getBurndown,
  getStreamVelocityComparison,
} from "../../../services/trends.js";

const trendsPartials = new Hono();

/**
 * GET /success-rate-chart
 *
 * Returns HTML fragment for the success rate trend chart section.
 */
trendsPartials.get("/success-rate-chart", (c) => {
  const periodParam = c.req.query("period") || "7d";
  const period = periodParam === "30d" ? "30d" : "7d";
  const prd = c.req.query("prd");
  const agent = c.req.query("agent");

  const trends = getSuccessRateTrends(period, { prd, agent });
  const weekOverWeek = getWeekOverWeek({ prd, agent });

  // Calculate trend arrow and color
  let trendArrow = "\u2192";
  let trendClass = "stable";
  if (weekOverWeek.delta !== null && weekOverWeek.delta !== 0) {
    if (weekOverWeek.delta > 0) {
      trendArrow = "\u2191";
      trendClass = "improved";
    } else {
      trendArrow = "\u2193";
      trendClass = "declined";
    }
  }

  const deltaText =
    weekOverWeek.delta !== null
      ? `${weekOverWeek.delta > 0 ? "+" : ""}${weekOverWeek.delta}%`
      : "N/A";

  // Build significant changes HTML
  let changesHtml = "";
  if (trends.significantChanges.length > 0) {
    const changeItems = trends.significantChanges
      .slice(0, 3)
      .map((change) => {
        const icon = change.direction === "improved" ? "\u2191" : "\u2193";
        const changeColor =
          change.direction === "improved" ? "var(--rams-success)" : "var(--rams-error)";
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
  const trendColor =
    trendClass === "improved"
      ? "var(--rams-success)"
      : trendClass === "declined"
        ? "var(--rams-error)"
        : "var(--rams-text-muted)";
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
 * GET /cost-chart
 *
 * Returns HTML fragment for the cost trend summary section.
 */
trendsPartials.get("/cost-chart", (c) => {
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
  const totalVariance = hasBudget
    ? (trends as unknown as { totalVariance: number }).totalVariance
    : 0;
  const varianceSign = hasBudget && totalVariance >= 0 ? "+" : "";

  // Calculate total tokens from byModel breakdown
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  if (trends.byModel) {
    for (const modelName of Object.keys(trends.byModel)) {
      const modelData = trends.byModel[modelName] as {
        inputTokens?: number;
        outputTokens?: number;
      };
      totalInputTokens += modelData.inputTokens || 0;
      totalOutputTokens += modelData.outputTokens || 0;
    }
  }

  // Format token numbers with commas for readability
  function formatNumber(num: number): string {
    return num.toLocaleString("en-US");
  }

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
      ${
        hasBudget
          ? `
      <div class="rams-metric-card">
        <div class="rams-metric-value" style="color: ${varianceColor};">${varianceSign}$${Math.abs(totalVariance).toFixed(2)}</div>
        <div class="rams-metric-label">vs Budget</div>
      </div>
      `
          : ""
      }
    </div>
    <div class="rams-text-muted" style="font-size: 0.875rem;">
      Showing data for ${period === "7d" ? "last 7 days" : "last 30 days"} &bull; ${trends.dailyMetrics.length} data points
    </div>
  `;

  return c.html(html);
});

/**
 * GET /velocity-chart
 *
 * Returns HTML fragment for the velocity summary section.
 */
trendsPartials.get("/velocity-chart", (c) => {
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
 * GET /export-controls
 *
 * Returns HTML fragment for export controls.
 */
trendsPartials.get("/export-controls", (c) => {
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
 * GET /success-rate-filters
 *
 * Returns HTML fragment for the filter dropdown options.
 */
trendsPartials.get("/success-rate-filters", (c) => {
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

/**
 * GET /cost-filters
 *
 * Returns HTML fragment for cost trend filter dropdowns.
 */
trendsPartials.get("/cost-filters", (c) => {
  const options = getCostFilterOptions();

  const prdOptions = options.prds.map((prd) => `<option value="${prd}">PRD-${prd}</option>`).join("");

  const modelOptions = options.models.map((model) => `<option value="${model}">${model}</option>`).join("");

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
 * GET /velocity-filters
 *
 * Returns HTML fragment for velocity trend filter dropdowns.
 */
trendsPartials.get("/velocity-filters", (c) => {
  const options = getFilterOptions();

  const prdOptions = options.prds.map((prd) => `<option value="${prd}">PRD-${prd}</option>`).join("");

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

/**
 * GET /burndown-chart/:prdId
 *
 * Returns HTML fragment for burndown chart summary.
 */
trendsPartials.get("/burndown-chart/:prdId", (c) => {
  const prdId = c.req.param("prdId");

  const burndown = getBurndown(prdId);

  if (!burndown) {
    return c.html(
      `<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">PRD-${prdId} not found</p></div>`
    );
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
 * GET /stream-comparison
 *
 * Returns HTML fragment for stream velocity comparison.
 */
trendsPartials.get("/stream-comparison", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";

  const comparison = getStreamVelocityComparison(period);

  if (comparison.streams.length === 0) {
    return c.html(
      `<div class="rams-card" style="text-align: center; padding: var(--rams-space-4);"><p class="rams-text-muted">No streams with velocity data found.</p></div>`
    );
  }

  const streamRows = comparison.streams
    .map(
      (stream) => `
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
    `
    )
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

export { trendsPartials };
