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

Before suggesting test commands:
1. Check for user-added testing skills in `.claude/skills/` (e.g., `unreal-testing/`, `unity-testing/`)
2. Detect project type from build files (package.json, Cargo.toml, CMakeLists.txt, etc.)
3. Propose appropriate test commands and acceptance criteria based on findings

For frontend/web UI tasks, include visual verification options using Playwright MCP tools.

If custom testing skills exist, incorporate their guidance into the verification proposal.

### 3. Explore Codebase (If Needed)

Based on answers, explore relevant code to inform the plan.

### 4. Create Task Files

**Create directory and guardrails.md (if first task).**

**Create plan.md:**
```markdown
---
task: <short descriptive name>
test_command: <appropriate for project type>
completion_promise: "<specific success statement>"
max_iterations: 15
visual_verification: false  # Set true for frontend tasks
---

# Task: <task name>

## Context
<what needs to be done and why>

## Success Criteria
- [ ] <specific, verifiable criterion 1>
- [ ] <specific, verifiable criterion 2>
- [ ] All tests pass

## Relevant Files
<files discovered during exploration>
```

For frontend tasks with visual verification, set `visual_verification: true` and create the screenshots directory:
```bash
mkdir -p .ralph/ralph-N/screenshots
```

### 5. Confirm and Guide

```
Created task: ralph-N
Plan saved to: .ralph/ralph-N/plan.md
To start: /ralph-go N
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
