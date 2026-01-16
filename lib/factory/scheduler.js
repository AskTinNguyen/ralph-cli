/**
 * Factory Scheduler - Dependency Graph and Execution Order
 *
 * Builds dependency graph from stages and determines optimal execution order.
 * Supports parallel execution, branching, and conditional stages.
 *
 * @module lib/factory/scheduler
 */

/**
 * Build a dependency graph from stages
 * @param {Array} stages - Parsed stages
 * @returns {Object} Dependency graph { nodes, edges, inDegree }
 */
function buildDependencyGraph(stages) {
  const nodes = new Map();
  const edges = new Map();
  const inDegree = new Map();
  const reverseEdges = new Map();

  // Initialize nodes
  for (const stage of stages) {
    nodes.set(stage.id, stage);
    edges.set(stage.id, []);
    reverseEdges.set(stage.id, []);
    inDegree.set(stage.id, 0);
  }

  // Build edges from dependencies
  for (const stage of stages) {
    if (stage.depends_on && stage.depends_on.length > 0) {
      for (const dep of stage.depends_on) {
        // dep -> stage (stage depends on dep)
        edges.get(dep).push(stage.id);
        reverseEdges.get(stage.id).push(dep);
        inDegree.set(stage.id, inDegree.get(stage.id) + 1);
      }
    }
  }

  return {
    nodes,
    edges,
    reverseEdges,
    inDegree,
  };
}

/**
 * Get execution order using topological sort
 * @param {Object} graph - Dependency graph
 * @returns {Array} Ordered list of stage IDs
 */
function getExecutionOrder(graph) {
  const { nodes, edges, inDegree } = graph;
  const order = [];
  const queue = [];
  const inDegCopy = new Map(inDegree);

  // Find all nodes with no dependencies
  for (const [nodeId, deg] of inDegCopy.entries()) {
    if (deg === 0) {
      queue.push(nodeId);
    }
  }

  // Process nodes in topological order
  while (queue.length > 0) {
    // Sort queue to ensure deterministic order
    queue.sort();

    const nodeId = queue.shift();
    order.push(nodeId);

    // Reduce in-degree of dependent nodes
    for (const dependent of edges.get(nodeId) || []) {
      const newDegree = inDegCopy.get(dependent) - 1;
      inDegCopy.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  // Check if all nodes were processed (no cycles)
  if (order.length !== nodes.size) {
    throw new Error("Circular dependency detected in factory stages");
  }

  return order;
}

/**
 * Get stages that can be executed in parallel at a given point
 * @param {Object} graph - Dependency graph
 * @param {Set} completed - Set of completed stage IDs
 * @returns {Array} List of stage IDs that can run in parallel
 */
function getReadyStages(graph, completed) {
  const { nodes, reverseEdges } = graph;
  const ready = [];

  for (const [nodeId, stage] of nodes.entries()) {
    if (completed.has(nodeId)) continue;

    // Check if all dependencies are completed
    const deps = reverseEdges.get(nodeId) || [];
    const allDepsCompleted = deps.every((dep) => completed.has(dep));

    if (allDepsCompleted) {
      ready.push(nodeId);
    }
  }

  return ready;
}

/**
 * Get parallel execution groups
 * Groups stages that can be executed in parallel at each level
 * @param {Object} graph - Dependency graph
 * @returns {Array} Array of arrays, each containing stage IDs at that level
 */
function getParallelGroups(graph) {
  const { nodes, edges, inDegree } = graph;
  const groups = [];
  const inDegCopy = new Map(inDegree);
  const processed = new Set();

  while (processed.size < nodes.size) {
    const currentGroup = [];

    // Find all nodes with no remaining dependencies
    for (const [nodeId, deg] of inDegCopy.entries()) {
      if (deg === 0 && !processed.has(nodeId)) {
        currentGroup.push(nodeId);
      }
    }

    if (currentGroup.length === 0) {
      throw new Error("Circular dependency detected");
    }

    // Sort for deterministic order
    currentGroup.sort();
    groups.push(currentGroup);

    // Mark as processed and update in-degrees
    for (const nodeId of currentGroup) {
      processed.add(nodeId);

      for (const dependent of edges.get(nodeId) || []) {
        inDegCopy.set(dependent, inDegCopy.get(dependent) - 1);
      }
    }
  }

  return groups;
}

/**
 * Check if a stage can be executed based on completed stages
 * @param {Object} graph - Dependency graph
 * @param {string} stageId - Stage to check
 * @param {Set} completed - Set of completed stage IDs
 * @returns {boolean} True if stage can be executed
 */
function canExecute(graph, stageId, completed) {
  const deps = graph.reverseEdges.get(stageId) || [];
  return deps.every((dep) => completed.has(dep));
}

/**
 * Get direct dependencies of a stage
 * @param {Object} graph - Dependency graph
 * @param {string} stageId - Stage ID
 * @returns {Array} List of dependency stage IDs
 */
function getDependencies(graph, stageId) {
  return graph.reverseEdges.get(stageId) || [];
}

/**
 * Get direct dependents of a stage (stages that depend on this one)
 * @param {Object} graph - Dependency graph
 * @param {string} stageId - Stage ID
 * @returns {Array} List of dependent stage IDs
 */
function getDependents(graph, stageId) {
  return graph.edges.get(stageId) || [];
}

/**
 * Determine if stages form parallel branches that need merging
 * @param {Object} graph - Dependency graph
 * @param {Array} stageIds - Stage IDs to check
 * @returns {Object} { isParallel: boolean, mergePoint?: string }
 */
function analyzeParallelBranches(graph, stageIds) {
  const { nodes, edges } = graph;

  // Find common descendants
  const descendantSets = stageIds.map((id) => getAllDescendants(graph, id));

  // Find intersection of all descendant sets
  let commonDescendants = new Set(descendantSets[0]);
  for (let i = 1; i < descendantSets.length; i++) {
    commonDescendants = new Set(
      [...commonDescendants].filter((x) => descendantSets[i].has(x))
    );
  }

  if (commonDescendants.size === 0) {
    return { isParallel: true, mergePoint: null };
  }

  // Find the earliest merge point (first common descendant in topological order)
  const order = getExecutionOrder(graph);
  for (const stageId of order) {
    if (commonDescendants.has(stageId)) {
      // Check if this stage depends on all the parallel branches
      const deps = new Set(getDependencies(graph, stageId));
      const allBranchesConverge = stageIds.every(
        (id) => deps.has(id) || getAllDescendants(graph, id).has(stageId)
      );

      if (allBranchesConverge) {
        return { isParallel: true, mergePoint: stageId };
      }
    }
  }

  return { isParallel: true, mergePoint: null };
}

/**
 * Get all descendants of a stage (transitive closure)
 * @param {Object} graph - Dependency graph
 * @param {string} stageId - Stage ID
 * @returns {Set} Set of all descendant stage IDs
 */
function getAllDescendants(graph, stageId) {
  const descendants = new Set();
  const queue = [...(graph.edges.get(stageId) || [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!descendants.has(current)) {
      descendants.add(current);
      queue.push(...(graph.edges.get(current) || []));
    }
  }

  return descendants;
}

/**
 * Get all ancestors of a stage (transitive closure)
 * @param {Object} graph - Dependency graph
 * @param {string} stageId - Stage ID
 * @returns {Set} Set of all ancestor stage IDs
 */
function getAllAncestors(graph, stageId) {
  const ancestors = new Set();
  const queue = [...(graph.reverseEdges.get(stageId) || [])];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!ancestors.has(current)) {
      ancestors.add(current);
      queue.push(...(graph.reverseEdges.get(current) || []));
    }
  }

  return ancestors;
}

/**
 * Find stages that form a loop (have loop_to field)
 * @param {Object} graph - Dependency graph
 * @returns {Array} List of { stageId, loopTo } objects
 */
function findLoopStages(graph) {
  const loops = [];

  for (const [stageId, stage] of graph.nodes.entries()) {
    if (stage.loop_to) {
      loops.push({
        stageId,
        loopTo: stage.loop_to,
      });
    }
  }

  return loops;
}

/**
 * Create an execution plan with parallel groups and conditions
 * @param {Object} graph - Dependency graph
 * @param {Object} options - Planning options
 * @returns {Object} Execution plan
 */
function createExecutionPlan(graph, options = {}) {
  const parallelGroups = getParallelGroups(graph);
  const loops = findLoopStages(graph);

  const plan = {
    groups: [],
    loops,
    totalStages: graph.nodes.size,
    maxParallelism: 0,
  };

  for (let i = 0; i < parallelGroups.length; i++) {
    const group = parallelGroups[i];
    const stages = group.map((id) => {
      const stage = graph.nodes.get(id);
      return {
        id,
        type: stage.type,
        hasCondition: !!stage.condition,
        condition: stage.condition,
        mergeStrategy: stage.merge_strategy,
        loopTo: stage.loop_to,
      };
    });

    plan.groups.push({
      level: i,
      stages,
      parallelCount: stages.length,
    });

    if (stages.length > plan.maxParallelism) {
      plan.maxParallelism = stages.length;
    }
  }

  return plan;
}

/**
 * Generate ASCII visualization of the execution plan
 * @param {Object} graph - Dependency graph
 * @returns {string} ASCII representation
 */
function visualizeGraph(graph) {
  const plan = createExecutionPlan(graph);
  const lines = [];

  lines.push("Factory Execution Plan");
  lines.push("=".repeat(50));
  lines.push("");

  for (const group of plan.groups) {
    const levelPrefix = `Level ${group.level}: `;
    const stageNames = group.stages.map((s) => {
      let name = s.id;
      if (s.hasCondition) name += " (?)";
      if (s.loopTo) name += ` ↺${s.loopTo}`;
      return name;
    });

    if (group.parallelCount > 1) {
      lines.push(`${levelPrefix}[PARALLEL]`);
      for (const name of stageNames) {
        lines.push(`  ├── ${name}`);
      }
    } else {
      lines.push(`${levelPrefix}${stageNames[0]}`);
    }

    if (group.level < plan.groups.length - 1) {
      lines.push("      │");
      lines.push("      ▼");
    }
  }

  lines.push("");
  lines.push("-".repeat(50));
  lines.push(`Total stages: ${plan.totalStages}`);
  lines.push(`Max parallelism: ${plan.maxParallelism}`);
  lines.push(`Loops: ${plan.loops.length}`);

  return lines.join("\n");
}

/**
 * Get critical path (longest path through the graph)
 * @param {Object} graph - Dependency graph
 * @returns {Array} Stage IDs on the critical path
 */
function getCriticalPath(graph) {
  const order = getExecutionOrder(graph);
  const distances = new Map();
  const predecessors = new Map();

  // Initialize distances
  for (const nodeId of order) {
    distances.set(nodeId, 0);
    predecessors.set(nodeId, null);
  }

  // Calculate longest path to each node
  for (const nodeId of order) {
    const deps = graph.reverseEdges.get(nodeId) || [];
    for (const dep of deps) {
      const newDist = distances.get(dep) + 1;
      if (newDist > distances.get(nodeId)) {
        distances.set(nodeId, newDist);
        predecessors.set(nodeId, dep);
      }
    }
  }

  // Find node with maximum distance
  let maxNode = order[0];
  let maxDist = 0;
  for (const [nodeId, dist] of distances.entries()) {
    if (dist > maxDist) {
      maxDist = dist;
      maxNode = nodeId;
    }
  }

  // Reconstruct path
  const path = [maxNode];
  let current = maxNode;
  while (predecessors.get(current) !== null) {
    current = predecessors.get(current);
    path.unshift(current);
  }

  return path;
}

module.exports = {
  buildDependencyGraph,
  getExecutionOrder,
  getReadyStages,
  getParallelGroups,
  canExecute,
  getDependencies,
  getDependents,
  analyzeParallelBranches,
  getAllDescendants,
  getAllAncestors,
  findLoopStages,
  createExecutionPlan,
  visualizeGraph,
  getCriticalPath,
};
