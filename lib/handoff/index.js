/**
 * Handoff Module - Main Entry Point
 *
 * Provides handoff management for context transfer between AI agent sessions.
 * Solves the "context drift" problem by capturing essential state and enabling
 * clean transitions to new sessions with preserved technical context.
 *
 * Key features:
 * - Manual handoff creation with summary
 * - Auto-handoff on context threshold
 * - Thread mapping for handoff visualization
 * - Resume from handoff with injected context
 */
const fs = require("fs");
const path = require("path");

const { createHandoff, validateHandoff, HANDOFF_REASONS, HANDOFF_VERSION } = require("./schema");
const { extractContext, createHandoffContext } = require("./context");
const {
  registerHandoff,
  getLatestHandoff,
  getHandoffChain,
  visualizeGraph,
  generateMermaidDiagram,
  getThreadStats,
  loadThreadMap,
} = require("./thread-map");

/**
 * Maximum number of handoffs to keep per PRD
 */
const MAX_HANDOFFS_PER_PRD = 50;

/**
 * Get handoffs directory path
 * @param {string} projectRoot - Project root directory
 * @returns {string} Handoffs directory path
 */
function getHandoffsDir(projectRoot) {
  return path.join(projectRoot, ".ralph/handoffs");
}

/**
 * Get handoff file path
 * @param {string} projectRoot - Project root directory
 * @param {string} handoffId - Handoff ID
 * @returns {string} Handoff file path
 */
function getHandoffPath(projectRoot, handoffId) {
  return path.join(getHandoffsDir(projectRoot), `${handoffId}.json`);
}

/**
 * Create a new handoff from current state
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - Handoff options
 * @returns {Object} { success: boolean, handoff?: Object, path?: string, error?: string }
 */
function createNewHandoff(projectRoot, options = {}) {
  try {
    const handoffsDir = getHandoffsDir(projectRoot);

    // Ensure handoffs directory exists
    if (!fs.existsSync(handoffsDir)) {
      fs.mkdirSync(handoffsDir, { recursive: true });
    }

    // Find the active PRD folder
    const prdFolder = findActivePrdFolder(projectRoot, options.prd_id);

    // Extract context from current state
    let context = {};
    if (prdFolder) {
      context = createHandoffContext(prdFolder, {
        agent: options.agent,
        model: options.model,
      });
    }

    // Get parent handoff ID (latest in chain) if resuming
    let parentId = options.parent_id || null;
    if (!parentId && options.resume_from) {
      parentId = options.resume_from;
    } else if (!parentId && !options.is_root) {
      // Auto-link to latest handoff if not explicitly a root
      parentId = getLatestHandoff(projectRoot);
    }

    // Create handoff record
    const handoff = createHandoff({
      parent_id: parentId,
      reason: options.reason || HANDOFF_REASONS.MANUAL,
      prd_id: context.prd_id || options.prd_id,
      iteration: context.iteration || options.iteration,
      story_id: context.story_id || options.story_id,
      git_sha: context.git_sha,
      summary: options.summary || context.summary || "Manual handoff",
      state: {
        completed_stories: context.completed_stories || [],
        current_story: context.current_story,
        agent: options.agent || context.agent || "claude",
        model: options.model || context.model,
        phase: context.phase,
      },
      remaining_work: context.remaining_stories?.map((s) => ({
        id: s.id,
        title: s.title,
        type: "story",
      })) || [],
      blockers: context.blockers || [],
      critical_files: context.critical_files || [],
      learnings: context.learnings || [],
      metadata: {
        agent: options.agent || context.agent || "claude",
        model: options.model || context.model,
        session_duration: options.session_duration,
        context_usage_percent: options.context_usage_percent,
        tokens_used: options.tokens_used,
      },
    });

    // Validate handoff
    const validation = validateHandoff(handoff);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid handoff data: ${validation.errors.join(", ")}`,
      };
    }

    // Save handoff file
    const handoffPath = getHandoffPath(projectRoot, handoff.id);
    fs.writeFileSync(handoffPath, JSON.stringify(handoff, null, 2));

    // Register in thread map
    registerHandoff(projectRoot, handoff);

    // Prune old handoffs if needed
    pruneOldHandoffs(projectRoot);

    return {
      success: true,
      handoff,
      path: handoffPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to create handoff: ${err.message}`,
    };
  }
}

/**
 * Load a handoff by ID
 * @param {string} projectRoot - Project root directory
 * @param {string} handoffId - Handoff ID
 * @returns {Object} { success: boolean, handoff?: Object, error?: string }
 */
function loadHandoff(projectRoot, handoffId) {
  try {
    const handoffPath = getHandoffPath(projectRoot, handoffId);

    if (!fs.existsSync(handoffPath)) {
      return {
        success: false,
        error: `Handoff not found: ${handoffId}`,
        notFound: true,
      };
    }

    const content = fs.readFileSync(handoffPath, "utf8");
    const handoff = JSON.parse(content);

    // Validate
    const validation = validateHandoff(handoff);
    if (!validation.valid) {
      return {
        success: false,
        error: `Invalid handoff: ${validation.errors.join(", ")}`,
      };
    }

    return {
      success: true,
      handoff,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to load handoff: ${err.message}`,
    };
  }
}

/**
 * Load the latest handoff
 * @param {string} projectRoot - Project root directory
 * @returns {Object} { success: boolean, handoff?: Object, error?: string }
 */
function loadLatestHandoff(projectRoot) {
  const latestId = getLatestHandoff(projectRoot);
  if (!latestId) {
    return {
      success: false,
      error: "No handoffs found",
      notFound: true,
    };
  }
  return loadHandoff(projectRoot, latestId);
}

/**
 * List all handoffs
 * @param {string} projectRoot - Project root directory
 * @param {Object} options - List options
 * @returns {Object} { success: boolean, handoffs: Array, error?: string }
 */
function listHandoffs(projectRoot, options = {}) {
  try {
    const handoffsDir = getHandoffsDir(projectRoot);

    if (!fs.existsSync(handoffsDir)) {
      return { success: true, handoffs: [] };
    }

    const files = fs.readdirSync(handoffsDir)
      .filter((f) => f.startsWith("handoff-") && f.endsWith(".json"));

    const handoffs = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(handoffsDir, file), "utf8");
        const handoff = JSON.parse(content);

        // Filter by PRD if specified
        if (options.prd_id && handoff.prd_id !== options.prd_id) {
          continue;
        }

        handoffs.push({
          id: handoff.id,
          created_at: handoff.created_at,
          reason: handoff.reason,
          summary: handoff.summary,
          prd_id: handoff.prd_id,
          iteration: handoff.iteration,
          story_id: handoff.story_id,
          parent_id: handoff.parent_id,
        });
      } catch {
        // Skip invalid files
      }
    }

    // Sort by creation date (newest first)
    handoffs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // Limit if specified
    const limit = options.limit || 50;
    return {
      success: true,
      handoffs: handoffs.slice(0, limit),
    };
  } catch (err) {
    return {
      success: false,
      handoffs: [],
      error: `Failed to list handoffs: ${err.message}`,
    };
  }
}

/**
 * Generate handoff.md file for a handoff
 * @param {Object} handoff - Handoff record
 * @returns {string} Markdown content
 */
function generateHandoffMarkdown(handoff) {
  const lines = [];

  lines.push("# Handoff Context");
  lines.push("");
  lines.push(`**ID:** ${handoff.id}`);
  lines.push(`**Created:** ${handoff.created_at}`);
  lines.push(`**Reason:** ${handoff.reason}`);
  if (handoff.parent_id) {
    lines.push(`**Parent:** ${handoff.parent_id}`);
  }
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(handoff.summary);
  lines.push("");

  if (handoff.prd_id || handoff.iteration || handoff.story_id) {
    lines.push("## Current State");
    lines.push("");
    if (handoff.prd_id) lines.push(`- **PRD:** PRD-${handoff.prd_id}`);
    if (handoff.iteration) lines.push(`- **Iteration:** ${handoff.iteration}`);
    if (handoff.story_id) lines.push(`- **Current Story:** ${handoff.story_id}`);
    if (handoff.git_sha) lines.push(`- **Git SHA:** ${handoff.git_sha.slice(0, 8)}`);
    if (handoff.state?.phase) lines.push(`- **Phase:** ${handoff.state.phase}`);
    if (handoff.state?.agent) lines.push(`- **Agent:** ${handoff.state.agent}`);
    lines.push("");
  }

  if (handoff.state?.completed_stories?.length > 0) {
    lines.push("## Completed Work");
    lines.push("");
    for (const story of handoff.state.completed_stories) {
      if (typeof story === "object") {
        lines.push(`- [x] ${story.id}: ${story.title || story.message || ""}`);
      } else {
        lines.push(`- [x] ${story}`);
      }
    }
    lines.push("");
  }

  if (handoff.remaining_work?.length > 0) {
    lines.push("## Remaining Work");
    lines.push("");
    for (const item of handoff.remaining_work) {
      if (typeof item === "object") {
        lines.push(`- [ ] ${item.id}: ${item.title || ""}`);
      } else {
        lines.push(`- [ ] ${item}`);
      }
    }
    lines.push("");
  }

  if (handoff.blockers?.length > 0) {
    lines.push("## Blockers");
    lines.push("");
    for (const blocker of handoff.blockers) {
      if (typeof blocker === "object") {
        lines.push(`- **${blocker.type || "Issue"}:** ${blocker.message || JSON.stringify(blocker)}`);
      } else {
        lines.push(`- ${blocker}`);
      }
    }
    lines.push("");
  }

  if (handoff.critical_files?.length > 0) {
    lines.push("## Critical Files");
    lines.push("");
    lines.push("Review these files for context:");
    lines.push("");
    for (const file of handoff.critical_files.slice(0, 15)) {
      lines.push(`- \`${file}\``);
    }
    if (handoff.critical_files.length > 15) {
      lines.push(`- ... and ${handoff.critical_files.length - 15} more`);
    }
    lines.push("");
  }

  if (handoff.learnings?.length > 0) {
    lines.push("## Learnings");
    lines.push("");
    for (const learning of handoff.learnings.slice(0, 10)) {
      if (typeof learning === "object") {
        lines.push(`- ${learning.content || learning.message || JSON.stringify(learning)}`);
      } else {
        lines.push(`- ${learning}`);
      }
    }
    lines.push("");
  }

  lines.push("## Resume Instructions");
  lines.push("");
  lines.push("To resume from this handoff:");
  lines.push("```bash");
  lines.push(`ralph handoff resume ${handoff.id}`);
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

/**
 * Save handoff as markdown file
 * @param {string} projectRoot - Project root directory
 * @param {Object} handoff - Handoff record
 * @returns {Object} { success: boolean, path?: string, error?: string }
 */
function saveHandoffMarkdown(projectRoot, handoff) {
  try {
    const handoffsDir = getHandoffsDir(projectRoot);
    const mdPath = path.join(handoffsDir, `${handoff.id}.md`);

    const content = generateHandoffMarkdown(handoff);
    fs.writeFileSync(mdPath, content);

    return {
      success: true,
      path: mdPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to save handoff markdown: ${err.message}`,
    };
  }
}

/**
 * Find the active PRD folder
 * @param {string} projectRoot - Project root directory
 * @param {number|string} prdId - Specific PRD ID (optional)
 * @returns {string|null} PRD folder path
 */
function findActivePrdFolder(projectRoot, prdId = null) {
  const ralphDir = path.join(projectRoot, ".ralph");

  if (!fs.existsSync(ralphDir)) {
    return null;
  }

  // If specific PRD ID provided
  if (prdId) {
    const prdPath = path.join(ralphDir, `PRD-${prdId}`);
    if (fs.existsSync(prdPath)) {
      return prdPath;
    }
    return null;
  }

  // Find latest PRD
  const entries = fs.readdirSync(ralphDir, { withFileTypes: true });
  const prdFolders = entries
    .filter((e) => e.isDirectory() && /^PRD-\d+$/i.test(e.name))
    .sort((a, b) => {
      const numA = parseInt(a.name.replace(/PRD-/i, ""), 10);
      const numB = parseInt(b.name.replace(/PRD-/i, ""), 10);
      return numB - numA;
    });

  if (prdFolders.length > 0) {
    return path.join(ralphDir, prdFolders[0].name);
  }

  return null;
}

/**
 * Prune old handoffs to stay within limits
 * @param {string} projectRoot - Project root directory
 */
function pruneOldHandoffs(projectRoot) {
  try {
    const handoffsDir = getHandoffsDir(projectRoot);

    if (!fs.existsSync(handoffsDir)) {
      return;
    }

    const files = fs.readdirSync(handoffsDir)
      .filter((f) => f.startsWith("handoff-") && f.endsWith(".json"))
      .map((f) => {
        const filePath = path.join(handoffsDir, f);
        const stat = fs.statSync(filePath);
        return { file: f, path: filePath, mtime: stat.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // Remove old files beyond limit
    const toRemove = files.slice(MAX_HANDOFFS_PER_PRD);
    for (const item of toRemove) {
      fs.unlinkSync(item.path);
      // Also remove corresponding .md file
      const mdPath = item.path.replace(".json", ".md");
      if (fs.existsSync(mdPath)) {
        fs.unlinkSync(mdPath);
      }
    }
  } catch {
    // Ignore pruning errors
  }
}

/**
 * Generate context injection for agent prompts
 * @param {Object} handoff - Handoff record
 * @returns {string} Context to inject into agent prompt
 */
function generateContextInjection(handoff) {
  const lines = [];

  lines.push("## Handoff Context (from previous session)");
  lines.push("");
  lines.push(`This is a continuation of previous work. Handoff ID: ${handoff.id}`);
  lines.push("");

  if (handoff.summary) {
    lines.push(`**Previous session summary:** ${handoff.summary}`);
    lines.push("");
  }

  if (handoff.prd_id) {
    lines.push(`**Working on:** PRD-${handoff.prd_id}`);
  }

  if (handoff.state?.completed_stories?.length > 0) {
    lines.push(
      `**Completed:** ${handoff.state.completed_stories.length} stories`
    );
  }

  if (handoff.remaining_work?.length > 0) {
    lines.push(`**Remaining:** ${handoff.remaining_work.length} tasks`);
    lines.push("");
    lines.push("Next tasks:");
    for (const item of handoff.remaining_work.slice(0, 3)) {
      if (typeof item === "object") {
        lines.push(`- ${item.id}: ${item.title || ""}`);
      } else {
        lines.push(`- ${item}`);
      }
    }
  }

  if (handoff.blockers?.length > 0) {
    lines.push("");
    lines.push("**Blockers to address:**");
    for (const blocker of handoff.blockers.slice(0, 3)) {
      if (typeof blocker === "object") {
        lines.push(`- ${blocker.message || JSON.stringify(blocker)}`);
      } else {
        lines.push(`- ${blocker}`);
      }
    }
  }

  if (handoff.critical_files?.length > 0) {
    lines.push("");
    lines.push("**Key files to review:**");
    for (const file of handoff.critical_files.slice(0, 5)) {
      lines.push(`- ${file}`);
    }
  }

  if (handoff.learnings?.length > 0) {
    lines.push("");
    lines.push("**Learnings from previous session:**");
    for (const learning of handoff.learnings.slice(0, 5)) {
      if (typeof learning === "object") {
        lines.push(`- ${learning.content || learning.message || ""}`);
      } else {
        lines.push(`- ${learning}`);
      }
    }
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  return lines.join("\n");
}

/**
 * Check if auto-handoff should be triggered
 * @param {Object} options - Check options
 * @returns {Object} { shouldHandoff: boolean, reason?: string }
 */
function checkAutoHandoff(options = {}) {
  const { contextUsagePercent = 0, sessionDurationMinutes = 0, threshold = 90 } = options;

  // Check context window threshold
  if (contextUsagePercent >= threshold) {
    return {
      shouldHandoff: true,
      reason: HANDOFF_REASONS.CONTEXT_LIMIT,
      message: `Context usage at ${contextUsagePercent}% (threshold: ${threshold}%)`,
    };
  }

  // Check time limit (optional, if configured)
  const timeLimit = options.timeLimitMinutes || 0;
  if (timeLimit > 0 && sessionDurationMinutes >= timeLimit) {
    return {
      shouldHandoff: true,
      reason: HANDOFF_REASONS.TIME_LIMIT,
      message: `Session duration ${sessionDurationMinutes}m exceeds limit ${timeLimit}m`,
    };
  }

  return {
    shouldHandoff: false,
  };
}

module.exports = {
  // Constants
  HANDOFF_VERSION,
  HANDOFF_REASONS,
  MAX_HANDOFFS_PER_PRD,

  // Core operations
  createNewHandoff,
  loadHandoff,
  loadLatestHandoff,
  listHandoffs,

  // Markdown generation
  generateHandoffMarkdown,
  saveHandoffMarkdown,

  // Context injection
  generateContextInjection,

  // Auto-handoff
  checkAutoHandoff,

  // Thread mapping (re-export)
  getHandoffChain,
  getLatestHandoff,
  visualizeGraph,
  generateMermaidDiagram,
  getThreadStats,
  loadThreadMap,

  // Utilities
  getHandoffsDir,
  getHandoffPath,
  findActivePrdFolder,

  // Schema (re-export)
  schema: require("./schema"),
  context: require("./context"),
  threadMap: require("./thread-map"),
};
