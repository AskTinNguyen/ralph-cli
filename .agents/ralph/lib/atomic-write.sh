#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Atomic File Operations Library
# ─────────────────────────────────────────────────────────────────────────────
# Provides race-condition-safe file operations for concurrent builds.
# Uses temp+rename pattern for atomic writes and flock/mkdir for locking.
#
# Usage:
#   source "$(dirname "${BASH_SOURCE[0]}")/atomic-write.sh"
#
# Functions:
#   atomic_write <file> <content>        - Atomic file write
#   atomic_increment <file>              - Atomic counter increment
#   atomic_decrement <file>              - Atomic counter decrement
#   atomic_read <file>                   - Safe counter read
#   atomic_append <file> <content>       - Atomic append operation
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ─────────────────────────────────────────────────────────────────────────────
# atomic_write
# ─────────────────────────────────────────────────────────────────────────────
# Atomically write content to a file using temp+rename pattern.
# This prevents other processes from reading partial writes.
#
# Arguments:
#   $1 - Target file path
#   $2 - Content to write
#
# Returns:
#   0 on success, 1 on failure
#
# Example:
#   atomic_write "/path/to/file.txt" "content here"
# ─────────────────────────────────────────────────────────────────────────────
atomic_write() {
  local file="$1"
  local content="$2"
  local temp="${file}.tmp.$$"

  # Create parent directory if needed
  local dir
  dir="$(dirname "$file")"
  mkdir -p "$dir" 2>/dev/null || true

  # Write to temp file
  if ! echo "$content" > "$temp" 2>/dev/null; then
    rm -f "$temp" 2>/dev/null || true
    return 1
  fi

  # Atomic rename (guaranteed atomic on POSIX systems)
  if ! mv -f "$temp" "$file" 2>/dev/null; then
    rm -f "$temp" 2>/dev/null || true
    return 1
  fi

  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# atomic_increment
# ─────────────────────────────────────────────────────────────────────────────
# Atomically increment a counter in a file.
# Uses flock if available, falls back to mkdir-based locking.
#
# Arguments:
#   $1 - Counter file path
#
# Returns:
#   New counter value on stdout, exit code 0 on success
#
# Example:
#   new_value=$(atomic_increment "/path/to/counter.txt")
# ─────────────────────────────────────────────────────────────────────────────
atomic_increment() {
  local file="$1"
  local lock="${file}.lock"
  local count

  # Create parent directory if needed
  local dir
  dir="$(dirname "$file")"
  mkdir -p "$dir" 2>/dev/null || true

  # Use flock if available (faster, more reliable)
  if command -v flock >/dev/null 2>&1; then
    count=$(flock "$lock" -c "
      c=\$(cat '$file' 2>/dev/null || echo 0)
      c=\$((c + 1))
      echo \"\$c\" > '$file'
      echo \"\$c\"
    ")
    echo "$count"
    return 0
  fi

  # Fallback to mkdir-based locking (atomic across all POSIX systems)
  local max_attempts=100
  local attempt=0
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.1
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
      # Clean stale lock if exists for >10 seconds
      if [ -d "$lock" ]; then
        local lock_age
        lock_age=$(( $(date +%s) - $(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || echo 0) ))
        if [ "$lock_age" -gt 10 ]; then
          rmdir "$lock" 2>/dev/null || true
          continue
        fi
      fi
      echo "ERROR: Failed to acquire lock after ${max_attempts} attempts" >&2
      return 1
    fi
  done

  # Lock acquired - perform increment
  count=$(cat "$file" 2>/dev/null || echo 0)
  count=$((count + 1))
  echo "$count" > "$file"
  rmdir "$lock" 2>/dev/null || true
  echo "$count"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# atomic_decrement
# ─────────────────────────────────────────────────────────────────────────────
# Atomically decrement a counter in a file.
# Uses same locking strategy as atomic_increment.
#
# Arguments:
#   $1 - Counter file path
#
# Returns:
#   New counter value on stdout, exit code 0 on success
#
# Example:
#   new_value=$(atomic_decrement "/path/to/counter.txt")
# ─────────────────────────────────────────────────────────────────────────────
atomic_decrement() {
  local file="$1"
  local lock="${file}.lock"
  local count

  # Create parent directory if needed
  local dir
  dir="$(dirname "$file")"
  mkdir -p "$dir" 2>/dev/null || true

  # Use flock if available
  if command -v flock >/dev/null 2>&1; then
    count=$(flock "$lock" -c "
      c=\$(cat '$file' 2>/dev/null || echo 0)
      c=\$((c - 1))
      # Prevent negative counts
      if [ \"\$c\" -lt 0 ]; then c=0; fi
      echo \"\$c\" > '$file'
      echo \"\$c\"
    ")
    echo "$count"
    return 0
  fi

  # Fallback to mkdir-based locking
  local max_attempts=100
  local attempt=0
  while ! mkdir "$lock" 2>/dev/null; do
    sleep 0.1
    attempt=$((attempt + 1))
    if [ "$attempt" -ge "$max_attempts" ]; then
      # Clean stale lock if exists for >10 seconds
      if [ -d "$lock" ]; then
        local lock_age
        lock_age=$(( $(date +%s) - $(stat -f %m "$lock" 2>/dev/null || stat -c %Y "$lock" 2>/dev/null || echo 0) ))
        if [ "$lock_age" -gt 10 ]; then
          rmdir "$lock" 2>/dev/null || true
          continue
        fi
      fi
      echo "ERROR: Failed to acquire lock after ${max_attempts} attempts" >&2
      return 1
    fi
  done

  # Lock acquired - perform decrement
  count=$(cat "$file" 2>/dev/null || echo 0)
  count=$((count - 1))
  # Prevent negative counts
  if [ "$count" -lt 0 ]; then count=0; fi
  echo "$count" > "$file"
  rmdir "$lock" 2>/dev/null || true
  echo "$count"
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# atomic_read
# ─────────────────────────────────────────────────────────────────────────────
# Safely read a counter value, returning 0 if file doesn't exist.
#
# Arguments:
#   $1 - Counter file path
#
# Returns:
#   Counter value on stdout
#
# Example:
#   value=$(atomic_read "/path/to/counter.txt")
# ─────────────────────────────────────────────────────────────────────────────
atomic_read() {
  local file="$1"
  cat "$file" 2>/dev/null || echo 0
}

# ─────────────────────────────────────────────────────────────────────────────
# atomic_append
# ─────────────────────────────────────────────────────────────────────────────
# Atomically append content to a file.
# Note: On most systems, appends <PIPE_BUF (512-4096 bytes) are atomic.
# For larger writes, consider using a lock.
#
# Arguments:
#   $1 - Target file path
#   $2 - Content to append
#
# Returns:
#   0 on success, 1 on failure
#
# Example:
#   atomic_append "/path/to/log.txt" "new log line"
# ─────────────────────────────────────────────────────────────────────────────
atomic_append() {
  local file="$1"
  local content="$2"

  # Create parent directory if needed
  local dir
  dir="$(dirname "$file")"
  mkdir -p "$dir" 2>/dev/null || true

  # Single write is atomic up to PIPE_BUF size (typically 4096 bytes)
  # For bash echo, this is safe for reasonable log lines
  echo "$content" >> "$file" 2>/dev/null || return 1
  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# atomic_delete
# ─────────────────────────────────────────────────────────────────────────────
# Atomically delete a file (idempotent - no error if file doesn't exist).
#
# Arguments:
#   $1 - File path to delete
#
# Returns:
#   0 on success
#
# Example:
#   atomic_delete "/path/to/file.txt"
# ─────────────────────────────────────────────────────────────────────────────
atomic_delete() {
  local file="$1"
  rm -f "$file" 2>/dev/null || true
  return 0
}
