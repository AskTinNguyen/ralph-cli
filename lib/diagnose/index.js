/**
 * Failure Pattern Detection module
 *
 * Provides error signature extraction, clustering, and root cause classification
 * for analyzing Ralph loop run logs.
 */
const fs = require("fs");
const path = require("path");

const {
  extractErrors,
  extractErrorsFromSummary,
  extractErrorsFromErrorsLog,
  extractAllErrors,
  getErrorTypes,
} = require("./extractor");

const {
  clusterErrors,
  mergeSimilarClusters,
  getClusterSummary,
  normalizeMessage,
  similarity,
} = require("./cluster");

const {
  classifyCluster,
  classifyClusters,
  getRemediationSuggestions,
  getRootCause,
  getSeverityColor,
} = require("./classifier");

/**
 * Run full diagnosis on a project
 * @param {string} projectPath - Path to project root
 * @param {object} options - Diagnosis options
 * @returns {object} Diagnosis results
 */
function diagnose(projectPath, options = {}) {
  const {
    runId = null,
    limit = 500,
    similarityThreshold = 0.6,
  } = options;

  const ralphDir = path.join(projectPath, ".ralph");
  const runsDir = path.join(ralphDir, "runs");
  const errorsLogPath = path.join(ralphDir, "errors.log");

  // Check if ralph directory exists
  if (!fs.existsSync(ralphDir)) {
    return {
      success: false,
      error: "No .ralph directory found",
      patterns: [],
      summary: null,
    };
  }

  let errors = [];

  // If specific run ID provided, only analyze that run
  if (runId) {
    const summaryPath = path.join(runsDir, `run-${runId}-iter-1.md`);
    const logPath = path.join(runsDir, `run-${runId}-iter-1.log`);

    // Try to find matching files
    if (fs.existsSync(runsDir)) {
      const files = fs.readdirSync(runsDir);
      const matchingSummary = files.find((f) => f.includes(runId) && f.endsWith(".md"));
      const matchingLog = files.find((f) => f.includes(runId) && f.endsWith(".log"));

      if (matchingSummary) {
        const summaryErrors = extractErrorsFromSummary(path.join(runsDir, matchingSummary));
        errors.push(...summaryErrors);
      }

      if (matchingLog) {
        const logErrors = extractErrors(path.join(runsDir, matchingLog));
        errors.push(...logErrors);
      }
    }

    if (errors.length === 0) {
      return {
        success: false,
        error: `No run found matching ID: ${runId}`,
        patterns: [],
        summary: null,
      };
    }
  } else {
    // Full diagnosis across all runs
    errors = extractAllErrors(runsDir, {
      errorsLogPath,
      limit,
    });
  }

  if (errors.length === 0) {
    return {
      success: true,
      patterns: [],
      summary: {
        totalErrors: 0,
        totalClusters: 0,
        uniqueRuns: 0,
        typeBreakdown: {},
      },
      suggestions: [],
    };
  }

  // Cluster similar errors
  const clusters = clusterErrors(errors, {
    similarityThreshold,
    groupByType: true,
  });

  // Merge very similar clusters
  const mergedClusters = mergeSimilarClusters(clusters, 0.85);

  // Classify each cluster to root cause
  const classifiedClusters = classifyClusters(mergedClusters);

  // Get summary statistics
  const summary = getClusterSummary(classifiedClusters);

  // Generate remediation suggestions
  const suggestions = getRemediationSuggestions(classifiedClusters);

  return {
    success: true,
    patterns: classifiedClusters,
    summary: {
      ...summary,
      errorTypes: getErrorTypes(errors),
    },
    suggestions,
    runId: runId || null,
  };
}

/**
 * Format diagnosis results as markdown
 * @param {object} results - Diagnosis results
 * @returns {string} Markdown formatted report
 */
function formatDiagnosisMarkdown(results) {
  if (!results.success) {
    return `# Diagnosis Error\n\n${results.error}`;
  }

  const lines = [
    "# Failure Pattern Diagnosis",
    "",
    results.runId ? `> Analysis of run: ${results.runId}` : "> Analysis of all runs",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
    "## Summary",
    "",
    `- **Total Errors:** ${results.summary.totalErrors}`,
    `- **Unique Patterns:** ${results.summary.totalClusters}`,
    `- **Affected Runs:** ${results.summary.uniqueRuns}`,
    "",
  ];

  // Type breakdown
  if (Object.keys(results.summary.typeBreakdown).length > 0) {
    lines.push("### Error Type Breakdown", "");
    for (const [type, stats] of Object.entries(results.summary.typeBreakdown)) {
      lines.push(`- **${type}:** ${stats.count} errors in ${stats.clusters} patterns`);
    }
    lines.push("");
  }

  // Top patterns
  if (results.patterns.length > 0) {
    lines.push("---", "", "## Top Failure Patterns", "");

    for (const pattern of results.patterns.slice(0, 10)) {
      const severityBadge = pattern.severity === "critical" ? "CRITICAL"
        : pattern.severity === "high" ? "HIGH"
        : pattern.severity === "medium" ? "MEDIUM" : "LOW";

      lines.push(`### ${pattern.rootCauseLabel} [${severityBadge}]`, "");
      lines.push(`**Occurrences:** ${pattern.count}`);
      lines.push(`**Affected Runs:** ${pattern.runs.length}`);
      lines.push(`**Type:** ${pattern.type}`);
      lines.push("");
      lines.push("**Representative Error:**");
      lines.push("```");
      lines.push(pattern.representative.slice(0, 200));
      lines.push("```");
      lines.push("");

      if (pattern.remediation && pattern.remediation.length > 0) {
        lines.push("**Remediation:**");
        for (const step of pattern.remediation.slice(0, 3)) {
          lines.push(`- ${step}`);
        }
        lines.push("");
      }
    }
  }

  // Remediation summary
  if (results.suggestions.length > 0) {
    lines.push("---", "", "## Recommended Actions", "");

    for (const suggestion of results.suggestions) {
      lines.push(`### ${suggestion.label}`);
      lines.push("");
      lines.push(`- Occurrences: ${suggestion.totalOccurrences}`);
      lines.push(`- Severity: ${suggestion.severity}`);
      lines.push("");
      lines.push("**Steps:**");
      for (const step of suggestion.remediation) {
        lines.push(`1. ${step}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Save diagnosis report
 * @param {object} results - Diagnosis results
 * @param {string} outputPath - Path to save report
 */
function saveDiagnosisReport(results, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = formatDiagnosisMarkdown(results);
  fs.writeFileSync(outputPath, content);
}

module.exports = {
  // Main function
  diagnose,

  // Extraction
  extractErrors,
  extractErrorsFromSummary,
  extractErrorsFromErrorsLog,
  extractAllErrors,
  getErrorTypes,

  // Clustering
  clusterErrors,
  mergeSimilarClusters,
  getClusterSummary,
  normalizeMessage,
  similarity,

  // Classification
  classifyCluster,
  classifyClusters,
  getRemediationSuggestions,
  getRootCause,
  getSeverityColor,

  // Reporting
  formatDiagnosisMarkdown,
  saveDiagnosisReport,
};
