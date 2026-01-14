/**
 * Plan.md story parser - extracts stories with acceptance criteria for estimation
 */
const fs = require("fs");
const path = require("path");

// Lazy load risk analyzer to avoid circular dependencies
let riskAnalyzer = null;
function getRiskAnalyzer() {
  if (!riskAnalyzer) {
    try {
      riskAnalyzer = require("../risk/analyzer");
    } catch {
      riskAnalyzer = null;
    }
  }
  return riskAnalyzer;
}

/**
 * Parse a plan.md file and extract stories with their metadata
 * @param {string} planPath - Path to plan.md file
 * @returns {Object} Parsed plan with stories array
 */
function parsePlan(planPath) {
  if (!fs.existsSync(planPath)) {
    return null;
  }

  const content = fs.readFileSync(planPath, "utf-8");
  return parsePlanContent(content);
}

/**
 * Parse plan.md content and extract stories
 * @param {string} content - Plan.md content
 * @returns {Object} Parsed plan with stories array
 */
function parsePlanContent(content) {
  const lines = content.split("\n");
  const stories = [];
  let currentStory = null;
  let inTasksSection = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code fences (``` or ```language)
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip story detection inside code blocks
    if (inCodeBlock) {
      continue;
    }

    // Match story headers: ### US-XXX: Title or ### [ ] US-XXX: Title or ### [x] US-XXX: Title
    const storyMatch = trimmed.match(/^###\s*(?:\[([x\s])\]\s*)?(?:(US-\d+):\s*)?(.+)$/i);

    if (storyMatch) {
      // Save previous story if exists
      if (currentStory) {
        stories.push(currentStory);
      }

      const completed = storyMatch[1] && storyMatch[1].toLowerCase() === "x";
      const storyId = storyMatch[2] || `story-${stories.length + 1}`;
      const title = storyMatch[3].trim();

      currentStory = {
        id: storyId,
        title: title,
        completed: completed,
        tasks: [],
        taskCount: 0,
        completedTasks: 0,
        keywords: extractKeywords(title),
        storyBlock: "", // Collect story block for risk analysis
      };
      inTasksSection = true;
      continue;
    }

    // Match tasks within a story: - [ ] Task description or - [x] Task description
    if (currentStory && inTasksSection) {
      // Collect story block content for risk analysis
      currentStory.storyBlock += line + "\n";

      const taskMatch = trimmed.match(/^-\s*\[([x\s])\]\s*(.+)$/i);

      if (taskMatch) {
        const taskCompleted = taskMatch[1].toLowerCase() === "x";
        const taskText = taskMatch[2].trim();

        currentStory.tasks.push({
          text: taskText,
          completed: taskCompleted,
        });

        currentStory.taskCount++;
        if (taskCompleted) {
          currentStory.completedTasks++;
        }
      }

      // End tasks section when we hit another section header or blank line followed by non-task content
      if (trimmed.startsWith("##") && !trimmed.startsWith("###")) {
        inTasksSection = false;
      }
    }
  }

  // Save last story and add risk scores
  if (currentStory) {
    stories.push(currentStory);
  }

  // Add risk scores to all stories
  const analyzer = getRiskAnalyzer();
  if (analyzer) {
    for (const story of stories) {
      const riskResult = analyzer.analyzeStoryRisk(story.storyBlock || story.title);
      story.risk = {
        score: riskResult.score,
        level: riskResult.riskLevel,
        factors: riskResult.factors,
      };
      // Clean up the temporary storyBlock field
      delete story.storyBlock;
    }
  } else {
    // Remove storyBlock if analyzer not available
    for (const story of stories) {
      delete story.storyBlock;
    }
  }

  return {
    stories: stories,
    totalStories: stories.length,
    completedStories: stories.filter((s) => s.completed).length,
    pendingStories: stories.filter((s) => !s.completed).length,
  };
}

/**
 * Extract keywords from story title for complexity multipliers
 * @param {string} title - Story title
 * @returns {string[]} Array of matched keywords
 */
function extractKeywords(title) {
  const keywords = [];
  const titleLower = title.toLowerCase();

  const keywordPatterns = [
    { pattern: /\brefactor\b/, keyword: "refactor" },
    { pattern: /\btest\b/, keyword: "test" },
    { pattern: /\bfeature\b/, keyword: "feature" },
    { pattern: /\bfix\b/, keyword: "fix" },
    { pattern: /\bdocs?\b/, keyword: "docs" },
    { pattern: /\bdocumentation\b/, keyword: "docs" },
    { pattern: /\bbug\b/, keyword: "fix" },
    { pattern: /\bapi\b/, keyword: "feature" },
    { pattern: /\bui\b/, keyword: "feature" },
    { pattern: /\bcommand\b/, keyword: "feature" },
  ];

  for (const { pattern, keyword } of keywordPatterns) {
    if (pattern.test(titleLower) && !keywords.includes(keyword)) {
      keywords.push(keyword);
    }
  }

  return keywords;
}

/**
 * Parse a prd.md file and extract stories with acceptance criteria
 * @param {string} prdPath - Path to prd.md file
 * @returns {Object} Parsed PRD with stories array
 */
function parsePRD(prdPath) {
  if (!fs.existsSync(prdPath)) {
    return null;
  }

  const content = fs.readFileSync(prdPath, "utf-8");
  return parsePRDContent(content);
}

/**
 * Parse PRD content and extract stories with acceptance criteria
 * @param {string} content - PRD content
 * @returns {Object} Parsed PRD with stories
 */
function parsePRDContent(content) {
  const lines = content.split("\n");
  const stories = [];
  let currentStory = null;
  let inAcceptanceCriteria = false;
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code fences (``` or ```language)
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    // Skip story detection inside code blocks
    if (inCodeBlock) {
      continue;
    }

    // Match story headers: ### [ ] US-XXX: Title or ### [x] US-XXX: Title
    const storyMatch = trimmed.match(/^###\s*\[([x\s])\]\s*(US-\d+):\s*(.+)$/i);

    if (storyMatch) {
      // Save previous story if exists
      if (currentStory) {
        stories.push(currentStory);
      }

      const completed = storyMatch[1].toLowerCase() === "x";
      const storyId = storyMatch[2];
      const title = storyMatch[3].trim();

      currentStory = {
        id: storyId,
        title: title,
        completed: completed,
        acceptanceCriteria: [],
        acceptanceCriteriaCount: 0,
        completedCriteria: 0,
        keywords: extractKeywords(title),
        storyBlock: "", // Collect story block for risk analysis
      };
      inAcceptanceCriteria = false;
      continue;
    }

    // Check for acceptance criteria section header
    if (trimmed.toLowerCase().startsWith("#### acceptance criteria")) {
      inAcceptanceCriteria = true;
      continue;
    }

    // End acceptance criteria section on new section header
    if (
      trimmed.startsWith("###") ||
      (trimmed.startsWith("####") && !trimmed.toLowerCase().includes("acceptance"))
    ) {
      inAcceptanceCriteria = false;
    }

    // Parse acceptance criteria items and collect story content
    if (currentStory) {
      // Collect all lines for story block (for risk analysis)
      currentStory.storyBlock += line + "\n";

      if (inAcceptanceCriteria) {
        const criteriaMatch = trimmed.match(/^-\s*\[([x\s])\]\s*(.+)$/i);

        if (criteriaMatch) {
          const criteriaCompleted = criteriaMatch[1].toLowerCase() === "x";
          const criteriaText = criteriaMatch[2].trim();

          currentStory.acceptanceCriteria.push({
            text: criteriaText,
            completed: criteriaCompleted,
          });

          currentStory.acceptanceCriteriaCount++;
          if (criteriaCompleted) {
            currentStory.completedCriteria++;
          }
        }
      }
    }
  }

  // Save last story
  if (currentStory) {
    stories.push(currentStory);
  }

  // Add risk scores to all stories
  const analyzer = getRiskAnalyzer();
  if (analyzer) {
    for (const story of stories) {
      const riskResult = analyzer.analyzeStoryRisk(story.storyBlock || story.title);
      story.risk = {
        score: riskResult.score,
        level: riskResult.riskLevel,
        factors: riskResult.factors,
      };
      // Clean up the temporary storyBlock field
      delete story.storyBlock;
    }
  } else {
    // Remove storyBlock if analyzer not available
    for (const story of stories) {
      delete story.storyBlock;
    }
  }

  return {
    stories: stories,
    totalStories: stories.length,
    completedStories: stories.filter((s) => s.completed).length,
    pendingStories: stories.filter((s) => !s.completed).length,
  };
}

/**
 * Get pending (uncompleted) stories from a parsed plan or PRD
 * @param {Object} parsed - Parsed plan or PRD object
 * @returns {Object[]} Array of pending stories
 */
function getPendingStories(parsed) {
  if (!parsed || !parsed.stories) {
    return [];
  }
  return parsed.stories.filter((s) => !s.completed);
}

module.exports = {
  parsePlan,
  parsePlanContent,
  parsePRD,
  parsePRDContent,
  extractKeywords,
  getPendingStories,
};
