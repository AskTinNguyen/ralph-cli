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

| Server         | Purpose                            | Status               | Env Variable                       |
| -------------- | ---------------------------------- | -------------------- | ---------------------------------- |
| **Notion**     | Docs, databases, task tracking     | Auto-start           | `NOTION_API_KEY`                   |
| **Slack**      | Team notifications, context search | Auto-start           | `SLACK_BOT_TOKEN`, `SLACK_TEAM_ID` |
| **GitHub**     | Issues, PRs, code search           | Auto-start           | `GITHUB_TOKEN`                     |
| **Miro**       | Visual diagrams, boards            | Auto-start           | `MIRO_API_TOKEN`                   |
| **Playwright** | Browser automation, UI testing     | On-demand (disabled) | None                               |

### Setup

1. Set required environment variables in your shell or `.env`
2. MCP servers auto-start when Claude Code runs (except Playwright)
3. Tools are available as `mcp__<server>__<action>`

### Playwright On-Demand Configuration

**Why disabled by default?** Playwright spawns browser windows for each Claude Code session, which can cause multiple empty browser windows to appear.

**Enable when needed:**
```bash
# Enable for UI testing session
.agents/ralph/enable-playwright.sh

# Restart Claude Code
claude

# Disable when done
.agents/ralph/disable-playwright.sh
```

**Or manually edit `.mcp.json`:**
```json
"playwright": {
  "disabled": false  // Change true to false
}
```

### Playwright/ChromeMCP Troubleshooting

Playwright and ChromeMCP can sometimes leave orphan browser processes or get stuck. Use these scripts:

| Script                   | Purpose                                      |
| ------------------------ | -------------------------------------------- |
| `cleanup-playwright.sh`  | Kill stuck Playwright MCP processes          |
| `disable-playwright.sh`  | Disable Playwright in `.mcp.json`            |
| `enable-playwright.sh`   | Enable Playwright in `.mcp.json`             |

```bash
# Clean up stuck browser windows and processes
.agents/ralph/cleanup-playwright.sh

# Disable Playwright (prevents browser spawning)
.agents/ralph/disable-playwright.sh

# Enable Playwright for UI testing
.agents/ralph/enable-playwright.sh
```

**Common fixes:**
- **Multiple browser windows spawning**: `cleanup-playwright.sh` then `disable-playwright.sh`
- **Browser stuck/unresponsive**: `cleanup-playwright.sh` and restart Claude Code
- **Need UI testing**: `enable-playwright.sh`, restart Claude Code, test, then `disable-playwright.sh`

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

## Agent Operation Guide

When working with Ralph CLI tasks on behalf of users, reference the Agent Guide at:
- **Web**: http://localhost:3000/docs/agent-guide.html (when UI server running)
- **File**: `ui/public/docs/agent-guide.html`

This concise, agent-friendly reference contains:
- Decision trees for command selection
- Common task patterns (single PRD, streams, parallel execution)
- File structure reference
- Critical rules (do's and don'ts)
- Status interpretation
- Quick troubleshooting
- MCP integration examples
- Response templates

**When to reference**: Before executing Ralph commands, check the Agent Guide for the correct pattern to follow.

## Error Handling & Issue Creation

Ralph CLI uses standardized error codes (RALPH-XXX) for consistent error handling and automated GitHub issue creation.

### Error Code Reference

| Range | Category | Description |
|-------|----------|-------------|
| 001-099 | CONFIG | Configuration errors (missing files, invalid settings) |
| 100-199 | PRD | PRD/Plan errors (missing stories, malformed documents) |
| 200-299 | BUILD | Build failures (agent errors, rollback issues) |
| 300-399 | GIT | Git errors (conflicts, dirty state, diverged branches) |
| 400-499 | AGENT | Agent errors (fallback exhausted, timeouts) |
| 500-599 | STREAM | Stream errors (lock conflicts, worktree issues) |
| 900-999 | INTERNAL | Internal errors (unexpected failures) |

### Error Lookup

```bash
# Look up specific error
ralph error RALPH-401

# List all errors
ralph error --list

# Filter by category
ralph error --list --category=BUILD

# Show errors that auto-create GitHub issues
ralph error --list --auto-issue
```

### Error Code Usage in Builds

When build failures occur, agents should:

1. **Reference error codes** when reporting failures
2. **Check remediation steps**: `ralph error RALPH-XXX`
3. **Include error code** in progress.md updates
4. **Follow remediation** before retrying

Example in progress.md:
```markdown
## Iteration 3 - Failed
- Error: [RALPH-401] Agent fallback chain exhausted
- Story: US-003
- See: `ralph error RALPH-401` for remediation
```

### GitHub Issue Creation

Ralph can auto-create GitHub issues for critical failures. **Disabled by default** - enable via config.

**Enable auto-issue creation:**
```bash
# In .agents/ralph/config.sh
export RALPH_AUTO_ISSUES=true
```

**Errors that trigger auto-issue creation:**
- `RALPH-201`: Agent command failed
- `RALPH-202`: Rollback failed - manual intervention required
- `RALPH-401`: Agent fallback chain exhausted
- `RALPH-402`: Story selection lock timeout
- `RALPH-506`: PR creation failed

**Issue format:**
- Title: `[RALPH-XXX] Error message`
- Labels: `ralph-error`, category-specific label
- Body: Error details, context, remediation steps, logs

### MCP GitHub Issue Creation

When working as an agent and encountering critical failures, create GitHub issues using MCP:

```javascript
mcp__github__create_issue({
  owner: "<repo-owner>",
  repo: "<repo-name>",
  title: "[RALPH-XXX] <short description>",
  body: "<formatted error context>",
  labels: ["ralph-error", "ralph-<category>"]
})
```

**Required context in issues:**
- Error code and message
- PRD and story being worked on
- Agent chain tried (if applicable)
- Last 50 lines of run log
- Link to error documentation

**Create issues for:** `RALPH-201`, `RALPH-202`, `RALPH-401`, `RALPH-402`, `RALPH-506`

**Do NOT create issues for:**
- CONFIG errors (0XX range) - user configuration issues
- GIT errors (3XX range) - requires manual resolution
- Transient network errors - should retry

### Configuration

Add to `.agents/ralph/config.sh`:
```bash
# Enable/disable auto issue creation (default: false)
export RALPH_AUTO_ISSUES=false

# Override repo for issues (default: current project repo)
export RALPH_ISSUE_REPO=""

# Deduplication window in hours (default: 24)
export RALPH_ISSUE_DEDUP_HOURS=24
```
