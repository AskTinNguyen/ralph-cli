/**
 * Stream Control API Routes
 *
 * REST API endpoints for managing stream control operations.
 * Supports creating, initializing, merging, building, stopping, closing, and restoring streams.
 */

import { Hono } from "hono";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { getRalphRoot, getStreams, getStreamDetails } from "../../services/state-reader.js";
import { processManager } from "../../services/process-manager.js";
import { getBudgetStatus } from "../../services/token-reader.js";
import type { BuildOptions } from "../../types.js";

export const streamControl = new Hono();

/**
 * Helper function to execute a ralph command and return the result
 */
function executeRalphCommand(
  args: string[],
  cwd: string
): Promise<{ success: boolean; stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const childProcess = spawn("ralph", args, {
      cwd,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (childProcess.stdout) {
      childProcess.stdout.on("data", (data: Buffer) => {
        stdout += data.toString();
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on("data", (data: Buffer) => {
        stderr += data.toString();
      });
    }

    childProcess.on("error", (error: Error) => {
      resolve({
        success: false,
        stdout: "",
        stderr: error.message,
        code: null,
      });
    });

    childProcess.on("exit", (code) => {
      resolve({
        success: code === 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        code,
      });
    });
  });
}

/**
 * PRD template for new streams
 */
const PRD_TEMPLATE = `# Product Requirements Document

## Overview
[Describe what we're building and why]

## User Stories

### [ ] US-001: [Story title]
**As a** [user type]
**I want** [feature]
**So that** [benefit]

#### Acceptance Criteria
- [ ] Criterion 1
`;

/**
 * POST /api/stream/new
 *
 * Create a new PRD-N stream folder.
 * Determines next available N by scanning existing PRD-* folders.
 * Creates .ralph/PRD-N/ directory with empty prd.md template.
 *
 * Returns:
 *   - 200 with { success: true, id: N, path: string }
 *   - 500 on error
 */
streamControl.post("/stream/new", (c) => {
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

  try {
    // Scan existing PRD-* folders to determine next available N
    const entries = fs.readdirSync(ralphRoot, { withFileTypes: true });
    let maxId = 0;

    for (const entry of entries) {
      const match = entry.name.match(/^PRD-(\d+)$/i);
      if (entry.isDirectory() && match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) {
          maxId = id;
        }
      }
    }

    const nextId = maxId + 1;
    const streamPath = path.join(ralphRoot, `PRD-${nextId}`);
    const prdPath = path.join(streamPath, "prd.md");

    // Create the directory
    fs.mkdirSync(streamPath, { recursive: true });

    // Create the prd.md file with template
    fs.writeFileSync(prdPath, PRD_TEMPLATE, "utf-8");

    return c.json({
      success: true,
      id: nextId,
      path: streamPath,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to create stream: ${errorMessage}`,
      },
      500
    );
  }
});

/**
 * POST /api/stream/:id/init
 *
 * Initialize git worktree for the stream.
 * Executes: `ralph stream init N` via child_process.spawn
 *
 * Returns:
 *   - 200 on success
 *   - 404 if stream doesn't exist
 *   - 500 on error
 */
streamControl.post("/stream/:id/init", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

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

  // Project root is the parent of .ralph
  const projectRoot = path.dirname(ralphRoot);

  const result = await executeRalphCommand(["stream", "init", id], projectRoot);

  if (result.success) {
    return c.json({
      success: true,
      message: `Stream PRD-${id} worktree initialized`,
      output: result.stdout,
    });
  } else {
    return c.json(
      {
        error: result.code === null ? "spawn_error" : "command_failed",
        message:
          result.code === null
            ? `Failed to spawn ralph command: ${result.stderr}`
            : `ralph stream init ${id} failed with exit code ${result.code}`,
        stderr: result.stderr,
      },
      500
    );
  }
});

/**
 * POST /api/stream/:id/merge
 *
 * Merge stream back to main branch.
 * Executes: `ralph stream merge N` via child_process.spawn
 *
 * Returns:
 *   - 200 on success
 *   - 404 if stream doesn't exist
 *   - 500 on error
 */
streamControl.post("/stream/:id/merge", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

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

  // Project root is the parent of .ralph
  const projectRoot = path.dirname(ralphRoot);

  const result = await executeRalphCommand(["stream", "merge", id], projectRoot);

  if (result.success) {
    return c.json({
      success: true,
      message: `Stream PRD-${id} merged to main`,
      output: result.stdout,
    });
  } else {
    return c.json(
      {
        error: result.code === null ? "spawn_error" : "command_failed",
        message:
          result.code === null
            ? `Failed to spawn ralph command: ${result.stderr}`
            : `ralph stream merge ${id} failed with exit code ${result.code}`,
        stderr: result.stderr,
      },
      500
    );
  }
});

/**
 * POST /api/stream/:id/build
 *
 * Start build in specific stream context.
 * Request body: { iterations: number, agent?: string, noCommit?: boolean }
 * Uses processManager.startBuild() with stream option set.
 *
 * Returns:
 *   - 200 with build status
 *   - 404 if stream doesn't exist
 *   - 409 if already running
 */
streamControl.post("/stream/:id/build", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Parse request body
  let body: { iterations?: number; agent?: string; noCommit?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: "bad_request",
        message: "Invalid JSON body",
      },
      400
    );
  }

  // Validate iterations
  const iterations = body.iterations;
  if (!iterations || typeof iterations !== "number" || iterations < 1) {
    return c.json(
      {
        error: "bad_request",
        message: "iterations must be a positive number",
      },
      400
    );
  }

  // Validate agent if provided
  const validAgents = ["claude", "codex", "droid"];
  if (body.agent && !validAgents.includes(body.agent)) {
    return c.json(
      {
        error: "bad_request",
        message: `agent must be one of: ${validAgents.join(", ")}`,
      },
      400
    );
  }

  // Build options with stream set
  const options: Partial<BuildOptions> = {
    stream: id,
    agent: body.agent as BuildOptions["agent"],
    noCommit: body.noCommit,
  };

  // Check budget before starting build
  const budgetStatus = getBudgetStatus();
  if (budgetStatus.shouldPause) {
    let reason = "Budget exceeded";
    if (budgetStatus.daily.exceeded && budgetStatus.daily.limit !== null) {
      reason = `Daily budget exceeded ($${budgetStatus.daily.spent.toFixed(2)}/$${budgetStatus.daily.limit.toFixed(2)})`;
    } else if (budgetStatus.monthly.exceeded && budgetStatus.monthly.limit !== null) {
      reason = `Monthly budget exceeded ($${budgetStatus.monthly.spent.toFixed(2)}/$${budgetStatus.monthly.limit.toFixed(2)})`;
    }
    return c.json(
      {
        error: "budget_exceeded",
        message: `${reason}. Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
      },
      403
    );
  }

  // Start the build using process manager
  const status = processManager.startBuild(iterations, options);

  // Check if build was started successfully or if already running
  if (status.error && status.state === "running") {
    return c.json(
      {
        error: "conflict",
        message: "A build is already running",
        status: {
          state: status.state,
          pid: status.pid,
          startedAt: status.startedAt?.toISOString(),
          command: status.command,
        },
      },
      409
    );
  }

  if (status.state === "error") {
    return c.json(
      {
        error: "start_failed",
        message: status.error || "Failed to start build",
      },
      500
    );
  }

  return c.json({
    success: true,
    message: `Build started for stream PRD-${id}`,
    status: {
      state: status.state,
      pid: status.pid,
      startedAt: status.startedAt?.toISOString(),
      command: status.command,
      options: status.options,
    },
  });
});

/**
 * POST /api/stream/:id/stop
 *
 * Stop a running build for a specific stream.
 * Request body: { force?: boolean }
 *   - force: false (default) = graceful stop (SIGTERM, waits for current iteration)
 *   - force: true = immediate termination (SIGKILL)
 *
 * Returns:
 *   - 200 with stop status
 *   - 404 if stream doesn't exist
 *   - 409 if stream not running
 */
streamControl.post("/stream/:id/stop", async (c) => {
  const id = c.req.param("id");

  // Validate stream exists
  const stream = getStreamDetails(id);
  if (!stream) {
    return c.json(
      {
        error: "not_found",
        message: `Stream PRD-${id} not found`,
      },
      404
    );
  }

  // Check if stream is running
  if (stream.status !== "running") {
    return c.json(
      {
        error: "not_running",
        message: `Stream PRD-${id} is not currently running`,
      },
      409
    );
  }

  // Parse request body
  let body: { force?: boolean } = {};
  try {
    body = await c.req.json();
  } catch {
    // No body or invalid JSON is okay, defaults to graceful stop
  }

  const force = body.force === true;

  // Stop the build
  const status = force ? processManager.killBuild() : processManager.stopBuild();

  if (status.state === "idle" && status.error) {
    return c.json(
      {
        error: "not_running",
        message: status.error,
      },
      409
    );
  }

  if (status.state === "error") {
    return c.json(
      {
        error: "stop_failed",
        message: status.error || "Failed to stop build",
      },
      500
    );
  }

  return c.json({
    success: true,
    message: force
      ? `Build for PRD-${id} terminated immediately`
      : `Stop signal sent to PRD-${id} build (will complete current iteration)`,
    status: {
      state: status.state,
      pid: status.pid,
      startedAt: status.startedAt?.toISOString(),
      command: status.command,
    },
  });
});

/**
 * POST /api/streams/:id/close
 *
 * Mark a stream as closed (inactive). Creates a .closed marker file.
 * Only allowed for streams at 0% completion that are not running, merged, or completed.
 *
 * Returns:
 *   - 200 on success
 *   - 400 if stream has progress or is in an invalid state
 *   - 404 if stream not found
 */
streamControl.post("/streams/:id/close", async (c) => {
  const streamId = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_initialized", message: "Ralph not initialized" }, 500);
  }

  const streamPath = path.join(ralphRoot, `PRD-${streamId}`);

  if (!fs.existsSync(streamPath)) {
    return c.json({ error: "not_found", message: `Stream PRD-${streamId} not found` }, 404);
  }

  // Get stream details to validate state
  const streams = getStreams();
  const stream = streams.find((s) => s.id === streamId);

  if (!stream) {
    return c.json({ error: "not_found", message: `Stream PRD-${streamId} not found` }, 404);
  }

  // Validate: can only close streams at 0% that are not running/merged/completed
  if (stream.completedStories > 0) {
    return c.json(
      { error: "invalid_state", message: "Cannot close stream with completed stories" },
      400
    );
  }

  if (stream.status === "running") {
    return c.json({ error: "invalid_state", message: "Cannot close a running stream" }, 400);
  }

  if (stream.merged) {
    return c.json({ error: "invalid_state", message: "Cannot close a merged stream" }, 400);
  }

  if (stream.status === "completed") {
    return c.json({ error: "invalid_state", message: "Cannot close a completed stream" }, 400);
  }

  // Create .closed marker file
  const closedMarkerPath = path.join(streamPath, ".closed");
  try {
    fs.writeFileSync(closedMarkerPath, new Date().toISOString());
    return c.json({ success: true, message: `Stream PRD-${streamId} closed` });
  } catch (error) {
    return c.json(
      { error: "write_failed", message: `Failed to create .closed marker: ${error}` },
      500
    );
  }
});

/**
 * POST /api/streams/:id/restore
 *
 * Restore a closed stream by removing the .closed marker file.
 *
 * Returns:
 *   - 200 on success
 *   - 404 if stream not found or not closed
 */
streamControl.post("/streams/:id/restore", async (c) => {
  const streamId = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_initialized", message: "Ralph not initialized" }, 500);
  }

  const streamPath = path.join(ralphRoot, `PRD-${streamId}`);
  const closedMarkerPath = path.join(streamPath, ".closed");

  if (!fs.existsSync(closedMarkerPath)) {
    return c.json(
      { error: "not_found", message: `Stream PRD-${streamId} is not closed` },
      404
    );
  }

  try {
    fs.unlinkSync(closedMarkerPath);
    return c.json({ success: true, message: `Stream PRD-${streamId} restored` });
  } catch (error) {
    return c.json(
      { error: "delete_failed", message: `Failed to remove .closed marker: ${error}` },
      500
    );
  }
});
