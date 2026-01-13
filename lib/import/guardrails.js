/**
 * Guardrails import module
 *
 * Handles importing guardrails from other projects in the registry.
 */
const fs = require("fs");
const path = require("path");

/**
 * Parse guardrails from a guardrails.md file
 * @param {string} guardrailsPath - Path to guardrails.md file
 * @returns {Object[]} - Array of parsed guardrail objects
 */
function parseGuardrails(guardrailsPath) {
  if (!fs.existsSync(guardrailsPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(guardrailsPath, "utf-8");
    const guardrails = [];

    // Match guardrail entries - both "### Sign:" and simple "###" patterns
    const signRegex = /### (?:Sign: )?([^\n]+)\n([\s\S]*?)(?=###|$)/g;
    let match;

    while ((match = signRegex.exec(content)) !== null) {
      const title = match[1].trim();
      const body = match[2].trim();

      // Skip empty or section headers
      if (!body || title.toLowerCase() === "core signs" || title.toLowerCase() === "learned signs") {
        continue;
      }

      // Extract trigger and instruction
      const triggerMatch = body.match(/[-*]\s*\*\*Trigger\*\*:\s*(.+)/);
      const instructionMatch = body.match(/[-*]\s*\*\*Instruction\*\*:\s*(.+)/);
      const addedAfterMatch = body.match(/[-*]\s*\*\*Added after\*\*:\s*(.+)/);
      const contextMatch = body.match(/[-*]\s*\*\*Context\*\*:\s*(.+)/);

      guardrails.push({
        title,
        trigger: triggerMatch ? triggerMatch[1].trim() : "",
        instruction: instructionMatch ? instructionMatch[1].trim() : "",
        addedAfter: addedAfterMatch ? addedAfterMatch[1].trim() : "",
        context: contextMatch ? contextMatch[1].trim() : "",
        rawContent: body,
      });
    }

    return guardrails;
  } catch {
    return [];
  }
}

/**
 * Get guardrails from a project
 * @param {string} projectPath - Path to the project
 * @returns {Object[]} - Array of guardrail objects with project info
 */
function getProjectGuardrails(projectPath) {
  const guardrailsPath = path.join(projectPath, ".ralph", "guardrails.md");
  return parseGuardrails(guardrailsPath);
}

/**
 * Format a guardrail for display in preview
 * @param {Object} guardrail - Guardrail object
 * @returns {string} - Formatted string for display
 */
function formatGuardrailPreview(guardrail) {
  let preview = `### Sign: ${guardrail.title}`;
  if (guardrail.trigger) {
    preview += `\n  Trigger: ${guardrail.trigger}`;
  }
  if (guardrail.instruction) {
    preview += `\n  Instruction: ${guardrail.instruction}`;
  }
  return preview;
}

/**
 * Format imported guardrails for writing to guardrails.md
 * @param {Object[]} guardrails - Array of guardrail objects
 * @param {string} sourceName - Name of the source project
 * @returns {string} - Formatted markdown string
 */
function formatImportedGuardrails(guardrails, sourceName) {
  const importedAt = new Date().toISOString();
  let content = "";

  for (const guardrail of guardrails) {
    content += `\n### Sign: ${guardrail.title}\n`;
    if (guardrail.trigger) {
      content += `- **Trigger**: ${guardrail.trigger}\n`;
    }
    if (guardrail.instruction) {
      content += `- **Instruction**: ${guardrail.instruction}\n`;
    }
    if (guardrail.context) {
      content += `- **Context**: ${guardrail.context}\n`;
    }
    content += `- **Imported from**: ${sourceName}\n`;
    content += `- **Imported at**: ${importedAt}\n`;
  }

  return content;
}

/**
 * Check if a guardrail already exists in target
 * @param {Object} guardrail - Guardrail to check
 * @param {Object[]} existingGuardrails - Existing guardrails in target
 * @returns {boolean} - True if guardrail already exists
 */
function guardrailExists(guardrail, existingGuardrails) {
  return existingGuardrails.some(
    (existing) =>
      existing.title.toLowerCase() === guardrail.title.toLowerCase() ||
      (existing.trigger &&
        guardrail.trigger &&
        existing.trigger.toLowerCase() === guardrail.trigger.toLowerCase())
  );
}

/**
 * Import guardrails into target project's guardrails.md
 * @param {Object[]} guardrails - Guardrails to import
 * @param {string} targetPath - Path to target project
 * @param {string} sourceName - Name of source project
 * @returns {Object} - Result with imported count and skipped count
 */
function importGuardrails(guardrails, targetPath, sourceName) {
  const targetGuardrailsPath = path.join(targetPath, ".ralph", "guardrails.md");

  // Ensure directory exists
  fs.mkdirSync(path.dirname(targetGuardrailsPath), { recursive: true });

  // Parse existing guardrails
  const existingGuardrails = parseGuardrails(targetGuardrailsPath);

  // Filter out duplicates
  const toImport = guardrails.filter((g) => !guardrailExists(g, existingGuardrails));
  const skipped = guardrails.length - toImport.length;

  if (toImport.length === 0) {
    return { imported: 0, skipped };
  }

  // Create or append to guardrails.md
  let content = "";
  if (!fs.existsSync(targetGuardrailsPath)) {
    content = `# Guardrails (Signs)\n\n> Lessons learned from failures. Read before acting.\n\n## Imported Signs\n`;
  } else {
    content = fs.readFileSync(targetGuardrailsPath, "utf-8");

    // Add imported section if it doesn't exist
    if (!content.includes("## Imported Signs")) {
      content += "\n## Imported Signs\n";
    }
  }

  // Append imported guardrails
  content += formatImportedGuardrails(toImport, sourceName);

  fs.writeFileSync(targetGuardrailsPath, content);

  return { imported: toImport.length, skipped };
}

/**
 * Get suggested projects based on tech stack similarity
 * @param {Object[]} projects - Array of registered projects
 * @param {string[]} targetStack - Tech stack of target project
 * @returns {Object[]} - Sorted array of projects with relevance scores
 */
function getSuggestedProjects(projects, targetStack) {
  if (!targetStack || targetStack.length === 0) {
    return projects;
  }

  // Score projects by tag overlap
  const scored = projects.map((project) => {
    const overlap = project.tags.filter((tag) =>
      targetStack.some((t) => t.toLowerCase() === tag.toLowerCase())
    );
    const score = overlap.length;
    return { ...project, relevanceScore: score, matchingTags: overlap };
  });

  // Sort by relevance score (highest first), then by guardrail count
  return scored.sort((a, b) => {
    if (b.relevanceScore !== a.relevanceScore) {
      return b.relevanceScore - a.relevanceScore;
    }
    return (b.stats?.guardrailCount || 0) - (a.stats?.guardrailCount || 0);
  });
}

module.exports = {
  parseGuardrails,
  getProjectGuardrails,
  formatGuardrailPreview,
  formatImportedGuardrails,
  guardrailExists,
  importGuardrails,
  getSuggestedProjects,
};
