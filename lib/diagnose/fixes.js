/**
 * Fix Registry for Auto-Remediation
 *
 * Maps error types from classifier.js to executable fix commands
 * with categorization for safe vs risky operations.
 */

/**
 * Fix categories - determines whether approval is needed
 */
const FIX_CATEGORIES = {
  SAFE: "safe",
  NEEDS_APPROVAL: "needs-approval",
  MANUAL_ONLY: "manual-only",
};

/**
 * Extract dependency name from error message
 * Handles patterns like:
 * - Cannot find module 'lodash'
 * - Module not found: Error: Can't resolve 'axios'
 * - Error: Cannot find module '@scope/package'
 *
 * @param {string} errorMessage - The error message
 * @returns {string|null} Extracted dependency name or null
 */
function extractDependencyName(errorMessage) {
  if (!errorMessage) return null;

  // Pattern: Cannot find module 'package-name'
  let match = errorMessage.match(/Cannot find module ['"]([^'"]+)['"]/);
  if (match) return match[1];

  // Pattern: Can't resolve 'package-name'
  match = errorMessage.match(/Can't resolve ['"]([^'"]+)['"]/);
  if (match) return match[1];

  // Pattern: Module not found: 'package-name'
  match = errorMessage.match(/Module not found:.*['"]([^'"]+)['"]/);
  if (match) return match[1];

  // Pattern: Error: Cannot find package 'package-name'
  match = errorMessage.match(/Cannot find package ['"]([^'"]+)['"]/);
  if (match) return match[1];

  return null;
}

/**
 * Sanitize dependency name to prevent shell injection
 * Only allows valid npm package name characters
 *
 * @param {string} dep - Dependency name
 * @returns {string|null} Sanitized name or null if invalid
 */
function sanitizeDependencyName(dep) {
  if (!dep) return null;

  // Valid npm package names: lowercase, numbers, hyphens, dots, underscores
  // Scoped packages: @scope/package-name
  const validPattern = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;

  if (!validPattern.test(dep)) {
    return null;
  }

  // Additional safety: no shell metacharacters
  if (/[;&|`$(){}[\]\\<>]/.test(dep)) {
    return null;
  }

  return dep;
}

/**
 * Fix Registry - maps error types to fix definitions
 *
 * Each fix has:
 * - category: safe | needs-approval | manual-only
 * - command: string or function(context) => string
 * - verify: command to verify fix succeeded
 * - description: human-readable description
 * - suggest: suggestion text for non-auto fixes
 */
const FIX_REGISTRY = {
  /**
   * Lint errors - safe auto-fix
   * Uses npm run lint -- --fix if available, falls back to eslint --fix
   */
  LINT_ERROR: {
    category: FIX_CATEGORIES.SAFE,
    command: "npm run lint -- --fix",
    verify: "npm run lint",
    description: "Auto-fix lint errors with --fix flag",
    filePatterns: ["*.js", "*.ts", "*.jsx", "*.tsx"],
  },

  /**
   * Format errors - safe auto-fix
   * Uses prettier to format all source files
   */
  FORMAT_ERROR: {
    category: FIX_CATEGORIES.SAFE,
    command: "npx prettier --write .",
    verify: "npx prettier --check .",
    description: "Auto-fix formatting with prettier",
    filePatterns: ["*.js", "*.ts", "*.jsx", "*.tsx", "*.json", "*.md"],
  },

  /**
   * Missing dependency - safe auto-fix
   * Extracts package name from error and installs it
   */
  MISSING_DEPENDENCY: {
    category: FIX_CATEGORIES.SAFE,
    command: function (context) {
      const dep = extractDependencyName(context.errorMessage);
      const sanitized = sanitizeDependencyName(dep);
      if (!sanitized) {
        return null; // Cannot determine safe command
      }
      return `npm install ${sanitized}`;
    },
    verify: "npm ls",
    description: "Auto-install missing npm dependency",
    extractDependency: extractDependencyName,
  },

  /**
   * Type errors - needs approval for complex cases
   * Basic TS errors can be attempted with tsc fixes
   */
  TYPE_ERROR: {
    category: FIX_CATEGORIES.NEEDS_APPROVAL,
    command: null, // Complex - requires AI or manual intervention
    verify: "npx tsc --noEmit",
    description: "TypeScript type errors require manual review",
    suggest: "Run `npx tsc --noEmit` to identify all type errors, then fix manually or use --fix-types flag",
    basicFixes: {
      // Common basic fixes that can be attempted
      undefinedProperty: "Add optional chaining (?.) or nullish coalescing (??)",
      missingImport: "Add missing import statement",
      wrongType: "Add type assertion or fix the type annotation",
    },
  },

  /**
   * Syntax errors - needs approval (risky)
   * Syntax errors usually require understanding intent
   */
  SYNTAX_ERROR: {
    category: FIX_CATEGORIES.NEEDS_APPROVAL,
    command: null,
    verify: null,
    description: "Syntax errors require manual review",
    suggest: "Check for missing brackets, quotes, or semicolons",
  },

  /**
   * Test failures - manual only
   * Tests fail for logic reasons, not fixable automatically
   */
  TEST_FAILURE: {
    category: FIX_CATEGORIES.MANUAL_ONLY,
    command: null,
    verify: "npm test",
    description: "Test failures require manual investigation",
    suggest: "Review failing test assertions and expected values",
  },

  /**
   * Build errors - needs approval
   * Build errors may have multiple causes
   */
  BUILD_ERROR: {
    category: FIX_CATEGORIES.NEEDS_APPROVAL,
    command: null,
    verify: "npm run build",
    description: "Build errors require investigation",
    suggest: "Check build configuration and dependencies",
  },

  /**
   * Shell/command errors - manual only
   * Depends on system configuration
   */
  SHELL_ERROR: {
    category: FIX_CATEGORIES.MANUAL_ONLY,
    command: null,
    verify: null,
    description: "Shell errors depend on system configuration",
    suggest: "Verify command exists in PATH and has correct arguments",
  },

  /**
   * Permission errors - manual only
   * Requires system-level changes
   */
  PERMISSION_ERROR: {
    category: FIX_CATEGORIES.MANUAL_ONLY,
    command: null,
    verify: null,
    description: "Permission errors require manual resolution",
    suggest: "Check file and directory permissions",
  },

  /**
   * File not found - needs approval
   * May need to create file or fix path
   */
  FILE_NOT_FOUND: {
    category: FIX_CATEGORIES.NEEDS_APPROVAL,
    command: null,
    verify: null,
    description: "File not found errors need path verification",
    suggest: "Verify file paths and create missing files if needed",
  },

  /**
   * Git errors - needs approval
   * Git state can be complex
   */
  GIT_ERROR: {
    category: FIX_CATEGORIES.NEEDS_APPROVAL,
    command: null,
    verify: "git status",
    description: "Git errors need careful handling",
    suggest: "Run git status and resolve any conflicts or uncommitted changes",
  },

  /**
   * Uncommitted changes - safe auto-fix (stash)
   */
  UNCOMMITTED_CHANGES: {
    category: FIX_CATEGORIES.SAFE,
    command: "git stash",
    verify: "git status --porcelain",
    description: "Stash uncommitted changes to clean working tree",
  },

  /**
   * Timeout errors - manual only
   * Requires optimization or config changes
   */
  TIMEOUT_ERROR: {
    category: FIX_CATEGORIES.MANUAL_ONLY,
    command: null,
    verify: null,
    description: "Timeout errors require optimization",
    suggest: "Increase timeout values or optimize slow operations",
  },

  /**
   * Network errors - manual only
   * External factors
   */
  NETWORK_ERROR: {
    category: FIX_CATEGORIES.MANUAL_ONLY,
    command: null,
    verify: null,
    description: "Network errors are usually transient",
    suggest: "Check connectivity and retry",
  },

  /**
   * Memory errors - manual only
   * Requires code or config changes
   */
  MEMORY_ERROR: {
    category: FIX_CATEGORIES.MANUAL_ONLY,
    command: null,
    verify: null,
    description: "Memory errors require optimization",
    suggest: "Increase heap size with NODE_OPTIONS=--max-old-space-size=4096",
  },
};

/**
 * Map classifier ROOT_CAUSES keys to FIX_REGISTRY keys
 * Some have same name, some need mapping
 */
const ROOT_CAUSE_TO_FIX = {
  missing_dependency: "MISSING_DEPENDENCY",
  type_error: "TYPE_ERROR",
  test_failure: "TEST_FAILURE",
  syntax_error: "SYNTAX_ERROR",
  shell_error: "SHELL_ERROR",
  permission_error: "PERMISSION_ERROR",
  file_not_found: "FILE_NOT_FOUND",
  git_error: "GIT_ERROR",
  timeout_error: "TIMEOUT_ERROR",
  network_error: "NETWORK_ERROR",
  memory_error: "MEMORY_ERROR",
  build_error: "BUILD_ERROR",
  uncommitted_changes: "UNCOMMITTED_CHANGES",
  unknown: null, // No fix for unknown errors
};

/**
 * Get fix definition for a root cause
 *
 * @param {string} rootCause - Root cause key from classifier
 * @returns {object|null} Fix definition or null
 */
function getFixForRootCause(rootCause) {
  const fixKey = ROOT_CAUSE_TO_FIX[rootCause];
  if (!fixKey) return null;
  return FIX_REGISTRY[fixKey] || null;
}

/**
 * Get all safe fixes (category = 'safe')
 *
 * @returns {object} Map of fix key to fix definition
 */
function getSafeFixes() {
  const safeFixes = {};
  for (const [key, fix] of Object.entries(FIX_REGISTRY)) {
    if (fix.category === FIX_CATEGORIES.SAFE) {
      safeFixes[key] = fix;
    }
  }
  return safeFixes;
}

/**
 * Get fix command for an error
 * Handles both static commands and dynamic command functions
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @param {object} context - Context with errorMessage, filePath, etc.
 * @returns {string|null} Command to execute or null
 */
function getFixCommand(fixKey, context = {}) {
  const fix = FIX_REGISTRY[fixKey];
  if (!fix) return null;

  if (typeof fix.command === "function") {
    return fix.command(context);
  }

  return fix.command;
}

/**
 * Check if a fix is safe to run automatically
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @returns {boolean}
 */
function isSafeFix(fixKey) {
  const fix = FIX_REGISTRY[fixKey];
  return fix && fix.category === FIX_CATEGORIES.SAFE;
}

/**
 * Check if a fix needs approval
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @returns {boolean}
 */
function needsApproval(fixKey) {
  const fix = FIX_REGISTRY[fixKey];
  return fix && fix.category === FIX_CATEGORIES.NEEDS_APPROVAL;
}

/**
 * Check if a fix is manual-only
 *
 * @param {string} fixKey - Key in FIX_REGISTRY
 * @returns {boolean}
 */
function isManualOnly(fixKey) {
  const fix = FIX_REGISTRY[fixKey];
  return fix && fix.category === FIX_CATEGORIES.MANUAL_ONLY;
}

module.exports = {
  // Constants
  FIX_CATEGORIES,
  FIX_REGISTRY,
  ROOT_CAUSE_TO_FIX,

  // Helpers
  extractDependencyName,
  sanitizeDependencyName,

  // Query functions
  getFixForRootCause,
  getSafeFixes,
  getFixCommand,
  isSafeFix,
  needsApproval,
  isManualOnly,
};
