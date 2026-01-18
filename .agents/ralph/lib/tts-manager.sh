#!/usr/bin/env bash
# TTS Manager - Prevents overlapping voice output
# Provides exclusive TTS playback with cross-session coordination
#
# Usage:
#   source .agents/ralph/lib/tts-manager.sh
#   speak_exclusive "Hello world"
#
# Functions:
#   cancel_existing_tts - Kill TTS processes from THIS session only
#   speak_exclusive <text> - Wait for lock, cancel our TTS, speak new text
#
# Cross-Session Coordination:
#   Uses global voice lock file (.ralph/locks/voice/voice.lock) to coordinate
#   across multiple Claude Code sessions. Each session is identified by its
#   terminal/parent process.

set -euo pipefail

# Get script directory
TTS_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source path utilities
source "${TTS_SCRIPT_DIR}/path-utils.sh"

# Resolve RALPH_ROOT using smart detection
RALPH_DIR="$(find_ralph_root)" || RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
export RALPH_ROOT="$RALPH_DIR"

# Generate session ID from terminal/parent process FIRST
# This ensures each Claude Code session has a unique ID
TTS_SESSION_ID="${TERM_SESSION_ID:-${WINDOWID:-session-${PPID:-$$}}}"
# Sanitize session ID for use in filenames
TTS_SESSION_ID_SAFE=$(echo "$TTS_SESSION_ID" | tr -cd 'a-zA-Z0-9_-')

# Session-specific PID file (prevents cross-session overwrites)
TTS_PID_FILE="${RALPH_DIR}/tts-${TTS_SESSION_ID_SAFE}.pid"
TTS_LOG_FILE="${RALPH_DIR}/tts-manager.log"
VOICE_LOCK_DIR="${RALPH_DIR}/locks/voice"
VOICE_LOCK_FILE="${VOICE_LOCK_DIR}/voice.lock"

# Log to TTS manager log
tts_log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [tts-mgr:${TTS_SESSION_ID:0:20}] $*" >> "$TTS_LOG_FILE"
}

# Check if voice lock is held by another session
# Returns 0 if we can proceed (lock free or held by us), 1 if held by another
check_voice_lock() {
  if [[ ! -f "$VOICE_LOCK_FILE" ]]; then
    return 0  # Lock free
  fi

  local lock_pid=$(grep '^PID=' "$VOICE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
  local lock_cli=$(grep '^CLI_ID=' "$VOICE_LOCK_FILE" 2>/dev/null | cut -d= -f2)

  # Check if lock holder process is dead
  if [[ -n "$lock_pid" ]] && ! kill -0 "$lock_pid" 2>/dev/null; then
    tts_log "Lock held by dead process $lock_pid, cleaning up"
    rm -f "$VOICE_LOCK_FILE" 2>/dev/null || true
    return 0  # Lock was stale, now free
  fi

  # Check if lock is held by THIS session (same session ID prefix)
  if [[ -n "$lock_cli" && "$lock_cli" == *"$TTS_SESSION_ID"* ]]; then
    return 0  # Our lock, can proceed
  fi

  # Lock held by another active session
  tts_log "Lock held by another session: $lock_cli (PID: $lock_pid)"
  return 1
}

# Wait for voice lock to be available (with timeout)
# Returns 0 if lock acquired/available, 1 if timeout
wait_for_voice_lock() {
  local timeout_seconds="${1:-10}"
  local interval_ms=300  # 300ms between checks
  local max_iterations=$(( (timeout_seconds * 1000) / interval_ms ))
  local i=0

  tts_log "Waiting for voice lock (timeout: ${timeout_seconds}s, max_iterations: ${max_iterations})..."

  while [[ $i -lt $max_iterations ]]; do
    if check_voice_lock; then
      local waited_seconds=$(( (i * interval_ms) / 1000 ))
      tts_log "Voice lock available after ~${waited_seconds}s (iteration $i)"
      return 0
    fi

    # Sleep 300ms
    sleep 0.3
    i=$((i + 1))

    # Log progress every 10 iterations (~3 seconds)
    if [[ $((i % 10)) -eq 0 ]]; then
      local waited_so_far=$(( (i * interval_ms) / 1000 ))
      tts_log "Still waiting for voice lock... (${waited_so_far}s elapsed)"
    fi
  done

  tts_log "Timeout waiting for voice lock after ${timeout_seconds}s"
  return 1
}

# Cancel TTS processes from THIS session only (not other sessions)
cancel_existing_tts() {
  tts_log "Canceling TTS for this session..."

  # Kill our tracked PID if exists (session-specific)
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

  # NOTE: We NO LONGER kill all "ralph speak" processes globally!
  # This was causing race conditions across sessions.
  # Each session only manages its own TTS PID.

  # Brief wait for cleanup
  sleep 0.1

  tts_log "TTS cancel complete for this session"
}

# Cancel all TTS processes globally (use with caution - only for cleanup)
cancel_all_tts() {
  tts_log "Canceling ALL TTS processes globally..."

  # Kill any ralph speak processes
  local orphans=$(pgrep -f "ralph speak" 2>/dev/null || echo "")
  if [[ -n "$orphans" ]]; then
    tts_log "Killing all ralph speak processes: $orphans"
    pkill -f "ralph speak" 2>/dev/null || true
  fi

  # Kill any say processes on macOS
  if command -v say &>/dev/null; then
    local say_pids=$(pgrep say 2>/dev/null || echo "")
    if [[ -n "$say_pids" ]]; then
      tts_log "Killing say processes: $say_pids"
      killall say 2>/dev/null || true
    fi
  fi

  # Kill any piper processes
  local piper_pids=$(pgrep -f "piper" 2>/dev/null || echo "")
  if [[ -n "$piper_pids" ]]; then
    tts_log "Killing piper processes: $piper_pids"
    pkill -f "piper" 2>/dev/null || true
  fi

  sleep 0.3
  tts_log "All TTS canceled"
}

# Internal helper: prepare for TTS (acquire lock, cancel existing, validate)
# Returns 0 if ready to speak, 1 if should skip
# Sets TTS_TEXT variable with the text to speak
_prepare_tts() {
  local text="${1:-}"
  local mode="${2:-async}"

  # If no arg provided, read from stdin
  if [[ -z "$text" ]]; then
    text=$(cat)
  fi

  if [[ -z "$text" ]]; then
    tts_log "No text provided, skipping"
    return 1
  fi

  # Export for caller
  TTS_TEXT="$text"

  tts_log "Speaking${mode:+ ($mode)}: ${text:0:50}..."

  # Wait for voice lock if another session is speaking
  if ! check_voice_lock; then
    tts_log "Another session is speaking, waiting..."
    if ! wait_for_voice_lock 15; then
      tts_log "Timeout waiting for other session, skipping TTS"
      return 1
    fi
  fi

  # Cancel any existing TTS from THIS session only
  cancel_existing_tts

  # Verify ralph speak command is available
  if ! command -v ralph &>/dev/null; then
    tts_log "ERROR: ralph command not found in PATH"
    return 1
  fi

  return 0
}

# Speak text exclusively with cross-session coordination (non-blocking)
# Usage: speak_exclusive "text to speak"
#        echo "text" | speak_exclusive
speak_exclusive() {
  local TTS_TEXT=""
  if ! _prepare_tts "${1:-}" "async"; then
    return $?
  fi

  # Speak in background and track PID
  (echo "$TTS_TEXT" | ralph speak 2>&1) &
  local tts_pid=$!
  echo "$tts_pid" > "$TTS_PID_FILE"

  tts_log "TTS started with PID: $tts_pid"

  # Brief wait to check if TTS started successfully
  sleep 0.2
  if ! kill -0 "$tts_pid" 2>/dev/null; then
    tts_log "WARN: TTS process $tts_pid may have exited quickly"
  fi
}

# Speak text and wait for completion (blocking)
# Use for short confirmations that must finish before subsequent TTS
# Usage: speak_blocking "Starting your request"
speak_blocking() {
  local TTS_TEXT=""
  if ! _prepare_tts "${1:-}" "blocking"; then
    return $?
  fi

  # Speak and track PID
  (echo "$TTS_TEXT" | ralph speak) &
  local tts_pid=$!
  echo "$tts_pid" > "$TTS_PID_FILE"

  tts_log "TTS started with PID: $tts_pid (waiting for completion)"

  # Wait for completion
  local tts_exit_code=0
  wait "$tts_pid" 2>/dev/null || tts_exit_code=$?

  # Clean up PID file
  rm -f "$TTS_PID_FILE" 2>/dev/null || true

  if [[ $tts_exit_code -ne 0 ]]; then
    tts_log "WARN: TTS exited with code $tts_exit_code"
  else
    tts_log "TTS completed successfully"
  fi
}

# Cleanup function (for trap)
cleanup_tts_manager() {
  rm -f "$TTS_PID_FILE" 2>/dev/null || true
}

# Export functions and variables
export -f _prepare_tts
export -f cancel_existing_tts
export -f cancel_all_tts
export -f speak_exclusive
export -f speak_blocking
export -f check_voice_lock
export -f wait_for_voice_lock
export -f tts_log
export -f cleanup_tts_manager
export TTS_SESSION_ID
export TTS_SESSION_ID_SAFE
export TTS_PID_FILE
export VOICE_LOCK_FILE
