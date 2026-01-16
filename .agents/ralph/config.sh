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
# Rollback Configuration (US-001)
# ─────────────────────────────────────────────────────────────────────────────
# Configure automatic rollback behavior when test failures are detected.
# When tests fail, Ralph can automatically revert to pre-story git state.
#
# Enable/disable automatic rollback on test failure (default: true):
ROLLBACK_ENABLED=true
#
# Note: Rollback is disabled when using --no-commit flag.
# Error context is preserved in .ralph/PRD-N/runs/failure-context-*.log
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Intelligent Retry Configuration (US-002)
# ─────────────────────────────────────────────────────────────────────────────
# Configure automatic retry behavior after rollback.
# When a story fails and is rolled back, Ralph can retry with enhanced context.
#
# Maximum retry attempts per story before giving up (default: 3):
ROLLBACK_MAX_RETRIES=3
#
# Enable/disable automatic retry after rollback (default: true):
ROLLBACK_RETRY_ENABLED=true
#
# Note: Retry uses PROMPT_retry.md template with failure context injected.
# Each retry includes: failure reason, previous approach analysis, and suggestions.
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Rollback Trigger Configuration (US-003)
# ─────────────────────────────────────────────────────────────────────────────
# Configure what types of failures trigger automatic rollback.
#
# Rollback trigger policy (choose one):
#   test-fail  - Only test failures (Jest, Pytest, Mocha, Go test, Vitest, etc.)
#   lint-fail  - Only lint failures (ESLint, Prettier, Ruff, Pylint, etc.)
#   type-fail  - Only type check failures (TypeScript, mypy, pyright, etc.)
#   any-fail   - Any non-zero exit code triggers rollback (most aggressive)
#
# Default: test-fail (most conservative, only rollback on test failures)
ROLLBACK_TRIGGER=test-fail
#
# Override via CLI: ralph build 1 --rollback-trigger=any-fail
# Disable rollback via CLI: ralph build 1 --no-rollback
#
# Story-level skip: Add <!-- no-rollback --> to a story block in the PRD
# to exclude that specific story from rollback even if failures occur.
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Risk Assessment Configuration (US-004)
# ─────────────────────────────────────────────────────────────────────────────
# Configure risk assessment thresholds and behavior.
# Risk scoring analyzes stories for security, payment, database, and other
# high-impact changes. High-risk stories are flagged for human review.
#
# Risk threshold: scores at or above this value are considered "high risk"
# Range: 1-10, where 10 is maximum risk. Default: 7
RALPH_RISK_THRESHOLD=7
#
# Pause execution for high-risk stories (true/false):
# When true, prompts user for confirmation before executing high-risk stories
RALPH_RISK_PAUSE=true
#
# Override via CLI: ralph build 1 --skip-risk-check
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Model Routing Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Automatically select Claude model based on task complexity.
#
# Enable/disable complexity-based model routing (default: true):
# Set to false to always use RALPH_DEFAULT_MODEL
RALPH_ROUTING_ENABLED=false
#
# ─────────────────────────────────────────────────────────────────────────────
# Model Selection per Complexity Tier
# ─────────────────────────────────────────────────────────────────────────────
# Customize which Claude model to use for each complexity level.
# Options: haiku (fastest/cheapest), sonnet (balanced), opus (most capable)
#
# Model for LOW complexity tasks (score 1-3):
# Simple fixes, documentation, typos
RALPH_LOW_COMPLEXITY_MODEL=opus
#
# Model for MEDIUM complexity tasks (score 4-7):
# Features, refactoring, moderate changes
RALPH_MEDIUM_COMPLEXITY_MODEL=opus
#
# Model for HIGH complexity tasks (score 8-10):
# Architecture, new systems, complex multi-file changes
RALPH_HIGH_COMPLEXITY_MODEL=opus
#
# ─────────────────────────────────────────────────────────────────────────────
# Complexity Score Thresholds (Advanced)
# ─────────────────────────────────────────────────────────────────────────────
# Customize the complexity score boundaries between tiers:
# RALPH_HAIKU_MAX_COMPLEXITY=3    # Scores 1-3 use LOW model
# RALPH_SONNET_MAX_COMPLEXITY=7   # Scores 4-7 use MEDIUM model
#                                  # Scores 8-10 use HIGH model
#
# Default model when routing is disabled or unavailable:
RALPH_DEFAULT_MODEL=opus
#
# Override model selection via CLI: ralph build 1 --model=opus
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Agent Switching Configuration (Failure Pattern Detection)
# ─────────────────────────────────────────────────────────────────────────────
# Configure automatic agent switching when failure patterns are detected.
# When an agent fails consecutively, Ralph can suggest or auto-switch to alternatives.
#
# Fallback chain order when switching agents (space-separated):
# IMPORTANT: When RALPH_ROUTING_ENABLED=true, only Claude agents are compatible
# with Claude models (haiku, sonnet, opus). Non-Claude agents (codex, droid)
# will auto-disable routing and use their own model selection.
#
# For Claude model routing: use "claude" only
# For mixed agents: use "claude codex droid" (routing auto-disabled for non-Claude)
AGENT_FALLBACK_CHAIN="claude"
#
# Number of consecutive failures before triggering switch suggestion (default: 2):
AGENT_SWITCH_THRESHOLD=2
#
# Enable switching on timeout failures (exit code 124/137) (default: true):
AGENT_SWITCH_ON_TIMEOUT=true
#
# Enable switching on general errors (exit code 1) (default: true):
AGENT_SWITCH_ON_ERROR=true
#
# Enable switching on quality failures (test/lint/type errors) (default: false):
# Note: Quality failures are more conservative - they may be code issues not agent issues
AGENT_SWITCH_ON_QUALITY=false
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

# ─────────────────────────────────────────────────────────────────────────────
# Timing Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Configure delays and intervals for the build loop.
#
# Delay between iterations in seconds (default: 0, no delay):
# Use this to add a pause between build iterations for rate limiting or cooling.
# ITERATION_DELAY=0
#
# Progress update interval in seconds (default: 30):
# How often to show "still running" messages during long-running agent calls.
# PROGRESS_INTERVAL=30
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Merge Policy Configuration
# ─────────────────────────────────────────────────────────────────────────────
# Control merge behavior for worktree branches to main.
#
# Require explicit human confirmation before merging (default: true):
# When enabled, `ralph stream merge N` will prompt for confirmation before merging.
# Use --yes flag to skip confirmation: `ralph stream merge N --yes`
RALPH_MERGE_REQUIRE_CONFIRM=true
#
# CRITICAL: Ralph NEVER auto-merges on build completion.
# Merges must be triggered explicitly via `ralph stream merge N` command.
# This is a core safety guarantee and cannot be overridden.
#
# Override via CLI: ralph stream merge N --yes
# ─────────────────────────────────────────────────────────────────────────────

# ─────────────────────────────────────────────────────────────────────────────
# Sequential Mode Configuration (Contamination Prevention)
# ─────────────────────────────────────────────────────────────────────────────
# Enable sequential mode for projects that cannot use worktrees (e.g., large repos).
# When enabled, only ONE PRD can build at a time, preventing context contamination.
#
# Enable sequential mode (default: false):
# Set to true for large repos that cannot use worktrees (disk space constraints).
# This enforces one-at-a-time PRD builds and prevents parallel execution.
# RALPH_SEQUENTIAL_MODE=false
#
# Enable scope validation (default: false):
# When enabled, validates that agent only modified files within PRD scope.
# Rolls back iteration if contamination detected (agent accessed other PRDs).
# Recommended when RALPH_SEQUENTIAL_MODE=true.
# RALPH_VALIDATE_SCOPE=false
#
# Enforce strict PRD ordering (default: false):
# When enabled, PRD-N cannot start until PRD-(N-1) is completed.
# Example: Cannot build PRD-3 until PRD-2 is merged/completed.
# Only useful for workflows requiring strict sequential completion.
# RALPH_ENFORCE_ORDER=false
#
# Note: Worktrees provide strongest isolation and are recommended when possible.
# Sequential mode is for projects where worktrees are not feasible.
# ─────────────────────────────────────────────────────────────────────────────
