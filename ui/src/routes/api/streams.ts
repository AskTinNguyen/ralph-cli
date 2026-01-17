/**
 * Stream API Routes
 *
 * REST API endpoints for stream CRUD operations.
 * Provides listing, detail views, stories, runs, and workflow graph data.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { getStreams, getStreamDetails, getRalphRoot } from "../../services/state-reader.js";
import { countStoriesByStatus } from "../../services/markdown-parser.js";

const streams = new Hono();

/**
 * GET /
 *
 * Returns all streams with status information.
 */
streams.get("/", (c) => {
  const allStreams = getStreams();

  const response = allStreams.map((stream) => ({
    id: stream.id,
    name: stream.name,
    status: stream.status,
    hasPrd: stream.hasPrd,
    hasPlan: stream.hasPlan,
    hasProgress: stream.hasProgress,
    totalStories: stream.totalStories,
    completedStories: stream.completedStories,
    completionPercentage:
      stream.totalStories > 0
        ? Math.round((stream.completedStories / stream.totalStories) * 100)
        : 0,
  }));

  return c.json({
    streams: response,
    count: allStreams.length,
  });
});

/**
 * GET /:id
 *
 * Returns detailed information for a specific stream.
 */
streams.get("/:id", (c) => {
  const id = c.req.param("id");

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

  const completionPercentage =
    stream.totalStories > 0
      ? Math.round((stream.completedStories / stream.totalStories) * 100)
      : 0;

  const inProgressStories = stream.stories.filter((s) => s.status === "in-progress").length;
  const pendingStories = stream.stories.filter((s) => s.status === "pending").length;

  return c.json({
    id: stream.id,
    name: stream.name,
    path: stream.path,
    status: stream.status,
    hasPrd: stream.hasPrd,
    hasPlan: stream.hasPlan,
    hasProgress: stream.hasProgress,
    stories: stream.stories,
    stats: {
      total: stream.totalStories,
      completed: stream.completedStories,
      inProgress: inProgressStories,
      pending: pendingStories,
      completionPercentage,
    },
    runs: stream.runs.map((run) => ({
      id: run.id,
      iteration: run.iteration,
      startedAt: run.startedAt.toISOString(),
      status: run.status,
      storyId: run.storyId,
      storyTitle: run.storyTitle,
      logPath: run.logPath,
      hasSummary: !!run.summaryPath,
    })),
    lastRun: stream.lastRun
      ? {
          id: stream.lastRun.id,
          iteration: stream.lastRun.iteration,
          startedAt: stream.lastRun.startedAt.toISOString(),
          status: stream.lastRun.status,
        }
      : null,
  });
});

/**
 * GET /:id/workflow-graph
 *
 * Get workflow graph data for visualization (Cytoscape.js format)
 *
 * Returns:
 *   - dispatcher: Dispatcher node (PRD) data
 *   - stats: Story and agent statistics
 *   - elements: Cytoscape graph elements (nodes + edges)
 */
streams.get("/:id/workflow-graph", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json({ error: "not_found", message: "Ralph root not found" }, 404);
  }

  const prdDir = path.join(ralphRoot, `PRD-${id}`);
  const planPath = path.join(prdDir, "plan.md");
  const progressPath = path.join(prdDir, "progress.md");
  const statusPath = path.join(prdDir, ".status.json");

  // Also check worktree paths
  const worktreePrdDir = path.join(ralphRoot, "worktrees", `PRD-${id}`, ".ralph", `PRD-${id}`);
  const worktreePlanPath = path.join(worktreePrdDir, "plan.md");
  const worktreeProgressPath = path.join(worktreePrdDir, "progress.md");
  const worktreeStatusPath = path.join(worktreePrdDir, ".status.json");

  // Use worktree paths if they exist
  const effectivePlanPath = fs.existsSync(worktreePlanPath) ? worktreePlanPath : planPath;
  const effectiveProgressPath = fs.existsSync(worktreeProgressPath)
    ? worktreeProgressPath
    : progressPath;
  const effectiveStatusPath = fs.existsSync(worktreeStatusPath) ? worktreeStatusPath : statusPath;

  if (!fs.existsSync(effectivePlanPath)) {
    return c.json({ error: "not_found", message: "Plan file not found" }, 404);
  }

  try {
    // Parse plan.md to get all stories
    const planContent = fs.readFileSync(effectivePlanPath, "utf-8");

    // Parse stories from plan.md (format: ### US-XXX: Title or ### [ ] US-XXX: Title)
    const stories: { id: string; title: string; status: string; acceptanceCriteria: unknown[] }[] =
      [];
    const lines = planContent.split("\n");

    for (const line of lines) {
      // Match story headings with or without checkbox
      const storyMatch = line.match(/^###\s*(?:\[([ xX])\]\s*)?(US-\d+):\s*(.+)$/i);

      if (storyMatch) {
        const checkbox = storyMatch[1];
        const storyId = storyMatch[2].toUpperCase();
        const storyTitle = storyMatch[3].trim();
        const isCompleted = checkbox && checkbox.toLowerCase() === "x";

        stories.push({
          id: storyId,
          title: storyTitle,
          status: isCompleted ? "completed" : "pending",
          acceptanceCriteria: [],
        });
      }
    }

    // Parse progress.md to get completion status
    const progressStories = new Map<string, { status: string; progress: number }>();
    if (fs.existsSync(effectiveProgressPath)) {
      const progressContent = fs.readFileSync(effectiveProgressPath, "utf-8");
      const progressLines = progressContent.split("\n");

      for (const line of progressLines) {
        const storyMatch = line.match(/^##\s*\[([ xX])\]\s*(US-\d+):/i);
        if (storyMatch) {
          const storyId = storyMatch[2].toUpperCase();
          const isCompleted = storyMatch[1].toLowerCase() === "x";
          progressStories.set(storyId, {
            status: isCompleted ? "completed" : "in_progress",
            progress: isCompleted ? 1.0 : 0.5,
          });
        }
      }
    }

    // Get current build status
    let currentStoryId: string | null = null;
    let currentIteration = 0;
    let currentModel = "sonnet";

    if (fs.existsSync(effectiveStatusPath)) {
      const statusContent = fs.readFileSync(effectiveStatusPath, "utf-8");
      const status = JSON.parse(statusContent);
      currentStoryId = status.story_id || null;
      currentIteration = status.iteration || 0;
      currentModel = status.model || "sonnet";
    }

    // Build graph nodes
    const nodes: unknown[] = [];
    const edges: unknown[] = [];

    // Dispatcher node (PRD)
    const dispatcherId = `PRD-${id}`;
    const completedCount = stories.filter(
      (s) => progressStories.get(s.id)?.status === "completed" || s.status === "completed"
    ).length;

    nodes.push({
      data: {
        id: dispatcherId,
        type: "dispatcher",
        label: `PRD-${id}`,
        total_stories: stories.length,
        completed_stories: completedCount,
      },
      classes: ["dispatcher", "status-running"],
    });

    // Story nodes
    let inProgressCount = 0;
    for (const story of stories) {
      const progressData = progressStories.get(story.id);
      const status = progressData?.status || story.status || "ready";
      const progress = progressData?.progress || 0;

      if (status === "in_progress") {
        inProgressCount++;
      }

      nodes.push({
        data: {
          id: story.id,
          type: "story",
          label: story.title.substring(0, 30) + (story.title.length > 30 ? "..." : ""),
          status: status,
          progress: progress,
          iterations: 0,
          cost: 0,
        },
        classes: ["story", `status-${status}`],
      });

      // Edge from dispatcher to story
      edges.push({
        data: {
          id: `edge-${dispatcherId}-to-${story.id}`,
          source: dispatcherId,
          target: story.id,
          type: "story-path",
        },
        classes: [],
      });
    }

    // Add active agent node if there's a running build
    let activeAgents = 0;
    if (currentStoryId && currentIteration > 0) {
      const agentId = `agent-${id}-${currentStoryId}-active`;
      nodes.push({
        data: {
          id: agentId,
          type: "agent",
          label: `Iter ${currentIteration}`,
          parent_story: currentStoryId,
          model: currentModel,
          tokens_budget: 50000,
          tokens_used: 0,
          elapsed_seconds: 0,
          phase: "executing",
        },
        classes: ["agent", `model-${currentModel}`],
      });

      // Edge from dispatcher to current story (active path)
      edges.push({
        data: {
          id: `edge-active-${agentId}`,
          source: dispatcherId,
          target: currentStoryId,
          type: "agent-path",
        },
        classes: ["active"],
      });

      activeAgents = 1;
    }

    // Return graph data
    return c.json({
      dispatcher_id: dispatcherId,
      dispatcher: {
        id: dispatcherId,
        label: `PRD-${id}`,
        total_stories: stories.length,
        completed_stories: completedCount,
      },
      stats: {
        total_stories: stories.length,
        completed_stories: completedCount,
        inprogress_stories: inProgressCount,
        active_agents: activeAgents,
      },
      elements: {
        nodes: nodes,
        edges: edges,
      },
    });
  } catch (error: unknown) {
    console.error("Error generating workflow graph:", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "internal_error", message }, 500);
  }
});

export { streams };
