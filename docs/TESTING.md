# Testing Guide

## Test Folder Structure

All test files **must** be in the `/tests` directory. This is a strict requirement to maintain code organization and clarity.

```
tests/
├── *.mjs                              # Integration and E2E tests
│   ├── cli-smoke.mjs                  # CLI smoke tests (basic functionality)
│   ├── agent-loops.mjs                # Agent loop behavior tests
│   ├── agent-ping.mjs                 # Agent health check tests
│   ├── integration.mjs                # Main integration test suite
│   ├── integration-actions.mjs        # Actions integration tests
│   ├── integration-checkpoint.mjs     # Checkpoint system tests
│   ├── integration-doctor.mjs         # Doctor command tests
│   ├── integration-metrics.mjs        # Metrics collection tests
│   ├── integration-notify.mjs         # Notification system tests
│   ├── integration-risk.mjs           # Risk analysis tests
│   ├── integration-switcher.mjs       # Agent switcher tests
│   ├── integration-ui-api.mjs         # UI API integration tests
│   ├── integration-watch.mjs          # File watching tests
│   ├── e2e-workflow.mjs               # End-to-end workflow tests
│   ├── real-agents.mjs                # Real agent execution tests
│   └── lib-python.mjs                 # Python library tests
│
├── test-*.js                          # Unit tests
│   ├── test-analyzer.js               # Code analyzer tests
│   ├── test-committer.js              # Git committer tests
│   ├── test-complexity.js             # Complexity analysis tests
│   ├── test-context-budget.js         # Context budget tests
│   ├── test-context-directives.js     # Context directive tests
│   ├── test-context-scorer.js         # Context scoring tests
│   ├── test-context-selector.js       # Context selection tests
│   ├── test-context-visualization.js  # Context visualization tests
│   ├── test-error-handling.js         # Error handling tests
│   ├── test-executor.js               # Story executor tests
│   ├── test-executor-us003.js         # Specific user story tests
│   ├── test-git-fallback.js           # Git fallback functionality tests
│   ├── test-merger.js                 # Branch merger tests
│   ├── test-parallel-index.js         # Parallel execution tests
│   ├── test-realistic-scenarios.js    # Realistic workflow scenario tests
│   ├── test-risk-analyzer.js          # Risk analyzer tests
│   ├── test-token-usage.js            # Token usage tracking tests
│   └── test-with-anthropic-api.js     # Anthropic API integration tests
│
├── fixtures/                          # Test fixtures and sample data
├── helpers/                           # Test utility functions
└── mocks/                             # Mock implementations

```

## File Organization Rules

### ✅ DO

- Place **all** test files in `/tests` directory
- Use `.mjs` extension for integration and E2E tests
- Use `test-*.js` naming pattern for unit tests
- Use subdirectories (`fixtures/`, `helpers/`, `mocks/`) for supporting test files
- Keep test file names descriptive and consistent

### ❌ DON'T

- Place test files in `/lib`, `/bin`, or any source directory
- Mix test files with production code
- Use inconsistent naming conventions
- Create test files in the project root

## Running Tests

### Quick Tests (No Agent Required)

```bash
# Smoke tests - fast validation
npm test

# Agent health check
npm run test:ping
```

### Integration Tests (Requires Agents)

```bash
# All integration tests
npm run test:all

# Specific integration tests
npm run test:checkpoint      # Checkpoint system
npm run test:switcher        # Agent switching
npm run test:risk           # Risk analysis
npm run test:actions        # Actions workflow
npm run test:notify         # Notifications
npm run test:metrics        # Metrics collection
npm run test:doctor         # Doctor diagnostics
npm run test:watch          # File watching
npm run test:ui-api         # UI API
```

### Advanced Tests

```bash
# End-to-end workflow
npm run test:e2e

# Real agent execution (requires configured agents)
npm run test:real

# With coverage reporting
npm run test:coverage

# Integration tests with environment flag
RALPH_INTEGRATION=1 npm test
```

## Test Categories

### 1. Smoke Tests (`*.mjs`)
Quick validation tests that ensure basic CLI functionality works without requiring a real agent.

### 2. Integration Tests (`integration-*.mjs`)
Tests that verify multiple components work together correctly. May require mock or real agents.

### 3. Unit Tests (`test-*.js`)
Isolated tests for specific modules and functions. Focus on individual component behavior.

### 4. E2E Tests (`e2e-*.mjs`)
Full workflow tests that simulate real user scenarios from start to finish.

### 5. Real Agent Tests
Tests that execute against actual Claude/Codex/Droid agents. Require API keys and agent installation.

## Writing New Tests

When adding new tests:

1. **Choose the right location**: Always use `/tests` directory
2. **Choose the right extension**:
   - `.mjs` for integration/E2E tests
   - `.js` for unit tests
3. **Use descriptive names**:
   - Integration: `integration-feature-name.mjs`
   - Unit: `test-component-name.js`
   - E2E: `e2e-workflow-name.mjs`
4. **Update package.json** if adding new npm scripts
5. **Document** complex test scenarios

## Migration Notes

All test files have been migrated to `/tests` directory following this structure:

- Moved from `/lib/metrics/test-git-fallback.js` → `/tests/test-git-fallback.js`
- Moved from root `test-*.js` files → `/tests/test-*.js`
- Updated import paths to reflect new locations
- All worktree test copies remain in `.ralph/worktrees/` (not part of main codebase)

## Best Practices

1. **Isolation**: Tests should not depend on each other
2. **Cleanup**: Clean up any created files/state after tests
3. **Fast**: Keep unit tests fast; use mocks when possible
4. **Descriptive**: Use clear test names and assertions
5. **Maintainable**: Keep tests simple and focused
6. **Documented**: Add comments for complex test logic
