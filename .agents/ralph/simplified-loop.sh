#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Simplified Ralph Loop
# ─────────────────────────────────────────────────────────────────────────────
# The simplest, most concise, most error-free Ralph loop.
# Delegates ALL enforcement to Claude Code hooks (PreToolUse, PostToolUse, Stop)
# rather than inline validation.
#
# Usage:
#   ./simplified-loop.sh                   # build mode, default iterations
#   ./simplified-loop.sh 10                # build mode, 10 iterations
#   ./simplified-loop.sh --prd=2           # build specific PRD
#   ./simplified-loop.sh --dry-run         # validate without running agent
#
# Target: ~150 lines of core loop logic
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Error trap with context
trap '_handle_error "$?" "$LINENO"' ERR
_handle_error() {
  local exit_code=$1 line_no=$2
  echo "ERROR: Failed at line $line_no (exit $exit_code)" >&2
  exit "$exit_code"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${RALPH_ROOT:-${SCRIPT_DIR}/../..}" && pwd)"

# Source minimal utilities only
source "$SCRIPT_DIR/lib/minimal.sh"

# ─────────────────────────────────────────────────────────────────────────────
# Configuration with defaults
# ─────────────────────────────────────────────────────────────────────────────
MAX_ITERATIONS="${MAX_ITERATIONS:-25}"
TIMEOUT_AGENT="${TIMEOUT_AGENT:-3600}"
PRD_NUMBER="${PRD_NUMBER:-1}"
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case "$arg" in
    --prd=*)
      PRD_NUMBER="${arg#*=}"
      # Validate PRD_NUMBER is a positive integer (prevent path traversal)
      if ! [[ "$PRD_NUMBER" =~ ^[0-9]+$ ]]; then
        log_error "Invalid PRD number: $PRD_NUMBER (must be a positive integer)"
        exit 1
      fi
      ;;
    --dry-run) DRY_RUN=true ;;
    [0-9]*) MAX_ITERATIONS="$arg" ;;
  esac
done

# Validate MAX_ITERATIONS upper bound (prevent runaway processes)
MAX_ALLOWED_ITERATIONS="${MAX_ALLOWED_ITERATIONS:-100}"

if [[ "$MAX_ITERATIONS" -gt "$MAX_ALLOWED_ITERATIONS" ]]; then
  log_warn "MAX_ITERATIONS capped at $MAX_ALLOWED_ITERATIONS (requested: $MAX_ITERATIONS)"
  MAX_ITERATIONS="$MAX_ALLOWED_ITERATIONS"
fi

# Paths (relative to ROOT_DIR)
RALPH_DIR="$ROOT_DIR/.ralph"
PRD_DIR="$RALPH_DIR/PRD-${PRD_NUMBER}"
PLAN_PATH="$PRD_DIR/plan.md"
PROGRESS_PATH="$PRD_DIR/progress.md"
PROMPT_TEMPLATE="$SCRIPT_DIR/PROMPT_simplified.md"

# Validate required files exist
if [[ ! -f "$PLAN_PATH" ]]; then
  log_error "Plan not found: $PLAN_PATH"
  log_error "Run 'ralph plan --prd=$PRD_NUMBER' first"
  exit 1
fi

# Create progress file if it doesn't exist
[[ -f "$PROGRESS_PATH" ]] || echo "# Progress Log" > "$PROGRESS_PATH"

# ─────────────────────────────────────────────────────────────────────────────
# Signal handling with proper cleanup
# ─────────────────────────────────────────────────────────────────────────────
AGENT_PID=""
TEMP_FILE=""

cleanup() {
  # Block signals during cleanup to prevent re-entry
  trap '' INT TERM EXIT

  if [[ -n "${AGENT_PID:-}" ]] && kill -0 "$AGENT_PID" 2>/dev/null; then
    kill -TERM "$AGENT_PID" 2>/dev/null || true
    wait "$AGENT_PID" 2>/dev/null || true
  fi

  [[ -n "${TEMP_FILE:-}" ]] && rm -f "$TEMP_FILE" 2>/dev/null || true

  log "Loop terminated"

  # Re-enable traps before exit
  trap - INT TERM EXIT
}

trap 'cleanup; exit 130' INT   # Ctrl+C
trap 'cleanup; exit 143' TERM  # kill
trap 'cleanup' EXIT            # normal exit

# ─────────────────────────────────────────────────────────────────────────────
# Main iteration loop
# ─────────────────────────────────────────────────────────────────────────────
log "Starting simplified loop (PRD-$PRD_NUMBER, max $MAX_ITERATIONS iterations)"
cd "$ROOT_DIR"

# Acquire exclusive lock to prevent concurrent modifications (TOCTOU protection)
# The lock file descriptor is automatically closed when the script exits,
# which releases the lock. The trap cleanup handles other cleanup tasks.
LOCK_FILE="$RALPH_DIR/.agent-lock"
mkdir -p "$(dirname "$LOCK_FILE")"

# Cross-platform lock acquisition (flock on Linux, shlock on macOS)
if command -v flock >/dev/null 2>&1; then
  exec 200>"$LOCK_FILE"
  if ! flock -n 200; then
    log_error "Another agent is running. Use stream mode for parallel builds."
    exit 1
  fi
elif command -v shlock >/dev/null 2>&1; then
  if ! shlock -f "$LOCK_FILE" -p $$; then
    log_error "Another agent is running. Use stream mode for parallel builds."
    exit 1
  fi
else
  # Fallback: simple PID-based lock
  if [[ -f "$LOCK_FILE" ]]; then
    existing_pid=$(cat "$LOCK_FILE" 2>/dev/null)
    if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
      log_error "Another agent is running (PID $existing_pid). Use stream mode for parallel builds."
      exit 1
    fi
  fi
  echo $$ > "$LOCK_FILE"
fi
log "Acquired exclusive lock for agent execution"

for iteration in $(seq 1 "$MAX_ITERATIONS"); do
  log "=== Iteration $iteration/$MAX_ITERATIONS ==="

  # Story selection (simple: first unchecked story)
  story_line=$(grep -m1 '^\s*-\s*\[ \].*US-[0-9]\+' "$PLAN_PATH" 2>/dev/null || echo "")

  if [[ -z "$story_line" ]]; then
    log_success "All stories complete!"
    exit 0
  fi

  # Extract story ID (e.g., US-001)
  story_id=$(echo "$story_line" | grep -o 'US-[0-9]\+' | head -1)

  if [[ -z "$story_id" ]]; then
    log_error "Could not parse story ID from: $story_line"
    exit 1
  fi

  log "Working on: $story_id"

  # Save checkpoint for rollback (atomic write)
  # Protected by the exclusive lock acquired above
  HEAD_BEFORE=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [[ -n "$HEAD_BEFORE" ]]; then
    atomic_write "$RALPH_DIR/.checkpoint" "$HEAD_BEFORE"
  fi

  # Track current story for hooks
  atomic_write "$RALPH_DIR/current-story" "$story_id"

  # Dry run mode - just show what would happen
  if [[ "$DRY_RUN" == "true" ]]; then
    log "DRY RUN: Would execute story $story_id"
    continue
  fi

  # Build prompt from template
  TEMP_FILE=$(mktemp)
  build_prompt "$story_id" "$PLAN_PATH" "$PROMPT_TEMPLATE" > "$TEMP_FILE"

  # Run agent with timeout
  set +e
  timeout "$TIMEOUT_AGENT" claude -p --dangerously-skip-permissions < "$TEMP_FILE" &
  AGENT_PID=$!
  wait "$AGENT_PID"
  exit_code=$?
  AGENT_PID=""
  set -e

  # Cleanup temp file
  rm -f "$TEMP_FILE"
  TEMP_FILE=""

  if [[ $exit_code -eq 0 ]]; then
    # Success: commit changes
    if git diff --quiet && git diff --cached --quiet; then
      log_warn "No changes to commit for $story_id"
    else
      git add -A
      git commit -m "feat($story_id): implementation" --no-verify 2>/dev/null || true
    fi

    # Mark story complete in plan
    mark_story_complete "$story_id" "$PLAN_PATH"

    # Log progress
    {
      echo ""
      echo "## Iteration $iteration - $story_id"
      echo "- Status: SUCCESS"
      echo "- Commit: $(git rev-parse --short HEAD 2>/dev/null || echo 'N/A')"
      echo "- Time: $(date -Iseconds)"
    } >> "$PROGRESS_PATH"

    log_success "Completed: $story_id"

  elif [[ $exit_code -eq 130 ]] || [[ $exit_code -eq 143 ]]; then
    # Interrupted (SIGINT/SIGTERM)
    log "Interrupted"
    exit "$exit_code"

  elif [[ $exit_code -eq 124 ]]; then
    # Timeout
    log_error "Timeout after ${TIMEOUT_AGENT}s for $story_id"
    {
      echo ""
      echo "## Iteration $iteration - $story_id"
      echo "- Status: TIMEOUT"
      echo "- Time: $(date -Iseconds)"
    } >> "$PROGRESS_PATH"

  else
    # Other failure - hooks should have handled rollback
    log_warn "Failed: $story_id (exit $exit_code) - hooks handle rollback"
    {
      echo ""
      echo "## Iteration $iteration - $story_id"
      echo "- Status: FAILED (exit $exit_code)"
      echo "- Time: $(date -Iseconds)"
    } >> "$PROGRESS_PATH"
  fi
done

log "Max iterations ($MAX_ITERATIONS) reached"
exit 0
