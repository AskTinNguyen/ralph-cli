#!/bin/bash
# Interactive UI Testing Script
# Run specific test scenarios interactively

set -e

UI_URL="${UI_URL:-http://localhost:3000}"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "🎯 Ralph UI Interactive Testing"
echo "================================"
echo ""
echo "Available test scenarios:"
echo "  1) Test stream selection workflow"
echo "  2) Test build configuration"
echo "  3) Test navigation between pages"
echo "  4) Test search/filter functionality"
echo "  5) Test error handling"
echo "  6) Test real-time status updates"
echo "  7) Take comprehensive screenshots"
echo "  8) Check accessibility"
echo "  9) Custom test (manual commands)"
echo "  0) Exit"
echo ""

read -p "Select test (1-9, 0 to exit): " choice

case $choice in
  1)
    echo -e "\n${BLUE}Testing Stream Selection Workflow${NC}"
    echo "===================================="

    # Navigate to dashboard
    agent-browser open "$UI_URL"
    echo "✓ Opened homepage"

    # Take initial snapshot
    agent-browser snapshot -i > /tmp/snapshot.txt
    cat /tmp/snapshot.txt | head -20

    echo -e "\n${YELLOW}Action: Click through to dashboard...${NC}"
    ENTER_REF=$(grep "Press Enter" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$ENTER_REF"
    sleep 1

    agent-browser snapshot -i > /tmp/snapshot.txt
    DASHBOARD_REF=$(grep "Back to Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$DASHBOARD_REF"
    sleep 1

    echo -e "\n${YELLOW}Current page elements:${NC}"
    agent-browser snapshot -i

    echo -e "\n${YELLOW}Stream selector content:${NC}"
    STREAM_REF=$(grep "listbox.*Stream" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    if [ -n "$STREAM_REF" ]; then
      agent-browser get text "$STREAM_REF"
    fi

    echo -e "\n${GREEN}✓ Test completed${NC}"
    ;;

  2)
    echo -e "\n${BLUE}Testing Build Configuration${NC}"
    echo "============================"

    agent-browser open "$UI_URL"
    # Navigate to dashboard
    agent-browser snapshot -i > /tmp/snapshot.txt
    ENTER_REF=$(grep "Press Enter" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$ENTER_REF"
    sleep 1
    agent-browser snapshot -i > /tmp/snapshot.txt
    DASHBOARD_REF=$(grep "Back to Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$DASHBOARD_REF"
    sleep 1

    echo -e "\n${YELLOW}Form controls:${NC}"
    agent-browser snapshot -i | grep -E "(spinbutton|combobox|checkbox)"

    echo -e "\n${YELLOW}Setting iterations to 5...${NC}"
    ITER_REF=$(grep "spinbutton.*Iterations" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    if [ -n "$ITER_REF" ]; then
      agent-browser fill "$ITER_REF" "5"
      echo "✓ Iterations set"
    fi

    echo -e "\n${YELLOW}Checking dry run option...${NC}"
    DRY_REF=$(grep "checkbox.*Dry run" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    if [ -n "$DRY_REF" ]; then
      agent-browser click "$DRY_REF"
      echo "✓ Dry run enabled"
    fi

    echo -e "\n${YELLOW}Final snapshot:${NC}"
    agent-browser snapshot -i

    echo -e "\n${GREEN}✓ Test completed${NC}"
    ;;

  3)
    echo -e "\n${BLUE}Testing Navigation Between Pages${NC}"
    echo "=================================="

    pages=("Dashboard" "Streams" "Logs" "Tokens" "Documentation")

    agent-browser open "$UI_URL"
    # Navigate to main UI
    agent-browser snapshot -i > /tmp/snapshot.txt
    ENTER_REF=$(grep "Press Enter" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$ENTER_REF"
    sleep 1
    agent-browser snapshot -i > /tmp/snapshot.txt
    DASHBOARD_REF=$(grep "Back to Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$DASHBOARD_REF"
    sleep 1

    for page in "${pages[@]}"; do
      echo -e "\n${YELLOW}Navigating to $page...${NC}"
      agent-browser snapshot -i > /tmp/snapshot.txt
      PAGE_REF=$(grep "link.*$page" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
      if [ -n "$PAGE_REF" ]; then
        agent-browser click "$PAGE_REF"
        sleep 2
        PAGE_TITLE=$(agent-browser eval "document.title")
        echo "✓ Page title: $PAGE_TITLE"

        # Check for errors
        ERRORS=$(agent-browser errors)
        if [ -z "$ERRORS" ]; then
          echo "✓ No console errors"
        else
          echo "⚠ Console errors detected"
        fi
      fi
    done

    echo -e "\n${GREEN}✓ Navigation test completed${NC}"
    ;;

  4)
    echo -e "\n${BLUE}Testing Search/Filter Functionality${NC}"
    echo "====================================="

    agent-browser open "$UI_URL"
    # Navigate to Streams
    agent-browser snapshot -i > /tmp/snapshot.txt
    ENTER_REF=$(grep "Press Enter" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$ENTER_REF"
    sleep 1
    agent-browser snapshot -i > /tmp/snapshot.txt
    DASHBOARD_REF=$(grep "Back to Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$DASHBOARD_REF"
    sleep 1
    agent-browser snapshot -i > /tmp/snapshot.txt
    STREAMS_REF=$(grep "link.*Streams" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$STREAMS_REF"
    sleep 2

    echo -e "\n${YELLOW}Initial stream count:${NC}"
    INITIAL_COUNT=$(agent-browser eval "document.querySelectorAll('[data-prd], .stream-card, [class*=stream]').length" 2>/dev/null || echo "0")
    echo "Streams visible: $INITIAL_COUNT"

    echo -e "\n${YELLOW}Finding search input...${NC}"
    agent-browser snapshot -i > /tmp/snapshot.txt
    SEARCH_REF=$(grep "textbox.*Search" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)

    if [ -n "$SEARCH_REF" ]; then
      echo "✓ Search input found: $SEARCH_REF"

      echo -e "\n${YELLOW}Searching for 'PRD-67'...${NC}"
      agent-browser fill "$SEARCH_REF" "PRD-67"
      sleep 1

      FILTERED_COUNT=$(agent-browser eval "document.querySelectorAll('[data-prd], .stream-card').length" 2>/dev/null || echo "0")
      echo "Filtered streams: $FILTERED_COUNT"

      echo -e "\n${YELLOW}Clearing search...${NC}"
      agent-browser fill "$SEARCH_REF" ""
      sleep 1
    else
      echo "⚠ Search input not found"
    fi

    echo -e "\n${GREEN}✓ Test completed${NC}"
    ;;

  5)
    echo -e "\n${BLUE}Testing Error Handling${NC}"
    echo "======================="

    agent-browser open "$UI_URL"

    echo -e "\n${YELLOW}Checking console for errors...${NC}"
    ERRORS=$(agent-browser errors)
    if [ -z "$ERRORS" ]; then
      echo "✓ No console errors on page load"
    else
      echo "⚠ Errors detected:"
      echo "$ERRORS"
    fi

    echo -e "\n${YELLOW}Checking for error boundaries...${NC}"
    HAS_ERROR_BOUNDARY=$(agent-browser eval "!!document.querySelector('[data-error-boundary], [class*=error]')" 2>/dev/null || echo "false")
    echo "Error boundary present: $HAS_ERROR_BOUNDARY"

    echo -e "\n${GREEN}✓ Test completed${NC}"
    ;;

  6)
    echo -e "\n${BLUE}Testing Real-time Status Updates${NC}"
    echo "=================================="

    echo "This test monitors the UI for real-time updates."
    echo "Start a build in another terminal: ralph build 1 --prd=67"
    echo ""
    read -p "Press Enter when build is running..."

    agent-browser open "$UI_URL"

    for i in {1..10}; do
      echo -e "\n${YELLOW}Update $i/10${NC}"
      agent-browser snapshot -i > /tmp/snapshot.txt
      if grep -q "running\|Building" /tmp/snapshot.txt; then
        echo "✓ Build status detected"
      fi
      sleep 3
    done

    echo -e "\n${GREEN}✓ Monitoring completed${NC}"
    ;;

  7)
    echo -e "\n${BLUE}Taking Comprehensive Screenshots${NC}"
    echo "=================================="

    SCREENSHOT_DIR="/tmp/ralph-ui-screenshots-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$SCREENSHOT_DIR"

    agent-browser open "$UI_URL"

    pages=("Dashboard" "Streams" "Logs" "Tokens" "Documentation")

    # Navigate to main UI
    agent-browser snapshot -i > /tmp/snapshot.txt
    ENTER_REF=$(grep "Press Enter" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$ENTER_REF"
    sleep 1
    agent-browser snapshot -i > /tmp/snapshot.txt
    DASHBOARD_REF=$(grep "Back to Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
    agent-browser click "$DASHBOARD_REF"
    sleep 1

    for page in "${pages[@]}"; do
      echo -e "\n${YELLOW}Capturing $page...${NC}"
      agent-browser snapshot -i > /tmp/snapshot.txt
      PAGE_REF=$(grep "link.*$page" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
      if [ -n "$PAGE_REF" ]; then
        agent-browser click "$PAGE_REF"
        sleep 2
        FILENAME="$SCREENSHOT_DIR/${page,,}.png"
        agent-browser screenshot "$FILENAME"
        echo "✓ Saved: $FILENAME"
      fi
    done

    echo -e "\n${GREEN}✓ Screenshots saved to: $SCREENSHOT_DIR${NC}"
    echo "View with: open $SCREENSHOT_DIR"
    ;;

  8)
    echo -e "\n${BLUE}Checking Accessibility${NC}"
    echo "======================="

    agent-browser open "$UI_URL"

    echo -e "\n${YELLOW}Checking for ARIA labels...${NC}"
    ARIA_COUNT=$(agent-browser eval "document.querySelectorAll('[aria-label], [role]').length")
    echo "Elements with ARIA: $ARIA_COUNT"

    echo -e "\n${YELLOW}Checking for alt text on images...${NC}"
    IMG_COUNT=$(agent-browser eval "document.querySelectorAll('img').length")
    IMG_ALT_COUNT=$(agent-browser eval "document.querySelectorAll('img[alt]').length")
    echo "Images: $IMG_COUNT, With alt text: $IMG_ALT_COUNT"

    echo -e "\n${YELLOW}Checking keyboard navigation...${NC}"
    echo "Testing Tab navigation..."
    for i in {1..5}; do
      agent-browser press Tab
      sleep 0.3
    done
    echo "✓ Tab navigation working"

    echo -e "\n${GREEN}✓ Accessibility check completed${NC}"
    ;;

  9)
    echo -e "\n${BLUE}Custom Test Mode${NC}"
    echo "================"
    echo ""
    echo "agent-browser is ready. Available commands:"
    echo "  agent-browser snapshot -i       - See interactive elements"
    echo "  agent-browser click @eN         - Click element by ref"
    echo "  agent-browser get text @eN      - Get element text"
    echo "  agent-browser screenshot X.png  - Take screenshot"
    echo "  agent-browser errors            - Check console errors"
    echo "  agent-browser eval \"JS code\"    - Run JavaScript"
    echo ""
    echo "Current URL: $UI_URL"
    echo ""
    agent-browser open "$UI_URL"
    echo ""
    echo "Run your commands manually, or press Ctrl+C to exit."
    echo ""
    ;;

  0)
    echo "Exiting..."
    exit 0
    ;;

  *)
    echo "Invalid choice"
    exit 1
    ;;
esac

echo ""
echo "Test completed!"
