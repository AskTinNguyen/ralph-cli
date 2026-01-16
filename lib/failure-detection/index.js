/**
 * Failure Detection Module
 *
 * Extracts failure detection patterns from loop.sh into a testable TypeScript module.
 * Provides pattern matching against log files to detect build/test/lint failures.
 *
 * @module lib/failure-detection
 */

const {
  ALL_PATTERNS,
  TEST_PATTERNS,
  LINT_PATTERNS,
  TYPE_PATTERNS,
  BUILD_PATTERNS,
  RUNTIME_PATTERNS,
  GIT_PATTERNS,
  CATEGORIES,
  SEVERITY_LEVELS,
} = require("./patterns");

/**
 * Detect failures in log content
 *
 * @param {string} logContent - The log content to analyze
 * @param {Object} options - Detection options
 * @param {string[]} options.categories - Categories to check (default: all)
 * @param {number} options.minSeverity - Minimum severity level (1-4, default: 1)
 * @param {number} options.contextLines - Lines of context to include (default: 2)
 * @returns {Object} Detection result with matches
 */
function detectFailure(logContent, options = {}) {
  const {
    categories = null, // null means all categories
    minSeverity = 1,
    contextLines = 2,
  } = options;

  if (!logContent || typeof logContent !== "string") {
    return {
      hasFailure: false,
      matches: [],
      summary: {
        total: 0,
        byCategory: {},
        bySeverity: {},
        highestSeverity: 0,
      },
    };
  }

  const lines = logContent.split("\n");
  const matches = [];
  const matchedLines = new Set(); // Avoid duplicate matches on same line

  // Select patterns based on categories filter
  let patternsToCheck = ALL_PATTERNS;
  if (categories && Array.isArray(categories) && categories.length > 0) {
    patternsToCheck = ALL_PATTERNS.filter((p) => categories.includes(p.category));
  }

  // Filter by minimum severity
  patternsToCheck = patternsToCheck.filter((p) => p.severity >= minSeverity);

  // Check each line against patterns
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    for (const patternDef of patternsToCheck) {
      if (patternDef.pattern.test(line)) {
        // Skip if we already matched this line
        const lineKey = `${i}:${patternDef.category}`;
        if (matchedLines.has(lineKey)) continue;
        matchedLines.add(lineKey);

        // Extract context lines
        const contextBefore = lines.slice(Math.max(0, i - contextLines), i);
        const contextAfter = lines.slice(i + 1, i + 1 + contextLines);

        matches.push({
          pattern: patternDef.pattern.source,
          category: patternDef.category,
          severity: patternDef.severity,
          severityLevel: SEVERITY_LEVELS[patternDef.severity],
          description: patternDef.description,
          matchedLine: line,
          lineNumber: i + 1, // 1-indexed
          context: {
            before: contextBefore,
            after: contextAfter,
          },
        });
      }
    }
  }

  // Build summary
  const summary = buildSummary(matches);

  return {
    hasFailure: matches.length > 0,
    matches,
    summary,
  };
}

/**
 * Build summary statistics from matches
 * @param {Array} matches - Array of match objects
 * @returns {Object} Summary statistics
 */
function buildSummary(matches) {
  const byCategory = {};
  const bySeverity = {};
  let highestSeverity = 0;

  for (const match of matches) {
    // Count by category
    byCategory[match.category] = (byCategory[match.category] || 0) + 1;

    // Count by severity
    bySeverity[match.severity] = (bySeverity[match.severity] || 0) + 1;

    // Track highest severity
    if (match.severity > highestSeverity) {
      highestSeverity = match.severity;
    }
  }

  return {
    total: matches.length,
    byCategory,
    bySeverity,
    highestSeverity,
    highestSeverityLevel: SEVERITY_LEVELS[highestSeverity] || "none",
  };
}

/**
 * Detect test failures in log content
 * @param {string} logContent - The log content to analyze
 * @returns {Object} Detection result with test failure matches
 */
function detectTestFailure(logContent) {
  return detectFailure(logContent, { categories: ["test"] });
}

/**
 * Detect lint failures in log content
 * @param {string} logContent - The log content to analyze
 * @returns {Object} Detection result with lint failure matches
 */
function detectLintFailure(logContent) {
  return detectFailure(logContent, { categories: ["lint"] });
}

/**
 * Detect type check failures in log content
 * @param {string} logContent - The log content to analyze
 * @returns {Object} Detection result with type failure matches
 */
function detectTypeFailure(logContent) {
  return detectFailure(logContent, { categories: ["type"] });
}

/**
 * Detect build failures in log content
 * @param {string} logContent - The log content to analyze
 * @returns {Object} Detection result with build failure matches
 */
function detectBuildFailure(logContent) {
  return detectFailure(logContent, { categories: ["build"] });
}

/**
 * Classify failure type from log content
 * Returns the most severe failure category found
 *
 * Priority order for tie-breaking (more specific categories first):
 * git > test > lint > type > build > runtime > unknown
 *
 * @param {string} logContent - The log content to analyze
 * @returns {string} Failure type: "test", "lint", "type", "build", "runtime", "git", or "unknown"
 */
function classifyFailureType(logContent) {
  const result = detectFailure(logContent);

  if (!result.hasFailure) {
    return "unknown";
  }

  // Category priority for tie-breaking (higher = more specific)
  const categoryPriority = {
    git: 6,
    test: 5,
    lint: 4,
    type: 3,
    build: 2,
    runtime: 1,
    unknown: 0,
  };

  // Find the category with highest severity match, using priority for tie-breaking
  let highestSeverity = 0;
  let highestPriority = 0;
  let failureType = "unknown";

  for (const match of result.matches) {
    const priority = categoryPriority[match.category] || 0;

    if (match.severity > highestSeverity ||
        (match.severity === highestSeverity && priority > highestPriority)) {
      highestSeverity = match.severity;
      highestPriority = priority;
      failureType = match.category;
    }
  }

  return failureType;
}

/**
 * Extract error context lines from log content
 * Returns lines containing error keywords
 *
 * @param {string} logContent - The log content to analyze
 * @param {Object} options - Extraction options
 * @param {number} options.maxLines - Maximum lines to return (default: 10)
 * @param {number} options.minLines - Minimum lines to return (default: 3)
 * @returns {string[]} Array of error context lines
 */
function extractErrorContext(logContent, options = {}) {
  const { maxLines = 10, minLines = 3 } = options;

  if (!logContent || typeof logContent !== "string") {
    return [];
  }

  const lines = logContent.split("\n");
  const result = detectFailure(logContent, { minSeverity: 2 });

  if (!result.hasFailure) {
    // Fallback to last N lines if no error keywords found
    return lines.slice(-minLines);
  }

  // Collect unique lines with errors
  const errorLines = new Set();
  for (const match of result.matches) {
    errorLines.add(match.matchedLine);
    // Also add context lines
    for (const contextLine of match.context.before) {
      if (contextLine.trim()) errorLines.add(contextLine);
    }
    for (const contextLine of match.context.after) {
      if (contextLine.trim()) errorLines.add(contextLine);
    }
  }

  // Convert to array and limit
  const contextArray = Array.from(errorLines).slice(0, maxLines);

  // Ensure minimum lines
  if (contextArray.length < minLines) {
    const lastLines = lines.slice(-minLines);
    return lastLines;
  }

  return contextArray;
}

/**
 * Format detection result for CLI output
 *
 * @param {Object} result - Detection result from detectFailure()
 * @param {Object} options - Format options
 * @param {boolean} options.showContext - Include context lines (default: true)
 * @param {boolean} options.color - Use ANSI colors (default: true)
 * @returns {string} Formatted output string
 */
function formatResult(result, options = {}) {
  const { showContext = true, color = true } = options;

  if (!result.hasFailure) {
    return color ? "\x1b[32m✓ No failures detected\x1b[0m" : "✓ No failures detected";
  }

  const lines = [];

  // Header
  const severityColor = {
    1: "\x1b[36m", // cyan (info)
    2: "\x1b[33m", // yellow (warning)
    3: "\x1b[31m", // red (error)
    4: "\x1b[35m", // magenta (critical)
  };

  const reset = color ? "\x1b[0m" : "";
  const headerColor = color ? severityColor[result.summary.highestSeverity] || "\x1b[31m" : "";

  lines.push(
    `${headerColor}✗ Detected ${result.summary.total} failure(s)${reset} (${result.summary.highestSeverityLevel})`
  );
  lines.push("");

  // Summary by category
  lines.push("Categories:");
  for (const [category, count] of Object.entries(result.summary.byCategory)) {
    const categoryInfo = CATEGORIES[category];
    lines.push(`  ${category}: ${count} (${categoryInfo?.name || "Unknown"})`);
  }
  lines.push("");

  // Top matches
  lines.push("Failures:");
  const displayMatches = result.matches.slice(0, 10); // Limit to 10
  for (const match of displayMatches) {
    const sColor = color ? severityColor[match.severity] : "";
    lines.push(`  ${sColor}[${match.severityLevel}]${reset} ${match.description}`);
    lines.push(`    Line ${match.lineNumber}: ${match.matchedLine.substring(0, 100)}`);

    if (showContext && match.context.before.length > 0) {
      lines.push(`    Context:`);
      for (const contextLine of match.context.before) {
        if (contextLine.trim()) {
          lines.push(`      ${contextLine.substring(0, 80)}`);
        }
      }
    }
    lines.push("");
  }

  if (result.matches.length > 10) {
    lines.push(`  ... and ${result.matches.length - 10} more`);
  }

  return lines.join("\n");
}

/**
 * Get all available pattern categories
 * @returns {Object} Category definitions
 */
function getCategories() {
  return CATEGORIES;
}

/**
 * Get pattern count by category
 * @returns {Object} Count of patterns per category
 */
function getPatternCounts() {
  const counts = {};
  for (const [category, info] of Object.entries(CATEGORIES)) {
    counts[category] = info.patterns.length;
  }
  counts.total = ALL_PATTERNS.length;
  return counts;
}

module.exports = {
  // Main detection functions
  detectFailure,
  detectTestFailure,
  detectLintFailure,
  detectTypeFailure,
  detectBuildFailure,

  // Classification
  classifyFailureType,

  // Context extraction
  extractErrorContext,

  // Formatting
  formatResult,

  // Metadata
  getCategories,
  getPatternCounts,

  // Re-export patterns for direct access
  ALL_PATTERNS,
  TEST_PATTERNS,
  LINT_PATTERNS,
  TYPE_PATTERNS,
  BUILD_PATTERNS,
  RUNTIME_PATTERNS,
  GIT_PATTERNS,
  CATEGORIES,
  SEVERITY_LEVELS,
};
