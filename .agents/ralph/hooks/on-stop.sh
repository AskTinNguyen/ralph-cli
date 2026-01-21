#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Stop Hook - Validate completion state when Claude Code session ends
# ─────────────────────────────────────────────────────────────────────────────
# CRITICAL: This hook must ALWAYS exit 0 to avoid breaking Claude Code.
#
# Receives: JSON via stdin with stop_reason
# Actions:
#   - Check if current story was completed
#   - Log incomplete state for resumption
#   - Cleanup temporary files
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Error trap: always exit 0
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
CURRENT_STORY_FILE="$RALPH_DIR/current-story"
SESSIONS_LOG="$RALPH_DIR/sessions.log"

# ─────────────────────────────────────────────────────────────────────────────
# Read hook data from stdin
# ─────────────────────────────────────────────────────────────────────────────
hook_data=""
if [[ ! -t 0 ]]; then
  hook_data=$(cat)
fi

# Validate JSON if present
stop_reason=""
if [[ -n "$hook_data" ]]; then
  if echo "$hook_data" | jq -e . >/dev/null 2>&1; then
    stop_reason=$(echo "$hook_data" | jq -r '.stop_reason // empty')
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Check completion state
# ─────────────────────────────────────────────────────────────────────────────
if [[ -f "$CURRENT_STORY_FILE" ]]; then
  story_id=$(cat "$CURRENT_STORY_FILE" 2>/dev/null || echo "")

  if [[ -n "$story_id" ]]; then
    # Find the plan file (try multiple PRD directories)
    plan_path=""
    for prd_dir in "$RALPH_DIR"/PRD-*; do
      if [[ -f "$prd_dir/plan.md" ]]; then
        plan_path="$prd_dir/plan.md"
        break
      fi
    done

    # Check if story was marked complete
    story_completed=false
    if [[ -n "$plan_path" ]] && [[ -f "$plan_path" ]]; then
      # Use fixed-string grep for security
      if grep -qF "[x] " "$plan_path" 2>/dev/null && grep -qF "$story_id" "$plan_path" 2>/dev/null; then
        # More precise check: story line has [x]
        if grep -q "^\s*-\s*\[x\].*${story_id}" "$plan_path" 2>/dev/null; then
          story_completed=true
        fi
      fi
    fi

    # Log incomplete state for potential resumption
    if [[ "$story_completed" == "false" ]]; then
      mkdir -p "$(dirname "$SESSIONS_LOG")" 2>/dev/null || true
      {
        echo "incomplete:$story_id:$(date +%s):${stop_reason:-unknown}"
      } >> "$SESSIONS_LOG" 2>/dev/null || true
    fi
  fi
fi

# ─────────────────────────────────────────────────────────────────────────────
# Cleanup temporary files
# ─────────────────────────────────────────────────────────────────────────────
rm -f "$CURRENT_STORY_FILE" 2>/dev/null || true
rm -f "$RALPH_DIR/.checkpoint" 2>/dev/null || true
rm -f "$RALPH_DIR/session.log" 2>/dev/null || true

exit 0
