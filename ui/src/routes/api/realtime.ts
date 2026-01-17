/**
 * Real-Time Status API Routes
 *
 * REST API endpoints for live build status and events.
 * Provides real-time status, event logs, cost tracking, and budget monitoring.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { getRalphRoot } from "../../services/state-reader.js";

const realtime = new Hono();

/**
 * Resolve paths for both main and worktree locations
 * @param id - Stream/PRD ID
 * @param filename - File to look for
 * @param ralphRoot - Ralph root path
 * @returns Effective file path or null if not found
 */
function resolveStatusFile(
  id: string,
  filename: string,
  ralphRoot: string
): string | null {
  const mainPath = path.join(ralphRoot, `PRD-${id}`, filename);
  const worktreePath = path.join(
    ralphRoot,
    "worktrees",
    `PRD-${id}`,
    ".ralph",
    `PRD-${id}`,
    filename
  );

  if (fs.existsSync(worktreePath)) {
    return worktreePath;
  }
  if (fs.existsSync(mainPath)) {
    return mainPath;
  }
  return null;
}

/**
 * Resolve PRD folder path, checking both main and worktree locations
 * @param id - Stream/PRD ID
 * @param ralphRoot - Ralph root path
 * @returns Resolved PRD folder path
 */
function resolvePrdFolder(id: string, ralphRoot: string): string {
  const mainPath = path.join(ralphRoot, `PRD-${id}`);
  const worktreePath = path.join(
    ralphRoot,
    "worktrees",
    `PRD-${id}`,
    ".ralph",
    `PRD-${id}`
  );

  if (!fs.existsSync(mainPath) && fs.existsSync(worktreePath)) {
    return worktreePath;
  }
  return mainPath;
}

/**
 * GET /streams/:id/status
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
realtime.get("/streams/:id/status", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      { error: "not_found", message: "Ralph root not found" },
      404
    );
  }

  const effectivePath = resolveStatusFile(id, ".status.json", ralphRoot);

  if (!effectivePath) {
    return c.json(
      { error: "not_found", message: "No active build status found" },
      404
    );
  }

  try {
    const content = fs.readFileSync(effectivePath, "utf-8");
    const status = JSON.parse(content);

    return c.json({
      phase: status.phase || "unknown",
      story_id: status.story_id || null,
      story_title: status.story_title || null,
      iteration: status.iteration || 0,
      elapsed_seconds: status.elapsed_seconds || 0,
      updated_at: status.updated_at || new Date().toISOString(),
    });
  } catch {
    return c.json(
      { error: "parse_error", message: "Failed to parse status file" },
      500
    );
  }
});

/**
 * GET /streams/:id/events
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
realtime.get("/streams/:id/events", (c) => {
  const id = c.req.param("id");
  const limit = Math.min(parseInt(c.req.query("limit") || "10", 10), 100);
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      { error: "not_found", message: "Ralph root not found" },
      404
    );
  }

  const effectivePath = resolveStatusFile(id, ".events.log", ralphRoot);

  if (!effectivePath) {
    return c.json({ events: [], count: 0 });
  }

  try {
    const content = fs.readFileSync(effectivePath, "utf-8");
    const lines = content.trim().split("\n").filter((line) => line.length > 0);

    // Get last N lines
    const recentLines = lines.slice(-limit);

    // Parse event lines: [timestamp] LEVEL message | details
    const events = recentLines.map((line) => {
      const match = line.match(/^\[([^\]]+)\]\s+(\w+)\s+(.+)$/);
      if (!match) {
        return {
          timestamp: new Date().toISOString(),
          level: "INFO",
          message: line,
          details: null,
        };
      }

      const [, timestamp, level, rest] = match;
      let message = rest;
      let details: string | null = null;

      // Split on " | " for details
      if (rest.includes(" | ")) {
        const parts = rest.split(" | ");
        message = parts[0];
        details = parts.slice(1).join(" | ");
      }

      // Parse timestamp
      let isoTimestamp: string;
      try {
        isoTimestamp = new Date(timestamp.replace(" ", "T")).toISOString();
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
  } catch {
    return c.json(
      { error: "read_error", message: "Failed to read events log" },
      500
    );
  }
});

/**
 * GET /streams/:id/cost
 *
 * Returns cost tracking data for a stream.
 * Reads from .cost.json in the PRD folder.
 *
 * Response:
 *   - total_cost: Total accumulated cost in dollars
 *   - total_input_tokens: Total input tokens used
 *   - total_output_tokens: Total output tokens used
 *   - iterations: Array of per-iteration cost data
 *   - has_data: Whether cost tracking data exists
 */
realtime.get("/streams/:id/cost", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "Ralph root not found" }, 500);
  }

  const prdFolder = resolvePrdFolder(id, ralphRoot);
  const costPath = path.join(prdFolder, ".cost.json");

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
    const content = fs.readFileSync(costPath, "utf-8");
    const costData = JSON.parse(content);
    return c.json({
      has_data: true,
      ...costData,
    });
  } catch (err) {
    return c.json(
      { error: `Failed to read cost data: ${(err as Error).message}` },
      500
    );
  }
});

/**
 * GET /streams/:id/budget
 *
 * Returns budget configuration and status for a stream.
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
realtime.get("/streams/:id/budget", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "Ralph root not found" }, 500);
  }

  const prdFolder = resolvePrdFolder(id, ralphRoot);
  const budgetPath = path.join(prdFolder, ".budget.json");
  const costPath = path.join(prdFolder, ".cost.json");

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
    const budgetContent = fs.readFileSync(budgetPath, "utf-8");
    const budget = JSON.parse(budgetContent);

    let currentCost = 0;
    if (fs.existsSync(costPath)) {
      const costContent = fs.readFileSync(costPath, "utf-8");
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
      warnings: budget.warnings || [0.75, 0.9],
    });
  } catch (err) {
    return c.json(
      { error: `Failed to read budget data: ${(err as Error).message}` },
      500
    );
  }
});

export { realtime };
