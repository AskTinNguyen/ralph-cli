/**
 * PRD Quality Reviewer
 * Validates PRD documents against Addy Osmani's "Good Spec" principles
 */
const fs = require("fs");
const validators = require("./validators");

/**
 * Review a PRD file for quality and completeness
 * @param {string} prdPath - Path to prd.md file
 * @returns {object} Review result with score, grade, issues, and breakdown
 */
function reviewPRD(prdPath) {
  const result = {
    type: "prd",
    path: prdPath,
    valid: true,
    grade: "F",
    score: 0,
    breakdown: {
      structure: { score: 0, max: 20, issues: [] },
      boundaries: { score: 0, max: 20, issues: [] },
      storyQuality: { score: 0, max: 25, issues: [] },
      concreteness: { score: 0, max: 20, issues: [] },
      context: { score: 0, max: 15, issues: [] },
    },
    issues: [],
    recommendations: [],
  };

  // Read file
  let content;
  try {
    content = fs.readFileSync(prdPath, "utf8");
  } catch (err) {
    result.valid = false;
    result.issues.push({
      severity: "critical",
      type: "file_not_found",
      message: `Could not read PRD file: ${err.message}`,
    });
    return result;
  }

  const lines = content.split("\n");

  // ============================================================================
  // Structure Check (20 points)
  // ============================================================================
  const structureResult = checkStructure(content, lines);
  result.breakdown.structure = structureResult;

  // ============================================================================
  // Boundaries Check (20 points)
  // ============================================================================
  const boundariesResult = validators.validateBoundaries(content);
  result.breakdown.boundaries = {
    score: boundariesResult.score,
    max: 20,
    issues: boundariesResult.issues,
    tiers: boundariesResult.tiers,
  };

  // ============================================================================
  // Story Quality Check (25 points)
  // ============================================================================
  const storyQualityResult = checkStoryQuality(content, lines);
  result.breakdown.storyQuality = storyQualityResult;

  // ============================================================================
  // Concreteness Check (20 points)
  // ============================================================================
  const concretenessResult = checkConcreteness(content, lines);
  result.breakdown.concreteness = concretenessResult;

  // ============================================================================
  // Context Check (15 points)
  // ============================================================================
  const contextResult = checkContext(content, lines);
  result.breakdown.context = contextResult;

  // ============================================================================
  // Calculate Overall Score
  // ============================================================================
  result.score =
    structureResult.score +
    boundariesResult.score +
    storyQualityResult.score +
    concretenessResult.score +
    contextResult.score;

  result.grade = gradeScore(result.score);

  // ============================================================================
  // Aggregate All Issues
  // ============================================================================
  result.issues = [
    ...structureResult.issues,
    ...boundariesResult.issues,
    ...storyQualityResult.issues,
    ...concretenessResult.issues,
    ...contextResult.issues,
  ];

  // ============================================================================
  // Generate Recommendations
  // ============================================================================
  result.recommendations = generateRecommendations(result);

  return result;
}

/**
 * Check PRD structure (20 points)
 */
function checkStructure(content, lines) {
  const result = {
    score: 0,
    max: 20,
    issues: [],
    checks: {
      hasTitle: false,
      hasOverview: false,
      hasUserStories: false,
      storyFormatCorrect: true,
      hasCriteria: true,
      sequentialIds: true,
    },
  };

  // Check for title header (3 points)
  const hasTitleHeader = lines.some((line) => /^# .+/.test(line));
  if (hasTitleHeader) {
    result.score += 3;
    result.checks.hasTitle = true;
  } else {
    result.issues.push({
      severity: "high",
      type: "missing_title",
      message: "PRD is missing a title header (# Title)",
    });
  }

  // Check for Overview section (3 points)
  const hasOverview = lines.some((line) => /^## Overview/i.test(line));
  if (hasOverview) {
    result.score += 3;
    result.checks.hasOverview = true;
  } else {
    result.issues.push({
      severity: "high",
      type: "missing_overview",
      message: "PRD is missing an Overview section",
    });
  }

  // Check for User Stories section (4 points)
  const hasUserStories = lines.some((line) => /^## User Stories/i.test(line));
  if (hasUserStories) {
    result.score += 4;
    result.checks.hasUserStories = true;
  } else {
    result.issues.push({
      severity: "critical",
      type: "missing_user_stories",
      message: "PRD is missing a User Stories section",
    });
  }

  // Validate story format (5 points total)
  const storyPattern = /^### \[([ x])\] (US-\d+):\s*(.*)$/;
  const stories = [];
  let storyFormatScore = 5;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const storyMatch = line.match(storyPattern);
    if (storyMatch) {
      stories.push({
        id: storyMatch[2],
        title: storyMatch[3],
        completed: storyMatch[1] === "x",
        line: lineNum,
      });

      // Check story ID format (US-XXX with 3 digits)
      if (!/^US-\d{3}$/.test(storyMatch[2])) {
        result.issues.push({
          severity: "medium",
          type: "story_id_format",
          line: lineNum,
          message: `Story ID should be US-XXX (3 digits): ${storyMatch[2]}`,
        });
        storyFormatScore -= 1;
        result.checks.storyFormatCorrect = false;
      }

      // Check for empty title
      if (!storyMatch[3] || storyMatch[3].trim() === "") {
        result.issues.push({
          severity: "high",
          type: "empty_story_title",
          line: lineNum,
          message: `Story ${storyMatch[2]} has an empty title`,
        });
        storyFormatScore -= 1;
        result.checks.storyFormatCorrect = false;
      }
    }

    // Check for malformed story headers
    if (line.match(/^### \[/) && !storyMatch) {
      result.issues.push({
        severity: "high",
        type: "malformed_story_header",
        line: lineNum,
        message: "Malformed story header (expected: ### [ ] US-XXX: Title)",
      });
      storyFormatScore -= 1;
      result.checks.storyFormatCorrect = false;
    }
  }

  result.score += Math.max(0, storyFormatScore);

  // Check for acceptance criteria (3 points)
  const criteriaPattern = /^- \[([ x])\]\s+(.+)$/;
  const hasCriteria = lines.some((line) => criteriaPattern.test(line));
  if (hasCriteria) {
    result.score += 3;
  } else {
    result.issues.push({
      severity: "high",
      type: "no_acceptance_criteria",
      message: "No acceptance criteria found (- [ ] format)",
    });
    result.checks.hasCriteria = false;
  }

  // Check for sequential story IDs (2 points)
  if (stories.length > 1) {
    const ids = stories.map((s) => parseInt(s.id.replace("US-", ""), 10));
    let sequential = true;
    for (let i = 1; i < ids.length; i++) {
      if (ids[i] !== ids[i - 1] + 1) {
        sequential = false;
        result.issues.push({
          severity: "low",
          type: "non_sequential_ids",
          message: `Story IDs not sequential: ${stories[i - 1].id} → ${stories[i].id}`,
        });
        break;
      }
    }
    if (sequential) {
      result.score += 2;
    } else {
      result.checks.sequentialIds = false;
    }
  }

  return result;
}

/**
 * Check story quality (25 points)
 */
function checkStoryQuality(content, lines) {
  const result = {
    score: 0,
    max: 25,
    issues: [],
    checks: {
      criteriaVerifiable: true,
      hasExamples: false,
      hasNegativeCases: false,
      hasUIVerification: false,
      appropriateSize: true,
    },
  };

  const storyPattern = /^### \[([ x])\] (US-\d+):\s*(.*)$/;
  const criteriaPattern = /^- \[([ x])\]\s+(.+)$/;

  let currentStoryId = null;
  let currentStoryLine = null;
  let currentStoryCriteria = [];
  let totalStories = 0;
  let storiesWithExamples = 0;
  let storiesWithNegativeCases = 0;
  let uiStories = 0;
  let uiStoriesWithVerification = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track stories
    const storyMatch = line.match(storyPattern);
    if (storyMatch) {
      // Analyze previous story if exists
      if (currentStoryId && currentStoryCriteria.length > 0) {
        analyzeStory(
          currentStoryId,
          currentStoryLine,
          currentStoryCriteria,
          result
        );
        totalStories++;

        // Check for examples in criteria
        const hasExample = currentStoryCriteria.some((c) =>
          /example|e\.g\.|input.*output|given.*when.*then/i.test(c)
        );
        if (hasExample) storiesWithExamples++;

        // Check for negative/error cases
        const hasNegative = currentStoryCriteria.some((c) =>
          /error|invalid|fail|reject|when\s+not|negative|edge\s+case/i.test(c)
        );
        if (hasNegative) storiesWithNegativeCases++;

        // Check UI verification
        const isUIStory = /UI|button|form|page|display|render|show|view/i.test(
          currentStoryId
        );
        if (isUIStory) {
          uiStories++;
          const hasUIVerification = currentStoryCriteria.some((c) =>
            /browser|screenshot|visual|chrome|firefox|safari|rendered/i.test(c)
          );
          if (hasUIVerification) uiStoriesWithVerification++;
        }
      }

      currentStoryId = storyMatch[2];
      currentStoryLine = lineNum;
      currentStoryCriteria = [];
    }

    // Collect criteria for current story
    const criteriaMatch = line.match(criteriaPattern);
    if (criteriaMatch && currentStoryId) {
      currentStoryCriteria.push(criteriaMatch[2]);
    }
  }

  // Analyze last story
  if (currentStoryId && currentStoryCriteria.length > 0) {
    analyzeStory(currentStoryId, currentStoryLine, currentStoryCriteria, result);
    totalStories++;

    const hasExample = currentStoryCriteria.some((c) =>
      /example|e\.g\.|input.*output|given.*when.*then/i.test(c)
    );
    if (hasExample) storiesWithExamples++;

    const hasNegative = currentStoryCriteria.some((c) =>
      /error|invalid|fail|reject|when\s+not|negative|edge\s+case/i.test(c)
    );
    if (hasNegative) storiesWithNegativeCases++;

    const isUIStory = /UI|button|form|page|display|render|show|view/i.test(
      currentStoryId
    );
    if (isUIStory) {
      uiStories++;
      const hasUIVerification = currentStoryCriteria.some((c) =>
        /browser|screenshot|visual|chrome|firefox|safari|rendered/i.test(c)
      );
      if (hasUIVerification) uiStoriesWithVerification++;
    }
  }

  // Score criteria verifiability (10 points)
  // Already tracked in analyzeStory
  result.score += Math.max(
    0,
    10 - result.issues.filter((i) => i.type === "non_verifiable_criteria").length
  );

  // Score examples (5 points)
  if (totalStories > 0) {
    const exampleRatio = storiesWithExamples / totalStories;
    const exampleScore = Math.round(exampleRatio * 5);
    result.score += exampleScore;
    result.checks.hasExamples = exampleRatio >= 0.5;

    if (exampleRatio < 0.5) {
      result.issues.push({
        severity: "medium",
        type: "insufficient_examples",
        message: `Only ${storiesWithExamples}/${totalStories} stories have concrete examples`,
      });
    }
  }

  // Score negative cases (5 points)
  if (totalStories > 0) {
    const negativeRatio = storiesWithNegativeCases / totalStories;
    const negativeScore = Math.round(negativeRatio * 5);
    result.score += negativeScore;
    result.checks.hasNegativeCases = negativeRatio >= 0.5;

    if (negativeRatio < 0.3) {
      result.issues.push({
        severity: "medium",
        type: "missing_negative_cases",
        message: `Only ${storiesWithNegativeCases}/${totalStories} stories cover error/edge cases`,
      });
    }
  }

  // Score UI verification (3 points)
  if (uiStories > 0) {
    const uiVerifyRatio = uiStoriesWithVerification / uiStories;
    const uiScore = Math.round(uiVerifyRatio * 3);
    result.score += uiScore;
    result.checks.hasUIVerification = uiVerifyRatio >= 0.7;

    if (uiVerifyRatio < 0.7) {
      result.issues.push({
        severity: "medium",
        type: "missing_ui_verification",
        message: `Only ${uiStoriesWithVerification}/${uiStories} UI stories specify browser verification`,
      });
    }
  } else {
    result.score += 3; // No UI stories, full credit
  }

  // Story sizing (2 points)
  // This is a simple heuristic - stories with 3-5 criteria are well-sized
  const wellSizedStories = 0; // Would need story analysis
  result.score += 2; // Simplified for now

  return result;
}

/**
 * Analyze a single story's criteria for quality
 */
function analyzeStory(storyId, line, criteria, result) {
  // Check criteria count (3-5 is ideal)
  if (criteria.length < 3) {
    result.issues.push({
      severity: "medium",
      type: "insufficient_criteria",
      line,
      message: `${storyId} has only ${criteria.length} acceptance criteria (need 3-5)`,
    });
  } else if (criteria.length > 7) {
    result.issues.push({
      severity: "low",
      type: "story_too_large",
      line,
      message: `${storyId} has ${criteria.length} criteria (consider splitting)`,
    });
  }

  // Check for vague criteria
  for (let i = 0; i < criteria.length; i++) {
    const vagueIssues = validators.detectVagueLanguage(criteria[i], line + i + 1);
    if (vagueIssues.length > 0) {
      result.issues.push({
        severity: "medium",
        type: "non_verifiable_criteria",
        line: line + i + 1,
        message: `${storyId} criterion is not verifiable: "${vagueIssues[0].match}"`,
      });
      result.checks.criteriaVerifiable = false;
    }
  }
}

/**
 * Check concreteness (20 points)
 */
function checkConcreteness(content, lines) {
  const result = {
    score: 20, // Start with full points, deduct for issues
    max: 20,
    issues: [],
    checks: {
      noVagueTerms: true,
      commandsExecutable: true,
      filePathsSpecific: true,
      noPlaceholders: true,
    },
  };

  let vagueCount = 0;
  let placeholderCount = 0;
  let commandIssues = 0;
  let pathIssues = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check for vague language
    const vagueIssues = validators.detectVagueLanguage(line, lineNum);
    if (vagueIssues.length > 0) {
      vagueCount += vagueIssues.length;
      result.issues.push({
        severity: "medium",
        type: "vague_language",
        line: lineNum,
        message: vagueIssues[0].message,
        suggestion: vagueIssues[0].suggestion,
      });
      result.checks.noVagueTerms = false;
    }

    // Check for placeholders
    const placeholders = validators.detectPlaceholders(line, lineNum);
    if (placeholders.length > 0) {
      placeholderCount += placeholders.length;
      result.issues.push({
        severity: "high",
        type: "placeholder",
        line: lineNum,
        message: placeholders[0].message,
        example: placeholders[0].example,
      });
      result.checks.noPlaceholders = false;
    }

    // Check command executability
    if (line.includes("```") || line.includes("`")) {
      const cmdIssues = validators.checkCommandExecutability(line, lineNum);
      if (cmdIssues.length > 0) {
        commandIssues += cmdIssues.length;
        result.issues.push(...cmdIssues.map((i) => ({ ...i, severity: "high" })));
        result.checks.commandsExecutable = false;
      }
    }

    // Check file path specificity
    const pathIssues = validators.validateFilePaths(line, lineNum);
    if (pathIssues.length > 0) {
      pathIssues += pathIssues.length;
      result.issues.push(...pathIssues.map((i) => ({ ...i, severity: "medium" })));
      result.checks.filePathsSpecific = false;
    }
  }

  // Deduct points based on issues (max 20 points to deduct)
  const deductions =
    Math.min(5, Math.floor(vagueCount / 2)) + // 0.5 points per vague term
    Math.min(7, placeholderCount) + // 1 point per placeholder
    Math.min(5, commandIssues * 2) + // 2 points per non-executable command
    Math.min(3, Math.floor(pathIssues / 2)); // 0.5 points per vague path

  result.score = Math.max(0, 20 - deductions);

  return result;
}

/**
 * Check context (15 points)
 */
function checkContext(content, lines) {
  const result = {
    score: 0,
    max: 15,
    issues: [],
    checks: {
      hasProjectStructure: false,
      hasCommands: false,
      techStackDetected: false,
      commandsMatchProject: true,
    },
  };

  // Check for Project Structure section (5 points)
  const hasStructure = lines.some((line) =>
    /^##+ (Project\s+Structure|Files?\s+to\s+(Create|Modify)|Directory\s+Layout)/i.test(line)
  );
  if (hasStructure) {
    result.score += 5;
    result.checks.hasProjectStructure = true;
  } else {
    result.issues.push({
      severity: "medium",
      type: "missing_project_structure",
      message: 'Missing "Project Structure" or "Files to Create/Modify" section',
    });
  }

  // Check for Commands Reference (5 points)
  const hasCommands = lines.some((line) =>
    /^##+ Commands?|^##+ Setup|^##+ Test|^##+ Build|^##+ Verify/i.test(line)
  );
  if (hasCommands) {
    result.score += 5;
    result.checks.hasCommands = true;
  } else {
    result.issues.push({
      severity: "medium",
      type: "missing_commands",
      message: "Missing commands section (setup/test/build/verify)",
    });
  }

  // Detect tech stack (3 points)
  const techPatterns = [
    /node|npm|yarn|pnpm/i,
    /python|pip|django|flask/i,
    /rust|cargo/i,
    /go\s+|golang/i,
    /java|maven|gradle/i,
    /react|vue|angular/i,
  ];

  const techDetected = techPatterns.some((pattern) => pattern.test(content));
  if (techDetected) {
    result.score += 3;
    result.checks.techStackDetected = true;
  } else {
    result.issues.push({
      severity: "low",
      type: "no_tech_stack",
      message: "No clear technology stack identified in PRD",
    });
  }

  // Commands match project (2 points)
  // This is simplified - in reality would check actual project files
  result.score += 2;

  return result;
}

/**
 * Convert score (0-100) to letter grade
 */
function gradeScore(score) {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/**
 * Generate actionable recommendations based on review results
 */
function generateRecommendations(result) {
  const recommendations = [];

  // Structure recommendations
  if (result.breakdown.structure.score < 15) {
    if (!result.breakdown.structure.checks.hasTitle) {
      recommendations.push({
        priority: "high",
        message: "Add a clear title header using # Title format",
      });
    }
    if (!result.breakdown.structure.checks.hasOverview) {
      recommendations.push({
        priority: "high",
        message: "Add an ## Overview section explaining what you're building and why",
      });
    }
    if (!result.breakdown.structure.checks.hasUserStories) {
      recommendations.push({
        priority: "critical",
        message: "Add ## User Stories section with ### [ ] US-XXX: Title format",
      });
    }
  }

  // Boundaries recommendations
  if (result.breakdown.boundaries.score < 15) {
    recommendations.push({
      priority: "high",
      message: "Add three-tier boundaries: ✅ Always Do, ⚠️ Ask First, 🚫 Never Do (3+ items each)",
    });
  }

  // Concreteness recommendations
  if (result.breakdown.concreteness.score < 15) {
    const vagueIssues = result.issues.filter((i) => i.type === "vague_language");
    if (vagueIssues.length > 0) {
      recommendations.push({
        priority: "high",
        message: `Replace vague language with concrete outcomes (found ${vagueIssues.length} instances)`,
      });
    }

    const placeholders = result.issues.filter((i) => i.type === "placeholder");
    if (placeholders.length > 0) {
      recommendations.push({
        priority: "high",
        message: `Replace placeholders with actual values (found ${placeholders.length} instances)`,
      });
    }
  }

  // Story quality recommendations
  if (result.breakdown.storyQuality.score < 18) {
    if (!result.breakdown.storyQuality.checks.hasExamples) {
      recommendations.push({
        priority: "medium",
        message: "Add concrete examples with input/output to acceptance criteria",
      });
    }
    if (!result.breakdown.storyQuality.checks.hasNegativeCases) {
      recommendations.push({
        priority: "medium",
        message: "Add error cases and edge conditions to acceptance criteria",
      });
    }
  }

  // Context recommendations
  if (result.breakdown.context.score < 10) {
    if (!result.breakdown.context.checks.hasProjectStructure) {
      recommendations.push({
        priority: "medium",
        message: 'Add "Files to create/modify" section with specific file paths',
      });
    }
    if (!result.breakdown.context.checks.hasCommands) {
      recommendations.push({
        priority: "medium",
        message: "Add commands section with copy-paste executable setup/test/build commands",
      });
    }
  }

  return recommendations;
}

module.exports = {
  reviewPRD,
  gradeScore,
};
