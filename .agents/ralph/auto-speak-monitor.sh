#!/usr/bin/env bash
# Auto-speak monitor for Claude Code sessions
# Watches the terminal output and speaks Claude's responses automatically
# Integrated with tts-manager for voice lock coordination and recap-for-tts for LLM summarization

set -euo pipefail

# Get script directory for sourcing
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RALPH_ROOT="${RALPH_ROOT:-$(pwd)}"
CONFIG_FILE="${RALPH_ROOT}/.ralph/voice-config.json"
LOG_FILE="${RALPH_ROOT}/.ralph/auto-speak.log"
PID_FILE="${RALPH_ROOT}/.ralph/auto-speak.pid"

# Source TTS manager for voice lock coordination
source "${SCRIPT_DIR}/lib/tts-manager.sh"

# Colors
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
DIM='\033[2m'
NC='\033[0m'

# Cleanup trap for proper resource cleanup
cleanup() {
  rm -f "$PID_FILE" 2>/dev/null || true
  cleanup_tts_manager
}
trap cleanup EXIT INT TERM

log() {
  echo "[$(date '+%H:%M:%S')] $*" >> "$LOG_FILE"
}

info() {
  echo -e "${CYAN}$*${NC}"
  log "INFO: $*"
}

dim() {
  echo -e "${DIM}$*${NC}"
}

success() {
  echo -e "${GREEN}$*${NC}"
  log "SUCCESS: $*"
}

warn() {
  echo -e "${YELLOW}$*${NC}"
  log "WARN: $*"
}

# Check if auto-speak is enabled
is_enabled() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    return 1
  fi

  # Use jq if available, otherwise grep
  if command -v jq &>/dev/null; then
    # Check nested autoSpeak.enabled or root level autoSpeak boolean
    local enabled=$(jq -r '.autoSpeak.enabled // .autoSpeak // false' "$CONFIG_FILE" 2>/dev/null)
    [[ "$enabled" == "true" ]]
  else
    grep -q '"autoSpeak"[[:space:]]*:[[:space:]]*{' "$CONFIG_FILE" 2>/dev/null && \
    grep -q '"enabled"[[:space:]]*:[[:space:]]*true' "$CONFIG_FILE" 2>/dev/null
  fi
}

# Read auto-speak mode from config
get_auto_speak_mode() {
  if [[ ! -f "$CONFIG_FILE" ]]; then
    echo "short"
    return
  fi

  if command -v jq &>/dev/null; then
    # Try nested autoSpeak.mode first, then root level autoSpeakMode
    local mode=$(jq -r '.autoSpeak.mode // .autoSpeakMode // "short"' "$CONFIG_FILE" 2>/dev/null)
    echo "$mode"
  else
    echo "short"
  fi
}

# Extract Claude's response from terminal output
# This is a simplified version - in production you'd want more robust parsing
extract_response() {
  local input="$1"

  # Remove ANSI color codes
  local clean=$(echo "$input" | sed 's/\x1B\[[0-9;]*[JKmsu]//g')

  # Remove tool calls and system messages
  clean=$(echo "$clean" | grep -v "^<" | grep -v "^<function_calls>" | grep -v "^</function_calls>" || true)

  # Remove empty lines
  clean=$(echo "$clean" | sed '/^[[:space:]]*$/d')

  echo "$clean"
}

# Find the latest Claude Code transcript file
find_latest_transcript() {
  local projects_dir="${HOME}/.claude/projects"

  if [[ ! -d "$projects_dir" ]]; then
    return
  fi

  # Get current working directory
  local cwd=$(pwd)

  # Try exact match first - encode path like Claude Code does (/ -> -)
  local encoded_path=$(echo "$cwd" | tr '/' '-')
  local project_dir="${projects_dir}/${encoded_path}"

  if [[ -d "$project_dir" ]]; then
    local latest=$(ls -t "$project_dir"/*.jsonl 2>/dev/null | head -1)
    if [[ -n "$latest" ]]; then
      echo "$latest"
      return
    fi
  fi

  # Try fuzzy match (partial path matching)
  local cwd_parts=($(echo "$cwd" | tr '/' ' '))
  for dir in "$projects_dir"/*; do
    if [[ -d "$dir" ]]; then
      local match=true
      for part in "${cwd_parts[@]}"; do
        if [[ ! "$dir" =~ "$part" ]]; then
          match=false
          break
        fi
      done

      if [[ "$match" == true ]]; then
        local latest=$(ls -t "$dir"/*.jsonl 2>/dev/null | head -1)
        if [[ -n "$latest" ]]; then
          echo "$latest"
          return
        fi
      fi
    fi
  done
}

# Summarize text using recap-for-tts.mjs (extended summaries)
summarize_with_recap() {
  local text="$1"
  local mode="${2:-medium}"

  # Find latest transcript
  local transcript_path=$(find_latest_transcript)

  if [[ -z "$transcript_path" ]]; then
    log "WARN: No transcript found for recap, using original text"
    echo "$text"
    return
  fi

  if [[ ! -f "$transcript_path" ]]; then
    log "WARN: Transcript file not accessible: $transcript_path"
    echo "$text"
    return
  fi

  log "Found transcript for recap: $transcript_path"

  # Call recap summarizer via Node.js
  local recap_script="${SCRIPT_DIR}/recap-for-tts.mjs"

  if [[ ! -f "$recap_script" ]]; then
    log "ERROR: Recap script not found: $recap_script"
    echo "$text"  # Fallback to original text
    return
  fi

  local summary=$(node "$recap_script" "$transcript_path" "$mode" 2>/dev/null)
  local exit_code=$?

  if [[ $exit_code -ne 0 ]]; then
    log "WARN: Recap summarization failed with exit code $exit_code"
    echo "$text"
    return
  fi

  if [[ -n "$summary" ]]; then
    echo "$summary"
  else
    echo "$text"  # Fallback
  fi
}

# Speak text using ralph speak with voice lock coordination
speak() {
  local text="$1"
  local mode="${SPEAK_MODE:-short}"

  if [[ -z "$text" ]]; then
    return
  fi

  log "Speaking (mode: $mode): ${text:0:100}..."

  # Apply summarization based on mode
  local summary="$text"
  if [[ "$mode" != "none" && "$mode" != "short" ]]; then
    # Use recap for medium/full modes
    log "Applying recap summarization for mode: $mode"
    summary=$(summarize_with_recap "$text" "$mode")
  fi

  # Use speak_exclusive from tts-manager for cross-session coordination
  # This will:
  # - Wait if another session is speaking
  # - Cancel any existing TTS from this session
  # - Speak the new text
  speak_exclusive "$summary"
}

# Start monitoring
start_monitor() {
  # Read mode from config if not set via CLI
  if [[ -z "$SPEAK_MODE" ]]; then
    SPEAK_MODE=$(get_auto_speak_mode)
    export SPEAK_MODE
  fi

  info "Starting auto-speak monitor (mode: $SPEAK_MODE)..."

  # Create log file
  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"

  # Save PID
  echo $$ > "$PID_FILE"

  dim "Monitoring Claude Code output for auto-speak"
  dim "Press Ctrl+C to stop"
  echo ""

  # Buffer for accumulating response
  local response_buffer=""
  local in_response=false

  # Monitor stdin (piped from claude command)
  while IFS= read -r line; do
    # Echo line to stdout (pass through)
    echo "$line"

    # Check if auto-speak is still enabled
    if ! is_enabled; then
      log "Auto-speak disabled, exiting monitor"
      break
    fi

    # Detect start of Claude's response
    # This is a heuristic - adjust based on actual Claude Code output format
    if [[ "$line" =~ ^[A-Z].*$ ]] && [[ ! "$line" =~ ^[[:space:]]*$ ]]; then
      in_response=true
      response_buffer+="$line"$'\n'
    elif [[ "$in_response" == true ]]; then
      if [[ "$line" =~ ^[[:space:]]*$ ]]; then
        # Empty line might signal end of response paragraph
        if [[ -n "$response_buffer" ]]; then
          # Speak the accumulated response
          local clean_text=$(extract_response "$response_buffer")
          if [[ ${#clean_text} -gt 20 ]]; then
            speak "$clean_text"
          fi
          response_buffer=""
        fi
        in_response=false
      else
        response_buffer+="$line"$'\n'
      fi
    fi
  done

  # Clean up
  rm -f "$PID_FILE"
  log "Monitor stopped"
}

# Stop monitor
stop_monitor() {
  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      success "Auto-speak monitor stopped (PID: $pid)"
    else
      warn "Monitor process not running"
    fi
    rm -f "$PID_FILE"
  else
    warn "No monitor PID file found"
  fi
}

# Check status
check_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid=$(cat "$PID_FILE")
    if kill -0 "$pid" 2>/dev/null; then
      success "Auto-speak monitor is running (PID: $pid)"
      if is_enabled; then
        info "Auto-speak is enabled"
      else
        warn "Auto-speak is disabled in config"
      fi
      return 0
    else
      warn "Monitor PID file exists but process is not running"
      rm -f "$PID_FILE"
      return 1
    fi
  else
    info "Auto-speak monitor is not running"
    return 1
  fi
}

# Main
case "${1:-start}" in
  start)
    # Parse mode option (--short, --medium, --full)
    if [[ -n "${2:-}" ]] && [[ "${2:-}" =~ ^--(short|medium|full|none)$ ]]; then
      SPEAK_MODE="${2#--}"
      export SPEAK_MODE
    fi

    if [[ -f "$PID_FILE" ]]; then
      local pid=$(cat "$PID_FILE")
      if kill -0 "$pid" 2>/dev/null; then
        warn "Monitor already running (PID: $pid)"
        exit 1
      fi
    fi

    if ! is_enabled; then
      warn "Auto-speak is not enabled"
      info "Run: ralph speak --auto-on"
      exit 1
    fi

    start_monitor
    ;;

  stop)
    stop_monitor
    ;;

  status)
    check_status
    ;;

  *)
    echo "Usage: $0 {start [--short|--medium|--full|--none]|stop|status}"
    echo ""
    echo "Modes (for 'start' command):"
    echo "  --short   Auto-speak style (~30 words)"
    echo "  --medium  Recap mode (~100 words)"
    echo "  --full    Detailed mode (~200 words)"
    echo "  --none    No TTS, pass-through only"
    echo ""
    echo "Default mode: from voice-config.json or 'short'"
    exit 1
    ;;
esac
