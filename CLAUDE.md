# Ralph CLI

Autonomous coding loop for Claude Code.

## Core Philosophy

```bash
while :; do cat prompt.md | agent ; done
```

**Same task. New brain each iteration. Memory is filesystem + git, not chat.**

## Quick Reference

Two implementations available - **identical functionality**:

| Implementation | Use When |
|----------------|----------|
| `ralph.sh` (Bash) | C++, Rust, Go, Python, or any non-JS project |
| `ralph` (Bun/TS) | JavaScript/TypeScript projects with Bun |

### Commands (Bash version)

| Use Case | Command |
|----------|---------|
| **Install to repo** | `ralph.sh install` |
| **Interactive task creation** | `claude` then `/ralph-new` or `/ralph-plan` |
| **Interactive execution** | `claude` then `/ralph-go 1` |
| **Headless task creation** | `ralph.sh new "task description"` |
| **Headless execution** | `ralph.sh go 1` |
| **List tasks** | `ralph.sh list` |

### Commands (Bun version)

| Use Case | Command |
|----------|---------|
| **Install to repo** | `ralph install` |
| **Interactive task creation** | `claude` then `/ralph-new` or `/ralph-plan` |
| **Interactive execution** | `claude` then `/ralph-go 1` |
| **Headless task creation** | `ralph new "task description"` |
| **Headless execution** | `ralph go 1` |
| **List tasks** | `ralph list` |

## File Structure

```
project/
├── .claude/
│   └── skills/
│       ├── ralph-go/SKILL.md     # Single iteration executor
│       ├── ralph-new/SKILL.md    # Task creation
│       └── ralph-plan/SKILL.md   # Interactive planning
└── .ralph/
    ├── guardrails.md             # SHARED constraints for ALL tasks
    └── ralph-1/                  # Task 1
        ├── plan.md               # Task definition (read-only)
        ├── progress.md           # What's done (append-only) ← MEMORY
        └── errors.log            # What failed (append-only) ← MEMORY
```

## How It Works

**External loop (ralph.sh or ralph.ts):**
1. For each iteration up to max_iterations
2. Invoke Claude fresh with `/ralph-go <id>`
3. Check output for COMPLETE or NEEDS_HUMAN
4. If done, exit. Otherwise loop continues.

**Single iteration (Claude + SKILL.md):**
1. Read memory (files, not chat)
2. Decide next step
3. Do ONE thing
4. Write to memory (progress.md/errors.log)
5. Exit (COMPLETE, NEEDS_HUMAN, or just exit)

Claude has no memory of previous iterations. Each invocation starts fresh. The filesystem IS the memory.

## plan.md Format

```markdown
---
task: Add user authentication
test_command: bun run verify
completion_promise: "User authentication works and all tests pass"
max_iterations: 15
---

# Task: Add user authentication

## Context
What needs to be done and why.

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] All tests pass
```

## Completion Signals

| Signal | Meaning |
|--------|---------|
| `<promise>COMPLETE: {completion_promise}</promise>` | Task finished successfully |
| `<promise>NEEDS_HUMAN: {reason}</promise>` | Blocked, needs intervention |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | `COMPLETE` - Task finished |
| 1 | Error or max iterations |
| 2 | `NEEDS_HUMAN` - Blocked |

## Why This Architecture?

| Problem | Solution |
|---------|----------|
| Context window exhaustion | Fresh context each iteration |
| Hallucinated history | Must read actual files |
| Crash = lost state | State persists in filesystem |
| Debugging difficulty | All state visible in files |

## Package Structure

```
ralph-cli/
├── bin/ralph.sh      # Bash CLI (zero dependencies)
├── src/ralph.ts      # TypeScript CLI (requires Bun)
├── skills/           # Bundled Claude Code skills
│   ├── ralph-go/     # Single iteration executor
│   ├── ralph-new/
│   └── ralph-plan/
├── decisions/        # Architecture Decision Records
├── package.json
└── README.md
```
