#!/usr/bin/env bash
#
# generate-feature-idea.sh - Generate progressive feature ideas for long-running PoC
#
# Usage: generate-feature-idea.sh <iteration> <complexity>
#
# Arguments:
#   iteration   - Current iteration number (1-15)
#   complexity  - Complexity level (simple|medium|complex|advanced)
#

set -euo pipefail

ITERATION=${1:-1}
COMPLEXITY=${2:-simple}

# Feature pools organized by complexity
declare -A SIMPLE_FEATURES=(
  [1]="Add a footer component to the wedding planner app with copyright info and social links"
  [2]="Update color scheme for better accessibility with WCAG 2.1 AA compliance"
  [3]="Add loading spinner component for async operations"
)

declare -A MEDIUM_FEATURES=(
  [4]="Create a budget calculator component with expense categories and totals"
  [5]="Add guest RSVP tracking with attendance statistics dashboard"
  [6]="Implement vendor contact management with categorization (photographer, caterer, florist)"
  [7]="Create timeline/schedule builder for wedding day events"
)

declare -A COMPLEX_FEATURES=(
  [8]="Build seating chart planner with drag-drop table assignments"
  [9]="Implement email notification system for guest reminders and updates"
  [10]="Create gift registry integration with Amazon/Target APIs"
  [11]="Add real-time collaboration for multi-user wedding planning"
  [12]="Implement calendar integration with Google Calendar/iCal for event sync"
)

declare -A ADVANCED_FEATURES=(
  [13]="Build analytics dashboard showing planning progress and task completion metrics"
  [14]="Implement mobile-responsive PWA with offline support and push notifications"
  [15]="Add AI-powered vendor recommendations based on budget and preferences"
)

# Select feature based on iteration
case $COMPLEXITY in
  simple)
    # Iterations 1-3
    IDX=$((ITERATION % 3))
    [ $IDX -eq 0 ] && IDX=3
    echo "${SIMPLE_FEATURES[$IDX]}"
    ;;

  medium)
    # Iterations 4-7
    IDX=$(((ITERATION - 3) % 4 + 4))
    echo "${MEDIUM_FEATURES[$IDX]}"
    ;;

  complex)
    # Iterations 8-12
    IDX=$(((ITERATION - 7) % 5 + 8))
    echo "${COMPLEX_FEATURES[$IDX]}"
    ;;

  advanced)
    # Iterations 13-15
    IDX=$(((ITERATION - 12) % 3 + 13))
    echo "${ADVANCED_FEATURES[$IDX]}"
    ;;

  *)
    echo "Add general UI improvements and code quality enhancements"
    ;;
esac
