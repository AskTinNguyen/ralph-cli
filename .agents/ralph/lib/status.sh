#!/bin/bash
# Status emission module for real-time build visibility (US-001)
# Emits .status.json file for CLI and UI consumption

# Update status file with current phase, story, and elapsed time
# Usage: update_status <prd_folder> <phase> <iteration> <story_id> <story_title> <elapsed_seconds>
update_status() {
  local prd_folder="$1"
  local phase="$2"
  local iteration="$3"
  local story_id="${4:-}"
  local story_title="${5:-}"
  local elapsed_seconds="${6:-0}"

  local status_file="$prd_folder/.status.json"
  local timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Create JSON with current status
  local json_content
  json_content=$(cat <<EOF
{
  "phase": "$phase",
  "story_id": "$story_id",
  "story_title": "$story_title",
  "iteration": $iteration,
  "elapsed_seconds": $elapsed_seconds,
  "updated_at": "$timestamp"
}
EOF
)

  # Write atomically to prevent reading partial content
  local tmp_file="${status_file}.tmp.$$"
  echo "$json_content" > "$tmp_file"
  mv "$tmp_file" "$status_file"
}

# Clear status file when build completes
# Usage: clear_status <prd_folder>
clear_status() {
  local prd_folder="$1"
  local status_file="$prd_folder/.status.json"

  if [ -f "$status_file" ]; then
    rm -f "$status_file"
  fi
}

# Calculate elapsed seconds since build start
# Usage: elapsed_since <start_timestamp>
# Returns: seconds elapsed
elapsed_since() {
  local start_ts="$1"
  local now_ts=$(date +%s)
  echo $((now_ts - start_ts))
}
