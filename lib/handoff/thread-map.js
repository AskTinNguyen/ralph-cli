/**
 * Thread Map - Handoff Relationship Tracking
 *
 * Tracks relationships between handoffs, enabling visualization of
 * how work has been transferred between agent sessions. Supports:
 * - Parent-child relationships (linear handoffs)
 * - Branch visualization (parallel work)
 * - Merge tracking (work consolidation)
 */
const fs = require("fs");
const path = require("path");

/**
 * Load thread map from project
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Thread map data
 */
function loadThreadMap(projectRoot) {
  const mapPath = path.join(projectRoot, ".ralph/handoffs/thread-map.json");

  if (!fs.existsSync(mapPath)) {
    return {
      version: 1,
      threads: {},
      roots: [], // Handoffs with no parent
      updated_at: null,
    };
  }

  try {
    return JSON.parse(fs.readFileSync(mapPath, "utf8"));
  } catch {
    return {
      version: 1,
      threads: {},
      roots: [],
      updated_at: null,
    };
  }
}

/**
 * Save thread map to project
 * @param {string} projectRoot - Project root directory
 * @param {Object} threadMap - Thread map data
 */
function saveThreadMap(projectRoot, threadMap) {
  const handoffsDir = path.join(projectRoot, ".ralph/handoffs");
  const mapPath = path.join(handoffsDir, "thread-map.json");

  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }

  threadMap.updated_at = new Date().toISOString();
  fs.writeFileSync(mapPath, JSON.stringify(threadMap, null, 2));
}

/**
 * Register a new handoff in the thread map
 * @param {string} projectRoot - Project root directory
 * @param {Object} handoff - Handoff record
 */
function registerHandoff(projectRoot, handoff) {
  const threadMap = loadThreadMap(projectRoot);

  // Create thread entry
  threadMap.threads[handoff.id] = {
    id: handoff.id,
    parent_id: handoff.parent_id,
    children: [],
    created_at: handoff.created_at,
    reason: handoff.reason,
    summary: handoff.summary,
    prd_id: handoff.prd_id,
    iteration: handoff.iteration,
    story_id: handoff.story_id,
  };

  // Update parent's children list
  if (handoff.parent_id && threadMap.threads[handoff.parent_id]) {
    threadMap.threads[handoff.parent_id].children.push(handoff.id);
  }

  // Track root handoffs (no parent)
  if (!handoff.parent_id) {
    threadMap.roots.push(handoff.id);
  }

  saveThreadMap(projectRoot, threadMap);
}

/**
 * Get the handoff chain (lineage) for a handoff ID
 * @param {string} projectRoot - Project root directory
 * @param {string} handoffId - Handoff ID
 * @returns {Array} Array of handoff IDs from root to current
 */
function getHandoffChain(projectRoot, handoffId) {
  const threadMap = loadThreadMap(projectRoot);
  const chain = [];
  let currentId = handoffId;

  while (currentId && threadMap.threads[currentId]) {
    chain.unshift(currentId);
    currentId = threadMap.threads[currentId].parent_id;
  }

  return chain;
}

/**
 * Get all descendants of a handoff
 * @param {string} projectRoot - Project root directory
 * @param {string} handoffId - Handoff ID
 * @returns {Array} Array of descendant handoff IDs
 */
function getDescendants(projectRoot, handoffId) {
  const threadMap = loadThreadMap(projectRoot);
  const descendants = [];
  const queue = [handoffId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    const thread = threadMap.threads[currentId];
    if (thread && thread.children) {
      descendants.push(...thread.children);
      queue.push(...thread.children);
    }
  }

  return descendants;
}

/**
 * Get the latest handoff in a chain (leaf node)
 * @param {string} projectRoot - Project root directory
 * @param {string} handoffId - Starting handoff ID (optional, uses latest root if not provided)
 * @returns {string|null} Latest handoff ID
 */
function getLatestHandoff(projectRoot, handoffId = null) {
  const threadMap = loadThreadMap(projectRoot);

  // If no ID provided, start from the most recent root
  if (!handoffId) {
    if (threadMap.roots.length === 0) {
      return null;
    }
    // Get the most recent root
    const sortedRoots = threadMap.roots
      .map((id) => ({
        id,
        created_at: threadMap.threads[id]?.created_at || "1970-01-01",
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    handoffId = sortedRoots[0].id;
  }

  // Follow children to find the leaf
  let current = threadMap.threads[handoffId];
  while (current && current.children && current.children.length > 0) {
    // If multiple children, pick the most recent
    const sortedChildren = current.children
      .map((id) => ({
        id,
        created_at: threadMap.threads[id]?.created_at || "1970-01-01",
      }))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    current = threadMap.threads[sortedChildren[0].id];
  }

  return current?.id || handoffId;
}

/**
 * Build ASCII visualization of the thread graph
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Visualization options
 * @returns {string} ASCII graph
 */
function visualizeGraph(projectRoot, options = {}) {
  const threadMap = loadThreadMap(projectRoot);
  const { maxDepth = 10, showDetails = true } = options;

  if (Object.keys(threadMap.threads).length === 0) {
    return "No handoffs recorded yet.";
  }

  const lines = [];
  lines.push("Handoff Thread Map");
  lines.push("==================");
  lines.push("");

  // Build graph starting from roots
  for (const rootId of threadMap.roots) {
    visualizeNode(threadMap, rootId, lines, "", 0, maxDepth, showDetails);
  }

  // Add legend
  lines.push("");
  lines.push("Legend:");
  lines.push("  ○ = handoff node");
  lines.push("  │ = continuation");
  lines.push("  ├─ = branch");
  lines.push("  └─ = last child");

  return lines.join("\n");
}

/**
 * Recursively visualize a node and its children
 * @param {Object} threadMap - Thread map data
 * @param {string} nodeId - Current node ID
 * @param {Array} lines - Output lines array
 * @param {string} prefix - Current indentation prefix
 * @param {number} depth - Current depth
 * @param {number} maxDepth - Maximum depth to render
 * @param {boolean} showDetails - Show node details
 */
function visualizeNode(threadMap, nodeId, lines, prefix, depth, maxDepth, showDetails) {
  if (depth > maxDepth) {
    lines.push(`${prefix}  ... (truncated at depth ${maxDepth})`);
    return;
  }

  const thread = threadMap.threads[nodeId];
  if (!thread) return;

  // Build node label
  let label = `○ ${nodeId.slice(0, 20)}`;
  if (showDetails) {
    const details = [];
    if (thread.reason) details.push(thread.reason);
    if (thread.prd_id) details.push(`PRD-${thread.prd_id}`);
    if (thread.story_id) details.push(thread.story_id);
    if (details.length > 0) {
      label += ` (${details.join(", ")})`;
    }
  }

  lines.push(`${prefix}${label}`);

  // Render children
  const children = thread.children || [];
  for (let i = 0; i < children.length; i++) {
    const isLast = i === children.length - 1;
    const childPrefix = isLast ? "└─ " : "├─ ";
    const continuationPrefix = isLast ? "   " : "│  ";

    lines.push(`${prefix}${childPrefix.slice(0, -1)}`);
    visualizeNode(
      threadMap,
      children[i],
      lines,
      prefix + continuationPrefix,
      depth + 1,
      maxDepth,
      showDetails
    );
  }
}

/**
 * Generate Mermaid diagram syntax for the thread graph
 * @param {string} projectRoot - Project root directory
 * @returns {string} Mermaid diagram syntax
 */
function generateMermaidDiagram(projectRoot) {
  const threadMap = loadThreadMap(projectRoot);

  if (Object.keys(threadMap.threads).length === 0) {
    return "graph TD\n  empty[No handoffs recorded]";
  }

  const lines = ["graph TD"];

  // Define nodes
  for (const [id, thread] of Object.entries(threadMap.threads)) {
    const shortId = id.slice(8, 20); // Remove 'handoff-' prefix and truncate
    const label = thread.summary
      ? `${shortId}<br/>${thread.summary.slice(0, 30)}...`
      : shortId;
    lines.push(`  ${sanitizeId(id)}["${label}"]`);
  }

  // Define edges
  for (const [id, thread] of Object.entries(threadMap.threads)) {
    if (thread.children) {
      for (const childId of thread.children) {
        lines.push(`  ${sanitizeId(id)} --> ${sanitizeId(childId)}`);
      }
    }
  }

  // Style root nodes
  for (const rootId of threadMap.roots) {
    lines.push(`  style ${sanitizeId(rootId)} fill:#e1f5fe`);
  }

  return lines.join("\n");
}

/**
 * Sanitize ID for Mermaid compatibility
 * @param {string} id - Original ID
 * @returns {string} Sanitized ID
 */
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Get statistics about the thread map
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Statistics
 */
function getThreadStats(projectRoot) {
  const threadMap = loadThreadMap(projectRoot);

  const totalThreads = Object.keys(threadMap.threads).length;
  const totalRoots = threadMap.roots.length;

  // Calculate max depth
  let maxDepth = 0;
  const calculateDepth = (id, depth) => {
    maxDepth = Math.max(maxDepth, depth);
    const thread = threadMap.threads[id];
    if (thread && thread.children) {
      for (const childId of thread.children) {
        calculateDepth(childId, depth + 1);
      }
    }
  };
  for (const rootId of threadMap.roots) {
    calculateDepth(rootId, 1);
  }

  // Count by reason
  const reasonCounts = {};
  for (const thread of Object.values(threadMap.threads)) {
    const reason = thread.reason || "unknown";
    reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
  }

  return {
    total_handoffs: totalThreads,
    total_chains: totalRoots,
    max_depth: maxDepth,
    reasons: reasonCounts,
    updated_at: threadMap.updated_at,
  };
}

module.exports = {
  loadThreadMap,
  saveThreadMap,
  registerHandoff,
  getHandoffChain,
  getDescendants,
  getLatestHandoff,
  visualizeGraph,
  generateMermaidDiagram,
  getThreadStats,
};
