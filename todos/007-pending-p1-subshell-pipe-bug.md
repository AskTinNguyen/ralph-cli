---
status: pending
priority: p1
issue_id: "007"
tags: [code-review, plan-review, bash, bug, ralph-loop]
dependencies: []
created: 2026-01-21
---

# Fix Subshell Pipe Bug in select_story()

## Problem Statement

The proposed `select_story()` function uses a pipe into a brace block `{ }`, creating a subshell. Variables set inside the subshell don't exist in the parent shell, causing the function to return empty.

**Why it matters:**
- Story selection completely broken
- Build loop never starts (no story found)
- Silent failure - no error message
- Core functionality non-functional

## Findings

### From code-quality-reviewer:
- **Location:** Proposed `select_story()` in plan
- **Pattern:** `grep ... | head -1 | { read -r match; ... echo "$id|$title|$line" }`
- **Impact:** Function always returns empty, loop exits immediately

### Evidence:
```bash
# BROKEN - variables in subshell don't escape
grep -n "^### \[ \] US-" "$prd" | head -1 | {
  read -r match
  [[ -z "$match" ]] && return 1
  local line="${match%%:*}"
  local id=$(echo ... | sed ...)
  echo "$id|$title|$line"  # This echo goes to stdout of the subshell
}
# But nothing is captured by the caller!

# The pipe creates a subshell:
# - parent shell → pipe → head → pipe → { subshell }
# - Variables in subshell are lost when subshell exits
```

### Bash Subshell Behavior:
```bash
# Test case demonstrating the bug:
result=$(echo "foo" | { read -r x; echo "got: $x"; })
echo "Result: $result"  # Works! BUT...

# With return/exit:
func() {
  echo "test" | { read -r x; return 1; }  # return exits subshell, not func
  echo "This still runs!"  # Unexpected!
}
```

## Proposed Solutions

### Solution A: Command substitution (Recommended)
**Pros:** Clean, portable, no subshell issues
**Cons:** Slightly more verbose
**Effort:** Small
**Risk:** Low

```bash
select_story() {
  local prd="$1"
  local match=$(grep -n "^### \[ \] US-" "$prd" | head -1)
  [[ -z "$match" ]] && return 1

  local line="${match%%:*}"
  local rest="${match#*:}"
  local id=$(echo "$rest" | sed 's/### \[ \] \(US-[0-9]*\).*/\1/')
  local title=$(echo "$rest" | sed 's/### \[ \] US-[0-9]*: //')
  echo "$id|$title|$line"
}
```

### Solution B: Process substitution
**Pros:** Single pass, efficient
**Cons:** Bash 4.0+ required, less portable
**Effort:** Small
**Risk:** Low

```bash
select_story() {
  local prd="$1"
  local id title line

  while IFS=: read -r line rest; do
    id=$(echo "$rest" | grep -o 'US-[0-9]\+')
    title=$(echo "$rest" | sed 's/### \[ \] US-[0-9]*: //')
    echo "$id|$title|$line"
    return 0
  done < <(grep -n "^### \[ \] US-" "$prd" | head -1)

  return 1
}
```

### Solution C: Here-string approach
**Pros:** Works in older bash
**Cons:** Slightly harder to read
**Effort:** Small
**Risk:** Low

```bash
select_story() {
  local prd="$1"
  local match
  read -r match <<< "$(grep -n "^### \[ \] US-" "$prd" | head -1)"
  [[ -z "$match" ]] && return 1

  local line="${match%%:*}"
  local rest="${match#*:}"
  # ... rest of logic
}
```

## Recommended Action

Use **Solution A** (command substitution) - clearest, most portable.

## Technical Details

**Affected files:**
- `lib/loop.sh` (proposed) - select_story() function

**Testing:**
```bash
# Create test PRD
cat > /tmp/test-prd.md << 'EOF'
# Test PRD

### [ ] US-001: First story
Content here

### [ ] US-002: Second story
More content
EOF

# Test function
select_story() {
  local prd="$1"
  local match=$(grep -n "^### \[ \] US-" "$prd" | head -1)
  [[ -z "$match" ]] && return 1
  local line="${match%%:*}"
  local rest="${match#*:}"
  local id=$(echo "$rest" | sed 's/### \[ \] \(US-[0-9]*\).*/\1/')
  local title=$(echo "$rest" | sed 's/### \[ \] US-[0-9]*: //')
  echo "$id|$title|$line"
}

result=$(select_story /tmp/test-prd.md)
echo "Result: $result"  # Should output: US-001|First story|3
```

## Acceptance Criteria

- [ ] `select_story()` returns correct story ID
- [ ] `select_story()` returns correct story title
- [ ] `select_story()` returns correct line number
- [ ] Returns exit code 1 when no unchecked stories found
- [ ] Works in bash 3.2+ (macOS default)

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-21 | Created | Identified during plan review |

## Resources

- [BashFAQ: I set variables in a loop that's in a pipeline. Why do they disappear?](https://mywiki.wooledge.org/BashFAQ/024)
- [Bash subshell behavior](https://www.gnu.org/software/bash/manual/html_node/Command-Execution-Environment.html)
