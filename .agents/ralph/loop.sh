#!/bin/bash
# Ralph loop — simple, portable, single-agent
# Usage:
#   ./.agents/ralph/loop.sh                 # build mode, default iterations
#   ./.agents/ralph/loop.sh build           # build mode
#   ./.agents/ralph/loop.sh plan            # plan mode (default 1 iteration)
#   ./.agents/ralph/loop.sh plan 3          # plan mode, 3 iterations
#   ./.agents/ralph/loop.sh prd "request"   # generate PRD via agent
#   ./.agents/ralph/loop.sh 10              # build mode, 10 iterations
#   ./.agents/ralph/loop.sh build 1 --no-commit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${RALPH_ROOT:-${SCRIPT_DIR}/../..}" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.sh"

# Source shared output utilities (colors and msg_* functions)
# shellcheck source=lib/output.sh
source "$SCRIPT_DIR/lib/output.sh"

# Source agent utilities (resolve, require, run, experiments)
# shellcheck source=lib/agent.sh
source "$SCRIPT_DIR/lib/agent.sh"

# Source atomic write utilities (prevents race conditions)
# shellcheck source=lib/atomic-write.sh
source "$SCRIPT_DIR/lib/atomic-write.sh"

# Source git utilities (SHA validation, git operations)
# shellcheck source=lib/git-utils.sh
source "$SCRIPT_DIR/lib/git-utils.sh"

# Source telemetry utilities for tracking silent failures (P3.2)
# shellcheck source=lib/telemetry.sh
source "$SCRIPT_DIR/lib/telemetry.sh"

# Source status utilities for real-time visibility (US-001)
# shellcheck source=lib/status.sh
source "$SCRIPT_DIR/lib/status.sh"

# Source event logging utilities for errors, warnings, retries (US-002)
# shellcheck source=lib/events.sh
source "$SCRIPT_DIR/lib/events.sh"

# Source cost tracking utilities for real-time cost accumulation (US-007)
# shellcheck source=lib/cost.sh
source "$SCRIPT_DIR/lib/cost.sh"

# Source budget tracking utilities for cost limits and warnings (US-008)
# shellcheck source=lib/budget.sh
source "$SCRIPT_DIR/lib/budget.sh"

# Source heartbeat and stall detection utilities for production monitoring (US-009)
# shellcheck source=lib/heartbeat.sh
source "$SCRIPT_DIR/lib/heartbeat.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Dependency availability checks for graceful degradation (P2.5)
# These flags allow features to degrade gracefully when deps are missing
# ─────────────────────────────────────────────────────────────────────────────
PYTHON3_AVAILABLE=false
NODE_AVAILABLE=false
GIT_AVAILABLE=false

if command -v python3 >/dev/null 2>&1; then
  PYTHON3_AVAILABLE=true
fi

if command -v node >/dev/null 2>&1; then
  NODE_AVAILABLE=true
fi

if command -v git >/dev/null 2>&1; then
  GIT_AVAILABLE=true
fi

# PRD folder helpers - each plan gets its own PRD-N folder
RALPH_DIR=".ralph"

get_next_prd_number() {
  local max=0
  if [[ -d "$RALPH_DIR" ]]; then
    # Check both PRD-N (new) and prd-N (legacy) folders
    for dir in "$RALPH_DIR"/PRD-* "$RALPH_DIR"/prd-*; do
      if [[ -d "$dir" ]]; then
        local num="${dir##*[Pp][Rr][Dd]-}"
        if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max )); then
          max=$num
        fi
      fi
    done
  fi
  echo $((max + 1))
}

get_latest_prd_number() {
  local max=0
  if [[ -d "$RALPH_DIR" ]]; then
    # Check both PRD-N (new) and prd-N (legacy) folders
    for dir in "$RALPH_DIR"/PRD-* "$RALPH_DIR"/prd-*; do
      if [[ -d "$dir" ]]; then
        local num="${dir##*[Pp][Rr][Dd]-}"
        if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max )); then
          max=$num
        fi
      fi
    done
  fi
  if (( max == 0 )); then
    echo ""
  else
    echo "$max"
  fi
}

get_prd_dir() {
  local num="$1"
  # Check uppercase first (new), then legacy lowercase
  if [[ -d "$RALPH_DIR/PRD-$num" ]]; then
    echo "$RALPH_DIR/PRD-$num"
  elif [[ -d "$RALPH_DIR/prd-$num" ]]; then
    echo "$RALPH_DIR/prd-$num"
  else
    # Default to uppercase for new folders
    echo "$RALPH_DIR/PRD-$num"
  fi
}

# Determine active PRD number from env or auto-detect
if [[ -n "${PRD_NUMBER:-}" ]]; then
  ACTIVE_PRD_NUMBER="$PRD_NUMBER"
elif [[ -n "${PRD_PATH:-}" ]]; then
  # Extract number from path if provided (e.g., .ralph/PRD-1/prd.md -> 1)
  # Handle both PRD-N and prd-N (legacy)
  if [[ "$PRD_PATH" =~ [Pp][Rr][Dd]-([0-9]+) ]]; then
    ACTIVE_PRD_NUMBER="${BASH_REMATCH[1]}"
  else
    ACTIVE_PRD_NUMBER=""
  fi
else
  ACTIVE_PRD_NUMBER=""
fi

# Default paths use PRD-N folder structure
DEFAULT_AGENTS_PATH="AGENTS.md"
DEFAULT_PROMPT_PLAN=".agents/ralph/PROMPT_plan.md"
DEFAULT_PROMPT_BUILD=".agents/ralph/PROMPT_build.md"
DEFAULT_PROMPT_PRD=".agents/ralph/PROMPT_prd.md"
DEFAULT_PROMPT_RETRY=".agents/ralph/PROMPT_retry.md"
DEFAULT_GUARDRAILS_PATH=".ralph/guardrails.md"
DEFAULT_ERRORS_LOG_PATH=".ralph/errors.log"
DEFAULT_ACTIVITY_LOG_PATH=".ralph/activity.log"
DEFAULT_TMP_DIR=".ralph/.tmp"
DEFAULT_RUNS_DIR=".ralph/runs"
DEFAULT_GUARDRAILS_REF=".agents/ralph/references/GUARDRAILS.md"
DEFAULT_CONTEXT_REF=".agents/ralph/references/CONTEXT_ENGINEERING.md"
DEFAULT_ACTIVITY_CMD=".agents/ralph/log-activity.sh"
if [[ -n "${RALPH_ROOT:-}" ]]; then
  agents_path="$RALPH_ROOT/.agents/ralph/agents.sh"
else
  agents_path="$SCRIPT_DIR/agents.sh"
fi
if [[ -f "$agents_path" ]]; then
  # shellcheck source=/dev/null
  source "$agents_path"
fi

DEFAULT_MAX_ITERATIONS=25
DEFAULT_NO_COMMIT=false
PRD_REQUEST_PATH=""
PRD_INLINE=""

# Optional config overrides (simple shell vars)
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
fi

DEFAULT_AGENT_NAME="${DEFAULT_AGENT:-claude}"
# resolve_agent_cmd() now in lib/agent.sh
DEFAULT_AGENT_CMD="$(resolve_agent_cmd "$DEFAULT_AGENT_NAME")"

# ─────────────────────────────────────────────────────────────────────────────
# Experiment Assignment (now in lib/agent.sh)
# ─────────────────────────────────────────────────────────────────────────────
# Global variables for experiment tracking (set by get_experiment_assignment)
# These are declared in lib/agent.sh but referenced here
# EXPERIMENT_NAME, EXPERIMENT_VARIANT, EXPERIMENT_EXCLUDED

# Path resolution with PRD-N folder support
# If explicit paths are set via environment, use them
# Otherwise, use PRD-N folder structure
if [[ -n "${PRD_PATH:-}" ]]; then
  # Explicit path provided - use it as-is
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  # PRD number specified - use that folder
  PRD_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/prd.md"
else
  # No path or number specified - will be set per-mode below
  PRD_PATH=""
fi

if [[ -n "${PLAN_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  PLAN_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/plan.md"
else
  PLAN_PATH=""
fi

if [[ -n "${PROGRESS_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  PROGRESS_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/progress.md"
else
  PROGRESS_PATH=""
fi
AGENTS_PATH="${AGENTS_PATH:-$DEFAULT_AGENTS_PATH}"
PROMPT_PLAN="${PROMPT_PLAN:-$DEFAULT_PROMPT_PLAN}"
PROMPT_BUILD="${PROMPT_BUILD:-$DEFAULT_PROMPT_BUILD}"
PROMPT_PRD="${PROMPT_PRD:-$DEFAULT_PROMPT_PRD}"
PROMPT_RETRY="${PROMPT_RETRY:-$DEFAULT_PROMPT_RETRY}"
GUARDRAILS_PATH="${GUARDRAILS_PATH:-$DEFAULT_GUARDRAILS_PATH}"

# ERRORS_LOG_PATH, ACTIVITY_LOG_PATH, RUNS_DIR should use PRD-N folder when specified
if [[ -n "${ERRORS_LOG_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  ERRORS_LOG_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/errors.log"
else
  ERRORS_LOG_PATH="$DEFAULT_ERRORS_LOG_PATH"
fi

if [[ -n "${ACTIVITY_LOG_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  ACTIVITY_LOG_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/activity.log"
else
  ACTIVITY_LOG_PATH="$DEFAULT_ACTIVITY_LOG_PATH"
fi

TMP_DIR="${TMP_DIR:-$DEFAULT_TMP_DIR}"

if [[ -n "${RUNS_DIR:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  RUNS_DIR="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/runs"
else
  RUNS_DIR="$DEFAULT_RUNS_DIR"
fi
GUARDRAILS_REF="${GUARDRAILS_REF:-$DEFAULT_GUARDRAILS_REF}"
CONTEXT_REF="${CONTEXT_REF:-$DEFAULT_CONTEXT_REF}"
ACTIVITY_CMD="${ACTIVITY_CMD:-$DEFAULT_ACTIVITY_CMD}"
AGENT_CMD="${AGENT_CMD:-$DEFAULT_AGENT_CMD}"
MAX_ITERATIONS="${MAX_ITERATIONS:-$DEFAULT_MAX_ITERATIONS}"
NO_COMMIT="${NO_COMMIT:-$DEFAULT_NO_COMMIT}"

abs_path() {
  local p="$1"
  # Return empty if input is empty
  if [[ -z "$p" ]]; then
    echo ""
  elif [[ "$p" = /* ]]; then
    echo "$p"
  else
    echo "$ROOT_DIR/$p"
  fi
}

# Check if currently in a worktree context (ralph/PRD-N branch)
in_worktree_context() {
  local current_branch
  current_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  [[ "$current_branch" =~ ^ralph/PRD-[0-9]+$ ]]
}

# Show context-aware completion instructions
# Usage: show_completion_instructions <prd_number>
show_completion_instructions() {
  local prd_num="${1:-}"

  if in_worktree_context; then
    # Worktree build completed - manual merge required
    printf "\n${C_YELLOW}╔════════════════════════════════════════════════════════╗${C_RESET}\n"
    printf "${C_YELLOW}║  ⚠️  MANUAL MERGE REQUIRED                             ║${C_RESET}\n"
    printf "${C_YELLOW}╚════════════════════════════════════════════════════════╝${C_RESET}\n"
    printf "\n${C_CYAN}Build completed in isolated worktree branch.${C_RESET}\n"
    printf "${C_DIM}Changes are NOT on main branch yet.${C_RESET}\n\n"

    printf "${C_BOLD}Next Steps:${C_RESET}\n"
    printf "  ${C_GREEN}1.${C_RESET} Review changes:\n"
    printf "     ${C_DIM}git log --oneline${C_RESET}\n"
    printf "     ${C_DIM}git diff main${C_RESET}\n\n"

    printf "  ${C_GREEN}2.${C_RESET} Validate build:\n"
    printf "     ${C_DIM}npm test${C_RESET}  ${C_DIM}# or your test command${C_RESET}\n"
    printf "     ${C_DIM}npm run build${C_RESET}  ${C_DIM}# verify production build${C_RESET}\n\n"

    printf "  ${C_GREEN}3.${C_RESET} Merge to main:\n"
    if [[ -n "$prd_num" ]]; then
      printf "     ${C_CYAN}ralph stream merge ${prd_num}${C_RESET}\n"
    else
      printf "     ${C_CYAN}ralph stream merge N${C_RESET}  ${C_DIM}# replace N with PRD number${C_RESET}\n"
    fi
    printf "     ${C_DIM}(You will be prompted for confirmation)${C_RESET}\n\n"

    printf "${C_DIM}See: CLAUDE.md for full workflow documentation${C_RESET}\n"
    printf "${C_YELLOW}────────────────────────────────────────────────────────${C_RESET}\n\n"
  else
    # Direct-to-main build completed
    printf "\n${C_GREEN}╔════════════════════════════════════════════════════════╗${C_RESET}\n"
    printf "${C_GREEN}║  ✓ BUILD COMPLETE                                      ║${C_RESET}\n"
    printf "${C_GREEN}╚════════════════════════════════════════════════════════╝${C_RESET}\n"
    printf "\n${C_CYAN}All stories committed directly to main branch.${C_RESET}\n"
    printf "${C_DIM}No merge required - changes are already on main.${C_RESET}\n\n"
  fi
}

PRD_PATH="$(abs_path "$PRD_PATH")"
PLAN_PATH="$(abs_path "$PLAN_PATH")"
PROGRESS_PATH="$(abs_path "$PROGRESS_PATH")"
AGENTS_PATH="$(abs_path "$AGENTS_PATH")"
PROMPT_PLAN="$(abs_path "$PROMPT_PLAN")"
PROMPT_BUILD="$(abs_path "$PROMPT_BUILD")"
PROMPT_PRD="$(abs_path "$PROMPT_PRD")"
PROMPT_RETRY="$(abs_path "$PROMPT_RETRY")"
GUARDRAILS_PATH="$(abs_path "$GUARDRAILS_PATH")"
ERRORS_LOG_PATH="$(abs_path "$ERRORS_LOG_PATH")"
ACTIVITY_LOG_PATH="$(abs_path "$ACTIVITY_LOG_PATH")"
TMP_DIR="$(abs_path "$TMP_DIR")"
RUNS_DIR="$(abs_path "$RUNS_DIR")"
GUARDRAILS_REF="$(abs_path "$GUARDRAILS_REF")"
CONTEXT_REF="$(abs_path "$CONTEXT_REF")"
ACTIVITY_CMD="$(abs_path "$ACTIVITY_CMD")"

# ─────────────────────────────────────────────────────────────────────────────
# Agent Functions (now in lib/agent.sh)
# ─────────────────────────────────────────────────────────────────────────────
# require_agent(), run_agent(), run_agent_inline() are now in lib/agent.sh

# ─────────────────────────────────────────────────────────────────────────────
# Retry Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Retry wrapper for agent calls with exponential backoff
# Defaults: 3 retries, 1s base delay, 16s max delay
RETRY_MAX_ATTEMPTS="${RETRY_MAX_ATTEMPTS:-3}"
RETRY_BASE_DELAY_MS="${RETRY_BASE_DELAY_MS:-1000}"
RETRY_MAX_DELAY_MS="${RETRY_MAX_DELAY_MS:-16000}"
NO_RETRY="${NO_RETRY:-false}"

# Calculate exponential backoff delay with jitter
# Usage: calculate_backoff_delay <attempt> -> delay_seconds (float)
calculate_backoff_delay() {
  local attempt="$1"
  # Exponential backoff: base_delay * 2^(attempt-1)
  # Attempt 1: 1s, Attempt 2: 2s, Attempt 3: 4s, etc.
  local base_ms="$RETRY_BASE_DELAY_MS"
  local max_ms="$RETRY_MAX_DELAY_MS"
  local multiplier=$((1 << (attempt - 1)))  # 2^(attempt-1)
  local delay_ms=$((base_ms * multiplier))

  # Cap at max delay
  if [ "$delay_ms" -gt "$max_ms" ]; then
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

# Global variables for retry statistics (set by run_agent_with_retry)
# These are used by write_run_meta and append_metrics
LAST_RETRY_COUNT=0
LAST_RETRY_TOTAL_TIME=0

# Global variables for rollback statistics (set during rollback execution, US-004)
# These are used by append_metrics for tracking rollback events
LAST_ROLLBACK_COUNT=0
LAST_ROLLBACK_REASON=""
LAST_ROLLBACK_SUCCESS=""

# Global variables for agent switch tracking (US-003)
# These are used by write_run_meta to record switches in run summary
LAST_SWITCH_COUNT=0
LAST_SWITCH_FROM=""
LAST_SWITCH_TO=""
LAST_SWITCH_REASON=""

# Global variable to track agents tried during this iteration (US-004)
# Comma-separated list of agent names (e.g., "claude,codex,droid")
AGENTS_TRIED_THIS_ITERATION=""

# Global variable to track retry history for this iteration (P1.4)
# Format: "attempt=N status=S duration=Ds|attempt=N status=S duration=Ds|..."
RETRY_HISTORY_THIS_ITERATION=""

# Global array to track temp files for cleanup (P2.1)
# Using a simple string (space-separated) for bash compatibility
TEMP_FILES_TO_CLEANUP=""

# Function to register a temp file for cleanup (P2.1)
register_temp_file() {
  local file="$1"
  TEMP_FILES_TO_CLEANUP="$TEMP_FILES_TO_CLEANUP $file"
}

# Function to cleanup all registered temp files (P2.1)
cleanup_temp_files() {
  for file in $TEMP_FILES_TO_CLEANUP; do
    rm -f "$file" 2>/dev/null || true
  done
  TEMP_FILES_TO_CLEANUP=""
}

# Tee with heartbeat: writes to stdout and log file while updating heartbeat (US-009)
# Usage: cmd 2>&1 | tee_with_heartbeat <log_file> <append_mode>
# append_mode: "append" to append to log, anything else to overwrite
tee_with_heartbeat() {
  local log_file="$1"
  local append_mode="${2:-}"
  local prd_folder="${PRD_FOLDER:-}"

  if [ "$append_mode" = "append" ]; then
    while IFS= read -r line; do
      echo "$line"
      echo "$line" >> "$log_file"
      # Update heartbeat on every line of output (US-009)
      if [ -n "$prd_folder" ]; then
        update_heartbeat "$prd_folder"
      fi
    done
  else
    # Clear/create log file first
    : > "$log_file"
    while IFS= read -r line; do
      echo "$line"
      echo "$line" >> "$log_file"
      # Update heartbeat on every line of output (US-009)
      if [ -n "$prd_folder" ]; then
        update_heartbeat "$prd_folder"
      fi
    done
  fi
}

# Retry wrapper for agent execution
# Usage: run_agent_with_retry <prompt_file> <log_file> <iteration> -> exit_status
# Handles tee internally and manages retry output to log file
# Sets LAST_RETRY_COUNT and LAST_RETRY_TOTAL_TIME for metrics
# Uses global PRD_FOLDER for event logging (US-002)
# Updates heartbeat on every line of agent output (US-009)
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

  # Initialize heartbeat at start of agent execution (US-009)
  if [ -n "${PRD_FOLDER:-}" ]; then
    update_heartbeat "$PRD_FOLDER"
  fi

  # If retry is disabled, just run once
  if [ "$NO_RETRY" = "true" ]; then
    run_agent "$prompt_file" 2>&1 | tee_with_heartbeat "$log_file"
    return "${PIPESTATUS[0]}"
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    # Run the agent with tee for logging (US-009: includes heartbeat updates)
    if [ "$attempt" -eq 1 ]; then
      # First attempt: create/overwrite log file
      run_agent "$prompt_file" 2>&1 | tee_with_heartbeat "$log_file"
      exit_status="${PIPESTATUS[0]}"
    else
      # Retry attempts: append retry header and output to log
      {
        echo ""
        echo "=== RETRY ATTEMPT $attempt/$max_attempts ($(date '+%Y-%m-%d %H:%M:%S')) ==="
        echo ""
      } >> "$log_file"
      run_agent "$prompt_file" 2>&1 | tee_with_heartbeat "$log_file" "append"
      exit_status="${PIPESTATUS[0]}"
    fi

    # Success - no retry needed
    if [ "$exit_status" -eq 0 ]; then
      if [ "$retry_count" -gt 0 ]; then
        log_activity "RETRY_SUCCESS iteration=$iteration succeeded_after=$retry_count retries total_retry_time=${total_retry_time}s"
        # Log retry success event (US-002)
        if [ -n "${PRD_FOLDER:-}" ]; then
          log_event_info "$PRD_FOLDER" "Retry succeeded" "iteration=$iteration retries=$retry_count total_wait=${total_retry_time}s"
        fi
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
    if [ "$exit_status" -eq 130 ] || [ "$exit_status" -eq 143 ]; then
      return "$exit_status"
    fi

    retry_count=$((retry_count + 1))

    # Check if we have more attempts
    if [ "$attempt" -lt "$max_attempts" ]; then
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

      # Log retry event to .events.log (US-002)
      if [ -n "${PRD_FOLDER:-}" ]; then
        log_event_retry "$PRD_FOLDER" "$next_attempt" "$max_attempts" "${delay}s" "exit_code=$exit_status"
        # Also display the event in CLI (US-002)
        display_event "RETRY" "Retry $next_attempt/$max_attempts (delay: ${delay}s)" "exit_code=$exit_status"
      fi

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

      # Log retry exhausted as error event with context (US-002 + US-004)
      if [ -n "${PRD_FOLDER:-}" ]; then
        local retry_error_context
        retry_error_context=$(extract_error_context "$log_file")
        log_event_error_with_context "$PRD_FOLDER" "All retries exhausted" "exit_code=$exit_status" "$log_file" "$iteration" "${STORY_ID:-}" "${CURRENT_AGENT:-}"
        display_error_with_context "All retries exhausted" "iteration=$iteration attempts=$max_attempts exit_code=$exit_status" "$retry_error_context"
      fi

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

MODE="build"
RESUME_MODE="${RALPH_RESUME:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    plan|build|prd)
      MODE="$1"
      shift
      ;;
    --prompt)
      PRD_REQUEST_PATH="$2"
      shift 2
      ;;
    --no-commit)
      NO_COMMIT=true
      shift
      ;;
    --no-rollback)
      ROLLBACK_ENABLED=false
      shift
      ;;
    --rollback-trigger=*)
      ROLLBACK_TRIGGER="${1#*=}"
      shift
      ;;
    --resume)
      RESUME_MODE="1"
      shift
      ;;
    *)
      if [ "$MODE" = "prd" ]; then
        PRD_INLINE="${PRD_INLINE:+$PRD_INLINE }$1"
        shift
      elif [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
        shift
      else
        msg_error "Unknown arg: $1"
        exit 1
      fi
      ;;
  esac
done
if [ "$MODE" = "plan" ] && [ "$MAX_ITERATIONS" = "$DEFAULT_MAX_ITERATIONS" ]; then
  MAX_ITERATIONS=1
fi

# Set up PRD-N folder paths based on mode
if [ -z "$PRD_PATH" ]; then
  if [ "$MODE" = "prd" ]; then
    # PRD mode: always create a new PRD-N folder
    NEW_PRD_NUM=$(get_next_prd_number)
    ACTIVE_PRD_NUMBER="$NEW_PRD_NUM"
    PRD_DIR="$(get_prd_dir "$NEW_PRD_NUM")"
    PRD_PATH="$PRD_DIR/prd.md"
    PLAN_PATH="$PRD_DIR/plan.md"
    PROGRESS_PATH="$PRD_DIR/progress.md"
    RUNS_DIR="$PRD_DIR/runs"
    ERRORS_LOG_PATH="$PRD_DIR/errors.log"
    ACTIVITY_LOG_PATH="$PRD_DIR/activity.log"
    msg_info "Creating new PRD folder: PRD-$NEW_PRD_NUM"
  else
    # plan/build mode: use latest PRD-N folder
    LATEST_PRD_NUM=$(get_latest_prd_number)
    if [ -z "$LATEST_PRD_NUM" ]; then
      msg_error "No PRD folder found. Run 'ralph prd' first to create one."
      exit 1
    fi
    ACTIVE_PRD_NUMBER="$LATEST_PRD_NUM"
    PRD_DIR="$(get_prd_dir "$LATEST_PRD_NUM")"
    PRD_PATH="$PRD_DIR/prd.md"
    if [ -z "$PLAN_PATH" ]; then
      PLAN_PATH="$PRD_DIR/plan.md"
    fi
    if [ -z "$PROGRESS_PATH" ]; then
      PROGRESS_PATH="$PRD_DIR/progress.md"
    fi
    RUNS_DIR="${RUNS_DIR:-$PRD_DIR/runs}"
    ERRORS_LOG_PATH="${ERRORS_LOG_PATH:-$PRD_DIR/errors.log}"
    ACTIVITY_LOG_PATH="${ACTIVITY_LOG_PATH:-$PRD_DIR/activity.log}"
    msg_info "Using PRD folder: PRD-$LATEST_PRD_NUM"
  fi
fi

PROMPT_FILE="$PROMPT_BUILD"
if [ "$MODE" = "plan" ]; then
  PROMPT_FILE="$PROMPT_PLAN"
fi

if [ "$MODE" = "prd" ]; then
  PRD_USE_INLINE=1
  if [ -z "$PRD_AGENT_CMD" ]; then
    PRD_AGENT_CMD="$AGENT_CMD"
    PRD_USE_INLINE=0
  fi
  if [ "${RALPH_DRY_RUN:-}" != "1" ]; then
    require_agent "$PRD_AGENT_CMD"
  fi

  # Create full PRD-N folder structure
  mkdir -p "$(dirname "$PRD_PATH")" "$TMP_DIR" "$RUNS_DIR"
  touch "$PROGRESS_PATH" "$ERRORS_LOG_PATH" "$ACTIVITY_LOG_PATH" 2>/dev/null || true

  if [ -z "$PRD_REQUEST_PATH" ] && [ -n "$PRD_INLINE" ]; then
    PRD_REQUEST_PATH="$TMP_DIR/prd-request-$(date +%Y%m%d-%H%M%S)-$$.txt"
    printf '%s\n' "$PRD_INLINE" > "$PRD_REQUEST_PATH"
  fi

  if [ -z "$PRD_REQUEST_PATH" ] || [ ! -f "$PRD_REQUEST_PATH" ]; then
    msg_error "PRD request missing. Provide a prompt string or --prompt <file>."
    exit 1
  fi

  if [ "${RALPH_DRY_RUN:-}" = "1" ]; then
    if [ ! -f "$PRD_PATH" ]; then
      {
        echo "# PRD (dry run)"
        echo ""
        echo "_Generated without an agent run._"
      } > "$PRD_PATH"
    fi
    exit 0
  fi

  PRD_PROMPT_FILE="$TMP_DIR/prd-prompt-$(date +%Y%m%d-%H%M%S)-$$.md"
  USER_REQUEST="$(cat "$PRD_REQUEST_PATH")"

  # Use shared PROMPT_prd.md template if available, otherwise use inline prompt
  if [ -f "$PROMPT_PRD" ]; then
    # Render template with variable substitution
    sed -e "s|{{PRD_PATH}}|$PRD_PATH|g" \
        -e "s|{{GUARDRAILS_PATH}}|$GUARDRAILS_PATH|g" \
        -e "s|{{USER_REQUEST}}|$USER_REQUEST|g" \
        "$PROMPT_PRD" > "$PRD_PROMPT_FILE"

    if [ "${PRD_HEADLESS:-}" = "1" ]; then
      # Headless mode: Add instruction to skip clarifying questions
      {
        cat "$PRD_PROMPT_FILE"
        echo ""
        echo "## Mode: Headless"
        echo ""
        echo "IMPORTANT: Do NOT ask clarifying questions. Make reasonable assumptions and document them in the Context section."
      } > "${PRD_PROMPT_FILE}.tmp" && mv "${PRD_PROMPT_FILE}.tmp" "$PRD_PROMPT_FILE"
    else
      # Interactive mode: Add instruction to ask clarifying questions
      {
        cat "$PRD_PROMPT_FILE"
        echo ""
        echo "## Mode: Interactive"
        echo ""
        echo "Before generating the PRD, ask 3-5 essential clarifying questions with lettered options (A, B, C, D)."
        echo "Focus on: Problem/Goal, Core Functionality, Scope/Boundaries, Success Criteria."
        echo "Format questions so user can respond with '1A, 2C, 3B' for quick iteration."
        echo ""
        echo "After creating the PRD, tell the user to run \`ralph plan\` to generate the implementation plan."
      } > "${PRD_PROMPT_FILE}.tmp" && mv "${PRD_PROMPT_FILE}.tmp" "$PRD_PROMPT_FILE"
    fi
  else
    # Fallback: Inline prompt (template not found)
    msg_warn "PRD template not found at $PROMPT_PRD, using inline prompt"
    if [ "${PRD_HEADLESS:-}" = "1" ]; then
      {
        echo "You are an autonomous coding agent."
        echo "Create a Product Requirements Document (PRD) based on the user's description."
        echo "IMPORTANT: Do NOT ask clarifying questions. Make reasonable assumptions."
        echo ""
        echo "Generate a complete PRD with this structure:"
        echo "1. # Product Requirements Document"
        echo "2. ## Overview - What we're building and why"
        echo "3. ## Goals - Primary objectives"
        echo "4. ## User Stories - Use format: ### [ ] US-001: Title"
        echo "   Each story must have: **As a** user, **I want** feature, **So that** benefit"
        echo "   Include #### Acceptance Criteria with checkboxes (3-5 max per story)"
        echo "   Include examples and negative cases"
        echo "   For UI stories, include: Verify in browser using dev-browser skill"
        echo "5. ## Non-Goals - What this will NOT include"
        echo "6. ## Technical Considerations"
        echo "7. ## Success Metrics"
        echo "8. ## Context - Document assumptions made"
        echo ""
        echo "Save the PRD to: $PRD_PATH"
        echo "Do NOT implement anything - only create the PRD document."
        echo ""
        echo "User request:"
        echo "$USER_REQUEST"
      } > "$PRD_PROMPT_FILE"
    else
      {
        echo "You are an autonomous coding agent creating a Product Requirements Document."
        echo ""
        echo "First, ask 3-5 essential clarifying questions with lettered options (A, B, C, D)."
        echo "Focus on: Problem/Goal, Core Functionality, Scope/Boundaries, Success Criteria."
        echo "Format questions so user can respond with '1A, 2C, 3B' for quick iteration."
        echo ""
        echo "Then generate a complete PRD with:"
        echo "- ## Overview"
        echo "- ## Goals"
        echo "- ## User Stories (format: ### [ ] US-001: Title, with 3-5 acceptance criteria each)"
        echo "- ## Non-Goals"
        echo "- ## Technical Considerations"
        echo "- ## Success Metrics"
        echo "- ## Context (document Q&A answers and assumptions)"
        echo ""
        echo "Save the PRD to: $PRD_PATH"
        echo "Do NOT implement anything."
        echo "After creating the PRD, tell the user to run \`ralph plan\`."
        echo ""
        echo "User request:"
        echo "$USER_REQUEST"
      } > "$PRD_PROMPT_FILE"
    fi
  fi

  if [ "$PRD_USE_INLINE" -eq 1 ]; then
    run_agent_inline "$PRD_PROMPT_FILE"
  else
    run_agent "$PRD_PROMPT_FILE"
  fi

  # Validate generated PRD has required sections
  if [ -f "$PRD_PATH" ] && [ -s "$PRD_PATH" ]; then
    PRD_VALID=true
    PRD_WARNINGS=""

    # Check for required sections
    if ! grep -q "## Overview\|## Introduction" "$PRD_PATH" 2>/dev/null; then
      PRD_WARNINGS="${PRD_WARNINGS}\n  - Missing Overview/Introduction section"
      PRD_VALID=false
    fi
    if ! grep -q "### \[ \] US-[0-9]" "$PRD_PATH" 2>/dev/null; then
      PRD_WARNINGS="${PRD_WARNINGS}\n  - Missing or malformed User Stories (expected: ### [ ] US-001: Title)"
      PRD_VALID=false
    fi
    if ! grep -q "## Non-Goals\|## Non Goals" "$PRD_PATH" 2>/dev/null; then
      PRD_WARNINGS="${PRD_WARNINGS}\n  - Missing Non-Goals section"
    fi

    if [ "$PRD_VALID" = "false" ]; then
      msg_warn "PRD validation warnings:$PRD_WARNINGS"
      msg_dim "Consider re-running 'ralph prd' or manually editing $PRD_PATH"
    else
      msg_success "PRD created: $PRD_PATH"
    fi
  fi

  exit 0
fi

if [ "${RALPH_DRY_RUN:-}" != "1" ]; then
  require_agent
fi

if [ ! -f "$PROMPT_FILE" ]; then
  msg_warn "Prompt not found: $PROMPT_FILE"
  exit 1
fi

# Enhanced file validation with better error messages (P3.1)
if [ "$MODE" != "prd" ]; then
  if [ ! -f "$PRD_PATH" ]; then
    msg_error "PRD not found: $PRD_PATH"
    msg_dim "Create it first with: ralph prd"
    exit 1
  elif [ ! -s "$PRD_PATH" ]; then
    msg_error "PRD file is empty: $PRD_PATH"
    msg_dim "Edit the file to add your requirements, then run: ralph plan"
    exit 1
  fi
fi

if [ "$MODE" = "build" ]; then
  if [ ! -f "$PLAN_PATH" ]; then
    msg_error "Plan not found: $PLAN_PATH"
    msg_dim "Create it first with: ralph plan"
    exit 1
  elif [ ! -s "$PLAN_PATH" ]; then
    msg_error "Plan file is empty: $PLAN_PATH"
    msg_dim "Run 'ralph plan' to generate user stories from the PRD"
    exit 1
  fi
fi

mkdir -p "$(dirname "$PROGRESS_PATH")" "$TMP_DIR" "$RUNS_DIR"

if [ ! -f "$PROGRESS_PATH" ]; then
  {
    echo "# Progress Log"
    echo "Started: $(date)"
    echo ""
    echo "## Codebase Patterns"
    echo "- (add reusable patterns here)"
    echo ""
    echo "---"
  } > "$PROGRESS_PATH"
fi

if [ ! -f "$GUARDRAILS_PATH" ]; then
  {
    echo "# Guardrails (Signs)"
    echo ""
    echo "> Lessons learned from failures. Read before acting."
    echo ""
    echo "## Core Signs"
    echo ""
    echo "### Sign: Read Before Writing"
    echo "- **Trigger**: Before modifying any file"
    echo "- **Instruction**: Read the file first"
    echo "- **Added after**: Core principle"
    echo ""
    echo "### Sign: Test Before Commit"
    echo "- **Trigger**: Before committing changes"
    echo "- **Instruction**: Run required tests and verify outputs"
    echo "- **Added after**: Core principle"
    echo ""
    echo "---"
    echo ""
    echo "## Learned Signs"
    echo ""
  } > "$GUARDRAILS_PATH"
fi

if [ ! -f "$ERRORS_LOG_PATH" ]; then
  {
    echo "# Error Log"
    echo ""
    echo "> Failures and repeated issues. Use this to add guardrails."
    echo ""
  } > "$ERRORS_LOG_PATH"
fi

if [ ! -f "$ACTIVITY_LOG_PATH" ]; then
  {
    echo "# Activity Log"
    echo ""
    echo "## Run Summary"
    echo ""
    echo "## Events"
    echo ""
  } > "$ACTIVITY_LOG_PATH"
fi

RUN_TAG="$(date +%Y%m%d-%H%M%S)-$$"

render_prompt() {
  local src="$1"
  local dst="$2"
  local story_meta="$3"
  local story_block="$4"
  local run_id="$5"
  local iter="$6"
  local run_log="$7"
  local run_meta="$8"
  python3 - "$src" "$dst" "$PRD_PATH" "$PLAN_PATH" "$AGENTS_PATH" "$PROGRESS_PATH" "$ROOT_DIR" "$GUARDRAILS_PATH" "$ERRORS_LOG_PATH" "$ACTIVITY_LOG_PATH" "$GUARDRAILS_REF" "$CONTEXT_REF" "$ACTIVITY_CMD" "$NO_COMMIT" "$story_meta" "$story_block" "$run_id" "$iter" "$run_log" "$run_meta" <<'PY'
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
prd, plan, agents, progress, root = sys.argv[3:8]
guardrails = sys.argv[8]
errors_log = sys.argv[9]
activity_log = sys.argv[10]
guardrails_ref = sys.argv[11]
context_ref = sys.argv[12]
activity_cmd = sys.argv[13]
no_commit = sys.argv[14]
meta_path = sys.argv[15] if len(sys.argv) > 15 else ""
block_path = sys.argv[16] if len(sys.argv) > 16 else ""
run_id = sys.argv[17] if len(sys.argv) > 17 else ""
iteration = sys.argv[18] if len(sys.argv) > 18 else ""
run_log = sys.argv[19] if len(sys.argv) > 19 else ""
run_meta = sys.argv[20] if len(sys.argv) > 20 else ""
repl = {
    "PRD_PATH": prd,
    "PLAN_PATH": plan,
    "AGENTS_PATH": agents,
    "PROGRESS_PATH": progress,
    "REPO_ROOT": root,
    "GUARDRAILS_PATH": guardrails,
    "ERRORS_LOG_PATH": errors_log,
    "ACTIVITY_LOG_PATH": activity_log,
    "GUARDRAILS_REF": guardrails_ref,
    "CONTEXT_REF": context_ref,
    "ACTIVITY_CMD": activity_cmd,
    "NO_COMMIT": no_commit,
    "RUN_ID": run_id,
    "ITERATION": iteration,
    "RUN_LOG_PATH": run_log,
    "RUN_META_PATH": run_meta,
}
story = {"id": "", "title": "", "block": ""}
if meta_path:
    try:
        import json
        meta = json.loads(Path(meta_path).read_text())
        story["id"] = meta.get("id", "") or ""
        story["title"] = meta.get("title", "") or ""
    except Exception:
        pass
if block_path and Path(block_path).exists():
    story["block"] = Path(block_path).read_text()
repl["STORY_ID"] = story["id"]
repl["STORY_TITLE"] = story["title"]
repl["STORY_BLOCK"] = story["block"]
for k, v in repl.items():
    src = src.replace("{{" + k + "}}", v)
Path(sys.argv[2]).write_text(src)
PY
}

# Render retry prompt with failure context variables (US-002)
# Usage: render_retry_prompt <src> <dst> <story_meta> <story_block> <run_id> <iter> <run_log> <run_meta> \
#                            <failure_context_file> <retry_attempt> <retry_max>
render_retry_prompt() {
  local src="$1"
  local dst="$2"
  local story_meta="$3"
  local story_block="$4"
  local run_id="$5"
  local iter="$6"
  local run_log="$7"
  local run_meta="$8"
  local failure_context_file="${9:-}"
  local retry_attempt="${10:-1}"
  local retry_max="${11:-3}"
  python3 - "$src" "$dst" "$PRD_PATH" "$PLAN_PATH" "$AGENTS_PATH" "$PROGRESS_PATH" "$ROOT_DIR" "$GUARDRAILS_PATH" "$ERRORS_LOG_PATH" "$ACTIVITY_LOG_PATH" "$GUARDRAILS_REF" "$CONTEXT_REF" "$ACTIVITY_CMD" "$NO_COMMIT" "$story_meta" "$story_block" "$run_id" "$iter" "$run_log" "$run_meta" "$failure_context_file" "$retry_attempt" "$retry_max" <<'PY'
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
prd, plan, agents, progress, root = sys.argv[3:8]
guardrails = sys.argv[8]
errors_log = sys.argv[9]
activity_log = sys.argv[10]
guardrails_ref = sys.argv[11]
context_ref = sys.argv[12]
activity_cmd = sys.argv[13]
no_commit = sys.argv[14]
meta_path = sys.argv[15] if len(sys.argv) > 15 else ""
block_path = sys.argv[16] if len(sys.argv) > 16 else ""
run_id = sys.argv[17] if len(sys.argv) > 17 else ""
iteration = sys.argv[18] if len(sys.argv) > 18 else ""
run_log = sys.argv[19] if len(sys.argv) > 19 else ""
run_meta = sys.argv[20] if len(sys.argv) > 20 else ""
failure_context_file = sys.argv[21] if len(sys.argv) > 21 else ""
retry_attempt = sys.argv[22] if len(sys.argv) > 22 else "1"
retry_max = sys.argv[23] if len(sys.argv) > 23 else "3"

def analyze_previous_approach(context):
    """Analyze what the previous approach tried based on failure context."""
    if not context:
        return "No previous failure context available."

    lines = context.split('\n')
    analysis = []

    # Look for common patterns
    for line in lines:
        line_lower = line.lower()
        if 'import' in line_lower and ('error' in line_lower or 'fail' in line_lower):
            analysis.append("- Import statements may have issues")
        if 'route' in line_lower and ('not found' in line_lower or '404' in line_lower):
            analysis.append("- Route registration may be missing")
        if 'expect' in line_lower and 'received' in line_lower:
            analysis.append("- Test assertions did not match expected values")
        if 'undefined' in line_lower or 'null' in line_lower:
            analysis.append("- Some variables or properties were undefined/null")
        if 'type' in line_lower and 'error' in line_lower:
            analysis.append("- Type mismatches were detected")

    if not analysis:
        analysis.append("- Review the full log for specific failure details")

    return '\n'.join(list(set(analysis))[:5])  # Dedupe and limit to 5

def suggest_alternatives(context):
    """Suggest alternative approaches based on failure patterns."""
    if not context:
        return "- Try a simpler approach first\n- Double-check the requirements"

    context_lower = context.lower()
    suggestions = []

    # Pattern-based suggestions
    if 'import' in context_lower and ('error' in context_lower or 'module' in context_lower):
        suggestions.append("- Verify all import paths are correct and modules exist")
        suggestions.append("- Check for circular dependencies")

    if 'route' in context_lower or '404' in context_lower:
        suggestions.append("- Ensure the route is registered in the router/app")
        suggestions.append("- Check route path spelling and parameters")

    if 'expect' in context_lower or 'assert' in context_lower:
        suggestions.append("- Match the expected output format exactly")
        suggestions.append("- Check data types (string vs number, etc.)")

    if 'undefined' in context_lower or 'null' in context_lower:
        suggestions.append("- Add null checks and default values")
        suggestions.append("- Verify object properties exist before accessing")

    if 'timeout' in context_lower:
        suggestions.append("- Reduce operation complexity or add pagination")
        suggestions.append("- Check for infinite loops or blocking operations")

    if 'permission' in context_lower or 'access' in context_lower:
        suggestions.append("- Check file/directory permissions")
        suggestions.append("- Verify authentication/authorization is set up")

    if 'syntax' in context_lower:
        suggestions.append("- Check for missing brackets, semicolons, or quotes")
        suggestions.append("- Validate JSON/YAML/config file formats")

    if not suggestions:
        suggestions.append("- Read the failing test/verification command carefully")
        suggestions.append("- Check if dependencies are installed")
        suggestions.append("- Try a more incremental approach")

    return '\n'.join(suggestions[:4])  # Limit to 4 suggestions

# Read failure context from file
failure_context = ""
if failure_context_file and Path(failure_context_file).exists():
    failure_context = Path(failure_context_file).read_text()

# Analyze previous approach from failure context
previous_approach = analyze_previous_approach(failure_context)

# Generate suggestions based on failure patterns
suggestions = suggest_alternatives(failure_context)

repl = {
    "PRD_PATH": prd,
    "PLAN_PATH": plan,
    "AGENTS_PATH": agents,
    "PROGRESS_PATH": progress,
    "REPO_ROOT": root,
    "GUARDRAILS_PATH": guardrails,
    "ERRORS_LOG_PATH": errors_log,
    "ACTIVITY_LOG_PATH": activity_log,
    "GUARDRAILS_REF": guardrails_ref,
    "CONTEXT_REF": context_ref,
    "ACTIVITY_CMD": activity_cmd,
    "NO_COMMIT": no_commit,
    "RUN_ID": run_id,
    "ITERATION": iteration,
    "RUN_LOG_PATH": run_log,
    "RUN_META_PATH": run_meta,
    "FAILURE_CONTEXT": failure_context,
    "PREVIOUS_APPROACH": previous_approach,
    "SUGGESTIONS": suggestions,
    "RETRY_ATTEMPT": retry_attempt,
    "RETRY_MAX": retry_max,
}
story = {"id": "", "title": "", "block": ""}
if meta_path:
    try:
        import json
        meta = json.loads(Path(meta_path).read_text())
        story["id"] = meta.get("id", "") or ""
        story["title"] = meta.get("title", "") or ""
    except Exception:
        pass
if block_path and Path(block_path).exists():
    story["block"] = Path(block_path).read_text()
repl["STORY_ID"] = story["id"]
repl["STORY_TITLE"] = story["title"]
repl["STORY_BLOCK"] = story["block"]
for k, v in repl.items():
    src = src.replace("{{" + k + "}}", v)
Path(sys.argv[2]).write_text(src)
PY
}

select_story() {
  local meta_out="$1"
  local block_out="$2"
  python3 - "$PRD_PATH" "$meta_out" "$block_out" <<'PY'
import json
import re
import sys
from pathlib import Path

prd_path = Path(sys.argv[1])
meta_out = Path(sys.argv[2])
block_out = Path(sys.argv[3])

text = prd_path.read_text().splitlines()
pattern = re.compile(r'^###\s+(\[(?P<status>[ xX])\]\s+)?(?P<id>US-\d+):\s*(?P<title>.+)$')

stories = []
current = None
for line in text:
    m = pattern.match(line)
    if m:
        if current:
            stories.append(current)
        current = {
            "id": m.group("id"),
            "title": m.group("title").strip(),
            "status": (m.group("status") or " "),
            "lines": [line],
        }
    elif current is not None:
        current["lines"].append(line)
if current:
    stories.append(current)

if not stories:
    meta_out.write_text(json.dumps({"ok": False, "error": "No stories found in PRD"}, indent=2) + "\n")
    block_out.write_text("")
    sys.exit(0)

def is_done(story):
    return str(story.get("status", "")).strip().lower() == "x"

remaining = [s for s in stories if not is_done(s)]
meta = {"ok": True, "total": len(stories), "remaining": len(remaining)}

if remaining:
    target = remaining[0]
    meta.update({
        "id": target["id"],
        "title": target["title"],
    })
    block_out.write_text("\n".join(target["lines"]))
else:
    block_out.write_text("")

meta_out.write_text(json.dumps(meta, indent=2) + "\n")
PY
}

remaining_stories() {
  local meta_file="$1"
  python3 - "$meta_file" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
print(data.get("remaining", "unknown"))
PY
}

story_field() {
  local meta_file="$1"
  local field="$2"
  python3 - "$meta_file" "$field" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
field = sys.argv[2]
print(data.get(field, ""))
PY
}

# ─────────────────────────────────────────────────────────────────────────────
# Story Selection Locking (P1.3)
# Prevents parallel builds from picking the same story
# ─────────────────────────────────────────────────────────────────────────────

acquire_story_lock() {
  # Acquire lock for story selection to prevent parallel builds picking same story
  # Usage: if acquire_story_lock "$prd_folder"; then select_story; release_story_lock; fi
  # Returns: 0 on success, 1 on timeout
  local prd_folder="$1"
  local lock_dir="$prd_folder/.story-selection.lock"
  local max_wait="${2:-30}"
  local waited=0

  while [ $waited -lt $max_wait ]; do
    if mkdir "$lock_dir" 2>/dev/null; then
      echo $$ > "$lock_dir/pid"
      return 0
    fi

    # Check if lock is stale (holding process died)
    if [ -f "$lock_dir/pid" ]; then
      local pid
      pid=$(cat "$lock_dir/pid" 2>/dev/null || echo "")
      if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then
        # Process died, clean up stale lock
        rm -rf "$lock_dir" 2>/dev/null || true
        continue
      fi
    fi

    sleep 1
    waited=$((waited + 1))
  done

  msg_error "Timeout waiting for story selection lock after ${max_wait}s"
  return 1
}

release_story_lock() {
  # Release story selection lock
  # Usage: release_story_lock "$prd_folder"
  local prd_folder="$1"
  local lock_dir="$prd_folder/.story-selection.lock"

  rm -rf "$lock_dir" 2>/dev/null || true
}

# Wrapper for select_story with locking (P1.3)
select_story_locked() {
  # Thread-safe story selection for parallel builds
  # Usage: select_story_locked "$prd_folder" "$meta_out" "$block_out"
  local prd_folder="$1"
  local meta_out="$2"
  local block_out="$3"

  if acquire_story_lock "$prd_folder"; then
    select_story "$meta_out" "$block_out"
    release_story_lock "$prd_folder"
    return 0
  else
    return 1
  fi
}

log_activity() {
  local message="$1"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $message" >> "$ACTIVITY_LOG_PATH"
}

log_error() {
  local message="$1"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $message" >> "$ERRORS_LOG_PATH"
}

# Save checkpoint before story execution for resumable builds
# Usage: save_checkpoint <prd-folder> <prd-id> <iteration> <story-id> <git-sha> [agent] [total-cost]
save_checkpoint() {
  local prd_folder="$1"
  local prd_id="$2"
  local iteration="$3"
  local story_id="$4"
  local git_sha="$5"
  local agent="${6:-codex}"
  local total_cost="${7:-0}"

  local checkpoint_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    checkpoint_cli="$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    checkpoint_cli="$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi

  # Check if checkpoint CLI exists
  if [ ! -f "$checkpoint_cli" ] || ! command -v node >/dev/null 2>&1; then
    msg_dim "Checkpoint CLI not available, skipping checkpoint save"
    return 0
  fi

  # Build JSON data with cost tracking (US-007)
  local json_data
  json_data=$(printf '{"prd_id":%s,"iteration":%s,"story_id":"%s","git_sha":"%s","loop_state":{"agent":"%s","total_cost":%s}}' \
    "$prd_id" "$iteration" "$story_id" "$git_sha" "$agent" "${total_cost:-0}")

  # Save checkpoint via CLI
  if node "$checkpoint_cli" save "$prd_folder" "$json_data" >/dev/null 2>&1; then
    msg_dim "Checkpoint saved: iteration=$iteration story=$story_id"
    return 0
  else
    msg_warn "Failed to save checkpoint"
    return 1
  fi
}

# Clear checkpoint from PRD folder (called on successful completion)
# Usage: clear_checkpoint <prd-folder>
clear_checkpoint() {
  local prd_folder="$1"

  local checkpoint_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    checkpoint_cli="$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    checkpoint_cli="$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi

  # Check if checkpoint CLI exists
  if [ ! -f "$checkpoint_cli" ] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  # Clear checkpoint via CLI (silent - don't warn on failure)
  if node "$checkpoint_cli" clear "$prd_folder" >/dev/null 2>&1; then
    msg_dim "Checkpoint cleared (build complete)"
    return 0
  else
    return 1
  fi
}

# Load checkpoint from PRD folder for resumable builds
# Returns: Sets CHECKPOINT_ITERATION, CHECKPOINT_STORY_ID, CHECKPOINT_GIT_SHA
# Exit code: 0 if checkpoint loaded, 1 if not found or error
load_checkpoint() {
  local prd_folder="$1"

  local checkpoint_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    checkpoint_cli="$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    checkpoint_cli="$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi

  # Check if checkpoint CLI exists
  if [ ! -f "$checkpoint_cli" ] || ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  # Load checkpoint via CLI
  local output
  output=$(node "$checkpoint_cli" load "$prd_folder" 2>/dev/null)
  local status=$?

  if [ $status -ne 0 ]; then
    return 1
  fi

  # Parse JSON output using Python (more reliable than bash parsing)
  CHECKPOINT_ITERATION=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('iteration', ''))" 2>/dev/null)
  CHECKPOINT_STORY_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('story_id', ''))" 2>/dev/null)
  CHECKPOINT_GIT_SHA=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('git_sha', ''))" 2>/dev/null)
  CHECKPOINT_AGENT=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('loop_state', {}).get('agent', 'codex'))" 2>/dev/null)

  if [ -n "$CHECKPOINT_ITERATION" ]; then
    return 0
  else
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Rollback Functions (US-001: Automatic Rollback on Test Failure)
# ─────────────────────────────────────────────────────────────────────────────

# Detect test failures in build output
# Returns: 0 if test failure detected, 1 if no test failure
# Usage: detect_test_failure <log_file>
detect_test_failure() {
  local log_file="$1"

  if [ ! -f "$log_file" ]; then
    return 1
  fi

  # Common test failure patterns across various frameworks
  # Jest: "Tests: X failed"
  # Mocha: "X failing"
  # Pytest: "X failed"
  # npm test: "npm ERR!" with test context
  # Go test: "FAIL" or "--- FAIL:"
  # Vitest: "Tests: X failed"
  # Bun test: "X fail"
  local patterns=(
    "Tests:.*[0-9]+ failed"           # Jest, Vitest
    "[0-9]+ failing"                   # Mocha
    "FAILED.*test"                     # Pytest
    "^FAIL\t"                          # Go test (FAIL<tab>package)
    "--- FAIL:"                        # Go test detailed
    "npm ERR!.*test"                   # npm test failure
    "test.*failed"                     # Generic test failure
    "AssertionError"                   # Node.js assertion
    "Error: expect"                    # Jest/Vitest expect failure
    "✗.*test"                          # Various test runners
    "[0-9]+ test.*fail"                # Bun and others
    "FAIL.*\\.test\\."                 # Test file failure patterns
    "FAIL.*\\.spec\\."                 # Spec file failure patterns
    "exit status [1-9]"                # Go test exit status
  )

  for pattern in "${patterns[@]}"; do
    if grep -qiE "$pattern" "$log_file" 2>/dev/null; then
      return 0  # Test failure detected
    fi
  done

  return 1  # No test failure detected
}

# Detect lint failures in build output (US-003)
# Returns: 0 if lint failure detected, 1 if no lint failure
# Usage: detect_lint_failure <log_file>
detect_lint_failure() {
  local log_file="$1"

  if [ ! -f "$log_file" ]; then
    return 1
  fi

  # Common lint failure patterns across various linters
  local patterns=(
    "error.*eslint"                    # ESLint
    "eslint.*error"                    # ESLint (alternate order)
    "[0-9]+ error"                     # ESLint summary
    "prettier.*failed"                 # Prettier
    "prettier.*check.*failed"          # Prettier check mode
    "ruff.*error"                      # Ruff (Python)
    "pylint.*error"                    # Pylint
    "flake8.*error"                    # Flake8
    "rubocop.*offense"                 # RuboCop (Ruby)
    "stylelint.*error"                 # Stylelint (CSS)
    "golangci-lint.*error"             # golangci-lint (Go)
    "lint.*failed"                     # Generic lint failure
    "linting.*failed"                  # Generic linting failure
    "Linting errors"                   # Generic linting errors
  )

  for pattern in "${patterns[@]}"; do
    if grep -qiE "$pattern" "$log_file" 2>/dev/null; then
      return 0  # Lint failure detected
    fi
  done

  return 1  # No lint failure detected
}

# Detect type check failures in build output (US-003)
# Returns: 0 if type failure detected, 1 if no type failure
# Usage: detect_type_failure <log_file>
detect_type_failure() {
  local log_file="$1"

  if [ ! -f "$log_file" ]; then
    return 1
  fi

  # Common type check failure patterns
  local patterns=(
    "error TS[0-9]+"                   # TypeScript errors
    "tsc.*error"                       # TypeScript compiler
    "Type.*is not assignable"          # TypeScript type error
    "Cannot find module"               # TypeScript/JavaScript import error
    "Cannot find name"                 # TypeScript undefined error
    "mypy.*error"                      # mypy (Python)
    "pyright.*error"                   # Pyright (Python)
    "type.*mismatch"                   # Generic type mismatch
    "incompatible type"                # Generic incompatible type
    "error\\[E[0-9]+"                  # Rust compiler errors
    "flow.*error"                      # Flow (JavaScript)
  )

  for pattern in "${patterns[@]}"; do
    if grep -qiE "$pattern" "$log_file" 2>/dev/null; then
      return 0  # Type failure detected
    fi
  done

  return 1  # No type failure detected
}

# Unified failure detection based on ROLLBACK_TRIGGER config (US-003)
# Returns: 0 if relevant failure detected (based on config), 1 otherwise
# Usage: detect_failure <log_file> <trigger_policy>
detect_failure() {
  local log_file="$1"
  local trigger_policy="${2:-test-fail}"

  if [ ! -f "$log_file" ]; then
    return 1
  fi

  case "$trigger_policy" in
    test-fail)
      detect_test_failure "$log_file"
      return $?
      ;;
    lint-fail)
      detect_lint_failure "$log_file"
      return $?
      ;;
    type-fail)
      detect_type_failure "$log_file"
      return $?
      ;;
    any-fail)
      # any-fail triggers on any non-zero exit, no log analysis needed
      # The caller already checks CMD_STATUS != 0, so we always return 0 here
      return 0
      ;;
    *)
      # Unknown trigger policy, fall back to test-fail
      detect_test_failure "$log_file"
      return $?
      ;;
  esac
}

# Check if story has rollback disabled via <!-- no-rollback --> comment (US-003)
# Returns: 0 if rollback should be skipped, 1 if rollback is allowed
# Usage: story_has_no_rollback <story_block_file>
story_has_no_rollback() {
  local story_block_file="$1"

  if [ -z "$story_block_file" ]; then
    return 1  # No file, allow rollback
  fi

  if [ ! -f "$story_block_file" ]; then
    return 1  # File doesn't exist, allow rollback
  fi

  # Check for <!-- no-rollback --> comment in story block file
  if grep -qiE "<!--[[:space:]]*no-rollback[[:space:]]*-->" "$story_block_file" 2>/dev/null; then
    return 0  # Rollback disabled for this story
  fi

  return 1  # Rollback is allowed
}

# Rollback to a git checkpoint (pre-story state)
# Usage: rollback_to_checkpoint <target_sha> <story_id> <reason>
# Returns: 0 on success, 1 on failure
rollback_to_checkpoint() {
  local target_sha="$1"
  local story_id="$2"
  local reason="${3:-test_failure}"

  if [ -z "$target_sha" ]; then
    log_error "ROLLBACK failed: no target SHA provided"
    return 1
  fi

  # Fix P0.4: Validate SHA format and existence before attempting rollback
  if ! is_valid_sha "$target_sha"; then
    log_error "ROLLBACK failed: invalid SHA format: $target_sha"
    return 1
  fi

  if ! git_sha_exists "$target_sha"; then
    log_error "ROLLBACK failed: SHA does not exist in repository: $target_sha"
    return 1
  fi

  local current_sha
  current_sha=$(git_head)

  # Check if we're already at target SHA
  if [ "$current_sha" = "$target_sha" ]; then
    msg_dim "Already at target SHA, no rollback needed"
    return 0
  fi

  # Stash any uncommitted changes to preserve them
  local stash_output
  stash_output=$(git stash push -m "ralph-rollback-$story_id-$(date +%s)" 2>&1)
  local has_stash=false
  local stash_ref=""
  if ! echo "$stash_output" | grep -q "No local changes"; then
    has_stash=true
    # Fix P1.1: Track specific stash ref for cleanup
    stash_ref=$(git rev-parse stash@{0} 2>/dev/null || echo "")
    msg_dim "Stashed uncommitted changes before rollback"
  fi

  # Perform the rollback using git reset
  if ! git reset --hard "$target_sha" >/dev/null 2>&1; then
    log_error "ROLLBACK failed: git reset --hard $target_sha failed"
    # Attempt to restore stash if we made one
    if [ "$has_stash" = "true" ]; then
      git stash pop >/dev/null 2>&1 || true
    fi
    return 1
  fi

  # Fix P1.1: Clean up stash after successful rollback
  if [ "$has_stash" = "true" ] && [ -n "$stash_ref" ]; then
    # Drop the specific stash we created
    if git stash drop "$stash_ref" >/dev/null 2>&1; then
      log_activity "ROLLBACK_STASH_CLEANED ref=${stash_ref:0:8}"
      msg_dim "Cleaned up rollback stash"
    fi
  fi

  # Log the rollback
  log_activity "ROLLBACK story=$story_id reason=$reason from=${current_sha:0:8} to=${target_sha:0:8}"

  return 0
}

# Save failure context for retry (preserves error information)
# Usage: save_failure_context <log_file> <runs_dir> <run_tag> <iteration> <story_id>
save_failure_context() {
  local log_file="$1"
  local runs_dir="$2"
  local run_tag="$3"
  local iteration="$4"
  local story_id="$5"

  local context_file="$runs_dir/failure-context-$run_tag-iter-$iteration.log"

  {
    echo "# Failure Context"
    echo "# Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "# Story: $story_id"
    echo "# Run: $run_tag (iteration $iteration)"
    echo ""
    echo "## Test Output"
    echo ""

    if [ -f "$log_file" ]; then
      # Extract relevant error/test failure sections
      # Look for test output, assertion failures, stack traces
      grep -iE "(FAIL|ERROR|test.*fail|AssertionError|expect|✗|failing|failed)" "$log_file" 2>/dev/null | head -100 || true
      echo ""
      echo "## Full Log Tail (last 50 lines)"
      echo ""
      tail -50 "$log_file" 2>/dev/null || true
    else
      echo "(Log file not found: $log_file)"
    fi
  } > "$context_file"

  echo "$context_file"
}

# Display rollback notification to user
# Usage: notify_rollback <story_id> <reason> <target_sha> <context_file>
notify_rollback() {
  local story_id="$1"
  local reason="$2"
  local target_sha="$3"
  local context_file="${4:-}"

  printf "\n"
  printf "${C_YELLOW}${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_YELLOW}${C_BOLD}║              ROLLBACK TRIGGERED                       ║${C_RESET}\n"
  printf "${C_YELLOW}${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
  printf "\n"
  printf "  ${C_BOLD}Story:${C_RESET}  %s\n" "$story_id"
  printf "  ${C_BOLD}Reason:${C_RESET} %s\n" "$reason"
  printf "  ${C_BOLD}Rolled back to:${C_RESET} %s\n" "${target_sha:0:8}"
  if [ -n "$context_file" ] && [ -f "$context_file" ]; then
    printf "  ${C_BOLD}Error context:${C_RESET} %s\n" "$context_file"
  fi
  printf "\n"
  printf "${C_DIM}  The codebase has been restored to its pre-story state.${C_RESET}\n"
  printf "${C_DIM}  Review the error context for the next attempt.${C_RESET}\n"
  printf "\n"
}

# Log rollback event to a dedicated rollback history log (US-004)
# Provides structured logging for rollback analysis and statistics
# Usage: log_rollback <story_id> <reason> <from_sha> <to_sha> <attempt> <success> [context_file]
log_rollback() {
  local story_id="$1"
  local reason="$2"
  local from_sha="$3"
  local to_sha="$4"
  local attempt="${5:-1}"
  local success="${6:-true}"
  local context_file="${7:-}"

  local timestamp
  timestamp=$(date '+%Y-%m-%dT%H:%M:%SZ')

  # Log to activity log with structured format
  log_activity "ROLLBACK_EVENT story=$story_id reason=$reason from=${from_sha:0:8} to=${to_sha:0:8} attempt=$attempt success=$success"

  # Log to dedicated rollback history file (append-only JSONL format)
  local rollback_log="${PRD_FOLDER:-$RALPH_DIR}/runs/rollback-history.jsonl"
  local runs_dir
  runs_dir="$(dirname "$rollback_log")"

  # Create runs directory if needed
  if [ ! -d "$runs_dir" ]; then
    mkdir -p "$runs_dir"
  fi

  # Build JSON record (escape special characters)
  local escaped_reason
  escaped_reason=$(printf '%s' "$reason" | sed 's/"/\\"/g')

  local json_record
  json_record=$(printf '{"timestamp":"%s","storyId":"%s","reason":"%s","fromSha":"%s","toSha":"%s","attempt":%d,"success":%s,"runId":"%s","contextFile":"%s"}' \
    "$timestamp" \
    "$story_id" \
    "$escaped_reason" \
    "${from_sha:0:8}" \
    "${to_sha:0:8}" \
    "$attempt" \
    "$success" \
    "${RUN_TAG:-unknown}" \
    "${context_file:-}")

  echo "$json_record" >> "$rollback_log"
}

# Get rollback statistics from rollback history (US-004)
# Usage: get_rollback_stats [prd_folder]
# Returns: JSON with rollback statistics
get_rollback_stats() {
  local prd_folder="${1:-$PRD_FOLDER}"
  local rollback_log="$prd_folder/runs/rollback-history.jsonl"

  if [ ! -f "$rollback_log" ]; then
    echo '{"total":0,"successful":0,"failed":0,"successRate":0,"byReason":{},"byStory":{}}'
    return 0
  fi

  # Use Node.js for JSON aggregation if available, otherwise use shell
  if command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const lines = fs.readFileSync('$rollback_log', 'utf-8').split('\\n').filter(l => l.trim());
const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const stats = {
  total: records.length,
  successful: records.filter(r => r.success === true || r.success === 'true').length,
  failed: records.filter(r => r.success === false || r.success === 'false').length,
  successRate: 0,
  avgAttempts: 0,
  byReason: {},
  byStory: {}
};

stats.successRate = stats.total > 0 ? Math.round((stats.successful / stats.total) * 100) : 0;

// Calculate average attempts
const totalAttempts = records.reduce((sum, r) => sum + (r.attempt || 1), 0);
stats.avgAttempts = stats.total > 0 ? Math.round((totalAttempts / stats.total) * 100) / 100 : 0;

// Group by reason
for (const r of records) {
  const reason = r.reason || 'unknown';
  if (!stats.byReason[reason]) stats.byReason[reason] = { count: 0, successful: 0 };
  stats.byReason[reason].count++;
  if (r.success === true || r.success === 'true') stats.byReason[reason].successful++;
}

// Group by story
for (const r of records) {
  const story = r.storyId || 'unknown';
  if (!stats.byStory[story]) stats.byStory[story] = { rollbacks: 0, maxAttempts: 0 };
  stats.byStory[story].rollbacks++;
  stats.byStory[story].maxAttempts = Math.max(stats.byStory[story].maxAttempts, r.attempt || 1);
}

console.log(JSON.stringify(stats));
"
  else
    # Fallback shell implementation (basic counts only)
    local total
    total=$(wc -l < "$rollback_log" | tr -d ' ')
    local successful
    successful=$(grep -c '"success":true' "$rollback_log" 2>/dev/null || echo 0)
    local failed=$((total - successful))
    local rate=0
    if [ "$total" -gt 0 ]; then
      rate=$((successful * 100 / total))
    fi
    printf '{"total":%d,"successful":%d,"failed":%d,"successRate":%d,"byReason":{},"byStory":{}}' \
      "$total" "$successful" "$failed" "$rate"
  fi
}

# Validate git state matches checkpoint
# Returns: 0 if match or user confirms, 1 if user declines
validate_git_state() {
  local expected_sha="$1"
  local current_sha

  current_sha=$(git_head)

  if [ -z "$expected_sha" ]; then
    # No checkpoint SHA to validate
    return 0
  fi

  if [ "$current_sha" = "$expected_sha" ]; then
    return 0
  fi

  # Git state has diverged - warn user
  printf "\n${C_YELLOW}${C_BOLD}Warning: Git state has diverged from checkpoint${C_RESET}\n"
  printf "  ${C_DIM}Checkpoint SHA: ${C_RESET}${expected_sha:0:8}\n"
  printf "  ${C_DIM}Current SHA:    ${C_RESET}${current_sha:0:8}\n"
  printf "\n"

  # Prompt user if in TTY mode
  if [ -t 0 ]; then
    printf "${C_YELLOW}Resume anyway? [y/N]: ${C_RESET}"
    read -r response
    case "$response" in
      [yY]|[yY][eE][sS])
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  else
    # Non-interactive mode - fail safe
    msg_error "Git state diverged. Use --resume in interactive mode to override."
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Scope Validation (Sequential Mode Support)
# ─────────────────────────────────────────────────────────────────────────────
# Validates that agent only modified files within PRD scope
# Used in sequential mode to prevent contamination

validate_prd_scope() {
  # Check if scope validation is enabled
  if [[ "${RALPH_VALIDATE_SCOPE:-false}" != "true" ]]; then
    return 0  # Validation disabled
  fi

  # Check if ACTIVE_PRD_NUMBER is set
  if [[ -z "${ACTIVE_PRD_NUMBER:-}" ]]; then
    return 0  # No active PRD - skip validation
  fi

  local prd_num="${ACTIVE_PRD_NUMBER##*PRD-}"  # Extract number

  # Get list of changed files in this iteration
  local changed_files
  changed_files=$(git diff --name-only HEAD~1 2>/dev/null || echo "")

  if [[ -z "$changed_files" ]]; then
    # No changes detected - this is OK
    return 0
  fi

  # Check if any changed files are in other PRD directories
  local violations=""
  while IFS= read -r file; do
    # Skip if file is in .ralph/PRD-N/ directory (current PRD)
    if [[ "$file" == ".ralph/PRD-${prd_num}/"* ]]; then
      continue
    fi

    # Check if file is in a different PRD directory
    if [[ "$file" =~ \.ralph/PRD-([0-9]+)/ ]]; then
      local other_prd="${BASH_REMATCH[1]}"
      if [[ "$other_prd" != "$prd_num" ]]; then
        violations="${violations}${violations:+$'\n'}  - $file (PRD-$other_prd)"
      fi
    fi
  done <<< "$changed_files"

  if [[ -n "$violations" ]]; then
    # Scope violation detected!
    printf "\n${C_RED}${C_BOLD}SCOPE VIOLATION DETECTED${C_RESET}\n"
    printf "${C_DIM}Agent modified files outside PRD-${prd_num} scope:${C_RESET}\n"
    printf "%s\n" "$violations"
    printf "\n"
    printf "${C_YELLOW}Rolling back this iteration...${C_RESET}\n"

    # Rollback the commit
    git reset --hard HEAD~1 2>/dev/null || true

    printf "${C_RED}Iteration rolled back due to contamination.${C_RESET}\n"
    printf "${C_DIM}Agent must only work on PRD-${prd_num}.${C_RESET}\n"
    echo ""

    return 1  # Validation failed
  fi

  return 0  # Validation passed
}

# Prompt user to confirm resume from checkpoint
# Returns: 0 if user confirms, 1 if user declines
prompt_resume_confirmation() {
  local iteration="$1"
  local story_id="$2"

  printf "\n${C_CYAN}${C_BOLD}Checkpoint found${C_RESET}\n"
  printf "  ${C_DIM}Iteration:${C_RESET} $iteration\n"
  printf "  ${C_DIM}Story:${C_RESET}     ${story_id:-unknown}\n"
  printf "\n"

  # Prompt user if in TTY mode
  if [ -t 0 ]; then
    printf "${C_CYAN}Resume from iteration $iteration? [Y/n]: ${C_RESET}"
    read -r response
    case "$response" in
      [nN]|[nN][oO])
        return 1
        ;;
      *)
        return 0
        ;;
    esac
  else
    # Non-interactive mode - proceed with resume
    return 0
  fi
}

# Get model routing decision for a story
# Usage: get_routing_decision <story_block_file> [override_model]
# Returns JSON: {"model": "sonnet", "score": 5.2, "reason": "...", "override": false}
get_routing_decision() {
  local story_file="$1"
  local override="${2:-}"
  local router_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    router_cli="$RALPH_ROOT/lib/tokens/router-cli.js"
  else
    router_cli="$SCRIPT_DIR/../../lib/tokens/router-cli.js"
  fi

  # Check if router CLI exists and Node.js is available
  if [ -f "$router_cli" ] && command -v node >/dev/null 2>&1; then
    local args=("--story" "$story_file" "--repo-root" "$ROOT_DIR")
    if [ -n "$override" ]; then
      args+=("--override" "$override")
    fi
    node "$router_cli" "${args[@]}" 2>/dev/null || echo '{"model":"sonnet","score":null,"reason":"router unavailable","override":false}'
  else
    # Fallback when router not available
    echo '{"model":"sonnet","score":null,"reason":"router not installed","override":false}'
  fi
}

# Parse JSON field from routing decision
parse_routing_field() {
  local json="$1"
  local field="$2"
  local result
  result=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('$field',''); print('' if v is None else str(v))" "$json" 2>/dev/null)
  # Handle None, null, and empty
  if [ -z "$result" ] || [ "$result" = "None" ] || [ "$result" = "null" ]; then
    echo ""
  else
    echo "$result"
  fi
}

# Estimate execution cost before running
# Usage: estimate_execution_cost <model> <complexity_score>
# Returns JSON: {"estimatedCost": "0.15", "costRange": "$0.10-0.25", "estimatedTokens": 15000, "comparison": "vs $0.75 if using Opus"}
estimate_execution_cost() {
  local model="$1"
  local score="$2"
  local estimator_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    estimator_cli="$RALPH_ROOT/lib/tokens/estimator-cli.js"
  else
    estimator_cli="$SCRIPT_DIR/../../lib/tokens/estimator-cli.js"
  fi

  # Check if estimator CLI exists and Node.js is available
  if [ -f "$estimator_cli" ] && command -v node >/dev/null 2>&1; then
    local args=("--model" "$model" "--repo-root" "$ROOT_DIR")
    if [ -n "$score" ]; then
      args+=("--complexity" "$score")
    fi
    node "$estimator_cli" "${args[@]}" 2>/dev/null || echo '{"estimatedCost":null,"costRange":null,"estimatedTokens":null,"comparison":null}'
  else
    # Fallback when estimator not available
    echo '{"estimatedCost":null,"costRange":null,"estimatedTokens":null,"comparison":null}'
  fi
}

# Calculate actual cost from token usage
# Usage: calculate_actual_cost <input_tokens> <output_tokens> <model>
# Returns JSON: {"totalCost": "0.15", "inputCost": "0.05", "outputCost": "0.10"}
calculate_actual_cost() {
  local input_tokens="$1"
  local output_tokens="$2"
  local model="$3"

  # Use Node.js for cost calculation
  if command -v node >/dev/null 2>&1; then
    local calculator_path
    if [[ -n "${RALPH_ROOT:-}" ]]; then
      calculator_path="$RALPH_ROOT/lib/tokens/calculator.js"
    else
      calculator_path="$SCRIPT_DIR/../../lib/tokens/calculator.js"
    fi

    if [ -f "$calculator_path" ]; then
      node -e "
        const calc = require('$calculator_path');
        const result = calc.calculateCost(
          { inputTokens: $input_tokens, outputTokens: $output_tokens },
          '$model'
        );
        console.log(JSON.stringify(result));
      " 2>/dev/null || echo '{"totalCost":null}'
    else
      echo '{"totalCost":null}'
    fi
  else
    echo '{"totalCost":null}'
  fi
}

# Enhanced error display with path highlighting and suggestions
# Usage: show_error "message" ["log_path"]
show_error() {
  local message="$1"
  local log_path="${2:-}"
  msg_error "$message"
  if [ -n "$log_path" ]; then
    printf "  ${C_RED}Review logs at: ${C_BOLD}%s${C_RESET}\n" "$log_path"
  fi
}

# Show helpful suggestions when errors occur
show_error_suggestions() {
  local error_type="${1:-agent}"  # agent or system
  printf "\n${C_YELLOW}${C_BOLD}Suggested next steps:${C_RESET}\n"
  if [ "$error_type" = "agent" ]; then
    printf "  ${C_DIM}1)${C_RESET} Review the run log for agent output and errors\n"
    printf "  ${C_DIM}2)${C_RESET} Check ${C_CYAN}%s${C_RESET} for repeated failures\n" "$ERRORS_LOG_PATH"
    printf "  ${C_DIM}3)${C_RESET} Try: ${C_CYAN}ralph build 1 --no-commit${C_RESET} for a test run\n"
  else
    printf "  ${C_DIM}1)${C_RESET} Verify the agent CLI is installed and authenticated\n"
    printf "  ${C_DIM}2)${C_RESET} Check system resources (disk space, memory)\n"
    printf "  ${C_DIM}3)${C_RESET} Review ${C_CYAN}%s${C_RESET} for patterns\n" "$GUARDRAILS_PATH"
  fi
}

# Print error summary at end of run if any iterations failed
# Reads from FAILED_ITERATIONS (format: "iter:story:logfile,iter:story:logfile,...")
print_error_summary() {
  local failed_data="$1"
  local count="$2"

  if [ -z "$failed_data" ] || [ "$count" -eq 0 ]; then
    return
  fi

  echo ""
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}${C_RED}  ERROR SUMMARY: %d iteration(s) failed${C_RESET}\n" "$count"
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"

  # Parse and display each failed iteration
  IFS=',' read -ra FAILURES <<< "$failed_data"
  for failure in "${FAILURES[@]}"; do
    IFS=':' read -r iter story logfile <<< "$failure"
    printf "${C_RED}  ✗ Iteration %s${C_RESET}" "$iter"
    if [ -n "$story" ] && [ "$story" != "plan" ]; then
      printf " ${C_DIM}(%s)${C_RESET}" "$story"
    fi
    printf "\n"
    printf "    ${C_RED}Log: ${C_BOLD}%s${C_RESET}\n" "$logfile"
  done

  printf "${C_RED}───────────────────────────────────────────────────────${C_RESET}\n"
  printf "  ${C_YELLOW}Check: ${C_CYAN}%s${C_RESET}\n" "$ERRORS_LOG_PATH"
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"
}

# Print auto-fix summary if any fixes were applied (US-003)
# Reads AUTO_FIX entries from activity.log via fix-summary-cli.js
print_fix_summary() {
  local prd_folder="$1"

  if [ -z "$prd_folder" ] || [ ! -d "$prd_folder" ]; then
    return
  fi

  local activity_log="$prd_folder/activity.log"
  if [ ! -f "$activity_log" ]; then
    return
  fi

  # Check if there are any AUTO_FIX entries in the log
  if ! grep -q "AUTO_FIX" "$activity_log" 2>/dev/null; then
    return
  fi

  # Use fix-summary-cli.js to print the summary
  local cli_path="$ROOT_DIR/lib/diagnose/fix-summary-cli.js"
  if [ -f "$cli_path" ]; then
    node "$cli_path" print "$activity_log"
  fi
}

# Get auto-fix summary string for commit message (US-003)
# Returns a line like "Auto-fixed: LINT_ERROR, FORMAT_ERROR"
get_fix_commit_line() {
  local prd_folder="$1"

  if [ -z "$prd_folder" ] || [ ! -d "$prd_folder" ]; then
    return
  fi

  local activity_log="$prd_folder/activity.log"
  if [ ! -f "$activity_log" ]; then
    return
  fi

  # Check if there are any AUTO_FIX entries in the log
  if ! grep -q "AUTO_FIX" "$activity_log" 2>/dev/null; then
    return
  fi

  # Use fix-summary-cli.js to get the commit line
  local cli_path="$ROOT_DIR/lib/diagnose/fix-summary-cli.js"
  if [ -f "$cli_path" ]; then
    node "$cli_path" commit "$activity_log"
  fi
}

# Format duration in human-readable form (e.g., "1m 23s" or "45s")
format_duration() {
  local secs="$1"
  local mins=$((secs / 60))
  local remaining=$((secs % 60))
  if [ "$mins" -gt 0 ]; then
    printf "%dm %ds" "$mins" "$remaining"
  else
    printf "%ds" "$secs"
  fi
}

# Print iteration summary table at end of multi-iteration run
# Reads from ITERATION_RESULTS (format: "iter|story|duration|status,...")
print_summary_table() {
  local results="$1"
  local total_time="$2"
  local success_count="$3"
  local total_count="$4"
  local remaining="$5"

  if [ -z "$results" ] || [ "$total_count" -eq 0 ]; then
    return
  fi

  # Only show table for multi-iteration runs (2+)
  if [ "$total_count" -lt 2 ]; then
    return
  fi

  echo ""
  printf "${C_CYAN}╔═══════════════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD}${C_CYAN}                    ITERATION SUMMARY                          ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╠═════╤════════════╤════════════╤═════════╤══════════════════════╣${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD} Iter│   Story    │  Duration  │ Retries │       Status         ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╟─────┼────────────┼────────────┼─────────┼──────────────────────╢${C_RESET}\n"

  # Parse and display each iteration result
  IFS=',' read -ra RESULTS <<< "$results"
  local total_retries=0
  for result in "${RESULTS[@]}"; do
    # Handle both old format (4 fields) and new format (5 fields with retries)
    local iter story duration status retries_field
    IFS='|' read -r iter story duration status retries_field <<< "$result"
    local dur_str
    dur_str=$(format_duration "$duration")
    # Handle missing/empty retries field gracefully (backwards compatibility)
    local retries=0
    if [ -n "$retries_field" ] && [ "$retries_field" != "" ]; then
      retries="$retries_field"
    fi
    total_retries=$((total_retries + retries))

    # Status symbol and color
    local status_display
    if [ "$status" = "success" ]; then
      status_display="${C_GREEN}✓ success${C_RESET}"
    else
      status_display="${C_RED}✗ error${C_RESET}"
    fi

    # Retry display with color
    local retry_display
    if [ "$retries" -gt 0 ]; then
      retry_display="${C_YELLOW}${retries}${C_RESET}"
    else
      retry_display="${C_DIM}0${C_RESET}"
    fi

    # Truncate story ID if too long (max 10 chars)
    local story_display="${story:-plan}"
    if [ "${#story_display}" -gt 10 ]; then
      story_display="${story_display:0:10}"
    fi

    printf "${C_CYAN}║${C_RESET} %3s │ %-10s │ %10s │   %-5b │ %-20b ${C_CYAN}║${C_RESET}\n" "$iter" "$story_display" "$dur_str" "$retry_display" "$status_display"
  done

  printf "${C_CYAN}╠═════╧════════════╧════════════╧═════════╧══════════════════════╣${C_RESET}\n"

  # Aggregate stats
  local total_dur_str
  total_dur_str=$(format_duration "$total_time")
  local success_rate
  if [ "$total_count" -gt 0 ]; then
    success_rate=$((success_count * 100 / total_count))
  else
    success_rate=0
  fi

  # Color-code success rate
  local rate_color="$C_GREEN"
  if [ "$success_rate" -lt 100 ]; then
    rate_color="$C_YELLOW"
  fi
  if [ "$success_rate" -lt 50 ]; then
    rate_color="$C_RED"
  fi

  printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Total time:${C_RESET} %-10s ${C_BOLD}Success:${C_RESET} ${rate_color}%d/%d (%d%%)${C_RESET}  " "$total_dur_str" "$success_count" "$total_count" "$success_rate"
  if [ "$total_retries" -gt 0 ]; then
    printf "${C_BOLD}Retries:${C_RESET} ${C_YELLOW}%d${C_RESET}  " "$total_retries"
  fi
  printf "${C_CYAN}║${C_RESET}\n"
  if [ -n "$remaining" ] && [ "$remaining" != "unknown" ] && [ "$remaining" != "0" ]; then
    printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Stories remaining:${C_RESET} %-41s ${C_CYAN}║${C_RESET}\n" "$remaining"
  fi
  printf "${C_CYAN}╚═══════════════════════════════════════════════════════════════╝${C_RESET}\n"
}

append_run_summary() {
  local line="$1"
  python3 - "$ACTIVITY_LOG_PATH" "$line" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
line = sys.argv[2]
text = path.read_text().splitlines()
out = []
inserted = False
for l in text:
    out.append(l)
    if not inserted and l.strip() == "## Run Summary":
        out.append(f"- {line}")
        inserted = True
if not inserted:
    out = [
        "# Activity Log",
        "",
        "## Run Summary",
        f"- {line}",
        "",
        "## Events",
        "",
    ] + text
Path(path).write_text("\n".join(out).rstrip() + "\n")
PY
}

# Write run metadata using external Python script
# Usage: write_run_meta <output_path> <json_data>
# Where json_data is a JSON object containing all metadata fields
write_run_meta() {
  local output_path="$1"
  local json_data="$2"

  # Create temporary JSON file
  local json_tmp
  json_tmp="$(mktemp)"
  register_temp_file "$json_tmp"  # P2.1: register for cleanup
  echo "$json_data" > "$json_tmp"

  # Call Python script to generate markdown
  if ! python3 "$SCRIPT_DIR/lib/run-meta-writer.py" "$json_tmp" "$output_path" 2>/dev/null; then
    # Fallback: write minimal metadata if Python script fails
    {
      echo "# Ralph Run Summary"
      echo ""
      echo "Error: Failed to generate full metadata"
      echo ""
      echo "Raw JSON:"
      echo "$json_data"
    } > "$output_path"
  fi

  # Clean up temp file
  rm -f "$json_tmp"

  # Handle actual cost calculation if needed (requires bash routing lib)
  # Extract values from JSON for cost calculation
  local input_tokens output_tokens routed_model token_model
  input_tokens="$(echo "$json_data" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('input_tokens',''))" 2>/dev/null || echo "")"
  output_tokens="$(echo "$json_data" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('output_tokens',''))" 2>/dev/null || echo "")"
  routed_model="$(echo "$json_data" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('routed_model',''))" 2>/dev/null || echo "")"
  token_model="$(echo "$json_data" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('token_model',''))" 2>/dev/null || echo "")"

  # Calculate and append actual cost if we have the data
  if [[ -n "$input_tokens" ]] && [[ "$input_tokens" != "null" ]] && [[ -n "$output_tokens" ]] && [[ "$output_tokens" != "null" ]]; then
    local cost_model="${routed_model:-$token_model}"
    if [[ -n "$cost_model" ]] && [[ "$cost_model" != "null" ]]; then
      local actual_cost_json actual_cost
      actual_cost_json="$(calculate_actual_cost "$input_tokens" "$output_tokens" "$cost_model" 2>/dev/null || echo "")"
      actual_cost="$(parse_routing_field "$actual_cost_json" "totalCost" 2>/dev/null || echo "")"
      if [[ -n "$actual_cost" ]] && [[ "$actual_cost" != "null" ]]; then
        # Insert actual cost into the markdown file (replace placeholder line)
        sed -i.bak "s|- Actual tokens: \([0-9]*\) (input: \([0-9]*\), output: \([0-9]*\))|- Actual tokens: \1 (input: \2, output: \3)\n- Actual cost: \$$actual_cost|g" "$output_path"
        rm -f "${output_path}.bak"
      fi
    fi
  fi
}

# Generate context summary for a story
# Returns markdown-formatted context selection summary
generate_context_summary() {
  local story_block="$1"
  local model="${2:-sonnet}"
  local limit="${3:-15}"
  local project_root="${4:-$ROOT_DIR}"

  # Check if context CLI is available
  local context_cli="$SCRIPT_DIR/../../lib/context/cli.js"
  if [ ! -f "$context_cli" ]; then
    echo ""
    return 0
  fi

  # Generate context summary using the CLI
  # Write story to temp file to handle multi-line content
  local story_tmp
  story_tmp="$(mktemp)"
  register_temp_file "$story_tmp"  # P2.1: register for cleanup
  echo "$story_block" > "$story_tmp"

  local summary
  summary=$(node "$context_cli" \
    --story-file "$story_tmp" \
    --project-root "$project_root" \
    --model "$model" \
    --limit "$limit" \
    --format markdown 2>/dev/null || echo "")

  rm -f "$story_tmp"
  echo "$summary"
}

# Append context summary to run metadata file
append_context_to_run_meta() {
  local run_meta_path="$1"
  local context_summary="$2"

  if [ -z "$context_summary" ]; then
    return 0
  fi

  # Append context summary section
  {
    echo ""
    echo "$context_summary"
    echo ""
  } >> "$run_meta_path"
}

git_head() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true
  else
    echo ""
  fi
}

git_commit_list() {
  local before="$1"
  local after="$2"
  if [ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ]; then
    git -C "$ROOT_DIR" log --oneline "$before..$after" | sed 's/^/- /'
  else
    echo ""
  fi
}

git_changed_files() {
  local before="$1"
  local after="$2"
  if [ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ]; then
    git -C "$ROOT_DIR" diff --name-only "$before" "$after" | sed 's/^/- /'
  else
    echo ""
  fi
}

git_dirty_files() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" status --porcelain | awk '{print "- " $2}'
  else
    echo ""
  fi
}

# Extract token metrics from a log file using Node.js extractor
# Returns JSON: {"inputTokens": N, "outputTokens": N, "model": "...", "estimated": bool}
extract_tokens_from_log() {
  local log_file="$1"
  local extractor_path
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    extractor_path="$RALPH_ROOT/lib/tokens/extract-cli.js"
  else
    extractor_path="$SCRIPT_DIR/../../lib/tokens/extract-cli.js"
  fi

  # Check if extractor exists and Node.js is available
  if [ -f "$extractor_path" ] && command -v node >/dev/null 2>&1; then
    node "$extractor_path" "$log_file" 2>/dev/null || echo '{"inputTokens":null,"outputTokens":null,"model":null,"estimated":false}'
  else
    echo '{"inputTokens":null,"outputTokens":null,"model":null,"estimated":false}'
  fi
}

# Parse JSON field from token extraction result
parse_token_field() {
  local json="$1"
  local field="$2"
  local result

  # Graceful degradation: if Python3 not available, return empty (P2.5)
  if [ "$PYTHON3_AVAILABLE" = "false" ]; then
    # Simple bash fallback for common JSON patterns
    result=$(echo "$json" | sed -n "s/.*\"$field\"[[:space:]]*:[[:space:]]*\([^,}]*\).*/\1/p" | tr -d ' "')
    if [ "$result" = "null" ]; then
      echo ""
    else
      echo "$result"
    fi
    return
  fi

  result=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('$field',''); print('' if v is None else str(v))" "$json" 2>/dev/null)
  # Handle None, null, and empty - return empty string to prevent arithmetic errors
  if [ -z "$result" ] || [ "$result" = "None" ] || [ "$result" = "null" ]; then
    echo ""
  else
    echo "$result"
  fi
}

# Append metrics to metrics.jsonl for historical tracking
# Called after each successful build iteration
append_metrics() {
  local prd_folder="$1"
  local story_id="$2"
  local story_title="$3"
  local duration="$4"
  local input_tokens="$5"
  local output_tokens="$6"
  local agent="$7"
  local model="$8"
  local status="$9"
  local run_id="${10}"
  local iteration="${11}"
  local retry_count="${12:-0}"
  local retry_time="${13:-0}"
  local complexity_score="${14:-}"
  local routing_reason="${15:-}"
  local estimated_cost="${16:-}"
  local exp_name="${17:-}"
  local exp_variant="${18:-}"
  local exp_excluded="${19:-}"
  # Rollback tracking fields (US-004)
  local rollback_count="${20:-0}"
  local rollback_reason="${21:-}"
  local rollback_success="${22:-}"
  # Switch tracking fields (US-004)
  local switch_count="${23:-0}"
  local agents_tried="${24:-}"  # Comma-separated list of agents tried
  local failure_type="${25:-}"  # timeout, error, quality, or empty
  # Retry history for this iteration (P1.4)
  local retry_history="${26:-}"  # Format: "attempt=N status=S duration=Ds|..."

  local metrics_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    metrics_cli="$RALPH_ROOT/lib/estimate/metrics-cli.js"
  else
    metrics_cli="$SCRIPT_DIR/../../lib/estimate/metrics-cli.js"
  fi

  # Check if metrics CLI exists and Node.js is available
  if [ -f "$metrics_cli" ] && command -v node >/dev/null 2>&1; then
    # Build JSON data - handle null tokens gracefully
    local input_val="null"
    local output_val="null"
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ] && [ "$input_tokens" != "" ]; then
      input_val="$input_tokens"
    fi
    if [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ] && [ "$output_tokens" != "" ]; then
      output_val="$output_tokens"
    fi

    # Handle complexity score
    local complexity_val="null"
    if [ -n "$complexity_score" ] && [ "$complexity_score" != "null" ] && [ "$complexity_score" != "" ] && [ "$complexity_score" != "n/a" ]; then
      complexity_val="$complexity_score"
    fi

    # Handle estimated cost
    local estimated_cost_val="null"
    if [ -n "$estimated_cost" ] && [ "$estimated_cost" != "null" ] && [ "$estimated_cost" != "" ] && [ "$estimated_cost" != "n/a" ]; then
      estimated_cost_val="$estimated_cost"
    fi

    # Escape strings for JSON
    local escaped_title
    escaped_title=$(printf '%s' "$story_title" | sed 's/"/\\"/g' | sed "s/'/\\'/g")

local escaped_reason="null"
    if [ -n "$routing_reason" ] && [ "$routing_reason" != "null" ] && [ "$routing_reason" != "" ]; then
      escaped_reason=$(printf '"%s"' "$(printf '%s' "$routing_reason" | sed 's/"/\\"/g')")
    fi

    # Build experiment fields if present
    local exp_fields=""
    if [ -n "$exp_name" ]; then
      local excluded_bool="false"
      if [ "$exp_excluded" = "1" ]; then
        excluded_bool="true"
      fi
      exp_fields=$(printf ',"experimentName":"%s","experimentVariant":"%s","experimentExcluded":%s' \
        "$exp_name" \
        "$exp_variant" \
        "$excluded_bool")
    fi

    # Build rollback fields if present (US-004)
    local rollback_fields=""
    if [ -n "$rollback_count" ] && [ "$rollback_count" != "0" ]; then
      local rollback_success_bool="null"
      if [ "$rollback_success" = "true" ]; then
        rollback_success_bool="true"
      elif [ "$rollback_success" = "false" ]; then
        rollback_success_bool="false"
      fi
      local escaped_rollback_reason="null"
      if [ -n "$rollback_reason" ]; then
        escaped_rollback_reason=$(printf '"%s"' "$(printf '%s' "$rollback_reason" | sed 's/"/\\"/g')")
      fi
      rollback_fields=$(printf ',"rollbackCount":%s,"rollbackReason":%s,"rollbackSuccess":%s' \
        "$rollback_count" \
        "$escaped_rollback_reason" \
        "$rollback_success_bool")
    fi

    # Build switch tracking fields (US-004)
    local switch_fields=""
    if [ -n "$switch_count" ] && [ "$switch_count" != "0" ]; then
      # Convert comma-separated agents to JSON array
      local agents_json="null"
      if [ -n "$agents_tried" ]; then
        # Convert "claude,codex" to ["claude","codex"]
        agents_json="[$(echo "$agents_tried" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/' )]"
      fi
      local failure_type_json="null"
      if [ -n "$failure_type" ]; then
        failure_type_json="\"$failure_type\""
      fi
      switch_fields=$(printf ',"switchCount":%s,"agents":%s,"failureType":%s' \
        "$switch_count" \
        "$agents_json" \
        "$failure_type_json")
    fi

    # Build retry history field (P1.4)
    local retry_history_field=""
    if [ -n "$retry_history" ]; then
      # Escape the retry history string for JSON
      local escaped_retry_history
      escaped_retry_history=$(printf '%s' "$retry_history" | sed 's/"/\\"/g')
      retry_history_field=$(printf ',"retryHistory":"%s"' "$escaped_retry_history")
    fi

    local json_data
    json_data=$(printf '{"storyId":"%s","storyTitle":"%s","duration":%s,"inputTokens":%s,"outputTokens":%s,"agent":"%s","model":"%s","status":"%s","runId":"%s","iteration":%s,"retryCount":%s,"retryTime":%s,"complexityScore":%s,"routingReason":%s,"estimatedCost":%s,"timestamp":"%s"%s%s%s%s}' \
      "$story_id" \
      "$escaped_title" \
      "$duration" \
      "$input_val" \
      "$output_val" \
      "$agent" \
      "${model:-null}" \
      "$status" \
      "$run_id" \
      "$iteration" \
      "$retry_count" \
      "$retry_time" \
      "$complexity_val" \
      "$escaped_reason" \
      "$estimated_cost_val" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$exp_fields" \
      "$rollback_fields" \
      "$switch_fields" \
      "$retry_history_field")

    if ! node "$metrics_cli" "$prd_folder" "$json_data" 2>/dev/null; then
      log_silent_failure "metrics" "append_metrics" "story=$story_id iteration=$iteration"
    fi
  fi
}

# Rebuild token cache for the current stream
# Called at end of build to ensure dashboard has fresh data
rebuild_token_cache() {
  if [ "$MODE" != "build" ]; then
    return 0
  fi

  local cache_script
  if [ -n "$RALPH_ROOT" ]; then
    cache_script="$RALPH_ROOT/lib/tokens/index.js"
  else
    cache_script="$SCRIPT_DIR/../../lib/tokens/index.js"
  fi

  # Get the stream path (PRD-N directory)
  local stream_path
  stream_path="$(dirname "$PRD_PATH")"

  if [ -f "$cache_script" ] && command -v node >/dev/null 2>&1; then
    node -e "
      const tokens = require('$cache_script');
      const streamPath = '$stream_path';
      const repoRoot = '$(dirname "$(dirname "$stream_path")")';
      try {
        tokens.rebuildCache(streamPath, tokens.parseTokensFromSummary, { repoRoot });
        console.log('Token cache rebuilt for ' + streamPath);
      } catch (e) {
        console.error('Failed to rebuild token cache:', e.message);
      }
    " 2>/dev/null || true
  fi
}

msg_info "Ralph mode: $MODE"
msg_dim "Max iterations: $MAX_ITERATIONS"
msg_dim "PRD: $PRD_PATH"
msg_dim "Plan: $PLAN_PATH"
HAS_ERROR="false"
# Track failed iterations for summary at end
FAILED_ITERATIONS=""
FAILED_COUNT=0

# Iteration results tracking for summary table
# Each entry: "iter|story_id|duration|status"
ITERATION_RESULTS=""
TOTAL_DURATION=0
SUCCESS_COUNT=0
RETRY_SUCCESS_COUNT=0  # Track retry successes separately (fix P0.2)
ITERATION_COUNT=0

# ─────────────────────────────────────────────────────────────────────────────
# Failure Pattern Detection (US-001)
# ─────────────────────────────────────────────────────────────────────────────
# Track consecutive failures per agent for automatic agent switching
CONSECUTIVE_FAILURES=0
CURRENT_AGENT="$DEFAULT_AGENT_NAME"
LAST_FAILURE_TYPE=""
LAST_FAILED_STORY_ID=""

# Classify failure type from exit code and log contents
# Usage: classify_failure_type <exit_code> <log_file>
# Returns: "timeout", "error", or "quality"
classify_failure_type() {
  local exit_code="$1"
  local log_file="$2"

  # Timeout failures (SIGALRM=124, SIGKILL=137)
  if [ "$exit_code" -eq 124 ] || [ "$exit_code" -eq 137 ]; then
    echo "timeout"
    return
  fi

  # Quality failures - check log for test/lint/type errors
  if [ -f "$log_file" ]; then
    # Check for test failures
    if grep -qiE "(test(s)? (failed|failing)|FAIL |✗ |AssertionError|expect\(.*\)\.to)" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Check for lint errors
    if grep -qiE "(eslint|prettier|lint).*error|linting failed" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Check for TypeScript type errors
    if grep -qiE "error TS[0-9]+:|type error|TypeError:" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
  fi

  # Default to general error
  echo "error"
}

# Check if failure type should trigger agent switch based on config
# Usage: should_trigger_switch <failure_type>
# Returns: 0 (true) if switch should be triggered, 1 (false) otherwise
should_trigger_switch() {
  local failure_type="$1"

  case "$failure_type" in
    timeout)
      [ "${AGENT_SWITCH_ON_TIMEOUT:-true}" = "true" ] && return 0
      ;;
    error)
      [ "${AGENT_SWITCH_ON_ERROR:-true}" = "true" ] && return 0
      ;;
    quality)
      [ "${AGENT_SWITCH_ON_QUALITY:-false}" = "true" ] && return 0
      ;;
  esac
  return 1
}

# Update consecutive failure tracking
# Usage: track_failure <exit_code> <log_file> <story_id>
# Sets: CONSECUTIVE_FAILURES, LAST_FAILURE_TYPE, LAST_FAILED_STORY_ID
track_failure() {
  local exit_code="$1"
  local log_file="$2"
  local story_id="$3"

  LAST_FAILURE_TYPE="$(classify_failure_type "$exit_code" "$log_file")"
  LAST_FAILED_STORY_ID="$story_id"

  # Only increment if the failure type should trigger a switch
  if should_trigger_switch "$LAST_FAILURE_TYPE"; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    log_activity "FAILURE_TRACKED agent=$CURRENT_AGENT type=$LAST_FAILURE_TYPE consecutive=$CONSECUTIVE_FAILURES story=$story_id threshold=${AGENT_SWITCH_THRESHOLD:-2}"
  else
    # Log but don't count towards switch threshold
    log_activity "FAILURE_LOGGED agent=$CURRENT_AGENT type=$LAST_FAILURE_TYPE story=$story_id (not counting towards switch)"
  fi
}

# Reset consecutive failure tracking (called on success)
# Usage: reset_failure_tracking
reset_failure_tracking() {
  if [ "$CONSECUTIVE_FAILURES" -gt 0 ]; then
    log_activity "FAILURE_RESET agent=$CURRENT_AGENT previous_consecutive=$CONSECUTIVE_FAILURES (story completed successfully)"
  fi
  CONSECUTIVE_FAILURES=0
  LAST_FAILURE_TYPE=""
  LAST_FAILED_STORY_ID=""
}

# Check if switch threshold has been reached
# Usage: switch_threshold_reached
# Returns: 0 if threshold reached, 1 otherwise
switch_threshold_reached() {
  local threshold="${AGENT_SWITCH_THRESHOLD:-2}"
  [ "$CONSECUTIVE_FAILURES" -ge "$threshold" ]
}

# Get switch state file path for the current PRD
# Usage: get_switch_state_file <prd_folder>
get_switch_state_file() {
  local prd_folder="$1"
  echo "$prd_folder/switch-state.json"
}

# Save switch state to JSON file for cross-run persistence
# Usage: save_switch_state <prd_folder>
save_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_file "$prd_folder")"

  # Create JSON state
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  local json_content
  json_content=$(cat <<EOF
{
  "agent": "$CURRENT_AGENT",
  "failures": $CONSECUTIVE_FAILURES,
  "lastFailureType": "$LAST_FAILURE_TYPE",
  "storyId": "$LAST_FAILED_STORY_ID",
  "chainPosition": $CHAIN_POSITION,
  "updatedAt": "$timestamp"
}
EOF
)
  atomic_write "$state_file" "$json_content"  # Fix P0.3: atomic write
  msg_dim "Switch state saved: $CONSECUTIVE_FAILURES failures for $CURRENT_AGENT (chain position $CHAIN_POSITION)"
}

# Load switch state from JSON file
# Usage: load_switch_state <prd_folder>
# Sets: CURRENT_AGENT, CONSECUTIVE_FAILURES, LAST_FAILURE_TYPE, LAST_FAILED_STORY_ID, CHAIN_POSITION
load_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_file "$prd_folder")"

  if [ ! -f "$state_file" ]; then
    return 1
  fi

  # Parse JSON using Python
  local parsed
  parsed=$(python3 -c "
import json
import sys
try:
    with open('$state_file', 'r') as f:
        d = json.load(f)
    print(d.get('agent', ''))
    print(d.get('failures', 0))
    print(d.get('lastFailureType', ''))
    print(d.get('storyId', ''))
    print(d.get('chainPosition', 0))
except Exception:
    sys.exit(1)
" 2>/dev/null) || return 1

  # Read parsed values line by line
  CURRENT_AGENT=$(echo "$parsed" | sed -n '1p')
  CONSECUTIVE_FAILURES=$(echo "$parsed" | sed -n '2p')
  LAST_FAILURE_TYPE=$(echo "$parsed" | sed -n '3p')
  LAST_FAILED_STORY_ID=$(echo "$parsed" | sed -n '4p')
  CHAIN_POSITION=$(echo "$parsed" | sed -n '5p')

  # Validate
  if [ -z "$CURRENT_AGENT" ]; then
    CURRENT_AGENT="$DEFAULT_AGENT_NAME"
  fi
  if [ -z "$CONSECUTIVE_FAILURES" ] || ! [[ "$CONSECUTIVE_FAILURES" =~ ^[0-9]+$ ]]; then
    CONSECUTIVE_FAILURES=0
  fi
  if [ -z "$CHAIN_POSITION" ] || ! [[ "$CHAIN_POSITION" =~ ^[0-9]+$ ]]; then
    CHAIN_POSITION=0
  fi
  # Update AGENT_CMD to match loaded agent
  AGENT_CMD="$(resolve_agent_cmd "$CURRENT_AGENT")"

  msg_dim "Switch state loaded: $CONSECUTIVE_FAILURES failures for $CURRENT_AGENT (chain position $CHAIN_POSITION)"
  return 0
}

# Clear switch state file (on successful completion of all stories)
# Usage: clear_switch_state <prd_folder>
clear_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_file "$prd_folder")"

  if [ -f "$state_file" ]; then
    rm -f "$state_file"
    msg_dim "Switch state cleared (build complete)"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Agent Fallback Chain Functions (US-002)
# ─────────────────────────────────────────────────────────────────────────────
# Track current position in the fallback chain
CHAIN_POSITION=0

# Check if an agent CLI is available in PATH
# Usage: agent_available <agent_name>
# Returns: 0 (true) if available, 1 (false) otherwise
agent_available() {
  local agent_name="$1"
  if [ -z "$agent_name" ]; then
    return 1
  fi
  command -v "$agent_name" >/dev/null 2>&1
}

# Get the fallback chain as an array (space-separated string from config)
# Usage: chain=($(get_fallback_chain))
get_fallback_chain() {
  echo "${AGENT_FALLBACK_CHAIN:-claude codex droid}"
}

# Switch to the next available agent in the fallback chain
# Usage: switch_to_next_agent
# Returns: 0 if switched successfully, 1 if chain exhausted
# Sets: CURRENT_AGENT, AGENT_CMD, CHAIN_POSITION
switch_to_next_agent() {
  local chain_str
  chain_str="$(get_fallback_chain)"
  local -a chain=($chain_str)
  local chain_length=${#chain[@]}
  local old_agent="$CURRENT_AGENT"
  local start_position=$CHAIN_POSITION

  # Try each agent in the chain starting from current position + 1
  for ((i = 1; i <= chain_length; i++)); do
    local next_pos=$(( (start_position + i) % chain_length ))
    local candidate="${chain[$next_pos]}"

    # Skip if we're back at the current agent (full loop)
    if [ "$candidate" = "$old_agent" ]; then
      continue
    fi

    # Check if agent is available
    if agent_available "$candidate"; then
      CHAIN_POSITION=$next_pos
      CURRENT_AGENT="$candidate"
      AGENT_CMD="$(resolve_agent_cmd "$candidate")"
      log_activity "AGENT_SWITCH from=$old_agent to=$CURRENT_AGENT reason=$LAST_FAILURE_TYPE story=${STORY_ID:-unknown} failures=$CONSECUTIVE_FAILURES chain_position=$CHAIN_POSITION"
      msg_warn "Switching agent: $old_agent → $CURRENT_AGENT (after $CONSECUTIVE_FAILURES $LAST_FAILURE_TYPE failure(s))"
      # Track switch for run summary (US-003)
      LAST_SWITCH_COUNT=$((LAST_SWITCH_COUNT + 1))
      LAST_SWITCH_FROM="$old_agent"
      LAST_SWITCH_TO="$CURRENT_AGENT"
      LAST_SWITCH_REASON="$LAST_FAILURE_TYPE"
      # Track agents tried for metrics (US-004)
      if [ -z "$AGENTS_TRIED_THIS_ITERATION" ]; then
        AGENTS_TRIED_THIS_ITERATION="$old_agent,$CURRENT_AGENT"
      elif [[ ",$AGENTS_TRIED_THIS_ITERATION," != *",$CURRENT_AGENT,"* ]]; then
        AGENTS_TRIED_THIS_ITERATION="$AGENTS_TRIED_THIS_ITERATION,$CURRENT_AGENT"
      fi
      return 0
    fi
  done

  # Chain exhausted - no available agents found
  log_activity "SWITCH_FAILED reason=chain_exhausted tried=$chain_length story=${STORY_ID:-unknown}"
  msg_error "Agent fallback chain exhausted. No available agents found."
  return 1
}

# Reset chain position to start (first available agent)
# Called when a story completes successfully (US-002)
# Usage: reset_chain_position
# Sets: CHAIN_POSITION, CURRENT_AGENT, AGENT_CMD
reset_chain_position() {
  local chain_str
  chain_str="$(get_fallback_chain)"
  local -a chain=($chain_str)
  local old_agent="$CURRENT_AGENT"
  local old_position=$CHAIN_POSITION

  # Find first available agent in chain
  for ((i = 0; i < ${#chain[@]}; i++)); do
    local candidate="${chain[$i]}"
    if agent_available "$candidate"; then
      CHAIN_POSITION=$i
      CURRENT_AGENT="$candidate"
      AGENT_CMD="$(resolve_agent_cmd "$candidate")"
      if [ "$old_position" -ne "$i" ] || [ "$old_agent" != "$candidate" ]; then
        log_activity "CHAIN_RESET from=$old_agent to=$CURRENT_AGENT position=$CHAIN_POSITION (story completed successfully)"
        msg_dim "Chain reset: using primary agent $CURRENT_AGENT"
      fi
      return 0
    fi
  done

  # No agents available at all - keep current (shouldn't happen)
  msg_warn "No agents available in chain, keeping $CURRENT_AGENT"
  return 1
}

# Risk check function for high-risk story flagging (US-002)
# Usage: check_risk <story_block_file>
# Returns: 0 = proceed, 1 = skip story, 2 = user cancelled
# Sets: SKIP_ALL_RISK_CHECKS=1 if user chooses to skip all checks
check_risk() {
  local story_block_file="$1"

  # Skip if --skip-risk-check flag was passed
  if [ "${RALPH_SKIP_RISK:-}" = "1" ]; then
    return 0
  fi

  # Skip if already skipping all checks in this run
  if [ "${SKIP_ALL_RISK_CHECKS:-}" = "1" ]; then
    return 0
  fi

  # Get the risk threshold (default: 7)
  local threshold="${RALPH_RISK_THRESHOLD:-7}"

  # Run risk analysis via Node.js
  local risk_result
  risk_result=$(node -e "
    const fs = require('fs');
    const storyBlock = fs.readFileSync('$story_block_file', 'utf-8');
    try {
      const { isHighRisk, formatRiskPrompt } = require('${RALPH_ROOT:-$ROOT_DIR}/lib/risk');
      const result = isHighRisk(storyBlock, $threshold);
      console.log(JSON.stringify({
        isHighRisk: result.isHighRisk,
        score: result.score,
        riskLevel: result.riskLevel,
        prompt: formatRiskPrompt(result.analysis, { showPrompt: true }),
        factors: result.factors
      }));
    } catch (e) {
      console.log(JSON.stringify({ error: e.message, isHighRisk: false }));
    }
  " 2>/dev/null) || risk_result='{"isHighRisk":false}'

  # Parse the JSON result
  local is_high_risk
  is_high_risk=$(echo "$risk_result" | python3 -c "import sys, json; d=json.load(sys.stdin); print('true' if d.get('isHighRisk') else 'false')" 2>/dev/null) || is_high_risk="false"

  if [ "$is_high_risk" = "false" ]; then
    return 0
  fi

  # Display high-risk warning
  local score
  local risk_level
  local prompt_text
  score=$(echo "$risk_result" | python3 -c "import sys, json; print(json.load(sys.stdin).get('score', 0))" 2>/dev/null) || score="?"
  risk_level=$(echo "$risk_result" | python3 -c "import sys, json; print(json.load(sys.stdin).get('riskLevel', 'unknown'))" 2>/dev/null) || risk_level="unknown"
  prompt_text=$(echo "$risk_result" | python3 -c "import sys, json; print(json.load(sys.stdin).get('prompt', ''))" 2>/dev/null) || prompt_text=""

  echo ""
  printf "${C_YELLOW}╔══════════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_YELLOW}║${C_RESET}  ${C_BOLD}${C_RED}⚠  HIGH-RISK STORY DETECTED${C_RESET}                              ${C_YELLOW}║${C_RESET}\n"
  printf "${C_YELLOW}╚══════════════════════════════════════════════════════════╝${C_RESET}\n"
  echo ""
  echo "$prompt_text"
  echo ""

  # Log the high-risk detection
  log_activity "HIGH_RISK_DETECTED score=$score level=$risk_level story=${STORY_ID:-unknown}"

  # Prompt for user confirmation (only in interactive mode)
  if [ -t 0 ]; then
    printf "${C_BOLD}? Proceed with this high-risk story? ${C_RESET}${C_DIM}[y/n/s]${C_RESET} "
    read -r response
    case "$response" in
      [yY]|[yY][eE][sS])
        log_activity "HIGH_RISK_APPROVED story=${STORY_ID:-unknown}"
        return 0
        ;;
      [sS]|[sS][kK][iI][pP])
        export SKIP_ALL_RISK_CHECKS=1
        log_activity "HIGH_RISK_SKIP_ALL story=${STORY_ID:-unknown}"
        return 0
        ;;
      *)
        log_activity "HIGH_RISK_REJECTED story=${STORY_ID:-unknown}"
        return 1
        ;;
    esac
  else
    # Non-interactive mode: pause by default
    if [ "${RALPH_RISK_PAUSE:-true}" = "true" ]; then
      msg_warn "High-risk story detected in non-interactive mode. Use --skip-risk-check to bypass."
      return 1
    fi
    return 0
  fi
}

# Progress indicator: prints elapsed time, phase, and story every N seconds (TTY only) (US-001)
# Usage: start_progress_indicator <start_time> <prd_folder>; ... long process ...; stop_progress_indicator
PROGRESS_PID=""
start_progress_indicator() {
  # Only show progress in TTY mode
  if [ ! -t 1 ]; then
    return
  fi
  local start_time="$1"
  local prd_folder="${2:-}"
  local parent_pid=$$  # Capture parent PID to detect orphaning
  (
    while true; do
      # Exit if parent process is no longer running (prevents orphaned processes)
      if ! kill -0 "$parent_pid" 2>/dev/null; then
        exit 0
      fi
      sleep 1  # Update every 1 second for better responsiveness (US-001)
      local now=$(date +%s)
      local elapsed=$((now - start_time))
      local mins=$((elapsed / 60))
      local secs=$((elapsed % 60))

      # Read status from .status.json if available (US-001)
      local phase=""
      local story_id=""
      local status_file="$prd_folder/.status.json"
      if [ -n "$prd_folder" ] && [ -f "$status_file" ]; then
        if command -v jq >/dev/null 2>&1; then
          phase=$(jq -r '.phase // ""' "$status_file" 2>/dev/null || echo "")
          story_id=$(jq -r '.story_id // ""' "$status_file" 2>/dev/null || echo "")
        elif command -v python3 >/dev/null 2>&1; then
          phase=$(python3 -c "import json,sys; d=json.load(open('$status_file')); print(d.get('phase',''))" 2>/dev/null || echo "")
          story_id=$(python3 -c "import json,sys; d=json.load(open('$status_file')); print(d.get('story_id',''))" 2>/dev/null || echo "")
        fi
      fi

      # Format status line (US-001)
      local time_str
      if [ "$mins" -gt 0 ]; then
        time_str="⏱ ${mins}m ${secs}s"
      else
        time_str="⏱ ${secs}s"
      fi

      if [ -n "$phase" ] && [ -n "$story_id" ]; then
        printf "${C_DIM}  %s | %s | %s${C_RESET}\n" "$time_str" "$phase" "$story_id"
      else
        printf "${C_DIM}  %s${C_RESET}\n" "$time_str"
      fi
    done
  ) &
  PROGRESS_PID=$!
}

stop_progress_indicator() {
  # Safety check to avoid killing wrong process due to PID reuse (P1.5)
  if [ -z "$PROGRESS_PID" ]; then
    return
  fi

  # Verify PID still exists before killing
  if kill -0 "$PROGRESS_PID" 2>/dev/null; then
    # Extra safety: check it's actually our bash process (not a reused PID)
    local cmd
    cmd=$(ps -p "$PROGRESS_PID" -o args= 2>/dev/null || echo "")
    if [[ "$cmd" =~ bash.*sleep ]] || [[ "$cmd" =~ "sleep 5" ]] || [ -z "$cmd" ]; then
      # It's our progress indicator or process already gone - safe to kill
      kill "$PROGRESS_PID" 2>/dev/null || true
      wait "$PROGRESS_PID" 2>/dev/null || true
    else
      # PID was reused by another process - log but don't kill
      msg_dim "Progress PID $PROGRESS_PID reused by another process, skipping kill"
    fi
  fi

  PROGRESS_PID=""
}

# Ensure progress indicator is stopped and temp files cleaned on exit/interrupt (P2.1)
# Ensure cleanup on exit/interrupt: stop indicators, stall detector, and clean temp files (P2.1, US-009)
trap 'stop_progress_indicator; stop_stall_detector; cleanup_temp_files' EXIT INT TERM

# Resume mode handling
START_ITERATION=1
if [ "$MODE" = "build" ] && [ -n "$RESUME_MODE" ]; then
  PRD_FOLDER="$(dirname "$PRD_PATH")"

  if load_checkpoint "$PRD_FOLDER"; then
    # Validate git state matches checkpoint
    if ! validate_git_state "$CHECKPOINT_GIT_SHA"; then
      msg_error "Resume cancelled due to git state mismatch."
      exit 1
    fi

    # Validate plan.md hasn't changed since checkpoint (P1.2)
    if ! validate_plan_hash "$CHECKPOINT_PLAN_HASH" "$PLAN_PATH"; then
      msg_error "Resume cancelled due to plan change."
      exit 1
    fi

    # Prompt user for confirmation
    if ! prompt_resume_confirmation "$CHECKPOINT_ITERATION" "$CHECKPOINT_STORY_ID"; then
      msg_info "Starting fresh build (checkpoint ignored)."
    else
      START_ITERATION=$CHECKPOINT_ITERATION
      msg_success "Resuming from iteration $START_ITERATION (story $CHECKPOINT_STORY_ID)"
    fi
  else
    msg_warn "No checkpoint found. Starting fresh build."
  fi

  # Load switch state for failure tracking persistence (US-001)
  if load_switch_state "$PRD_FOLDER"; then
    if [ "$CONSECUTIVE_FAILURES" -gt 0 ]; then
      msg_info "Previous run had $CONSECUTIVE_FAILURES consecutive failure(s) for agent $CURRENT_AGENT"
    fi
  fi
elif [ "$MODE" = "build" ]; then
  # Non-resume build mode - load switch state to continue tracking
  PRD_FOLDER="$(dirname "$PRD_PATH")"
  load_switch_state "$PRD_FOLDER" 2>/dev/null || true
fi

# Track overall build start time for status emission (US-001)
BUILD_START=$(date +%s)

# Initialize cost tracking for real-time cost accumulation (US-007)
PRD_FOLDER_FOR_COST="$(dirname "$PRD_PATH")"
init_cost_tracking "$PRD_FOLDER_FOR_COST"
TOTAL_BUILD_COST=0

for i in $(seq $START_ITERATION "$MAX_ITERATIONS"); do
  echo ""
  printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}${C_CYAN}  Running iteration $i/$MAX_ITERATIONS${C_RESET}\n"
  printf "${C_DIM}  Started: $(date '+%Y-%m-%d %H:%M:%S')${C_RESET}\n"
  printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"

  STORY_META=""
  STORY_BLOCK=""
  ITER_START=$(date +%s)
  ITER_START_FMT=$(date '+%Y-%m-%d %H:%M:%S')

  # Reset rollback tracking for this iteration (US-004)
  LAST_ROLLBACK_COUNT=0
  LAST_ROLLBACK_REASON=""
  LAST_ROLLBACK_SUCCESS=""

  # Reset switch tracking for this iteration (US-003, US-004)
  LAST_SWITCH_COUNT=0
  LAST_SWITCH_FROM=""
  LAST_SWITCH_TO=""
  LAST_SWITCH_REASON=""
  # Initialize with current agent for metrics tracking (US-004)
  AGENTS_TRIED_THIS_ITERATION="$CURRENT_AGENT"
  # Initialize retry history for this iteration (P1.4)
  RETRY_HISTORY_THIS_ITERATION=""
  if [ "$MODE" = "build" ]; then
    STORY_META="$TMP_DIR/story-$RUN_TAG-$i.json"
    STORY_BLOCK="$TMP_DIR/story-$RUN_TAG-$i.md"
    # Use locked story selection to prevent parallel builds picking same story (P1.3)
    select_story_locked "$(dirname "$PRD_PATH")" "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"
    if [ "$REMAINING" = "unknown" ]; then
      msg_error "Could not parse stories from PRD: $PRD_PATH"
      exit 1
    fi
    if [ "$REMAINING" = "0" ]; then
      # Clear checkpoint and switch state on successful completion
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      clear_checkpoint "$PRD_FOLDER"
      clear_switch_state "$PRD_FOLDER"
      msg_success "No remaining stories."
      exit 0
    fi
    STORY_ID="$(story_field "$STORY_META" "id")"
    STORY_TITLE="$(story_field "$STORY_META" "title")"

    # Emit status: planning phase complete, entering execution (US-001)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    ELAPSED=$(elapsed_since "$BUILD_START")
    update_status "$PRD_FOLDER" "planning" "$i" "$STORY_ID" "$STORY_TITLE" "$ELAPSED"

    # Check for experiment assignment (may override AGENT_CMD for this story)
    get_experiment_assignment "$STORY_ID"

    # Print current story being worked on
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_CYAN}  Working on: ${C_BOLD}$STORY_ID${C_RESET}${C_CYAN} - $STORY_TITLE${C_RESET}\n"

    # Check for high-risk story (US-002)
    if ! check_risk "$STORY_BLOCK"; then
      msg_warn "Skipping high-risk story $STORY_ID (user declined or non-interactive mode)"
      # Track skipped iteration for summary
      ITER_END=$(date +%s)
      ITER_DURATION=$((ITER_END - ITER_START))
      ITERATION_COUNT=$((ITERATION_COUNT + 1))
      TOTAL_DURATION=$((TOTAL_DURATION + ITER_DURATION))
      ITERATION_RESULTS="${ITERATION_RESULTS}${ITERATION_RESULTS:+,}$i|$STORY_ID|$ITER_DURATION|skipped-risk|0"
      continue
    fi

    # Get model routing decision
    ROUTING_JSON="$(get_routing_decision "$STORY_BLOCK" "${RALPH_MODEL_OVERRIDE:-}")"
    ROUTED_MODEL="$(parse_routing_field "$ROUTING_JSON" "model")"
    ROUTED_SCORE="$(parse_routing_field "$ROUTING_JSON" "score")"
    ROUTED_REASON="$(parse_routing_field "$ROUTING_JSON" "reason")"
    ROUTED_OVERRIDE="$(parse_routing_field "$ROUTING_JSON" "override")"

    # Parse complexity breakdown from routing JSON
    ROUTED_BREAKDOWN="$(parse_routing_field "$ROUTING_JSON" "breakdown")"

    # Display routing decision with enhanced visualization
    printf "${C_DIM}  ┌─ Routing Decision ────────────────────────────────${C_RESET}\n"
    if [ "$ROUTED_OVERRIDE" = "true" ]; then
      printf "${C_DIM}  │${C_RESET} ${C_YELLOW}Model: ${C_BOLD}$ROUTED_MODEL${C_RESET}${C_YELLOW} (manual override)${C_RESET}\n"
    elif [ -n "$ROUTED_SCORE" ]; then
      # Determine complexity level and color
      level_color="$C_GREEN"
      level_label="low"
      if [ "$(echo "$ROUTED_SCORE > 3" | bc -l 2>/dev/null || echo "0")" = "1" ]; then
        level_color="$C_YELLOW"
        level_label="medium"
      fi
      if [ "$(echo "$ROUTED_SCORE > 7" | bc -l 2>/dev/null || echo "0")" = "1" ]; then
        level_color="$C_RED"
        level_label="high"
      fi
      printf "${C_DIM}  │${C_RESET} Complexity: ${level_color}${C_BOLD}${ROUTED_SCORE}/10${C_RESET} (${level_label})\n"
      printf "${C_DIM}  │${C_RESET} Model: ${C_BOLD}$ROUTED_MODEL${C_RESET}\n"
      printf "${C_DIM}  │${C_RESET} Reason: ${C_DIM}$ROUTED_REASON${C_RESET}\n"
    else
      printf "${C_DIM}  │${C_RESET} Model: ${C_BOLD}$ROUTED_MODEL${C_RESET}${C_DIM} (default - routing unavailable)${C_RESET}\n"
    fi

    # Get and display estimated cost before execution
    ESTIMATED_COST_JSON="$(estimate_execution_cost "$ROUTED_MODEL" "$ROUTED_SCORE")"
    ESTIMATED_COST="$(parse_routing_field "$ESTIMATED_COST_JSON" "estimatedCost")"
    ESTIMATED_COST_RANGE="$(parse_routing_field "$ESTIMATED_COST_JSON" "costRange")"
    ESTIMATED_TOKENS="$(parse_routing_field "$ESTIMATED_COST_JSON" "estimatedTokens")"
    ESTIMATED_COMPARISON="$(parse_routing_field "$ESTIMATED_COST_JSON" "comparison")"
    if [ -n "$ESTIMATED_COST" ] && [ "$ESTIMATED_COST" != "null" ]; then
      printf "${C_DIM}  │${C_RESET} Est. cost: ${C_CYAN}\$${ESTIMATED_COST}${C_RESET}"
      if [ -n "$ESTIMATED_COST_RANGE" ] && [ "$ESTIMATED_COST_RANGE" != "null" ]; then
        printf " ${C_DIM}($ESTIMATED_COST_RANGE)${C_RESET}"
      fi
      printf "\n"
      if [ -n "$ESTIMATED_COMPARISON" ] && [ "$ESTIMATED_COMPARISON" != "null" ]; then
        printf "${C_DIM}  │${C_RESET} ${C_DIM}$ESTIMATED_COMPARISON${C_RESET}\n"
      fi
    fi
    printf "${C_DIM}  └────────────────────────────────────────────────────${C_RESET}\n"

    # Log model selection to activity log
    log_activity "MODEL_SELECTION story=$STORY_ID complexity=${ROUTED_SCORE:-n/a} model=$ROUTED_MODEL reason=\"$ROUTED_REASON\" estimated_cost=\$${ESTIMATED_COST:-n/a}"
  fi

  HEAD_BEFORE="$(git_head)"
  PROMPT_RENDERED="$TMP_DIR/prompt-$RUN_TAG-$i.md"
  LOG_FILE="$RUNS_DIR/run-$RUN_TAG-iter-$i.log"
  RUN_META="$RUNS_DIR/run-$RUN_TAG-iter-$i.md"
  render_prompt "$PROMPT_FILE" "$PROMPT_RENDERED" "$STORY_META" "$STORY_BLOCK" "$RUN_TAG" "$i" "$LOG_FILE" "$RUN_META"

  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    log_activity "ITERATION $i start (mode=$MODE story=$STORY_ID)"
    # Log iteration start as info event (US-002)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    log_event_info "$PRD_FOLDER" "Iteration started" "iteration=$i story=$STORY_ID mode=$MODE"
  else
    log_activity "ITERATION $i start (mode=$MODE)"
  fi

  # Save checkpoint before story execution (build mode only)
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    save_checkpoint "$PRD_FOLDER" "$ACTIVE_PRD_NUMBER" "$i" "$STORY_ID" "$HEAD_BEFORE" "$DEFAULT_AGENT_NAME" "${TOTAL_BUILD_COST:-0}"
  fi

  # Emit status: entering executing phase (US-001)
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    ELAPSED=$(elapsed_since "$BUILD_START")
    update_status "$PRD_FOLDER" "executing" "$i" "$STORY_ID" "$STORY_TITLE" "$ELAPSED"
  fi

  set +e
  # Start progress indicator before agent execution (US-001)
  PRD_FOLDER="$(dirname "$PRD_PATH")"
  start_progress_indicator "$ITER_START" "$PRD_FOLDER"

  # Start stall detector for production monitoring (US-009)
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    start_stall_detector "$PRD_FOLDER" "$i" "$STORY_ID" "$CURRENT_AGENT" "$ACTIVITY_LOG_PATH"
  fi

  if [ "${RALPH_DRY_RUN:-}" = "1" ]; then
    echo "[RALPH_DRY_RUN] Skipping agent execution." | tee "$LOG_FILE"
    CMD_STATUS=0
  else
    # Use retry wrapper for automatic retries with exponential backoff
    # Includes heartbeat updates on every line of output (US-009)
    run_agent_with_retry "$PROMPT_RENDERED" "$LOG_FILE" "$i"
    CMD_STATUS=$?
  fi

  # Stop stall detector after agent execution (US-009)
  stop_stall_detector
  # Clear any stalled marker if execution completed (US-009)
  clear_stalled_marker "$PRD_FOLDER"

  # Stop progress indicator after agent execution
  stop_progress_indicator
  set -e
  if [ "$CMD_STATUS" -eq 130 ] || [ "$CMD_STATUS" -eq 143 ]; then
    msg_warn "Interrupted."
    exit "$CMD_STATUS"
  fi
  ITER_END=$(date +%s)
  ITER_END_FMT=$(date '+%Y-%m-%d %H:%M:%S')
  ITER_DURATION=$((ITER_END - ITER_START))
  HEAD_AFTER="$(git_head)"
  log_activity "ITERATION $i end (duration=${ITER_DURATION}s)"
  if [ "$CMD_STATUS" -ne 0 ]; then
    log_error "ITERATION $i command failed (status=$CMD_STATUS)"
    HAS_ERROR="true"
    # Track failed iteration details for summary
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_ITERATIONS="${FAILED_ITERATIONS}${FAILED_ITERATIONS:+,}$i:${STORY_ID:-plan}:$LOG_FILE"

    # Log error event with context to .events.log (US-002 + US-004)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    local error_context
    error_context=$(extract_error_context "$LOG_FILE")
    log_event_error_with_context "$PRD_FOLDER" "Iteration failed" "exit_code=$CMD_STATUS" "$LOG_FILE" "$i" "${STORY_ID:-plan}" "$CURRENT_AGENT"
    display_error_with_context "Iteration $i failed" "story=${STORY_ID:-plan} exit_code=$CMD_STATUS agent=$CURRENT_AGENT" "$error_context"

    # Track failure for agent switching (US-001)
    if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
      track_failure "$CMD_STATUS" "$LOG_FILE" "$STORY_ID"
      save_switch_state "$PRD_FOLDER"
      # Check if we should switch agents (US-002)
      if switch_threshold_reached; then
        if ! switch_to_next_agent; then
          # Fix P0.5: Agent fallback chain exhausted - all agents failed
          msg_error "Agent fallback chain exhausted - all agents failed for story $STORY_ID"
          log_error "CHAIN_EXHAUSTED story=$STORY_ID - manual intervention required"
          # Log chain exhausted as error event with context (US-002 + US-004)
          local chain_error_context
          chain_error_context=$(extract_error_context "$LOG_FILE")
          log_event_error_with_context "$PRD_FOLDER" "Agent fallback chain exhausted" "" "$LOG_FILE" "$i" "$STORY_ID" "$CURRENT_AGENT"
          display_error_with_context "Agent fallback chain exhausted" "story=$STORY_ID iteration=$i" "$chain_error_context"
          # Continue to next iteration rather than infinite loop
          # Story remains unchecked and can be retried manually later
        else
          # Reset failure count after successful switch
          CONSECUTIVE_FAILURES=0
          save_switch_state "$PRD_FOLDER"
          # Log agent switch as warning event (US-002)
          log_event_warn "$PRD_FOLDER" "Switching agent" "from=$LAST_SWITCH_FROM to=$CURRENT_AGENT story=$STORY_ID"
          display_event "WARN" "Switching agent to $CURRENT_AGENT" "story=$STORY_ID"
          msg_info "Will retry story $STORY_ID with agent $CURRENT_AGENT in next iteration"
        fi
      fi
    fi
  fi
  COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
  CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"
  DIRTY_FILES="$(git_dirty_files)"
  STATUS_LABEL="success"
  if [ "$CMD_STATUS" -ne 0 ]; then
    STATUS_LABEL="error"
  else
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    # Log iteration success as info event (US-002)
    if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      log_event_info "$PRD_FOLDER" "Iteration completed" "iteration=$i story=$STORY_ID duration=${ITER_DURATION}s"
    fi
    # Reset failure tracking on success (US-001)
    if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
      reset_failure_tracking
      # Reset chain position to primary agent on success (US-002)
      reset_chain_position
    fi
  fi
  # Track iteration result for summary table
  ITERATION_COUNT=$((ITERATION_COUNT + 1))
  TOTAL_DURATION=$((TOTAL_DURATION + ITER_DURATION))
  ITERATION_RESULTS="${ITERATION_RESULTS}${ITERATION_RESULTS:+,}$i|${STORY_ID:-plan}|$ITER_DURATION|$STATUS_LABEL|$LAST_RETRY_COUNT"

  if [ "$MODE" = "build" ] && [ "$NO_COMMIT" = "false" ] && [ -n "$DIRTY_FILES" ]; then
    msg_warn "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
    log_error "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
    # Log uncommitted changes as warning event (US-002)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    log_event_warn "$PRD_FOLDER" "Uncommitted changes" "iteration=$i story=${STORY_ID:-plan}"
    display_event "WARN" "Uncommitted changes after iteration $i" "story=${STORY_ID:-plan}"
  fi

  # Extract token metrics from log file
  TOKEN_JSON="$(extract_tokens_from_log "$LOG_FILE")"
  TOKEN_INPUT="$(parse_token_field "$TOKEN_JSON" "inputTokens")"
  TOKEN_OUTPUT="$(parse_token_field "$TOKEN_JSON" "outputTokens")"
  TOKEN_MODEL="$(parse_token_field "$TOKEN_JSON" "model")"
  TOKEN_ESTIMATED="$(parse_token_field "$TOKEN_JSON" "estimated")"

  # Update cost tracking with this iteration's tokens (US-007)
  ITERATION_COST="$(update_cost "$PRD_FOLDER_FOR_COST" "$i" "${STORY_ID:-plan}" "$LOG_FILE" "${TOKEN_MODEL:-sonnet}")"
  TOTAL_BUILD_COST="$(get_total_cost "$PRD_FOLDER_FOR_COST")"

  # Check budget and enforce limits (US-008)
  update_budget_usage "$PRD_FOLDER_FOR_COST" "$TOTAL_BUILD_COST"
  if ! check_and_enforce_budget "$PRD_FOLDER_FOR_COST" "$TOTAL_BUILD_COST"; then
    log_event_warn "$PRD_FOLDER_FOR_COST" "Build stopped: budget limit exceeded" "cost=$TOTAL_BUILD_COST"
    msg_warn "Build stopped due to budget limit. Use 'ralph budget set <amount>' to increase limit."
    exit 0
  fi

  # Build JSON object for run metadata
  RUN_META_JSON=$(python3 -c "import json, sys; print(json.dumps({
    'mode': '$MODE',
    'iteration': '$i',
    'run_id': '$RUN_TAG',
    'story_id': '${STORY_ID:-}',
    'story_title': '${STORY_TITLE:-}',
    'started': '$ITER_START_FMT',
    'ended': '$ITER_END_FMT',
    'duration': '$ITER_DURATION',
    'status': '$STATUS_LABEL',
    'log_file': '$LOG_FILE',
    'head_before': '$HEAD_BEFORE',
    'head_after': '$HEAD_AFTER',
    'commit_list': '''$COMMIT_LIST''',
    'changed_files': '''$CHANGED_FILES''',
    'dirty_files': '''$DIRTY_FILES''',
    'input_tokens': '$TOKEN_INPUT',
    'output_tokens': '$TOKEN_OUTPUT',
    'token_model': '$TOKEN_MODEL',
    'token_estimated': '$TOKEN_ESTIMATED',
    'retry_count': '$LAST_RETRY_COUNT',
    'retry_time': '$LAST_RETRY_TOTAL_TIME',
    'routed_model': '${ROUTED_MODEL:-}',
    'complexity_score': '${ROUTED_SCORE:-}',
    'routing_reason': '${ROUTED_REASON:-}',
    'est_cost': '${ESTIMATED_COST:-}',
    'est_tokens': '${ESTIMATED_TOKENS:-}',
    'switch_count': '$LAST_SWITCH_COUNT',
    'switch_from': '$LAST_SWITCH_FROM',
    'switch_to': '$LAST_SWITCH_TO',
    'switch_reason': '$LAST_SWITCH_REASON',
    'iteration_cost': '$ITERATION_COST',
    'total_cost': '$TOTAL_BUILD_COST'
  }))" 2>/dev/null || echo '{}')

  write_run_meta "$RUN_META" "$RUN_META_JSON"

  # Append context summary to run meta (build mode only)
  if [ "$MODE" = "build" ] && [ -n "${STORY_BLOCK:-}" ]; then
    CONTEXT_SUMMARY="$(generate_context_summary "$STORY_BLOCK" "${ROUTED_MODEL:-sonnet}" 15 "$ROOT_DIR")"
    if [ -n "$CONTEXT_SUMMARY" ]; then
      append_context_to_run_meta "$RUN_META" "$CONTEXT_SUMMARY"
    fi
  fi

  # Note: append_metrics is called after rollback logic to capture both rollback and switch data
  # See the metrics call below the rollback section

  # Display iteration cost in CLI (US-007)
  if [ -n "$ITERATION_COST" ] && [ "$ITERATION_COST" != "0" ]; then
    FORMATTED_ITER_COST="$(format_cost "$ITERATION_COST")"
    FORMATTED_TOTAL_COST="$(format_cost "$TOTAL_BUILD_COST")"
    printf "${C_DIM}  💰 Cost: %s (iteration) | %s (total)${C_RESET}\n" "$FORMATTED_ITER_COST" "$FORMATTED_TOTAL_COST"
  fi

  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | story=$STORY_ID | duration=${ITER_DURATION}s | status=$STATUS_LABEL | cost=${ITERATION_COST:-0}"
  else
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | duration=${ITER_DURATION}s | status=$STATUS_LABEL | cost=${ITERATION_COST:-0}"
  fi

  if [ "$MODE" = "build" ]; then
    # Use locked story selection to prevent parallel builds picking same story (P1.3)
    select_story_locked "$(dirname "$PRD_PATH")" "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"

    # ─────────────────────────────────────────────────────────────────────────
    # Rollback on Failure (US-001 + US-003)
    # Check for failures based on ROLLBACK_TRIGGER config and rollback to pre-story state
    # ─────────────────────────────────────────────────────────────────────────
    if [ "$CMD_STATUS" -ne 0 ] && [ "${ROLLBACK_ENABLED:-true}" = "true" ] && [ "$NO_COMMIT" = "false" ]; then
      # US-003: Check for story-level rollback skip via <!-- no-rollback --> comment
      if story_has_no_rollback "${STORY_BLOCK:-}"; then
        log_activity "ROLLBACK_SKIPPED story=$STORY_ID reason=no-rollback-directive"
        msg_dim "Rollback skipped: story has <!-- no-rollback --> directive"
      # Check if failure matches configured trigger policy (US-003)
      elif detect_failure "$LOG_FILE" "${ROLLBACK_TRIGGER:-test-fail}"; then
        log_activity "FAILURE_DETECTED story=$STORY_ID trigger=${ROLLBACK_TRIGGER:-test-fail}"

        # Save failure context for retry before rollback
        FAILURE_CONTEXT_FILE="$(save_failure_context "$LOG_FILE" "$RUNS_DIR" "$RUN_TAG" "$i" "${STORY_ID:-unknown}")"

        # Determine failure reason based on trigger policy for notification
        local failure_reason
        case "${ROLLBACK_TRIGGER:-test-fail}" in
          test-fail) failure_reason="Test failure detected" ;;
          lint-fail) failure_reason="Lint failure detected" ;;
          type-fail) failure_reason="Type check failure detected" ;;
          any-fail)  failure_reason="Build failure detected (any-fail policy)" ;;
          *)         failure_reason="Failure detected" ;;
        esac

        # Perform rollback to pre-story state
        if rollback_to_checkpoint "$HEAD_BEFORE" "${STORY_ID:-unknown}" "${ROLLBACK_TRIGGER:-test-fail}"; then
          # Notify user of successful rollback
          notify_rollback "${STORY_ID:-unknown}" "$failure_reason" "$HEAD_BEFORE" "$FAILURE_CONTEXT_FILE"
          log_activity "ROLLBACK_SUCCESS story=$STORY_ID context=$FAILURE_CONTEXT_FILE"
          # Log rollback event for history tracking (US-004)
          log_rollback "${STORY_ID:-unknown}" "${ROLLBACK_TRIGGER:-test-fail}" "$(git_head)" "$HEAD_BEFORE" "1" "true" "$FAILURE_CONTEXT_FILE"

          # Update rollback tracking variables for metrics (US-004)
          LAST_ROLLBACK_COUNT=$((LAST_ROLLBACK_COUNT + 1))
          LAST_ROLLBACK_REASON="${ROLLBACK_TRIGGER:-test-fail}"
          LAST_ROLLBACK_SUCCESS="true"

          # Update HEAD_AFTER to reflect rollback
          HEAD_AFTER="$(git_head)"
          COMMIT_LIST=""
          CHANGED_FILES=""

          # ─────────────────────────────────────────────────────────────────────
          # Intelligent Retry (US-002)
          # Retry the story with enhanced context after successful rollback
          # ─────────────────────────────────────────────────────────────────────
          if [ "${ROLLBACK_RETRY_ENABLED:-true}" = "true" ]; then
            ROLLBACK_MAX="${ROLLBACK_MAX_RETRIES:-3}"

            # Track retry attempts for this story (use a simple file-based approach)
            RETRY_TRACKING_FILE="$RUNS_DIR/retry-count-${STORY_ID:-unknown}.txt"
            if [ -f "$RETRY_TRACKING_FILE" ]; then
              CURRENT_RETRY_COUNT=$(cat "$RETRY_TRACKING_FILE")
            else
              CURRENT_RETRY_COUNT=0
            fi

            CURRENT_RETRY_COUNT=$((CURRENT_RETRY_COUNT + 1))
            atomic_write "$RETRY_TRACKING_FILE" "$CURRENT_RETRY_COUNT"  # Fix P0.3: atomic write

            if [ "$CURRENT_RETRY_COUNT" -le "$ROLLBACK_MAX" ]; then
              printf "\n"
              printf "${C_CYAN}${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
              printf "${C_CYAN}${C_BOLD}║            INTELLIGENT RETRY (US-002)                 ║${C_RESET}\n"
              printf "${C_CYAN}${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
              printf "\n"
              printf "  ${C_BOLD}Story:${C_RESET}  %s\n" "${STORY_ID:-unknown}"
              printf "  ${C_BOLD}Retry:${C_RESET}  %s of %s\n" "$CURRENT_RETRY_COUNT" "$ROLLBACK_MAX"
              printf "  ${C_BOLD}Context:${C_RESET} %s\n" "$FAILURE_CONTEXT_FILE"
              printf "\n"
              printf "${C_DIM}  Preparing enhanced retry prompt with failure context...${C_RESET}\n"
              printf "\n"

              log_activity "ROLLBACK_RETRY story=$STORY_ID attempt=$CURRENT_RETRY_COUNT/$ROLLBACK_MAX context=$FAILURE_CONTEXT_FILE"

              # Render retry prompt with failure context
              RETRY_PROMPT_RENDERED="$TMP_DIR/prompt-retry-$RUN_TAG-$i-retry$CURRENT_RETRY_COUNT.md"
              RETRY_LOG_FILE="$RUNS_DIR/run-$RUN_TAG-iter-$i-retry$CURRENT_RETRY_COUNT.log"
              RETRY_RUN_META="$RUNS_DIR/run-$RUN_TAG-iter-$i-retry$CURRENT_RETRY_COUNT.md"

              render_retry_prompt "$PROMPT_RETRY" "$RETRY_PROMPT_RENDERED" "$STORY_META" "$STORY_BLOCK" "$RUN_TAG" "$i" "$RETRY_LOG_FILE" "$RETRY_RUN_META" "$FAILURE_CONTEXT_FILE" "$CURRENT_RETRY_COUNT" "$ROLLBACK_MAX"

              # Execute retry
              RETRY_START=$(date +%s)
              set +e
              PRD_FOLDER="$(dirname "$PRD_PATH")"
              start_progress_indicator "$RETRY_START" "$PRD_FOLDER"
              run_agent_with_retry "$RETRY_PROMPT_RENDERED" "$RETRY_LOG_FILE" "$i"
              RETRY_STATUS=$?
              stop_progress_indicator
              set -e

              RETRY_END=$(date +%s)
              RETRY_DURATION=$((RETRY_END - RETRY_START))

              # Track retry attempt in history (P1.4)
              if [ -n "$RETRY_HISTORY_THIS_ITERATION" ]; then
                RETRY_HISTORY_THIS_ITERATION="${RETRY_HISTORY_THIS_ITERATION}|attempt=$CURRENT_RETRY_COUNT status=$RETRY_STATUS duration=${RETRY_DURATION}s"
              else
                RETRY_HISTORY_THIS_ITERATION="attempt=$CURRENT_RETRY_COUNT status=$RETRY_STATUS duration=${RETRY_DURATION}s"
              fi

              if [ "$RETRY_STATUS" -eq 0 ]; then
                # Retry succeeded! Log success for rollback history (US-004)
                log_rollback "${STORY_ID:-unknown}" "retry_success" "$HEAD_BEFORE" "$(git_head)" "$CURRENT_RETRY_COUNT" "true" "$FAILURE_CONTEXT_FILE"
                printf "${C_GREEN}${C_BOLD}  Retry $CURRENT_RETRY_COUNT SUCCEEDED${C_RESET}\n"
                log_activity "ROLLBACK_RETRY_SUCCESS story=$STORY_ID attempt=$CURRENT_RETRY_COUNT duration=${RETRY_DURATION}s"

                # Update rollback tracking - mark as success since retry worked (US-004)
                LAST_ROLLBACK_COUNT=$CURRENT_RETRY_COUNT
                LAST_ROLLBACK_REASON="retry_success"
                LAST_ROLLBACK_SUCCESS="true"

                # Clear retry tracking file on success
                atomic_delete "$RETRY_TRACKING_FILE"  # Fix P0.3: atomic delete

                # Update metrics with successful retry
                CMD_STATUS=0
                STATUS_LABEL="success"
                RETRY_SUCCESS_COUNT=$((RETRY_SUCCESS_COUNT + 1))  # Fix P0.2: separate retry counter
                HEAD_AFTER="$(git_head)"
                COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
                CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"

                # Update run meta for the retry
                RETRY_META_JSON=$(python3 -c "import json; print(json.dumps({
                  'mode': '$MODE',
                  'iteration': '$i',
                  'run_id': '$RUN_TAG',
                  'story_id': '${STORY_ID:-}',
                  'story_title': '${STORY_TITLE:-} (Retry $CURRENT_RETRY_COUNT)',
                  'started': '$ITER_START_FMT',
                  'ended': '$(date '+%Y-%m-%d %H:%M:%S')',
                  'duration': '$RETRY_DURATION',
                  'status': 'success',
                  'log_file': '$RETRY_LOG_FILE',
                  'head_before': '$HEAD_BEFORE',
                  'head_after': '$HEAD_AFTER',
                  'commit_list': '''$COMMIT_LIST''',
                  'changed_files': '''$CHANGED_FILES''',
                  'dirty_files': '',
                  'input_tokens': '',
                  'output_tokens': '',
                  'token_model': '',
                  'token_estimated': 'false',
                  'retry_count': '0',
                  'retry_time': '0',
                  'routed_model': '',
                  'complexity_score': '',
                  'routing_reason': '',
                  'est_cost': '',
                  'est_tokens': '',
                  'switch_count': '0',
                  'switch_from': '',
                  'switch_to': '',
                  'switch_reason': ''
                }))" 2>/dev/null || echo '{}')
                write_run_meta "$RETRY_RUN_META" "$RETRY_META_JSON"
              else
                # Retry failed
                printf "${C_YELLOW}  Retry $CURRENT_RETRY_COUNT failed${C_RESET}\n"
                log_activity "ROLLBACK_RETRY_FAILED story=$STORY_ID attempt=$CURRENT_RETRY_COUNT duration=${RETRY_DURATION}s"

                # Check if we should rollback this retry too (use same trigger policy)
                if detect_failure "$RETRY_LOG_FILE" "${ROLLBACK_TRIGGER:-test-fail}"; then
                  log_activity "RETRY_FAILURE story=$STORY_ID attempt=$CURRENT_RETRY_COUNT trigger=${ROLLBACK_TRIGGER:-test-fail}"
                  # Save new failure context
                  FAILURE_CONTEXT_FILE="$(save_failure_context "$RETRY_LOG_FILE" "$RUNS_DIR" "$RUN_TAG" "$i-retry$CURRENT_RETRY_COUNT" "${STORY_ID:-unknown}")"
                  # Rollback the retry attempt
                  if rollback_to_checkpoint "$HEAD_BEFORE" "${STORY_ID:-unknown}" "retry_${ROLLBACK_TRIGGER:-test-fail}"; then
                    # Log retry rollback for history tracking (US-004)
                    log_rollback "${STORY_ID:-unknown}" "retry_${ROLLBACK_TRIGGER:-test-fail}" "$(git_head)" "$HEAD_BEFORE" "$CURRENT_RETRY_COUNT" "true" "$FAILURE_CONTEXT_FILE"
                  fi
                fi
              fi
            else
              # Max retries exhausted
              printf "\n"
              printf "${C_RED}${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
              printf "${C_RED}${C_BOLD}║          MAX RETRIES EXHAUSTED                        ║${C_RESET}\n"
              printf "${C_RED}${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
              printf "\n"
              printf "  ${C_BOLD}Story:${C_RESET}  %s\n" "${STORY_ID:-unknown}"
              printf "  ${C_BOLD}Attempts:${C_RESET} %s (max: %s)\n" "$CURRENT_RETRY_COUNT" "$ROLLBACK_MAX"
              printf "\n"
              printf "${C_DIM}  Story will be skipped. Review failure context and fix manually.${C_RESET}\n"
              printf "${C_DIM}  Context file: %s${C_RESET}\n" "$FAILURE_CONTEXT_FILE"
              printf "\n"

              log_activity "MAX_RETRIES_EXHAUSTED story=$STORY_ID attempts=$CURRENT_RETRY_COUNT max=$ROLLBACK_MAX"
              log_error "MAX_RETRIES_EXHAUSTED story=$STORY_ID - manual intervention required"
              # Log max retries exhausted as error event with context (US-002 + US-004)
              PRD_FOLDER="$(dirname "$PRD_PATH")"
              local max_retry_error_context
              max_retry_error_context=$(extract_error_context "${FAILURE_CONTEXT_FILE:-$LOG_FILE}")
              log_event_error_with_context "$PRD_FOLDER" "Max retries exhausted" "attempts=$CURRENT_RETRY_COUNT max=$ROLLBACK_MAX" "${FAILURE_CONTEXT_FILE:-$LOG_FILE}" "$i" "$STORY_ID" "$CURRENT_AGENT"
              display_error_with_context "Max retries exhausted" "story=$STORY_ID attempts=$CURRENT_RETRY_COUNT agent=$CURRENT_AGENT" "$max_retry_error_context"
              # Log max retries exhausted for history tracking (US-004)
              log_rollback "${STORY_ID:-unknown}" "max_retries_exhausted" "$(git_head)" "$HEAD_BEFORE" "$CURRENT_RETRY_COUNT" "false" "$FAILURE_CONTEXT_FILE"

              # Update rollback tracking - mark as failure since max retries exhausted (US-004)
              LAST_ROLLBACK_COUNT=$CURRENT_RETRY_COUNT
              LAST_ROLLBACK_REASON="max_retries_exhausted"
              LAST_ROLLBACK_SUCCESS="false"

              # Clear retry tracking file
              atomic_delete "$RETRY_TRACKING_FILE"  # Fix P0.3: atomic delete
            fi
          fi
        else
          log_error "ROLLBACK_FAILED story=${STORY_ID:-unknown}"
          msg_error "Rollback failed - manual intervention may be required"
          # Log rollback failure as error event with context (US-002 + US-004)
          PRD_FOLDER="$(dirname "$PRD_PATH")"
          local rollback_error_context
          rollback_error_context=$(extract_error_context "${FAILURE_CONTEXT_FILE:-$LOG_FILE}")
          log_event_error_with_context "$PRD_FOLDER" "Rollback failed" "trigger=${ROLLBACK_TRIGGER:-test-fail}" "${FAILURE_CONTEXT_FILE:-$LOG_FILE}" "$i" "${STORY_ID:-unknown}" "$CURRENT_AGENT"
          display_error_with_context "Rollback failed" "story=${STORY_ID:-unknown} trigger=${ROLLBACK_TRIGGER:-test-fail} agent=$CURRENT_AGENT" "$rollback_error_context"
          # Log failed rollback for history tracking (US-004)
          log_rollback "${STORY_ID:-unknown}" "${ROLLBACK_TRIGGER:-test-fail}" "$(git_head)" "$HEAD_BEFORE" "1" "false" "${FAILURE_CONTEXT_FILE:-}"

          # Update rollback tracking variables for metrics (US-004)
          LAST_ROLLBACK_COUNT=$((LAST_ROLLBACK_COUNT + 1))
          LAST_ROLLBACK_REASON="${ROLLBACK_TRIGGER:-test-fail}"
          LAST_ROLLBACK_SUCCESS="false"
        fi
      fi
    fi

    # Append metrics to metrics.jsonl for historical tracking (build mode only)
    # Called after rollback logic to capture rollback data (US-004)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    # Use routing decision model (ROUTED_MODEL) instead of log-extracted model (TOKEN_MODEL)
    # TOKEN_MODEL is unreliable as it pattern-matches log content, not actual model used
    FINAL_MODEL="${ROUTED_MODEL:-${TOKEN_MODEL:-unknown}}"
    append_metrics "$PRD_FOLDER" "${STORY_ID}" "${STORY_TITLE:-}" "$ITER_DURATION" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$DEFAULT_AGENT_NAME" "$FINAL_MODEL" "$STATUS_LABEL" "$RUN_TAG" "$i" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "${ROUTED_SCORE:-}" "${ROUTED_REASON:-}" "${ESTIMATED_COST:-}" "${EXPERIMENT_NAME:-}" "${EXPERIMENT_VARIANT:-}" "${EXPERIMENT_EXCLUDED:-}" "$LAST_ROLLBACK_COUNT" "$LAST_ROLLBACK_REASON" "$LAST_ROLLBACK_SUCCESS" "$LAST_SWITCH_COUNT" "$AGENTS_TRIED_THIS_ITERATION" "" "$RETRY_HISTORY_THIS_ITERATION"

    if [ "$CMD_STATUS" -ne 0 ]; then
      # Differentiate agent errors vs system errors
      if [ "$CMD_STATUS" -eq 1 ]; then
        show_error "ITERATION $i: Agent exited with error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "agent"
      else
        show_error "ITERATION $i: System/command error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "system"
      fi
      log_error "ITERATION $i exited non-zero (code=$CMD_STATUS); review $LOG_FILE"
    fi
    if grep -q "<promise>COMPLETE</promise>" "$LOG_FILE"; then
      if [ "$REMAINING" = "0" ]; then
        printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
        printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
        printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
        # Print summary table before exit
        print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
        # Print auto-fix summary if any fixes were applied (US-003)
        PRD_FOLDER="$(dirname "$PRD_PATH")"
        print_fix_summary "$PRD_FOLDER"
        rebuild_token_cache
        # Clear checkpoint and switch state on successful completion
        clear_checkpoint "$PRD_FOLDER"
        clear_switch_state "$PRD_FOLDER"
        # Extract PRD number from folder path for completion instructions
        local prd_num=""
        if [[ "$PRD_FOLDER" =~ PRD-([0-9]+) ]]; then
          prd_num="${BASH_REMATCH[1]}"
        fi
        show_completion_instructions "$prd_num"
        exit 0
      fi
      msg_info "Completion signal received; stories remaining: $REMAINING"
    fi
    # Validate PRD scope (sequential mode) before marking iteration complete
    if ! validate_prd_scope; then
      # Scope validation failed - iteration was rolled back
      log_error "ITERATION $i: Scope violation detected - rolled back"
      FAILED_COUNT=$((FAILED_COUNT + 1))
      FAILED_ITERATIONS="${FAILED_ITERATIONS}${FAILED_ITERATIONS:+,}$i"
      ITERATION_RESULTS="${ITERATION_RESULTS}${ITERATION_RESULTS:+,}$i|${STORY_ID:-}|$ITER_DURATION|scope-violation|0"
      HAS_ERROR=true
      # Continue to next iteration
      continue
    fi

    # Iteration completion separator
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
    printf "${C_CYAN}═══════════════════────────════════════────────────────${C_RESET}\n"
    msg_success "Iteration $i complete. Remaining stories: $REMAINING"
    if [ "$REMAINING" = "0" ]; then
      # Print summary table before exit
      print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
      # Print auto-fix summary if any fixes were applied (US-003)
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      print_fix_summary "$PRD_FOLDER"
      rebuild_token_cache
      # Clear checkpoint and switch state on successful completion
      clear_checkpoint "$PRD_FOLDER"
      clear_switch_state "$PRD_FOLDER"
      # Extract PRD number from folder path for completion instructions
      local prd_num=""
      if [[ "$PRD_FOLDER" =~ PRD-([0-9]+) ]]; then
        prd_num="${BASH_REMATCH[1]}"
      fi
      show_completion_instructions "$prd_num"
      exit 0
    fi
  else
    # Handle plan mode errors
    if [ "$CMD_STATUS" -ne 0 ]; then
      # Differentiate agent errors vs system errors
      if [ "$CMD_STATUS" -eq 1 ]; then
        show_error "ITERATION $i: Agent exited with error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "agent"
      else
        show_error "ITERATION $i: System/command error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "system"
      fi
      log_error "ITERATION $i (plan) exited non-zero (code=$CMD_STATUS); review $LOG_FILE"
    fi
    # Iteration completion separator (plan mode)
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
    printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
    msg_success "Iteration $i complete."
  fi
  sleep 2

done

# Clear status file and heartbeat when build completes (US-001, US-009)
if [ "$MODE" = "build" ] && [ -n "${PRD_PATH:-}" ]; then
  PRD_FOLDER="$(dirname "$PRD_PATH")"
  clear_status "$PRD_FOLDER"
  clear_heartbeat "$PRD_FOLDER"
  clear_stalled_marker "$PRD_FOLDER"
fi

# Get final remaining count for summary
FINAL_REMAINING="${REMAINING:-unknown}"
if [ "$MODE" = "build" ] && [ -f "$STORY_META" ]; then
  FINAL_REMAINING="$(remaining_stories "$STORY_META")"
fi

# Print iteration summary table
print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "$FINAL_REMAINING"

# Print auto-fix summary if any fixes were applied (US-003)
if [ -n "${PRD_PATH:-}" ]; then
  PRD_FOLDER="$(dirname "$PRD_PATH")"
  print_fix_summary "$PRD_FOLDER"
fi

# Rebuild token cache for dashboard
rebuild_token_cache

msg_warn "Reached max iterations ($MAX_ITERATIONS)."
if [ "$MODE" = "plan" ]; then
  echo ""
  msg_info "Next steps (if you want to proceed):"
  msg_dim "1) Review the plan in \"$PLAN_PATH\"."

  # Extract PRD number from path for command examples
  if [[ "$PLAN_PATH" =~ PRD-([0-9]+) ]]; then
    PRD_NUM="${BASH_REMATCH[1]}"
    msg_dim "2) Direct execution: ralph build 5 --prd=$PRD_NUM"
    msg_dim "3) Stream execution (isolated): ralph stream build $PRD_NUM 5"
    msg_dim "4) Test single run: ralph build 1 --no-commit --prd=$PRD_NUM"
  else
    msg_dim "2) Direct execution: ralph build"
    msg_dim "3) Stream execution: ralph stream build <prd-num> <iterations>"
    msg_dim "4) Test single run: ralph build 1 --no-commit"
  fi
fi

# Print error summary at end of run if any iterations failed
print_error_summary "$FAILED_ITERATIONS" "$FAILED_COUNT"

if [ "$HAS_ERROR" = "true" ]; then
  exit 1
fi
exit 0
