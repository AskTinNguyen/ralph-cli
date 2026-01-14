/**
 * Risk analyzer - analyzes stories for potential risk factors
 *
 * Examines story text, file patterns, and dependencies to calculate
 * a risk score from 1-10 indicating the level of review needed.
 */

const {
  HIGH_RISK_KEYWORDS,
  HIGH_RISK_FILE_PATTERNS,
  HIGH_RISK_DEPENDENCY_PATTERNS,
  RISK_CATEGORIES,
  DEFAULT_RISK_CONFIG,
} = require("./patterns");

/**
 * Analyze story text for risk keywords
 * @param {string} storyText - The full story block text
 * @returns {Object} Analysis result with matches and score
 */
function analyzeKeywords(storyText) {
  if (!storyText || typeof storyText !== "string") {
    return {
      score: 0,
      matches: [],
      categories: {},
    };
  }

  const matches = [];
  const categories = {};

  for (const { pattern, keyword, weight, category } of HIGH_RISK_KEYWORDS) {
    if (pattern.test(storyText)) {
      matches.push({ keyword, weight, category });

      if (!categories[category]) {
        categories[category] = {
          ...RISK_CATEGORIES[category],
          keywords: [],
          totalWeight: 0,
        };
      }
      categories[category].keywords.push(keyword);
      categories[category].totalWeight += weight;
    }
  }

  // Calculate weighted score (sum of weights, capped at 10)
  const rawScore = matches.reduce((sum, m) => sum + m.weight, 0);
  const score = Math.min(rawScore, 10);

  return {
    score,
    rawScore,
    matches,
    categories,
    matchCount: matches.length,
  };
}

/**
 * Extract file paths mentioned in story text
 * @param {string} storyText - The full story block text
 * @returns {string[]} Array of file paths found
 */
function extractFilePaths(storyText) {
  if (!storyText || typeof storyText !== "string") {
    return [];
  }

  const paths = new Set();

  // Match backtick-enclosed paths: `path/to/file.js`
  const backtickMatches = storyText.match(/`([^`]+\.[a-zA-Z]+)`/g);
  if (backtickMatches) {
    for (const match of backtickMatches) {
      const path = match.slice(1, -1); // Remove backticks
      paths.add(path);
    }
  }

  // Match common file patterns: path/to/file.ext
  const pathMatches = storyText.match(
    /(?:^|\s)((?:[\w-]+\/)+[\w-]+\.(?:js|ts|py|sql|md|json|yaml|yml|sh|env)[a-z]*)/gi
  );
  if (pathMatches) {
    for (const match of pathMatches) {
      paths.add(match.trim());
    }
  }

  return Array.from(paths);
}

/**
 * Match a file path against glob-style pattern
 * @param {string} filePath - File path to test
 * @param {string} pattern - Glob pattern (supports ** and *)
 * @returns {boolean} Whether the path matches
 */
function matchGlobPattern(filePath, pattern) {
  // Convert glob pattern to regex
  let regexStr = pattern
    .replace(/\./g, "\\.") // Escape dots
    .replace(/\*\*/g, "@@GLOBSTAR@@") // Temp placeholder for **
    .replace(/\*/g, "[^/]*") // * matches anything except /
    .replace(/@@GLOBSTAR@@/g, ".*"); // ** matches anything including /

  const regex = new RegExp(`(^|/)${regexStr}($|/)`);
  return regex.test(filePath);
}

/**
 * Analyze file patterns mentioned in story for risk
 * @param {string} storyText - The full story block text
 * @returns {Object} Analysis result with file risk scores
 */
function analyzeFilePatterns(storyText) {
  const detectedFiles = extractFilePaths(storyText);
  const matches = [];

  for (const filePath of detectedFiles) {
    for (const { pattern, weight, description } of HIGH_RISK_FILE_PATTERNS) {
      if (matchGlobPattern(filePath, pattern)) {
        matches.push({
          file: filePath,
          pattern,
          weight,
          description,
        });
        break; // Only count each file once
      }
    }
  }

  // Calculate score from matches
  const rawScore = matches.reduce((sum, m) => sum + m.weight, 0);
  const score = Math.min(rawScore, 10);

  return {
    score,
    rawScore,
    detectedFiles,
    matches,
    matchCount: matches.length,
  };
}

/**
 * Analyze story for dependency-related risk
 * @param {string} storyText - The full story block text
 * @returns {Object} Analysis result with dependency risk factors
 */
function analyzeDependencyRisk(storyText) {
  if (!storyText || typeof storyText !== "string") {
    return {
      score: 0,
      matches: [],
      hasDependencyChanges: false,
    };
  }

  const matches = [];
  const lowerText = storyText.toLowerCase();

  // Check if story mentions dependency changes
  const dependencyIndicators = [
    /\bpackage\.json\b/i,
    /\bpackage-lock\.json\b/i,
    /\brequirements\.txt\b/i,
    /\bdependenc/i,
    /\bnpm\s+install/i,
    /\byarn\s+add/i,
    /\bpip\s+install/i,
    /\bnew\s+(?:package|library|module)\b/i,
    /\bupgrade\b.*\b(?:version|package)\b/i,
    /\bmajor\s+version/i,
  ];

  const hasDependencyChanges = dependencyIndicators.some((pattern) =>
    pattern.test(storyText)
  );

  // Check for specific high-risk dependencies
  for (const { pattern, weight, description } of HIGH_RISK_DEPENDENCY_PATTERNS) {
    if (pattern.test(storyText)) {
      matches.push({
        dependency: description,
        weight,
      });
    }
  }

  // Additional weight for major version changes
  let majorVersionBonus = 0;
  if (/\bmajor\s+version/i.test(storyText) || /\bbreaking\s+change/i.test(storyText)) {
    majorVersionBonus = 2;
  }

  const rawScore = matches.reduce((sum, m) => sum + m.weight, 0) + majorVersionBonus;
  const score = Math.min(rawScore, 10);

  return {
    score,
    rawScore,
    matches,
    hasDependencyChanges,
    majorVersionBonus,
    matchCount: matches.length,
  };
}

/**
 * Estimate scope risk based on story complexity indicators
 * @param {string} storyText - The full story block text
 * @returns {Object} Scope analysis with risk contribution
 */
function analyzeScopeRisk(storyText) {
  if (!storyText || typeof storyText !== "string") {
    return {
      score: 1,
      scope: "single",
      indicators: [],
    };
  }

  const indicators = [];
  let scopeMultiplier = 1;

  // Wide scope indicators
  const widePatterns = [
    { pattern: /\ball\s+files\b/i, scope: "wide", multiplier: 3 },
    { pattern: /\bentire\s+(?:project|codebase|system)\b/i, scope: "wide", multiplier: 3 },
    { pattern: /\bthroughout\b/i, scope: "wide", multiplier: 2 },
    { pattern: /\bevery(?:where|thing)\b/i, scope: "wide", multiplier: 2 },
    { pattern: /\bglobal(?:ly)?\b/i, scope: "wide", multiplier: 2 },
    { pattern: /\bacross\s+(?:all|the|multiple)\b/i, scope: "multi", multiplier: 2 },
    { pattern: /\bmultiple\s+(?:files|components|modules)\b/i, scope: "multi", multiplier: 1.5 },
  ];

  for (const { pattern, scope, multiplier } of widePatterns) {
    if (pattern.test(storyText)) {
      indicators.push({ pattern: pattern.source, scope });
      scopeMultiplier = Math.max(scopeMultiplier, multiplier);
    }
  }

  // Count acceptance criteria (more criteria = more complex)
  const criteriaMatches = storyText.match(/^-\s*\[[\sx]\]\s*.+$/gim);
  const criteriaCount = criteriaMatches ? criteriaMatches.length : 0;

  // More than 5 criteria adds risk
  let criteriaBonus = 0;
  if (criteriaCount > 5) {
    criteriaBonus = Math.min((criteriaCount - 5) * 0.5, 2);
  }

  const scope =
    scopeMultiplier >= 3 ? "wide" : scopeMultiplier >= 1.5 ? "multi" : "single";
  const score = Math.min(scopeMultiplier + criteriaBonus, 10);

  return {
    score,
    scope,
    scopeMultiplier,
    criteriaCount,
    criteriaBonus,
    indicators,
  };
}

/**
 * Analyze a story block for overall risk
 * @param {string} storyBlock - The complete story text including criteria
 * @param {Object} config - Optional risk configuration
 * @returns {Object} Complete risk analysis with score and breakdown
 */
function analyzeStoryRisk(storyBlock, config = {}) {
  // Handle null/empty input - return minimal risk
  if (!storyBlock || typeof storyBlock !== "string" || storyBlock.trim() === "") {
    return {
      score: 1,
      riskLevel: "low",
      factors: [],
      breakdown: {
        keyword: { score: 0, weight: 0.3, contribution: 0, matchCount: 0 },
        filePattern: { score: 0, weight: 0.3, contribution: 0, matchCount: 0 },
        dependency: { score: 0, weight: 0.2, contribution: 0, matchCount: 0 },
        scope: { score: 1, weight: 0.2, contribution: 0.2, scope: "single" },
      },
      analysis: {
        keywords: { score: 0, matches: [], categories: {}, matchCount: 0 },
        filePatterns: { score: 0, detectedFiles: [], matches: [], matchCount: 0 },
        dependencies: { score: 0, matches: [], hasDependencyChanges: false },
        scope: { score: 1, scope: "single", indicators: [] },
      },
    };
  }

  const mergedConfig = { ...DEFAULT_RISK_CONFIG, ...config };
  const { weights } = mergedConfig;

  // Run all analyzers
  const keywordAnalysis = analyzeKeywords(storyBlock);
  const filePatternAnalysis = analyzeFilePatterns(storyBlock);
  const dependencyAnalysis = analyzeDependencyRisk(storyBlock);
  const scopeAnalysis = analyzeScopeRisk(storyBlock);

  // Calculate weighted final score
  const weightedScore =
    keywordAnalysis.score * weights.keyword +
    filePatternAnalysis.score * weights.filePattern +
    dependencyAnalysis.score * weights.dependency +
    scopeAnalysis.score * weights.scope;

  // Scale to 1-10
  const rawScore =
    keywordAnalysis.rawScore +
    filePatternAnalysis.rawScore +
    dependencyAnalysis.rawScore +
    scopeAnalysis.score;

  // Final score: blend of weighted and raw scores, normalized to 1-10
  const blendedScore = (weightedScore + rawScore / 3) / 2;
  const finalScore = Math.max(1, Math.min(10, Math.round(blendedScore)));

  // Collect all risk factors for display
  const factors = [];

  for (const match of keywordAnalysis.matches) {
    factors.push({
      type: "keyword",
      description: `Contains "${match.keyword}" keyword`,
      weight: match.weight,
      category: match.category,
    });
  }

  for (const match of filePatternAnalysis.matches) {
    factors.push({
      type: "file",
      description: `Modifies ${match.description.toLowerCase()} (${match.file})`,
      weight: match.weight,
    });
  }

  for (const match of dependencyAnalysis.matches) {
    factors.push({
      type: "dependency",
      description: `Involves ${match.dependency}`,
      weight: match.weight,
    });
  }

  if (scopeAnalysis.scope !== "single") {
    factors.push({
      type: "scope",
      description: `${scopeAnalysis.scope === "wide" ? "Wide" : "Multi-file"} scope changes`,
      weight: scopeAnalysis.scopeMultiplier,
    });
  }

  // Determine risk level
  const riskLevel =
    finalScore >= 8
      ? "critical"
      : finalScore >= mergedConfig.threshold
        ? "high"
        : finalScore >= 4
          ? "medium"
          : "low";

  return {
    score: finalScore,
    riskLevel,
    factors,
    breakdown: {
      keyword: {
        score: keywordAnalysis.score,
        weight: weights.keyword,
        contribution: keywordAnalysis.score * weights.keyword,
        matchCount: keywordAnalysis.matchCount,
      },
      filePattern: {
        score: filePatternAnalysis.score,
        weight: weights.filePattern,
        contribution: filePatternAnalysis.score * weights.filePattern,
        matchCount: filePatternAnalysis.matchCount,
      },
      dependency: {
        score: dependencyAnalysis.score,
        weight: weights.dependency,
        contribution: dependencyAnalysis.score * weights.dependency,
        matchCount: dependencyAnalysis.matchCount,
      },
      scope: {
        score: scopeAnalysis.score,
        weight: weights.scope,
        contribution: scopeAnalysis.score * weights.scope,
        scope: scopeAnalysis.scope,
      },
    },
    analysis: {
      keywords: keywordAnalysis,
      filePatterns: filePatternAnalysis,
      dependencies: dependencyAnalysis,
      scope: scopeAnalysis,
    },
  };
}

/**
 * Format risk analysis for CLI display
 * @param {Object} analysis - Result from analyzeStoryRisk
 * @returns {string} Formatted string for terminal output
 */
function formatRiskPrompt(analysis) {
  const lines = [];

  lines.push(`Risk Score: ${analysis.score}/10`);
  lines.push(`Risk Level: ${analysis.riskLevel.toUpperCase()}`);
  lines.push("");
  lines.push("Factors:");

  for (const factor of analysis.factors) {
    lines.push(`  - ${factor.description} (risk +${factor.weight})`);
  }

  if (analysis.factors.length === 0) {
    lines.push("  - No significant risk factors detected");
  }

  return lines.join("\n");
}

module.exports = {
  analyzeStoryRisk,
  analyzeKeywords,
  analyzeFilePatterns,
  analyzeDependencyRisk,
  analyzeScopeRisk,
  extractFilePaths,
  matchGlobPattern,
  formatRiskPrompt,
};
