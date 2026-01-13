---
name: ralph-new
description: Create a new Ralph task. Use when user says "ralph new", "create ralph task", "new ralph", or wants to set up a task for autonomous execution.
---

# Ralph New - Create Task

Create a new Ralph task for autonomous execution.

## Usage

```
/ralph-new <task description>
```

Examples:
- `/ralph-new Add user authentication`
- `/ralph-new Fix the login bug`
- `/ralph-new` (interactive mode)

## Your Process

### 1. Find Next Task ID

```bash
# List existing task directories
ls .ralph/

# Find highest ralph-N, increment
# If ralph-1, ralph-2 exist → create ralph-3
```

### 2. Create Task Directory

```bash
mkdir -p .ralph/ralph-N
```

### 3. Gather Information

If task description provided, use it. Otherwise ask using AskUserQuestion:

**Question 1: What to build**
```json
{
  "questions": [{
    "question": "What should this task accomplish?",
    "header": "Task",
    "options": [
      {"label": "New feature", "description": "Build something new"},
      {"label": "Bug fix", "description": "Fix existing issue"},
      {"label": "Refactor", "description": "Improve code structure"},
      {"label": "Other", "description": "Something else"}
    ],
    "multiSelect": false
  }]
}
```

**Question 2: Verification**
```json
{
  "questions": [{
    "question": "How should completion be verified?",
    "header": "Test",
    "options": [
      {"label": "bun test", "description": "Run unit tests"},
      {"label": "bun run verify", "description": "Typecheck + lint + tests"},
      {"label": "bun run build", "description": "Just verify it builds"}
    ],
    "multiSelect": false
  }]
}
```

### 4. Create plan.md

Write to `.ralph/ralph-N/plan.md`:

```markdown
---
task: <short name>
test_command: <from question 2>
completion_promise: "All tests pass and <task> is complete"
max_iterations: 15
---

# Task: <task name>

## Context
<description of what needs to be done>

## Success Criteria
- [ ] <criterion 1>
- [ ] <criterion 2>
- [ ] All tests pass
```

### 5. Create Empty State Files

```bash
echo "# Progress" > .ralph/ralph-N/progress.md
touch .ralph/ralph-N/errors.log
touch .ralph/ralph-N/activity.log
```

### 6. Create Guardrails (if first task)

If `.ralph/guardrails.md` doesn't exist, create it:

```markdown
# Guardrails

These constraints apply to ALL Ralph tasks.

## Safety Constraints (NEVER do these)

- Never push directly to main/master branch
- Never delete production data or drop database tables
- Never modify .env, credentials, or secret files
- Never run destructive commands (rm -rf, DROP DATABASE, etc.)
- Never commit API keys, tokens, or passwords
- Never disable tests or skip verification
- Never force push or rewrite git history

## Process Guidelines

- Study the codebase before making changes
- Search for existing implementations before creating new ones
- Run the test command before claiming completion
- Keep changes focused on the current task
- Commit frequently with descriptive messages
- Ask for human help when genuinely stuck (NEEDS_HUMAN)

## Project-Specific Rules

(Add your project's constraints here)
```

### 7. Output Result

```
Created task: ralph-N
  .ralph/ralph-N/plan.md

To start:
  /ralph-go N

Or edit the plan first:
  .ralph/ralph-N/plan.md
```

## Example

```
User: /ralph-new Add dark mode toggle

Claude: Creating ralph-1...

I need to know how to verify completion:
[Shows AskUserQuestion with test options]

User: bun run verify

Claude: Created task: ralph-1
  .ralph/ralph-1/plan.md

Task: Add dark mode toggle
Test: bun run verify
Max iterations: 15

To start: /ralph-go 1
```

## File Structure Created

```
.ralph/
├── guardrails.md        # Shared (created if missing)
└── ralph-N/
    ├── plan.md          # Task definition
    ├── progress.md      # Empty, ready for iterations
    ├── errors.log       # Empty
    └── activity.log     # Empty
```
