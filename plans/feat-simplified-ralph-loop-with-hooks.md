# feat: Simplified Ralph Loop with Claude Agent SDKs, Hooks and Prehooks

## Enhancement Summary

**Deepened on:** 2026-01-21
**Research agents used:** architecture-strategist, security-sentinel, performance-oracle, code-simplicity-reviewer, agent-native-reviewer, bash-best-practices, hook-patterns, test-failure-patterns

### Key Improvements
1. **Security hardening** - Fixed command injection risks, added input validation
2. **Performance optimization** - Lazy loading, jq alternatives, startup optimization
3. **Agent-native patterns** - Explicit completion tools, feedback loops, observability
4. **Comprehensive test detection** - Multi-framework failure patterns

### New Considerations Discovered
- Hooks must ALWAYS exit 0 (critical for Claude Code stability)
- State synchronization between loop and hooks needs atomic operations
- The 20-line minimal loop is achievable (vs. current 4,244 lines)
- PreToolUse/PostToolUse hooks need robust JSON validation

---

## Overview

Create the simplest, most concise, most error-free Ralph Loop in Bash Shell that repeatedly attempts to complete a user's feature request. The loop delegates ALL enforcement to Claude Code hooks (PreToolUse, PostToolUse, UserPromptSubmit, Stop) rather than inline validation, achieving a core loop under 200 lines.

**Key Innovation:** Shift from 4,244-line monolithic loop to ~150-line core loop + hook-based enforcement.

### Research Insights

**Best Practices (from code-simplicity-reviewer):**
- The essential loop logic can be expressed in ~20 lines
- Current 4,244 LOC is 100x more than necessary
- Remove: watchdog, TTS, budget, cost, heartbeat, telemetry libraries
- Merge: output + errors + events + status into single logging utility

**Performance Considerations (from performance-oracle):**
- Current startup: 1-3 seconds (13 library sources = 130-390ms)
- Target: <500ms achievable with lazy loading
- Hook target: <100ms requires cached config, no python3 calls

---

## Problem Statement / Motivation

The existing Ralph loop (`loop.sh`) has grown to 4,244 lines with 23 library files. While battle-tested, this complexity:
- Makes debugging difficult
- Increases maintenance burden
- Mixes concerns (loop logic + enforcement + metrics + rollback)
- Requires understanding thousands of lines to modify behavior

A simplified loop with hook-based enforcement would:
- Be easier to understand and maintain
- Allow enforcement rules to be modified without changing core loop
- Enable project-specific customization via hooks
- Align with Claude Code's native hook system

### Research Insights

**Architecture Concerns (from architecture-strategist):**
- Hook responsibility overlap needs clear boundaries:
  - PreToolUse: "Can this action be attempted?" (permissions, scope)
  - PostToolUse: "Did this action succeed?" (tests, state verification)
  - Stop: "Is the story complete?" (acceptance criteria)
- State synchronization between loop/hooks needs atomic file operations
- Missing: Error propagation from hooks to loop via signal files

**Simplicity Analysis (from code-simplicity-reviewer):**
- 75,000+ lines total across bash + TypeScript
- Essential logic: pick story, run agent, commit/rollback, repeat
- Everything else is feature creep that should be plugins

---

## Proposed Solution

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Simplified Ralph Loop                         │
│                       (~150 lines)                               │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  for iteration in 1..MAX:                                │    │
│  │    story = select_next_story(plan.md)                    │    │
│  │    [story empty] → exit 0                                │    │
│  │    run_agent_with_timeout(story)                         │    │
│  │    [success] → commit and continue                       │    │
│  │    [failure] → hooks handle rollback                     │    │
│  │  done                                                    │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Code Hooks                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌────────┐  │
│  │UserPrompt    │ │ PreToolUse   │ │ PostToolUse  │ │ Stop   │  │
│  │Submit        │ │              │ │              │ │        │  │
│  │              │ │ - Validate   │ │ - Detect     │ │ - Save │  │
│  │ - Log prompt │ │   file read  │ │   test fail  │ │   state│  │
│  │ - Start TTS  │ │ - Validate   │ │ - Trigger    │ │ - TTS  │  │
│  │              │ │   git state  │ │   rollback   │ │ summary│  │
│  │              │ │ - Block bad  │ │ - Track cost │ │        │  │
│  │              │ │   operations │ │              │ │        │  │
│  └──────────────┘ └──────────────┘ └──────────────┘ └────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Research Insights

**Agent-Native Concerns (from agent-native-reviewer):**
- Hooks are currently *constraints*, not *capabilities*
- Missing: Alternative tools when blocking operations (e.g., `create_pr` instead of blocking `git push`)
- Missing: Explicit completion tool instead of heuristic detection
- Missing: Feedback loop from rollbacks to guardrails

**Recommended Enhancement:**
```typescript
// Instead of blocking git push, provide alternative
tool("request_merge", {
  storyId: z.string(),
  summary: z.string(),
}, async (params) => {
  await createPR(params);
  return { text: "PR created for review" };
});
```

---

### Core Loop (Target: ~150 lines)

```bash
#!/bin/bash
# simplified-loop.sh - The simplest Ralph loop
set -euo pipefail

# Error trap with context (from bash-best-practices)
trap '_handle_error "$?" "$LINENO"' ERR
_handle_error() {
    local exit_code=$1 line_no=$2
    echo "ERROR: Failed at line $line_no (exit $exit_code)" >&2
    exit "$exit_code"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/minimal.sh"  # Only essential utilities

# Configuration with defaults
MAX_ITERATIONS="${MAX_ITERATIONS:-25}"
TIMEOUT_AGENT="${TIMEOUT_AGENT:-3600}"
PLAN_PATH="${PLAN_PATH:-.ralph/PRD-${PRD_NUMBER:-1}/plan.md}"
PROGRESS_PATH="${PROGRESS_PATH:-.ralph/PRD-${PRD_NUMBER:-1}/progress.md}"

# Signal handling (improved from bash-best-practices)
cleanup() {
  # Block signals during cleanup
  trap '' INT TERM EXIT

  [[ -n "${AGENT_PID:-}" ]] && kill -TERM "$AGENT_PID" 2>/dev/null || true
  [[ -n "${TEMP_FILE:-}" ]] && rm -f "$TEMP_FILE" 2>/dev/null || true

  log "Loop terminated"
  trap - INT TERM EXIT
}
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup' EXIT

# Main iteration loop
for iteration in $(seq 1 "$MAX_ITERATIONS"); do
  log "=== Iteration $iteration/$MAX_ITERATIONS ==="

  # Story selection (simple: grep first unchecked)
  story_id=$(grep -m1 '^\s*- \[ \]' "$PLAN_PATH" | sed 's/.*US-/US-/' | cut -d: -f1)

  if [[ -z "$story_id" ]]; then
    log "All stories complete!"
    exit 0
  fi

  log "Working on: $story_id"

  # Save checkpoint for rollback (atomic write)
  HEAD_BEFORE=$(git rev-parse HEAD)
  echo "$HEAD_BEFORE" > "$RALPH_DIR/.checkpoint.tmp.$$"
  mv "$RALPH_DIR/.checkpoint.tmp.$$" "$RALPH_DIR/.checkpoint"

  # Build prompt and run agent with timeout
  TEMP_FILE=$(mktemp)
  build_prompt "$story_id" > "$TEMP_FILE"

  if timeout "$TIMEOUT_AGENT" claude -p --dangerously-skip-permissions < "$TEMP_FILE"; then
    # Success: commit (hooks will validate)
    git add -A
    git commit -m "feat($story_id): implementation" --no-verify || true
    mark_story_complete "$story_id"
    log "Completed: $story_id"
  else
    exit_code=$?
    if [[ $exit_code -eq 130 ]] || [[ $exit_code -eq 143 ]]; then
      log "Interrupted"
      exit "$exit_code"
    fi
    # Failure: hooks already triggered rollback
    log "Failed: $story_id (exit $exit_code) - hooks will handle"
  fi

  rm -f "$TEMP_FILE"
  TEMP_FILE=""
done

log "Max iterations reached"
exit 0
```

### Research Insights

**Security Hardening (from security-sentinel):**
- Current code uses `eval` with user-controllable inputs (CRITICAL)
- Path traversal possible in atomic_write without validation
- Race condition in lock acquisition needs PID-based detection

**Recommended Fix for JSON Parsing:**
```bash
# Validate JSON before parsing (prevents injection)
if ! echo "$hook_data" | jq -e . >/dev/null 2>&1; then
  echo '{"decision":"allow","message":"Invalid JSON"}'
  exit 0
fi

# Use fixed-string matching instead of regex for paths
if ! grep -qF "Read: $file_path" "$SESSION_LOG" 2>/dev/null; then
  echo '{"decision":"block"}'
fi
```

---

## Technical Approach

### Phase 1: Core Loop Implementation

**Files to create:**
- `.agents/ralph/simplified-loop.sh` - Core loop (~150 lines)
- `.agents/ralph/lib/minimal.sh` - Minimal utilities (~100 lines)

**Tasks:**
- [x] Create `simplified-loop.sh` with basic iteration logic
- [x] Implement `select_next_story()` using simple grep (no Python)
- [x] Implement `build_prompt()` using heredoc template
- [x] Implement `mark_story_complete()` using sed
- [x] Add signal handling (INT, TERM, EXIT) with proper trap ordering
- [x] Add timeout enforcement using `timeout` command
- [x] Add atomic checkpoint save before each story

### Research Insights

**Performance Optimization (from performance-oracle):**
```bash
# Lazy-load libraries instead of upfront sourcing
_load_heartbeat() {
  source "$SCRIPT_DIR/lib/heartbeat.sh"
  unset -f _load_heartbeat
}
update_heartbeat() { _load_heartbeat; update_heartbeat "$@"; }
```

**Minimal JSON Parsing Without jq (from bash-best-practices):**
```bash
# Pure bash JSON field extraction (10x faster than python3)
json_get() {
  local json="$1" field="$2"
  echo "$json" | grep -o "\"$field\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" | \
    sed 's/.*"\([^"]*\)"$/\1/'
}
```

---

### Phase 2: Hook Implementation

**Files to create:**
- `.agents/ralph/hooks/pre-prompt.sh` - UserPromptSubmit hook
- `.agents/ralph/hooks/pre-tool.sh` - PreToolUse hook
- `.agents/ralph/hooks/post-tool.sh` - PostToolUse hook
- `.agents/ralph/hooks/on-stop.sh` - Stop hook

**Tasks:**
- [x] Create `pre-tool.sh` with file validation (Edit requires prior Read)
- [x] Create `pre-tool.sh` with git state validation (no dirty state outside scope)
- [x] Create `post-tool.sh` with test failure detection (pattern matching)
- [x] Create `post-tool.sh` with rollback trigger (git reset --hard)
- [x] Create `on-stop.sh` with completion state validation
- [ ] Update hook installation script

### Phase 3: Integration & Testing

**Tasks:**
- [x] Create test fixtures with known pass/fail scenarios
- [ ] Test signal handling (Ctrl+C, SIGTERM)
- [ ] Test timeout enforcement
- [x] Test hook triggering via mock Claude commands
- [ ] Performance comparison with existing loop.sh

---

## Hook Specifications

### PreToolUse Hook (`pre-tool.sh`)

**Trigger:** Before Edit, Write, Bash tools

```bash
#!/bin/bash
# pre-tool.sh - Validate before tool execution
# CRITICAL: Must ALWAYS exit 0 to avoid breaking Claude Code
set -euo pipefail

trap 'echo "{\"decision\":\"allow\"}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"

# Read hook data from stdin (non-interactive context)
hook_data=""
if [[ ! -t 0 ]]; then
  hook_data=$(cat)
fi

# Validate JSON before parsing (security)
if ! echo "$hook_data" | jq -e . >/dev/null 2>&1; then
  echo '{"decision":"allow","message":"Invalid JSON, allowing by default"}'
  exit 0
fi

tool_name=$(echo "$hook_data" | jq -r '.tool_name // empty')
tool_input=$(echo "$hook_data" | jq -r '.tool_input // empty')

# Validate extracted values
if [[ -z "$tool_name" ]]; then
  echo '{"decision":"allow"}'
  exit 0
fi

case "$tool_name" in
  Edit)
    file_path=$(echo "$tool_input" | jq -r '.file_path // empty')

    # Sanitize file_path for grep (escape regex special chars)
    sanitized_path=$(printf '%s\n' "$file_path" | sed 's/[[\.*^$()+?{|]/\\&/g')

    # Use fixed string matching for security
    if ! grep -qF "Read: $file_path" "$RALPH_DIR/session.log" 2>/dev/null; then
      echo '{"decision":"block","message":"Must Read file before Edit"}'
      exit 0
    fi
    ;;
  Bash)
    command=$(echo "$tool_input" | jq -r '.command // empty')

    # Block with word boundaries to prevent false positives
    if [[ "$command" =~ (^|[[:space:]])(git[[:space:]]+push|git[[:space:]]+merge|ralph[[:space:]]+stream[[:space:]]+merge)([[:space:]]|$) ]]; then
      echo '{"decision":"block","message":"Push/merge operations blocked during build. Use create_pr instead."}'
      exit 0
    fi
    ;;
esac

echo '{"decision":"allow"}'
exit 0
```

### Research Insights

**Security Improvements (from security-sentinel):**
- Added JSON validation before parsing
- Used fixed-string grep instead of regex for paths
- Added word boundary matching for command blocking
- Added error trap that always returns allow + exit 0

**Hook Pattern (from hook-patterns-researcher):**
- Hooks receive JSON via stdin (not arguments)
- Must ALWAYS exit 0 (even on errors)
- Use trap to ensure clean exit on any failure

---

### PostToolUse Hook (`post-tool.sh`)

**Trigger:** After Bash, Edit, Write tools

```bash
#!/bin/bash
# post-tool.sh - Enforce after tool execution
# CRITICAL: Must ALWAYS exit 0
set -euo pipefail

trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"

hook_data=""
if [[ ! -t 0 ]]; then
  hook_data=$(cat)
fi

# Validate JSON
if ! echo "$hook_data" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

tool_name=$(echo "$hook_data" | jq -r '.tool_name // empty')
tool_output=$(echo "$hook_data" | jq -r '.tool_output // ""')

case "$tool_name" in
  Bash)
    # Comprehensive test failure detection (from test-failure-patterns)
    # Covers: Jest, Vitest, pytest, Go test, Mocha, RSpec, Bats
    if [[ "$tool_output" =~ (FAIL[[:space:]]|FAILED|✗|✕|not[[:space:]]ok|AssertionError:|Failures:|failed,|---[[:space:]]+FAIL:) ]]; then

      # Verify it's actually a test run (not just text containing "FAIL")
      if [[ "$tool_output" =~ (jest|vitest|pytest|mocha|go[[:space:]]test|rspec|bats|npm[[:space:]]test|yarn[[:space:]]test) ]]; then

        # Trigger rollback
        git_sha_before=$(cat "$RALPH_DIR/.checkpoint" 2>/dev/null || echo "")
        if [[ -n "$git_sha_before" ]]; then
          git reset --hard "$git_sha_before" 2>/dev/null || true
        fi

        # Log for retry context (with rotation)
        {
          echo "=== Test Failure $(date -Iseconds) ==="
          echo "$tool_output" | head -100  # Limit size
        } >> "$RALPH_DIR/failure-context.log"

        # Rotate if too large
        if [[ $(wc -c < "$RALPH_DIR/failure-context.log" 2>/dev/null || echo 0) -gt 100000 ]]; then
          tail -500 "$RALPH_DIR/failure-context.log" > "$RALPH_DIR/failure-context.log.tmp"
          mv "$RALPH_DIR/failure-context.log.tmp" "$RALPH_DIR/failure-context.log"
        fi
      fi
    fi
    ;;
esac

exit 0
```

### Research Insights

**Test Failure Patterns (from test-failure-patterns-researcher):**

| Framework | Failure Indicator | Regex Pattern |
|-----------|------------------|---------------|
| Jest | FAIL ✕ | `FAIL\s\|✕\|Tests:.*failed` |
| Vitest | × FAIL | `×\s\|FAIL\s\|Tests\s.*failed` |
| pytest | FAILED = | `FAILED.*::\|=.*FAILURES\|failed,` |
| Go test | --- FAIL: | `^---\s+FAIL:\|^FAIL$` |
| Mocha | failing ✗ | `failing\|✗.*\d+\)` |
| RSpec | F Failures: | `Failures:\|^\s+\d+\)\|failures?` |
| Bats | ✗ not ok | `✗\|^not\s+ok\|failures?` |

**Comprehensive Pattern:**
```bash
(FAIL[[:space:]]|FAILED|✗|✕|not[[:space:]]ok|AssertionError:|Failures:|failed,|---[[:space:]]+FAIL:)
```

---

### Stop Hook (`on-stop.sh`)

**Trigger:** When Claude Code session ends

```bash
#!/bin/bash
# on-stop.sh - Validate completion state
# CRITICAL: Must ALWAYS exit 0
set -euo pipefail

trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
PLAN_PATH="${PLAN_PATH:-$RALPH_DIR/PRD-1/plan.md}"

# Check if story was marked complete
if [[ -f "$RALPH_DIR/current-story" ]]; then
  story_id=$(cat "$RALPH_DIR/current-story" 2>/dev/null || echo "")

  if [[ -n "$story_id" ]]; then
    # Use fixed-string grep for security
    if ! grep -qF "[x] $story_id" "$PLAN_PATH" 2>/dev/null; then
      # Log incomplete state for resumption
      {
        echo "incomplete:$story_id:$(date +%s)"
      } >> "$RALPH_DIR/sessions.log"
    fi
  fi
fi

# Cleanup
rm -f "$RALPH_DIR/current-story" "$RALPH_DIR/.checkpoint" 2>/dev/null || true

exit 0
```

### Research Insights

**Agent-Native Improvement (from agent-native-reviewer):**

Instead of heuristic completion detection in Stop hook, provide explicit completion tool:

```typescript
tool("complete_story", {
  storyId: z.string(),
  summary: z.string(),
  status: z.enum(["success", "partial", "blocked"]),
  testsPassed: z.boolean(),
}, async (params) => {
  // Verify claims against reality
  const testsActuallyPassed = await runTests();
  if (params.testsPassed && !testsActuallyPassed) {
    return {
      text: "Tests did not pass. Cannot complete.",
      shouldContinue: true,
    };
  }

  await markStoryComplete(params.storyId, params.summary);
  return { text: `Completed: ${params.summary}`, shouldContinue: false };
});
```

---

## Acceptance Criteria

### Functional Requirements

- [ ] Loop selects next unchecked story from plan.md
- [ ] Loop runs Claude agent with configurable timeout
- [ ] Loop commits on success with story ID in message
- [ ] Loop continues on failure (hooks handle rollback)
- [ ] Loop exits cleanly on all stories complete
- [ ] Loop exits cleanly on max iterations
- [ ] Loop handles SIGINT (Ctrl+C) with proper cleanup
- [ ] Loop handles SIGTERM with proper cleanup

### Non-Functional Requirements

- [ ] Core loop is under 200 lines of Bash
- [ ] Loop starts in under 500ms
- [ ] Loop has no external dependencies beyond: bash 4+, git, jq, timeout
- [ ] All file writes are atomic (temp file + mv)
- [ ] Hooks are independently testable

### Hook Requirements

- [ ] PreToolUse blocks Edit without prior Read
- [ ] PreToolUse blocks git push/merge commands
- [ ] PostToolUse detects test failure patterns (all frameworks)
- [ ] PostToolUse triggers rollback on test failure
- [ ] Stop hook validates completion state
- [ ] All hooks exit 0 (never crash Claude Code)
- [ ] All hooks validate JSON input before parsing

### Quality Gates

- [ ] All tests pass: `./tests/simplified-loop.test.sh`
- [ ] Shellcheck passes with no warnings
- [ ] Loop works with existing PRD-N folder structure
- [ ] Loop produces compatible progress.md format

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Core loop LOC | < 200 | `wc -l simplified-loop.sh` |
| Startup time | < 500ms | `time ./simplified-loop.sh --dry-run` |
| Hook response time | < 100ms | `time ./hooks/pre-tool.sh < test-input.json` |
| Test coverage | > 80% | Unit tests for each function |

### Research Insights

**Performance Targets (from performance-oracle):**

| Metric | Current | After Optimization | Target |
|--------|---------|-------------------|--------|
| Loop startup | 1-3s | **300-500ms** | <500ms |
| Hook response | 200-500ms | **50-100ms** | <100ms |
| Per-iteration overhead | 500-1000ms | **100-200ms** | - |

---

## Dependencies & Prerequisites

**Required:**
- Bash 4.0+ (for associative arrays, if needed)
- Git (for commits and rollback)
- jq (for JSON parsing in hooks)
- timeout command (GNU coreutils)

**Optional:**
- Claude CLI installed and configured
- Existing .ralph/PRD-N structure from `ralph plan`

### Research Insights

**Dependency Analysis (from code-simplicity-reviewer):**
- jq can be avoided for simple cases using grep/sed
- Python is NOT optional in current codebase (embedded scripts)
- Recommendation: Commit fully to either Node.js OR pure bash

---

## Risk Analysis & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Hooks may not fire correctly | High | Test with mock Claude commands |
| Rollback may corrupt state | High | Atomic operations + checkpoints |
| Test detection false positives | Medium | Conservative pattern matching + framework verification |
| Signal handling race conditions | Medium | Proper trap ordering + signal blocking during cleanup |
| Command injection in hooks | Critical | JSON validation + fixed-string matching |
| State file corruption | High | Atomic writes (temp + mv) |
| Hook-to-loop error propagation | Medium | Error signal files (.hook-error.json) |

### Research Insights

**Security Risks (from security-sentinel):**

| Priority | Issue | Fix Complexity |
|----------|-------|---------------|
| **CRITICAL** | Command injection via `eval` | Medium |
| **HIGH** | Unsafe JSON parsing in hooks | Medium |
| **MEDIUM** | Path traversal in atomic_write | Low |
| **MEDIUM** | Race condition in locks | Medium |

---

## Implementation Phases

### Phase 1: Foundation (Core Loop)
- Create simplified-loop.sh
- Create lib/minimal.sh
- Implement story selection
- Implement signal handling with proper cleanup
- Basic integration test
- Atomic checkpoint save/restore

### Phase 2: Hook Infrastructure
- Create hook directory structure
- Implement pre-tool.sh with JSON validation
- Implement post-tool.sh with multi-framework detection
- Implement on-stop.sh
- Hook installation script
- Error signal file protocol

### Phase 3: Enforcement Logic
- File read validation in pre-tool
- Git operation blocking in pre-tool (with alternatives)
- Test failure detection in post-tool
- Rollback triggering in post-tool
- Completion validation in on-stop
- Feedback loop to guardrails

### Phase 4: Testing & Validation
- Unit tests for each function
- Integration tests with mock agent
- Signal handling tests
- Performance benchmarks
- Security audit (shellcheck + manual review)
- Documentation

---

## File Structure

```
.agents/ralph/
├── simplified-loop.sh          # Core loop (~150 lines)
├── lib/
│   └── minimal.sh              # Essential utilities (~100 lines)
├── hooks/
│   ├── pre-prompt.sh           # UserPromptSubmit hook
│   ├── pre-tool.sh             # PreToolUse hook
│   ├── post-tool.sh            # PostToolUse hook
│   └── on-stop.sh              # Stop hook
└── PROMPT_simplified.md        # Prompt template

tests/
├── simplified-loop.test.sh     # Integration tests
├── hooks/
│   ├── pre-tool.test.sh        # Pre-tool hook tests
│   ├── post-tool.test.sh       # Post-tool hook tests
│   └── on-stop.test.sh         # Stop hook tests
└── fixtures/
    ├── plan-complete.md        # All stories complete
    ├── plan-partial.md         # Some stories complete
    ├── test-output-jest.txt    # Jest failure output
    ├── test-output-pytest.txt  # pytest failure output
    └── test-output-go.txt      # Go test failure output
```

---

## Claude Code Hooks Configuration

Add to `~/.claude/settings.local.json`:

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [{
        "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.agents/ralph/hooks/pre-prompt.sh"
      }]
    }],
    "PreToolUse": [{
      "matcher": "Bash|Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.agents/ralph/hooks/pre-tool.sh"
      }]
    }],
    "PostToolUse": [{
      "matcher": "Bash|Edit|Write",
      "hooks": [{
        "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.agents/ralph/hooks/post-tool.sh"
      }]
    }],
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "$CLAUDE_PROJECT_DIR/.agents/ralph/hooks/on-stop.sh"
      }]
    }]
  }
}
```

### Research Insights

**Hook Configuration (from hook-patterns-researcher):**
- Hooks receive JSON via stdin, not arguments
- Must use absolute paths (no runtime variable substitution)
- Multiple hooks per event execute sequentially
- Error in hook breaks Claude Code (hence exit 0 requirement)

---

## References & Research

### Internal References
- Existing loop: `.agents/ralph/loop.sh` (4,244 lines)
- Retry logic: `.agents/ralph/lib/retry.sh:94-198`
- Hook examples: `.agents/ralph/auto-speak-hook.sh`, `.agents/ralph/prompt-ack-hook.sh`
- Config: `.agents/ralph/config.sh`

### External References
- Claude Code hooks documentation: https://docs.anthropic.com/en/docs/claude-code/hooks
- Bash best practices: https://google.github.io/styleguide/shellguide.html
- GNU timeout: https://www.gnu.org/software/coreutils/manual/html_node/timeout-invocation.html
- ShellCheck: https://www.shellcheck.net/

### Related Work
- TypeScript migration: `plans/feat-typescript-migration-v0-2.md`
- Factory mode: `skills/factory/SKILL.md`

### Research Sources
- Jest CLI: https://jestjs.io/docs/cli
- pytest exit codes: https://docs.pytest.org/en/stable/reference/exit-codes.html
- Go test: https://pkg.go.dev/testing
- TAP specification: https://testanything.org/tap-specification.html

---

Generated with [Claude Code](https://claude.com/claude-code)
