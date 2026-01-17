/**
 * Checkpoint API Routes
 *
 * REST API endpoints for checkpoint management and build resumption.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { getRalphRoot } from "../../services/state-reader.js";
import { formatTimeAgo } from "../utils/formatters.js";

const checkpoint = new Hono();

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
 * GET /streams/:id/checkpoint
 *
 * Returns checkpoint data for a stream if one exists.
 * Includes iteration, story, agent, git SHA, and creation time.
 *
 * Returns 404 if no checkpoint exists.
 */
checkpoint.get("/streams/:id/checkpoint", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "Ralph root not found" }, 500);
  }

  const prdFolder = resolvePrdFolder(id, ralphRoot);
  const checkpointPath = path.join(prdFolder, "checkpoint.json");

  if (!fs.existsSync(checkpointPath)) {
    return c.json({ error: "No checkpoint found", notFound: true }, 404);
  }

  try {
    const content = fs.readFileSync(checkpointPath, "utf-8");
    const checkpointData = JSON.parse(content);

    // Add formatted time ago
    let timeAgo = "unknown";
    if (checkpointData.created_at) {
      const created = new Date(checkpointData.created_at);
      timeAgo = formatTimeAgo(created);
    }

    return c.json({
      ...checkpointData,
      time_ago: timeAgo,
      prd_folder: prdFolder,
    });
  } catch (err) {
    return c.json(
      { error: `Failed to read checkpoint: ${(err as Error).message}` },
      500
    );
  }
});

/**
 * POST /streams/:id/resume
 *
 * Triggers a build resume for the specified stream.
 * Uses the checkpoint to resume from the last saved state.
 *
 * Query params:
 *   - iterations: Number of iterations to run (default: 1)
 */
checkpoint.post("/streams/:id/resume", async (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "Ralph root not found" }, 500);
  }

  const prdFolder = resolvePrdFolder(id, ralphRoot);
  const checkpointPath = path.join(prdFolder, "checkpoint.json");

  if (!fs.existsSync(checkpointPath)) {
    return c.json({ error: "No checkpoint found to resume from" }, 404);
  }

  // Parse body for iterations
  let iterations = 1;
  try {
    const body = await c.req.json().catch(() => ({}));
    if (body.iterations && typeof body.iterations === "number") {
      iterations = Math.min(Math.max(1, body.iterations), 100);
    }
  } catch {
    // Use default
  }

  try {
    // Spawn ralph build with --resume flag
    const cwd = path.dirname(path.dirname(ralphRoot)); // Get project root
    const child = spawn(
      "ralph",
      ["build", String(iterations), `--prd=${id}`, "--resume"],
      {
        cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          RALPH_RESUME: "1",
        },
      }
    );

    child.unref();

    return c.json({
      success: true,
      message: `Resuming build for PRD-${id} with ${iterations} iteration(s)`,
      pid: child.pid,
    });
  } catch (err) {
    return c.json(
      { error: `Failed to start build: ${(err as Error).message}` },
      500
    );
  }
});

/**
 * POST /streams/:id/checkpoint/clear
 *
 * Clears (deletes) the checkpoint for a stream.
 * This allows starting a fresh build.
 */
checkpoint.post("/streams/:id/checkpoint/clear", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "Ralph root not found" }, 500);
  }

  const prdFolder = resolvePrdFolder(id, ralphRoot);
  const checkpointPath = path.join(prdFolder, "checkpoint.json");

  if (!fs.existsSync(checkpointPath)) {
    return c.json({ error: "No checkpoint found to clear", notFound: true }, 404);
  }

  try {
    fs.unlinkSync(checkpointPath);
    return c.json({
      success: true,
      message: `Checkpoint cleared for PRD-${id}`,
    });
  } catch (err) {
    return c.json(
      { error: `Failed to clear checkpoint: ${(err as Error).message}` },
      500
    );
  }
});

export { checkpoint };
