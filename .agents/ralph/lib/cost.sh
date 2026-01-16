#!/bin/bash
# Cost tracking module for real-time cost accumulation (US-007)
# Tracks token usage and cost per iteration, persists to .cost.json

# ============================================================================
# Cost Tracking Functions
# ============================================================================

# Initialize cost tracking for a build
# Usage: init_cost_tracking <prd_folder>
init_cost_tracking() {
  local prd_folder="$1"
  local cost_file="$prd_folder/.cost.json"

  # Create initial cost file if it doesn't exist
  if [[ ! -f "$cost_file" ]]; then
    cat > "$cost_file" <<EOF
{
  "total_cost": 0,
  "total_input_tokens": 0,
  "total_output_tokens": 0,
  "iterations": [],
  "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
  fi
}

# Extract token counts from a run log file
# Usage: extract_tokens_from_log <log_file>
# Output: JSON with input_tokens and output_tokens
extract_tokens_from_log() {
  local log_file="$1"

  if [[ ! -f "$log_file" ]]; then
    echo '{"input_tokens":0,"output_tokens":0,"estimated":true}'
    return
  fi

  # Try to extract tokens using Node.js extractor (most accurate)
  local script_dir="$(dirname "${BASH_SOURCE[0]}")"
  local extractor_path="$script_dir/../../../lib/tokens/extractor.js"

  if [[ -f "$extractor_path" ]] && command -v node &> /dev/null; then
    local result
    result=$(node -e "
      const extractor = require('$extractor_path');
      const fs = require('fs');
      const content = fs.readFileSync('$log_file', 'utf8');
      const tokens = extractor.extractTokensWithFallback(content);
      console.log(JSON.stringify({
        input_tokens: tokens.inputTokens || 0,
        output_tokens: tokens.outputTokens || 0,
        estimated: tokens.estimated || false
      }));
    " 2>/dev/null)

    if [[ -n "$result" ]]; then
      echo "$result"
      return
    fi
  fi

  # Fallback: grep for common token patterns
  local input_tokens=0
  local output_tokens=0
  local estimated=true

  # Pattern: tokens: {input: N, output: N}
  local pattern_match
  pattern_match=$(grep -oE 'tokens:\s*\{\s*input:\s*[0-9]+\s*,\s*output:\s*[0-9]+\s*\}' "$log_file" | tail -1)
  if [[ -n "$pattern_match" ]]; then
    input_tokens=$(echo "$pattern_match" | grep -oE 'input:\s*[0-9]+' | grep -oE '[0-9]+')
    output_tokens=$(echo "$pattern_match" | grep -oE 'output:\s*[0-9]+' | grep -oE '[0-9]+')
    estimated=false
  fi

  # Pattern: input_tokens: N, output_tokens: N
  if [[ "$estimated" == "true" ]]; then
    input_tokens=$(grep -oE 'input[_\s]?tokens:\s*[0-9]+' "$log_file" | tail -1 | grep -oE '[0-9]+' || echo "0")
    output_tokens=$(grep -oE 'output[_\s]?tokens:\s*[0-9]+' "$log_file" | tail -1 | grep -oE '[0-9]+' || echo "0")
    if [[ "$input_tokens" -gt 0 ]] || [[ "$output_tokens" -gt 0 ]]; then
      estimated=false
    fi
  fi

  # Fallback estimation based on file size (~3.5 chars per token, optimized for code)
  if [[ "$estimated" == "true" ]] && [[ -f "$log_file" ]]; then
    local file_size
    file_size=$(wc -c < "$log_file" 2>/dev/null || echo "0")
    file_size="${file_size// /}"
    # More accurate estimation: 3.5 chars per token for code
    # Estimate: input ~70% of total (Claude Code has large prompts), output ~30%
    local total_tokens=$((file_size * 10 / 35))  # Equivalent to file_size / 3.5
    input_tokens=$((total_tokens * 7 / 10))
    output_tokens=$((total_tokens * 3 / 10))
  fi

  echo "{\"input_tokens\":$input_tokens,\"output_tokens\":$output_tokens,\"estimated\":$estimated}"
}

# Calculate cost from token counts
# Usage: calculate_cost <input_tokens> <output_tokens> <model> [cache_creation_tokens] [cache_read_tokens]
# Output: cost in dollars (6 decimal places)
calculate_cost() {
  local input_tokens="$1"
  local output_tokens="$2"
  local model="${3:-sonnet}"
  local cache_creation_tokens="${4:-0}"
  local cache_read_tokens="${5:-0}"

  # Pricing per 1M tokens (as of Jan 2026)
  # Claude Opus 4.5: $15/1M input, $75/1M output, $3.75 cache write, $1.50 cache read
  # Claude Sonnet 4/4.5: $3/1M input, $15/1M output, $0.75 cache write, $0.30 cache read
  # Claude Haiku 3.5: $0.25/1M input, $1.25/1M output, $0.0625 cache write, $0.025 cache read
  local input_price output_price cache_write_price cache_read_price
  case "$model" in
    opus|claude-opus*)
      input_price="15"
      output_price="75"
      cache_write_price="3.75"
      cache_read_price="1.50"
      ;;
    haiku|claude-haiku*)
      input_price="0.25"
      output_price="1.25"
      cache_write_price="0.0625"
      cache_read_price="0.025"
      ;;
    sonnet|claude-sonnet*|*)
      input_price="3"
      output_price="15"
      cache_write_price="0.75"
      cache_read_price="0.30"
      ;;
  esac

  # Calculate cost: (tokens / 1000000) * price
  # Using bc for floating point math
  if command -v bc &> /dev/null; then
    local cost
    cost=$(echo "scale=6; ($input_tokens * $input_price + $output_tokens * $output_price + $cache_creation_tokens * $cache_write_price + $cache_read_tokens * $cache_read_price) / 1000000" | bc)
    echo "$cost"
  else
    # Fallback: integer math with 6 decimal approximation
    local input_cost=$((input_tokens * ${input_price%.*} / 1000))
    local output_cost=$((output_tokens * ${output_price%.*} / 1000))
    local cache_write_cost=$((cache_creation_tokens * ${cache_write_price%.*} / 1000))
    local cache_read_cost=$((cache_read_tokens * ${cache_read_price%.*} / 1000))
    local total_microdollars=$((input_cost + output_cost + cache_write_cost + cache_read_cost))
    printf "0.%06d\n" "$total_microdollars"
  fi
}

# Update cost file with new iteration data
# Usage: update_cost <prd_folder> <iteration> <story_id> <log_file> <model>
update_cost() {
  local prd_folder="$1"
  local iteration="$2"
  local story_id="$3"
  local log_file="$4"
  local model="${5:-sonnet}"

  local cost_file="$prd_folder/.cost.json"

  # Extract tokens from log
  local tokens_json
  tokens_json=$(extract_tokens_from_log "$log_file")

  local input_tokens output_tokens estimated
  input_tokens=$(echo "$tokens_json" | grep -oE '"input_tokens":\s*[0-9]+' | grep -oE '[0-9]+' || echo "0")
  output_tokens=$(echo "$tokens_json" | grep -oE '"output_tokens":\s*[0-9]+' | grep -oE '[0-9]+' || echo "0")
  estimated=$(echo "$tokens_json" | grep -oE '"estimated":\s*(true|false)' | grep -oE '(true|false)' || echo "true")

  # Calculate cost for this iteration
  local iteration_cost
  iteration_cost=$(calculate_cost "$input_tokens" "$output_tokens" "$model")

  # Read current totals
  local current_total_cost current_input current_output
  if [[ -f "$cost_file" ]]; then
    current_total_cost=$(grep -oE '"total_cost":\s*[0-9.]+' "$cost_file" | grep -oE '[0-9.]+' || echo "0")
    current_input=$(grep -oE '"total_input_tokens":\s*[0-9]+' "$cost_file" | grep -oE '[0-9]+' || echo "0")
    current_output=$(grep -oE '"total_output_tokens":\s*[0-9]+' "$cost_file" | grep -oE '[0-9]+' || echo "0")
  else
    current_total_cost="0"
    current_input="0"
    current_output="0"
  fi

  # Calculate new totals using bc or awk
  local new_total_cost new_input new_output
  if command -v bc &> /dev/null; then
    new_total_cost=$(echo "scale=6; $current_total_cost + $iteration_cost" | bc)
  else
    new_total_cost=$(awk "BEGIN {printf \"%.6f\", $current_total_cost + $iteration_cost}")
  fi
  new_input=$((current_input + input_tokens))
  new_output=$((current_output + output_tokens))

  # Build iteration entry
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local iteration_entry
  iteration_entry=$(cat <<EOF
{
      "iteration": $iteration,
      "story_id": "$story_id",
      "cost": $iteration_cost,
      "input_tokens": $input_tokens,
      "output_tokens": $output_tokens,
      "model": "$model",
      "estimated": $estimated,
      "timestamp": "$timestamp"
    }
EOF
)

  # Read existing iterations (if any)
  local existing_iterations=""
  if [[ -f "$cost_file" ]]; then
    existing_iterations=$(grep -oE '"iterations":\s*\[[^]]*\]' "$cost_file" | sed 's/"iterations":\s*\[//' | sed 's/\]$//' || echo "")
  fi

  # Build new cost file
  local new_content
  if [[ -n "$existing_iterations" ]] && [[ "$existing_iterations" != "[]" ]]; then
    new_content=$(cat <<EOF
{
  "total_cost": $new_total_cost,
  "total_input_tokens": $new_input,
  "total_output_tokens": $new_output,
  "iterations": [
    $existing_iterations,
    $iteration_entry
  ],
  "updated_at": "$timestamp"
}
EOF
)
  else
    new_content=$(cat <<EOF
{
  "total_cost": $new_total_cost,
  "total_input_tokens": $new_input,
  "total_output_tokens": $new_output,
  "iterations": [
    $iteration_entry
  ],
  "updated_at": "$timestamp"
}
EOF
)
  fi

  # Write atomically
  local tmp_file="${cost_file}.tmp.$$"
  echo "$new_content" > "$tmp_file"
  mv "$tmp_file" "$cost_file"

  # Return iteration cost for display
  echo "$iteration_cost"
}

# Get current total cost from .cost.json
# Usage: get_total_cost <prd_folder>
# Output: cost in dollars
get_total_cost() {
  local prd_folder="$1"
  local cost_file="$prd_folder/.cost.json"

  if [[ -f "$cost_file" ]]; then
    grep -oE '"total_cost":\s*[0-9.]+' "$cost_file" | grep -oE '[0-9.]+' || echo "0"
  else
    echo "0"
  fi
}

# Format cost for display
# Usage: format_cost <cost>
# Output: formatted cost string (e.g., "$0.0234")
format_cost() {
  local cost="$1"
  printf '$%.4f' "$cost"
}

# Clear cost tracking (for fresh builds)
# Usage: clear_cost <prd_folder>
clear_cost() {
  local prd_folder="$1"
  local cost_file="$prd_folder/.cost.json"

  if [[ -f "$cost_file" ]]; then
    rm -f "$cost_file"
  fi
}

# Enhanced log metadata extraction (Phase 3.1)
# Extracts API response metadata from log and saves to separate file
# Usage: extract_log_metadata <log_file> <metadata_file>
extract_log_metadata() {
  local log_file="$1"
  local metadata_file="$2"

  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  # Try to extract usage JSON from log (Claude API response format)
  local usage_json=""
  usage_json=$(grep -oE '"usage"\s*:\s*\{[^}]+\}' "$log_file" 2>/dev/null | tail -1 || echo "")

  # Try to extract model from log
  local model=""
  model=$(grep -oE '"model"\s*:\s*"[^"]+"' "$log_file" 2>/dev/null | head -1 | sed 's/.*"model"\s*:\s*"\([^"]*\)".*/\1/' || echo "")

  # If we found usage or model, save to metadata file
  if [[ -n "$usage_json" ]] || [[ -n "$model" ]]; then
    cat > "$metadata_file" <<EOF
{
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "model": "${model:-unknown}",
  "usage": ${usage_json:-null},
  "log_file": "$(basename "$log_file")"
}
EOF
  fi
}

# Validate token extraction results (Phase 3.2)
# Warns if token counts seem suspiciously low
# Usage: validate_token_extraction <input_tokens> <output_tokens> <log_file>
validate_token_extraction() {
  local input_tokens="$1"
  local output_tokens="$2"
  local log_file="$3"
  local total_tokens=$((input_tokens + output_tokens))

  # Warning thresholds (Claude Code typically uses 50K-200K tokens per run)
  local min_expected=1000
  local max_expected=1000000

  if [[ "$total_tokens" -lt "$min_expected" ]]; then
    echo "⚠️  Warning: Token extraction may be incomplete (only $total_tokens tokens)" >&2
    echo "   Log file: $log_file" >&2
    echo "   This is unusually low for a Claude Code run (expected >$min_expected)" >&2
    return 1
  fi

  if [[ "$total_tokens" -gt "$max_expected" ]]; then
    echo "⚠️  Warning: Token count unusually high ($total_tokens tokens)" >&2
    echo "   Log file: $log_file" >&2
    return 1
  fi

  return 0
}
