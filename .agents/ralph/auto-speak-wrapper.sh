#!/usr/bin/env bash
# Auto-speak wrapper for Claude Code sessions
# Source this file to enable auto-speaking: source .agents/ralph/auto-speak-wrapper.sh

# Check if ralph speak is available
if ! command -v ralph &>/dev/null; then
  echo "Error: ralph command not found"
  return 1
fi

# Function to speak clipboard contents
speak-clipboard() {
  if command -v pbpaste &>/dev/null; then
    pbpaste | ralph speak
  elif command -v xclip &>/dev/null; then
    xclip -selection clipboard -o | ralph speak
  else
    echo "Clipboard command not found (pbpaste or xclip required)"
    return 1
  fi
}

# Function to speak last Claude response
# Usage: After copying my response, run: speak-last
speak-last() {
  speak-clipboard
}

# Alias for convenience
alias sl='speak-last'
alias sc='speak-clipboard'

# Enable auto-speak mode
auto-speak-on() {
  ralph speak --auto-on
  echo ""
  echo "To hear responses:"
  echo "  1. Select/copy my text response"
  echo "  2. Run: sl"
  echo ""
  echo "Or use keyboard shortcut: Ctrl+C then sl"
}

# Disable auto-speak mode
auto-speak-off() {
  ralph speak --auto-off
}

# Check status
auto-speak-status() {
  ralph speak --auto-status
}

echo "Auto-speak functions loaded!"
echo ""
echo "Commands:"
echo "  auto-speak-on     - Enable auto-speak mode"
echo "  auto-speak-off    - Disable auto-speak mode"
echo "  speak-last (sl)   - Speak last copied text"
echo ""
echo "Quick start: Run 'auto-speak-on' to begin"
