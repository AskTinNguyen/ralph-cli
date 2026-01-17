#!/usr/bin/env bash
# Auto-speak monitor for Claude Code sessions
# Watches the terminal output and speaks Claude's responses automatically

set -euo pipefail

RALPH_ROOT="${RALPH_ROOT:-$(pwd)}"
CONFIG_FILE="${RALPH_ROOT}/.ralph/voice-config.json"
LOG_FILE="${RALPH_ROOT}/.ralph/auto-speak.log"
PID_FILE="${RALPH_ROOT}/.ralph/auto-speak.pid"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

log() {
  echo "[$(date '+%H:%M:%S')] $*" >> "$LOG_FILE"
}

info() {
  echo -e "${CYAN}$*${NC}"
  log "INFO: $*"
}

dim() {
  echo -e "${DIM}$*${NC}"
}

success() {
  echo -e "${GREEN}$*${NC}"
  log "SUCCESS: $*"
}

warn() {
  echo -e "${YELLOW}$*${NC}"
  log "WARN: $*"
}

# Check if auto-speak is enabled
is_enabled() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return 1
  fi

  # Use jq if available, otherwise grep
  if command -v jq &>/dev/null; then
    local enabled=$(jq -r '.autoSpeak // false' "$CONFIG_FILE" 2>/dev/null)
    [[ "$enabled" == "true" ]]
  else
    grep -q '"autoSpeak"[[:space:]]*:[[:space:]]*true' "$CONFIG_FILE" 2>/dev/null
  fi
}

# Extract Claude's response from terminal output
# This is a simplified version - in production you'd want more robust parsing
extract_response() {
  local input="$1"

  # Remove ANSI color codes
  local clean=$(echo "$input" | sed 's/\x1B\[[0-9;]*[JKmsu]//g')

  # Remove tool calls and system messages
  clean=$(echo "$clean" | grep -v "^<" | grep -v "^<function_calls>" | grep -v "^</function_calls>" || true)

  # Remove empty lines
  clean=$(echo "$clean" | sed '/^[[:space:]]*$/d')

  echo "$clean"
}

# Speak text using ralph speak
speak() {
  local text="$1"

  if [[ -z "$text" ]]; then
    return
  fi

  log "Speaking: ${text:0:100}..."
  echo "$text" | ralph speak 2>/dev/null &
}

# Start monitoring
start_monitor() {
  info "Starting auto-speak monitor..."

  # Create log file
  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"

  # Save PID
  echo $$ > "$PID_FILE"

  dim "Monitoring Claude Code output for auto-speak"
  dim "Press Ctrl+C to stop"
  echo ""

  # Buffer for accumulating response
  local response_buffer=""
  local in_response=false

  # Monitor stdin (piped from claude command)
  while IFS= read -r line; do
    # Echo line to stdout (pass through)
    echo "$line"

    # Check if auto-speak is still enabled
    if ! is_enabled; then
      log "Auto-speak disabled, exiting monitor"
      break
    fi

    # Detect start of Claude's response
    # This is a heuristic - adjust based on actual Claude Code output format
    if [[ "$line" =~ ^[A-Z].*$ ]] && [[ ! "$line" =~ ^[[:space:]]*$ ]]; then
      in_response=true
      response_buffer+="$line"$'\n'
    elif [[ "$in_response" == true ]]; then
      if [[ "$line" =~ ^[[:space:]]*$ ]]; then
        # Empty line might signal end of response paragraph
        if [[ -n "$response_buffer" ]]; then
          # Speak the accumulated response
          local clean_text=$(extract_response "$response_buffer")
          if [[ ${#clean_text} -gt 20 ]]; then
            speak "$clean_text"
          fi
          response_buffer=""
        fi
        in_response=false
      else
        response_buffer+="$line"$'\n'
      fi
    fi
  done

  # Clean up
  rm -f "$PID_FILE"
  log "Monitor stopped"
}

# Stop monitor
stop_monitor() {
  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      success "Auto-speak monitor stopped (PID: $pid)"
    else
      warn "Monitor process not running"
    fi
    rm -f "$PID_FILE"
  else
    warn "No monitor PID file found"
  fi
}

# Check status
check_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      success "Auto-speak monitor is running (PID: $pid)"
      if is_enabled; then
        info "Auto-speak is enabled"
      else
        warn "Auto-speak is disabled in config"
      fi
      return 0
    else
      warn "Monitor PID file exists but process is not running"
      rm -f "$PID_FILE"
      return 1
    fi
  else
    info "Auto-speak monitor is not running"
    return 1
  fi
}

# Main
case "${1:-start}" in
  start)
    if [[ -f "$PID_FILE" ]]; then
      local pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        warn "Monitor already running (PID: $pid)"
        exit 1
      fi
    fi

    if ! is_enabled; then
      warn "Auto-speak is not enabled"
      info "Run: ralph speak --auto-on"
      exit 1
    fi

    start_monitor
    ;;

  stop)
    stop_monitor
    ;;

  status)
    check_status
    ;;

  *)
    echo "Usage: $0 {start|stop|status}"
    exit 1
    ;;
esac
