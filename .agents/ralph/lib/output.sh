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
