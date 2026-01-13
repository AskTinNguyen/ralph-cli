/**
 * AI-Assisted Merge Handler
 *
 * Handles conflict resolution when parallel stories modify the same files.
 * Uses Claude subagent for intelligent 3-way merging.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Detect file conflicts across multiple story results
 *
 * @param {Array} results - Array of execution results from parallel stories
 * @returns {Object} Conflict analysis with conflictedFiles and storyFileMap
 */
function detectConflicts(results) {
  const fileToStories = new Map();

  // Build a map of files to the stories that modified them
  for (const result of results) {
    if (result.status === "success") {
      for (const file of result.filesModified) {
        if (!fileToStories.has(file)) {
          fileToStories.set(file, []);
        }
        fileToStories.get(file).push(result.storyId);
      }
    }
  }

  // Find files modified by multiple stories
  const conflictedFiles = [];
  for (const [file, stories] of fileToStories.entries()) {
    if (stories.length > 1) {
      conflictedFiles.push({
        file,
        stories,
      });
    }
  }

  return {
    conflictedFiles,
    fileToStories: Object.fromEntries(fileToStories),
  };
}

/**
 * Read file content from disk, or return null if it doesn't exist
 *
 * @param {string} filePath - Path to file
 * @param {string} repoRoot - Repository root directory
 * @returns {string|null} File content or null
 */
function readFileContent(filePath, repoRoot) {
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(repoRoot, filePath);

  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch (err) {
    // File doesn't exist yet (new file)
    return null;
  }
}

/**
 * Get base version of a file (before any story modifications)
 *
 * @param {string} filePath - Path to file
 * @param {string} repoRoot - Repository root directory
 * @returns {Promise<string|null>} Base file content or null
 */
async function getBaseVersion(filePath, repoRoot) {
  // Use git to get the version from HEAD
  return new Promise((resolve) => {
    const proc = spawn("git", ["show", `HEAD:${filePath}`], {
      cwd: repoRoot,
      shell: true,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        // File doesn't exist in HEAD (new file)
        resolve(null);
      } else {
        resolve(stdout);
      }
    });
  });
}

/**
 * Spawn merge subagent to resolve conflicts
 *
 * @param {Object} conflict - Conflict object with file and stories
 * @param {Array} results - Story execution results
 * @param {Object} options - Merge options
 * @param {string} options.agentCmd - Agent command template
 * @param {string} options.repoRoot - Repository root directory
 * @param {string} options.promptTemplate - Path to merge prompt template
 * @param {number} options.timeout - Timeout in milliseconds (default: 300000 = 5 minutes)
 * @returns {Promise<Object>} Merge result with status and mergedContent
 */
async function spawnMergeAgent(conflict, results, options) {
  const {
    agentCmd = "codex exec --yolo --skip-git-repo-check -",
    repoRoot,
    promptTemplate,
    timeout = 300000, // 5 minutes for merge operations
  } = options;

  const { file, stories } = conflict;

  // Get base version (from git HEAD)
  const baseContent = await getBaseVersion(file, repoRoot);

  // Get current version (on disk after parallel execution)
  const currentContent = readFileContent(file, repoRoot);

  // Get versions from each story's output
  // Note: Since stories run in parallel and modify files in place,
  // we need to reconstruct what each story intended by reading the current state
  // This is a simplification - in a real implementation, we'd capture
  // the file state after each story execution
  const storyVersions = {};
  for (const storyId of stories) {
    // For now, we'll use the current content
    // In a more robust implementation, each story would save its changes separately
    storyVersions[storyId] = currentContent;
  }

  // Generate merge prompt
  const prompt = await generateMergePrompt({
    file,
    stories,
    baseContent,
    currentContent,
    storyVersions,
    repoRoot,
    promptTemplate,
  });

  // Write prompt to temporary file
  const tmpDir = path.join(repoRoot, ".ralph", ".tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const promptFile = path.join(tmpDir, `merge-${path.basename(file)}-${Date.now()}.md`);
  fs.writeFileSync(promptFile, prompt, "utf-8");

  // Determine how to invoke the agent
  let command, args, input;

  if (agentCmd.includes("{prompt}")) {
    const cmdParts = agentCmd.replace("{prompt}", promptFile).split(/\s+/);
    command = cmdParts[0];
    args = cmdParts.slice(1);
    input = null;
  } else if (agentCmd.endsWith("-")) {
    const cmdParts = agentCmd.split(/\s+/);
    command = cmdParts[0];
    args = cmdParts.slice(1);
    input = prompt;
  } else {
    const cmdParts = agentCmd.split(/\s+/);
    command = cmdParts[0];
    args = [...cmdParts.slice(1), prompt];
    input = null;
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";

    const proc = spawn(command, args, {
      cwd: repoRoot,
      shell: true,
      stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    // Set timeout
    const timeoutId = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Merge agent timed out after ${timeout}ms for file ${file}`));
    }, timeout);

    // If agent reads from stdin, write the prompt
    if (input && proc.stdin) {
      proc.stdin.write(input);
      proc.stdin.end();
    }

    // Collect output
    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Handle completion
    proc.on("close", (code) => {
      clearTimeout(timeoutId);

      // Clean up prompt file
      try {
        fs.unlinkSync(promptFile);
      } catch (err) {
        // Ignore cleanup errors
      }

      const duration = Date.now() - startTime;

      if (code !== 0) {
        resolve({
          status: "failed",
          error: `Merge agent failed with code ${code}\nStderr: ${stderr}`,
          file,
          duration,
        });
        return;
      }

      // Parse merge result
      const result = parseMergeResult(stdout, file, duration);
      resolve(result);
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      reject(new Error(`Failed to spawn merge agent for file ${file}: ${err.message}`));
    });
  });
}

/**
 * Generate merge prompt for AI agent
 *
 * @param {Object} options - Merge prompt options
 * @returns {Promise<string>} Generated prompt
 */
async function generateMergePrompt(options) {
  const {
    file,
    stories,
    baseContent,
    currentContent,
    storyVersions,
    repoRoot,
    promptTemplate,
  } = options;

  // Load template
  let template;
  if (promptTemplate && fs.existsSync(promptTemplate)) {
    template = fs.readFileSync(promptTemplate, "utf-8");
  } else {
    template = getDefaultMergeTemplate();
  }

  // Format versions for display
  const baseDisplay = baseContent ? baseContent : "(new file - no base version)";
  const currentDisplay = currentContent ? currentContent : "(file does not exist)";

  // Build story versions section
  let storyVersionsDisplay = "";
  for (const storyId of stories) {
    const content = storyVersions[storyId] || "(no content)";
    storyVersionsDisplay += `\n### Story ${storyId} Version:\n\`\`\`\n${content}\n\`\`\`\n`;
  }

  // Replace placeholders
  const prompt = template
    .replace(/\{\{FILE_PATH\}\}/g, file)
    .replace(/\{\{STORIES\}\}/g, stories.join(", "))
    .replace(/\{\{BASE_CONTENT\}\}/g, baseDisplay)
    .replace(/\{\{CURRENT_CONTENT\}\}/g, currentDisplay)
    .replace(/\{\{STORY_VERSIONS\}\}/g, storyVersionsDisplay);

  return prompt;
}

/**
 * Default template for merge operations
 */
function getDefaultMergeTemplate() {
  return `# 3-Way Merge Conflict Resolution

You are a merge agent resolving conflicts for parallel story execution.

## File: {{FILE_PATH}}

**Conflicting Stories:** {{STORIES}}

## Base Version (from git HEAD):
\`\`\`
{{BASE_CONTENT}}
\`\`\`

## Current Version (after parallel execution):
\`\`\`
{{CURRENT_CONTENT}}
\`\`\`

{{STORY_VERSIONS}}

## Your Task

Analyze the changes from each story and create a merged version that:
1. Preserves all functionality from both stories
2. Resolves any conflicts intelligently
3. Maintains code quality and consistency
4. Follows the existing code style

## Instructions

1. Compare the base version with each story's changes
2. Identify what each story was trying to accomplish
3. Merge the changes in a way that preserves both intents
4. If changes are incompatible, choose the most sensible resolution

## Output Format

Output the merged result in this format:

\`\`\`
<merge-result>
{
  "status": "success|failed",
  "mergedContent": "...entire merged file content...",
  "error": "error message if failed",
  "reasoning": "brief explanation of merge decisions"
}
</merge-result>
\`\`\`

**Important:** The mergedContent field must contain the COMPLETE merged file content, not just the diff.
`;
}

/**
 * Parse merge result from agent output
 *
 * @param {string} output - Agent stdout
 * @param {string} file - File path being merged
 * @param {number} duration - Merge duration in ms
 * @returns {Object} Parsed merge result
 */
function parseMergeResult(output, file, duration) {
  // Try to find <merge-result> block
  const resultMatch = output.match(/<merge-result>\s*(\{[\s\S]*?\})\s*<\/merge-result>/);

  if (resultMatch) {
    try {
      const result = JSON.parse(resultMatch[1]);
      return {
        status: result.status || "success",
        mergedContent: result.mergedContent || null,
        error: result.error || null,
        reasoning: result.reasoning || null,
        file,
        duration,
        rawOutput: output,
      };
    } catch (err) {
      return {
        status: "failed",
        error: `Failed to parse merge result JSON: ${err.message}`,
        mergedContent: null,
        file,
        duration,
        rawOutput: output,
      };
    }
  }

  // No result block found
  return {
    status: "failed",
    error: "No <merge-result> block found in agent output",
    mergedContent: null,
    file,
    duration,
    rawOutput: output,
  };
}

/**
 * Apply merged content to file on disk
 *
 * @param {string} file - File path (relative to repo root)
 * @param {string} content - Merged content to write
 * @param {string} repoRoot - Repository root directory
 * @returns {boolean} True if successful
 */
function applyMergedContent(file, content, repoRoot) {
  try {
    const fullPath = path.isAbsolute(file) ? file : path.join(repoRoot, file);

    // Ensure directory exists
    const dir = path.dirname(fullPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(fullPath, content, "utf-8");
    return true;
  } catch (err) {
    console.error(`Failed to write merged content to ${file}: ${err.message}`);
    return false;
  }
}

/**
 * Resolve all conflicts using AI-assisted merging
 *
 * @param {Array} results - Story execution results
 * @param {Object} options - Merge options
 * @returns {Promise<Object>} Merge summary with resolved/failed conflicts
 */
async function resolveConflicts(results, options) {
  const { conflictedFiles } = detectConflicts(results);

  if (conflictedFiles.length === 0) {
    return {
      status: "no-conflicts",
      resolved: [],
      failed: [],
    };
  }

  const resolved = [];
  const failed = [];

  // Process each conflict
  for (const conflict of conflictedFiles) {
    try {
      const mergeResult = await spawnMergeAgent(conflict, results, options);

      if (mergeResult.status === "success" && mergeResult.mergedContent) {
        // Apply merged content
        const applied = applyMergedContent(
          mergeResult.file,
          mergeResult.mergedContent,
          options.repoRoot
        );

        if (applied) {
          resolved.push({
            file: mergeResult.file,
            stories: conflict.stories,
            reasoning: mergeResult.reasoning,
          });
        } else {
          failed.push({
            file: mergeResult.file,
            stories: conflict.stories,
            error: "Failed to write merged content",
          });
        }
      } else {
        failed.push({
          file: mergeResult.file,
          stories: conflict.stories,
          error: mergeResult.error || "Merge failed",
        });
      }
    } catch (err) {
      failed.push({
        file: conflict.file,
        stories: conflict.stories,
        error: err.message,
      });
    }
  }

  return {
    status: failed.length === 0 ? "success" : "partial",
    resolved,
    failed,
  };
}

module.exports = {
  detectConflicts,
  readFileContent,
  getBaseVersion,
  spawnMergeAgent,
  generateMergePrompt,
  parseMergeResult,
  applyMergedContent,
  resolveConflicts,
};
