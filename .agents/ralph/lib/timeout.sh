#!/bin/bash
# Timeout enforcement module for production monitoring (US-011)
# Provides timeout wrappers for agent calls, iterations, and stories

# ============================================================================
# Configuration (Environment Variables)
# ============================================================================

# Agent call timeout: 60 minutes (3600 seconds)
# Can be overridden via RALPH_TIMEOUT_AGENT environment variable
TIMEOUT_AGENT="${RALPH_TIMEOUT_AGENT:-3600}"

# Iteration timeout: 90 minutes (5400 seconds)
# Enforced by watchdog - can be overridden via RALPH_TIMEOUT_ITERATION
TIMEOUT_ITERATION="${RALPH_TIMEOUT_ITERATION:-5400}"

# Story timeout: 3 hours (10800 seconds) across multiple attempts
# Can be overridden via RALPH_TIMEOUT_STORY
TIMEOUT_STORY="${RALPH_TIMEOUT_STORY:-10800}"

# ============================================================================
# Story Time Tracking
# ============================================================================

# Story time tracking file stores cumulative time per story
# Format (JSON): { "US-001": { "total_seconds": 1234, "attempts": 2 }, ... }

# Initialize or get story time tracking file
get_story_time_file() {
  local prd_folder="$1"
  echo "$prd_folder/.story_times.json"
}

# Get cumulative time spent on a story
# Usage: get_story_time <prd_folder> <story_id>
# Returns: Total seconds spent on story (0 if not tracked)
get_story_time() {
  local prd_folder="$1"
  local story_id="$2"
  local time_file
  time_file=$(get_story_time_file "$prd_folder")

  if [[ ! -f "$time_file" ]]; then
    echo "0"
    return
  fi

  # Parse JSON using python3 or jq
  if command -v python3 &>/dev/null; then
    python3 -c "
import json
import sys
try:
    with open('$time_file', 'r') as f:
        data = json.load(f)
    story_data = data.get('$story_id', {})
    print(story_data.get('total_seconds', 0))
except:
    print(0)
" 2>/dev/null
  elif command -v jq &>/dev/null; then
    jq -r ".[\"$story_id\"].total_seconds // 0" "$time_file" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

# Get story attempt count
# Usage: get_story_attempts <prd_folder> <story_id>
# Returns: Number of attempts on story (0 if not tracked)
get_story_attempts() {
  local prd_folder="$1"
  local story_id="$2"
  local time_file
  time_file=$(get_story_time_file "$prd_folder")

  if [[ ! -f "$time_file" ]]; then
    echo "0"
    return
  fi

  # Parse JSON using python3 or jq
  if command -v python3 &>/dev/null; then
    python3 -c "
import json
try:
    with open('$time_file', 'r') as f:
        data = json.load(f)
    story_data = data.get('$story_id', {})
    print(story_data.get('attempts', 0))
except:
    print(0)
" 2>/dev/null
  elif command -v jq &>/dev/null; then
    jq -r ".[\"$story_id\"].attempts // 0" "$time_file" 2>/dev/null || echo "0"
  else
    echo "0"
  fi
}

# Update story time tracking
# Usage: update_story_time <prd_folder> <story_id> <duration_seconds> [increment_attempts]
# increment_attempts: "true" to increment attempt counter (default: false)
update_story_time() {
  local prd_folder="$1"
  local story_id="$2"
  local duration="$3"
  local increment_attempts="${4:-false}"
  local time_file
  time_file=$(get_story_time_file "$prd_folder")

  # Ensure prd_folder exists
  if [[ -z "$prd_folder" ]]; then
    return 1
  fi

  # Use python3 or jq to update JSON atomically
  if command -v python3 &>/dev/null; then
    python3 -c "
import json
import os

time_file = '$time_file'
story_id = '$story_id'
duration = int('$duration')
increment = '$increment_attempts' == 'true'

# Read existing data or create empty dict
data = {}
if os.path.exists(time_file):
    try:
        with open(time_file, 'r') as f:
            data = json.load(f)
    except:
        pass

# Update story data
if story_id not in data:
    data[story_id] = {'total_seconds': 0, 'attempts': 0, 'last_updated': ''}

data[story_id]['total_seconds'] += duration
if increment:
    data[story_id]['attempts'] += 1

from datetime import datetime
data[story_id]['last_updated'] = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

# Write atomically
tmp_file = time_file + '.tmp.' + str(os.getpid())
with open(tmp_file, 'w') as f:
    json.dump(data, f, indent=2)
os.rename(tmp_file, time_file)
" 2>/dev/null
  elif command -v jq &>/dev/null; then
    local tmp_file="${time_file}.tmp.$$"
    local current_time current_attempts
    current_time=$(get_story_time "$prd_folder" "$story_id")
    current_attempts=$(get_story_attempts "$prd_folder" "$story_id")
    local new_time=$((current_time + duration))
    local new_attempts=$current_attempts
    if [[ "$increment_attempts" == "true" ]]; then
      new_attempts=$((current_attempts + 1))
    fi
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

    if [[ -f "$time_file" ]]; then
      jq ".[\"$story_id\"] = {\"total_seconds\": $new_time, \"attempts\": $new_attempts, \"last_updated\": \"$timestamp\"}" \
        "$time_file" > "$tmp_file" && mv "$tmp_file" "$time_file"
    else
      echo "{\"$story_id\": {\"total_seconds\": $new_time, \"attempts\": $new_attempts, \"last_updated\": \"$timestamp\"}}" > "$time_file"
    fi
  fi
}

# Check if story has exceeded timeout
# Usage: is_story_timed_out <prd_folder> <story_id>
# Returns: 0 if timed out, 1 if not
is_story_timed_out() {
  local prd_folder="$1"
  local story_id="$2"
  local story_time
  story_time=$(get_story_time "$prd_folder" "$story_id")

  if [[ "$story_time" -ge "$TIMEOUT_STORY" ]]; then
    return 0  # Timed out
  fi
  return 1  # Not timed out
}

# Clear story time tracking (e.g., on successful completion)
# Usage: clear_story_time <prd_folder> <story_id>
clear_story_time() {
  local prd_folder="$1"
  local story_id="$2"
  local time_file
  time_file=$(get_story_time_file "$prd_folder")

  if [[ ! -f "$time_file" ]]; then
    return
  fi

  # Remove story from tracking
  if command -v python3 &>/dev/null; then
    python3 -c "
import json
import os

time_file = '$time_file'
story_id = '$story_id'

if os.path.exists(time_file):
    with open(time_file, 'r') as f:
        data = json.load(f)
    if story_id in data:
        del data[story_id]
        tmp_file = time_file + '.tmp.' + str(os.getpid())
        with open(tmp_file, 'w') as f:
            json.dump(data, f, indent=2)
        os.rename(tmp_file, time_file)
" 2>/dev/null
  elif command -v jq &>/dev/null; then
    local tmp_file="${time_file}.tmp.$$"
    jq "del(.[\"$story_id\"])" "$time_file" > "$tmp_file" && mv "$tmp_file" "$time_file"
  fi
}

# ============================================================================
# Iteration Time Tracking
# ============================================================================

# Track iteration start time for timeout enforcement
ITERATION_START_TIME=""

# Start iteration timer
# Usage: start_iteration_timer
start_iteration_timer() {
  ITERATION_START_TIME=$(date +%s)
  export ITERATION_START_TIME
}

# Get elapsed iteration time in seconds
# Usage: get_iteration_elapsed
# Returns: Elapsed seconds since iteration started
get_iteration_elapsed() {
  if [[ -z "$ITERATION_START_TIME" ]]; then
    echo "0"
    return
  fi
  local now
  now=$(date +%s)
  echo $((now - ITERATION_START_TIME))
}

# Check if iteration has exceeded timeout
# Usage: is_iteration_timed_out
# Returns: 0 if timed out, 1 if not
is_iteration_timed_out() {
  local elapsed
  elapsed=$(get_iteration_elapsed)

  if [[ "$elapsed" -ge "$TIMEOUT_ITERATION" ]]; then
    return 0  # Timed out
  fi
  return 1  # Not timed out
}

# ============================================================================
# Agent Timeout Wrapper
# ============================================================================

# Run command with timeout
# Usage: run_with_timeout <timeout_seconds> <command...>
# Returns: Command exit status (124 if timed out)
# Note: Uses timeout command (GNU coreutils)
run_with_timeout() {
  local timeout_secs="$1"
  shift

  # Check if timeout command is available
  if ! command -v timeout &>/dev/null; then
    # Fallback: run without timeout on systems without timeout command
    "$@"
    return $?
  fi

  # Use timeout command with SIGTERM (graceful), then SIGKILL after 30s
  timeout --signal=TERM --kill-after=30 "$timeout_secs" "$@"
  return $?
}

# Run agent with timeout wrapper
# Usage: run_agent_with_timeout <prompt_file>
# Returns: Agent exit status (124 if timed out)
# Environment: AGENT_CMD must be set
run_agent_with_timeout() {
  local prompt_file="$1"
  local timeout_secs="${TIMEOUT_AGENT}"

  if [[ "$AGENT_CMD" == *"{prompt}"* ]]; then
    # File-based agent (e.g., droid with {prompt} placeholder)
    local escaped
    escaped=$(printf '%q' "$prompt_file")
    local cmd="${AGENT_CMD//\{prompt\}/$escaped}"
    run_with_timeout "$timeout_secs" bash -c "$cmd"
  else
    # Stdin-based agent (e.g., claude, codex)
    run_with_timeout "$timeout_secs" bash -c "cat '$prompt_file' | $AGENT_CMD"
  fi
}

# ============================================================================
# Timeout Event Logging
# ============================================================================

# Log a timeout event to .events.log and activity.log
# Usage: log_timeout_event <prd_folder> <timeout_type> <duration> <iteration> <story_id> <agent> [extra_details]
# timeout_type: "agent", "iteration", or "story"
log_timeout_event() {
  local prd_folder="$1"
  local timeout_type="$2"
  local duration="$3"
  local iteration="${4:-}"
  local story_id="${5:-}"
  local agent="${6:-}"
  local extra="${7:-}"

  if [[ -z "$prd_folder" ]]; then
    return 1
  fi

  local events_file="$prd_folder/.events.log"
  local activity_log="$prd_folder/activity.log"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  # Build details string
  local details="type=$timeout_type duration=${duration}s"
  if [[ -n "$iteration" ]]; then
    details="$details iteration=$iteration"
  fi
  if [[ -n "$story_id" ]]; then
    details="$details story=$story_id"
  fi
  if [[ -n "$agent" ]]; then
    details="$details agent=$agent"
  fi
  if [[ -n "$extra" ]]; then
    details="$details $extra"
  fi

  # Determine threshold for message
  local threshold_secs
  case "$timeout_type" in
    agent) threshold_secs="$TIMEOUT_AGENT" ;;
    iteration) threshold_secs="$TIMEOUT_ITERATION" ;;
    story) threshold_secs="$TIMEOUT_STORY" ;;
    *) threshold_secs="unknown" ;;
  esac

  local message="Timeout: $timeout_type exceeded ${threshold_secs}s limit"

  # Write to .events.log
  echo "[$timestamp] ERROR $message | $details" >> "$events_file"

  # Write to activity.log
  if [[ -f "$activity_log" ]] || [[ -w "$(dirname "$activity_log")" ]]; then
    echo "[$timestamp] TIMEOUT $timeout_type $details" >> "$activity_log"
  fi
}

# Display timeout event in CLI with visual indicator
# Usage: display_timeout_event <timeout_type> <duration> <iteration> <story_id> <agent>
display_timeout_event() {
  local timeout_type="$1"
  local duration="$2"
  local iteration="${3:-}"
  local story_id="${4:-}"
  local agent="${5:-}"

  # Get colors
  local c_red="${C_RED:-\033[31m}"
  local c_yellow="${C_YELLOW:-\033[33m}"
  local c_dim="${C_DIM:-\033[2m}"
  local c_reset="${C_RESET:-\033[0m}"
  local c_bold="${C_BOLD:-\033[1m}"

  # Format duration as human-readable
  local hours=$((duration / 3600))
  local mins=$(( (duration % 3600) / 60))
  local secs=$((duration % 60))
  local formatted_duration=""

  if [[ "$hours" -gt 0 ]]; then
    formatted_duration="${hours}h ${mins}m ${secs}s"
  elif [[ "$mins" -gt 0 ]]; then
    formatted_duration="${mins}m ${secs}s"
  else
    formatted_duration="${secs}s"
  fi

  # Determine threshold for message
  local threshold_secs threshold_formatted
  case "$timeout_type" in
    agent)
      threshold_secs="$TIMEOUT_AGENT"
      threshold_formatted="$(( TIMEOUT_AGENT / 60 ))m"
      ;;
    iteration)
      threshold_secs="$TIMEOUT_ITERATION"
      threshold_formatted="$(( TIMEOUT_ITERATION / 60 ))m"
      ;;
    story)
      threshold_secs="$TIMEOUT_STORY"
      threshold_formatted="$(( TIMEOUT_STORY / 3600 ))h"
      ;;
    *)
      threshold_secs="unknown"
      threshold_formatted="unknown"
      ;;
  esac

  # Print timeout message with visual emphasis
  printf "\n%b───────────────────────────────────────────────────────%b\n" "$c_red" "$c_reset"
  printf "%b  ⏱ TIMEOUT: %s%b\n" "$c_red" "$timeout_type" "$c_reset"
  printf "%b  Duration: %s (limit: %s)%b\n" "$c_yellow" "$formatted_duration" "$threshold_formatted" "$c_reset"

  if [[ -n "$iteration" ]]; then
    printf "%b  Iteration: %s%b\n" "$c_dim" "$iteration" "$c_reset"
  fi
  if [[ -n "$story_id" ]]; then
    printf "%b  Story: %s%b\n" "$c_dim" "$story_id" "$c_reset"
  fi
  if [[ -n "$agent" ]]; then
    printf "%b  Agent: %s%b\n" "$c_dim" "$agent" "$c_reset"
  fi

  printf "%b───────────────────────────────────────────────────────%b\n\n" "$c_red" "$c_reset"
}

# ============================================================================
# Integration Helpers
# ============================================================================

# Check if an exit code indicates a timeout
# Usage: is_timeout_exit_code <exit_code>
# Returns: 0 if timeout (124 or 137), 1 otherwise
is_timeout_exit_code() {
  local exit_code="$1"

  # 124 = timeout command SIGTERM
  # 137 = SIGKILL (128 + 9)
  if [[ "$exit_code" -eq 124 ]] || [[ "$exit_code" -eq 137 ]]; then
    return 0
  fi
  return 1
}

# Get timeout configuration as JSON
# Usage: get_timeout_config
# Returns: JSON object with timeout settings
get_timeout_config() {
  cat <<EOF
{
  "agent_timeout_seconds": $TIMEOUT_AGENT,
  "iteration_timeout_seconds": $TIMEOUT_ITERATION,
  "story_timeout_seconds": $TIMEOUT_STORY,
  "agent_timeout_minutes": $(( TIMEOUT_AGENT / 60 )),
  "iteration_timeout_minutes": $(( TIMEOUT_ITERATION / 60 )),
  "story_timeout_hours": $(( TIMEOUT_STORY / 3600 ))
}
EOF
}

# Format timeout value for display
# Usage: format_timeout <seconds>
# Returns: Human-readable string like "60m" or "3h"
format_timeout() {
  local seconds="$1"

  local hours=$((seconds / 3600))
  local mins=$(( (seconds % 3600) / 60))

  if [[ "$hours" -gt 0 ]]; then
    if [[ "$mins" -gt 0 ]]; then
      echo "${hours}h ${mins}m"
    else
      echo "${hours}h"
    fi
  else
    echo "${mins}m"
  fi
}
