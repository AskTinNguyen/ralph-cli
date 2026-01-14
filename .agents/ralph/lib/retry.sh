#!/bin/bash
# Shared retry utilities for ralph scripts
# Source this file to get retry/backoff functions
#
# Functions:
#   calculate_backoff_delay - Calculate exponential backoff delay with jitter
#   run_agent_with_retry    - Retry wrapper for agent execution
#
# Configuration variables (with defaults):
#   RETRY_MAX_ATTEMPTS   - Maximum retry attempts (default: 3)
#   RETRY_BASE_DELAY_MS  - Base delay in milliseconds (default: 1000)
#   RETRY_MAX_DELAY_MS   - Maximum delay cap in milliseconds (default: 16000)
#   NO_RETRY             - Disable retries entirely (default: false)
#
# Global variables set by run_agent_with_retry:
#   LAST_RETRY_COUNT      - Number of retries performed
#   LAST_RETRY_TOTAL_TIME - Total time spent waiting for retries (seconds)
#
# Dependencies (must be defined before sourcing):
#   run_agent             - Function to execute the agent
#   log_activity          - Function to log activity messages
#   C_GREEN, C_YELLOW, C_RESET - Color variables from output.sh

# ============================================================================
# Retry Configuration
# ============================================================================
# These can be overridden by the sourcing script or environment variables

RETRY_MAX_ATTEMPTS="${RETRY_MAX_ATTEMPTS:-3}"
RETRY_BASE_DELAY_MS="${RETRY_BASE_DELAY_MS:-1000}"
RETRY_MAX_DELAY_MS="${RETRY_MAX_DELAY_MS:-16000}"
NO_RETRY="${NO_RETRY:-false}"

# ============================================================================
# Global variables for retry statistics
# ============================================================================
# These are set by run_agent_with_retry and used by write_run_meta and append_metrics

LAST_RETRY_COUNT=0
LAST_RETRY_TOTAL_TIME=0

# ============================================================================
# Retry Functions
# ============================================================================

# Calculate exponential backoff delay with jitter
# Usage: delay=$(calculate_backoff_delay <attempt>)
# Returns: delay in seconds as a float (e.g., "2.456")
#
# Algorithm:
#   - Exponential backoff: base_delay * 2^(attempt-1)
#   - Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s, etc.
#   - Capped at max_delay
#   - Random jitter (0-1000ms) added to prevent thundering herd
calculate_backoff_delay() {
  local attempt="$1"
  # Exponential backoff: base_delay * 2^(attempt-1)
  # Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s, etc.
  local base_ms="$RETRY_BASE_DELAY_MS"
  local max_ms="$RETRY_MAX_DELAY_MS"
  local multiplier=$((1 << (attempt - 1)))  # 2^(attempt-1)
  local delay_ms=$((base_ms * multiplier))

  # Cap at max delay
  if [[ "$delay_ms" -gt "$max_ms" ]]; then
    delay_ms="$max_ms"
  fi

  # Add jitter (0-1000ms) to prevent thundering herd
  local jitter_ms=$((RANDOM % 1000))
  delay_ms=$((delay_ms + jitter_ms))

  # Convert to seconds with decimal (bash sleep accepts decimals)
  local delay_sec
  delay_sec=$(printf "%.3f" "$(echo "scale=3; $delay_ms / 1000" | bc)")
  echo "$delay_sec"
}

# Retry wrapper for agent execution
# Usage: run_agent_with_retry <prompt_file> <log_file> <iteration>
# Returns: exit status of agent (0 for success, non-zero for failure)
#
# Behavior:
#   - Runs agent with retries on failure (up to RETRY_MAX_ATTEMPTS)
#   - Uses exponential backoff between retries
#   - Logs retry progress to terminal, activity log, and run log
#   - Does not retry on user interruption (SIGINT/SIGTERM)
#   - Sets LAST_RETRY_COUNT and LAST_RETRY_TOTAL_TIME for metrics
#
# Dependencies:
#   - run_agent: function to execute the agent with a prompt file
#   - log_activity: function to log activity messages
#   - C_GREEN, C_YELLOW, C_RESET: color variables from output.sh
run_agent_with_retry() {
  local prompt_file="$1"
  local log_file="$2"
  local iteration="$3"
  local attempt=1
  local exit_status=0
  local max_attempts="$RETRY_MAX_ATTEMPTS"
  local retry_count=0
  local total_retry_time=0

  # Reset global retry stats
  LAST_RETRY_COUNT=0
  LAST_RETRY_TOTAL_TIME=0

  # If retry is disabled, just run once
  if [[ "$NO_RETRY" = "true" ]]; then
    run_agent "$prompt_file" 2>&1 | tee "$log_file"
    return "${PIPESTATUS[0]}"
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    # Run the agent with tee for logging
    if [[ "$attempt" -eq 1 ]]; then
      # First attempt: create/overwrite log file
      run_agent "$prompt_file" 2>&1 | tee "$log_file"
      exit_status="${PIPESTATUS[0]}"
    else
      # Retry attempts: append retry header and output to log
      {
        echo ""
        echo "=== RETRY ATTEMPT $attempt/$max_attempts ($(date '+%Y-%m-%d %H:%M:%S')) ==="
        echo ""
      } | tee -a "$log_file"
      run_agent "$prompt_file" 2>&1 | tee -a "$log_file"
      exit_status="${PIPESTATUS[0]}"
    fi

    # Success - no retry needed
    if [[ "$exit_status" -eq 0 ]]; then
      if [[ "$retry_count" -gt 0 ]]; then
        log_activity "RETRY_SUCCESS iteration=$iteration succeeded_after=$retry_count retries total_retry_time=${total_retry_time}s"
        printf "${C_GREEN}───────────────────────────────────────────────────────${C_RESET}\n"
        printf "${C_GREEN}  Succeeded after %d retries (total retry wait: %ds)${C_RESET}\n" "$retry_count" "$total_retry_time"
        printf "${C_GREEN}───────────────────────────────────────────────────────${C_RESET}\n"
      fi
      # Set global stats for metrics
      LAST_RETRY_COUNT=$retry_count
      LAST_RETRY_TOTAL_TIME=$total_retry_time
      return 0
    fi

    # User interruption (SIGINT=130, SIGTERM=143) - don't retry
    if [[ "$exit_status" -eq 130 ]] || [[ "$exit_status" -eq 143 ]]; then
      return "$exit_status"
    fi

    retry_count=$((retry_count + 1))

    # Check if we have more attempts
    if [[ "$attempt" -lt "$max_attempts" ]]; then
      local delay
      delay=$(calculate_backoff_delay "$attempt")
      local delay_int="${delay%.*}"  # Integer part for accumulation
      total_retry_time=$((total_retry_time + delay_int))
      local next_attempt=$((attempt + 1))

      # Log retry attempt to terminal with enhanced visibility
      printf "${C_YELLOW}───────────────────────────────────────────────────────${C_RESET}\n"
      printf "${C_YELLOW}  Agent failed (exit code: %d)${C_RESET}\n" "$exit_status"
      printf "${C_YELLOW}  Retry %d/%d in %ss...${C_RESET}\n" "$next_attempt" "$max_attempts" "$delay"
      printf "${C_YELLOW}───────────────────────────────────────────────────────${C_RESET}\n"

      # Log retry to activity log with cumulative stats
      log_activity "RETRY iteration=$iteration attempt=$next_attempt/$max_attempts delay=${delay}s exit_code=$exit_status cumulative_retry_time=${total_retry_time}s"

      # Append retry info to run log
      {
        echo ""
        echo "[RETRY] Attempt $attempt failed with exit code $exit_status"
        echo "[RETRY] Waiting ${delay}s before retry $next_attempt/$max_attempts"
        echo "[RETRY] Cumulative retry wait time: ${total_retry_time}s"
        echo ""
      } >> "$log_file"

      # Wait before retry
      sleep "$delay"
    else
      # All retries exhausted - log final failure
      log_activity "RETRY_EXHAUSTED iteration=$iteration total_attempts=$max_attempts final_exit_code=$exit_status total_retry_time=${total_retry_time}s"
      {
        echo ""
        echo "[RETRY] All $max_attempts attempts exhausted. Final exit code: $exit_status"
        echo "[RETRY] Total retry wait time: ${total_retry_time}s"
      } >> "$log_file"
      # Set global stats even on exhaustion
      LAST_RETRY_COUNT=$retry_count
      LAST_RETRY_TOTAL_TIME=$total_retry_time
    fi

    attempt=$((attempt + 1))
  done

  # All retries exhausted
  return "$exit_status"
}
