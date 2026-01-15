#!/bin/bash
# Enable Playwright MCP for the current session
#
# Usage:
#   source .agents/ralph/enable-playwright.sh
#   OR
#   . .agents/ralph/enable-playwright.sh
#
# This temporarily enables Playwright MCP by modifying .mcp.json
# The change is local to this project only.

set -e

MCP_FILE=".mcp.json"

if [[ ! -f "$MCP_FILE" ]]; then
    echo "Error: $MCP_FILE not found in current directory"
    exit 1
fi

# Check if playwright is already enabled
if grep -q '"playwright".*"disabled": false' "$MCP_FILE" 2>/dev/null; then
    echo "✓ Playwright MCP is already enabled"
    exit 0
fi

# Enable playwright by removing disabled flag or setting it to false
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' 's/"playwright": {/"playwright": {\
      "disabled": false,/; s/"disabled": true,/"disabled": false,/' "$MCP_FILE"
else
    # Linux
    sed -i 's/"playwright": {/"playwright": {\n      "disabled": false,/; s/"disabled": true,/"disabled": false,/' "$MCP_FILE"
fi

echo "✓ Playwright MCP enabled for this session"
echo ""
echo "Next steps:"
echo "  1. Exit current Claude Code session (Ctrl+C)"
echo "  2. Restart Claude Code: claude"
echo "  3. Playwright browser tools will be available"
echo ""
echo "To disable again, run: .agents/ralph/disable-playwright.sh"
