#!/bin/bash
# Clean up existing Playwright MCP processes and browser windows
#
# Usage: .agents/ralph/cleanup-playwright.sh

echo "Cleaning up Playwright MCP processes..."

# Count current processes (macOS compatible)
PLAYWRIGHT_COUNT=$(ps aux | grep -c "mcp-server-playwright" | grep -v grep || echo "0")
CHROME_COUNT=$(ps aux | grep -c "mcp-chrome" | grep -v grep || echo "0")

if [[ "$PLAYWRIGHT_COUNT" -eq 0 ]]; then
    echo "✓ No Playwright MCP processes running"
else
    echo "Found $PLAYWRIGHT_COUNT Playwright MCP process(es)"
    pkill -f "mcp-server-playwright"
    sleep 1
    echo "✓ Killed Playwright MCP processes"
fi

if [[ "$CHROME_COUNT" -gt 0 ]]; then
    echo "Found $CHROME_COUNT Chrome MCP process(es)"
    echo "  (These will close automatically when MCP processes exit)"
fi

echo ""
echo "✓ Cleanup complete"
echo ""
echo "Next steps:"
echo "  1. Verify browser windows closed"
echo "  2. Check remaining processes: ps aux | grep playwright"
echo "  3. Restart Claude Code sessions if needed"
