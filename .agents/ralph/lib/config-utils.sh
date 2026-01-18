#!/usr/bin/env bash
# Config Utilities - Shared JSON config reading with jq fallback
#
# Usage:
#   source .agents/ralph/lib/config-utils.sh
#   value=$(get_config_value ".autoSpeak.enabled" "false")
#   if is_config_true ".progress.enabled"; then echo "enabled"; fi
#
# Functions:
#   get_config_value <jq_path> <default> [config_file] - Get value from JSON config
#   is_config_true <jq_path> [config_file] - Check if config value is "true"
#   is_config_false <jq_path> [config_file] - Check if config value is "false"
#   get_config_int <jq_path> <default> <min> <max> [config_file] - Get integer with validation

set -euo pipefail

# Get script directory for sourcing path-utils
CONFIG_UTILS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source path utilities if not already sourced
if ! declare -f find_ralph_root &>/dev/null; then
  source "${CONFIG_UTILS_DIR}/path-utils.sh"
fi

# Resolve default config file path
_get_default_config_file() {
  local ralph_dir
  ralph_dir="$(find_ralph_root 2>/dev/null)" || ralph_dir="${RALPH_ROOT:-$(pwd)}/.ralph"
  echo "${ralph_dir}/voice-config.json"
}

# Get a value from JSON config file with fallback default
# Usage: get_config_value ".path.to.value" "default_value" [config_file]
get_config_value() {
  local jq_path="$1"
  local default="$2"
  local config_file="${3:-$(_get_default_config_file)}"

  if [[ ! -f "$config_file" ]]; then
    echo "$default"
    return
  fi

  if command -v jq &>/dev/null; then
    local value
    value=$(jq -r "${jq_path} // null" "$config_file" 2>/dev/null)
    if [[ -n "$value" && "$value" != "null" ]]; then
      echo "$value"
    else
      echo "$default"
    fi
  else
    echo "$default"
  fi
}

# Check if a config value equals "true"
# Usage: if is_config_true ".autoSpeak.enabled"; then ...
is_config_true() {
  local jq_path="$1"
  local config_file="${2:-$(_get_default_config_file)}"
  local value
  value=$(get_config_value "$jq_path" "false" "$config_file")
  [[ "$value" == "true" ]]
}

# Check if a config value equals "false"
# Usage: if is_config_false ".progress.enabled"; then ...
is_config_false() {
  local jq_path="$1"
  local config_file="${2:-$(_get_default_config_file)}"
  local value
  value=$(get_config_value "$jq_path" "true" "$config_file")
  [[ "$value" == "false" ]]
}

# Get an integer from config with min/max validation
# Usage: interval=$(get_config_int ".progress.intervalSeconds" 15 5 120)
get_config_int() {
  local jq_path="$1"
  local default="$2"
  local min="$3"
  local max="$4"
  local config_file="${5:-$(_get_default_config_file)}"

  local value
  value=$(get_config_value "$jq_path" "$default" "$config_file")

  # Validate it's an integer within range
  if [[ "$value" =~ ^[0-9]+$ ]] && [[ "$value" -ge "$min" ]] && [[ "$value" -le "$max" ]]; then
    echo "$value"
  else
    echo "$default"
  fi
}

# Export functions
export -f get_config_value
export -f is_config_true
export -f is_config_false
export -f get_config_int
