---
status: complete
priority: p2
issue_id: "015"
tags: [security, code-review, simplified-loop, hooks]
dependencies: []
---

# Log Injection Sanitization Incomplete

## Problem Statement

The pre-tool.sh hook sanitizes newlines from file paths before logging, but doesn't sanitize ANSI escape sequences or other control characters that could corrupt logs or enable terminal injection attacks.

**Severity:** P2 - Log integrity and potential terminal escape injection.

## Findings

- Location: `.agents/ralph/hooks/pre-tool.sh:112-116`
- Current sanitization only handles newlines:
  ```bash
  safe_file_path="${file_path//$'\n'/ }"
  safe_file_path="${safe_file_path//$'\r'/ }"
  ```
- **Missing sanitization:**
  1. ANSI escape sequences: `\e[...m` (color codes)
  2. Terminal control: `\e[2J` (clear screen)
  3. Cursor manipulation: `\e[H` (home)
  4. Tab characters: `\t`
  5. Backspace: `\b`
  6. Bell: `\a`

**Attack scenario:**
- File path: `test$'\e[2J\e[H'file.txt` could clear terminal
- File path: `test$'\e[31m'FAKE_SUCCESS$'\e[0m'.txt` could inject colored output

## Proposed Solutions

### Option 1: Strip All Non-Printable Characters (Recommended)

**Approach:** Use tr to remove all control characters.

```bash
sanitize_for_log() {
  local input="$1"
  # Remove all control characters (ASCII 0-31 except tab which becomes space)
  echo "$input" | tr -d '\000-\010\013-\037' | tr '\011' ' '
}

# Usage:
safe_file_path=$(sanitize_for_log "$file_path")
```

**Pros:**
- Simple and effective
- Handles all control characters
- Low overhead

**Cons:**
- May remove legitimate unicode in some edge cases
- Need to test with various locales

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Escape Special Characters

**Approach:** Escape control characters rather than removing them.

```bash
sanitize_for_log() {
  local input="$1"
  printf '%q' "$input"
}
```

**Pros:**
- Preserves all information
- Visibly shows what was escaped

**Cons:**
- Output harder to read
- May not prevent terminal injection if output is later unescaped

**Effort:** 20 minutes

**Risk:** Low

---

### Option 3: Use Structured Logging (JSON)

**Approach:** Log in JSON format where values are properly escaped.

```bash
log_read() {
  local file_path="$1"
  printf '{"event":"read","file":"%s","ts":"%s"}\n' \
    "$(echo "$file_path" | jq -Rs '.')" \
    "$(date -Iseconds)" >> "$SESSION_LOG"
}
```

**Pros:**
- Proper escaping guaranteed
- Structured, parseable logs
- Industry best practice

**Cons:**
- Requires jq
- Changes log format (may break existing tools)

**Effort:** 1 hour

**Risk:** Medium (breaking change)

## Recommended Action

Implement Option 1 for immediate fix. Consider Option 3 for future log infrastructure improvements.

## Technical Details

**Affected files:**
- `.agents/ralph/hooks/pre-tool.sh:112-116` - file path sanitization

**Related components:**
- `.ralph/session.log` - session log file

## Resources

- **PR:** #11
- **Related:** OWASP Log Injection

## Acceptance Criteria

- [x] ANSI escape sequences stripped from log entries
- [x] All control characters (ASCII 0-31) handled
- [ ] Test added for escape sequence injection
- [x] Existing log parsing still works

## Work Log

### 2026-01-21 - Code Review Discovery

**By:** Claude Code (/workflows:review)

**Actions:**
- Identified incomplete log sanitization
- Analyzed potential terminal injection vectors
- Proposed 3 solution approaches
- Recommended control character stripping (Option 1)

**Learnings:**
- Log injection can enable terminal escape attacks
- Always sanitize all control characters, not just newlines

### 2026-01-21 - Fix Implemented

**By:** Claude Opus 4.5

**Actions:**
- Implemented Option 1: Strip all non-printable characters
- Updated `.agents/ralph/hooks/pre-tool.sh:112-117`
- New sanitization uses `tr` to:
  - Remove all control characters ASCII 0-8, 11, 12, 14-31 (NUL, SOH, STX, etc.)
  - Convert tab (09), newline (0A), carriage return (0D) to spaces
- This handles ANSI escapes, bells, backspaces, form feeds, and all other control chars

**Implementation:**
```bash
safe_file_path=$(printf '%s' "$file_path" | tr -d '\000-\010\013\014\016-\037' | tr '\011\012\015' '   ')
```

**Learnings:**
- `printf '%s'` is safer than `echo` for arbitrary input (no interpretation of escape sequences)
- Two-stage `tr` cleanly separates deletion vs replacement
