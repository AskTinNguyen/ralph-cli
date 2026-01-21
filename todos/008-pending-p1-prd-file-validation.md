---
status: pending
priority: p1
issue_id: "008"
tags: [code-review, plan-review, bash, validation, ralph-loop]
dependencies: []
created: 2026-01-21
---

# Add PRD File Existence Validation

## Problem Statement

The proposed loop assumes the PRD file exists but has no validation. If the file is missing, deleted, or inaccessible, the loop fails with a cryptic error message.

**Why it matters:**
- Poor user experience on common failure case
- Confusing error: "Could not parse stories" vs "File not found"
- No guidance on how to fix the issue
- First-time users stuck without clear feedback

## Findings

### From robustness-reviewer:
- **Location:** Proposed loop entry point
- **Pattern:** `grep -n "^### \[ \] US-" "$prd"` without existence check
- **Impact:** Generic error message doesn't indicate file access issue

### Failure Chain:
```bash
# User scenario:
1. User runs `ralph build 5`
2. PRD file was deleted/moved/never created
3. grep fails silently (empty output)
4. select_story returns "no stories found"
5. User message: "No remaining stories" (misleading!)
6. User confused: "But I just created stories!"
```

### Current Ralph Behavior:
The full Ralph CLI validates PRD existence in multiple places but the proposed minimal version lacks this.

## Proposed Solutions

### Solution A: Early validation in run_build() (Recommended)
**Pros:** Clear error, fast fail, actionable message
**Cons:** None
**Effort:** Small
**Risk:** Low

```bash
run_build() {
  local iterations="${1:-5}"
  local prd_path="${RALPH_DIR}/prd.md"

  # Validate PRD exists and is readable
  if [[ ! -f "$prd_path" ]]; then
    echo "Error: PRD file not found at $prd_path" >&2
    echo "Run 'ralph init' to set up, then create your PRD." >&2
    exit 1
  fi

  if [[ ! -r "$prd_path" ]]; then
    echo "Error: PRD file not readable: $prd_path" >&2
    echo "Check file permissions: ls -la $prd_path" >&2
    exit 1
  fi

  # Continue with build...
}
```

### Solution B: Validation in select_story()
**Pros:** Defensive, catches issues at point of use
**Cons:** Error message less contextual
**Effort:** Small
**Risk:** Low

```bash
select_story() {
  local prd="$1"

  [[ -f "$prd" ]] || { echo "PRD not found: $prd" >&2; return 2; }
  [[ -r "$prd" ]] || { echo "PRD not readable: $prd" >&2; return 2; }

  local match=$(grep -n "^### \[ \] US-" "$prd" | head -1)
  # ... rest
}
```

### Solution C: Both layers (defense in depth)
**Pros:** Maximum protection
**Cons:** Redundant checks
**Effort:** Small
**Risk:** Low

## Recommended Action

Use **Solution A** (early validation in run_build) - clearest user feedback.

## Technical Details

**Affected files:**
- `ralph` (proposed) - main entry point
- `lib/loop.sh` (proposed) - run_build() function

**Exit codes:**
- `1` - File not found
- `2` - File not readable
- Distinct from `0` (success) and story-not-found scenarios

**Testing:**
```bash
# Test missing file
rm -f .ralph/prd.md
./ralph build 1
# Expected: "Error: PRD file not found at .ralph/prd.md"

# Test permission issue
chmod 000 .ralph/prd.md
./ralph build 1
# Expected: "Error: PRD file not readable"
chmod 644 .ralph/prd.md
```

## Acceptance Criteria

- [ ] Clear error message when PRD file doesn't exist
- [ ] Clear error message when PRD file isn't readable
- [ ] Exit code 1 (not 0) on file errors
- [ ] Error message includes path to missing file
- [ ] Error message suggests next steps (run init, check permissions)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-21 | Created | Identified during plan review |

## Resources

- [Bash file test operators](https://www.gnu.org/software/bash/manual/html_node/Bash-Conditional-Expressions.html)
