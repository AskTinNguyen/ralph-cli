#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PostToolUse Hook - Enforce after tool execution
# ─────────────────────────────────────────────────────────────────────────────
# CRITICAL: This hook must ALWAYS exit 0 to avoid breaking Claude Code.
#
# Receives: JSON via stdin with tool_name, tool_output
# Actions:
#   - Detect test failures from Bash output
#   - Trigger rollback on test failure
#   - Log failure context for retry
#
# Supports test frameworks: Jest, Vitest, pytest, Go test, Mocha, RSpec, Bats
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Error trap: always exit 0
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
CHECKPOINT_FILE="$RALPH_DIR/.checkpoint"
FAILURE_LOG="$RALPH_DIR/failure-context.log"
MAX_FAILURE_LOG_SIZE=100000  # 100KB

# ─────────────────────────────────────────────────────────────────────────────
# Read hook data from stdin
# ─────────────────────────────────────────────────────────────────────────────
hook_data=""
if [[ ! -t 0 ]]; then
  hook_data=$(cat)
fi

# Empty input: nothing to do
if [[ -z "$hook_data" ]]; then
  exit 0
fi

# Validate JSON
if ! echo "$hook_data" | jq -e . >/dev/null 2>&1; then
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Extract fields
# ─────────────────────────────────────────────────────────────────────────────
tool_name=$(echo "$hook_data" | jq -r '.tool_name // empty')
tool_output=$(echo "$hook_data" | jq -r '.tool_output // ""')

# Only process Bash tool output
if [[ "$tool_name" != "Bash" ]]; then
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Test failure detection (comprehensive multi-framework patterns)
# ─────────────────────────────────────────────────────────────────────────────
# Pattern 1: Universal failure indicators
#   FAIL, FAILED, ✗, ✕, not ok, AssertionError, Failures:, failed,
#
# Pattern 2: Framework-specific
#   Jest:    "FAIL src/", "Tests: X failed"
#   Vitest:  "× FAIL", "Tests X failed"
#   pytest:  "FAILED", "= FAILURES =", "X failed,"
#   Go:      "--- FAIL:", "FAIL"
#   Mocha:   "failing", "✗ X)"
#   RSpec:   "Failures:", "F..", "X failures"
#   Bats:    "✗", "not ok"
# ─────────────────────────────────────────────────────────────────────────────

# Check for failure patterns
is_test_failure=false

# Framework-specific detection patterns (more reliable than universal)

# Jest: "Tests: X failed" or "Test Suites: X failed"
if [[ "$tool_output" =~ Tests:.*[0-9]+.*failed ]] || [[ "$tool_output" =~ Test\ Suites:.*[0-9]+.*failed ]]; then
  is_test_failure=true
fi

# Vitest: "Test Files  X failed" or "Tests  X failed |" (note double spaces)
if [[ "$tool_output" =~ Test\ Files.*[0-9]+\ failed ]] || [[ "$tool_output" =~ Tests.*[0-9]+\ failed\ \| ]]; then
  is_test_failure=true
fi

# pytest: "= FAILURES =" or "X failed," at end of summary
if [[ "$tool_output" =~ =.*FAILURES.*= ]] || [[ "$tool_output" =~ [0-9]+\ failed, ]]; then
  is_test_failure=true
fi

# Go test: "--- FAIL:" or line starting with "FAIL<tab>package"
if [[ "$tool_output" =~ ---\ FAIL: ]] || [[ "$tool_output" =~ FAIL$'\t' ]]; then
  is_test_failure=true
fi

# Mocha: "X failing"
if [[ "$tool_output" =~ [0-9]+\ failing ]]; then
  is_test_failure=true
fi

# RSpec: "X examples, Y failures"
if [[ "$tool_output" =~ [0-9]+\ examples,.*[0-9]+\ failure ]]; then
  is_test_failure=true
fi

# Bats: "not ok" at start of line
if [[ "$tool_output" =~ $'\n'not\ ok ]] || [[ "$tool_output" =~ ^not\ ok ]]; then
  is_test_failure=true
fi

# npm/yarn test failure (catches any test runner run via npm)
if [[ "$tool_output" =~ npm\ ERR!\ Test\ failed ]] || [[ "$tool_output" =~ error\ Command\ failed ]]; then
  is_test_failure=true
fi

# ─────────────────────────────────────────────────────────────────────────────
# Handle test failure: rollback and log
# ─────────────────────────────────────────────────────────────────────────────
if [[ "$is_test_failure" == "true" ]]; then
  # Get checkpoint SHA for rollback
  checkpoint_sha=""
  if [[ -f "$CHECKPOINT_FILE" ]]; then
    checkpoint_sha=$(cat "$CHECKPOINT_FILE" 2>/dev/null || echo "")
  fi

  # Perform rollback
  if [[ -n "$checkpoint_sha" ]]; then
    git reset --hard "$checkpoint_sha" 2>/dev/null || true
  fi

  # Log failure context for retry (helps agent avoid repeating mistakes)
  mkdir -p "$(dirname "$FAILURE_LOG")" 2>/dev/null || true
  {
    echo ""
    echo "=== Test Failure $(date -Iseconds) ==="
    echo "Checkpoint: $checkpoint_sha"
    # Limit output to 100 lines to prevent log bloat
    echo "$tool_output" | tail -100
    echo "=== End Failure ==="
  } >> "$FAILURE_LOG" 2>/dev/null || true

  # Rotate log if too large
  if [[ -f "$FAILURE_LOG" ]]; then
    log_size=$(wc -c < "$FAILURE_LOG" 2>/dev/null || echo 0)
    if [[ "$log_size" -gt "$MAX_FAILURE_LOG_SIZE" ]]; then
      tail -500 "$FAILURE_LOG" > "${FAILURE_LOG}.tmp" 2>/dev/null || true
      mv "${FAILURE_LOG}.tmp" "$FAILURE_LOG" 2>/dev/null || true
    fi
  fi
fi

exit 0
