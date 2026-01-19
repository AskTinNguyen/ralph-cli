/**
 * Workflow Graph API Routes
 *
 * REST API endpoint for workflow graph visualization data.
 * Provides Cytoscape.js-compatible graph elements for stream visualization.
 */

import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { getRalphRoot } from "../../services/state-reader.js";

const workflowApi = new Hono();

interface StoryData {
  id: string;
  title: string;
  status: string;
  acceptanceCriteria: unknown[];
}

interface GraphNode {
  data: {
    id: string;
    type: string;
    label: string;
    [key: string]: unknown;
  };
  classes: string[];
}

interface GraphEdge {
  data: {
    id: string;
    source: string;
    target: string;
    type: string;
  };
  classes: string[];
}

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
workflowApi.get("/:id/workflow-graph", (c) => {
  const id = c.req.param("id");
  const ralphRoot = getRalphRoot();

  if (!ralphRoot) {
    return c.json(
      { error: "not_found", message: "Ralph root not found" },
      404
    );
  }

  const prdDir = path.join(ralphRoot, `PRD-${id}`);
  const planPath = path.join(prdDir, "plan.md");
  const progressPath = path.join(prdDir, "progress.md");
  const statusPath = path.join(prdDir, ".status.json");

  // Also check worktree paths
  const worktreePrdDir = path.join(
    ralphRoot,
    "worktrees",
    `PRD-${id}`,
    ".ralph",
    `PRD-${id}`
  );
  const worktreePlanPath = path.join(worktreePrdDir, "plan.md");
  const worktreeProgressPath = path.join(worktreePrdDir, "progress.md");
  const worktreeStatusPath = path.join(worktreePrdDir, ".status.json");

  // Use worktree paths if they exist
  const effectivePlanPath = fs.existsSync(worktreePlanPath)
    ? worktreePlanPath
    : planPath;
  const effectiveProgressPath = fs.existsSync(worktreeProgressPath)
    ? worktreeProgressPath
    : progressPath;
  const effectiveStatusPath = fs.existsSync(worktreeStatusPath)
    ? worktreeStatusPath
    : statusPath;

  if (!fs.existsSync(effectivePlanPath)) {
    return c.json(
      { error: "not_found", message: "Plan file not found" },
      404
    );
  }

  try {
    // Parse plan.md to get all stories
    const planContent = fs.readFileSync(effectivePlanPath, "utf-8");

    // Parse stories from plan.md (format: ### US-XXX: Title or ### [ ] US-XXX: Title)
    const stories: StoryData[] = [];
    const lines = planContent.split("\n");

    for (const line of lines) {
      // Match story headings with or without checkbox
      // Pattern: ### US-001: Title or ### [ ] US-001: Title or ### [x] US-001: Title
      const storyMatch = line.match(
        /^###\s*(?:\[([ xX])\]\s*)?(US-\d+):\s*(.+)$/i
      );

      if (storyMatch) {
        const checkbox = storyMatch[1]; // May be undefined for plan.md format
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
    const progressStories = new Map<
      string,
      { status: string; progress: number }
    >();
    if (fs.existsSync(effectiveProgressPath)) {
      const progressContent = fs.readFileSync(effectiveProgressPath, "utf-8");
      const progressLines = progressContent.split("\n");

      for (const line of progressLines) {
        // Match story completion markers: ## [x] US-001: Title or ## [ ] US-001: Title
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
      // Try to infer model from status (may not be available)
      currentModel = status.model || "sonnet";
    }

    // Build graph nodes
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];

    // Dispatcher node (PRD)
    const dispatcherId = `PRD-${id}`;
    const completedCount = stories.filter(
      (s) =>
        progressStories.get(s.id)?.status === "completed" ||
        s.status === "completed"
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
          label:
            story.title.substring(0, 30) +
            (story.title.length > 30 ? "..." : ""),
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
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return c.json({ error: "internal_error", message: errorMessage }, 500);
  }
});

export { workflowApi };
