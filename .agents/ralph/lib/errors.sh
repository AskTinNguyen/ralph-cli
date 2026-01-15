#!/bin/bash
# Error management utilities for ralph scripts
# Source this file to get error code helpers
#
# Requires: jq, output.sh (for msg_error, msg_dim)
# Usage:
#   source "${SCRIPT_DIR}/lib/errors.sh"
#   ralph_error "RALPH-001" "prd=/path/to/prd"

# ============================================================================
# Configuration
# ============================================================================

# Path to error registry
ERRORS_JSON="${ERRORS_JSON:-${SCRIPT_DIR}/lib/errors.json}"

# Auto-issue creation (disabled by default)
RALPH_AUTO_ISSUES="${RALPH_AUTO_ISSUES:-false}"
RALPH_ISSUE_DEDUP_HOURS="${RALPH_ISSUE_DEDUP_HOURS:-24}"

# ============================================================================
# Error lookup and display
# ============================================================================

# Emit error with code and message
# Usage: ralph_error RALPH-001 ["extra context"]
# This is the main function to use in loop.sh/stream.sh
ralph_error() {
  local code="$1"
  local context="${2:-}"

  # Validate code format
  if [[ ! "$code" =~ ^RALPH-[0-9]{3}$ ]]; then
    msg_error "Invalid error code format: $code"
    return 1
  fi

  # Get message from registry
  local msg
  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    msg=$(jq -r ".\"$code\".message // \"Unknown error\"" "$ERRORS_JSON" 2>/dev/null)
  else
    msg="Unknown error (registry not available)"
  fi

  # Display error
  msg_error "[$code] $msg"

  # Show context if provided
  if [ -n "$context" ]; then
    msg_dim "  Context: $context"
  fi

  # Show lookup hint
  msg_dim "  Run: ralph error $code"

  return 0
}

# Get error message by code
# Usage: error_msg=$(get_error_message "RALPH-001")
get_error_message() {
  local code="$1"

  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    jq -r ".\"$code\".message // \"\"" "$ERRORS_JSON" 2>/dev/null
  else
    echo ""
  fi
}

# Get error severity by code
# Usage: severity=$(get_error_severity "RALPH-001")
get_error_severity() {
  local code="$1"

  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    jq -r ".\"$code\".severity // \"error\"" "$ERRORS_JSON" 2>/dev/null
  else
    echo "error"
  fi
}

# Get error category by code
# Usage: category=$(get_error_category "RALPH-001")
get_error_category() {
  local code="$1"

  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    jq -r ".\"$code\".category // \"UNKNOWN\"" "$ERRORS_JSON" 2>/dev/null
  else
    echo "UNKNOWN"
  fi
}

# ============================================================================
# GitHub issue integration
# ============================================================================

# Check if error should trigger GitHub issue creation
# Usage: if should_create_issue "RALPH-001"; then ... fi
should_create_issue() {
  local code="$1"

  # Check if auto-issues are enabled
  if [ "$RALPH_AUTO_ISSUES" != "true" ]; then
    return 1
  fi

  # Check if error has auto_issue flag
  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    local auto_issue
    auto_issue=$(jq -r ".\"$code\".auto_issue // false" "$ERRORS_JSON" 2>/dev/null)
    [ "$auto_issue" = "true" ]
    return $?
  fi

  return 1
}

# Get GitHub labels for error code
# Usage: labels=$(get_error_labels "RALPH-001")
get_error_labels() {
  local code="$1"

  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    jq -r ".\"$code\".labels // [\"ralph-error\"] | join(\",\")" "$ERRORS_JSON" 2>/dev/null
  else
    echo "ralph-error"
  fi
}

# Create GitHub issue for error (uses Node.js module)
# Usage: create_github_issue "RALPH-001" "prd=PRD-1" "story=US-001" "/path/to/log"
create_github_issue() {
  local code="$1"
  local prd="${2:-}"
  local story="${3:-}"
  local log_path="${4:-}"

  # Only proceed if enabled
  if [ "$RALPH_AUTO_ISSUES" != "true" ]; then
    msg_dim "GitHub issue creation is disabled (RALPH_AUTO_ISSUES=false)"
    return 0
  fi

  # Check if should create issue for this error
  if ! should_create_issue "$code"; then
    msg_dim "Error $code is not configured for auto-issue creation"
    return 0
  fi

  # Use Node.js module for actual issue creation
  if command -v node &>/dev/null; then
    local script_path="${SCRIPT_DIR}/../../lib/github/issue.js"
    if [ -f "$script_path" ]; then
      node -e "
        const issue = require('$script_path');
        issue.createIssue('$code', {
          prd: '$prd',
          story: '$story',
          logPath: '$log_path'
        }).then(result => {
          if (result.success) {
            console.log('Created issue: ' + result.issueUrl);
          } else if (result.skipped) {
            console.log('Skipped: ' + result.error);
          } else {
            console.error('Failed: ' + result.error);
          }
        }).catch(err => {
          console.error('Error: ' + err.message);
        });
      "
    else
      msg_dim "Issue creation module not found at $script_path"
    fi
  else
    msg_dim "Node.js not available for issue creation"
  fi
}

# ============================================================================
# Error logging
# ============================================================================

# Log error to errors.log file
# Usage: log_error "RALPH-001" "context info" "/path/to/errors.log"
log_error() {
  local code="$1"
  local context="${2:-}"
  local log_file="${3:-${ERRORS_LOG_PATH:-}}"

  if [ -z "$log_file" ]; then
    return 0
  fi

  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  local msg
  msg=$(get_error_message "$code")

  # Append to log file
  mkdir -p "$(dirname "$log_file")"
  echo "[$timestamp] $code: $msg${context:+ | $context}" >> "$log_file"
}

# ============================================================================
# Error code validation
# ============================================================================

# Validate error code format
# Usage: if is_valid_error_code "RALPH-001"; then ... fi
is_valid_error_code() {
  local code="$1"
  [[ "$code" =~ ^RALPH-[0-9]{3}$ ]]
}

# Check if error code exists in registry
# Usage: if error_code_exists "RALPH-001"; then ... fi
error_code_exists() {
  local code="$1"

  if [ -f "$ERRORS_JSON" ] && command -v jq &>/dev/null; then
    jq -e ".\"$code\" != null" "$ERRORS_JSON" &>/dev/null
    return $?
  fi

  return 1
}

# ============================================================================
# Helper for error handling in scripts
# ============================================================================

# Handle error with code - logs, displays, and optionally creates issue
# Usage: handle_error "RALPH-001" "context" "/path/to/log" [exit_code]
handle_error() {
  local code="$1"
  local context="${2:-}"
  local log_path="${3:-}"
  local exit_code="${4:-1}"

  # Display error
  ralph_error "$code" "$context"

  # Log error
  if [ -n "${ERRORS_LOG_PATH:-}" ]; then
    log_error "$code" "$context" "$ERRORS_LOG_PATH"
  fi

  # Create GitHub issue if enabled
  if should_create_issue "$code"; then
    create_github_issue "$code" "${PRD_ID:-}" "${STORY_ID:-}" "$log_path"
  fi

  return "$exit_code"
}
