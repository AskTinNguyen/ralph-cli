---
status: pending
priority: p1
issue_id: "006"
tags: [code-review, plan-review, bash, portability, ralph-loop]
dependencies: []
created: 2026-01-21
---

# Fix sed -i Portability Bug in mark_complete()

## Problem Statement

The proposed `mark_complete()` function uses `sed -i ''` which is **macOS-only syntax**. On Linux, this fails with "no filename" error because Linux sed expects either `sed -i.bak` or just `sed -i`.

**Why it matters:**
- Story completion fails entirely on Linux systems
- Build loop cannot mark stories as done
- Resume mechanism breaks (stories re-selected infinitely)
- Cross-platform compatibility is a core requirement

## Findings

### From code-quality-reviewer:
- **Location:** Proposed `mark_complete()` in plan
- **Pattern:** `sed -i '' "s/^### \[ \] $id:/### [x] $id:/" "$prd"`
- **Impact:** Linux users cannot use ralph-loop at all

### Evidence:
```bash
# macOS (works):
sed -i '' 's/foo/bar/' file.txt

# Linux (fails):
sed -i '' 's/foo/bar/' file.txt
# Error: sed: can't read : No such file or directory

# Linux (correct):
sed -i 's/foo/bar/' file.txt  # no backup
sed -i.bak 's/foo/bar/' file.txt  # with backup
```

## Proposed Solutions

### Solution A: Use .bak suffix (Recommended)
**Pros:** Works on both macOS and Linux, explicit backup
**Cons:** Leaves .bak files (can be cleaned up)
**Effort:** Small
**Risk:** Low

```bash
mark_complete() {
  local prd="$1" id="$2"
  sed -i.bak "s/^### \[ \] $id:/### [x] $id:/" "$prd"
  rm -f "${prd}.bak"  # Clean up backup
}
```

### Solution B: Platform detection
**Pros:** Uses native syntax per platform
**Cons:** More complex, duplicated logic
**Effort:** Medium
**Risk:** Low

```bash
mark_complete() {
  local prd="$1" id="$2"
  if [[ "$OSTYPE" == "darwin"* ]]; then
    sed -i '' "s/^### \[ \] $id:/### [x] $id:/" "$prd"
  else
    sed -i "s/^### \[ \] $id:/### [x] $id:/" "$prd"
  fi
}
```

### Solution C: Use perl instead of sed
**Pros:** Consistent cross-platform, more powerful
**Cons:** Adds perl dependency
**Effort:** Small
**Risk:** Low

```bash
mark_complete() {
  local prd="$1" id="$2"
  perl -i -pe "s/^### \[ \] $id:/### [x] $id:/" "$prd"
}
```

## Recommended Action

Use **Solution A** (sed with .bak suffix + cleanup) - simplest, most portable.

## Technical Details

**Affected files:**
- `lib/loop.sh` (proposed) - mark_complete() function

**Testing:**
```bash
# Test on Linux container
docker run -it ubuntu:22.04 bash
echo "### [ ] US-001: Test" > test.md
sed -i.bak 's/\[ \]/[x]/' test.md && rm -f test.md.bak
cat test.md  # Should show: ### [x] US-001: Test
```

## Acceptance Criteria

- [ ] `mark_complete()` works on macOS
- [ ] `mark_complete()` works on Linux (Ubuntu, Debian, Alpine)
- [ ] No leftover .bak files after successful completion
- [ ] PRD file correctly updated with [x] checkbox

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-01-21 | Created | Identified during plan review |

## Resources

- [GNU sed vs BSD sed differences](https://stackoverflow.com/questions/4247068/sed-command-with-i-option-failing-on-mac-but-works-on-linux)
- Current Ralph implementation: `/Users/tinnguyen/ralph-cli/.agents/ralph/lib/prd-utils.sh`
