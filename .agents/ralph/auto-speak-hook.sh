#!/usr/bin/env bash
# Auto-speak hook for Claude Code
# Triggered by Stop hook - speaks Claude's last response via TTS
# Uses local Qwen model for intelligent summarization
# Usage: Called automatically by Claude Code when a response completes

set -euo pipefail

# Get script directory for sourcing path-utils
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source path utilities for smart RALPH_ROOT resolution
source "${SCRIPT_DIR}/lib/path-utils.sh"

# Resolve RALPH_ROOT using smart detection (handles both project root and .ralph paths)
RALPH_DIR="$(find_ralph_root)"
if [[ -z "$RALPH_DIR" ]]; then
  # Fallback to default behavior
  RALPH_DIR="${RALPH_ROOT:-$(pwd)}/.ralph"
fi

CONFIG_FILE="${RALPH_DIR}/voice-config.json"
LOG_FILE="${RALPH_DIR}/auto-speak-hook.log"
TEMP_SCRIPT="${RALPH_DIR}/auto-speak-summarize.mjs"

# Set RALPH_ROOT for child processes (points to .ralph directory)
export RALPH_ROOT="$RALPH_DIR"

# Source TTS manager for exclusive TTS playback
source "${SCRIPT_DIR}/lib/tts-manager.sh"

# Source session detection library
source "${SCRIPT_DIR}/lib/session-detect.sh"

# Function to log messages
log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# Check if auto-speak is enabled
is_auto_speak_enabled() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return 1
  fi

  # Use jq if available, otherwise grep
  if command -v jq &>/dev/null; then
    local enabled=$(jq -r '.autoSpeak // false' "$CONFIG_FILE" 2>/dev/null)
    [[ "$enabled" == "true" ]]
  else
    grep -q '"autoSpeak"[[:space:]]*:[[:space:]]*true' "$CONFIG_FILE" 2>/dev/null
  fi
}

# Extract and clean Claude's response text
extract_response_text() {
  local transcript_path="$1"

  if [[ ! -f "$transcript_path" ]]; then
    log "ERROR: Transcript file not found: $transcript_path"
    return 1
  fi

  # Read the transcript and extract the last assistant message
  # Claude Code transcripts are in JSON format
  if command -v jq &>/dev/null; then
    # Use jq to extract the last assistant message content
    local response=$(jq -r '
      .messages
      | map(select(.role == "assistant"))
      | last
      | .content
      | if type == "array" then
          map(select(.type == "text") | .text)
          | join("\n")
        elif type == "string" then
          .
        else
          ""
        end
    ' "$transcript_path" 2>/dev/null)

    if [[ -n "$response" ]]; then
      echo "$response"
      return 0
    fi
  fi

  # Fallback: simple grep-based extraction (less reliable)
  # Look for assistant messages and extract text content
  local in_assistant=false
  local response=""

  while IFS= read -r line; do
    if [[ "$line" =~ \"role\":[[:space:]]*\"assistant\" ]]; then
      in_assistant=true
    elif [[ "$in_assistant" == true ]] && [[ "$line" =~ \"text\":[[:space:]]*\"(.*)\" ]]; then
      response+="${BASH_REMATCH[1]}"$'\n'
    elif [[ "$in_assistant" == true ]] && [[ "$line" =~ \}[[:space:]]*,?[[:space:]]*$ ]]; then
      in_assistant=false
    fi
  done < "$transcript_path"

  if [[ -n "$response" ]]; then
    echo "$response"
    return 0
  fi

  log "WARN: Could not extract response from transcript"
  return 1
}

# Clean text for TTS (remove code blocks, tool calls, etc.)
clean_text_for_tts() {
  local text="$1"

  # Remove code blocks (```...```)
  text=$(echo "$text" | sed -E '/```/,/```/d')

  # Remove XML-like tags (tool calls, function calls, etc.)
  text=$(echo "$text" | sed -E 's/<[^>]+>//g')

  # Remove markdown formatting
  text=$(echo "$text" | sed -E 's/\*\*([^*]+)\*\*/\1/g')  # Bold
  text=$(echo "$text" | sed -E 's/\*([^*]+)\*/\1/g')      # Italic
  text=$(echo "$text" | sed -E 's/`([^`]+)`/\1/g')        # Inline code

  # Remove URLs
  text=$(echo "$text" | sed -E 's/https?:\/\/[^[:space:]]+//g')

  # Remove excessive whitespace
  text=$(echo "$text" | sed -E 's/[[:space:]]+/ /g')

  # Trim
  text=$(echo "$text" | sed -E 's/^[[:space:]]+//;s/[[:space:]]+$//')

  echo "$text"
}

# Stop progress timer and watcher before speaking final summary
cleanup_acknowledgment_processes() {
  log "Stopping acknowledgment processes..."

  # Stop progress timer
  "${RALPH_ROOT}/.agents/ralph/progress-timer.sh" stop 2>/dev/null || true

  # Kill any running transcript watcher
  pkill -f "transcript-watcher.mjs" 2>/dev/null || true

  # Remove watcher PID file
  rm -f "${RALPH_DIR}/transcript-watcher.pid" 2>/dev/null || true

  log "Acknowledgment processes stopped"
}

# Main hook logic
main() {
  log "=== Auto-speak hook triggered ==="

  # Stop any acknowledgment/progress processes before speaking final summary
  cleanup_acknowledgment_processes

  # Check if auto-speak is enabled
  if ! is_auto_speak_enabled; then
    log "Auto-speak disabled, skipping TTS"
    exit 0
  fi

  # Read hook data from stdin (JSON)
  local hook_data=""
  if [[ ! -t 0 ]]; then
    hook_data=$(cat)
    log "Hook data received: ${hook_data:0:200}..."
  else
    log "WARN: No hook data received on stdin"
  fi

  # Extract transcript path from hook data
  local transcript_path=""
  if command -v jq &>/dev/null && [[ -n "$hook_data" ]]; then
    transcript_path=$(echo "$hook_data" | jq -r '.transcript_path // ""' 2>/dev/null)
  fi

  if [[ -z "$transcript_path" ]] || [[ ! -f "$transcript_path" ]]; then
    log "ERROR: No valid transcript path found"
    log "Hook data: $hook_data"
    exit 0
  fi

  log "Transcript path: $transcript_path"

  # Check if this is a session start - skip voice on first prompt
  if should_skip_session_start "$transcript_path"; then
    log "Session start detected, skipping auto-speak voice"
    exit 0
  fi

  # Use Node.js script to extract, filter, and summarize with Qwen
  local summarizer_script="${RALPH_ROOT}/.agents/ralph/summarize-for-tts.mjs"

  if [[ ! -f "$summarizer_script" ]]; then
    log "ERROR: Summarizer script not found: $summarizer_script"
    exit 0
  fi

  log "Running context-aware Qwen summarization..."

  # Run summarizer (filters + LLM summarization)
  local summary=""
  summary=$(node "$summarizer_script" "$transcript_path" 2>>"$LOG_FILE")
  local exit_code=$?

  if [[ $exit_code -ne 0 ]]; then
    log "Summarizer failed with exit code $exit_code"
    exit 0
  fi

  if [[ -z "$summary" ]]; then
    log "Summary empty, skipping TTS"
    exit 0
  fi

  # Allow short responses (like "4" or "Yes") - they're valid answers
  # Only skip truly empty or whitespace-only summaries

  log "Summary generated: ${#summary} characters"
  log "Summary preview: ${summary:0:100}..."

  # Speak the summary exclusively (cancels any existing TTS)
  speak_exclusive "$summary"

  log "=== Hook complete ==="

  exit 0
}

# Run main
main
