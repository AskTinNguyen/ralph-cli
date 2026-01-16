#!/bin/bash
# Event logging module for real-time visibility (US-002)
# Captures errors, warnings, info messages with structured format
# Events persist to .events.log for CLI display and historical review

# ============================================================================
# Event Logging Functions
# ============================================================================

# Log an error event to .events.log
# Usage: log_event_error <prd_folder> <message> [details]
# Example: log_event_error "$PRD_FOLDER" "Agent failed" "exit_code=1 story=US-001"
log_event_error() {
  local prd_folder="$1"
  local message="$2"
  local details="${3:-}"
  _log_event "$prd_folder" "ERROR" "$message" "$details"
}

# Log a warning event to .events.log
# Usage: log_event_warn <prd_folder> <message> [details]
# Example: log_event_warn "$PRD_FOLDER" "Test flaky" "retry=2/3"
log_event_warn() {
  local prd_folder="$1"
  local message="$2"
  local details="${3:-}"
  _log_event "$prd_folder" "WARN" "$message" "$details"
}

# Log an info event to .events.log
# Usage: log_event_info <prd_folder> <message> [details]
# Example: log_event_info "$PRD_FOLDER" "Build started" "iteration=1"
log_event_info() {
  local prd_folder="$1"
  local message="$2"
  local details="${3:-}"
  _log_event "$prd_folder" "INFO" "$message" "$details"
}

# Log a retry event to .events.log
# Usage: log_event_retry <prd_folder> <attempt> <max_attempts> <delay> [reason]
# Example: log_event_retry "$PRD_FOLDER" 2 3 "2s" "agent_timeout"
log_event_retry() {
  local prd_folder="$1"
  local attempt="$2"
  local max_attempts="$3"
  local delay="$4"
  local reason="${5:-}"
  local message="Retry $attempt/$max_attempts (delay: $delay)"
  local details="attempt=$attempt max=$max_attempts delay=$delay"
  if [[ -n "$reason" ]]; then
    details="$details reason=$reason"
  fi
  _log_event "$prd_folder" "RETRY" "$message" "$details"
}

# Internal function to write event to log file
# Format: [timestamp] LEVEL message | details
_log_event() {
  local prd_folder="$1"
  local level="$2"
  local message="$3"
  local details="${4:-}"

  # Ensure prd_folder exists
  if [[ -z "$prd_folder" ]]; then
    return 1
  fi

  local events_file="$prd_folder/.events.log"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  # Build event line
  local event_line="[$timestamp] $level $message"
  if [[ -n "$details" ]]; then
    event_line="$event_line | $details"
  fi

  # Append to file atomically (use >> which is atomic for single lines)
  echo "$event_line" >> "$events_file"
}

# ============================================================================
# CLI Display Functions
# ============================================================================

# Display an event with color and visual indicator
# Usage: display_event <level> <message> [details]
# Colors: ERROR=red, WARN=yellow, INFO=dim, RETRY=cyan
display_event() {
  local level="$1"
  local message="$2"
  local details="${3:-}"

  # Get colors (use output.sh variables if available)
  local c_red="${C_RED:-\033[31m}"
  local c_yellow="${C_YELLOW:-\033[33m}"
  local c_cyan="${C_CYAN:-\033[36m}"
  local c_dim="${C_DIM:-\033[2m}"
  local c_reset="${C_RESET:-\033[0m}"
  local c_bold="${C_BOLD:-\033[1m}"

  local icon color
  case "$level" in
    ERROR)
      icon="✗"
      color="$c_red"
      ;;
    WARN)
      icon="⚠"
      color="$c_yellow"
      ;;
    RETRY)
      icon="↻"
      color="$c_cyan"
      ;;
    INFO|*)
      icon="ℹ"
      color="$c_dim"
      ;;
  esac

  # Print event with color
  printf "%b%s %s%b" "$color" "$icon" "$message" "$c_reset"
  if [[ -n "$details" ]]; then
    printf " %b%s%b" "$c_dim" "$details" "$c_reset"
  fi
  printf "\n"
}

# Display new events from .events.log since a given line number
# Usage: display_new_events <events_file> <last_line_shown>
# Returns: new line count
display_new_events() {
  local events_file="$1"
  local last_line="${2:-0}"

  if [[ ! -f "$events_file" ]]; then
    echo "0"
    return
  fi

  local current_line_count
  current_line_count=$(wc -l < "$events_file" 2>/dev/null || echo "0")
  current_line_count="${current_line_count// /}"  # trim whitespace

  if [[ "$current_line_count" -le "$last_line" ]]; then
    echo "$current_line_count"
    return
  fi

  # Display new events
  local new_events
  new_events=$(tail -n "+$((last_line + 1))" "$events_file" 2>/dev/null)

  while IFS= read -r line; do
    if [[ -z "$line" ]]; then
      continue
    fi

    # Parse event line: [timestamp] LEVEL message | details
    # Format: [2026-01-16 16:09:40] ERROR Test message | key=value
    # Use awk for reliable parsing (regex has issues with some bash versions)
    local after_bracket level rest message details

    after_bracket=$(echo "$line" | awk -F'] ' '{print $2}')
    level=$(echo "$after_bracket" | awk '{print $1}')
    rest=$(echo "$after_bracket" | cut -d' ' -f2-)

    if [[ -n "$level" ]] && [[ -n "$rest" ]]; then
      # Split on " | " for details
      if [[ "$rest" == *" | "* ]]; then
        message="${rest%% | *}"
        details="${rest#* | }"
      else
        message="$rest"
        details=""
      fi

      display_event "$level" "$message" "$details"
    fi
  done <<< "$new_events"

  echo "$current_line_count"
}

# Get recent events from .events.log
# Usage: get_recent_events <events_file> [count]
# Returns: JSON array of recent events
get_recent_events() {
  local events_file="$1"
  local count="${2:-10}"

  if [[ ! -f "$events_file" ]]; then
    echo "[]"
    return
  fi

  local events
  events=$(tail -n "$count" "$events_file" 2>/dev/null)

  # Convert to simple format for CLI consumption
  # Full JSON parsing would require jq or node
  echo "$events"
}

# ============================================================================
# Event Context Helpers
# ============================================================================

# Build event details string with common context
# Usage: build_event_details <iteration> [story_id] [agent] [extra...]
build_event_details() {
  local iteration="$1"
  local story_id="${2:-}"
  local agent="${3:-}"
  shift 3 2>/dev/null || shift "$#"

  local details="iteration=$iteration"
  if [[ -n "$story_id" ]]; then
    details="$details story=$story_id"
  fi
  if [[ -n "$agent" ]]; then
    details="$details agent=$agent"
  fi

  # Append any extra key=value pairs
  for extra in "$@"; do
    details="$details $extra"
  done

  echo "$details"
}

# Clear events log (use sparingly - mainly for testing)
# Usage: clear_events <prd_folder>
clear_events() {
  local prd_folder="$1"
  local events_file="$prd_folder/.events.log"
  if [[ -f "$events_file" ]]; then
    : > "$events_file"
  fi
}
