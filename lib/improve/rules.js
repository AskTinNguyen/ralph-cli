/**
 * Failure-to-guardrail mapping rules
 *
 * Maps error patterns to guardrail templates that can prevent the same issues.
 */

/**
 * Error categories with their guardrail templates
 */
const GUARDRAIL_TEMPLATES = {
  // Uncommitted changes patterns
  uncommitted_changes: {
    trigger: "Before marking a story as complete",
    instruction: "Run `git status --porcelain` to verify the working tree is clean. Stage and commit all changes before proceeding.",
    context: "Iterations have left uncommitted changes, which breaks the loop's stateless design.",
  },

  // Missing COMPLETE signal
  no_complete_signal: {
    trigger: "When finishing a story in build mode",
    instruction: "Only output `<promise>COMPLETE</promise>` after verifying ALL stories in the PRD are complete. Check the PRD file to confirm.",
    context: "Runs failed to signal completion properly, causing the loop to not recognize finished work.",
  },

  // Test failures
  test_failure: {
    trigger: "Before committing changes",
    instruction: "Run the project's test suite and verify all tests pass. Fix any failing tests before committing.",
    context: "Changes were committed with failing tests, causing downstream issues.",
  },

  // Type errors
  type_error: {
    trigger: "Before committing TypeScript/JavaScript changes",
    instruction: "Run type checking (tsc --noEmit or equivalent) and fix all type errors before committing.",
    context: "Type errors were introduced, breaking the build.",
  },

  // Syntax errors
  syntax_error: {
    trigger: "After writing code",
    instruction: "Validate syntax before saving. Run a linter or syntax check to catch issues early.",
    context: "Syntax errors were introduced, preventing code execution.",
  },

  // File not found
  file_not_found: {
    trigger: "Before reading or modifying a file",
    instruction: "Verify the file exists using ls or glob before attempting to read or modify it.",
    context: "Operations failed because target files did not exist.",
  },

  // Permission errors
  permission_error: {
    trigger: "When file operations fail",
    instruction: "Check file permissions before operations. Use appropriate permissions when creating files.",
    context: "File operations failed due to permission issues.",
  },

  // Dependency missing
  missing_dependency: {
    trigger: "Before running build or test commands",
    instruction: "Run `npm install` or equivalent to ensure all dependencies are installed.",
    context: "Commands failed because required dependencies were not installed.",
  },

  // Command failed (generic)
  command_failed: {
    trigger: "After running a command that may fail",
    instruction: "Check the exit code of commands and handle failures appropriately. Log errors for debugging.",
    context: "Commands failed without proper error handling.",
  },

  // Long duration
  slow_execution: {
    trigger: "When planning complex tasks",
    instruction: "Break large tasks into smaller, focused stories. Each story should complete in under 5 minutes.",
    context: "Runs took too long, suggesting tasks were too complex.",
  },

  // Multiple errors in single run
  multiple_errors: {
    trigger: "When encountering errors during execution",
    instruction: "Stop and fix the first error before continuing. Don't accumulate multiple errors.",
    context: "Runs accumulated multiple errors instead of fixing issues early.",
  },

  // Plan mode specific
  plan_incomplete: {
    trigger: "When completing planning mode",
    instruction: "Ensure the plan has specific, actionable tasks with verification commands for each story.",
    context: "Plans lacked sufficient detail for autonomous execution.",
  },

  // Git issues
  git_conflict: {
    trigger: "Before committing changes",
    instruction: "Pull latest changes and resolve any conflicts before pushing.",
    context: "Git operations failed due to conflicts or out-of-sync state.",
  },
};

/**
 * Pattern matchers that map error signatures to rule keys
 */
const PATTERN_MATCHERS = [
  {
    key: "uncommitted_changes",
    patterns: [
      /left uncommitted changes/i,
      /uncommitted changes/i,
      /working tree.*not clean/i,
      /changes not staged/i,
    ],
  },
  {
    key: "no_complete_signal",
    patterns: [
      /no.*complete.*signal/i,
      /missing.*complete/i,
      /<promise>COMPLETE<\/promise>.*not found/i,
    ],
  },
  {
    key: "test_failure",
    patterns: [
      /test.*fail/i,
      /tests.*failed/i,
      /npm test.*fail/i,
      /jest.*fail/i,
      /FAIL\s+\w+/,
    ],
  },
  {
    key: "type_error",
    patterns: [
      /TypeError/i,
      /type.*error/i,
      /TS\d+:/,
      /cannot.*type/i,
    ],
  },
  {
    key: "syntax_error",
    patterns: [
      /SyntaxError/i,
      /unexpected.*token/i,
      /parsing.*error/i,
    ],
  },
  {
    key: "file_not_found",
    patterns: [
      /ENOENT/i,
      /no such file/i,
      /file.*not found/i,
      /cannot find.*file/i,
    ],
  },
  {
    key: "permission_error",
    patterns: [
      /EACCES/i,
      /permission denied/i,
      /access denied/i,
    ],
  },
  {
    key: "missing_dependency",
    patterns: [
      /cannot find module/i,
      /module not found/i,
      /dependency.*missing/i,
      /package.*not installed/i,
    ],
  },
  {
    key: "command_failed",
    patterns: [
      /command failed/i,
      /exit.*code.*[1-9]/i,
      /exited.*non-zero/i,
    ],
  },
  {
    key: "git_conflict",
    patterns: [
      /merge conflict/i,
      /CONFLICT/,
      /cannot.*merge/i,
    ],
  },
];

/**
 * Match an error message to a rule key
 * @param {string} errorMessage - The error message to match
 * @returns {string|null} The matched rule key or null
 */
function matchErrorToRule(errorMessage) {
  for (const { key, patterns } of PATTERN_MATCHERS) {
    for (const pattern of patterns) {
      if (pattern.test(errorMessage)) {
        return key;
      }
    }
  }
  return null;
}

/**
 * Get guardrail template for a rule key
 * @param {string} ruleKey - The rule key
 * @returns {object|null} The guardrail template or null
 */
function getGuardrailTemplate(ruleKey) {
  return GUARDRAIL_TEMPLATES[ruleKey] || null;
}

/**
 * Get all available rule keys
 * @returns {string[]} List of rule keys
 */
function getAllRuleKeys() {
  return Object.keys(GUARDRAIL_TEMPLATES);
}

module.exports = {
  GUARDRAIL_TEMPLATES,
  PATTERN_MATCHERS,
  matchErrorToRule,
  getGuardrailTemplate,
  getAllRuleKeys,
};
