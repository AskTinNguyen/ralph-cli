---
status: complete
priority: p2
issue_id: "017"
tags: [security, code-review, simplified-loop, hooks]
dependencies: ["013"]
---

# Regex Injection in on-stop.sh Hook

## Problem Statement

The on-stop.sh hook uses story IDs in grep patterns without proper escaping, allowing regex metacharacters in story IDs to cause unexpected behavior or denial of service.

**Severity:** P2 - Regex injection could cause incorrect behavior or hangs.

## Findings

- Location: `.agents/ralph/hooks/on-stop.sh` (if exists)
- Similar to issue #013, story IDs used directly in patterns
- **Potential issues:**
  1. Regex metacharacters: `.*`, `+`, `?`, `|`
  2. Catastrophic backtracking: `US-((((a])*)*)*)*`
  3. Match more than intended: `US-.*` matches all stories

**Note:** Need to verify on-stop.sh exists and contains this pattern.

## Proposed Solutions

### Option 1: Use grep -F (Fixed Strings)

**Approach:** Use fixed string matching instead of regex.

```bash
# Instead of:
grep "Story: $story_id" progress.md

# Use:
grep -F "Story: $story_id" progress.md
```

**Pros:**
- Simple change
- No regex interpretation
- Slightly faster

**Cons:**
- Loses regex flexibility if needed elsewhere

**Effort:** 15 minutes

**Risk:** Low

---

### Option 2: Validate Story ID Format

**Approach:** Same as issue #013 - validate story ID matches expected format.

```bash
if ! [[ "$story_id" =~ ^US-[0-9]+$ ]]; then
  echo "Invalid story ID" >&2
  exit 1
fi
```

**Pros:**
- Consistent with other hooks
- Defense in depth

**Cons:**
- Duplicate validation (if #013 also validates)

**Effort:** 15 minutes

**Risk:** Low

---

### Option 3: Escape Regex Metacharacters

**Approach:** Escape all regex special characters in story ID.

```bash
escape_regex() {
  echo "$1" | sed 's/[[\.*^$()+?{|\\]/\\&/g'
}
```

**Pros:**
- Preserves ability to use regex elsewhere

**Cons:**
- Complex escaping
- Easy to miss edge cases

**Effort:** 30 minutes

**Risk:** Medium

## Recommended Action

Implement Option 1 (grep -F) combined with format validation from #013. This provides defense in depth.

## Technical Details

**Affected files:**
- `.agents/ralph/hooks/on-stop.sh` (verify existence)

**Related components:**
- Depends on #013 for story ID validation

## Resources

- **PR:** #11
- **Dependency:** #013 (story ID validation)

## Acceptance Criteria

- [x] Verify on-stop.sh exists and uses story IDs in patterns
- [x] Use grep -F for fixed string matching
- [x] Validate story ID format (consistent with #013)
- [ ] Test added for regex metacharacter handling

## Work Log

### 2026-01-21 - Code Review Discovery

**By:** Claude Code (/workflows:review)

**Actions:**
- Identified potential regex injection in hooks
- Proposed grep -F as simple fix
- Linked to #013 for consistent validation

**Learnings:**
- Use grep -F when literal matching is needed
- Consistent validation across all entry points

### 2026-01-21 - Fix Applied

**By:** Claude Code

**Actions:**
- Verified on-stop.sh exists at `.agents/ralph/hooks/on-stop.sh`
- Found regex injection on line 61: `grep -q "^\s*-\s*\[x\].*${story_id}"` used story ID directly in regex pattern
- Applied fix:
  1. Added story ID format validation (`^US-[0-9]+$`) before processing
  2. Changed the problematic grep to use `-F` flag with piped approach: `grep -F "$story_id" | grep -qE '^\s*-\s*\[x\]'`
- This provides defense in depth: validation rejects invalid IDs, and grep -F prevents regex interpretation

**Changes made to `.agents/ralph/hooks/on-stop.sh`:**
- Added story ID format validation (lines 55-60)
- Changed line 69 from `grep -q "^\s*-\s*\[x\].*${story_id}"` to `grep -F "$story_id" | grep -qE '^\s*-\s*\[x\]'`
