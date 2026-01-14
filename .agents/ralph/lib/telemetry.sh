#!/bin/bash
# Telemetry for tracking silent failures (P3.2)
# Source this file to get telemetry logging functions
#
# Functions:
#   log_silent_failure  - Log a failure that was silently suppressed
#   get_telemetry_stats - Get summary statistics from telemetry log
#
# The telemetry log is stored at .ralph/telemetry.log and can be analyzed
# to identify patterns in silent failures that might need attention.

# ============================================================================
# Configuration
# ============================================================================

# Default telemetry log path (can be overridden by sourcing script)
: "${RALPH_DIR:=.ralph}"
: "${TELEMETRY_LOG_PATH:=$RALPH_DIR/telemetry.log}"

# ============================================================================
# Telemetry Functions
# ============================================================================

log_silent_failure() {
  # Log a silent failure for later analysis
  # Usage: log_silent_failure "component" "operation" "context"
  # Example: log_silent_failure "metrics" "append_metrics" "node not available"
  local component="$1"
  local operation="$2"
  local context="${3:-}"

  # Ensure telemetry directory exists
  mkdir -p "$(dirname "$TELEMETRY_LOG_PATH")" 2>/dev/null || return 0

  {
    echo "timestamp=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')"
    echo "component=$component"
    echo "operation=$operation"
    echo "context=$context"
    echo "pid=$$"
    echo "---"
  } >> "$TELEMETRY_LOG_PATH" 2>/dev/null || true
}

get_telemetry_stats() {
  # Get summary statistics from telemetry log
  # Usage: stats=$(get_telemetry_stats)
  # Returns: count by component and operation

  if [ ! -f "$TELEMETRY_LOG_PATH" ]; then
    echo "No telemetry data available"
    return 0
  fi

  echo "=== Silent Failure Telemetry ==="
  echo ""
  echo "Failures by component:"
  grep "^component=" "$TELEMETRY_LOG_PATH" 2>/dev/null | sort | uniq -c | sort -rn
  echo ""
  echo "Failures by operation:"
  grep "^operation=" "$TELEMETRY_LOG_PATH" 2>/dev/null | sort | uniq -c | sort -rn
  echo ""
  echo "Total entries: $(grep -c "^---$" "$TELEMETRY_LOG_PATH" 2>/dev/null || echo 0)"
}

clear_telemetry() {
  # Clear the telemetry log
  # Usage: clear_telemetry
  rm -f "$TELEMETRY_LOG_PATH" 2>/dev/null || true
}
