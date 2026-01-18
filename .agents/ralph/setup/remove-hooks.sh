#!/bin/bash
# Auto-Speak Uninstall Script
# Removes Ralph auto-speak hooks from Claude Code configuration
#
# Usage: .agents/ralph/setup/remove-hooks.sh
#
# Exit codes:
#   0 - Hooks removed successfully
#   1 - Error (missing dependencies, removal failed, etc.)
#   2 - Hooks not found (already removed)

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

# Configuration
CLAUDE_CONFIG="${HOME}/.claude/settings.local.json"
BACKUP_SUFFIX=".backup-$(date +%Y%m%d-%H%M%S)"

# Print functions
info() { echo -e "${CYAN}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check dependencies
check_dependencies() {
  if ! command -v jq &> /dev/null; then
    error "jq is required but not installed"
    info "Install: brew install jq (macOS) or apt install jq (Linux)"
    exit 1
  fi
}

# Check if hooks are present
check_hooks_present() {
  if [ ! -f "$CLAUDE_CONFIG" ]; then
    return 1 # Not present
  fi

  # Check for Ralph hooks
  local has_ralph_hooks

  has_ralph_hooks=$(jq -r '
    (
      (.hooks.UserPromptSubmit? // [] |
       map(.hooks? // [] | map(.command? // "" | contains("prompt-ack-hook.sh"))) |
       flatten | any) or
      (.hooks.Stop? // [] |
       map(.hooks? // [] | map(.command? // "" | contains("auto-speak-hook.sh"))) |
       flatten | any)
    )
  ' "$CLAUDE_CONFIG")

  if [ "$has_ralph_hooks" = "true" ]; then
    return 0 # Hooks present
  fi

  return 1 # Not present
}

# List hooks that will be removed
list_hooks() {
  echo ""
  echo -e "${BOLD}Hooks to be removed:${NC}"

  # List UserPromptSubmit hooks
  local prompt_hooks
  prompt_hooks=$(jq -r '
    .hooks.UserPromptSubmit? // [] |
    map(.hooks? // [] | map(select(.command? // "" | contains("prompt-ack-hook.sh")) | .command)) |
    flatten | .[]
  ' "$CLAUDE_CONFIG" 2>/dev/null || echo "")

  if [ -n "$prompt_hooks" ]; then
    echo -e "${CYAN}• UserPromptSubmit:${NC}"
    echo "$prompt_hooks" | while read -r hook; do
      echo "    $hook"
    done
  fi

  # List Stop hooks
  local stop_hooks
  stop_hooks=$(jq -r '
    .hooks.Stop? // [] |
    map(.hooks? // [] | map(select(.command? // "" | contains("auto-speak-hook.sh")) | .command)) |
    flatten | .[]
  ' "$CLAUDE_CONFIG" 2>/dev/null || echo "")

  if [ -n "$stop_hooks" ]; then
    echo -e "${CYAN}• Stop:${NC}"
    echo "$stop_hooks" | while read -r hook; do
      echo "    $hook"
    done
  fi

  echo ""
}

# Create backup
create_backup() {
  local backup_file="${CLAUDE_CONFIG}${BACKUP_SUFFIX}"

  if [ -f "$CLAUDE_CONFIG" ]; then
    cp "$CLAUDE_CONFIG" "$backup_file"
    success "Backup created: $backup_file"
    echo "$backup_file" # Return backup path
  else
    echo "" # No backup needed
  fi
}

# Remove hooks from config
remove_hooks() {
  local temp_file
  temp_file=$(mktemp)

  # Remove Ralph hooks using jq
  jq '
    # Remove prompt-ack-hook.sh from UserPromptSubmit
    .hooks.UserPromptSubmit = (
      (.hooks.UserPromptSubmit? // []) |
      map(
        .hooks = ((.hooks? // []) | map(select(.command? // "" | contains("prompt-ack-hook.sh") | not)))
      ) |
      # Remove empty hook groups
      map(select(.hooks | length > 0))
    ) |

    # Remove auto-speak-hook.sh from Stop
    .hooks.Stop = (
      (.hooks.Stop? // []) |
      map(
        .hooks = ((.hooks? // []) | map(select(.command? // "" | contains("auto-speak-hook.sh") | not)))
      ) |
      # Remove empty hook groups
      map(select(.hooks | length > 0))
    ) |

    # Clean up empty hooks object
    if (.hooks.UserPromptSubmit | length == 0) then
      .hooks |= del(.UserPromptSubmit)
    else
      .
    end |

    if (.hooks.Stop | length == 0) then
      .hooks |= del(.Stop)
    else
      .
    end |

    # Remove hooks key if completely empty
    if (.hooks | length == 0) then
      del(.hooks)
    else
      .
    end
  ' "$CLAUDE_CONFIG" > "$temp_file"

  # Verify jq succeeded
  if [ $? -ne 0 ]; then
    rm -f "$temp_file"
    error "Failed to process config with jq"
    exit 1
  fi

  # Verify output is valid JSON
  if ! jq empty "$temp_file" 2>/dev/null; then
    rm -f "$temp_file"
    error "Generated config is invalid JSON"
    exit 1
  fi

  # Replace config
  mv "$temp_file" "$CLAUDE_CONFIG"
}

# Show diff
show_diff() {
  local backup_file="$1"

  if [ -f "$backup_file" ]; then
    echo ""
    echo -e "${BOLD}Changes:${NC}"
    diff -u "$backup_file" "$CLAUDE_CONFIG" || true
    echo ""
  fi
}

# Main removal flow
main() {
  echo ""
  echo -e "${CYAN}${BOLD}Ralph Auto-Speak Hook Removal${NC}"
  echo ""

  # Check dependencies
  check_dependencies

  # Check if config exists
  if [ ! -f "$CLAUDE_CONFIG" ]; then
    info "Claude Code config not found: $CLAUDE_CONFIG"
    info "Nothing to remove."
    exit 2
  fi

  # Check if hooks are present
  if ! check_hooks_present; then
    success "Ralph hooks not found in config"
    info "Config: $CLAUDE_CONFIG"
    exit 2
  fi

  # List hooks that will be removed
  list_hooks

  # Confirmation prompt
  read -p "Remove these hooks? [y/N] " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    warn "Cancelled by user"
    exit 0
  fi

  # Create backup
  backup_file=$(create_backup)

  # Remove hooks
  info "Removing Ralph hooks from Claude Code config..."
  remove_hooks

  # Show changes
  if [ -n "$backup_file" ]; then
    show_diff "$backup_file"
  fi

  # Success
  success "Ralph hooks removed successfully"
  info "Config: $CLAUDE_CONFIG"

  if [ -n "$backup_file" ]; then
    info "Backup: $backup_file"
    echo ""
    echo -e "${BOLD}To restore hooks:${NC}"
    echo "  cp $backup_file $CLAUDE_CONFIG"
  fi

  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo "  1. Restart Claude Code"
  echo "  2. Auto-speak is now disabled"
  echo ""
  echo -e "${CYAN}To reinstall: .agents/ralph/setup/post-install.sh${NC}"
  echo ""
}

# Run main
main "$@"
