---
name: ralph-parallel
description: Analyze a Ralph task for parallel decomposition. Use when user says "ralph parallel", "parallelize task", "split task", or wants to run multiple independent domains concurrently.
---

# Ralph Parallel - Task Decomposition

Analyze a task and identify independent domains for parallel execution.

**Core principle:** "Dispatch one agent per independent problem domain. Let them work concurrently."

## Usage

```
/ralph-parallel <task-id>
```

Examples: `/ralph-parallel 1` or `/ralph-parallel ralph-1`

## When to Parallelize

**DO parallelize when:**
- 3+ test files failing with different root causes
- Multiple subsystems broken independently
- Non-overlapping code paths (different directories/modules)
- Each problem understandable without context from others
- No shared state between investigations

**DON'T parallelize when:**
- Failures are related (fixing one might fix others)
- Sequential dependency exists (A must complete before B)
- Shared state would cause conflicts
- Less than 3 independent domains identified
- Problems require understanding full system state

## Your Process

### 1. Read the Parent Task

```bash
TASK_ID="ralph-${input}"  # normalize: 1 → ralph-1
```

Read these files:
- `.ralph/${TASK_ID}/plan.md` - The task definition
- `.ralph/${TASK_ID}/progress.md` - What's been tried
- `.ralph/${TASK_ID}/errors.log` - Recent failures

### 2. Identify Independent Domains

**Strategy A: Test Failure Analysis**
If test failures exist:
1. Run the test_command from plan.md
2. Group failures by file/module
3. Check if failures share code paths
4. Each isolated group = one domain

**Strategy B: Criteria Analysis**
Parse success criteria from plan.md:
1. List all criteria
2. Identify which touch different code areas
3. Check for dependencies between criteria
4. Independent criteria = potential domains

**Strategy C: Code Area Analysis**
For complex tasks:
1. Identify major code areas involved
2. Check for import/dependency relationships
3. Non-overlapping areas = potential domains

### 3. Validate Independence

For each potential domain, verify:
- [ ] Can be understood without other domains
- [ ] Changes won't conflict with other domains
- [ ] Has its own testable completion state
- [ ] Doesn't share mutable state with others

### 4. Present Decomposition

Show the user:

```markdown
## Parallel Decomposition Analysis

**Parent task:** ralph-1 - "Add authentication system"
**Domains identified:** 3

### Domain A: Database Schema
- **Focus:** User table, sessions table
- **Files:** src/db/schema.ts, migrations/
- **Test command:** npm test -- db.test.ts
- **Conflict risk:** LOW

### Domain B: API Endpoints
- **Focus:** /login, /logout, /register routes
- **Files:** src/routes/auth.ts, src/middleware/
- **Test command:** npm test -- auth.test.ts
- **Conflict risk:** LOW

### Domain C: UI Components
- **Focus:** Login form, registration form
- **Files:** src/components/auth/
- **Test command:** npm test -- auth-ui.test.ts
- **Conflict risk:** LOW

**Overall assessment:** SUITABLE for parallel execution
**Estimated conflict risk:** LOW
```

If NOT suitable:
```markdown
## Parallel Decomposition Analysis

**Parent task:** ralph-1
**Assessment:** NOT SUITABLE for parallel execution

**Reason:** [specific reason]
- Failures appear related (all stem from auth middleware change)
- Sequential dependency (DB must exist before API can use it)
- High conflict risk (all domains touch shared config)

**Recommendation:** Run sequentially with `ralph.sh go 1`
```

### 5. Create Sub-Tasks (if approved)

For each domain, create:

**Directory:** `.ralph/ralph-{parent-id}-{letter}/`

**plan.md:**
```yaml
---
task: <domain-specific task name>
parent: ralph-{parent-id}
domain: <domain-identifier>
test_command: <domain-specific test>
completion_promise: "<domain-specific success>"
max_iterations: 10
---

# Task: <domain name>

## Context
This is a sub-task of ralph-{parent-id}.
Focus ONLY on: <domain scope>

## Success Criteria
- [ ] <domain-specific criterion 1>
- [ ] <domain-specific criterion 2>
- [ ] Domain tests pass

## Constraints
- Do NOT modify files outside: <file scope>
- Do NOT change: <exclusions>
```

**progress.md:** Initialize empty
**errors.log:** Initialize empty

### 6. Output Result

**If sub-tasks created:**
```
PARALLEL READY

Created sub-tasks:
  ralph-1-a: Database Schema
  ralph-1-b: API Endpoints
  ralph-1-c: UI Components

To execute:
  ralph.sh parallel 1

Or manually:
  ralph.sh go 1-a & ralph.sh go 1-b & ralph.sh go 1-c &
```

**If not suitable:**
```
NOT PARALLELIZABLE

Reason: <explanation>

Recommendation: ralph.sh go 1
```

## Sub-Task Frontmatter Fields

| Field | Required | Description |
|-------|----------|-------------|
| task | Yes | Short name for this domain |
| parent | Yes | Parent task ID (e.g., ralph-1) |
| domain | Yes | Domain identifier (e.g., auth-db) |
| test_command | Yes | Domain-specific test command |
| completion_promise | Yes | What signals this domain is done |
| max_iterations | No | Default: 10 |

## Example Decomposition

**Parent task:** "Fix 6 failing tests across 3 test files"

**Analysis:**
- `abort.test.ts`: 2 failures - abort timing issues
- `batch.test.ts`: 2 failures - batch completion logic
- `race.test.ts`: 2 failures - race condition in approval

**Domains:**
1. **ralph-1-a**: Abort functionality (abort.test.ts)
2. **ralph-1-b**: Batch completion (batch.test.ts)
3. **ralph-1-c**: Race conditions (race.test.ts)

**Result:** 3 independent investigations running concurrently

## Key Philosophy

- **Independence is paramount** - If domains might conflict, don't parallelize
- **Focused scope** - Each sub-task should be narrowly defined
- **Clear boundaries** - Sub-tasks know what files they can/cannot touch
- **Testable completion** - Each domain has its own verification

## Guardrails

All guardrails from `.ralph/guardrails.md` apply to ALL sub-tasks.

Additional constraints for parallel execution:
- Sub-tasks should NOT modify the same files
- Sub-tasks should NOT have sequential dependencies
- When in doubt, recommend sequential execution
