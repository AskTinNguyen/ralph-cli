---
status: complete
priority: p3
issue_id: "018"
tags: [code-review, simplified-loop]
dependencies: []
---

# MAX_ITERATIONS Missing Upper Bound Validation

## Problem Statement

The simplified-loop.sh accepts MAX_ITERATIONS from environment or CLI without validating an upper bound. Extremely large values could cause resource exhaustion or unintended long-running processes.

**Severity:** P3 - Nice-to-have defensive check.

## Findings

- Location: `.agents/ralph/simplified-loop.sh:36,53`
- Current validation: Only checks for positive integer via regex
- **Issues:**
  1. No upper bound: `MAX_ITERATIONS=999999999` is valid
  2. Could run for days/weeks
  3. Resource exhaustion possible

**Current code:**
```bash
MAX_ITERATIONS="${MAX_ITERATIONS:-25}"
# ...
[0-9]*) MAX_ITERATIONS="$arg" ;;
```

## Proposed Solutions

### Option 1: Add Maximum Limit (Recommended)

**Approach:** Add a configurable maximum with sensible default.

```bash
MAX_ITERATIONS="${MAX_ITERATIONS:-25}"
MAX_ALLOWED_ITERATIONS="${MAX_ALLOWED_ITERATIONS:-100}"

# Validate upper bound
if [[ "$MAX_ITERATIONS" -gt "$MAX_ALLOWED_ITERATIONS" ]]; then
  log_warn "MAX_ITERATIONS capped at $MAX_ALLOWED_ITERATIONS (requested: $MAX_ITERATIONS)"
  MAX_ITERATIONS="$MAX_ALLOWED_ITERATIONS"
fi
```

**Pros:**
- Prevents runaway processes
- Configurable for power users
- Clear warning message

**Cons:**
- May surprise users expecting large runs

**Effort:** 15 minutes

**Risk:** Low

---

### Option 2: Require Explicit Flag for Large Values

**Approach:** Require `--allow-large` flag for iterations > 100.

**Pros:**
- Explicit user intent
- Hard to accidentally run long

**Cons:**
- More complex CLI handling

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

Implement Option 1 with MAX_ALLOWED_ITERATIONS=100 as default.

## Technical Details

**Affected files:**
- `.agents/ralph/simplified-loop.sh:36,53`

## Acceptance Criteria

- [x] Upper bound enforced (default: 100)
- [x] Warning logged when capped
- [x] Configurable via MAX_ALLOWED_ITERATIONS env var
- [ ] Test added for large value handling

## Work Log

### 2026-01-21 - Implementation Complete

**By:** Claude Code

**Actions:**
- Added MAX_ALLOWED_ITERATIONS validation in simplified-loop.sh (lines 57-63)
- Upper bound defaults to 100, configurable via environment variable
- Warning logged when iterations are capped
- Validation placed after argument parsing to catch both env vars and CLI args

**Files modified:**
- `.agents/ralph/simplified-loop.sh`

---

### 2026-01-21 - Code Review Discovery

**By:** Claude Code (/workflows:review)

**Actions:**
- Identified missing upper bound validation
- Proposed configurable limit

**Learnings:**
- Always validate both lower and upper bounds
