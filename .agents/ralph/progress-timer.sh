#!/usr/bin/env bash
# Background timer for periodic progress updates
# Speaks status phrases at regular intervals while Claude is working
#
# Usage:
#   progress-timer.sh start  - Start the background timer
#   progress-timer.sh stop   - Stop the running timer
#
# The timer automatically cycles through progress phrases every N seconds
# Timer is killed by the Stop hook when Claude finishes responding

set -euo pipefail

# Get script directory for sourcing path-utils
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared utilities
source "${SCRIPT_DIR}/lib/path-utils.sh"
source "${SCRIPT_DIR}/lib/config-utils.sh"
source "${SCRIPT_DIR}/lib/tts-manager.sh"

# Resolve RALPH_ROOT using smart detection
RALPH_DIR="$(find_ralph_root)" || RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
export RALPH_ROOT="$RALPH_DIR"

PID_FILE="${RALPH_DIR}/progress-timer.pid"
LOG_FILE="${RALPH_DIR}/progress-timer.log"

# Progress phrases - English
PHRASES_EN=(
  "Still working"
  "Processing"
  "Almost there"
  "Working on it"
)

# Progress phrases - Vietnamese
PHRASES_VI=(
  "Đang xử lý"
  "Vẫn đang làm"
  "Sắp xong rồi"
  "Đang thực hiện"
)

# Active phrases array (set based on language preference)
PHRASES=()

# Function to log messages
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [timer] $*" >> "$LOG_FILE"
}

# Get preferred language from config
get_voice_language() {
  get_config_value ".multilingual.preferredLanguage" "en"
}

# Initialize phrases based on language preference
init_phrases() {
  local lang=$(get_voice_language)
  if [[ "$lang" == "vi" ]]; then
    PHRASES=("${PHRASES_VI[@]}")
    log "Using Vietnamese phrases"
  else
    PHRASES=("${PHRASES_EN[@]}")
    log "Using English phrases"
  fi
}

# Get interval from config (5-120 seconds, default 15)
get_interval() {
  get_config_int ".progress.intervalSeconds" 15 5 120
}

# Get initial delay from config (2-60 seconds, default 5)
get_initial_delay() {
  get_config_int ".progress.initialDelaySeconds" 5 2 60
}

# Check if progress updates are enabled
# Progress requires both progress.enabled != false AND autoSpeak enabled
is_progress_enabled() {
  # Explicitly disabled
  if is_config_false ".progress.enabled"; then
    return 1
  fi

  # Check autoSpeak (supports both legacy boolean and new object format)
  is_config_true ".autoSpeak.enabled" || is_config_true ".autoSpeak"
}

# Speak a phrase using TTS manager (exclusive playback)
# Uses "progress" usage type to select progress voice
speak_phrase() {
  local phrase="$1"
  speak_exclusive "$phrase" "progress" || true
}

# Start the background timer loop
start_timer() {
  log "=== Starting progress timer ==="

  # Check if progress is enabled
  if ! is_progress_enabled; then
    log "Progress updates disabled, not starting timer"
    exit 0
  fi

  # Kill any existing timer first
  stop_timer 2>/dev/null || true

  local interval=$(get_interval)
  local initial_delay=$(get_initial_delay)
  log "Interval: ${interval}s, Initial delay: ${initial_delay}s"

  # Initialize phrases based on language preference
  init_phrases

  # Start the background timer loop
  (
    # Set up signal handling for clean exit
    trap 'log "Timer received TERM signal"; exit 0' TERM
    trap 'log "Timer received INT signal"; exit 0' INT

    # Also exit if parent dies (prevents orphans)
    trap 'exit 0' HUP

    local idx=0
    local num_phrases=${#PHRASES[@]}

    # Wait for initial delay before first phrase (shorter than subsequent intervals)
    log "Waiting ${initial_delay}s before first progress update..."
    sleep "$initial_delay"

    # Check if we should still be running (PID file exists and matches)
    while true; do
      # Verify our PID file still points to us
      if [[ -f "$PID_FILE" ]]; then
        local stored_pid=$(cat "$PID_FILE" 2>/dev/null)
        if [[ "$stored_pid" != "$$" ]]; then
          log "PID mismatch (stored: $stored_pid, us: $$), exiting"
          exit 0
        fi
      else
        log "PID file removed, exiting"
        exit 0
      fi

      # Speak the current phrase
      local phrase="${PHRASES[$idx]}"
      log "Speaking: $phrase"
      speak_phrase "$phrase"

      # Move to next phrase (cycle)
      idx=$(( (idx + 1) % num_phrases ))

      # Wait for next interval
      sleep "$interval"
    done
  ) &

  local timer_pid=$!
  echo "$timer_pid" > "$PID_FILE"
  disown "$timer_pid" 2>/dev/null || true

  log "Timer started with PID $timer_pid"
}

# Stop the running timer
stop_timer() {
  log "=== Stopping progress timer ==="

  if [[ ! -f "$PID_FILE" ]]; then
    log "No PID file found, nothing to stop"
    return 0
  fi

  local pid=$(cat "$PID_FILE" 2>/dev/null)
  rm -f "$PID_FILE"

  if [[ -z "$pid" ]]; then
    log "Empty PID file"
    return 0
  fi

  # Check if process is still running
  if kill -0 "$pid" 2>/dev/null; then
    log "Killing timer process $pid"
    kill "$pid" 2>/dev/null || true

    # Wait briefly for clean exit
    sleep 0.2

    # Force kill if still running
    if kill -0 "$pid" 2>/dev/null; then
      log "Force killing timer process $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    log "Timer process $pid already stopped"
  fi

  log "Timer stopped"
}

# Show status
show_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE" 2>/dev/null)
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "Progress timer running (PID: $pid)"
      return 0
    fi
  fi
  echo "Progress timer not running"
  return 1
}

# Main command handler
case "${1:-}" in
  start)
    start_timer
    ;;
  stop)
    stop_timer
    ;;
  status)
    show_status
    ;;
  *)
    echo "Usage: progress-timer.sh {start|stop|status}"
    exit 1
    ;;
esac
