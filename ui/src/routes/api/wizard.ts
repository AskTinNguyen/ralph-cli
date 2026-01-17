/**
 * Wizard API Routes
 *
 * REST API endpoints for the New Stream Wizard flow.
 * Supports PRD generation, plan generation, and real-time status streaming.
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import fs from "node:fs";
import path from "node:path";
import { getRalphRoot } from "../../services/state-reader.js";
import {
  wizardProcessManager,
  type WizardOutputEvent,
} from "../../services/wizard-process-manager.js";

const wizard = new Hono();

/**
 * POST /stream/wizard/start
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
wizard.post("/stream/wizard/start", async (c) => {
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

  let body: { description?: string } = {};
  try {
    const contentType = c.req.header("content-type") || "";
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    }
  } catch {
    // Proceed with empty description
  }

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

    const processPid = result.pid;

    // Wait for the PRD folder to be created (ralph prd outputs this early)
    const streamId = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout waiting for PRD folder creation"));
      }, 10000);

      if (result.eventEmitter) {
        result.eventEmitter.once(
          "prd-created",
          async (data: { streamId: string }) => {
            clearTimeout(timeout);
            console.log(`[API] PRD-${data.streamId} creation announced`);

            const expectedPath = path.join(ralphRoot, `PRD-${data.streamId}`);
            const maxRetries = 10;
            const retryDelay = 200;

            for (let i = 0; i < maxRetries; i++) {
              if (fs.existsSync(expectedPath)) {
                console.log(`[API] PRD-${data.streamId} folder verified`);
                resolve(data.streamId);
                return;
              }
              await new Promise((r) => setTimeout(r, retryDelay));
            }

            reject(new Error(`PRD-${data.streamId} folder not found on disk`));
          }
        );

        result.eventEmitter.once(
          "error",
          (event: { data: { message?: string } }) => {
            clearTimeout(timeout);
            reject(new Error(event.data.message || "PRD generation failed"));
          }
        );
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
 * GET /stream/:id/generation-status
 *
 * Get the current generation status for a stream.
 * Checks if ralph process is running, and file existence for completion.
 *
 * Returns:
 *   - 200 with { status, phase?, progress?, error? }
 *   - 404 if stream doesn't exist
 */
wizard.get("/stream/:id/generation-status", (c) => {
  const id = c.req.param("id");

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

  const status = wizardProcessManager.getStatus(id);

  if (status.status === "idle") {
    const prdPath = path.join(streamPath, "prd.md");
    const planPath = path.join(streamPath, "plan.md");

    const hasPrd = fs.existsSync(prdPath);
    const hasPlan = fs.existsSync(planPath);

    let prdHasContent = false;
    if (hasPrd) {
      try {
        const content = fs.readFileSync(prdPath, "utf-8");
        prdHasContent = content.includes("US-001") && content.length > 500;
      } catch {
        // Ignore read errors
      }
    }

    let phase: string;
    if (hasPlan) {
      phase = "complete";
    } else if (hasPrd && prdHasContent) {
      phase = "prd_complete";
    } else {
      phase = "not_started";
    }

    return c.json({
      status: "idle",
      prdExists: hasPrd,
      prdHasContent,
      planExists: hasPlan,
      phase,
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
 * POST /stream/:id/cancel
 *
 * Cancel an ongoing generation process for a stream.
 * Stops the running PRD or plan generation process.
 */
wizard.post("/stream/:id/cancel", (c) => {
  const id = c.req.param("id");

  const result = wizardProcessManager.cancel(id);

  if (result.success) {
    return c.json({ success: true, message: result.message });
  }

  return c.json({ error: "cancel_failed", message: result.message }, 400);
});

/**
 * POST /wizard/cancel-pid/:pid
 *
 * Cancel a generation process by its PID.
 * More reliable than stream-based cancellation as PID is available immediately
 * after process starts, before the stream ID is determined.
 */
wizard.post("/wizard/cancel-pid/:pid", (c) => {
  const pidStr = c.req.param("pid");
  const pid = parseInt(pidStr, 10);

  if (isNaN(pid) || pid <= 0) {
    return c.json({ error: "invalid_pid", message: "Invalid PID" }, 400);
  }

  const result = wizardProcessManager.cancelByPid(pid);

  if (result.success) {
    return c.json({ success: true, message: result.message });
  }

  return c.json({ error: "cancel_failed", message: result.message }, 400);
});

/**
 * GET /stream/:id/prd
 *
 * Get the PRD content for a stream.
 * Returns the raw markdown content of the prd.md file.
 */
wizard.get("/stream/:id/prd", (c) => {
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
 * PUT /stream/:id/prd
 *
 * Update the PRD content for a stream.
 * Overwrites the prd.md file with the provided content.
 */
wizard.put("/stream/:id/prd", async (c) => {
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
 * POST /stream/:id/generate-plan
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
wizard.post("/stream/:id/generate-plan", (c) => {
  const id = c.req.param("id");

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

  if (wizardProcessManager.isGenerating(id)) {
    return c.json(
      {
        error: "conflict",
        message: "Generation already in progress for this stream",
      },
      409
    );
  }

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
 * GET /stream/:id/generation-stream
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
wizard.get("/stream/:id/generation-stream", (c) => {
  const id = c.req.param("id");
  const generationType = c.req.query("type") as "prd" | "plan" | undefined;

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
    let eventEmitter = wizardProcessManager.getEventEmitter(id);
    let isConnected = true;

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

    if (!eventEmitter) {
      const status = wizardProcessManager.getStatus(id);
      try {
        const eventType = status.status === "complete" ? "complete" : "idle";
        const message =
          status.status === "complete"
            ? "Generation already complete"
            : "No active generation";
        await stream.writeSSE({
          event: eventType,
          data: JSON.stringify({
            streamId: id,
            status: status.status,
            phase: status.phase,
            message,
            timestamp: new Date().toISOString(),
          }),
        });
      } catch {
        // Ignore
      }
      return;
    }

    const handlers: {
      event: string;
      handler: (event: WizardOutputEvent) => Promise<void>;
    }[] = [];

    function createHandler(
      eventType: string
    ): (event: WizardOutputEvent) => Promise<void> {
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
    }

    for (const eventType of ["phase", "output", "complete", "error"]) {
      const handler = createHandler(eventType);
      handlers.push({ event: eventType, handler });
      eventEmitter.on(eventType, handler);
    }

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

    try {
      while (isConnected && wizardProcessManager.isGenerating(id)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      if (isConnected) {
        const finalStatus = wizardProcessManager.getStatus(id);
        const eventType =
          finalStatus.status === "complete" ? "complete" : "status";
        await stream.writeSSE({
          event: eventType,
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

    isConnected = false;
    clearInterval(heartbeatInterval);

    for (const { event, handler } of handlers) {
      eventEmitter?.off(event, handler);
    }

    console.log(`[SSE] Generation stream for PRD-${id} disconnected`);
  });
});

/**
 * POST /stream/:id/generation-cancel
 *
 * Cancel an in-progress generation.
 * Kills the ralph process if running.
 *
 * Returns:
 *   - 200 with { success: true }
 *   - 404 if stream doesn't exist
 *   - 409 if no generation in progress
 */
wizard.post("/stream/:id/generation-cancel", (c) => {
  const id = c.req.param("id");

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

  if (!wizardProcessManager.isGenerating(id)) {
    return c.json(
      {
        error: "conflict",
        message: "No generation in progress for this stream",
      },
      409
    );
  }

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

export { wizard };
