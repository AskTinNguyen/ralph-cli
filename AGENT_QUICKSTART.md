# Agent Quick Start

## Setup (run once per repo)

```bash
bun add github:AskTinNguyen/ralph-cli
ralph install
```

## Create Task

```bash
ralph new "Add feature X"
```

Then edit `.ralph/ralph-1/plan.md`:

```yaml
---
task: Add feature X
test_command: bun run verify
completion_promise: "Feature X works and all tests pass"
max_iterations: 15
---

## Success Criteria
- [ ] Implement X
- [ ] Add tests for X
- [ ] All tests pass
```

## Run Task

```bash
claude
> /ralph-go 1
```

## Key Files to Read

| File | Contains |
|------|----------|
| `.ralph/ralph-N/plan.md` | What to do |
| `.ralph/ralph-N/progress.md` | What's done |
| `.ralph/guardrails.md` | What NOT to do |

## Update Skills

```bash
bun update ralph-cli
ralph update
```
