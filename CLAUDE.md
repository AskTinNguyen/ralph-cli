# Ralph CLI

Autonomous coding loop for Claude Code. PRD-based workflow with bash implementation.

## Quick Reference

| Use Case | Command |
|----------|---------|
| **Install to repo** | `ralph install` |
| **Generate PRD** | `ralph prd` |
| **Create plan from PRD** | `ralph plan` |
| **Run build iterations** | `ralph build 5` |
| **Dry run (no commit)** | `ralph build 1 --no-commit` |

## Multi-Stream (Parallel Execution)

| Use Case | Command |
|----------|---------|
| **Create stream** | `ralph stream new` |
| **List streams** | `ralph stream list` |
| **Show status** | `ralph stream status` |
| **Init worktree** | `ralph stream init 1` |
| **Build in stream** | `ralph stream build 1 5` |
| **Run parallel** | `ralph stream build 1 & ralph stream build 2 &` |
| **Merge stream** | `ralph stream merge 1` |

## Single PRD Workflow

1. **PRD** → Define requirements: `ralph prd`
2. **Plan** → Break into stories: `ralph plan`
3. **Build** → Execute stories: `ralph build N`

## Multi-Stream Workflow

1. **Create streams**: `ralph stream new` (creates prd-1, prd-2, ...)
2. **Edit PRDs**: `.ralph/prd-N/prd.md`
3. **Init worktrees** (optional): `ralph stream init N`
4. **Run in parallel**: `ralph stream build 1 & ralph stream build 2 &`
5. **Merge completed**: `ralph stream merge N`

## File Structure

**Single PRD mode:**
```
project/
├── .agents/
│   ├── ralph/                    # Loop templates
│   │   ├── loop.sh               # Main execution loop
│   │   ├── stream.sh             # Multi-stream commands
│   │   └── config.sh             # Agent configuration
│   └── tasks/
│       └── prd.md                # PRD document
└── .ralph/
    ├── IMPLEMENTATION_PLAN.md    # Task plan (stories)
    ├── progress.md               # Append-only progress log
    └── guardrails.md             # Lessons learned
```

**Multi-stream mode:**
```
.ralph/
├── prd-1/                        # Stream 1
│   ├── prd.md                    # PRD for this stream
│   ├── plan.md                   # Implementation plan
│   ├── progress.md               # Progress log
│   └── runs/                     # Run logs
├── prd-2/                        # Stream 2
│   └── ...
├── guardrails.md                 # Shared guardrails
├── locks/                        # Stream locks (prevent concurrent runs)
└── worktrees/                    # Git worktrees for parallel execution
    ├── prd-1/                    # Isolated working directory
    └── prd-2/
```

## PRD Format

```markdown
# Product Requirements Document

## Overview
What we're building and why.

## User Stories

### [ ] US-001: Story title
**As a** user
**I want** feature
**So that** benefit

#### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2
```

Stories are marked `[x]` when complete.

## Agent Configuration

Set in `.agents/ralph/config.sh` or via CLI flag:

```bash
# Use Claude
ralph build 1 --agent=claude

# Use Codex (default)
ralph build 1 --agent=codex

# Use Droid
ralph build 1 --agent=droid
```

## Package Structure

```
ralph-cli/
├── bin/ralph             # Node.js CLI entry point
├── .agents/ralph/        # Bash loop implementation
│   ├── loop.sh           # Main execution loop
│   ├── PROMPT_build.md   # Build iteration prompt
│   └── PROMPT_plan.md    # Planning prompt
├── skills/               # Optional agent skills
│   ├── commit/           # Git commit helper
│   ├── dev-browser/      # Browser automation
│   └── prd/              # PRD generation
└── package.json
```

## How It Works

1. **PRD**: `ralph prd` generates requirements document
2. **Plan**: `ralph plan` creates `IMPLEMENTATION_PLAN.md` with ordered stories
3. **Build**: `ralph build N` runs N iterations of `loop.sh`
4. **Loop**: Each iteration picks next unchecked story, executes, commits, marks done

The loop is stateless - each iteration reads files, does work, writes results.
