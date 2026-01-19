#!/usr/bin/env bash
#
# test-poc-setup.sh - Validate long-running PoC setup
#
# Tests all components without running the full 6-hour PoC
#

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

ERRORS=0

echo "════════════════════════════════════════════════════════════════"
echo -e "${BLUE}🧪 LONG-RUNNING POC - SETUP VALIDATION${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Test 1: Feature Idea Generator
echo -e "${BLUE}[Test 1/5]${NC} Testing feature idea generator..."

for i in {1..3}; do
  RESULT=$(.agents/ralph/generate-feature-idea.sh $i simple)
  if [ -z "$RESULT" ]; then
    echo -e "${RED}  ✗ Failed to generate feature idea for iteration $i${NC}"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "${GREEN}  ✓ Iteration $i: ${RESULT:0:50}...${NC}"
  fi
done

echo ""

# Test 2: YAML Syntax Validation
echo -e "${BLUE}[Test 2/5]${NC} Validating factory YAML syntax..."

if ! command -v yq &> /dev/null; then
  echo -e "${YELLOW}  ⚠️  yq not installed, skipping YAML validation${NC}"
  echo "  Install: brew install yq (macOS) or apt-get install yq (Linux)"
else
  if yq eval . .ralph/factory/long-running-poc.yaml > /dev/null 2>&1; then
    echo -e "${GREEN}  ✓ YAML syntax valid${NC}"
  else
    echo -e "${RED}  ✗ YAML syntax invalid${NC}"
    ERRORS=$((ERRORS + 1))
  fi
fi

echo ""

# Test 3: Required Files Exist
echo -e "${BLUE}[Test 3/5]${NC} Checking required files..."

REQUIRED_FILES=(
  ".ralph/factory/long-running-poc.yaml"
  ".agents/ralph/generate-feature-idea.sh"
  ".agents/ralph/start-poc.sh"
  ".agents/ralph/monitor-poc.sh"
  ".ralph/factory/LONG_RUNNING_POC.md"
  ".ralph/factory/POC_QUICKSTART.md"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    echo -e "${GREEN}  ✓ $file${NC}"
  else
    echo -e "${RED}  ✗ Missing: $file${NC}"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# Test 4: Script Executability
echo -e "${BLUE}[Test 4/5]${NC} Checking script permissions..."

SCRIPTS=(
  ".agents/ralph/generate-feature-idea.sh"
  ".agents/ralph/start-poc.sh"
  ".agents/ralph/monitor-poc.sh"
)

for script in "${SCRIPTS[@]}"; do
  if [ -x "$script" ]; then
    echo -e "${GREEN}  ✓ $script (executable)${NC}"
  else
    echo -e "${RED}  ✗ $script (not executable)${NC}"
    echo "  Fix: chmod +x $script"
    ERRORS=$((ERRORS + 1))
  fi
done

echo ""

# Test 5: Factory Command Availability
echo -e "${BLUE}[Test 5/5]${NC} Checking Ralph factory commands..."

if command -v ralph &> /dev/null; then
  echo -e "${GREEN}  ✓ Ralph CLI available${NC}"

  # Test factory list command
  if ralph factory list &> /dev/null; then
    echo -e "${GREEN}  ✓ Factory commands working${NC}"
  else
    echo -e "${YELLOW}  ⚠️  Factory commands may not be fully implemented${NC}"
  fi
else
  echo -e "${RED}  ✗ Ralph CLI not found${NC}"
  echo "  Install: npm install -g ralph-cli"
  ERRORS=$((ERRORS + 1))
fi

echo ""

# Summary
echo "════════════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
  echo -e "${GREEN}✅ All validation tests passed!${NC}"
  echo ""
  echo "Setup is ready. You can now:"
  echo "  1. Run short test: .agents/ralph/start-poc.sh --short-test"
  echo "  2. Run full PoC: .agents/ralph/start-poc.sh"
  echo ""
else
  echo -e "${RED}❌ Found $ERRORS error(s)${NC}"
  echo ""
  echo "Fix the errors above before running the PoC."
  exit 1
fi
echo "════════════════════════════════════════════════════════════════"
