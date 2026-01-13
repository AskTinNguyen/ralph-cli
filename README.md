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
# Clone the repo
git clone https://github.com/AskTinNguyen/ralph-cli.git

# Add to your PATH (add to ~/.bashrc or ~/.zshrc)
export PATH="$PATH:$HOME/ralph-cli/bin"

# Verify
ralph.sh --help
```

Or copy directly to your project:

```bash
curl -O https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/bin/ralph.sh
chmod +x ralph.sh
```

## Quick Start

```bash
# 1. Install Ralph skills to your repo
ralph.sh install

# 2. Start Claude Code
claude

# 3. Create a task interactively
> /ralph-plan

# 4. Or create one directly
> /ralph-new Add user authentication

# 5. Run the task
> /ralph-go 1
```

## Commands

| Command | Description |
|---------|-------------|
| `ralph.sh install` | Install skills to current repo |
| `ralph.sh new "task"` | Create a new task |
| `ralph.sh list` | List all tasks |
| `ralph.sh go <id>` | Run task headlessly (pure loop) |
| `ralph.sh update` | Update skills to latest version |

### What Gets Created

After running `ralph.sh install`:
- `.claude/skills/ralph-go/` - Main execution skill
- `.claude/skills/ralph-new/` - Task creation skill
- `.claude/skills/ralph-plan/` - Interactive planning skill
- `.ralph/guardrails.md` - Safety constraints

## Interactive Usage (Recommended)

For the best experience, use Ralph through Claude Code directly:

```bash
claude
> /ralph-plan          # Interactive task planning
> /ralph-new Fix bug   # Quick task creation
> /ralph-go 1          # Run task with full UI
```

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
