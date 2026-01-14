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

git_sha_exists() {
  # Validate that a git SHA exists and is reachable in the repository
  # Usage: if git_sha_exists "$sha"; then ... fi
  #        if git_sha_exists "$sha" "/path/to/repo"; then ... fi
  # Returns: 0 if SHA exists, 1 if not
  local sha="$1"
  local repo_dir="${2:-$ROOT_DIR}"

  if [[ -z "$sha" ]]; then
    return 1
  fi

  git -C "$repo_dir" rev-parse --verify "${sha}^{commit}" >/dev/null 2>&1
}

is_valid_sha() {
  # Validate SHA format (40 hexadecimal characters)
  # Usage: if is_valid_sha "$sha"; then ... fi
  # Returns: 0 if format is valid, 1 if not
  local sha="$1"

  if [[ -z "$sha" ]]; then
    return 1
  fi

  # Full SHA: 40 hex characters
  if [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
    return 0
  fi

  # Short SHA: 7-40 hex characters (common short form)
  if [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]]; then
    return 0
  fi

  return 1
}

# ============================================================================
# Batch git operations for performance (P2.2)
# Combines multiple git calls into one to reduce overhead (~150ms -> ~50ms)
# ============================================================================

git_status_batch() {
  # Returns commit list, changed files, and dirty files in one git call
  # Output format: three sections separated by ---SEPARATOR---
  #   Section 1: Commits between before and after
  #   Section 2: Changed files between before and after
  #   Section 3: Dirty (uncommitted) files
  # Usage: output=$(git_status_batch "$before_sha" "$after_sha")
  #        commits=$(echo "$output" | sed -n '1,/---SEPARATOR---/p' | grep -v SEPARATOR)
  local before="$1"
  local after="$2"
  local repo_dir="${3:-$ROOT_DIR}"

  {
    # Section 1: Commits
    if [[ -n "$before" ]] && [[ -n "$after" ]] && [[ "$before" != "$after" ]]; then
      git -C "$repo_dir" log --oneline "$before..$after" 2>/dev/null | sed 's/^/- /'
    fi
    echo "---SEPARATOR---"

    # Section 2: Changed files
    if [[ -n "$before" ]] && [[ -n "$after" ]] && [[ "$before" != "$after" ]]; then
      git -C "$repo_dir" diff --name-only "$before" "$after" 2>/dev/null | sed 's/^/- /'
    fi
    echo "---SEPARATOR---"

    # Section 3: Dirty files
    git -C "$repo_dir" status --porcelain 2>/dev/null | awk '{print "- " $2}'
  }
}

# Parse commit list from batch output
git_batch_commits() {
  local output="$1"
  echo "$output" | sed -n '1,/---SEPARATOR---/p' | grep -v "^---SEPARATOR---$"
}

# Parse changed files from batch output
git_batch_changed_files() {
  local output="$1"
  echo "$output" | sed -n '/---SEPARATOR---/,/---SEPARATOR---/{//d;p}' | head -n -1 2>/dev/null || \
    echo "$output" | sed -n '/---SEPARATOR---/,/---SEPARATOR---/{//d;p}'
}

# Parse dirty files from batch output
git_batch_dirty_files() {
  local output="$1"
  echo "$output" | sed -n '/---SEPARATOR---$/,$p' | tail -n +2
}
