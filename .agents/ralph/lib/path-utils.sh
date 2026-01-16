#!/bin/bash
# Path resolution utilities for ralph scripts
# Provides smart path discovery that matches UI server behavior
#
# Functions:
#   find_ralph_root  - Find the .ralph directory (prefer parent when in ui/)

# ============================================================================
# Ralph Root Discovery
# ============================================================================

# Find the .ralph directory by walking up from current directory.
# Configuration priority:
# 1. RALPH_ROOT environment variable (if set and exists)
#    - Can point to either the .ralph directory itself or the project root
# 2. Parent directory's .ralph (when in ui/ subdirectory) - PRODUCTION DEFAULT
# 3. Current directory's .ralph
# 4. Walk up directory tree
#
# This matches the UI server's getRalphRoot() logic for consistency.
find_ralph_root() {
  # 1. Check if RALPH_ROOT is explicitly configured
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    local explicit_path
    explicit_path="$(cd "$RALPH_ROOT" 2>/dev/null && pwd)"
    if [[ -d "$explicit_path" ]]; then
      # Check if RALPH_ROOT points to .ralph directory itself
      if [[ "$(basename "$explicit_path")" == ".ralph" ]]; then
        echo "$explicit_path"
        return 0
      fi
      # Check if RALPH_ROOT points to project root with .ralph subdirectory
      if [[ -d "$explicit_path/.ralph" ]]; then
        echo "$explicit_path/.ralph"
        return 0
      fi
    fi
    echo "Warning: RALPH_ROOT set to $RALPH_ROOT but .ralph directory not found" >&2
  fi

  local current_dir
  current_dir="$(pwd)"
  local current_basename
  current_basename="$(basename "$current_dir")"

  # 2. Special case: If in ui/ subdirectory, prefer parent's .ralph for production
  if [[ "$current_basename" == "ui" ]]; then
    local parent_ralph
    parent_ralph="$(cd .. 2>/dev/null && pwd)/.ralph"
    if [[ -d "$parent_ralph" ]]; then
      echo "$parent_ralph"
      return 0
    fi
  fi

  # 3. Walk up from current directory
  local search_dir="$current_dir"
  while [[ "$search_dir" != "/" ]]; do
    if [[ -d "$search_dir/.ralph" ]]; then
      echo "$search_dir/.ralph"
      return 0
    fi
    search_dir="$(dirname "$search_dir")"
  done

  # 4. Check root directory
  if [[ -d "/.ralph" ]]; then
    echo "/.ralph"
    return 0
  fi

  # Not found
  return 1
}

# ============================================================================
# Exports
# ============================================================================

# Export function for use in scripts that source this file
export -f find_ralph_root
