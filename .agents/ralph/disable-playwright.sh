#!/bin/bash
# Disable Playwright MCP to prevent browser windows from spawning
#
# Usage:
#   .agents/ralph/disable-playwright.sh

set -e

MCP_FILE=".mcp.json"

if [[ ! -f "$MCP_FILE" ]]; then
    echo "Error: $MCP_FILE not found in current directory"
    exit 1
fi

# Check if playwright is already disabled
if grep -q '"playwright".*"disabled": true' "$MCP_FILE" 2>/dev/null; then
    echo "✓ Playwright MCP is already disabled"
    exit 0
fi

# Disable playwright
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    sed -i '' 's/"disabled": false,/"disabled": true,/' "$MCP_FILE"
else
    # Linux
    sed -i 's/"disabled": false,/"disabled": true,/' "$MCP_FILE"
fi

echo "✓ Playwright MCP disabled"
echo ""
echo "Next steps:"
echo "  1. Exit current Claude Code session (Ctrl+C)"
echo "  2. Kill existing Playwright processes: pkill -f mcp-server-playwright"
echo "  3. Restart Claude Code: claude"
echo ""
echo "Browser windows will no longer spawn automatically."
