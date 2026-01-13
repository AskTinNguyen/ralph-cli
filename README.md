# Ralph CLI

Autonomous coding loop for Claude Code. Ralph iteratively works on tasks until completion, following a simple checklist-based approach.

## What is Ralph?

Ralph is an AI coding loop that:
1. Reads a task definition with success criteria
2. Works toward completing each criterion
3. Runs tests to verify progress
4. Continues until all criteria are met or help is needed

State lives in files, not databases. Every step is transparent and traceable.

## Installation

```bash
# Install from GitHub
bun add github:AskTinNguyen/ralph-cli

# Install skills to your repo
bunx ralph install
```

This creates:
- `.claude/skills/ralph-go/` - Main execution skill
- `.claude/skills/ralph-new/` - Task creation skill
- `.claude/skills/ralph-plan/` - Interactive planning skill
- `.ralph/guardrails.md` - Safety constraints

## Quick Start

```bash
# 1. Install Ralph to your repo
bunx ralph install

# 2. Start Claude Code
claude

# 3. Create a task interactively
> /ralph-plan

# 4. Or create one directly
> /ralph-new Add user authentication

# 5. Run the task
> /ralph-go 1
```

## Commands

### `ralph install`

Install Ralph skills to the current repository.

```bash
ralph install
# Creates .claude/skills/ralph-*/ and .ralph/guardrails.md
```

### `ralph update`

Update Ralph skills to the latest version.

```bash
# First, update the package
bun update ralph-cli

# Then update the skills
ralph update
# Overwrites .claude/skills/ralph-*/ with latest
# Skips guardrails.md if you've customized it
```

### `ralph new <task>`

Create a new task.

```bash
ralph new "Add dark mode toggle"
# Creates .ralph/ralph-1/plan.md
```

### `ralph list`

List all tasks.

```bash
ralph list
# ralph-1: Add dark mode toggle (0 iterations)
# ralph-2: Fix login bug (3 iterations)
```

### `ralph go <id>`

Run a task headlessly (for scripts/automation).

```bash
ralph go 1
# Runs until COMPLETE or NEEDS_HUMAN
```

## Interactive Usage (Recommended)

For the best experience, use Ralph through Claude Code directly:

```bash
claude
> /ralph-plan          # Interactive task planning
> /ralph-new Fix bug   # Quick task creation
> /ralph-go 1          # Run task with full UI
```

## File Structure

```
your-repo/
├── .claude/
│   └── skills/
│       ├── ralph-go/SKILL.md      # Execution loop
│       ├── ralph-new/SKILL.md     # Task creation
│       └── ralph-plan/SKILL.md    # Planning
└── .ralph/
    ├── guardrails.md              # Safety constraints (shared, READ FIRST)
    └── ralph-1/                   # Task 1
        ├── plan.md                # Task definition
        ├── progress.md            # Iteration history (append-only)
        ├── activity.log           # Detailed action log (append-only)
        └── errors.log             # Test failures (append-only)
```

## Task Definition

`plan.md` uses YAML frontmatter:

```markdown
---
task: Add health endpoint
test_command: bun test
completion_promise: "Health endpoint returns 200 and all tests pass"
max_iterations: 15
---

# Task: Add health endpoint

## Context
We need a health check endpoint for load balancer probes.

## Success Criteria
- [ ] GET /health returns 200 OK
- [ ] Response includes { status: "ok" }
- [ ] All tests pass
```

## Completion Signals

Ralph outputs these markers to control the loop:

```markdown
<!-- Success -->
<promise>COMPLETE: Health endpoint returns 200 and all tests pass</promise>

<!-- Needs help -->
<promise>NEEDS_HUMAN: Cannot find the router configuration</promise>
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | SUCCESS - Task completed |
| 1 | ERROR - Unexpected error |
| 2 | NEEDS_HUMAN - Claude escalated |

## State Files (Critical for Agents)

Ralph uses state files as the memory and harness for continuation. **Agents MUST read these files at the start of each iteration and write to them after each action.**

### guardrails.md (Read Before Every Action)

**Purpose**: Safety constraints that apply to ALL tasks. Violations are unacceptable.

**When to read**: Before starting any work, before every iteration.

**Template**:
```markdown
# Guardrails

## Safety Constraints (NEVER do these)
- Never push directly to main/master branch
- Never delete production data
- Never commit secrets/credentials
- Never skip tests

## Project-Specific Rules
- (Add your project's constraints)
```

### progress.md (Append After Every Iteration)

**Purpose**: Iteration history that enables continuation. Future iterations read this to understand what's been tried.

**When to write**: After EVERY iteration, whether pass or fail.

**Template**:
```markdown
## Iteration N - YYYY-MM-DD HH:MM:SS
- **Attempted**: What you tried to do
- **Result**: PASSED | FAILED
- **Files changed**: List of files modified
- **Criteria met**: Which checkboxes can now be checked
- **Next**: What to try next (if not complete)
```

### errors.log (Append On Failure)

**Purpose**: Record of test failures. Prevents repeating the same mistakes.

**When to write**: When `test_command` fails.

**Template**:
```markdown
## Iteration N - YYYY-MM-DD HH:MM:SS
Command: bun test
Exit code: 1
Output:
  FAIL src/components/Button.test.ts
    ✕ should render correctly
      Expected: true
      Received: false
```

### activity.log (Append Detailed Actions)

**Purpose**: Detailed log of all actions taken. Useful for debugging and auditing.

**When to write**: After significant actions (file edits, commands run, decisions made).

**Template**:
```markdown
## Iteration N - YYYY-MM-DD HH:MM:SS

### Actions Taken
1. Read plan.md - identified next criterion: "Add login button"
2. Searched codebase for existing button components
3. Created src/components/LoginButton.tsx
4. Added tests in src/components/LoginButton.test.ts
5. Ran test_command: bun test
6. Result: PASSED

### Decisions Made
- Used existing Button component as base
- Placed in components/ directory following project convention
```

### Agent Loop Reminder

```
┌─────────────────────────────────────────────────────────┐
│  START OF EVERY ITERATION:                              │
│  1. Read guardrails.md    → Know constraints            │
│  2. Read plan.md          → Know the goal               │
│  3. Read progress.md      → Know what's done            │
│  4. Read errors.log       → Know what failed            │
│                                                         │
│  AFTER EVERY ITERATION:                                 │
│  5. Run test_command      → Verify work                 │
│  6. Append to progress.md → Record what happened        │
│  7. Append to errors.log  → If tests failed             │
│  8. Append to activity.log→ Detailed actions            │
│                                                         │
│  THEN:                                                  │
│  9. Check completion      → All criteria met?           │
│  10. Output signal        → COMPLETE or continue        │
└─────────────────────────────────────────────────────────┘
```

## Philosophy

- **State lives in files** - Human-readable, no database needed
- **Minimal tooling** - ~200 lines of code, no server
- **Transparent execution** - Read any file to understand what's happening
- **Portable** - Works in any repo with Claude Code

## License

MIT
