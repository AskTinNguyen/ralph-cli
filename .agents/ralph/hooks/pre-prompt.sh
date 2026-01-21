#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# UserPromptSubmit Hook - Runs when user submits a prompt
# ─────────────────────────────────────────────────────────────────────────────
# CRITICAL: This hook must ALWAYS exit 0 to avoid breaking Claude Code.
#
# Receives: JSON via stdin with prompt content
# Actions:
#   - Log prompt submission timestamp
#   - Clear session log for new conversation
#   - Optional: trigger TTS notification
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Error trap: always exit 0
trap 'exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
SESSION_LOG="$RALPH_DIR/session.log"
ACTIVITY_LOG="$RALPH_DIR/activity.log"

# ─────────────────────────────────────────────────────────────────────────────
# Read hook data from stdin
# ─────────────────────────────────────────────────────────────────────────────
hook_data=""
if [[ ! -t 0 ]]; then
  hook_data=$(cat)
fi

# ─────────────────────────────────────────────────────────────────────────────
# Start new session: clear read tracking log
# ─────────────────────────────────────────────────────────────────────────────
# This ensures Edit validation is per-conversation, not accumulated
mkdir -p "$(dirname "$SESSION_LOG")" 2>/dev/null || true
: > "$SESSION_LOG" 2>/dev/null || true

# ─────────────────────────────────────────────────────────────────────────────
# Log activity (optional)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -n "$hook_data" ]]; then
  # Extract prompt length for logging (don't log actual content for privacy)
  prompt_length=0
  if echo "$hook_data" | jq -e . >/dev/null 2>&1; then
    prompt=$(echo "$hook_data" | jq -r '.prompt // ""')
    prompt_length=${#prompt}
  fi

  mkdir -p "$(dirname "$ACTIVITY_LOG")" 2>/dev/null || true
  {
    echo "$(date -Iseconds) prompt_submit length=$prompt_length"
  } >> "$ACTIVITY_LOG" 2>/dev/null || true
fi

exit 0
