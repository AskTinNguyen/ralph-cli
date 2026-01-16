#!/bin/bash
# Ralph Factory Mode - Bash Utilities
# Provides shell-level helpers for factory operations
#
# Usage:
#   source .agents/ralph/factory.sh
#   factory_init "myflow"
#   factory_run "myflow" --var="user_request=Add auth"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source shared output utilities
# shellcheck source=lib/output.sh
source "$SCRIPT_DIR/lib/output.sh"

# Source path utilities
# shellcheck source=lib/path-utils.sh
source "$SCRIPT_DIR/lib/path-utils.sh"

# ============================================================================
# Factory Configuration
# ============================================================================

FACTORY_VERSION="1"
DEFAULT_FACTORY_NAME="factory"

# Find factory directory
get_factory_dir() {
  local ralph_dir
  ralph_dir="$(find_ralph_root)"
  echo "$ralph_dir/factory"
}

# ============================================================================
# Factory Commands (Thin wrappers around Node.js CLI)
# ============================================================================

# Initialize a new factory
factory_init() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  local template="${2:-basic}"

  ralph factory init "$name" --template="$template"
}

# Run a factory
factory_run() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  shift || true

  ralph factory run "$name" "$@"
}

# Get factory status
factory_status() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"

  ralph factory status "$name"
}

# Stop a running factory
factory_stop() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"

  ralph factory stop "$name"
}

# Resume a factory
factory_resume() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  shift || true

  ralph factory resume "$name" "$@"
}

# List factory stages
factory_stages() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"

  ralph factory stages "$name"
}

# Show execution graph
factory_graph() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"

  ralph factory graph "$name"
}

# ============================================================================
# Helper Functions for Stage Execution
# ============================================================================

# Check if factory is running
is_factory_running() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  local factory_dir
  factory_dir="$(get_factory_dir)"
  local runs_dir="$factory_dir/runs"

  if [[ ! -d "$runs_dir" ]]; then
    return 1
  fi

  # Check for any running state
  for state_file in "$runs_dir"/run-*/state.json; do
    if [[ -f "$state_file" ]]; then
      local status
      status=$(jq -r '.status // "unknown"' "$state_file" 2>/dev/null || echo "unknown")
      if [[ "$status" == "running" ]]; then
        return 0
      fi
    fi
  done

  return 1
}

# Get current factory run ID
get_active_run_id() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  local factory_dir
  factory_dir="$(get_factory_dir)"
  local runs_dir="$factory_dir/runs"

  if [[ ! -d "$runs_dir" ]]; then
    echo ""
    return
  fi

  # Find running factory
  for state_file in "$runs_dir"/run-*/state.json; do
    if [[ -f "$state_file" ]]; then
      local status run_id
      status=$(jq -r '.status // "unknown"' "$state_file" 2>/dev/null || echo "unknown")
      run_id=$(jq -r '.runId // ""' "$state_file" 2>/dev/null || echo "")
      if [[ "$status" == "running" && -n "$run_id" ]]; then
        echo "$run_id"
        return
      fi
    fi
  done

  echo ""
}

# Get latest run ID (regardless of status)
get_latest_run_id() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  local factory_dir
  factory_dir="$(get_factory_dir)"
  local runs_dir="$factory_dir/runs"

  if [[ ! -d "$runs_dir" ]]; then
    echo ""
    return
  fi

  # Find latest run by timestamp
  local latest=""
  local latest_time=0

  for run_dir in "$runs_dir"/run-*/; do
    if [[ -d "$run_dir" ]]; then
      local run_id="${run_dir##*/}"
      run_id="${run_id%/}"
      local time_part="${run_id#run-}"

      if [[ "$time_part" =~ ^[0-9]+$ ]] && (( time_part > latest_time )); then
        latest_time="$time_part"
        latest="$run_id"
      fi
    fi
  done

  echo "$latest"
}

# ============================================================================
# Stage Context Helpers
# ============================================================================

# Read stage output from a factory run
get_stage_output() {
  local run_id="$1"
  local stage_id="$2"
  local field="${3:-}"

  local factory_dir
  factory_dir="$(get_factory_dir)"
  local result_file="$factory_dir/runs/$run_id/stages/$stage_id/result.json"

  if [[ ! -f "$result_file" ]]; then
    echo ""
    return 1
  fi

  if [[ -n "$field" ]]; then
    jq -r ".output.$field // \"\"" "$result_file" 2>/dev/null || echo ""
  else
    cat "$result_file"
  fi
}

# Get PRD number from a factory run
get_factory_prd_number() {
  local run_id="$1"
  local stage_id="${2:-generate_prd}"

  get_stage_output "$run_id" "$stage_id" "prd_number"
}

# ============================================================================
# Learning Helpers
# ============================================================================

# Add a learning to the project
add_factory_learning() {
  local type="$1"
  local message="$2"
  local stage_id="${3:-unknown}"

  local factory_dir
  factory_dir="$(get_factory_dir)"
  local learnings_file="$factory_dir/learnings.json"

  # Create learnings file if it doesn't exist
  if [[ ! -f "$learnings_file" ]]; then
    mkdir -p "$factory_dir"
    echo '{"learnings": [], "version": 1}' > "$learnings_file"
  fi

  # Add learning using jq
  local timestamp
  timestamp=$(date -Iseconds)
  local id="learning-$(date +%s)-$(head /dev/urandom | tr -dc a-z0-9 | head -c 6)"

  jq --arg type "$type" \
     --arg message "$message" \
     --arg stage_id "$stage_id" \
     --arg timestamp "$timestamp" \
     --arg id "$id" \
     '.learnings += [{id: $id, type: $type, message: $message, stage_id: $stage_id, added_at: $timestamp}]' \
     "$learnings_file" > "$learnings_file.tmp" && mv "$learnings_file.tmp" "$learnings_file"
}

# Get recent learnings as text
get_recent_learnings() {
  local count="${1:-5}"
  local factory_dir
  factory_dir="$(get_factory_dir)"
  local learnings_file="$factory_dir/learnings.json"

  if [[ ! -f "$learnings_file" ]]; then
    echo ""
    return
  fi

  jq -r ".learnings | .[-$count:] | .[] | \"[\(.type)] \(.message)\"" "$learnings_file" 2>/dev/null || echo ""
}

# ============================================================================
# YAML Helpers (Basic)
# ============================================================================

# Get a value from factory YAML (requires yq)
factory_config_get() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"
  local key="$2"

  local factory_dir
  factory_dir="$(get_factory_dir)"
  local config_file="$factory_dir/$name.yaml"

  if [[ ! -f "$config_file" ]]; then
    echo ""
    return 1
  fi

  # Try yq if available, otherwise fall back to grep
  if command -v yq &>/dev/null; then
    yq e ".$key" "$config_file" 2>/dev/null
  else
    # Basic grep for simple values
    grep -E "^$key:" "$config_file" | sed 's/^[^:]*:\s*//' | head -1
  fi
}

# Count stages in factory config
factory_stage_count() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"

  local factory_dir
  factory_dir="$(get_factory_dir)"
  local config_file="$factory_dir/$name.yaml"

  if [[ ! -f "$config_file" ]]; then
    echo "0"
    return
  fi

  grep -c "^  - id:" "$config_file" 2>/dev/null || echo "0"
}

# ============================================================================
# Validation Helpers
# ============================================================================

# Check if factory config is valid
validate_factory_config() {
  local name="${1:-$DEFAULT_FACTORY_NAME}"

  ralph factory stages "$name" > /dev/null 2>&1
  return $?
}

# Check if all dependencies installed for factory
check_factory_deps() {
  local missing=()

  # Check for jq (used for JSON manipulation)
  if ! command -v jq &>/dev/null; then
    missing+=("jq")
  fi

  # Check for ralph CLI
  if ! command -v ralph &>/dev/null; then
    missing+=("ralph")
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    msg_error "Missing dependencies: ${missing[*]}"
    return 1
  fi

  return 0
}

# ============================================================================
# Main (when run directly)
# ============================================================================

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  cmd="${1:-}"
  shift || true

  case "$cmd" in
    init)
      factory_init "$@"
      ;;
    run)
      factory_run "$@"
      ;;
    status)
      factory_status "$@"
      ;;
    stop)
      factory_stop "$@"
      ;;
    resume)
      factory_resume "$@"
      ;;
    stages)
      factory_stages "$@"
      ;;
    graph)
      factory_graph "$@"
      ;;
    is-running)
      if is_factory_running "$@"; then
        echo "yes"
        exit 0
      else
        echo "no"
        exit 1
      fi
      ;;
    *)
      echo "Ralph Factory Utilities"
      echo ""
      echo "Usage: factory.sh <command> [args]"
      echo ""
      echo "Commands:"
      echo "  init [name]        Initialize factory"
      echo "  run [name]         Run factory"
      echo "  status [name]      Show status"
      echo "  stop [name]        Stop factory"
      echo "  resume [name]      Resume factory"
      echo "  stages [name]      List stages"
      echo "  graph [name]       Show graph"
      echo "  is-running [name]  Check if running"
      echo ""
      exit 1
      ;;
  esac
fi
