# Ralph CLI

Autonomous coding loop for Claude Code. Ralph iteratively works on tasks until completion, following a simple checklist-based approach.

## What is Ralph?

Ralph is an AI coding loop that:
1. Reads a task definition with success criteria
2. Works toward completing each criterion
3. Runs tests to verify progress
4. Continues until all criteria are met or help is needed

State lives in files, not databases. Every step is transparent and traceable.

## Installation

### Global Install (Recommended)

Install globally to use the `ralph` command directly anywhere:

```bash
bun add -g github:AskTinNguyen/ralph-cli

# Verify installation
ralph --help
```

Then in any repo:

```bash
ralph install    # Install skills to current repo
ralph new "task" # Create a task
ralph go 1       # Run a task
```

### Local Install (Per-Project)

Install as a dev dependency in your project:

```bash
bun add -D github:AskTinNguyen/ralph-cli
```

Use with `bunx`:

```bash
bunx ralph install
bunx ralph new "task"
bunx ralph go 1
```

Or add a script to your `package.json`:

```json
{
  "scripts": {
    "ralph": "ralph"
  }
}
```

Then use `bun run ralph install`, etc.

### What Gets Created

After running `ralph install`, this creates:
- `.claude/skills/ralph-go/` - Main execution skill
- `.claude/skills/ralph-new/` - Task creation skill
- `.claude/skills/ralph-plan/` - Interactive planning skill
- `.ralph/guardrails.md` - Safety constraints

## Quick Start

```bash
# 1. Install Ralph globally (one-time setup)
bun add -g github:AskTinNguyen/ralph-cli

# 2. Install Ralph skills to your repo
ralph install

# 3. Start Claude Code
claude

# 4. Create a task interactively
> /ralph-plan

# 5. Or create one directly
> /ralph-new Add user authentication

# 6. Run the task
> /ralph-go 1
```

## Commands

### `ralph install`

Install Ralph skills to the current repository.

```bash
ralph install
# Creates .claude/skills/ralph-*/ and .ralph/guardrails.md
```

### `ralph update`

Update Ralph skills to the latest version.

```bash
# Global install: update package, then update skills
bun add -g github:AskTinNguyen/ralph-cli
ralph update

# Local install: update package, then update skills
bun add -D github:AskTinNguyen/ralph-cli
bunx ralph update
```

This overwrites `.claude/skills/ralph-*/` with the latest versions. Your `guardrails.md` is preserved if you've customized it.

### `ralph new <task>`

Create a new task.

```bash
ralph new "Add dark mode toggle"
# Creates .ralph/ralph-1/plan.md
```

### `ralph list`

List all tasks.

```bash
ralph list
# ralph-1: Add dark mode toggle (0 iterations)
# ralph-2: Fix login bug (3 iterations)
```

### `ralph go <id>`

Run a task headlessly (for scripts/automation).

```bash
ralph go 1
# Runs until COMPLETE or NEEDS_HUMAN
```

## Interactive Usage (Recommended)

For the best experience, use Ralph through Claude Code directly:

```bash
claude
> /ralph-plan          # Interactive task planning
> /ralph-new Fix bug   # Quick task creation
> /ralph-go 1          # Run task with full UI
```

## File Structure

```
your-repo/
├── .claude/
│   └── skills/
│       ├── ralph-go/SKILL.md      # Execution loop
│       ├── ralph-new/SKILL.md     # Task creation
│       └── ralph-plan/SKILL.md    # Planning
└── .ralph/
    ├── guardrails.md              # Safety constraints (shared, READ FIRST)
    └── ralph-1/                   # Task 1
        ├── plan.md                # Task definition
        ├── progress.md            # Iteration history (smart append)
        └── errors.log             # Test failures (rolling, max 3)
```

## Task Definition

`plan.md` uses YAML frontmatter:

```markdown
---
task: Add health endpoint
test_command: bun test
completion_promise: "Health endpoint returns 200 and all tests pass"
max_iterations: 15
---

# Task: Add health endpoint

## Context
We need a health check endpoint for load balancer probes.

## Success Criteria
- [ ] GET /health returns 200 OK
- [ ] Response includes { status: "ok" }
- [ ] All tests pass
```

## Completion Signals

Ralph outputs these markers to control the loop:

```markdown
<!-- Success -->
<promise>COMPLETE: Health endpoint returns 200 and all tests pass</promise>

<!-- Needs help -->
<promise>NEEDS_HUMAN: Cannot find the router configuration</promise>
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | SUCCESS - Task completed |
| 1 | ERROR - Unexpected error |
| 2 | NEEDS_HUMAN - Claude escalated |

## State Files (Critical for Agents)

Ralph uses state files as the memory and harness for continuation. **Agents MUST read these files at the start of each iteration and manage them to avoid context bloat.**

### Context Management Strategy

To prevent unbounded log growth that wastes context:

| File | Strategy | Max Size |
|------|----------|----------|
| `guardrails.md` | Read-only, never modify | N/A |
| `progress.md` | Keep last 5 iterations, summarize older | ~50 lines |
| `errors.log` | Keep last 3 unique errors only | ~30 lines |
| `activity.log` | Optional, for debugging only | Remove if not needed |

### guardrails.md (Read Before Every Action)

**Purpose**: Safety constraints that apply to ALL tasks. Violations are unacceptable.

**When to read**: Before starting any work, before every iteration.

**Template**:
```markdown
# Guardrails

## Safety Constraints (NEVER do these)
- Never push directly to main/master branch
- Never delete production data
- Never commit secrets/credentials
- Never skip tests

## Project-Specific Rules
- (Add your project's constraints)
```

### progress.md (Smart Append)

**Purpose**: Iteration history that enables continuation.

**Management rules**:
1. After iteration 5, summarize iterations 1-N into a "Summary" section
2. Keep only last 5 iterations in detail
3. This prevents unbounded growth while preserving context

**Template**:
```markdown
## Summary (Iterations 1-5)
- Set up project structure
- Added authentication module
- Fixed 2 test failures
- Integrated with database

## Iteration 6 - YYYY-MM-DD HH:MM:SS
- **Attempted**: What you tried to do
- **Result**: PASSED | FAILED
- **Files changed**: List of files modified
- **Criteria met**: Which checkboxes can now be checked
- **Next**: What to try next (if not complete)
```

### errors.log (Deduplicated, Rolling)

**Purpose**: Record of recent, unique test failures. Prevents repeating the same mistakes.

**Management rules**:
1. Before appending, check if same error already exists → skip if duplicate
2. Keep only last 3 unique errors
3. Remove oldest when adding new (rolling window)

**Template**:
```markdown
## Error 1 (Iteration 8)
Command: bun test
Exit code: 1
Output:
  FAIL src/components/Button.test.ts
    ✕ should render correctly
      Expected: true
      Received: false

## Error 2 (Iteration 10)
...
```

### activity.log (Optional)

**Purpose**: Detailed log for debugging. **Not required for normal operation.**

**When to use**: Only when debugging issues or when human requests detailed audit trail.

**Recommendation**: Skip this file in normal loops to save context. Use only if stuck.

### Agent Loop (Context-Aware)

**READ (start of iteration):**
1. guardrails.md → Know constraints
2. plan.md → Know the goal
3. progress.md → Know what's done
4. errors.log → Know what failed (last 3)

**WORK:**
5. Do work toward next criterion
6. Run test_command → Verify work

**WRITE (end of iteration):**
7. Update progress.md → Summarize if > 5 iterations
8. Update errors.log → Only if new unique error

**CONTEXT MANAGEMENT:**
- progress.md > 5 iterations? Summarize older ones
- errors.log has duplicate? Don't append
- errors.log > 3 entries? Remove oldest

**CHECK:**
9. All criteria met? → COMPLETE
10. Otherwise → next iteration

## Philosophy

- **State lives in files** - Human-readable, no database needed
- **Minimal tooling** - ~200 lines of code, no server
- **Transparent execution** - Read any file to understand what's happening
- **Portable** - Works in any repo with Claude Code

## License

MIT
