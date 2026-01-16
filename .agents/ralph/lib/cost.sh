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

  # Fallback estimation based on file size (~4 chars per token)
  if [[ "$estimated" == "true" ]] && [[ -f "$log_file" ]]; then
    local file_size
    file_size=$(wc -c < "$log_file" 2>/dev/null || echo "0")
    file_size="${file_size// /}"
    # Estimate: input ~60% of total, output ~40%
    local total_tokens=$((file_size / 4))
    input_tokens=$((total_tokens * 6 / 10))
    output_tokens=$((total_tokens * 4 / 10))
  fi

  echo "{\"input_tokens\":$input_tokens,\"output_tokens\":$output_tokens,\"estimated\":$estimated}"
}

# Calculate cost from token counts
# Usage: calculate_cost <input_tokens> <output_tokens> <model>
# Output: cost in dollars (6 decimal places)
calculate_cost() {
  local input_tokens="$1"
  local output_tokens="$2"
  local model="${3:-sonnet}"

  # Pricing per 1M tokens (as of Jan 2026)
  # Sonnet: $3/1M input, $15/1M output
  # Opus: $15/1M input, $75/1M output
  # Haiku: $0.25/1M input, $1.25/1M output
  local input_price output_price
  case "$model" in
    opus|claude-opus*)
      input_price="15"
      output_price="75"
      ;;
    haiku|claude-haiku*)
      input_price="0.25"
      output_price="1.25"
      ;;
    sonnet|claude-sonnet*|*)
      input_price="3"
      output_price="15"
      ;;
  esac

  # Calculate cost: (tokens / 1000000) * price
  # Using bc for floating point math
  if command -v bc &> /dev/null; then
    local cost
    cost=$(echo "scale=6; ($input_tokens * $input_price + $output_tokens * $output_price) / 1000000" | bc)
    echo "$cost"
  else
    # Fallback: integer math with 6 decimal approximation
    local input_cost=$((input_tokens * ${input_price%.*} / 1000))
    local output_cost=$((output_tokens * ${output_price%.*} / 1000))
    local total_microdollars=$((input_cost + output_cost))
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
