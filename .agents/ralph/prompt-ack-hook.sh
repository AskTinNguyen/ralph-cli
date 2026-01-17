#!/usr/bin/env bash
# UserPromptSubmit hook - starts transcript watcher for Claude's first response
# Triggered when user submits a command to Claude Code
# Speaks Claude's actual acknowledgment text via TTS

set -euo pipefail

RALPH_ROOT="${RALPH_ROOT:-$(pwd)}"
CONFIG_FILE="${RALPH_ROOT}/.ralph/voice-config.json"
LOG_FILE="${RALPH_ROOT}/.ralph/prompt-ack-hook.log"
WATCHER_PID_FILE="${RALPH_ROOT}/.ralph/transcript-watcher.pid"

# Source session detection library
source "${RALPH_ROOT}/.agents/ralph/lib/session-detect.sh"

# Function to log messages
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Check if acknowledgment is enabled
is_ack_enabled() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return 1
  fi

  # Check acknowledgment.enabled first, then fall back to autoSpeak
  if command -v jq &>/dev/null; then
    local ack_enabled=$(jq -r '.acknowledgment.enabled // null' "$CONFIG_FILE" 2>/dev/null)
    if [[ "$ack_enabled" == "true" ]]; then
      return 0
    elif [[ "$ack_enabled" == "false" ]]; then
      return 1
    fi
    # Fall back to autoSpeak if acknowledgment.enabled is not set
    local enabled=$(jq -r '.autoSpeak // false' "$CONFIG_FILE" 2>/dev/null)
    [[ "$enabled" == "true" ]]
  else
    grep -q '"autoSpeak"[[:space:]]*:[[:space:]]*true' "$CONFIG_FILE" 2>/dev/null
  fi
}

# Kill any existing transcript watcher
kill_existing_watcher() {
  if [[ -f "$WATCHER_PID_FILE" ]]; then
    local pid=$(cat "$WATCHER_PID_FILE" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      log "Killing existing watcher (PID: $pid)"
      kill "$pid" 2>/dev/null || true
    fi
    rm -f "$WATCHER_PID_FILE"
  fi

  # Also kill any stray watcher processes
  pkill -f "transcript-watcher.mjs" 2>/dev/null || true
}

# Main hook logic
main() {
  log "=== Prompt acknowledgment hook triggered ==="

  if ! is_ack_enabled; then
    log "Acknowledgment disabled, skipping"
    exit 0
  fi

  # Read hook data from stdin (JSON)
  local hook_data=""
  if [[ ! -t 0 ]]; then
    hook_data=$(cat)
    log "Hook data received: ${hook_data:0:200}..."
  else
    log "WARN: No hook data received on stdin"
    exit 0
  fi

  # Extract transcript path from hook data
  local transcript_path=""
  if command -v jq &>/dev/null && [[ -n "$hook_data" ]]; then
    transcript_path=$(echo "$hook_data" | jq -r '.transcript_path // ""' 2>/dev/null)
  fi

  if [[ -z "$transcript_path" ]]; then
    log "No transcript path in hook data, skipping"
    exit 0
  fi

  if [[ ! -f "$transcript_path" ]]; then
    log "Transcript file not found: $transcript_path"
    exit 0
  fi

  log "Transcript: $transcript_path"

  # Check if this is a session start - skip voice on first prompt
  if should_skip_session_start "$transcript_path"; then
    log "Session start detected, skipping acknowledgment voice"
    exit 0
  fi

  # Kill any existing watcher before starting new one
  kill_existing_watcher

  # Also stop any existing progress timer
  "${RALPH_ROOT}/.agents/ralph/progress-timer.sh" stop 2>/dev/null || true

  # Start transcript watcher in background (detached from terminal)
  nohup node "${RALPH_ROOT}/.agents/ralph/transcript-watcher.mjs" \
    "$transcript_path" >> "$LOG_FILE" 2>&1 &

  local watcher_pid=$!
  echo "$watcher_pid" > "$WATCHER_PID_FILE"

  log "Watcher started (PID: $watcher_pid)"
  log "=== Hook complete ==="

  exit 0
}

# Run main
main
