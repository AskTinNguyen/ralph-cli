# Optional Ralph config overrides.
# All paths are relative to repo root unless absolute.
# Uncomment and edit as needed.

# ─────────────────────────────────────────────────────────────────────────────
# Budget Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Set spending limits to control costs. Budget alerts are shown at 80%, 90%, 100%.
#
# Daily budget limit in USD (resets at midnight):
RALPH_BUDGET_DAILY=25.00

# Monthly budget limit in USD (resets on 1st of month):
RALPH_BUDGET_MONTHLY=500.00
#
# Alert threshold percentages (comma-separated):
# RALPH_BUDGET_ALERT_THRESHOLDS=80,90,100
#
# Pause builds when budget exceeded (true/false):
# RALPH_BUDGET_PAUSE_ON_EXCEEDED=false
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Retry Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Configure automatic retry behavior for transient agent failures.
# When an agent call fails, Ralph will automatically retry with exponential backoff.
#
# Maximum number of retry attempts (default: 3):
# RETRY_MAX_ATTEMPTS=3
#
# Base delay in milliseconds for exponential backoff (default: 1000ms):
# RETRY_BASE_DELAY_MS=1000
#
# Maximum delay cap in milliseconds (default: 16000ms):
# RETRY_MAX_DELAY_MS=16000
#
# Disable retries entirely (set via --no-retry flag or env var):
# NO_RETRY=false
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Token Cost Pricing (per 1M tokens in USD)
# ─────────────────────────────────────────────────────────────────────────────
# Override default Claude pricing. Values are per 1 million tokens.
#
# Global override (applies when model is unknown or as fallback):
# CLAUDE_PRICING_INPUT=3.00
# CLAUDE_PRICING_OUTPUT=15.00
#
# Per-model overrides (2025 defaults shown):
# CLAUDE_OPUS_INPUT=15.00
# CLAUDE_OPUS_OUTPUT=75.00
# CLAUDE_SONNET_INPUT=3.00
# CLAUDE_SONNET_OUTPUT=15.00
# CLAUDE_HAIKU_INPUT=0.25
# CLAUDE_HAIKU_OUTPUT=1.25
#
# Default model to use for cost calculation when not detected:
# CLAUDE_MODEL=sonnet
# ─────────────────────────────────────────────────────────────────────────────

# PRD_PATH=".agents/tasks/prd.md"
# PLAN_PATH=".ralph/IMPLEMENTATION_PLAN.md"
# PROGRESS_PATH=".ralph/progress.md"
# GUARDRAILS_PATH=".ralph/guardrails.md"
# ERRORS_LOG_PATH=".ralph/errors.log"
# ACTIVITY_LOG_PATH=".ralph/activity.log"
# TMP_DIR=".ralph/.tmp"
# RUNS_DIR=".ralph/runs"
# GUARDRAILS_REF=".agents/ralph/references/GUARDRAILS.md"
# CONTEXT_REF=".agents/ralph/references/CONTEXT_ENGINEERING.md"
# ACTIVITY_CMD=".agents/ralph/log-activity.sh"
# AGENT_CMD defaults are defined in agents.sh. Override here if needed.
# AGENT_CMD="codex exec --yolo --skip-git-repo-check -"
# PRD_AGENT_CMD defaults are defined in agents.sh (interactive).
# PRD_AGENT_CMD="codex --yolo --skip-git-repo-check {prompt}"
# AGENT_CMD="claude -p --dangerously-skip-permissions \"\$(cat {prompt})\""
# AGENT_CMD="droid exec --skip-permissions-unsafe -f {prompt}"
# AGENTS_PATH="AGENTS.md"
# PROMPT_PLAN=".agents/ralph/PROMPT_plan.md"
# PROMPT_BUILD=".agents/ralph/PROMPT_build.md"
# NO_COMMIT=false
# MAX_ITERATIONS=25
