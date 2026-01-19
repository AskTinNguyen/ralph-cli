#!/usr/bin/env bash
#
# start-poc.sh - Launch the long-running Factory PoC with proper setup
#
# Usage: ./start-poc.sh [--dry-run|--short-test]
#

set -euo pipefail

MODE="full"
DRY_RUN=false

# Parse arguments
for arg in "$@"; do
  case $arg in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --short-test)
      MODE="short"
      shift
      ;;
    --help)
      echo "Usage: $0 [--dry-run|--short-test]"
      echo ""
      echo "Options:"
      echo "  --dry-run      Validate setup without running"
      echo "  --short-test   Run short test (30 min, 3 iterations)"
      echo "  --help         Show this help message"
      exit 0
      ;;
  esac
done

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

echo "════════════════════════════════════════════════════════════════"
echo -e "${CYAN}🚀 LONG-RUNNING FACTORY PoC - SETUP${NC}"
echo "════════════════════════════════════════════════════════════════"
echo ""

# Step 1: Check prerequisites
echo -e "${BLUE}[1/5]${NC} Checking prerequisites..."

# Check Ralph CLI
if ! command -v ralph &> /dev/null; then
  echo -e "${RED}✗ Ralph CLI not found${NC}"
  echo "  Install: npm install -g ralph-cli"
  exit 1
fi
echo -e "${GREEN}  ✓ Ralph CLI installed${NC}"

# Check factory file
if [ ! -f ".ralph/factory/long-running-poc.yaml" ]; then
  echo -e "${RED}✗ Factory configuration not found${NC}"
  echo "  Expected: .ralph/factory/long-running-poc.yaml"
  exit 1
fi
echo -e "${GREEN}  ✓ Factory configuration exists${NC}"

# Check feature generator script
if [ ! -x ".agents/ralph/generate-feature-idea.sh" ]; then
  echo -e "${RED}✗ Feature generator script not found or not executable${NC}"
  echo "  Expected: .agents/ralph/generate-feature-idea.sh"
  exit 1
fi
echo -e "${GREEN}  ✓ Feature generator script ready${NC}"

# Check test project (wedding-planner-app)
if [ ! -d "wedding-planner-app" ]; then
  echo -e "${YELLOW}⚠️  Wedding planner app not found${NC}"
  echo "  The PoC will target the main project directory"
else
  echo -e "${GREEN}  ✓ Wedding planner app exists${NC}"
fi

echo ""

# Step 2: Git status check
echo -e "${BLUE}[2/5]${NC} Checking git repository..."

if ! git rev-parse --is-inside-work-tree &> /dev/null; then
  echo -e "${RED}✗ Not a git repository${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Git repository detected${NC}"

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  echo -e "${YELLOW}⚠️  You have uncommitted changes${NC}"
  echo -e "${YELLOW}  The PoC will create many commits. Consider committing or stashing first.${NC}"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo ""

# Step 3: Configuration summary
echo -e "${BLUE}[3/5]${NC} Configuration summary..."

if [ "$MODE" = "short" ]; then
  echo -e "${YELLOW}  Mode: SHORT TEST${NC}"
  echo "  - Runtime: 30 minutes"
  echo "  - Max iterations: 3"
  echo "  - Build iterations: 5"

  # Modify factory config for short test
  cat > .ralph/factory/long-running-poc-test.yaml <<EOF
version: "1"
name: "long-running-poc-test"
description: "SHORT TEST: 30-minute validation run"

variables:
  max_runtime_hours: 0.5
  max_iterations: 3
  build_iterations_per_prd: 5

# (Include all stages from main config...)
EOF

  FACTORY_NAME="long-running-poc-test"
else
  echo -e "${GREEN}  Mode: FULL PoC${NC}"
  echo "  - Runtime: 6 hours"
  echo "  - Max iterations: 15"
  echo "  - Build iterations: 8"

  FACTORY_NAME="long-running-poc"
fi

echo ""

# Step 4: Clean up old runs (optional)
echo -e "${BLUE}[4/5]${NC} Checking for previous runs..."

if [ -d ".ralph/factory/runs" ]; then
  RUN_COUNT=$(ls -d .ralph/factory/runs/run-* 2>/dev/null | wc -l | xargs)
  if [ "$RUN_COUNT" -gt 0 ]; then
    echo -e "${YELLOW}  Found $RUN_COUNT previous run(s)${NC}"
    echo ""
    read -p "Clean up previous runs? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      rm -rf .ralph/factory/runs/*
      rm -f .ralph/factory/poc-start-time.txt
      rm -rf .ralph/factory/iterations
      echo -e "${GREEN}  ✓ Cleaned up previous runs${NC}"
    fi
  fi
fi

echo ""

# Step 5: Final confirmation
echo -e "${BLUE}[5/5]${NC} Ready to launch!"

if [ "$DRY_RUN" = true ]; then
  echo -e "${GREEN}✓ Dry-run complete - setup validated${NC}"
  echo ""
  echo "To start the PoC:"
  echo "  ralph factory run $FACTORY_NAME"
  exit 0
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo -e "${CYAN}PoC will run autonomously for:${NC}"
if [ "$MODE" = "short" ]; then
  echo -e "  ${YELLOW}30 minutes (test mode)${NC}"
else
  echo -e "  ${GREEN}6 hours (full PoC)${NC}"
fi
echo ""
echo "During execution, you can:"
echo "  - Monitor progress: .agents/ralph/monitor-poc.sh"
echo "  - Check status: ralph factory status $FACTORY_NAME"
echo "  - Stop gracefully: ralph factory stop $FACTORY_NAME"
echo "  - Resume: ralph factory resume $FACTORY_NAME"
echo "════════════════════════════════════════════════════════════════"
echo ""

read -p "Start the PoC now? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
  echo "Aborted. Run manually with:"
  echo "  ralph factory run $FACTORY_NAME"
  exit 0
fi

echo ""
echo -e "${GREEN}🚀 Launching Factory PoC...${NC}"
echo ""

# Launch in background with output logging
LOG_FILE="poc-output-$(date +%Y%m%d-%H%M%S).log"

nohup ralph factory run $FACTORY_NAME > "$LOG_FILE" 2>&1 &
PID=$!

echo -e "${GREEN}✓ PoC started in background${NC}"
echo ""
echo "Process ID: $PID"
echo "Log file: $LOG_FILE"
echo ""
echo "Monitor with:"
echo "  .agents/ralph/monitor-poc.sh"
echo ""
echo "Or tail logs:"
echo "  tail -f $LOG_FILE"
echo ""
echo -e "${CYAN}Good luck! 🎉${NC}"
