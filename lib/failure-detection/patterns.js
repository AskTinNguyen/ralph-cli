/**
 * Failure detection patterns - extracted from loop.sh
 *
 * Each pattern includes:
 * - pattern: RegExp pattern to match
 * - category: Category of failure (test, lint, type, build, runtime, git)
 * - severity: 1 (info), 2 (warning), 3 (error), 4 (critical)
 * - description: Human-readable description
 */

// Test failure patterns (15+ patterns)
const TEST_PATTERNS = [
  // Jest, Vitest
  {
    pattern: /Tests:.*\d+\s+failed/i,
    category: "test",
    severity: 3,
    description: "Jest/Vitest test failures",
  },
  // Mocha
  {
    pattern: /\d+\s+failing/,
    category: "test",
    severity: 3,
    description: "Mocha test failures",
  },
  // Pytest
  {
    pattern: /FAILED.*test/i,
    category: "test",
    severity: 3,
    description: "Pytest test failures",
  },
  // Go test (FAIL<tab>package)
  {
    pattern: /^FAIL\t/m,
    category: "test",
    severity: 3,
    description: "Go test failure",
  },
  // Go test detailed
  {
    pattern: /---\s*FAIL:/,
    category: "test",
    severity: 3,
    description: "Go test detailed failure",
  },
  // npm test failure
  {
    pattern: /npm\s+ERR!.*test/i,
    category: "test",
    severity: 3,
    description: "npm test failure",
  },
  // Generic test failure
  {
    pattern: /test.*failed/i,
    category: "test",
    severity: 3,
    description: "Generic test failure",
  },
  // Jest/Vitest expect failure
  {
    pattern: /Error:\s*expect/i,
    category: "test",
    severity: 3,
    description: "Jest/Vitest expect failure",
  },
  // Bun and others
  {
    pattern: /\d+\s+test.*fail/i,
    category: "test",
    severity: 3,
    description: "Test count failure",
  },
  // Test file failure patterns (.test. files)
  {
    pattern: /FAIL.*\.test\./,
    category: "test",
    severity: 3,
    description: "Test file failure (.test.)",
  },
  // Spec file failure patterns (.spec. files)
  {
    pattern: /FAIL.*\.spec\./,
    category: "test",
    severity: 3,
    description: "Spec file failure (.spec.)",
  },
  // AssertionError
  {
    pattern: /AssertionError/,
    category: "test",
    severity: 3,
    description: "Assertion error",
  },
  // Expect to
  {
    pattern: /expect\(.*\)\.to/,
    category: "test",
    severity: 3,
    description: "Test expectation failure",
  },
  // Test runner exit
  {
    pattern: /test\s+(runner|suite)\s+exit/i,
    category: "test",
    severity: 3,
    description: "Test runner exit",
  },
  // ✗ symbol (common in test output)
  {
    pattern: /✗/,
    category: "test",
    severity: 2,
    description: "Test failure symbol",
  },
];

// Lint failure patterns (12+ patterns)
const LINT_PATTERNS = [
  // ESLint
  {
    pattern: /error.*eslint/i,
    category: "lint",
    severity: 3,
    description: "ESLint error",
  },
  // ESLint alternate order
  {
    pattern: /eslint.*error/i,
    category: "lint",
    severity: 3,
    description: "ESLint error (alternate)",
  },
  // ESLint summary (✖ N errors)
  {
    pattern: /✖\s*\d+\s+error/i,
    category: "lint",
    severity: 3,
    description: "ESLint error count",
  },
  // ESLint line error format (10:5 error message)
  {
    pattern: /\d+:\d+\s+error\s+/i,
    category: "lint",
    severity: 3,
    description: "ESLint line error",
  },
  // Prettier
  {
    pattern: /prettier.*failed/i,
    category: "lint",
    severity: 3,
    description: "Prettier failure",
  },
  // Prettier check mode
  {
    pattern: /prettier.*check.*failed/i,
    category: "lint",
    severity: 3,
    description: "Prettier check failure",
  },
  // Ruff (Python)
  {
    pattern: /ruff.*error/i,
    category: "lint",
    severity: 3,
    description: "Ruff linter error",
  },
  // Pylint
  {
    pattern: /pylint.*error/i,
    category: "lint",
    severity: 3,
    description: "Pylint error",
  },
  // Flake8
  {
    pattern: /flake8.*error/i,
    category: "lint",
    severity: 3,
    description: "Flake8 error",
  },
  // Stylelint (CSS)
  {
    pattern: /stylelint.*error/i,
    category: "lint",
    severity: 3,
    description: "Stylelint error",
  },
  // golangci-lint (Go)
  {
    pattern: /golangci-lint.*error/i,
    category: "lint",
    severity: 3,
    description: "golangci-lint error",
  },
  // Generic lint failure
  {
    pattern: /lint.*failed/i,
    category: "lint",
    severity: 3,
    description: "Generic lint failure",
  },
  // Generic linting failure
  {
    pattern: /linting.*failed/i,
    category: "lint",
    severity: 3,
    description: "Linting failure",
  },
  // Linting errors message
  {
    pattern: /Linting errors/i,
    category: "lint",
    severity: 3,
    description: "Linting errors",
  },
];

// Type check failure patterns (10+ patterns)
const TYPE_PATTERNS = [
  // TypeScript errors
  {
    pattern: /error\s+TS\d+/,
    category: "type",
    severity: 3,
    description: "TypeScript error",
  },
  // TypeScript compiler
  {
    pattern: /tsc.*error/i,
    category: "type",
    severity: 3,
    description: "TypeScript compiler error",
  },
  // TypeScript type error
  {
    pattern: /Type.*is not assignable/,
    category: "type",
    severity: 3,
    description: "TypeScript type assignment error",
  },
  // TypeScript/JavaScript import error
  {
    pattern: /Cannot find module/,
    category: "type",
    severity: 3,
    description: "Module not found error",
  },
  // TypeScript undefined error
  {
    pattern: /Cannot find name/,
    category: "type",
    severity: 3,
    description: "Name not found error",
  },
  // mypy (Python)
  {
    pattern: /mypy.*error/i,
    category: "type",
    severity: 3,
    description: "mypy type error",
  },
  // mypy error format (file:line: error:)
  {
    pattern: /:\d+:\s*error:/i,
    category: "type",
    severity: 3,
    description: "mypy/pyright line error",
  },
  // Pyright (Python)
  {
    pattern: /pyright.*error/i,
    category: "type",
    severity: 3,
    description: "Pyright type error",
  },
  // Rust compiler errors
  {
    pattern: /error\[E\d+\]/,
    category: "type",
    severity: 3,
    description: "Rust compiler error",
  },
  // Flow (JavaScript)
  {
    pattern: /flow.*error/i,
    category: "type",
    severity: 3,
    description: "Flow type error",
  },
  // TypeError
  {
    pattern: /TypeError:/,
    category: "type",
    severity: 3,
    description: "JavaScript TypeError",
  },
];

// Build/compilation failure patterns (8+ patterns)
const BUILD_PATTERNS = [
  // npm ERR!
  {
    pattern: /npm\s+ERR!/,
    category: "build",
    severity: 3,
    description: "npm error",
  },
  // Build failed
  {
    pattern: /build\s+failed/i,
    category: "build",
    severity: 3,
    description: "Build failure",
  },
  // Compilation failed
  {
    pattern: /compilation\s+failed/i,
    category: "build",
    severity: 3,
    description: "Compilation failure",
  },
  // Make error
  {
    pattern: /make\[\d+\]:.*Error/,
    category: "build",
    severity: 3,
    description: "Make error",
  },
  // Cargo (Rust) build error
  {
    pattern: /cargo.*build.*failed/i,
    category: "build",
    severity: 3,
    description: "Cargo build failure",
  },
  // Could not build
  {
    pattern: /could not build/i,
    category: "build",
    severity: 3,
    description: "Build failure",
  },
  // Build error
  {
    pattern: /\[BUILD\].*error/i,
    category: "build",
    severity: 3,
    description: "Build error",
  },
  // Webpack build error
  {
    pattern: /webpack.*error/i,
    category: "build",
    severity: 3,
    description: "Webpack error",
  },
];

// Runtime error patterns (10+ patterns)
const RUNTIME_PATTERNS = [
  // Generic Error:
  {
    pattern: /Error:/,
    category: "runtime",
    severity: 2,
    description: "Generic error",
  },
  // Exception
  {
    pattern: /Exception:/i,
    category: "runtime",
    severity: 3,
    description: "Exception",
  },
  // Abort
  {
    pattern: /abort/i,
    category: "runtime",
    severity: 4,
    description: "Process abort",
  },
  // Panic
  {
    pattern: /panic/i,
    category: "runtime",
    severity: 4,
    description: "Panic",
  },
  // Fatal
  {
    pattern: /fatal/i,
    category: "runtime",
    severity: 4,
    description: "Fatal error",
  },
  // Crashed
  {
    pattern: /crashed/i,
    category: "runtime",
    severity: 4,
    description: "Process crashed",
  },
  // Timeout
  {
    pattern: /timeout/i,
    category: "runtime",
    severity: 3,
    description: "Timeout",
  },
  // Connection refused
  {
    pattern: /refused/i,
    category: "runtime",
    severity: 3,
    description: "Connection refused",
  },
  // ENOENT (file not found)
  {
    pattern: /ENOENT/,
    category: "runtime",
    severity: 3,
    description: "File not found (ENOENT)",
  },
  // EACCES (permission denied)
  {
    pattern: /EACCES/,
    category: "runtime",
    severity: 3,
    description: "Permission denied (EACCES)",
  },
  // EPERM (operation not permitted)
  {
    pattern: /EPERM/,
    category: "runtime",
    severity: 3,
    description: "Operation not permitted (EPERM)",
  },
  // Segmentation fault
  {
    pattern: /segmentation\s+fault/i,
    category: "runtime",
    severity: 4,
    description: "Segmentation fault",
  },
  // Stack overflow
  {
    pattern: /stack\s+overflow/i,
    category: "runtime",
    severity: 4,
    description: "Stack overflow",
  },
  // Out of memory
  {
    pattern: /out\s+of\s+memory/i,
    category: "runtime",
    severity: 4,
    description: "Out of memory",
  },
];

// Git/VCS error patterns (5+ patterns)
const GIT_PATTERNS = [
  // Git fatal not a repository (highest priority, specific match)
  {
    pattern: /fatal:\s*not\s+a\s+git\s+repository/i,
    category: "git",
    severity: 4,
    description: "Not a git repository",
  },
  // Git error (priority higher than runtime fatal)
  {
    pattern: /fatal:\s+/,
    category: "git",
    severity: 4,
    description: "Git fatal error",
  },
  // Git conflict
  {
    pattern: /CONFLICT\s+\(/,
    category: "git",
    severity: 3,
    description: "Git merge conflict",
  },
  // Git error
  {
    pattern: /error:\s+cannot\s+lock/i,
    category: "git",
    severity: 3,
    description: "Git lock error",
  },
  // Git not a repository (alternate form)
  {
    pattern: /not\s+a\s+git\s+repository/i,
    category: "git",
    severity: 3,
    description: "Not a git repository",
  },
  // Git push rejected
  {
    pattern: /\[rejected\]/,
    category: "git",
    severity: 3,
    description: "Git push rejected",
  },
];

// All patterns combined
const ALL_PATTERNS = [
  ...TEST_PATTERNS,
  ...LINT_PATTERNS,
  ...TYPE_PATTERNS,
  ...BUILD_PATTERNS,
  ...RUNTIME_PATTERNS,
  ...GIT_PATTERNS,
];

// Category definitions for grouping
const CATEGORIES = {
  test: {
    name: "Test Failures",
    description: "Test runner and assertion failures",
    patterns: TEST_PATTERNS,
  },
  lint: {
    name: "Lint Errors",
    description: "Code style and lint errors",
    patterns: LINT_PATTERNS,
  },
  type: {
    name: "Type Errors",
    description: "Type checking and compilation errors",
    patterns: TYPE_PATTERNS,
  },
  build: {
    name: "Build Failures",
    description: "Build and compilation failures",
    patterns: BUILD_PATTERNS,
  },
  runtime: {
    name: "Runtime Errors",
    description: "Runtime and system errors",
    patterns: RUNTIME_PATTERNS,
  },
  git: {
    name: "Git Errors",
    description: "Version control errors",
    patterns: GIT_PATTERNS,
  },
};

// Severity levels
const SEVERITY_LEVELS = {
  1: "info",
  2: "warning",
  3: "error",
  4: "critical",
};

module.exports = {
  TEST_PATTERNS,
  LINT_PATTERNS,
  TYPE_PATTERNS,
  BUILD_PATTERNS,
  RUNTIME_PATTERNS,
  GIT_PATTERNS,
  ALL_PATTERNS,
  CATEGORIES,
  SEVERITY_LEVELS,
};
