#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Agent Resolution and Execution Library
# ─────────────────────────────────────────────────────────────────────────────
# This library provides functions for:
# - Resolving agent names to command strings
# - Validating agent installation
# - Executing agents with prompts (with optional timeout)
# - Getting experiment assignments for A/B testing
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/agent.sh"
#
# Functions:
#   resolve_agent_cmd <agent_name>      - Resolve agent name to command
#   require_agent [agent_cmd]           - Validate agent is installed
#   run_agent <prompt_file>             - Execute agent with prompt file
#   run_agent_inline <prompt_file>      - Execute agent with inline prompt
#   get_experiment_assignment <story_id> - Get experiment assignment
#
# Global Variables (set by get_experiment_assignment):
#   EXPERIMENT_NAME      - Name of assigned experiment
#   EXPERIMENT_VARIANT   - Variant name (e.g., "control", "treatment")
#   EXPERIMENT_EXCLUDED  - "true" if excluded from experiment
#
# Environment Variables (US-011 timeout enforcement):
#   RALPH_TIMEOUT_AGENT   - Agent call timeout in seconds (default: 3600 = 60 min)
#   RALPH_TIMEOUT_ENABLED - Set to "false" to disable timeout (default: "true")
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# Agent call timeout: 60 minutes (3600 seconds) - US-011
TIMEOUT_AGENT="${RALPH_TIMEOUT_AGENT:-3600}"
TIMEOUT_ENABLED="${RALPH_TIMEOUT_ENABLED:-true}"

# Experiment tracking globals (set by get_experiment_assignment)
EXPERIMENT_NAME="${EXPERIMENT_NAME:-}"
EXPERIMENT_VARIANT="${EXPERIMENT_VARIANT:-}"
EXPERIMENT_EXCLUDED="${EXPERIMENT_EXCLUDED:-}"

# ─────────────────────────────────────────────────────────────────────────────
# resolve_agent_cmd
# ─────────────────────────────────────────────────────────────────────────────
# Resolve agent name to command string.
#
# Arguments:
#   $1 - Agent name (claude, codex, droid)
#
# Returns:
#   Command string with placeholders
#   - {prompt} placeholder for file-based agents (droid)
#   - stdin-based for others (claude, codex)
#
# Environment Variables:
#   AGENT_CLAUDE_CMD - Override for claude (default: "claude -p --dangerously-skip-permissions")
#   AGENT_CODEX_CMD  - Override for codex (default: "codex exec --yolo --skip-git-repo-check -")
#   AGENT_DROID_CMD  - Override for droid (default: "droid exec --skip-permissions-unsafe -f {prompt}")
#
# Example:
#   cmd=$(resolve_agent_cmd "claude")
#   # Returns: "claude -p --dangerously-skip-permissions"
# ─────────────────────────────────────────────────────────────────────────────
resolve_agent_cmd() {
  local name="$1"
  case "$name" in
    codex)
      if [[ -n "${AGENT_CODEX_CMD:-}" ]]; then
        echo "$AGENT_CODEX_CMD"
      else
        echo "codex exec --yolo --skip-git-repo-check -"
      fi
      ;;
    droid)
      if [[ -n "${AGENT_DROID_CMD:-}" ]]; then
        echo "$AGENT_DROID_CMD"
      else
        echo "droid exec --skip-permissions-unsafe -f {prompt}"
      fi
      ;;
    claude|""|*)
      if [[ -n "${AGENT_CLAUDE_CMD:-}" ]]; then
        echo "$AGENT_CLAUDE_CMD"
      else
        echo "claude -p --dangerously-skip-permissions"
      fi
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# is_claude_agent
# ─────────────────────────────────────────────────────────────────────────────
# Check if an agent name is a Claude-based agent.
# Claude model routing (haiku, sonnet, opus) only works with Claude agents.
#
# Arguments:
#   $1 - Agent name (claude, codex, droid)
#
# Returns:
#   0 - Is a Claude agent
#   1 - Not a Claude agent
#
# Example:
#   if is_claude_agent "claude"; then echo "Compatible"; fi
# ─────────────────────────────────────────────────────────────────────────────
is_claude_agent() {
  local name="${1:-}"
  case "$name" in
    claude|"")
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

# ─────────────────────────────────────────────────────────────────────────────
# validate_agent_model_compatibility
# ─────────────────────────────────────────────────────────────────────────────
# Validate that the selected agent is compatible with model routing.
# Claude models (haiku, sonnet, opus) only work with Claude agents.
# Using Codex or Droid with Claude model routing will fail.
#
# Arguments:
#   $1 - Agent name (claude, codex, droid)
#   $2 - Routing enabled flag (true/false)
#
# Environment Variables:
#   RALPH_ROUTING_ENABLED - If true, model routing is active
#
# Returns:
#   0 - Compatible (or routing disabled)
#   1 - Incompatible (non-Claude agent with routing enabled)
#
# Side Effects:
#   - Prints warning message if incompatible
#   - Sets RALPH_ROUTING_ENABLED=false if incompatible
#
# Example:
#   validate_agent_model_compatibility "codex" "true"
#   # Prints warning and returns 1
# ─────────────────────────────────────────────────────────────────────────────
validate_agent_model_compatibility() {
  local agent_name="${1:-claude}"
  local routing_enabled="${2:-${RALPH_ROUTING_ENABLED:-true}}"

  # If routing is disabled, any agent is fine
  if [[ "$routing_enabled" != "true" ]]; then
    return 0
  fi

  # Check if agent is Claude-compatible
  if is_claude_agent "$agent_name"; then
    return 0
  fi

  # Non-Claude agent with routing enabled - warn and disable routing
  msg_warn "Agent '$agent_name' is not compatible with Claude model routing (haiku/sonnet/opus)"
  msg_warn "Claude models only work with the Claude agent"
  msg_warn "Auto-disabling model routing for this session"
  msg_info "To fix: use --agent=claude or set RALPH_ROUTING_ENABLED=false in config.sh"

  # Disable routing for this session
  export RALPH_ROUTING_ENABLED=false

  return 1
}

# ─────────────────────────────────────────────────────────────────────────────
# get_compatible_fallback_chain
# ─────────────────────────────────────────────────────────────────────────────
# Get fallback chain filtered to only include Claude-compatible agents
# when model routing is enabled.
#
# Arguments:
#   $1 - Original fallback chain (space-separated)
#   $2 - Routing enabled flag (true/false)
#
# Returns:
#   Filtered chain (Claude-only if routing enabled, original otherwise)
#
# Example:
#   chain=$(get_compatible_fallback_chain "claude codex droid" "true")
#   # Returns: "claude"
# ─────────────────────────────────────────────────────────────────────────────
get_compatible_fallback_chain() {
  local chain="${1:-claude codex droid}"
  local routing_enabled="${2:-${RALPH_ROUTING_ENABLED:-true}}"

  # If routing is disabled, return full chain
  if [[ "$routing_enabled" != "true" ]]; then
    echo "$chain"
    return
  fi

  # Filter to Claude-only agents when routing is enabled
  local filtered_chain=""
  for agent in $chain; do
    if is_claude_agent "$agent"; then
      filtered_chain="${filtered_chain}${filtered_chain:+ }$agent"
    fi
  done

  # If no Claude agents in chain, default to claude
  if [[ -z "$filtered_chain" ]]; then
    filtered_chain="claude"
  fi

  echo "$filtered_chain"
}

# ─────────────────────────────────────────────────────────────────────────────
# require_agent
# ─────────────────────────────────────────────────────────────────────────────
# Validate that the specified agent is installed and available.
#
# Arguments:
#   $1 - Agent command (optional, defaults to $AGENT_CMD)
#
# Exit Codes:
#   0 - Agent is installed
#   1 - Agent not found (exits script)
#
# Example:
#   require_agent "$AGENT_CMD"
#   # Exits if agent binary not in PATH
# ─────────────────────────────────────────────────────────────────────────────
require_agent() {
  local agent_cmd="${1:-$AGENT_CMD}"
  local agent_bin
  agent_bin="${agent_cmd%% *}"
  if [[ -z "$agent_bin" ]]; then
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

# ─────────────────────────────────────────────────────────────────────────────
# run_agent
# ─────────────────────────────────────────────────────────────────────────────
# Execute agent with prompt from file, with timeout enforcement (US-011).
# Handles both stdin-based agents (claude, codex) and file-based agents (droid).
#
# Arguments:
#   $1 - Path to prompt file
#
# Environment Variables:
#   AGENT_CMD - Agent command (set by resolve_agent_cmd or config.sh)
#   RALPH_TIMEOUT_AGENT - Timeout in seconds (default: 3600 = 60 min)
#   RALPH_TIMEOUT_ENABLED - Set to "false" to disable timeout
#
# Exit Codes:
#   0   - Success
#   124 - Timeout (SIGTERM sent by timeout command)
#   137 - Killed (128 + 9 = SIGKILL after grace period)
#   *   - Other exit codes from agent
#
# Security:
#   - Uses bash -c for command isolation (preferred over eval)
#   - Uses printf '%q' for shell-safe path escaping
#   - AGENT_CMD is trusted (from config.sh), prompt file path is sanitized
#
# Example:
#   run_agent "/tmp/prompt.md"
#   # Executes: timeout 3600 claude -p --dangerously-skip-permissions < /tmp/prompt.md
#   # Or: timeout 3600 droid exec --skip-permissions-unsafe -f /tmp/prompt.md
# ─────────────────────────────────────────────────────────────────────────────
run_agent() {
  local prompt_file="$1"
  local use_timeout="$TIMEOUT_ENABLED"
  local timeout_secs="$TIMEOUT_AGENT"

  # Check if timeout command is available and enabled
  local timeout_prefix=""
  if [[ "$use_timeout" == "true" ]] && command -v timeout &>/dev/null; then
    # Use timeout with SIGTERM, then SIGKILL after 30s grace period
    timeout_prefix="timeout --signal=TERM --kill-after=30 $timeout_secs"
  fi

  if [[ "$AGENT_CMD" == *"{prompt}"* ]]; then
    # File-based agent (e.g., droid with {prompt} placeholder)
    local escaped
    escaped=$(printf '%q' "$prompt_file")
    local cmd="${AGENT_CMD//\{prompt\}/$escaped}"
    if [[ -n "$timeout_prefix" ]]; then
      eval "$timeout_prefix $cmd"
    else
      eval "$cmd"
    fi
  else
    # Stdin-based agent (e.g., claude, codex)
    if [[ -n "$timeout_prefix" ]]; then
      cat "$prompt_file" | eval "$timeout_prefix $AGENT_CMD"
    else
      cat "$prompt_file" | eval "$AGENT_CMD"
    fi
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# run_agent_inline
# ─────────────────────────────────────────────────────────────────────────────
# Execute agent with inline prompt content (used for PRD generation).
#
# Arguments:
#   $1 - Path to prompt file (content will be read and inlined)
#
# Environment Variables:
#   PRD_AGENT_CMD - Agent command for PRD generation
#
# Security:
#   - PRD_AGENT_CMD is trusted (from config.sh)
#   - Prompt content from template files (also trusted)
#   - Uses sed escaping for single quotes in prompt content
#   - eval is necessary here for multi-line content handling
#
# Example:
#   run_agent_inline "/tmp/prompt.md"
#   # Executes: claude -p --dangerously-skip-permissions '<prompt content>'
# ─────────────────────────────────────────────────────────────────────────────
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
# get_experiment_assignment
# ─────────────────────────────────────────────────────────────────────────────
# Get experiment assignment for a story ID using hash-based assignment.
#
# This function:
# - Calls the Node.js assignment module (lib/experiment/assignment.js)
# - Parses the assignment string (EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED)
# - Sets global variables for experiment tracking
# - Overrides AGENT_CMD if experiment assigns a different agent
#
# Arguments:
#   $1 - Story ID (e.g., "US-001")
#
# Global Variables Set:
#   EXPERIMENT_NAME      - Name of assigned experiment
#   EXPERIMENT_VARIANT   - Variant name (e.g., "control", "treatment")
#   EXPERIMENT_EXCLUDED  - "true" if excluded from experiment
#   AGENT_CMD           - Overridden if experiment assigns different agent
#
# Dependencies:
#   - Node.js runtime
#   - lib/experiment/assignment.js module
#   - ROOT_DIR (repository root)
#   - DEFAULT_AGENT_NAME (fallback agent)
#   - RALPH_ROOT or SCRIPT_DIR (to locate assignment.js)
#
# Example:
#   get_experiment_assignment "US-001"
#   # Sets: EXPERIMENT_NAME="model_routing", EXPERIMENT_VARIANT="control"
#   # May override: AGENT_CMD="codex exec --yolo --skip-git-repo-check -"
# ─────────────────────────────────────────────────────────────────────────────
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
  if [[ ! -f "$assignment_script" ]] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  # Get assignment string from assignment module
  local assignment
  assignment=$(node -e "
    const assignment = require('$assignment_script');
    const result = assignment.getAssignmentString('$ROOT_DIR', '$story_id');
    process.stdout.write(result);
  " 2>/dev/null) || true

  if [[ -z "$assignment" ]]; then
    return 0
  fi

  # Parse assignment: EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED
  IFS='|' read -r exp_name exp_variant exp_agent exp_excluded <<< "$assignment"

  # Set globals
  EXPERIMENT_NAME="$exp_name"
  EXPERIMENT_VARIANT="$exp_variant"
  EXPERIMENT_EXCLUDED="$exp_excluded"

  # Override AGENT_CMD if experiment assigns a different agent
  if [[ -n "$exp_agent" ]] && [[ "$exp_agent" != "$DEFAULT_AGENT_NAME" ]]; then
    AGENT_CMD="$(resolve_agent_cmd "$exp_agent")"
    msg_dim "Experiment '$exp_name' assigned variant '$exp_variant' (agent: $exp_agent)"
  fi
}
