#!/usr/bin/env bash
# UserPromptSubmit hook - starts transcript watcher for Claude's first response
# Triggered when user submits a command to Claude Code
# Speaks Claude's actual acknowledgment text via TTS

set -euo pipefail

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared utilities
source "${SCRIPT_DIR}/lib/path-utils.sh"
source "${SCRIPT_DIR}/lib/config-utils.sh"
source "${SCRIPT_DIR}/lib/session-detect.sh"

# Resolve RALPH_ROOT using smart detection
RALPH_DIR="$(find_ralph_root)" || RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
export RALPH_ROOT="$RALPH_DIR"

LOG_FILE="${RALPH_DIR}/prompt-ack-hook.log"
WATCHER_PID_FILE="${RALPH_DIR}/transcript-watcher.pid"

# Function to log messages
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Check if acknowledgment is enabled
# Priority: acknowledgment.enabled > autoSpeak
is_ack_enabled() {
  # Check explicit acknowledgment setting first
  if is_config_true ".acknowledgment.enabled"; then
    return 0
  fi
  if is_config_false ".acknowledgment.enabled"; then
    return 1
  fi
  # Fall back to autoSpeak
  is_config_true ".autoSpeak"
}

# Check if immediate acknowledgment is enabled (default: false)
is_immediate_ack_enabled() {
  is_config_true ".acknowledgment.immediate"
}

# Get preferred language from config
get_voice_language() {
  get_config_value ".multilingual.preferredLanguage" "en"
}

# Get immediate acknowledgment phrase from config
# Supports multilingual: checks preferredLanguage for Vietnamese
get_immediate_phrase() {
  local lang=$(get_voice_language)

  if [[ "$lang" == "vi" ]]; then
    # Vietnamese acknowledgment (check config first, then default)
    local vi_phrase=$(get_config_value ".acknowledgment.immediatePhraseVi" "")
    if [[ -n "$vi_phrase" ]]; then
      echo "$vi_phrase"
    else
      echo "Được rồi"  # Default Vietnamese "Got it"
    fi
  else
    # English acknowledgment
    get_config_value ".acknowledgment.immediatePhrase" "Got it"
  fi
}

# Speak immediate acknowledgment (non-blocking)
speak_immediate_ack() {
  local phrase=$(get_immediate_phrase)
  log "Speaking immediate acknowledgment: $phrase"

  # Source TTS manager and speak (non-blocking)
  source "${SCRIPT_DIR}/lib/tts-manager.sh"
  speak_exclusive "$phrase" &
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
  "${SCRIPT_DIR}/progress-timer.sh" stop 2>/dev/null || true

  # Speak immediate acknowledgment if enabled (quick "Got it" before processing)
  if is_immediate_ack_enabled; then
    speak_immediate_ack
  fi

  # Start transcript watcher in background (detached from terminal)
  # Use SCRIPT_DIR which points to .agents/ralph/, not RALPH_ROOT which points to .ralph/
  nohup node "${SCRIPT_DIR}/transcript-watcher.mjs" \
    "$transcript_path" >> "$LOG_FILE" 2>&1 &

  local watcher_pid=$!
  echo "$watcher_pid" > "$WATCHER_PID_FILE"

  log "Watcher started (PID: $watcher_pid)"
  log "=== Hook complete ==="

  exit 0
}

# Run main
main
