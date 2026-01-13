---
name: ralph-plan
description: Interactive task planning for Ralph CLI. Use when user says "ralph plan", "plan a task for ralph", "plan ralph task", or wants to interactively define a task for autonomous execution.
---

# Ralph Task Planning

Turn ideas into well-structured tasks for Ralph autonomous execution through collaborative dialogue.

**Announce:** "I'm using the ralph-plan skill to create a task for autonomous execution."

## Usage

```
/ralph-plan [task-id]
```

- `/ralph-plan` - Create new task with next available ID
- `/ralph-plan 1` - Plan/edit existing ralph-1

## Your Process

### 1. Understand Context First

**Before asking questions**, review the project state:
```bash
# Check existing Ralph tasks
ls .ralph/

# Review recent work
git log --oneline -10

# Understand project structure
ls -la
```

Read key files: README, package.json/Cargo.toml/etc., and any existing `.ralph/guardrails.md`.

### 2. Determine Task ID

If no ID provided:
```bash
# Find next available ID
ls .ralph/  # Look for ralph-N directories
# Next = highest N + 1, or ralph-1 if none exist
```

If ID provided, check if task exists:
- Exists → Show current plan, ask what to change
- Doesn't exist → Create new

### 3. Gather Requirements (One Question at a Time)

Ask questions sequentially. **Prefer multiple-choice format** when feasible. **Limit to ONE question per message.**

**Question 1: The Goal**
```
What should Ralph accomplish? Please describe in a sentence or two.
```
(Use free text here—goals are too varied for multiple choice)

**Question 2: Scope Clarification**
Based on their answer, ask a focused follow-up:
```json
{
  "questions": [{
    "question": "Which best describes the scope?",
    "header": "Scope",
    "options": [
      {"label": "Single file", "description": "Changes isolated to one file"},
      {"label": "One module", "description": "Changes within a single module/component"},
      {"label": "Cross-cutting", "description": "Touches multiple areas of the codebase"},
      {"label": "New addition", "description": "Creating new files/modules from scratch"}
    ],
    "multiSelect": false
  }]
}
```

**Question 3: Constraints** (if relevant)
```json
{
  "questions": [{
    "question": "Any constraints I should know about?",
    "header": "Constraints",
    "options": [
      {"label": "Must pass CI", "description": "Existing tests and lints must pass"},
      {"label": "No new deps", "description": "Cannot add new dependencies"},
      {"label": "Backwards compat", "description": "Must maintain existing APIs"},
      {"label": "None special", "description": "Standard development constraints"}
    ],
    "multiSelect": true
  }]
}
```

### 4. Explore the Codebase

**This step is critical.** Before proposing an approach:

1. Use Glob/Grep to find relevant files
2. Read key files to understand existing patterns
3. Identify files that will need modification
4. Note existing test patterns

Document what you find—this informs the plan.

### 5. Present 2-3 Approaches

After exploration, present options with trade-offs:

```markdown
Based on my exploration, here are approaches:

**Option A: [Name] (Recommended)**
- Approach: [2-3 sentences]
- Pros: [key benefits]
- Cons: [trade-offs]
- Files: [main files affected]

**Option B: [Name]**
- Approach: [2-3 sentences]
- Pros: [key benefits]
- Cons: [trade-offs]
- Files: [main files affected]

Which approach would you prefer?
```

**Lead with your recommended option.** Apply YAGNI—prefer simpler solutions.

### 6. Define Verification

Before suggesting test commands:
1. Check for testing skills in `.claude/skills/`
2. Detect project type from build files
3. Review existing test patterns in the codebase

```json
{
  "questions": [{
    "question": "How should Ralph verify completion?",
    "header": "Verify",
    "options": [
      {"label": "[detected command]", "description": "Run existing test suite"},
      {"label": "Manual check", "description": "Visual/manual verification needed"},
      {"label": "Custom command", "description": "I'll specify a command"}
    ],
    "multiSelect": false
  }]
}
```

For frontend tasks, include visual verification options using Playwright MCP tools.

### 7. Create Detailed Plan

**Create directory structure:**
```bash
mkdir -p .ralph/ralph-N
```

**Create plan.md with bite-sized tasks:**

```markdown
---
task: <short descriptive name>
test_command: <command>
completion_promise: "<specific, verifiable success statement>"
max_iterations: 15
---

# Task: <task name>

**Goal:** <one sentence describing what this builds>

**Approach:** <2-3 sentences about the chosen approach>

## Context

<what needs to be done and why—enough for someone with zero context>

## Files to Modify

- `exact/path/to/file.ts` - <what changes>
- `exact/path/to/another.ts` - <what changes>
- `tests/path/to/test.ts` - <new tests>

## Implementation Steps

Break into discrete, atomic tasks. Each step = one action.

### Step 1: <description>

**Files:** `path/to/file.ts`

**Do:** <specific instruction>

```typescript
// Example code showing the change
```

### Step 2: <description>

**Files:** `path/to/file.ts`

**Do:** <specific instruction>

### Step 3: Write tests

**Files:** `tests/path/to/test.ts`

**Do:** Add tests for the new functionality

```typescript
// Example test structure
```

### Step 4: Verify and commit

**Run:** `<test_command>`

**Commit:** `<suggested commit message>`

## Success Criteria

- [ ] <specific, verifiable criterion 1>
- [ ] <specific, verifiable criterion 2>
- [ ] <test_command> passes
- [ ] No regressions in existing functionality

## Anti-Goals (What NOT to do)

- Don't <common mistake to avoid>
- Don't <over-engineering trap>
- Stay focused on <the core goal>
```

**Key principles for the plan:**
- Exact file paths (not vague references)
- Code examples where helpful (not vague instructions)
- One action per step
- YAGNI: Don't add speculative features

### 8. Confirm and Offer Execution

```markdown
## Created: ralph-N

**Task:** <name>
**Plan:** `.ralph/ralph-N/plan.md`
**Verify:** `<test_command>`
**Iterations:** 15 max

### Ready to execute?
```

```json
{
  "questions": [{
    "question": "How would you like to proceed?",
    "header": "Execute",
    "options": [
      {"label": "Run autonomously", "description": "Start ralph.sh go N in terminal"},
      {"label": "Single iteration", "description": "Run one /ralph-go N cycle to test"},
      {"label": "Review first", "description": "I'll review the plan before running"},
      {"label": "Edit plan", "description": "I want to modify the plan first"}
    ],
    "multiSelect": false
  }]
}
```

## Important Rules

- **Context first:** Review project before asking questions
- **One question at a time:** Don't overwhelm with multiple questions
- **Explore before proposing:** Read code to inform the approach
- **Present options:** Always show 2-3 approaches with trade-offs
- **Be specific:** Exact file paths, code examples, verifiable criteria
- **YAGNI:** Prefer simpler solutions; don't over-engineer
- **Bite-sized steps:** Each step = one discrete action

## Example Session

```
User: /ralph-plan

Claude: I'm using the ralph-plan skill to create a task for autonomous execution.

Let me review your project first...

[Reads package.json, checks git log, explores structure]

I see this is a TypeScript CLI project using Bun, with tests in `tests/`.
No existing Ralph tasks.

What should Ralph accomplish?

User: Add a --verbose flag to show debug output

Claude: Got it. Let me explore how flags are currently handled...

[Reads CLI entry point, finds argument parsing]

I found flags are parsed in `src/cli.ts` using a simple args parser.
The logging module is in `src/logger.ts`.

Here are two approaches:

**Option A: Extend existing logger (Recommended)**
- Add a `setVerbose()` function to logger.ts
- Parse --verbose in cli.ts, call setVerbose()
- Pros: Minimal changes, uses existing patterns
- Cons: None significant
- Files: src/cli.ts, src/logger.ts, tests/cli.test.ts

**Option B: New debug module**
- Create separate debug.ts module
- Pros: Separation of concerns
- Cons: Over-engineering for a flag
- Files: src/debug.ts (new), src/cli.ts, tests/debug.test.ts

Which approach?

User: Option A

Claude: How should Ralph verify completion?

[Shows AskUserQuestion with detected test command]

User: bun test

Claude: [Creates detailed plan.md with steps]

## Created: ralph-1

**Task:** Add --verbose flag
**Plan:** `.ralph/ralph-1/plan.md`
**Verify:** `bun test`
**Iterations:** 15 max

How would you like to proceed?

[Shows execution options]
```
