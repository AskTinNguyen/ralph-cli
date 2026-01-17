/**
 * Trends API Routes
 *
 * REST API endpoints for success rate, cost, and velocity analytics.
 * Provides trend data and chart-ready JSON for the dashboard.
 */

import { Hono } from "hono";
import {
  getSuccessRateTrends,
  getWeekOverWeek,
  getFilterOptions,
  formatForChart,
  getCostTrends,
  getCostTrendsWithBudget,
  getCostFilterOptions,
  formatCostForChart,
  formatModelBreakdownForChart,
  getVelocityTrends,
  getBurndown,
  getStreamVelocityComparison,
  formatVelocityForChart,
  formatBurndownForChart,
  formatStreamComparisonForChart,
  getExportData,
  exportToCsv,
} from "../../services/trends.js";
import type { ExportOptions } from "../../services/trends.js";

const trends = new Hono();

// ==============================================
// SUCCESS RATE TRENDS ENDPOINTS (US-001)
// ==============================================

/**
 * GET /success-rate
 *
 * Returns success rate trend data for visualization.
 * Query params:
 *   - period: '7d' or '30d' (default: '7d')
 *   - prd: PRD ID to filter by (optional)
 *   - agent: Agent name to filter by (optional)
 *   - developer: Developer to filter by (optional)
 */
trends.get("/success-rate", (c) => {
  const periodParam = c.req.query("period") || "7d";
  const period = periodParam === "30d" ? "30d" : "7d";
  const prd = c.req.query("prd");
  const agent = c.req.query("agent");
  const developer = c.req.query("developer");

  const trendData = getSuccessRateTrends(period, { prd, agent, developer });
  const chartData = formatForChart(trendData);
  const weekOverWeek = getWeekOverWeek({ prd, agent, developer });

  return c.json({
    trends: trendData,
    chartData,
    weekOverWeek,
  });
});

/**
 * GET /filters
 *
 * Returns available filter options for success rate trends.
 */
trends.get("/filters", (c) => {
  const options = getFilterOptions();
  return c.json(options);
});

// ==============================================
// COST TRENDS ENDPOINTS (US-002)
// ==============================================

/**
 * GET /cost
 *
 * Returns cost trend data for visualization.
 * Query params:
 *   - period: '7d' or '30d' (default: '30d')
 *   - groupBy: 'day' or 'week' (default: 'day')
 *   - prd: PRD ID to filter by (optional)
 *   - model: Model name to filter by (optional)
 *   - budget: Daily budget in dollars for comparison (optional)
 */
trends.get("/cost", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const groupBy = (c.req.query("groupBy") || "day") as "day" | "week";
  const prd = c.req.query("prd");
  const model = c.req.query("model");
  const budgetParam = c.req.query("budget");

  const filters = { prd, model, groupBy };

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

    const trendData = getCostTrendsWithBudget(period, dailyBudget, filters);
    const chartData = formatCostForChart(trendData, {
      showBudget: true,
      dailyBudget,
    });
    const modelBreakdownChart = formatModelBreakdownForChart(trendData.byModel);

    return c.json({
      trends: trendData,
      chartData,
      modelBreakdownChart,
      period,
      filters: trendData.filters,
    });
  }

  const trendData = getCostTrends(period, filters);
  const chartData = formatCostForChart(trendData);
  const modelBreakdownChart = formatModelBreakdownForChart(trendData.byModel);

  return c.json({
    trends: trendData,
    chartData,
    modelBreakdownChart,
    period,
    filters: trendData.filters,
  });
});

/**
 * GET /cost/filters
 *
 * Returns available filter options for cost trends.
 */
trends.get("/cost/filters", (c) => {
  const options = getCostFilterOptions();
  return c.json(options);
});

// ==============================================
// VELOCITY TRENDS ENDPOINTS (US-003)
// ==============================================

/**
 * GET /velocity
 *
 * Returns velocity trend data for visualization.
 * Query params:
 *   - period: '7d' or '30d' (default: '30d')
 *   - prd: PRD ID to filter by (optional)
 *   - groupBy: 'day' or 'week' (default: 'day')
 */
trends.get("/velocity", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";
  const prd = c.req.query("prd");
  const groupBy = (c.req.query("groupBy") || "day") as "day" | "week";

  const filters = { prd, groupBy };
  const trendData = getVelocityTrends(period, filters);
  const chartData = formatVelocityForChart(trendData);

  return c.json({
    trends: trendData,
    chartData,
    period,
    filters: trendData.filters,
  });
});

/**
 * GET /burndown/:prdId
 *
 * Returns burndown chart data for a specific PRD.
 */
trends.get("/burndown/:prdId", (c) => {
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
 * GET /streams
 *
 * Returns velocity comparison across all streams.
 * Query params:
 *   - period: '7d' or '30d' (default: '30d')
 */
trends.get("/streams", (c) => {
  const periodParam = c.req.query("period") || "30d";
  const period = periodParam === "7d" ? "7d" : "30d";

  const comparison = getStreamVelocityComparison(period);
  const chartData = formatStreamComparisonForChart(comparison);

  return c.json({
    comparison,
    chartData,
  });
});

// ==============================================
// EXPORT ENDPOINTS (US-004)
// ==============================================

/**
 * GET /export
 *
 * Export trend data in CSV or JSON format.
 * Query params:
 *   - format: 'csv' or 'json' (default: 'json')
 *   - metrics: 'all', 'success-rate', 'cost', or 'velocity' (default: 'all')
 *   - period: '7d' or '30d' (default: '30d')
 *   - prd: PRD ID to filter by (optional)
 */
trends.get("/export", (c) => {
  const format = (c.req.query("format") || "json") as "csv" | "json";
  const metrics = (c.req.query("metrics") || "all") as
    | "all"
    | "success-rate"
    | "cost"
    | "velocity";
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

  const filename = `ralph-trends-${metrics}-${period}-${new Date().toISOString().split("T")[0]}.json`;

  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});

export { trends };
