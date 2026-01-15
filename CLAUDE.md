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

| Use Case                | Command                                         |
| ----------------------- | ----------------------------------------------- |
| **List PRDs**           | `ralph stream list`                             |
| **Show status**         | `ralph stream status`                           |
| **Init worktree**       | `ralph stream init 1`                           |
| **Build in stream**     | `ralph stream build 1 5`                        |
| **Build (no worktree)** | `ralph stream build 1 5 --no-worktree`          |
| **Build (force)**       | `ralph stream build 1 5 --force`                |
| **Run parallel**        | `ralph stream build 1 & ralph stream build 2 &` |
| **Merge stream**        | `ralph stream merge 1`                          |

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
# Use Claude (default)
ralph build 1 --agent=claude

# Use Codex
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
├── tests/                # Test files (IMPORTANT: ALL tests go here)
│   ├── *.mjs             # Integration and E2E tests
│   ├── test-*.js         # Unit tests
│   ├── fixtures/         # Test fixtures
│   ├── helpers/          # Test utilities
│   └── mocks/            # Mock implementations
└── package.json
```

**Testing Rules:**
- ✅ All test files must be in `/tests` directory
- ✅ Integration/E2E tests use `.mjs` extension
- ✅ Unit tests use `test-*.js` naming pattern
- ❌ Never place test files in `/lib`, `/bin`, or other source directories

> **Full testing guide**: See [TESTING.md](TESTING.md) for comprehensive documentation on test organization and best practices.

## How It Works

1. **PRD**: `ralph prd` generates requirements document in `.ralph/PRD-N/prd.md`
2. **Plan**: `ralph plan` creates `plan.md` with ordered stories in the same PRD-N folder
3. **Build**: `ralph build N` runs N iterations of `loop.sh` against the active PRD
4. **Loop**: Each iteration picks next unchecked story, executes, commits, marks done

**Isolation guarantee**: Each plan lives in its own PRD-N folder. Plans are never overwritten by subsequent `ralph plan` calls - a new PRD-N+1 folder is created instead.

The loop is stateless - each iteration reads files, does work, writes results.

## Status Validation & Troubleshooting

### Stream Status Verification

**IMPORTANT**: Git commits are the ultimate source of truth for PRD status. Checkboxes are only progress markers.

**How it works:**
1. **Git is authoritative**: Status checks git history for actual commits, not checkboxes
2. **Two completion workflows**:
   - `merged`: Worktree workflow - branch merged to main via PR (`.merged` marker)
   - `completed`: Direct-to-main workflow - commits directly on main (`.completed` marker)
3. **Auto-correction**: Missing `.completed` markers auto-created when git shows commits
4. **Checkboxes are hints**: Used by agents during work, not for status determination

**Status detection hierarchy:**
- `running`: Lock file exists with active PID
- `merged`: Branch merged to main (git merge-base check)
- `completed`: Commits found on main (progress.md hashes + git log search)
- `in_progress`: progress.md exists but no commits found
- `ready`: plan.md exists but no progress yet

**Why this matters:**
- Correctly identifies PRDs completed via direct-to-main workflow (no worktree)
- Checkboxes can't be trusted as proof of work - only git commits matter
- Prevents false status when checkboxes aren't updated

**Manual verification:**
```bash
# Check if PRD has commits on main
git log --oneline --grep="PRD-N"

# Verify specific commits from progress.md
grep "Commit:" .ralph/PRD-N/progress.md

# See all commits for a PRD
git log --all --oneline | grep -i "PRD-N\|US-00"
```

**New status commands:**
```bash
# Mark PRD as completed (direct-to-main workflow)
ralph stream mark-completed N

# Remove completion marker
ralph stream unmark-completed N

# Auto-scan and fix all stale status markers
ralph stream verify-status
```

**Common issues:**
- **Checkbox marked but no commits**: Status = "in_progress" (work not committed yet)
- **Commits exist but shows "ready"**: Run `ralph stream verify-status` to auto-correct
- **Want to distinguish worktree vs direct builds**: Check for `.merged` vs `.completed` marker files
- **Direct-to-main PRD shows wrong status**: `get_stream_status()` will auto-create `.completed` marker on first status check

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

## UI Testing

**IMPORTANT**: All UI-related testing MUST use the `chromemcp` MCP server for browser automation.

### Why ChromeMCP?

- **Live browser interaction**: Test actual UI behavior, not just API responses
- **Visual validation**: Verify charts, layouts, and interactive elements render correctly
- **User flow testing**: Simulate real user interactions (clicks, form fills, navigation)
- **Screenshot verification**: Capture visual evidence of UI state
- **Error detection**: Catch JavaScript errors, failed network requests, console warnings

### Usage

The Ralph UI server (`ui/`) should be tested using browser automation tools via MCP:

```bash
# Start the UI server (usually runs on http://localhost:3000)
cd ui && npm run dev

# Use chromemcp tools via MCP for testing:
# - mcp__plugin_playwright_playwright__browser_navigate(url)
# - mcp__plugin_playwright_playwright__browser_snapshot()
# - mcp__plugin_playwright_playwright__browser_click(element, ref)
# - mcp__plugin_playwright_playwright__browser_take_screenshot(filename)
# - mcp__plugin_playwright_playwright__browser_evaluate(function)
```

### Testing Checklist

When testing UI features:
1. ✅ Navigate to the page using `browser_navigate`
2. ✅ Take snapshot using `browser_snapshot` to see page structure
3. ✅ Verify elements are visible and functional
4. ✅ Test user interactions (clicks, form fills, etc.)
5. ✅ Check for JavaScript errors in console
6. ✅ Validate data loads correctly from API endpoints
7. ✅ Take screenshots for visual verification

**Never test UI features with just curl or API calls alone** - always verify the actual rendered page works correctly.
