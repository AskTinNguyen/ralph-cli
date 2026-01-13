# Planning

You are an autonomous coding agent. Your task is to create or update an implementation plan based on the PRD and existing code.

## Paths
- PRD: {{PRD_PATH}}
- Implementation Plan: {{PLAN_PATH}}
- AGENTS (optional): {{AGENTS_PATH}}
- Progress Log: {{PROGRESS_PATH}}
- Guardrails: {{GUARDRAILS_PATH}}
- Guardrails Reference: {{GUARDRAILS_REF}}
- Context Reference: {{CONTEXT_REF}}
- Errors Log: {{ERRORS_LOG_PATH}}
- Activity Log: {{ACTIVITY_LOG_PATH}}
- Repo Root: {{REPO_ROOT}}

## Rules (Non-Negotiable)
- Do NOT implement anything.
- Do NOT run tests or modify source code.
- Do NOT ask the user questions.
- Plan only.
- Do NOT assume missing functionality; confirm by reading code.
- Treat shared utilities (if present) as the standard library; prefer existing patterns over ad-hoc copies.

## Your Task (Do this in order)
1. Read the PRD at {{PRD_PATH}}.
2. Read {{GUARDRAILS_PATH}} for known failure modes (follow them while planning).
3. If {{AGENTS_PATH}} exists, read it for project-specific commands/patterns.
4. Inspect relevant code to compare reality vs requirements. Do not assume missing functionality.
5. Look for TODOs, placeholders, skipped/flaky tests, and inconsistent patterns.
6. Ensure each story heading in the PRD uses the exact marker format: `### [ ] US-XXX: Story Title` (checked stories: `### [x] ...`).
   - If the markers are incorrect, update {{PRD_PATH}} to fix only the heading markers (do not change meaning).
   - Ensure a short **Routing Policy** section exists in the PRD; add it if missing (see template below).
7. Create or update {{PLAN_PATH}} with a prioritized task list, grouped by story.

## Implementation Plan Format (Required)
Use a simple markdown structure with self-contained tasks grouped by story:

- Each story has its own section: `### US-XXX: Story Title`.
- Use the exact story IDs/titles from the PRD.
- Each task is a single checkbox item `- [ ]`.
- Each task must be self-contained and independently shippable.
- Each task must include **what**, **where**, and **verification**.

Example task format:

- [ ] Task title
  - Scope: what you will change and where (files/modules)
  - Acceptance: concrete outcomes to verify
  - Verification: exact command(s) to run

Also include a short summary at the top:

# Implementation Plan

## Summary
- Brief overview of gaps and the next most important work

## Tasks
### US-XXX: Story Title
- [ ] ...

## Notes
- Discoveries, risks, or clarifications

## Output
- Update {{PLAN_PATH}}.
- You may also update {{PRD_PATH}} only to fix story heading markers and to add/maintain the **Routing Policy** section.

## Additional Guardrails
- Plan only. No implementation.
- Keep tasks ordered by priority of missing work.
- If you discover a missing requirement, note it under **Notes** and add a task.

## Routing Policy Template (PRD)
Add this section to the PRD if missing (keep it short and explicit):

## Routing Policy
- Commit URLs are invalid.
- Unknown GitHub subpaths canonicalize to repo root.
