/**
 * Error signature extraction module
 *
 * Scans run logs for common error patterns: stack traces, exit codes,
 * test failures, TypeScript errors, shell errors.
 */
const fs = require("fs");
const path = require("path");

/**
 * Error signature patterns with their categories
 */
const ERROR_PATTERNS = [
  // TypeScript/JavaScript type errors
  {
    type: "type_error",
    patterns: [
      /TypeError:\s*(.+)/gi,
      /TS(\d+):\s*(.+)/gi,
      /type\s*['"]([^'"]+)['"]\s*is not assignable/gi,
      /Property\s*['"]([^'"]+)['"]\s*does not exist/gi,
      /Cannot find name\s*['"]([^'"]+)['"]/gi,
    ],
  },
  // Syntax errors
  {
    type: "syntax_error",
    patterns: [
      /SyntaxError:\s*(.+)/gi,
      /Unexpected token\s*(.+)/gi,
      /Parsing error:\s*(.+)/gi,
      /unexpected\s+(\w+)/gi,
    ],
  },
  // Reference errors
  {
    type: "reference_error",
    patterns: [/ReferenceError:\s*(.+)/gi, /(\w+)\s*is not defined/gi],
  },
  // File/module not found
  {
    type: "file_not_found",
    patterns: [
      /ENOENT:\s*no such file or directory[,:]?\s*(.+)/gi,
      /Cannot find module\s*['"]([^'"]+)['"]/gi,
      /Module not found:\s*(.+)/gi,
      /Error: Cannot find module/gi,
      /no such file or directory:\s*(.+)/gi,
    ],
  },
  // Permission errors
  {
    type: "permission_error",
    patterns: [/EACCES:\s*(.+)/gi, /permission denied[,:]?\s*(.+)?/gi, /Error: EACCES/gi],
  },
  // Test failures
  {
    type: "test_failure",
    patterns: [
      /FAIL\s+(.+\.(?:test|spec)\.[jt]sx?)/gi,
      /(\d+)\s+(?:tests?\s+)?failed/gi,
      /Test failed:\s*(.+)/gi,
      /AssertionError:\s*(.+)/gi,
      /Expected\s*(.+)\s*to\s*(?:equal|be|match)/gi,
      /expect\(.+\)\.to(?:Be|Equal|Match)/gi,
    ],
  },
  // Shell/command errors
  {
    type: "shell_error",
    patterns: [
      /command not found:\s*(.+)/gi,
      /bash:\s*(.+):\s*command not found/gi,
      /zsh:\s*(.+):\s*command not found/gi,
      /sh:\s*(.+):\s*not found/gi,
      /exit code\s*(\d+)/gi,
      /exited with code\s*(\d+)/gi,
      /exited.*non-zero.*code[=:]?\s*(\d+)/gi,
    ],
  },
  // Missing dependency
  {
    type: "missing_dependency",
    patterns: [
      /npm ERR!\s*(.+)/gi,
      /Cannot resolve dependency\s*(.+)/gi,
      /peer dep missing:\s*(.+)/gi,
      /ERESOLVE\s*(.+)/gi,
      /missing peer dependency/gi,
    ],
  },
  // Git errors
  {
    type: "git_error",
    patterns: [
      /fatal:\s*(.+)/gi,
      /CONFLICT\s*\((.+)\)/gi,
      /merge conflict in\s*(.+)/gi,
      /Your local changes.*would be overwritten/gi,
      /error: failed to push/gi,
    ],
  },
  // Timeout errors
  {
    type: "timeout_error",
    patterns: [
      /timeout.*exceeded/gi,
      /ETIMEDOUT/gi,
      /timed out after\s*(\d+)/gi,
      /operation timed out/gi,
    ],
  },
  // Network errors
  {
    type: "network_error",
    patterns: [
      /ECONNREFUSED/gi,
      /ENOTFOUND/gi,
      /getaddrinfo.*failed/gi,
      /network error/gi,
      /fetch failed/gi,
    ],
  },
  // Memory errors
  {
    type: "memory_error",
    patterns: [
      /JavaScript heap out of memory/gi,
      /ENOMEM/gi,
      /allocation failed/gi,
      /RangeError: Maximum call stack/gi,
    ],
  },
  // Build errors
  {
    type: "build_error",
    patterns: [
      /Build failed/gi,
      /Compilation failed/gi,
      /error during build/gi,
      /webpack.*error/gi,
      /esbuild.*error/gi,
      /rollup.*error/gi,
    ],
  },
  // Uncommitted changes
  {
    type: "uncommitted_changes",
    patterns: [
      /left uncommitted changes/gi,
      /uncommitted changes/gi,
      /working tree.*not clean/gi,
      /changes not staged/gi,
    ],
  },
  // Loop-specific patterns
  {
    type: "loop_error",
    patterns: [
      /ITERATION\s+\d+.*(?:failed|error)/gi,
      /command failed.*status[=:]?\s*(\d+)/gi,
      /<promise>COMPLETE<\/promise>.*not found/gi,
    ],
  },
];

/**
 * Extract error signatures from a log file content
 * @param {string} content - Log file content
 * @param {object} options - Extraction options
 * @returns {object[]} Array of extracted errors with { type, message, location, line }
 */
function extractErrorsFromContent(content, options = {}) {
  const { maxErrors = 100 } = options;
  const errors = [];
  const lines = content.split("\n");
  const seen = new Set(); // Dedup similar errors

  for (const { type, patterns } of ERROR_PATTERNS) {
    for (const pattern of patterns) {
      // Reset regex state
      pattern.lastIndex = 0;

      let match;
      while ((match = pattern.exec(content)) !== null && errors.length < maxErrors) {
        const fullMatch = match[0];
        const message = match[1] || fullMatch;

        // Create a dedup key
        const dedupKey = `${type}:${message.slice(0, 50)}`;
        if (seen.has(dedupKey)) {
          continue;
        }
        seen.add(dedupKey);

        // Find line number
        const matchIndex = match.index;
        let lineNumber = 1;
        let charCount = 0;
        for (let i = 0; i < lines.length && charCount < matchIndex; i++) {
          charCount += lines[i].length + 1; // +1 for newline
          lineNumber = i + 1;
        }

        // Extract location hint from context
        let location = null;
        const locationMatch = fullMatch.match(/(?:at|in|from)\s+([^\s:]+(?::\d+)?)/i);
        if (locationMatch) {
          location = locationMatch[1];
        }

        errors.push({
          type,
          message: message.trim(),
          fullMatch: fullMatch.trim(),
          location,
          line: lineNumber,
        });
      }
    }
  }

  return errors;
}

/**
 * Extract errors from a run log file
 * @param {string} logPath - Path to log file
 * @param {object} options - Extraction options
 * @returns {object[]} Array of extracted errors
 */
function extractErrors(logPath, options = {}) {
  if (!fs.existsSync(logPath)) {
    return [];
  }

  const content = fs.readFileSync(logPath, "utf-8");
  const errors = extractErrorsFromContent(content, options);

  // Add source info to each error
  return errors.map((e) => ({
    ...e,
    source: logPath,
  }));
}

/**
 * Extract agent name from run summary content
 * @param {string} content - Summary file content
 * @returns {string|null} Agent name or null if not found
 */
function extractAgentFromSummary(content) {
  // Try to find agent from various patterns in the summary
  // Pattern 1: "- Agent: codex" or similar
  const agentMatch = content.match(/[-•]\s*Agent:\s*(\w+)/i);
  if (agentMatch) {
    return agentMatch[1].toLowerCase();
  }

  // Pattern 2: Check activity log entries "agent=codex"
  const activityMatch = content.match(/agent[=:](\w+)/i);
  if (activityMatch) {
    return activityMatch[1].toLowerCase();
  }

  // Pattern 3: Check for agent command patterns
  if (content.includes("codex exec") || content.includes("AGENT_CODEX")) {
    return "codex";
  }
  if (content.includes("claude -p") || content.includes("AGENT_CLAUDE")) {
    return "claude";
  }
  if (content.includes("droid exec") || content.includes("AGENT_DROID")) {
    return "droid";
  }

  return null;
}

/**
 * Extract errors from a run summary file
 * @param {string} summaryPath - Path to summary file
 * @param {object} options - Extraction options
 * @param {string} options.agent - Override agent name
 * @returns {object[]} Array of extracted errors
 */
function extractErrorsFromSummary(summaryPath, options = {}) {
  if (!fs.existsSync(summaryPath)) {
    return [];
  }

  const content = fs.readFileSync(summaryPath, "utf-8");
  const errors = [];

  // Extract agent from summary content (US-001)
  const agent = options.agent || extractAgentFromSummary(content);

  // Check status
  const statusMatch = content.match(/- Status:\s*(.+)/);
  if (statusMatch && statusMatch[1].trim() === "error") {
    errors.push({
      type: "loop_error",
      message: "Run ended with error status",
      source: summaryPath,
      agent,
    });
  }

  // Check for uncommitted changes
  const uncommittedSection = content.includes("### Uncommitted Changes");
  if (uncommittedSection) {
    const afterSection = content.split("### Uncommitted Changes")[1];
    if (afterSection) {
      const items = afterSection
        .split("\n")
        .filter((l) => l.trim().startsWith("- ") && l.trim() !== "- (none)")
        .map((l) => l.replace("- ", "").trim());

      if (items.length > 0) {
        errors.push({
          type: "uncommitted_changes",
          message: `${items.length} uncommitted changes: ${items.slice(0, 3).join(", ")}${items.length > 3 ? "..." : ""}`,
          source: summaryPath,
          details: items,
          agent,
        });
      }
    }
  }

  // Extract errors from the summary content itself
  const contentErrors = extractErrorsFromContent(content, { maxErrors: 20 });
  errors.push(...contentErrors.map((e) => ({ ...e, source: summaryPath, agent })));

  return errors;
}

/**
 * Extract errors from errors.log file
 * @param {string} errorsLogPath - Path to errors.log
 * @returns {object[]} Array of extracted errors
 */
function extractErrorsFromErrorsLog(errorsLogPath) {
  if (!fs.existsSync(errorsLogPath)) {
    return [];
  }

  const content = fs.readFileSync(errorsLogPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const errors = [];

  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (!match) continue;

    const timestamp = match[1];
    const message = match[2];

    // Determine error type from message
    let type = "loop_error";
    if (message.includes("uncommitted changes")) {
      type = "uncommitted_changes";
    } else if (message.includes("command failed")) {
      type = "shell_error";
    } else if (message.includes("non-zero")) {
      type = "shell_error";
    }

    // Extract run ID if present
    const runMatch = message.match(/run-(\d{8}-\d{6}-\d+)/);
    const iterMatch = message.match(/ITERATION\s+(\d+)/i);

    // Extract agent if present (US-001)
    const agentMatch = message.match(/agent[=:](\w+)/i);
    const agent = agentMatch ? agentMatch[1].toLowerCase() : null;

    errors.push({
      type,
      message,
      timestamp,
      runId: runMatch ? runMatch[1] : null,
      iteration: iterMatch ? parseInt(iterMatch[1], 10) : null,
      source: errorsLogPath,
      agent,
    });
  }

  return errors;
}

/**
 * Extract all errors from a runs directory
 * @param {string} runsDir - Path to runs directory
 * @param {object} options - Options for extraction
 * @returns {object[]} All extracted errors
 */
function extractAllErrors(runsDir, options = {}) {
  const { errorsLogPath, limit } = options;
  const allErrors = [];

  // Extract from errors.log first
  if (errorsLogPath) {
    const logErrors = extractErrorsFromErrorsLog(errorsLogPath);
    allErrors.push(...logErrors);
  }

  // Extract from run summaries and logs
  if (fs.existsSync(runsDir)) {
    const files = fs.readdirSync(runsDir).sort().reverse(); // Recent first

    for (const file of files) {
      if (limit && allErrors.length >= limit) break;

      const filePath = path.join(runsDir, file);

      if (file.endsWith(".md") && file.startsWith("run-")) {
        // Summary file
        const summaryErrors = extractErrorsFromSummary(filePath);
        allErrors.push(...summaryErrors);

        // Also check corresponding log file
        const logFile = file.replace(".md", ".log");
        const logPath = path.join(runsDir, logFile);
        if (fs.existsSync(logPath)) {
          const logErrors = extractErrors(logPath, { maxErrors: 20 });
          allErrors.push(...logErrors);
        }
      }
    }
  }

  return allErrors;
}

/**
 * Get unique error types found
 * @param {object[]} errors - Array of error objects
 * @returns {string[]} Unique error types
 */
function getErrorTypes(errors) {
  return [...new Set(errors.map((e) => e.type))];
}

module.exports = {
  ERROR_PATTERNS,
  extractErrorsFromContent,
  extractErrors,
  extractErrorsFromSummary,
  extractErrorsFromErrorsLog,
  extractAllErrors,
  getErrorTypes,
  // Agent extraction (US-001)
  extractAgentFromSummary,
};
