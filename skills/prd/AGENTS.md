# PRD Skill - Agent Guide

**Quick Reference for AI Agents**

The PRD skill generates Product Requirements Documents through an interactive Q&A workflow. This guide covers critical rules, workflow patterns, and quality standards.

---

## What is the PRD Skill?

The PRD skill creates structured requirements documents by:
1. Asking 3-5 clarifying questions with lettered options
2. Generating user stories with acceptance criteria
3. Saving to `.ralph/PRD-N/prd.md` (auto-incremented)

**Purpose:** Define WHAT to build (not HOW) in a format suitable for implementation agents.

---

## Critical Rule: ALWAYS Use `--headless` Flag

### ⚠️ Nested Agent Interaction Warning

When Claude Code (or another AI agent) executes `ralph prd`, it invokes a nested agent (Claude, Codex, or Droid). Without `--headless`, both agents try to interact with the same TTY, causing:

- **Deadlocks** - Both agents waiting for input
- **TTY conflicts** - Overlapping I/O streams
- **Process hangs** - Commands never complete
- **Unpredictable output** - Garbled or missing responses

### ✅ CORRECT Usage (Agent Context)

```bash
ralph prd "Feature description" --headless
```

### ❌ INCORRECT Usage (Causes Conflicts)

```bash
ralph prd "Feature description"  # Missing --headless flag
```

### When to Use `--headless`

- ✅ Claude Code agent calling ralph
- ✅ UI server triggering PRD generation
- ✅ CI/CD pipelines and automation scripts
- ✅ Background jobs and daemons
- ✅ Any context where stdin is not an interactive terminal

**Note:** Human users running `ralph prd` in a terminal do NOT need `--headless` (interactive mode is default).

---

## PRD Generation Workflow

### Step 1: Ask Clarifying Questions

Ask 3-5 essential questions with lettered options (A, B, C, D). Focus on:

- **Problem/Goal:** What problem does this solve?
- **Core Functionality:** What are the key actions?
- **Scope/Boundaries:** What should it NOT do?
- **Success Criteria:** How do we know it's done?

**Example Format:**
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
```

This lets users respond with "1A, 2C" for quick iteration.

### Step 2: Generate PRD Structure

1. **Introduction/Overview** - Brief description and problem statement
2. **Goals** - Specific, measurable objectives
3. **User Stories** - Sized appropriately (see below)
4. **Functional Requirements** - Optional (only for cross-cutting concerns)
5. **Non-Goals** - What's explicitly out of scope
6. **Success Metrics** - How success is measured
7. **Context** - Q&A trail and assumptions made

### Step 3: Save PRD

- **Format:** Markdown (`.md`)
- **Location:** `.ralph/PRD-N/prd.md` (provided automatically)
- **Isolation:** Each PRD in its own folder (PRD-1, PRD-2, etc.)

---

## Story Sizing Guidelines

Each user story should be implementable in one focused session.

**Heuristics:**
- **3-5 acceptance criteria max** per story (split if more)
- **Single concern** - one file or tightly coupled set of files
- **~100-200 lines of code** typical upper bound
- **No more than 2 integration points** (e.g., API + database, not API + database + cache + queue)
- **Independently testable** - can verify without completing other stories

**Split stories when:**
- More than 5 acceptance criteria
- Multiple layers involved (backend + frontend + database)
- Multiple integration points (API + cache + queue + auth)

**Story Format:**
```markdown
### US-001: [Title]

**Description:** As a [user], I want [feature] so that [benefit].

**Acceptance Criteria:**

- [ ] Specific verifiable criterion
- [ ] Another criterion with example: <input> -> <expected output>
- [ ] Negative case: <bad input> -> <expected error>
- [ ] Canonical form (if URLs/IDs produced): <exact format>
- [ ] Typecheck/lint passes
- [ ] **[UI stories only]** Verify in browser using agent-browser
```

---

## Quality Standards

### Acceptance Criteria Requirements

**✅ GOOD (Specific & Verifiable):**
- "Button shows confirmation dialog before deleting"
- "API returns 404 for non-existent resource"
- "Search results update within 200ms"

**❌ BAD (Vague):**
- "Works correctly"
- "User can search"
- "Handles errors properly"

### Tech-Agnostic PRDs

Ralph works across Python, JavaScript, Go, Rust, Java, etc. PRDs should be:

- ✅ **Tech-agnostic** - No prescriptive stacks ("Use TypeScript interfaces" → "Define data types per project language")
- ✅ **Auto-detect context** - Agent reads project files (package.json, Cargo.toml, etc.)
- ✅ **Project-specific commands** - "npm test" for JS, "pytest" for Python, not generic "run tests"
- ✅ **PRD = WHAT, Plan = HOW** - Keep implementation details out of PRDs

### Examples and Edge Cases

Always include in acceptance criteria:
- **Explicit examples:** `creating task without priority -> defaults to 'medium'`
- **Negative cases:** `invalid priority 'urgent' -> validation error`
- **Canonical forms:** `URL format: /tasks/{uuid}` (when producing IDs/links)

### Browser Verification (UI Stories)

For any story with UI changes, ALWAYS include:
```markdown
- [ ] Verify in browser using agent-browser
```

This ensures visual verification of frontend work.

---

## Common Pitfalls

### ❌ Scope Creep

**Problem:** User keeps adding requirements during Q&A.

**Solution:**
1. Capture everything mentioned
2. Prioritize into "v1" (this PRD) and "v2" (future PRD)
3. Add v2 items to **Non-Goals** with note: "Planned for future iteration"

### ❌ Implementation Details in PRDs

**Problem:** PRD specifies HOW instead of WHAT.

**Examples:**
- ❌ "Use Redux for state management"
- ❌ "Create a React component with hooks"
- ✅ "Store user preferences persistently"
- ✅ "Display user settings in editable form"

**Solution:** Keep PRDs focused on requirements and outcomes. Let the plan specify implementation.

### ❌ Vague Commands

**Problem:** "Run tests" without project-specific context.

**Solution:**
- Detect tech stack from project files
- Use specific commands: `npm test -- --testPathPattern=auth` (JS), `pytest tests/test_auth.py` (Python)

### ❌ Missing Context Section

**Problem:** Future readers don't know why decisions were made.

**Solution:** Always append Context section with Q&A trail and assumptions:
```markdown
## Context

### Clarifying Questions & Answers

1. **What is the primary goal?** → B. Increase user retention
2. **Who is the target user?** → C. All users

### Assumptions Made

- Assumed existing auth system will be reused
- Assumed PostgreSQL database (based on existing schema)
```

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **Full Skill Reference:** [SKILL.md](SKILL.md) - Complete PRD skill documentation
- **CLAUDE.md:** [PRD Command Modes section](../../CLAUDE.md#prd-command-modes) - Interactive vs headless mode
- **Agent Guide (Web):** http://localhost:3000/docs/agent-guide.html - Interactive decision trees

---

## Summary

**Key Takeaways:**

1. **ALWAYS use `--headless` flag** when Claude Code agent executes `ralph prd`
2. **Ask 3-5 clarifying questions** with lettered options for quick responses
3. **Size stories appropriately** - 3-5 criteria, single concern, ~100-200 LOC
4. **Be tech-agnostic** - PRD defines WHAT, plan defines HOW
5. **Include examples** - Explicit examples, negative cases, canonical forms
6. **UI stories need browser verification** - Add agent-browser criterion
7. **Document context** - Append Q&A trail and assumptions to PRD
