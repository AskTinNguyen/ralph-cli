/**
 * Guardrail candidate generator
 *
 * Analyzes run logs and error patterns to generate guardrail candidates
 * with proper provenance tracking.
 */
const fs = require("fs");
const path = require("path");
const { parseRunSummary, parseRunLog, listRunSummaries } = require("../eval/parser");
const { matchErrorToRule, getGuardrailTemplate } = require("./rules");

/**
 * Analyze errors from a single run and extract patterns
 * @param {string} summaryPath - Path to run summary file
 * @returns {object[]} Array of error patterns with metadata
 */
function analyzeRunErrors(summaryPath) {
  const summary = parseRunSummary(summaryPath);
  if (!summary) {
    return [];
  }

  const errors = [];

  // Check run status
  if (summary.status === "error") {
    errors.push({
      type: "run_failure",
      message: `Run ${summary.runId} failed with error status`,
      runId: summary.runId,
      iteration: summary.iteration,
      mode: summary.mode,
      story: summary.story,
    });
  }

  // Check for uncommitted changes
  if (summary.uncommittedChanges && summary.uncommittedChanges.length > 0) {
    errors.push({
      type: "uncommitted_changes",
      message: `Run ${summary.runId} left ${summary.uncommittedChanges.length} uncommitted changes`,
      runId: summary.runId,
      iteration: summary.iteration,
      mode: summary.mode,
      story: summary.story,
      details: summary.uncommittedChanges,
    });
  }

  // Parse log file for more patterns
  if (summary.logPath) {
    const logData = parseRunLog(summary.logPath);
    if (logData) {
      // Check for missing COMPLETE signal in build mode
      if (summary.mode === "build" && !logData.hasComplete && summary.status !== "success") {
        errors.push({
          type: "no_complete_signal",
          message: `Run ${summary.runId} did not produce COMPLETE signal`,
          runId: summary.runId,
          iteration: summary.iteration,
          mode: summary.mode,
          story: summary.story,
        });
      }

      // Check for errors in log
      if (logData.errors && logData.errors.length > 0) {
        for (const errorMsg of logData.errors) {
          errors.push({
            type: "log_error",
            message: errorMsg,
            runId: summary.runId,
            iteration: summary.iteration,
            mode: summary.mode,
            story: summary.story,
          });
        }
      }

      // Check for verification failures
      if (logData.failCount > 0) {
        errors.push({
          type: "verification_failure",
          message: `Run ${summary.runId} had ${logData.failCount} failed verifications`,
          runId: summary.runId,
          iteration: summary.iteration,
          mode: summary.mode,
          story: summary.story,
          failCount: logData.failCount,
        });
      }
    }
  }

  return errors;
}

/**
 * Parse the errors.log file for additional patterns
 * @param {string} errorsLogPath - Path to errors.log file
 * @returns {object[]} Array of error patterns
 */
function parseErrorsLog(errorsLogPath) {
  if (!fs.existsSync(errorsLogPath)) {
    return [];
  }

  const content = fs.readFileSync(errorsLogPath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());
  const errors = [];

  for (const line of lines) {
    // Parse timestamp and message
    const match = line.match(/^\[([^\]]+)\]\s+(.+)$/);
    if (match) {
      const timestamp = match[1];
      const message = match[2];

      // Extract run info if present
      const runMatch = message.match(/run-(\d{8}-\d{6}-\d+)/);
      const iterMatch = message.match(/ITERATION\s+(\d+)/i);

      errors.push({
        type: "errors_log",
        message: message,
        timestamp: timestamp,
        runId: runMatch ? runMatch[1] : null,
        iteration: iterMatch ? parseInt(iterMatch[1], 10) : null,
      });
    }
  }

  return errors;
}

/**
 * Cluster similar errors and count occurrences
 * @param {object[]} errors - Array of error objects
 * @returns {object[]} Clustered errors with counts
 */
function clusterErrors(errors) {
  const clusters = new Map();

  for (const error of errors) {
    // Determine rule key for this error
    const ruleKey = matchErrorToRule(error.message) || error.type;

    if (!clusters.has(ruleKey)) {
      clusters.set(ruleKey, {
        ruleKey,
        count: 0,
        examples: [],
        runs: new Set(),
      });
    }

    const cluster = clusters.get(ruleKey);
    cluster.count++;
    cluster.runs.add(error.runId);

    // Keep up to 3 examples
    if (cluster.examples.length < 3) {
      cluster.examples.push({
        message: error.message,
        runId: error.runId,
        iteration: error.iteration,
        mode: error.mode,
        story: error.story,
      });
    }
  }

  return Array.from(clusters.values())
    .map((c) => ({
      ...c,
      runs: Array.from(c.runs).filter(Boolean),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Generate guardrail candidates from clustered errors
 * @param {object[]} clusters - Clustered errors
 * @param {number} minOccurrences - Minimum occurrences to generate candidate
 * @returns {object[]} Guardrail candidates
 */
function generateCandidates(clusters, minOccurrences = 1) {
  const candidates = [];

  for (const cluster of clusters) {
    // Skip if below threshold
    if (cluster.count < minOccurrences) {
      continue;
    }

    // Get template for this rule
    const template = getGuardrailTemplate(cluster.ruleKey);
    if (!template) {
      // Create generic candidate for unrecognized patterns
      candidates.push({
        id: `candidate-${Date.now()}-${candidates.length}`,
        title: formatTitle(cluster.ruleKey),
        trigger: "When encountering this pattern",
        instruction: `Investigate and handle: ${cluster.examples[0]?.message || cluster.ruleKey}`,
        context: `Occurred ${cluster.count} times across ${cluster.runs.length} runs.`,
        ruleKey: cluster.ruleKey,
        occurrences: cluster.count,
        affectedRuns: cluster.runs,
        examples: cluster.examples,
        generatedAt: new Date().toISOString(),
      });
      continue;
    }

    candidates.push({
      id: `candidate-${Date.now()}-${candidates.length}`,
      title: formatTitle(cluster.ruleKey),
      trigger: template.trigger,
      instruction: template.instruction,
      context: `${template.context} Occurred ${cluster.count} times across ${cluster.runs.length} runs.`,
      ruleKey: cluster.ruleKey,
      occurrences: cluster.count,
      affectedRuns: cluster.runs,
      examples: cluster.examples,
      generatedAt: new Date().toISOString(),
    });
  }

  return candidates;
}

/**
 * Format rule key as human-readable title
 * @param {string} ruleKey - The rule key
 * @returns {string} Formatted title
 */
function formatTitle(ruleKey) {
  return ruleKey
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Generate guardrail candidates markdown content
 * @param {object[]} candidates - Array of candidates
 * @returns {string} Markdown content
 */
function formatCandidatesMarkdown(candidates) {
  const lines = [
    "# Guardrail Candidates",
    "",
    "> Auto-generated candidates based on failure pattern analysis.",
    "> Use `ralph improve` to review and apply these candidates.",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "---",
    "",
  ];

  if (candidates.length === 0) {
    lines.push("*No candidates generated. No significant failure patterns detected.*");
    return lines.join("\n");
  }

  for (const candidate of candidates) {
    lines.push(`## ${candidate.title}`);
    lines.push("");
    lines.push(`**ID:** \`${candidate.id}\``);
    lines.push(`**Rule Key:** \`${candidate.ruleKey}\``);
    lines.push(`**Occurrences:** ${candidate.occurrences}`);
    lines.push(`**Affected Runs:** ${candidate.affectedRuns.join(", ") || "N/A"}`);
    lines.push("");
    lines.push("### Guardrail");
    lines.push("");
    lines.push(`- **Trigger:** ${candidate.trigger}`);
    lines.push(`- **Instruction:** ${candidate.instruction}`);
    lines.push(`- **Context:** ${candidate.context}`);
    lines.push("");
    lines.push("### Provenance");
    lines.push("");
    for (const example of candidate.examples) {
      const storyInfo = example.story ? ` (${example.story})` : "";
      lines.push(`- Run \`${example.runId}\` iter ${example.iteration || "N/A"}${storyInfo}: ${example.message}`);
    }
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Format a guardrail for appending to guardrails.md
 * @param {object} candidate - The candidate to format
 * @param {string} acceptedAt - ISO timestamp when accepted
 * @returns {string} Formatted guardrail markdown
 */
function formatGuardrailEntry(candidate, acceptedAt) {
  const lines = [
    `### Sign: ${candidate.title}`,
    `- **Trigger**: ${candidate.trigger}`,
    `- **Instruction**: ${candidate.instruction}`,
    `- **Added after**: Auto-generated from ${candidate.occurrences} occurrences in runs: ${candidate.affectedRuns.slice(0, 3).join(", ")}${candidate.affectedRuns.length > 3 ? "..." : ""}`,
    `- **Generated at**: ${candidate.generatedAt}`,
    `- **Accepted at**: ${acceptedAt}`,
    "",
  ];
  return lines.join("\n");
}

/**
 * Analyze all runs and generate candidates
 * @param {string} runsDir - Path to runs directory
 * @param {string} errorsLogPath - Path to errors.log file
 * @param {object} options - Generation options
 * @returns {object[]} Generated candidates
 */
function analyzeAndGenerate(runsDir, errorsLogPath, options = {}) {
  const { minOccurrences = 1 } = options;

  // Collect errors from all sources
  const allErrors = [];

  // Parse run summaries
  const summaries = listRunSummaries(runsDir);
  for (const summaryPath of summaries) {
    const runErrors = analyzeRunErrors(summaryPath);
    allErrors.push(...runErrors);
  }

  // Parse errors.log
  const logErrors = parseErrorsLog(errorsLogPath);
  allErrors.push(...logErrors);

  // Cluster and generate
  const clusters = clusterErrors(allErrors);
  const candidates = generateCandidates(clusters, minOccurrences);

  return candidates;
}

/**
 * Save candidates to pending file
 * @param {object[]} candidates - Candidates to save
 * @param {string} outputPath - Path to save file
 */
function saveCandidates(candidates, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = formatCandidatesMarkdown(candidates);
  fs.writeFileSync(outputPath, content);
}

/**
 * Load existing candidates from pending file
 * @param {string} pendingPath - Path to pending file
 * @returns {object[]} Parsed candidates
 */
function loadCandidates(pendingPath) {
  if (!fs.existsSync(pendingPath)) {
    return [];
  }

  const content = fs.readFileSync(pendingPath, "utf-8");
  const candidates = [];
  let current = null;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New candidate section
    if (line.startsWith("## ")) {
      if (current) {
        candidates.push(current);
      }
      current = {
        title: line.replace("## ", "").trim(),
        id: null,
        ruleKey: null,
        occurrences: 0,
        affectedRuns: [],
        trigger: "",
        instruction: "",
        context: "",
        examples: [],
      };
      continue;
    }

    if (!current) continue;

    // Parse metadata
    if (line.startsWith("**ID:**")) {
      current.id = line.match(/`([^`]+)`/)?.[1] || null;
    } else if (line.startsWith("**Rule Key:**")) {
      current.ruleKey = line.match(/`([^`]+)`/)?.[1] || null;
    } else if (line.startsWith("**Occurrences:**")) {
      current.occurrences = parseInt(line.replace("**Occurrences:**", "").trim(), 10) || 0;
    } else if (line.startsWith("**Affected Runs:**")) {
      const runsStr = line.replace("**Affected Runs:**", "").trim();
      current.affectedRuns = runsStr !== "N/A" ? runsStr.split(", ") : [];
    } else if (line.startsWith("- **Trigger:**")) {
      current.trigger = line.replace("- **Trigger:**", "").trim();
    } else if (line.startsWith("- **Instruction:**")) {
      current.instruction = line.replace("- **Instruction:**", "").trim();
    } else if (line.startsWith("- **Context:**")) {
      current.context = line.replace("- **Context:**", "").trim();
    } else if (line.startsWith("- Run `")) {
      // Parse provenance example
      const match = line.match(/Run `([^`]+)` iter ([^:]+): (.+)/);
      if (match) {
        current.examples.push({
          runId: match[1],
          iteration: match[2] !== "N/A" ? parseInt(match[2], 10) : null,
          message: match[3],
        });
      }
    }
  }

  // Don't forget last candidate
  if (current) {
    candidates.push(current);
  }

  return candidates;
}

module.exports = {
  analyzeRunErrors,
  parseErrorsLog,
  clusterErrors,
  generateCandidates,
  formatCandidatesMarkdown,
  formatGuardrailEntry,
  analyzeAndGenerate,
  saveCandidates,
  loadCandidates,
};
