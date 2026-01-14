/**
 * Fix definitions and repair functions for ralph doctor
 *
 * Provides install commands for missing tools, state file repairs,
 * git conflict resolution suggestions, and documentation links.
 */
const fs = require("fs");
const path = require("path");

/**
 * Documentation links for complex issues
 */
const DOCUMENTATION_LINKS = {
  ralph_install: "https://github.com/AskTinNguyen/ralph-cli#quick-reference",
  ralph_prd: "https://github.com/AskTinNguyen/ralph-cli#workflow",
  ralph_streams: "https://github.com/AskTinNguyen/ralph-cli#parallel-workflow",
  prd_format: "https://github.com/AskTinNguyen/ralph-cli#prd-format",
  agent_config: "https://github.com/AskTinNguyen/ralph-cli#agent-configuration",
  node_install: "https://nodejs.org/en/download/",
  git_install: "https://git-scm.com/downloads",
  claude_install: "https://docs.anthropic.com/en/docs/claude-code",
  codex_install: "https://github.com/openai/codex",
  git_merge_conflicts: "https://git-scm.com/docs/git-merge#_how_to_resolve_conflicts",
};

/**
 * Fix definitions for common issues
 * Each fix has: command, description, type (auto|manual|guided)
 */
const FIXES = {
  // Missing tool installations
  missing_node: {
    command: null,
    description: "Install Node.js v18+ from nodejs.org",
    type: "manual",
    link: DOCUMENTATION_LINKS.node_install,
    steps: [
      "Visit https://nodejs.org",
      "Download the LTS version (18.x or later)",
      "Run the installer",
      "Verify with: node --version",
    ],
  },
  missing_git: {
    command: null,
    description: "Install Git from git-scm.com",
    type: "manual",
    link: DOCUMENTATION_LINKS.git_install,
    steps: [
      "Visit https://git-scm.com/downloads",
      "Download the version for your OS",
      "Run the installer",
      "Verify with: git --version",
    ],
  },
  missing_claude: {
    command: "npm install -g @anthropic-ai/claude-code",
    description: "Install Claude Code CLI globally",
    type: "auto",
    link: DOCUMENTATION_LINKS.claude_install,
  },
  missing_codex: {
    command: "npm install -g @openai/codex",
    description: "Install Codex CLI globally",
    type: "auto",
    link: DOCUMENTATION_LINKS.codex_install,
  },
  missing_droid: {
    command: null,
    description: "See Droid installation documentation",
    type: "manual",
    link: null,
    steps: ["Contact your organization for Droid installation instructions"],
  },

  // Ralph setup issues
  missing_ralph_templates: {
    command: "ralph install",
    description: "Install Ralph agent templates",
    type: "auto",
    link: DOCUMENTATION_LINKS.ralph_install,
  },
  missing_ralph_dir: {
    command: "ralph prd",
    description: "Create initial PRD to set up .ralph directory",
    type: "guided",
    link: DOCUMENTATION_LINKS.ralph_prd,
  },
  missing_guardrails: {
    command: "ralph build 1",
    description: "Run a build iteration to create guardrails.md",
    type: "guided",
    link: DOCUMENTATION_LINKS.ralph_install,
  },

  // State file issues
  corrupted_prd_markers: {
    command: null,
    description: "Repair malformed story markers in PRD",
    type: "auto",
    repairFunction: "repairPRDMarkers",
  },
  corrupted_plan_format: {
    command: null,
    description: "Repair malformed task markers in plan",
    type: "auto",
    repairFunction: "repairPlanFormat",
  },
  unclosed_bracket: {
    command: null,
    description: "Fix unclosed brackets in checkbox markers",
    type: "auto",
    repairFunction: "repairUnclosedBrackets",
  },

  // Git issues
  git_merge_conflicts: {
    command: null,
    description: "Resolve git merge conflicts",
    type: "guided",
    link: DOCUMENTATION_LINKS.git_merge_conflicts,
    steps: [
      "Run: git status  # to see conflicted files",
      "Edit each conflicted file to resolve conflicts",
      "Remove <<<<<<, ======, and >>>>>> markers",
      "Run: git add <resolved-file>",
      "Run: git commit  # to complete the merge",
    ],
  },
  git_uncommitted_changes: {
    command: null,
    description: "Handle uncommitted changes",
    type: "guided",
    steps: [
      "To save changes: git stash",
      "To discard changes: git checkout -- .",
      "To commit changes: git add -A && git commit -m 'message'",
    ],
  },
  git_detached_head: {
    command: null,
    description: "Fix detached HEAD state",
    type: "guided",
    steps: [
      "To create a branch from current state: git checkout -b <new-branch-name>",
      "To return to an existing branch: git checkout <branch-name>",
      "To discard current changes: git checkout main",
    ],
  },
  git_not_repo: {
    command: "git init",
    description: "Initialize a git repository",
    type: "auto",
  },
};

/**
 * Read file contents or return null
 * @param {string} filePath - Path to file
 * @returns {string|null}
 */
function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * Write content to file
 * @param {string} filePath - Path to file
 * @param {string} content - Content to write
 * @returns {boolean} Success status
 */
function writeFile(filePath, content) {
  try {
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Repair malformed story markers in PRD file
 * Fixes: ### [] US-XXX -> ### [ ] US-XXX
 *        ### [X] US-XXX -> ### [x] US-XXX
 *        ### [  ] US-XXX -> ### [ ] US-XXX
 *
 * @param {string} prdPath - Path to prd.md file
 * @returns {object} Repair result with changes made
 */
function repairPRDMarkers(prdPath) {
  const result = {
    success: false,
    path: prdPath,
    changes: [],
    error: null,
  };

  const content = readFile(prdPath);
  if (!content) {
    result.error = `Cannot read file: ${prdPath}`;
    return result;
  }

  let modified = content;
  const lines = content.split("\n");
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNum = i + 1;
    const originalLine = line;

    // Fix story headers: ### [] US-XXX -> ### [ ] US-XXX
    if (line.match(/^### \[\]\s*US-\d+:/)) {
      line = line.replace(/^### \[\]/, "### [ ]");
      result.changes.push({
        line: lineNum,
        type: "empty_checkbox",
        before: originalLine,
        after: line,
      });
    }

    // Fix uppercase X: ### [X] -> ### [x]
    if (line.match(/^### \[X\]/)) {
      line = line.replace(/^### \[X\]/, "### [x]");
      result.changes.push({
        line: lineNum,
        type: "uppercase_x",
        before: originalLine,
        after: line,
      });
    }

    // Fix double space: ### [  ] -> ### [ ]
    if (line.match(/^### \[\s{2,}\]/)) {
      line = line.replace(/^### \[\s{2,}\]/, "### [ ]");
      result.changes.push({
        line: lineNum,
        type: "double_space",
        before: originalLine,
        after: line,
      });
    }

    // Fix criteria uppercase X: - [X] -> - [x]
    if (line.match(/^- \[X\]/)) {
      line = line.replace(/^- \[X\]/, "- [x]");
      result.changes.push({
        line: lineNum,
        type: "criteria_uppercase_x",
        before: originalLine,
        after: line,
      });
    }

    // Fix criteria empty: - [] -> - [ ]
    if (line.match(/^- \[\]\s/)) {
      line = line.replace(/^- \[\]/, "- [ ]");
      result.changes.push({
        line: lineNum,
        type: "criteria_empty",
        before: originalLine,
        after: line,
      });
    }

    newLines.push(line);
  }

  if (result.changes.length > 0) {
    modified = newLines.join("\n");
    if (writeFile(prdPath, modified)) {
      result.success = true;
    } else {
      result.error = `Cannot write to file: ${prdPath}`;
    }
  } else {
    result.success = true; // No changes needed
  }

  return result;
}

/**
 * Repair malformed task markers in plan file
 * Fixes: - [] Task -> - [ ] Task
 *        - [X] Task -> - [x] Task
 *
 * @param {string} planPath - Path to plan.md file
 * @returns {object} Repair result with changes made
 */
function repairPlanFormat(planPath) {
  const result = {
    success: false,
    path: planPath,
    changes: [],
    error: null,
  };

  const content = readFile(planPath);
  if (!content) {
    result.error = `Cannot read file: ${planPath}`;
    return result;
  }

  const lines = content.split("\n");
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNum = i + 1;
    const originalLine = line;

    // Fix empty checkbox: - [] -> - [ ]
    if (line.match(/^- \[\]\s/)) {
      line = line.replace(/^- \[\]/, "- [ ]");
      result.changes.push({
        line: lineNum,
        type: "empty_checkbox",
        before: originalLine,
        after: line,
      });
    }

    // Fix uppercase X: - [X] -> - [x]
    if (line.match(/^- \[X\]/)) {
      line = line.replace(/^- \[X\]/, "- [x]");
      result.changes.push({
        line: lineNum,
        type: "uppercase_x",
        before: originalLine,
        after: line,
      });
    }

    // Fix double space: - [  ] -> - [ ]
    if (line.match(/^- \[\s{2,}\]/)) {
      line = line.replace(/^- \[\s{2,}\]/, "- [ ]");
      result.changes.push({
        line: lineNum,
        type: "double_space",
        before: originalLine,
        after: line,
      });
    }

    newLines.push(line);
  }

  if (result.changes.length > 0) {
    const modified = newLines.join("\n");
    if (writeFile(planPath, modified)) {
      result.success = true;
    } else {
      result.error = `Cannot write to file: ${planPath}`;
    }
  } else {
    result.success = true; // No changes needed
  }

  return result;
}

/**
 * Repair unclosed brackets in files
 * Fixes: - [task -> - [ ] task
 *        ### [US-XXX -> ### [ ] US-XXX
 *
 * @param {string} filePath - Path to file
 * @returns {object} Repair result with changes made
 */
function repairUnclosedBrackets(filePath) {
  const result = {
    success: false,
    path: filePath,
    changes: [],
    error: null,
  };

  const content = readFile(filePath);
  if (!content) {
    result.error = `Cannot read file: ${filePath}`;
    return result;
  }

  const lines = content.split("\n");
  const newLines = [];

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const lineNum = i + 1;
    const originalLine = line;

    // Fix unclosed bracket in story header: ### [US-XXX -> ### [ ] US-XXX
    if (line.match(/^### \[(?![\sx\]])/) && !line.includes("]")) {
      line = line.replace(/^### \[/, "### [ ] ");
      result.changes.push({
        line: lineNum,
        type: "unclosed_story_bracket",
        before: originalLine,
        after: line,
      });
    }

    // Fix unclosed bracket in task: - [task -> - [ ] task
    if (line.match(/^- \[(?![\sx\]])/) && !line.match(/^- \[.\]/)) {
      line = line.replace(/^- \[/, "- [ ] ");
      result.changes.push({
        line: lineNum,
        type: "unclosed_task_bracket",
        before: originalLine,
        after: line,
      });
    }

    newLines.push(line);
  }

  if (result.changes.length > 0) {
    const modified = newLines.join("\n");
    if (writeFile(filePath, modified)) {
      result.success = true;
    } else {
      result.error = `Cannot write to file: ${filePath}`;
    }
  } else {
    result.success = true; // No changes needed
  }

  return result;
}

/**
 * Get suggested git commands based on git state
 * @param {object} gitState - Git state from environment checks
 * @returns {object} Suggested git fixes
 */
function suggestGitFixes(gitState) {
  const suggestions = [];

  if (!gitState) {
    return { suggestions: [] };
  }

  // Handle not a git repo
  if (gitState.isRepo === false) {
    suggestions.push({
      issue: "not_a_git_repo",
      severity: "error",
      fix: FIXES.git_not_repo,
    });
    return { suggestions };
  }

  // Handle merge conflicts
  if (gitState.hasConflicts) {
    suggestions.push({
      issue: "merge_conflicts",
      severity: "error",
      fix: FIXES.git_merge_conflicts,
      commands: [
        "git status                    # See conflicted files",
        "git diff                      # View conflicts",
        "git checkout --theirs <file>  # Accept incoming changes",
        "git checkout --ours <file>    # Keep current changes",
        "git add <file>                # Mark as resolved",
        "git commit                    # Complete merge",
      ],
    });
  }

  // Handle uncommitted changes
  if (gitState.hasUncommitted) {
    suggestions.push({
      issue: "uncommitted_changes",
      severity: "warning",
      fix: FIXES.git_uncommitted_changes,
      commands: [
        "git stash                     # Save changes for later",
        "git stash pop                 # Restore stashed changes",
        "git checkout -- .             # Discard all changes",
        "git add -A && git commit -m 'WIP'  # Commit changes",
      ],
    });
  }

  // Handle detached HEAD
  if (gitState.branch === "HEAD") {
    suggestions.push({
      issue: "detached_head",
      severity: "warning",
      fix: FIXES.git_detached_head,
      commands: [
        "git checkout -b <new-branch>  # Create branch from current state",
        "git checkout main             # Return to main branch",
      ],
    });
  }

  // Handle no remote
  if (!gitState.hasRemote && gitState.isRepo) {
    suggestions.push({
      issue: "no_remote",
      severity: "info",
      fix: {
        description: "No remote repository configured",
        type: "guided",
        steps: [
          "Create a repository on GitHub/GitLab",
          "Run: git remote add origin <url>",
          "Run: git push -u origin main",
        ],
      },
      commands: [
        "git remote add origin <url>   # Add remote",
        "git push -u origin main       # Push and set upstream",
      ],
    });
  }

  return { suggestions };
}

/**
 * Get fix suggestion for a specific issue type
 * @param {string} issueType - Type of issue from checks
 * @returns {object|null} Fix definition or null
 */
function getFix(issueType) {
  // Map issue types to fixes
  const issueToFix = {
    // Environment issues
    missing_node: "missing_node",
    missing_git: "missing_git",
    missing_claude: "missing_claude",
    missing_codex: "missing_codex",
    missing_droid: "missing_droid",
    node_version_low: "missing_node",

    // Configuration issues
    directory_not_found: "missing_ralph_templates",
    missing_template: "missing_ralph_templates",
    no_prds: "missing_ralph_dir",
    missing_guardrails: "missing_guardrails",

    // State issues
    malformed_story_header: "corrupted_prd_markers",
    empty_story_title: "corrupted_prd_markers",
    unclosed_bracket: "unclosed_bracket",
    unclosed_task_bracket: "corrupted_plan_format",

    // Git issues
    not_a_git_repo: "git_not_repo",
    merge_conflicts: "git_merge_conflicts",
    uncommitted_changes: "git_uncommitted_changes",
    detached_head: "git_detached_head",
  };

  const fixKey = issueToFix[issueType];
  return fixKey ? FIXES[fixKey] : null;
}

/**
 * Apply automatic fixes for detected issues
 * @param {object} diagnosticResults - Results from doctor checks
 * @param {string} projectPath - Path to project root
 * @returns {object} Results of applied fixes
 */
function applyFixes(diagnosticResults, projectPath = ".") {
  const results = {
    applied: [],
    skipped: [],
    failed: [],
  };

  // Process state check errors for auto-fixable issues
  if (diagnosticResults.state && diagnosticResults.state.checks) {
    for (const check of diagnosticResults.state.checks) {
      if (check.errors) {
        for (const error of check.errors) {
          const fix = getFix(error.type);
          if (fix && fix.type === "auto" && fix.repairFunction) {
            // Apply repair function
            let repairResult;
            if (fix.repairFunction === "repairPRDMarkers" && check.path) {
              repairResult = repairPRDMarkers(check.path);
            } else if (fix.repairFunction === "repairPlanFormat" && check.path) {
              repairResult = repairPlanFormat(check.path);
            } else if (fix.repairFunction === "repairUnclosedBrackets" && check.path) {
              repairResult = repairUnclosedBrackets(check.path);
            }

            if (repairResult) {
              if (repairResult.success) {
                results.applied.push({
                  type: error.type,
                  fix: fix.description,
                  changes: repairResult.changes,
                });
              } else {
                results.failed.push({
                  type: error.type,
                  fix: fix.description,
                  error: repairResult.error,
                });
              }
            }
          } else if (fix && fix.type !== "auto") {
            results.skipped.push({
              type: error.type,
              fix: fix.description,
              reason: `Requires ${fix.type} intervention`,
              suggestion: fix.command || fix.steps,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Format fix suggestion for display
 * @param {object} fix - Fix definition
 * @returns {string} Formatted fix string
 */
function formatFix(fix) {
  if (!fix) return "";

  const lines = [];

  if (fix.command) {
    lines.push(`  → ${fix.command}`);
  }

  if (fix.steps) {
    for (const step of fix.steps) {
      lines.push(`  → ${step}`);
    }
  }

  if (fix.link) {
    lines.push(`  → See: ${fix.link}`);
  }

  return lines.join("\n");
}

module.exports = {
  // Fix definitions
  FIXES,
  DOCUMENTATION_LINKS,

  // Repair functions
  repairPRDMarkers,
  repairPlanFormat,
  repairUnclosedBrackets,

  // Git suggestions
  suggestGitFixes,

  // Fix utilities
  getFix,
  applyFixes,
  formatFix,
};
