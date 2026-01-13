---
name: ralph-plan
description: Interactive task planning for Ralph CLI. Use when user says "ralph plan", "plan a task for ralph", "plan ralph task", or wants to interactively define a task for autonomous execution.
---

# Ralph Task Planning

Interactively create a task for Ralph autonomous execution.

## Usage

```
/ralph-plan [task-id]
```

- `/ralph-plan` - Create new task with next available ID
- `/ralph-plan 1` - Plan/edit existing ralph-1

## Your Process

### 1. Determine Task ID

If no ID provided:
```bash
# Find next available ID
ls .ralph/  # Look for ralph-N directories
# Next = highest N + 1, or ralph-1 if none exist
```

If ID provided, check if task exists:
- Exists → Show current plan, ask what to change
- Doesn't exist → Create new

### 2. Gather Information (One Question at a Time)

**Question 1: What to build**
```json
{
  "questions": [{
    "question": "What should Ralph accomplish?",
    "header": "Goal",
    "options": [
      {"label": "New feature", "description": "Build new functionality"},
      {"label": "Bug fix", "description": "Fix an existing issue"},
      {"label": "Refactor", "description": "Improve code structure"},
      {"label": "Tests", "description": "Add or improve tests"}
    ],
    "multiSelect": false
  }]
}
```

**Question 2: Scope**
```json
{
  "questions": [{
    "question": "What area of the codebase?",
    "header": "Scope",
    "options": [
      {"label": "Frontend", "description": "UI components, pages"},
      {"label": "Backend", "description": "API, database, server"},
      {"label": "Full stack", "description": "Both frontend and backend"},
      {"label": "Tooling", "description": "Build, CI, developer experience"}
    ],
    "multiSelect": false
  }]
}
```

**Question 3: Verification**
```json
{
  "questions": [{
    "question": "How should completion be verified?",
    "header": "Test",
    "options": [
      {"label": "bun run verify (Recommended)", "description": "Full typecheck + lint + tests"},
      {"label": "bun test", "description": "Just run tests"},
      {"label": "bun run build", "description": "Verify it compiles"}
    ],
    "multiSelect": false
  }]
}
```

### 3. Explore Codebase (If Needed)

Based on answers, explore relevant code:
```bash
# Example for frontend feature
Glob: src/components/**/*.tsx
Grep: pattern relevant to task
Read: key files
```

### 4. Create Task Files

**Create directory:**
```bash
mkdir -p .ralph/ralph-N
```

**Create guardrails.md (if first task):**
```markdown
# Guardrails

## Safety Constraints (NEVER do these)
- Never push directly to main/master
- Never delete production data
- Never commit secrets/credentials
- Never skip tests

## Process Guidelines
- Study code before changing it
- Run tests before claiming done
- Keep changes focused
```

**Create plan.md:**
```markdown
---
task: <short descriptive name>
test_command: <from question 3>
completion_promise: "<specific success statement>"
max_iterations: 15
---

# Task: <task name>

## Context
<what needs to be done and why, based on codebase exploration>

## Success Criteria
- [ ] <specific, verifiable criterion 1>
- [ ] <specific, verifiable criterion 2>
- [ ] <specific, verifiable criterion 3>
- [ ] All tests pass

## Relevant Files
<files discovered during exploration>

## Notes
<any important context from the conversation>
```

**Create empty state files:**
```bash
echo "# Progress\n" > .ralph/ralph-N/progress.md
touch .ralph/ralph-N/errors.log
```

### 5. Confirm and Guide

```
Created task: ralph-N

Plan saved to: .ralph/ralph-N/plan.md

To start autonomous execution:
  /ralph-go N

To preview the plan:
  Read .ralph/ralph-N/plan.md

To edit before starting:
  Edit .ralph/ralph-N/plan.md
```

## Important Rules

- **Ask ONE question at a time** using AskUserQuestion
- **Wait for each answer** before proceeding
- **Explore the codebase** to write informed success criteria
- **Be specific** in criteria - vague criteria lead to failed tasks
- **Keep max_iterations reasonable** (10-20 for most tasks)

## Example Session

```
User: /ralph-plan

Claude: What should Ralph accomplish?
[Shows AskUserQuestion]

User: New feature

Claude: What area of the codebase?
[Shows AskUserQuestion]

User: Backend

Claude: Let me explore the backend structure...
[Reads relevant files]

Claude: How should completion be verified?
[Shows AskUserQuestion]

User: bun run verify

Claude: Created task: ralph-1

Plan saved to: .ralph/ralph-1/plan.md

Task: <inferred from conversation>
Test: bun run verify
Max iterations: 15

To start: /ralph-go 1
```
