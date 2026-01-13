# Ralph CLI

Autonomous coding loop for Claude Code. PRD-based workflow with bash implementation.

## Quick Reference

| Use Case | Command |
|----------|---------|
| **Install to repo** | `ralph install` |
| **Generate PRD** | `ralph prd` |
| **Create plan from PRD** | `ralph plan` |
| **Run build iterations** | `ralph build 5` |
| **Single iteration** | `ralph build 1` |
| **Dry run (no commit)** | `ralph build 1 --no-commit` |

## Workflow

1. **PRD** → Define requirements: `ralph prd`
2. **Plan** → Break into stories: `ralph plan`
3. **Build** → Execute stories: `ralph build N`

## File Structure

```
project/
├── .agents/
│   ├── ralph/                    # Loop templates (optional customization)
│   │   ├── loop.sh               # Main execution loop
│   │   ├── PROMPT_build.md       # Build prompt template
│   │   ├── PROMPT_plan.md        # Plan prompt template
│   │   └── config.sh             # Agent configuration
│   └── tasks/
│       └── prd.md                # PRD document
└── .ralph/
    ├── IMPLEMENTATION_PLAN.md    # Task plan (stories)
    ├── progress.md               # Append-only progress log
    ├── guardrails.md             # Lessons learned ("Signs")
    ├── activity.log              # Activity + timing
    ├── errors.log                # Failures
    └── runs/                     # Raw run logs
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
