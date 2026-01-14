# Ralph CLI

Autonomous coding loop for Claude Code. PRD-based workflow with bash implementation.

## Quick Reference

| Use Case                 | Command                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Install ralph-cli**    | `git clone https://github.com/AskTinNguyen/ralph-cli.git && cd ralph-cli && npm i && npm link` |
| **Install to project**   | `ralph install`                                                                                |
| **Generate PRD**         | `ralph prd`                                                                                    |
| **Create plan from PRD** | `ralph plan` (creates PRD-N folder)                                                            |
| **Run build iterations** | `ralph build 5`                                                                                |
| **Build specific PRD**   | `ralph build 5 --prd=1`                                                                        |
| **Dry run (no commit)**  | `ralph build 1 --no-commit`                                                                    |

## Stream Commands (Parallel Execution)

| Use Case            | Command                                         |
| ------------------- | ----------------------------------------------- |
| **List PRDs**       | `ralph stream list`                             |
| **Show status**     | `ralph stream status`                           |
| **Init worktree**   | `ralph stream init 1`                           |
| **Build in stream** | `ralph stream build 1 5`                        |
| **Run parallel**    | `ralph stream build 1 & ralph stream build 2 &` |
| **Merge stream**    | `ralph stream merge 1`                          |

## Workflow

Each `ralph plan` creates a new isolated folder (PRD-1, PRD-2, ...) to prevent plans from being overwritten:

1. **PRD** → Define requirements: `ralph prd` (creates `.ralph/PRD-N/prd.md`)
2. **Plan** → Break into stories: `ralph plan` (creates `.ralph/PRD-N/plan.md`)
3. **Build** → Execute stories: `ralph build N` or `ralph build N --prd=1`

## Parallel Workflow

1. **Create multiple PRDs**: Run `ralph prd` multiple times (creates PRD-1, PRD-2, ...)
2. **Edit PRDs**: `.ralph/PRD-N/prd.md`
3. **Init worktrees** (optional): `ralph stream init N`
4. **Run in parallel**: `ralph stream build 1 & ralph stream build 2 &`
5. **Merge completed**: `ralph stream merge N`

## File Structure

Each plan is stored in its own isolated folder to prevent conflicts:

```
project/
├── .agents/
│   └── ralph/                    # Loop templates
│       ├── loop.sh               # Main execution loop
│       ├── stream.sh             # Multi-stream commands
│       └── config.sh             # Agent configuration
└── .ralph/
    ├── PRD-1/                    # First plan (isolated)
    │   ├── prd.md                # PRD document
    │   ├── plan.md               # Implementation plan (stories)
    │   ├── progress.md           # Progress log
    │   └── runs/                 # Run logs
    ├── PRD-2/                    # Second plan (isolated)
    │   ├── prd.md
    │   ├── plan.md
    │   ├── progress.md
    │   └── runs/
    ├── guardrails.md             # Shared lessons learned
    ├── locks/                    # Stream locks (prevent concurrent runs)
    └── worktrees/                # Git worktrees for parallel execution
        ├── PRD-1/                # Isolated working directory
        └── PRD-2/
```

**Key principle**: Plans are NEVER stored in a centralized location. Each `ralph plan` auto-increments to the next available PRD-N folder.

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

1. **PRD**: `ralph prd` generates requirements document in `.ralph/PRD-N/prd.md`
2. **Plan**: `ralph plan` creates `plan.md` with ordered stories in the same PRD-N folder
3. **Build**: `ralph build N` runs N iterations of `loop.sh` against the active PRD
4. **Loop**: Each iteration picks next unchecked story, executes, commits, marks done

**Isolation guarantee**: Each plan lives in its own PRD-N folder. Plans are never overwritten by subsequent `ralph plan` calls - a new PRD-N+1 folder is created instead.

The loop is stateless - each iteration reads files, does work, writes results.

## MCP Servers

Ralph agents have access to MCP (Model Context Protocol) servers for external integrations. Configuration is in `.mcp.json`.

### Available Integrations

| Server     | Purpose                            | Env Variable                       |
| ---------- | ---------------------------------- | ---------------------------------- |
| **Notion** | Docs, databases, task tracking     | `NOTION_API_KEY`                   |
| **Slack**  | Team notifications, context search | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` |
| **GitHub** | Issues, PRs, code search           | `GITHUB_TOKEN`                     |
| **Miro**   | Visual diagrams, boards            | `MIRO_API_TOKEN`                   |

### Setup

1. Set required environment variables in your shell or `.env`
2. MCP servers auto-start when Claude Code runs
3. Tools are available as `mcp__<server>__<action>`

### Usage Examples

```
# Search Notion for project docs
mcp__notion__search("Project requirements")

# Post build status to Slack
mcp__slack__send_message(channel="builds", text="Build completed")

# Create GitHub issue
mcp__github__create_issue(repo="org/repo", title="Bug found")

# Get Miro board
mcp__miro__get_boards()
```

See `.agents/ralph/MCP_TOOLS.md` for full documentation.
