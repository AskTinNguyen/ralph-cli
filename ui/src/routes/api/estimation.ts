/**
 * Estimation API Routes
 *
 * REST API endpoints for PRD estimation, accuracy tracking, and rollback statistics.
 * Provides estimate data, history, and comparison functionality.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { getRalphRoot, getStreams } from "../../services/state-reader.js";
import { getStreamEstimate } from "../../services/estimate-reader.js";

// Import CommonJS accuracy and estimate modules
const require = createRequire(import.meta.url);
const { generateAccuracyReport, loadEstimates, saveEstimate } = require("../../../../lib/estimate/accuracy.js");
const { estimate } = require("../../../../lib/estimate/index.js");
const { getRollbackAnalytics } = require("../../../../lib/estimate/metrics.js");

const estimation = new Hono();

/**
 * GET /estimate/:prdId
 *
 * Returns JSON estimate for the specified PRD.
 * Query params:
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 *   - force: Force fresh calculation, bypass cache (default: false)
 */
estimation.get("/estimate/:prdId", (c) => {
  const prdId = c.req.param("prdId");
  const model = c.req.query("model") || "sonnet";
  const force = c.req.query("force") === "true";

  if (model !== "sonnet" && model !== "opus") {
    return c.json(
      {
        error: "bad_request",
        message: 'Invalid model parameter. Must be "sonnet" or "opus".',
      },
      400
    );
  }

  const result = getStreamEstimate(prdId, { model, force });

  if (!result.success) {
    return c.json(
      {
        error: "not_found",
        message: result.error || `PRD-${prdId} not found or missing plan.md`,
      },
      404
    );
  }

  return c.json({
    prdId,
    estimates: result.estimates,
    totals: result.totals,
    cached: result.cached,
    cachedAt: result.cachedAt,
    planModifiedAt: result.planModifiedAt,
  });
});

/**
 * GET /estimate/:prdId/accuracy
 *
 * Returns JSON accuracy report comparing estimates vs actual results.
 */
estimation.get("/estimate/:prdId/accuracy", (c) => {
  const prdId = c.req.param("prdId");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: "Ralph root directory not found",
      },
      404
    );
  }

  const prdFolder = path.join(ralphRoot, `PRD-${prdId}`);

  if (!fs.existsSync(prdFolder)) {
    return c.json(
      {
        error: "not_found",
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const report = generateAccuracyReport(prdFolder);

  if (!report.success) {
    return c.json(
      {
        error: "internal_error",
        message: report.error || "Failed to generate accuracy report",
      },
      500
    );
  }

  return c.json({
    prdId,
    hasData: report.hasData || false,
    message: report.message || null,
    comparisons: report.comparisons || [],
    accuracy: report.accuracy || null,
    trend: report.trend || null,
    summary: report.summary || null,
  });
});

/**
 * GET /estimate/:prdId/history
 *
 * Returns historical estimates for a PRD with pagination support.
 * Query params:
 *   - limit: Maximum number of estimates to return (default: 10)
 *   - offset: Number of estimates to skip (default: 0)
 */
estimation.get("/estimate/:prdId/history", (c) => {
  const prdId = c.req.param("prdId");
  const limit = parseInt(c.req.query("limit") || "10", 10);
  const offset = parseInt(c.req.query("offset") || "0", 10);
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      {
        error: "not_found",
        message: "Ralph root directory not found",
      },
      404
    );
  }

  const prdFolder = path.join(ralphRoot, `PRD-${prdId}`);

  if (!fs.existsSync(prdFolder)) {
    return c.json(
      {
        error: "not_found",
        message: `PRD-${prdId} not found`,
      },
      404
    );
  }

  const result = loadEstimates(prdFolder);

  if (!result.success) {
    return c.json(
      {
        error: "internal_error",
        message: result.error || "Failed to load estimates",
      },
      500
    );
  }

  // Sort by timestamp descending (newest first)
  const sortedEstimates = (result.estimates || []).sort(
    (a: { timestamp: string }, b: { timestamp: string }) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Apply pagination
  const total = sortedEstimates.length;
  const validLimit = Math.min(Math.max(1, limit), 100);
  const validOffset = Math.max(0, offset);
  const paginatedEstimates = sortedEstimates.slice(validOffset, validOffset + validLimit);

  return c.json({
    prdId,
    estimates: paginatedEstimates,
    total,
    limit: validLimit,
    offset: validOffset,
  });
});

/**
 * POST /estimate/:prdId/run
 *
 * Triggers a fresh estimate calculation and updates the cache.
 * Query params:
 *   - model: Model for cost calculation ('sonnet' or 'opus', default: 'sonnet')
 */
estimation.post("/estimate/:prdId/run", (c) => {
  const prdId = c.req.param("prdId");
  const model = c.req.query("model") || "sonnet";

  if (model !== "sonnet" && model !== "opus") {
    return c.json(
      {
        error: "bad_request",
        message: 'Invalid model parameter. Must be "sonnet" or "opus".',
      },
      400
    );
  }

  const result = getStreamEstimate(prdId, { model, force: true });

  if (!result.success) {
    return c.json(
      {
        error: "not_found",
        message: result.error || `PRD-${prdId} not found or missing plan.md`,
      },
      404
    );
  }

  return c.json({
    prdId,
    estimates: result.estimates,
    totals: result.totals,
    cached: false,
    cachedAt: result.cachedAt,
    planModifiedAt: result.planModifiedAt,
  });
});

/**
 * GET /rollback-stats
 *
 * Returns JSON with rollback statistics for a stream or all streams.
 * Query params:
 *   - id: Stream ID (optional, returns all streams if not provided)
 */
estimation.get("/rollback-stats", (c) => {
  const streamId = c.req.query("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ success: false, error: "Ralph directory not found" });
  }

  if (streamId) {
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
  const allStreams = getStreams();
  const allStats = {
    totalRollbacks: 0,
    totalRecovered: 0,
    totalFailed: 0,
    byStream: {} as Record<string, { rollbacks: number; recoveryRate: number }>,
    byReason: {} as Record<string, { count: number; successful: number }>,
  };

  for (const stream of allStreams) {
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
    for (const [reason, stats] of Object.entries(
      analytics.byReason as Record<string, { count: number; successful: number }>
    )) {
      if (!allStats.byReason[reason]) {
        allStats.byReason[reason] = { count: 0, successful: 0 };
      }
      allStats.byReason[reason].count += stats.count;
      allStats.byReason[reason].successful += stats.successful;
    }
  }

  const overallRecoveryRate =
    allStats.totalRollbacks > 0
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

export { estimation };
