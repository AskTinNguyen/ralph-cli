---
name: prd
description: "Generate a Product Requirements Document (PRD) for a new feature. Use when planning a feature, starting a new project, or when asked to create a PRD. Triggers on: create a prd, write prd for, plan this feature, requirements for, spec out."
version: 1.1.0
---

# PRD Generator

Create detailed Product Requirements Documents that are clear, actionable, and suitable for implementation.

---

## The Job

1. Receive a feature description from the user
2. Ask 3-5 essential clarifying questions (with lettered options)
3. Generate a structured PRD based on answers
4. Save to the path provided (typically `.ralph/PRD-N/prd.md`)

**Important:** Do NOT start implementing. Just create the PRD.

**Note:** When invoked via `ralph prd`, the save path is provided automatically. The system creates isolated PRD folders (PRD-1, PRD-2, etc.) to prevent overwrites.

---

## Step 1: Clarifying Questions

Ask only critical questions where the initial prompt is ambiguous. Focus on:

- **Problem/Goal:** What problem does this solve?
- **Core Functionality:** What are the key actions?
- **Scope/Boundaries:** What should it NOT do?
- **Success Criteria:** How do we know it's done?

### Format Questions Like This:

```
1. What is the primary goal of this feature?
   A. Improve user onboarding experience
   B. Increase user retention
   C. Reduce support burden
   D. Other: [please specify]

2. Who is the target user?
   A. New users only
   B. Existing users only
   C. All users
   D. Admin users only

3. What is the scope?
   A. Minimal viable version
   B. Full-featured implementation
   C. Just the backend/API
   D. Just the UI
```

This lets users respond with "1A, 2C, 3B" for quick iteration.

---

## Step 2: PRD Structure

Generate the PRD with these sections:

### 1. Introduction/Overview

Brief description of the feature and the problem it solves.

### 2. Goals

Specific, measurable objectives (bullet list).

### 3. User Stories

Each story needs:

- **Title:** Short descriptive name
- **Description:** "As a [user], I want [feature] so that [benefit]"
- **Acceptance Criteria:** Verifiable checklist of what "done" means

### Story Sizing Guidelines

Each story should be small enough to implement in one focused session. Use these heuristics:

- **3-5 acceptance criteria max** per story (split if more)
- **Single concern** - one file or tightly coupled set of files
- **~100-200 lines of code** typical upper bound
- **No more than 2 integration points** (e.g., API + database, not API + database + cache + queue)
- **Independently testable** - can verify without completing other stories

**Too big?** Split by layer (backend/frontend), by CRUD operation, or by user action.

**Format:**

```markdown
### US-001: [Title]

**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**

- [ ] Specific verifiable criterion
- [ ] Another criterion
- [ ] Example (if helpful): <input> -> <expected output>
- [ ] Negative case (if helpful): <bad input> -> <expected error/status>
- [ ] Canonical form (only if URLs/IDs are produced): <exact format>
- [ ] Typecheck/lint passes
- [ ] **[UI stories only]** Verify in browser using agent-browser
```

**Important:**

- Acceptance criteria must be verifiable, not vague. "Works correctly" is bad. "Button shows confirmation dialog before deleting" is good.
- Include explicit examples or negative cases when they clarify expected behavior.
- If the story produces URLs/IDs/links, specify the exact canonical form.
- **For any story with UI changes:** Always include "Verify in browser using agent-browser" as acceptance criteria. This ensures visual verification of frontend work.

### 4. Functional Requirements (Optional)

**When to include:** Use FRs for system-level constraints, cross-cutting concerns, or API contracts that span multiple stories. Skip this section if user stories already capture all requirements.

**FRs complement stories, they don't duplicate them:**

| User Stories | Functional Requirements |
|--------------|------------------------|
| Implementation-focused | Contract/constraint-focused |
| "As a user, I want..." | "The system must..." |
| Discrete, shippable units | Cross-cutting rules |
| Example: Add priority dropdown | Example: All API responses < 200ms |

**Format:**

- "FR-1: The system must allow users to..."
- "FR-2: All API endpoints must return errors in JSON format"
- "FR-3: Authentication tokens must expire after 24 hours"

**Skip FRs when:** All requirements are captured in user stories and there are no system-wide constraints to document.

### 5. Non-Goals (Out of Scope)

What this feature will NOT include. Critical for managing scope.

### 6. Design Considerations (Optional)

- UI/UX requirements
- Link to mockups if available
- Relevant existing components to reuse

### 7. Technical Considerations (Optional)

- Known constraints or dependencies
- Integration points with existing systems
- Performance requirements

### 8. Success Metrics

How will success be measured?

- "Reduce time to complete X by 50%"
- "Increase conversion rate by 10%"

### 9. Open Questions

Remaining questions or areas needing clarification.

### 10. Context (Auto-generated)

**Important:** After completing the Q&A phase, append a Context section to preserve the decision trail:

```markdown
## Context

### Clarifying Questions & Answers

1. **What is the primary goal?** → B. Increase user retention
2. **Who is the target user?** → C. All users
3. **What is the scope?** → A. Minimal viable version

### Assumptions Made

- Assumed existing auth system will be reused
- Assumed PostgreSQL database (based on existing schema)
```

This section helps future readers understand why decisions were made.

---

## Writing for Junior Developers

The PRD reader may be a junior developer or AI agent. Therefore:

- Be explicit and unambiguous
- Avoid jargon or explain it
- Provide enough detail to understand purpose and core logic
- Number requirements for easy reference
- Use concrete examples where helpful

---

## Handling Edge Cases

When user input is ambiguous or incomplete, follow these guidelines:

### Vague or Incomplete Answers

| Situation | Action |
|-----------|--------|
| User gives one-word answers | Ask one targeted follow-up, then proceed with reasonable defaults |
| User says "just do whatever" | State your assumptions explicitly in the PRD Overview, proceed |
| User skips questions | Use the most common/safe option, note it in Open Questions |
| Contradictory answers | Point out the conflict, ask which takes priority |

### Feature Conflicts

If the requested feature conflicts with existing code:

1. Note the conflict in **Technical Considerations**
2. Add a story for resolving the conflict (e.g., "US-001: Migrate legacy X to new pattern")
3. Document the migration path, don't just ignore it

### Scope Creep Prevention

If user keeps adding requirements during Q&A:

1. Capture everything mentioned
2. Prioritize into "v1" (this PRD) and "v2" (future PRD) in the Overview
3. Add v2 items to **Non-Goals** with note: "Planned for future iteration"

---

## Output

- **Format:** Markdown (`.md`)
- **Location:** Path provided by system (typically `.ralph/PRD-N/prd.md`)
- **Fallback:** `.agents/tasks/prd-[feature-name].md` if no path provided

---

## Example PRD

```markdown
# PRD: Task Priority System

## Introduction

Add priority levels to tasks so users can focus on what matters most. Tasks can be marked as high, medium, or low priority, with visual indicators and filtering to help users manage their workload effectively.

## Goals

- Allow assigning priority (high/medium/low) to any task
- Provide clear visual differentiation between priority levels
- Enable filtering and sorting by priority
- Default new tasks to medium priority

## User Stories

### US-001: Add priority field to database

**Description:** As a developer, I need to store task priority so it persists across sessions.

**Acceptance Criteria:**

- [ ] Add priority column to tasks table: 'high' | 'medium' | 'low' (default 'medium')
- [ ] Example: creating a task without a priority -> defaults to 'medium'
- [ ] Negative case: invalid priority 'urgent' -> validation error
- [ ] Generate and run migration successfully
- [ ] Typecheck passes

### US-002: Display priority indicator on task cards

**Description:** As a user, I want to see task priority at a glance so I know what needs attention first.

**Acceptance Criteria:**

- [ ] Each task card shows colored priority badge (red=high, yellow=medium, gray=low)
- [ ] Example: task with priority 'high' shows red badge
- [ ] Negative case: unknown priority value -> badge not shown + fallback text
- [ ] Priority visible without hovering or clicking
- [ ] Typecheck passes
- [ ] Verify in browser using agent-browser

### US-003: Add priority selector to task edit

**Description:** As a user, I want to change a task's priority when editing it.

**Acceptance Criteria:**

- [ ] Priority dropdown in task edit modal
- [ ] Shows current priority as selected
- [ ] Saves immediately on selection change
- [ ] Typecheck passes
- [ ] Verify in browser using agent-browser

### US-004: Filter tasks by priority

**Description:** As a user, I want to filter the task list to see only high-priority items when I'm focused.

**Acceptance Criteria:**

- [ ] Filter dropdown with options: All | High | Medium | Low
- [ ] Filter persists in URL params
- [ ] Empty state message when no tasks match filter
- [ ] Typecheck passes
- [ ] Verify in browser using agent-browser

## Functional Requirements

- FR-1: Add `priority` field to tasks table ('high' | 'medium' | 'low', default 'medium')
- FR-2: Display colored priority badge on each task card
- FR-3: Include priority selector in task edit modal
- FR-4: Add priority filter dropdown to task list header
- FR-5: Sort by priority within each status column (high to medium to low)

## Non-Goals

- No priority-based notifications or reminders
- No automatic priority assignment based on due date
- No priority inheritance for subtasks

## Technical Considerations

- Reuse existing badge component with color variants
- Filter state managed via URL search params
- Priority stored in database, not computed

## Success Metrics

- Users can change priority in under 2 clicks
- High-priority tasks immediately visible at top of lists
- No regression in task list performance

## Open Questions

- Should priority affect task ordering within a column?
- Should we add keyboard shortcuts for priority changes?
```

---

## Checklist

Before saving the PRD:

- [ ] Asked clarifying questions with lettered options (interactive mode)
- [ ] Incorporated user's answers into requirements
- [ ] User stories follow sizing guidelines (3-5 criteria, single concern)
- [ ] Each story has examples and/or negative cases
- [ ] Canonical URL/ID form specified when applicable
- [ ] UI stories include browser verification criterion
- [ ] Non-goals section defines clear boundaries
- [ ] Context section documents Q&A decisions and assumptions
- [ ] Saved to provided path (or `.ralph/PRD-N/prd.md`)
