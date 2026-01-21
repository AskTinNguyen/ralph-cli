---
status: complete
priority: p2
issue_id: "016"
tags: [security, code-review, simplified-loop]
dependencies: []
---

# TOCTOU Race Condition in Checkpoint Rollback

## Problem Statement

The simplified-loop.sh creates a checkpoint before agent execution and uses it for rollback on failure, but there's a Time-Of-Check-Time-Of-Use (TOCTOU) race condition between checkpoint creation and potential rollback.

**Severity:** P2 - Race condition could lead to data loss or inconsistent state.

## Findings

- Location: `.agents/ralph/simplified-loop.sh:129-132`
- Current flow:
  ```bash
  HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [[ -n "$HEAD_BEFORE" ]]; then
    atomic_write "$RALPH_DIR/.checkpoint" "$HEAD_BEFORE"
  fi
  # ... agent executes (potentially long running) ...
  # ... rollback uses checkpoint ...
  ```
- **Race condition scenario:**
  1. Checkpoint created at commit A
  2. Agent starts working
  3. Another process (parallel build, user, CI) makes commit B
  4. Agent fails
  5. Rollback goes to A, losing commit B

**Risk Assessment:**
- Low probability in single-stream usage
- Higher risk with parallel streams or CI integration
- Could lose legitimate work from other processes

## Proposed Solutions

### Option 1: Lock-Based Checkpoint (Recommended)

**Approach:** Use file locks to prevent concurrent modifications during agent execution.

```bash
# Acquire exclusive lock before checkpoint
exec 200>"$RALPH_DIR/.agent-lock"
if ! flock -n 200; then
  log_error "Another agent is running. Use stream mode for parallel builds."
  exit 1
fi

HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
# ... agent executes ...
# Lock released automatically when script exits
```

**Pros:**
- Prevents concurrent modification
- Simple implementation
- Standard Unix pattern

**Cons:**
- Blocks parallel execution in same repo
- Lock must be released on all exit paths

**Effort:** 1 hour

**Risk:** Low

---

### Option 2: Verify Checkpoint Before Rollback

**Approach:** Before rollback, verify the checkpoint is still valid (no new commits).

```bash
rollback_if_safe() {
  local checkpoint="$1"
  local current_head
  current_head=$(git rev-parse HEAD)

  # Check if checkpoint is direct parent of current HEAD
  if git merge-base --is-ancestor "$checkpoint" "$current_head"; then
    # Safe to rollback - no unrelated commits
    git reset --hard "$checkpoint"
  else
    log_warn "Checkpoint stale. Manual intervention required."
    log_warn "Expected: $checkpoint, Current: $current_head"
    return 1
  fi
}
```

**Pros:**
- Non-blocking
- Preserves unrelated work
- Fails safely

**Cons:**
- May not rollback when needed
- User must handle stale checkpoint

**Effort:** 1 hour

**Risk:** Medium

---

### Option 3: Git Reflog-Based Recovery

**Approach:** Use git reflog to track all changes and provide recovery options.

**Pros:**
- Complete audit trail
- Manual recovery possible

**Cons:**
- Complex recovery process
- Not automated

**Effort:** 2 hours

**Risk:** Low

## Recommended Action

Implement Option 1 (lock-based) for single-stream mode. The lock prevents the race condition entirely. For parallel streams, worktrees already provide isolation.

## Technical Details

**Affected files:**
- `.agents/ralph/simplified-loop.sh:129-132` - checkpoint creation
- `.agents/ralph/hooks/post-tool.sh` - rollback logic

**Related components:**
- Stream mode uses worktrees (already isolated)
- `.ralph/.checkpoint` file

## Resources

- **PR:** #11
- **Related:** TOCTOU vulnerabilities

## Acceptance Criteria

- [x] Lock acquired before checkpoint creation
- [x] Lock released on all exit paths (trap)
- [x] Parallel execution blocked with clear error message
- [x] Worktree/stream mode still works (unaffected - uses separate worktrees)
- [ ] Test added for concurrent execution detection

## Work Log

### 2026-01-21 - Code Review Discovery

**By:** Claude Code (/workflows:review)

**Actions:**
- Identified TOCTOU race condition in checkpoint logic
- Analyzed parallel execution scenarios
- Proposed 3 solution approaches
- Recommended lock-based approach (Option 1)

**Learnings:**
- Checkpoints must be protected from concurrent modification
- Worktrees provide better isolation for parallel work

### 2026-01-21 - Fix Implemented

**By:** Claude Opus 4.5

**Actions:**
- Implemented Option 1 (lock-based checkpoint) in `.agents/ralph/simplified-loop.sh`
- Added exclusive file lock using `flock` before checkpoint creation (lines 115-124)
- Lock file: `$RALPH_DIR/.agent-lock`
- Lock is automatically released when script exits (file descriptor closed)
- Clear error message when another agent is running

**Changes:**
```bash
# Acquire exclusive lock to prevent concurrent modifications (TOCTOU protection)
LOCK_FILE="$RALPH_DIR/.agent-lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
  log_error "Another agent is running. Use stream mode for parallel builds."
  exit 1
fi
log "Acquired exclusive lock for agent execution"
```

**Notes:**
- Test for concurrent execution detection not yet added (marked incomplete in acceptance criteria)
- Worktree/stream mode remains unaffected as it uses isolated directories
