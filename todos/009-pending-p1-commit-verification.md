---
status: pending
priority: p1
issue_id: "009"
tags: [code-review, plan-review, bash, git, ralph-loop]
dependencies: []
created: 2026-01-21
---

# Add Git Commit Verification After Agent Execution

## Problem Statement

The proposed loop trusts the agent to create commits but never verifies commits were actually made. If the agent forgets to commit, fails mid-execution, or commits incorrectly, the loop proceeds as if successful.

**Why it matters:**
- Silent data loss - work done but not committed
- Story marked complete but changes lost
- Resume mechanism breaks (story skipped but work missing)
- No audit trail of what was accomplished

## Findings

### From robustness-reviewer:
- **Location:** Proposed build iteration logic
- **Pattern:** `if claude ... ; then mark_complete; fi`
- **Impact:** Agent success != commit success

### Failure Scenarios:
```bash
# Scenario 1: Agent forgets to commit
1. Agent successfully implements feature
2. Agent exits with code 0 (success)
3. Loop marks story [x] complete
4. BUT: No commit was created!
5. Changes sit in working directory
6. Next iteration may overwrite them

# Scenario 2: Agent commits but with wrong message
1. Agent commits as "WIP" or "temp"
2. Loop marks story complete
3. Commit history is polluted

# Scenario 3: Agent partially commits
1. Agent commits some files, misses others
2. Loop marks complete
3. Uncommitted files lost on next iteration
```

### Current Proposed Code:
```bash
if claude -p --dangerously-skip-permissions < /tmp/prompt.md; then
    mark_complete "$id"
    git add -A && git commit -m "feat($id): $title"  # This is AFTER agent
    echo "Completed: $id"
fi
```

The plan shows the loop doing `git commit` after the agent, but this doesn't verify the agent's work was actually committed properly.

## Proposed Solutions

### Solution A: Check git log for new commits (Recommended)
**Pros:** Direct verification, can check commit message format
**Cons:** Slightly more complex
**Effort:** Small
**Risk:** Low

```bash
run_iteration() {
  local story_id="$1" story_title="$2"
  local head_before=$(git rev-parse HEAD)

  # Run agent
  if ! claude -p --dangerously-skip-permissions < /tmp/prompt.md; then
    echo "Agent failed for $story_id" >&2
    return 1
  fi

  local head_after=$(git rev-parse HEAD)

  # Verify commit was created
  if [[ "$head_before" == "$head_after" ]]; then
    echo "Warning: Agent succeeded but no commit created" >&2
    echo "Creating commit for uncommitted changes..." >&2

    # Check for uncommitted changes
    if [[ -n "$(git status --porcelain)" ]]; then
      git add -A
      git commit -m "feat($story_id): $story_title"
    else
      echo "Error: No changes to commit. Story may not have been implemented." >&2
      return 1
    fi
  fi

  mark_complete "$story_id"
}
```

### Solution B: Check for uncommitted files only
**Pros:** Simpler, catches dirty state
**Cons:** Doesn't verify commit quality
**Effort:** Small
**Risk:** Low

```bash
verify_clean_state() {
  local dirty=$(git status --porcelain)
  if [[ -n "$dirty" ]]; then
    echo "Warning: Uncommitted changes after agent:" >&2
    echo "$dirty" >&2
    return 1
  fi
  return 0
}
```

### Solution C: Require specific commit message format
**Pros:** Ensures conventional commits, verifiable
**Cons:** More restrictive
**Effort:** Medium
**Risk:** Medium

```bash
verify_commit() {
  local story_id="$1"
  local last_commit=$(git log -1 --pretty=format:"%s")

  # Check commit message contains story ID
  if [[ ! "$last_commit" =~ $story_id ]]; then
    echo "Error: Last commit doesn't reference $story_id" >&2
    echo "Commit message: $last_commit" >&2
    return 1
  fi
}
```

## Recommended Action

Use **Solution A** (check git log + fallback commit) - most robust, handles all failure modes.

## Technical Details

**Affected files:**
- `lib/loop.sh` (proposed) - run_build() iteration logic

**Git commands used:**
- `git rev-parse HEAD` - get current commit SHA
- `git status --porcelain` - check for uncommitted changes
- `git log -1 --pretty=format:"%s"` - get last commit message

**Testing:**
```bash
# Test: Agent succeeds but no commit
# Mock agent that exits 0 but doesn't commit
mock_agent() { echo "// New code" >> test.js; exit 0; }
# Expected: Loop creates fallback commit

# Test: Agent commits correctly
# Mock agent that commits
mock_agent() { echo "// New code" >> test.js; git add -A; git commit -m "feat(US-001): test"; }
# Expected: Loop verifies commit exists, marks complete

# Test: No changes at all
mock_agent() { exit 0; }  # Does nothing
# Expected: Error message, story not marked complete
```

## Acceptance Criteria

- [ ] Verify HEAD changed after agent execution
- [ ] Create fallback commit if agent forgot to commit
- [ ] Error if agent succeeded but no changes exist
- [ ] Log warning if fallback commit was needed
- [ ] Include story ID in any fallback commit message

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-21 | Created | Identified during plan review |

## Resources

- [git rev-parse documentation](https://git-scm.com/docs/git-rev-parse)
- [Conventional commits spec](https://www.conventionalcommits.org/)
