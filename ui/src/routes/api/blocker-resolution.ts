/**
 * Blocker Resolution API
 *
 * Handles manual blocker resolution with tracking
 * Part of PRD-112 US-005: Manual blocker resolution with tracking
 */

import { Hono } from "hono";
import path from "path";
import fs from "fs";

const blockerResolution = new Hono();

/**
 * Load blocker status for a PRD
 */
function loadBlockerStatus(prdId: number) {
  const ralphRoot = process.env.RALPH_ROOT || path.join(__dirname, "../../../.ralph");
  const blocker_path = path.join(ralphRoot, `PRD-${prdId}`, "blocker-status.json");

  if (!fs.existsSync(blocker_path)) {
    return null;
  }

  try {
    const content = fs.readFileSync(blocker_path, "utf-8");
    return JSON.parse(content);
  } catch (error) {
    console.error(`[Blocker API] Failed to load blocker status: ${error}`);
    return null;
  }
}

/**
 * Save blocker status for a PRD
 */
function saveBlockerStatus(prdId: number, status: any) {
  const ralphRoot = process.env.RALPH_ROOT || path.join(__dirname, "../../../.ralph");
  const blocker_path = path.join(ralphRoot, `PRD-${prdId}`, "blocker-status.json");

  try {
    fs.writeFileSync(blocker_path, JSON.stringify(status, null, 2));
    return true;
  } catch (error) {
    console.error(`[Blocker API] Failed to save blocker status: ${error}`);
    return false;
  }
}

/**
 * Feed resolution data into bug wikipedia for pattern analysis
 */
function feedResolutionToBugWikipedia(prdId: number, resolution: any) {
  const ralphRoot = process.env.RALPH_ROOT || path.join(__dirname, "../../../.ralph");
  const bugWikipediaDir = path.join(ralphRoot, "bug-wikipedia");

  // Create bug-wikipedia directory if it doesn't exist
  if (!fs.existsSync(bugWikipediaDir)) {
    fs.mkdirSync(bugWikipediaDir, { recursive: true });
  }

  // Create resolutions directory
  const resolutionsDir = path.join(bugWikipediaDir, "blocker-resolutions");
  if (!fs.existsSync(resolutionsDir)) {
    fs.mkdirSync(resolutionsDir, { recursive: true });
  }

  // Store resolution data with timestamp and PRD ID
  const timestamp = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const resolutionFile = path.join(resolutionsDir, `resolution-prd${prdId}-${timestamp}.json`);

  try {
    const resolutionData = {
      prd_id: prdId,
      resolution_reason: resolution.resolution_reason,
      escalation_level_at_resolution: resolution.escalation_level_at_resolution,
      time_to_resolution_hours: resolution.time_to_resolution_hours,
      resolved_at: resolution.resolved_at,
      alerted_users: resolution.alerted_users,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(resolutionFile, JSON.stringify(resolutionData, null, 2));
    console.log(`[Blocker API] Resolution data fed to bug-wikipedia for PRD-${prdId}`);
    return true;
  } catch (error) {
    console.error(`[Blocker API] Failed to feed resolution to bug-wikipedia: ${error}`);
    return false;
  }
}

/**
 * POST /api/resolve-blocker
 *
 * Manually resolve a blocker and document what fixed it
 *
 * Request body:
 * {
 *   "prd_id": 112,
 *   "reason": "Fixed dependency version conflict"
 * }
 */
blockerResolution.post("/", async (c) => {
  try {
    const body = await c.req.json();
    const { prd_id, reason } = body;

    // Validate inputs
    if (!prd_id || typeof prd_id !== "number") {
      return c.json({ error: "Missing or invalid prd_id" }, 400);
    }

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return c.json({ error: "Missing or invalid reason" }, 400);
    }

    // Load current blocker status
    const status = loadBlockerStatus(prd_id);
    if (!status) {
      return c.json({ error: `No blocker found for PRD-${prd_id}` }, 404);
    }

    // Update status with resolution info
    const now = new Date().toISOString();
    const escalation_level = status.escalation_level || 0;
    const alerted_users = status.escalation_history?.[status.escalation_history.length - 1]?.alerted || [];

    // Calculate time from blocker detection to resolution
    let time_to_resolution_hours = 0;
    if (status.blocker_since) {
      const blockerStart = new Date(status.blocker_since);
      const resolutionEnd = new Date(now);
      const diffMs = resolutionEnd.getTime() - blockerStart.getTime();
      time_to_resolution_hours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // Round to 2 decimals
    }

    const updated_status = {
      ...status,
      resolved_at: now,
      resolved_by: "manual",
      resolution_reason: reason,
      escalation_level_at_resolution: escalation_level,
      alerted_users,
      time_to_resolution_hours,
      is_blocked: false,
      may_be_resolved: false, // Clear the may_be_resolved flag when manually confirmed
    };

    // Save updated status
    if (!saveBlockerStatus(prd_id, updated_status)) {
      return c.json({ error: "Failed to save blocker status" }, 500);
    }

    // Feed resolution data into bug wikipedia for pattern analysis
    feedResolutionToBugWikipedia(prd_id, {
      resolution_reason: reason,
      escalation_level_at_resolution: escalation_level,
      time_to_resolution_hours,
      resolved_at: now,
      alerted_users,
    });

    return c.json({
      success: true,
      prd_id,
      resolved_at: now,
      reason,
      escalation_level_at_resolution: escalation_level,
      time_to_resolution_hours,
      alerted_users,
    });
  } catch (error: any) {
    console.error("[Blocker API] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

/**
 * GET /api/resolve-blocker/:prd_id
 *
 * Get blocker status for a specific PRD
 */
blockerResolution.get("/:prd_id", (c) => {
  try {
    const prd_id = parseInt(c.req.param("prd_id"), 10);

    if (isNaN(prd_id)) {
      return c.json({ error: "Invalid prd_id" }, 400);
    }

    const status = loadBlockerStatus(prd_id);
    if (!status) {
      return c.json({ error: `No blocker found for PRD-${prd_id}` }, 404);
    }

    return c.json({
      prd_id,
      is_blocked: status.is_blocked,
      blocker_since: status.blocker_since,
      days_blocked: status.days_blocked,
      escalation_level: status.escalation_level,
      escalation_level_name: status.escalation_level_name,
      resolved_at: status.resolved_at || null,
      resolution_reason: status.resolution_reason || null,
      alerted_users: status.alerted_users || [],
    });
  } catch (error: any) {
    console.error("[Blocker API] Error:", error);
    return c.json({ error: error.message }, 500);
  }
});

export default blockerResolution;
