# Ralph CLI

Autonomous coding loop for Claude Code. PRD-based workflow with bash implementation.

## Quick Reference

| Use Case                 | Command                                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------------------- |
| **Install (Mac/Linux)**  | `curl -fsSL https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.sh \| bash`  |
| **Install (Windows)**    | `iwr -useb https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.ps1 \| iex`   |
| **Install (manual)**     | `git clone https://github.com/AskTinNguyen/ralph-cli.git && cd ralph-cli && npm i && npm link` |
| **Install to project**   | `ralph install`                                                                                |
| **Generate PRD**         | `ralph prd`                                                                                    |
| **Create plan from PRD** | `ralph plan` (uses latest PRD)                                                                 |
| **Plan specific PRD**    | `ralph plan --prd=1`                                                                           |
| **Run build iterations** | `ralph build 5`                                                                                |
| **Build specific PRD**   | `ralph build 5 --prd=1`                                                                        |
| **Dry run (no commit)**  | `ralph build 1 --no-commit`                                                                    |
| **Factory run**          | `ralph factory run my-factory`                                                                 |
| **Factory status**       | `ralph factory status my-factory`                                                              |

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

## Factory Mode (Meta-Orchestration)

Factory Mode enables declarative, multi-stage agent workflows with verification gates. Use it for complex pipelines, recursive workflows, and production-grade automation.

| Use Case | Command |
|----------|---------|
| **Create factory** | `ralph factory init my-factory` |
| **Run factory** | `ralph factory run my-factory` |
| **Check status** | `ralph factory status my-factory` |
| **Resume failed** | `ralph factory resume my-factory` |
| **List factories** | `ralph factory list` |

**Key Features:**
- **Chained workflows**: PRD → Plan → Build pipelines
- **Conditional branching**: Execute different paths based on results
- **Recursive loops**: Auto-retry failed stages with context
- **Verification gates**: Tamper-resistant checks (tests, git, builds)

**Verification gates prevent gaming** - agents cannot claim success by outputting "All tests pass!" - the verification system actually runs tests and checks results.

> **Full documentation**: See [`skills/factory/SKILL.md`](skills/factory/SKILL.md) for complete reference including YAML schema, verification types, examples, and best practices.

## Workflow

Each `ralph plan` creates a new isolated folder (PRD-1, PRD-2, ...) to prevent plans from being overwritten:

1. **PRD** → Define requirements: `ralph prd` (creates `.ralph/PRD-N/prd.md`)
2. **Plan** → Break into stories: `ralph plan` (uses latest PRD) or `ralph plan --prd=1` (specific PRD)
3. **Build** → Execute stories: `ralph build N` or `ralph build N --prd=1`
4. **Merge** → **MANUAL STEP** (worktree only): Review changes, then `ralph stream merge N`

**Merge Safety**: Builds NEVER auto-merge. When using worktrees, you must explicitly run `ralph stream merge N` after reviewing changes. Direct-to-main builds don't require merging.

## Parallel Workflow

1. **Create multiple PRDs**: Run `ralph prd` multiple times (creates PRD-1, PRD-2, ...)
2. **Edit PRDs**: `.ralph/PRD-N/prd.md`
3. **Init worktrees** (optional): `ralph stream init N`
4. **Run in parallel**: `ralph stream build 1 & ralph stream build 2 &`
5. **Wait for completion**: Monitor build progress via `ralph stream status`
6. **Review changes**: `git log main..ralph/PRD-N`, run tests, validate output
7. **Merge completed**: `ralph stream merge N` (requires human confirmation)

**Merge Safety**: Ralph NEVER auto-merges worktree branches. Each merge requires:
- Explicit human command: `ralph stream merge N`
- Interactive confirmation prompt (or `--yes` flag for automation)
- All merges are auditable and reversible

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
    ├── worktrees/                # Git worktrees for parallel execution
    │   ├── PRD-1/                # Isolated working directory
    │   └── PRD-2/
    └── factory/                  # Factory mode (meta-orchestration)
        ├── my-factory.yaml       # Factory definitions
        ├── learnings.json        # Project-wide learnings
        └── runs/                 # Execution history
            └── run-TIMESTAMP/
                ├── state.json    # Checkpoint state
                └── stages/       # Per-stage results
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
# Use Claude (default - recommended)
ralph build 1 --agent=claude

# Use Codex (OpenAI - no Claude model routing)
ralph build 1 --agent=codex

# Use Droid (Factory.ai - no Claude model routing)
ralph build 1 --agent=droid
```

**Agent/Model Compatibility:**
- **Claude agent**: Full support for model routing (haiku, sonnet, opus)
- **Codex/Droid**: Model routing auto-disabled; uses provider's default model

If you try to use a non-Claude agent with model routing enabled, Ralph will:
1. Display a warning message
2. Auto-disable model routing for that session
3. Suggest using `--agent=claude` or disabling routing

## Model Routing Configuration

Ralph can automatically select the optimal Claude model based on task complexity. Configure in `.agents/ralph/config.sh` or via `ralph init`.

### Complexity Tiers

| Tier | Score | Default Model | Use Case |
|------|-------|---------------|----------|
| **Low** | 1-3 | Haiku | Simple fixes, docs, typos |
| **Medium** | 4-7 | Sonnet | Features, refactoring |
| **High** | 8-10 | Opus | Architecture, complex changes |

### Configuration Variables

```bash
# Enable/disable complexity-based model routing
RALPH_ROUTING_ENABLED=true

# Model for LOW complexity tasks (score 1-3)
RALPH_LOW_COMPLEXITY_MODEL=haiku

# Model for MEDIUM complexity tasks (score 4-7)
RALPH_MEDIUM_COMPLEXITY_MODEL=sonnet

# Model for HIGH complexity tasks (score 8-10)
RALPH_HIGH_COMPLEXITY_MODEL=opus

# Default model when routing is disabled
RALPH_DEFAULT_MODEL=sonnet

# Customize complexity thresholds (advanced)
RALPH_HAIKU_MAX_COMPLEXITY=3    # Scores 1-3 use LOW model
RALPH_SONNET_MAX_COMPLEXITY=7   # Scores 4-7 use MEDIUM model
```

### CLI Override

```bash
# Force a specific model for one build
ralph build 5 --model=opus

# Force model for stream build
ralph stream build 1 5 --model=haiku
```

### Example: All Opus Configuration

To use Opus for all tasks regardless of complexity:

```bash
# Option 1: Disable routing, set default
RALPH_ROUTING_ENABLED=false
RALPH_DEFAULT_MODEL=opus

# Option 2: Set all tiers to Opus
RALPH_ROUTING_ENABLED=true
RALPH_LOW_COMPLEXITY_MODEL=opus
RALPH_MEDIUM_COMPLEXITY_MODEL=opus
RALPH_HIGH_COMPLEXITY_MODEL=opus
```

### Interactive Setup

Run `ralph init` to configure model routing interactively:

```
? Enable complexity-based model routing? Yes
? Model for LOW complexity tasks (1-3)? Haiku (recommended)
? Model for MEDIUM complexity tasks (4-7)? Sonnet (recommended)
? Model for HIGH complexity tasks (8-10)? Opus (recommended)

┌ Model Routing Configuration ─────────────────┐
│ Low (1-3) → haiku                            │
│ Medium (4-7) → sonnet                        │
│ High (8-10) → opus                           │
└──────────────────────────────────────────────┘
```

**Note:** Model routing configuration is only shown for Claude agent. Non-Claude agents (Codex, Droid) skip this step.

## PRD Command Modes

The `ralph prd` command supports two execution modes:

### Interactive Mode (Default)

**Usage:** `ralph prd "Feature description"`

- Used when a human runs the command in a terminal
- Agent runs interactively with full terminal output
- Real-time progress and thinking visible to user
- Suitable for development and manual workflows

**Example:**
```bash
# Human running in terminal
ralph prd "Build a user authentication system"
```

### Headless Mode (Non-Interactive)

**Usage:** `ralph prd "Feature description" --headless`

- Required for server/UI/background execution
- Agent runs with piped stdin (no interactive prompts)
- Output captured programmatically for streaming
- Prevents TTY conflicts and hanging processes

**When to use `--headless`:**
- ✅ UI server triggering PRD generation
- ✅ CI/CD pipelines and automation scripts
- ✅ Background jobs and daemons
- ✅ When Claude Code agent executes `ralph prd` (avoids nested interaction)
- ✅ Any context where stdin is not an interactive terminal

**Examples:**
```bash
# UI server (always use --headless)
ralph prd "Feature description" --headless

# Claude Code agent calling ralph
ralph prd "Add dashboard feature" --headless

# CI/CD pipeline
ralph prd "Automated test suite" --headless

# Background process
nohup ralph prd "Long-running task" --headless > prd.log 2>&1 &
```

**Important:** The Ralph UI server (`ui/`) automatically uses `--headless` mode (see `ui/src/services/wizard-process-manager.ts:126`) to prevent process hangs.

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

### Setup

1. Set required environment variables in your shell or `.env`
2. MCP servers auto-start when Claude Code runs
3. Tools are available as `mcp__<server>__<action>`

### Orphaned Ralph Process Cleanup

If a Ralph build/plan process is interrupted or killed unexpectedly, the elapsed time indicator may continue running in the background. This has been fixed in the latest version (progress indicators now auto-terminate when the parent process dies), but you may still encounter orphaned processes from older runs.

**Symptoms:**
- Elapsed time messages (`⏱ Elapsed: Xm Ys`) continue appearing after a Ralph process completes
- Terminal shows: "Progress PID XXXXX reused by another process, skipping kill"
- Background `loop.sh` processes visible in `ps aux | grep ralph`

**Quick fix:**
```bash
# Clean up all orphaned Ralph processes
.agents/ralph/cleanup-orphans.sh
```

**Manual cleanup:**
```bash
# Find orphaned processes
ps aux | grep "ralph-cli/.agents/ralph/loop.sh" | grep -v grep

# Kill specific PIDs
kill -TERM <pid1> <pid2> ...

# Force kill if needed (use with caution)
kill -9 <pid>
```

**Prevention:**
The fix (as of v1.x) ensures background progress indicators automatically exit when their parent process dies, preventing orphans from forming in future runs.

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

**IMPORTANT**: All UI-related testing uses browser automation with agent-browser.

### agent-browser CLI

**Vercel's agent-browser** - Fast Rust-based CLI for browser automation, optimized for AI agents.

**Why agent-browser?**
- **Fast & reliable**: Rust CLI with Node.js fallback
- **AI-optimized**: Snapshot + ref workflow (`@e1`, `@e2`) for deterministic selection
- **No buggy MCP**: Standalone CLI tool, no MCP server issues
- **Persistent sessions**: Isolated browser instances with cookies/storage
- **JSON output**: Machine-readable results for agents

**Installation:**
```bash
npm install -g agent-browser
agent-browser install  # Downloads Chromium
```

**Usage Examples:**
```bash
# Start the UI server
cd ui && npm run dev

# Navigate and take snapshot
agent-browser open http://localhost:3000
agent-browser snapshot -i  # Interactive elements only

# Click elements by reference
agent-browser click @e2

# Fill forms
agent-browser fill @e3 "test@example.com"

# Take screenshot
agent-browser screenshot --full

# Get element text
agent-browser get text @e1

# Run JavaScript
agent-browser eval "document.title"

# Find and click by role
agent-browser find role button click --name Submit
```

**Common Commands:**
```bash
# Navigation
agent-browser open <url>
agent-browser back
agent-browser reload

# Interaction
agent-browser click <selector|@ref>
agent-browser type <selector|@ref> "text"
agent-browser fill <selector|@ref> "text"
agent-browser press Enter

# Verification
agent-browser snapshot [-i] [-c]  # -i = interactive only, -c = compact
agent-browser screenshot [--full]
agent-browser get text <selector|@ref>
agent-browser is visible <selector|@ref>

# Debug
agent-browser console
agent-browser errors
agent-browser network requests
```

### Testing Checklist

When testing UI features with **agent-browser**:
1. ✅ Navigate to the page: `agent-browser open http://localhost:3000`
2. ✅ Take snapshot: `agent-browser snapshot -i` to see interactive elements
3. ✅ Verify elements visible: `agent-browser is visible @e1`
4. ✅ Test interactions: `agent-browser click @e2`, `agent-browser fill @e3 "text"`
5. ✅ Check console errors: `agent-browser console` and `agent-browser errors`
6. ✅ Validate data loads: `agent-browser get text @e1` or `agent-browser eval "..."`
7. ✅ Take screenshots: `agent-browser screenshot --full`

**Never test UI features with just curl or API calls alone** - always verify the actual rendered page works correctly.

### UI Testing Helper Script

For common testing scenarios, use the provided helper script:

```bash
# Quick snapshot of homepage
.agents/ralph/test-ui.sh snapshot

# Test PRD list page (automated)
.agents/ralph/test-ui.sh test-list

# Test logs page (automated)
.agents/ralph/test-ui.sh test-logs

# Interactive mode (opens headed browser)
.agents/ralph/test-ui.sh interactive

# Clean up browser session
.agents/ralph/test-ui.sh cleanup
```

**Custom UI URL:**
```bash
UI_URL=http://localhost:8080 .agents/ralph/test-ui.sh snapshot
```

### UI Server Configuration

The Ralph UI server uses `RALPH_ROOT` environment variable to determine which `.ralph` directory to read from:

**Production mode (default):**
```bash
# Uses parent directory's .ralph/ (ralph-cli/.ralph)
cd ui && npm run dev
# or
npm start
```

**Test mode:**
```bash
# Uses ui/.ralph/ for isolated testing
cd ui && npm run dev:test
# or
npm run start:test
```

**Custom RALPH_ROOT:**
```bash
# Point to any .ralph directory
RALPH_ROOT=/path/to/.ralph npm run dev
```

**Directory structure:**
- `ralph-cli/.ralph/` - Production PRD directories (PRD-1 through PRD-N)
- `ralph-cli/ui/.ralph/` - Test/isolated PRD directories (used with `:test` scripts)

The server automatically uses `ralph-cli/.ralph` unless `RALPH_ROOT` is explicitly set. This prevents the UI from showing test PRDs in production while allowing isolated testing when needed.

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
