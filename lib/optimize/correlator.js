/**
 * Prompt section correlator
 *
 * Analyzes correlation between prompt sections/instructions
 * and run outcomes to identify which sections are followed/ignored.
 */
const fs = require("fs");
const path = require("path");
const { parseRunSummary, parseRunLog, listRunSummaries } = require("../eval/parser");

/**
 * Parse a prompt template into sections
 * @param {string} templatePath - Path to the prompt template file
 * @returns {object[]} Array of section objects
 */
function parsePromptSections(templatePath) {
  if (!fs.existsSync(templatePath)) {
    return [];
  }

  const content = fs.readFileSync(templatePath, "utf-8");
  const lines = content.split("\n");
  const sections = [];
  let currentSection = null;
  let sectionContent = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for heading (section start)
    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.content = sectionContent.join("\n").trim();
        currentSection.endLine = i - 1;
        sections.push(currentSection);
      }

      // Start new section
      currentSection = {
        level: headingMatch[1].length,
        title: headingMatch[2].trim(),
        startLine: i,
        endLine: null,
        content: "",
        instructions: [],
      };
      sectionContent = [];
      continue;
    }

    if (currentSection) {
      sectionContent.push(line);

      // Extract bullet point instructions
      const bulletMatch = line.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) {
        currentSection.instructions.push(bulletMatch[1].trim());
      }

      // Extract numbered instructions
      const numberedMatch = line.match(/^\d+\.\s+(.+)$/);
      if (numberedMatch) {
        currentSection.instructions.push(numberedMatch[1].trim());
      }
    }
  }

  // Don't forget the last section
  if (currentSection) {
    currentSection.content = sectionContent.join("\n").trim();
    currentSection.endLine = lines.length - 1;
    sections.push(currentSection);
  }

  return sections;
}

/**
 * Extract key instructions from prompt sections
 * @param {object[]} sections - Parsed sections
 * @returns {object[]} Array of key instructions with metadata
 */
function extractKeyInstructions(sections) {
  const instructions = [];

  // Important sections to track
  const importantSections = [
    "Rules",
    "Non-Negotiable",
    "Your Task",
    "Guardrails",
    "Progress Entry Format",
    "Activity Logging",
    "Completion Signal",
  ];

  for (const section of sections) {
    const isImportant = importantSections.some(
      (s) => section.title.toLowerCase().includes(s.toLowerCase())
    );

    // Track section-level importance
    instructions.push({
      type: "section",
      id: `section:${section.title.toLowerCase().replace(/\s+/g, "_")}`,
      title: section.title,
      content: section.content.slice(0, 200),
      isImportant,
      instructionCount: section.instructions.length,
    });

    // Track individual instructions from important sections
    if (isImportant) {
      for (let i = 0; i < section.instructions.length; i++) {
        const instr = section.instructions[i];
        instructions.push({
          type: "instruction",
          id: `instr:${section.title.toLowerCase().replace(/\s+/g, "_")}:${i}`,
          sectionTitle: section.title,
          text: instr,
          isImportant: true,
        });
      }
    }
  }

  return instructions;
}

/**
 * Check if a specific instruction was followed in a run
 * @param {object} instruction - Instruction object
 * @param {object} runSummary - Parsed run summary
 * @param {object} runLog - Parsed run log
 * @returns {object} Follow status { followed: boolean, evidence: string }
 */
function checkInstructionFollowed(instruction, runSummary, runLog) {
  const text = instruction.text || instruction.title || "";
  const textLower = text.toLowerCase();

  // Check for common instruction patterns
  // "Read X before Y"
  if (textLower.includes("read") && textLower.includes("before")) {
    // Can't directly verify, assume followed if run succeeded
    return {
      followed: runSummary.status === "success",
      evidence: runSummary.status === "success" ? "Run succeeded" : "Cannot verify",
      confidence: 0.5,
    };
  }

  // "Do NOT ask user questions"
  if (textLower.includes("do not ask") || textLower.includes("don't ask")) {
    // Check if log contains question patterns
    const hasQuestions = runLog && runLog.content &&
      /\?\s*$/m.test(runLog.content);
    return {
      followed: !hasQuestions,
      evidence: hasQuestions ? "Found question marks in output" : "No questions detected",
      confidence: 0.7,
    };
  }

  // "Commit changes"
  if (textLower.includes("commit")) {
    const hasCommits = runSummary.commits && runSummary.commits.length > 0 &&
      runSummary.commits[0] !== "(none)";
    const hasUncommitted = runSummary.uncommittedChanges &&
      runSummary.uncommittedChanges.length > 0;

    if (textLower.includes("all changes") || textLower.includes("must be committed")) {
      return {
        followed: !hasUncommitted,
        evidence: hasUncommitted
          ? `${runSummary.uncommittedChanges.length} uncommitted changes`
          : "All changes committed",
        confidence: 0.9,
      };
    }

    return {
      followed: hasCommits,
      evidence: hasCommits ? `Made ${runSummary.commits.length} commits` : "No commits made",
      confidence: 0.8,
    };
  }

  // "Mark tasks/stories as complete"
  if (textLower.includes("mark") && (textLower.includes("complete") || textLower.includes("done"))) {
    // Check if story status changed
    return {
      followed: runSummary.status === "success",
      evidence: runSummary.status === "success" ? "Run marked as success" : "Run did not succeed",
      confidence: 0.6,
    };
  }

  // "Run verification/tests"
  if (textLower.includes("verification") || textLower.includes("test")) {
    const hasVerifications = runLog && (runLog.passCount > 0 || runLog.failCount > 0);
    return {
      followed: hasVerifications,
      evidence: hasVerifications
        ? `Found ${runLog.passCount} passed, ${runLog.failCount} failed`
        : "No verification results found",
      confidence: 0.8,
    };
  }

  // "Update plan/PRD/progress"
  if (textLower.includes("update") &&
      (textLower.includes("plan") || textLower.includes("prd") || textLower.includes("progress"))) {
    // Check if relevant files were changed
    const relevantFiles = (runSummary.changedFiles || []).filter((f) =>
      f.includes("plan.md") || f.includes("prd.md") || f.includes("progress.md")
    );
    return {
      followed: relevantFiles.length > 0,
      evidence: relevantFiles.length > 0
        ? `Updated: ${relevantFiles.join(", ")}`
        : "No plan/PRD/progress files changed",
      confidence: 0.7,
    };
  }

  // "Append progress entry"
  if (textLower.includes("append") && textLower.includes("progress")) {
    const progressChanged = (runSummary.changedFiles || []).some((f) =>
      f.includes("progress.md")
    );
    return {
      followed: progressChanged,
      evidence: progressChanged ? "Progress file updated" : "Progress file not updated",
      confidence: 0.8,
    };
  }

  // "Log activity"
  if (textLower.includes("log") && textLower.includes("activity")) {
    // Can't directly verify without reading activity log
    return {
      followed: null,
      evidence: "Cannot verify activity logging",
      confidence: 0.3,
    };
  }

  // Default: cannot determine
  return {
    followed: null,
    evidence: "Cannot determine compliance",
    confidence: 0.1,
  };
}

/**
 * Analyze correlation between prompt sections and run outcomes
 * @param {string} projectPath - Path to project
 * @param {string} templatePath - Path to prompt template
 * @returns {object} Correlation analysis results
 */
function analyzeCorrelation(projectPath, templatePath) {
  const runsDir = path.join(projectPath, ".ralph", "runs");
  const summaryPaths = listRunSummaries(runsDir);

  // Parse template
  const sections = parsePromptSections(templatePath);
  const instructions = extractKeyInstructions(sections);

  // Initialize tracking for each instruction
  const instructionStats = {};
  for (const instr of instructions) {
    instructionStats[instr.id] = {
      ...instr,
      totalRuns: 0,
      followedCount: 0,
      ignoredCount: 0,
      unknownCount: 0,
      successWhenFollowed: 0,
      successWhenIgnored: 0,
      confidenceSum: 0,
    };
  }

  // Analyze each run
  for (const summaryPath of summaryPaths) {
    const summary = parseRunSummary(summaryPath);
    if (!summary) continue;

    // Only analyze build mode runs
    if (summary.mode !== "build") continue;

    // Parse log if available
    let log = null;
    if (summary.logPath) {
      log = parseRunLog(summary.logPath);
    }

    // Check each instruction
    for (const instr of instructions) {
      if (instr.type !== "instruction") continue;

      const stats = instructionStats[instr.id];
      stats.totalRuns++;

      const result = checkInstructionFollowed(instr, summary, log);
      stats.confidenceSum += result.confidence;

      if (result.followed === true) {
        stats.followedCount++;
        if (summary.status === "success") {
          stats.successWhenFollowed++;
        }
      } else if (result.followed === false) {
        stats.ignoredCount++;
        if (summary.status === "success") {
          stats.successWhenIgnored++;
        }
      } else {
        stats.unknownCount++;
      }
    }
  }

  // Calculate correlations
  const correlations = [];
  for (const [id, stats] of Object.entries(instructionStats)) {
    if (stats.type !== "instruction") continue;
    if (stats.totalRuns < 3) continue; // Need minimum data

    const followRate = stats.totalRuns > 0
      ? Math.round(((stats.followedCount) / stats.totalRuns) * 100)
      : null;

    const successRateWhenFollowed = stats.followedCount > 0
      ? Math.round((stats.successWhenFollowed / stats.followedCount) * 100)
      : null;

    const successRateWhenIgnored = stats.ignoredCount > 0
      ? Math.round((stats.successWhenIgnored / stats.ignoredCount) * 100)
      : null;

    // Calculate impact (how much following this instruction affects success)
    let impact = null;
    if (successRateWhenFollowed != null && successRateWhenIgnored != null) {
      impact = successRateWhenFollowed - successRateWhenIgnored;
    }

    const avgConfidence = stats.totalRuns > 0
      ? Math.round((stats.confidenceSum / stats.totalRuns) * 100)
      : 0;

    correlations.push({
      id,
      sectionTitle: stats.sectionTitle,
      text: stats.text,
      totalRuns: stats.totalRuns,
      followRate,
      successRateWhenFollowed,
      successRateWhenIgnored,
      impact,
      avgConfidence,
      followedCount: stats.followedCount,
      ignoredCount: stats.ignoredCount,
      unknownCount: stats.unknownCount,
    });
  }

  // Sort by impact (most impactful first)
  correlations.sort((a, b) => {
    // Prioritize by confidence-adjusted impact
    const aScore = (Math.abs(a.impact || 0)) * (a.avgConfidence / 100);
    const bScore = (Math.abs(b.impact || 0)) * (b.avgConfidence / 100);
    return bScore - aScore;
  });

  return {
    template: templatePath,
    sectionCount: sections.length,
    instructionCount: instructions.filter((i) => i.type === "instruction").length,
    runsAnalyzed: summaryPaths.length,
    correlations,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Identify consistently followed vs ignored instructions
 * @param {object[]} correlations - Correlation data from analyzeCorrelation
 * @returns {object} Categorized instructions
 */
function categorizeInstructions(correlations) {
  const consistentlyFollowed = correlations.filter((c) =>
    c.followRate != null && c.followRate >= 80 && c.avgConfidence >= 50
  );

  const consistentlyIgnored = correlations.filter((c) =>
    c.followRate != null && c.followRate <= 30 && c.avgConfidence >= 50
  );

  const highImpact = correlations.filter((c) =>
    c.impact != null && Math.abs(c.impact) >= 20 && c.avgConfidence >= 50
  );

  const lowConfidence = correlations.filter((c) =>
    c.avgConfidence < 50
  );

  return {
    consistentlyFollowed,
    consistentlyIgnored,
    highImpact,
    lowConfidence,
  };
}

/**
 * Get all runs grouped by prompt version (if available)
 * @param {string} projectPath - Path to project
 * @returns {object} Runs grouped by version
 */
function getRunsByVersion(projectPath) {
  const runsDir = path.join(projectPath, ".ralph", "runs");
  const summaryPaths = listRunSummaries(runsDir);
  const byVersion = {};

  for (const summaryPath of summaryPaths) {
    const summary = parseRunSummary(summaryPath);
    if (!summary) continue;

    // Try to detect version from run (would need to be logged)
    // For now, group by date as proxy for version changes
    const dateMatch = summary.startedAt?.match(/^(\d{4}-\d{2}-\d{2})/);
    const version = dateMatch ? dateMatch[1] : "unknown";

    if (!byVersion[version]) {
      byVersion[version] = [];
    }
    byVersion[version].push(summary);
  }

  return byVersion;
}

module.exports = {
  parsePromptSections,
  extractKeyInstructions,
  checkInstructionFollowed,
  analyzeCorrelation,
  categorizeInstructions,
  getRunsByVersion,
};
