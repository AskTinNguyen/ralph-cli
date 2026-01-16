#!/bin/bash
#
# Cleanup Script: Remove Nested .ralph Directories from Worktrees
#
# This script backs up critical progress.md files from nested .ralph directories,
# then removes the nested directories to prevent context contamination.
#
# IMPORTANT: Run this AFTER applying the RALPH_DIR fix in stream.sh
#
# Usage:
#   bash .agents/ralph/cleanup-nested-ralph.sh
#   or
#   chmod +x .agents/ralph/cleanup-nested-ralph.sh
#   .agents/ralph/cleanup-nested-ralph.sh

set -euo pipefail

# Color codes for output
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'
C_BLUE='\033[0;34m'
C_DIM='\033[2m'
C_BOLD='\033[1m'
C_RESET='\033[0m'

# Get repo root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKTREES_DIR="$REPO_ROOT/.ralph/worktrees"
BACKUP_DIR="$REPO_ROOT/.ralph/Diagnosis/nested-progress-backup"

echo ""
echo -e "${C_BOLD}Nested .ralph Cleanup Script${C_RESET}"
echo -e "${C_DIM}════════════════════════════════════════${C_RESET}"
echo ""

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Function to backup progress.md from nested location
backup_progress() {
  local stream_id="$1"
  local nested_progress="$WORKTREES_DIR/$stream_id/.ralph/$stream_id/progress.md"
  local backup_file="$BACKUP_DIR/${stream_id}-progress.md"

  if [ -f "$nested_progress" ]; then
    local size=$(stat -f%z "$nested_progress" 2>/dev/null || stat -c%s "$nested_progress" 2>/dev/null || echo "0")

    if [ "$size" -gt 0 ]; then
      echo -e "${C_YELLOW}📦 Backing up:${C_RESET} $stream_id/progress.md (${size} bytes)"
      cp "$nested_progress" "$backup_file"
      echo -e "${C_GREEN}   ✓${C_RESET} Saved to: ${C_DIM}$(basename "$backup_file")${C_RESET}"
      return 0
    else
      echo -e "${C_DIM}⊘  Skipping:${C_RESET} $stream_id/progress.md (empty)"
      return 1
    fi
  else
    echo -e "${C_DIM}⊘  Not found:${C_RESET} $stream_id/progress.md"
    return 1
  fi
}

# Function to remove nested .ralph directory
remove_nested_ralph() {
  local stream_id="$1"
  local nested_ralph="$WORKTREES_DIR/$stream_id/.ralph"

  if [ -d "$nested_ralph" ]; then
    echo -e "${C_RED}🗑  Removing:${C_RESET} $stream_id/.ralph/"
    rm -rf "$nested_ralph"
    echo -e "${C_GREEN}   ✓${C_RESET} Deleted nested .ralph directory"
    return 0
  else
    echo -e "${C_DIM}⊘  No nested .ralph:${C_RESET} $stream_id"
    return 1
  fi
}

# Main cleanup logic
echo -e "${C_BOLD}Step 1: Backup Critical Files${C_RESET}"
echo -e "${C_DIM}────────────────────────────────────────${C_RESET}"
echo ""

backup_count=0

# Find all worktrees with nested .ralph
if [ -d "$WORKTREES_DIR" ]; then
  for worktree in "$WORKTREES_DIR"/*; do
    if [ -d "$worktree" ]; then
      stream_id=$(basename "$worktree")

      # Check if nested .ralph exists
      if [ -d "$worktree/.ralph" ]; then
        echo -e "${C_BLUE}Processing:${C_RESET} ${C_BOLD}$stream_id${C_RESET}"

        # Backup progress.md
        if backup_progress "$stream_id"; then
          ((backup_count++))
        fi

        # Also backup activity.log if exists
        nested_activity="$worktree/.ralph/$stream_id/activity.log"
        if [ -f "$nested_activity" ] && [ -s "$nested_activity" ]; then
          cp "$nested_activity" "$BACKUP_DIR/${stream_id}-activity.log"
          echo -e "${C_DIM}   + activity.log backed up${C_RESET}"
        fi

        # Backup errors.log if exists
        nested_errors="$worktree/.ralph/$stream_id/errors.log"
        if [ -f "$nested_errors" ] && [ -s "$nested_errors" ]; then
          cp "$nested_errors" "$BACKUP_DIR/${stream_id}-errors.log"
          echo -e "${C_DIM}   + errors.log backed up${C_RESET}"
        fi

        echo ""
      fi
    fi
  done
else
  echo -e "${C_DIM}No worktrees directory found${C_RESET}"
  echo ""
fi

echo -e "${C_GREEN}✓ Backup complete:${C_RESET} $backup_count file(s) saved to:"
echo -e "${C_DIM}  $(path_display "$BACKUP_DIR")${C_RESET}"
echo ""

# Pause for user confirmation
echo -e "${C_BOLD}Step 2: Remove Nested .ralph Directories${C_RESET}"
echo -e "${C_DIM}────────────────────────────────────────${C_RESET}"
echo ""
echo -e "${C_YELLOW}⚠️  WARNING:${C_RESET} This will delete nested .ralph directories"
echo -e "${C_DIM}   (backups are safe in Diagnosis/nested-progress-backup/)${C_RESET}"
echo ""
read -p "Continue? [y/N] " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo -e "${C_YELLOW}Cancelled${C_RESET}"
  exit 0
fi

echo ""

removal_count=0

# Remove nested .ralph directories
if [ -d "$WORKTREES_DIR" ]; then
  for worktree in "$WORKTREES_DIR"/*; do
    if [ -d "$worktree" ]; then
      stream_id=$(basename "$worktree")

      if remove_nested_ralph "$stream_id"; then
        ((removal_count++))
      fi

      echo ""
    fi
  done
fi

echo -e "${C_GREEN}✓ Cleanup complete:${C_RESET} $removal_count nested .ralph directories removed"
echo ""

# Verification
echo -e "${C_BOLD}Step 3: Verification${C_RESET}"
echo -e "${C_DIM}────────────────────────────────────────${C_RESET}"
echo ""

nested_count=$(find "$WORKTREES_DIR" -name ".ralph" -type d 2>/dev/null | wc -l)

if [ "$nested_count" -eq 0 ]; then
  echo -e "${C_GREEN}✓ PASS:${C_RESET} No nested .ralph directories found"
else
  echo -e "${C_RED}✗ FAIL:${C_RESET} Found $nested_count nested .ralph directories:"
  find "$WORKTREES_DIR" -name ".ralph" -type d
fi

echo ""

# Summary
echo -e "${C_BOLD}Summary${C_RESET}"
echo -e "${C_DIM}────────────────────────────────────────${C_RESET}"
echo -e "  Backups saved: ${C_BOLD}$backup_count${C_RESET}"
echo -e "  Directories removed: ${C_BOLD}$removal_count${C_RESET}"
echo -e "  Verification: ${C_GREEN}✓${C_RESET}"
echo ""
echo -e "${C_DIM}Backup location:${C_RESET}"
echo -e "  $BACKUP_DIR"
echo ""
echo -e "${C_DIM}Review backups:${C_RESET}"
echo -e "  ${C_DIM}ls -lh $BACKUP_DIR${C_RESET}"
echo ""
echo -e "${C_GREEN}✓ Cleanup successful${C_RESET}"
echo ""
