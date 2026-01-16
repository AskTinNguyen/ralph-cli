#!/bin/bash
# Notification module for multi-channel notifications (US-012)
# Supports: CLI (always enabled), Slack, Discord, Webhooks

# ============================================================================
# Configuration
# ============================================================================

# Notification config file path
NOTIFY_CONFIG="${RALPH_NOTIFY_CONFIG:-.agents/ralph/notify.config.js}"

# Enable/disable notifications globally
NOTIFY_ENABLED="${RALPH_NOTIFY_ENABLED:-true}"

# ============================================================================
# CLI Notification (Always Enabled)
# ============================================================================

# Display notification in CLI with visual formatting
# Usage: notify_cli <event_type> <message> [details]
# event_type: "build_start", "build_complete", "build_failed", "stalled", "needs_human"
notify_cli() {
  local event_type="$1"
  local message="$2"
  local details="${3:-}"

  # Get colors (use defaults if not defined)
  local c_green="${C_GREEN:-\033[32m}"
  local c_red="${C_RED:-\033[31m}"
  local c_yellow="${C_YELLOW:-\033[33m}"
  local c_cyan="${C_CYAN:-\033[36m}"
  local c_dim="${C_DIM:-\033[2m}"
  local c_bold="${C_BOLD:-\033[1m}"
  local c_reset="${C_RESET:-\033[0m}"

  local icon=""
  local color=""
  local title=""

  case "$event_type" in
    build_start)
      icon="🚀"
      color="$c_cyan"
      title="BUILD STARTED"
      ;;
    build_complete)
      icon="✓"
      color="$c_green"
      title="BUILD COMPLETED"
      ;;
    build_failed)
      icon="✗"
      color="$c_red"
      title="BUILD FAILED"
      ;;
    stalled)
      icon="⚠"
      color="$c_yellow"
      title="BUILD STALLED"
      ;;
    needs_human)
      icon="🆘"
      color="$c_red"
      title="NEEDS HUMAN INTERVENTION"
      ;;
    story_complete)
      icon="📋"
      color="$c_green"
      title="STORY COMPLETED"
      ;;
    *)
      icon="ℹ"
      color="$c_dim"
      title="NOTIFICATION"
      ;;
  esac

  printf "\n%b═══════════════════════════════════════════════════════%b\n" "$color" "$c_reset"
  printf "%b  %s %s%b\n" "$color" "$icon" "$title" "$c_reset"
  printf "%b  %s%b\n" "$c_bold" "$message" "$c_reset"
  if [[ -n "$details" ]]; then
    printf "%b  %s%b\n" "$c_dim" "$details" "$c_reset"
  fi
  printf "%b═══════════════════════════════════════════════════════%b\n\n" "$color" "$c_reset"
}

# ============================================================================
# Event Payload Builder
# ============================================================================

# Build notification payload JSON
# Usage: build_notification_payload <event_type> <prd_num> <message> [details_json]
build_notification_payload() {
  local event_type="$1"
  local prd_num="$2"
  local message="$3"
  local details_json="${4:-{}}"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  # Get git info if available
  local git_branch=""
  local git_sha=""
  if command -v git &>/dev/null && [[ -d .git ]]; then
    git_branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    git_sha=$(git rev-parse --short HEAD 2>/dev/null || echo "")
  fi

  cat <<EOF
{
  "event": "$event_type",
  "prd_num": "$prd_num",
  "message": "$message",
  "timestamp": "$timestamp",
  "branch": "$git_branch",
  "commit": "$git_sha",
  "details": $details_json
}
EOF
}

# ============================================================================
# Slack Notification
# ============================================================================

# Send Slack notification via webhook
# Usage: notify_slack <webhook_url> <event_type> <prd_num> <message> [channel] [details]
notify_slack() {
  local webhook_url="$1"
  local event_type="$2"
  local prd_num="$3"
  local message="$4"
  local channel="${5:-}"
  local details="${6:-}"

  if [[ -z "$webhook_url" ]]; then
    return 0  # Graceful skip if no webhook
  fi

  # Determine emoji and color based on event type
  local emoji=""
  local color=""
  case "$event_type" in
    build_start) emoji=":rocket:"; color="#36a64f" ;;
    build_complete) emoji=":white_check_mark:"; color="#2eb886" ;;
    build_failed) emoji=":x:"; color="#dc3545" ;;
    stalled) emoji=":warning:"; color="#f0ad4e" ;;
    needs_human) emoji=":sos:"; color="#dc3545" ;;
    story_complete) emoji=":clipboard:"; color="#2eb886" ;;
    *) emoji=":information_source:"; color="#0d6efd" ;;
  esac

  # Build Slack payload
  local payload
  payload=$(cat <<EOF
{
  "text": "$emoji PRD-$prd_num: $message",
  ${channel:+"\"channel\": \"$channel\","}
  "attachments": [
    {
      "color": "$color",
      "title": "Ralph Build Notification",
      "text": "$message",
      "fields": [
        {"title": "PRD", "value": "PRD-$prd_num", "short": true},
        {"title": "Event", "value": "$event_type", "short": true}
        ${details:+,{"title": "Details", "value": "$details", "short": false}}
      ],
      "footer": "Ralph CLI",
      "ts": $(date +%s)
    }
  ]
}
EOF
)

  # Send webhook request
  if ! curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$webhook_url" > /dev/null 2>&1; then
    # Log failure but don't block build
    if type log_event_warn &>/dev/null; then
      log_event_warn "" "Slack notification failed" "prd=$prd_num event=$event_type"
    fi
    return 1
  fi
  return 0
}

# ============================================================================
# Discord Notification
# ============================================================================

# Send Discord notification via webhook
# Usage: notify_discord <webhook_url> <event_type> <prd_num> <message> [details]
notify_discord() {
  local webhook_url="$1"
  local event_type="$2"
  local prd_num="$3"
  local message="$4"
  local details="${5:-}"

  if [[ -z "$webhook_url" ]]; then
    return 0  # Graceful skip if no webhook
  fi

  # Determine color based on event type (Discord uses decimal)
  local color=""
  case "$event_type" in
    build_start) color="3066993" ;;   # Green
    build_complete) color="3066993" ;; # Green
    build_failed) color="15158332" ;;  # Red
    stalled) color="15105570" ;;       # Orange
    needs_human) color="15158332" ;;   # Red
    story_complete) color="3066993" ;; # Green
    *) color="3447003" ;;              # Blue
  esac

  # Build Discord payload
  local payload
  payload=$(cat <<EOF
{
  "content": "PRD-$prd_num: $message",
  "embeds": [
    {
      "title": "Ralph Build Notification",
      "description": "$message",
      "color": $color,
      "fields": [
        {"name": "PRD", "value": "PRD-$prd_num", "inline": true},
        {"name": "Event", "value": "$event_type", "inline": true}
        ${details:+,{"name": "Details", "value": "$details", "inline": false}}
      ],
      "footer": {"text": "Ralph CLI"},
      "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    }
  ]
}
EOF
)

  # Send webhook request
  if ! curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$webhook_url" > /dev/null 2>&1; then
    # Log failure but don't block build
    if type log_event_warn &>/dev/null; then
      log_event_warn "" "Discord notification failed" "prd=$prd_num event=$event_type"
    fi
    return 1
  fi
  return 0
}

# ============================================================================
# Generic Webhook Notification
# ============================================================================

# Send notification to generic webhook endpoint
# Usage: notify_webhook <webhook_url> <event_type> <prd_num> <message> [details_json]
notify_webhook() {
  local webhook_url="$1"
  local event_type="$2"
  local prd_num="$3"
  local message="$4"
  local details_json="${5:-{}}"

  if [[ -z "$webhook_url" ]]; then
    return 0  # Graceful skip if no webhook
  fi

  # Build standard payload
  local payload
  payload=$(build_notification_payload "$event_type" "$prd_num" "$message" "$details_json")

  # Send webhook request
  if ! curl -s -X POST -H "Content-Type: application/json" -d "$payload" "$webhook_url" > /dev/null 2>&1; then
    # Log failure but don't block build
    if type log_event_warn &>/dev/null; then
      log_event_warn "" "Webhook notification failed" "prd=$prd_num event=$event_type url=$webhook_url"
    fi
    return 1
  fi
  return 0
}

# ============================================================================
# Email Notification
# ============================================================================

# Send notification via email
# Usage: notify_email <email> <event_type> <prd_num> <message> [details]
notify_email() {
  local email="$1"
  local event_type="$2"
  local prd_num="$3"
  local message="$4"
  local details="${5:-}"

  if [[ -z "$email" ]]; then
    return 0  # Graceful skip if no email
  fi

  # Determine subject based on event type
  local subject=""
  case "$event_type" in
    build_start) subject="[Ralph] Build Started - PRD-$prd_num" ;;
    build_complete) subject="[Ralph] Build Completed - PRD-$prd_num" ;;
    build_failed) subject="[Ralph] Build Failed - PRD-$prd_num" ;;
    stalled) subject="[Ralph] Build Stalled - PRD-$prd_num" ;;
    needs_human) subject="[Ralph] Needs Human Intervention - PRD-$prd_num" ;;
    story_complete) subject="[Ralph] Story Completed - PRD-$prd_num" ;;
    *) subject="[Ralph] Notification - PRD-$prd_num" ;;
  esac

  # Build email body
  local body
  body=$(cat <<EOF
Ralph Build Notification
========================

Event: $event_type
PRD: PRD-$prd_num
Message: $message

${details:+Details: $details}

Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")

---
Ralph CLI - Autonomous Coding Loop
EOF
)

  # Try sending via mail command (most common)
  if command -v mail &>/dev/null; then
    if ! echo "$body" | mail -s "$subject" "$email" 2>/dev/null; then
      # Log failure but don't block build
      if type log_event_warn &>/dev/null; then
        log_event_warn "" "Email notification failed (mail command)" "prd=$prd_num event=$event_type to=$email"
      fi
      return 1
    fi
    return 0
  fi

  # Try sendmail if available
  if command -v sendmail &>/dev/null; then
    local from_addr="${RALPH_EMAIL_FROM:-ralph-cli@localhost}"
    local email_content
    email_content=$(cat <<EOF
To: $email
From: $from_addr
Subject: $subject
Content-Type: text/plain; charset=UTF-8

$body
EOF
)
    if ! echo "$email_content" | sendmail -t 2>/dev/null; then
      if type log_event_warn &>/dev/null; then
        log_event_warn "" "Email notification failed (sendmail)" "prd=$prd_num event=$event_type to=$email"
      fi
      return 1
    fi
    return 0
  fi

  # No email command available
  if type log_event_warn &>/dev/null; then
    log_event_warn "" "Email notification skipped (no mail/sendmail)" "prd=$prd_num event=$event_type"
  fi
  return 1
}

# ============================================================================
# Main Notification Function
# ============================================================================

# Send notification to all configured channels
# Usage: send_notification <event_type> <prd_folder> <message> [details]
# Reads configuration from environment or notify.conf
send_notification() {
  local event_type="$1"
  local prd_folder="$2"
  local message="$3"
  local details="${4:-}"

  # Check if notifications are enabled
  if [[ "$NOTIFY_ENABLED" != "true" ]]; then
    return 0
  fi

  # Extract PRD number from folder path
  local prd_num=""
  if [[ "$prd_folder" =~ PRD-([0-9]+) ]]; then
    prd_num="${BASH_REMATCH[1]}"
  fi

  # 1. CLI notification (always enabled)
  notify_cli "$event_type" "$message" "$details"

  # 2. Slack notification (if configured)
  local slack_webhook="${SLACK_WEBHOOK:-$SLACK_WEBHOOK_URL:-}"
  local slack_channel="${SLACK_CHANNEL:-}"
  if [[ -n "$slack_webhook" ]]; then
    notify_slack "$slack_webhook" "$event_type" "$prd_num" "$message" "$slack_channel" "$details" &
  fi

  # 3. Discord notification (if configured)
  local discord_webhook="${DISCORD_WEBHOOK:-$DISCORD_WEBHOOK_URL:-}"
  if [[ -n "$discord_webhook" ]]; then
    notify_discord "$discord_webhook" "$event_type" "$prd_num" "$message" "$details" &
  fi

  # 4. Generic webhook (if configured)
  local generic_webhook="${RALPH_NOTIFY_WEBHOOK:-}"
  if [[ -n "$generic_webhook" ]]; then
    local details_json="{}"
    if [[ -n "$details" ]]; then
      details_json="{\"text\": \"$details\"}"
    fi
    notify_webhook "$generic_webhook" "$event_type" "$prd_num" "$message" "$details_json" &
  fi

  # 5. Email notification (if configured)
  local email_to="${RALPH_NOTIFY_EMAIL:-}"
  if [[ -n "$email_to" ]]; then
    notify_email "$email_to" "$event_type" "$prd_num" "$message" "$details" &
  fi

  # Wait for background notifications (with timeout to prevent blocking)
  wait 2>/dev/null || true

  return 0
}

# ============================================================================
# Event-Specific Helpers
# ============================================================================

# Notify build started
# Usage: notify_build_start <prd_folder> [iterations]
notify_build_start() {
  local prd_folder="$1"
  local iterations="${2:-}"
  local details=""
  if [[ -n "$iterations" ]]; then
    details="Iterations: $iterations"
  fi
  send_notification "build_start" "$prd_folder" "Build started" "$details"
}

# Notify build completed
# Usage: notify_build_complete <prd_folder> <stories_completed> <duration> [cost]
notify_build_complete() {
  local prd_folder="$1"
  local stories_completed="$2"
  local duration="$3"
  local cost="${4:-}"

  # Format duration
  local duration_fmt
  if [[ "$duration" -lt 60 ]]; then
    duration_fmt="${duration}s"
  elif [[ "$duration" -lt 3600 ]]; then
    duration_fmt="$((duration / 60))m $((duration % 60))s"
  else
    duration_fmt="$((duration / 3600))h $((duration % 3600 / 60))m"
  fi

  local details="Stories: $stories_completed | Duration: $duration_fmt"
  if [[ -n "$cost" ]]; then
    details="$details | Cost: \$$cost"
  fi
  send_notification "build_complete" "$prd_folder" "Build completed successfully" "$details"
}

# Notify build failed
# Usage: notify_build_failed <prd_folder> <reason> [story_id]
notify_build_failed() {
  local prd_folder="$1"
  local reason="$2"
  local story_id="${3:-}"

  local details="Reason: $reason"
  if [[ -n "$story_id" ]]; then
    details="Story: $story_id | $details"
  fi
  send_notification "build_failed" "$prd_folder" "Build failed" "$details"
}

# Notify stalled build
# Usage: notify_stalled <prd_folder> <heartbeat_age> [story_id]
notify_stalled() {
  local prd_folder="$1"
  local heartbeat_age="$2"
  local story_id="${3:-}"

  local details="No activity for ${heartbeat_age}s"
  if [[ -n "$story_id" ]]; then
    details="Story: $story_id | $details"
  fi
  send_notification "stalled" "$prd_folder" "Build stalled - no recent activity" "$details"
}

# Notify needs human intervention
# Usage: notify_needs_human <prd_folder> <reason> [story_id]
notify_needs_human() {
  local prd_folder="$1"
  local reason="$2"
  local story_id="${3:-}"

  local details="Reason: $reason"
  if [[ -n "$story_id" ]]; then
    details="Story: $story_id | $details"
  fi
  send_notification "needs_human" "$prd_folder" "Human intervention required" "$details"
}

# Notify story completed
# Usage: notify_story_complete <prd_folder> <story_id> <story_title> [duration]
notify_story_complete() {
  local prd_folder="$1"
  local story_id="$2"
  local story_title="$3"
  local duration="${4:-}"

  local details="$story_id: $story_title"
  if [[ -n "$duration" ]]; then
    details="$details (${duration}s)"
  fi
  send_notification "story_complete" "$prd_folder" "Story completed" "$details"
}

# ============================================================================
# Test Function
# ============================================================================

# Send test notification to verify configuration
# Usage: notify_test [prd_folder]
notify_test() {
  local prd_folder="${1:-.ralph/PRD-0}"

  echo "Sending test notifications..."
  echo ""

  # Test CLI
  echo "1. CLI notification (always enabled):"
  notify_cli "build_complete" "Test notification from ralph notify test" "This is a test message"

  # Test Slack
  local slack_webhook="${SLACK_WEBHOOK:-$SLACK_WEBHOOK_URL:-}"
  if [[ -n "$slack_webhook" ]]; then
    echo "2. Slack notification:"
    if notify_slack "$slack_webhook" "build_complete" "0" "Test notification from ralph notify test"; then
      echo "   ✓ Slack notification sent"
    else
      echo "   ✗ Slack notification failed"
    fi
  else
    echo "2. Slack: Not configured (set SLACK_WEBHOOK)"
  fi

  # Test Discord
  local discord_webhook="${DISCORD_WEBHOOK:-$DISCORD_WEBHOOK_URL:-}"
  if [[ -n "$discord_webhook" ]]; then
    echo "3. Discord notification:"
    if notify_discord "$discord_webhook" "build_complete" "0" "Test notification from ralph notify test"; then
      echo "   ✓ Discord notification sent"
    else
      echo "   ✗ Discord notification failed"
    fi
  else
    echo "3. Discord: Not configured (set DISCORD_WEBHOOK)"
  fi

  # Test generic webhook
  local generic_webhook="${RALPH_NOTIFY_WEBHOOK:-}"
  if [[ -n "$generic_webhook" ]]; then
    echo "4. Generic webhook:"
    if notify_webhook "$generic_webhook" "build_complete" "0" "Test notification from ralph notify test"; then
      echo "   ✓ Webhook notification sent"
    else
      echo "   ✗ Webhook notification failed"
    fi
  else
    echo "4. Generic webhook: Not configured (set RALPH_NOTIFY_WEBHOOK)"
  fi

  # Test email
  local email_to="${RALPH_NOTIFY_EMAIL:-}"
  if [[ -n "$email_to" ]]; then
    echo "5. Email notification:"
    if notify_email "$email_to" "build_complete" "0" "Test notification from ralph notify test"; then
      echo "   ✓ Email notification sent to $email_to"
    else
      echo "   ✗ Email notification failed"
    fi
  else
    echo "5. Email: Not configured (set RALPH_NOTIFY_EMAIL)"
  fi

  echo ""
  echo "Test complete."
}
