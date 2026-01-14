#!/bin/bash
# Shared git utilities for ralph scripts
# Source this file to get git helper functions
#
# Functions:
#   git_head          - Returns current HEAD SHA
#   git_commit_list   - Returns formatted commit list between SHAs
#   git_changed_files - Returns changed files between SHAs
#   git_dirty_files   - Returns uncommitted files
#
# All functions accept an optional ROOT_DIR parameter to support worktree contexts.
# If not provided, defaults to the ROOT_DIR variable set by the sourcing script,
# or falls back to current directory.

# ============================================================================
# Configuration
# ROOT_DIR can be overridden by sourcing script before sourcing this library
# ============================================================================

# Default ROOT_DIR if not already set (sourcing script should set this)
: "${ROOT_DIR:=$(pwd)}"

# ============================================================================
# Git helper functions
# ============================================================================

git_head() {
  # Returns the current HEAD SHA or empty string if not in a git repo
  # Usage: sha=$(git_head)
  #        sha=$(git_head "/path/to/repo")
  local repo_dir="${1:-$ROOT_DIR}"

  if git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true
  else
    echo ""
  fi
}

git_commit_list() {
  # Returns formatted commit list between two SHAs (for progress logs)
  # Usage: commits=$(git_commit_list "$before_sha" "$after_sha")
  #        commits=$(git_commit_list "$before_sha" "$after_sha" "/path/to/repo")
  local before="$1"
  local after="$2"
  local repo_dir="${3:-$ROOT_DIR}"

  if [[ -n "$before" ]] && [[ -n "$after" ]] && [[ "$before" != "$after" ]]; then
    git -C "$repo_dir" log --oneline "$before..$after" 2>/dev/null | sed 's/^/- /'
  else
    echo ""
  fi
}

git_changed_files() {
  # Returns list of changed files between two SHAs (for progress logs)
  # Usage: files=$(git_changed_files "$before_sha" "$after_sha")
  #        files=$(git_changed_files "$before_sha" "$after_sha" "/path/to/repo")
  local before="$1"
  local after="$2"
  local repo_dir="${3:-$ROOT_DIR}"

  if [[ -n "$before" ]] && [[ -n "$after" ]] && [[ "$before" != "$after" ]]; then
    git -C "$repo_dir" diff --name-only "$before" "$after" 2>/dev/null | sed 's/^/- /'
  else
    echo ""
  fi
}

git_dirty_files() {
  # Returns list of uncommitted files (staged + unstaged)
  # Usage: dirty=$(git_dirty_files)
  #        dirty=$(git_dirty_files "/path/to/repo")
  local repo_dir="${1:-$ROOT_DIR}"

  if git -C "$repo_dir" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$repo_dir" status --porcelain 2>/dev/null | awk '{print "- " $2}'
  else
    echo ""
  fi
}
