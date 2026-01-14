/**
 * Risk assessment module - entry point
 *
 * Provides risk analysis capabilities for user stories,
 * scoring changes based on keywords, file patterns, and dependencies.
 */

const {
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,
  extractFilePaths,
  formatRiskPrompt,
  isHighRisk,
} = require("./analyzer");

const {
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
} = require("./patterns");

/**
 * Get the risk threshold from config
 * Reads from RALPH_RISK_THRESHOLD env var or returns default
 * @returns {number} Risk threshold (default: 7)
 */
function getRiskThreshold() {
  const envThreshold = process.env.RALPH_RISK_THRESHOLD;
  if (envThreshold && !isNaN(parseInt(envThreshold, 10))) {
    return parseInt(envThreshold, 10);
  }
  return DEFAULT_RISK_CONFIG.threshold;
}

/**
 * Check if risk pause is enabled
 * Reads from RALPH_RISK_PAUSE env var or returns default
 * @returns {boolean} Whether to pause on high-risk stories
 */
function shouldPauseOnHighRisk() {
  const envPause = process.env.RALPH_RISK_PAUSE;
  if (envPause !== undefined) {
    return envPause.toLowerCase() === "true" || envPause === "1";
  }
  return DEFAULT_RISK_CONFIG.pauseOnHighRisk;
}

/**
 * Format risk display for an array of stories
 * Provides sorted list with risk scores and highlights high-risk stories
 * @param {Object[]} stories - Array of story objects with risk field
 * @param {Object} options - Display options
 * @param {boolean} options.sortByRisk - Sort stories by risk score (descending)
 * @param {boolean} options.highlightHighRisk - Include highlight markers for high-risk
 * @param {number} options.threshold - Risk threshold (default: from config)
 * @returns {Object} Formatted display data with sortedStories and summary
 */
function formatRiskDisplay(stories, options = {}) {
  const {
    sortByRisk = true,
    highlightHighRisk = true,
    threshold = getRiskThreshold(),
  } = options;

  if (!stories || stories.length === 0) {
    return {
      sortedStories: [],
      summary: {
        total: 0,
        highRisk: 0,
        mediumRisk: 0,
        lowRisk: 0,
        avgScore: 0,
      },
      formattedOutput: "No stories to display.",
    };
  }

  // Ensure all stories have risk information
  const storiesWithRisk = stories.map((story) => {
    if (!story.risk) {
      const riskResult = analyzeStoryRisk(story.storyBlock || story.title || "");
      return {
        ...story,
        risk: {
          score: riskResult.score,
          level: riskResult.riskLevel,
          factors: riskResult.factors,
        },
      };
    }
    return story;
  });

  // Sort by risk score if requested
  const sortedStories = sortByRisk
    ? [...storiesWithRisk].sort((a, b) => (b.risk?.score || 0) - (a.risk?.score || 0))
    : storiesWithRisk;

  // Calculate summary statistics
  const riskScores = sortedStories.map((s) => s.risk?.score || 0);
  const avgScore = riskScores.length > 0
    ? Math.round(riskScores.reduce((a, b) => a + b, 0) / riskScores.length)
    : 0;

  const summary = {
    total: sortedStories.length,
    highRisk: sortedStories.filter((s) => (s.risk?.score || 0) >= threshold).length,
    mediumRisk: sortedStories.filter((s) => {
      const score = s.risk?.score || 0;
      return score >= 4 && score < threshold;
    }).length,
    lowRisk: sortedStories.filter((s) => (s.risk?.score || 0) < 4).length,
    avgScore,
  };

  // Generate formatted CLI output
  const lines = [];
  lines.push("Risk Distribution");
  lines.push("=================");
  lines.push("");
  lines.push(`Total Stories: ${summary.total}`);
  lines.push(`High Risk (${threshold}+): ${summary.highRisk}`);
  lines.push(`Medium Risk (4-${threshold - 1}): ${summary.mediumRisk}`);
  lines.push(`Low Risk (<4): ${summary.lowRisk}`);
  lines.push(`Average Score: ${summary.avgScore}/10`);
  lines.push("");
  lines.push("Stories by Risk:");
  lines.push("----------------");

  for (const story of sortedStories) {
    const score = story.risk?.score || 0;
    const level = story.risk?.level || "low";
    const isHighRisk = score >= threshold;
    const prefix = highlightHighRisk && isHighRisk ? "⚠ " : "  ";
    const storyId = story.id || "???";
    const title = story.title || "Untitled";

    lines.push(`${prefix}[${score}/10] ${storyId}: ${title}`);

    // Show factors for high-risk stories
    if (isHighRisk && story.risk?.factors?.length > 0) {
      for (const factor of story.risk.factors.slice(0, 3)) {
        lines.push(`      - ${factor.description}`);
      }
    }
  }

  return {
    sortedStories,
    summary,
    formattedOutput: lines.join("\n"),
  };
}

/**
 * Get risk level color class for UI styling
 * @param {number} score - Risk score (1-10)
 * @param {number} threshold - High risk threshold
 * @returns {string} CSS class name for styling
 */
function getRiskColorClass(score, threshold = 7) {
  if (score >= 8) return "risk-critical";
  if (score >= threshold) return "risk-high";
  if (score >= 4) return "risk-medium";
  return "risk-low";
}

/**
 * Get risk level label for display
 * @param {number} score - Risk score (1-10)
 * @param {number} threshold - High risk threshold
 * @returns {string} Human-readable risk level
 */
function getRiskLabel(score, threshold = 7) {
  if (score >= 8) return "Critical";
  if (score >= threshold) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

module.exports = {
  // Main analysis functions
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,
  isHighRisk,

  // Configuration functions
  getRiskThreshold,
  shouldPauseOnHighRisk,

  // Utilities
  extractFilePaths,
  formatRiskPrompt,

  // Display functions (US-003: Risk Visualization)
  formatRiskDisplay,
  getRiskColorClass,
  getRiskLabel,

  // Pattern definitions (for customization)
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
};
