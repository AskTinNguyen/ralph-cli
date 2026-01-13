# Agent Quick Start

## Setup (run once per repo)

```bash
bun add github:AskTinNguyen/ralph-cli
ralph install
```

## Phase 1: Planning (Critical)

Use `/ralph-plan` for interactive planning. This generates:

1. **plan.md** - Task definition with success criteria
2. **guardrails.md** - Constraints you must NEVER violate

```bash
claude
> /ralph-plan Add user authentication
```

The planning phase asks questions to define:
- What needs to be built
- How to verify completion (`test_command`)
- What "done" looks like (`completion_promise`)
- Success criteria checklist

## Phase 2: Execution

```bash
> /ralph-go 1
```

## Key Files

| File | Purpose | Agent Action |
|------|---------|--------------|
| `guardrails.md` | Safety constraints | Read FIRST, NEVER violate |
| `plan.md` | Task definition + success criteria | Read to know what to do |
| `progress.md` | Iteration history | Smart append (see below) |
| `errors.log` | Test failures | Rolling window, max 3 unique |

## Context Management (Prevent Bloat)

**progress.md** - Smart append:
- Keep last 5 iterations in detail
- Summarize older iterations into "## Summary (Iterations 1-N)"

**errors.log** - Rolling window:
- Keep only last 3 unique errors
- Skip duplicates (don't append same error twice)
- Remove oldest when adding new

## Definition of Complete

Task is complete when ALL conditions met:

1. All `Success Criteria` checkboxes are checked: `- [x]`
2. `test_command` passes
3. Output: `<promise>COMPLETE: {completion_promise}</promise>`

## Definition of Blocked

When stuck after 3+ attempts:

```
<promise>NEEDS_HUMAN: {specific reason}</promise>
```

## Continuation Harness

**READ (start of iteration):**
1. guardrails.md → constraints
2. plan.md → goal + criteria
3. progress.md → what's done
4. errors.log → recent failures

**WORK:**
5. Do work toward next criterion
6. Run test_command

**WRITE (end of iteration):**
7. Update progress.md (summarize if > 5)
8. Update errors.log (if new unique error)

**CHECK:**
9. All criteria met? → COMPLETE
10. Stuck 3+ times? → NEEDS_HUMAN
11. Otherwise → next iteration

## Update Skills

```bash
bun update ralph-cli
ralph update
```
