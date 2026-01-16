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

# Source path utilities for smart ralph root discovery
# shellcheck source=lib/path-utils.sh
source "$SCRIPT_DIR/lib/path-utils.sh"

# Source shared output utilities (colors, msg_* functions, visual helpers)
# shellcheck source=lib/output.sh
source "$SCRIPT_DIR/lib/output.sh"

# Source watchdog module for auto-recovery (US-010)
# shellcheck source=lib/watchdog.sh
source "$SCRIPT_DIR/lib/watchdog.sh"

# Find ralph root using smart discovery (prefers parent .ralph when in ui/)
RALPH_DIR="$(find_ralph_root || echo "")"
if [[ -z "$RALPH_DIR" ]]; then
  msg_error "Cannot find .ralph directory. Run 'ralph install' first."
  exit 1
fi
ROOT_DIR="$(dirname "$RALPH_DIR")"
WORKTREES_DIR="$RALPH_DIR/worktrees"
LOCKS_DIR="$RALPH_DIR/locks"

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

get_current_branch() {
  git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""
}

is_on_protected_branch() {
  local current_branch
  current_branch=$(get_current_branch)
  [[ "$current_branch" == "main" || "$current_branch" == "master" ]]
}

get_base_branch_name() {
  if git show-ref --verify --quiet "refs/heads/main"; then
    echo "main"
  elif git show-ref --verify --quiet "refs/heads/master"; then
    echo "master"
  else
    echo "main"
  fi
}

is_stream_merged() {
  # Check if stream has been merged to main
  # Returns: 0 if merged, 1 if not merged
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # First check git history for actual merge (source of truth)
  if is_branch_merged_in_git "$stream_id"; then
    # Auto-create .merged marker if git shows it's merged but marker is missing
    if [[ ! -f "$stream_dir/.merged" ]]; then
      mark_stream_merged "$stream_id"
    fi
    return 0
  fi

  # Fallback: Check for .merged marker file (legacy or manual marking)
  [[ -f "$stream_dir/.merged" ]]
}

is_branch_merged_in_git() {
  # Verify if a stream's branch has been merged to main/master via git
  # Returns: 0 if merged, 1 if not merged or branch doesn't exist
  local stream_id="$1"
  local branch="ralph/$stream_id"
  local base_branch="main"

  # Check if main exists, otherwise use master
  if ! git show-ref --verify --quiet "refs/heads/main"; then
    if git show-ref --verify --quiet "refs/heads/master"; then
      base_branch="master"
    else
      # No main or master branch - can't verify
      return 1
    fi
  fi

  # Check if the branch exists in git
  if ! git show-ref --verify --quiet "refs/heads/$branch" 2>/dev/null; then
    # Branch doesn't exist locally - check if there's a merge commit in history
    # Look for merge commits mentioning this stream
    if git log --all --oneline --grep="$stream_id" --merges | grep -qi "merge"; then
      return 0
    fi
    return 1
  fi

  # Branch exists - check if it's been merged to base branch
  if git merge-base --is-ancestor "$branch" "$base_branch" 2>/dev/null; then
    return 0
  fi

  return 1
}

mark_stream_merged() {
  # Mark a stream as merged by creating .merged marker file
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # Create .merged marker with timestamp
  echo "merged_at=$(date -Iseconds)" > "$stream_dir/.merged"
  echo "merged_by=${USER:-unknown}" >> "$stream_dir/.merged"
}

get_prd_commits() {
  # Extract commit hashes from progress.md (format: "- Commit: abc123f message")
  # Args: stream_dir
  # Outputs: List of 7-char commit hashes, one per line
  local stream_dir="$1"
  local progress_file="$stream_dir/progress.md"

  if [[ ! -f "$progress_file" ]]; then
    return
  fi

  # Extract commit hashes from progress entries
  grep -E "^- Commit: [a-f0-9]{7}" "$progress_file" | \
    sed -E 's/^- Commit: ([a-f0-9]{7}).*/\1/' | \
    sort -u
}

verify_commit_exists() {
  # Check if a commit hash exists in git history
  # Args: commit_hash
  # Returns: 0 if commit exists, 1 otherwise
  local commit_hash="$1"

  git log --oneline 2>/dev/null | grep -q "^$commit_hash" && return 0
  return 1
}

has_git_evidence() {
  # Check if PRD has commits on current branch via 3-tier detection
  # Args: stream_id
  # Returns: 0 if evidence found, 1 otherwise
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # Tier 1: Extract commits from progress.md and verify in git (most reliable)
  local commits
  commits=$(get_prd_commits "$stream_dir")
  if [[ -n "$commits" ]]; then
    while read -r commit_hash; do
      if verify_commit_exists "$commit_hash"; then
        return 0
      fi
    done <<< "$commits"
  fi

  # Tier 2: Search git log for more specific PRD pattern (word boundary match)
  # Use -E for extended regex to properly match word boundaries
  if git log --all --oneline --grep="^.*PRD-${stream_id}.*$" 2>/dev/null | head -1 | grep -q .; then
    return 0
  fi

  # If no evidence found, status will be determined by file structure (plan.md, progress.md, etc.)
  return 1
}

is_stream_completed() {
  # Check if stream completed via direct-to-main workflow
  # Args: stream_id
  # Returns: 0 if completed (has .completed marker or git evidence), 1 otherwise
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # Quick check: .completed marker exists?
  if [[ -f "$stream_dir/.completed" ]]; then
    return 0
  fi

  # Check git evidence for commits
  if has_git_evidence "$stream_id"; then
    # Auto-create .completed marker
    mark_stream_completed "$stream_id"
    return 0
  fi

  return 1
}

mark_stream_completed() {
  # Mark a stream as completed via direct-to-main workflow
  # Args: stream_id
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # Create .completed marker with metadata
  {
    echo "completed_at=$(date -Iseconds)"
    echo "completed_by=${USER:-unknown}"
    echo "workflow=direct-to-main"
  } > "$stream_dir/.completed"
}

unmark_stream_completed() {
  # Remove completion marker from stream
  # Args: stream_id
  local stream_id="$1"
  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  rm -f "$stream_dir/.completed"
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

is_lock_stale() {
  # Check if a lock file contains a stale PID (process no longer running)
  # Args: lock_file_path
  # Returns: 0 if lock is stale (PID not running), 1 otherwise
  local lock_file="$1"

  if [[ ! -f "$lock_file" ]]; then
    return 1  # No lock file - not stale
  fi

  local pid
  pid=$(cat "$lock_file" 2>/dev/null)

  if [[ -z "$pid" ]]; then
    return 0  # Empty lock file - treat as stale
  fi

  # Check if PID is still running
  if kill -0 "$pid" 2>/dev/null; then
    return 1  # Process is running - lock is valid
  fi

  return 0  # Process is not running - lock is stale
}

cleanup_stale_lock() {
  # Clean up a stale lock file with warning
  # Args: lock_file_path
  # Returns: 0 if cleaned up, 1 if lock was valid or didn't exist
  local lock_file="$1"

  if [[ ! -f "$lock_file" ]]; then
    return 1  # No lock file to clean up
  fi

  if ! is_lock_stale "$lock_file"; then
    return 1  # Lock is valid - don't clean up
  fi

  # Read the PID before removing for logging
  local stale_pid
  stale_pid=$(cat "$lock_file" 2>/dev/null)

  # Remove the stale lock
  rm -f "$lock_file"

  # Log warning about stale lock cleanup
  msg_warn "Cleaned up stale lock (PID $stale_pid no longer running): $lock_file"

  return 0
}

acquire_lock() {
  local stream_id="$1"
  mkdir -p "$LOCKS_DIR"
  local lock_file="$LOCKS_DIR/$stream_id.lock"

  # Clean up stale lock before checking if stream is running
  cleanup_stale_lock "$lock_file"

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

get_merge_lock_info() {
  # Returns lock holder info: "STREAM_ID (PID PID) started Xs ago"
  if [[ ! -f "$MERGE_LOCK_FILE" ]]; then
    echo ""
    return
  fi

  local holder_stream holder_pid holder_time now elapsed
  holder_stream=$(grep '^STREAM_ID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
  holder_pid=$(grep '^PID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
  holder_time=$(grep '^TIMESTAMP=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)

  if [[ -z "$holder_stream" || -z "$holder_pid" ]]; then
    echo "unknown holder"
    return
  fi

  # Calculate elapsed time
  now=$(date +%s)
  elapsed=$((now - holder_time))

  if [[ $elapsed -lt 60 ]]; then
    echo "$holder_stream (PID $holder_pid) started ${elapsed}s ago"
  elif [[ $elapsed -lt 3600 ]]; then
    echo "$holder_stream (PID $holder_pid) started $((elapsed / 60))m ago"
  else
    echo "$holder_stream (PID $holder_pid) started $((elapsed / 3600))h ago"
  fi
}

# ============================================================================
# Active PRD Marker (Sequential Mode Support)
# ============================================================================
# Track which PRD is currently building to prevent contamination in
# non-worktree sequential mode. Only one PRD can be active at a time.

ACTIVE_PRD_FILE="$RALPH_DIR/.active-prd"

get_active_prd() {
  # Returns the currently active PRD number, or empty string if none
  if [[ -f "$ACTIVE_PRD_FILE" ]]; then
    cat "$ACTIVE_PRD_FILE"
  else
    echo ""
  fi
}

is_prd_active() {
  # Check if a specific PRD is currently active
  # Args: stream_id (e.g., "PRD-2" or "2")
  local stream_id="$1"
  local stream_num="${stream_id##*PRD-}"  # Extract number
  local active
  active=$(get_active_prd)
  [[ -n "$active" && "$active" == "$stream_num" ]]
}

has_active_prd() {
  # Returns 0 if any PRD is currently active
  local active
  active=$(get_active_prd)
  [[ -n "$active" ]]
}

set_active_prd() {
  # Mark a PRD as active
  # Args: stream_id (e.g., "PRD-2" or "2")
  local stream_id="$1"
  local stream_num="${stream_id##*PRD-}"  # Extract number

  mkdir -p "$RALPH_DIR"
  echo "$stream_num" > "$ACTIVE_PRD_FILE"
}

clear_active_prd() {
  # Clear the active PRD marker
  rm -f "$ACTIVE_PRD_FILE"
}

get_active_prd_info() {
  # Returns formatted info about active PRD for display
  local active
  active=$(get_active_prd)
  if [[ -n "$active" ]]; then
    echo "PRD-$active"
  else
    echo "none"
  fi
}

# ============================================================================
# Retry with backoff (US-004)
# ============================================================================

SPINNER_CHARS='|/-\'

show_wait_spinner() {
  # Display spinner with elapsed time and lock holder info
  # Args: elapsed_seconds, total_wait, lock_holder_info
  local elapsed="$1"
  local max_wait="$2"
  local lock_info="$3"
  local spinner_idx=$((elapsed % 4))
  local spinner_char="${SPINNER_CHARS:$spinner_idx:1}"

  # Format elapsed time nicely
  local elapsed_str
  if [[ $elapsed -lt 60 ]]; then
    elapsed_str="${elapsed}s"
  else
    elapsed_str="$((elapsed / 60))m $((elapsed % 60))s"
  fi

  # Clear line and print spinner
  printf "\r${C_YELLOW}%s${C_RESET} Waiting for merge lock... ${C_DIM}[%s / %ss]${C_RESET} ${C_DIM}Held by: %s${C_RESET}  " \
    "$spinner_char" "$elapsed_str" "$max_wait" "$lock_info"
}

# ============================================================================
# Merge Queue Tracking (US-005)
# ============================================================================

MERGE_QUEUE_DIR="$LOCKS_DIR/merge-queue"

register_in_merge_queue() {
  # Register a stream as waiting for the merge lock
  # Args: stream_id
  local stream_id="$1"
  mkdir -p "$MERGE_QUEUE_DIR"

  # Create queue entry with PID and timestamp
  cat > "$MERGE_QUEUE_DIR/$stream_id.wait" << EOF
PID=$$
STREAM_ID=$stream_id
TIMESTAMP=$(date +%s)
EOF
}

unregister_from_merge_queue() {
  # Remove stream from waiting queue
  # Args: stream_id
  local stream_id="$1"
  rm -f "$MERGE_QUEUE_DIR/$stream_id.wait"
}

get_merge_queue() {
  # Returns list of streams waiting in merge queue (sorted by timestamp)
  # Output format: "STREAM_ID (waiting Xs)" per line
  if [[ ! -d "$MERGE_QUEUE_DIR" ]]; then
    return
  fi

  local queue_entries=()

  for entry_file in "$MERGE_QUEUE_DIR"/*.wait; do
    if [[ -f "$entry_file" ]]; then
      local entry_stream entry_pid entry_time now elapsed
      entry_stream=$(grep '^STREAM_ID=' "$entry_file" 2>/dev/null | cut -d= -f2)
      entry_pid=$(grep '^PID=' "$entry_file" 2>/dev/null | cut -d= -f2)
      entry_time=$(grep '^TIMESTAMP=' "$entry_file" 2>/dev/null | cut -d= -f2)

      # Skip if process is no longer running (stale entry)
      if [[ -n "$entry_pid" ]] && ! kill -0 "$entry_pid" 2>/dev/null; then
        rm -f "$entry_file"
        continue
      fi

      # Calculate elapsed time
      now=$(date +%s)
      elapsed=$((now - entry_time))

      # Store with timestamp for sorting
      queue_entries+=("$entry_time|$entry_stream|$elapsed")
    fi
  done

  # Sort by timestamp and output
  if [[ ${#queue_entries[@]} -gt 0 ]]; then
    printf '%s\n' "${queue_entries[@]}" | sort -t'|' -k1 -n | while IFS='|' read -r ts stream elapsed; do
      if [[ $elapsed -lt 60 ]]; then
        echo "$stream (waiting ${elapsed}s)"
      elif [[ $elapsed -lt 3600 ]]; then
        echo "$stream (waiting $((elapsed / 60))m)"
      else
        echo "$stream (waiting $((elapsed / 3600))h)"
      fi
    done
  fi
}

get_historical_merge_duration() {
  # Calculate average merge duration from recent merge operations
  # Returns: average seconds or 0 if no history
  # Looks at commit timestamps of merge commits to estimate duration

  # For now, return a reasonable default estimate (30 seconds)
  # Future enhancement: track actual merge durations in a log file
  echo "30"
}

wait_for_merge_lock() {
  # Wait for merge lock with exponential backoff
  # Args: stream_id, max_wait_seconds (default 300)
  # Returns: 0 if lock acquired, 1 if timeout exceeded
  local stream_id="$1"
  local max_wait="${2:-300}"
  local elapsed=0
  local backoff=1
  local max_backoff=30

  msg_dim "Merge lock is held. Waiting with exponential backoff..."

  # Register in merge queue for visibility (US-005)
  register_in_merge_queue "$stream_id"

  while [[ $elapsed -lt $max_wait ]]; do
    # Check if lock is now available
    if ! is_merge_lock_held; then
      # Clear spinner line
      printf "\r%80s\r" " "
      msg_dim "Lock released. Attempting to acquire..."
      if acquire_merge_lock "$stream_id"; then
        unregister_from_merge_queue "$stream_id"
        return 0
      fi
      # Someone else grabbed it - keep waiting
      msg_dim "Lock acquired by another process. Continuing to wait..."
    fi

    # Show spinner with current status
    local lock_info
    lock_info=$(get_merge_lock_info)
    show_wait_spinner "$elapsed" "$max_wait" "$lock_info"

    # Sleep for current backoff interval
    local sleep_time=$backoff
    # Don't sleep past max wait
    if [[ $((elapsed + sleep_time)) -gt $max_wait ]]; then
      sleep_time=$((max_wait - elapsed))
    fi
    sleep "$sleep_time"
    elapsed=$((elapsed + sleep_time))

    # Exponential backoff with cap
    backoff=$((backoff * 2))
    if [[ $backoff -gt $max_backoff ]]; then
      backoff=$max_backoff
    fi
  done

  # Clear spinner line
  printf "\r%80s\r" " "
  msg_error "Max wait time exceeded (${max_wait}s). Merge lock still held."
  local lock_info
  lock_info=$(get_merge_lock_info)
  msg_dim "Current holder: $lock_info"
  unregister_from_merge_queue "$stream_id"
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

  # IMPORTANT: Check git history FIRST (source of truth)
  # Worktree workflow: Branch merged to main via PR
  if is_stream_merged "$stream_id"; then
    echo "merged"
    return
  fi

  # NEW: Direct-to-main workflow: Commits exist on main
  # This catches PRDs completed without using worktrees
  if is_stream_completed "$stream_id"; then
    echo "completed"
    return
  fi

  # Check if PRD exists
  local prd_file="$stream_dir/prd.md"
  if [[ ! -f "$prd_file" ]]; then
    echo "no_prd"
    return
  fi

  # Check if progress.md exists (work has started)
  if [[ -f "$stream_dir/progress.md" ]]; then
    echo "in_progress"
    return
  fi

  # Check if plan.md exists (work hasn't started yet)
  if [[ -f "$stream_dir/plan.md" ]]; then
    echo "ready"
    return
  fi

  # Fallback: Count stories as last resort
  local total remaining
  total=$(grep -c '### \[' "$prd_file" 2>/dev/null || true)
  remaining=$(grep -c '### \[ \]' "$prd_file" 2>/dev/null || true)
  total=${total:-0}
  remaining=${remaining:-0}

  if [[ "$total" -eq 0 ]]; then
    echo "no_stories"
  elif [[ "$remaining" -eq 0 ]]; then
    # All stories completed in prd.md
    echo "ready"
  else
    # Stories remain unchecked
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
      local symbol status_color display_status
      display_status="$status"
      case "$status" in
        running)
          symbol="$SYM_RUNNING"
          status_color="${C_BOLD}${C_YELLOW}"
          ;;
        merged)
          symbol="$SYM_MERGED"
          status_color="${C_GREEN}"
          ;;
        completed)
          # Completed but not merged - check if has worktree (needs merge)
          if worktree_exists "$stream_id"; then
            symbol="$SYM_COMPLETED"
            status_color="${C_YELLOW}"
            display_status="needs merge"
          else
            symbol="$SYM_COMPLETED"
            status_color="${C_GREEN}"
          fi
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

      printf "  %s ${C_BOLD}PRD-%s${C_RESET}  ${status_color}%-11s${C_RESET} %s stories\n" "$symbol" "$num" "$display_status" "$progress"
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
      local symbol status_color row_prefix row_suffix display_status
      row_prefix=""
      row_suffix=""
      display_status="$status"
      case "$status" in
        running)
          symbol="$SYM_RUNNING"
          status_color="${C_BOLD}${C_YELLOW}"
          row_prefix="${C_BOLD}"
          row_suffix="${C_RESET}"
          ;;
        merged)
          symbol="$SYM_MERGED"
          status_color="${C_GREEN}"
          ;;
        completed)
          # Completed but not merged - check if has worktree (needs merge)
          if [[ "$has_worktree" == "yes" ]]; then
            symbol="$SYM_COMPLETED"
            status_color="${C_YELLOW}"
            display_status="needs mrg"
          else
            symbol="$SYM_COMPLETED"
            status_color="${C_GREEN}"
          fi
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
        "$symbol" "$stream_id" "$display_status" "$progress" "$last_modified" "$has_worktree"
    fi
  done

  if [[ $found -eq 0 ]]; then
    printf "│ %-54s │\n" "No streams found."
  fi

  echo "└──────────┴────────────┴──────────┴──────────┴──────────┘"
  echo ""
  msg_dim "Legend: $SYM_MERGED merged  $SYM_COMPLETED completed  $SYM_RUNNING running  $SYM_READY ready"
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
  shift || true
  local iterations="${1:-1}"
  shift || true

  # Parse flags
  local no_worktree=false
  local force_build=false
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --no-worktree)
        no_worktree=true
        shift
        ;;
      --force)
        force_build=true
        shift
        ;;
      *)
        # If it looks like a number, treat as iterations
        if [[ "$1" =~ ^[0-9]+$ ]]; then
          iterations="$1"
        fi
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

  if ! stream_exists "$stream_id"; then
    msg_error "Stream not found: $stream_id" >&2
    return 1
  fi

  # ============================================================================
  # Safeguard: Block build on main/master without worktree
  # ============================================================================
  if ! worktree_exists "$stream_id"; then
    local current_branch
    current_branch=$(get_current_branch)

    if is_on_protected_branch; then
      # On main/master without worktree - block by default
      if [[ "$no_worktree" == "true" || "$force_build" == "true" ]]; then
        # User explicitly allowed it
        msg_warn "Building without worktree on branch '$current_branch'"
        msg_dim "Commits will go directly to $current_branch"
        echo ""
      else
        # Block with helpful error message
        msg_error "SAFEGUARD: No worktree initialized for $stream_id"
        echo ""
        printf "You're currently on branch '${C_BOLD}%s${C_RESET}'.\n" "$current_branch"
        printf "Running 'ralph stream build' without a worktree will commit directly to %s!\n" "$current_branch"
        echo ""
        printf "${C_BOLD}Recommended actions:${C_RESET}\n"
        printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
        numbered_step 1 "Initialize a worktree first (recommended):"
        printf "   ${C_DIM}ralph stream init %s${C_RESET}\n" "${input}"
        printf "   Then: ${C_DIM}ralph stream build %s %s${C_RESET}\n" "${input}" "${iterations}"
        echo ""
        numbered_step 2 "Or explicitly allow building without worktree:"
        printf "   ${C_DIM}ralph stream build %s %s --no-worktree${C_RESET}\n" "${input}" "${iterations}"
        echo ""
        numbered_step 3 "Or force build on $current_branch (use with caution):"
        printf "   ${C_DIM}ralph stream build %s %s --force${C_RESET}\n" "${input}" "${iterations}"
        echo ""
        return 1
      fi
    else
      # On a feature branch without worktree - just inform, don't block
      msg_dim "No worktree for $stream_id - building in current directory on branch '$current_branch'"
    fi
  fi

  # ============================================================================
  # Sequential Mode Check (Contamination Prevention)
  # ============================================================================
  if [[ "${RALPH_SEQUENTIAL_MODE:-false}" == "true" ]]; then
    # Sequential mode enabled - only one PRD can build at a time
    if has_active_prd && ! is_prd_active "$stream_id"; then
      local active_prd
      active_prd=$(get_active_prd_info)
      msg_error "SEQUENTIAL MODE: Another PRD is already building"
      echo ""
      printf "Active PRD: ${C_BOLD}%s${C_RESET}\n" "$active_prd"
      printf "Requested:  ${C_BOLD}%s${C_RESET}\n" "$stream_id"
      echo ""
      printf "${C_DIM}Sequential mode allows only ONE PRD to build at a time.${C_RESET}\n"
      printf "${C_DIM}This prevents context contamination in large repos without worktrees.${C_RESET}\n"
      echo ""
      printf "${C_BOLD}Wait for ${C_YELLOW}%s${C_RESET}${C_BOLD} to complete, or:${C_RESET}\n" "$active_prd"
      numbered_step 1 "Check status: ${C_DIM}ralph stream status${C_RESET}"
      numbered_step 2 "Disable sequential mode in ${C_DIM}.agents/ralph/config.sh${C_RESET}"
      echo ""
      return 1
    fi
  fi

  # Acquire lock
  if ! acquire_lock "$stream_id"; then
    return 1
  fi

  # Set active PRD marker (for sequential mode tracking)
  set_active_prd "$stream_id"

  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # Set up cleanup on exit (includes watchdog stop)
  trap "release_lock '$stream_id'; clear_active_prd; stop_watchdog '$stream_dir'" EXIT

  local work_dir="$ROOT_DIR"

  # If worktree exists, use it
  if worktree_exists "$stream_id"; then
    work_dir="$WORKTREES_DIR/$stream_id"
    # IMPORTANT: Always use main RALPH_DIR, never create nested .ralph in worktree
    # This prevents context contamination where agents discover multiple PRDs
    stream_dir="$RALPH_DIR/$stream_id"
  fi

  section_header "Running build for $stream_id"
  bullet "Work dir: $(path_display "$work_dir")"
  bullet "Iterations: ${C_BOLD}$iterations${C_RESET}"

  # Start watchdog process for auto-recovery (US-010)
  start_watchdog "$stream_dir"
  if is_watchdog_running "$stream_dir"; then
    local watchdog_pid
    watchdog_pid=$(get_watchdog_pid "$stream_dir")
    bullet "Watchdog: ${C_GREEN}active${C_RESET} (PID $watchdog_pid)"
  else
    bullet "Watchdog: ${C_DIM}disabled${C_RESET}"
  fi
  echo ""

  # Run loop.sh with stream-specific paths
  cd "$work_dir"
  PRD_PATH="$stream_dir/prd.md" \
  PLAN_PATH="$stream_dir/plan.md" \
  PROGRESS_PATH="$stream_dir/progress.md" \
  ERRORS_LOG_PATH="$stream_dir/errors.log" \
  ACTIVITY_LOG_PATH="$stream_dir/activity.log" \
  RUNS_DIR="$stream_dir/runs" \
  RALPH_DIR="$RALPH_DIR" \
  ACTIVE_PRD_NUMBER="$stream_id" \
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

# ============================================================================
# Auto-rebase before merge (US-003)
# ============================================================================

rebase_onto_main() {
  # Rebase stream branch onto latest main/master in worktree
  # Args: worktree_path, base_branch
  # Returns: 0 on success, 1 on failure (rebase aborted)
  local worktree_path="$1"
  local base_branch="$2"
  local branch_name
  branch_name=$(git -C "$worktree_path" rev-parse --abbrev-ref HEAD 2>/dev/null)

  msg_dim "Fetching latest $base_branch from origin..."
  if ! git -C "$worktree_path" fetch origin "$base_branch" 2>/dev/null; then
    msg_warn "Could not fetch origin/$base_branch - rebasing onto local $base_branch"
  fi

  msg_dim "Rebasing $branch_name onto origin/$base_branch..."

  # Attempt the rebase
  local rebase_output
  if rebase_output=$(git -C "$worktree_path" rebase "origin/$base_branch" 2>&1); then
    msg_dim "Rebase successful"
    return 0
  fi

  # Rebase failed - check if we're in rebase state and abort
  if git -C "$worktree_path" rev-parse --verify REBASE_HEAD >/dev/null 2>&1; then
    msg_error "Rebase failed due to conflicts:"
    echo "$rebase_output" | while read -r line; do
      printf "  ${C_DIM}%s${C_RESET}\n" "$line"
    done
    echo ""

    # Show conflicting files
    local conflict_files
    conflict_files=$(git -C "$worktree_path" diff --name-only --diff-filter=U 2>/dev/null)
    if [[ -n "$conflict_files" ]]; then
      msg_warn "Conflicting files:"
      echo "$conflict_files" | while read -r file; do
        printf "  ${C_RED}•${C_RESET} %s\n" "$file"
      done
    fi

    msg_dim "Aborting rebase..."
    git -C "$worktree_path" rebase --abort 2>/dev/null || true

    echo ""
    msg_error "Rebase aborted. To resolve manually:"
    printf "  ${C_DIM}1. cd %s${C_RESET}\n" "$worktree_path"
    printf "  ${C_DIM}2. git rebase origin/%s${C_RESET}\n" "$base_branch"
    printf "  ${C_DIM}3. Resolve conflicts and: git rebase --continue${C_RESET}\n"
    printf "  ${C_DIM}4. Then retry: ralph stream merge <N>${C_RESET}\n"
    return 1
  fi

  # Rebase failed for another reason
  msg_error "Rebase failed: $rebase_output"
  return 1
}

cmd_merge() {
  local input="$1"
  shift || true

  # Parse flags
  local force_merge=false
  local do_rebase=false
  local do_wait=false
  local force_unlock=false
  local skip_confirm=false
  local max_wait=300
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --force)
        force_merge=true
        shift
        ;;
      --rebase)
        do_rebase=true
        shift
        ;;
      --wait)
        do_wait=true
        shift
        ;;
      --force-unlock)
        force_unlock=true
        shift
        ;;
      --yes|-y)
        skip_confirm=true
        shift
        ;;
      --max-wait=*)
        max_wait="${1#--max-wait=}"
        shift
        ;;
      --max-wait)
        shift
        max_wait="${1:-300}"
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  local stream_id
  stream_id=$(normalize_stream_id "$input")

  # Handle --force-unlock: manually remove stale/stuck merge lock
  if [[ "$force_unlock" == "true" ]]; then
    if [[ -f "$MERGE_LOCK_FILE" ]]; then
      local holder_stream holder_pid
      holder_stream=$(grep '^STREAM_ID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
      holder_pid=$(grep '^PID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)

      msg_warn "Force unlocking merge lock held by $holder_stream (PID $holder_pid)"

      # Check if the process is still running
      if kill -0 "$holder_pid" 2>/dev/null; then
        msg_warn "Warning: PID $holder_pid is still running!"
        printf "Are you sure you want to forcefully remove the lock? [y/N]: "
        read -r confirm
        if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
          msg_dim "Aborted."
          return 0
        fi
      fi

      rm -f "$MERGE_LOCK_FILE"
      msg_warn "Merge lock forcefully removed."
      msg_dim "Proceeding with merge..."
      echo ""
    else
      msg_dim "No merge lock file exists."
    fi
  fi

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

  # Merge confirmation prompt (unless --yes flag is used)
  if [[ "${RALPH_MERGE_REQUIRE_CONFIRM:-true}" == "true" ]] && [[ "$skip_confirm" == "false" ]]; then
    local branch="ralph/$stream_id"
    local base_branch="main"

    # Check if main exists, otherwise use master
    if ! git show-ref --verify --quiet "refs/heads/main"; then
      if git show-ref --verify --quiet "refs/heads/master"; then
        base_branch="master"
      fi
    fi

    # Show merge summary
    printf "\n${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
    printf "${C_BOLD}Merge Confirmation: $stream_id → $base_branch${C_RESET}\n"
    printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n\n"

    # Show commit summary
    msg_dim "Commits to be merged:"
    local commit_count
    commit_count=$(git rev-list --count "$base_branch..$branch" 2>/dev/null || echo "0")
    printf "  ${C_GREEN}%s commit(s)${C_RESET}\n\n" "$commit_count"

    # Show recent commits
    git log --oneline --no-decorate "$base_branch..$branch" 2>/dev/null | head -n 10 | while read -r line; do
      printf "  ${C_DIM}•${C_RESET} %s\n" "$line"
    done

    if [[ "$commit_count" -gt 10 ]]; then
      printf "  ${C_DIM}... and %d more${C_RESET}\n" $((commit_count - 10))
    fi

    printf "\n${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_YELLOW}This will merge the worktree branch into $base_branch.${C_RESET}\n"
    printf "${C_DIM}Review changes: git log $base_branch..$branch${C_RESET}\n"
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n\n"

    # Prompt for confirmation
    printf "${C_BOLD}Proceed with merge? [y/N]:${C_RESET} "
    read -r confirm

    if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
      msg_dim "Merge cancelled by user."
      printf "${C_DIM}To merge later: ralph stream merge $stream_id${C_RESET}\n"
      printf "${C_DIM}To skip confirmation: ralph stream merge $stream_id --yes${C_RESET}\n"
      return 0
    fi

    echo ""
  fi

  # Acquire global merge lock to prevent concurrent merges
  if ! acquire_merge_lock "$stream_id"; then
    if [[ "$do_wait" == "true" ]]; then
      # Wait for lock with exponential backoff
      if ! wait_for_merge_lock "$stream_id" "$max_wait"; then
        return 1
      fi
    else
      msg_dim "Another merge is in progress. Use --wait to wait, or --force-unlock to force."
      return 1
    fi
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

  # Auto-rebase before merge (US-003)
  local worktree_path="$WORKTREES_DIR/$stream_id"
  if [[ "$do_rebase" == "true" ]]; then
    msg_dim "Auto-rebase enabled - rebasing onto latest $base_branch in worktree..."
    if ! rebase_onto_main "$worktree_path" "$base_branch"; then
      msg_error "Rebase failed. Merge aborted."
      return 1
    fi
    echo ""
  fi

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

  # Mark stream as merged
  mark_stream_merged "$stream_id"

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

cmd_mark_merged() {
  # Manually mark a stream as merged (for streams merged outside of ralph)
  local input="$1"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  if ! stream_exists "$stream_id"; then
    msg_error "Stream $stream_id does not exist" >&2
    return 1
  fi

  local status
  status=$(get_stream_status "$stream_id")

  if [[ "$status" == "merged" ]]; then
    msg_dim "$stream_id is already marked as merged"
    return 0
  fi

  # Mark as merged
  mark_stream_merged "$stream_id"
  printf "${C_GREEN}${SYM_SUCCESS}${C_RESET} Marked %s as merged\n" "$stream_id"
}

cmd_unmark_merged() {
  # Remove merged marker from a stream
  local input="$1"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  if [[ ! -f "$stream_dir/.merged" ]]; then
    msg_dim "$stream_id is not marked as merged"
    return 0
  fi

  rm -f "$stream_dir/.merged"
  printf "${C_GREEN}${SYM_SUCCESS}${C_RESET} Unmarked %s as merged\n" "$stream_id"
}

cmd_mark_completed() {
  # Manually mark a stream as completed (for direct-to-main workflows)
  local input="$1"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  if ! stream_exists "$stream_id"; then
    msg_error "Stream $stream_id does not exist" >&2
    return 1
  fi

  local status
  status=$(get_stream_status "$stream_id")

  if [[ "$status" == "completed" ]]; then
    msg_dim "$stream_id is already marked as completed"
    return 0
  fi

  # Mark as completed
  mark_stream_completed "$stream_id"
  printf "${C_GREEN}${SYM_SUCCESS}${C_RESET} Marked %s as completed\n" "$stream_id"
}

cmd_unmark_completed() {
  # Remove completed marker from a stream
  local input="$1"
  local stream_id
  stream_id=$(normalize_stream_id "$input")

  if [[ -z "$stream_id" ]]; then
    msg_error "Invalid stream ID: $input" >&2
    return 1
  fi

  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  if [[ ! -f "$stream_dir/.completed" ]]; then
    msg_dim "$stream_id is not marked as completed"
    return 0
  fi

  unmark_stream_completed "$stream_id"
  printf "${C_GREEN}${SYM_SUCCESS}${C_RESET} Unmarked %s as completed\n" "$stream_id"
}

cmd_verify_status() {
  # Auto-scan all PRDs and correct stale status markers
  section_header "Verifying PRD Status"

  local prd_count=0
  local corrected_count=0

  for prd_dir in "$RALPH_DIR"/PRD-*/ "$RALPH_DIR"/prd-*/; do
    [[ -d "$prd_dir" ]] || continue
    local stream_id
    stream_id=$(basename "$prd_dir")

    # Get current status (will auto-create .completed if git evidence found)
    local status
    status=$(get_stream_status "$stream_id")

    # Log correction if marker was created
    if [[ "$status" == "completed" ]] && [[ -f "$prd_dir/.completed" ]]; then
      local completed_at
      completed_at=$(grep "^completed_at=" "$prd_dir/.completed" | cut -d= -f2)
      if [[ -n "$completed_at" ]]; then
        ((corrected_count++))
        msg_dim "✓ $stream_id: auto-corrected to completed"
      fi
    fi

    ((prd_count++))
  done

  msg_success "Scanned $prd_count PRDs, corrected $corrected_count stale status markers"
  if [[ $corrected_count -gt 0 ]]; then
    printf "\n${C_CYAN}Auto-corrections logged to activity log${C_RESET}\n"
  fi
}

# ============================================================================
# Merge Queue Status (US-005)
# ============================================================================

cmd_merge_status() {
  section_header "Merge Queue Status"

  # Check if merge lock is held
  if is_merge_lock_held; then
    local holder_stream holder_pid holder_time now elapsed
    holder_stream=$(grep '^STREAM_ID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
    holder_pid=$(grep '^PID=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)
    holder_time=$(grep '^TIMESTAMP=' "$MERGE_LOCK_FILE" 2>/dev/null | cut -d= -f2)

    # Calculate elapsed time
    now=$(date +%s)
    elapsed=$((now - holder_time))

    # Format elapsed time nicely
    local elapsed_str
    if [[ $elapsed -lt 60 ]]; then
      elapsed_str="${elapsed}s"
    elif [[ $elapsed -lt 3600 ]]; then
      elapsed_str="$((elapsed / 60))m $((elapsed % 60))s"
    else
      elapsed_str="$((elapsed / 3600))h $((elapsed % 3600 / 60))m"
    fi

    printf "${C_BOLD}Current Merge:${C_RESET}\n"
    printf "  ${C_YELLOW}${SYM_RUNNING}${C_RESET} ${C_BOLD}%s${C_RESET} ${C_DIM}(PID %s)${C_RESET}\n" "$holder_stream" "$holder_pid"
    printf "  ${C_DIM}Started: %s ago${C_RESET}\n" "$elapsed_str"
    echo ""

    # Show waiting queue
    local queue
    queue=$(get_merge_queue)
    if [[ -n "$queue" ]]; then
      printf "${C_BOLD}Waiting Queue:${C_RESET}\n"
      local position=1
      while IFS= read -r entry; do
        printf "  ${C_DIM}%d.${C_RESET} %s\n" "$position" "$entry"
        ((position++))
      done <<< "$queue"
      echo ""

      # Estimate wait time
      local queue_count avg_duration estimated_wait
      queue_count=$(echo "$queue" | wc -l | tr -d ' ')
      avg_duration=$(get_historical_merge_duration)
      estimated_wait=$((queue_count * avg_duration))

      if [[ $estimated_wait -lt 60 ]]; then
        printf "${C_DIM}Estimated wait: ~%ds (based on ~%ds avg merge time)${C_RESET}\n" "$estimated_wait" "$avg_duration"
      else
        printf "${C_DIM}Estimated wait: ~%dm (based on ~%ds avg merge time)${C_RESET}\n" "$((estimated_wait / 60))" "$avg_duration"
      fi
    else
      printf "${C_DIM}No streams waiting in queue${C_RESET}\n"
    fi
  else
    printf "${C_GREEN}${SYM_COMPLETED}${C_RESET} ${C_BOLD}No merge in progress${C_RESET}\n"
    printf "${C_DIM}The merge lock is available${C_RESET}\n"

    # Check for any stale queue entries and clean them up
    local queue
    queue=$(get_merge_queue)
    if [[ -n "$queue" ]]; then
      echo ""
      printf "${C_YELLOW}Note:${C_RESET} Found orphaned queue entries (cleaned up):\n"
      echo "$queue"
    fi
  fi
  echo ""
}

# ============================================================================
# PR Creation (US-001)
# ============================================================================

cmd_pr() {
  local input="$1"
  shift || true

  # Parse flags
  local dry_run=false
  local custom_title=""
  local custom_base=""
  local custom_reviewers=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        dry_run=true
        shift
        ;;
      --title=*)
        custom_title="${1#--title=}"
        shift
        ;;
      --title)
        shift
        custom_title="${1:-}"
        shift
        ;;
      --base=*)
        custom_base="${1#--base=}"
        shift
        ;;
      --base)
        shift
        custom_base="${1:-}"
        shift
        ;;
      --reviewers=*)
        custom_reviewers="${1#--reviewers=}"
        shift
        ;;
      --reviewers)
        shift
        custom_reviewers="${1:-}"
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

  if ! stream_exists "$stream_id"; then
    msg_error "Stream not found: $stream_id" >&2
    return 1
  fi

  # Check if gh CLI is available
  if ! command -v gh &> /dev/null; then
    msg_error "GitHub CLI (gh) is not installed." >&2
    msg_dim "Install it from: https://cli.github.com/"
    return 1
  fi

  # Check if gh is authenticated
  if ! gh auth status &> /dev/null; then
    msg_error "GitHub CLI is not authenticated." >&2
    msg_dim "Run: gh auth login"
    return 1
  fi

  local branch="ralph/$stream_id"
  local base_branch="${custom_base:-main}"

  # Check if main exists, otherwise use master
  if [[ -z "$custom_base" ]]; then
    if ! git show-ref --verify --quiet "refs/heads/main"; then
      if git show-ref --verify --quiet "refs/heads/master"; then
        base_branch="master"
      fi
    fi
  fi

  # Check if branch exists
  if ! git show-ref --verify --quiet "refs/heads/$branch"; then
    msg_error "Branch $branch does not exist." >&2
    msg_dim "Initialize the stream first: ralph stream init ${input}"
    return 1
  fi

  local stream_dir
  stream_dir="$(get_stream_dir "$stream_id")"

  # Get stream info for PR title
  local pr_title="$custom_title"
  local prd_title=""

  if [[ -f "$stream_dir/prd.md" ]]; then
    # Extract PRD title
    prd_title=$(grep -m1 '^#' "$stream_dir/prd.md" | sed 's/^#\s*\(PRD:\s*\)\?//' | head -1)
  fi

  if [[ -z "$pr_title" ]]; then
    if [[ -n "$prd_title" ]]; then
      pr_title="$stream_id: $prd_title"
    else
      pr_title="$stream_id: Implementation"
    fi
  fi

  # Generate smart PR body using Node.js template module
  # This includes: PRD summary, completed stories, key files changed, test results
  local pr_body
  local generate_script="$SCRIPT_DIR/../../lib/github/generate-pr-body.js"

  if [[ -f "$generate_script" ]] && command -v node &> /dev/null; then
    pr_body=$(node "$generate_script" "$stream_id" "$RALPH_DIR" "$ROOT_DIR" "$base_branch" 2>/dev/null)
  fi

  # Fallback to basic body if Node.js generation fails
  if [[ -z "$pr_body" ]]; then
    local overview=""
    local completed_stories=""

    if [[ -f "$stream_dir/prd.md" ]]; then
      # Extract overview (first paragraph after ## Overview)
      overview=$(awk '/^## Overview/{found=1; next} found && /^##/{exit} found && NF' "$stream_dir/prd.md" | head -1)

      # Extract completed stories
      completed_stories=$(grep -E '###\s+\[x\]' "$stream_dir/prd.md" | sed 's/###\s*\[x\]\s*/- [x] /')
    fi

    pr_body="## Summary

This PR was automatically generated by Ralph CLI from $stream_id.
"

    if [[ -n "$overview" ]]; then
      pr_body+="
$overview
"
    fi

    if [[ -n "$completed_stories" ]]; then
      pr_body+="
### Completed Stories

$completed_stories
"
    fi

    pr_body+="
---
*Generated by [Ralph CLI](https://github.com/AskTinNguyen/ralph-cli)*"
  fi

  # Dry run mode
  if [[ "$dry_run" == "true" ]]; then
    section_header "PR Preview (Dry Run)"
    printf "${C_BOLD}Title:${C_RESET} %s\n" "$pr_title"
    printf "${C_BOLD}Branch:${C_RESET} %s -> %s\n" "$branch" "$base_branch"
    if [[ -n "$custom_reviewers" ]]; then
      printf "${C_BOLD}Reviewers:${C_RESET} %s\n" "$custom_reviewers"
    else
      printf "${C_BOLD}Reviewers:${C_RESET} %s\n" "(auto-assign from CODEOWNERS)"
    fi
    echo ""
    printf "${C_BOLD}Body:${C_RESET}\n"
    printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
    echo "$pr_body"
    printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
    echo ""
    msg_dim "Run without --dry-run to create the PR"
    return 0
  fi

  section_header "Creating PR for $stream_id"

  # Push branch to remote
  msg_dim "Pushing $branch to origin..."
  if ! git push -u origin "$branch" 2>/dev/null; then
    msg_warn "Branch may already be pushed (continuing...)"
  fi

  # Create PR using gh CLI
  msg_dim "Creating pull request..."
  local pr_url
  pr_url=$(gh pr create \
    --title "$pr_title" \
    --body "$pr_body" \
    --base "$base_branch" \
    --head "$branch" 2>&1)

  local gh_exit=$?

  if [[ $gh_exit -ne 0 ]]; then
    # Check if PR already exists
    if echo "$pr_url" | grep -qi "already exists"; then
      msg_warn "PR already exists for this branch."
      pr_url=$(gh pr list --head "$branch" --json url --jq '.[0].url' 2>/dev/null)
      if [[ -n "$pr_url" ]]; then
        printf "\n${C_GREEN}${SYM_SUCCESS}${C_RESET} ${C_BOLD}Existing PR:${C_RESET} %s\n" "$pr_url"
        return 0
      fi
    fi
    msg_error "Failed to create PR:" >&2
    echo "$pr_url" >&2
    return 1
  fi

  printf "\n${C_GREEN}${SYM_SUCCESS}${C_RESET} ${C_BOLD}PR created:${C_RESET} %s\n" "$pr_url"

  # Handle reviewer assignment (custom --reviewers override or auto-assign)
  if [[ -n "$custom_reviewers" ]]; then
    # Use custom reviewers specified via --reviewers flag
    msg_dim "Assigning custom reviewers: $custom_reviewers"

    # Parse comma-separated reviewers and request reviews
    local reviewer_list=""
    local team_list=""

    # Split reviewers and categorize as users vs teams
    IFS=',' read -ra reviewer_arr <<< "$custom_reviewers"
    for reviewer in "${reviewer_arr[@]}"; do
      reviewer=$(echo "$reviewer" | xargs) # Trim whitespace
      reviewer=${reviewer#@} # Remove leading @ if present

      if [[ "$reviewer" == *"/"* ]]; then
        # Team format: org/team
        if [[ -n "$team_list" ]]; then
          team_list="$team_list,$reviewer"
        else
          team_list="$reviewer"
        fi
      else
        # Individual reviewer
        if [[ -n "$reviewer_list" ]]; then
          reviewer_list="$reviewer_list,$reviewer"
        else
          reviewer_list="$reviewer"
        fi
      fi
    done

    # Extract PR number from URL for gh commands
    local pr_number
    pr_number=$(echo "$pr_url" | grep -oE '[0-9]+$')

    if [[ -n "$pr_number" ]]; then
      # Request review from individual users
      if [[ -n "$reviewer_list" ]]; then
        if gh pr edit "$pr_number" --add-reviewer "$reviewer_list" 2>/dev/null; then
          msg_dim "Assigned reviewers: $reviewer_list"
        else
          msg_warn "Could not assign some reviewers"
        fi
      fi

      # Request review from teams
      if [[ -n "$team_list" ]]; then
        IFS=',' read -ra team_arr <<< "$team_list"
        for team in "${team_arr[@]}"; do
          if gh api "repos/{owner}/{repo}/pulls/$pr_number/requested_reviewers" \
            -f "team_reviewers[]=$team" 2>/dev/null; then
            msg_dim "Assigned team: $team"
          else
            msg_warn "Could not assign team: $team"
          fi
        done
      fi
    fi

    # Add standard labels
    if gh pr edit "$pr_number" --add-label "ralph-generated,PRD-${stream_id#PRD-}" 2>/dev/null; then
      msg_dim "Added labels: ralph-generated, PRD-${stream_id#PRD-}"
    fi
  else
    # Auto-assign reviewers and labels (US-003)
    local assign_script="$SCRIPT_DIR/../../lib/github/assign-reviewers.js"
    if [[ -f "$assign_script" ]] && command -v node &> /dev/null; then
      msg_dim "Assigning reviewers and labels..."
      local assign_output
      assign_output=$(node "$assign_script" "$stream_id" "$pr_url" "$ROOT_DIR" "$base_branch" 2>&1)
      local assign_exit=$?

      if [[ $assign_exit -eq 0 ]]; then
        # Parse and display results
        if echo "$assign_output" | grep -q "reviewers:"; then
          local reviewers
          reviewers=$(echo "$assign_output" | grep "reviewers:" | sed 's/reviewers: //')
          if [[ -n "$reviewers" && "$reviewers" != "none" ]]; then
            msg_dim "Assigned reviewers: $reviewers"
          fi
        fi
        if echo "$assign_output" | grep -q "teams:"; then
          local teams
          teams=$(echo "$assign_output" | grep "teams:" | sed 's/teams: //')
          if [[ -n "$teams" && "$teams" != "none" ]]; then
            msg_dim "Assigned teams: $teams"
          fi
        fi
        if echo "$assign_output" | grep -q "labels:"; then
          local labels
          labels=$(echo "$assign_output" | grep "labels:" | sed 's/labels: //')
          if [[ -n "$labels" ]]; then
            msg_dim "Added labels: $labels"
          fi
        fi
        # Show any warnings
        if echo "$assign_output" | grep -q "warning:"; then
          echo "$assign_output" | grep "warning:" | while read -r warning_line; do
            msg_warn "${warning_line#warning: }"
          done
        fi
      else
        msg_warn "Could not auto-assign reviewers: $assign_output"
      fi
    fi
  fi

  next_steps_header
  numbered_step 1 "Review the PR at: ${C_CYAN}${pr_url}${C_RESET}"
  numbered_step 2 "After approval, merge the PR"
  numbered_step 3 "${C_DIM}ralph stream mark-merged $input${C_RESET}"
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
      echo "Usage: ralph stream build <N> [iterations] [--no-worktree|--force]" >&2
      exit 1
    fi
    cmd_build "$@"
    ;;
  merge)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream merge <N> [--rebase] [--force] [--wait] [--max-wait=N] [--force-unlock]" >&2
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
  merge-status)
    cmd_merge_status
    ;;
  mark-merged)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream mark-merged <N>" >&2
      exit 1
    fi
    cmd_mark_merged "$1"
    ;;
  unmark-merged)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream unmark-merged <N>" >&2
      exit 1
    fi
    cmd_unmark_merged "$1"
    ;;
  mark-completed)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream mark-completed <N>" >&2
      exit 1
    fi
    cmd_mark_completed "$1"
    ;;
  unmark-completed)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream unmark-completed <N>" >&2
      exit 1
    fi
    cmd_unmark_completed "$1"
    ;;
  verify-status)
    cmd_verify_status
    ;;
  pr)
    if [[ -z "${1:-}" ]]; then
      echo "Usage: ralph stream pr <N> [--title \"...\"] [--reviewers \"...\"] [--base branch] [--dry-run]" >&2
      exit 1
    fi
    cmd_pr "$@"
    ;;
  *)
    printf "${C_BOLD}Ralph Stream${C_RESET} ${C_DIM}- Multi-PRD parallel execution${C_RESET}\n"
    printf "\n${C_BOLD}${C_CYAN}Usage:${C_RESET}\n"
    printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
    printf "  ${C_GREEN}ralph stream new${C_RESET}              Create new stream (PRD-1, PRD-2, ...)\n"
    printf "  ${C_GREEN}ralph stream list${C_RESET}             List all streams\n"
    printf "  ${C_GREEN}ralph stream status${C_RESET}           Show detailed status\n"
    printf "  ${C_GREEN}ralph stream init ${C_YELLOW}<N>${C_RESET}         Initialize worktree for parallel execution\n"
    printf "  ${C_GREEN}ralph stream build ${C_YELLOW}<N>${C_RESET} ${C_DIM}[n] [options]${C_RESET}\n"
    printf "                              Run n build iterations in stream\n"
    printf "                              ${C_DIM}--no-worktree: allow build without worktree${C_RESET}\n"
    printf "                              ${C_DIM}--force: force build on main/master${C_RESET}\n"
    printf "  ${C_GREEN}ralph stream merge ${C_YELLOW}<N>${C_RESET} ${C_DIM}[options]${C_RESET}\n"
    printf "                              Merge completed stream\n"
    printf "                              ${C_DIM}--rebase: rebase onto main first${C_RESET}\n"
    printf "                              ${C_DIM}--force: ignore conflicts${C_RESET}\n"
    printf "                              ${C_DIM}--wait: wait if lock is held${C_RESET}\n"
    printf "                              ${C_DIM}--max-wait=N: max wait seconds (default: 300)${C_RESET}\n"
    printf "                              ${C_DIM}--force-unlock: forcefully remove stale lock${C_RESET}\n"
    printf "  ${C_GREEN}ralph stream pr ${C_YELLOW}<N>${C_RESET} ${C_DIM}[options]${C_RESET}\n"
    printf "                              Create PR for completed stream\n"
    printf "                              ${C_DIM}--dry-run: preview without creating${C_RESET}\n"
    printf "                              ${C_DIM}--title: custom PR title${C_RESET}\n"
    printf "                              ${C_DIM}--reviewers: comma-separated reviewers${C_RESET}\n"
    printf "                              ${C_DIM}--base: target branch (default: main)${C_RESET}\n"
    printf "  ${C_GREEN}ralph stream merge-status${C_RESET}     Show merge lock holder and waiting queue\n"
    printf "  ${C_GREEN}ralph stream cleanup ${C_YELLOW}<N>${C_RESET}      Remove stream worktree\n"
    printf "  ${C_GREEN}ralph stream mark-merged ${C_YELLOW}<N>${C_RESET}  Mark stream as merged manually\n"
    printf "  ${C_GREEN}ralph stream unmark-merged ${C_YELLOW}<N>${C_RESET}\n"
    printf "                              Remove merged marker from stream\n"
    printf "  ${C_GREEN}ralph stream mark-completed ${C_YELLOW}<N>${C_RESET} Mark stream as completed (direct-to-main)\n"
    printf "  ${C_GREEN}ralph stream unmark-completed ${C_YELLOW}<N>${C_RESET}\n"
    printf "                              Remove completed marker from stream\n"
    printf "  ${C_GREEN}ralph stream verify-status${C_RESET}     Auto-scan and fix stale status markers\n"
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
