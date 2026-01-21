#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Minimal Utilities for Simplified Ralph Loop
# ─────────────────────────────────────────────────────────────────────────────
# Only essential functions needed for the simplified loop.
# Target: ~100 lines of utility code
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Color output (TTY-aware)
# ─────────────────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  C_GREEN=$'\033[32m'
  C_RED=$'\033[31m'
  C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'
  C_RESET=$'\033[0m'
else
  C_GREEN='' C_RED='' C_YELLOW='' C_CYAN='' C_RESET=''
fi

# ─────────────────────────────────────────────────────────────────────────────
# Logging functions
# ─────────────────────────────────────────────────────────────────────────────
log() {
  printf "%s[%s]%s %s\n" "$C_CYAN" "$(date +%H:%M:%S)" "$C_RESET" "$*"
}

log_success() {
  printf "%s[%s] ✓ %s%s\n" "$C_GREEN" "$(date +%H:%M:%S)" "$*" "$C_RESET"
}

log_error() {
  printf "%s[%s] ✗ %s%s\n" "$C_RED" "$(date +%H:%M:%S)" "$*" "$C_RESET" >&2
}

log_warn() {
  printf "%s[%s] ⚠ %s%s\n" "$C_YELLOW" "$(date +%H:%M:%S)" "$*" "$C_RESET"
}

# ─────────────────────────────────────────────────────────────────────────────
# Atomic file operations (prevents race conditions)
# ─────────────────────────────────────────────────────────────────────────────
atomic_write() {
  local file="$1"
  local content="$2"
  local temp="${file}.tmp.$$"
  local dir
  dir="$(dirname "$file")"

  mkdir -p "$dir" 2>/dev/null || true

  if ! printf '%s\n' "$content" > "$temp" 2>/dev/null; then
    rm -f "$temp" 2>/dev/null || true
    return 1
  fi

  if ! mv -f "$temp" "$file" 2>/dev/null; then
    rm -f "$temp" 2>/dev/null || true
    return 1
  fi

  return 0
}

# ─────────────────────────────────────────────────────────────────────────────
# Story management
# ─────────────────────────────────────────────────────────────────────────────

# Extract full story block from plan.md
# Usage: get_story_block "US-001" "/path/to/plan.md"
get_story_block() {
  local story_id="$1"
  local plan_path="$2"

  # Find line number of story, then extract until next story or section
  awk -v sid="$story_id" '
    /^###.*'"$story_id"'/ { found=1; print; next }
    found && /^###/ { exit }
    found && /^##[^#]/ { exit }
    found { print }
  ' "$plan_path"
}

# Mark a story as complete in plan.md
# Usage: mark_story_complete "US-001" "/path/to/plan.md"
mark_story_complete() {
  local story_id="$1"
  local plan_path="$2"

  # Use sed to change [ ] to [x] for this story
  # macOS sed requires different syntax than GNU sed
  if sed --version 2>/dev/null | grep -q GNU; then
    # GNU sed
    sed -i "s/^\(\s*-\s*\)\[ \]\(.*${story_id}\)/\1[x]\2/" "$plan_path"
  else
    # macOS sed
    sed -i '' "s/^\([[:space:]]*-[[:space:]]*\)\[ \]\(.*${story_id}\)/\1[x]\2/" "$plan_path"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Prompt building
# ─────────────────────────────────────────────────────────────────────────────

# Build prompt from template with variable substitution
# Usage: build_prompt "US-001" "/path/to/plan.md" "/path/to/template.md"
build_prompt() {
  local story_id="$1"
  local plan_path="$2"
  local template_path="$3"

  local story_block
  story_block=$(get_story_block "$story_id" "$plan_path")

  local story_title
  story_title=$(echo "$story_block" | head -1 | sed 's/^###[[:space:]]*//')

  # Read template and substitute variables
  if [[ -f "$template_path" ]]; then
    sed \
      -e "s|{{STORY_ID}}|$story_id|g" \
      -e "s|{{STORY_TITLE}}|$story_title|g" \
      -e "s|{{PLAN_PATH}}|$plan_path|g" \
      -e "s|{{PROGRESS_PATH}}|${PROGRESS_PATH:-}|g" \
      -e "s|{{PRD_NUMBER}}|${PRD_NUMBER:-1}|g" \
      "$template_path"

    # Append story block
    echo ""
    echo "## Story Details"
    echo ""
    echo "$story_block"
  else
    # Fallback: minimal prompt
    cat <<EOF
# Build Task

Implement story $story_id from the plan.

## Story
$story_block

## Rules
- Implement only the work required for this story
- Do NOT ask questions
- Commit when complete
EOF
  fi
}
