#!/bin/bash
# UI Testing Helper Script using agent-browser
# Usage: ./test-ui.sh [command] [args]

set -euo pipefail

UI_URL="${UI_URL:-http://localhost:3000}"
SESSION="${AGENT_BROWSER_SESSION:-ralph-ui-test}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

# Check if agent-browser is installed
if ! command -v agent-browser &> /dev/null; then
  log_error "agent-browser is not installed"
  echo "Install with: npm install -g agent-browser && agent-browser install"
  exit 1
fi

# Check if UI server is running
check_server() {
  if ! curl -s "$UI_URL" > /dev/null 2>&1; then
    log_warn "UI server not running at $UI_URL"
    log_info "Start with: cd ui && npm run dev"
    return 1
  fi
  log_info "UI server is running at $UI_URL"
  return 0
}

# Navigate to URL and take snapshot
snapshot() {
  check_server || exit 1
  log_info "Opening $UI_URL and taking snapshot..."
  agent-browser --session "$SESSION" open "$UI_URL"
  agent-browser --session "$SESSION" snapshot -i
}

# Test PRD list page
test_prd_list() {
  check_server || exit 1
  log_info "Testing PRD list page..."

  agent-browser --session "$SESSION" open "$UI_URL"
  sleep 2

  # Take snapshot
  agent-browser --session "$SESSION" snapshot -i > /tmp/prd-list-snapshot.txt

  # Check for key elements
  if grep -q "PRD" /tmp/prd-list-snapshot.txt; then
    log_info "✓ PRD list loaded"
  else
    log_error "✗ PRD list not found"
  fi

  # Check for errors
  if agent-browser --session "$SESSION" errors | grep -q "Error"; then
    log_error "✗ Console errors detected"
    agent-browser --session "$SESSION" errors
  else
    log_info "✓ No console errors"
  fi

  # Take screenshot
  agent-browser --session "$SESSION" screenshot --full ui-prd-list.png
  log_info "Screenshot saved to ui-prd-list.png"
}

# Test logs page
test_logs() {
  check_server || exit 1
  log_info "Testing logs page..."

  agent-browser --session "$SESSION" open "$UI_URL/logs"
  sleep 2

  agent-browser --session "$SESSION" snapshot -i > /tmp/logs-snapshot.txt

  # Take screenshot
  agent-browser --session "$SESSION" screenshot --full ui-logs.png
  log_info "Screenshot saved to ui-logs.png"

  # Check for errors
  if agent-browser --session "$SESSION" errors | grep -q "Error"; then
    log_warn "Console errors detected on logs page"
    agent-browser --session "$SESSION" errors
  else
    log_info "✓ No console errors on logs page"
  fi
}

# Interactive test mode
interactive() {
  check_server || exit 1
  log_info "Starting interactive session at $UI_URL"
  log_info "Session: $SESSION"
  log_info "Opening browser in headed mode..."

  agent-browser --session "$SESSION" --headed open "$UI_URL"

  echo
  log_info "Browser session started. You can now use agent-browser commands:"
  echo "  agent-browser --session $SESSION snapshot -i"
  echo "  agent-browser --session $SESSION click @e1"
  echo "  agent-browser --session $SESSION screenshot"
  echo "  agent-browser --session $SESSION console"
  echo "  agent-browser --session $SESSION errors"
  echo
  log_info "Session will persist until you close the browser or run:"
  echo "  agent-browser --session $SESSION close"
}

# Clean up session
cleanup() {
  log_info "Cleaning up session: $SESSION"
  agent-browser --session "$SESSION" close 2>/dev/null || true
  log_info "Session closed"
}

# Show help
show_help() {
  cat <<EOF
UI Testing Helper Script using agent-browser

Usage: $0 [command]

Commands:
  snapshot          Take snapshot of homepage
  test-list         Test PRD list page
  test-logs         Test logs page
  interactive       Start headed browser for manual testing
  cleanup           Close browser session
  help              Show this help

Environment Variables:
  UI_URL                    UI server URL (default: http://localhost:3000)
  AGENT_BROWSER_SESSION     Session name (default: ralph-ui-test)

Examples:
  $0 snapshot
  $0 test-list
  UI_URL=http://localhost:8080 $0 interactive
EOF
}

# Main command handler
case "${1:-help}" in
  snapshot)
    snapshot
    ;;
  test-list|test-prd-list)
    test_prd_list
    ;;
  test-logs)
    test_logs
    ;;
  interactive)
    interactive
    ;;
  cleanup|close)
    cleanup
    ;;
  help|--help|-h)
    show_help
    ;;
  *)
    log_error "Unknown command: $1"
    show_help
    exit 1
    ;;
esac
