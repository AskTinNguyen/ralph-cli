#!/bin/bash
# DEPRECATED: This standalone script is maintained for backward compatibility only.
# The inline log_activity() function in loop.sh is the primary logging mechanism.
# This script may be removed in a future version.
#
# Prefer using the inline function which:
# - Uses ACTIVITY_LOG_PATH from context (supports PRD-specific logs)
# - Doesn't require a subprocess for each log entry
# - Is faster and more consistent
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
ACTIVITY_LOG="$ROOT_DIR/.ralph/activity.log"

if [ $# -lt 1 ]; then
  echo "Usage: $0 \"message\""
  exit 1
fi

mkdir -p "$(dirname "$ACTIVITY_LOG")"
TS=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TS] $*" >> "$ACTIVITY_LOG"
