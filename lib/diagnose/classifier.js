/**
 * Root cause classification module
 *
 * Maps error clusters to root cause categories and provides
 * remediation suggestions for each pattern.
 */

/**
 * Root cause categories with their definitions and remediations
 */
const ROOT_CAUSES = {
  missing_dependency: {
    label: "Missing Dependency",
    description: "Required packages or modules are not installed",
    severity: "high",
    remediation: [
      "Run `npm install` or equivalent package manager install command",
      "Check package.json for missing dependencies",
      "Verify the correct version of the dependency is specified",
      "For peer dependencies, install them explicitly",
    ],
    relatedTypes: ["missing_dependency", "file_not_found"],
  },

  type_error: {
    label: "Type Error",
    description: "TypeScript or JavaScript type mismatches",
    severity: "high",
    remediation: [
      "Run `tsc --noEmit` to check types before committing",
      "Review type definitions and interfaces",
      "Add proper type annotations to functions and variables",
      "Check for null/undefined handling",
    ],
    relatedTypes: ["type_error", "reference_error"],
  },

  test_failure: {
    label: "Test Failure",
    description: "Unit tests or integration tests are failing",
    severity: "high",
    remediation: [
      "Run the test suite locally before committing",
      "Review failing test assertions and expected values",
      "Check if test fixtures or mocks need updating",
      "Verify test environment setup is correct",
    ],
    relatedTypes: ["test_failure"],
  },

  syntax_error: {
    label: "Syntax Error",
    description: "Code has syntax issues preventing execution",
    severity: "critical",
    remediation: [
      "Run linter before saving files",
      "Check for missing brackets, quotes, or semicolons",
      "Verify JSON files are valid",
      "Use IDE syntax highlighting to catch issues early",
    ],
    relatedTypes: ["syntax_error"],
  },

  shell_error: {
    label: "Shell/Command Error",
    description: "Shell commands failing or not found",
    severity: "medium",
    remediation: [
      "Verify command exists in PATH",
      "Check command arguments and flags",
      "Handle non-zero exit codes appropriately",
      "Use absolute paths when possible",
    ],
    relatedTypes: ["shell_error", "loop_error"],
  },

  permission_error: {
    label: "Permission Error",
    description: "File or directory access denied",
    severity: "medium",
    remediation: [
      "Check file and directory permissions",
      "Avoid writing to system directories",
      "Use appropriate file modes when creating files",
      "Run with correct user permissions",
    ],
    relatedTypes: ["permission_error"],
  },

  file_not_found: {
    label: "File Not Found",
    description: "Referenced files or paths do not exist",
    severity: "medium",
    remediation: [
      "Verify file paths before reading/writing",
      "Use path.join() for cross-platform compatibility",
      "Check for typos in file names",
      "Ensure files are created before being referenced",
    ],
    relatedTypes: ["file_not_found"],
  },

  git_error: {
    label: "Git Error",
    description: "Version control operations failed",
    severity: "medium",
    remediation: [
      "Pull latest changes before starting work",
      "Resolve merge conflicts manually",
      "Commit changes before switching branches",
      "Check git status before committing",
    ],
    relatedTypes: ["git_error", "uncommitted_changes"],
  },

  timeout_error: {
    label: "Timeout",
    description: "Operation took too long and was terminated",
    severity: "medium",
    remediation: [
      "Break large tasks into smaller steps",
      "Increase timeout values if appropriate",
      "Check for infinite loops or blocking operations",
      "Optimize slow operations",
    ],
    relatedTypes: ["timeout_error"],
  },

  network_error: {
    label: "Network Error",
    description: "Network connectivity or remote service issues",
    severity: "low",
    remediation: [
      "Check internet connectivity",
      "Verify remote service is available",
      "Implement retry logic for transient failures",
      "Use offline fallbacks when possible",
    ],
    relatedTypes: ["network_error"],
  },

  memory_error: {
    label: "Memory Error",
    description: "Out of memory or stack overflow",
    severity: "high",
    remediation: [
      "Increase Node.js heap size if needed",
      "Check for memory leaks",
      "Avoid processing large files in memory",
      "Use streaming for large data sets",
    ],
    relatedTypes: ["memory_error"],
  },

  build_error: {
    label: "Build Error",
    description: "Build process failed",
    severity: "high",
    remediation: [
      "Review build configuration",
      "Check for missing build dependencies",
      "Verify source files are valid",
      "Run build locally to reproduce",
    ],
    relatedTypes: ["build_error"],
  },

  uncommitted_changes: {
    label: "Uncommitted Changes",
    description: "Work was not properly committed",
    severity: "medium",
    remediation: [
      "Run `git status` before finishing a task",
      "Stage and commit all changes",
      "Verify working tree is clean after commit",
      "Use `git add -A` to include all changes",
    ],
    relatedTypes: ["uncommitted_changes"],
  },

  unknown: {
    label: "Unknown Error",
    description: "Unclassified error pattern",
    severity: "low",
    remediation: [
      "Review the full error message for context",
      "Check logs for additional details",
      "Search for similar issues online",
      "Consider adding a new error pattern",
    ],
    relatedTypes: [],
  },
};

/**
 * Classify an error type to a root cause
 * @param {string} errorType - The error type from extraction
 * @returns {string} Root cause key
 */
function classifyErrorType(errorType) {
  for (const [causeKey, cause] of Object.entries(ROOT_CAUSES)) {
    if (cause.relatedTypes.includes(errorType)) {
      return causeKey;
    }
  }
  return "unknown";
}

/**
 * Classify a cluster to a root cause
 * @param {object} cluster - Error cluster with { type, representative, ... }
 * @returns {object} Classification result
 */
function classifyCluster(cluster) {
  const rootCauseKey = classifyErrorType(cluster.type);
  const rootCause = ROOT_CAUSES[rootCauseKey];

  return {
    ...cluster,
    rootCause: rootCauseKey,
    rootCauseLabel: rootCause.label,
    severity: rootCause.severity,
    description: rootCause.description,
    remediation: rootCause.remediation,
  };
}

/**
 * Classify all clusters
 * @param {object[]} clusters - Array of error clusters
 * @returns {object[]} Classified clusters
 */
function classifyClusters(clusters) {
  return clusters.map(classifyCluster);
}

/**
 * Get remediation suggestions for a list of classified clusters
 * @param {object[]} classifiedClusters - Clusters with root cause info
 * @returns {object[]} Prioritized remediation suggestions
 */
function getRemediationSuggestions(classifiedClusters) {
  const suggestions = new Map();

  // Group by root cause and aggregate
  for (const cluster of classifiedClusters) {
    if (!suggestions.has(cluster.rootCause)) {
      suggestions.set(cluster.rootCause, {
        rootCause: cluster.rootCause,
        label: cluster.rootCauseLabel,
        severity: cluster.severity,
        totalOccurrences: 0,
        affectedRuns: new Set(),
        remediation: cluster.remediation,
        examples: [],
      });
    }

    const suggestion = suggestions.get(cluster.rootCause);
    suggestion.totalOccurrences += cluster.count;

    for (const run of cluster.runs || []) {
      suggestion.affectedRuns.add(run);
    }

    // Keep up to 3 examples
    if (suggestion.examples.length < 3) {
      suggestion.examples.push(cluster.representative);
    }
  }

  // Convert to array and sort by severity and count
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };

  return Array.from(suggestions.values())
    .map((s) => ({
      ...s,
      affectedRuns: Array.from(s.affectedRuns),
    }))
    .sort((a, b) => {
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      if (severityDiff !== 0) return severityDiff;
      return b.totalOccurrences - a.totalOccurrences;
    });
}

/**
 * Get root cause definition
 * @param {string} causeKey - Root cause key
 * @returns {object} Root cause definition
 */
function getRootCause(causeKey) {
  return ROOT_CAUSES[causeKey] || ROOT_CAUSES.unknown;
}

/**
 * Get all root cause keys
 * @returns {string[]} Array of root cause keys
 */
function getAllRootCauses() {
  return Object.keys(ROOT_CAUSES);
}

/**
 * Get severity color for display
 * @param {string} severity - Severity level
 * @returns {string} Color name
 */
function getSeverityColor(severity) {
  switch (severity) {
    case "critical":
      return "red";
    case "high":
      return "yellow";
    case "medium":
      return "cyan";
    case "low":
      return "dim";
    default:
      return "white";
  }
}

module.exports = {
  ROOT_CAUSES,
  classifyErrorType,
  classifyCluster,
  classifyClusters,
  getRemediationSuggestions,
  getRootCause,
  getAllRootCauses,
  getSeverityColor,
};
