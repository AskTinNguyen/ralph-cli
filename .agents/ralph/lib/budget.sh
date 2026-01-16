#!/bin/bash
# Budget tracking module for cost limits and warnings (US-008)
# Manages .budget.json configuration and threshold checking

# ============================================================================
# Budget Configuration Functions
# ============================================================================

# Initialize budget configuration for a PRD
# Usage: init_budget <prd_folder> <limit> [enforce]
init_budget() {
  local prd_folder="$1"
  local limit="$2"
  local enforce="${3:-true}"
  local budget_file="$prd_folder/.budget.json"

  # Create budget file with default warnings at 75% and 90%
  cat > "$budget_file" <<EOF
{
  "limit": $limit,
  "warnings": [0.75, 0.90],
  "enforce": $enforce,
  "created_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
}

# Read budget configuration
# Usage: get_budget <prd_folder>
# Output: JSON budget config or empty if not set
get_budget() {
  local prd_folder="$1"
  local budget_file="$prd_folder/.budget.json"

  if [[ -f "$budget_file" ]]; then
    cat "$budget_file"
  else
    echo ""
  fi
}

# Get budget limit
# Usage: get_budget_limit <prd_folder>
# Output: Budget limit in dollars or empty
get_budget_limit() {
  local prd_folder="$1"
  local budget_file="$prd_folder/.budget.json"

  if [[ -f "$budget_file" ]]; then
    grep -oE '"limit":\s*[0-9.]+' "$budget_file" | grep -oE '[0-9.]+' || echo ""
  else
    echo ""
  fi
}

# Check if budget enforcement is enabled
# Usage: is_budget_enforced <prd_folder>
# Returns: 0 if enforced, 1 if not
is_budget_enforced() {
  local prd_folder="$1"
  local budget_file="$prd_folder/.budget.json"

  if [[ -f "$budget_file" ]]; then
    local enforce
    enforce=$(grep -oE '"enforce":\s*(true|false)' "$budget_file" | grep -oE '(true|false)' || echo "true")
    [[ "$enforce" == "true" ]]
  else
    return 1
  fi
}

# ============================================================================
# Budget Checking Functions
# ============================================================================

# Calculate budget usage percentage
# Usage: calculate_budget_percentage <current_cost> <limit>
# Output: Percentage as integer (0-100+)
calculate_budget_percentage() {
  local current_cost="$1"
  local limit="$2"

  if [[ -z "$limit" ]] || [[ "$limit" == "0" ]]; then
    echo "0"
    return
  fi

  if command -v bc &> /dev/null; then
    local percentage
    percentage=$(echo "scale=0; ($current_cost * 100) / $limit" | bc)
    echo "$percentage"
  else
    # Fallback: integer math (multiply first to avoid truncation)
    local cost_cents=$((${current_cost%.*} * 100))
    local limit_cents=$((${limit%.*} * 100))
    if [[ "$limit_cents" -gt 0 ]]; then
      echo $((cost_cents * 100 / limit_cents))
    else
      echo "0"
    fi
  fi
}

# Check budget thresholds and return warning level
# Usage: check_budget_threshold <prd_folder> <current_cost>
# Output: "none", "warning_75", "warning_90", or "exceeded"
check_budget_threshold() {
  local prd_folder="$1"
  local current_cost="$2"
  local budget_file="$prd_folder/.budget.json"

  if [[ ! -f "$budget_file" ]]; then
    echo "none"
    return
  fi

  local limit
  limit=$(get_budget_limit "$prd_folder")

  if [[ -z "$limit" ]] || [[ "$limit" == "0" ]]; then
    echo "none"
    return
  fi

  local percentage
  percentage=$(calculate_budget_percentage "$current_cost" "$limit")

  if [[ "$percentage" -ge 100 ]]; then
    echo "exceeded"
  elif [[ "$percentage" -ge 90 ]]; then
    echo "warning_90"
  elif [[ "$percentage" -ge 75 ]]; then
    echo "warning_75"
  else
    echo "none"
  fi
}

# Track which warnings have been shown to avoid spam
# File: .budget-warnings-shown in PRD folder
BUDGET_WARNINGS_SHOWN=""

# Check if a warning level has already been shown
# Usage: is_warning_shown <prd_folder> <level>
is_warning_shown() {
  local prd_folder="$1"
  local level="$2"
  local warnings_file="$prd_folder/.budget-warnings-shown"

  if [[ -f "$warnings_file" ]]; then
    grep -q "^$level$" "$warnings_file" 2>/dev/null
  else
    return 1
  fi
}

# Mark a warning level as shown
# Usage: mark_warning_shown <prd_folder> <level>
mark_warning_shown() {
  local prd_folder="$1"
  local level="$2"
  local warnings_file="$prd_folder/.budget-warnings-shown"

  echo "$level" >> "$warnings_file"
}

# Clear warning markers (for new builds)
# Usage: clear_warning_markers <prd_folder>
clear_warning_markers() {
  local prd_folder="$1"
  local warnings_file="$prd_folder/.budget-warnings-shown"

  rm -f "$warnings_file"
}

# ============================================================================
# Budget Display Functions
# ============================================================================

# Format budget status for CLI display
# Usage: format_budget_status <current_cost> <limit>
# Output: Formatted string like "$3.80 / $5.00 (76%)"
format_budget_status() {
  local current_cost="$1"
  local limit="$2"

  local percentage
  percentage=$(calculate_budget_percentage "$current_cost" "$limit")

  printf '$%.2f / $%.2f (%d%%)' "$current_cost" "$limit" "$percentage"
}

# Display budget warning with appropriate color
# Usage: display_budget_warning <prd_folder> <current_cost>
# Requires: C_YELLOW, C_RED, C_RESET from output.sh
display_budget_warning() {
  local prd_folder="$1"
  local current_cost="$2"

  local limit
  limit=$(get_budget_limit "$prd_folder")

  if [[ -z "$limit" ]] || [[ "$limit" == "0" ]]; then
    return
  fi

  local threshold
  threshold=$(check_budget_threshold "$prd_folder" "$current_cost")
  local status
  status=$(format_budget_status "$current_cost" "$limit")

  case "$threshold" in
    warning_75)
      if ! is_warning_shown "$prd_folder" "warning_75"; then
        printf "${C_YELLOW:-}⚠ Budget 75%% threshold: %s${C_RESET:-}\n" "$status"
        # Log to events for UI visibility (US-008)
        if type log_event_warn &>/dev/null; then
          log_event_warn "$prd_folder" "Budget 75% threshold reached" "cost=$current_cost limit=$limit"
        fi
        mark_warning_shown "$prd_folder" "warning_75"
      fi
      ;;
    warning_90)
      if ! is_warning_shown "$prd_folder" "warning_90"; then
        printf "${C_YELLOW:-}⚠ Budget 90%% threshold: %s${C_RESET:-}\n" "$status"
        # Log to events for UI visibility (US-008)
        if type log_event_warn &>/dev/null; then
          log_event_warn "$prd_folder" "Budget 90% threshold reached" "cost=$current_cost limit=$limit"
        fi
        mark_warning_shown "$prd_folder" "warning_90"
      fi
      ;;
    exceeded)
      printf "${C_RED:-}⛔ Budget EXCEEDED: %s${C_RESET:-}\n" "$status"
      # Log to events for UI visibility (US-008)
      if ! is_warning_shown "$prd_folder" "exceeded_event"; then
        if type log_event_error &>/dev/null; then
          log_event_error "$prd_folder" "Budget limit exceeded" "cost=$current_cost limit=$limit"
        fi
        mark_warning_shown "$prd_folder" "exceeded_event"
      fi
      ;;
  esac
}

# ============================================================================
# Budget Enforcement Functions
# ============================================================================

# Prompt user to continue when budget exceeded
# Usage: prompt_budget_continue <prd_folder> <current_cost>
# Returns: 0 if user wants to continue, 1 if not
prompt_budget_continue() {
  local prd_folder="$1"
  local current_cost="$2"

  local limit
  limit=$(get_budget_limit "$prd_folder")
  local status
  status=$(format_budget_status "$current_cost" "$limit")

  echo ""
  printf "${C_RED:-}════════════════════════════════════════════════════════${C_RESET:-}\n"
  printf "${C_RED:-}  BUDGET LIMIT REACHED${C_RESET:-}\n"
  printf "${C_DIM:-}  %s${C_RESET:-}\n" "$status"
  printf "${C_RED:-}════════════════════════════════════════════════════════${C_RESET:-}\n"
  echo ""

  # Check if we're in interactive mode
  if [[ -t 0 ]]; then
    printf "Continue build despite budget limit? [y/N]: "
    read -r response
    case "$response" in
      [yY]|[yY][eE][sS])
        return 0
        ;;
      *)
        return 1
        ;;
    esac
  else
    # Non-interactive mode: don't continue
    printf "${C_YELLOW:-}Non-interactive mode: stopping at budget limit${C_RESET:-}\n"
    return 1
  fi
}

# Check budget and handle enforcement
# Usage: check_and_enforce_budget <prd_folder> <current_cost>
# Returns: 0 to continue, 1 to stop
check_and_enforce_budget() {
  local prd_folder="$1"
  local current_cost="$2"

  local limit
  limit=$(get_budget_limit "$prd_folder")

  # No budget set, continue
  if [[ -z "$limit" ]] || [[ "$limit" == "0" ]]; then
    return 0
  fi

  local threshold
  threshold=$(check_budget_threshold "$prd_folder" "$current_cost")

  # Display warning if applicable
  display_budget_warning "$prd_folder" "$current_cost"

  # Check if enforcement is needed
  if [[ "$threshold" == "exceeded" ]] && is_budget_enforced "$prd_folder"; then
    if ! is_warning_shown "$prd_folder" "exceeded_prompted"; then
      mark_warning_shown "$prd_folder" "exceeded_prompted"
      if ! prompt_budget_continue "$prd_folder" "$current_cost"; then
        return 1
      fi
    fi
  fi

  return 0
}

# ============================================================================
# Budget Update Functions
# ============================================================================

# Update budget file with current usage
# Usage: update_budget_usage <prd_folder> <current_cost>
update_budget_usage() {
  local prd_folder="$1"
  local current_cost="$2"
  local budget_file="$prd_folder/.budget.json"

  if [[ ! -f "$budget_file" ]]; then
    return
  fi

  # Read current config
  local limit warnings enforce
  limit=$(get_budget_limit "$prd_folder")

  # Get warnings array (default to [0.75, 0.90])
  warnings=$(grep -oE '"warnings":\s*\[[0-9., ]+\]' "$budget_file" | sed 's/.*\[/[/' || echo "[0.75, 0.90]")

  # Get enforce setting
  if is_budget_enforced "$prd_folder"; then
    enforce="true"
  else
    enforce="false"
  fi

  local percentage
  percentage=$(calculate_budget_percentage "$current_cost" "$limit")

  # Write updated budget file
  cat > "$budget_file" <<EOF
{
  "limit": $limit,
  "warnings": $warnings,
  "enforce": $enforce,
  "current_cost": $current_cost,
  "percentage_used": $percentage,
  "updated_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF
}
