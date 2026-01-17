#!/usr/bin/env bash
# Session Detection - Detects new Claude Code session start
# Used to skip voice output on first prompt of a new session
#
# Usage:
#   source .agents/ralph/lib/session-detect.sh
#   if should_skip_session_start "$transcript_path"; then
#     echo "Skip voice - session just started"
#   fi
#
# Functions:
#   count_user_messages - Count user entries in transcript JSONL
#   is_skip_session_start_enabled - Check if feature is enabled in config
#   get_min_user_messages - Get threshold from config
#   should_skip_session_start - Main decision function

set -euo pipefail

# Get script directory for sourcing path-utils
SESSION_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source path utilities for smart RALPH_ROOT resolution
source "${SESSION_SCRIPT_DIR}/path-utils.sh"

# Resolve RALPH_ROOT using smart detection (handles both project root and .ralph paths)
SESSION_RALPH_DIR="$(find_ralph_root)"
if [[ -z "$SESSION_RALPH_DIR" ]]; then
  # Fallback to default behavior
  SESSION_RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
fi

# Set RALPH_ROOT for child processes (points to .ralph directory)
export RALPH_ROOT="$SESSION_RALPH_DIR"

SESSION_CONFIG_FILE="${SESSION_RALPH_DIR}/voice-config.json"
SESSION_LOG_FILE="${SESSION_RALPH_DIR}/session-detect.log"

# Log to session detect log
session_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [session-detect] $*" >> "$SESSION_LOG_FILE"
}

# Count user messages in transcript JSONL file
# Claude Code transcripts are JSONL format with "type":"user" entries
count_user_messages() {
  local transcript_path="$1"

  if [[ ! -f "$transcript_path" ]]; then
    echo "0"
    return
  fi

  # Count lines with "type":"user" (user prompt entries)
  local count=$(grep -c '"type":"user"' "$transcript_path" 2>/dev/null || echo "0")
  echo "$count"
}

# Check if skip session start feature is enabled
is_skip_session_start_enabled() {
  if [[ ! -f "$SESSION_CONFIG_FILE" ]]; then
    return 1
  fi

  if command -v jq &>/dev/null; then
    local enabled=$(jq -r '.skipSessionStart.enabled // true' "$SESSION_CONFIG_FILE" 2>/dev/null)
    [[ "$enabled" == "true" ]]
  else
    # Default to enabled if can't read config
    return 0
  fi
}

# Get minimum user messages threshold from config
get_min_user_messages() {
  if [[ ! -f "$SESSION_CONFIG_FILE" ]]; then
    echo "1"
    return
  fi

  if command -v jq &>/dev/null; then
    local min=$(jq -r '.skipSessionStart.minUserMessages // 1' "$SESSION_CONFIG_FILE" 2>/dev/null)
    # Validate it's a number
    if [[ "$min" =~ ^[0-9]+$ ]]; then
      echo "$min"
    else
      echo "1"
    fi
  else
    echo "1"
  fi
}

# Main decision function - should we skip voice for session start?
# Returns 0 (true) if we should skip, 1 (false) if we should speak
should_skip_session_start() {
  local transcript_path="$1"

  # Check if feature is enabled
  if ! is_skip_session_start_enabled; then
    session_log "Skip session start feature disabled"
    return 1  # Don't skip, feature is off
  fi

  # Get threshold
  local min_messages=$(get_min_user_messages)

  # Count user messages in transcript
  local user_count=$(count_user_messages "$transcript_path")

  session_log "User message count: $user_count, threshold: $min_messages"

  # Skip if user count is at or below threshold
  if [[ "$user_count" -le "$min_messages" ]]; then
    session_log "Session start detected (count=$user_count <= threshold=$min_messages), should skip voice"
    return 0  # Yes, skip voice
  else
    session_log "Not a session start (count=$user_count > threshold=$min_messages), allow voice"
    return 1  # No, don't skip
  fi
}

# Export functions
export -f count_user_messages
export -f is_skip_session_start_enabled
export -f get_min_user_messages
export -f should_skip_session_start
export -f session_log
