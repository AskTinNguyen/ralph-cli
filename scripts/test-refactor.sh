#!/bin/bash
# Test script to verify refactored CLI commands work correctly

echo "🧪 Testing refactored Ralph CLI commands..."
echo ""

# Color helpers
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

passed=0
failed=0

test_command() {
  local name="$1"
  local cmd="$2"

  echo -n "Testing: $name... "
  if eval "$cmd" > /dev/null 2>&1; then
    echo -e "${GREEN}✓${NC}"
    ((passed++))
    return 0
  else
    echo -e "${RED}✗${NC}"
    ((failed++))
    return 1
  fi
}

# Test help commands
test_command "ralph help" "node bin/ralph help"
test_command "ralph --help" "node bin/ralph --help"

# Test getting started commands
test_command "ralph doctor --help" "node bin/ralph doctor --help"
test_command "ralph ping --help" "node bin/ralph ping --help"
test_command "ralph init --help" "node bin/ralph init --help"
test_command "ralph install --help" "node bin/ralph install --help"

# Test core workflow commands
test_command "ralph eval --help" "node bin/ralph eval --help"
test_command "ralph estimate --help" "node bin/ralph estimate --help"
test_command "ralph improve --help" "node bin/ralph improve --help"

# Test analytics commands
test_command "ralph stats" "node bin/ralph stats"
test_command "ralph routing --help" "node bin/ralph routing --help"

# Test diagnostics commands
test_command "ralph diagnose" "node bin/ralph diagnose"
test_command "ralph experiment --help" "node bin/ralph experiment --help"

# Test utilities
test_command "ralph checkpoint list" "node bin/ralph checkpoint list"
test_command "ralph completions bash" "node bin/ralph completions bash"
test_command "ralph ui --help" "node bin/ralph ui --help"
test_command "ralph log --help" "node bin/ralph log --help"

# Test project management commands
test_command "ralph registry list" "node bin/ralph registry list"
test_command "ralph search --help" "node bin/ralph search --help"
test_command "ralph import --help" "node bin/ralph import --help"

# Test advanced commands
test_command "ralph optimize --help" "node bin/ralph optimize --help"
test_command "ralph watch --help" "node bin/ralph watch --help"

echo ""
echo "=========================================="
echo "Results: ${GREEN}${passed} passed${NC}, ${RED}${failed} failed${NC}"
echo "=========================================="

if [ $failed -eq 0 ]; then
  echo -e "${GREEN}✓ All tests passed!${NC}"
  exit 0
else
  echo -e "${RED}✗ Some tests failed${NC}"
  exit 1
fi
