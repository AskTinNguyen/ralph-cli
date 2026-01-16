---
name: factory
description: "Meta-orchestration layer for creating factorial-style sequences of agent workflows. Use when building production pipelines, chaining PRD→Plan→Build flows, or creating recursive/branching workflows with verification gates."
version: 1.0.0
---

# Factory Mode

Meta-orchestration layer for Ralph CLI that enables declarative, multi-stage agent workflows with tamper-resistant verification gates.

---

## Overview

Factory Mode allows you to:

- **Chain workflows**: PRD → Plan → Build pipelines where outcomes feed into new stages
- **Branch conditionally**: Execute different paths based on previous stage results
- **Loop recursively**: Retry failed stages with accumulated context
- **Run in parallel**: Execute independent stages concurrently
- **Verify work**: Tamper-resistant gates that require proof-of-work, not just text claims

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `ralph factory init [name]` | Create new factory from template |
| `ralph factory run [name]` | Execute factory pipeline |
| `ralph factory status [name]` | Show execution progress |
| `ralph factory stop [name]` | Stop running factory |
| `ralph factory resume [name]` | Resume from checkpoint |
| `ralph factory list` | List all factories |
| `ralph factory graph [name]` | Visualize dependency graph |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FACTORY MODE                                 │
│                    Meta-Orchestration Layer                          │
└─────────────────────────────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
   ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
   │   Parser    │         │  Scheduler  │         │  Executor   │
   │   (YAML)    │         │   (DAG)     │         │  (Stages)   │
   └──────┬──────┘         └──────┬──────┘         └──────┬──────┘
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  │
                           ┌──────▼──────┐
                           │  Verifier   │
                           │  (Gates)    │
                           └─────────────┘
```

### Core Components

| Component | File | Purpose |
|-----------|------|---------|
| Parser | `lib/factory/parser.js` | Parse YAML, validate schema, resolve templates |
| Scheduler | `lib/factory/scheduler.js` | Build DAG, determine execution order |
| Executor | `lib/factory/executor.js` | Run stages, capture outputs, handle retries |
| Context | `lib/factory/context.js` | Extract learnings, inject context |
| Verifier | `lib/factory/verifier.js` | Tamper-resistant verification gates |
| Checkpoint | `lib/factory/checkpoint.js` | Save/restore execution state |

---

## Factory Configuration (YAML)

### Basic Structure

```yaml
# .ralph/factory/my-factory.yaml
version: "1"
name: "my-factory"

variables:
  max_iterations: 10
  test_command: "npm test"

stages:
  - id: stage_one
    type: custom
    command: "echo 'Hello World'"

  - id: stage_two
    type: custom
    depends_on: [stage_one]
    command: "echo 'Stage two'"
```

### Stage Types

| Type | Description | Configuration |
|------|-------------|---------------|
| `prd` | Generate PRD | `input.request`, `input.context` |
| `plan` | Create plan from PRD | `depends_on` (prd stage) |
| `build` | Execute stories | `config.iterations`, `config.parallel` |
| `custom` | Run shell command | `command` |
| `factory` | Nested factory | `factory_name` |

### Full Schema

```yaml
version: "1"
name: "factory-name"

variables:
  var_name: "value"
  max_recursion: 3

stages:
  - id: unique_stage_id          # Required: unique identifier
    type: custom|prd|plan|build|factory

    # Dependencies
    depends_on: [other_stage_id] # Optional: stages that must complete first

    # Conditional execution
    condition: "{{ stages.prev.passed }}"  # Optional: expression that must be true

    # For custom type
    command: "shell command"     # Shell command to execute

    # For prd/plan/build types
    input:
      request: "{{ user_request }}"
      context: "{{ learnings }}"
    config:
      iterations: 10
      parallel: 3
      use_worktree: true

    # Retry configuration
    retry:
      max_attempts: 3
      delay: 1000

    # Verification gates (critical!)
    verify:
      - type: test_suite
        id: my_tests
        command: "npm test"
        min_passing: 10
        max_failing: 0

    # Loop back to earlier stage
    loop_to: earlier_stage_id
    max_loops: 3
```

---

## Verification Gates

### Philosophy: Trust Artifacts, Not Text

**Problem**: Agents can claim success by outputting text like "All tests pass!" while actually failing.

**Solution**: Verification gates check actual artifacts - git commits, test results, file changes - not text output.

```
┌─────────────────────────────────────────────────────────────┐
│  Agent outputs: "SUCCESS! All 21 tests pass!"              │
│  Agent exit code: 0                                         │
├─────────────────────────────────────────────────────────────┤
│  Verification runs actual tests: 8 failed, 13 passed       │
│  Verification result: FAILED                                │
└─────────────────────────────────────────────────────────────┘
```

### Verifier Types

| Type | Purpose | Key Parameters |
|------|---------|----------------|
| `file_exists` | Check files were created | `files: [paths]` |
| `file_changed` | Check files were modified | `files: [paths]`, `since: git_ref` |
| `file_contains` | Check file content | `file`, `pattern` (regex) |
| `git_commits` | Check commits were made | `min_commits`, `since`, `pattern` |
| `git_diff` | Check actual changes | `files`, `min_lines` |
| `git_files_changed` | Check specific files changed | `files`, `min_files` |
| `test_suite` | Run tests and verify results | `command`, `min_passing`, `max_failing` |
| `test_coverage` | Check code coverage | `command`, `min_coverage` |
| `build_success` | Verify build completes | `command` |
| `lint_pass` | Verify linting passes | `command`, `max_errors` |
| `custom` | Custom verification | `command`, `success_pattern` |

### Test Suite Verification

The most powerful verification type - actually runs your test suite:

```yaml
verify:
  - type: test_suite
    id: jest_tests
    command: "npm test"
    min_passing: 20      # Minimum tests that must pass
    max_failing: 0       # Maximum allowed failures
    timeout: 60000       # Optional: timeout in ms
```

**Supported test frameworks:**
- Jest (`Tests: X passed, Y failed, Z total`)
- Mocha (`X passing, Y failing`)
- TAP (`# tests X, # pass Y, # fail Z`)
- Generic (`X tests`, `Y failures`)

### Example: Mathematical Proof Verification

```yaml
# This cannot be gamed - math must be correct
stages:
  - id: implement_math_lib
    type: custom
    command: |
      # Agent implements math functions
      echo "Implementing math library..."

    verify:
      - type: test_suite
        id: math_tests
        command: "cd math-lib && npm test"
        min_passing: 21    # All 21 tests must pass
        max_failing: 0     # Zero failures allowed
```

**Test suite includes:**
- `isPrime(n)` - primality testing
- `fibonacci(n)` - sequence generation
- `factorial(n)` - large number handling
- `gcd(a, b)` - greatest common divisor
- `lcm(a, b)` - least common multiple
- `median(arr)` - statistical calculation
- `standardDeviation(arr)` - precision math

An agent cannot fake these - the math must actually be correct.

### Git-Based Verification

Trust git history, not claims:

```yaml
verify:
  - type: git_commits
    min_commits: 1
    since: "HEAD~5"
    pattern: "US-\\d+"    # Must reference user story

  - type: git_files_changed
    files:
      - "src/**/*.ts"
      - "tests/**/*.test.ts"
    min_files: 2
```

### Build Verification

Ensure code actually compiles:

```yaml
verify:
  - type: build_success
    command: "npm run build"

  - type: lint_pass
    command: "npm run lint"
    max_errors: 0
    max_warnings: 10
```

---

## Conditional Execution & Branching

### Condition Expressions

```yaml
stages:
  - id: fix_bugs
    type: custom
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.failed }}"  # Only runs if tests failed
    command: "..."

  - id: deploy
    type: custom
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.passed }}"  # Only runs if tests passed
    command: "..."
```

### Available Context Variables

| Variable | Description |
|----------|-------------|
| `{{ stages.STAGE_ID.passed }}` | Boolean: stage passed |
| `{{ stages.STAGE_ID.failed }}` | Boolean: stage failed |
| `{{ stages.STAGE_ID.output }}` | Stage output object |
| `{{ stages.STAGE_ID.exit_code }}` | Exit code |
| `{{ variables.VAR_NAME }}` | Factory variable |
| `{{ learnings }}` | Accumulated learnings |
| `{{ recursion_count }}` | Current loop iteration |

### Branching Example

```yaml
stages:
  - id: analyze_complexity
    type: custom
    command: "node analyze.js"

  # Branch A: Simple path
  - id: simple_build
    depends_on: [analyze_complexity]
    condition: "{{ stages.analyze_complexity.output.complexity <= 5 }}"
    type: build
    config:
      iterations: 5

  # Branch B: Complex path
  - id: complex_build
    depends_on: [analyze_complexity]
    condition: "{{ stages.analyze_complexity.output.complexity > 5 }}"
    type: build
    config:
      iterations: 20
      parallel: 3
```

---

## Recursive Loops

### Loop Configuration

```yaml
stages:
  - id: build_feature
    type: build

  - id: run_tests
    type: custom
    depends_on: [build_feature]
    command: "npm test"

  - id: fix_failures
    type: prd
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.failed && recursion_count < 3 }}"
    input:
      request: "Fix: {{ stages.run_tests.error_summary }}"
    loop_to: build_feature   # Go back to build stage
    max_loops: 3             # Maximum 3 iterations
```

### Loop Flow

```
[build_feature] → [run_tests] → PASSED → [deploy]
                       ↓
                    FAILED
                       ↓
                 [fix_failures]
                       ↓
                 loop_to: build_feature (if recursion_count < 3)
```

---

## Context & Learning

### Context Flow

Each stage's output becomes available to subsequent stages:

```yaml
stages:
  - id: generate_prd
    type: prd
    input:
      request: "{{ user_request }}"

  - id: build
    type: build
    depends_on: [generate_prd]
    input:
      # Access previous stage output
      prd_number: "{{ stages.generate_prd.prd_number }}"
      stories: "{{ stages.generate_prd.stories }}"
```

### Project-Wide Learnings

Learnings accumulate across all factory runs:

```yaml
# Learnings from .ralph/factory/learnings.json
stages:
  - id: generate_prd
    type: prd
    input:
      request: "{{ user_request }}"
      context: "{{ learnings }}"  # Inject accumulated learnings
```

---

## File Structure

```
.ralph/
├── factory/
│   ├── my-factory.yaml          # Factory definition
│   ├── another-factory.yaml     # Another factory
│   ├── variables.yaml           # Shared variables (optional)
│   ├── learnings.json           # Project-wide learnings
│   └── runs/                    # Execution history
│       └── run-TIMESTAMP/
│           ├── state.json       # Execution state
│           ├── context.json     # Accumulated context
│           └── stages/          # Per-stage outputs
│               ├── stage_one/
│               │   └── result.json
│               └── stage_two/
│                   └── result.json
```

---

## Examples

### Example 1: Simple Pipeline

```yaml
version: "1"
name: "simple-pipeline"

stages:
  - id: setup
    type: custom
    command: "npm install"

  - id: test
    type: custom
    depends_on: [setup]
    command: "npm test"
    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 10

  - id: build
    type: custom
    depends_on: [test]
    command: "npm run build"
    verify:
      - type: build_success
        command: "npm run build"
```

### Example 2: PRD → Plan → Build Pipeline

```yaml
version: "1"
name: "feature-pipeline"

variables:
  feature_request: "Add user authentication"

stages:
  - id: generate_prd
    type: prd
    input:
      request: "{{ variables.feature_request }}"

  - id: create_plan
    type: plan
    depends_on: [generate_prd]

  - id: build_feature
    type: build
    depends_on: [create_plan]
    config:
      iterations: 10
    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 5
```

### Example 3: Self-Correcting Pipeline with Verification

```yaml
version: "1"
name: "self-correcting"

variables:
  max_attempts: 3

stages:
  - id: implement
    type: custom
    command: |
      node implement-feature.js

  - id: verify_implementation
    type: custom
    depends_on: [implement]
    command: "npm test"
    verify:
      - type: test_suite
        id: feature_tests
        command: "npm test -- --testPathPattern=feature"
        min_passing: 10
        max_failing: 0

  - id: fix_issues
    type: prd
    depends_on: [verify_implementation]
    condition: "{{ stages.verify_implementation.failed && recursion_count < max_attempts }}"
    input:
      request: "Fix failures: {{ stages.verify_implementation.verification.failures }}"
    loop_to: implement
    max_loops: 3

  - id: deploy
    type: custom
    depends_on: [verify_implementation]
    condition: "{{ stages.verify_implementation.passed }}"
    command: "npm run deploy"
```

### Example 4: Parallel Branches with Merge

```yaml
version: "1"
name: "parallel-builds"

stages:
  - id: setup
    type: custom
    command: "npm install"

  # Parallel branch 1
  - id: build_frontend
    type: custom
    depends_on: [setup]
    command: "npm run build:frontend"

  # Parallel branch 2
  - id: build_backend
    type: custom
    depends_on: [setup]
    command: "npm run build:backend"

  # Merge point - waits for both
  - id: integration_test
    type: custom
    depends_on: [build_frontend, build_backend]
    command: "npm run test:integration"
    verify:
      - type: test_suite
        command: "npm run test:integration"
        min_passing: 20
```

---

## Checkpointing & Resume

### Automatic Checkpoints

Factory automatically saves state after each stage:

```bash
# If factory fails mid-execution
ralph factory run my-factory
# Stage 1: ✓ Completed
# Stage 2: ✓ Completed
# Stage 3: ✗ Failed

# Resume from last checkpoint
ralph factory resume my-factory
# Resuming from stage 3...
```

### Checkpoint Data

```json
// .ralph/factory/runs/run-XXXXX/state.json
{
  "factoryName": "my-factory",
  "status": "running",
  "currentStage": "stage_three",
  "completedStages": ["stage_one", "stage_two"],
  "startedAt": "2026-01-16T10:00:00Z"
}
```

---

## Debugging

### View Execution Details

```bash
# Check run status
ralph factory status my-factory

# View stage result
cat .ralph/factory/runs/run-XXXXX/stages/STAGE_ID/result.json

# View full execution log
cat .ralph/factory/runs/run-XXXXX/execution.log
```

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Stage skipped | Condition evaluated false | Check condition expression |
| Verification failed | Actual results don't match requirements | Check verify configuration |
| Loop infinite | No exit condition | Add `max_loops` or proper condition |
| Stage timeout | Command takes too long | Add `timeout` configuration |

---

## Best Practices

### 1. Always Use Verification Gates

```yaml
# BAD: Trust agent output
- id: implement
  command: "node implement.js"
  # No verification = can be gamed

# GOOD: Verify actual work
- id: implement
  command: "node implement.js"
  verify:
    - type: test_suite
      command: "npm test"
      min_passing: 10
```

### 2. Use Specific Verification

```yaml
# BAD: Just check exit code
verify:
  - type: custom
    command: "npm test"
    # Exit code 0 can be faked

# GOOD: Check actual test counts
verify:
  - type: test_suite
    command: "npm test"
    min_passing: 21
    max_failing: 0
```

### 3. Combine Multiple Verifiers

```yaml
verify:
  - type: test_suite
    command: "npm test"
    min_passing: 20

  - type: build_success
    command: "npm run build"

  - type: lint_pass
    command: "npm run lint"
    max_errors: 0
```

### 4. Set Reasonable Timeouts

```yaml
- id: long_running_stage
  type: custom
  command: "npm run e2e-tests"
  timeout: 300000  # 5 minutes
  verify:
    - type: test_suite
      command: "npm run e2e-tests"
      timeout: 300000
```

### 5. Use Git Verification for Code Changes

```yaml
verify:
  - type: git_commits
    min_commits: 1
    pattern: "^(feat|fix|refactor):"

  - type: git_files_changed
    files: ["src/**/*.ts"]
    min_files: 1
```

---

## API Reference

### Factory Module (`lib/factory/index.js`)

```javascript
const factory = require('./lib/factory');

// Run a factory
const result = await factory.run('my-factory', {
  variables: { key: 'value' }
});

// Resume a factory
const result = await factory.resume('my-factory', 'run-XXXXX');

// Get factory status
const status = await factory.status('my-factory');
```

### Verifier Module (`lib/factory/verifier.js`)

```javascript
const verifier = require('./lib/factory/verifier');

// Run verification
const result = verifier.runVerification(
  { type: 'test_suite', command: 'npm test', min_passing: 10 },
  context,
  projectRoot
);

// Result structure
{
  status: 'passed' | 'failed' | 'skipped',
  error: 'Error message if failed',
  details: { /* verification-specific details */ },
  duration: 1234,
  verifier: 'verifier_id'
}
```

---

## Checklist

Before running a factory:

- [ ] Each stage has a unique `id`
- [ ] Dependencies are correctly specified with `depends_on`
- [ ] Critical stages have `verify` blocks
- [ ] Verification thresholds match actual test counts
- [ ] Conditions use correct template syntax `{{ }}`
- [ ] Loops have `max_loops` to prevent infinite execution
- [ ] Variables are defined before use
- [ ] Custom commands are properly escaped

---

## Related Documentation

- [CLAUDE.md](../../CLAUDE.md) - Main Ralph CLI documentation
- [lib/factory/](../../lib/factory/) - Factory module source code
- [.ralph/factory/](../../.ralph/factory/) - Example factories
