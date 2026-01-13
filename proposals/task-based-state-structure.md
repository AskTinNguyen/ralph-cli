# Proposal: Task-Based State Structure

**Author:** Claude
**Date:** 2026-01-13
**Status:** Draft
**Related:** `multi-stream-worktrees.md`

---

## Executive Summary

This proposal restructures Ralph's state management from a **single shared folder** to a **task-isolated structure**, where each task (story, feature, or work unit) has its own dedicated folder with complete state isolation.

The goal is to enable:
- **Clear traceability**: Know exactly what, where, why, when, and which task produced any artifact
- **Parallel execution**: Multiple tasks can run without state conflicts
- **Easy debugging**: All context for a task is in one place
- **Historical reference**: Past tasks remain intact for learning

---

## Problem Statement

### Current Ralph Structure

```
.ralph/
├── IMPLEMENTATION_PLAN.md     # Single plan for ALL stories
├── progress.md                # Single progress for ALL iterations
├── guardrails.md              # Shared (OK)
├── errors.log                 # All errors mixed together
├── activity.log               # All activity mixed together
└── runs/                      # All runs from all stories
    ├── run-20260113-091523-12345-iter-1.log
    ├── run-20260113-091523-12345-iter-1.md
    ├── run-20260113-103045-67890-iter-1.log   # Different task?
    ├── run-20260113-103045-67890-iter-1.md    # Same task?
    └── ...                                     # WHO KNOWS?
```

### Problems

| Issue | Impact |
|-------|--------|
| **Untrackable runs** | Can't tell which story/PRD a run belongs to |
| **Mixed progress** | All stories append to same progress.md |
| **No historical context** | After completion, hard to see what happened |
| **Parallel conflicts** | Two stories writing to same files |
| **Debugging nightmare** | Which log goes with which error? |

### ralph-cli Structure (Better)

```
.ralph/
├── guardrails.md              # Shared safety rules
├── ralph-1/                   # Task 1: Complete isolation
│   ├── plan.md                # Task definition + metadata
│   ├── progress.md            # This task's progress only
│   ├── errors.log             # This task's errors only
│   ├── activity.log           # This task's activity only
│   └── logs/                  # This task's iteration logs
│       ├── iteration-1.log
│       ├── iteration-2.log
│       └── iteration-3.log
├── ralph-2/                   # Task 2: Complete isolation
│   ├── plan.md
│   ├── progress.md
│   └── logs/
│       └── ...
└── ralph-3/                   # Task 3: Complete isolation
    └── ...
```

### Benefits

| Aspect | Before | After |
|--------|--------|-------|
| **Traceability** | "Some run from somewhere" | "Iteration 3 of task US-001" |
| **Context** | Scattered across files | All in `.ralph/US-001/` |
| **Parallelism** | Conflicts | Isolated folders |
| **History** | Overwritten | Preserved per task |
| **Debugging** | Search everywhere | Look in one folder |

---

## Proposed Structure

### New Directory Layout

```
.ralph/
├── config.yaml                    # Global Ralph configuration
├── guardrails.md                  # Shared safety rules (cross-task)
├── tasks/                         # All tasks live here
│   ├── US-001/                    # Task folder (by story ID)
│   │   ├── task.yaml              # Task metadata (frontmatter)
│   │   ├── plan.md                # Implementation plan for this task
│   │   ├── progress.md            # Iteration history
│   │   ├── errors.log             # Failures and issues
│   │   ├── activity.log           # Timestamps and events
│   │   ├── status.json            # Machine-readable status
│   │   ├── logs/                  # Per-iteration logs
│   │   │   ├── iter-001.log       # Full agent output
│   │   │   ├── iter-001.md        # Summary metadata
│   │   │   ├── iter-002.log
│   │   │   └── iter-002.md
│   │   └── artifacts/             # Task-specific artifacts
│   │       ├── screenshots/       # Visual verification
│   │       └── reports/           # Generated reports
│   │
│   ├── US-002/                    # Another task
│   │   └── ...
│   │
│   └── US-003/                    # Another task
│       └── ...
│
├── prds/                          # PRD storage
│   ├── prd-main.md                # Main PRD (default)
│   ├── prd-auth-system.md         # Feature-specific PRD
│   └── prd-api-v2.md              # Another PRD
│
└── archive/                       # Completed/archived tasks
    ├── US-001/                    # Moved after merge
    └── ...
```

### Task Metadata File (`task.yaml`)

Each task has structured metadata:

```yaml
# .ralph/tasks/US-001/task.yaml

# Identity
id: US-001
title: "Implement user authentication"
created: "2026-01-13T09:15:23Z"
updated: "2026-01-13T14:32:10Z"

# Source
prd: "../prds/prd-main.md"
story_ref: "### [ ] US-001: Implement user authentication"

# Execution
status: "in_progress"  # pending | in_progress | completed | blocked | archived
agent: "claude"
branch: "ralph/US-001"
max_iterations: 25
current_iteration: 5

# Verification
test_command: "npm test -- --grep 'auth'"
completion_promise: "Authentication flow works end-to-end"
visual_verification: false

# Tracking
started_at: "2026-01-13T10:00:00Z"
completed_at: null
total_duration_seconds: 4532
iterations_run: 5

# Git
base_commit: "abc1234"
head_commit: "def5678"
commits:
  - hash: "abc1235"
    subject: "ralph(US-001): add auth routes"
  - hash: "def5678"
    subject: "ralph(US-001): add JWT validation"

# Dependencies (optional)
depends_on: []
blocks: ["US-003", "US-004"]

# Tags (for filtering/search)
tags: ["auth", "backend", "security"]
```

### Plan File (`plan.md`)

Task-specific implementation plan with frontmatter:

```markdown
---
# Frontmatter mirrors key task.yaml fields for agent consumption
task: US-001
title: Implement user authentication
test_command: npm test -- --grep 'auth'
completion_promise: Authentication flow works end-to-end
visual_verification: false
---

# US-001: Implement user authentication

## Context

This story implements JWT-based authentication for the API. Users should be able
to register, login, and access protected endpoints with valid tokens.

## Success Criteria

- [ ] POST /auth/register creates new user
- [ ] POST /auth/login returns JWT token
- [ ] Protected routes reject invalid tokens
- [ ] Token refresh endpoint works
- [ ] All auth tests pass

## Implementation Tasks

- [ ] Create User model and migration
  - Scope: src/models/user.ts, migrations/
  - Verification: npm run migrate && npm test

- [ ] Add register endpoint
  - Scope: src/routes/auth.ts
  - Verification: curl test or npm test

- [ ] Add login endpoint with JWT
  - Scope: src/routes/auth.ts, src/utils/jwt.ts
  - Verification: npm test -- --grep 'login'

- [ ] Add auth middleware
  - Scope: src/middleware/auth.ts
  - Verification: npm test -- --grep 'protected'

## Notes

- Using jose library for JWT (already in package.json)
- Password hashing with bcrypt
- Token expiry: 1 hour
```

### Progress File (`progress.md`)

Clean iteration history for this task only:

```markdown
# Progress: US-001

## Iteration 5 - 2026-01-13 14:32:10
**Focus**: Add auth middleware for protected routes

### Actions
- Created `src/middleware/auth.ts` with JWT verification
- Added `@authenticated` decorator
- Protected `/api/users/me` endpoint

### Verification
```
npm test -- --grep 'protected'
✓ rejects request without token
✓ rejects request with invalid token
✓ allows request with valid token
3 passing (45ms)
```

### Outcome
- Result: PASSED
- Commit: `def5678` - "ralph(US-001): add auth middleware"
- Criteria completed: 3/5

---

## Iteration 4 - 2026-01-13 13:15:42
**Focus**: Add login endpoint with JWT generation

### Actions
- Implemented `/auth/login` endpoint
- Added JWT generation with jose library
- Added password verification with bcrypt

### Verification
```
npm test -- --grep 'login'
✓ returns 401 for invalid credentials
✓ returns JWT for valid credentials
✓ token contains user ID
3 passing (120ms)
```

### Outcome
- Result: PASSED
- Commit: `abc1236` - "ralph(US-001): add login endpoint"
- Criteria completed: 2/5

---

[... earlier iterations ...]
```

### Status File (`status.json`)

Machine-readable status for dashboards and tooling:

```json
{
  "id": "US-001",
  "title": "Implement user authentication",
  "status": "in_progress",
  "progress": {
    "criteria_total": 5,
    "criteria_completed": 3,
    "percentage": 60
  },
  "iterations": {
    "current": 5,
    "max": 25,
    "successful": 4,
    "failed": 1
  },
  "timing": {
    "started_at": "2026-01-13T10:00:00Z",
    "last_activity": "2026-01-13T14:32:10Z",
    "total_seconds": 4532,
    "avg_iteration_seconds": 906
  },
  "git": {
    "branch": "ralph/US-001",
    "commits": 4,
    "base_commit": "abc1234",
    "head_commit": "def5678"
  },
  "last_result": "PASSED",
  "next_action": "Add token refresh endpoint"
}
```

---

## State Diagram: Task Lifecycle

```
                              ┌─────────────┐
                              │   PENDING   │
                              │             │
                              │ task.yaml   │
                              │ created     │
                              └──────┬──────┘
                                     │
                              ralph build US-001
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────────┐
│                         IN_PROGRESS                                 │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐     │
│  │  Read    │───▶│ Execute  │───▶│  Write   │───▶│  Check   │──┐  │
│  │ task.yaml│    │  Agent   │    │ progress │    │ criteria │  │  │
│  │ plan.md  │    │          │    │ status   │    │          │  │  │
│  │ progress │    │          │    │ logs/    │    │          │  │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────┘  │  │
│       ▲                                                         │  │
│       └─────────────────────────────────────────────────────────┘  │
│                    (more criteria to complete)                      │
│                                                                     │
└───────────────────────────────┬────────────────────────────────────┘
                                │
               ┌────────────────┼────────────────┐
               │                │                │
        (all criteria)    (blocked)        (max iterations)
               │                │                │
               ▼                ▼                ▼
        ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
        │  COMPLETED  │  │   BLOCKED   │  │   FAILED    │
        │             │  │             │  │             │
        │ status.json │  │ NEEDS_HUMAN │  │ needs review│
        │ updated     │  │ signal      │  │             │
        └──────┬──────┘  └─────────────┘  └─────────────┘
               │
        ralph merge US-001
               │
               ▼
        ┌─────────────┐
        │   MERGED    │
        └──────┬──────┘
               │
        ralph archive US-001
               │
               ▼
        ┌─────────────┐
        │  ARCHIVED   │
        │             │
        │ moved to    │
        │ archive/    │
        └─────────────┘
```

---

## Implementation Changes

### 1. New Loop Variables

**File:** `loop.sh` (modified)

```bash
# Current: Single paths
# PLAN_PATH=".ralph/IMPLEMENTATION_PLAN.md"
# PROGRESS_PATH=".ralph/progress.md"
# RUNS_DIR=".ralph/runs"

# New: Task-scoped paths
TASK_ID="${TASK_ID:-}"  # Set by CLI or story selection
TASK_DIR=".ralph/tasks/${TASK_ID}"
TASK_YAML="${TASK_DIR}/task.yaml"
TASK_PLAN="${TASK_DIR}/plan.md"
TASK_PROGRESS="${TASK_DIR}/progress.md"
TASK_ERRORS="${TASK_DIR}/errors.log"
TASK_ACTIVITY="${TASK_DIR}/activity.log"
TASK_STATUS="${TASK_DIR}/status.json"
TASK_LOGS="${TASK_DIR}/logs"
```

### 2. Task Initialization

**New function:** `init_task()`

```bash
init_task() {
  local task_id="$1"
  local prd_path="$2"
  local story_block="$3"

  local task_dir=".ralph/tasks/${task_id}"

  # Create task directory structure
  mkdir -p "${task_dir}/logs"
  mkdir -p "${task_dir}/artifacts/screenshots"

  # Create task.yaml
  cat > "${task_dir}/task.yaml" <<EOF
id: ${task_id}
title: "$(extract_story_title "$story_block")"
created: "$(date -Iseconds)"
updated: "$(date -Iseconds)"
prd: "${prd_path}"
status: pending
agent: "${AGENT_NAME:-codex}"
branch: "ralph/${task_id}"
max_iterations: ${MAX_ITERATIONS}
current_iteration: 0
test_command: "${TEST_COMMAND:-}"
completion_promise: "${COMPLETION_PROMISE:-All acceptance criteria pass}"
started_at: null
completed_at: null
iterations_run: 0
commits: []
tags: []
EOF

  # Create plan.md from story block
  cat > "${task_dir}/plan.md" <<EOF
---
task: ${task_id}
title: $(extract_story_title "$story_block")
test_command: ${TEST_COMMAND:-npm test}
completion_promise: All acceptance criteria pass
visual_verification: false
---

${story_block}

## Implementation Tasks

(To be filled by planning iteration)
EOF

  # Create empty state files
  cat > "${task_dir}/progress.md" <<EOF
# Progress: ${task_id}

EOF

  touch "${task_dir}/errors.log"
  touch "${task_dir}/activity.log"

  # Create initial status.json
  cat > "${task_dir}/status.json" <<EOF
{
  "id": "${task_id}",
  "status": "pending",
  "progress": {"criteria_total": 0, "criteria_completed": 0, "percentage": 0},
  "iterations": {"current": 0, "max": ${MAX_ITERATIONS}, "successful": 0, "failed": 0},
  "timing": {"started_at": null, "last_activity": null, "total_seconds": 0},
  "git": {"branch": "ralph/${task_id}", "commits": 0},
  "last_result": null
}
EOF

  echo "Initialized task: ${task_id}"
  echo "  Directory: ${task_dir}"
}
```

### 3. Iteration Logging

**Modified:** `write_run_meta()` → `write_iteration_log()`

```bash
write_iteration_log() {
  local task_id="$1"
  local iteration="$2"
  local status="$3"
  local duration="$4"
  local log_content="$5"

  local task_dir=".ralph/tasks/${task_id}"
  local iter_num=$(printf "%03d" "$iteration")

  # Write raw log
  echo "$log_content" > "${task_dir}/logs/iter-${iter_num}.log"

  # Write summary
  cat > "${task_dir}/logs/iter-${iter_num}.md" <<EOF
# Iteration ${iteration} Summary

- Task: ${task_id}
- Started: ${ITER_START_FMT}
- Ended: ${ITER_END_FMT}
- Duration: ${duration}s
- Status: ${status}

## Git Changes
- Commits: ${COMMIT_COUNT:-0}
- Files changed: ${FILES_CHANGED:-0}

## Output Preview
\`\`\`
$(head -50 "${task_dir}/logs/iter-${iter_num}.log")
\`\`\`
EOF

  # Update status.json
  update_task_status "$task_id" "$iteration" "$status" "$duration"
}
```

### 4. Task Status Updates

**New function:** `update_task_status()`

```bash
update_task_status() {
  local task_id="$1"
  local iteration="$2"
  local result="$3"
  local duration="$4"

  local status_file=".ralph/tasks/${task_id}/status.json"

  python3 - "$status_file" "$iteration" "$result" "$duration" <<'PY'
import json
import sys
from pathlib import Path
from datetime import datetime

status_file = Path(sys.argv[1])
iteration = int(sys.argv[2])
result = sys.argv[3]
duration = int(sys.argv[4])

status = json.loads(status_file.read_text())

# Update iterations
status["iterations"]["current"] = iteration
if result in ["PASSED", "success"]:
    status["iterations"]["successful"] += 1
else:
    status["iterations"]["failed"] += 1

# Update timing
status["timing"]["last_activity"] = datetime.now().isoformat()
status["timing"]["total_seconds"] += duration

# Update result
status["last_result"] = result

# Update overall status
if result == "COMPLETE":
    status["status"] = "completed"
    status["timing"]["completed_at"] = datetime.now().isoformat()
elif result == "NEEDS_HUMAN":
    status["status"] = "blocked"
elif status["iterations"]["current"] >= status["iterations"]["max"]:
    status["status"] = "failed"
else:
    status["status"] = "in_progress"

status_file.write_text(json.dumps(status, indent=2))
PY
}
```

### 5. CLI Changes

**New commands:**

```bash
# Task management
ralph task list                    # List all tasks with status
ralph task show US-001             # Show task details
ralph task init US-001             # Initialize task from PRD story
ralph task archive US-001          # Move to archive

# Run specific task
ralph build --task US-001          # Run iterations for specific task
ralph build --task US-001 --iter 5 # Run exactly 5 iterations

# Dashboard
ralph status                       # Show all tasks status
ralph status --json                # Machine-readable output

# Legacy (still works)
ralph build                        # Auto-selects next task from PRD
```

### 6. Task Selection

**Modified:** `select_story()` → `select_or_create_task()`

```bash
select_or_create_task() {
  local prd_path="$1"

  # Parse PRD for unchecked stories
  local next_story=$(parse_next_story "$prd_path")

  if [ -z "$next_story" ]; then
    echo "NO_TASKS"
    return
  fi

  local story_id=$(echo "$next_story" | jq -r '.id')
  local task_dir=".ralph/tasks/${story_id}"

  # Check if task already exists
  if [ -d "$task_dir" ]; then
    # Resume existing task
    echo "$story_id"
    return
  fi

  # Initialize new task
  local story_block=$(echo "$next_story" | jq -r '.block')
  init_task "$story_id" "$prd_path" "$story_block"

  echo "$story_id"
}
```

---

## Migration Path

### From Current Structure

```bash
# Automated migration script
ralph migrate-state

# What it does:
# 1. Creates .ralph/tasks/ directory
# 2. Parses existing PRD for story IDs
# 3. Creates task folder per story
# 4. Moves relevant runs to task folders
# 5. Splits progress.md entries by story
# 6. Preserves .ralph/guardrails.md as shared
```

### Manual Migration

```bash
# 1. Backup current state
cp -r .ralph .ralph.backup

# 2. Create new structure
mkdir -p .ralph/tasks
mkdir -p .ralph/prds
mkdir -p .ralph/archive

# 3. Move PRD
mv .agents/tasks/prd.md .ralph/prds/prd-main.md

# 4. For each story in PRD:
for story_id in US-001 US-002 US-003; do
  mkdir -p .ralph/tasks/${story_id}/logs
  # Extract story-specific content from old files
  # Create task.yaml, plan.md, progress.md
done

# 5. Remove old shared files
rm .ralph/IMPLEMENTATION_PLAN.md
rm .ralph/progress.md
rm -rf .ralph/runs
```

---

## Integration with Multi-Stream

When combined with the multi-stream proposal:

```
.ralph/
├── config.yaml                    # Global config
├── streams.yaml                   # Stream definitions
├── guardrails.md                  # Shared rules
│
├── tasks/                         # All tasks (main worktree)
│   ├── US-001/
│   └── US-002/
│
├── worktrees/                     # Stream worktrees
│   ├── auth/                      # Stream: auth
│   │   ├── .ralph/
│   │   │   └── tasks/             # Stream-local tasks
│   │   │       ├── US-001/        # Task isolation
│   │   │       └── US-002/
│   │   └── src/
│   │
│   └── api/                       # Stream: api
│       ├── .ralph/
│       │   └── tasks/
│       │       ├── US-003/
│       │       └── US-004/
│       └── src/
│
├── prds/
│   └── prd-main.md
│
└── archive/
```

Each stream has its own `.ralph/tasks/` folder, providing complete isolation.

---

## Dashboard Views

### Task List

```
ralph task list

┌──────────────────────────────────────────────────────────────────────────┐
│                           Ralph Tasks                                     │
├──────────┬─────────────────────────────────┬──────────┬─────────┬────────┤
│ ID       │ Title                           │ Status   │ Progress│ Iters  │
├──────────┼─────────────────────────────────┼──────────┼─────────┼────────┤
│ US-001   │ Implement user authentication   │ ● active │ 3/5     │ 5/25   │
│ US-002   │ Add API rate limiting           │ ○ pending│ 0/3     │ 0/25   │
│ US-003   │ Create admin dashboard          │ ○ pending│ 0/4     │ 0/25   │
│ US-004   │ Fix login redirect bug          │ ✓ done   │ 2/2     │ 3/25   │
└──────────┴─────────────────────────────────┴──────────┴─────────┴────────┘

Active: US-001 (60% complete, 5 iterations)
```

### Task Detail

```
ralph task show US-001

╔══════════════════════════════════════════════════════════════════════════╗
║  Task: US-001 - Implement user authentication                            ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                          ║
║  Status:     ● IN_PROGRESS                                               ║
║  Branch:     ralph/US-001                                                ║
║  Started:    2026-01-13 10:00:00                                         ║
║  Duration:   1h 15m 32s                                                  ║
║                                                                          ║
║  Progress:   ████████████░░░░░░░░ 60% (3/5 criteria)                     ║
║  Iterations: █████░░░░░░░░░░░░░░░ 5/25                                   ║
║                                                                          ║
║  Criteria:                                                               ║
║    [x] POST /auth/register creates new user                              ║
║    [x] POST /auth/login returns JWT token                                ║
║    [x] Protected routes reject invalid tokens                            ║
║    [ ] Token refresh endpoint works                                      ║
║    [ ] All auth tests pass                                               ║
║                                                                          ║
║  Recent Activity:                                                        ║
║    iter-005  14:32:10  PASSED  Added auth middleware                     ║
║    iter-004  13:15:42  PASSED  Added login endpoint                      ║
║    iter-003  12:00:15  PASSED  Added register endpoint                   ║
║    iter-002  11:30:00  FAILED  Missing bcrypt import                     ║
║    iter-001  10:00:00  PASSED  Created User model                        ║
║                                                                          ║
║  Commits: 4                                                              ║
║    def5678  ralph(US-001): add auth middleware                           ║
║    abc1236  ralph(US-001): add login endpoint                            ║
║    abc1235  ralph(US-001): add register endpoint                         ║
║    abc1234  ralph(US-001): add User model                                ║
║                                                                          ║
╚══════════════════════════════════════════════════════════════════════════╝

Files:
  .ralph/tasks/US-001/
  ├── task.yaml
  ├── plan.md
  ├── progress.md     (5 entries)
  ├── errors.log      (1 error)
  ├── activity.log    (10 events)
  ├── status.json
  └── logs/
      ├── iter-001.log
      ├── iter-002.log
      ├── iter-003.log
      ├── iter-004.log
      └── iter-005.log
```

---

## Benefits Summary

| Aspect | Before (Shared) | After (Task-Isolated) |
|--------|-----------------|----------------------|
| **Find task's logs** | Search `runs/` by timestamp | Look in `tasks/US-001/logs/` |
| **See task progress** | Grep `progress.md` | Read `tasks/US-001/progress.md` |
| **Know task status** | Parse PRD + guess | Read `tasks/US-001/status.json` |
| **Run parallel tasks** | Conflicts | Each task isolated |
| **Debug failures** | Cross-reference files | All in one folder |
| **Archive completed** | Delete entries? | Move folder to `archive/` |
| **Report on task** | Manual aggregation | Export task folder |

---

## Implementation Priority

1. **Phase 1: Core Structure**
   - Task folder creation
   - task.yaml schema
   - plan.md with frontmatter
   - Iteration logging to task folder

2. **Phase 2: CLI**
   - `ralph task` subcommand
   - `ralph status` dashboard
   - Migration script

3. **Phase 3: Integration**
   - Multi-stream compatibility
   - Archive management
   - Historical analysis tools

---

## Appendix: File Reference

### task.yaml Schema

```yaml
# Required fields
id: string              # Story/task identifier (e.g., US-001)
title: string           # Human-readable title
status: enum            # pending | in_progress | completed | blocked | archived
created: datetime       # ISO 8601 timestamp

# Source reference
prd: string             # Path to source PRD
story_ref: string       # Story heading line from PRD

# Execution settings
agent: string           # Agent to use (codex, claude, droid)
max_iterations: int     # Maximum iterations allowed
test_command: string    # Verification command
completion_promise: string  # What signals done

# Runtime state
current_iteration: int  # Current iteration number
started_at: datetime    # When execution started
completed_at: datetime  # When completed (null if not)
iterations_run: int     # Total iterations executed

# Git tracking
branch: string          # Feature branch name
base_commit: string     # Starting commit hash
head_commit: string     # Current commit hash
commits: list           # List of {hash, subject}

# Optional
depends_on: list        # Dependent task IDs
blocks: list            # Tasks this blocks
tags: list              # Categorization tags
visual_verification: bool  # Capture screenshots
```

### status.json Schema

```json
{
  "id": "string",
  "title": "string",
  "status": "pending|in_progress|completed|blocked|archived",
  "progress": {
    "criteria_total": "int",
    "criteria_completed": "int",
    "percentage": "int"
  },
  "iterations": {
    "current": "int",
    "max": "int",
    "successful": "int",
    "failed": "int"
  },
  "timing": {
    "started_at": "datetime|null",
    "completed_at": "datetime|null",
    "last_activity": "datetime|null",
    "total_seconds": "int",
    "avg_iteration_seconds": "int"
  },
  "git": {
    "branch": "string",
    "base_commit": "string",
    "head_commit": "string",
    "commits": "int"
  },
  "last_result": "string|null",
  "next_action": "string|null"
}
```
