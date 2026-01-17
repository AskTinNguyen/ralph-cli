#!/usr/bin/env bash
# TTS Manager - Prevents overlapping voice output
# Provides exclusive TTS playback by canceling any existing TTS before speaking
#
# Usage:
#   source .agents/ralph/lib/tts-manager.sh
#   speak_exclusive "Hello world"
#
# Functions:
#   cancel_existing_tts - Kill all running TTS processes
#   speak_exclusive <text> - Cancel existing TTS and speak new text

set -euo pipefail

RALPH_ROOT="${RALPH_ROOT:-$(pwd)}"
TTS_PID_FILE="${RALPH_ROOT}/.ralph/tts.pid"
TTS_LOG_FILE="${RALPH_ROOT}/.ralph/tts-manager.log"

# Log to TTS manager log
tts_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [tts-mgr] $*" >> "$TTS_LOG_FILE"
}

# Cancel all existing TTS processes
cancel_existing_tts() {
  tts_log "Canceling existing TTS..."

  # Kill tracked PID if exists
  if [[ -f "$TTS_PID_FILE" ]]; then
    local pid=$(cat "$TTS_PID_FILE" 2>/dev/null || echo "")
    if [[ -n "$pid" ]]; then
      if kill -0 "$pid" 2>/dev/null; then
        tts_log "Killing tracked TTS PID: $pid"
        kill "$pid" 2>/dev/null || true
        # Wait briefly for process to die
        local waited=0
        while kill -0 "$pid" 2>/dev/null && [[ $waited -lt 10 ]]; do
          sleep 0.05
          waited=$((waited + 1))
        done
        # Force kill if still alive
        if kill -0 "$pid" 2>/dev/null; then
          tts_log "Force killing TTS PID: $pid"
          kill -9 "$pid" 2>/dev/null || true
        fi
      fi
    fi
    rm -f "$TTS_PID_FILE"
  fi

  # Kill any orphaned ralph speak processes (safety net)
  local orphans=$(pgrep -f "ralph speak" 2>/dev/null || echo "")
  if [[ -n "$orphans" ]]; then
    tts_log "Killing orphaned ralph speak processes: $orphans"
    pkill -f "ralph speak" 2>/dev/null || true
  fi

  # Kill any say processes on macOS (safety net)
  if command -v say &>/dev/null; then
    local say_pids=$(pgrep say 2>/dev/null || echo "")
    if [[ -n "$say_pids" ]]; then
      tts_log "Killing say processes: $say_pids"
      killall say 2>/dev/null || true
    fi
  fi

  # Brief wait for cleanup
  sleep 0.3

  tts_log "TTS cancel complete"
}

# Speak text exclusively (cancels any existing TTS first)
# Usage: speak_exclusive "text to speak"
#        echo "text" | speak_exclusive
speak_exclusive() {
  local text="${1:-}"

  # If no arg provided, read from stdin
  if [[ -z "$text" ]]; then
    text=$(cat)
  fi

  if [[ -z "$text" ]]; then
    tts_log "No text provided, skipping"
    return 0
  fi

  tts_log "Speaking: ${text:0:50}..."

  # Cancel any existing TTS
  cancel_existing_tts

  # Speak and track PID
  # Use echo + pipe to avoid shell escaping issues
  (echo "$text" | ralph speak) &
  local tts_pid=$!
  echo "$tts_pid" > "$TTS_PID_FILE"

  tts_log "TTS started with PID: $tts_pid"

  # Don't wait for completion - let it run in background
}

# Cleanup function (for trap)
cleanup_tts_manager() {
  rm -f "$TTS_PID_FILE" 2>/dev/null || true
}

# Export functions
export -f cancel_existing_tts
export -f speak_exclusive
export -f tts_log
