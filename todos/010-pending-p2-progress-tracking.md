---
status: pending
priority: p2
issue_id: "010"
tags: [code-review, plan-review, bash, state-management, ralph-loop]
dependencies: []
created: 2026-01-21
---

# Add Progress Tracking (progress.md)

## Problem Statement

The proposed minimal loop lacks progress tracking. There's no audit trail of which stories were completed, when, or what commits were created. Debugging failures requires manually checking git history.

**Why it matters:**
- No visibility into build progress
- Hard to debug what went wrong
- No resume context after interruption
- Can't track build statistics (duration, cost, iterations)

## Findings

### From architecture-reviewer:
- Current Ralph: `progress.md` tracks completion with commit SHAs
- Proposed: No progress file mentioned
- Impact: Loss of observability and debugging capability

### What progress.md provides:
```markdown
# Build Progress

## Session: 2026-01-21T10:30:00

### Iteration 1
- Story: US-001 - Add user login
- Status: ✓ Complete
- Commit: abc1234
- Duration: 2m 34s

### Iteration 2
- Story: US-002 - Add password reset
- Status: ✗ Failed
- Error: Agent timeout after 300s
- Rollback: def5678 → abc1234
```

## Proposed Solutions

### Solution A: Simple append-only log (Recommended)
**Pros:** Simple, no state management, easy to parse
**Cons:** File grows over time
**Effort:** Small
**Risk:** Low

```bash
log_progress() {
  local story_id="$1"
  local status="$2"  # "complete" or "failed"
  local commit="${3:-}"
  local progress_file="${RALPH_DIR}/progress.md"

  cat >> "$progress_file" << EOF

### $(date '+%Y-%m-%d %H:%M:%S')
- Story: $story_id
- Status: $status
- Commit: ${commit:-N/A}
EOF
}

# Usage in loop:
if run_agent "$prompt"; then
  local commit=$(git rev-parse --short HEAD)
  log_progress "$story_id" "complete" "$commit"
  mark_complete "$story_id"
else
  log_progress "$story_id" "failed"
fi
```

### Solution B: JSON checkpoint file
**Pros:** Machine-readable, supports resume
**Cons:** Requires jq dependency or manual parsing
**Effort:** Medium
**Risk:** Low

```bash
save_checkpoint() {
  local iteration="$1" story_id="$2" status="$3"
  local checkpoint="${RALPH_DIR}/checkpoint.json"

  cat > "$checkpoint" << EOF
{
  "iteration": $iteration,
  "story_id": "$story_id",
  "status": "$status",
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "git_sha": "$(git rev-parse HEAD)"
}
EOF
}
```

## Recommended Action

Use **Solution A** (simple append log) for v1 - sufficient for debugging without added complexity.

## Technical Details

**Affected files:**
- `lib/loop.sh` (proposed) - add log_progress() function
- Creates: `.ralph/progress.md`

## Acceptance Criteria

- [ ] Progress file created on first iteration
- [ ] Each iteration logged with timestamp
- [ ] Completed stories show commit SHA
- [ ] Failed stories show error reason
- [ ] File survives interruption (append-only)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-21 | Created | Identified during plan review |
