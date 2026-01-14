/**
 * Parallel Execution Orchestrator
 *
 * Spawns multiple Claude subagents concurrently to execute stories in parallel.
 * Each subagent runs in isolation and reports back its results.
 *
 * Features:
 * - Configurable concurrency and timeout
 * - Automatic retry for failed subagents (once before marking as failed)
 * - Clean termination on timeout with SIGTERM followed by SIGKILL
 * - Detailed error reporting for diagnostics
 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Execute stories in parallel using child processes
 *
 * @param {Array} stories - Array of story objects with id, title, content
 * @param {Object} options - Execution options
 * @param {number} options.maxConcurrency - Max number of concurrent agents (default: 3)
 * @param {number} options.timeout - Timeout per agent in milliseconds (default: 600000 = 10 minutes)
 * @param {string} options.agentCmd - Agent command template (e.g., "codex exec --yolo -")
 * @param {string} options.prdPath - Path to PRD file
 * @param {string} options.planPath - Path to plan file
 * @param {string} options.progressPath - Path to progress file
 * @param {string} options.guardrailsPath - Path to guardrails file
 * @param {string} options.errorsLogPath - Path to errors log
 * @param {string} options.activityLogPath - Path to activity log
 * @param {string} options.repoRoot - Repository root directory
 * @param {string} options.runId - Run ID for tracking
 * @param {string} options.promptTemplate - Path to prompt template for parallel execution
 * @param {number} options.maxRetries - Maximum retry attempts for failed agents (default: 1)
 * @returns {Promise<Array>} Array of execution results
 */
async function executeParallel(stories, options = {}) {
  const {
    maxConcurrency = 3,
    timeout = 600000, // 10 minutes
    agentCmd = "codex exec --yolo --skip-git-repo-check -",
    prdPath,
    planPath,
    progressPath,
    guardrailsPath,
    errorsLogPath,
    activityLogPath,
    repoRoot,
    runId,
    promptTemplate,
    maxRetries = 1,
  } = options;

  if (!stories || stories.length === 0) {
    return [];
  }

  if (!prdPath || !planPath) {
    throw new Error("prdPath and planPath are required");
  }

  // Track active agents and results
  const results = [];
  const activeAgents = new Map();
  let nextStoryIndex = 0;

  // Track retry attempts
  const retryCount = new Map();

  // Process stories in batches up to maxConcurrency
  return new Promise((resolve, reject) => {
    const startNextAgent = () => {
      // Check if we're done
      if (nextStoryIndex >= stories.length && activeAgents.size === 0) {
        resolve(results);
        return;
      }

      // Start new agents up to maxConcurrency
      while (activeAgents.size < maxConcurrency && nextStoryIndex < stories.length) {
        const story = stories[nextStoryIndex];
        nextStoryIndex++;

        executeStoryWithRetry(story, options, maxRetries, retryCount, errorsLogPath)
          .then((result) => {
            activeAgents.delete(story.id);
            results.push(result);
            startNextAgent(); // Start next story
          })
          .catch((error) => {
            activeAgents.delete(story.id);
            const errorResult = {
              storyId: story.id,
              status: "failed",
              error: error.message,
              filesModified: [],
              potentialConflicts: [],
              retriesAttempted: retryCount.get(story.id) || 0,
            };
            results.push(errorResult);

            // Log error to errors.log
            logError(errorsLogPath, story.id, error.message, retryCount.get(story.id) || 0);

            startNextAgent(); // Continue with next story
          });

        activeAgents.set(story.id, { story, startedAt: Date.now() });
      }
    };

    startNextAgent();
  });
}

/**
 * Execute a story with automatic retry on failure
 *
 * @param {Object} story - Story object
 * @param {Object} options - Execution options
 * @param {number} maxRetries - Maximum retry attempts
 * @param {Map} retryCount - Map tracking retry attempts per story
 * @param {string} errorsLogPath - Path to errors log
 * @returns {Promise<Object>} Execution result
 */
async function executeStoryWithRetry(story, options, maxRetries, retryCount, errorsLogPath) {
  let lastError;
  const attempts = maxRetries + 1; // Initial attempt + retries

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const result = await executeStory(story, options);

      // If successful, return the result
      if (result.status === "success") {
        if (attempt > 0) {
          console.log(`[executor] ${story.id}: Succeeded on retry ${attempt}`);
        }
        return result;
      }

      // If failed but not due to error, try again
      lastError = new Error(result.error || "Agent returned failed status");
    } catch (error) {
      lastError = error;
    }

    // Track retry count
    retryCount.set(story.id, attempt + 1);

    // Log retry attempt
    if (attempt < attempts - 1) {
      console.log(`[executor] ${story.id}: Attempt ${attempt + 1} failed, retrying... Error: ${lastError.message}`);

      // Brief delay before retry
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // All attempts failed
  const finalError = new Error(
    `Story ${story.id} failed after ${attempts} attempt(s): ${lastError.message}`
  );
  throw finalError;
}

/**
 * Log error to errors.log file
 *
 * @param {string} errorsLogPath - Path to errors log file
 * @param {string} storyId - Story ID that failed
 * @param {string} errorMessage - Error message
 * @param {number} retriesAttempted - Number of retries attempted
 */
function logError(errorsLogPath, storyId, errorMessage, retriesAttempted) {
  if (!errorsLogPath) return;

  try {
    const timestamp = new Date().toISOString().replace("T", " ").split(".")[0];
    const entry = `[${timestamp}] ${storyId}: FAILED after ${retriesAttempted} retry(s) - ${errorMessage}\n`;

    // Ensure directory exists
    const dir = path.dirname(errorsLogPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.appendFileSync(errorsLogPath, entry, "utf-8");
  } catch (err) {
    console.error(`[executor] Failed to log error to ${errorsLogPath}: ${err.message}`);
  }
}

/**
 * Execute a single story using a child process agent
 *
 * @param {Object} story - Story object with id, title, content
 * @param {Object} options - Execution options
 * @returns {Promise<Object>} Execution result
 */
async function executeStory(story, options) {
  const {
    timeout = 600000,
    agentCmd,
    prdPath,
    planPath,
    progressPath,
    guardrailsPath,
    errorsLogPath,
    activityLogPath,
    repoRoot,
    runId,
    promptTemplate,
  } = options;

  // Generate prompt for this story
  const prompt = await generatePrompt(story, {
    prdPath,
    planPath,
    progressPath,
    guardrailsPath,
    errorsLogPath,
    activityLogPath,
    repoRoot,
    runId,
    promptTemplate,
  });

  // Write prompt to temporary file
  const tmpDir = path.join(repoRoot, ".ralph", ".tmp");
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }

  const promptFile = path.join(tmpDir, `parallel-${story.id}-${Date.now()}.md`);
  fs.writeFileSync(promptFile, prompt, "utf-8");

  // Determine how to invoke the agent
  let command, args, input;

  if (agentCmd.includes("{prompt}")) {
    // Agent expects prompt file path as argument (e.g., droid)
    const cmdParts = agentCmd.replace("{prompt}", promptFile).split(/\s+/);
    command = cmdParts[0];
    args = cmdParts.slice(1);
    input = null;
  } else if (agentCmd.endsWith("-")) {
    // Agent reads from stdin (e.g., codex exec -)
    const cmdParts = agentCmd.split(/\s+/);
    command = cmdParts[0];
    args = cmdParts.slice(1);
    input = prompt;
  } else {
    // Agent expects inline prompt (e.g., claude)
    const cmdParts = agentCmd.split(/\s+/);
    command = cmdParts[0];
    args = [...cmdParts.slice(1), prompt];
    input = null;
  }

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let forceKillTimeoutId = null;

    // Spawn the agent process
    const proc = spawn(command, args, {
      cwd: repoRoot,
      shell: true,
      stdio: input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    });

    // Clean termination function
    const cleanTerminate = () => {
      timedOut = true;

      // First, send SIGTERM for graceful shutdown
      proc.kill("SIGTERM");
      console.log(`[executor] ${story.id}: Sending SIGTERM (timeout after ${Math.round(timeout / 1000)}s)`);

      // If process doesn't exit within 10 seconds, force kill with SIGKILL
      forceKillTimeoutId = setTimeout(() => {
        try {
          proc.kill("SIGKILL");
          console.log(`[executor] ${story.id}: Sending SIGKILL (force kill)`);
        } catch (err) {
          // Process may have already exited
        }
      }, 10000);
    };

    // Set timeout
    const timeoutId = setTimeout(cleanTerminate, timeout);

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
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }

      // Clean up prompt file
      try {
        fs.unlinkSync(promptFile);
      } catch (err) {
        // Ignore cleanup errors
      }

      const duration = Date.now() - startTime;

      // Check if timed out
      if (timedOut) {
        reject(
          new Error(`Agent timed out after ${Math.round(timeout / 1000)} seconds for story ${story.id}. The agent was terminated gracefully.`)
        );
        return;
      }

      if (code !== 0) {
        // Provide more detailed error message
        const truncatedStderr = stderr.length > 500 ? stderr.substring(0, 500) + "..." : stderr;
        reject(
          new Error(
            `Agent failed for story ${story.id} with exit code ${code}.\n` +
              `Duration: ${Math.round(duration / 1000)}s\n` +
              `Stderr: ${truncatedStderr || "(no stderr)"}`
          )
        );
        return;
      }

      // Parse result from agent output
      const result = parseAgentOutput(stdout, story.id, duration);
      resolve(result);
    });

    proc.on("error", (err) => {
      clearTimeout(timeoutId);
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
      reject(new Error(`Failed to spawn agent for story ${story.id}: ${err.message}`));
    });
  });
}

/**
 * Generate prompt for a story using the template
 *
 * @param {Object} story - Story object
 * @param {Object} options - Prompt options
 * @returns {Promise<string>} Generated prompt
 */
async function generatePrompt(story, options) {
  const {
    prdPath,
    planPath,
    progressPath,
    guardrailsPath,
    errorsLogPath,
    activityLogPath,
    repoRoot,
    runId,
    promptTemplate,
  } = options;

  // Load template
  let template;
  if (promptTemplate && fs.existsSync(promptTemplate)) {
    template = fs.readFileSync(promptTemplate, "utf-8");
  } else {
    // Use default template (similar to PROMPT_build.md but for parallel execution)
    template = getDefaultTemplate();
  }

  // Replace placeholders
  const prompt = template
    .replace(/\{\{STORY_ID\}\}/g, story.id)
    .replace(/\{\{STORY_TITLE\}\}/g, story.title)
    .replace(/\{\{STORY_CONTENT\}\}/g, story.content)
    .replace(/\{\{PRD_PATH\}\}/g, prdPath)
    .replace(/\{\{PLAN_PATH\}\}/g, planPath)
    .replace(/\{\{PROGRESS_PATH\}\}/g, progressPath || "")
    .replace(/\{\{GUARDRAILS_PATH\}\}/g, guardrailsPath || "")
    .replace(/\{\{ERRORS_LOG_PATH\}\}/g, errorsLogPath || "")
    .replace(/\{\{ACTIVITY_LOG_PATH\}\}/g, activityLogPath || "")
    .replace(/\{\{REPO_ROOT\}\}/g, repoRoot)
    .replace(/\{\{RUN_ID\}\}/g, runId || "");

  return prompt;
}

/**
 * Default template for parallel execution
 */
function getDefaultTemplate() {
  return `# Parallel Story Execution

You are executing story {{STORY_ID}} as part of a parallel batch.

## Story Details
**ID:** {{STORY_ID}}
**Title:** {{STORY_TITLE}}

{{STORY_CONTENT}}

## Instructions
1. Read the PRD at {{PRD_PATH}}
2. Read the plan at {{PLAN_PATH}}
3. Implement ONLY the tasks for {{STORY_ID}}
4. Do NOT commit changes (the orchestrator handles commits)
5. Do NOT modify other stories' files unless explicitly required by {{STORY_ID}}
6. Work in isolation - other agents are working on other stories concurrently

## Output Format
At the end of your execution, output a result block in this format:

\`\`\`
<parallel-result>
{
  "storyId": "{{STORY_ID}}",
  "status": "success|failed",
  "filesModified": ["path/to/file1.js", "path/to/file2.ts"],
  "potentialConflicts": ["path/to/shared/file.js"],
  "error": "error message if failed",
  "duration": 1234
}
</parallel-result>
\`\`\`

**Important:** Do NOT commit. The orchestrator will handle all commits after merging changes.
`;
}

/**
 * Parse agent output to extract result
 *
 * @param {string} output - Agent stdout
 * @param {string} storyId - Story ID
 * @param {number} duration - Execution duration in ms
 * @returns {Object} Parsed result
 */
function parseAgentOutput(output, storyId, duration) {
  // Try to find <parallel-result> block
  const resultMatch = output.match(/<parallel-result>\s*(\{[\s\S]*?\})\s*<\/parallel-result>/);

  if (resultMatch) {
    try {
      const result = JSON.parse(resultMatch[1]);
      return {
        storyId: result.storyId || storyId,
        status: result.status || "success",
        filesModified: result.filesModified || [],
        potentialConflicts: result.potentialConflicts || [],
        error: result.error || null,
        duration: result.duration || duration,
        rawOutput: output,
      };
    } catch (err) {
      // Failed to parse JSON, return default success
      return {
        storyId,
        status: "success",
        filesModified: extractFilesFromOutput(output),
        potentialConflicts: [],
        error: null,
        duration,
        rawOutput: output,
      };
    }
  }

  // No result block found, try to extract files from output
  return {
    storyId,
    status: "success",
    filesModified: extractFilesFromOutput(output),
    potentialConflicts: [],
    error: null,
    duration,
    rawOutput: output,
  };
}

/**
 * Extract modified files from agent output by looking for common patterns
 *
 * @param {string} output - Agent output
 * @returns {Array} Array of file paths
 */
function extractFilesFromOutput(output) {
  const files = new Set();

  // Pattern 1: "Created file: path/to/file.js"
  const createdPattern =
    /(?:Created|Modified|Updated|Wrote)\s+(?:file:\s*)?([a-zA-Z0-9_\-./]+\.(js|ts|tsx|jsx|md|sh|json|yml|yaml|css|html))/gi;
  let match;
  while ((match = createdPattern.exec(output)) !== null) {
    files.add(match[1]);
  }

  // Pattern 2: Look for file paths in backticks
  const backtickPattern = /`([a-zA-Z0-9_\-./]+\.(js|ts|tsx|jsx|md|sh|json|yml|yaml|css|html))`/g;
  while ((match = backtickPattern.exec(output)) !== null) {
    files.add(match[1]);
  }

  return Array.from(files);
}

module.exports = {
  executeParallel,
  executeStory,
  executeStoryWithRetry,
  generatePrompt,
  parseAgentOutput,
  extractFilesFromOutput,
  logError,
};
