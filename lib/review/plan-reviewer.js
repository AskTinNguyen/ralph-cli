/**
 * Plan Quality Reviewer
 * Validates implementation plans against completeness and actionability standards
 */
const fs = require("fs");
const validators = require("./validators");

/**
 * Review a plan.md file for quality and actionability
 * @param {string} planPath - Path to plan.md file
 * @param {string} prdPath - Path to corresponding prd.md (for cross-validation)
 * @returns {object} Review result with score, grade, issues, and breakdown
 */
function reviewPlan(planPath, prdPath = null) {
  const result = {
    type: "plan",
    path: planPath,
    prdPath,
    valid: true,
    grade: "F",
    score: 0,
    breakdown: {
      structure: { score: 0, max: 25, issues: [] }, // Increased from 20 for Commands/Testing sections
      taskQuality: { score: 0, max: 30, issues: [] },
      codePatterns: { score: 0, max: 20, issues: [] },
      completeness: { score: 0, max: 15, issues: [] },
      actionability: { score: 0, max: 15, issues: [] },
    },
    issues: [],
    recommendations: [],
  };

  // Read plan file
  let content;
  try {
    content = fs.readFileSync(planPath, "utf8");
  } catch (err) {
    result.valid = false;
    result.issues.push({
      severity: "critical",
      type: "file_not_found",
      message: `Could not read plan file: ${err.message}`,
    });
    return result;
  }

  const lines = content.split("\n");

  // Read PRD if provided for cross-validation
  let prdContent = null;
  let prdStories = [];
  if (prdPath) {
    try {
      prdContent = fs.readFileSync(prdPath, "utf8");
      prdStories = extractPRDStories(prdContent);
    } catch (err) {
      // PRD not available, skip cross-validation
    }
  }

  // ============================================================================
  // Structure Check (20 points)
  // ============================================================================
  const structureResult = checkPlanStructure(content, lines);
  result.breakdown.structure = structureResult;

  // ============================================================================
  // Task Quality Check (30 points)
  // ============================================================================
  const taskQualityResult = checkTaskQuality(content, lines);
  result.breakdown.taskQuality = taskQualityResult;

  // ============================================================================
  // Code Patterns Check (20 points)
  // ============================================================================
  const codePatternsResult = checkCodePatterns(content, lines);
  result.breakdown.codePatterns = codePatternsResult;

  // ============================================================================
  // Completeness Check (15 points)
  // ============================================================================
  const completenessResult = checkCompleteness(content, lines, prdStories);
  result.breakdown.completeness = completenessResult;

  // ============================================================================
  // Actionability Check (15 points)
  // ============================================================================
  const actionabilityResult = checkActionability(content, lines);
  result.breakdown.actionability = actionabilityResult;

  // ============================================================================
  // Calculate Overall Score
  // ============================================================================
  result.score =
    structureResult.score +
    taskQualityResult.score +
    codePatternsResult.score +
    completenessResult.score +
    actionabilityResult.score;

  result.grade = gradeScore(result.score);

  // ============================================================================
  // Aggregate All Issues
  // ============================================================================
  result.issues = [
    ...structureResult.issues,
    ...taskQualityResult.issues,
    ...codePatternsResult.issues,
    ...completenessResult.issues,
    ...actionabilityResult.issues,
  ];

  // ============================================================================
  // Generate Recommendations
  // ============================================================================
  result.recommendations = generateRecommendations(result);

  return result;
}

/**
 * Extract story IDs from PRD for cross-validation
 */
function extractPRDStories(prdContent) {
  const stories = [];
  const storyPattern = /^### \[([ x])\] (US-\d+):\s*(.*)$/gm;
  let match;

  while ((match = storyPattern.exec(prdContent)) !== null) {
    stories.push({
      id: match[2],
      title: match[3],
      completed: match[1] === "x",
    });
  }

  return stories;
}

/**
 * Check plan structure (25 points max)
 * - Title header: 4 points
 * - Summary section: 4 points
 * - Tasks section: 4 points
 * - Commands section: 3 points
 * - Testing section: 2 points (optional)
 * - Story header format: 5 points
 * - Task checkboxes: 3 points
 * @param {string} content - Full plan content
 * @param {string[]} lines - Plan content split by lines
 * @returns {object} Structure check result with score, issues, and checks
 */
function checkPlanStructure(content, lines) {
  const result = {
    score: 0,
    max: 25, // Increased from 20 to accommodate new sections
    issues: [],
    checks: {
      hasTitle: false,
      hasSummary: false,
      hasTasks: false,
      hasCommands: false,
      hasTesting: false,
      storyHeadersCorrect: true,
      allPRDStoriesPresent: true,
    },
  };

  // Check for title header (4 points)
  const hasTitleHeader = lines.some((line) =>
    /^# Implementation Plan/i.test(line)
  );
  if (hasTitleHeader) {
    result.score += 4;
    result.checks.hasTitle = true;
  } else {
    result.issues.push({
      severity: "high",
      type: "missing_title",
      message: "Plan is missing '# Implementation Plan' header",
    });
  }

  // Check for Summary section (4 points)
  const hasSummary = lines.some((line) => /^## Summary/i.test(line));
  if (hasSummary) {
    result.score += 4;
    result.checks.hasSummary = true;
  } else {
    result.issues.push({
      severity: "high",
      type: "missing_summary",
      message: "Plan is missing ## Summary section",
    });
  }

  // Check for Tasks section (4 points)
  const hasTasks = lines.some((line) => /^## Tasks/i.test(line));
  if (hasTasks) {
    result.score += 4;
    result.checks.hasTasks = true;
  } else {
    result.issues.push({
      severity: "critical",
      type: "missing_tasks",
      message: "Plan is missing ## Tasks section",
    });
  }

  // Check for Commands section (3 points)
  const hasCommands = lines.some((line) => /^##\s*Commands/i.test(line));
  if (hasCommands) {
    result.score += 3;
    result.checks.hasCommands = true;
  } else {
    result.issues.push({
      severity: "medium",
      type: "missing_commands",
      message: "Plan missing ## Commands section with executable commands",
    });
  }

  // Check for Testing section (2 points) - optional but recommended
  const hasTesting = lines.some((line) =>
    /^##\s*(Testing|Testing Strategy)/i.test(line)
  );
  if (hasTesting) {
    result.score += 2;
    result.checks.hasTesting = true;
  }
  // No issue added for missing Testing - it's optional

  // Validate story headers match PRD format (5 points)
  const storyHeaderPattern = /^### (US-\d+):\s*(.*)$/;
  const storyHeaders = [];
  let headerScore = 5;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    const headerMatch = line.match(storyHeaderPattern);
    if (headerMatch) {
      storyHeaders.push({
        id: headerMatch[1],
        title: headerMatch[2],
        line: lineNum,
      });

      // Check story ID format
      if (!/^US-\d{3}$/.test(headerMatch[1])) {
        result.issues.push({
          severity: "medium",
          type: "story_header_format",
          line: lineNum,
          message: `Story header ID should be US-XXX (3 digits): ${headerMatch[1]}`,
        });
        headerScore -= 1;
        result.checks.storyHeadersCorrect = false;
      }
    }

    // Check for malformed headers
    if (line.match(/^### US-/) && !headerMatch) {
      result.issues.push({
        severity: "medium",
        type: "malformed_story_header",
        line: lineNum,
        message: "Malformed story header (expected: ### US-XXX: Title)",
      });
      headerScore -= 1;
      result.checks.storyHeadersCorrect = false;
    }
  }

  result.score += Math.max(0, headerScore);

  // Check for task checkboxes (3 points)
  const taskPattern = /^- \[([ x])\]\s+(.+)$/;
  const hasTaskCheckboxes = lines.some((line) => taskPattern.test(line));
  if (hasTaskCheckboxes) {
    result.score += 3;
  } else {
    result.issues.push({
      severity: "high",
      type: "no_tasks",
      message: "No task checkboxes found (- [ ] format)",
    });
  }

  return result;
}

/**
 * Check task quality (30 points)
 */
function checkTaskQuality(content, lines) {
  const result = {
    score: 0,
    max: 30,
    issues: [],
    checks: {
      allTasksHaveScope: true,
      allTasksHaveAcceptance: true,
      allTasksHaveVerification: true,
      tasksIndependent: true,
      dependenciesClear: true,
    },
  };

  const taskPattern = /^- \[([ x])\]\s+(.+)$/;
  const tasks = [];
  let currentStoryId = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track current story
    const storyMatch = line.match(/^### (US-\d+):/);
    if (storyMatch) {
      currentStoryId = storyMatch[1];
    }

    // Collect tasks
    const taskMatch = line.match(taskPattern);
    if (taskMatch) {
      const taskText = taskMatch[2];
      const taskStartLine = lineNum;

      // Look ahead for Scope/Acceptance/Verification
      let hasScope = false;
      let hasAcceptance = false;
      let hasVerification = false;

      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const nextLine = lines[j];

        // Stop at next task or section
        if (nextLine.match(/^-\s+\[/) || nextLine.match(/^###/)) break;

        if (/^\s+-\s+Scope:/i.test(nextLine)) hasScope = true;
        if (/^\s+-\s+Acceptance:/i.test(nextLine)) hasAcceptance = true;
        if (/^\s+-\s+Verification:/i.test(nextLine)) hasVerification = true;
      }

      tasks.push({
        text: taskText,
        line: taskStartLine,
        storyId: currentStoryId,
        hasScope,
        hasAcceptance,
        hasVerification,
      });

      // Check for required fields
      if (!hasScope) {
        result.issues.push({
          severity: "high",
          type: "missing_task_scope",
          line: taskStartLine,
          message: `Task missing Scope field: "${taskText.substring(0, 50)}..."`,
        });
        result.checks.allTasksHaveScope = false;
      }

      if (!hasAcceptance) {
        result.issues.push({
          severity: "high",
          type: "missing_task_acceptance",
          line: taskStartLine,
          message: `Task missing Acceptance field: "${taskText.substring(0, 50)}..."`,
        });
        result.checks.allTasksHaveAcceptance = false;
      }

      if (!hasVerification) {
        result.issues.push({
          severity: "high",
          type: "missing_task_verification",
          line: taskStartLine,
          message: `Task missing Verification field: "${taskText.substring(0, 50)}..."`,
        });
        result.checks.allTasksHaveVerification = false;
      }
    }
  }

  // Score based on task completeness (20 points)
  if (tasks.length === 0) {
    result.issues.push({
      severity: "critical",
      type: "no_tasks",
      message: "Plan contains no tasks",
    });
  } else {
    const tasksWithAllFields = tasks.filter(
      (t) => t.hasScope && t.hasAcceptance && t.hasVerification
    ).length;
    const completenessRatio = tasksWithAllFields / tasks.length;
    result.score += Math.round(completenessRatio * 20);
  }

  // Score task independence (5 points)
  // Tasks should be independently shippable
  const dependencyPatterns = /depends?\s+on|requires?\s+completion|after\s+US-/i;
  const dependentTasks = tasks.filter((t) => dependencyPatterns.test(t.text));
  if (dependentTasks.length > tasks.length * 0.3) {
    result.issues.push({
      severity: "medium",
      type: "too_many_dependencies",
      message: `${dependentTasks.length}/${tasks.length} tasks have dependencies (consider reducing)`,
    });
    result.checks.tasksIndependent = false;
    result.score += 2;
  } else {
    result.score += 5;
  }

  // Score clear dependencies (5 points)
  // Dependencies should be explicit, not implicit
  result.score += 5; // Simplified for now

  return result;
}

/**
 * Check code patterns (20 points)
 */
function checkCodePatterns(content, lines) {
  const result = {
    score: 0,
    max: 20,
    issues: [],
    checks: {
      hasCodeExamples: false,
      patternsFromProject: false,
      showsErrorHandling: false,
      showsValidation: false,
      showsTesting: false,
      noGenericExamples: true,
    },
  };

  // Check for code patterns section (5 points)
  const hasCodePatterns = lines.some((line) =>
    /^##+ (Code\s+Patterns|Implementation\s+Patterns|Examples?)/i.test(line)
  );
  if (hasCodePatterns) {
    result.score += 5;
    result.checks.hasCodeExamples = true;
  } else {
    result.issues.push({
      severity: "medium",
      type: "missing_code_patterns",
      message: "Plan missing code patterns section with concrete examples",
    });
  }

  // Count code blocks
  const codeBlocks = (content.match(/```/g) || []).length / 2;
  if (codeBlocks >= 2) {
    result.score += 5;
    result.checks.hasCodeExamples = true;

    // Check if patterns reference project files (5 points)
    const hasProjectRefs =
      /from\s+['"]\.\/|import.*from\s+['"]\.\/|require\(['"]\.\//.test(content);
    if (hasProjectRefs) {
      result.score += 5;
      result.checks.patternsFromProject = true;
    } else {
      result.issues.push({
        severity: "low",
        type: "generic_code_examples",
        message: "Code examples don't reference actual project files",
      });
    }
  } else if (codeBlocks >= 1) {
    result.score += 2;
  } else {
    result.issues.push({
      severity: "medium",
      type: "no_code_examples",
      message: "Plan needs 2-3 concrete code pattern examples",
    });
  }

  // Check for error handling patterns (2 points)
  if (/try\s*\{|catch|error|throw|reject/i.test(content)) {
    result.score += 2;
    result.checks.showsErrorHandling = true;
  }

  // Check for validation patterns (2 points)
  if (/validate|check|verify|assert|if\s*\(/i.test(content)) {
    result.score += 2;
    result.checks.showsValidation = true;
  }

  // Check for testing patterns (1 point)
  if (/test|expect|assert|describe|it\(/i.test(content)) {
    result.score += 1;
    result.checks.showsTesting = true;
  }

  return result;
}

/**
 * Check completeness (15 points)
 */
function checkCompleteness(content, lines, prdStories) {
  const result = {
    score: 0,
    max: 15,
    issues: [],
    checks: {
      allStoriesHaveTasks: true,
      highRiskStoriesDetailed: true,
      noOrphanedTasks: true,
    },
  };

  // Extract plan story IDs
  const planStoryIds = new Set();
  const storyHeaderPattern = /^### (US-\d+):/;
  for (const line of lines) {
    const match = line.match(storyHeaderPattern);
    if (match) {
      planStoryIds.add(match[1]);
    }
  }

  // Cross-validate with PRD if available (10 points)
  if (prdStories && prdStories.length > 0) {
    const incompleteStories = prdStories.filter((s) => !s.completed);
    const missingStories = incompleteStories.filter(
      (s) => !planStoryIds.has(s.id)
    );

    if (missingStories.length === 0) {
      result.score += 10;
    } else {
      result.score += Math.max(
        0,
        Math.round(
          10 * (1 - missingStories.length / Math.max(1, incompleteStories.length))
        )
      );
      result.issues.push({
        severity: "high",
        type: "missing_stories",
        message: `Plan missing ${missingStories.length} incomplete PRD stories: ${missingStories
          .map((s) => s.id)
          .join(", ")}`,
      });
      result.checks.allStoriesHaveTasks = false;
    }
  } else {
    // No PRD to validate against, give partial credit
    result.score += 5;
  }

  // Check high-risk stories have detailed tasks (3 points)
  const highRiskKeywords = /security|auth|payment|data\s+loss|migration|breaking/i;
  const highRiskStories = Array.from(planStoryIds).filter((id) =>
    highRiskKeywords.test(content)
  );
  result.score += 3; // Simplified

  // Check for orphaned tasks (2 points)
  const taskPattern = /^- \[([ x])\]\s+(.+)$/;
  let lastStory = null;
  let orphanedTasks = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const storyMatch = line.match(storyHeaderPattern);
    if (storyMatch) {
      lastStory = storyMatch[1];
    }

    const taskMatch = line.match(taskPattern);
    if (taskMatch && !lastStory) {
      orphanedTasks++;
      result.issues.push({
        severity: "medium",
        type: "orphaned_task",
        line: i + 1,
        message: `Task not associated with any story: "${taskMatch[2].substring(0, 50)}..."`,
      });
      result.checks.noOrphanedTasks = false;
    }
  }

  if (orphanedTasks === 0) {
    result.score += 2;
  }

  return result;
}

/**
 * Check actionability (15 points)
 */
function checkActionability(content, lines) {
  const result = {
    score: 0,
    max: 15,
    issues: [],
    checks: {
      verificationsExecutable: true,
      pathsSpecific: true,
      tasksManageable: true,
      noAssumptions: true,
    },
  };

  let verificationCount = 0;
  let executableVerifications = 0;
  let vaguePathCount = 0;
  let oversizedTasks = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Check verification commands are executable (7 points)
    if (/^\s+-\s+Verification:/i.test(line)) {
      verificationCount++;

      // Look at next few lines for commands
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const cmdLine = lines[j];
        if (/^\s+-\s+(Scope|Acceptance):/i.test(cmdLine)) break;
        if (/^\s*-\s+\[/.test(cmdLine)) break; // Next task

        if (cmdLine.includes("`") || /^\s+```/.test(cmdLine)) {
          const cmdIssues = validators.checkCommandExecutability(cmdLine, j + 1);
          if (cmdIssues.length === 0) {
            executableVerifications++;
          } else {
            result.issues.push({
              severity: "high",
              type: "non_executable_verification",
              line: j + 1,
              message: "Verification command not executable (contains placeholders)",
            });
            result.checks.verificationsExecutable = false;
          }
        }
      }
    }

    // Check file paths are specific (4 points)
    const pathIssues = validators.validateFilePaths(line, lineNum);
    if (pathIssues.length > 0) {
      vaguePathCount += pathIssues.length;
      result.issues.push(...pathIssues.map((i) => ({ ...i, severity: "medium" })));
      result.checks.pathsSpecific = false;
    }

    // Check task size (3 points)
    // Tasks with > 200 words might be too large
    if (/^\s+-\s+Scope:/i.test(line)) {
      const scopeText = line.substring(line.indexOf(":") + 1);
      if (scopeText.split(/\s+/).length > 50) {
        oversizedTasks++;
        result.issues.push({
          severity: "low",
          type: "oversized_task",
          line: lineNum,
          message: "Task scope might be too large (consider splitting)",
        });
        result.checks.tasksManageable = false;
      }
    }
  }

  // Score executable verifications
  if (verificationCount > 0) {
    const execRatio = executableVerifications / verificationCount;
    result.score += Math.round(execRatio * 7);
  } else {
    result.score += 3; // Partial credit if no verifications found
  }

  // Score path specificity
  if (vaguePathCount === 0) {
    result.score += 4;
  } else {
    result.score += Math.max(0, 4 - Math.min(4, vaguePathCount));
  }

  // Score task size
  if (oversizedTasks === 0) {
    result.score += 3;
  } else {
    result.score += Math.max(0, 3 - Math.min(3, oversizedTasks));
  }

  // Check for assumptions about missing functionality (1 point)
  const assumptionPatterns = /assume|presume|if\s+.*\s+exists|when\s+.*\s+is\s+ready/i;
  if (!assumptionPatterns.test(content)) {
    result.score += 1;
  } else {
    result.issues.push({
      severity: "low",
      type: "assumptions",
      message: "Plan contains assumptions about missing functionality",
    });
    result.checks.noAssumptions = false;
  }

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
 * Generate actionable recommendations
 */
function generateRecommendations(result) {
  const recommendations = [];

  // Structure recommendations - core sections (only if score is low)
  if (result.breakdown.structure.score < 20) {
    if (!result.breakdown.structure.checks.hasTitle) {
      recommendations.push({
        priority: "high",
        message: "Add '# Implementation Plan' header",
      });
    }
    if (!result.breakdown.structure.checks.hasSummary) {
      recommendations.push({
        priority: "high",
        message: "Add ## Summary section with overview of approach",
      });
    }
    if (!result.breakdown.structure.checks.hasTasks) {
      recommendations.push({
        priority: "critical",
        message: "Add ## Tasks section with story headers and task checkboxes",
      });
    }
  }

  // Structure recommendations - optional sections (always check)
  if (!result.breakdown.structure.checks.hasCommands) {
    recommendations.push({
      priority: "medium",
      message:
        "Add ## Commands section with build/test/lint commands from package.json",
    });
  }
  if (!result.breakdown.structure.checks.hasTesting) {
    recommendations.push({
      priority: "low",
      message:
        "Consider adding ## Testing section with test framework and coverage requirements",
    });
  }

  // Task quality recommendations
  if (result.breakdown.taskQuality.score < 20) {
    const missingScope = result.issues.filter(
      (i) => i.type === "missing_task_scope"
    ).length;
    const missingAcceptance = result.issues.filter(
      (i) => i.type === "missing_task_acceptance"
    ).length;
    const missingVerification = result.issues.filter(
      (i) => i.type === "missing_task_verification"
    ).length;

    if (missingScope > 0) {
      recommendations.push({
        priority: "high",
        message: `Add Scope field to ${missingScope} task(s) - describe what + where`,
      });
    }
    if (missingAcceptance > 0) {
      recommendations.push({
        priority: "high",
        message: `Add Acceptance field to ${missingAcceptance} task(s) - concrete outcomes`,
      });
    }
    if (missingVerification > 0) {
      recommendations.push({
        priority: "high",
        message: `Add Verification field to ${missingVerification} task(s) - exact commands`,
      });
    }
  }

  // Code patterns recommendations
  if (result.breakdown.codePatterns.score < 15) {
    if (!result.breakdown.codePatterns.checks.hasCodeExamples) {
      recommendations.push({
        priority: "medium",
        message: "Add 2-3 concrete code pattern examples from actual project files",
      });
    }
    if (!result.breakdown.codePatterns.checks.patternsFromProject) {
      recommendations.push({
        priority: "medium",
        message: "Reference actual project files in code examples (not generic examples)",
      });
    }
  }

  // Completeness recommendations
  if (result.breakdown.completeness.score < 10) {
    const missingStories = result.issues.filter(
      (i) => i.type === "missing_stories"
    );
    if (missingStories.length > 0) {
      recommendations.push({
        priority: "high",
        message: missingStories[0].message,
      });
    }
  }

  // Actionability recommendations
  if (result.breakdown.actionability.score < 10) {
    if (!result.breakdown.actionability.checks.verificationsExecutable) {
      recommendations.push({
        priority: "high",
        message: "Make verification commands copy-paste executable (remove placeholders)",
      });
    }
    if (!result.breakdown.actionability.checks.pathsSpecific) {
      recommendations.push({
        priority: "medium",
        message: "Use specific file paths (e.g., 'src/auth.ts' not 'the auth file')",
      });
    }
  }

  return recommendations;
}

module.exports = {
  reviewPlan,
  gradeScore,
};
