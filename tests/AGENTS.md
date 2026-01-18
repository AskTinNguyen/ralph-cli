# Tests Directory - Agent Guide

**Quick Reference for Test Organization and Writing**

All Ralph CLI tests live in the `/tests` directory. This guide covers organization rules, file naming patterns, and test writing conventions.

---

## What is the tests/ Directory?

Central location for all test files, maintaining separation between tests and production code.

**Contents:**
- **Integration/E2E tests** - `*.mjs` files
- **Unit tests** - `test-*.js` files
- **Test fixtures** - `fixtures/` subdirectory
- **Test helpers** - `helpers/` subdirectory
- **Mock implementations** - `mocks/` subdirectory

**Purpose:** Centralized testing ensures consistency and prevents test files from being scattered across the codebase.

---

## Critical Rules

### ✅ DO:

- **Place ALL test files in `/tests` directory**
- **Use `.mjs` extension** for integration and E2E tests
- **Use `test-*.js` naming pattern** for unit tests
- **Use subdirectories** (`fixtures/`, `helpers/`, `mocks/`) for supporting files
- **Keep test file names descriptive** - `test-complexity.js`, `integration-metrics.mjs`

### ❌ DON'T:

- **Never place test files in `/lib`, `/bin`, or source directories**
- Don't mix test files with production code
- Don't use inconsistent naming conventions
- Don't create test files in project root

---

## File Organization

```
tests/
├── *.mjs                              # Integration and E2E tests
│   ├── cli-smoke.mjs                  # CLI smoke tests
│   ├── agent-loops.mjs                # Agent loop behavior
│   ├── integration.mjs                # Main integration suite
│   ├── e2e-workflow.mjs               # End-to-end workflows
│   └── real-agents.mjs                # Real agent execution
│
├── test-*.js                          # Unit tests
│   ├── test-analyzer.js               # Code analyzer tests
│   ├── test-committer.js              # Git committer tests
│   ├── test-complexity.js             # Complexity analysis
│   ├── test-executor.js               # Story executor tests
│   └── test-realistic-scenarios.js    # Realistic workflows
│
├── fixtures/                          # Test fixtures and sample data
├── helpers/                           # Test utility functions
└── mocks/                             # Mock implementations
```

---

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
npm run test:risk            # Risk analysis
npm run test:actions         # Actions workflow
npm run test:notify          # Notifications
npm run test:metrics         # Metrics collection
npm run test:doctor          # Doctor diagnostics
npm run test:watch           # File watching
npm run test:ui-api          # UI API
```

### Advanced Tests

```bash
# Real agent execution (expensive, uses API credits)
npm run test:real

# End-to-end workflow tests
npm run test:e2e
```

---

## Test Writing Patterns

### Integration Test Structure (*.mjs)

```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Feature Name', () => {
  it('should do something', async () => {
    // Arrange
    const input = setupTestData();

    // Act
    const result = await featureUnderTest(input);

    // Assert
    assert.strictEqual(result.status, 'success');
  });
});
```

### Unit Test Structure (test-*.js)

```javascript
const assert = require('assert');
const { describe, it } = require('node:test');

describe('Module Name', () => {
  it('should handle edge case', () => {
    // Arrange
    const input = edgeCaseData();

    // Act
    const result = moduleUnderTest(input);

    // Assert
    assert.ok(result.isValid);
  });
});
```

---

## Test Helpers

### Using Fixtures

```javascript
import { readFileSync } from 'fs';
import { join } from 'path';

const fixture = readFileSync(
  join(import.meta.dirname, 'fixtures/sample-prd.md'),
  'utf-8'
);
```

### Using Helpers

```javascript
import { setupTestRepo, cleanupTestRepo } from './helpers/git-helpers.js';

describe('Git operations', () => {
  beforeEach(() => setupTestRepo());
  afterEach(() => cleanupTestRepo());

  it('should commit changes', async () => {
    // Test logic
  });
});
```

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **Full Testing Guide:** [TESTING.md](../TESTING.md) - Comprehensive test documentation
- **Package Structure:** [CLAUDE.md § Package Structure](../CLAUDE.md#package-structure) - Testing rules

---

## Summary

**Key Takeaways:**

1. **All tests in `/tests` directory** - Never place tests in source directories
2. **Use `.mjs` for integration** - Integration/E2E tests
3. **Use `test-*.js` for unit tests** - Unit test naming pattern
4. **Organize with subdirectories** - fixtures/, helpers/, mocks/
5. **Run `npm test` for smoke tests** - Fast validation without agents
6. **Run `npm run test:all` for integration** - Full test suite with agents
