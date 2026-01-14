#!/bin/bash
# Shared color and output utilities for ralph scripts
# Source this file to get TTY-aware colored output helpers

# ============================================================================
# Color output support with TTY detection
# Colors are disabled when stdout is not a TTY (pipes, redirects)
# ============================================================================

if [ -t 1 ]; then
  C_GREEN=$'\033[32m'
  C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
  C_DIM=$'\033[2m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_GREEN=''
  C_RED=''
  C_YELLOW=''
  C_CYAN=''
  C_DIM=''
  C_BOLD=''
  C_RESET=''
fi

# ============================================================================
# Colored output helper functions (msg_*)
# ============================================================================

msg_success() {
  printf "${C_GREEN}%s${C_RESET}\n" "$1"
}

msg_error() {
  printf "${C_BOLD}${C_RED}%s${C_RESET}\n" "$1"
}

msg_warn() {
  printf "${C_YELLOW}%s${C_RESET}\n" "$1"
}

msg_info() {
  printf "${C_CYAN}%s${C_RESET}\n" "$1"
}

msg_dim() {
  printf "${C_DIM}%s${C_RESET}\n" "$1"
}

# ============================================================================
# Visual hierarchy helpers (from stream.sh)
# Symbols standardized for consistent meaning across all commands:
#   checkmark = success/completed action
#   filled circle = completed stream/item
#   empty circle = ready/pending
#   play = running/in-progress
#   question = unknown/error state
#   arrow = pointer/reference
# ============================================================================

SYM_SUCCESS="✓"
SYM_COMPLETED="●"
SYM_READY="○"
SYM_RUNNING="▶"
SYM_UNKNOWN="?"
SYM_POINTER="→"

# ============================================================================
# Status constants for stream/PRD states
# Use these instead of magic strings for maintainability and error prevention
# ============================================================================

STATUS_RUNNING="running"
STATUS_COMPLETED="completed"
STATUS_READY="ready"
STATUS_NOT_FOUND="not_found"
STATUS_NO_PRD="no_prd"
STATUS_NO_STORIES="no_stories"

# Section header with color and separator
section_header() {
  local title="$1"
  printf "\n${C_BOLD}${C_CYAN}%s${C_RESET}\n" "$title"
  printf "${C_DIM}────────────────────────────────────────${C_RESET}\n"
}

# File path display (distinct from regular text)
path_display() {
  local path="$1"
  printf "${C_CYAN}%s${C_RESET}" "$path"
}

# Next steps section with visual highlight
next_steps_header() {
  printf "\n${C_BOLD}${C_YELLOW}Next steps:${C_RESET}\n"
}

# Indented bullet point
bullet() {
  local text="$1"
  printf "  ${C_DIM}•${C_RESET} %b\n" "$text"
}

# Numbered step (for next steps)
numbered_step() {
  local num="$1"
  local text="$2"
  printf "  ${C_YELLOW}%d.${C_RESET} %s\n" "$num" "$text"
}

# ============================================================================
# Error display functions
# These functions provide consistent error formatting across ralph scripts
# Note: ERRORS_LOG_PATH and GUARDRAILS_PATH must be defined by the caller
# ============================================================================

# Enhanced error display with path highlighting
# Usage: show_error "message" ["log_path"]
show_error() {
  local message="$1"
  local log_path="${2:-}"
  msg_error "$message"
  if [[ -n "$log_path" ]]; then
    printf "  ${C_RED}Review logs at: ${C_BOLD}%s${C_RESET}\n" "$log_path"
  fi
}

# Show helpful suggestions when errors occur
# Usage: show_error_suggestions ["agent"|"system"]
# Note: Requires ERRORS_LOG_PATH and GUARDRAILS_PATH to be set in calling context
show_error_suggestions() {
  local error_type="${1:-agent}"  # agent or system
  printf "\n${C_YELLOW}${C_BOLD}Suggested next steps:${C_RESET}\n"
  if [[ "$error_type" = "agent" ]]; then
    printf "  ${C_DIM}1)${C_RESET} Review the run log for agent output and errors\n"
    printf "  ${C_DIM}2)${C_RESET} Check ${C_CYAN}%s${C_RESET} for repeated failures\n" "$ERRORS_LOG_PATH"
    printf "  ${C_DIM}3)${C_RESET} Try: ${C_CYAN}ralph build 1 --no-commit${C_RESET} for a test run\n"
  else
    printf "  ${C_DIM}1)${C_RESET} Verify the agent CLI is installed and authenticated\n"
    printf "  ${C_DIM}2)${C_RESET} Check system resources (disk space, memory)\n"
    printf "  ${C_DIM}3)${C_RESET} Review ${C_CYAN}%s${C_RESET} for patterns\n" "$GUARDRAILS_PATH"
  fi
}

# Print error summary at end of run if any iterations failed
# Usage: print_error_summary "iter:story:logfile,..." count
# Note: Requires ERRORS_LOG_PATH to be set in calling context
print_error_summary() {
  local failed_data="$1"
  local count="$2"

  if [[ -z "$failed_data" ]] || [[ "$count" -eq 0 ]]; then
    return
  fi

  echo ""
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}${C_RED}  ERROR SUMMARY: %d iteration(s) failed${C_RESET}\n" "$count"
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"

  # Parse and display each failed iteration
  IFS=',' read -ra FAILURES <<< "$failed_data"
  for failure in "${FAILURES[@]}"; do
    IFS=':' read -r iter story logfile <<< "$failure"
    printf "${C_RED}  ✗ Iteration %s${C_RESET}" "$iter"
    if [[ -n "$story" ]] && [[ "$story" != "plan" ]]; then
      printf " ${C_DIM}(%s)${C_RESET}" "$story"
    fi
    printf "\n"
    printf "    ${C_RED}Log: ${C_BOLD}%s${C_RESET}\n" "$logfile"
  done

  printf "${C_RED}───────────────────────────────────────────────────────${C_RESET}\n"
  printf "  ${C_YELLOW}Check: ${C_CYAN}%s${C_RESET}\n" "$ERRORS_LOG_PATH"
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"
}
