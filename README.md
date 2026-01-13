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
    ├── guardrails.md              # Safety constraints (shared)
    └── ralph-1/                   # Task 1
        ├── plan.md                # Task definition
        ├── progress.md            # Iteration history
        └── errors.log             # Test failures
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

## Philosophy

- **State lives in files** - Human-readable, no database needed
- **Minimal tooling** - ~200 lines of code, no server
- **Transparent execution** - Read any file to understand what's happening
- **Portable** - Works in any repo with Claude Code

## License

MIT
