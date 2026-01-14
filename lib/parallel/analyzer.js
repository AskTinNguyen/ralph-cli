/**
 * Story Dependency Analyzer module
 *
 * Parses PRD markdown, extracts stories, detects dependencies,
 * and generates parallelizable batches via topological sort.
 */
const fs = require("fs");
const path = require("path");

/**
 * Parse stories from PRD markdown
 * @param {string} prdPath - Path to PRD markdown file
 * @returns {Array} Array of story objects with id, title, status, content, and lines
 */
function parseStories(prdPath) {
  const text = fs.readFileSync(prdPath, "utf-8");
  const lines = text.split("\n");

  // Regex pattern matching loop.sh:566
  const pattern = /^###\s+(\[(?<status>[ xX])\]\s+)?(?<id>US-\d+):\s*(?<title>.+)$/;

  const stories = [];
  let current = null;

  for (const line of lines) {
    const match = pattern.exec(line);
    if (match) {
      if (current) {
        stories.push(current);
      }
      current = {
        id: match.groups.id,
        title: match.groups.title.trim(),
        status: (match.groups.status || " ").trim(),
        lines: [line],
        content: "",
      };
    } else if (current !== null) {
      current.lines.push(line);
    }
  }

  if (current) {
    stories.push(current);
  }

  // Join content for each story
  for (const story of stories) {
    story.content = story.lines.join("\n");
  }

  return stories;
}

/**
 * Extract file paths mentioned in story content
 * Looks for patterns like:
 * - Backtick code: `src/utils/logger.ts`
 * - Create/Update/Modify statements: "Create lib/parallel/analyzer.js"
 * - File extensions: .js, .ts, .tsx, .md, .sh, etc.
 *
 * @param {string} content - Story content text
 * @returns {Array} Array of file paths
 */
function extractFilePaths(content) {
  const paths = new Set();

  // Pattern 1: Backtick code blocks with file paths
  // Matches: `src/utils/logger.ts` or `lib/parallel/analyzer.js`
  const backtickPattern = /`([a-zA-Z0-9_\-./]+\.(js|ts|tsx|jsx|md|sh|json|yml|yaml|css|html))`/g;
  let match;
  while ((match = backtickPattern.exec(content)) !== null) {
    paths.add(match[1]);
  }

  // Pattern 2: Common file operation verbs followed by file paths
  // Matches: "Create lib/parallel/analyzer.js" or "Update src/index.ts"
  const verbPattern =
    /(?:Create|Update|Modify|Edit|Add|Delete|Remove)\s+([a-zA-Z0-9_\-./]+\.(js|ts|tsx|jsx|md|sh|json|yml|yaml|css|html))/gi;
  while ((match = verbPattern.exec(content)) !== null) {
    paths.add(match[1]);
  }

  // Pattern 3: File paths in acceptance criteria (common pattern)
  // Matches standalone file paths like: src/utils/logger.ts
  const standalonePath =
    /(?:^|\s)([a-zA-Z0-9_\-]+(?:\/[a-zA-Z0-9_\-]+)+\.(js|ts|tsx|jsx|md|sh|json|yml|yaml|css|html))(?:\s|$|,|\.)/gm;
  while ((match = standalonePath.exec(content)) !== null) {
    paths.add(match[1]);
  }

  return Array.from(paths);
}

/**
 * Detect explicit dependencies in story content
 * Looks for patterns like:
 * - "depends on US-XXX"
 * - "after US-XXX"
 * - "requires US-XXX"
 *
 * @param {string} content - Story content text
 * @returns {Array} Array of story IDs this story depends on
 */
function detectDependencies(content) {
  const dependencies = new Set();

  // Pattern: "depends on US-XXX", "after US-XXX", "requires US-XXX"
  const depPattern = /(?:depends on|after|requires)\s+(US-\d+)/gi;
  let match;
  while ((match = depPattern.exec(content)) !== null) {
    dependencies.add(match[1].toUpperCase());
  }

  return Array.from(dependencies);
}

/**
 * Build dependency graph from stories
 * Returns a DAG (Directed Acyclic Graph) structure with:
 * - Explicit dependencies (from detectDependencies)
 * - Implicit file-based dependencies (stories touching same files)
 *
 * @param {Array} stories - Array of story objects
 * @returns {Object} Dependency graph with nodes and edges
 */
function buildDependencyGraph(stories) {
  const graph = {
    nodes: {},
    edges: {}, // edges[storyId] = [dependencies...]
  };

  // Initialize nodes and detect explicit dependencies
  for (const story of stories) {
    graph.nodes[story.id] = {
      id: story.id,
      title: story.title,
      status: story.status,
      files: extractFilePaths(story.content),
      explicitDeps: detectDependencies(story.content),
    };
    graph.edges[story.id] = [...graph.nodes[story.id].explicitDeps];
  }

  // Detect implicit file-based dependencies
  // If US-002 and US-003 both touch same file, and US-003 comes after US-002,
  // then US-003 depends on US-002
  const storyIds = stories.map((s) => s.id);
  for (let i = 0; i < storyIds.length; i++) {
    const currentId = storyIds[i];
    const currentFiles = graph.nodes[currentId].files;

    // Check all previous stories
    for (let j = 0; j < i; j++) {
      const priorId = storyIds[j];
      const priorFiles = graph.nodes[priorId].files;

      // If any files overlap, current depends on prior
      const hasOverlap = currentFiles.some((f) => priorFiles.includes(f));
      if (hasOverlap && !graph.edges[currentId].includes(priorId)) {
        graph.edges[currentId].push(priorId);
      }
    }
  }

  return graph;
}

/**
 * Generate parallelizable batches via topological sort
 * Uses Kahn's algorithm for topological sorting to determine which
 * stories can be executed in parallel.
 *
 * @param {Object} graph - Dependency graph from buildDependencyGraph
 * @param {Array} stories - Original stories array (for filtering incomplete)
 * @returns {Array} Array of batches, where each batch is an array of story IDs that can run in parallel
 */
function getBatches(graph, stories) {
  // Filter to only incomplete stories
  const incompleteIds = stories.filter((s) => s.status.toLowerCase() !== "x").map((s) => s.id);

  if (incompleteIds.length === 0) {
    return [];
  }

  // Build in-degree map (how many dependencies each story has)
  const inDegree = {};
  const edges = {};

  for (const id of incompleteIds) {
    inDegree[id] = 0;
    edges[id] = [];
  }

  // Calculate in-degrees, only considering incomplete stories
  for (const id of incompleteIds) {
    const deps = graph.edges[id].filter((depId) => incompleteIds.includes(depId));
    for (const depId of deps) {
      if (!edges[depId]) {
        edges[depId] = [];
      }
      edges[depId].push(id);
      inDegree[id]++;
    }
  }

  // Kahn's algorithm for topological sort
  const batches = [];
  const queue = incompleteIds.filter((id) => inDegree[id] === 0);

  while (queue.length > 0) {
    // All items in queue have no dependencies, so they can run in parallel
    const batch = [...queue];
    batches.push(batch);
    queue.length = 0;

    // Process this batch
    for (const id of batch) {
      const dependents = edges[id] || [];
      for (const depId of dependents) {
        inDegree[depId]--;
        if (inDegree[depId] === 0) {
          queue.push(depId);
        }
      }
    }
  }

  // Check for cycles
  const processedCount = batches.flat().length;
  if (processedCount < incompleteIds.length) {
    throw new Error(
      `Circular dependency detected. Processed ${processedCount} of ${incompleteIds.length} stories.`
    );
  }

  return batches;
}

module.exports = {
  parseStories,
  extractFilePaths,
  detectDependencies,
  buildDependencyGraph,
  getBatches,
};
