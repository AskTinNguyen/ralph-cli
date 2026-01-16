#!/bin/bash
# Heartbeat and stall detection module for production monitoring (US-009)
# Updates .heartbeat file on agent output, detects stalls after configurable threshold

# ============================================================================
# Configuration
# ============================================================================

# Default stall threshold: 30 minutes (1800 seconds)
# Can be overridden via RALPH_STALL_THRESHOLD_SILENT environment variable
STALL_THRESHOLD="${RALPH_STALL_THRESHOLD_SILENT:-1800}"

# Check interval for stall detection (60 seconds)
STALL_CHECK_INTERVAL="${RALPH_STALL_CHECK_INTERVAL:-60}"

# ============================================================================
# Heartbeat Functions
# ============================================================================

# Update heartbeat file with current timestamp
# Usage: update_heartbeat <prd_folder>
# Should be called on every agent output (or at regular intervals)
update_heartbeat() {
  local prd_folder="$1"

  if [[ -z "$prd_folder" ]]; then
    return 1
  fi

  local heartbeat_file="$prd_folder/.heartbeat"
  local timestamp
  timestamp=$(date +%s)

  # Write atomically using temp file
  local tmp_file="${heartbeat_file}.tmp.$$"
  echo "$timestamp" > "$tmp_file"
  mv "$tmp_file" "$heartbeat_file"
}

# Read last heartbeat timestamp
# Usage: get_heartbeat <prd_folder>
# Returns: Unix timestamp or empty if no heartbeat
get_heartbeat() {
  local prd_folder="$1"
  local heartbeat_file="$prd_folder/.heartbeat"

  if [[ -f "$heartbeat_file" ]]; then
    cat "$heartbeat_file" 2>/dev/null
  fi
}

# Calculate heartbeat age in seconds
# Usage: get_heartbeat_age <prd_folder>
# Returns: Age in seconds, or empty if no heartbeat
get_heartbeat_age() {
  local prd_folder="$1"
  local last_heartbeat
  last_heartbeat=$(get_heartbeat "$prd_folder")

  if [[ -n "$last_heartbeat" ]]; then
    local now
    now=$(date +%s)
    echo $((now - last_heartbeat))
  fi
}

# Clear heartbeat file (on build completion)
# Usage: clear_heartbeat <prd_folder>
clear_heartbeat() {
  local prd_folder="$1"
  local heartbeat_file="$prd_folder/.heartbeat"

  rm -f "$heartbeat_file" 2>/dev/null || true
}

# ============================================================================
# Stall Detection Functions
# ============================================================================

# Check if build is stalled based on heartbeat age
# Usage: is_stalled <prd_folder> [threshold_seconds]
# Returns: 0 if stalled, 1 if not stalled
is_stalled() {
  local prd_folder="$1"
  local threshold="${2:-$STALL_THRESHOLD}"

  local age
  age=$(get_heartbeat_age "$prd_folder")

  if [[ -z "$age" ]]; then
    # No heartbeat file exists - can't determine stall
    return 1
  fi

  if [[ "$age" -ge "$threshold" ]]; then
    return 0  # Stalled
  fi

  return 1  # Not stalled
}

# Create .stalled marker file with diagnostics
# Usage: create_stalled_marker <prd_folder> <iteration> <story_id> <agent> <elapsed_seconds>
create_stalled_marker() {
  local prd_folder="$1"
  local iteration="${2:-unknown}"
  local story_id="${3:-unknown}"
  local agent="${4:-unknown}"
  local elapsed="${5:-0}"

  if [[ -z "$prd_folder" ]]; then
    return 1
  fi

  local stalled_file="$prd_folder/.stalled"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local heartbeat_age
  heartbeat_age=$(get_heartbeat_age "$prd_folder")

  # Get current process info
  local pid=$$
  local lock_pid=""
  local lock_file="$prd_folder/../locks/stream-${prd_folder##*/PRD-}.lock"
  if [[ -f "$lock_file" ]]; then
    lock_pid=$(cat "$lock_file" 2>/dev/null || echo "")
  fi

  # Get last few lines from log file if available
  local last_output=""
  local log_pattern="$prd_folder/runs/run-*-iter-*.log"
  local latest_log
  latest_log=$(ls -t $log_pattern 2>/dev/null | head -1)
  if [[ -n "$latest_log" ]] && [[ -f "$latest_log" ]]; then
    last_output=$(tail -20 "$latest_log" 2>/dev/null || echo "")
  fi

  # Create stalled marker with diagnostics
  cat > "$stalled_file" <<EOF
{
  "timestamp": "$timestamp",
  "iteration": $iteration,
  "story_id": "$story_id",
  "agent": "$agent",
  "elapsed_seconds": $elapsed,
  "heartbeat_age_seconds": ${heartbeat_age:-null},
  "stall_threshold_seconds": $STALL_THRESHOLD,
  "pid": $pid,
  "lock_pid": ${lock_pid:-null},
  "last_log_file": "${latest_log:-null}",
  "last_output_lines": $(printf '%s' "$last_output" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || echo '""')
}
EOF

  return 0
}

# Clear stalled marker file
# Usage: clear_stalled_marker <prd_folder>
clear_stalled_marker() {
  local prd_folder="$1"
  local stalled_file="$prd_folder/.stalled"

  rm -f "$stalled_file" 2>/dev/null || true
}

# Check if .stalled marker exists
# Usage: has_stalled_marker <prd_folder>
# Returns: 0 if marker exists, 1 otherwise
has_stalled_marker() {
  local prd_folder="$1"
  local stalled_file="$prd_folder/.stalled"

  [[ -f "$stalled_file" ]]
}

# ============================================================================
# Stall Detection Background Process
# ============================================================================

# Global variable to track stall detector PID
STALL_DETECTOR_PID=""

# Start background stall detector
# Usage: start_stall_detector <prd_folder> <iteration> <story_id> <agent> <activity_log>
start_stall_detector() {
  local prd_folder="$1"
  local iteration="$2"
  local story_id="$3"
  local agent="$4"
  local activity_log="${5:-}"
  local parent_pid=$$  # Capture parent PID

  # Don't start if already running
  if [[ -n "$STALL_DETECTOR_PID" ]] && kill -0 "$STALL_DETECTOR_PID" 2>/dev/null; then
    return 0
  fi

  # Start background detector
  (
    local stall_logged=false
    local build_start
    build_start=$(date +%s)

    while true; do
      # Exit if parent process is gone (prevents orphans)
      if ! kill -0 "$parent_pid" 2>/dev/null; then
        exit 0
      fi

      sleep "$STALL_CHECK_INTERVAL"

      # Check for stall
      if is_stalled "$prd_folder"; then
        # Only log stall once per detection
        if [[ "$stall_logged" != "true" ]]; then
          local elapsed=$(($(date +%s) - build_start))
          local heartbeat_age
          heartbeat_age=$(get_heartbeat_age "$prd_folder")

          # Create stalled marker with diagnostics
          create_stalled_marker "$prd_folder" "$iteration" "$story_id" "$agent" "$elapsed"

          # Log to activity.log
          if [[ -n "$activity_log" ]] && [[ -w "$(dirname "$activity_log")" ]]; then
            local log_timestamp
            log_timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            echo "[$log_timestamp] STALL iteration=$iteration story=$story_id elapsed=${elapsed}s heartbeat_age=${heartbeat_age}s" >> "$activity_log"
          fi

          # Log to .events.log
          local events_file="$prd_folder/.events.log"
          if [[ -w "$(dirname "$events_file")" ]]; then
            local event_timestamp
            event_timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            echo "[$event_timestamp] ERROR Stall detected | iteration=$iteration story=$story_id heartbeat_age=${heartbeat_age}s threshold=${STALL_THRESHOLD}s" >> "$events_file"
          fi

          stall_logged=true
        fi
      else
        # Reset stall flag if no longer stalled (heartbeat resumed)
        if [[ "$stall_logged" == "true" ]]; then
          # Clear stalled marker if heartbeat resumed
          clear_stalled_marker "$prd_folder"

          # Log recovery
          if [[ -n "$activity_log" ]] && [[ -w "$(dirname "$activity_log")" ]]; then
            local log_timestamp
            log_timestamp=$(date '+%Y-%m-%d %H:%M:%S')
            echo "[$log_timestamp] STALL_RECOVERED iteration=$iteration story=$story_id" >> "$activity_log"
          fi

          stall_logged=false
        fi
      fi
    done
  ) &
  STALL_DETECTOR_PID=$!
}

# Stop background stall detector
# Usage: stop_stall_detector
stop_stall_detector() {
  if [[ -n "$STALL_DETECTOR_PID" ]]; then
    if kill -0 "$STALL_DETECTOR_PID" 2>/dev/null; then
      kill "$STALL_DETECTOR_PID" 2>/dev/null || true
      wait "$STALL_DETECTOR_PID" 2>/dev/null || true
    fi
    STALL_DETECTOR_PID=""
  fi
}

# ============================================================================
# Heartbeat Wrapper for Agent Output
# ============================================================================

# Wrap command output to update heartbeat on each line
# Usage: cmd | heartbeat_tee <prd_folder> | tee <log_file>
# This updates heartbeat on every line of output from the agent
heartbeat_tee() {
  local prd_folder="$1"

  while IFS= read -r line; do
    echo "$line"
    update_heartbeat "$prd_folder"
  done
}

# Alternative: Run command and update heartbeat on output
# Usage: run_with_heartbeat <prd_folder> <command...>
run_with_heartbeat() {
  local prd_folder="$1"
  shift

  # Run command, piping output through heartbeat update
  "$@" | while IFS= read -r line; do
    echo "$line"
    update_heartbeat "$prd_folder"
  done

  return "${PIPESTATUS[0]}"
}

# ============================================================================
# Integration Helpers
# ============================================================================

# Format heartbeat age for display
# Usage: format_heartbeat_age <seconds>
# Returns: Human-readable string like "5m 30s" or "1h 23m"
format_heartbeat_age() {
  local seconds="$1"

  if [[ -z "$seconds" ]]; then
    echo "unknown"
    return
  fi

  local hours=$((seconds / 3600))
  local mins=$(( (seconds % 3600) / 60))
  local secs=$((seconds % 60))

  if [[ "$hours" -gt 0 ]]; then
    echo "${hours}h ${mins}m"
  elif [[ "$mins" -gt 0 ]]; then
    echo "${mins}m ${secs}s"
  else
    echo "${secs}s"
  fi
}

# Get stall status as JSON
# Usage: get_stall_status <prd_folder>
# Returns: JSON object with stall status
get_stall_status() {
  local prd_folder="$1"

  local heartbeat_age
  heartbeat_age=$(get_heartbeat_age "$prd_folder")

  local is_currently_stalled="false"
  if is_stalled "$prd_folder"; then
    is_currently_stalled="true"
  fi

  local has_marker="false"
  if has_stalled_marker "$prd_folder"; then
    has_marker="true"
  fi

  cat <<EOF
{
  "heartbeat_age_seconds": ${heartbeat_age:-null},
  "stall_threshold_seconds": $STALL_THRESHOLD,
  "is_stalled": $is_currently_stalled,
  "has_stalled_marker": $has_marker
}
EOF
}
