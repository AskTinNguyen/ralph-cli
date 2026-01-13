# Ralph CLI

## TL;DR

Ralph = Claude follows a checklist until done. Skills do the work, CLI just orchestrates.

## Commands

| Action | Command |
|--------|---------|
| Install skills | `ralph install` |
| Update skills | `ralph update` |
| Create task | `ralph new "description"` |
| List tasks | `ralph list` |
| Run task (headless) | `ralph go 1` |
| Run task (interactive) | `claude` then `/ralph-go 1` |

## File Locations

| Path | Purpose |
|------|---------|
| `.claude/skills/ralph-go/SKILL.md` | Execution loop |
| `.claude/skills/ralph-new/SKILL.md` | Task creation |
| `.claude/skills/ralph-plan/SKILL.md` | Interactive planning |
| `.ralph/guardrails.md` | Safety constraints (shared) |
| `.ralph/ralph-N/plan.md` | Task definition |
| `.ralph/ralph-N/progress.md` | Iteration history |
| `.ralph/ralph-N/errors.log` | Test failures |

## plan.md Format

```yaml
---
task: Short task name
test_command: bun run verify
completion_promise: "What done looks like"
max_iterations: 15
---

# Task: ...

## Success Criteria
- [ ] Criterion 1
- [ ] Criterion 2
- [ ] All tests pass
```

## Completion Signals

| Signal | Meaning |
|--------|---------|
| `<promise>COMPLETE: {text}</promise>` | Task finished |
| `<promise>NEEDS_HUMAN: {reason}</promise>` | Blocked, needs help |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | SUCCESS |
| 1 | ERROR |
| 2 | NEEDS_HUMAN |

## How It Works

1. `ralph install` → copies skills to `.claude/skills/`
2. `/ralph-new` → creates `.ralph/ralph-N/plan.md`
3. `/ralph-go N` → reads plan, does work, runs tests, updates progress
4. Loop until `COMPLETE` or `NEEDS_HUMAN`

## For Humans

See [FOR_HUMAN_BEGINNERS_GUIDE.md](./FOR_HUMAN_BEGINNERS_GUIDE.md) for conceptual explanation.
