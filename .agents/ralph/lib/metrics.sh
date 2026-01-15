#!/bin/bash
# Metrics tracking and token extraction utilities
# Source this file to get metrics functions

# Source Python utilities for cross-platform compatibility
# shellcheck source=python-utils.sh
METRICS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$METRICS_LIB_DIR/python-utils.sh"

# ============================================================================
# Token extraction
# ============================================================================

# Extract tokens from agent run log using Node.js extractor
# Usage: extract_tokens_from_log <log_file>
# Returns: JSON with inputTokens, outputTokens, model, estimated fields
extract_tokens_from_log() {
  local log_file="$1"
  local extractor_path
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    extractor_path="$RALPH_ROOT/lib/tokens/extract-cli.js"
  else
    extractor_path="$SCRIPT_DIR/../../lib/tokens/extract-cli.js"
  fi

  # Check if extractor exists and Node.js is available
  if [ -f "$extractor_path" ] && command -v node >/dev/null 2>&1; then
    node "$extractor_path" "$log_file" 2>/dev/null || echo '{"inputTokens":null,"outputTokens":null,"model":null,"estimated":false}'
  else
    echo '{"inputTokens":null,"outputTokens":null,"model":null,"estimated":false}'
  fi
}

# Parse JSON field from token extraction result
parse_token_field() {
  local json="$1"
  local field="$2"
  local result
  result=$($PYTHON_CMD -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('$field',''); print('' if v is None else str(v))" "$json" 2>/dev/null)
  # Handle None, null, and empty - return empty string to prevent arithmetic errors
  if [ -z "$result" ] || [ "$result" = "None" ] || [ "$result" = "null" ]; then
    echo ""
  else
    echo "$result"
  fi
}

# ============================================================================
# Metrics appending
# ============================================================================

# Append metrics to metrics.jsonl for historical tracking
# Called after each successful build iteration
# Usage: append_metrics <prd_folder> <story_id> <story_title> <duration> <input_tokens> <output_tokens> <agent> <model> <status> <run_id> <iteration> [retry_count] [retry_time] [complexity_score] [routing_reason] [estimated_cost] [exp_name] [exp_variant] [exp_excluded] [rollback_count] [rollback_reason] [rollback_success] [switch_count] [agents_tried] [failure_type]
append_metrics() {
  local prd_folder="$1"
  local story_id="$2"
  local story_title="$3"
  local duration="$4"
  local input_tokens="$5"
  local output_tokens="$6"
  local agent="$7"
  local model="$8"
  local status="$9"
  local run_id="${10}"
  local iteration="${11}"
  local retry_count="${12:-0}"
  local retry_time="${13:-0}"
  local complexity_score="${14:-}"
  local routing_reason="${15:-}"
  local estimated_cost="${16:-}"
  local exp_name="${17:-}"
  local exp_variant="${18:-}"
  local exp_excluded="${19:-}"
  # Rollback tracking fields (US-004)
  local rollback_count="${20:-0}"
  local rollback_reason="${21:-}"
  local rollback_success="${22:-}"
  # Switch tracking fields (US-004)
  local switch_count="${23:-0}"
  local agents_tried="${24:-}"  # Comma-separated list of agents tried
  local failure_type="${25:-}"  # timeout, error, quality, or empty

  local metrics_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    metrics_cli="$RALPH_ROOT/lib/estimate/metrics-cli.js"
  else
    metrics_cli="$SCRIPT_DIR/../../lib/estimate/metrics-cli.js"
  fi

  # Check if metrics CLI exists and Node.js is available
  if [ -f "$metrics_cli" ] && command -v node >/dev/null 2>&1; then
    # Build JSON data - handle null tokens gracefully
    local input_val="null"
    local output_val="null"
    if [ -n "$input_tokens" ] && [ "$input_tokens" != "null" ] && [ "$input_tokens" != "" ]; then
      input_val="$input_tokens"
    fi
    if [ -n "$output_tokens" ] && [ "$output_tokens" != "null" ] && [ "$output_tokens" != "" ]; then
      output_val="$output_tokens"
    fi

    # Handle complexity score
    local complexity_val="null"
    if [ -n "$complexity_score" ] && [ "$complexity_score" != "null" ] && [ "$complexity_score" != "" ] && [ "$complexity_score" != "n/a" ]; then
      complexity_val="$complexity_score"
    fi

    # Handle estimated cost
    local estimated_cost_val="null"
    if [ -n "$estimated_cost" ] && [ "$estimated_cost" != "null" ] && [ "$estimated_cost" != "" ] && [ "$estimated_cost" != "n/a" ]; then
      estimated_cost_val="$estimated_cost"
    fi

    # Escape strings for JSON
    local escaped_title
    escaped_title=$(printf '%s' "$story_title" | sed 's/"/\\"/g' | sed "s/'/\\'/g")

local escaped_reason="null"
    if [ -n "$routing_reason" ] && [ "$routing_reason" != "null" ] && [ "$routing_reason" != "" ]; then
      escaped_reason=$(printf '"%s"' "$(printf '%s' "$routing_reason" | sed 's/"/\\"/g')")
    fi

    # Build experiment fields if present
    local exp_fields=""
    if [ -n "$exp_name" ]; then
      local excluded_bool="false"
      if [ "$exp_excluded" = "1" ]; then
        excluded_bool="true"
      fi
      exp_fields=$(printf ',"experimentName":"%s","experimentVariant":"%s","experimentExcluded":%s' \
        "$exp_name" \
        "$exp_variant" \
        "$excluded_bool")
    fi

    # Build rollback fields if present (US-004)
    local rollback_fields=""
    if [ -n "$rollback_count" ] && [ "$rollback_count" != "0" ]; then
      local rollback_success_bool="null"
      if [ "$rollback_success" = "true" ]; then
        rollback_success_bool="true"
      elif [ "$rollback_success" = "false" ]; then
        rollback_success_bool="false"
      fi
      local escaped_rollback_reason="null"
      if [ -n "$rollback_reason" ]; then
        escaped_rollback_reason=$(printf '"%s"' "$(printf '%s' "$rollback_reason" | sed 's/"/\\"/g')")
      fi
      rollback_fields=$(printf ',"rollbackCount":%s,"rollbackReason":%s,"rollbackSuccess":%s' \
        "$rollback_count" \
        "$escaped_rollback_reason" \
        "$rollback_success_bool")
    fi

    # Build switch tracking fields (US-004)
    local switch_fields=""
    if [ -n "$switch_count" ] && [ "$switch_count" != "0" ]; then
      # Convert comma-separated agents to JSON array
      local agents_json="null"
      if [ -n "$agents_tried" ]; then
        # Convert "claude,codex" to ["claude","codex"]
        agents_json="[$(echo "$agents_tried" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/' )]"
      fi
      local failure_type_json="null"
      if [ -n "$failure_type" ]; then
        failure_type_json="\"$failure_type\""
      fi
      switch_fields=$(printf ',"switchCount":%s,"agents":%s,"failureType":%s' \
        "$switch_count" \
        "$agents_json" \
        "$failure_type_json")
    fi

    local json_data
    json_data=$(printf '{"storyId":"%s","storyTitle":"%s","duration":%s,"inputTokens":%s,"outputTokens":%s,"agent":"%s","model":"%s","status":"%s","runId":"%s","iteration":%s,"retryCount":%s,"retryTime":%s,"complexityScore":%s,"routingReason":%s,"estimatedCost":%s,"timestamp":"%s"%s%s%s}' \
      "$story_id" \
      "$escaped_title" \
      "$duration" \
      "$input_val" \
      "$output_val" \
      "$agent" \
      "${model:-null}" \
      "$status" \
      "$run_id" \
      "$iteration" \
      "$retry_count" \
      "$retry_time" \
      "$complexity_val" \
      "$escaped_reason" \
      "$estimated_cost_val" \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      "$exp_fields" \
      "$rollback_fields" \
      "$switch_fields")

    node "$metrics_cli" "$prd_folder" "$json_data" 2>/dev/null || true
  fi
}

# ============================================================================
# Token cache rebuild
# ============================================================================

# Rebuild token cache for the current stream
# Called at end of build to ensure dashboard has fresh data
# Note: Requires MODE, PRD_PATH, and RALPH_ROOT to be set in calling context
rebuild_token_cache() {
  if [ "$MODE" != "build" ]; then
    return 0
  fi

  local cache_script
  if [ -n "$RALPH_ROOT" ]; then
    cache_script="$RALPH_ROOT/lib/tokens/index.js"
  else
    cache_script="$SCRIPT_DIR/../../lib/tokens/index.js"
  fi

  # Get the stream path (PRD-N directory)
  local stream_path
  stream_path="$(dirname "$PRD_PATH")"

  if [ -f "$cache_script" ] && command -v node >/dev/null 2>&1; then
    node -e "
      const tokens = require('$cache_script');
      const streamPath = '$stream_path';
      const repoRoot = '$(dirname "$(dirname "$stream_path")")';
      try {
        tokens.rebuildCache(streamPath, tokens.parseTokensFromSummary, { repoRoot });
        console.log('Token cache rebuilt for ' + streamPath);
      } catch (e) {
        console.error('Failed to rebuild token cache:', e.message);
      }
    " 2>/dev/null || true
  fi
}
