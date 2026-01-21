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
      # ─────────────────────────────────────────────────────────────────────────
      # Normalize command for enhanced analysis
      # Remove newlines, normalize separators for comprehensive pattern matching
      # ─────────────────────────────────────────────────────────────────────────
      normalized=$(echo "$command" | tr '\n' ' ' | sed 's/;/ /g; s/&&/ /g; s/||/ /g; s/|/ /g')

      # ─────────────────────────────────────────────────────────────────────────
      # Check 1: Basic git push pattern (original check)
      # ─────────────────────────────────────────────────────────────────────────
      if [[ "$command" =~ (^|[[:space:]]|&&|\|)git[[:space:]]+push([[:space:]]|$|[[:space:]]+) ]]; then
        echo '{"decision":"block","message":"git push blocked during build. Complete build first, then manually push."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 2: git and push appearing anywhere in command (bypass detection)
      # Catches: $(echo git) $(echo push), eval "git" "push", etc.
      # ─────────────────────────────────────────────────────────────────────────
      if echo "$normalized" | grep -qiE '\bgit\b.*\bpush\b'; then
        echo '{"decision":"block","message":"git push detected (bypass attempt blocked). Complete build first, then manually push."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 3: Subshell/backtick patterns containing git push
      # Catches: $(git push), `git push`, $(...git...push...)
      # Use grep for safer pattern matching with special characters
      # ─────────────────────────────────────────────────────────────────────────
      if echo "$command" | grep -qE '\$\([^)]*git[^)]*push' || \
         echo "$command" | grep -qE '`[^`]*git[^`]*push'; then
        echo '{"decision":"block","message":"git push in subshell blocked. Complete build first, then manually push."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 4: Script file execution - check if script contains git push
      # Catches: bash script.sh, sh script.sh, ./script.sh, source script.sh
      # ─────────────────────────────────────────────────────────────────────────
      for script_file in $(echo "$command" | grep -oE '[^ ]+\.(sh|bash)' 2>/dev/null || true); do
        if [[ -f "$script_file" ]]; then
          if grep -qE '\bgit\b.*\bpush\b' "$script_file" 2>/dev/null; then
            echo "{\"decision\":\"block\",\"message\":\"Script contains git push: $script_file. Cannot execute during build.\"}"
            exit 0
          fi
          if grep -qE '\bgit\b.*\bmerge\b.*(main|master)' "$script_file" 2>/dev/null; then
            echo "{\"decision\":\"block\",\"message\":\"Script contains git merge to main/master: $script_file. Cannot execute during build.\"}"
            exit 0
          fi
        fi
      done

      # ─────────────────────────────────────────────────────────────────────────
      # Check 5: Base64 encoded commands (potential obfuscation)
      # Catches: echo <base64> | base64 -d | bash
      # ─────────────────────────────────────────────────────────────────────────
      if [[ "$command" =~ base64[[:space:]]+-d ]] && [[ "$command" =~ \|[[:space:]]*(bash|sh|zsh) ]]; then
        echo '{"decision":"block","message":"Base64-decoded shell execution blocked for safety."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 6: Block git merge to main/master (original + enhanced)
      # ─────────────────────────────────────────────────────────────────────────
      if [[ "$command" =~ (^|[[:space:]]|&&|\|)git[[:space:]]+merge[[:space:]]+.*(main|master) ]]; then
        echo '{"decision":"block","message":"git merge to main/master blocked. Use ralph stream merge instead."}'
        exit 0
      fi

      # Enhanced: git and merge appearing with main/master anywhere
      if echo "$normalized" | grep -qiE '\bgit\b.*\bmerge\b.*(main|master)'; then
        echo '{"decision":"block","message":"git merge to main/master detected (bypass attempt blocked). Use ralph stream merge instead."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 7: Block ralph stream merge (automated merge)
      # ─────────────────────────────────────────────────────────────────────────
      if [[ "$command" =~ ralph[[:space:]]+stream[[:space:]]+merge ]]; then
        echo '{"decision":"block","message":"ralph stream merge blocked during build. Human must trigger merge manually."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 8: Block force flags on git
      # ─────────────────────────────────────────────────────────────────────────
      if [[ "$command" =~ git[[:space:]]+.*--force ]]; then
        echo '{"decision":"block","message":"git --force operations blocked for safety."}'
        exit 0
      fi

      # ─────────────────────────────────────────────────────────────────────────
      # Check 9: Block eval with git commands (obfuscation attempt)
      # Catches: eval "git push", eval 'git' 'push'
      # ─────────────────────────────────────────────────────────────────────────
      if [[ "$command" =~ eval[[:space:]] ]] && echo "$normalized" | grep -qiE '\bgit\b'; then
        if echo "$normalized" | grep -qiE '\bpush\b|\bmerge\b'; then
          echo '{"decision":"block","message":"eval with git push/merge blocked. Cannot execute during build."}'
          exit 0
        fi
      fi
    fi
    ;;

  Read)
    # Log reads for Edit validation
    file_path=$(echo "$tool_input" | jq -r '.file_path // empty')
    if [[ -n "$file_path" ]]; then
      mkdir -p "$(dirname "$SESSION_LOG")" 2>/dev/null || true
      # Sanitize file_path: strip all control characters (ASCII 0-31) to prevent log injection
      # This handles newlines, carriage returns, ANSI escapes, tabs, bells, backspaces, etc.
      # - tr -d '\000-\010\013-\037' removes ASCII 0-8, 11-31 (all control chars except tab/newline)
      # - tr '\011\012\015' '   ' converts tab, newline, carriage return to spaces
      safe_file_path=$(printf '%s' "$file_path" | tr -d '\000-\010\013\014\016-\037' | tr '\011\012\015' '   ')
      printf 'Read: %s\n' "$safe_file_path" >> "$SESSION_LOG" 2>/dev/null || true
    fi
    ;;

esac

# Default: allow
echo '{"decision":"allow"}'
exit 0
