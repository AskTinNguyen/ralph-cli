# Ralph CLI

Autonomous coding loop for Claude Code. Ralph iteratively works on tasks until completion, following a simple checklist-based approach.

## What is Ralph?

Ralph is an AI coding loop that:
1. Reads a task definition with success criteria
2. Works toward completing each criterion
3. Runs tests to verify progress
4. Continues until all criteria are met or help is needed

State lives in files, not databases. Every step is transparent and traceable.

## Installation

**Zero dependencies.** Pure bash. Works on macOS, Linux, and Windows (Git Bash/WSL).

```bash
# 1. Clone ralph-cli (one time setup)
git clone -b feat/pure-loop https://github.com/AskTinNguyen/ralph-cli.git
~/ralph-cli/bin/ralph.sh install   # Adds ralph.sh to PATH
source ~/.zshrc                     # Or restart terminal

# 2. Install skills to your project
cd your-project
ralph.sh install
```

The installer will:
1. Copy Ralph skills to your project's `.claude/skills/`
2. **Ask to add `ralph.sh` to your PATH** (first time only)
3. Create `.ralph/guardrails.md` for safety constraints

## Quick Start

```bash
# 1. Create a task
ralph.sh new "Add user authentication"

# 2. Run the task (loops until complete)
ralph.sh go 1
```

## ⚠️ Two Execution Modes

| Mode | Command | Behavior |
|------|---------|----------|
| 🔁 **Headless** | `ralph.sh go 1` | Loops until COMPLETE (autonomous) |
| 👤 **Interactive** | `/ralph-go 1` | ONE iteration only (for debugging) |

**Want autonomous execution?** Use `ralph.sh go <id>` in your terminal.

## Commands

| Command | Description |
|---------|-------------|
| `ralph.sh install` | Install skills to current repo |
| `ralph.sh new "task"` | Create a new task |
| `ralph.sh list` | List all tasks |
| `ralph.sh status` | Show all tasks status and running loops |
| `ralph.sh log <id>` | Show logs for a task |
| `ralph.sh go <id>` | Run task (loops until COMPLETE) |
| `ralph.sh update` | Update skills in current project |
| `ralph.sh upgrade` | Pull latest CLI + update skills |

### What Gets Created

After running `ralph.sh install`:
- `.claude/skills/ralph-go/` - Main execution skill
- `.claude/skills/ralph-new/` - Task creation skill
- `.claude/skills/ralph-plan/` - Interactive planning skill
- `.ralph/guardrails.md` - Safety constraints

## Interactive Commands (Inside Claude Code)

These commands work inside Claude Code (`claude`):

| Command | What it does |
|---------|--------------|
| `/ralph-plan` | Interactive task planning with Claude |
| `/ralph-new Fix bug` | Quick task creation |
| `/ralph-go 1` | Run ONE iteration (see warning above!) |

## File Structure

```
your-repo/
├── .claude/
│   └── skills/
│       ├── ralph-go/SKILL.md      # Execution loop
│       ├── ralph-new/SKILL.md     # Task creation
│       └── ralph-plan/SKILL.md    # Planning
└── .ralph/
    ├── guardrails.md              # Safety constraints (shared)
    └── ralph-1/                   # Task 1
        ├── plan.md                # Task definition
        ├── progress.md            # Iteration history
        └── errors.log             # Test failures
```

## Task Definition

`plan.md` uses YAML frontmatter:

```markdown
---
task: Add health endpoint
test_command: make test
completion_promise: "Health endpoint returns 200 and all tests pass"
max_iterations: 15
---

# Task: Add health endpoint

## Context
We need a health check endpoint for load balancer probes.

## Success Criteria
- [ ] GET /health returns 200 OK
- [ ] Response includes { status: "ok" }
- [ ] All tests pass
```

### Language-Agnostic Testing

Ralph works with any project type:

| Project Type | Example Test Command |
|--------------|---------------------|
| JavaScript/TypeScript | `npm test`, `bun test` |
| Rust | `cargo test` |
| Go | `go test ./...` |
| Python | `pytest` |
| C++ (CMake) | `cmake --build . && ctest` |
| C++ (Make) | `make && make test` |

## Completion Signals

Ralph outputs these markers to control the loop:

```markdown
<!-- Success -->
<promise>COMPLETE: Health endpoint returns 200 and all tests pass</promise>

<!-- Needs help -->
<promise>NEEDS_HUMAN: Cannot find the router configuration</promise>
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | SUCCESS - Task completed |
| 1 | ERROR - Max iterations or unexpected error |
| 2 | NEEDS_HUMAN - Claude escalated |

## Architecture

Ralph uses a **pure loop** architecture:

```bash
# The core philosophy
while :; do cat prompt.md | agent ; done
```

- **Same task, new brain each iteration**
- **Memory is filesystem + git, not chat**
- **Fresh context window every iteration** (no exhaustion)
- **All state visible in files** (easy debugging)

See [ARCHITECTURE.md](ARCHITECTURE.md) for details.

## Philosophy

- **Zero dependencies** - Pure bash, runs anywhere
- **State lives in files** - Human-readable, no database
- **Minimal tooling** - ~300 lines of bash
- **Transparent execution** - Read any file to understand what's happening
- **Language-agnostic** - Works with any project type

## License

MIT
