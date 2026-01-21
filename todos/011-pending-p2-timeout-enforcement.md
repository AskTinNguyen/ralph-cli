---
status: pending
priority: p2
issue_id: "011"
tags: [code-review, plan-review, bash, reliability, ralph-loop]
dependencies: []
created: 2026-01-21
---

# Add Agent Timeout Enforcement

## Problem Statement

The proposed loop has no timeout enforcement. Agent calls could hang indefinitely if the model becomes unresponsive, network issues occur, or the task is too complex.

**Why it matters:**
- Build can hang forever without user knowing
- Resource waste (terminal, API connection held)
- No automatic recovery mechanism
- Poor user experience - manual kill required

## Findings

### From robustness-reviewer:
- Current Ralph: `lib/timeout.sh` enforces 3600s default
- Proposed: No timeout mentioned
- Impact: Indefinite hang on agent failure

### Hang scenarios:
1. **Network timeout** - API connection drops silently
2. **Model overload** - 529 errors with long backoff
3. **Infinite loop** - Agent stuck in reasoning loop
4. **Large codebase** - Context window exceeded, slow response

## Proposed Solutions

### Solution A: bash timeout command (Recommended)
**Pros:** Simple, built-in, no dependencies
**Cons:** Coarse-grained (whole command)
**Effort:** Small
**Risk:** Low

```bash
AGENT_TIMEOUT=${AGENT_TIMEOUT:-600}  # 10 minutes default

run_agent() {
  local prompt="$1"
  timeout --signal=TERM --kill-after=30 "$AGENT_TIMEOUT" \
    claude -p --dangerously-skip-permissions < "$prompt"
  local exit_code=$?

  if [[ $exit_code -eq 124 ]]; then
    echo "Error: Agent timed out after ${AGENT_TIMEOUT}s" >&2
    return 124
  fi
  return $exit_code
}
```

### Solution B: Background process with manual timeout
**Pros:** More control, can show progress
**Cons:** More complex, PID management
**Effort:** Medium
**Risk:** Low

```bash
run_agent_with_progress() {
  local prompt="$1"
  local timeout="${AGENT_TIMEOUT:-600}"

  claude -p --dangerously-skip-permissions < "$prompt" &
  local agent_pid=$!

  local elapsed=0
  while kill -0 $agent_pid 2>/dev/null; do
    sleep 5
    elapsed=$((elapsed + 5))
    echo "⏱ Elapsed: ${elapsed}s" >&2

    if [[ $elapsed -ge $timeout ]]; then
      echo "Timeout reached, killing agent..." >&2
      kill -TERM $agent_pid 2>/dev/null
      sleep 5
      kill -9 $agent_pid 2>/dev/null
      return 124
    fi
  done

  wait $agent_pid
}
```

## Recommended Action

Use **Solution A** (bash timeout) - simplest, reliable.

## Technical Details

**Affected files:**
- `lib/loop.sh` (proposed) - wrap agent invocation

**Environment variables:**
- `AGENT_TIMEOUT` - seconds before timeout (default: 600)

## Acceptance Criteria

- [ ] Agent killed after timeout period
- [ ] Clear error message on timeout
- [ ] Exit code 124 for timeout (standard)
- [ ] Configurable timeout via environment variable
- [ ] Grace period before SIGKILL (30s)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-21 | Created | Identified during plan review |
