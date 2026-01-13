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
| `plan.md` | Task definition + success criteria | Read to know what to do |
| `progress.md` | Iteration history | Append after each iteration |
| `activity.log` | Detailed activity log | Append to track work done |
| `errors.log` | Test failures | Append when tests fail |
| `guardrails.md` | Safety constraints | Read and NEVER violate |

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

Ralph continues work by reading state files:

```
1. Read plan.md → understand task
2. Read progress.md → see what's done
3. Read errors.log → avoid repeating failures
4. Read guardrails.md → know constraints
5. Do work → run test_command
6. Append to progress.md/errors.log
7. Loop until COMPLETE or NEEDS_HUMAN
```

## Update Skills

```bash
bun update ralph-cli
ralph update
```
