#!/bin/bash
# Auto-Speak Post-Install Script
# Safely adds Ralph auto-speak hooks to Claude Code configuration
#
# Usage: .agents/ralph/setup/post-install.sh
#
# Exit codes:
#   0 - Hooks added successfully
#   1 - Error (missing dependencies, backup failed, etc.)
#   2 - Hooks already configured

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

# Initialize Claude config if it doesn't exist
init_claude_config() {
  if [ ! -f "$CLAUDE_CONFIG" ]; then
    info "Creating Claude Code config at $CLAUDE_CONFIG"
    mkdir -p "$(dirname "$CLAUDE_CONFIG")"
    echo '{}' > "$CLAUDE_CONFIG"
  fi
}

# Check if hooks are already configured
check_existing_hooks() {
  if [ ! -f "$CLAUDE_CONFIG" ]; then
    return 1 # Not configured
  fi

  # Check for Ralph hooks
  local has_prompt_ack has_auto_speak

  has_prompt_ack=$(jq -r '
    .hooks.UserPromptSubmit? // [] |
    map(.hooks? // [] | map(.command? // "" | contains("prompt-ack-hook.sh"))) |
    flatten | any
  ' "$CLAUDE_CONFIG")

  has_auto_speak=$(jq -r '
    .hooks.Stop? // [] |
    map(.hooks? // [] | map(.command? // "" | contains("auto-speak-hook.sh"))) |
    flatten | any
  ' "$CLAUDE_CONFIG")

  if [ "$has_prompt_ack" = "true" ] && [ "$has_auto_speak" = "true" ]; then
    return 0 # Already configured
  fi

  return 1 # Not fully configured
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

# Add hooks to config
add_hooks() {
  local temp_file
  temp_file=$(mktemp)

  # Define hooks using jq to merge with existing config
  jq '
    # Initialize hooks object if missing
    .hooks = (.hooks // {}) |

    # Add UserPromptSubmit hook if not present
    .hooks.UserPromptSubmit = (.hooks.UserPromptSubmit // []) |
    if (
      map(.hooks? // [] | map(.command? // "" | contains("prompt-ack-hook.sh"))) |
      flatten | any | not
    ) then
      . + [{
        "hooks": [{
          "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.agents/ralph/prompt-ack-hook.sh"
        }]
      }]
    else
      .
    end |

    # Add Stop hook if not present
    .hooks.Stop = (.hooks.Stop // []) |
    if (
      map(.hooks? // [] | map(.command? // "" | contains("auto-speak-hook.sh"))) |
      flatten | any | not
    ) then
      . + [{
        "hooks": [{
          "type": "command",
          "command": "\"$CLAUDE_PROJECT_DIR\"/.agents/ralph/auto-speak-hook.sh"
        }]
      }]
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

# Main installation flow
main() {
  echo ""
  echo -e "${CYAN}${BOLD}Ralph Auto-Speak Hook Installation${NC}"
  echo ""

  # Check dependencies
  check_dependencies

  # Initialize config
  init_claude_config

  # Check if already configured
  if check_existing_hooks; then
    success "Ralph hooks already configured"
    info "Config: $CLAUDE_CONFIG"
    exit 2
  fi

  # Create backup
  backup_file=$(create_backup)

  # Add hooks
  info "Adding Ralph hooks to Claude Code config..."
  add_hooks

  # Show changes
  if [ -n "$backup_file" ]; then
    show_diff "$backup_file"
  fi

  # Success
  success "Ralph hooks installed successfully"
  info "Config: $CLAUDE_CONFIG"

  if [ -n "$backup_file" ]; then
    info "Backup: $backup_file"
  fi

  echo ""
  echo -e "${BOLD}Next steps:${NC}"
  echo "  1. Restart Claude Code"
  echo "  2. Run: ralph speak --auto-on"
  echo "  3. Check: ralph speak --auto-status"
  echo ""
  echo -e "${CYAN}To remove hooks: .agents/ralph/setup/remove-hooks.sh${NC}"
  echo ""
}

# Run main
main "$@"
