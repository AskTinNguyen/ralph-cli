/**
 * Agent API Routes
 *
 * REST API endpoints for agent availability and configuration.
 */

import { Hono } from "hono";
import {
  getCachedAgentAvailability,
  clearAgentCache,
} from "../../services/agent-checker.js";

const agents = new Hono();

/**
 * GET /agents
 *
 * Returns available agents with their status.
 *
 * Returns:
 *   - agents: Array of { name, id, available, version, path, suggestion }
 *   - default: ID of the default/recommended agent
 *   - availableCount: Number of available agents
 */
agents.get("/", (c) => {
  const availability = getCachedAgentAvailability();
  return c.json(availability);
});

/**
 * POST /agents/refresh
 *
 * Force refresh of agent availability cache.
 * Useful after installing a new agent.
 *
 * Returns:
 *   - Fresh agent availability status
 */
agents.post("/refresh", (c) => {
  clearAgentCache();
  const availability = getCachedAgentAvailability();
  return c.json(availability);
});

export { agents };
