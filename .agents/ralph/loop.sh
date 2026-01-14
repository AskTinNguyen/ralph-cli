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

DEFAULT_AGENT_NAME="${DEFAULT_AGENT:-codex}"
resolve_agent_cmd() {
  local name="$1"
  case "$name" in
    claude)
      if [[ -n "${AGENT_CLAUDE_CMD:-}" ]]; then
        echo "$AGENT_CLAUDE_CMD"
      else
        echo "claude -p --dangerously-skip-permissions"
      fi
      ;;
    droid)
      if [[ -n "${AGENT_DROID_CMD:-}" ]]; then
        echo "$AGENT_DROID_CMD"
      else
        echo "droid exec --skip-permissions-unsafe -f {prompt}"
      fi
      ;;
    codex|""|*)
      if [[ -n "${AGENT_CODEX_CMD:-}" ]]; then
        echo "$AGENT_CODEX_CMD"
      else
        echo "codex exec --yolo --skip-git-repo-check -"
      fi
      ;;
  esac
}
DEFAULT_AGENT_CMD="$(resolve_agent_cmd "$DEFAULT_AGENT_NAME")"

# ─────────────────────────────────────────────────────────────────────────────
# Experiment Assignment
# ─────────────────────────────────────────────────────────────────────────────
# Global variables for experiment tracking (set by get_experiment_assignment)
EXPERIMENT_NAME=""
EXPERIMENT_VARIANT=""
EXPERIMENT_EXCLUDED=""

# Get experiment assignment for a story ID
# Uses hash-based assignment from lib/experiment/assignment.js
# Returns: EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED (pipe-delimited)
# Sets global vars: EXPERIMENT_NAME, EXPERIMENT_VARIANT, EXPERIMENT_EXCLUDED
get_experiment_assignment() {
  local story_id="$1"
  local assignment_script

  if [[ -n "${RALPH_ROOT:-}" ]]; then
    assignment_script="$RALPH_ROOT/lib/experiment/assignment.js"
  else
    assignment_script="$SCRIPT_DIR/../../lib/experiment/assignment.js"
  fi

  # Reset globals
  EXPERIMENT_NAME=""
  EXPERIMENT_VARIANT=""
  EXPERIMENT_EXCLUDED=""

  # Check if assignment module exists and Node.js is available
  if [ ! -f "$assignment_script" ] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  # Get assignment string from assignment module
  local assignment
  assignment=$(node -e "
    const assignment = require('$assignment_script');
    const result = assignment.getAssignmentString('$ROOT_DIR', '$story_id');
    process.stdout.write(result);
  " 2>/dev/null) || true

  if [ -z "$assignment" ]; then
    return 0
  fi

  # Parse assignment: EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED
  IFS='|' read -r exp_name exp_variant exp_agent exp_excluded <<< "$assignment"

  # Set globals
  EXPERIMENT_NAME="$exp_name"
  EXPERIMENT_VARIANT="$exp_variant"
  EXPERIMENT_EXCLUDED="$exp_excluded"

  # Override AGENT_CMD if experiment assigns a different agent
  if [ -n "$exp_agent" ] && [ "$exp_agent" != "$DEFAULT_AGENT_NAME" ]; then
    AGENT_CMD="$(resolve_agent_cmd "$exp_agent")"
    msg_dim "Experiment '$exp_name' assigned variant '$exp_variant' (agent: $exp_agent)"
  fi
}

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

PRD_PATH="$(abs_path "$PRD_PATH")"
PLAN_PATH="$(abs_path "$PLAN_PATH")"
PROGRESS_PATH="$(abs_path "$PROGRESS_PATH")"
AGENTS_PATH="$(abs_path "$AGENTS_PATH")"
PROMPT_PLAN="$(abs_path "$PROMPT_PLAN")"
PROMPT_BUILD="$(abs_path "$PROMPT_BUILD")"
GUARDRAILS_PATH="$(abs_path "$GUARDRAILS_PATH")"
ERRORS_LOG_PATH="$(abs_path "$ERRORS_LOG_PATH")"
ACTIVITY_LOG_PATH="$(abs_path "$ACTIVITY_LOG_PATH")"
TMP_DIR="$(abs_path "$TMP_DIR")"
RUNS_DIR="$(abs_path "$RUNS_DIR")"
GUARDRAILS_REF="$(abs_path "$GUARDRAILS_REF")"
CONTEXT_REF="$(abs_path "$CONTEXT_REF")"
ACTIVITY_CMD="$(abs_path "$ACTIVITY_CMD")"

require_agent() {
  local agent_cmd="${1:-$AGENT_CMD}"
  local agent_bin
  agent_bin="${agent_cmd%% *}"
  if [ -z "$agent_bin" ]; then
    msg_error "AGENT_CMD is empty. Set it in config.sh."
    exit 1
  fi
  if ! command -v "$agent_bin" >/dev/null 2>&1; then
    msg_error "Agent command not found: $agent_bin"
    case "$agent_bin" in
      codex)
        msg_info "Install: npm i -g @openai/codex"
        ;;
      claude)
        msg_info "Install: curl -fsSL https://claude.ai/install.sh | bash"
        ;;
      droid)
        msg_info "Install: curl -fsSL https://app.factory.ai/cli | sh"
        ;;
    esac
    msg_dim "Then authenticate per the CLI's instructions."
    exit 1
  fi
}

run_agent() {
  local prompt_file="$1"
  if [[ "$AGENT_CMD" == *"{prompt}"* ]]; then
    local escaped
    escaped=$(printf '%q' "$prompt_file")
    local cmd="${AGENT_CMD//\{prompt\}/$escaped}"
    eval "$cmd"
  else
    cat "$prompt_file" | eval "$AGENT_CMD"
  fi
}

run_agent_inline() {
  local prompt_file="$1"
  local prompt_content
  prompt_content="$(cat "$prompt_file")"
  local escaped
  escaped=$(printf "%s" "$prompt_content" | sed "s/'/'\\\\''/g")
  if [[ "$PRD_AGENT_CMD" == *"{prompt}"* ]]; then
    local cmd="${PRD_AGENT_CMD//\{prompt\}/'$escaped'}"
    eval "$cmd"
  else
    eval "$PRD_AGENT_CMD '$escaped'"
  fi
}

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

# Retry wrapper for agent execution
# Usage: run_agent_with_retry <prompt_file> <log_file> <iteration> -> exit_status
# Handles tee internally and manages retry output to log file
# Sets LAST_RETRY_COUNT and LAST_RETRY_TOTAL_TIME for metrics
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
  if [ "$NO_RETRY" = "true" ]; then
    run_agent "$prompt_file" 2>&1 | tee "$log_file"
    return "${PIPESTATUS[0]}"
  fi

  while [ "$attempt" -le "$max_attempts" ]; do
    # Run the agent with tee for logging
    if [ "$attempt" -eq 1 ]; then
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
    if [ "$exit_status" -eq 0 ]; then
      if [ "$retry_count" -gt 0 ]; then
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
  {
    echo "You are an autonomous coding agent."
    echo "Use the \$prd skill to create a Product Requirements Document."
    echo "Save the PRD to: $PRD_PATH"
    echo "Do NOT implement anything."
    echo "After creating the PRD, tell the user to close the session and run \`ralph plan\`."
    echo ""
    echo "User request:"
    cat "$PRD_REQUEST_PATH"
  } > "$PRD_PROMPT_FILE"

  if [ "$PRD_USE_INLINE" -eq 1 ]; then
    run_agent_inline "$PRD_PROMPT_FILE"
  else
    run_agent "$PRD_PROMPT_FILE"
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

if [ "$MODE" != "prd" ] && [ ! -f "$PRD_PATH" ]; then
  msg_warn "PRD not found: $PRD_PATH"
  exit 1
fi

if [ "$MODE" = "build" ] && [ ! -f "$PLAN_PATH" ]; then
  msg_warn "Plan not found: $PLAN_PATH"
  echo "Create it first with:"
  msg_info "  ./.agents/ralph/loop.sh plan"
  exit 1
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
# Usage: save_checkpoint <prd-folder> <prd-id> <iteration> <story-id> <git-sha> [agent]
save_checkpoint() {
  local prd_folder="$1"
  local prd_id="$2"
  local iteration="$3"
  local story_id="$4"
  local git_sha="$5"
  local agent="${6:-codex}"

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

  # Build JSON data
  local json_data
  json_data=$(printf '{"prd_id":%s,"iteration":%s,"story_id":"%s","git_sha":"%s","loop_state":{"agent":"%s"}}' \
    "$prd_id" "$iteration" "$story_id" "$git_sha" "$agent")

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

write_run_meta() {
  local path="$1"
  local mode="$2"
  local iter="$3"
  local run_id="$4"
  local story_id="$5"
  local story_title="$6"
  local started="$7"
  local ended="$8"
  local duration="$9"
  local status="${10}"
  local log_file="${11}"
  local head_before="${12}"
  local head_after="${13}"
  local commit_list="${14}"
  local changed_files="${15}"
  local dirty_files="${16}"
  local input_tokens="${17:-}"
  local output_tokens="${18:-}"
  local token_model="${19:-}"
  local token_estimated="${20:-false}"
  local retry_count="${21:-0}"
  local retry_time="${22:-0}"
  # Routing and cost estimate parameters (new for US-003)
  local routed_model="${23:-}"
  local complexity_score="${24:-}"
  local routing_reason="${25:-}"
  local est_cost="${26:-}"
  local est_tokens="${27:-}"
  {
    echo "# Ralph Run Summary"
    echo ""
    echo "- Run ID: $run_id"
    echo "- Iteration: $iter"
    echo "- Mode: $mode"
    if [ -n "$story_id" ]; then
      echo "- Story: $story_id: $story_title"
    fi
    echo "- Started: $started"
    echo "- Ended: $ended"
    echo "- Duration: ${duration}s"
    echo "- Status: $status"
    echo "- Log: $log_file"
    echo ""
    echo "## Git"
    echo "- Head (before): ${head_before:-unknown}"
    echo "- Head (after): ${head_after:-unknown}"
    echo ""
    echo "### Commits"
    if [ -n "$commit_list" ]; then
      echo "$commit_list"
    else
      echo "- (none)"
    fi
    echo ""
    echo "### Changed Files (commits)"
    if [ -n "$changed_files" ]; then
      echo "$changed_files"
    else
      echo "- (none)"
    fi
    echo ""
    echo "### Uncommitted Changes"
    if [ -n "$dirty_files" ]; then
      echo "$dirty_files"
    else
      echo "- (clean)"
    fi
    echo ""
    echo "## Token Usage"
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ]; then
      echo "- Input tokens: $input_tokens"
    else
      echo "- Input tokens: (unavailable)"
    fi
    if [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ]; then
      echo "- Output tokens: $output_tokens"
    else
      echo "- Output tokens: (unavailable)"
    fi
    if [ -n "$token_model" ] && [ "$token_model" != "null" ]; then
      echo "- Model: $token_model"
    fi
    echo "- Estimated: $token_estimated"
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ] && [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ]; then
      local total=$((input_tokens + output_tokens))
      echo "- Total tokens: $total"
    fi
    echo ""
    echo "## Retry Statistics"
    if [ "$retry_count" -gt 0 ]; then
      echo "- Retry count: $retry_count"
      echo "- Total retry wait time: ${retry_time}s"
    else
      echo "- Retry count: 0 (succeeded on first attempt)"
    fi
    echo ""
    echo "## Routing Decision"
    if [ -n "$routed_model" ]; then
      echo "- Model: $routed_model"
      if [ -n "$complexity_score" ] && [ "$complexity_score" != "n/a" ]; then
        echo "- Complexity score: ${complexity_score}/10"
      fi
      if [ -n "$routing_reason" ] && [ "$routing_reason" != "n/a" ]; then
        echo "- Reason: $routing_reason"
      fi
    else
      echo "- Model: (not routed)"
    fi
    echo ""
    echo "## Cost Estimate vs Actual"
    if [ -n "$est_cost" ] && [ "$est_cost" != "n/a" ] && [ "$est_cost" != "null" ]; then
      echo "### Pre-execution Estimate"
      echo "- Estimated cost: \$${est_cost}"
      if [ -n "$est_tokens" ] && [ "$est_tokens" != "null" ]; then
        echo "- Estimated tokens: $est_tokens"
      fi
    else
      echo "### Pre-execution Estimate"
      echo "- (estimate unavailable)"
    fi
    echo ""
    echo "### Actual Usage"
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ] && [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ]; then
      local actual_total=$((input_tokens + output_tokens))
      echo "- Actual tokens: $actual_total (input: $input_tokens, output: $output_tokens)"
      # Calculate actual cost if model available
      if [ -n "$token_model" ] && [ "$token_model" != "null" ]; then
        local actual_cost_json
        actual_cost_json="$(calculate_actual_cost "$input_tokens" "$output_tokens" "$token_model" 2>/dev/null || echo "")"
        local actual_cost
        actual_cost="$(parse_routing_field "$actual_cost_json" "totalCost" 2>/dev/null || echo "")"
        if [ -n "$actual_cost" ] && [ "$actual_cost" != "null" ]; then
          echo "- Actual cost: \$$actual_cost"
        fi
      fi
    else
      echo "- (actual usage unavailable)"
    fi
    echo ""
    echo "### Estimate Accuracy"
    if [ -n "$est_tokens" ] && [ "$est_tokens" != "null" ] && [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ] && [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ]; then
      local actual_total=$((input_tokens + output_tokens))
      if [ "$est_tokens" -gt 0 ]; then
        local variance_pct
        variance_pct=$(python3 -c "print(round((($actual_total - $est_tokens) / $est_tokens) * 100, 1))" 2>/dev/null || echo "n/a")
        echo "- Token variance: ${variance_pct}% (estimated: $est_tokens, actual: $actual_total)"
      fi
    else
      echo "- (variance not available)"
    fi
    echo ""
  } > "$path"
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

    local json_data
    json_data=$(printf '{"storyId":"%s","storyTitle":"%s","duration":%s,"inputTokens":%s,"outputTokens":%s,"agent":"%s","model":"%s","status":"%s","runId":"%s","iteration":%s,"retryCount":%s,"retryTime":%s,"complexityScore":%s,"routingReason":%s,"estimatedCost":%s,"timestamp":"%s"%s}' \
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
      "$exp_fields")

    node "$metrics_cli" "$prd_folder" "$json_data" 2>/dev/null || true
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
ITERATION_COUNT=0

# Progress indicator: prints elapsed time every N seconds (TTY only)
# Usage: start_progress_indicator; ... long process ...; stop_progress_indicator
PROGRESS_PID=""
start_progress_indicator() {
  # Only show progress in TTY mode
  if [ ! -t 1 ]; then
    return
  fi
  local start_time="$1"
  local story_info="${2:-}"
  (
    while true; do
      sleep 5
      local now=$(date +%s)
      local elapsed=$((now - start_time))
      local mins=$((elapsed / 60))
      local secs=$((elapsed % 60))
      if [ "$mins" -gt 0 ]; then
        printf "${C_DIM}  ⏱ Elapsed: %dm %ds${C_RESET}\n" "$mins" "$secs"
      else
        printf "${C_DIM}  ⏱ Elapsed: %ds${C_RESET}\n" "$secs"
      fi
    done
  ) &
  PROGRESS_PID=$!
}

stop_progress_indicator() {
  if [ -n "$PROGRESS_PID" ]; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    wait "$PROGRESS_PID" 2>/dev/null || true
    PROGRESS_PID=""
  fi
}

# Ensure progress indicator is stopped on exit/interrupt
trap 'stop_progress_indicator' EXIT INT TERM

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
fi

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
  if [ "$MODE" = "build" ]; then
    STORY_META="$TMP_DIR/story-$RUN_TAG-$i.json"
    STORY_BLOCK="$TMP_DIR/story-$RUN_TAG-$i.md"
    select_story "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"
    if [ "$REMAINING" = "unknown" ]; then
      msg_error "Could not parse stories from PRD: $PRD_PATH"
      exit 1
    fi
    if [ "$REMAINING" = "0" ]; then
      # Clear checkpoint on successful completion
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      clear_checkpoint "$PRD_FOLDER"
      msg_success "No remaining stories."
      exit 0
    fi
    STORY_ID="$(story_field "$STORY_META" "id")"
    STORY_TITLE="$(story_field "$STORY_META" "title")"

    # Check for experiment assignment (may override AGENT_CMD for this story)
    get_experiment_assignment "$STORY_ID"

    # Print current story being worked on
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_CYAN}  Working on: ${C_BOLD}$STORY_ID${C_RESET}${C_CYAN} - $STORY_TITLE${C_RESET}\n"

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
      local level_color="$C_GREEN"
      local level_label="low"
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
  else
    log_activity "ITERATION $i start (mode=$MODE)"
  fi

  # Save checkpoint before story execution (build mode only)
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    save_checkpoint "$PRD_FOLDER" "$ACTIVE_PRD_NUMBER" "$i" "$STORY_ID" "$HEAD_BEFORE" "$DEFAULT_AGENT_NAME"
  fi

  set +e
  # Start progress indicator before agent execution
  start_progress_indicator "$ITER_START"
  if [ "${RALPH_DRY_RUN:-}" = "1" ]; then
    echo "[RALPH_DRY_RUN] Skipping agent execution." | tee "$LOG_FILE"
    CMD_STATUS=0
  else
    # Use retry wrapper for automatic retries with exponential backoff
    run_agent_with_retry "$PROMPT_RENDERED" "$LOG_FILE" "$i"
    CMD_STATUS=$?
  fi
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
  fi
  COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
  CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"
  DIRTY_FILES="$(git_dirty_files)"
  STATUS_LABEL="success"
  if [ "$CMD_STATUS" -ne 0 ]; then
    STATUS_LABEL="error"
  else
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  fi
  # Track iteration result for summary table
  ITERATION_COUNT=$((ITERATION_COUNT + 1))
  TOTAL_DURATION=$((TOTAL_DURATION + ITER_DURATION))
  ITERATION_RESULTS="${ITERATION_RESULTS}${ITERATION_RESULTS:+,}$i|${STORY_ID:-plan}|$ITER_DURATION|$STATUS_LABEL|$LAST_RETRY_COUNT"

  if [ "$MODE" = "build" ] && [ "$NO_COMMIT" = "false" ] && [ -n "$DIRTY_FILES" ]; then
    msg_warn "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
    log_error "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
  fi

  # Extract token metrics from log file
  TOKEN_JSON="$(extract_tokens_from_log "$LOG_FILE")"
  TOKEN_INPUT="$(parse_token_field "$TOKEN_JSON" "inputTokens")"
  TOKEN_OUTPUT="$(parse_token_field "$TOKEN_JSON" "outputTokens")"
  TOKEN_MODEL="$(parse_token_field "$TOKEN_JSON" "model")"
  TOKEN_ESTIMATED="$(parse_token_field "$TOKEN_JSON" "estimated")"

  write_run_meta "$RUN_META" "$MODE" "$i" "$RUN_TAG" "${STORY_ID:-}" "${STORY_TITLE:-}" "$ITER_START_FMT" "$ITER_END_FMT" "$ITER_DURATION" "$STATUS_LABEL" "$LOG_FILE" "$HEAD_BEFORE" "$HEAD_AFTER" "$COMMIT_LIST" "$CHANGED_FILES" "$DIRTY_FILES" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$TOKEN_MODEL" "$TOKEN_ESTIMATED" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "${ROUTED_MODEL:-}" "${ROUTED_SCORE:-}" "${ROUTED_REASON:-}" "${ESTIMATED_COST:-}" "${ESTIMATED_TOKENS:-}"

  # Append context summary to run meta (build mode only)
  if [ "$MODE" = "build" ] && [ -n "${STORY_BLOCK:-}" ]; then
    CONTEXT_SUMMARY="$(generate_context_summary "$STORY_BLOCK" "${ROUTED_MODEL:-sonnet}" 15 "$ROOT_DIR")"
    if [ -n "$CONTEXT_SUMMARY" ]; then
      append_context_to_run_meta "$RUN_META" "$CONTEXT_SUMMARY"
    fi
  fi

  # Append metrics to metrics.jsonl for historical tracking (build mode only)
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    # Derive PRD folder from PRD_PATH (e.g., /path/.ralph/PRD-1/prd.md -> /path/.ralph/PRD-1)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
append_metrics "$PRD_FOLDER" "${STORY_ID}" "${STORY_TITLE:-}" "$ITER_DURATION" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$DEFAULT_AGENT_NAME" "$TOKEN_MODEL" "$STATUS_LABEL" "$RUN_TAG" "$i" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "${ROUTED_SCORE:-}" "${ROUTED_REASON:-}" "${ESTIMATED_COST:-}" "${EXPERIMENT_NAME:-}" "${EXPERIMENT_VARIANT:-}" "${EXPERIMENT_EXCLUDED:-}"
  fi

  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | story=$STORY_ID | duration=${ITER_DURATION}s | status=$STATUS_LABEL"
  else
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | duration=${ITER_DURATION}s | status=$STATUS_LABEL"
  fi

  if [ "$MODE" = "build" ]; then
    select_story "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"
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
        rebuild_token_cache
        # Clear checkpoint on successful completion
        PRD_FOLDER="$(dirname "$PRD_PATH")"
        clear_checkpoint "$PRD_FOLDER"
        msg_success "All stories complete."
        exit 0
      fi
      msg_info "Completion signal received; stories remaining: $REMAINING"
    fi
    # Iteration completion separator
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
    printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
    msg_success "Iteration $i complete. Remaining stories: $REMAINING"
    if [ "$REMAINING" = "0" ]; then
      # Print summary table before exit
      print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
      rebuild_token_cache
      # Clear checkpoint on successful completion
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      clear_checkpoint "$PRD_FOLDER"
      msg_success "No remaining stories."
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

# Get final remaining count for summary
FINAL_REMAINING="${REMAINING:-unknown}"
if [ "$MODE" = "build" ] && [ -f "$STORY_META" ]; then
  FINAL_REMAINING="$(remaining_stories "$STORY_META")"
fi

# Print iteration summary table
print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "$FINAL_REMAINING"

# Rebuild token cache for dashboard
rebuild_token_cache

msg_warn "Reached max iterations ($MAX_ITERATIONS)."
if [ "$MODE" = "plan" ]; then
  echo ""
  msg_info "Next steps (if you want to proceed):"
  msg_dim "1) Review the plan in \"$PLAN_PATH\"."
  msg_dim "2) Start implementation with: ralph build"
  msg_dim "3) Test a single run without committing: ralph build 1 --no-commit"
fi

# Print error summary at end of run if any iterations failed
print_error_summary "$FAILED_ITERATIONS" "$FAILED_COUNT"

if [ "$HAS_ERROR" = "true" ]; then
  exit 1
fi
exit 0
