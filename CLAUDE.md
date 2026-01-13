# Ralph CLI

Autonomous coding loop for Claude Code.

## Quick Reference

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
│       ├── ralph-go/SKILL.md     # Main execution loop
│       ├── ralph-new/SKILL.md    # Task creation
│       └── ralph-plan/SKILL.md   # Interactive planning
└── .ralph/
    ├── guardrails.md             # SHARED constraints for ALL tasks
    └── ralph-1/                  # Task 1
        ├── plan.md               # Task definition with frontmatter
        ├── progress.md           # Iteration history (append-only)
        └── errors.log            # Verification failures
```

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
| 1 | Error or failure |
| 2 | `NEEDS_HUMAN` - Blocked |

## Package Structure

```
ralph-cli/
├── src/ralph.ts      # CLI (~200 lines)
├── skills/           # Bundled Claude Code skills
│   ├── ralph-go/
│   ├── ralph-new/
│   └── ralph-plan/
├── package.json
└── README.md
```

## How It Works

1. **Install**: `ralph install` copies skills to `.claude/skills/` and creates `.ralph/guardrails.md`
2. **Create**: Use `/ralph-new` or `/ralph-plan` in Claude Code to define a task
3. **Execute**: `/ralph-go <id>` runs the loop - Claude reads the task, does work, verifies, repeats
4. **Complete**: Claude outputs `<promise>COMPLETE</promise>` when done or `NEEDS_HUMAN` if stuck

The "loop" is Claude following skill instructions, not code managing iterations.
