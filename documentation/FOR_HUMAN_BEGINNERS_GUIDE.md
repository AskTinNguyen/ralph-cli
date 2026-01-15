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

Instead of code that says "now read the file, now check progress, now run tests," you just write **prompts**—instructions that guide the execution:

> "Read the PRD. See what stories remain. Pick the next one. Do that work. Run the test command. Update progress. If everything passes, mark it done. Otherwise, keep going."

That's the build loop. It's just instructions in `PROMPT_build.md`, not code.

### Why Files?

Everything lives in simple files you can read:

| File                     | What it is                                      |
| ------------------------ | ----------------------------------------------- |
| `guardrails.md`          | Safety rules Ralph must NEVER violate           |
| `prd.md`                 | Product requirements document with user stories |
| `IMPLEMENTATION_PLAN.md` | Breakdown of stories into tasks                 |
| `progress.md`            | History of what happened each iteration         |
| `errors.log`             | What went wrong (if anything)                   |

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

The CLI exists only because:

1. **Automation** - Scripts need to run `ralph build 1` without a human typing
2. **Exit codes** - Programs need numbers (0 = success, 2 = needs help)
3. **Convenience** - `ralph prd` is faster than creating files manually

But the CLI doesn't contain the smarts. It just invokes the bash loop with the right prompts.

### Analogy

Think of it like a recipe card vs. a cooking robot:

- **Old approach**: Build a robot that knows every cooking technique, tracks ingredients, manages timers
- **New approach**: Hand a skilled chef a recipe card. They already know how to cook. The card just tells them _what_ to make.

Ralph (the agent) is the chef. The prompt is the recipe card. The CLI just hands over the card.

### Why This Works

Ralph uses **prompts**—reusable instruction templates. When you run `ralph build`, it loads the build prompt and follows it. The instructions say:

1. Read the PRD and plan
2. Understand which stories are done
3. Pick the next story and do that work
4. Test it
5. Record what happened
6. Either mark complete or continue

Ralph "loops" not because code forces it to, but because the bash script runs iterations until the PRD is complete.

### Summary

| Before                | After                     |
| --------------------- | ------------------------- |
| Complex state machine | Simple bash loop          |
| 26 files of code      | 1 bash script + 2 prompts |
| Code manages the loop | Bash runs iterations      |
| Opaque execution      | Human-readable files      |

**Ralph is an agent following a PRD until it's done.** The elegance is that we stopped trying to build clever software and instead used simple bash scripts with clear prompts.

---

## How Ralph Knows When to Update Files

### The Answer: Instructions, Not Code

Ralph knows because **the prompt tells it to**. The `PROMPT_build.md` file is literally a document that says things like:

```markdown
## After Each Iteration

1. Run verification tests
2. If tests fail, append the error to errors.log
3. Append a summary to progress.md with:
   - What you tried
   - What happened
   - Which stories are now complete
4. If all stories are done, output <promise>COMPLETE</promise>
```

The agent reads these instructions and follows them. No code enforces it—the agent just does what the instructions say, the same way a human would follow a recipe.

### When Each File Gets Updated

| File          | When Ralph Updates It  | What Goes In                                |
| ------------- | ---------------------- | ------------------------------------------- |
| `prd.md`      | When story is complete | Story checkboxes: `- [ ]` → `- [x]`         |
| `progress.md` | After every iteration  | "Iteration 3: Completed US-001, tests pass" |
| `errors.log`  | When tests fail        | The error output from verification          |

### A Concrete Example

Say the prompt includes:

```markdown
## Iteration Flow

1. Read prd.md to see unchecked stories
2. Read progress.md to see what you've already tried
3. Pick one unchecked story to work on
4. Make the code changes
5. Run verification tests
6. If it fails:
   - Append the error to errors.log
   - Append to progress.md: "Iteration N: Tried X, failed because Y"
7. If it passes:
   - Check off the story in prd.md
   - Append to progress.md: "Iteration N: Completed US-001"
8. If all stories checked → output COMPLETE
9. Otherwise → continue to next iteration
```

The agent reads this and does exactly that. The file updates happen because the instructions say to update them.

### Why This Works

Claude already knows how to:

- Read and write files
- Run shell commands
- Parse markdown
- Follow multi-step instructions

We're not teaching Claude anything new. We're just giving it a specific workflow to follow. The skill is a **checklist for Claude**, and updating the state files is part of that checklist.

### The Trust Model

You might ask: "What if the agent doesn't follow the instructions?"

In practice, modern AI agents are very good at following explicit instructions. The prompt says "append to progress.md after each iteration" and the agent does it.

The instructions are the source of truth. Change the instructions, change the behavior. No code to modify.

---

## How Testing Works in Ralph

### The Test Command

PRD stories can specify verification commands. Ralph detects your project type and suggests the right test command:

```markdown
### [ ] US-001: Add login button

**As a** user
**I want** a login button
**So that** I can authenticate

#### Acceptance Criteria

- [ ] Button renders on page
- [ ] Button triggers auth flow
- [ ] All tests pass
```

After Ralph makes changes, it runs tests. The result determines what happens next.

### Works With Any Language

Ralph doesn't care what language you use. It detects your project type and suggests the right test command:

| Your Project          | Ralph Suggests           |
| --------------------- | ------------------------ |
| JavaScript/TypeScript | `npm test` or `bun test` |
| Rust                  | `cargo test`             |
| Python                | `pytest`                 |
| Go                    | `go test ./...`          |
| C++                   | `make test` or `ctest`   |

You can configure verification in `.agents/ralph/config.sh`.

### What Can Cause Test Failures

| Failure Type               | Example                                     | What Ralph Does                   |
| -------------------------- | ------------------------------------------- | --------------------------------- |
| **Code doesn't compile**   | Syntax error, missing import                | Fix the error, try again          |
| **Test assertions fail**   | `expect(button).toExist()` fails            | Investigate why, fix code         |
| **Runtime error**          | `TypeError: undefined is not a function`    | Debug and fix                     |
| **Missing implementation** | Test expects feature that doesn't exist yet | Implement the feature             |
| **Regression**             | New code broke something else               | Fix without breaking other things |

### The Iteration Cycle

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   Ralph makes changes                                   │
│         ↓                                               │
│   Runs verification                                     │
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
│   Mark      Try to fix                                  │
│   story     (next iteration)                            │
│   done                                                  │
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

| Concept                | What It Means                          |
| ---------------------- | -------------------------------------- |
| **Test command**       | Verification that runs every iteration |
| **Completion promise** | The final "I'm done" declaration       |

The promise is **not** automatically triggered by passing tests. Ralph must:

1. Have all tests passing **AND**
2. Believe all story acceptance criteria are met **AND**
3. Explicitly output `<promise>COMPLETE</promise>`

#### Why Separate Them?

Tests might pass but acceptance criteria aren't met:

```markdown
#### Acceptance Criteria

- [x] Login button exists
- [x] Button calls auth API
- [ ] Button shows loading state ← Tests pass, but this isn't done
- [x] All tests pass
```

Ralph won't say COMPLETE because one checkbox is unchecked, even though tests pass.

### Ways the Process Can Break Down

#### 1. Tests Keep Failing (Stuck)

```
Iteration 1: Failed - missing import
Iteration 2: Failed - wrong function name
Iteration 3: Failed - still wrong
Iteration 4: Failed - same error
```

After repeated failures, Ralph might output:

```
<promise>NEEDS_HUMAN: Cannot figure out why auth module won't import</promise>
```

This exits with code 2, signaling human help is needed.

#### 2. Max Iterations Reached

If Ralph hits the max iterations without completing, it stops.

#### 3. No Progress (Stalled)

If progress.md shows the same state for 3+ iterations:

```
Iteration 5: Tried X, failed
Iteration 6: Tried X again, failed
Iteration 7: Tried X differently, still failed
```

The system detects stalling.

### Good Test Commands

| Approach               | Examples                                  | Why It Works                  |
| ---------------------- | ----------------------------------------- | ----------------------------- |
| **Unit tests**         | `npm test`, `cargo test`, `pytest`        | Fast, specific feedback       |
| **Type/compile check** | `tsc --noEmit`, `cargo check`, `go build` | Catches errors before runtime |
| **Build**              | `npm run build`, `make`, `cargo build`    | Ensures everything compiles   |
| **Combined**           | `npm run lint && npm test`                | Multiple safety nets          |
| **Custom script**      | `./scripts/check-feature.sh`              | Task-specific validation      |

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
- **Promise** = Ralph's declaration that everything is done
- Tests can fail for many reasons (bugs, missing code, regressions)
- Ralph keeps trying until tests pass AND all criteria are met
- If truly stuck, Ralph says `NEEDS_HUMAN` instead of spinning forever

The test command is Ralph's feedback loop. Fail → learn → fix → try again. The promise is the finish line.

---

## Visual Verification (For Web Projects)

If you're building a web UI, Ralph can take screenshots to help you verify the work visually.

### How to Enable

Configure visual verification in your workflow (requires the `dev-browser` skill).

### What Happens

1. Ralph makes changes to your code
2. Runs your tests (as usual)
3. **Also** opens a browser, navigates to your app, takes screenshots
4. Saves screenshots to `.ralph/screenshots/`

You can review the screenshots to see what the UI looks like at each step. This is especially useful for:

- Design changes where "does it look right?" matters
- Catching visual regressions tests might miss
- Showing stakeholders what was built

Install the skill: `ralph install --skills` and select `dev-browser`.

---

## Custom Testing Skills (For Specialized Projects)

If you're working with specialized tools like Unreal Engine, Unity, or embedded systems, Ralph can use custom testing knowledge you provide.

### The Problem

Modern AI agents know general patterns, but your Unreal Engine 5 project might have specific:

- Build commands (`RunUAT.bat` with certain flags)
- Test commands (Automation Framework setup)
- Verification patterns (PIE testing)

### The Solution

Configure project-specific commands in `.agents/ralph/config.sh` or create custom verification scripts that Ralph calls during iterations.

### Why This Helps

- Iterations use the right test commands automatically
- No need to explain your build process each time
- The config becomes project documentation

---

## Quick Reference

### Exit Codes

| Code | Meaning                                |
| ---- | -------------------------------------- |
| 0    | SUCCESS - Task completed               |
| 1    | ERROR - Unexpected error               |
| 2    | NEEDS_HUMAN - Claude escalated         |
| 3    | MAX_ITER - Iteration limit reached     |
| 4    | STALLED - No progress for 3 iterations |

### File Structure

```
your-project/
├── .agents/
│   ├── ralph/              # Ralph templates
│   │   └── loop.sh
│   └── tasks/
│       └── prd.md          # Product requirements
└── .ralph/
    ├── guardrails.md       # Constraints (READ FIRST)
    ├── IMPLEMENTATION_PLAN.md  # Task breakdown
    ├── progress.md         # Iteration history
    └── errors.log          # Test failures
```

### Commands

```bash
# Generate PRD
ralph prd

# Generate plan from PRD
ralph plan

# Run build iterations
ralph build 5

# Install to repo
ralph install
```

---

## Key Takeaways

1. **Ralph is simple**: It's an agent following a PRD until done
2. **State lives in files**: Human-readable, no database needed
3. **Prompts are instructions**: No complex code, just clear prompts
4. **Tests provide feedback**: Fail → fix → retry loop
5. **Promise means done**: Agent declares completion explicitly
6. **Escape hatches exist**: NEEDS_HUMAN, max iterations, stall detection
7. **Works with any language**: Detects your project and suggests the right commands
8. **Visual verification**: Screenshots for web UI projects (with dev-browser skill)
9. **Extensible**: Configure custom commands in `.agents/ralph/config.sh`

The magic isn't in the code—it's in realizing agents already know how to work. We just needed to give them a clear workflow to follow.
