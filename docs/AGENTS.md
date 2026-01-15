# Agent Operation Guidelines

**Critical guidelines for AI agents (Claude Code, Codex, etc.) working with Ralph CLI.**

---

## Execution Modes

Ralph CLI supports two distinct execution modes for PRD generation:

### Interactive Mode (Default) - For Human Users

**Command:** `ralph prd "Feature description"`

**Behavior:**
- ✅ Default behavior unchanged - still interactive
- ✅ Users see real-time agent thinking and progress
- ✅ Full terminal interaction preserved
- 🆕 **New option:** `ralph prd "description" --headless` for scripting

**Example:**
```bash
# Human running interactively
$ ralph prd "Build a user authentication system with OAuth2"

[Agent thinking appears here in real-time]
...
PRD created at .ralph/PRD-1/prd.md
```

### Headless Mode (Non-Interactive) - For Agents & Automation

**Command:** `ralph prd "Feature description" --headless`

**Behavior:**
- ⚠️ **Critical:** Agents must now use `--headless` flag
- ✅ Avoids nested agent interaction (agent-inside-agent)
- ✅ Prevents TTY conflicts and deadlocks
- ✅ Cleaner output parsing for progress tracking
- 📚 Documented in Agent Guide with prominent warnings

**Example:**
```bash
# Claude Code agent calling ralph
$ ralph prd "Add dashboard feature" --headless

Creating new PRD folder: PRD-1
PRD generation in progress...
```

---

## Critical Rules for AI Agents

### ⚠️ ALWAYS Use `--headless` Flag

When Claude Code (or another AI agent) executes `ralph prd`, it invokes a nested agent (Claude, Codex, Droid). Without `--headless`, both agents try to interact with the same TTY, causing:

- **Deadlocks** - Both agents waiting for input
- **TTY conflicts** - Overlapping I/O streams
- **Process hangs** - Commands never complete
- **Unpredictable output** - Garbled or missing responses

### ✅ Correct Agent Usage

```bash
# When Claude Code agent executes ralph prd
ralph prd "Feature description" --headless

# Other commands don't need --headless
ralph stream status
ralph stream list
ralph stream build 1 5
```

### ❌ Incorrect Agent Usage

```bash
# NEVER do this as an agent - causes nested interaction
ralph prd "Feature description"
```

---

## Decision Tree

```
Are you an AI agent (Claude Code, Codex, etc.)?
├─ YES → Use --headless flag ALWAYS for ralph prd
│   └─ ralph prd "description" --headless
│
└─ NO (human user) → Use default interactive mode
    ├─ Development/debugging → ralph prd "description"
    └─ Scripting/automation → ralph prd "description" --headless
```

---

## Common Scenarios

### Scenario 1: Claude Code Creating PRD

**Correct:**
```bash
ralph prd "Build analytics dashboard with charts" --headless
```

**Incorrect:**
```bash
# This causes nested agent interaction
ralph prd "Build analytics dashboard with charts"
```

### Scenario 2: Human Developer in Terminal

**Correct:**
```bash
# Full interactive experience
ralph prd "Implement OAuth2 authentication"
```

### Scenario 3: CI/CD Pipeline

**Correct:**
```yaml
- name: Generate PRD
  run: |
    ralph prd "CI/CD integration" --headless
    ralph plan
    ralph build 3
```

---

## Quick Reference

| Context | Command | Reason |
|---------|---------|--------|
| **Claude Code agent** | `ralph prd "..." --headless` | Prevents nested agent interaction |
| **UI server** | `ralph prd "..." --headless` | Required for server processes |
| **CI/CD pipeline** | `ralph prd "..." --headless` | Automation, no TTY available |
| **Background job** | `ralph prd "..." --headless` | Non-blocking execution |
| **Human terminal** | `ralph prd "..."` | Interactive experience (default) |
| **Human scripting** | `ralph prd "..." --headless` | Optional for automation |

---

## Summary

**For AI Agents (Claude Code, etc.):**
```bash
# ✅ ALWAYS do this
ralph prd "description" --headless

# ❌ NEVER do this (causes conflicts)
ralph prd "description"
```

**For Human Users:**
```bash
# ✅ Default interactive mode
ralph prd "description"

# ✅ Optional headless for scripts
ralph prd "description" --headless
```

**Remember:** The `--headless` flag prevents TTY conflicts when agents invoke other agents.

---

## Codebase Reference

### Build & Test

- No build step
- Tests (dry-run): `npm test`
- Fast real agent check: `npm run test:ping`
- Full real loop: `npm run test:real`

### CLI Structure

- CLI entry: `bin/ralph`
- Templates: `.agents/ralph/` (copied to repos on install)
- State/logs: `.ralph/` (local only)
- Skills: `skills/`
- Tests: `tests/`

### Related Documentation

- **Agent Guide (UI):** http://localhost:3000/docs/agent-guide.html
- **Main Documentation:** [CLAUDE.md](./CLAUDE.md) - See "PRD Command Modes" section
- **Tutorial:** http://localhost:3000/docs/tutorial.html
