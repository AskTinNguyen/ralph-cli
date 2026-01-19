/**
 * Build Control API Routes
 *
 * REST API endpoints for starting, stopping, and monitoring Ralph builds.
 * Also includes plan start endpoint.
 */

import { Hono } from "hono";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { BuildOptions } from "../../types.js";
import { getRalphRoot } from "../../services/state-reader.js";
import { processManager } from "../../services/process-manager.js";
import { getBudgetStatus } from "../../services/token-reader.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { saveEstimate } = require("../../../../lib/estimate/accuracy.js");
const { estimate } = require("../../../../lib/estimate/index.js");

/**
 * Valid agent types for builds
 */
export const VALID_AGENTS = ["claude", "codex", "droid"] as const;

const buildApi = new Hono();

/**
 * POST /build/start
 *
 * Start a new build process.
 * Request body: { iterations: number, stream?: string, agent?: string, noCommit?: boolean }
 *
 * Returns:
 *   - 200 with { success: true, status: BuildStatus } on success
 *   - 400 for invalid parameters
 *   - 409 Conflict if build already running
 */
buildApi.post("/build/start", async (c) => {
  let body: {
    iterations?: number;
    stream?: string;
    agent?: string;
    noCommit?: boolean;
  };

  const contentType = c.req.header("content-type") || "";
  try {
    if (contentType.includes("application/json")) {
      body = await c.req.json();
    } else {
      const formData = await c.req.parseBody();
      body = {
        iterations: formData.iterations
          ? parseInt(formData.iterations as string, 10)
          : undefined,
        stream:
          formData.stream && formData.stream !== ""
            ? (formData.stream as string)
            : undefined,
        agent: formData.agent as string | undefined,
        noCommit: formData.noCommit === "true" || formData.noCommit === "on",
      };
    }
  } catch {
    return c.json(
      {
        error: "bad_request",
        message: "Invalid request body",
      },
      400
    );
  }

  const iterations = body.iterations;
  if (iterations === undefined || iterations === null) {
    return c.json(
      {
        error: "bad_request",
        message: "Missing required parameter: iterations",
      },
      400
    );
  }

  if (typeof iterations !== "number" || !Number.isInteger(iterations)) {
    return c.json(
      {
        error: "bad_request",
        message: "Parameter iterations must be an integer",
      },
      400
    );
  }

  if (iterations < 1 || iterations > 100) {
    return c.json(
      {
        error: "bad_request",
        message: "Parameter iterations must be between 1 and 100",
      },
      400
    );
  }

  if (body.agent !== undefined && body.agent !== null) {
    if (!VALID_AGENTS.includes(body.agent as (typeof VALID_AGENTS)[number])) {
      return c.json(
        {
          error: "bad_request",
          message: `Invalid agent: ${body.agent}. Must be one of: ${VALID_AGENTS.join(", ")}`,
        },
        400
      );
    }
  }

  if (processManager.isRunning()) {
    const currentStatus = processManager.getBuildStatus();
    return c.json(
      {
        error: "conflict",
        message:
          "A build is already running. Stop it first before starting a new one.",
        status: {
          state: currentStatus.state,
          pid: currentStatus.pid,
          startedAt: currentStatus.startedAt?.toISOString(),
          command: currentStatus.command,
          options: currentStatus.options,
        },
      },
      409
    );
  }

  const options: Partial<BuildOptions> = {};
  if (body.stream) {
    options.stream = body.stream;
  }
  if (body.agent) {
    options.agent = body.agent as BuildOptions["agent"];
  }
  if (body.noCommit !== undefined) {
    options.noCommit = body.noCommit;
  }

  const budgetStatus = getBudgetStatus();
  if (budgetStatus.shouldPause) {
    let reason = "Budget exceeded";
    if (budgetStatus.daily.exceeded && budgetStatus.daily.limit !== null) {
      reason = `Daily budget exceeded ($${budgetStatus.daily.spent.toFixed(2)}/$${budgetStatus.daily.limit.toFixed(2)})`;
    } else if (
      budgetStatus.monthly.exceeded &&
      budgetStatus.monthly.limit !== null
    ) {
      reason = `Monthly budget exceeded ($${budgetStatus.monthly.spent.toFixed(2)}/$${budgetStatus.monthly.limit.toFixed(2)})`;
    }
    return c.json(
      {
        error: "budget_exceeded",
        message: `${reason}. Set RALPH_BUDGET_PAUSE_ON_EXCEEDED=false in config.sh to override.`,
        budgetStatus: {
          daily: {
            spent: budgetStatus.daily.spent,
            limit: budgetStatus.daily.limit,
            exceeded: budgetStatus.daily.exceeded,
          },
          monthly: {
            spent: budgetStatus.monthly.spent,
            limit: budgetStatus.monthly.limit,
            exceeded: budgetStatus.monthly.exceeded,
          },
        },
      },
      403
    );
  }

  if (body.stream) {
    try {
      const ralphRoot = getRalphRoot();
      if (ralphRoot) {
        const prdFolder = path.join(ralphRoot, `PRD-${body.stream}`);
        const planPath = path.join(prdFolder, "plan.md");

        if (fs.existsSync(planPath)) {
          const estimateResult = estimate(prdFolder, {
            model: body.agent === "opus" ? "opus" : "sonnet",
          });

          if (estimateResult.success) {
            const saveResult = saveEstimate(prdFolder, estimateResult);
            if (saveResult.success) {
              console.log(
                `[AUTO-SAVE] Saved estimate for PRD-${body.stream} before build`
              );
            } else {
              console.warn(
                `[AUTO-SAVE] Failed to save estimate: ${saveResult.error}`
              );
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[AUTO-SAVE] Error saving estimate: ${err}`);
    }
  }

  const status = processManager.startBuild(iterations, options);

  if (status.state === "error") {
    return c.json(
      {
        error: "internal_error",
        message: status.error || "Failed to start build",
      },
      500
    );
  }

  return c.json({
    success: true,
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
 * POST /build/stop
 *
 * Stop the currently running build process.
 *
 * Returns:
 *   - 200 with { success: true } on success
 *   - 404 if no build is running
 */
buildApi.post("/build/stop", (c) => {
  if (!processManager.isRunning()) {
    return c.json(
      {
        error: "not_found",
        message: "No build is currently running",
      },
      404
    );
  }

  const status = processManager.stopBuild();

  if (status.error && status.state === "error") {
    return c.json(
      {
        error: "internal_error",
        message: status.error,
      },
      500
    );
  }

  return c.json({
    success: true,
    message: "Build stop signal sent",
  });
});

/**
 * GET /build/status
 *
 * Get the current build status.
 *
 * Returns:
 *   - 200 with current build state
 */
buildApi.get("/build/status", (c) => {
  const status = processManager.getBuildStatus();

  return c.json({
    state: status.state,
    pid: status.pid,
    startedAt: status.startedAt?.toISOString(),
    command: status.command,
    options: status.options,
    error: status.error,
  });
});

/**
 * POST /plan/start
 *
 * Start a new plan process (ralph plan command).
 * Request body: { stream?: string } - optional stream to plan for
 *
 * Note: This is a simplified implementation that runs ralph plan.
 * For a full implementation, the process manager would need to be
 * extended to handle plan processes separately from build processes.
 *
 * Returns:
 *   - 200 with { success: true, status: BuildStatus } on success
 *   - 409 Conflict if a process is already running
 */
buildApi.post("/plan/start", async (c) => {
  if (processManager.isRunning()) {
    const currentStatus = processManager.getBuildStatus();
    return c.json(
      {
        error: "conflict",
        message:
          "A process is already running. Stop it first before starting a new one.",
        status: {
          state: currentStatus.state,
          pid: currentStatus.pid,
          startedAt: currentStatus.startedAt?.toISOString(),
          command: currentStatus.command,
        },
      },
      409
    );
  }

  const ralphRoot = getRalphRoot();
  if (!ralphRoot) {
    return c.json(
      {
        error: "internal_error",
        message:
          'Cannot start plan: .ralph directory not found. Run "ralph install" first.',
      },
      500
    );
  }

  let body: { stream?: string } = {};
  try {
    body = await c.req.json();
  } catch {
    // Empty body is ok for plan
  }

  const projectRoot = path.dirname(ralphRoot);

  const args = ["plan"];
  if (body.stream) {
    args.push(`--prd=${body.stream}`);
  }

  try {
    const childProcess = spawn("ralph", args, {
      cwd: projectRoot,
      env: { ...process.env },
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    });

    if (!childProcess.pid) {
      return c.json(
        {
          error: "internal_error",
          message: "Failed to start plan process: no PID assigned",
        },
        500
      );
    }

    const command = `ralph ${args.join(" ")}`;
    console.log(`[API] Started plan: ${command} (PID: ${childProcess.pid})`);

    return c.json({
      success: true,
      status: {
        state: "running",
        pid: childProcess.pid,
        startedAt: new Date().toISOString(),
        command,
      },
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json(
      {
        error: "internal_error",
        message: `Failed to start plan: ${errorMessage}`,
      },
      500
    );
  }
});

export { buildApi };
