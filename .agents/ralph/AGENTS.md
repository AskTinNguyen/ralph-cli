# Build Loop - Agent Guide

**Quick Reference for Build Loop Agents**

This guide is for AI agents executing within the Ralph build loop (`loop.sh`). It covers the workflow, critical rules, and troubleshooting for story implementation.

---

## What is the Build Loop?

The Ralph build loop (`loop.sh`) executes stories from a plan in iterations. Each iteration:

1. **Picks** the next unchecked story from `plan.md`
2. **Implements** the story's acceptance criteria
3. **Commits** changes to git
4. **Marks** the story as done in PRD and plan
5. **Logs** progress to `progress.md`

**Key principle:** The loop is stateless - each iteration reads files, does work, writes results.

---

## Build Loop Workflow

### Iteration Steps (Sequential)

1. **Read guardrails** - Check `.ralph/guardrails.md` for lessons learned
2. **Read error log** - Review `.ralph/PRD-N/errors.log` for repeated failures
3. **Read PRD** - Understand the full requirement
4. **Read plan** - Locate your story section (`### US-XXX: ...`)
5. **Check skill routing** - If plan specifies `/frontend-design` for this story, invoke it immediately
6. **Audit files** - Read all necessary code to understand context
7. **Follow AGENTS.md** - If `.agents/AGENTS.md` exists, follow its build/test instructions
8. **Implement story** - Complete all tasks for the assigned story ONLY
9. **Run verification** - Execute commands listed in acceptance criteria
10. **Update plan** - Mark tasks `[x]` in your story section
11. **Update PRD** - Check all acceptance criteria `[x]`, then mark story heading `[x]`
12. **Commit changes** - Use `$commit` skill, include AUTO_FIX entries from activity log
13. **Log progress** - Append entry to `progress.md` with run/commit/test details

### Completion Signal

Only output `<promise>COMPLETE</promise>` when **all stories** in the PRD are marked `[x]`. Completing your assigned story is NOT sufficient unless it was the last remaining story.

---

## Critical Rules for Build Agents

### ✅ DO:

1. **Implement only the assigned story** - Do not change unrelated code
2. **Commit all changes** - Git commits are the source of truth, not checkboxes
3. **Verify before marking done** - Run tests/commands from acceptance criteria
4. **Update both PRD and plan** - Check criteria first, then story heading
5. **Read before implementing** - Audit files to avoid duplicating existing functionality
6. **Follow AGENTS.md instructions** - Project-specific build/test commands
7. **Log to progress.md** - Include commit hash, verification results, files changed

### ❌ DON'T:

1. **Never auto-merge** - Do NOT run `ralph stream merge` or create PRs
2. **Don't assume missing functionality** - Read the code first
3. **Don't use placeholders** - Implement completely, no stubs
4. **Don't trust checkboxes alone** - Git commits = proof of work
5. **Don't skip verification** - Tests must actually pass
6. **Don't ask user questions** - Build agents run autonomously
7. **Don't change scope** - Stick to the assigned story

### Git Commit Requirements

**Every iteration MUST commit if changes were made:**

```bash
# Stage everything
git add -A

# Check for AUTO_FIX entries in activity log
grep "AUTO_FIX" .ralph/PRD-N/activity.log | tail -5

# Commit using $commit skill
# Include AUTO_FIX summary in commit body if found

# Verify clean working tree
git status --porcelain  # Should be empty

# Capture commit details
git show -s --format="%h %s" HEAD
```

**No-commit mode:** If `{{NO_COMMIT}}` is true, skip committing but note it in progress entry.

---

## Story Implementation Pattern

### 1. Assess Complexity

Before implementation, assess story complexity (1-10 scale):

- **Low (1-3):** Simple fixes, docs, typos, single-file changes
- **Medium (4-7):** Features, refactoring, multi-file changes
- **High (8-10):** Architecture changes, complex integrations, new systems

### 2. Model Selection (Claude Agent Only)

**Model routing is only available for Claude agents.** If using Codex or Droid, model selection is handled by the provider.

For Claude agents, the build loop selects models based on complexity:

| Complexity | Score | Default Model | Use Case |
|------------|-------|---------------|----------|
| **Low** | 1-3 | Haiku | Simple fixes, docs, typos |
| **Medium** | 4-7 | Sonnet | Features, refactoring |
| **High** | 8-10 | Opus | Architecture, complex changes |

**Configuration:**
- Set in `.agents/ralph/config.sh`
- Override with `ralph build --model=opus`
- Disable routing: `RALPH_ROUTING_ENABLED=false`

**Note:** Codex and Droid agents automatically disable model routing. If you see a warning about model routing with non-Claude agents, it's informational only.

### 3. Iteration Strategy

- **Start simple:** Implement core functionality first
- **Test incrementally:** Verify each piece works before moving on
- **Commit atomically:** One logical change per commit
- **Update docs:** Capture why, not just what

---

## Progress Entry Format

Append to `progress.md` after each iteration:

```markdown
## [Date/Time] - US-XXX: Story Title
Thread: [agent session id if available]
Run: RUN_ID (iteration N)
Run log: .ralph/PRD-N/runs/run-TIMESTAMP.log
Run summary: .ralph/PRD-N/runs/run-TIMESTAMP-meta.json
- Guardrails reviewed: yes
- No-commit run: true/false
- Commit: abc1234 feat(US-XXX): ... (or `none` + reason)
- Post-commit status: clean (or list remaining files)
- Verification:
  - npm test -> PASS
  - npm run lint -> PASS
- Files changed:
  - src/component.js
  - tests/component.test.js
- What was implemented
- **Learnings for future iterations:**
  - Patterns discovered
  - Gotchas encountered
  - Useful context
---
```

---

## Troubleshooting

### Build Hangs or Fails

**Check lock files:**
```bash
ls -la .ralph/locks/
```

**Remove stale lock (only if process truly dead):**
```bash
rm .ralph/locks/PRD-N.lock
```

**Check error logs:**
```bash
cat .ralph/PRD-N/errors.log
tail -n 50 .ralph/PRD-N/runs/run-*.log
```

### Story Selection Timeout

**Problem:** Lock timeout waiting for story selection.

**Solution:**
1. Check for active processes: `ps aux | grep loop.sh`
2. Remove stale lock if no process found
3. Retry build: `ralph stream build N`

### Rollback Failed

**Problem:** Rollback failed after build error.

**Solution:**
1. Check git status: `git status`
2. Manually reset if needed: `git reset --hard HEAD`
3. Report error: Reference `RALPH-202` in progress.md

### Progress Markers Out of Sync

**Problem:** Checkboxes marked but no commits found.

**Solution:**
1. Verify via git: `git log --grep="PRD-N"`
2. If no commits, status = "in_progress" (work not committed)
3. Run verification: `ralph stream verify-status`

---

## Skill Routing (Frontend Stories)

Before implementing, check if `plan.md` contains a "Skill Routing" section.

**When to invoke `/frontend-design` skill:**
1. Plan's "Skill Routing" section lists `/frontend-design` for this story
2. Plan marks PRD as "Frontend" or "Full-stack" type
3. Story involves UI components, pages, layouts, or visual elements

**How to invoke:**
```
/frontend-design
```

This skill creates distinctive, production-grade frontend interfaces with high design quality.

**Detection pattern in plan.md:**
```markdown
## Skill Routing

**PRD Type**: Frontend | Full-stack

**Required Skills**:
- `/frontend-design` - Use for stories: US-XXX, US-YYY (or "ALL stories")
```

If your story is listed, invoke the skill before implementation.

---

## Browser Testing (Frontend Stories)

If the story changes UI, you MUST verify in the browser:

1. Use `agent-browser` CLI tool for browser automation
2. Navigate to the relevant page
3. Verify the UI changes work as expected
4. Take a screenshot if helpful for progress log

**A frontend story is NOT complete until browser verification passes.**

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **Build Prompt:** [PROMPT_build.md](PROMPT_build.md) - Full build loop prompt
- **CLAUDE.md:** [Model Routing section](../../CLAUDE.md#model-routing-configuration) - Complexity tiers and configuration
- **Error Codes:** `ralph error RALPH-XXX` - Lookup error remediation

---

## Summary

**Key Takeaways for Build Loop Agents:**

1. **Follow the workflow** - Read → Implement → Verify → Commit → Log
2. **Implement only assigned story** - No scope changes
3. **Git commits = proof** - Checkboxes are just hints
4. **Verify before marking done** - Tests must actually pass
5. **Never auto-merge** - Humans handle `ralph stream merge`
6. **Update progress.md** - Include commit hash, verification, learnings
7. **Invoke skills when needed** - Check for skill routing in plan
