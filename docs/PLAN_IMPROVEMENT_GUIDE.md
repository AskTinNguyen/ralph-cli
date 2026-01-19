# Ralph CLI Plan Step Improvement Guide

Based on [How to Write a Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/) by Addy Osmani.

**Purpose:** This document identifies gaps in Ralph's plan step implementation and provides actionable improvements aligned with industry best practices for AI agent specifications.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current State Analysis](#current-state-analysis)
3. [Gap Analysis by Principle](#gap-analysis-by-principle)
4. [Improvement Roadmap](#improvement-roadmap)
5. [Implementation Details](#implementation-details)
6. [File Change Matrix](#file-change-matrix)

---

## Executive Summary

### What's Working Well

| Strength | Implementation |
|----------|----------------|
| High-level to detailed flow | PRD → Plan → Build pipeline |
| Code pattern extraction | Plans require 2-3 concrete examples from codebase |
| Quality scoring | `plan-reviewer.js` scores plans 0-100 |
| Task structure | Scope/Acceptance/Verification fields required |
| Lessons learned | `guardrails.md` captures failure patterns |

### Key Gaps to Address

| Gap | Impact | Priority |
|-----|--------|----------|
| No three-tier boundary system (✅⚠️🚫) | Agents may overstep or under-deliver | **High** |
| Missing Commands section | No copy-paste verification commands | **High** |
| Monolithic prompt (253 lines) | Context overload, performance drops | **Medium** |
| No explicit Testing section | Test expectations unclear | **Medium** |
| No Git Workflow section | Inconsistent commit practices | **Low** |
| No Project Structure section | Navigation ambiguity | **Low** |

---

## Current State Analysis

### Key Files in Plan Step

| File | Purpose | Lines |
|------|---------|-------|
| `.agents/ralph/PROMPT_plan.md` | Main planning prompt | 253 |
| `.agents/ralph/PROMPT_build.md` | Build execution prompt | ~400 |
| `lib/review/plan-reviewer.js` | Quality validation | 809 |
| `skills/prd/SKILL.md` | PRD generation skill | 354 |
| `.agents/ralph/loop.sh` | Execution engine | 4224 |

### Current Plan Template Structure

```
# Implementation Plan
├── ## Summary
├── ## Code Patterns (2-3 examples)
├── ## Tasks
│   └── ### US-XXX: Story Title
│       └── - [ ] Task
│           ├── Scope: what + where
│           ├── Acceptance: outcomes
│           └── Verification: commands
├── ## Notes
└── ## Skill Routing (frontend only)
```

### Current Quality Scoring (plan-reviewer.js)

| Dimension | Points | Current Checks |
|-----------|--------|----------------|
| Structure | 20 | Title, Summary, Tasks, headers |
| Task Quality | 30 | Scope/Acceptance/Verification fields |
| Code Patterns | 20 | Examples, project refs, error handling |
| Completeness | 15 | All PRD stories covered |
| Actionability | 15 | Executable commands, specific paths |

---

## Gap Analysis by Principle

### Principle 1: Structure Like a PRD (6 Sections)

**Article recommends these 6 essential sections:**

| Section | Article Description | Ralph Status | Gap |
|---------|---------------------|--------------|-----|
| **Commands** | Full executable commands with flags | ❌ Missing | No central command reference |
| **Testing** | Framework, locations, coverage | ⚠️ Partial | Buried in Verification fields |
| **Project Structure** | Explicit directory organization | ❌ Missing | No structure reference |
| **Code Style** | Real code examples | ✅ Present | Has Code Patterns section |
| **Git Workflow** | Branch naming, commits, PRs | ❌ Missing | Exists in skills/commit but not in plans |
| **Boundaries** | Always/Ask/Never tiers | ⚠️ Partial | Has rules but flat structure |

**Current in PROMPT_plan.md (lines 20-27):**
```markdown
## Rules (Non-Negotiable)

- Do NOT implement anything.
- Do NOT run tests or modify source code.
- Do NOT ask the user questions.
- Plan only.
- Do NOT assume missing functionality; confirm by reading code.
```

**Article recommends:**
```markdown
## Boundaries

### ✅ Always (No approval needed)
- Read any file in the codebase
- Run read-only git commands

### ⚠️ Ask First (Human review required)
- Changes to public APIs
- Database schema modifications

### 🚫 Never (Hard stops)
- Commit secrets
- Skip type checking
```

---

### Principle 2: Break Into Modular Prompts

**Article insight:** "Research confirms that excessive instructions cause performance drops significantly as requirements pile up."

**Current state:**
- `PROMPT_plan.md`: 253 lines (single monolithic file)
- `PROMPT_build.md`: ~400 lines (single monolithic file)
- All guidance loaded regardless of PRD type

**Article recommends:**
- Divide specs into focused components (backend/frontend)
- Create extended table-of-contents summaries
- Use subagents for specialized domains
- Feed only relevant spec sections per task

**Gap:** Ralph currently has PRD type detection (frontend/backend/full-stack) at lines 36-39 of PROMPT_plan.md, but still loads the entire prompt regardless.

---

### Principle 3: Build in Self-Checks & Constraints

**Article's three-tier boundary system:**

| Tier | Symbol | Purpose | Example |
|------|--------|---------|---------|
| Always | ✅ | No approval needed | Run tests, read files |
| Ask First | ⚠️ | Human review required | API changes, new deps |
| Never | 🚫 | Hard stops | Secrets, force push |

**Current implementation gaps:**

1. **No tiered boundaries** - Rules are binary (do/don't)
2. **No self-verification step** - Plans don't include review checklist
3. **No domain expertise injection** - Library pitfalls not documented

**Current guardrails.md approach:**
- Captures lessons learned post-failure
- Not proactively injected into planning

---

### Principle 4: Test, Iterate & Evolve

**Article recommends:**
- Automated conformance suites
- Context management systems
- Comprehensive logging of agent reasoning

**Current strengths:**
- `plan-reviewer.js` provides scoring
- `progress.md` tracks execution
- `guardrails.md` captures lessons

**Gaps:**
- No automated plan validation before build starts
- No feedback loop from build failures to plan improvements
- No living document guidance in plans

---

## Improvement Roadmap

### Phase 1: High Priority (Quick Wins)

#### 1.1 Add Three-Tier Boundary System

**Files to modify:**
- `.agents/ralph/PROMPT_plan.md`
- `.agents/ralph/PROMPT_build.md`

**Add this section to both prompts:**

```markdown
## Agent Boundaries

### ✅ Always (No approval needed)
- Read any file in the codebase
- Run read-only commands: `git status`, `git log`, `npm test`, `npm run build`
- Update progress.md after completing each task
- Reference existing code patterns before writing new code
- Run type checking before marking task complete

### ⚠️ Ask First (Requires human confirmation)
- Changes to public API signatures or contracts
- Database schema modifications or migrations
- Adding new external dependencies
- Deleting files or removing functionality
- Changes to authentication/authorization logic
- Modifications to CI/CD configuration

### 🚫 Never (Hard stops - will cause build failure)
- Commit secrets, API keys, or credentials
- Push directly to main/master branch
- Skip type checking or linting
- Assume missing functionality exists (verify by reading code)
- Modify files outside the project scope
- Use `--force` flags on git commands
- Disable or skip tests to make them pass
```

#### 1.2 Add Commands Section to Plan Template

**File to modify:** `.agents/ralph/PROMPT_plan.md`

**Add after Summary section in template:**

```markdown
## Commands Reference

Before starting implementation, document the project's key commands:

### Build & Development
- Build: `[exact command from package.json or Makefile]`
- Dev server: `[command]`
- Watch mode: `[command]`

### Testing
- Unit tests: `[command]`
- Integration tests: `[command]`
- E2E tests: `[command]`
- Coverage: `[command]`

### Quality
- Lint: `[command]`
- Type check: `[command]`
- Format: `[command]`

### Deployment (if applicable)
- Deploy staging: `[command]`
- Deploy production: `[command]`

**Agent instruction:** Extract these from package.json, Makefile, or project documentation. These commands will be used in task Verification fields.
```

#### 1.3 Update Plan Reviewer

**File to modify:** `lib/review/plan-reviewer.js`

**Add new check for Commands section:**

```javascript
// Add to checkPlanStructure function
const hasCommands = lines.some(line => /^## Commands/i.test(line));
if (hasCommands) {
  result.score += 3;
  result.checks.hasCommands = true;
} else {
  result.issues.push({
    severity: 'medium',
    type: 'missing_commands',
    message: 'Plan missing ## Commands section with executable commands'
  });
}

// Add to checkPlanStructure result.checks
hasCommands: false,
```

---

### Phase 2: Medium Priority (Structural Improvements)

#### 2.1 Modularize Prompts

**Current:** Single 253-line PROMPT_plan.md

**Proposed structure:**

```
.agents/ralph/prompts/
├── plan/
│   ├── base.md              # Core rules (50 lines)
│   ├── boundaries.md        # Three-tier system (30 lines)
│   ├── frontend.md          # Frontend-specific (40 lines)
│   ├── backend.md           # Backend-specific (40 lines)
│   ├── patterns.md          # Code pattern extraction (30 lines)
│   └── template.md          # Output format (40 lines)
├── build/
│   ├── base.md
│   ├── boundaries.md
│   ├── verification.md
│   └── commit.md
└── shared/
    ├── commands.md          # Reusable commands reference
    └── testing.md           # Testing strategy template
```

**Modification to loop.sh:**

```bash
# In render_prompt function, conditionally include modules
render_prompt() {
  local prd_type=$(detect_prd_type "$PRD_PATH")
  local base_prompt=$(cat "$PROMPTS_DIR/plan/base.md")
  local boundaries=$(cat "$PROMPTS_DIR/plan/boundaries.md")

  # Conditional inclusion based on PRD type
  case "$prd_type" in
    frontend)
      local specific=$(cat "$PROMPTS_DIR/plan/frontend.md")
      ;;
    backend)
      local specific=$(cat "$PROMPTS_DIR/plan/backend.md")
      ;;
    *)
      local specific=""
      ;;
  esac

  # Compose final prompt
  echo "$base_prompt"
  echo "$boundaries"
  echo "$specific"
  echo "$(cat "$PROMPTS_DIR/plan/template.md")"
}
```

#### 2.2 Add Testing Section

**Add to PROMPT_plan.md template:**

```markdown
## Testing Strategy

### Test Framework & Locations
- Framework: [Jest/Vitest/Pytest/etc.]
- Unit tests: `tests/unit/` or `**/*.test.ts`
- Integration tests: `tests/integration/`
- E2E tests: `tests/e2e/` or `cypress/`

### Coverage Requirements
- New code: Minimum 80% coverage
- Critical paths: 100% coverage required
- Existing pattern: See `tests/example.test.ts`

### Test Commands
- Run all: `npm test`
- Run specific: `npm test -- --grep "pattern"`
- Watch mode: `npm test -- --watch`
- Coverage report: `npm test -- --coverage`

### Testing Patterns (from codebase)
```[language]
// Example test from actual project
// Found in: tests/example.test.ts
describe('FeatureName', () => {
  it('should handle expected case', () => {
    // Test pattern used in this project
  });
});
```

**Agent instruction:** Extract testing patterns from actual test files. Use these patterns for new tests.
```

#### 2.3 Add Git Workflow Section

**Add to PROMPT_plan.md template:**

```markdown
## Git Workflow

### Branch Naming
- Feature: `feature/US-XXX-short-description`
- Bugfix: `fix/US-XXX-short-description`
- Refactor: `refactor/US-XXX-short-description`

### Commit Format
Use conventional commits (enforced by `/commit` skill):
- `feat(scope): add new feature`
- `fix(scope): resolve bug`
- `refactor(scope): improve code structure`
- `test(scope): add tests`
- `docs(scope): update documentation`

### Commit Granularity
- One commit per story minimum
- Atomic commits (each commit should pass tests)
- Use `/commit` skill for message generation

### PR Requirements (if applicable)
- Title: `[US-XXX] Story title`
- Description: Summary of changes
- Tests: All passing
- Review: Required before merge
```

---

### Phase 3: Low Priority (Polish)

#### 3.1 Add Project Structure Section

**Add to PROMPT_plan.md template:**

```markdown
## Project Structure Reference

Document the project's directory layout before planning:

```
project/
├── src/           # Source code
│   ├── components/  # UI components
│   ├── services/    # Business logic
│   ├── utils/       # Shared utilities
│   └── types/       # TypeScript types
├── tests/         # Test files
├── docs/          # Documentation
└── config/        # Configuration files
```

**Key locations:**
- Entry point: `src/index.ts`
- Routes/API: `src/routes/` or `src/api/`
- Shared types: `src/types/`
- Test helpers: `tests/helpers/`

**Agent instruction:** Map your tasks to specific directories. Reference existing files in the same directory for patterns.
```

#### 3.2 Add Self-Review Checklist

**Add to end of PROMPT_plan.md:**

```markdown
## Self-Review Checklist (Agent must verify before completing)

Before finalizing the plan, verify:

### Structure
- [ ] Plan has Summary, Code Patterns, Tasks, Notes sections
- [ ] Each story from PRD has corresponding tasks
- [ ] No orphaned tasks (all tasks under a story header)

### Task Quality
- [ ] Every task has Scope, Acceptance, Verification
- [ ] Verification commands are copy-paste executable
- [ ] Tasks reference specific file paths (not "the auth file")
- [ ] Tasks are independently shippable (no hidden dependencies)

### Boundaries Compliance
- [ ] No tasks require ⚠️ Ask First actions without noting it
- [ ] No tasks violate 🚫 Never rules
- [ ] High-risk tasks explicitly flagged

### Completeness
- [ ] All incomplete PRD stories have tasks
- [ ] Commands section filled from package.json/Makefile
- [ ] Testing strategy documented
- [ ] Code patterns extracted from actual codebase (not generic)
```

---

## Implementation Details

### Change 1: Three-Tier Boundaries

**File:** `.agents/ralph/PROMPT_plan.md`

**Location:** After line 27 (after current Rules section)

**Action:** Replace current "Rules (Non-Negotiable)" with structured boundaries

**Before (lines 20-27):**
```markdown
## Rules (Non-Negotiable)

- Do NOT implement anything.
- Do NOT run tests or modify source code.
- Do NOT ask the user questions.
- Plan only.
- Do NOT assume missing functionality; confirm by reading code.
- Treat shared utilities (if present) as the standard library; prefer existing patterns over ad-hoc copies.
```

**After:**
```markdown
## Agent Boundaries

### Plan Mode Constraints
- Do NOT implement anything
- Do NOT run tests or modify source code
- Do NOT ask the user questions
- Plan only

### ✅ Always (No approval needed)
- Read any file in the codebase
- Inspect package.json, Makefile, or build configs
- Document existing code patterns
- Reference guardrails.md for known issues

### ⚠️ Ask First (Flag in plan if required)
- Tasks involving public API changes
- Database schema modifications
- New external dependencies
- File deletions

### 🚫 Never (Hard stops)
- Assume missing functionality exists (verify by reading code)
- Create generic examples (use actual project code)
- Skip code pattern analysis
- Plan tasks without verification commands
```

---

### Change 2: Commands Section Template

**File:** `.agents/ralph/PROMPT_plan.md`

**Location:** Add to "Implementation Plan Format" section (after line 125)

**Add:**
```markdown
## Commands Reference (Required)

Extract from package.json, Makefile, or project docs:

### Build & Test
- Build: `[command]`
- Test: `[command]`
- Lint: `[command]`
- Type check: `[command]`

### Development
- Dev server: `[command]`
- Watch: `[command]`

**Note:** These commands will be referenced in task Verification fields. Verify they work before including.
```

---

### Change 3: Plan Reviewer Updates

**File:** `lib/review/plan-reviewer.js`

**Add new checks:**

```javascript
// 1. Add to checkPlanStructure (around line 195)
// Check for Commands section (3 points)
const hasCommands = lines.some(line => /^##\s*Commands/i.test(line));
if (hasCommands) {
  result.score += 3;
  result.checks.hasCommands = true;
} else {
  result.issues.push({
    severity: 'medium',
    type: 'missing_commands',
    message: 'Plan missing ## Commands section'
  });
}

// 2. Add to checkPlanStructure result.checks object (around line 155)
hasCommands: false,

// 3. Add to generateRecommendations (around line 700)
if (!result.breakdown.structure.checks.hasCommands) {
  recommendations.push({
    priority: 'medium',
    message: 'Add ## Commands section with build/test/lint commands from package.json'
  });
}
```

**Adjust scoring:** Reduce other structure points by 3 to accommodate (or increase max to 23).

---

## File Change Matrix

| File | Change Type | Priority | Effort |
|------|-------------|----------|--------|
| `.agents/ralph/PROMPT_plan.md` | Modify | High | Low |
| `.agents/ralph/PROMPT_build.md` | Modify | High | Low |
| `lib/review/plan-reviewer.js` | Modify | Medium | Low |
| `.agents/ralph/prompts/` (new dir) | Create | Medium | Medium |
| `.agents/ralph/loop.sh` | Modify | Medium | Medium |
| `skills/prd/SKILL.md` | Modify | Low | Low |

### Detailed File Changes

#### `.agents/ralph/PROMPT_plan.md`

| Section | Line Range | Change |
|---------|------------|--------|
| Rules | 20-27 | Replace with three-tier boundaries |
| Plan Format | 125-165 | Add Commands section template |
| Plan Format | 165+ | Add Testing section template |
| Plan Format | 165+ | Add Git Workflow section |
| End of file | 250+ | Add Self-Review Checklist |

#### `.agents/ralph/PROMPT_build.md`

| Section | Change |
|---------|--------|
| Rules | Add matching three-tier boundaries |
| Verification | Reference Commands section from plan |

#### `lib/review/plan-reviewer.js`

| Function | Change |
|----------|--------|
| `checkPlanStructure` | Add Commands section check (+3 points) |
| `checkPlanStructure` | Add Testing section check (+2 points) |
| `generateRecommendations` | Add recommendations for new sections |

---

## Validation Criteria

After implementing changes, verify:

1. **New plans include Commands section** with actual project commands
2. **Boundaries are three-tiered** with ✅⚠️🚫 symbols
3. **Plan reviewer scores** include new section checks
4. **Agent behavior** respects boundary tiers during build
5. **No regression** in existing plan quality scores

---

## References

- [How to Write a Good Spec for AI Agents](https://addyosmani.com/blog/good-spec/) - Addy Osmani
- [good-spec-cheatsheet.md](./good-spec-cheatsheet.md) - Quick reference
- Current implementation: `.agents/ralph/PROMPT_plan.md`
- Quality reviewer: `lib/review/plan-reviewer.js`
