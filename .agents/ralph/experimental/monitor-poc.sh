#!/usr/bin/env bash
#
# monitor-poc.sh - Real-time monitoring for long-running Factory PoC
#
# Usage: ./monitor-poc.sh [refresh_interval_seconds]
#

set -euo pipefail

REFRESH_INTERVAL=${1:-10}
FACTORY_NAME="long-running-poc"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
MAGENTA='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

clear

while true; do
  clear
  echo "════════════════════════════════════════════════════════════════"
  echo -e "${CYAN}🔬 LONG-RUNNING FACTORY PoC - LIVE MONITOR${NC}"
  echo "════════════════════════════════════════════════════════════════"
  echo ""

  # Check if start time file exists
  if [ -f ".ralph/factory/poc-start-time.txt" ]; then
    START_TIME=$(cat .ralph/factory/poc-start-time.txt)
    CURRENT_TIME=$(date +%s)
    ELAPSED_SECONDS=$((CURRENT_TIME - START_TIME))
    ELAPSED_HOURS=$(echo "scale=2; $ELAPSED_SECONDS / 3600" | bc 2>/dev/null || echo "0")
    ELAPSED_MINS=$(echo "scale=0; $ELAPSED_SECONDS / 60" | bc 2>/dev/null || echo "0")

    echo -e "${GREEN}⏱️  Runtime Statistics${NC}"
    echo "────────────────────────────────────────────────────────────────"
    echo -e "  Start Time:    ${BLUE}$(date -r $START_TIME '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "  Current Time:  ${BLUE}$(date '+%Y-%m-%d %H:%M:%S')${NC}"
    echo -e "  Elapsed:       ${YELLOW}${ELAPSED_HOURS} hours (${ELAPSED_MINS} minutes)${NC}"
    echo -e "  Target:        ${MAGENTA}6.00 hours${NC}"
    echo -e "  Remaining:     ${CYAN}$(echo "6.0 - $ELAPSED_HOURS" | bc) hours${NC}"
    echo ""
  else
    echo -e "${YELLOW}⚠️  Factory not started yet${NC}"
    echo ""
  fi

  # Count iterations completed
  ITERATION_COUNT=0
  if [ -d ".ralph/factory/iterations" ]; then
    ITERATION_COUNT=$(ls -1 .ralph/factory/iterations/*.json 2>/dev/null | wc -l | xargs)
  fi

  echo -e "${GREEN}📊 Iteration Progress${NC}"
  echo "────────────────────────────────────────────────────────────────"
  echo -e "  Completed:     ${GREEN}${ITERATION_COUNT}${NC} / ${MAGENTA}15${NC}"

  # Progress bar
  PROGRESS=$((ITERATION_COUNT * 100 / 15))
  BAR_LENGTH=50
  FILLED=$((PROGRESS * BAR_LENGTH / 100))
  EMPTY=$((BAR_LENGTH - FILLED))
  printf "  Progress:      ["
  printf "%${FILLED}s" | tr ' ' '█'
  printf "%${EMPTY}s" | tr ' ' '░'
  printf "] ${PROGRESS}%%\n"
  echo ""

  # Show latest iteration details
  if [ $ITERATION_COUNT -gt 0 ]; then
    LATEST_ITER=$(ls -1 .ralph/factory/iterations/*.json 2>/dev/null | tail -1)
    if [ -n "$LATEST_ITER" ]; then
      echo -e "${GREEN}📝 Latest Iteration${NC}"
      echo "────────────────────────────────────────────────────────────────"

      # Parse JSON safely
      ITER_NUM=$(cat "$LATEST_ITER" | grep '"iteration"' | grep -oE '[0-9]+' | head -1)
      FEATURE=$(cat "$LATEST_ITER" | grep '"feature"' | sed 's/.*"feature": "\(.*\)".*/\1/' | head -1)
      ITER_HOURS=$(cat "$LATEST_ITER" | grep '"elapsed_hours"' | grep -oE '[0-9.]+' | head -1)

      echo -e "  Iteration:     ${CYAN}#${ITER_NUM}${NC}"
      echo -e "  Feature:       ${BLUE}${FEATURE}${NC}"
      echo -e "  Time:          ${YELLOW}${ITER_HOURS} hours${NC}"
      echo ""
    fi
  fi

  # Count PRDs
  PRD_COUNT=0
  if [ -d ".ralph" ]; then
    PRD_COUNT=$(ls -d .ralph/PRD-*/ 2>/dev/null | wc -l | xargs)
  fi

  echo -e "${GREEN}📁 Artifacts Generated${NC}"
  echo "────────────────────────────────────────────────────────────────"
  echo -e "  PRDs:          ${CYAN}${PRD_COUNT}${NC}"
  echo -e "  Plans:         ${CYAN}$(ls -1 .ralph/PRD-*/plan.md 2>/dev/null | wc -l | xargs)${NC}"
  echo -e "  Commits:       ${CYAN}$(git log --oneline --grep="PRD-" --since="24 hours ago" 2>/dev/null | wc -l | xargs)${NC}"
  echo -e "  Iterations:    ${CYAN}${ITERATION_COUNT}${NC}"
  echo ""

  # Show current stage (if factory is running)
  echo -e "${GREEN}🏭 Factory Status${NC}"
  echo "────────────────────────────────────────────────────────────────"

  if ps aux | grep -q "[r]alph factory run $FACTORY_NAME"; then
    echo -e "  Status:        ${GREEN}●${NC} RUNNING"

    # Try to get current stage from latest run
    LATEST_RUN=$(ls -dt .ralph/factory/runs/run-* 2>/dev/null | head -1)
    if [ -n "$LATEST_RUN" ] && [ -f "$LATEST_RUN/state.json" ]; then
      CURRENT_STAGE=$(cat "$LATEST_RUN/state.json" | grep '"currentStage"' | sed 's/.*"currentStage": "\(.*\)".*/\1/' | head -1)
      echo -e "  Current Stage: ${YELLOW}${CURRENT_STAGE}${NC}"
    fi
  else
    echo -e "  Status:        ${RED}●${NC} NOT RUNNING"
  fi
  echo ""

  # Show recent logs (last 5 lines)
  LATEST_RUN=$(ls -dt .ralph/factory/runs/run-* 2>/dev/null | head -1)
  if [ -n "$LATEST_RUN" ] && [ -f "$LATEST_RUN/execution.log" ]; then
    echo -e "${GREEN}📋 Recent Activity${NC}"
    echo "────────────────────────────────────────────────────────────────"
    tail -5 "$LATEST_RUN/execution.log" | sed 's/^/  /'
    echo ""
  fi

  # Footer
  echo "════════════════════════════════════════════════════════════════"
  echo -e "${CYAN}Press Ctrl+C to stop monitoring${NC}"
  echo -e "Refreshing every ${REFRESH_INTERVAL} seconds..."

  sleep $REFRESH_INTERVAL
done
