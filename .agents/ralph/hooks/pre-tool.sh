#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# PreToolUse Hook - Validate before tool execution
# ─────────────────────────────────────────────────────────────────────────────
# CRITICAL: This hook must ALWAYS exit 0 to avoid breaking Claude Code.
# Even on errors, we output a valid JSON response and exit 0.
#
# Receives: JSON via stdin with tool_name, tool_input
# Outputs:  {"decision": "allow"} or {"decision": "block", "message": "..."}
#
# Enforcement:
#   - Edit: Requires prior Read of the file
#   - Bash: Blocks git push/merge commands
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Error trap: always output allow and exit 0
trap 'echo "{\"decision\":\"allow\"}"; exit 0' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
SESSION_LOG="$RALPH_DIR/session.log"

# ─────────────────────────────────────────────────────────────────────────────
# Read hook data from stdin (non-interactive context)
# ─────────────────────────────────────────────────────────────────────────────
hook_data=""
if [[ ! -t 0 ]]; then
  hook_data=$(cat)
fi

# Empty input: allow by default
if [[ -z "$hook_data" ]]; then
  echo '{"decision":"allow"}'
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Validate JSON before parsing (security: prevent injection)
# ─────────────────────────────────────────────────────────────────────────────
if ! echo "$hook_data" | jq -e . >/dev/null 2>&1; then
  echo '{"decision":"allow","message":"Invalid JSON input"}'
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Extract fields
# ─────────────────────────────────────────────────────────────────────────────
tool_name=$(echo "$hook_data" | jq -r '.tool_name // empty')
tool_input=$(echo "$hook_data" | jq -r '.tool_input // empty')

# No tool name: allow
if [[ -z "$tool_name" ]]; then
  echo '{"decision":"allow"}'
  exit 0
fi

# ─────────────────────────────────────────────────────────────────────────────
# Tool-specific enforcement
# ─────────────────────────────────────────────────────────────────────────────
case "$tool_name" in

  Edit|Write)
    # Enforce: Must Read file before Edit/Write
    file_path=$(echo "$tool_input" | jq -r '.file_path // empty')

    if [[ -n "$file_path" ]] && [[ -f "$SESSION_LOG" ]]; then
      # Use fixed-string grep for security (no regex interpretation)
      if ! grep -qF "Read: $file_path" "$SESSION_LOG" 2>/dev/null; then
        echo "{\"decision\":\"block\",\"message\":\"Must Read file before ${tool_name}: $file_path\"}"
        exit 0
      fi
    fi
    ;;

  Bash)
    # Enforce: Block dangerous git operations
    command=$(echo "$tool_input" | jq -r '.command // empty')

    if [[ -n "$command" ]]; then
      # Block git push (including all variants)
      if [[ "$command" =~ (^|[[:space:]]|&&|\|)git[[:space:]]+push([[:space:]]|$|[[:space:]]+) ]]; then
        echo '{"decision":"block","message":"git push blocked during build. Complete build first, then manually push."}'
        exit 0
      fi

      # Block git merge to main/master
      if [[ "$command" =~ (^|[[:space:]]|&&|\|)git[[:space:]]+merge[[:space:]]+.*(main|master) ]]; then
        echo '{"decision":"block","message":"git merge to main/master blocked. Use ralph stream merge instead."}'
        exit 0
      fi

      # Block ralph stream merge (automated merge)
      if [[ "$command" =~ ralph[[:space:]]+stream[[:space:]]+merge ]]; then
        echo '{"decision":"block","message":"ralph stream merge blocked during build. Human must trigger merge manually."}'
        exit 0
      fi

      # Block force flags on git
      if [[ "$command" =~ git[[:space:]]+.*--force ]]; then
        echo '{"decision":"block","message":"git --force operations blocked for safety."}'
        exit 0
      fi
    fi
    ;;

  Read)
    # Log reads for Edit validation
    file_path=$(echo "$tool_input" | jq -r '.file_path // empty')
    if [[ -n "$file_path" ]]; then
      mkdir -p "$(dirname "$SESSION_LOG")" 2>/dev/null || true
      echo "Read: $file_path" >> "$SESSION_LOG" 2>/dev/null || true
    fi
    ;;

esac

# Default: allow
echo '{"decision":"allow"}'
exit 0
