# Ralph CLI

Autonomous coding loop for Claude Code.

## Core Philosophy

```bash
while :; do cat prompt.md | agent ; done
```

**Same task. New brain each iteration. Memory is filesystem + git, not chat.**

## Quick Reference

| Use Case | Command |
|----------|---------|
| **Install to repo** | `ralph.sh install` |
| **Create task** | `ralph.sh new "task description"` |
| **🔁 Run FULL LOOP** | `ralph.sh go 1` ← **Use this for autonomous execution** |
| **⚡ Run PARALLEL** | `ralph.sh parallel 1` ← **Decompose and run sub-tasks concurrently** |
| **List tasks** | `ralph.sh list` |

## ⚠️ Two Execution Modes

| Mode | Command | Behavior |
|------|---------|----------|
| 🔁 **Headless** | `ralph.sh go 1` | Loops until COMPLETE (autonomous) |
| 👤 **Interactive** | `/ralph-go 1` | ONE iteration only (for debugging) |

**For autonomous work:** Use `ralph.sh go <id>` in terminal (or `! ralph.sh go <id>` inside Claude Code).

## File Structure

```
project/
├── .claude/
│   └── skills/
│       ├── ralph-go/SKILL.md       # Single iteration executor
│       ├── ralph-new/SKILL.md      # Task creation
│       ├── ralph-plan/SKILL.md     # Interactive planning
│       └── ralph-parallel/SKILL.md # Parallel decomposition
└── .ralph/
    ├── guardrails.md               # SHARED constraints for ALL tasks
    ├── ralph-1/                    # Task 1 (parent)
    │   ├── plan.md
    │   ├── progress.md
    │   ├── errors.log
    │   └── parallel-status.md      # Parallel execution status (if parallel)
    ├── ralph-1-a/                  # Sub-task A (if parallelized)
    ├── ralph-1-b/                  # Sub-task B
    └── ralph-1-c/                  # Sub-task C
```

## How It Works

**External loop (ralph.sh):**
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

## Parallel Execution

**When to use:** Multiple independent problems (3+ test files failing, separate subsystems broken).

```bash
ralph.sh parallel 1       # Analyze, create sub-tasks, launch in parallel
ralph.sh parallel 1 -n    # Dry run (analyze only)
```

**How it works:**
1. Analyze task for independent domains
2. Create sub-tasks (`ralph-1-a`, `ralph-1-b`, etc.)
3. Launch each sub-task in parallel via `ralph.sh go`
4. Monitor completion and aggregate results

**Sub-task naming:** `ralph-{parent}-{letter}` (e.g., `ralph-1-a`, `ralph-1-b`)

## plan.md Format

```markdown
---
task: Add user authentication
test_command: make test
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
├── bin/ralph.sh      # CLI (pure bash, zero dependencies)
├── skills/           # Bundled Claude Code skills
│   ├── ralph-go/     # Single iteration executor
│   ├── ralph-new/    # Task creation
│   ├── ralph-plan/   # Interactive planning
│   └── ralph-parallel/ # Parallel decomposition
├── templates/        # Task templates
├── decisions/        # Architecture Decision Records
└── README.md
```
