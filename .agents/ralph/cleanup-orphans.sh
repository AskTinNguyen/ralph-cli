#!/usr/bin/env bash
# cleanup-orphans.sh
# Utility to clean up orphaned Ralph loop.sh processes and their background timers
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
C_RED='\033[0;31m'
C_GREEN='\033[0;32m'
C_YELLOW='\033[1;33m'
C_DIM='\033[2m'
C_RESET='\033[0m'

msg_info() { echo -e "${C_DIM}[INFO]${C_RESET} $*"; }
msg_success() { echo -e "${C_GREEN}[✓]${C_RESET} $*"; }
msg_warn() { echo -e "${C_YELLOW}[!]${C_RESET} $*"; }
msg_error() { echo -e "${C_RED}[ERROR]${C_RESET} $*"; }

echo "=========================================="
echo "Ralph Orphaned Process Cleanup"
echo "=========================================="
echo ""

# Find orphaned loop.sh processes
msg_info "Searching for orphaned Ralph processes..."
ORPHANED_PIDS=$(ps aux | grep "[/]ralph-cli/.agents/ralph/loop.sh" | awk '{print $2}' || true)

if [ -z "$ORPHANED_PIDS" ]; then
  msg_success "No orphaned Ralph processes found."
  exit 0
fi

# Display found processes
echo ""
msg_warn "Found orphaned processes:"
ps aux | grep "[/]ralph-cli/.agents/ralph/loop.sh" | head -10
echo ""

# Count processes
PROCESS_COUNT=$(echo "$ORPHANED_PIDS" | wc -l | tr -d ' ')
msg_info "Total: $PROCESS_COUNT process(es)"
echo ""

# Ask for confirmation
read -p "Kill these processes? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  msg_info "Cancelled. No processes were killed."
  exit 0
fi

# Kill the processes
msg_info "Terminating processes..."
for pid in $ORPHANED_PIDS; do
  if kill -TERM "$pid" 2>/dev/null; then
    msg_success "Killed PID $pid"
  else
    msg_warn "Failed to kill PID $pid (may have already exited)"
  fi
done

# Wait a moment for processes to terminate
sleep 2

# Verify cleanup
REMAINING=$(ps aux | grep "[/]ralph-cli/.agents/ralph/loop.sh" | wc -l | tr -d ' ')
if [ "$REMAINING" -eq 0 ]; then
  msg_success "All orphaned processes cleaned up successfully."
else
  msg_warn "$REMAINING process(es) still running. You may need to use 'kill -9' for stubborn processes."
  echo ""
  ps aux | grep "[/]ralph-cli/.agents/ralph/loop.sh" || true
fi

echo ""
echo "=========================================="
msg_info "Cleanup complete. The elapsed time messages should stop now."
echo "=========================================="
