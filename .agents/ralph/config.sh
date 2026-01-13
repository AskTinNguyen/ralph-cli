# Optional Ralph config overrides.
# All paths are relative to repo root unless absolute.
# Uncomment and edit as needed.

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
