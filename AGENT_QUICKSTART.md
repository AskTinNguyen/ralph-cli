# Agent Quick Start

## Setup (run once per repo)

```bash
npm install -g @iannuttall/ralph
ralph install
```

## Phase 1: PRD Generation

Generate a Product Requirements Document:

```bash
ralph prd
```

This creates `.agents/tasks/prd.md` with user stories in the format:

```markdown
### [ ] US-001: Story title

**As a** user
**I want** feature
**So that** benefit

#### Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2
```

## Phase 2: Planning

Generate an implementation plan from the PRD:

```bash
ralph plan
```

This creates `.ralph/IMPLEMENTATION_PLAN.md` breaking down stories into concrete tasks.

## Phase 3: Execution

Run build iterations:

```bash
ralph build 5    # Run 5 iterations
ralph build 1    # Run 1 iteration
```

## Key Files

| File                     | Purpose               | Agent Action                    |
| ------------------------ | --------------------- | ------------------------------- |
| `guardrails.md`          | Safety constraints    | Read FIRST, NEVER violate       |
| `prd.md`                 | User stories          | Read to know requirements       |
| `IMPLEMENTATION_PLAN.md` | Task breakdown        | Read for implementation details |
| `progress.md`            | Iteration history     | Append after each iteration     |
| `errors.log`             | Verification failures | Log when tests fail             |

## File Structure

```
project/
├── .agents/
│   ├── ralph/              # Loop templates
│   │   ├── loop.sh
│   │   ├── PROMPT_build.md
│   │   └── PROMPT_plan.md
│   └── tasks/
│       └── prd.md          # Product requirements
└── .ralph/
    ├── guardrails.md
    ├── IMPLEMENTATION_PLAN.md
    ├── progress.md
    └── errors.log
```

## Definition of Complete

Story is complete when ALL conditions met:

1. All acceptance criteria checkboxes checked: `- [x]`
2. Verification tests pass
3. Output: `<promise>COMPLETE</promise>`

Mark story as done in PRD:

```markdown
### [x] US-001: Story title
```

## Definition of Blocked

When stuck after repeated attempts:

```
<promise>NEEDS_HUMAN: {specific reason}</promise>
```

## Iteration Flow

**READ (start of iteration):**

1. `.ralph/guardrails.md` → constraints
2. `.agents/tasks/prd.md` → requirements
3. `.ralph/IMPLEMENTATION_PLAN.md` → breakdown
4. `.ralph/progress.md` → what's done
5. `.ralph/errors.log` → recent failures

**WORK:** 6. Pick next unchecked story from PRD 7. Make code changes 8. Run verification tests

**WRITE (end of iteration):** 9. Update progress.md with iteration summary 10. Update errors.log if tests failed 11. Mark story [x] in prd.md if complete

**CHECK:** 12. All stories done? → output COMPLETE 13. Stuck repeatedly? → output NEEDS_HUMAN 14. Otherwise → next iteration

## Multi-Stream (Parallel Execution)

For running multiple PRDs in parallel:

```bash
ralph stream new              # Create prd-1
ralph stream init 1           # Create worktree
ralph stream build 1 5        # Run 5 iterations
ralph stream merge 1          # Merge when done
```

See `ralph stream --help` for details.

## Model Selection (Claude Only)

Ralph auto-selects Claude models based on task complexity:

| Complexity | Score | Model |
|------------|-------|-------|
| Low | 1-3 | Haiku |
| Medium | 4-7 | Sonnet |
| High | 8-10 | Opus |

Override per build:

```bash
ralph build 5 --model=opus    # Force Opus
```

**Note:** Model routing only works with Claude agent. Codex/Droid use their provider's default models.
