#!/bin/bash
# Ralph Stream Management - Multi-PRD parallel execution
# Usage:
#   stream.sh new ["description"]     Create new stream (PRD-N)
#   stream.sh list                    List all streams
#   stream.sh status                  Show detailed status
#   stream.sh init <N>                Initialize worktree for stream
#   stream.sh build <N> [iters]       Run build in stream
#   stream.sh merge <N>               Merge completed stream

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${RALPH_ROOT:-$(pwd)}" && pwd)"
RALPH_DIR="$ROOT_DIR/.ralph"
WORKTREES_DIR="$RALPH_DIR/worktrees"
LOCKS_DIR="$RALPH_DIR/locks"

# Source shared output utilities (colors, msg_* functions, visual helpers)
# shellcheck source=lib/output.sh
source "$SCRIPT_DIR/lib/output.sh"

# ============================================================================
# Helpers
# ============================================================================

get_next_stream_id() {
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

normalize_stream_id() {
  local input="$1"
  if [[ "$input" =~ ^[0-9]+$ ]]; then
    echo "PRD-$input"
  elif [[ "$input" =~ ^[Pp][Rr][Dd]-[0-9]+$ ]]; then
    # Normalize to uppercase PRD-N
    local num="${input##*[Pp][Rr][Dd]-}"
    echo "PRD-$num"
  else
    echo ""
  fi
}

stream_exists() {
  local stream_id="$1"
  # Check both uppercase and legacy lowercase
  [[ -d "$RALPH_DIR/$stream_id" ]] || [[ -d "$RALPH_DIR/${stream_id,,}" ]]
}

get_stream_dir() {
  local stream_id="$1"
  # Check uppercase first (new), then legacy lowercase
  if [[ -d "$RALPH_DIR/$stream_id" ]]; then
    echo "$RALPH_DIR/$stream_id"
  elif [[ -d "$RALPH_DIR/${stream_id,,}" ]]; then
    echo "$RALPH_DIR/${stream_id,,}"
  else
    # Default to the given stream_id (should be uppercase for new)
    echo "$RALPH_DIR/$stream_id"
  fi
}

worktree_exists() {
  local stream_id="$1"
  [[ -d "$WORKTREES_DIR/$stream_id" ]]
}

is_stream_running() {
  local stream_id="$1"
  local lock_file="$LOCKS_DIR/$stream_id.lock"
  if [[ -f "$lock_file" ]]; then
    local pid
    pid=$(cat "$lock_file")
    if kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

acquire_lock() {
  local stream_id="$1"
  mkdir -p "$LOCKS_DIR"
  local lock_file="$LOCKS_DIR/$stream_id.lock"

  if is_stream_running "$stream_id"; then
    echo "Stream $stream_id is already running" >&2
    return 1
  fi

  echo $$ > "$lock_file"
  return 0
}

release_lock() {
  local stream_id="$1"
  rm -f "$LOCKS_DIR/$stream_id.lock"
}

# ============================================================================
# Merge Lock Functions (Global lock for serialized merges)
# ============================================================================

MERGE_LOCK_FILE="$LOCKS_DIR/merge.lock"

acquire_merge_lock() {
  local stream_id="$1"
  mkdir -p "$LOCKS_DIR"

  # Check if lock is already held by a running process
  if is_merge_lock_held; then
    local holder_stream holder_pid holder_time
    holder_stream=$(grep '^STREAM_ID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
    holder_pid=$(grep '^PID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
    msg_error "Merge lock is held by $holder_stream (PID $holder_pid)" >&2
    return 1
  fi

  # Create lock file with PID, stream ID, and timestamp
  cat > "$MERGE_LOCK_FILE" << EOF
PID=$$
STREAM_ID=$stream_id
TIMESTAMP=$(date +%s)
EOF

  return 0
}

release_merge_lock() {
  rm -f "$MERGE_LOCK_FILE"
}

is_merge_lock_held() {
  if [[ ! -f "$MERGE_LOCK_FILE" ]]; then
    return 1
  fi

  local pid
  pid=$(grep '^PID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)

  if [[ -z "$pid" ]]; then
    return 1
  fi

  # Check if the process is still running
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  # Lock exists but process is dead - stale lock
  msg_warn "Cleaning up stale merge lock (PID $pid no longer running)"
  rm -f "$MERGE_LOCK_FILE"
  return 1
}

get_stream_status() {
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  if [[ ! -d "$stream_dir" ]]; then
    echo "not_found"
    return
  fi

  if is_stream_running "$stream_id"; then
    echo "running"
    return
  fi

  # Check if all stories are done by looking at PRD
  local prd_file="$stream_dir/prd.md"
  if [[ ! -f "$prd_file" ]]; then
    echo "no_prd"
    return
  fi

  local total remaining
  total=$(grep -c '### \[' "$prd_file" 2>/dev/null || true)
  remaining=$(grep -c '### \[ \]' "$prd_file" 2>/dev/null || true)
  total=${total:-0}
  remaining=${remaining:-0}

  if [[ "$total" -eq 0 ]]; then
    echo "no_stories"
  elif [[ "$remaining" -eq 0 ]]; then
    echo "completed"
  else
    echo "ready"
  fi
}

count_stories() {
  local prd_file="$1"
  if [[ -f "$prd_file" ]]; then
    local total remaining
    total=$(grep -c '### \[' "$prd_file" 2>/dev/null || true)
    remaining=$(grep -c '### \[ \]' "$prd_file" 2>/dev/null || true)
    total=${total:-0}
    remaining=${remaining:-0}
    local done=$((total - remaining))
    echo "$done/$total"
  else
    echo "0/0"
  fi
}

get_human_time_diff() {
  # Returns human-readable time difference (e.g., "2h ago", "5m ago")
  local file="$1"
  if [[ ! -f "$file" ]]; then
    echo "-"
    return
  fi

  local now file_mtime diff
  now=$(date +%s)
  file_mtime=$(stat -f %m "$file" 2>/dev/null || stat -c %Y "$file" 2>/dev/null || echo 0)

  if [[ "$file_mtime" -eq 0 ]]; then
    echo "-"
    return
  fi

  diff=$((now - file_mtime))

  if [[ $diff -lt 60 ]]; then
    echo "${diff}s ago"
  elif [[ $diff -lt 3600 ]]; then
    echo "$((diff / 60))m ago"
  elif [[ $diff -lt 86400 ]]; then
    echo "$((diff / 3600))h ago"
  else
    echo "$((diff / 86400))d ago"
  fi
}

# ============================================================================
# Commands
# ============================================================================

cmd_new() {
  local description="${1:-}"
  local stream_num
  stream_num=$(get_next_stream_id)
  local stream_id="PRD-$stream_num"
  local stream_dir="$RALPH_DIR/$stream_id"

  mkdir -p "$stream_dir/runs"

  # Create empty state files
  touch "$stream_dir/progress.md"
  touch "$stream_dir/errors.log"
  touch "$stream_dir/activity.log"

  # Create PRD template
  cat > "$stream_dir/prd.md" << 'EOF'
# Product Requirements Document

## Overview

<!-- Describe what this stream/feature is about -->

## User Stories

### [ ] US-001: First story
**As a** user
**I want** feature
**So that** benefit

#### Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

EOF

  # Create plan template
  cat > "$stream_dir/plan.md" << 'EOF'
# Implementation Plan

<!-- Generated by ralph stream plan -->

EOF

  printf "\n${C_GREEN}${SYM_SUCCESS}${C_RESET} ${C_BOLD}Created stream:${C_RESET} ${C_CYAN}%s${C_RESET}\n" "$stream_id"
  bullet "Location: $(path_display "$RALPH_DIR/$stream_id/")"

  next_steps_header
  numbered_step 1 "Edit PRD: $(path_display "$stream_dir/prd.md")"
  numbered_step 2 "Generate plan: ${C_DIM}ralph stream plan $stream_num${C_RESET}"
  numbered_step 3 "Run build: ${C_DIM}ralph stream build $stream_num${C_RESET}"

  # Return just the number for scripting
  printf "\n${C_DIM}Stream ID: %s${C_RESET}\n" "$stream_num"
}

cmd_list() {
  if [[ ! -d "$RALPH_DIR" ]]; then
    msg_warn "No .ralph/ directory found."
    return
  fi

  section_header "Ralph Streams"

  local found=0
  # Check both PRD-N (new) and prd-N (legacy) folders
  for dir in "$RALPH_DIR"/PRD-* "$RALPH_DIR"/prd-*; do
    if [[ -d "$dir" ]]; then
      found=1
      local stream_id="${dir##*/}"
      local num="${stream_id##*[Pp][Rr][Dd]-}"
      local status
      status=$(get_stream_status "$stream_id")
      local progress
      progress=$(count_stories "$dir/prd.md")

      # Use standardized symbols and colors
      local symbol status_color
      case "$status" in
        running)
          symbol="$SYM_RUNNING"
          status_color="${C_BOLD}${C_YELLOW}"
          ;;
        completed)
          symbol="$SYM_COMPLETED"
          status_color="${C_GREEN}"
          ;;
        ready)
          symbol="$SYM_READY"
          status_color="${C_CYAN}"
          ;;
        *)
          symbol="$SYM_UNKNOWN"
          status_color="${C_DIM}"
          ;;
      esac

      printf "  %s ${C_BOLD}PRD-%s${C_RESET}  ${status_color}%-10s${C_RESET}  %s stories\n" "$symbol" "$num" "$status" "$progress"
    fi
  done

  if [[ $found -eq 0 ]]; then
    msg_dim "  No streams found."
    next_steps_header
    numbered_step 1 "Create one with: ${C_DIM}ralph stream new${C_RESET}"
  fi
  echo ""
}

cmd_status() {
  section_header "Ralph Multi-Stream Status"
  echo "┌──────────┬────────────┬──────────┬──────────┬──────────┐"
  printf "│ ${C_DIM}%-8s${C_RESET} │ ${C_DIM}%-10s${C_RESET} │ ${C_DIM}%-8s${C_RESET} │ ${C_DIM}%-8s${C_RESET} │ ${C_DIM}%-8s${C_RESET} │\n" "STREAM" "STATUS" "PROGRESS" "MODIFIED" "WORKTREE"
  echo "├──────────┼────────────┼──────────┼──────────┼──────────┤"

  if [[ ! -d "$RALPH_DIR" ]]; then
    printf "│ %-54s │\n" "No streams found."
    echo "└──────────┴────────────┴──────────┴──────────┴──────────┘"
    return
  fi

  local found=0
  # Check both PRD-N (new) and prd-N (legacy) folders
  for dir in "$RALPH_DIR"/PRD-* "$RALPH_DIR"/prd-*; do
    if [[ -d "$dir" ]]; then
      found=1
      local stream_id="${dir##*/}"
      local status
      status=$(get_stream_status "$stream_id")
      local progress
      progress=$(count_stories "$dir/prd.md")
      local has_worktree="no"
      if worktree_exists "$stream_id"; then
        has_worktree="yes"
      fi

      # Get last modified time for progress.md
      local last_modified
      last_modified=$(get_human_time_diff "$dir/progress.md")

      # Use standardized symbols and color based on status
      local symbol status_color row_prefix row_suffix
      row_prefix=""
      row_suffix=""
      case "$status" in
        running)
          symbol="$SYM_RUNNING"
          status_color="${C_BOLD}${C_YELLOW}"
          row_prefix="${C_BOLD}"
          row_suffix="${C_RESET}"
          ;;
        completed)
          symbol="$SYM_COMPLETED"
          status_color="${C_GREEN}"
          ;;
        ready)
          symbol="$SYM_READY"
          status_color="${C_CYAN}"
          ;;
        *)
          symbol="$SYM_UNKNOWN"
          status_color="${C_DIM}"
          ;;
      esac

      # Print row with color-coded status
      printf "${row_prefix}│ %s %-6s │ ${status_color}%-10s${C_RESET}${row_prefix} │ %-8s │ %-8s │ %-8s │${row_suffix}\n" \
        "$symbol" "$stream_id" "$status" "$progress" "$last_modified" "$has_worktree"
    fi
  done

  if [[ $found -eq 0 ]]; then
    printf "│ %-54s │\n" "No streams found."
  fi

  echo "└──────────┴────────────┴──────────┴──────────┴──────────┘"
  echo ""
  msg_dim "Legend: $SYM_COMPLETED completed  $SYM_RUNNING running  $SYM_READY ready  $SYM_UNKNOWN unknown"
  echo ""
}

cmd_init() {
  local input="$1"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  if ! stream_exists "$stream_id"; then
    msg_error "Stream not found: $stream_id" >&2
    next_steps_header
    numbered_step 1 "Create it first: ${C_DIM}ralph stream new${C_RESET}"
    return 1
  fi

  if worktree_exists "$stream_id"; then
    msg_warn "Worktree already exists for $stream_id"
    return 0
  fi

  local branch="ralph/$stream_id"
  local worktree_path="$WORKTREES_DIR/$stream_id"

  # Create branch from current HEAD if it doesn't exist
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    git branch "$branch"
    msg_dim "Created branch: $branch"
  fi

  # Create worktree
  mkdir -p "$WORKTREES_DIR"
  git worktree add "$worktree_path" "$branch"

  # Copy stream state to worktree
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"
  local wt_ralph_dir="$worktree_path/.ralph/$stream_id"
  mkdir -p "$wt_ralph_dir"
  cp -r "$stream_dir"/* "$wt_ralph_dir/"

  # Copy shared guardrails if exists
  if [[ -f "$RALPH_DIR/guardrails.md" ]]; then
    cp "$RALPH_DIR/guardrails.md" "$worktree_path/.ralph/"
  fi

  printf "\n${C_GREEN}${SYM_SUCCESS}${C_RESET} ${C_BOLD}Initialized worktree for %s${C_RESET}\n" "$stream_id"
  bullet "Path: $(path_display "$worktree_path")"
  bullet "Branch: ${C_CYAN}$branch${C_RESET}"
}

cmd_build() {
  local input="$1"
  local iterations="${2:-1}"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  if ! stream_exists "$stream_id"; then
    msg_error "Stream not found: $stream_id" >&2
    return 1
  fi

  # Acquire lock
  if ! acquire_lock "$stream_id"; then
    return 1
  fi

  # Set up cleanup on exit
  trap "release_lock '$stream_id'" EXIT

  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"
  local work_dir="$ROOT_DIR"

  # If worktree exists, use it
  if worktree_exists "$stream_id"; then
    work_dir="$WORKTREES_DIR/$stream_id"
    stream_dir="$work_dir/.ralph/$stream_id"
  fi

  section_header "Running build for $stream_id"
  bullet "Work dir: $(path_display "$work_dir")"
  bullet "Iterations: ${C_BOLD}$iterations${C_RESET}"
  echo ""

  # Run loop.sh with stream-specific paths
  cd "$work_dir"
  PRD_PATH="$stream_dir/prd.md" \
  PLAN_PATH="$stream_dir/plan.md" \
  PROGRESS_PATH="$stream_dir/progress.md" \
  ERRORS_LOG_PATH="$stream_dir/errors.log" \
  ACTIVITY_LOG_PATH="$stream_dir/activity.log" \
  RUNS_DIR="$stream_dir/runs" \
    "$SCRIPT_DIR/loop.sh" build "$iterations"
}

# ============================================================================
# Pre-flight Conflict Check (US-002)
# ============================================================================

check_merge_conflicts() {
  # Check for merge conflicts before attempting the actual merge
  # Args: branch_to_merge, base_branch
  # Returns: 0 if no conflicts, 1 if conflicts detected
  # Outputs: List of conflicting files (one per line) if conflicts exist
  local branch_to_merge="$1"
  local base_branch="$2"
  local conflicts=""

  # Attempt a dry-run merge (no-commit, no-ff) to detect conflicts
  # We need to capture the output to get conflicting file names
  local merge_output
  if merge_output=$(git merge --no-commit --no-ff "$branch_to_merge" 2>&1); then
    # Merge succeeded without conflicts - abort it since we're just checking
    git merge --abort 2>/dev/null || git reset --hard HEAD 2>/dev/null
    return 0
  fi

  # Check if we're in a merge state (conflicts detected)
  if git rev-parse --verify MERGE_HEAD >/dev/null 2>&1; then
    # Get list of conflicting files
    conflicts=$(git diff --name-only --diff-filter=U 2>/dev/null)
    # Abort the merge
    git merge --abort 2>/dev/null || git reset --hard HEAD 2>/dev/null
  else
    # Merge failed for another reason (not conflicts) - reset just in case
    git reset --hard HEAD 2>/dev/null
    # Return empty conflicts but indicate failure
    echo "Merge failed: $merge_output" >&2
    return 1
  fi

  if [[ -n "$conflicts" ]]; then
    echo "$conflicts"
    return 1
  fi

  return 0
}

cmd_merge() {
  local input="$1"
  shift || true

  # Parse flags
  local force_merge=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        force_merge=true
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  if ! worktree_exists "$stream_id"; then
    msg_error "No worktree for $stream_id" >&2
    msg_dim "Nothing to merge - stream ran in main worktree"
    return 1
  fi

  local status
  status=$(get_stream_status "$stream_id")
  if [[ "$status" != "completed" ]]; then
    msg_error "Stream $stream_id is not completed (status: $status)" >&2
    return 1
  fi

  # Acquire global merge lock to prevent concurrent merges
  if ! acquire_merge_lock "$stream_id"; then
    msg_dim "Another merge is in progress. Wait for it to complete or use --force-unlock."
    return 1
  fi

  # Set up trap to release merge lock on exit (success or failure)
  trap 'release_merge_lock' EXIT

  local branch="ralph/$stream_id"
  local base_branch="main"

  # Check if main exists, otherwise use master
  if ! git show-ref --verify --quiet "refs/heads/main"; then
    if git show-ref --verify --quiet "refs/heads/master"; then
      base_branch="master"
    fi
  fi

  section_header "Merging $stream_id to $base_branch"

  # Switch to base branch
  git checkout "$base_branch"

  # Pre-flight conflict check (US-002)
  msg_dim "Checking for merge conflicts..."
  local conflict_files
  if ! conflict_files=$(check_merge_conflicts "$branch" "$base_branch"); then
    if [[ -n "$conflict_files" ]]; then
      msg_warn "Conflicts detected in the following files:"
      echo "$conflict_files" | while read -r file; do
        printf "  ${C_RED}•${C_RESET} %s\n" "$file"
      done
      echo ""
      if [[ "$force_merge" == "true" ]]; then
        msg_warn "Proceeding with merge due to --force flag"
      else
        msg_error "Merge aborted. Resolve conflicts first or use --force to proceed anyway."
        return 1
      fi
    else
      # Merge failed for non-conflict reason
      msg_error "Merge pre-check failed. See error above."
      return 1
    fi
  else
    msg_dim "No conflicts detected"
  fi

  # Merge stream branch
  if git merge --ff-only "$branch"; then
    msg_dim "Merged $branch to $base_branch (fast-forward)"
  else
    msg_warn "Fast-forward not possible. Attempting regular merge..."
    git merge "$branch" -m "Merge $stream_id"
  fi

  # Sync state files from worktree to main repo
  local worktree_path="$WORKTREES_DIR/$stream_id"
  local worktree_state_dir="$worktree_path/.ralph/$stream_id"
  local main_state_dir="$RALPH_DIR/$stream_id"

  # Also check for legacy lowercase stream_id in worktree
  if [[ ! -d "$worktree_state_dir" ]]; then
    worktree_state_dir="$worktree_path/.ralph/${stream_id,,}"
  fi

  if [[ -d "$worktree_state_dir" ]]; then
    msg_dim "Syncing state files from worktree..."

    # Sync key state files (prd.md, plan.md, progress.md, activity.log)
    for state_file in prd.md plan.md progress.md activity.log; do
      if [[ -f "$worktree_state_dir/$state_file" ]]; then
        cp "$worktree_state_dir/$state_file" "$main_state_dir/$state_file"
      fi
    done

    # Sync run logs directory if it exists
    if [[ -d "$worktree_state_dir/runs" ]]; then
      mkdir -p "$main_state_dir/runs"
      cp -r "$worktree_state_dir/runs/"* "$main_state_dir/runs/" 2>/dev/null || true
    fi

    msg_dim "State files synced to $(path_display "$main_state_dir")"
  fi

  printf "\n${C_GREEN}${SYM_SUCCESS}${C_RESET} ${C_BOLD}Stream %s merged successfully${C_RESET}\n" "$stream_id"

  next_steps_header
  numbered_step 1 "${C_DIM}git push origin $base_branch${C_RESET}"
  numbered_step 2 "${C_DIM}ralph stream cleanup $input${C_RESET}"
}

cmd_cleanup() {
  local input="$1"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  if ! worktree_exists "$stream_id"; then
    msg_dim "No worktree for $stream_id"
    return 0
  fi

  local worktree_path="$WORKTREES_DIR/$stream_id"

  section_header "Cleaning up $stream_id"
  msg_dim "Removing worktree at $(path_display "$worktree_path")"
  git worktree remove "$worktree_path" --force

  printf "${C_GREEN}${SYM_SUCCESS}${C_RESET} Cleaned up %s\n" "$stream_id"
}

# ============================================================================
# Main
# ============================================================================

cmd="${1:-}"
shift || true

case "$cmd" in
  new)
    cmd_new "$@"
    ;;
  list)
    cmd_list
    ;;
  status)
    cmd_status
    ;;
  init)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream init <N>" >&2
      exit 1
    fi
    cmd_init "$1"
    ;;
  build)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream build <N> [iterations]" >&2
      exit 1
    fi
    cmd_build "$1" "${2:-1}"
    ;;
  merge)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream merge <N> [--force]" >&2
      exit 1
    fi
    cmd_merge "$@"
    ;;
  cleanup)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream cleanup <N>" >&2
      exit 1
    fi
    cmd_cleanup "$1"
    ;;
  *)
    printf "${C_BOLD}Ralph Stream${C_RESET} ${C_DIM}- Multi-PRD parallel execution${C_RESET}\n"
    printf "\n${C_BOLD}${C_CYAN}Usage:${C_RESET}\n"
    printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
    printf "  ${C_GREEN}ralph stream new${C_RESET}              Create new stream (PRD-1, PRD-2, ...)\n"
    printf "  ${C_GREEN}ralph stream list${C_RESET}             List all streams\n"
    printf "  ${C_GREEN}ralph stream status${C_RESET}           Show detailed status\n"
    printf "  ${C_GREEN}ralph stream init ${C_YELLOW}<N>${C_RESET}         Initialize worktree for parallel execution\n"
    printf "  ${C_GREEN}ralph stream build ${C_YELLOW}<N>${C_RESET} ${C_DIM}[n]${C_RESET}    Run n build iterations in stream\n"
    printf "  ${C_GREEN}ralph stream merge ${C_YELLOW}<N>${C_RESET} ${C_DIM}[--force]${C_RESET} Merge completed stream (--force ignores conflicts)\n"
    printf "  ${C_GREEN}ralph stream cleanup ${C_YELLOW}<N>${C_RESET}      Remove stream worktree\n"
    printf "\n${C_BOLD}${C_CYAN}Examples:${C_RESET}\n"
    printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
    printf "  ${C_DIM}ralph stream new${C_RESET}              ${C_DIM}# Creates PRD-1${C_RESET}\n"
    printf "  ${C_DIM}ralph stream build 1 5${C_RESET}        ${C_DIM}# Run 5 iterations on PRD-1${C_RESET}\n"
    printf "  ${C_DIM}ralph stream init 1${C_RESET}           ${C_DIM}# Create worktree for parallel work${C_RESET}\n"
    printf "  ${C_DIM}ralph stream build 1 &${C_RESET}        ${C_DIM}# Run in background${C_RESET}\n"
    printf "  ${C_DIM}ralph stream build 2 &${C_RESET}        ${C_DIM}# Run another in parallel${C_RESET}\n"
    echo ""
    ;;
esac
