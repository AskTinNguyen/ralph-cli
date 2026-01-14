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
# Failure Pattern Detection & Agent Switching Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Track agent failures and enable automatic switching when patterns detected.
# Failure types: timeout, error, quality (tests/lint failures)
# Threshold: consecutive failures before triggering switch
AGENT_SWITCH_THRESHOLD="${AGENT_SWITCH_THRESHOLD:-2}"
AGENT_SWITCH_ON_TIMEOUT="${AGENT_SWITCH_ON_TIMEOUT:-true}"
AGENT_SWITCH_ON_ERROR="${AGENT_SWITCH_ON_ERROR:-true}"
AGENT_SWITCH_ON_QUALITY="${AGENT_SWITCH_ON_QUALITY:-false}"

# Agent fallback chain configuration
# Default chain: claude → codex → droid
AGENT_FALLBACK_CHAIN="${AGENT_FALLBACK_CHAIN:-claude codex droid}"

# Failure tracking state (in-memory during run)
CONSECUTIVE_FAILURES=0
CURRENT_AGENT="$DEFAULT_AGENT_NAME"
LAST_FAILURE_TYPE=""
# Chain position tracking for fallback (0-indexed)
CHAIN_POSITION=0
# Switch tracking for run summary (format: "from:to:reason:story,from:to:reason:story,...")
SWITCHES_THIS_RUN=""
SWITCH_COUNT=0

# Classify failure type from exit code and log content
# Usage: classify_failure <exit_code> <log_file> -> "timeout" | "error" | "quality" | "success"
classify_failure() {
  local exit_code="$1"
  local log_file="$2"

  # Success case
  if [ "$exit_code" -eq 0 ]; then
    echo "success"
    return
  fi

  # Timeout detection: exit codes 124 (timeout command) and 137 (SIGKILL, often OOM/timeout)
  if [ "$exit_code" -eq 124 ] || [ "$exit_code" -eq 137 ]; then
    echo "timeout"
    return
  fi

  # User interruption - not a failure type we track
  if [ "$exit_code" -eq 130 ] || [ "$exit_code" -eq 143 ]; then
    echo "interrupted"
    return
  fi

  # Check log for quality failures (tests, lint, type errors)
  if [ -f "$log_file" ]; then
    # Test failures
    if grep -qiE "(FAIL\s+.*\.(test|spec)\.|tests?\s+failed|Test failed:|AssertionError:)" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Type errors
    if grep -qiE "(TypeError:|TS\d+:|type.*is not assignable|Property.*does not exist)" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Lint errors
    if grep -qiE "(eslint|prettier|tslint).*error" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Build failures
    if grep -qiE "(Build failed|Compilation failed|error during build)" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
  fi

  # Default to general error
  echo "error"
}

# Check if a failure type should trigger agent switching based on config
# Usage: should_switch_on_failure <failure_type> -> 0 (yes) | 1 (no)
should_switch_on_failure() {
  local failure_type="$1"

  case "$failure_type" in
    timeout)
      [ "$AGENT_SWITCH_ON_TIMEOUT" = "true" ] && return 0 || return 1
      ;;
    error)
      [ "$AGENT_SWITCH_ON_ERROR" = "true" ] && return 0 || return 1
      ;;
    quality)
      [ "$AGENT_SWITCH_ON_QUALITY" = "true" ] && return 0 || return 1
      ;;
    *)
      return 1
      ;;
  esac
}

# Track a failure and update consecutive failure count
# Usage: track_failure <failure_type> <story_id>
# Sets CONSECUTIVE_FAILURES and LAST_FAILURE_TYPE
track_failure() {
  local failure_type="$1"
  local story_id="${2:-unknown}"

  if should_switch_on_failure "$failure_type"; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    LAST_FAILURE_TYPE="$failure_type"
    log_activity "FAILURE_TRACKED type=$failure_type story=$story_id consecutive=$CONSECUTIVE_FAILURES agent=$CURRENT_AGENT"
  else
    # Non-switchable failure type - don't increment counter but log it
    log_activity "FAILURE_IGNORED type=$failure_type story=$story_id reason=not_configured_for_switch agent=$CURRENT_AGENT"
  fi
}

# Reset failure tracking on success
# Usage: reset_failure_tracking
reset_failure_tracking() {
  if [ "$CONSECUTIVE_FAILURES" -gt 0 ]; then
    log_activity "FAILURE_RESET previous_count=$CONSECUTIVE_FAILURES agent=$CURRENT_AGENT"
  fi
  CONSECUTIVE_FAILURES=0
  LAST_FAILURE_TYPE=""
}

# Check if switch threshold has been reached
# Usage: should_switch_agent -> 0 (yes) | 1 (no)
should_switch_agent() {
  [ "$CONSECUTIVE_FAILURES" -ge "$AGENT_SWITCH_THRESHOLD" ] && return 0 || return 1
}

# Check if an agent CLI is available in PATH
# Usage: agent_available <agent_name> -> 0 (available) | 1 (not available)
agent_available() {
  local agent_name="$1"
  local agent_bin=""

  # Determine the binary name for each known agent
  case "$agent_name" in
    claude)
      agent_bin="claude"
      ;;
    codex)
      agent_bin="codex"
      ;;
    droid)
      agent_bin="droid"
      ;;
    *)
      # For unknown agents, use the name directly as binary
      agent_bin="$agent_name"
      ;;
  esac

  # Check if the binary is available in PATH
  if command -v "$agent_bin" >/dev/null 2>&1; then
    return 0
  else
    return 1
  fi
}

# Notify about an agent switch with terminal output and activity logging
# Usage: notify_switch <from_agent> <to_agent> <reason> <story_id> <consecutive_failures>
# Displays a colored banner and logs to activity.log
# Tracks switch for run summary
notify_switch() {
  local from_agent="$1"
  local to_agent="$2"
  local reason="$3"
  local story_id="${4:-unknown}"
  local failures="${5:-0}"

  # Log to activity.log with structured format
  log_activity "AGENT_SWITCH from=$from_agent to=$to_agent reason=$reason story=$story_id failures=$failures"

  # Track switch for run summary
  SWITCHES_THIS_RUN="${SWITCHES_THIS_RUN}${SWITCHES_THIS_RUN:+,}$from_agent:$to_agent:$reason:$story_id"
  SWITCH_COUNT=$((SWITCH_COUNT + 1))

  # Terminal output with colored banner
  printf "\n${C_YELLOW}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_YELLOW}║${C_RESET}${C_BOLD}${C_YELLOW}                    AGENT SWITCH                        ${C_RESET}${C_YELLOW}║${C_RESET}\n"
  printf "${C_YELLOW}╠═══════════════════════════════════════════════════════╣${C_RESET}\n"
  printf "${C_YELLOW}║${C_RESET}  From: ${C_DIM}%-10s${C_RESET}  →  To: ${C_CYAN}%-10s${C_RESET}        ${C_YELLOW}║${C_RESET}\n" "$from_agent" "$to_agent"
  printf "${C_YELLOW}║${C_RESET}  Reason: ${C_DIM}%-44s${C_RESET}${C_YELLOW}║${C_RESET}\n" "$reason"
  if [ -n "$story_id" ] && [ "$story_id" != "unknown" ]; then
    printf "${C_YELLOW}║${C_RESET}  Story: ${C_CYAN}%-45s${C_RESET}${C_YELLOW}║${C_RESET}\n" "$story_id"
  fi
  printf "${C_YELLOW}║${C_RESET}  Consecutive failures: ${C_RED}%-30s${C_RESET}${C_YELLOW}║${C_RESET}\n" "$failures"
  printf "${C_YELLOW}╚═══════════════════════════════════════════════════════╝${C_RESET}\n\n"
}

# Get the next available agent from the fallback chain
# Usage: switch_to_next_agent <story_id> -> agent_name (or empty string if chain exhausted)
# Updates CURRENT_AGENT, CHAIN_POSITION, and AGENT_CMD when a switch occurs
# Displays terminal notification when a switch occurs
switch_to_next_agent() {
  local story_id="${1:-unknown}"
  local chain_array
  # Convert space-separated chain to array
  read -ra chain_array <<< "$AGENT_FALLBACK_CHAIN"
  local chain_length="${#chain_array[@]}"

  if [ "$chain_length" -eq 0 ]; then
    log_activity "SWITCH_FAILED reason=empty_chain story=$story_id"
    echo ""
    return
  fi

  local start_position="$CHAIN_POSITION"
  local old_agent="$CURRENT_AGENT"

  # Try each agent in the chain starting from current position + 1
  local attempts=0
  while [ "$attempts" -lt "$chain_length" ]; do
    # Move to next position in chain (wrap around)
    CHAIN_POSITION=$(( (CHAIN_POSITION + 1) % chain_length ))
    local candidate="${chain_array[$CHAIN_POSITION]}"

    # Skip if we're back at the starting agent
    if [ "$candidate" = "$old_agent" ]; then
      attempts=$((attempts + 1))
      continue
    fi

    # Check if this agent is available
    if agent_available "$candidate"; then
      CURRENT_AGENT="$candidate"
      AGENT_CMD="$(resolve_agent_cmd "$candidate")"
      # Notify with terminal output and logging
      notify_switch "$old_agent" "$CURRENT_AGENT" "$LAST_FAILURE_TYPE" "$story_id" "$CONSECUTIVE_FAILURES"
      echo "$CURRENT_AGENT"
      return
    else
      log_activity "AGENT_SKIP agent=$candidate reason=unavailable story=$story_id"
    fi

    attempts=$((attempts + 1))
  done

  # All agents tried, chain exhausted - notify failure
  log_activity "SWITCH_FAILED reason=chain_exhausted tried=$attempts story=$story_id"
  printf "\n${C_RED}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_RED}║${C_RESET}${C_BOLD}${C_RED}              AGENT SWITCH FAILED                      ${C_RESET}${C_RED}║${C_RESET}\n"
  printf "${C_RED}╠═══════════════════════════════════════════════════════╣${C_RESET}\n"
  printf "${C_RED}║${C_RESET}  All agents in fallback chain exhausted.              ${C_RED}║${C_RESET}\n"
  printf "${C_RED}║${C_RESET}  Tried: ${C_DIM}%-45s${C_RESET}${C_RED}║${C_RESET}\n" "$attempts agents"
  printf "${C_RED}║${C_RESET}  Chain: ${C_DIM}%-45s${C_RESET}${C_RED}║${C_RESET}\n" "$AGENT_FALLBACK_CHAIN"
  printf "${C_RED}╚═══════════════════════════════════════════════════════╝${C_RESET}\n\n"
  echo ""
}

# Reset chain position to the beginning (first agent in chain)
# Called when a story completes successfully to ensure next story starts fresh
# Usage: reset_chain_position
reset_chain_position() {
  local chain_array
  read -ra chain_array <<< "$AGENT_FALLBACK_CHAIN"

  if [ "${#chain_array[@]}" -eq 0 ]; then
    return
  fi

  local first_agent="${chain_array[0]}"
  local old_position="$CHAIN_POSITION"
  local old_agent="$CURRENT_AGENT"

  # Reset to first available agent in chain
  CHAIN_POSITION=0
  for i in "${!chain_array[@]}"; do
    if agent_available "${chain_array[$i]}"; then
      CHAIN_POSITION="$i"
      CURRENT_AGENT="${chain_array[$i]}"
      AGENT_CMD="$(resolve_agent_cmd "$CURRENT_AGENT")"
      break
    fi
  done

  if [ "$old_agent" != "$CURRENT_AGENT" ] || [ "$old_position" != "$CHAIN_POSITION" ]; then
    log_activity "CHAIN_RESET from=$old_agent to=$CURRENT_AGENT position=$CHAIN_POSITION"
  fi
}

# Get switch state file path for a PRD folder
# Usage: get_switch_state_path <prd_folder> -> path
get_switch_state_path() {
  local prd_folder="$1"
  echo "$prd_folder/switch-state.json"
}

# Load switch state from file for cross-run persistence
# Usage: load_switch_state <prd_folder>
# Sets CONSECUTIVE_FAILURES, LAST_FAILURE_TYPE, CURRENT_AGENT, CHAIN_POSITION
load_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_path "$prd_folder")"

  if [ -f "$state_file" ]; then
    local state
    state=$(cat "$state_file")
    CONSECUTIVE_FAILURES=$(echo "$state" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('consecutiveFailures', 0))" 2>/dev/null || echo 0)
    LAST_FAILURE_TYPE=$(echo "$state" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('lastFailureType', ''))" 2>/dev/null || echo "")
    CURRENT_AGENT=$(echo "$state" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('currentAgent', '$DEFAULT_AGENT_NAME'))" 2>/dev/null || echo "$DEFAULT_AGENT_NAME")
    CHAIN_POSITION=$(echo "$state" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('chainPosition', 0))" 2>/dev/null || echo 0)
    # Update AGENT_CMD to match loaded agent
    AGENT_CMD="$(resolve_agent_cmd "$CURRENT_AGENT")"
    log_activity "SWITCH_STATE_LOADED consecutive=$CONSECUTIVE_FAILURES lastType=$LAST_FAILURE_TYPE agent=$CURRENT_AGENT position=$CHAIN_POSITION"
  fi
}

# Save switch state to file for cross-run persistence
# Usage: save_switch_state <prd_folder> <story_id>
save_switch_state() {
  local prd_folder="$1"
  local story_id="${2:-}"
  local state_file
  state_file="$(get_switch_state_path "$prd_folder")"

  local timestamp
  timestamp=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  cat > "$state_file" <<EOF
{
  "consecutiveFailures": $CONSECUTIVE_FAILURES,
  "lastFailureType": "$LAST_FAILURE_TYPE",
  "currentAgent": "$CURRENT_AGENT",
  "chainPosition": $CHAIN_POSITION,
  "storyId": "$story_id",
  "updatedAt": "$timestamp"
}
EOF
}

# Clear switch state file (called on PRD completion or manual reset)
# Usage: clear_switch_state <prd_folder>
clear_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_path "$prd_folder")"

  if [ -f "$state_file" ]; then
    rm -f "$state_file"
    log_activity "SWITCH_STATE_CLEARED"
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
  local failure_type="${23:-}"
  local agent="${24:-}"
  local consecutive_failures="${25:-0}"
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
    if [ -n "$failure_type" ] && [ "$failure_type" != "success" ]; then
      echo "- Failure type: $failure_type"
    fi
    if [ -n "$agent" ]; then
      echo "- Agent: $agent"
    fi
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
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ] && [ "$input_tokens" != "None" ] && \
       [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ] && [ "$output_tokens" != "None" ] && \
       [[ "$input_tokens" =~ ^[0-9]+$ ]] && [[ "$output_tokens" =~ ^[0-9]+$ ]]; then
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
    echo "## Failure Pattern Tracking"
    if [ -n "$failure_type" ] && [ "$failure_type" != "success" ]; then
      echo "- Failure type: $failure_type"
      echo "- Consecutive failures: $consecutive_failures"
      echo "- Switch threshold: $AGENT_SWITCH_THRESHOLD"
      if [ "$consecutive_failures" -ge "$AGENT_SWITCH_THRESHOLD" ]; then
        echo "- Status: **Threshold reached** - consider agent switch"
      else
        echo "- Status: Tracking (${consecutive_failures}/${AGENT_SWITCH_THRESHOLD} toward threshold)"
      fi
    else
      echo "- No failure pattern detected"
    fi
    echo ""
    echo "## Agent Switches"
    if [ "$SWITCH_COUNT" -gt 0 ]; then
      echo "- Switch count: $SWITCH_COUNT"
      echo ""
      # Parse and display each switch
      IFS=',' read -ra SWITCH_ARRAY <<< "$SWITCHES_THIS_RUN"
      for switch_entry in "${SWITCH_ARRAY[@]}"; do
        IFS=':' read -r from_agent to_agent reason switch_story <<< "$switch_entry"
        echo "### Switch: $from_agent → $to_agent"
        echo "- Reason: $reason"
        if [ -n "$switch_story" ] && [ "$switch_story" != "unknown" ]; then
          echo "- Story: $switch_story"
        fi
        echo ""
      done
    else
      echo "- No agent switches occurred"
    fi
    echo ""
  } > "$path"
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
  python3 -c "import json,sys; d=json.loads(sys.argv[1]); print(d.get('$field',''))" "$json" 2>/dev/null || echo ""
}

# Append metrics to metrics.jsonl for historical tracking
# Called after each build iteration
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
  local failure_type="${14:-}"

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

    # Escape strings for JSON
    local escaped_title
    escaped_title=$(printf '%s' "$story_title" | sed 's/"/\\"/g' | sed "s/'/\\'/g")

    # Handle failure_type - use "success" if empty for successful runs
    local failure_type_val="null"
    if [ -n "$failure_type" ] && [ "$failure_type" != "success" ]; then
      failure_type_val="\"$failure_type\""
    fi

    local json_data
    json_data=$(printf '{"storyId":"%s","storyTitle":"%s","duration":%s,"inputTokens":%s,"outputTokens":%s,"agent":"%s","model":"%s","status":"%s","runId":"%s","iteration":%s,"retryCount":%s,"retryTime":%s,"failureType":%s,"timestamp":"%s"}' \
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
      "$failure_type_val" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)")

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

# Load any persisted switch state for cross-run persistence
if [ "$MODE" = "build" ] && [ -n "$ACTIVE_PRD_NUMBER" ]; then
  PRD_FOLDER_STATE="$(get_prd_dir "$ACTIVE_PRD_NUMBER")"
  load_switch_state "$PRD_FOLDER_STATE"
  if [ "$CONSECUTIVE_FAILURES" -gt 0 ]; then
    msg_warn "Resuming with $CONSECUTIVE_FAILURES consecutive failure(s) tracked from previous run"
  fi
fi

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

for i in $(seq 1 "$MAX_ITERATIONS"); do
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
      msg_success "No remaining stories."
      exit 0
    fi
    STORY_ID="$(story_field "$STORY_META" "id")"
    STORY_TITLE="$(story_field "$STORY_META" "title")"
    # Print current story being worked on
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_CYAN}  Working on: ${C_BOLD}$STORY_ID${C_RESET}${C_CYAN} - $STORY_TITLE${C_RESET}\n"
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
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

  # Classify failure type and track for agent switching
  FAILURE_TYPE="$(classify_failure "$CMD_STATUS" "$LOG_FILE")"
  if [ "$CMD_STATUS" -ne 0 ]; then
    log_error "ITERATION $i command failed (status=$CMD_STATUS type=$FAILURE_TYPE)"
    HAS_ERROR="true"
    # Track failed iteration details for summary
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_ITERATIONS="${FAILED_ITERATIONS}${FAILED_ITERATIONS:+,}$i:${STORY_ID:-plan}:$LOG_FILE"

    # Track failure for agent switching (build mode only)
    if [ "$MODE" = "build" ]; then
      track_failure "$FAILURE_TYPE" "${STORY_ID:-unknown}"
      # Save state for cross-run persistence
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      save_switch_state "$PRD_FOLDER" "${STORY_ID:-}"

      # Check if we've hit the switch threshold
      if should_switch_agent; then
        log_activity "SWITCH_THRESHOLD_REACHED consecutive=$CONSECUTIVE_FAILURES threshold=$AGENT_SWITCH_THRESHOLD agent=$CURRENT_AGENT"
        msg_warn "Agent switch threshold reached ($CONSECUTIVE_FAILURES consecutive failures)"
        msg_info "Consider switching agents with: ralph build N --agent=<alternative>"
      fi
    fi
  else
    # Success - reset failure tracking and chain position for next story
    if [ "$MODE" = "build" ]; then
      reset_failure_tracking
      # Reset chain to first agent for the next story
      reset_chain_position
      # Clear persisted state on success
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      save_switch_state "$PRD_FOLDER" "${STORY_ID:-}"
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

  write_run_meta "$RUN_META" "$MODE" "$i" "$RUN_TAG" "${STORY_ID:-}" "${STORY_TITLE:-}" "$ITER_START_FMT" "$ITER_END_FMT" "$ITER_DURATION" "$STATUS_LABEL" "$LOG_FILE" "$HEAD_BEFORE" "$HEAD_AFTER" "$COMMIT_LIST" "$CHANGED_FILES" "$DIRTY_FILES" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$TOKEN_MODEL" "$TOKEN_ESTIMATED" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "$FAILURE_TYPE" "$CURRENT_AGENT" "$CONSECUTIVE_FAILURES"

  # Append metrics to metrics.jsonl for historical tracking (build mode only)
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    # Derive PRD folder from PRD_PATH (e.g., /path/.ralph/PRD-1/prd.md -> /path/.ralph/PRD-1)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    append_metrics "$PRD_FOLDER" "${STORY_ID}" "${STORY_TITLE:-}" "$ITER_DURATION" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$CURRENT_AGENT" "$TOKEN_MODEL" "$STATUS_LABEL" "$RUN_TAG" "$i" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "$FAILURE_TYPE"
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
