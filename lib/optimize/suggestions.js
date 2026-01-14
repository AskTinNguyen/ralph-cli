/**
 * Prompt improvement suggestions generator
 *
 * Generates actionable suggestions for improving prompt templates
 * based on correlation analysis and run outcomes.
 */
const fs = require("fs");
const path = require("path");
const { analyzeCorrelation, categorizeInstructions } = require("./correlator");
const { getVersionComparison, parseVersion } = require("./versions");

/**
 * Generate suggestions based on correlation analysis
 * @param {object} analysis - Output from analyzeCorrelation
 * @param {object} categories - Output from categorizeInstructions
 * @returns {object[]} Array of suggestion objects
 */
function generateSuggestions(analysis, categories) {
  const suggestions = [];

  // 1. Strengthen high-impact instructions that are sometimes ignored
  for (const corr of categories.highImpact) {
    if (corr.impact > 0 && corr.followRate < 80) {
      suggestions.push({
        id: `strengthen-${suggestions.length}`,
        type: "strengthen",
        priority: "high",
        section: corr.sectionTitle,
        instruction: corr.text,
        reason: `This instruction has +${corr.impact}% success impact but is only followed ${corr.followRate}% of the time.`,
        suggestion: `Consider emphasizing this instruction more clearly. Add "IMPORTANT:" prefix or bold formatting. Move to a more prominent position.`,
        impact: corr.impact,
        confidence: corr.avgConfidence,
        metrics: {
          followRate: corr.followRate,
          successWhenFollowed: corr.successRateWhenFollowed,
          successWhenIgnored: corr.successRateWhenIgnored,
        },
      });
    }
  }

  // 2. Clarify consistently ignored instructions
  for (const corr of categories.consistentlyIgnored) {
    suggestions.push({
      id: `clarify-${suggestions.length}`,
      type: "clarify",
      priority: "medium",
      section: corr.sectionTitle,
      instruction: corr.text,
      reason: `This instruction is only followed ${corr.followRate}% of the time.`,
      suggestion: `Rewrite for clarity. Consider: Is this instruction actionable? Is it conflicting with other instructions? Break into smaller steps if complex.`,
      impact: corr.impact,
      confidence: corr.avgConfidence,
      metrics: {
        followRate: corr.followRate,
        totalRuns: corr.totalRuns,
      },
    });
  }

  // 3. Consider removing low-impact, ignored instructions
  for (const corr of categories.consistentlyIgnored) {
    if (corr.impact != null && Math.abs(corr.impact) < 10) {
      suggestions.push({
        id: `remove-${suggestions.length}`,
        type: "remove",
        priority: "low",
        section: corr.sectionTitle,
        instruction: corr.text,
        reason: `This instruction is ignored ${100 - corr.followRate}% of the time and has minimal success impact (${corr.impact}%).`,
        suggestion: `Consider removing this instruction to reduce prompt length and cognitive load. The agent doesn't seem to find it actionable.`,
        impact: corr.impact,
        confidence: corr.avgConfidence,
        metrics: {
          followRate: corr.followRate,
          ignoredCount: corr.ignoredCount,
        },
      });
    }
  }

  // 4. Flag negative-impact instructions
  for (const corr of categories.highImpact) {
    if (corr.impact < -15) {
      suggestions.push({
        id: `review-${suggestions.length}`,
        type: "review",
        priority: "high",
        section: corr.sectionTitle,
        instruction: corr.text,
        reason: `Following this instruction correlates with ${Math.abs(corr.impact)}% LOWER success rate.`,
        suggestion: `Review this instruction carefully. It may be causing unintended behavior or conflicting with more important goals.`,
        impact: corr.impact,
        confidence: corr.avgConfidence,
        metrics: {
          successWhenFollowed: corr.successRateWhenFollowed,
          successWhenIgnored: corr.successRateWhenIgnored,
        },
      });
    }
  }

  // 5. General recommendations based on overall patterns
  if (categories.consistentlyIgnored.length > 5) {
    suggestions.push({
      id: `general-${suggestions.length}`,
      type: "general",
      priority: "medium",
      section: "Overall",
      instruction: null,
      reason: `${categories.consistentlyIgnored.length} instructions are consistently ignored across runs.`,
      suggestion: `The prompt may be too long or contain too many detailed instructions. Consider consolidating related instructions or using a hierarchical structure with clear priorities.`,
      impact: null,
      confidence: 70,
      metrics: {
        ignoredCount: categories.consistentlyIgnored.length,
        totalInstructions: analysis.instructionCount,
      },
    });
  }

  // Sort by priority and impact
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => {
    const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return Math.abs(b.impact || 0) - Math.abs(a.impact || 0);
  });

  return suggestions;
}

/**
 * Generate version-based suggestions
 * @param {string} projectPath - Path to project
 * @returns {object[]} Version-related suggestions
 */
function generateVersionSuggestions(projectPath) {
  const suggestions = [];
  const versions = getVersionComparison(projectPath);

  if (versions.length < 2) {
    return suggestions;
  }

  // Find best and current version
  const current = versions.find((v) => v.isCurrent);
  const best = versions[0]; // Already sorted by success rate

  if (current && best && current.version !== best.version) {
    const improvement = (best.successRate || 0) - (current.successRate || 0);
    if (improvement > 10) {
      suggestions.push({
        id: `version-regression`,
        type: "version",
        priority: "high",
        section: "Version",
        instruction: null,
        reason: `Current version ${current.version} has ${current.successRate}% success rate, while version ${best.version} had ${best.successRate}%.`,
        suggestion: `Consider reverting recent prompt changes. Version ${best.version} performed ${improvement}% better than the current version.`,
        impact: -improvement,
        confidence: 80,
        metrics: {
          currentVersion: current.version,
          currentSuccessRate: current.successRate,
          bestVersion: best.version,
          bestSuccessRate: best.successRate,
        },
      });
    }
  }

  return suggestions;
}

/**
 * Format suggestions as markdown for the candidates file
 * @param {object[]} suggestions - Array of suggestion objects
 * @param {object} analysis - Correlation analysis metadata
 * @returns {string} Formatted markdown content
 */
function formatSuggestionsMarkdown(suggestions, analysis) {
  const lines = [
    "# Prompt Improvement Suggestions",
    "",
    "> Auto-generated suggestions based on correlation analysis.",
    "> Use `ralph optimize prompts` to review and apply these suggestions.",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Template: ${analysis?.template || "N/A"}`,
    `Runs analyzed: ${analysis?.runsAnalyzed || 0}`,
    "",
    "---",
    "",
  ];

  if (suggestions.length === 0) {
    lines.push(
      "*No suggestions generated. Insufficient data or no significant patterns detected.*"
    );
    return lines.join("\n");
  }

  // Group by priority
  const byPriority = {
    high: suggestions.filter((s) => s.priority === "high"),
    medium: suggestions.filter((s) => s.priority === "medium"),
    low: suggestions.filter((s) => s.priority === "low"),
  };

  for (const [priority, items] of Object.entries(byPriority)) {
    if (items.length === 0) continue;

    const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
    lines.push(`## ${priorityLabel} Priority`);
    lines.push("");

    for (const suggestion of items) {
      lines.push(
        `### ${suggestion.type.charAt(0).toUpperCase() + suggestion.type.slice(1)}: ${suggestion.section}`
      );
      lines.push("");
      lines.push(`**ID:** \`${suggestion.id}\``);

      if (suggestion.instruction) {
        lines.push(`**Instruction:** "${suggestion.instruction}"`);
      }

      lines.push("");
      lines.push(`**Why:** ${suggestion.reason}`);
      lines.push("");
      lines.push(`**Recommendation:** ${suggestion.suggestion}`);
      lines.push("");

      if (suggestion.metrics) {
        lines.push("**Metrics:**");
        for (const [key, value] of Object.entries(suggestion.metrics)) {
          if (value != null) {
            const label = key.replace(/([A-Z])/g, " $1").trim();
            lines.push(
              `- ${label}: ${typeof value === "number" && key.includes("Rate") ? value + "%" : value}`
            );
          }
        }
        lines.push("");
      }

      lines.push(`**Confidence:** ${suggestion.confidence}%`);
      if (suggestion.impact != null) {
        const impactLabel =
          suggestion.impact > 0 ? `+${suggestion.impact}%` : `${suggestion.impact}%`;
        lines.push(`**Impact:** ${impactLabel}`);
      }
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Save suggestions to file
 * @param {object[]} suggestions - Array of suggestions
 * @param {object} analysis - Analysis metadata
 * @param {string} outputPath - Path to save file
 */
function saveSuggestions(suggestions, analysis, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const content = formatSuggestionsMarkdown(suggestions, analysis);
  fs.writeFileSync(outputPath, content);
}

/**
 * Load existing suggestions from file
 * @param {string} suggestionsPath - Path to suggestions file
 * @returns {object[]} Parsed suggestions
 */
function loadSuggestions(suggestionsPath) {
  if (!fs.existsSync(suggestionsPath)) {
    return [];
  }

  const content = fs.readFileSync(suggestionsPath, "utf-8");
  const suggestions = [];
  let current = null;

  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // New suggestion section
    if (line.startsWith("### ")) {
      if (current) {
        suggestions.push(current);
      }
      const titleMatch = line.match(/^###\s+(\w+):\s+(.+)$/);
      if (titleMatch) {
        current = {
          type: titleMatch[1].toLowerCase(),
          section: titleMatch[2],
          id: null,
          instruction: null,
          reason: "",
          suggestion: "",
          metrics: {},
          confidence: 0,
          impact: null,
        };
      }
      continue;
    }

    if (!current) continue;

    // Parse fields
    if (line.startsWith("**ID:**")) {
      current.id = line.match(/`([^`]+)`/)?.[1] || null;
    } else if (line.startsWith("**Instruction:**")) {
      current.instruction = line.match(/"([^"]+)"/)?.[1] || null;
    } else if (line.startsWith("**Why:**")) {
      current.reason = line.replace("**Why:**", "").trim();
    } else if (line.startsWith("**Recommendation:**")) {
      current.suggestion = line.replace("**Recommendation:**", "").trim();
    } else if (line.startsWith("**Confidence:**")) {
      current.confidence = parseInt(line.replace("**Confidence:**", "").trim(), 10) || 0;
    } else if (line.startsWith("**Impact:**")) {
      const impactStr = line.replace("**Impact:**", "").trim();
      current.impact = parseInt(impactStr.replace("%", ""), 10) || null;
    } else if (line.startsWith("- ") && line.includes(":")) {
      // Parse metrics
      const metricMatch = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (metricMatch) {
        const key = metricMatch[1].replace(/\s+/g, "");
        let value = metricMatch[2].trim();
        if (value.endsWith("%")) {
          value = parseInt(value, 10);
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        }
        current.metrics[key] = value;
      }
    }
  }

  // Don't forget last suggestion
  if (current) {
    suggestions.push(current);
  }

  return suggestions;
}

/**
 * Get suggestions file path
 * @param {string} projectPath - Path to project
 * @returns {string} Path to suggestions file
 */
function getSuggestionsPath(projectPath) {
  return path.join(projectPath, ".ralph", "candidates", "prompt-suggestions.md");
}

/**
 * Generate all suggestions for a project
 * @param {string} projectPath - Path to project
 * @param {string} templatePath - Path to prompt template (optional)
 * @returns {object} Result with suggestions and analysis
 */
function generateAllSuggestions(projectPath, templatePath = null) {
  // Use default build template if not specified
  if (!templatePath) {
    templatePath = path.join(projectPath, ".agents", "ralph", "PROMPT_build.md");
  }

  if (!fs.existsSync(templatePath)) {
    return {
      suggestions: [],
      analysis: null,
      error: `Template not found: ${templatePath}`,
    };
  }

  // Run correlation analysis
  const analysis = analyzeCorrelation(projectPath, templatePath);
  const categories = categorizeInstructions(analysis.correlations);

  // Generate suggestions
  const suggestions = generateSuggestions(analysis, categories);

  // Add version-based suggestions
  const versionSuggestions = generateVersionSuggestions(projectPath);
  suggestions.push(...versionSuggestions);

  return {
    suggestions,
    analysis,
    categories,
  };
}

module.exports = {
  generateSuggestions,
  generateVersionSuggestions,
  formatSuggestionsMarkdown,
  saveSuggestions,
  loadSuggestions,
  getSuggestionsPath,
  generateAllSuggestions,
};
