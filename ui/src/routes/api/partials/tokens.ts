/**
 * Token Partials Routes
 *
 * HTML partial endpoints for token consumption UI components.
 * Returns HTML fragments for HTMX partial updates.
 */

import { Hono } from "hono";
import {
  getTokenSummary,
  getStreamTokens,
  getTokenTrends,
  getBudgetStatus,
  calculateModelEfficiency,
  getModelRecommendations,
  getAllRunsForEfficiency,
} from "../../../services/token-reader.js";
import { getStreams, getStreamDetails } from "../../../services/state-reader.js";
import { escapeHtml } from "../../utils/html-helpers.js";
import { formatCurrency, formatTokens } from "../../utils/formatters.js";

const tokenPartials = new Hono();

/**
 * GET /token-summary
 *
 * Returns HTML fragment for the token summary cards.
 * Shows total tokens consumed (input/output breakdown),
 * total estimated cost with currency formatting,
 * and cost trend indicator (up/down vs previous period).
 */
tokenPartials.get("/token-summary", (c) => {
  const summary = getTokenSummary();

  // Calculate previous period cost for trend
  const trends = getTokenTrends("7d");
  let previousCost = 0;
  let currentCost = 0;
  const dataPoints = trends.dataPoints;

  if (dataPoints.length >= 2) {
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
  const trendColor =
    trendDirection === "up"
      ? "var(--rams-warning)"
      : trendDirection === "down"
        ? "var(--rams-success)"
        : "var(--rams-text-muted)";

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
 * GET /token-streams
 *
 * Returns HTML fragment for the token usage by stream table.
 * Includes sortable headers, clickable rows for stream detail, and efficiency score.
 */
tokenPartials.get("/token-streams", (c) => {
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
    const fullStream = streams.find((s) => s.id === stream.streamId);
    const completedStories = fullStream?.completedStories || 0;
    const efficiencyScore = completedStories > 0 ? stream.totalCost / completedStories : null;

    return {
      ...stream,
      completedStories,
      efficiencyScore,
    };
  });

  const tableRows = enrichedStreams
    .map((stream) => {
      const efficiencyDisplay =
        stream.efficiencyScore !== null
          ? formatCurrency(stream.efficiencyScore)
          : '<span class="rams-text-muted">N/A</span>';
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
 * GET /token-models
 *
 * Returns HTML fragment for the token usage by model breakdown with efficiency metrics.
 * Shows model comparison, efficiency scores, and recommendations.
 */
tokenPartials.get("/token-models", (c) => {
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

  const modelCards = modelEntries
    .map(([model, metrics]) => {
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

      const successRateColor =
        successRate >= 80
          ? "var(--rams-success)"
          : successRate >= 50
            ? "var(--rams-warning)"
            : "var(--rams-error)";

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
 * GET /token-stories/:streamId
 *
 * Returns HTML fragment for expandable per-story token breakdown within a stream.
 * Shows story ID, title, status, runs, tokens, and cost with accordion expand/collapse.
 * Highlights stories with unusually high token consumption.
 */
tokenPartials.get("/token-stories/:streamId", (c) => {
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
  const highConsumptionThreshold = avgTokens * 1.5;

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
 * GET /token-budget
 *
 * Returns HTML fragment for budget progress bars.
 * Shows daily and monthly budget consumption with color-coded progress bars.
 */
tokenPartials.get("/token-budget", (c) => {
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
  function getStatusColor(percentage: number, exceeded: boolean): string {
    if (exceeded) return "var(--rams-error)";
    if (percentage >= 90) return "var(--rams-warning)";
    return "var(--rams-success)";
  }

  // Build daily budget HTML
  let dailyHtml = "";
  if (status.daily.hasLimit && status.daily.limit !== null) {
    const dailyBarWidth = Math.min(status.daily.percentage, 100);
    const dailyStatusIcon = status.daily.exceeded ? "&#9888;" : "&#10003;";
    const dailyStatusText = status.daily.exceeded ? "Exceeded" : "OK";
    const dailyStatusColor = getStatusColor(status.daily.percentage, status.daily.exceeded);

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
    const monthlyBarWidth = Math.min(status.monthly.percentage, 100);
    const monthlyStatusIcon = status.monthly.exceeded ? "&#9888;" : "&#10003;";
    const monthlyStatusText = status.monthly.exceeded ? "Exceeded" : "OK";
    const monthlyStatusColor = getStatusColor(status.monthly.percentage, status.monthly.exceeded);

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
  const highestDailyAlert = status.daily.alerts[status.daily.alerts.length - 1];
  const highestMonthlyAlert = status.monthly.alerts[status.monthly.alerts.length - 1];

  if (highestDailyAlert || highestMonthlyAlert) {
    const alertItems = [];
    if (highestDailyAlert) {
      const alertColor =
        highestDailyAlert.threshold >= 100
          ? "var(--rams-error)"
          : "var(--rams-warning)";
      alertItems.push(
        `<div class="rams-badge" style="background: ${alertColor}; color: white; margin-right: var(--rams-space-2);">&#9888; ${escapeHtml(highestDailyAlert.message)}</div>`
      );
    }
    if (highestMonthlyAlert) {
      const alertColor =
        highestMonthlyAlert.threshold >= 100
          ? "var(--rams-error)"
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

export { tokenPartials };
