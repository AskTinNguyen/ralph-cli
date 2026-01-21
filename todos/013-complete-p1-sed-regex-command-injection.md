---
status: complete
priority: p1
issue_id: "013"
tags: [security, code-review, simplified-loop]
dependencies: []
completed_at: 2026-01-21
---

# Command Injection via sed Regex in mark_story_complete

## Problem Statement

The `mark_story_complete` function in `lib/minimal.sh` uses a story ID directly in a sed regex pattern without proper escaping. A malicious story ID containing sed metacharacters or shell escapes could execute arbitrary commands.

**Severity:** P1 - Security vulnerability that could allow code execution.

## Findings

- Location: `.agents/ralph/lib/minimal.sh` - `mark_story_complete` function
- The story ID is extracted from `plan.md` and passed directly to sed
- While story IDs come from plan.md (not direct user input), a compromised plan file could inject malicious patterns
- Current regex: `sed -i.bak "s/\\[\\s*\\]\\s*\\(.*${story_id}\\)/[x] \\1/" "$plan_path"`
- Potential attack vector: Story ID like `US-001); rm -rf /; echo (`

**Risk Assessment:**
- Plan files are created by trusted tools (ralph plan)
- But defense-in-depth requires sanitizing all inputs to shell commands
- Similar vulnerability pattern to CVE-2016-10074 (sed injection)

## Proposed Solutions

### Option 1: Escape sed Metacharacters

**Approach:** Sanitize story_id by escaping all sed special characters before use.

```bash
sanitize_for_sed() {
  echo "$1" | sed 's/[&/\]/\\&/g; s/[[\^$.*?+|(){}]/\\&/g'
}

mark_story_complete() {
  local story_id="$1" plan_path="$2"
  local safe_id
  safe_id=$(sanitize_for_sed "$story_id")
  sed -i.bak "s/\\[\\s*\\]\\s*\\(.*${safe_id}\\)/[x] \\1/" "$plan_path"
}
```

**Pros:**
- Minimal code change
- Preserves existing logic

**Cons:**
- Complex escaping rules for sed
- Easy to miss edge cases

**Effort:** 30 minutes

**Risk:** Medium (escaping may be incomplete)

---

### Option 2: Validate Story ID Format Strictly (Recommended)

**Approach:** Only allow alphanumeric story IDs matching expected format (US-NNN).

```bash
mark_story_complete() {
  local story_id="$1" plan_path="$2"

  # Strict validation: only US-NNN format allowed
  if ! [[ "$story_id" =~ ^US-[0-9]+$ ]]; then
    echo "ERROR: Invalid story ID format: $story_id" >&2
    return 1
  fi

  sed -i.bak "s/\\[\\s*\\]\\s*\\(.*${story_id}\\)/[x] \\1/" "$plan_path"
}
```

**Pros:**
- Simple, clear validation
- Eliminates entire class of injection attacks
- Matches expected story ID format

**Cons:**
- Restricts flexibility if story ID format changes
- Need to update if format evolves

**Effort:** 20 minutes

**Risk:** Low

---

### Option 3: Use awk Instead of sed

**Approach:** Use awk with proper quoting to avoid shell expansion issues.

**Pros:**
- More robust parsing
- Better handling of complex patterns

**Cons:**
- More complex implementation
- Overkill for simple checkbox update

**Effort:** 1 hour

**Risk:** Low

## Recommended Action

Implement Option 2 (strict validation) as it's the simplest and most secure approach. The story ID format is well-defined (US-NNN) and unlikely to change.

## Technical Details

**Affected files:**
- `.agents/ralph/lib/minimal.sh:57` - mark_story_complete function

**Related components:**
- `.agents/ralph/simplified-loop.sh:170` - calls mark_story_complete

## Resources

- **PR:** #11
- **Related:** sed command injection patterns
- **Similar:** CVE-2016-10074

## Acceptance Criteria

- [x] Story ID validated against strict pattern (US-NNN)
- [x] Invalid story IDs rejected with error message
- [x] Test added for malicious story ID rejection
- [x] Existing functionality unchanged for valid IDs

## Work Log

### 2026-01-21 - Code Review Discovery

**By:** Claude Code (/workflows:review)

**Actions:**
- Identified command injection vulnerability in sed usage
- Analyzed attack surface (plan.md → story_id → sed)
- Proposed 3 solution approaches
- Recommended strict validation (Option 2)

**Learnings:**
- Always sanitize inputs to shell commands
- Prefer validation over escaping when format is known

### 2026-01-21 - Fix Implemented

**By:** Claude Code (claude-opus-4-5-20251101)

**Actions:**
- Implemented Option 2 (strict validation) in `.agents/ralph/lib/minimal.sh`
- Added regex validation: `^US-[0-9]+$` before sed execution
- Returns error code 1 and logs error message for invalid story IDs
- Added 2 test cases to `tests/simplified-loop.test.sh`:
  - Test for malicious injection attempts (e.g., `US-001); rm -rf /; echo (`)
  - Test for invalid format rejection (e.g., `123`)
- All 33 tests pass including new security tests

**Files Changed:**
- `.agents/ralph/lib/minimal.sh` - Added validation before sed
- `tests/simplified-loop.test.sh` - Added 2 new security tests
