/**
 * Token API Routes
 *
 * REST API endpoints for token consumption and cost tracking.
 * Provides token metrics, efficiency analysis, and export capabilities.
 */

import { Hono } from "hono";
import {
  getTokenSummary,
  getStreamTokens,
  getStoryTokens,
  getRunTokens,
  getTokenTrends,
  getBudgetStatus,
  calculateModelEfficiency,
  compareModels,
  getModelRecommendations,
  getAllRunsForEfficiency,
} from "../../services/token-reader.js";

const tokens = new Hono();

/**
 * GET /summary
 *
 * Returns overall token/cost summary across all streams.
 * Response includes:
 *   - totalInputTokens, totalOutputTokens, totalCost
 *   - avgCostPerStory, avgCostPerRun
 *   - byStream: array of per-stream summaries
 *   - byModel: object keyed by model name
 */
tokens.get("/summary", (c) => {
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
 * GET /stream/:id
 *
 * Returns detailed token metrics for a specific stream.
 * Includes per-story breakdown, per-model breakdown, and all runs.
 */
tokens.get("/stream/:id", (c) => {
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
 * GET /story/:streamId/:storyId
 *
 * Returns token metrics for a specific story within a stream.
 * Includes all runs for that story.
 */
tokens.get("/story/:streamId/:storyId", (c) => {
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
 * GET /runs
 *
 * Returns token data for recent runs.
 * Query params:
 *   - streamId: Filter to specific stream (optional)
 *   - limit: Max number of runs to return (default: 50)
 *   - offset: Number of runs to skip for pagination (default: 0)
 *   - from: Filter runs from this date (ISO format, optional)
 *   - to: Filter runs until this date (ISO format, optional)
 */
tokens.get("/runs", (c) => {
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
 * GET /trends
 *
 * Returns time-series token data for charts.
 * Query params:
 *   - period: Time period ('7d', '30d', '90d', 'all'). Default: '7d'
 *   - streamId: Optional stream ID to filter by (if not provided, returns aggregate)
 *
 * Returns data points grouped by day with:
 *   - date, inputTokens, outputTokens, totalCost, runCount
 */
tokens.get("/trends", (c) => {
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
 * GET /efficiency
 *
 * Returns efficiency metrics for all models.
 */
tokens.get("/efficiency", (c) => {
  const allRuns = getAllRunsForEfficiency();
  const efficiency = calculateModelEfficiency(allRuns);
  const recommendations = getModelRecommendations(efficiency);

  return c.json({
    efficiency,
    recommendations,
  });
});

/**
 * GET /compare
 *
 * Compare efficiency between two models.
 * Query params:
 *   - modelA: First model name (e.g., 'sonnet', 'opus', 'haiku')
 *   - modelB: Second model name
 *   - streamA: Optional stream ID for model A (for A/B stream comparison)
 *   - streamB: Optional stream ID for model B (for A/B stream comparison)
 */
tokens.get("/compare", (c) => {
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
 * GET /budget
 *
 * Returns budget status including daily/monthly limits and current spending.
 */
tokens.get("/budget", (c) => {
  const status = getBudgetStatus();
  return c.json(status);
});

/**
 * GET /export
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
tokens.get("/export", (c) => {
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
  function formatDate(date: Date): string {
    return date.toISOString().split("T")[0];
  }

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
  }

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
});

export { tokens };
