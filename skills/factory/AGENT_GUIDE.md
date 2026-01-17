# Factory Mode - Agent Guide

**Quick Reference for AI Agents**

This guide teaches you how to use Ralph CLI's Factory Mode for complex, multi-stage workflows with verification gates.

---

## What is Factory Mode?

Factory Mode is a **meta-orchestration layer** that lets you chain multiple Ralph commands (PRD → Plan → Build) into declarative pipelines with:

- ✅ **Tamper-resistant verification** - Can't fake success by claiming "tests pass!"
- ✅ **Conditional branching** - Different paths based on results
- ✅ **Self-correcting loops** - Retry failed stages with context
- ✅ **Parallel execution** - Run independent stages concurrently

**Key principle**: Verification gates check actual artifacts (git commits, test results, files) - not agent output text.

---

## When to Use Factory Mode

### ✅ Use Factory Mode When:

1. **Multi-stage workflows** - PRD → Plan → Build → Test → Deploy chains
2. **Quality gates required** - Must verify tests pass, builds succeed, commits exist
3. **Branching logic needed** - Different paths based on complexity, test results, etc.
4. **Self-correction needed** - Auto-retry failed builds with accumulated context
5. **Parallel execution** - Build frontend + backend simultaneously
6. **Recursive workflows** - Keep trying until tests pass (with max attempts)

### ❌ Don't Use Factory Mode For:

1. **Simple single PRD** - Just use `ralph prd`, `ralph plan`, `ralph build`
2. **Manual workflows** - User wants control over each step
3. **Exploratory work** - Requirements unclear, need human input
4. **One-off tasks** - No need for verification or loops

---

## Quick Start - Decision Tree

```
User request received
│
├─ "Build X feature" (single feature)
│  └─ Don't use factory - use: ralph prd → ralph plan → ralph build
│
├─ "Build and test X, auto-fix failures"
│  └─ USE FACTORY - needs verification + self-correction loop
│
├─ "Build full app with frontend + backend"
│  └─ USE FACTORY - needs parallel builds + integration tests
│
└─ "Create pipeline for X with quality gates"
   └─ USE FACTORY - needs verification stages
```

---

## Core Commands

```bash
# Create new factory from scratch
ralph factory init my-factory

# Run factory pipeline
ralph factory run my-factory

# Check execution status
ralph factory status my-factory

# Resume from checkpoint (after failure)
ralph factory resume my-factory

# List all factories
ralph factory list

# Stop running factory
ralph factory stop my-factory

# Visualize dependency graph
ralph factory graph my-factory
```

---

## Factory File Structure

```yaml
# .ralph/factory/my-factory.yaml
version: "1"
name: "my-factory"

# Optional variables (accessible in all stages)
variables:
  max_iterations: 10
  test_command: "npm test"

# Pipeline stages (executed in dependency order)
stages:
  - id: stage_one          # Unique identifier
    type: custom           # Stage type (prd|plan|build|custom|factory)
    command: "..."         # Shell command (for custom type)
    depends_on: []         # Stage IDs that must complete first
    condition: "..."       # Optional: only run if expression is true
    verify: []             # Verification gates (critical!)
    retry:
      max_attempts: 3
      delay: 1000
```

---

## Stage Types Reference

| Type | Purpose | Required Fields | Example Use |
|------|---------|----------------|-------------|
| `prd` | Generate PRD | `input.request` | Create requirements document |
| `plan` | Create plan from PRD | `depends_on` (prd stage) | Break PRD into stories |
| `build` | Execute stories | `config.iterations` | Implement features |
| `custom` | Run shell command | `command` | Run tests, deploy, custom scripts |
| `factory` | Nested factory | `factory_name` | Recursive factory workflows |

---

## Verification Gates - THE CRITICAL PART

### Why Verification Matters

**Problem**: Agents can claim success without doing work:
```
Agent output: "✓ All 21 tests pass!"
Agent exit code: 0
```

**Solution**: Verification gates check actual artifacts:
```
Verifier runs: npm test
Actual result: 8 failed, 13 passed
Verification: FAILED ❌
```

### Verifier Types

| Type | Checks | Use When |
|------|--------|----------|
| `test_suite` | **Runs tests**, counts pass/fail | Validating implementation |
| `build_success` | **Runs build**, checks exit code | Ensuring code compiles |
| `git_commits` | **Checks git log** for commits | Ensuring work committed |
| `git_files_changed` | **Checks git diff** for file changes | Verifying specific files modified |
| `file_exists` | **Checks filesystem** for files | Ensuring files created |
| `file_contains` | **Reads file**, matches pattern | Validating file content |
| `lint_pass` | **Runs linter**, checks errors/warnings | Code quality |
| `custom` | **Runs command**, matches success pattern | Custom checks |

### Critical Examples

#### ✅ GOOD: Test Suite Verification

```yaml
- id: implement_feature
  type: build
  config:
    iterations: 10
  verify:
    - type: test_suite
      command: "npm test"
      min_passing: 21    # MUST have 21 passing tests
      max_failing: 0     # ZERO failures allowed
```

**Why this works**: Factory actually runs `npm test` and parses Jest/Mocha output. Agent cannot fake this.

#### ❌ BAD: No Verification

```yaml
- id: implement_feature
  type: build
  config:
    iterations: 10
  # NO VERIFY BLOCK - agent can claim success without testing
```

#### ✅ GOOD: Multi-Gate Verification

```yaml
verify:
  - type: test_suite        # Tests must pass
    command: "npm test"
    min_passing: 20

  - type: build_success     # Code must compile
    command: "npm run build"

  - type: git_commits       # Work must be committed
    min_commits: 1
    pattern: "^(feat|fix):"

  - type: lint_pass         # Code must be clean
    command: "npm run lint"
    max_errors: 0
```

---

## Conditional Execution & Branching

### Available Context Variables

| Variable | Type | Description |
|----------|------|-------------|
| `{{ stages.STAGE_ID.passed }}` | Boolean | Stage completed successfully |
| `{{ stages.STAGE_ID.failed }}` | Boolean | Stage failed |
| `{{ stages.STAGE_ID.output }}` | Object | Stage output data |
| `{{ stages.STAGE_ID.exit_code }}` | Number | Exit code |
| `{{ variables.VAR_NAME }}` | Any | Factory variable |
| `{{ learnings }}` | String | Accumulated learnings |
| `{{ recursion_count }}` | Number | Current loop iteration |

### Example: Conditional Branching

```yaml
stages:
  - id: run_tests
    type: custom
    command: "npm test"

  # Only runs if tests FAILED
  - id: fix_failures
    type: prd
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.failed }}"
    input:
      request: "Fix test failures: {{ stages.run_tests.error_summary }}"

  # Only runs if tests PASSED
  - id: deploy
    type: custom
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.passed }}"
    command: "npm run deploy"
```

---

## Recursive Loops (Self-Correction)

### Pattern: Test → Fix → Retry

```yaml
stages:
  - id: implement
    type: build
    config:
      iterations: 10

  - id: verify_tests
    type: custom
    depends_on: [implement]
    command: "npm test"
    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 20
        max_failing: 0

  # Loop back if tests fail (max 3 attempts)
  - id: fix_failures
    type: prd
    depends_on: [verify_tests]
    condition: "{{ stages.verify_tests.failed && recursion_count < 3 }}"
    input:
      request: "Fix: {{ stages.verify_tests.verification.failures }}"
    loop_to: implement       # Go back to implement stage
    max_loops: 3             # Safety limit
```

**Flow**:
```
implement → verify_tests → PASSED → done ✓
                    ↓
                 FAILED
                    ↓
              fix_failures (recursion_count = 1)
                    ↓
         loop_to: implement
                    ↓
         implement → verify_tests → PASSED → done ✓
```

**Safety**: `max_loops` prevents infinite loops. Always set this!

---

## Common Patterns

### Pattern 1: Simple PRD → Plan → Build Pipeline

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

### Pattern 2: Parallel Execution with Merge

```yaml
stages:
  - id: setup
    type: custom
    command: "npm install"

  # These run in PARALLEL (both depend only on setup)
  - id: build_frontend
    type: build
    depends_on: [setup]
    config:
      iterations: 8

  - id: build_backend
    type: build
    depends_on: [setup]
    config:
      iterations: 8

  # Merge point - waits for BOTH to complete
  - id: integration_test
    type: custom
    depends_on: [build_frontend, build_backend]
    command: "npm run test:integration"
```

### Pattern 3: Self-Correcting Pipeline

```yaml
stages:
  - id: implement
    type: build
    config:
      iterations: 10

  - id: run_tests
    type: custom
    depends_on: [implement]
    command: "npm test"
    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 20
        max_failing: 0

  - id: fix_issues
    type: prd
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.failed && recursion_count < 3 }}"
    input:
      request: "Fix failures: {{ stages.run_tests.verification.failures }}"
    loop_to: implement
    max_loops: 3

  - id: deploy
    type: custom
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.passed }}"
    command: "npm run deploy"
```

---

## Agent Workflow - Step by Step

### When User Requests Factory Workflow:

1. **Understand requirements**
   - What stages are needed?
   - What verification is required?
   - Any branching/looping needed?

2. **Create factory YAML**
   ```bash
   ralph factory init my-factory
   ```
   - Edit `.ralph/factory/my-factory.yaml`
   - Define stages with proper dependencies
   - **ADD VERIFICATION GATES** (critical!)
   - Set up conditions for branching
   - Configure loops with `max_loops`

3. **Run factory**
   ```bash
   ralph factory run my-factory
   ```

4. **Monitor progress**
   ```bash
   ralph factory status my-factory
   ```

5. **Handle failures**
   - Check logs: `.ralph/factory/runs/run-TIMESTAMP/execution.log`
   - Check stage results: `.ralph/factory/runs/run-TIMESTAMP/stages/STAGE_ID/result.json`
   - Resume if needed: `ralph factory resume my-factory`

6. **Report results**
   - Show which stages completed
   - Report verification results
   - Show final artifacts (files created, tests passed, commits made)

---

## Critical Rules for Agents

### ✅ DO:

1. **Always add verification gates** to critical stages
2. **Use specific verifiers** (test_suite, not just custom)
3. **Set max_loops** on recursive stages
4. **Use depends_on** to enforce ordering
5. **Check actual artifacts** (git commits, files, test results)
6. **Set reasonable timeouts** for long-running stages
7. **Use variables** for configuration values

### ❌ DON'T:

1. **Trust agent output text** - always verify with gates
2. **Skip verification** on build/test stages
3. **Create infinite loops** - always set max_loops
4. **Use exit code alone** - use test_suite verifier
5. **Forget dependencies** - stages run in parallel without depends_on
6. **Hardcode values** - use variables for flexibility
7. **Ignore verification failures** - they mean real problems

---

## Debugging Tips

### Check Execution Status

```bash
# Current status
ralph factory status my-factory

# View full log
cat .ralph/factory/runs/run-TIMESTAMP/execution.log

# Check specific stage result
cat .ralph/factory/runs/run-TIMESTAMP/stages/stage_id/result.json
```

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| Stage skipped | Condition evaluated to false | Check condition expression syntax |
| Verification failed | Actual results don't match requirements | Check verify config, run command manually |
| Infinite loop | No exit condition | Add max_loops or proper condition |
| Stage never runs | Missing dependency | Check depends_on chain |
| Wrong execution order | Missing depends_on | Add proper dependencies |

---

## Examples from Codebase

### Example 1: Math Challenge (Verification Demo)

File: `.ralph/factory/math-challenge.yaml`

**Purpose**: Demonstrates that agents cannot fake test results.

```yaml
stages:
  - id: implement_math_lib
    type: custom
    command: |
      # Agent claims success but uses buggy code
      echo "✓ All tests pass! 21 tests, 0 failures!"
      exit 0

    # Verification ACTUALLY RUNS TESTS
    verify:
      - type: test_suite
        command: "npm test"
        min_passing: 21    # All math tests must pass
        max_failing: 0
```

**Result**: Stage fails because verification actually runs `npm test` and finds failures.

### Example 2: Wedding Planner (Full Pipeline)

File: `.ralph/factory/wedding-planner-simple.yaml`

**Purpose**: Build a complete feature with PRD → Plan → Build → Test flow.

```yaml
stages:
  - id: setup_directory
    type: custom
    command: "mkdir -p project && ..."
    verify:
      - type: file_exists
        files: ["project/package.json"]

  - id: generate_guest_prd
    type: prd
    depends_on: [setup_directory]
    input:
      request: "Create guest management module with CRUD..."

  - id: plan_guest_module
    type: plan
    depends_on: [generate_guest_prd]

  - id: build_guest_module
    type: build
    depends_on: [plan_guest_module]
    config:
      iterations: 10
    verify:
      - type: file_exists
        files: ["project/src/guests.js"]

  - id: run_tests
    type: custom
    depends_on: [build_guest_module]
    command: "cd project && npm test"
    verify:
      - type: test_suite
        command: "cd project && npm test"
        min_passing: 1
```

### Example 3: Wedding Planner Website (Complex Multi-Stage)

File: `.ralph/factory/wedding-planner-website.yaml`

**Purpose**: Full-stack app with parallel builds, integration tests, and self-correction.

**Key features**:
- 20 stages total
- Parallel frontend + backend builds
- Integration tests with verification
- Self-correcting loop on test failures
- Conditional deployment (only if tests pass)
- Documentation generation stage

**Structure**:
```
Setup → Database → Backend ↘
                            → Integration Tests → Fix Loop / Deploy
Setup → Database → Frontend ↗
```

---

## Response Templates

### When Creating Factory

```
I'll create a factory pipeline for [task]. This requires:

1. **Stages**:
   - [Stage 1]: [Purpose]
   - [Stage 2]: [Purpose]
   - ...

2. **Verification**:
   - [What will be verified]

3. **Branching/Loops** (if applicable):
   - [Conditions and flow]

Creating factory configuration...
```

### After Factory Completes

```
Factory "[name]" completed successfully!

**Results**:
- ✅ Stage 1 ([id]): [Result]
- ✅ Stage 2 ([id]): [Result]
- ...

**Verification Results**:
- ✅ Tests: [X] passed, 0 failed
- ✅ Build: Success
- ✅ Commits: [X] commits created

**Artifacts**:
- Files created: [list]
- PRDs generated: [list]
- Test results: [summary]
```

### When Factory Fails

```
Factory "[name]" failed at stage [stage_id].

**Error**: [Error message]

**Verification Failed**:
- Expected: [requirements]
- Actual: [results]

**Logs**: `.ralph/factory/runs/run-TIMESTAMP/execution.log`

**Next steps**:
1. Review stage output in logs
2. Fix the issue
3. Resume: `ralph factory resume [name]`
```

---

## Checklist Before Running Factory

- [ ] Each stage has unique `id`
- [ ] Dependencies specified with `depends_on`
- [ ] **Critical stages have `verify` blocks**
- [ ] Verification thresholds match actual test counts
- [ ] Conditions use correct syntax: `{{ expression }}`
- [ ] Loops have `max_loops` to prevent infinite execution
- [ ] Variables defined before use
- [ ] Commands properly escaped in YAML
- [ ] Stage types are correct (prd|plan|build|custom|factory)

---

## Related Documentation

- **Main Guide**: `skills/factory/SKILL.md` - Complete reference
- **CLAUDE.md**: Main Ralph CLI documentation
- **Source**: `lib/factory/` - Factory implementation
- **Examples**: `.ralph/factory/*.yaml` - Real factory examples

---

## Summary

**Factory Mode = Declarative Pipelines + Tamper-Proof Verification**

**Key Takeaways**:
1. **Always use verification gates** - Don't trust agent output
2. **Use test_suite verifier** for test validation
3. **Set max_loops** on recursive stages
4. **Use depends_on** for proper ordering
5. **Check git commits, test results, files** - not text output
6. **Follow the examples** in `.ralph/factory/` directory

**Remember**: Verification gates are what make Factory Mode powerful. Without them, agents can claim success without doing work. With them, you have proof-of-work that cannot be faked.
