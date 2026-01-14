#!/bin/bash
# Shared checkpoint utilities for ralph scripts
# Source this file to get checkpoint/resume functions
#
# Functions:
#   save_checkpoint            - Save checkpoint before story execution
#   clear_checkpoint           - Clear checkpoint after successful completion
#   load_checkpoint            - Load checkpoint for resumable builds
#   validate_git_state         - Validate git state matches checkpoint
#   prompt_resume_confirmation - Prompt user to confirm resume from checkpoint
#
# Global variables set by load_checkpoint:
#   CHECKPOINT_ITERATION - Iteration number from checkpoint
#   CHECKPOINT_STORY_ID  - Story ID from checkpoint
#   CHECKPOINT_GIT_SHA   - Git SHA from checkpoint
#   CHECKPOINT_AGENT     - Agent name from checkpoint
#
# Dependencies (must be defined/sourced before using):
#   SCRIPT_DIR           - Directory containing this script (set by sourcing script)
#   RALPH_ROOT           - Optional root path override
#   git_head             - Function from git-utils.sh
#   msg_dim, msg_warn, msg_error - Functions from output.sh
#   C_YELLOW, C_CYAN, C_BOLD, C_DIM, C_RESET - Color variables from output.sh

# ============================================================================
# Global variables for checkpoint state
# ============================================================================
# These are set by load_checkpoint and used by the main loop

CHECKPOINT_ITERATION=""
CHECKPOINT_STORY_ID=""
CHECKPOINT_GIT_SHA=""
CHECKPOINT_AGENT=""

# ============================================================================
# Helper: Get checkpoint CLI path
# ============================================================================
_get_checkpoint_cli() {
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    echo "$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    echo "$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi
}

# ============================================================================
# Checkpoint Functions
# ============================================================================

# Save checkpoint before story execution for resumable builds
# Usage: save_checkpoint <prd-folder> <prd-id> <iteration> <story-id> <git-sha> [agent]
# Returns: 0 on success, 1 on failure (non-fatal)
save_checkpoint() {
  local prd_folder="$1"
  local prd_id="$2"
  local iteration="$3"
  local story_id="$4"
  local git_sha="$5"
  local agent="${6:-codex}"

  local checkpoint_cli
  checkpoint_cli=$(_get_checkpoint_cli)

  # Check if checkpoint CLI exists
  if [[ ! -f "$checkpoint_cli" ]] || ! command -v node >/dev/null 2>&1; then
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
# Returns: 0 on success, 1 on failure (silent)
clear_checkpoint() {
  local prd_folder="$1"

  local checkpoint_cli
  checkpoint_cli=$(_get_checkpoint_cli)

  # Check if checkpoint CLI exists
  if [[ ! -f "$checkpoint_cli" ]] || ! command -v node >/dev/null 2>&1; then
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
# Sets global variables: CHECKPOINT_ITERATION, CHECKPOINT_STORY_ID, CHECKPOINT_GIT_SHA, CHECKPOINT_AGENT
# Usage: if load_checkpoint "$prd_folder"; then ... fi
# Returns: 0 if checkpoint loaded successfully, 1 if not found or error
load_checkpoint() {
  local prd_folder="$1"

  local checkpoint_cli
  checkpoint_cli=$(_get_checkpoint_cli)

  # Check if checkpoint CLI exists
  if [[ ! -f "$checkpoint_cli" ]] || ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  # Load checkpoint via CLI
  local output
  output=$(node "$checkpoint_cli" load "$prd_folder" 2>/dev/null)
  local status=$?

  if [[ $status -ne 0 ]]; then
    return 1
  fi

  # Parse JSON output using Python (more reliable than bash parsing)
  CHECKPOINT_ITERATION=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('iteration', ''))" 2>/dev/null)
  CHECKPOINT_STORY_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('story_id', ''))" 2>/dev/null)
  CHECKPOINT_GIT_SHA=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('git_sha', ''))" 2>/dev/null)
  CHECKPOINT_AGENT=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('loop_state', {}).get('agent', 'codex'))" 2>/dev/null)

  if [[ -n "$CHECKPOINT_ITERATION" ]]; then
    return 0
  else
    return 1
  fi
}

# Validate git state matches checkpoint
# Usage: if ! validate_git_state "$CHECKPOINT_GIT_SHA"; then exit 1; fi
# Returns: 0 if match or user confirms, 1 if user declines
validate_git_state() {
  local expected_sha="$1"
  local current_sha

  current_sha=$(git_head)

  if [[ -z "$expected_sha" ]]; then
    # No checkpoint SHA to validate
    return 0
  fi

  if [[ "$current_sha" = "$expected_sha" ]]; then
    return 0
  fi

  # Git state has diverged - warn user
  printf "\n${C_YELLOW}${C_BOLD}Warning: Git state has diverged from checkpoint${C_RESET}\n"
  printf "  ${C_DIM}Checkpoint SHA: ${C_RESET}${expected_sha:0:8}\n"
  printf "  ${C_DIM}Current SHA:    ${C_RESET}${current_sha:0:8}\n"
  printf "\n"

  # Prompt user if in TTY mode
  if [[ -t 0 ]]; then
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
# Usage: if ! prompt_resume_confirmation "$iteration" "$story_id"; then exit 0; fi
# Returns: 0 if user confirms, 1 if user declines
prompt_resume_confirmation() {
  local iteration="$1"
  local story_id="$2"

  printf "\n${C_CYAN}${C_BOLD}Checkpoint found${C_RESET}\n"
  printf "  ${C_DIM}Iteration:${C_RESET} $iteration\n"
  printf "  ${C_DIM}Story:${C_RESET}     ${story_id:-unknown}\n"
  printf "\n"

  # Prompt user if in TTY mode
  if [[ -t 0 ]]; then
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
