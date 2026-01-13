# Ralph Beginner's Guide

A non-technical introduction to Ralph - autonomous AI coding made simple.

---

## What is Ralph?

### The Problem We Solved

Imagine you hire a contractor to renovate your kitchen. You could either:

1. **Micromanage**: Stand over them, tell them each step, check every action
2. **Give clear goals**: "Here's what done looks like. Keep working until it matches. Let me know if you get stuck."

Ralph is option 2 for AI coding.

### The Core Idea

**Ralph is a to-do list that Claude keeps checking until everything is done.**

That's it. Here's the flow:

```
┌─────────────────────────────────────────────┐
│  1. You write a task with checkboxes        │
│     - [ ] Add login button                  │
│     - [ ] Button calls auth API             │
│     - [ ] All tests pass                    │
│                                             │
│  2. Claude reads the list                   │
│                                             │
│  3. Claude does work, runs tests            │
│                                             │
│  4. Claude checks off what's done           │
│     - [x] Add login button                  │
│     - [ ] Button calls auth API             │
│     - [ ] All tests pass                    │
│                                             │
│  5. Not all checked? Go back to step 2      │
│                                             │
│  6. All checked? Say "DONE"                 │
└─────────────────────────────────────────────┘
```

### The Breakthrough

We spent a lot of time building complex code to manage this loop—tracking state, handling iterations, managing sessions. **Thousands of lines of code.**

Then we realized: **Claude already knows how to follow instructions.**

Instead of code that says "now read the file, now check progress, now run tests," you just write a **skill**—a set of instructions Claude follows:

> "Read the task file. See what's not checked. Do that work. Run the test command. Update progress. If everything passes, say COMPLETE. Otherwise, keep going."

That's the `/ralph-go` skill. It's just instructions, not code.

### Why Files?

Everything lives in simple files you can read:

| File | What it is |
|------|------------|
| `guardrails.md` | Safety rules Claude must NEVER violate |
| `plan.md` | The task definition ("what to build") |
| `progress.md` | History of what happened each round |
| `errors.log` | What went wrong (if anything) |

No database. No server. You can open these in Notepad and see exactly what's happening. **Transparency over magic.**

### Guardrails: The Safety Net

The `guardrails.md` file is special—it's shared across ALL tasks and contains rules Claude must never break:

```markdown
# Guardrails

## Safety Constraints (NEVER do these)
- Never push directly to main/master branch
- Never delete production data
- Never commit secrets/credentials
- Never skip tests

## Project-Specific Rules
- Always use the existing component library
- Never modify the database schema without migration
```

Think of guardrails as the "house rules" for your project. Claude reads this file before every iteration and treats violations as unacceptable. You can customize it for your project's specific needs.

### The Minimal CLI

The 170-line CLI exists only because:

1. **Automation** - Scripts need to run `ralph go 1` without a human typing
2. **Exit codes** - Programs need numbers (0 = success, 2 = needs help)
3. **Convenience** - `ralph new "Add feature"` is faster than creating files manually

But the CLI doesn't contain the smarts. It just says "hey Claude, run the `/ralph-go` skill on task 1."

### Analogy

Think of it like a recipe card vs. a cooking robot:

- **Old approach**: Build a robot that knows every cooking technique, tracks ingredients, manages timers
- **New approach**: Hand a skilled chef a recipe card. They already know how to cook. The card just tells them *what* to make.

Claude is the chef. The skill is the recipe card. The CLI just hands over the card.

### Why This Works

Claude Code has a feature called **skills**—reusable instruction sets. When you type `/ralph-go`, Claude loads those instructions and follows them. The instructions say:

1. Read your task files
2. Understand where you left off
3. Do the next piece of work
4. Test it
5. Record what happened
6. Either finish or continue

Claude "loops" not because code forces it to, but because the instructions say "keep going until done."

### Summary

| Before | After |
|--------|-------|
| Complex state machine | Simple instructions |
| 26 files of code | 3 skill files |
| Code manages the loop | Claude follows instructions naturally |
| Opaque execution | Human-readable files |

**Ralph is Claude following a to-do list until it's done.** The elegance is that we stopped trying to build clever software and instead just told Claude what to do in plain language.

---

## How Ralph Knows When to Update Files

### The Answer: Instructions, Not Code

Ralph (Claude) knows because **the skill tells it to**. The `/ralph-go` skill is literally a document that says things like:

```markdown
## After Each Iteration

1. Run the test_command from the frontmatter
2. If tests fail, append the error to errors.log
3. Append a summary to progress.md with:
   - What you tried
   - What happened
   - Which criteria are now met
4. If all criteria are checked, output <promise>COMPLETE</promise>
```

Claude reads these instructions and follows them. No code enforces it—Claude just does what the instructions say, the same way a human would follow a recipe.

### When Each File Gets Updated

| File | When Claude Updates It | What Goes In |
|------|----------------------|--------------|
| `plan.md` | Rarely (only to check off criteria) | The checkboxes: `- [ ]` → `- [x]` |
| `progress.md` | After every iteration | "Iteration 3: Added login button, tests pass" |
| `errors.log` | When tests fail | The error output from the test command |

### A Concrete Example

Say the skill instructions include:

```markdown
## Iteration Flow

1. Read plan.md to see the task and unchecked criteria
2. Read progress.md to see what you've already tried
3. Pick one unchecked criterion to work on
4. Make the code changes
5. Run: `{test_command}` from the frontmatter
6. If it fails:
   - Append the error to errors.log
   - Append to progress.md: "Iteration N: Tried X, failed because Y"
7. If it passes:
   - Check off the criterion in plan.md
   - Append to progress.md: "Iteration N: Completed X"
8. If all criteria checked → output COMPLETE
9. Otherwise → continue to next iteration
```

Claude reads this and does exactly that. The file updates happen because the instructions say to update them.

### Why This Works

Claude already knows how to:
- Read and write files
- Run shell commands
- Parse markdown
- Follow multi-step instructions

We're not teaching Claude anything new. We're just giving it a specific workflow to follow. The skill is a **checklist for Claude**, and updating the state files is part of that checklist.

### The Trust Model

You might ask: "What if Claude doesn't follow the instructions?"

In practice, Claude is very good at following explicit instructions. The skill says "append to progress.md after each iteration" and Claude does it. It's the same reliability you get when you tell Claude "write a function that does X"—it does X.

The instructions are the source of truth. Change the instructions, change the behavior. No code to modify.

---

## How Testing Works in Ralph

### The Test Command

Every task has a `test_command` in its frontmatter:

```markdown
---
task: Add login button
test_command: bun test
completion_promise: "Login button works and all tests pass"
max_iterations: 15
---
```

After Claude makes changes, it runs that command. The result determines what happens next.

### What Can Cause Test Failures

| Failure Type | Example | What Claude Does |
|--------------|---------|------------------|
| **Code doesn't compile** | Syntax error, missing import | Fix the error, try again |
| **Test assertions fail** | `expect(button).toExist()` fails | Investigate why, fix code |
| **Runtime error** | `TypeError: undefined is not a function` | Debug and fix |
| **Missing implementation** | Test expects feature that doesn't exist yet | Implement the feature |
| **Regression** | New code broke something else | Fix without breaking other things |

### The Iteration Cycle

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   Claude makes changes                                  │
│         ↓                                               │
│   Runs: bun test                                        │
│         ↓                                               │
│   ┌─────────────┐                                       │
│   │ Tests pass? │                                       │
│   └─────────────┘                                       │
│      │       │                                          │
│     YES      NO                                         │
│      ↓        ↓                                         │
│   Update    Log error                                   │
│   progress  to errors.log                               │
│      ↓        ↓                                         │
│   Check     Try to fix                                  │
│   criteria  (next iteration)                            │
│      ↓                                                  │
│   All done? ──NO──→ Continue working                    │
│      │                                                  │
│     YES                                                 │
│      ↓                                                  │
│   <promise>COMPLETE</promise>                           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Promise vs Tests: Different Things

| Concept | What It Means |
|---------|---------------|
| **Test command** | Verification that runs every iteration |
| **Completion promise** | The final "I'm done" declaration |

The promise is **not** automatically triggered by passing tests. Claude must:

1. Have all tests passing **AND**
2. Believe all success criteria are met **AND**
3. Explicitly output `<promise>COMPLETE: Login button works and all tests pass</promise>`

#### Why Separate Them?

Tests might pass but criteria aren't met:

```markdown
## Success Criteria
- [x] Login button exists
- [x] Button calls auth API
- [ ] Button shows loading state   ← Tests pass, but this isn't done
- [x] All tests pass
```

Claude won't say COMPLETE because one checkbox is unchecked, even though `bun test` passes.

### Ways the Process Can Break Down

#### 1. Tests Keep Failing (Stuck)

```
Iteration 1: Failed - missing import
Iteration 2: Failed - wrong function name
Iteration 3: Failed - still wrong
Iteration 4: Failed - same error
```

After repeated failures, Claude might output:

```
<promise>NEEDS_HUMAN: Cannot figure out why auth module won't import</promise>
```

This exits with code 2, signaling human help is needed.

#### 2. Max Iterations Reached

```markdown
max_iterations: 15
```

If Claude hits 15 iterations without completing, it stops. Exit code 3 (MAX_ITER).

#### 3. No Progress (Stalled)

If progress.md shows the same state for 3+ iterations:

```
Iteration 5: Tried X, failed
Iteration 6: Tried X again, failed
Iteration 7: Tried X differently, still failed
```

The system detects stalling. Exit code 4 (STALLED).

### Good Test Commands

| Approach | Command | Why It Works |
|----------|---------|--------------|
| **Unit tests** | `bun test` | Fast, specific feedback |
| **Type checking** | `bun run verify` | Catches errors before runtime |
| **Build check** | `bun run build` | Ensures everything compiles |
| **Combined** | `bun run verify && bun test` | Multiple safety nets |
| **Custom script** | `./scripts/check-feature.sh` | Task-specific validation |

### Example: A Failing Test Flow

```markdown
# errors.log

## Iteration 2 - 2024-01-15 10:23:45
Command: bun test
Exit code: 1
Output:
  FAIL src/components/LoginButton.test.ts
    ✕ should show loading state when clicked
      Expected: loading spinner visible
      Received: button unchanged
```

```markdown
# progress.md

## Iteration 2
- Attempted: Added onClick handler to button
- Result: FAILED - Loading state not showing
- Next: Need to add loading state to component state

## Iteration 3
- Attempted: Added isLoading state, connected to button
- Result: PASSED - All tests now pass
- Criteria met: Button shows loading state ✓
```

### Summary

- **Tests** = verification run every iteration
- **Promise** = Claude's declaration that everything is done
- Tests can fail for many reasons (bugs, missing code, regressions)
- Claude keeps trying until tests pass AND all criteria are met
- If truly stuck, Claude says `NEEDS_HUMAN` instead of spinning forever

The test command is Claude's feedback loop. Fail → learn → fix → try again. The promise is the finish line.

---

## Quick Reference

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | SUCCESS - Task completed |
| 1 | ERROR - Unexpected error |
| 2 | NEEDS_HUMAN - Claude escalated |
| 3 | MAX_ITER - Iteration limit reached |
| 4 | STALLED - No progress for 3 iterations |

### File Structure

```
your-project/
└── .ralph/
    ├── guardrails.md      # Constraints for ALL tasks (READ FIRST)
    ├── ralph-1/           # Task 1
    │   ├── plan.md        # Task definition
    │   ├── progress.md    # Iteration history
    │   └── errors.log     # Test failures
    └── ralph-2/           # Task 2
        └── ...
```

### Commands

```bash
# Create a new task
ralph new "Add dark mode"

# List all tasks
ralph list

# Run a task
ralph go 1

# Or use Claude Code interactively
claude
> /ralph-plan Add dark mode
> /ralph-go 1
```

---

## Key Takeaways

1. **Ralph is simple**: It's Claude following a checklist until done
2. **State lives in files**: Human-readable, no database needed
3. **Skills are instructions**: No complex code, just tell Claude what to do
4. **Tests provide feedback**: Fail → fix → retry loop
5. **Promise means done**: Claude declares completion explicitly
6. **Escape hatches exist**: NEEDS_HUMAN, max iterations, stall detection

The magic isn't in the code—it's in realizing Claude already knows how to work. We just needed to give it a clear workflow to follow.
