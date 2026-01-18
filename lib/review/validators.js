/**
 * Reusable validation patterns for PRD and Plan review
 * Based on Addy Osmani's "Good Spec" principles
 */

/**
 * Vague language patterns to detect and suggest alternatives
 */
const VAGUE_PATTERNS = [
  {
    pattern: /\b(properly|correctly)\b/gi,
    type: "vague_adverb",
    message: "Use concrete criteria instead of 'properly' or 'correctly'",
    suggestion: "Example: 'Returns 200 status code' instead of 'works correctly'",
  },
  {
    pattern: /\b(works?|working)\b/gi,
    type: "vague_outcome",
    message: "Specify exact expected outcome instead of 'works'",
    suggestion: "Example: 'Function returns array of results' instead of 'function works'",
  },
  {
    pattern: /\b(as expected|should)\b/gi,
    type: "vague_expectation",
    message: "Define explicit expectations instead of 'as expected' or 'should'",
    suggestion: "Example: 'Button displays loading spinner' instead of 'should load'",
  },
  {
    pattern: /\b(good|better|best|nice|great)\b/gi,
    type: "vague_quality",
    message: "Use measurable quality criteria",
    suggestion: "Example: 'Response time < 200ms' instead of 'good performance'",
  },
  {
    pattern: /\b(appropriate|suitable|reasonable)\b/gi,
    type: "vague_qualifier",
    message: "Specify exact criteria instead of vague qualifiers",
    suggestion: "Example: 'Max 5 items per page' instead of 'appropriate limit'",
  },
];

/**
 * Placeholder patterns that indicate incomplete specifications
 */
const PLACEHOLDER_PATTERNS = [
  {
    pattern: /<[^>]+>/g,
    type: "angle_bracket_placeholder",
    message: "Replace placeholder with actual value",
    example: "Change '<filename>' to 'src/auth.js'",
  },
  {
    pattern: /\bTODO\b|\bFIXME\b/gi,
    type: "todo_marker",
    message: "Remove TODO/FIXME markers",
    example: "Complete the specification instead of leaving TODOs",
  },
  {
    pattern: /\.{3}|…/g,
    type: "ellipsis",
    message: "Complete the sentence instead of using ellipsis",
    example: "Finish the specification",
  },
  {
    pattern: /\{\{[^}]+\}\}/g,
    type: "template_variable",
    message: "Replace template variable with actual value",
    example: "Change '{{path}}' to actual path",
  },
];

/**
 * Detect vague language in text
 * @param {string} text - Text to analyze
 * @param {number} lineNum - Line number for error reporting
 * @returns {object[]} Array of vague language issues found
 */
function detectVagueLanguage(text, lineNum = null) {
  const issues = [];

  for (const { pattern, type, message, suggestion } of VAGUE_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      issues.push({
        type,
        line: lineNum,
        message: `${message}: "${match[0]}"`,
        suggestion,
        match: match[0],
        index: match.index,
      });
    }
  }

  return issues;
}

/**
 * Detect placeholders in text
 * @param {string} text - Text to analyze
 * @param {number} lineNum - Line number for error reporting
 * @returns {object[]} Array of placeholder issues found
 */
function detectPlaceholders(text, lineNum = null) {
  const issues = [];

  for (const { pattern, type, message, example } of PLACEHOLDER_PATTERNS) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      issues.push({
        type,
        line: lineNum,
        message: `${message}: "${match[0]}"`,
        example,
        match: match[0],
        index: match.index,
      });
    }
  }

  return issues;
}

/**
 * Validate three-tier boundary structure (✅ Always / ⚠️ Ask First / 🚫 Never)
 * @param {string} content - Full PRD content
 * @returns {object} Validation result with score and issues
 */
function validateBoundaries(content) {
  const result = {
    score: 0,
    maxScore: 20,
    issues: [],
    tiers: {
      always: { found: false, count: 0 },
      askFirst: { found: false, count: 0 },
      never: { found: false, count: 0 },
    },
  };

  const lines = content.split("\n");

  // Look for boundary sections
  const alwaysPattern = /^#+\s*(✅|Always\s+Do|Do\s+Always)/i;
  const askFirstPattern = /^#+\s*(⚠️|Ask\s+First|Confirm\s+Before)/i;
  const neverPattern = /^#+\s*(🚫|Never\s+Do|Don't|Avoid)/i;

  let currentSection = null;
  let itemCount = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const lineNum = i + 1;

    // Detect section headers
    if (alwaysPattern.test(line)) {
      currentSection = "always";
      result.tiers.always.found = true;
      itemCount = 0;
    } else if (askFirstPattern.test(line)) {
      currentSection = "askFirst";
      result.tiers.askFirst.found = true;
      itemCount = 0;
    } else if (neverPattern.test(line)) {
      currentSection = "never";
      result.tiers.never.found = true;
      itemCount = 0;
    }
    // Check for new section (any header) to stop counting
    else if (/^#+\s+/.test(line) && currentSection) {
      currentSection = null;
    }
    // Count items in current section
    else if (currentSection && /^[-*]\s+/.test(line)) {
      itemCount++;
      result.tiers[currentSection].count++;

      // Check for concrete items (not vague)
      const vagueIssues = detectVagueLanguage(line, lineNum);
      if (vagueIssues.length > 0) {
        result.issues.push({
          type: "vague_boundary_item",
          line: lineNum,
          section: currentSection,
          message: `Boundary item too vague: ${vagueIssues[0].match}`,
        });
      }
    }
  }

  // Score calculation
  let score = 0;

  // Check for presence of all three tiers (6 points each)
  if (result.tiers.always.found) score += 6;
  if (result.tiers.askFirst.found) score += 6;
  if (result.tiers.never.found) score += 6;

  // Check for minimum 3 items per tier (remaining 2 points if all have 3+)
  const hasEnoughItems =
    result.tiers.always.count >= 3 &&
    result.tiers.askFirst.count >= 3 &&
    result.tiers.never.count >= 3;

  if (hasEnoughItems) {
    score += 2;
  } else {
    if (result.tiers.always.count < 3) {
      result.issues.push({
        type: "insufficient_boundaries",
        message: `"Always Do" section has only ${result.tiers.always.count} items (need 3+)`,
      });
    }
    if (result.tiers.askFirst.count < 3) {
      result.issues.push({
        type: "insufficient_boundaries",
        message: `"Ask First" section has only ${result.tiers.askFirst.count} items (need 3+)`,
      });
    }
    if (result.tiers.never.count < 3) {
      result.issues.push({
        type: "insufficient_boundaries",
        message: `"Never Do" section has only ${result.tiers.never.count} items (need 3+)`,
      });
    }
  }

  result.score = score;
  return result;
}

/**
 * Check if commands are executable (no placeholders)
 * @param {string} text - Text containing commands
 * @param {number} lineNum - Line number for error reporting
 * @returns {object[]} Array of non-executable command issues
 */
function checkCommandExecutability(text, lineNum = null) {
  const issues = [];

  // Extract code blocks (commands are typically in code blocks)
  const codeBlockPattern = /```[\s\S]*?```|`[^`]+`/g;
  const matches = text.matchAll(codeBlockPattern);

  for (const match of matches) {
    const code = match[0];

    // Check for placeholders in commands
    const placeholders = detectPlaceholders(code, lineNum);
    if (placeholders.length > 0) {
      issues.push({
        type: "non_executable_command",
        line: lineNum,
        message: `Command contains placeholders and is not copy-paste executable`,
        command: code.substring(0, 50) + "...",
        fix: "Replace placeholders with actual values or concrete examples",
      });
    }

    // Check for environment variables that might not be set
    const envVarPattern = /\$\{[^}]+\}|\$[A-Z_]+/g;
    const envVars = code.match(envVarPattern);
    if (envVars && envVars.length > 2) {
      // More than 2 env vars might indicate too generic
      issues.push({
        type: "excessive_env_vars",
        line: lineNum,
        message: `Command relies heavily on environment variables`,
        command: code.substring(0, 50) + "...",
        fix: "Provide concrete examples with actual values",
      });
    }
  }

  return issues;
}

/**
 * Validate that file paths are specific, not vague
 * @param {string} text - Text to analyze
 * @param {number} lineNum - Line number
 * @returns {object[]} Issues with vague file paths
 */
function validateFilePaths(text, lineNum = null) {
  const issues = [];

  // Patterns indicating vague file references
  const vagueFilePatterns = [
    /the\s+(\w+)\s+file/gi,
    /appropriate\s+file/gi,
    /correct\s+location/gi,
    /relevant\s+directory/gi,
  ];

  for (const pattern of vagueFilePatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      issues.push({
        type: "vague_file_path",
        line: lineNum,
        message: `Vague file reference: "${match[0]}"`,
        suggestion: "Use specific paths like 'src/components/Auth.tsx'",
      });
    }
  }

  return issues;
}

module.exports = {
  detectVagueLanguage,
  detectPlaceholders,
  validateBoundaries,
  checkCommandExecutability,
  validateFilePaths,
  VAGUE_PATTERNS,
  PLACEHOLDER_PATTERNS,
};
