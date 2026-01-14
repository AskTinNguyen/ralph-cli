#!/bin/bash
# Shared PRD folder management utilities for ralph scripts
# Source this file to get PRD directory helpers
#
# Functions:
#   get_next_prd_number     - Returns the next available PRD number
#   get_latest_prd_number   - Returns the most recent PRD number (or empty)
#   get_prd_dir             - Returns the path to a PRD folder by number
#   normalize_prd_id        - Normalizes input to "PRD-N" format
#   prd_exists              - Checks if a PRD folder exists

# ============================================================================
# Configuration
# RALPH_DIR can be overridden by sourcing script before sourcing this library
# ============================================================================

# Default RALPH_DIR if not already set
: "${RALPH_DIR:=.ralph}"

# Helper to convert string to lowercase (portable across bash/zsh)
_prd_utils_lowercase() {
  echo "$1" | tr '[:upper:]' '[:lower:]'
}

# ============================================================================
# PRD folder helpers
# Each plan gets its own PRD-N folder (supports legacy prd-N lowercase)
# ============================================================================

get_next_prd_number() {
  # Returns the next available PRD number (max + 1)
  # Usage: num=$(get_next_prd_number)
  local max=0
  local ralph_dir="${1:-$RALPH_DIR}"
  local dir

  if [[ -d "$ralph_dir" ]]; then
    # Check both PRD-N (new) and prd-N (legacy) folders
    # Use find instead of glob to handle empty matches gracefully
    while IFS= read -r dir; do
      if [[ -d "$dir" ]]; then
        local num="${dir##*[Pp][Rr][Dd]-}"
        if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max )); then
          max=$num
        fi
      fi
    done < <(find "$ralph_dir" -maxdepth 1 -type d -name 'PRD-*' -o -type d -name 'prd-*' 2>/dev/null)
  fi
  echo $((max + 1))
}

get_latest_prd_number() {
  # Returns the most recent (highest) PRD number, or empty string if none exist
  # Usage: num=$(get_latest_prd_number) || echo "No PRDs found"
  local max=0
  local ralph_dir="${1:-$RALPH_DIR}"
  local dir

  if [[ -d "$ralph_dir" ]]; then
    # Check both PRD-N (new) and prd-N (legacy) folders
    # Use find instead of glob to handle empty matches gracefully
    while IFS= read -r dir; do
      if [[ -d "$dir" ]]; then
        local num="${dir##*[Pp][Rr][Dd]-}"
        if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max )); then
          max=$num
        fi
      fi
    done < <(find "$ralph_dir" -maxdepth 1 -type d -name 'PRD-*' -o -type d -name 'prd-*' 2>/dev/null)
  fi
  if (( max == 0 )); then
    echo ""
  else
    echo "$max"
  fi
}

get_prd_dir() {
  # Returns the path to a PRD folder by number
  # Checks uppercase first (new), then legacy lowercase
  # Usage: dir=$(get_prd_dir 1)
  local num="$1"
  local ralph_dir="${2:-$RALPH_DIR}"

  # Check uppercase first (new), then legacy lowercase
  if [[ -d "$ralph_dir/PRD-$num" ]]; then
    echo "$ralph_dir/PRD-$num"
  elif [[ -d "$ralph_dir/prd-$num" ]]; then
    echo "$ralph_dir/prd-$num"
  else
    # Default to uppercase for new folders
    echo "$ralph_dir/PRD-$num"
  fi
}

normalize_prd_id() {
  # Normalizes various PRD identifier formats to "PRD-N"
  # Accepts: "1", "PRD-1", "prd-1", "Prd-1"
  # Returns: "PRD-1" (uppercase) or empty string if invalid
  # Usage: id=$(normalize_prd_id "1") # returns "PRD-1"
  local input="$1"

  if [[ "$input" =~ ^[0-9]+$ ]]; then
    echo "PRD-$input"
  elif [[ "$input" =~ ^[Pp][Rr][Dd]-([0-9]+)$ ]]; then
    # Normalize to uppercase PRD-N
    local num="${BASH_REMATCH[1]}"
    echo "PRD-$num"
  else
    echo ""
  fi
}

prd_exists() {
  # Checks if a PRD folder exists (supports both uppercase and lowercase)
  # Usage: if prd_exists "PRD-1"; then ...
  local prd_id="$1"
  local ralph_dir="${2:-$RALPH_DIR}"

  # Normalize the ID first
  local normalized
  normalized=$(normalize_prd_id "$prd_id")
  if [[ -z "$normalized" ]]; then
    return 1
  fi

  # Check both uppercase and legacy lowercase
  local lowercase
  lowercase=$(_prd_utils_lowercase "$normalized")
  [[ -d "$ralph_dir/$normalized" ]] || [[ -d "$ralph_dir/$lowercase" ]]
}

# ============================================================================
# Aliases for backward compatibility with stream.sh naming
# These provide the same functionality under stream-oriented names
# ============================================================================

get_next_stream_id() {
  # Alias for get_next_prd_number (stream = PRD)
  get_next_prd_number "$@"
}

normalize_stream_id() {
  # Alias for normalize_prd_id (stream = PRD)
  normalize_prd_id "$@"
}

stream_exists() {
  # Alias for prd_exists (stream = PRD)
  prd_exists "$@"
}

get_stream_dir() {
  # Alias for get_prd_dir but accepts stream_id format (PRD-N)
  # Usage: dir=$(get_stream_dir "PRD-1")
  local stream_id="$1"
  local ralph_dir="${2:-$RALPH_DIR}"

  # Check uppercase first (new), then legacy lowercase
  local lowercase
  lowercase=$(_prd_utils_lowercase "$stream_id")
  if [[ -d "$ralph_dir/$stream_id" ]]; then
    echo "$ralph_dir/$stream_id"
  elif [[ -d "$ralph_dir/$lowercase" ]]; then
    echo "$ralph_dir/$lowercase"
  else
    # Default to the given stream_id (should be uppercase for new)
    echo "$ralph_dir/$stream_id"
  fi
}
