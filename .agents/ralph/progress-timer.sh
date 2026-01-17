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

RALPH_ROOT="${RALPH_ROOT:-$(pwd)}"
PID_FILE="${RALPH_ROOT}/.ralph/progress-timer.pid"
CONFIG_FILE="${RALPH_ROOT}/.ralph/voice-config.json"
LOG_FILE="${RALPH_ROOT}/.ralph/progress-timer.log"

# Progress phrases to cycle through
PHRASES=(
  "Still working"
  "Processing"
  "Almost there"
  "Working on it"
)

# Function to log messages
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] [timer] $*" >> "$LOG_FILE"
}

# Get interval from config or use default
get_interval() {
  local default=15

  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "$default"
    return
  fi

  if command -v jq &>/dev/null; then
    local interval=$(jq -r '.progress.intervalSeconds // 15' "$CONFIG_FILE" 2>/dev/null)
    if [[ "$interval" =~ ^[0-9]+$ ]] && [[ "$interval" -ge 5 ]] && [[ "$interval" -le 120 ]]; then
      echo "$interval"
      return
    fi
  fi

  echo "$default"
}

# Check if progress updates are enabled
is_progress_enabled() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return 0  # Default to enabled if no config
  fi

  if command -v jq &>/dev/null; then
    local enabled=$(jq -r '.progress.enabled // null' "$CONFIG_FILE" 2>/dev/null)
    if [[ "$enabled" == "false" ]]; then
      return 1
    fi
    # Also check if autoSpeak is enabled (progress depends on it)
    local autoSpeak=$(jq -r '.autoSpeak // false' "$CONFIG_FILE" 2>/dev/null)
    [[ "$autoSpeak" == "true" ]]
  else
    grep -q '"autoSpeak"[[:space:]]*:[[:space:]]*true' "$CONFIG_FILE" 2>/dev/null
  fi
}

# Speak a phrase using ralph speak
speak_phrase() {
  local phrase="$1"
  echo "$phrase" | ralph speak &>/dev/null || true
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
  log "Interval: ${interval}s"

  # Start the background timer loop
  (
    # Set up signal handling for clean exit
    trap 'log "Timer received TERM signal"; exit 0' TERM
    trap 'log "Timer received INT signal"; exit 0' INT

    # Also exit if parent dies (prevents orphans)
    trap 'exit 0' HUP

    local idx=0
    local num_phrases=${#PHRASES[@]}

    # Wait for initial interval before first phrase
    log "Waiting ${interval}s before first progress update..."
    sleep "$interval"

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
