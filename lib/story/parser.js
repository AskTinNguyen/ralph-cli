/**
 * Story Parser - Parse plan.md into structured Story objects
 *
 * Extracts stories from PRD markdown files, supporting both
 * checkbox status formats:
 * - `### [ ] US-001: Story title` (unchecked)
 * - `### [x] US-001: Story title` (checked/completed)
 *
 * @module lib/story/parser
 */

/**
 * Story status enumeration
 */
const StoryStatus = {
  PENDING: "pending",
  COMPLETED: "completed",
};

/**
 * Pattern to match story headings in PRD markdown
 * Matches: ### [ ] US-001: Story title
 * Or:      ### [x] US-001: Story title (completed)
 * Or:      ### US-001: Story title (no checkbox - treated as pending)
 */
const STORY_PATTERN =
  /^###\s+(\[(?<status>[ xX])\]\s+)?(?<id>US-\d+):\s*(?<title>.+)$/;

/**
 * Parse a PRD/plan markdown file into an array of Story objects
 *
 * @param {string} content - The markdown content to parse
 * @param {Object} options - Parsing options
 * @param {boolean} options.includeBlockContent - Include full story block in output (default: true)
 * @returns {Object} Parse result: { ok: boolean, stories: Story[], error?: string }
 */
function parseStories(content, options = {}) {
  const { includeBlockContent = true } = options;

  if (!content || typeof content !== "string") {
    return {
      ok: false,
      stories: [],
      error: "Content must be a non-empty string",
    };
  }

  const lines = content.split("\n");
  const stories = [];
  let currentStory = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = STORY_PATTERN.exec(line);

    if (match) {
      // Save previous story if exists
      if (currentStory) {
        stories.push(finishStory(currentStory, includeBlockContent));
      }

      // Start new story
      const statusChar = (match.groups.status || " ").trim().toLowerCase();
      currentStory = {
        id: match.groups.id,
        title: match.groups.title.trim(),
        status:
          statusChar === "x" ? StoryStatus.COMPLETED : StoryStatus.PENDING,
        statusChar: statusChar || " ",
        lineNumber: i + 1, // 1-indexed
        lines: [line],
      };
    } else if (currentStory !== null) {
      // Accumulate lines for current story
      currentStory.lines.push(line);
    }
  }

  // Don't forget the last story
  if (currentStory) {
    stories.push(finishStory(currentStory, includeBlockContent));
  }

  if (stories.length === 0) {
    return {
      ok: false,
      stories: [],
      error: "No stories found in content (expected format: ### [ ] US-NNN: Title)",
    };
  }

  return {
    ok: true,
    stories,
    total: stories.length,
    completed: stories.filter((s) => s.status === StoryStatus.COMPLETED).length,
    pending: stories.filter((s) => s.status === StoryStatus.PENDING).length,
  };
}

/**
 * Finish building a story object
 * @param {Object} story - Partial story object
 * @param {boolean} includeBlockContent - Whether to include the full block
 * @returns {Object} Completed story object
 */
function finishStory(story, includeBlockContent) {
  const result = {
    id: story.id,
    title: story.title,
    status: story.status,
    statusChar: story.statusChar,
    lineNumber: story.lineNumber,
  };

  if (includeBlockContent) {
    // Trim trailing empty lines from the block
    const blockLines = story.lines.slice();
    while (blockLines.length > 1 && blockLines[blockLines.length - 1].trim() === "") {
      blockLines.pop();
    }
    result.block = blockLines.join("\n");
  }

  return result;
}

/**
 * Parse stories from a file path
 *
 * @param {string} filePath - Path to PRD or plan.md file
 * @returns {Object} Parse result: { ok: boolean, stories: Story[], error?: string }
 */
function parseStoriesFromFile(filePath) {
  const fs = require("fs");
  const path = require("path");

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return {
      ok: false,
      stories: [],
      error: `File not found: ${resolvedPath}`,
    };
  }

  try {
    const content = fs.readFileSync(resolvedPath, "utf8");
    const result = parseStories(content);
    result.filePath = resolvedPath;
    return result;
  } catch (err) {
    return {
      ok: false,
      stories: [],
      error: `Failed to read file: ${err.message}`,
    };
  }
}

/**
 * Check if a story is completed
 * @param {Object} story - Story object
 * @returns {boolean} True if completed
 */
function isCompleted(story) {
  return story && story.status === StoryStatus.COMPLETED;
}

/**
 * Check if a story is pending
 * @param {Object} story - Story object
 * @returns {boolean} True if pending
 */
function isPending(story) {
  return story && story.status === StoryStatus.PENDING;
}

/**
 * Get remaining (uncompleted) stories
 * @param {Object[]} stories - Array of story objects
 * @returns {Object[]} Array of pending stories
 */
function getRemaining(stories) {
  return (stories || []).filter(isPending);
}

/**
 * Get completed stories
 * @param {Object[]} stories - Array of story objects
 * @returns {Object[]} Array of completed stories
 */
function getCompleted(stories) {
  return (stories || []).filter(isCompleted);
}

/**
 * Find a story by ID
 * @param {Object[]} stories - Array of story objects
 * @param {string} storyId - Story ID to find (e.g., "US-001")
 * @returns {Object|null} Story object or null if not found
 */
function findById(stories, storyId) {
  return (stories || []).find((s) => s.id === storyId) || null;
}

/**
 * Get summary statistics for a set of stories
 * @param {Object[]} stories - Array of story objects
 * @returns {Object} Summary statistics
 */
function getSummary(stories) {
  const storyList = stories || [];
  return {
    total: storyList.length,
    completed: storyList.filter(isCompleted).length,
    pending: storyList.filter(isPending).length,
  };
}

module.exports = {
  // Main parsing functions
  parseStories,
  parseStoriesFromFile,

  // Status utilities
  isCompleted,
  isPending,
  getRemaining,
  getCompleted,
  findById,
  getSummary,

  // Constants
  StoryStatus,
  STORY_PATTERN,
};
