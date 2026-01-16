#!/bin/bash
# Watchdog process for auto-recovery (US-010)
# Spawns as separate process to monitor heartbeat and restart stalled builds
# Runs independently of the build loop for crash isolation

# ============================================================================
# Configuration
# ============================================================================

# Check interval for heartbeat (60 seconds)
WATCHDOG_CHECK_INTERVAL="${RALPH_WATCHDOG_CHECK_INTERVAL:-60}"

# Consecutive stall checks before restart (3 checks = ~3 minutes of stall)
WATCHDOG_STALL_THRESHOLD="${RALPH_WATCHDOG_STALL_THRESHOLD:-3}"

# Maximum restarts before escalating to NEEDS_HUMAN
WATCHDOG_MAX_RESTARTS="${RALPH_WATCHDOG_MAX_RESTARTS:-3}"

# Stall threshold in seconds (matches heartbeat.sh default)
STALL_THRESHOLD="${RALPH_STALL_THRESHOLD_SILENT:-1800}"

# ============================================================================
# Watchdog State File
# ============================================================================

# State file format (JSON):
# {
#   "restart_count": 0,
#   "consecutive_stalls": 0,
#   "last_restart_at": null,
#   "status": "monitoring" | "needs_human"
# }

init_watchdog_state() {
  local prd_folder="$1"
  local state_file="$prd_folder/.watchdog.state"

  # Only create if doesn't exist (preserve state across restarts)
  if [[ ! -f "$state_file" ]]; then
    cat > "$state_file" << 'EOF'
{
  "restart_count": 0,
  "consecutive_stalls": 0,
  "last_restart_at": null,
  "status": "monitoring"
}
EOF
  fi
}

get_watchdog_state() {
  local prd_folder="$1"
  local field="$2"
  local state_file="$prd_folder/.watchdog.state"

  if [[ ! -f "$state_file" ]]; then
    echo ""
    return 1
  fi

  # Parse JSON field using python3 or jq
  if command -v python3 &>/dev/null; then
    python3 -c "import json; d=json.load(open('$state_file')); print(d.get('$field', ''))" 2>/dev/null
  elif command -v jq &>/dev/null; then
    jq -r ".$field // empty" "$state_file" 2>/dev/null
  else
    # Fallback: grep-based extraction for simple values
    grep -o "\"$field\": *[^,}]*" "$state_file" | sed 's/.*: *//' | tr -d '"' | head -1
  fi
}

update_watchdog_state() {
  local prd_folder="$1"
  local field="$2"
  local value="$3"
  local state_file="$prd_folder/.watchdog.state"

  if [[ ! -f "$state_file" ]]; then
    init_watchdog_state "$prd_folder"
  fi

  # Update field using python3 or jq
  if command -v python3 &>/dev/null; then
    python3 -c "
import json
with open('$state_file', 'r') as f:
    d = json.load(f)
# Handle numeric vs string values
try:
    d['$field'] = int('$value')
except ValueError:
    if '$value' == 'null':
        d['$field'] = None
    else:
        d['$field'] = '$value'
with open('$state_file', 'w') as f:
    json.dump(d, f, indent=2)
" 2>/dev/null
  elif command -v jq &>/dev/null; then
    local tmp_file="${state_file}.tmp.$$"
    if [[ "$value" =~ ^[0-9]+$ ]]; then
      jq ".$field = $value" "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
    elif [[ "$value" == "null" ]]; then
      jq ".$field = null" "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
    else
      jq ".$field = \"$value\"" "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
    fi
  fi
}

increment_watchdog_state() {
  local prd_folder="$1"
  local field="$2"

  local current
  current=$(get_watchdog_state "$prd_folder" "$field")
  current=${current:-0}
  update_watchdog_state "$prd_folder" "$field" "$((current + 1))"
}

reset_consecutive_stalls() {
  local prd_folder="$1"
  update_watchdog_state "$prd_folder" "consecutive_stalls" "0"
}

clear_watchdog_state() {
  local prd_folder="$1"
  rm -f "$prd_folder/.watchdog.state"
}

# ============================================================================
# Watchdog Logging
# ============================================================================

log_watchdog() {
  local prd_folder="$1"
  local level="$2"
  local message="$3"
  local watchdog_log="$prd_folder/watchdog.log"

  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  echo "[$timestamp] [$level] $message" >> "$watchdog_log"
}

log_watchdog_info() {
  log_watchdog "$1" "INFO" "$2"
}

log_watchdog_warn() {
  log_watchdog "$1" "WARN" "$2"
}

log_watchdog_error() {
  log_watchdog "$1" "ERROR" "$2"
}

# ============================================================================
# Lock File Helpers
# ============================================================================

get_lock_file() {
  local prd_folder="$1"
  local stream_id="${prd_folder##*/}"  # Extract PRD-N from path
  local ralph_dir="${prd_folder%/*}"   # Get .ralph directory
  echo "$ralph_dir/locks/$stream_id.lock"
}

is_lock_present() {
  local lock_file="$1"
  [[ -f "$lock_file" ]]
}

get_lock_pid() {
  local lock_file="$1"
  if [[ -f "$lock_file" ]]; then
    cat "$lock_file" 2>/dev/null
  fi
}

is_build_running() {
  local lock_file="$1"
  if [[ ! -f "$lock_file" ]]; then
    return 1
  fi

  local pid
  pid=$(get_lock_pid "$lock_file")
  if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  return 1
}

# ============================================================================
# Heartbeat Checking
# ============================================================================

get_heartbeat_age() {
  local prd_folder="$1"
  local heartbeat_file="$prd_folder/.heartbeat"

  if [[ ! -f "$heartbeat_file" ]]; then
    echo ""
    return
  fi

  local last_heartbeat
  last_heartbeat=$(cat "$heartbeat_file" 2>/dev/null)

  if [[ -n "$last_heartbeat" ]]; then
    local now
    now=$(date +%s)
    echo $((now - last_heartbeat))
  fi
}

is_stalled() {
  local prd_folder="$1"
  local heartbeat_age
  heartbeat_age=$(get_heartbeat_age "$prd_folder")

  if [[ -z "$heartbeat_age" ]]; then
    # No heartbeat file - can't determine stall
    return 1
  fi

  if [[ "$heartbeat_age" -ge "$STALL_THRESHOLD" ]]; then
    return 0  # Stalled
  fi
  return 1  # Not stalled
}

# ============================================================================
# NEEDS_HUMAN Marker
# ============================================================================

create_needs_human_marker() {
  local prd_folder="$1"
  local reason="$2"
  local marker_file="$prd_folder/.needs_human"

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local restart_count
  restart_count=$(get_watchdog_state "$prd_folder" "restart_count")

  cat > "$marker_file" << EOF
{
  "timestamp": "$timestamp",
  "reason": "$reason",
  "restart_count": ${restart_count:-0},
  "max_restarts": $WATCHDOG_MAX_RESTARTS,
  "message": "Build has stalled $WATCHDOG_MAX_RESTARTS times and requires human intervention"
}
EOF

  # Also log to events.log
  local events_file="$prd_folder/.events.log"
  local event_timestamp
  event_timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$event_timestamp] ERROR NEEDS_HUMAN | reason=$reason restart_count=${restart_count:-0} max_restarts=$WATCHDOG_MAX_RESTARTS" >> "$events_file"
}

has_needs_human_marker() {
  local prd_folder="$1"
  [[ -f "$prd_folder/.needs_human" ]]
}

clear_needs_human_marker() {
  local prd_folder="$1"
  rm -f "$prd_folder/.needs_human"
}

# ============================================================================
# Build Restart Logic
# ============================================================================

restart_build() {
  local prd_folder="$1"
  local build_pid="$2"
  local stream_id="${prd_folder##*/}"
  local stream_num="${stream_id##*PRD-}"

  log_watchdog_warn "$prd_folder" "Initiating build restart for $stream_id (killing PID $build_pid)"

  # Record restart timestamp
  local restart_timestamp
  restart_timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  update_watchdog_state "$prd_folder" "last_restart_at" "$restart_timestamp"

  # Increment restart count
  increment_watchdog_state "$prd_folder" "restart_count"

  # Reset consecutive stalls
  reset_consecutive_stalls "$prd_folder"

  # Kill the stalled build process and its children
  if [[ -n "$build_pid" ]] && kill -0 "$build_pid" 2>/dev/null; then
    log_watchdog_info "$prd_folder" "Killing stalled build process PID $build_pid"

    # Kill process group to get children too
    kill -TERM -- "-$build_pid" 2>/dev/null || kill -TERM "$build_pid" 2>/dev/null

    # Wait for process to die
    sleep 2

    # Force kill if still running
    if kill -0 "$build_pid" 2>/dev/null; then
      log_watchdog_warn "$prd_folder" "Process did not terminate gracefully, sending SIGKILL"
      kill -9 -- "-$build_pid" 2>/dev/null || kill -9 "$build_pid" 2>/dev/null
      sleep 1
    fi
  fi

  # Clean up lock file (allows new build to start)
  local lock_file
  lock_file=$(get_lock_file "$prd_folder")
  rm -f "$lock_file"

  # Clear stalled marker
  rm -f "$prd_folder/.stalled"

  # Find the ralph command and restart the build
  # The build will auto-resume from checkpoint (US-005)
  local ralph_dir="${prd_folder%/.ralph/*}"
  local ralph_cmd=""

  # Look for ralph in common locations
  if [[ -x "$ralph_dir/bin/ralph" ]]; then
    ralph_cmd="$ralph_dir/bin/ralph"
  elif command -v ralph &>/dev/null; then
    ralph_cmd="ralph"
  elif [[ -x "$(dirname "${BASH_SOURCE[0]}")/../../../bin/ralph" ]]; then
    ralph_cmd="$(dirname "${BASH_SOURCE[0]}")/../../../bin/ralph"
  fi

  if [[ -z "$ralph_cmd" ]]; then
    log_watchdog_error "$prd_folder" "Cannot find ralph command to restart build"
    return 1
  fi

  log_watchdog_info "$prd_folder" "Restarting build with: $ralph_cmd stream build $stream_num"

  # Log to events for visibility
  local events_file="$prd_folder/.events.log"
  local event_timestamp
  event_timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  local restart_count
  restart_count=$(get_watchdog_state "$prd_folder" "restart_count")
  echo "[$event_timestamp] WARN Watchdog restart | restart_count=$restart_count max_restarts=$WATCHDOG_MAX_RESTARTS" >> "$events_file"

  # Start new build (detached, in background)
  # Uses non-interactive mode which will auto-resume from checkpoint
  cd "$ralph_dir" || return 1
  nohup "$ralph_cmd" stream build "$stream_num" --force < /dev/null > /dev/null 2>&1 &

  log_watchdog_info "$prd_folder" "New build started (auto-resume enabled)"

  return 0
}

# ============================================================================
# Main Watchdog Loop
# ============================================================================

run_watchdog() {
  local prd_folder="$1"
  local stream_id="${prd_folder##*/}"

  # Write PID to file for tracking
  local watchdog_pid_file="$prd_folder/.watchdog.pid"
  echo $$ > "$watchdog_pid_file"

  # Initialize state
  init_watchdog_state "$prd_folder"

  log_watchdog_info "$prd_folder" "Watchdog started for $stream_id (PID $$)"
  log_watchdog_info "$prd_folder" "Config: check_interval=${WATCHDOG_CHECK_INTERVAL}s stall_threshold=$WATCHDOG_STALL_THRESHOLD max_restarts=$WATCHDOG_MAX_RESTARTS"

  local lock_file
  lock_file=$(get_lock_file "$prd_folder")

  while true; do
    # Check if lock file exists (build is supposed to be running)
    if ! is_lock_present "$lock_file"; then
      log_watchdog_info "$prd_folder" "Lock file disappeared - build completed or was manually stopped"
      break
    fi

    # Check if build process is running
    local build_pid
    build_pid=$(get_lock_pid "$lock_file")

    if ! is_build_running "$lock_file"; then
      log_watchdog_warn "$prd_folder" "Build process (PID $build_pid) is not running but lock exists - cleaning up"
      rm -f "$lock_file"
      break
    fi

    # Check heartbeat
    local heartbeat_age
    heartbeat_age=$(get_heartbeat_age "$prd_folder")

    if is_stalled "$prd_folder"; then
      # Build is stalled - increment consecutive stall count
      increment_watchdog_state "$prd_folder" "consecutive_stalls"

      local consecutive_stalls
      consecutive_stalls=$(get_watchdog_state "$prd_folder" "consecutive_stalls")

      log_watchdog_warn "$prd_folder" "Stall detected: heartbeat_age=${heartbeat_age}s consecutive_stalls=$consecutive_stalls/$WATCHDOG_STALL_THRESHOLD"

      if [[ "$consecutive_stalls" -ge "$WATCHDOG_STALL_THRESHOLD" ]]; then
        # Check if we've exceeded max restarts
        local restart_count
        restart_count=$(get_watchdog_state "$prd_folder" "restart_count")
        restart_count=${restart_count:-0}

        if [[ "$restart_count" -ge "$WATCHDOG_MAX_RESTARTS" ]]; then
          # Escalate to NEEDS_HUMAN
          log_watchdog_error "$prd_folder" "Max restarts ($WATCHDOG_MAX_RESTARTS) exceeded - escalating to NEEDS_HUMAN"
          update_watchdog_state "$prd_folder" "status" "needs_human"
          create_needs_human_marker "$prd_folder" "Max restarts exceeded after repeated stalls"
          break
        fi

        # Attempt restart
        log_watchdog_warn "$prd_folder" "Triggering restart (attempt $((restart_count + 1))/$WATCHDOG_MAX_RESTARTS)"
        restart_build "$prd_folder" "$build_pid"

        # Short sleep to let new build start
        sleep 5
      fi
    else
      # Build is healthy - reset consecutive stalls
      local prev_stalls
      prev_stalls=$(get_watchdog_state "$prd_folder" "consecutive_stalls")
      if [[ "${prev_stalls:-0}" -gt 0 ]]; then
        log_watchdog_info "$prd_folder" "Heartbeat recovered (age=${heartbeat_age}s) - resetting consecutive stalls"
        reset_consecutive_stalls "$prd_folder"
      fi
    fi

    sleep "$WATCHDOG_CHECK_INTERVAL"
  done

  # Cleanup
  log_watchdog_info "$prd_folder" "Watchdog terminating"
  rm -f "$watchdog_pid_file"
}

# ============================================================================
# Watchdog Management Functions (called from stream.sh/loop.sh)
# ============================================================================

start_watchdog() {
  local prd_folder="$1"

  # Don't start if already running
  local watchdog_pid_file="$prd_folder/.watchdog.pid"
  if [[ -f "$watchdog_pid_file" ]]; then
    local existing_pid
    existing_pid=$(cat "$watchdog_pid_file")
    if kill -0 "$existing_pid" 2>/dev/null; then
      return 0  # Already running
    fi
  fi

  # Start watchdog in background
  (run_watchdog "$prd_folder") &

  log_watchdog_info "$prd_folder" "Watchdog spawned in background"
}

stop_watchdog() {
  local prd_folder="$1"
  local watchdog_pid_file="$prd_folder/.watchdog.pid"

  if [[ -f "$watchdog_pid_file" ]]; then
    local pid
    pid=$(cat "$watchdog_pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      log_watchdog_info "$prd_folder" "Watchdog stopped (PID $pid)"
    fi
    rm -f "$watchdog_pid_file"
  fi
}

is_watchdog_running() {
  local prd_folder="$1"
  local watchdog_pid_file="$prd_folder/.watchdog.pid"

  if [[ -f "$watchdog_pid_file" ]]; then
    local pid
    pid=$(cat "$watchdog_pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

get_watchdog_pid() {
  local prd_folder="$1"
  local watchdog_pid_file="$prd_folder/.watchdog.pid"

  if [[ -f "$watchdog_pid_file" ]]; then
    cat "$watchdog_pid_file"
  fi
}

# ============================================================================
# CLI Entry Point
# ============================================================================

# If script is run directly (not sourced), start watchdog for given PRD folder
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  if [[ $# -lt 1 ]]; then
    echo "Usage: watchdog.sh <prd_folder>" >&2
    echo "Example: watchdog.sh /path/to/.ralph/PRD-1" >&2
    exit 1
  fi

  PRD_FOLDER="$1"

  if [[ ! -d "$PRD_FOLDER" ]]; then
    echo "Error: PRD folder does not exist: $PRD_FOLDER" >&2
    exit 1
  fi

  run_watchdog "$PRD_FOLDER"
fi
