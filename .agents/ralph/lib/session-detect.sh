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

# Get script directory
SESSION_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared utilities
source "${SESSION_SCRIPT_DIR}/path-utils.sh"
source "${SESSION_SCRIPT_DIR}/config-utils.sh"

# Resolve RALPH_ROOT using smart detection
SESSION_RALPH_DIR="$(find_ralph_root)" || SESSION_RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
export RALPH_ROOT="$SESSION_RALPH_DIR"

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

# Check if skip session start feature is enabled (default: true)
is_skip_session_start_enabled() {
  ! is_config_false ".skipSessionStart.enabled"
}

# Get minimum user messages threshold from config (default: 1)
get_min_user_messages() {
  get_config_int ".skipSessionStart.minUserMessages" 1 0 100
}

# Check if running in headless/automation mode
# Headless mode is detected via:
# 1. RALPH_HEADLESS=true environment variable
# 2. No controlling terminal (stdin is not a tty)
# 3. Config setting: skipSessionStart.headlessAlwaysSpeak = true
is_headless_mode() {
  # Check explicit env variable
  if [[ "${RALPH_HEADLESS:-}" == "true" ]]; then
    return 0
  fi

  # Check if stdin is not a terminal (piped mode)
  if [[ ! -t 0 ]]; then
    return 0
  fi

  return 1
}

# Check if headless mode should always speak (default: true)
should_headless_always_speak() {
  ! is_config_false ".skipSessionStart.headlessAlwaysSpeak"
}

# Main decision function - should we skip voice for session start?
# Returns 0 (true) if we should skip, 1 (false) if we should speak
should_skip_session_start() {
  local transcript_path="$1"

  # In headless mode, check if we should always speak
  if is_headless_mode; then
    if should_headless_always_speak; then
      session_log "Headless mode detected, always speak enabled - allowing voice"
      return 1  # Don't skip, allow voice
    else
      session_log "Headless mode detected, but always speak disabled"
    fi
  fi

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
export -f is_headless_mode
export -f should_headless_always_speak
export -f should_skip_session_start
export -f session_log
