# Ralph CLI - Agent Guide

**Quick Reference for AI Agents**

Ralph is an autonomous coding loop for Claude Code, Codex, and other AI agents. This guide provides critical rules, decision trees, and common patterns for working with Ralph.

---

## Quick Start

Ralph uses a PRD-based workflow: Define requirements → Create plan → Execute stories. Each PRD lives in an isolated folder (`.ralph/PRD-N/`) to prevent overwrites.

**Most Common Commands:**
```bash
ralph prd "description" --headless    # Generate PRD (ALWAYS use --headless as agent)
ralph stream status                   # Check PRD status
ralph stream build N [iterations]     # Execute build
git log --grep="PRD-N"                # Verify commits (source of truth)
ralph error RALPH-XXX                 # Lookup error codes
```

**Agent workflow:** (1) Generate PRD with `--headless` → (2) Check status → (3) Run build → (4) Verify via git log → (5) Exit with completion signal

---

## Critical Rules

### ⚠️ ALWAYS Use `--headless` Flag for PRD Generation

When Claude Code (or another AI agent) executes `ralph prd`, it invokes a nested agent. Without `--headless`, both agents try to interact with the same TTY, causing:

- **Deadlocks** - Both agents waiting for input
- **TTY conflicts** - Overlapping I/O streams
- **Process hangs** - Commands never complete

**✅ CORRECT:**
```bash
ralph prd "Feature description" --headless
```

**❌ INCORRECT (causes nested interaction):**
```bash
ralph prd "Feature description"
```

### 🚨 NEVER Auto-Merge Builds

Ralph NEVER auto-merges builds to main. This is a core safety guarantee.

**YOU MUST NOT:**
- Run `ralph stream merge` commands
- Create pull requests automatically
- Push branches to remote automatically
- Suggest or attempt to merge on completion

**YOUR ROLE:** Execute assigned stories. When complete, output `<promise>COMPLETE</promise>` signal. The human will handle merge/PR creation after reviewing your work.

**WHAT HAPPENS NEXT:** User reviews commits, runs tests, manually triggers `ralph stream merge N`, confirms interactive prompt.

### ✅ Git Commits = Source of Truth

Git history is authoritative for PRD status, not checkboxes.

- **Two workflows:** `merged` (worktree → PR) or `completed` (direct-to-main)
- **Auto-correction:** Missing `.completed` markers auto-created when git shows commits
- **Checkboxes are hints:** Used during work, not for status determination

**Verify status:**
```bash
git log --oneline --grep="PRD-N"              # Check commits exist
ralph stream verify-status                    # Auto-fix stale markers
```

---

## Decision Tree

```
User wants to...
├─ Install → ralph install
├─ List PRDs → ralph stream list
├─ Check status → ralph stream status
├─ New PRD → ralph prd "description" --headless
├─ Build PRD → ralph stream build N [iters]
├─ Parallel (no worktree) → ralph stream build 1 5 --no-worktree &
├─ Parallel (worktree) → ralph stream init N && ralph stream build N 5 &
├─ Verify status → git log --grep="PRD-N"
├─ Check errors → ralph error RALPH-XXX
└─ Dashboard → ralph ui
```

---

## Common Task Patterns

### Pattern 1: Quick Single-PRD Build

```bash
# IMPORTANT: Agents must use --headless to avoid nested interaction
ralph prd "Feature X description" --headless
# Wait for PRD generation (creates .ralph/PRD-N/prd.md)
ralph plan
# Wait for plan generation (creates .ralph/PRD-N/plan.md)
ralph build 5
# Monitor output, report completion
```

### Pattern 2: Stream-Based Build (Recommended)

```bash
# IMPORTANT: Agents must use --headless
ralph prd "Feature X description" --headless
# Note the PRD number from output (e.g., "PRD-3")
ralph stream status
# Verify PRD created, status shows "ready"
ralph stream build 3 5
# Monitor progress
```

### Pattern 3: Status Check & Monitoring

```bash
# Check all PRD statuses
ralph stream status

# Check specific PRD progress
cat .ralph/PRD-N/progress.md

# Verify via git commits (source of truth)
git log --oneline --grep="PRD-N" -10
```

---

## Status Codes

Git commits are the source of truth for PRD status.

| Status | Meaning | Action |
|--------|---------|--------|
| `ready` | plan.md exists, no progress yet | `ralph stream build N` |
| `running` | Lock file exists with active PID | Wait or check progress.md |
| `in_progress` | progress.md exists but no commits | Resume build (work not committed) |
| `completed` | Commits on main (direct-to-main workflow) | Done. Review `git log --grep="PRD-N"` |
| `merged` | Branch merged to main (worktree workflow) | Done. PR merged |
| `not_found` | PRD directory doesn't exist | `ralph prd "..." --headless` |

**Status Verification Commands:**
```bash
# Check if PRD has commits on main (source of truth)
git log --oneline --grep="PRD-N"

# Verify specific commits from progress.md
grep "Commit:" .ralph/PRD-N/progress.md

# Auto-scan and fix all stale status markers
ralph stream verify-status

# Manually mark as completed (if commits exist on main)
ralph stream mark-completed N
```

**Common Issues:**
- **Checkbox marked but no commits** → Status = "in_progress" (work not committed yet)
- **Commits exist but shows "ready"** → Run `ralph stream verify-status` to auto-correct
- **Direct-to-main PRD shows wrong status** → Auto-creates `.completed` marker on first status check

---

## File Structure

```
.agents/ralph/        # Agent templates & scripts → See .agents/ralph/AGENTS.md
.ralph/PRD-N/         # Each PRD isolated (prd.md, plan.md, progress.md)
.ralph/locks/         # Prevent concurrent runs
.ralph/worktrees/     # Git worktrees for parallel execution
.ralph/factory/       # Factory mode workflows → See skills/factory/AGENT_GUIDE.md
skills/prd/           # PRD generation skill → See skills/prd/AGENTS.md
skills/commit/        # Git commit helper → See skills/commit/AGENTS.md
ui/                   # Ralph UI → See ui/AGENTS.md
tests/                # Test files → See tests/AGENTS.md
```

---

## Error Handling

Ralph uses standardized error codes (RALPH-XXX) for consistent handling.

**Error Code Categories:**
- `001-099` - CONFIG (configuration errors)
- `100-199` - PRD (PRD/plan errors)
- `200-299` - BUILD (build failures)
- `300-399` - GIT (git errors)
- `400-499` - AGENT (agent errors)
- `500-599` - STREAM (stream errors)
- `900-999` - INTERNAL (internal errors)

**Lookup & Remediation:**
```bash
ralph error RALPH-401                 # Look up specific error
ralph error --list --category=BUILD   # List all errors by category
```

**Agent Responsibilities:**
- Reference error codes when reporting failures
- Check remediation: `ralph error RALPH-XXX`
- Include error code in progress.md updates
- Create GitHub issues via MCP for critical errors (201, 202, 401, 402, 506)

---

## Navigation Guide

**When working in subdirectories, read the local AGENTS.md for context-specific guidance:**

- **In `.agents/ralph/`:** Read `.agents/ralph/AGENTS.md` for build loop guidance
- **In `skills/prd/`:** Read `skills/prd/AGENTS.md` for PRD generation rules
- **In `skills/commit/`:** Read `skills/commit/AGENTS.md` for commit format
- **In `skills/factory/`:** Read `skills/factory/AGENT_GUIDE.md` for factory workflows
- **In `ui/`:** Read `ui/AGENTS.md` for UI testing guidance
- **In `tests/`:** Read `tests/AGENTS.md` for test writing rules

**For comprehensive reference:** See [CLAUDE.md](CLAUDE.md) for complete documentation on installation, configuration, workflows, and troubleshooting.

**For web-based reference:** See [agent-guide.html](ui/public/docs/agent-guide.html) or http://localhost:3000/docs/agent-guide.html for interactive decision trees and section pointers.

---

## Related Documentation

- **CLAUDE.md** - Comprehensive reference (installation, commands, configuration)
- **agent-guide.html** - Web-based agent guide with visual decision trees
- **skills/factory/AGENT_GUIDE.md** - Factory mode (meta-orchestration)
- **MCP_TOOLS.md** - MCP server integrations (Notion, Slack, GitHub, Miro)

---

## Summary

**Key Takeaways for AI Agents:**

1. **ALWAYS use `--headless` flag** when running `ralph prd` as an agent
2. **NEVER auto-merge** - builds require explicit human approval via `ralph stream merge`
3. **Git commits = source of truth** - verify status with `git log --grep="PRD-N"`
4. **Read local AGENTS.md** files for context-specific guidance in subdirectories
5. **Reference error codes** when reporting failures: `ralph error RALPH-XXX`
6. **Exit after completion** - output `<promise>COMPLETE</promise>` and let humans handle merges
