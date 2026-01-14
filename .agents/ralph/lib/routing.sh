#!/bin/bash
# Shared routing and cost estimation utilities for ralph scripts
# Source this file to get model routing and cost calculation functions
#
# Functions:
#   get_routing_decision     - Get model routing decision for a story
#   parse_json_field         - Parse a field from JSON object (generic utility)
#   estimate_execution_cost  - Estimate cost before running
#   calculate_actual_cost    - Calculate actual cost from token usage
#
# Dependencies (must be defined before sourcing):
#   SCRIPT_DIR  - Path to the ralph agents directory
#   ROOT_DIR    - Path to the repository root
#   RALPH_ROOT  - (optional) Root path for ralph installation
#
# External dependencies:
#   python3     - Required for parse_json_field
#   node        - Required for routing, estimation, and cost calculation

# ============================================================================
# JSON Utilities
# ============================================================================

# Parse JSON field from any JSON object
# Usage: parse_json_field <json_string> <field_name>
# Returns: The value of the field, or empty string if not found/null
#
# Examples:
#   model=$(parse_json_field '{"model":"sonnet","score":5}' "model")  # "sonnet"
#   score=$(parse_json_field '{"model":"sonnet","score":null}' "score")  # ""
#
# Note: This function is intentionally defensive about null/None values
# to prevent arithmetic errors when parsing optional numeric fields.
parse_json_field() {
  local json="$1"
  local field="$2"
  local result
  result=$(python3 -c "import json,sys; d=json.loads(sys.argv[1]); v=d.get('$field',''); print('' if v is None else str(v))" "$json" 2>/dev/null)
  # Handle None, null, and empty - return empty string to prevent arithmetic errors
  if [[ -z "$result" ]] || [[ "$result" = "None" ]] || [[ "$result" = "null" ]]; then
    echo ""
  else
    echo "$result"
  fi
}

# ============================================================================
# Model Routing Functions
# ============================================================================

# Get model routing decision for a story
# Usage: get_routing_decision <story_block_file> [override_model]
# Returns JSON: {"model": "sonnet", "score": 5.2, "reason": "...", "override": false}
#
# The router analyzes story complexity to select the appropriate model:
#   - Simple stories (low complexity) -> haiku (cheapest)
#   - Standard stories (medium complexity) -> sonnet (balanced)
#   - Complex stories (high complexity) -> opus (most capable)
#
# Arguments:
#   story_block_file  - Path to file containing the story block text
#   override_model    - (optional) Force use of specific model, bypassing routing
get_routing_decision() {
  local story_file="$1"
  local override="${2:-}"
  local router_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    router_cli="$RALPH_ROOT/lib/tokens/router-cli.js"
  else
    router_cli="$SCRIPT_DIR/../../lib/tokens/router-cli.js"
  fi

  # Check if router CLI exists and Node.js is available
  if [[ -f "$router_cli" ]] && command -v node >/dev/null 2>&1; then
    local args=("--story" "$story_file" "--repo-root" "$ROOT_DIR")
    if [[ -n "$override" ]]; then
      args+=("--override" "$override")
    fi
    node "$router_cli" "${args[@]}" 2>/dev/null || echo '{"model":"sonnet","score":null,"reason":"router unavailable","override":false}'
  else
    # Fallback when router not available
    echo '{"model":"sonnet","score":null,"reason":"router not installed","override":false}'
  fi
}

# ============================================================================
# Cost Estimation Functions
# ============================================================================

# Estimate execution cost before running
# Usage: estimate_execution_cost <model> <complexity_score>
# Returns JSON: {"estimatedCost": "0.15", "costRange": "$0.10-0.25", "estimatedTokens": 15000, "comparison": "vs $0.75 if using Opus"}
#
# This provides a pre-execution estimate based on:
#   - Selected model's pricing
#   - Story complexity score (correlates with token usage)
#   - Historical averages for similar stories
estimate_execution_cost() {
  local model="$1"
  local score="$2"
  local estimator_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    estimator_cli="$RALPH_ROOT/lib/tokens/estimator-cli.js"
  else
    estimator_cli="$SCRIPT_DIR/../../lib/tokens/estimator-cli.js"
  fi

  # Check if estimator CLI exists and Node.js is available
  if [[ -f "$estimator_cli" ]] && command -v node >/dev/null 2>&1; then
    local args=("--model" "$model" "--repo-root" "$ROOT_DIR")
    if [[ -n "$score" ]]; then
      args+=("--complexity" "$score")
    fi
    node "$estimator_cli" "${args[@]}" 2>/dev/null || echo '{"estimatedCost":null,"costRange":null,"estimatedTokens":null,"comparison":null}'
  else
    # Fallback when estimator not available
    echo '{"estimatedCost":null,"costRange":null,"estimatedTokens":null,"comparison":null}'
  fi
}

# Calculate actual cost from token usage
# Usage: calculate_actual_cost <input_tokens> <output_tokens> <model>
# Returns JSON: {"totalCost": "0.15", "inputCost": "0.05", "outputCost": "0.10"}
#
# This calculates the actual cost after execution using:
#   - Actual input and output token counts from the agent
#   - Current model pricing from the calculator
calculate_actual_cost() {
  local input_tokens="$1"
  local output_tokens="$2"
  local model="$3"

  # Use Node.js for cost calculation
  if command -v node >/dev/null 2>&1; then
    local calculator_path
    if [[ -n "${RALPH_ROOT:-}" ]]; then
      calculator_path="$RALPH_ROOT/lib/tokens/calculator.js"
    else
      calculator_path="$SCRIPT_DIR/../../lib/tokens/calculator.js"
    fi

    if [[ -f "$calculator_path" ]]; then
      node -e "
        const calc = require('$calculator_path');
        const result = calc.calculateCost(
          { inputTokens: $input_tokens, outputTokens: $output_tokens },
          '$model'
        );
        console.log(JSON.stringify(result));
      " 2>/dev/null || echo '{"totalCost":null}'
    else
      echo '{"totalCost":null}'
    fi
  else
    echo '{"totalCost":null}'
  fi
}
