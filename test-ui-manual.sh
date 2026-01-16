#!/bin/bash
# Manual UI Testing Script for Ralph CLI
# Uses agent-browser to simulate user interactions

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🧪 Ralph UI Manual Testing Suite"
echo "================================"
echo ""

# Check if UI is running
if ! curl -s http://localhost:3000 > /dev/null; then
  echo -e "${RED}❌ UI server not running on port 3000${NC}"
  echo "Start it with: cd ui && npm run dev"
  exit 1
fi

echo -e "${GREEN}✓ UI server is running${NC}"
echo ""

# Test 1: Homepage Load
echo "📝 Test 1: Homepage Load"
echo "------------------------"
agent-browser open http://localhost:3000
if agent-browser is visible "text=READY TO LOOP?"; then
  echo -e "${GREEN}✓ Homepage loaded successfully${NC}"
else
  echo -e "${RED}❌ Homepage not loading correctly${NC}"
  exit 1
fi
echo ""

# Test 2: Navigate to Dashboard
echo "📝 Test 2: Navigate to Dashboard"
echo "---------------------------------"
agent-browser snapshot -i > /tmp/snapshot.txt
ENTER_REF=$(grep "Press Enter" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
if [ -n "$ENTER_REF" ]; then
  agent-browser click "$ENTER_REF"
  sleep 1
  agent-browser snapshot -i > /tmp/snapshot.txt
  DASHBOARD_REF=$(grep "Back to Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
  agent-browser click "$DASHBOARD_REF"
  sleep 1
  echo -e "${GREEN}✓ Navigated to dashboard${NC}"
else
  echo -e "${RED}❌ Could not find navigation elements${NC}"
  exit 1
fi
echo ""

# Test 3: Verify Dashboard Elements
echo "📝 Test 3: Verify Dashboard Elements"
echo "------------------------------------"
agent-browser snapshot -i > /tmp/dashboard.txt
if grep -q "Start Build" /tmp/dashboard.txt; then
  echo -e "${GREEN}✓ Start Build button present${NC}"
else
  echo -e "${YELLOW}⚠ Start Build button not found${NC}"
fi

if grep -q "Stream" /tmp/dashboard.txt; then
  echo -e "${GREEN}✓ Stream selector present${NC}"
else
  echo -e "${YELLOW}⚠ Stream selector not found${NC}"
fi

if grep -q "Agent" /tmp/dashboard.txt; then
  echo -e "${GREEN}✓ Agent selector present${NC}"
else
  echo -e "${YELLOW}⚠ Agent selector not found${NC}"
fi

if grep -q "Iterations" /tmp/dashboard.txt; then
  echo -e "${GREEN}✓ Iterations input present${NC}"
else
  echo -e "${YELLOW}⚠ Iterations input not found${NC}"
fi
echo ""

# Test 4: Navigate to Streams Page
echo "📝 Test 4: Navigate to Streams Page"
echo "-----------------------------------"
agent-browser snapshot -i > /tmp/snapshot.txt
STREAMS_REF=$(grep "link.*Streams" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
if [ -n "$STREAMS_REF" ]; then
  agent-browser click "$STREAMS_REF"
  sleep 2

  # Verify stream cards loaded
  STREAM_COUNT=$(agent-browser eval "document.querySelectorAll('[data-prd], .stream-card').length" 2>/dev/null || echo "0")
  if [ "$STREAM_COUNT" -gt 0 ]; then
    echo -e "${GREEN}✓ Streams page loaded ($STREAM_COUNT streams found)${NC}"
  else
    echo -e "${YELLOW}⚠ No streams found on page${NC}"
  fi
else
  echo -e "${RED}❌ Could not find Streams link${NC}"
fi
echo ""

# Test 5: Navigate to Logs Page
echo "📝 Test 5: Navigate to Logs Page"
echo "--------------------------------"
agent-browser snapshot -i > /tmp/snapshot.txt
LOGS_REF=$(grep "link.*Logs" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
if [ -n "$LOGS_REF" ]; then
  agent-browser click "$LOGS_REF"
  sleep 2

  # Check for log level selector
  if agent-browser is visible "text=All Levels" 2>/dev/null; then
    echo -e "${GREEN}✓ Logs page loaded with filters${NC}"
  else
    echo -e "${YELLOW}⚠ Logs page loaded but filters not found${NC}"
  fi
else
  echo -e "${RED}❌ Could not find Logs link${NC}"
fi
echo ""

# Test 6: Navigate to Tokens Page
echo "📝 Test 6: Navigate to Tokens Page"
echo "----------------------------------"
agent-browser snapshot -i > /tmp/snapshot.txt
TOKENS_REF=$(grep "link.*Tokens" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
if [ -n "$TOKENS_REF" ]; then
  agent-browser click "$TOKENS_REF"
  sleep 2

  PAGE_TITLE=$(agent-browser eval "document.title")
  if echo "$PAGE_TITLE" | grep -q "Tokens"; then
    echo -e "${GREEN}✓ Tokens page loaded${NC}"
  else
    echo -e "${YELLOW}⚠ Tokens page loaded but title incorrect: $PAGE_TITLE${NC}"
  fi
else
  echo -e "${RED}❌ Could not find Tokens link${NC}"
fi
echo ""

# Test 7: Check for Console Errors
echo "📝 Test 7: Check for Console Errors"
echo "-----------------------------------"
ERRORS=$(agent-browser errors)
if [ -z "$ERRORS" ]; then
  echo -e "${GREEN}✓ No console errors detected${NC}"
else
  echo -e "${RED}❌ Console errors found:${NC}"
  echo "$ERRORS"
fi
echo ""

# Test 8: Take Screenshots
echo "📝 Test 8: Take Screenshots"
echo "---------------------------"
mkdir -p /tmp/ralph-ui-screenshots

# Dashboard
agent-browser snapshot -i > /tmp/snapshot.txt
DASHBOARD_REF=$(grep "link.*Dashboard" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
agent-browser click "$DASHBOARD_REF"
sleep 1
agent-browser screenshot /tmp/ralph-ui-screenshots/dashboard.png
echo -e "${GREEN}✓ Screenshot saved: /tmp/ralph-ui-screenshots/dashboard.png${NC}"

# Streams
agent-browser snapshot -i > /tmp/snapshot.txt
STREAMS_REF=$(grep "link.*Streams" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
agent-browser click "$STREAMS_REF"
sleep 1
agent-browser screenshot /tmp/ralph-ui-screenshots/streams.png
echo -e "${GREEN}✓ Screenshot saved: /tmp/ralph-ui-screenshots/streams.png${NC}"

# Logs
agent-browser snapshot -i > /tmp/snapshot.txt
LOGS_REF=$(grep "link.*Logs" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
agent-browser click "$LOGS_REF"
sleep 1
agent-browser screenshot /tmp/ralph-ui-screenshots/logs.png
echo -e "${GREEN}✓ Screenshot saved: /tmp/ralph-ui-screenshots/logs.png${NC}"

# Tokens
agent-browser snapshot -i > /tmp/snapshot.txt
TOKENS_REF=$(grep "link.*Tokens" /tmp/snapshot.txt | grep -o '@e[0-9]*' | head -1)
agent-browser click "$TOKENS_REF"
sleep 1
agent-browser screenshot /tmp/ralph-ui-screenshots/tokens.png
echo -e "${GREEN}✓ Screenshot saved: /tmp/ralph-ui-screenshots/tokens.png${NC}"

echo ""
echo "================================"
echo -e "${GREEN}✅ All tests completed!${NC}"
echo ""
echo "Screenshots saved to: /tmp/ralph-ui-screenshots/"
echo "View them with: open /tmp/ralph-ui-screenshots/"
echo ""
