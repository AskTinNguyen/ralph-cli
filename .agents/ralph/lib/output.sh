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

# ============================================================================
# Summary table display functions
# These functions provide iteration summary formatting for ralph build loops
# ============================================================================

# Format duration in human-readable form (e.g., "1m 23s" or "45s")
# Usage: format_duration <seconds>
format_duration() {
  local secs="$1"
  local mins=$((secs / 60))
  local remaining=$((secs % 60))
  if [[ "$mins" -gt 0 ]]; then
    printf "%dm %ds" "$mins" "$remaining"
  else
    printf "%ds" "$secs"
  fi
}

# Print iteration summary table at end of multi-iteration run
# Usage: print_summary_table "iter|story|dur|status|retries,..." total_time success_count total_count remaining
# Note: Requires color variables (C_*) to be defined
print_summary_table() {
  local results="$1"
  local total_time="$2"
  local success_count="$3"
  local total_count="$4"
  local remaining="$5"

  if [[ -z "$results" ]] || [[ "$total_count" -eq 0 ]]; then
    return
  fi

  # Only show table for multi-iteration runs (2+)
  if [[ "$total_count" -lt 2 ]]; then
    return
  fi

  echo ""
  printf "${C_CYAN}╔═══════════════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD}${C_CYAN}                    ITERATION SUMMARY                          ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╠═════╤════════════╤════════════╤═════════╤══════════════════════╣${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD} Iter│   Story    │  Duration  │ Retries │       Status         ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╟─────┼────────────┼────────────┼─────────┼──────────────────────╢${C_RESET}\n"

  # Parse and display each iteration result
  IFS=',' read -ra RESULTS <<< "$results"
  local total_retries=0
  for result in "${RESULTS[@]}"; do
    # Handle both old format (4 fields) and new format (5 fields with retries)
    local iter story duration status retries_field
    IFS='|' read -r iter story duration status retries_field <<< "$result"
    local dur_str
    dur_str=$(format_duration "$duration")
    # Handle missing/empty retries field gracefully (backwards compatibility)
    local retries=0
    if [[ -n "$retries_field" ]] && [[ "$retries_field" != "" ]]; then
      retries="$retries_field"
    fi
    total_retries=$((total_retries + retries))

    # Status symbol and color
    local status_display
    if [[ "$status" = "success" ]]; then
      status_display="${C_GREEN}✓ success${C_RESET}"
    else
      status_display="${C_RED}✗ error${C_RESET}"
    fi

    # Retry display with color
    local retry_display
    if [[ "$retries" -gt 0 ]]; then
      retry_display="${C_YELLOW}${retries}${C_RESET}"
    else
      retry_display="${C_DIM}0${C_RESET}"
    fi

    # Truncate story ID if too long (max 10 chars)
    local story_display="${story:-plan}"
    if [[ "${#story_display}" -gt 10 ]]; then
      story_display="${story_display:0:10}"
    fi

    printf "${C_CYAN}║${C_RESET} %3s │ %-10s │ %10s │   %-5b │ %-20b ${C_CYAN}║${C_RESET}\n" "$iter" "$story_display" "$dur_str" "$retry_display" "$status_display"
  done

  printf "${C_CYAN}╠═════╧════════════╧════════════╧═════════╧══════════════════════╣${C_RESET}\n"

  # Aggregate stats
  local total_dur_str
  total_dur_str=$(format_duration "$total_time")
  local success_rate
  if [[ "$total_count" -gt 0 ]]; then
    success_rate=$((success_count * 100 / total_count))
  else
    success_rate=0
  fi

  # Color-code success rate
  local rate_color="$C_GREEN"
  if [[ "$success_rate" -lt 100 ]]; then
    rate_color="$C_YELLOW"
  fi
  if [[ "$success_rate" -lt 50 ]]; then
    rate_color="$C_RED"
  fi

  printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Total time:${C_RESET} %-10s ${C_BOLD}Success:${C_RESET} ${rate_color}%d/%d (%d%%)${C_RESET}  " "$total_dur_str" "$success_count" "$total_count" "$success_rate"
  if [[ "$total_retries" -gt 0 ]]; then
    printf "${C_BOLD}Retries:${C_RESET} ${C_YELLOW}%d${C_RESET}  " "$total_retries"
  fi
  printf "${C_CYAN}║${C_RESET}\n"
  if [[ -n "$remaining" ]] && [[ "$remaining" != "unknown" ]] && [[ "$remaining" != "0" ]]; then
    printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Stories remaining:${C_RESET} %-41s ${C_CYAN}║${C_RESET}\n" "$remaining"
  fi
  printf "${C_CYAN}╚═══════════════════════════════════════════════════════════════╝${C_RESET}\n"
}
