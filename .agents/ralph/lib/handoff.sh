#!/bin/bash
# Shared handoff utilities for ralph scripts
# Source this file to get handoff functions for context transfer between sessions
#
# Functions:
#   create_handoff           - Create a handoff from current state
#   load_handoff             - Load a handoff by ID
#   load_latest_handoff      - Load the most recent handoff
#   check_auto_handoff       - Check if auto-handoff should be triggered
#   get_handoff_context      - Get context injection text for prompts
#
# Global variables set by load_handoff:
#   HANDOFF_ID              - Handoff identifier
#   HANDOFF_SUMMARY         - Summary of the handoff
#   HANDOFF_PRD_ID          - PRD ID from handoff
#   HANDOFF_ITERATION       - Iteration from handoff
#   HANDOFF_STORY_ID        - Story ID from handoff
#   HANDOFF_CONTEXT         - Context injection text
#
# Dependencies (must be defined/sourced before using):
#   SCRIPT_DIR              - Directory containing this script (set by sourcing script)
#   RALPH_ROOT              - Optional root path override
#   msg_dim, msg_warn, msg_error - Functions from output.sh
#   C_CYAN, C_BOLD, C_DIM, C_RESET - Color variables from output.sh

# ============================================================================
# Global variables for handoff state
# ============================================================================

HANDOFF_ID=""
HANDOFF_SUMMARY=""
HANDOFF_PRD_ID=""
HANDOFF_ITERATION=""
HANDOFF_STORY_ID=""
HANDOFF_CONTEXT=""

# ============================================================================
# Helper: Get handoff CLI path
# ============================================================================
_get_handoff_cli() {
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    echo "$RALPH_ROOT/lib/handoff/cli.js"
  else
    echo "$SCRIPT_DIR/../../lib/handoff/cli.js"
  fi
}

# ============================================================================
# Handoff Functions
# ============================================================================

# Create a handoff from current state
# Usage: create_handoff <prd-folder> [summary] [reason] [parent-id]
# Returns: 0 on success, 1 on failure
# Sets: HANDOFF_ID to the new handoff ID
create_handoff() {
  local prd_folder="$1"
  local summary="${2:-Manual handoff}"
  local reason="${3:-manual}"
  local parent_id="${4:-}"

  # Use ralph CLI to create handoff
  local ralph_bin
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    ralph_bin="$RALPH_ROOT/bin/ralph"
  else
    ralph_bin="$SCRIPT_DIR/../../bin/ralph"
  fi

  if [[ ! -f "$ralph_bin" ]]; then
    msg_warn "Ralph CLI not found, skipping handoff creation"
    return 1
  fi

  # Build command args
  local cmd_args=("handoff" "create" "$summary" "--reason=$reason" "--json")
  if [[ -n "$parent_id" ]]; then
    cmd_args+=("--parent=$parent_id")
  fi

  # Execute and capture output
  local output
  output=$(node "$ralph_bin" "${cmd_args[@]}" 2>/dev/null)
  local status=$?

  if [[ $status -ne 0 ]]; then
    msg_warn "Failed to create handoff"
    return 1
  fi

  # Parse handoff ID from JSON output
  HANDOFF_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('id', ''))" 2>/dev/null)

  if [[ -n "$HANDOFF_ID" ]]; then
    msg_dim "Handoff created: $HANDOFF_ID"
    return 0
  else
    return 1
  fi
}

# Load handoff by ID
# Usage: if load_handoff "$handoff_id"; then ... fi
# Returns: 0 if loaded, 1 if not found
# Sets: HANDOFF_ID, HANDOFF_SUMMARY, HANDOFF_PRD_ID, HANDOFF_ITERATION, HANDOFF_STORY_ID
load_handoff() {
  local handoff_id="$1"

  local ralph_bin
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    ralph_bin="$RALPH_ROOT/bin/ralph"
  else
    ralph_bin="$SCRIPT_DIR/../../bin/ralph"
  fi

  if [[ ! -f "$ralph_bin" ]]; then
    return 1
  fi

  # Load handoff via CLI
  local output
  output=$(node "$ralph_bin" handoff show "$handoff_id" --json 2>/dev/null)
  local status=$?

  if [[ $status -ne 0 ]]; then
    return 1
  fi

  # Parse JSON output
  HANDOFF_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('id', ''))" 2>/dev/null)
  HANDOFF_SUMMARY=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('summary', ''))" 2>/dev/null)
  HANDOFF_PRD_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('prd_id', '') or '')" 2>/dev/null)
  HANDOFF_ITERATION=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('iteration', '') or '')" 2>/dev/null)
  HANDOFF_STORY_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('story_id', '') or '')" 2>/dev/null)

  if [[ -n "$HANDOFF_ID" ]]; then
    return 0
  else
    return 1
  fi
}

# Load the latest handoff in the chain
# Usage: if load_latest_handoff; then ... fi
# Returns: 0 if loaded, 1 if none found
load_latest_handoff() {
  local ralph_bin
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    ralph_bin="$RALPH_ROOT/bin/ralph"
  else
    ralph_bin="$SCRIPT_DIR/../../bin/ralph"
  fi

  if [[ ! -f "$ralph_bin" ]]; then
    return 1
  fi

  # Get status to find latest handoff
  local output
  output=$(node "$ralph_bin" handoff status --json 2>/dev/null)
  local status=$?

  if [[ $status -ne 0 ]]; then
    return 1
  fi

  # Extract latest handoff ID
  local latest_id
  latest_id=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('latest_handoff', '') or '')" 2>/dev/null)

  if [[ -n "$latest_id" ]]; then
    load_handoff "$latest_id"
    return $?
  else
    return 1
  fi
}

# Check if auto-handoff should be triggered based on context usage
# Usage: if check_auto_handoff "$context_usage_percent" "$threshold"; then create_handoff ... fi
# Returns: 0 if should handoff, 1 if not
check_auto_handoff() {
  local context_usage="${1:-0}"
  local threshold="${2:-90}"

  # Parse as integers
  context_usage=$(printf "%.0f" "$context_usage" 2>/dev/null || echo "0")
  threshold=$(printf "%.0f" "$threshold" 2>/dev/null || echo "90")

  if [[ "$context_usage" -ge "$threshold" ]]; then
    return 0
  else
    return 1
  fi
}

# Get context injection text for agent prompts
# Usage: CONTEXT=$(get_handoff_context "$handoff_id")
# Returns: Context text to inject into prompts
get_handoff_context() {
  local handoff_id="${1:-}"

  local ralph_bin
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    ralph_bin="$RALPH_ROOT/bin/ralph"
  else
    ralph_bin="$SCRIPT_DIR/../../bin/ralph"
  fi

  if [[ ! -f "$ralph_bin" ]]; then
    echo ""
    return 1
  fi

  # Get handoff markdown (which includes context)
  local output
  if [[ -n "$handoff_id" ]]; then
    output=$(node "$ralph_bin" handoff export "$handoff_id" 2>/dev/null)
  else
    output=$(node "$ralph_bin" handoff export 2>/dev/null)
  fi

  echo "$output"
}

# Save handoff context to a file for prompt injection
# Usage: save_handoff_context_file "$handoff_id" "$output_path"
# Returns: 0 on success, 1 on failure
save_handoff_context_file() {
  local handoff_id="${1:-}"
  local output_path="$2"

  local context
  context=$(get_handoff_context "$handoff_id")

  if [[ -n "$context" ]] && [[ -n "$output_path" ]]; then
    echo "$context" > "$output_path"
    return 0
  else
    return 1
  fi
}

# Create iteration-end handoff
# Called at the end of each build iteration to capture state
# Usage: create_iteration_handoff <prd-folder> <iteration> <story-id> <completed-stories-count>
create_iteration_handoff() {
  local prd_folder="$1"
  local iteration="$2"
  local story_id="$3"
  local completed_count="${4:-0}"

  local summary="Iteration $iteration completed: $completed_count stories done, working on $story_id"

  create_handoff "$prd_folder" "$summary" "iteration_end"
}

# Create error handoff
# Called when an unrecoverable error requires fresh start
# Usage: create_error_handoff <prd-folder> <error-message>
create_error_handoff() {
  local prd_folder="$1"
  local error_msg="$2"

  local summary="Error recovery: ${error_msg:0:100}"

  create_handoff "$prd_folder" "$summary" "error"
}

# Display handoff info in a formatted box
# Usage: display_handoff_info
display_handoff_info() {
  if [[ -z "$HANDOFF_ID" ]]; then
    return
  fi

  printf "\n${C_CYAN}╔══════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET} ${C_BOLD}Handoff Context${C_RESET}                                   ${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╠══════════════════════════════════════════════════╣${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET} ID: %-43s ${C_CYAN}║${C_RESET}\n" "${HANDOFF_ID:0:43}"
  if [[ -n "$HANDOFF_PRD_ID" ]]; then
    printf "${C_CYAN}║${C_RESET} PRD: %-42s ${C_CYAN}║${C_RESET}\n" "PRD-$HANDOFF_PRD_ID"
  fi
  if [[ -n "$HANDOFF_ITERATION" ]]; then
    printf "${C_CYAN}║${C_RESET} Iteration: %-36s ${C_CYAN}║${C_RESET}\n" "$HANDOFF_ITERATION"
  fi
  if [[ -n "$HANDOFF_STORY_ID" ]]; then
    printf "${C_CYAN}║${C_RESET} Story: %-40s ${C_CYAN}║${C_RESET}\n" "$HANDOFF_STORY_ID"
  fi
  printf "${C_CYAN}║${C_RESET} Summary: %-38s ${C_CYAN}║${C_RESET}\n" "${HANDOFF_SUMMARY:0:38}..."
  printf "${C_CYAN}╚══════════════════════════════════════════════════╝${C_RESET}\n\n"
}

# Get auto-handoff threshold from config
# Usage: threshold=$(get_auto_handoff_threshold)
# Returns: Threshold percentage (default: 90)
get_auto_handoff_threshold() {
  # Check environment variable first
  if [[ -n "${RALPH_AUTO_HANDOFF_THRESHOLD:-}" ]]; then
    echo "$RALPH_AUTO_HANDOFF_THRESHOLD"
    return
  fi

  # Check config file
  local config_file
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    config_file="$RALPH_ROOT/.agents/ralph/config.sh"
  else
    config_file="$SCRIPT_DIR/../config.sh"
  fi

  if [[ -f "$config_file" ]]; then
    local threshold
    threshold=$(grep -E '^RALPH_AUTO_HANDOFF_THRESHOLD=' "$config_file" 2>/dev/null | cut -d= -f2)
    if [[ -n "$threshold" ]]; then
      echo "$threshold"
      return
    fi
  fi

  # Default threshold
  echo "90"
}

# Check if auto-handoff is enabled
# Usage: if is_auto_handoff_enabled; then ... fi
# Returns: 0 if enabled, 1 if disabled
is_auto_handoff_enabled() {
  local enabled="${RALPH_AUTO_HANDOFF_ENABLED:-true}"

  case "$enabled" in
    true|1|yes|on)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}
