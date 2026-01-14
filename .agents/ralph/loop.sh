#!/bin/bash
# Ralph loop — simple, portable, single-agent
# Usage:
#   ./.agents/ralph/loop.sh                 # build mode, default iterations
#   ./.agents/ralph/loop.sh build           # build mode
#   ./.agents/ralph/loop.sh plan            # plan mode (default 1 iteration)
#   ./.agents/ralph/loop.sh plan 3          # plan mode, 3 iterations
#   ./.agents/ralph/loop.sh prd "request"   # generate PRD via agent
#   ./.agents/ralph/loop.sh 10              # build mode, 10 iterations
#   ./.agents/ralph/loop.sh build 1 --no-commit

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${RALPH_ROOT:-${SCRIPT_DIR}/../..}" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.sh"

# Source shared output utilities (colors and msg_* functions)
# shellcheck source=lib/output.sh
source "$SCRIPT_DIR/lib/output.sh"

# PRD folder helpers - sourced from shared library
# Sets RALPH_DIR and provides: get_next_prd_number, get_latest_prd_number, get_prd_dir
RALPH_DIR=".ralph"
# shellcheck source=lib/prd-utils.sh
source "$SCRIPT_DIR/lib/prd-utils.sh"

# Git helper functions - sourced from shared library
# Provides: git_head, git_commit_list, git_changed_files, git_dirty_files
# shellcheck source=lib/git-utils.sh
source "$SCRIPT_DIR/lib/git-utils.sh"

# Retry utilities - sourced from shared library
# Provides: calculate_backoff_delay, run_agent_with_retry
# Configuration: RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, RETRY_MAX_DELAY_MS, NO_RETRY
# Global stats: LAST_RETRY_COUNT, LAST_RETRY_TOTAL_TIME
# Note: Depends on run_agent and log_activity which are defined later in this file
# shellcheck source=lib/retry.sh
source "$SCRIPT_DIR/lib/retry.sh"

# Determine active PRD number from env or auto-detect
if [[ -n "${PRD_NUMBER:-}" ]]; then
  ACTIVE_PRD_NUMBER="$PRD_NUMBER"
elif [[ -n "${PRD_PATH:-}" ]]; then
  # Extract number from path if provided (e.g., .ralph/PRD-1/prd.md -> 1)
  # Handle both PRD-N and prd-N (legacy)
  if [[ "$PRD_PATH" =~ [Pp][Rr][Dd]-([0-9]+) ]]; then
    ACTIVE_PRD_NUMBER="${BASH_REMATCH[1]}"
  else
    ACTIVE_PRD_NUMBER=""
  fi
else
  ACTIVE_PRD_NUMBER=""
fi

# Default paths use PRD-N folder structure
DEFAULT_AGENTS_PATH="AGENTS.md"
DEFAULT_PROMPT_PLAN=".agents/ralph/PROMPT_plan.md"
DEFAULT_PROMPT_BUILD=".agents/ralph/PROMPT_build.md"
DEFAULT_PROMPT_RETRY=".agents/ralph/PROMPT_retry.md"
DEFAULT_GUARDRAILS_PATH=".ralph/guardrails.md"
DEFAULT_ERRORS_LOG_PATH=".ralph/errors.log"
DEFAULT_ACTIVITY_LOG_PATH=".ralph/activity.log"
DEFAULT_TMP_DIR=".ralph/.tmp"
DEFAULT_RUNS_DIR=".ralph/runs"
DEFAULT_GUARDRAILS_REF=".agents/ralph/references/GUARDRAILS.md"
DEFAULT_CONTEXT_REF=".agents/ralph/references/CONTEXT_ENGINEERING.md"
DEFAULT_ACTIVITY_CMD=".agents/ralph/log-activity.sh"
if [[ -n "${RALPH_ROOT:-}" ]]; then
  agents_path="$RALPH_ROOT/.agents/ralph/agents.sh"
else
  agents_path="$SCRIPT_DIR/agents.sh"
fi
if [[ -f "$agents_path" ]]; then
  # shellcheck source=/dev/null
  source "$agents_path"
fi

DEFAULT_MAX_ITERATIONS=25
DEFAULT_NO_COMMIT=false
DEFAULT_ITERATION_DELAY=0
DEFAULT_PROGRESS_INTERVAL=30
PRD_REQUEST_PATH=""
PRD_INLINE=""

# Optional config overrides (simple shell vars)
if [[ -f "$CONFIG_FILE" ]]; then
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
fi

DEFAULT_AGENT_NAME="${DEFAULT_AGENT:-claude}"
resolve_agent_cmd() {
  local name="$1"
  case "$name" in
    codex)
      if [[ -n "${AGENT_CODEX_CMD:-}" ]]; then
        echo "$AGENT_CODEX_CMD"
      else
        echo "codex exec --yolo --skip-git-repo-check -"
      fi
      ;;
    droid)
      if [[ -n "${AGENT_DROID_CMD:-}" ]]; then
        echo "$AGENT_DROID_CMD"
      else
        echo "droid exec --skip-permissions-unsafe -f {prompt}"
      fi
      ;;
    claude|""|*)
      if [[ -n "${AGENT_CLAUDE_CMD:-}" ]]; then
        echo "$AGENT_CLAUDE_CMD"
      else
        echo "claude -p --dangerously-skip-permissions"
      fi
      ;;
  esac
}
DEFAULT_AGENT_CMD="$(resolve_agent_cmd "$DEFAULT_AGENT_NAME")"

# ─────────────────────────────────────────────────────────────────────────────
# Experiment Assignment
# ─────────────────────────────────────────────────────────────────────────────
# Global variables for experiment tracking (set by get_experiment_assignment)
EXPERIMENT_NAME=""
EXPERIMENT_VARIANT=""
EXPERIMENT_EXCLUDED=""

# Get experiment assignment for a story ID
# Uses hash-based assignment from lib/experiment/assignment.js
# Returns: EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED (pipe-delimited)
# Sets global vars: EXPERIMENT_NAME, EXPERIMENT_VARIANT, EXPERIMENT_EXCLUDED
get_experiment_assignment() {
  local story_id="$1"
  local assignment_script

  if [[ -n "${RALPH_ROOT:-}" ]]; then
    assignment_script="$RALPH_ROOT/lib/experiment/assignment.js"
  else
    assignment_script="$SCRIPT_DIR/../../lib/experiment/assignment.js"
  fi

  # Reset globals
  EXPERIMENT_NAME=""
  EXPERIMENT_VARIANT=""
  EXPERIMENT_EXCLUDED=""

  # Check if assignment module exists and Node.js is available
  if [[ ! -f "$assignment_script" ]] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  # Get assignment string from assignment module
  local assignment
  assignment=$(node -e "
    const assignment = require('$assignment_script');
    const result = assignment.getAssignmentString('$ROOT_DIR', '$story_id');
    process.stdout.write(result);
  " 2>/dev/null) || true

  if [[ -z "$assignment" ]]; then
    return 0
  fi

  # Parse assignment: EXPERIMENT_NAME|VARIANT_NAME|AGENT_NAME|EXCLUDED
  IFS='|' read -r exp_name exp_variant exp_agent exp_excluded <<< "$assignment"

  # Set globals
  EXPERIMENT_NAME="$exp_name"
  EXPERIMENT_VARIANT="$exp_variant"
  EXPERIMENT_EXCLUDED="$exp_excluded"

  # Override AGENT_CMD if experiment assigns a different agent
  if [[ -n "$exp_agent" ]] && [[ "$exp_agent" != "$DEFAULT_AGENT_NAME" ]]; then
    AGENT_CMD="$(resolve_agent_cmd "$exp_agent")"
    msg_dim "Experiment '$exp_name' assigned variant '$exp_variant' (agent: $exp_agent)"
  fi
}

# Path resolution with PRD-N folder support
# If explicit paths are set via environment, use them
# Otherwise, use PRD-N folder structure
if [[ -n "${PRD_PATH:-}" ]]; then
  # Explicit path provided - use it as-is
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  # PRD number specified - use that folder
  PRD_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/prd.md"
else
  # No path or number specified - will be set per-mode below
  PRD_PATH=""
fi

if [[ -n "${PLAN_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  PLAN_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/plan.md"
else
  PLAN_PATH=""
fi

if [[ -n "${PROGRESS_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  PROGRESS_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/progress.md"
else
  PROGRESS_PATH=""
fi
AGENTS_PATH="${AGENTS_PATH:-$DEFAULT_AGENTS_PATH}"
PROMPT_PLAN="${PROMPT_PLAN:-$DEFAULT_PROMPT_PLAN}"
PROMPT_BUILD="${PROMPT_BUILD:-$DEFAULT_PROMPT_BUILD}"
PROMPT_RETRY="${PROMPT_RETRY:-$DEFAULT_PROMPT_RETRY}"
GUARDRAILS_PATH="${GUARDRAILS_PATH:-$DEFAULT_GUARDRAILS_PATH}"

# ERRORS_LOG_PATH, ACTIVITY_LOG_PATH, RUNS_DIR should use PRD-N folder when specified
if [[ -n "${ERRORS_LOG_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  ERRORS_LOG_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/errors.log"
else
  ERRORS_LOG_PATH="$DEFAULT_ERRORS_LOG_PATH"
fi

if [[ -n "${ACTIVITY_LOG_PATH:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  ACTIVITY_LOG_PATH="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/activity.log"
else
  ACTIVITY_LOG_PATH="$DEFAULT_ACTIVITY_LOG_PATH"
fi

TMP_DIR="${TMP_DIR:-$DEFAULT_TMP_DIR}"

# Timing configuration (US-007)
ITERATION_DELAY="${ITERATION_DELAY:-$DEFAULT_ITERATION_DELAY}"

if [[ -n "${RUNS_DIR:-}" ]]; then
  :
elif [[ -n "$ACTIVE_PRD_NUMBER" ]]; then
  RUNS_DIR="$(get_prd_dir "$ACTIVE_PRD_NUMBER")/runs"
else
  RUNS_DIR="$DEFAULT_RUNS_DIR"
fi
GUARDRAILS_REF="${GUARDRAILS_REF:-$DEFAULT_GUARDRAILS_REF}"
CONTEXT_REF="${CONTEXT_REF:-$DEFAULT_CONTEXT_REF}"
ACTIVITY_CMD="${ACTIVITY_CMD:-$DEFAULT_ACTIVITY_CMD}"
AGENT_CMD="${AGENT_CMD:-$DEFAULT_AGENT_CMD}"
MAX_ITERATIONS="${MAX_ITERATIONS:-$DEFAULT_MAX_ITERATIONS}"
NO_COMMIT="${NO_COMMIT:-$DEFAULT_NO_COMMIT}"

abs_path() {
  local p="$1"
  # Return empty if input is empty
  if [[ -z "$p" ]]; then
    echo ""
  elif [[ "$p" = /* ]]; then
    echo "$p"
  else
    echo "$ROOT_DIR/$p"
  fi
}

PRD_PATH="$(abs_path "$PRD_PATH")"
PLAN_PATH="$(abs_path "$PLAN_PATH")"
PROGRESS_PATH="$(abs_path "$PROGRESS_PATH")"
AGENTS_PATH="$(abs_path "$AGENTS_PATH")"
PROMPT_PLAN="$(abs_path "$PROMPT_PLAN")"
PROMPT_BUILD="$(abs_path "$PROMPT_BUILD")"
PROMPT_RETRY="$(abs_path "$PROMPT_RETRY")"
GUARDRAILS_PATH="$(abs_path "$GUARDRAILS_PATH")"
ERRORS_LOG_PATH="$(abs_path "$ERRORS_LOG_PATH")"
ACTIVITY_LOG_PATH="$(abs_path "$ACTIVITY_LOG_PATH")"
TMP_DIR="$(abs_path "$TMP_DIR")"
RUNS_DIR="$(abs_path "$RUNS_DIR")"
GUARDRAILS_REF="$(abs_path "$GUARDRAILS_REF")"
CONTEXT_REF="$(abs_path "$CONTEXT_REF")"
ACTIVITY_CMD="$(abs_path "$ACTIVITY_CMD")"

require_agent() {
  local agent_cmd="${1:-$AGENT_CMD}"
  local agent_bin
  agent_bin="${agent_cmd%% *}"
  if [[ -z "$agent_bin" ]]; then
    msg_error "AGENT_CMD is empty. Set it in config.sh."
    exit 1
  fi
  if ! command -v "$agent_bin" >/dev/null 2>&1; then
    msg_error "Agent command not found: $agent_bin"
    case "$agent_bin" in
      codex)
        msg_info "Install: npm i -g @openai/codex"
        ;;
      claude)
        msg_info "Install: curl -fsSL https://claude.ai/install.sh | bash"
        ;;
      droid)
        msg_info "Install: curl -fsSL https://app.factory.ai/cli | sh"
        ;;
    esac
    msg_dim "Then authenticate per the CLI's instructions."
    exit 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Agent Execution Functions (US-006 - Safer eval alternatives)
# ─────────────────────────────────────────────────────────────────────────────
# SECURITY NOTE: These functions execute external agent commands with user input.
# The AGENT_CMD comes from trusted sources (agents.sh or config.sh), not user input.
# We use 'bash -c' instead of 'eval' where possible for improved safety.
# The prompt_file path is shell-escaped to prevent injection via filenames.
# ─────────────────────────────────────────────────────────────────────────────

run_agent() {
  local prompt_file="$1"

  # SECURITY: prompt_file is a temp file path controlled by ralph, not user input.
  # We still escape it for defense-in-depth against unusual filenames.

  if [[ "$AGENT_CMD" == *"{prompt}"* ]]; then
    # File-based agent (e.g., droid): substitute {prompt} with escaped file path
    # Use bash parameter expansion for substitution (safer than eval-based string building)
    local escaped_path
    escaped_path=$(printf '%q' "$prompt_file")
    local cmd="${AGENT_CMD//\{prompt\}/$escaped_path}"

    # SECURITY: bash -c provides process isolation; cmd contains trusted AGENT_CMD
    # with only the file path substituted. The file path is shell-escaped.
    bash -c "$cmd"
  else
    # Stdin-based agent (e.g., claude, codex): pipe prompt to agent via stdin
    # SECURITY: bash -c provides process isolation; AGENT_CMD is from trusted config.
    # Prompt content goes to stdin, not interpolated into the command.
    cat "$prompt_file" | bash -c "$AGENT_CMD"
  fi
}

run_agent_inline() {
  local prompt_file="$1"

  # SECURITY NOTE: This function is used for PRD generation with custom agent configs.
  # PRD_AGENT_CMD comes from trusted config (config.sh), not user input.
  # The prompt content comes from ralph-generated templates, also trusted.
  #
  # For agents with {prompt} placeholder expecting a FILE PATH (most common):
  #   Simply pass the file path (use run_agent instead for this case).
  # For agents expecting inline content as an argument (rare custom configs):
  #   We must use 'eval' because:
  #   1. The content may contain newlines, quotes, and shell metacharacters
  #   2. We need proper shell quoting to pass multi-line strings as arguments
  #   3. Using bash arrays would require different command formats

  if [[ "$PRD_AGENT_CMD" == *"{prompt}"* ]]; then
    # Check if this appears to be a file-path style command (contains -f or --file)
    # In that case, use file path directly instead of inline content
    if [[ "$PRD_AGENT_CMD" == *" -f "* ]] || [[ "$PRD_AGENT_CMD" == *"--file"* ]]; then
      # File-based agent: use file path directly (safer, no content escaping needed)
      local escaped_path
      escaped_path=$(printf '%q' "$prompt_file")
      local cmd="${PRD_AGENT_CMD//\{prompt\}/$escaped_path}"
      bash -c "$cmd"
    else
      # Inline content agent: substitute {prompt} with escaped content
      # SECURITY: eval is necessary here for proper shell quoting of multi-line content.
      # PRD_AGENT_CMD is from trusted config, content is from trusted templates.
      local prompt_content escaped_content cmd
      prompt_content="$(cat "$prompt_file")"
      escaped_content=$(printf "%s" "$prompt_content" | sed "s/'/'\\\\''/g")
      cmd="${PRD_AGENT_CMD//\{prompt\}/'$escaped_content'}"
      eval "$cmd"
    fi
  else
    # No {prompt} placeholder - pass content as final argument
    # SECURITY: eval is necessary for proper shell quoting of multi-line content.
    local prompt_content escaped_content
    prompt_content="$(cat "$prompt_file")"
    escaped_content=$(printf "%s" "$prompt_content" | sed "s/'/'\\\\''/g")
    eval "$PRD_AGENT_CMD '$escaped_content'"
  fi
}

# Global variables for rollback statistics (set during rollback execution, US-004)
# These are used by append_metrics for tracking rollback events
LAST_ROLLBACK_COUNT=0
LAST_ROLLBACK_REASON=""
LAST_ROLLBACK_SUCCESS=""

# Global variables for agent switch tracking (US-003)
# These are used by write_run_meta to record switches in run summary
LAST_SWITCH_COUNT=0
LAST_SWITCH_FROM=""
LAST_SWITCH_TO=""
LAST_SWITCH_REASON=""

# Global variable to track agents tried during this iteration (US-004)
# Comma-separated list of agent names (e.g., "claude,codex,droid")
AGENTS_TRIED_THIS_ITERATION=""

MODE="build"
RESUME_MODE="${RALPH_RESUME:-}"
while [ $# -gt 0 ]; do
  case "$1" in
    plan|build|prd)
      MODE="$1"
      shift
      ;;
    --prompt)
      PRD_REQUEST_PATH="$2"
      shift 2
      ;;
    --no-commit)
      NO_COMMIT=true
      shift
      ;;
    --no-rollback)
      ROLLBACK_ENABLED=false
      shift
      ;;
    --rollback-trigger=*)
      ROLLBACK_TRIGGER="${1#*=}"
      shift
      ;;
    --resume)
      RESUME_MODE="1"
      shift
      ;;
    *)
      if [[ "$MODE" = "prd" ]]; then
        PRD_INLINE="${PRD_INLINE:+$PRD_INLINE }$1"
        shift
      elif [[ "$1" =~ ^[0-9]+$ ]]; then
        MAX_ITERATIONS="$1"
        shift
      else
        msg_error "Unknown arg: $1"
        exit 1
      fi
      ;;
  esac
done
if [[ "$MODE" = "plan" ]] && [[ "$MAX_ITERATIONS" = "$DEFAULT_MAX_ITERATIONS" ]]; then
  MAX_ITERATIONS=1
fi

# Set up PRD-N folder paths based on mode
if [[ -z "$PRD_PATH" ]]; then
  if [[ "$MODE" = "prd" ]]; then
    # PRD mode: always create a new PRD-N folder
    NEW_PRD_NUM=$(get_next_prd_number)
    ACTIVE_PRD_NUMBER="$NEW_PRD_NUM"
    PRD_DIR="$(get_prd_dir "$NEW_PRD_NUM")"
    PRD_PATH="$PRD_DIR/prd.md"
    PLAN_PATH="$PRD_DIR/plan.md"
    PROGRESS_PATH="$PRD_DIR/progress.md"
    RUNS_DIR="$PRD_DIR/runs"
    ERRORS_LOG_PATH="$PRD_DIR/errors.log"
    ACTIVITY_LOG_PATH="$PRD_DIR/activity.log"
    msg_info "Creating new PRD folder: PRD-$NEW_PRD_NUM"
  else
    # plan/build mode: use latest PRD-N folder
    LATEST_PRD_NUM=$(get_latest_prd_number)
    if [[ -z "$LATEST_PRD_NUM" ]]; then
      msg_error "No PRD folder found. Run 'ralph prd' first to create one."
      exit 1
    fi
    ACTIVE_PRD_NUMBER="$LATEST_PRD_NUM"
    PRD_DIR="$(get_prd_dir "$LATEST_PRD_NUM")"
    PRD_PATH="$PRD_DIR/prd.md"
    if [[ -z "$PLAN_PATH" ]]; then
      PLAN_PATH="$PRD_DIR/plan.md"
    fi
    if [[ -z "$PROGRESS_PATH" ]]; then
      PROGRESS_PATH="$PRD_DIR/progress.md"
    fi
    RUNS_DIR="${RUNS_DIR:-$PRD_DIR/runs}"
    ERRORS_LOG_PATH="${ERRORS_LOG_PATH:-$PRD_DIR/errors.log}"
    ACTIVITY_LOG_PATH="${ACTIVITY_LOG_PATH:-$PRD_DIR/activity.log}"
    msg_info "Using PRD folder: PRD-$LATEST_PRD_NUM"
  fi
fi

PROMPT_FILE="$PROMPT_BUILD"
if [[ "$MODE" = "plan" ]]; then
  PROMPT_FILE="$PROMPT_PLAN"
fi

if [[ "$MODE" = "prd" ]]; then
  PRD_USE_INLINE=1
  if [[ -z "$PRD_AGENT_CMD" ]]; then
    PRD_AGENT_CMD="$AGENT_CMD"
    PRD_USE_INLINE=0
  fi
  if [[ "${RALPH_DRY_RUN:-}" != "1" ]]; then
    require_agent "$PRD_AGENT_CMD"
  fi

  # Create full PRD-N folder structure
  mkdir -p "$(dirname "$PRD_PATH")" "$TMP_DIR" "$RUNS_DIR"
  touch "$PROGRESS_PATH" "$ERRORS_LOG_PATH" "$ACTIVITY_LOG_PATH" 2>/dev/null || true

  if [[ -z "$PRD_REQUEST_PATH" ]] && [[ -n "$PRD_INLINE" ]]; then
    PRD_REQUEST_PATH="$TMP_DIR/prd-request-$(date +%Y%m%d-%H%M%S)-$$.txt"
    printf '%s\n' "$PRD_INLINE" > "$PRD_REQUEST_PATH"
  fi

  if [[ -z "$PRD_REQUEST_PATH" ]] || [[ ! -f "$PRD_REQUEST_PATH" ]]; then
    msg_error "PRD request missing. Provide a prompt string or --prompt <file>."
    exit 1
  fi

  if [[ "${RALPH_DRY_RUN:-}" = "1" ]]; then
    if [[ ! -f "$PRD_PATH" ]]; then
      {
        echo "# PRD (dry run)"
        echo ""
        echo "_Generated without an agent run._"
      } > "$PRD_PATH"
    fi
    exit 0
  fi

  PRD_PROMPT_FILE="$TMP_DIR/prd-prompt-$(date +%Y%m%d-%H%M%S)-$$.md"
  {
    echo "You are an autonomous coding agent."
    echo "Use the \$prd skill to create a Product Requirements Document."
    echo "Save the PRD to: $PRD_PATH"
    echo "Do NOT implement anything."
    echo "After creating the PRD, tell the user to close the session and run \`ralph plan\`."
    echo ""
    echo "User request:"
    cat "$PRD_REQUEST_PATH"
  } > "$PRD_PROMPT_FILE"

  if [[ "$PRD_USE_INLINE" -eq 1 ]]; then
    run_agent_inline "$PRD_PROMPT_FILE"
  else
    run_agent "$PRD_PROMPT_FILE"
  fi
  exit 0
fi

if [[ "${RALPH_DRY_RUN:-}" != "1" ]]; then
  require_agent
fi

if [[ ! -f "$PROMPT_FILE" ]]; then
  msg_warn "Prompt not found: $PROMPT_FILE"
  exit 1
fi

if [[ "$MODE" != "prd" ]] && [[ ! -f "$PRD_PATH" ]]; then
  msg_warn "PRD not found: $PRD_PATH"
  exit 1
fi

if [[ "$MODE" = "build" ]] && [[ ! -f "$PLAN_PATH" ]]; then
  msg_warn "Plan not found: $PLAN_PATH"
  echo "Create it first with:"
  msg_info "  ./.agents/ralph/loop.sh plan"
  exit 1
fi

mkdir -p "$(dirname "$PROGRESS_PATH")" "$TMP_DIR" "$RUNS_DIR"

if [[ ! -f "$PROGRESS_PATH" ]]; then
  {
    echo "# Progress Log"
    echo "Started: $(date)"
    echo ""
    echo "## Codebase Patterns"
    echo "- (add reusable patterns here)"
    echo ""
    echo "---"
  } > "$PROGRESS_PATH"
fi

if [[ ! -f "$GUARDRAILS_PATH" ]]; then
  {
    echo "# Guardrails (Signs)"
    echo ""
    echo "> Lessons learned from failures. Read before acting."
    echo ""
    echo "## Core Signs"
    echo ""
    echo "### Sign: Read Before Writing"
    echo "- **Trigger**: Before modifying any file"
    echo "- **Instruction**: Read the file first"
    echo "- **Added after**: Core principle"
    echo ""
    echo "### Sign: Test Before Commit"
    echo "- **Trigger**: Before committing changes"
    echo "- **Instruction**: Run required tests and verify outputs"
    echo "- **Added after**: Core principle"
    echo ""
    echo "---"
    echo ""
    echo "## Learned Signs"
    echo ""
  } > "$GUARDRAILS_PATH"
fi

if [[ ! -f "$ERRORS_LOG_PATH" ]]; then
  {
    echo "# Error Log"
    echo ""
    echo "> Failures and repeated issues. Use this to add guardrails."
    echo ""
  } > "$ERRORS_LOG_PATH"
fi

if [[ ! -f "$ACTIVITY_LOG_PATH" ]]; then
  {
    echo "# Activity Log"
    echo ""
    echo "## Run Summary"
    echo ""
    echo "## Events"
    echo ""
  } > "$ACTIVITY_LOG_PATH"
fi

RUN_TAG="$(date +%Y%m%d-%H%M%S)-$$"

# Path to the Python PRD parser library
PRD_PARSER_PY="$SCRIPT_DIR/lib/prd-parser.py"

# Generate template variables JSON file for prompt rendering
# Usage: write_template_vars <output_file> <run_id> <iteration> <run_log> <run_meta>
write_template_vars() {
  local output_file="$1"
  local run_id="$2"
  local iter="$3"
  local run_log="$4"
  local run_meta="$5"
  cat > "$output_file" <<EOF
{
  "PRD_PATH": "$PRD_PATH",
  "PLAN_PATH": "$PLAN_PATH",
  "AGENTS_PATH": "$AGENTS_PATH",
  "PROGRESS_PATH": "$PROGRESS_PATH",
  "REPO_ROOT": "$ROOT_DIR",
  "GUARDRAILS_PATH": "$GUARDRAILS_PATH",
  "ERRORS_LOG_PATH": "$ERRORS_LOG_PATH",
  "ACTIVITY_LOG_PATH": "$ACTIVITY_LOG_PATH",
  "GUARDRAILS_REF": "$GUARDRAILS_REF",
  "CONTEXT_REF": "$CONTEXT_REF",
  "ACTIVITY_CMD": "$ACTIVITY_CMD",
  "NO_COMMIT": "$NO_COMMIT",
  "RUN_ID": "$run_id",
  "ITERATION": "$iter",
  "RUN_LOG_PATH": "$run_log",
  "RUN_META_PATH": "$run_meta"
}
EOF
}

# Render prompt template using external Python script
# Usage: render_prompt <src> <dst> <story_meta> <story_block> <run_id> <iter> <run_log> <run_meta>
render_prompt() {
  local src="$1"
  local dst="$2"
  local story_meta="$3"
  local story_block="$4"
  local run_id="$5"
  local iter="$6"
  local run_log="$7"
  local run_meta="$8"
  local vars_file
  vars_file="$(mktemp)"
  write_template_vars "$vars_file" "$run_id" "$iter" "$run_log" "$run_meta"
  python3 "$PRD_PARSER_PY" render_prompt "$src" "$dst" "$vars_file" "$story_meta" "$story_block"
  rm -f "$vars_file"
}

# Render retry prompt with failure context variables using external Python script
# Usage: render_retry_prompt <src> <dst> <story_meta> <story_block> <run_id> <iter> <run_log> <run_meta> \
#                            <failure_context_file> <retry_attempt> <retry_max>
render_retry_prompt() {
  local src="$1"
  local dst="$2"
  local story_meta="$3"
  local story_block="$4"
  local run_id="$5"
  local iter="$6"
  local run_log="$7"
  local run_meta="$8"
  local failure_context_file="${9:-}"
  local retry_attempt="${10:-1}"
  local retry_max="${11:-3}"
  local vars_file
  vars_file="$(mktemp)"
  write_template_vars "$vars_file" "$run_id" "$iter" "$run_log" "$run_meta"
  python3 "$PRD_PARSER_PY" render_retry_prompt "$src" "$dst" "$vars_file" "$story_meta" "$story_block" "$failure_context_file" "$retry_attempt" "$retry_max"
  rm -f "$vars_file"
}

# Select next uncompleted story from PRD using external Python script
# Usage: select_story <meta_out> <block_out>
select_story() {
  local meta_out="$1"
  local block_out="$2"
  python3 "$PRD_PARSER_PY" select_story "$PRD_PATH" "$meta_out" "$block_out"
}

# Get remaining story count from metadata file using external Python script
# Usage: remaining_stories <meta_file>
remaining_stories() {
  local meta_file="$1"
  python3 "$PRD_PARSER_PY" remaining_stories "$meta_file"
}

# Get a field value from story metadata file using external Python script
# Usage: story_field <meta_file> <field>
story_field() {
  local meta_file="$1"
  local field="$2"
  python3 "$PRD_PARSER_PY" story_field "$meta_file" "$field"
}

log_activity() {
  local message="$1"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $message" >> "$ACTIVITY_LOG_PATH"
}

log_error() {
  local message="$1"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[$timestamp] $message" >> "$ERRORS_LOG_PATH"
}

# Save checkpoint before story execution for resumable builds
# Usage: save_checkpoint <prd-folder> <prd-id> <iteration> <story-id> <git-sha> [agent]
save_checkpoint() {
  local prd_folder="$1"
  local prd_id="$2"
  local iteration="$3"
  local story_id="$4"
  local git_sha="$5"
  local agent="${6:-codex}"

  local checkpoint_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    checkpoint_cli="$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    checkpoint_cli="$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi

  # Check if checkpoint CLI exists
  if [[ ! -f "$checkpoint_cli" ]] || ! command -v node >/dev/null 2>&1; then
    msg_dim "Checkpoint CLI not available, skipping checkpoint save"
    return 0
  fi

  # Build JSON data
  local json_data
  json_data=$(printf '{"prd_id":%s,"iteration":%s,"story_id":"%s","git_sha":"%s","loop_state":{"agent":"%s"}}' \
    "$prd_id" "$iteration" "$story_id" "$git_sha" "$agent")

  # Save checkpoint via CLI
  if node "$checkpoint_cli" save "$prd_folder" "$json_data" >/dev/null 2>&1; then
    msg_dim "Checkpoint saved: iteration=$iteration story=$story_id"
    return 0
  else
    msg_warn "Failed to save checkpoint"
    return 1
  fi
}

# Clear checkpoint from PRD folder (called on successful completion)
# Usage: clear_checkpoint <prd-folder>
clear_checkpoint() {
  local prd_folder="$1"

  local checkpoint_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    checkpoint_cli="$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    checkpoint_cli="$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi

  # Check if checkpoint CLI exists
  if [[ ! -f "$checkpoint_cli" ]] || ! command -v node >/dev/null 2>&1; then
    return 0
  fi

  # Clear checkpoint via CLI (silent - don't warn on failure)
  if node "$checkpoint_cli" clear "$prd_folder" >/dev/null 2>&1; then
    msg_dim "Checkpoint cleared (build complete)"
    return 0
  else
    return 1
  fi
}

# Load checkpoint from PRD folder for resumable builds
# Returns: Sets CHECKPOINT_ITERATION, CHECKPOINT_STORY_ID, CHECKPOINT_GIT_SHA
# Exit code: 0 if checkpoint loaded, 1 if not found or error
load_checkpoint() {
  local prd_folder="$1"

  local checkpoint_cli
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    checkpoint_cli="$RALPH_ROOT/lib/checkpoint/cli.js"
  else
    checkpoint_cli="$SCRIPT_DIR/../../lib/checkpoint/cli.js"
  fi

  # Check if checkpoint CLI exists
  if [[ ! -f "$checkpoint_cli" ]] || ! command -v node >/dev/null 2>&1; then
    return 1
  fi

  # Load checkpoint via CLI
  local output
  output=$(node "$checkpoint_cli" load "$prd_folder" 2>/dev/null)
  local status=$?

  if [[ $status -ne 0 ]]; then
    return 1
  fi

  # Parse JSON output using Python (more reliable than bash parsing)
  CHECKPOINT_ITERATION=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('iteration', ''))" 2>/dev/null)
  CHECKPOINT_STORY_ID=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('story_id', ''))" 2>/dev/null)
  CHECKPOINT_GIT_SHA=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('git_sha', ''))" 2>/dev/null)
  CHECKPOINT_AGENT=$(echo "$output" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('loop_state', {}).get('agent', 'codex'))" 2>/dev/null)

  if [[ -n "$CHECKPOINT_ITERATION" ]]; then
    return 0
  else
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Rollback Functions (US-001: Automatic Rollback on Test Failure)
# ─────────────────────────────────────────────────────────────────────────────

# Detect test failures in build output
# Returns: 0 if test failure detected, 1 if no test failure
# Usage: detect_test_failure <log_file>
detect_test_failure() {
  local log_file="$1"

  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  # Common test failure patterns across various frameworks
  # Jest: "Tests: X failed"
  # Mocha: "X failing"
  # Pytest: "X failed"
  # npm test: "npm ERR!" with test context
  # Go test: "FAIL" or "--- FAIL:"
  # Vitest: "Tests: X failed"
  # Bun test: "X fail"
  local patterns=(
    "Tests:.*[0-9]+ failed"           # Jest, Vitest
    "[0-9]+ failing"                   # Mocha
    "FAILED.*test"                     # Pytest
    "^FAIL\t"                          # Go test (FAIL<tab>package)
    "--- FAIL:"                        # Go test detailed
    "npm ERR!.*test"                   # npm test failure
    "test.*failed"                     # Generic test failure
    "AssertionError"                   # Node.js assertion
    "Error: expect"                    # Jest/Vitest expect failure
    "✗.*test"                          # Various test runners
    "[0-9]+ test.*fail"                # Bun and others
    "FAIL.*\\.test\\."                 # Test file failure patterns
    "FAIL.*\\.spec\\."                 # Spec file failure patterns
    "exit status [1-9]"                # Go test exit status
  )

  for pattern in "${patterns[@]}"; do
    if grep -qiE "$pattern" "$log_file" 2>/dev/null; then
      return 0  # Test failure detected
    fi
  done

  return 1  # No test failure detected
}

# Detect lint failures in build output (US-003)
# Returns: 0 if lint failure detected, 1 if no lint failure
# Usage: detect_lint_failure <log_file>
detect_lint_failure() {
  local log_file="$1"

  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  # Common lint failure patterns across various linters
  local patterns=(
    "error.*eslint"                    # ESLint
    "eslint.*error"                    # ESLint (alternate order)
    "[0-9]+ error"                     # ESLint summary
    "prettier.*failed"                 # Prettier
    "prettier.*check.*failed"          # Prettier check mode
    "ruff.*error"                      # Ruff (Python)
    "pylint.*error"                    # Pylint
    "flake8.*error"                    # Flake8
    "rubocop.*offense"                 # RuboCop (Ruby)
    "stylelint.*error"                 # Stylelint (CSS)
    "golangci-lint.*error"             # golangci-lint (Go)
    "lint.*failed"                     # Generic lint failure
    "linting.*failed"                  # Generic linting failure
    "Linting errors"                   # Generic linting errors
  )

  for pattern in "${patterns[@]}"; do
    if grep -qiE "$pattern" "$log_file" 2>/dev/null; then
      return 0  # Lint failure detected
    fi
  done

  return 1  # No lint failure detected
}

# Detect type check failures in build output (US-003)
# Returns: 0 if type failure detected, 1 if no type failure
# Usage: detect_type_failure <log_file>
detect_type_failure() {
  local log_file="$1"

  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  # Common type check failure patterns
  local patterns=(
    "error TS[0-9]+"                   # TypeScript errors
    "tsc.*error"                       # TypeScript compiler
    "Type.*is not assignable"          # TypeScript type error
    "Cannot find module"               # TypeScript/JavaScript import error
    "Cannot find name"                 # TypeScript undefined error
    "mypy.*error"                      # mypy (Python)
    "pyright.*error"                   # Pyright (Python)
    "type.*mismatch"                   # Generic type mismatch
    "incompatible type"                # Generic incompatible type
    "error\\[E[0-9]+"                  # Rust compiler errors
    "flow.*error"                      # Flow (JavaScript)
  )

  for pattern in "${patterns[@]}"; do
    if grep -qiE "$pattern" "$log_file" 2>/dev/null; then
      return 0  # Type failure detected
    fi
  done

  return 1  # No type failure detected
}

# Unified failure detection based on ROLLBACK_TRIGGER config (US-003)
# Returns: 0 if relevant failure detected (based on config), 1 otherwise
# Usage: detect_failure <log_file> <trigger_policy>
detect_failure() {
  local log_file="$1"
  local trigger_policy="${2:-test-fail}"

  if [[ ! -f "$log_file" ]]; then
    return 1
  fi

  case "$trigger_policy" in
    test-fail)
      detect_test_failure "$log_file"
      return $?
      ;;
    lint-fail)
      detect_lint_failure "$log_file"
      return $?
      ;;
    type-fail)
      detect_type_failure "$log_file"
      return $?
      ;;
    any-fail)
      # any-fail triggers on any non-zero exit, no log analysis needed
      # The caller already checks CMD_STATUS != 0, so we always return 0 here
      return 0
      ;;
    *)
      # Unknown trigger policy, fall back to test-fail
      detect_test_failure "$log_file"
      return $?
      ;;
  esac
}

# Check if story has rollback disabled via <!-- no-rollback --> comment (US-003)
# Returns: 0 if rollback should be skipped, 1 if rollback is allowed
# Usage: story_has_no_rollback <story_block_file>
story_has_no_rollback() {
  local story_block_file="$1"

  if [[ -z "$story_block_file" ]]; then
    return 1  # No file, allow rollback
  fi

  if [[ ! -f "$story_block_file" ]]; then
    return 1  # File doesn't exist, allow rollback
  fi

  # Check for <!-- no-rollback --> comment in story block file
  if grep -qiE "<!--[[:space:]]*no-rollback[[:space:]]*-->" "$story_block_file" 2>/dev/null; then
    return 0  # Rollback disabled for this story
  fi

  return 1  # Rollback is allowed
}

# Rollback to a git checkpoint (pre-story state)
# Usage: rollback_to_checkpoint <target_sha> <story_id> <reason>
# Returns: 0 on success, 1 on failure
rollback_to_checkpoint() {
  local target_sha="$1"
  local story_id="$2"
  local reason="${3:-test_failure}"

  if [[ -z "$target_sha" ]]; then
    log_error "ROLLBACK failed: no target SHA provided"
    return 1
  fi

  local current_sha
  current_sha=$(git_head)

  # Check if we're already at target SHA
  if [[ "$current_sha" = "$target_sha" ]]; then
    msg_dim "Already at target SHA, no rollback needed"
    return 0
  fi

  # Stash any uncommitted changes to preserve them
  local stash_output
  stash_output=$(git stash push -m "ralph-rollback-$story_id-$(date +%s)" 2>&1)
  local has_stash=false
  if ! echo "$stash_output" | grep -q "No local changes"; then
    has_stash=true
    msg_dim "Stashed uncommitted changes before rollback"
  fi

  # Perform the rollback using git reset
  if ! git reset --hard "$target_sha" >/dev/null 2>&1; then
    log_error "ROLLBACK failed: git reset --hard $target_sha failed"
    # Attempt to restore stash if we made one
    if [[ "$has_stash" = "true" ]]; then
      git stash pop >/dev/null 2>&1 || true
    fi
    return 1
  fi

  # Log the rollback
  log_activity "ROLLBACK story=$story_id reason=$reason from=${current_sha:0:8} to=${target_sha:0:8}"

  return 0
}

# Save failure context for retry (preserves error information)
# Usage: save_failure_context <log_file> <runs_dir> <run_tag> <iteration> <story_id>
save_failure_context() {
  local log_file="$1"
  local runs_dir="$2"
  local run_tag="$3"
  local iteration="$4"
  local story_id="$5"

  local context_file="$runs_dir/failure-context-$run_tag-iter-$iteration.log"

  {
    echo "# Failure Context"
    echo "# Generated: $(date '+%Y-%m-%d %H:%M:%S')"
    echo "# Story: $story_id"
    echo "# Run: $run_tag (iteration $iteration)"
    echo ""
    echo "## Test Output"
    echo ""

    if [[ -f "$log_file" ]]; then
      # Extract relevant error/test failure sections
      # Look for test output, assertion failures, stack traces
      grep -iE "(FAIL|ERROR|test.*fail|AssertionError|expect|✗|failing|failed)" "$log_file" 2>/dev/null | head -100 || true
      echo ""
      echo "## Full Log Tail (last 50 lines)"
      echo ""
      tail -50 "$log_file" 2>/dev/null || true
    else
      echo "(Log file not found: $log_file)"
    fi
  } > "$context_file"

  echo "$context_file"
}

# Display rollback notification to user
# Usage: notify_rollback <story_id> <reason> <target_sha> <context_file>
notify_rollback() {
  local story_id="$1"
  local reason="$2"
  local target_sha="$3"
  local context_file="${4:-}"

  printf "\n"
  printf "${C_YELLOW}${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_YELLOW}${C_BOLD}║              ROLLBACK TRIGGERED                       ║${C_RESET}\n"
  printf "${C_YELLOW}${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
  printf "\n"
  printf "  ${C_BOLD}Story:${C_RESET}  %s\n" "$story_id"
  printf "  ${C_BOLD}Reason:${C_RESET} %s\n" "$reason"
  printf "  ${C_BOLD}Rolled back to:${C_RESET} %s\n" "${target_sha:0:8}"
  if [[ -n "$context_file" ]] && [[ -f "$context_file" ]]; then
    printf "  ${C_BOLD}Error context:${C_RESET} %s\n" "$context_file"
  fi
  printf "\n"
  printf "${C_DIM}  The codebase has been restored to its pre-story state.${C_RESET}\n"
  printf "${C_DIM}  Review the error context for the next attempt.${C_RESET}\n"
  printf "\n"
}

# Log rollback event to a dedicated rollback history log (US-004)
# Provides structured logging for rollback analysis and statistics
# Usage: log_rollback <story_id> <reason> <from_sha> <to_sha> <attempt> <success> [context_file]
log_rollback() {
  local story_id="$1"
  local reason="$2"
  local from_sha="$3"
  local to_sha="$4"
  local attempt="${5:-1}"
  local success="${6:-true}"
  local context_file="${7:-}"

  local timestamp
  timestamp=$(date '+%Y-%m-%dT%H:%M:%SZ')

  # Log to activity log with structured format
  log_activity "ROLLBACK_EVENT story=$story_id reason=$reason from=${from_sha:0:8} to=${to_sha:0:8} attempt=$attempt success=$success"

  # Log to dedicated rollback history file (append-only JSONL format)
  local rollback_log="${PRD_FOLDER:-$RALPH_DIR}/runs/rollback-history.jsonl"
  local runs_dir
  runs_dir="$(dirname "$rollback_log")"

  # Create runs directory if needed
  if [[ ! -d "$runs_dir" ]]; then
    mkdir -p "$runs_dir"
  fi

  # Build JSON record (escape special characters)
  local escaped_reason
  escaped_reason=$(printf '%s' "$reason" | sed 's/"/\\"/g')

  local json_record
  json_record=$(printf '{"timestamp":"%s","storyId":"%s","reason":"%s","fromSha":"%s","toSha":"%s","attempt":%d,"success":%s,"runId":"%s","contextFile":"%s"}' \
    "$timestamp" \
    "$story_id" \
    "$escaped_reason" \
    "${from_sha:0:8}" \
    "${to_sha:0:8}" \
    "$attempt" \
    "$success" \
    "${RUN_TAG:-unknown}" \
    "${context_file:-}")

  echo "$json_record" >> "$rollback_log"
}

# Get rollback statistics from rollback history (US-004)
# Usage: get_rollback_stats [prd_folder]
# Returns: JSON with rollback statistics
get_rollback_stats() {
  local prd_folder="${1:-$PRD_FOLDER}"
  local rollback_log="$prd_folder/runs/rollback-history.jsonl"

  if [[ ! -f "$rollback_log" ]]; then
    echo '{"total":0,"successful":0,"failed":0,"successRate":0,"byReason":{},"byStory":{}}'
    return 0
  fi

  # Use Node.js for JSON aggregation if available, otherwise use shell
  if command -v node >/dev/null 2>&1; then
    node -e "
const fs = require('fs');
const lines = fs.readFileSync('$rollback_log', 'utf-8').split('\\n').filter(l => l.trim());
const records = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const stats = {
  total: records.length,
  successful: records.filter(r => r.success === true || r.success === 'true').length,
  failed: records.filter(r => r.success === false || r.success === 'false').length,
  successRate: 0,
  avgAttempts: 0,
  byReason: {},
  byStory: {}
};

stats.successRate = stats.total > 0 ? Math.round((stats.successful / stats.total) * 100) : 0;

// Calculate average attempts
const totalAttempts = records.reduce((sum, r) => sum + (r.attempt || 1), 0);
stats.avgAttempts = stats.total > 0 ? Math.round((totalAttempts / stats.total) * 100) / 100 : 0;

// Group by reason
for (const r of records) {
  const reason = r.reason || 'unknown';
  if (!stats.byReason[reason]) stats.byReason[reason] = { count: 0, successful: 0 };
  stats.byReason[reason].count++;
  if (r.success === true || r.success === 'true') stats.byReason[reason].successful++;
}

// Group by story
for (const r of records) {
  const story = r.storyId || 'unknown';
  if (!stats.byStory[story]) stats.byStory[story] = { rollbacks: 0, maxAttempts: 0 };
  stats.byStory[story].rollbacks++;
  stats.byStory[story].maxAttempts = Math.max(stats.byStory[story].maxAttempts, r.attempt || 1);
}

console.log(JSON.stringify(stats));
"
  else
    # Fallback shell implementation (basic counts only)
    local total
    total=$(wc -l < "$rollback_log" | tr -d ' ')
    local successful
    successful=$(grep -c '"success":true' "$rollback_log" 2>/dev/null || echo 0)
    local failed=$((total - successful))
    local rate=0
    if [[ "$total" -gt 0 ]]; then
      rate=$((successful * 100 / total))
    fi
    printf '{"total":%d,"successful":%d,"failed":%d,"successRate":%d,"byReason":{},"byStory":{}}' \
      "$total" "$successful" "$failed" "$rate"
  fi
}

# Validate git state matches checkpoint
# Returns: 0 if match or user confirms, 1 if user declines
validate_git_state() {
  local expected_sha="$1"
  local current_sha

  current_sha=$(git_head)

  if [[ -z "$expected_sha" ]]; then
    # No checkpoint SHA to validate
    return 0
  fi

  if [[ "$current_sha" = "$expected_sha" ]]; then
    return 0
  fi

  # Git state has diverged - warn user
  printf "\n${C_YELLOW}${C_BOLD}Warning: Git state has diverged from checkpoint${C_RESET}\n"
  printf "  ${C_DIM}Checkpoint SHA: ${C_RESET}${expected_sha:0:8}\n"
  printf "  ${C_DIM}Current SHA:    ${C_RESET}${current_sha:0:8}\n"
  printf "\n"

  # Prompt user if in TTY mode
  if [[ -t 0 ]]; then
    printf "${C_YELLOW}Resume anyway? [y/N]: ${C_RESET}"
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
    # Non-interactive mode - fail safe
    msg_error "Git state diverged. Use --resume in interactive mode to override."
    return 1
  fi
}

# Prompt user to confirm resume from checkpoint
# Returns: 0 if user confirms, 1 if user declines
prompt_resume_confirmation() {
  local iteration="$1"
  local story_id="$2"

  printf "\n${C_CYAN}${C_BOLD}Checkpoint found${C_RESET}\n"
  printf "  ${C_DIM}Iteration:${C_RESET} $iteration\n"
  printf "  ${C_DIM}Story:${C_RESET}     ${story_id:-unknown}\n"
  printf "\n"

  # Prompt user if in TTY mode
  if [[ -t 0 ]]; then
    printf "${C_CYAN}Resume from iteration $iteration? [Y/n]: ${C_RESET}"
    read -r response
    case "$response" in
      [nN]|[nN][oO])
        return 1
        ;;
      *)
        return 0
        ;;
    esac
  else
    # Non-interactive mode - proceed with resume
    return 0
  fi
}

# Get model routing decision for a story
# Usage: get_routing_decision <story_block_file> [override_model]
# Returns JSON: {"model": "sonnet", "score": 5.2, "reason": "...", "override": false}
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

# Parse JSON field from any JSON object
# Usage: parse_json_field <json_string> <field_name>
# Returns: The value of the field, or empty string if not found/null
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

# Estimate execution cost before running
# Usage: estimate_execution_cost <model> <complexity_score>
# Returns JSON: {"estimatedCost": "0.15", "costRange": "$0.10-0.25", "estimatedTokens": 15000, "comparison": "vs $0.75 if using Opus"}
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

# Enhanced error display with path highlighting and suggestions
# Usage: show_error "message" ["log_path"]
show_error() {
  local message="$1"
  local log_path="${2:-}"
  msg_error "$message"
  if [[ -n "$log_path" ]]; then
    printf "  ${C_RED}Review logs at: ${C_BOLD}%s${C_RESET}\n" "$log_path"
  fi
}

# Show helpful suggestions when errors occur
show_error_suggestions() {
  local error_type="${1:-agent}"  # agent or system
  printf "\n${C_YELLOW}${C_BOLD}Suggested next steps:${C_RESET}\n"
  if [[ "$error_type" = "agent" ]]; then
    printf "  ${C_DIM}1)${C_RESET} Review the run log for agent output and errors\n"
    printf "  ${C_DIM}2)${C_RESET} Check ${C_CYAN}%s${C_RESET} for repeated failures\n" "$ERRORS_LOG_PATH"
    printf "  ${C_DIM}3)${C_RESET} Try: ${C_CYAN}ralph build 1 --no-commit${C_RESET} for a test run\n"
  else
    printf "  ${C_DIM}1)${C_RESET} Verify the agent CLI is installed and authenticated\n"
    printf "  ${C_DIM}2)${C_RESET} Check system resources (disk space, memory)\n"
    printf "  ${C_DIM}3)${C_RESET} Review ${C_CYAN}%s${C_RESET} for patterns\n" "$GUARDRAILS_PATH"
  fi
}

# Print error summary at end of run if any iterations failed
# Reads from FAILED_ITERATIONS (format: "iter:story:logfile,iter:story:logfile,...")
print_error_summary() {
  local failed_data="$1"
  local count="$2"

  if [[ -z "$failed_data" ]] || [[ "$count" -eq 0 ]]; then
    return
  fi

  echo ""
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}${C_RED}  ERROR SUMMARY: %d iteration(s) failed${C_RESET}\n" "$count"
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"

  # Parse and display each failed iteration
  IFS=',' read -ra FAILURES <<< "$failed_data"
  for failure in "${FAILURES[@]}"; do
    IFS=':' read -r iter story logfile <<< "$failure"
    printf "${C_RED}  ✗ Iteration %s${C_RESET}" "$iter"
    if [[ -n "$story" ]] && [[ "$story" != "plan" ]]; then
      printf " ${C_DIM}(%s)${C_RESET}" "$story"
    fi
    printf "\n"
    printf "    ${C_RED}Log: ${C_BOLD}%s${C_RESET}\n" "$logfile"
  done

  printf "${C_RED}───────────────────────────────────────────────────────${C_RESET}\n"
  printf "  ${C_YELLOW}Check: ${C_CYAN}%s${C_RESET}\n" "$ERRORS_LOG_PATH"
  printf "${C_RED}═══════════════════════════════════════════════════════${C_RESET}\n"
}

# Format duration in human-readable form (e.g., "1m 23s" or "45s")
format_duration() {
  local secs="$1"
  local mins=$((secs / 60))
  local remaining=$((secs % 60))
  if [[ "$mins" -gt 0 ]]; then
    printf "%dm %ds" "$mins" "$remaining"
  else
    printf "%ds" "$secs"
  fi
}

# Print iteration summary table at end of multi-iteration run
# Reads from ITERATION_RESULTS (format: "iter|story|duration|status,...")
print_summary_table() {
  local results="$1"
  local total_time="$2"
  local success_count="$3"
  local total_count="$4"
  local remaining="$5"

  if [[ -z "$results" ]] || [[ "$total_count" -eq 0 ]]; then
    return
  fi

  # Only show table for multi-iteration runs (2+)
  if [[ "$total_count" -lt 2 ]]; then
    return
  fi

  echo ""
  printf "${C_CYAN}╔═══════════════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD}${C_CYAN}                    ITERATION SUMMARY                          ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╠═════╤════════════╤════════════╤═════════╤══════════════════════╣${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD} Iter│   Story    │  Duration  │ Retries │       Status         ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╟─────┼────────────┼────────────┼─────────┼──────────────────────╢${C_RESET}\n"

  # Parse and display each iteration result
  IFS=',' read -ra RESULTS <<< "$results"
  local total_retries=0
  for result in "${RESULTS[@]}"; do
    # Handle both old format (4 fields) and new format (5 fields with retries)
    local iter story duration status retries_field
    IFS='|' read -r iter story duration status retries_field <<< "$result"
    local dur_str
    dur_str=$(format_duration "$duration")
    # Handle missing/empty retries field gracefully (backwards compatibility)
    local retries=0
    if [[ -n "$retries_field" ]] && [[ "$retries_field" != "" ]]; then
      retries="$retries_field"
    fi
    total_retries=$((total_retries + retries))

    # Status symbol and color
    local status_display
    if [[ "$status" = "success" ]]; then
      status_display="${C_GREEN}✓ success${C_RESET}"
    else
      status_display="${C_RED}✗ error${C_RESET}"
    fi

    # Retry display with color
    local retry_display
    if [[ "$retries" -gt 0 ]]; then
      retry_display="${C_YELLOW}${retries}${C_RESET}"
    else
      retry_display="${C_DIM}0${C_RESET}"
    fi

    # Truncate story ID if too long (max 10 chars)
    local story_display="${story:-plan}"
    if [[ "${#story_display}" -gt 10 ]]; then
      story_display="${story_display:0:10}"
    fi

    printf "${C_CYAN}║${C_RESET} %3s │ %-10s │ %10s │   %-5b │ %-20b ${C_CYAN}║${C_RESET}\n" "$iter" "$story_display" "$dur_str" "$retry_display" "$status_display"
  done

  printf "${C_CYAN}╠═════╧════════════╧════════════╧═════════╧══════════════════════╣${C_RESET}\n"

  # Aggregate stats
  local total_dur_str
  total_dur_str=$(format_duration "$total_time")
  local success_rate
  if [[ "$total_count" -gt 0 ]]; then
    success_rate=$((success_count * 100 / total_count))
  else
    success_rate=0
  fi

  # Color-code success rate
  local rate_color="$C_GREEN"
  if [[ "$success_rate" -lt 100 ]]; then
    rate_color="$C_YELLOW"
  fi
  if [[ "$success_rate" -lt 50 ]]; then
    rate_color="$C_RED"
  fi

  printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Total time:${C_RESET} %-10s ${C_BOLD}Success:${C_RESET} ${rate_color}%d/%d (%d%%)${C_RESET}  " "$total_dur_str" "$success_count" "$total_count" "$success_rate"
  if [[ "$total_retries" -gt 0 ]]; then
    printf "${C_BOLD}Retries:${C_RESET} ${C_YELLOW}%d${C_RESET}  " "$total_retries"
  fi
  printf "${C_CYAN}║${C_RESET}\n"
  if [[ -n "$remaining" ]] && [[ "$remaining" != "unknown" ]] && [[ "$remaining" != "0" ]]; then
    printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Stories remaining:${C_RESET} %-41s ${C_CYAN}║${C_RESET}\n" "$remaining"
  fi
  printf "${C_CYAN}╚═══════════════════════════════════════════════════════════════╝${C_RESET}\n"
}

# Append a run summary line to the activity log using external Python script
# Usage: append_run_summary <line>
append_run_summary() {
  local line="$1"
  python3 "$PRD_PARSER_PY" append_run_summary "$ACTIVITY_LOG_PATH" "$line"
}

write_run_meta() {
  local path="$1"
  local mode="$2"
  local iter="$3"
  local run_id="$4"
  local story_id="$5"
  local story_title="$6"
  local started="$7"
  local ended="$8"
  local duration="$9"
  local status="${10}"
  local log_file="${11}"
  local head_before="${12}"
  local head_after="${13}"
  local commit_list="${14}"
  local changed_files="${15}"
  local dirty_files="${16}"
  local input_tokens="${17:-}"
  local output_tokens="${18:-}"
  local token_model="${19:-}"
  local token_estimated="${20:-false}"
  local retry_count="${21:-0}"
  local retry_time="${22:-0}"
  # Routing and cost estimate parameters (new for US-003)
  local routed_model="${23:-}"
  local complexity_score="${24:-}"
  local routing_reason="${25:-}"
  local est_cost="${26:-}"
  local est_tokens="${27:-}"
  # Agent switch parameters (new for US-003 Switch Notifications)
  local switch_count="${28:-0}"
  local switch_from="${29:-}"
  local switch_to="${30:-}"
  local switch_reason="${31:-}"
  {
    echo "# Ralph Run Summary"
    echo ""
    echo "- Run ID: $run_id"
    echo "- Iteration: $iter"
    echo "- Mode: $mode"
    if [[ -n "$story_id" ]]; then
      echo "- Story: $story_id: $story_title"
    fi
    echo "- Started: $started"
    echo "- Ended: $ended"
    echo "- Duration: ${duration}s"
    echo "- Status: $status"
    echo "- Log: $log_file"
    echo ""
    echo "## Git"
    echo "- Head (before): ${head_before:-unknown}"
    echo "- Head (after): ${head_after:-unknown}"
    echo ""
    echo "### Commits"
    if [[ -n "$commit_list" ]]; then
      echo "$commit_list"
    else
      echo "- (none)"
    fi
    echo ""
    echo "### Changed Files (commits)"
    if [[ -n "$changed_files" ]]; then
      echo "$changed_files"
    else
      echo "- (none)"
    fi
    echo ""
    echo "### Uncommitted Changes"
    if [[ -n "$dirty_files" ]]; then
      echo "$dirty_files"
    else
      echo "- (clean)"
    fi
    echo ""
    echo "## Token Usage"
    if [[ -n "$input_tokens" ]] && [[ "$input_tokens" != "null" ]]; then
      echo "- Input tokens: $input_tokens"
    else
      echo "- Input tokens: (unavailable)"
    fi
    if [[ -n "$output_tokens" ]] && [[ "$output_tokens" != "null" ]]; then
      echo "- Output tokens: $output_tokens"
    else
      echo "- Output tokens: (unavailable)"
    fi
    if [[ -n "$token_model" ]] && [[ "$token_model" != "null" ]]; then
      echo "- Model: $token_model"
    fi
    echo "- Estimated: $token_estimated"
    if [[ -n "$input_tokens" ]] && [[ "$input_tokens" != "null" ]] && [[ -n "$output_tokens" ]] && [[ "$output_tokens" != "null" ]]; then
      local total=$((input_tokens + output_tokens))
      echo "- Total tokens: $total"
    fi
    echo ""
    echo "## Retry Statistics"
    if [[ "$retry_count" -gt 0 ]]; then
      echo "- Retry count: $retry_count"
      echo "- Total retry wait time: ${retry_time}s"
    else
      echo "- Retry count: 0 (succeeded on first attempt)"
    fi
    echo ""
    echo "## Agent Switches"
    if [[ "$switch_count" -gt 0 ]]; then
      echo "- Switch count: $switch_count"
      echo "- From: $switch_from"
      echo "- To: $switch_to"
      echo "- Reason: $switch_reason"
    else
      echo "- Switch count: 0 (no agent switches)"
    fi
    echo ""
    echo "## Routing Decision"
    if [[ -n "$routed_model" ]]; then
      echo "- Model: $routed_model"
      if [[ -n "$complexity_score" ]] && [[ "$complexity_score" != "n/a" ]]; then
        echo "- Complexity score: ${complexity_score}/10"
      fi
      if [[ -n "$routing_reason" ]] && [[ "$routing_reason" != "n/a" ]]; then
        echo "- Reason: $routing_reason"
      fi
    else
      echo "- Model: (not routed)"
    fi
    echo ""
    echo "## Cost Estimate vs Actual"
    if [[ -n "$est_cost" ]] && [[ "$est_cost" != "n/a" ]] && [[ "$est_cost" != "null" ]]; then
      echo "### Pre-execution Estimate"
      echo "- Estimated cost: \$${est_cost}"
      if [[ -n "$est_tokens" ]] && [[ "$est_tokens" != "null" ]]; then
        echo "- Estimated tokens: $est_tokens"
      fi
    else
      echo "### Pre-execution Estimate"
      echo "- (estimate unavailable)"
    fi
    echo ""
    echo "### Actual Usage"
    if [[ -n "$input_tokens" ]] && [[ "$input_tokens" != "null" ]] && [[ -n "$output_tokens" ]] && [[ "$output_tokens" != "null" ]]; then
      local actual_total=$((input_tokens + output_tokens))
      echo "- Actual tokens: $actual_total (input: $input_tokens, output: $output_tokens)"
      # Calculate actual cost if model available
      if [[ -n "$token_model" ]] && [[ "$token_model" != "null" ]]; then
        local actual_cost_json
        actual_cost_json="$(calculate_actual_cost "$input_tokens" "$output_tokens" "$token_model" 2>/dev/null || echo "")"
        local actual_cost
        actual_cost="$(parse_json_field "$actual_cost_json" "totalCost" 2>/dev/null || echo "")"
        if [[ -n "$actual_cost" ]] && [[ "$actual_cost" != "null" ]]; then
          echo "- Actual cost: \$$actual_cost"
        fi
      fi
    else
      echo "- (actual usage unavailable)"
    fi
    echo ""
    echo "### Estimate Accuracy"
    if [[ -n "$est_tokens" ]] && [[ "$est_tokens" != "null" ]] && [[ -n "$input_tokens" ]] && [[ "$input_tokens" != "null" ]] && [[ -n "$output_tokens" ]] && [[ "$output_tokens" != "null" ]]; then
      local actual_total=$((input_tokens + output_tokens))
      if [[ "$est_tokens" -gt 0 ]]; then
        local variance_pct
        variance_pct=$(python3 -c "print(round((($actual_total - $est_tokens) / $est_tokens) * 100, 1))" 2>/dev/null || echo "n/a")
        echo "- Token variance: ${variance_pct}% (estimated: $est_tokens, actual: $actual_total)"
      fi
    else
      echo "- (variance not available)"
    fi
    echo ""
  } > "$path"
}

# Generate context summary for a story
# Returns markdown-formatted context selection summary
generate_context_summary() {
  local story_block="$1"
  local model="${2:-sonnet}"
  local limit="${3:-15}"
  local project_root="${4:-$ROOT_DIR}"

  # Check if context CLI is available
  local context_cli="$SCRIPT_DIR/../../lib/context/cli.js"
  if [[ ! -f "$context_cli" ]]; then
    echo ""
    return 0
  fi

  # Generate context summary using the CLI
  # Write story to temp file to handle multi-line content
  local story_tmp
  story_tmp="$(mktemp)"
  echo "$story_block" > "$story_tmp"

  local summary
  summary=$(node "$context_cli" \
    --story-file "$story_tmp" \
    --project-root "$project_root" \
    --model "$model" \
    --limit "$limit" \
    --format markdown 2>/dev/null || echo "")

  rm -f "$story_tmp"
  echo "$summary"
}

# Append context summary to run metadata file
append_context_to_run_meta() {
  local run_meta_path="$1"
  local context_summary="$2"

  if [[ -z "$context_summary" ]]; then
    return 0
  fi

  # Append context summary section
  {
    echo ""
    echo "$context_summary"
    echo ""
  } >> "$run_meta_path"
}

# Git helper functions are now sourced from lib/git-utils.sh
# Provides: git_head, git_commit_list, git_changed_files, git_dirty_files

# Extract token metrics from a log file using Node.js extractor
# Returns JSON: {"inputTokens": N, "outputTokens": N, "model": "...", "estimated": bool}
extract_tokens_from_log() {
  local log_file="$1"
  local extractor_path
  if [[ -n "${RALPH_ROOT:-}" ]]; then
    extractor_path="$RALPH_ROOT/lib/tokens/extract-cli.js"
  else
    extractor_path="$SCRIPT_DIR/../../lib/tokens/extract-cli.js"
  fi

  # Check if extractor exists and Node.js is available
  if [[ -f "$extractor_path" ]] && command -v node >/dev/null 2>&1; then
    node "$extractor_path" "$log_file" 2>/dev/null || echo '{"inputTokens":null,"outputTokens":null,"model":null,"estimated":false}'
  else
    echo '{"inputTokens":null,"outputTokens":null,"model":null,"estimated":false}'
  fi
}

# Append metrics to metrics.jsonl for historical tracking
# Called after each successful build iteration
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
  if [[ -f "$metrics_cli" ]] && command -v node >/dev/null 2>&1; then
    # Build JSON data - handle null tokens gracefully
    local input_val="null"
    local output_val="null"
    if [[ -n "$input_tokens" ]] && [[ "$input_tokens" != "null" ]] && [[ "$input_tokens" != "" ]]; then
      input_val="$input_tokens"
    fi
    if [[ -n "$output_tokens" ]] && [[ "$output_tokens" != "null" ]] && [[ "$output_tokens" != "" ]]; then
      output_val="$output_tokens"
    fi

    # Handle complexity score
    local complexity_val="null"
    if [[ -n "$complexity_score" ]] && [[ "$complexity_score" != "null" ]] && [[ "$complexity_score" != "" ]] && [[ "$complexity_score" != "n/a" ]]; then
      complexity_val="$complexity_score"
    fi

    # Handle estimated cost
    local estimated_cost_val="null"
    if [[ -n "$estimated_cost" ]] && [[ "$estimated_cost" != "null" ]] && [[ "$estimated_cost" != "" ]] && [[ "$estimated_cost" != "n/a" ]]; then
      estimated_cost_val="$estimated_cost"
    fi

    # Escape strings for JSON
    local escaped_title
    escaped_title=$(printf '%s' "$story_title" | sed 's/"/\\"/g' | sed "s/'/\\'/g")

local escaped_reason="null"
    if [[ -n "$routing_reason" ]] && [[ "$routing_reason" != "null" ]] && [[ "$routing_reason" != "" ]]; then
      escaped_reason=$(printf '"%s"' "$(printf '%s' "$routing_reason" | sed 's/"/\\"/g')")
    fi

    # Build experiment fields if present
    local exp_fields=""
    if [[ -n "$exp_name" ]]; then
      local excluded_bool="false"
      if [[ "$exp_excluded" = "1" ]]; then
        excluded_bool="true"
      fi
      exp_fields=$(printf ',"experimentName":"%s","experimentVariant":"%s","experimentExcluded":%s' \
        "$exp_name" \
        "$exp_variant" \
        "$excluded_bool")
    fi

    # Build rollback fields if present (US-004)
    local rollback_fields=""
    if [[ -n "$rollback_count" ]] && [[ "$rollback_count" != "0" ]]; then
      local rollback_success_bool="null"
      if [[ "$rollback_success" = "true" ]]; then
        rollback_success_bool="true"
      elif [[ "$rollback_success" = "false" ]]; then
        rollback_success_bool="false"
      fi
      local escaped_rollback_reason="null"
      if [[ -n "$rollback_reason" ]]; then
        escaped_rollback_reason=$(printf '"%s"' "$(printf '%s' "$rollback_reason" | sed 's/"/\\"/g')")
      fi
      rollback_fields=$(printf ',"rollbackCount":%s,"rollbackReason":%s,"rollbackSuccess":%s' \
        "$rollback_count" \
        "$escaped_rollback_reason" \
        "$rollback_success_bool")
    fi

    # Build switch tracking fields (US-004)
    local switch_fields=""
    if [[ -n "$switch_count" ]] && [[ "$switch_count" != "0" ]]; then
      # Convert comma-separated agents to JSON array
      local agents_json="null"
      if [[ -n "$agents_tried" ]]; then
        # Convert "claude,codex" to ["claude","codex"]
        agents_json="[$(echo "$agents_tried" | sed 's/,/","/g' | sed 's/^/"/' | sed 's/$/"/' )]"
      fi
      local failure_type_json="null"
      if [[ -n "$failure_type" ]]; then
        failure_type_json="\"$failure_type\""
      fi
      switch_fields=$(printf ',"switchCount":%s,"agents":%s,"failureType":%s' \
        "$switch_count" \
        "$agents_json" \
        "$failure_type_json")
    fi

    local json_data
    json_data=$(printf '{"storyId":"%s","storyTitle":"%s","duration":%s,"inputTokens":%s,"outputTokens":%s,"agent":"%s","model":"%s","status":"%s","runId":"%s","iteration":%s,"retryCount":%s,"retryTime":%s,"complexityScore":%s,"routingReason":%s,"estimatedCost":%s,"timestamp":"%s"%s%s}' \
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

# Rebuild token cache for the current stream
# Called at end of build to ensure dashboard has fresh data
rebuild_token_cache() {
  if [[ "$MODE" != "build" ]]; then
    return 0
  fi

  local cache_script
  if [[ -n "$RALPH_ROOT" ]]; then
    cache_script="$RALPH_ROOT/lib/tokens/index.js"
  else
    cache_script="$SCRIPT_DIR/../../lib/tokens/index.js"
  fi

  # Get the stream path (PRD-N directory)
  local stream_path
  stream_path="$(dirname "$PRD_PATH")"

  if [[ -f "$cache_script" ]] && command -v node >/dev/null 2>&1; then
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

msg_info "Ralph mode: $MODE"
msg_dim "Max iterations: $MAX_ITERATIONS"
msg_dim "PRD: $PRD_PATH"
msg_dim "Plan: $PLAN_PATH"
HAS_ERROR="false"
# Track failed iterations for summary at end
FAILED_ITERATIONS=""
FAILED_COUNT=0

# Iteration results tracking for summary table
# Each entry: "iter|story_id|duration|status"
ITERATION_RESULTS=""
TOTAL_DURATION=0
SUCCESS_COUNT=0
ITERATION_COUNT=0

# ─────────────────────────────────────────────────────────────────────────────
# Failure Pattern Detection (US-001)
# ─────────────────────────────────────────────────────────────────────────────
# Track consecutive failures per agent for automatic agent switching
CONSECUTIVE_FAILURES=0
CURRENT_AGENT="$DEFAULT_AGENT_NAME"
LAST_FAILURE_TYPE=""
LAST_FAILED_STORY_ID=""

# Classify failure type from exit code and log contents
# Usage: classify_failure_type <exit_code> <log_file>
# Returns: "timeout", "error", or "quality"
classify_failure_type() {
  local exit_code="$1"
  local log_file="$2"

  # Timeout failures (SIGALRM=124, SIGKILL=137)
  if [[ "$exit_code" -eq 124 ]] || [[ "$exit_code" -eq 137 ]]; then
    echo "timeout"
    return
  fi

  # Quality failures - check log for test/lint/type errors
  if [[ -f "$log_file" ]]; then
    # Check for test failures
    if grep -qiE "(test(s)? (failed|failing)|FAIL |✗ |AssertionError|expect\(.*\)\.to)" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Check for lint errors
    if grep -qiE "(eslint|prettier|lint).*error|linting failed" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
    # Check for TypeScript type errors
    if grep -qiE "error TS[0-9]+:|type error|TypeError:" "$log_file" 2>/dev/null; then
      echo "quality"
      return
    fi
  fi

  # Default to general error
  echo "error"
}

# Check if failure type should trigger agent switch based on config
# Usage: should_trigger_switch <failure_type>
# Returns: 0 (true) if switch should be triggered, 1 (false) otherwise
should_trigger_switch() {
  local failure_type="$1"

  case "$failure_type" in
    timeout)
      [ "${AGENT_SWITCH_ON_TIMEOUT:-true}" = "true" ]] && return 0
      ;;
    error)
      [ "${AGENT_SWITCH_ON_ERROR:-true}" = "true" ]] && return 0
      ;;
    quality)
      [ "${AGENT_SWITCH_ON_QUALITY:-false}" = "true" ]] && return 0
      ;;
  esac
  return 1
}

# Update consecutive failure tracking
# Usage: track_failure <exit_code> <log_file> <story_id>
# Sets: CONSECUTIVE_FAILURES, LAST_FAILURE_TYPE, LAST_FAILED_STORY_ID
track_failure() {
  local exit_code="$1"
  local log_file="$2"
  local story_id="$3"

  LAST_FAILURE_TYPE="$(classify_failure_type "$exit_code" "$log_file")"
  LAST_FAILED_STORY_ID="$story_id"

  # Only increment if the failure type should trigger a switch
  if should_trigger_switch "$LAST_FAILURE_TYPE"; then
    CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
    log_activity "FAILURE_TRACKED agent=$CURRENT_AGENT type=$LAST_FAILURE_TYPE consecutive=$CONSECUTIVE_FAILURES story=$story_id threshold=${AGENT_SWITCH_THRESHOLD:-2}"
  else
    # Log but don't count towards switch threshold
    log_activity "FAILURE_LOGGED agent=$CURRENT_AGENT type=$LAST_FAILURE_TYPE story=$story_id (not counting towards switch)"
  fi
}

# Reset consecutive failure tracking (called on success)
# Usage: reset_failure_tracking
reset_failure_tracking() {
  if [[ "$CONSECUTIVE_FAILURES" -gt 0 ]]; then
    log_activity "FAILURE_RESET agent=$CURRENT_AGENT previous_consecutive=$CONSECUTIVE_FAILURES (story completed successfully)"
  fi
  CONSECUTIVE_FAILURES=0
  LAST_FAILURE_TYPE=""
  LAST_FAILED_STORY_ID=""
}

# Check if switch threshold has been reached
# Usage: switch_threshold_reached
# Returns: 0 if threshold reached, 1 otherwise
switch_threshold_reached() {
  local threshold="${AGENT_SWITCH_THRESHOLD:-2}"
  [ "$CONSECUTIVE_FAILURES" -ge "$threshold" ]]
}

# Get switch state file path for the current PRD
# Usage: get_switch_state_file <prd_folder>
get_switch_state_file() {
  local prd_folder="$1"
  echo "$prd_folder/switch-state.json"
}

# Save switch state to JSON file for cross-run persistence
# Usage: save_switch_state <prd_folder>
save_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_file "$prd_folder")"

  # Create JSON state
  local timestamp
  timestamp="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

  cat > "$state_file" <<EOF
{
  "agent": "$CURRENT_AGENT",
  "failures": $CONSECUTIVE_FAILURES,
  "lastFailureType": "$LAST_FAILURE_TYPE",
  "storyId": "$LAST_FAILED_STORY_ID",
  "chainPosition": $CHAIN_POSITION,
  "updatedAt": "$timestamp"
}
EOF
  msg_dim "Switch state saved: $CONSECUTIVE_FAILURES failures for $CURRENT_AGENT (chain position $CHAIN_POSITION)"
}

# Load switch state from JSON file
# Usage: load_switch_state <prd_folder>
# Sets: CURRENT_AGENT, CONSECUTIVE_FAILURES, LAST_FAILURE_TYPE, LAST_FAILED_STORY_ID, CHAIN_POSITION
load_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_file "$prd_folder")"

  if [[ ! -f "$state_file" ]]; then
    return 1
  fi

  # Parse JSON using Python
  local parsed
  parsed=$(python3 -c "
import json
import sys
try:
    with open('$state_file', 'r') as f:
        d = json.load(f)
    print(d.get('agent', ''))
    print(d.get('failures', 0))
    print(d.get('lastFailureType', ''))
    print(d.get('storyId', ''))
    print(d.get('chainPosition', 0))
except Exception:
    sys.exit(1)
" 2>/dev/null) || return 1

  # Read parsed values line by line
  CURRENT_AGENT=$(echo "$parsed" | sed -n '1p')
  CONSECUTIVE_FAILURES=$(echo "$parsed" | sed -n '2p')
  LAST_FAILURE_TYPE=$(echo "$parsed" | sed -n '3p')
  LAST_FAILED_STORY_ID=$(echo "$parsed" | sed -n '4p')
  CHAIN_POSITION=$(echo "$parsed" | sed -n '5p')

  # Validate
  if [[ -z "$CURRENT_AGENT" ]]; then
    CURRENT_AGENT="$DEFAULT_AGENT_NAME"
  fi
  if [[ -z "$CONSECUTIVE_FAILURES" ]] || ! [[ "$CONSECUTIVE_FAILURES" =~ ^[0-9]+$ ]]; then
    CONSECUTIVE_FAILURES=0
  fi
  if [[ -z "$CHAIN_POSITION" ]] || ! [[ "$CHAIN_POSITION" =~ ^[0-9]+$ ]]; then
    CHAIN_POSITION=0
  fi
  # Update AGENT_CMD to match loaded agent
  AGENT_CMD="$(resolve_agent_cmd "$CURRENT_AGENT")"

  msg_dim "Switch state loaded: $CONSECUTIVE_FAILURES failures for $CURRENT_AGENT (chain position $CHAIN_POSITION)"
  return 0
}

# Clear switch state file (on successful completion of all stories)
# Usage: clear_switch_state <prd_folder>
clear_switch_state() {
  local prd_folder="$1"
  local state_file
  state_file="$(get_switch_state_file "$prd_folder")"

  if [[ -f "$state_file" ]]; then
    rm -f "$state_file"
    msg_dim "Switch state cleared (build complete)"
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Agent Fallback Chain Functions (US-002)
# ─────────────────────────────────────────────────────────────────────────────
# Track current position in the fallback chain
CHAIN_POSITION=0

# Check if an agent CLI is available in PATH
# Usage: agent_available <agent_name>
# Returns: 0 (true) if available, 1 (false) otherwise
agent_available() {
  local agent_name="$1"
  if [[ -z "$agent_name" ]]; then
    return 1
  fi
  command -v "$agent_name" >/dev/null 2>&1
}

# Get the fallback chain as an array (space-separated string from config)
# Usage: chain=($(get_fallback_chain))
get_fallback_chain() {
  echo "${AGENT_FALLBACK_CHAIN:-claude codex droid}"
}

# Switch to the next available agent in the fallback chain
# Usage: switch_to_next_agent
# Returns: 0 if switched successfully, 1 if chain exhausted
# Sets: CURRENT_AGENT, AGENT_CMD, CHAIN_POSITION
switch_to_next_agent() {
  local chain_str
  chain_str="$(get_fallback_chain)"
  local -a chain=($chain_str)
  local chain_length=${#chain[@]}
  local old_agent="$CURRENT_AGENT"
  local start_position=$CHAIN_POSITION

  # Try each agent in the chain starting from current position + 1
  for ((i = 1; i <= chain_length; i++)); do
    local next_pos=$(( (start_position + i) % chain_length ))
    local candidate="${chain[$next_pos]}"

    # Skip if we're back at the current agent (full loop)
    if [[ "$candidate" = "$old_agent" ]]; then
      continue
    fi

    # Check if agent is available
    if agent_available "$candidate"; then
      CHAIN_POSITION=$next_pos
      CURRENT_AGENT="$candidate"
      AGENT_CMD="$(resolve_agent_cmd "$candidate")"
      log_activity "AGENT_SWITCH from=$old_agent to=$CURRENT_AGENT reason=$LAST_FAILURE_TYPE story=${STORY_ID:-unknown} failures=$CONSECUTIVE_FAILURES chain_position=$CHAIN_POSITION"
      msg_warn "Switching agent: $old_agent → $CURRENT_AGENT (after $CONSECUTIVE_FAILURES $LAST_FAILURE_TYPE failure(s))"
      # Track switch for run summary (US-003)
      LAST_SWITCH_COUNT=$((LAST_SWITCH_COUNT + 1))
      LAST_SWITCH_FROM="$old_agent"
      LAST_SWITCH_TO="$CURRENT_AGENT"
      LAST_SWITCH_REASON="$LAST_FAILURE_TYPE"
      # Track agents tried for metrics (US-004)
      if [[ -z "$AGENTS_TRIED_THIS_ITERATION" ]]; then
        AGENTS_TRIED_THIS_ITERATION="$old_agent,$CURRENT_AGENT"
      elif [[ ",$AGENTS_TRIED_THIS_ITERATION," != *",$CURRENT_AGENT,"* ]]; then
        AGENTS_TRIED_THIS_ITERATION="$AGENTS_TRIED_THIS_ITERATION,$CURRENT_AGENT"
      fi
      return 0
    fi
  done

  # Chain exhausted - no available agents found
  log_activity "SWITCH_FAILED reason=chain_exhausted tried=$chain_length story=${STORY_ID:-unknown}"
  msg_error "Agent fallback chain exhausted. No available agents found."
  return 1
}

# Reset chain position to start (first available agent)
# Called when a story completes successfully (US-002)
# Usage: reset_chain_position
# Sets: CHAIN_POSITION, CURRENT_AGENT, AGENT_CMD
reset_chain_position() {
  local chain_str
  chain_str="$(get_fallback_chain)"
  local -a chain=($chain_str)
  local old_agent="$CURRENT_AGENT"
  local old_position=$CHAIN_POSITION

  # Find first available agent in chain
  for ((i = 0; i < ${#chain[@]}; i++)); do
    local candidate="${chain[$i]}"
    if agent_available "$candidate"; then
      CHAIN_POSITION=$i
      CURRENT_AGENT="$candidate"
      AGENT_CMD="$(resolve_agent_cmd "$candidate")"
      if [[ "$old_position" -ne "$i" ]] || [[ "$old_agent" != "$candidate" ]]; then
        log_activity "CHAIN_RESET from=$old_agent to=$CURRENT_AGENT position=$CHAIN_POSITION (story completed successfully)"
        msg_dim "Chain reset: using primary agent $CURRENT_AGENT"
      fi
      return 0
    fi
  done

  # No agents available at all - keep current (shouldn't happen)
  msg_warn "No agents available in chain, keeping $CURRENT_AGENT"
  return 1
}

# Progress indicator: prints elapsed time every PROGRESS_INTERVAL seconds (TTY only)
# Usage: start_progress_indicator; ... long process ...; stop_progress_indicator
# Configure via PROGRESS_INTERVAL in config.sh (default: 30 seconds)
PROGRESS_PID=""
PROGRESS_INTERVAL="${PROGRESS_INTERVAL:-$DEFAULT_PROGRESS_INTERVAL}"
start_progress_indicator() {
  # Only show progress in TTY mode
  if [[ ! -t 1 ]]; then
    return
  fi
  local start_time="$1"
  local story_info="${2:-}"
  local interval="${PROGRESS_INTERVAL:-30}"
  (
    while true; do
      sleep "$interval"
      local now=$(date +%s)
      local elapsed=$((now - start_time))
      local mins=$((elapsed / 60))
      local secs=$((elapsed % 60))
      if [[ "$mins" -gt 0 ]]; then
        printf "${C_DIM}  ⏱ Elapsed: %dm %ds${C_RESET}\n" "$mins" "$secs"
      else
        printf "${C_DIM}  ⏱ Elapsed: %ds${C_RESET}\n" "$secs"
      fi
    done
  ) &
  PROGRESS_PID=$!
}

stop_progress_indicator() {
  if [[ -n "$PROGRESS_PID" ]]; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    wait "$PROGRESS_PID" 2>/dev/null || true
    PROGRESS_PID=""
  fi
}

# Ensure progress indicator is stopped on exit/interrupt
trap 'stop_progress_indicator' EXIT INT TERM

# Resume mode handling
START_ITERATION=1
if [[ "$MODE" = "build" ]] && [[ -n "$RESUME_MODE" ]]; then
  PRD_FOLDER="$(dirname "$PRD_PATH")"

  if load_checkpoint "$PRD_FOLDER"; then
    # Validate git state matches checkpoint
    if ! validate_git_state "$CHECKPOINT_GIT_SHA"; then
      msg_error "Resume cancelled due to git state mismatch."
      exit 1
    fi

    # Prompt user for confirmation
    if ! prompt_resume_confirmation "$CHECKPOINT_ITERATION" "$CHECKPOINT_STORY_ID"; then
      msg_info "Starting fresh build (checkpoint ignored)."
    else
      START_ITERATION=$CHECKPOINT_ITERATION
      msg_success "Resuming from iteration $START_ITERATION (story $CHECKPOINT_STORY_ID)"
    fi
  else
    msg_warn "No checkpoint found. Starting fresh build."
  fi

  # Load switch state for failure tracking persistence (US-001)
  if load_switch_state "$PRD_FOLDER"; then
    if [[ "$CONSECUTIVE_FAILURES" -gt 0 ]]; then
      msg_info "Previous run had $CONSECUTIVE_FAILURES consecutive failure(s) for agent $CURRENT_AGENT"
    fi
  fi
elif [[ "$MODE" = "build" ]]; then
  # Non-resume build mode - load switch state to continue tracking
  PRD_FOLDER="$(dirname "$PRD_PATH")"
  load_switch_state "$PRD_FOLDER" 2>/dev/null || true
fi

for ((i = START_ITERATION; i <= MAX_ITERATIONS; i++)); do
  echo ""
  printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}${C_CYAN}  Running iteration $i/$MAX_ITERATIONS${C_RESET}\n"
  printf "${C_DIM}  Started: $(date '+%Y-%m-%d %H:%M:%S')${C_RESET}\n"
  printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"

  STORY_META=""
  STORY_BLOCK=""
  ITER_START=$(date +%s)
  ITER_START_FMT=$(date '+%Y-%m-%d %H:%M:%S')

  # Reset rollback tracking for this iteration (US-004)
  LAST_ROLLBACK_COUNT=0
  LAST_ROLLBACK_REASON=""
  LAST_ROLLBACK_SUCCESS=""

  # Reset switch tracking for this iteration (US-003, US-004)
  LAST_SWITCH_COUNT=0
  LAST_SWITCH_FROM=""
  LAST_SWITCH_TO=""
  LAST_SWITCH_REASON=""
  # Initialize with current agent for metrics tracking (US-004)
  AGENTS_TRIED_THIS_ITERATION="$CURRENT_AGENT"
  if [[ "$MODE" = "build" ]]; then
    STORY_META="$TMP_DIR/story-$RUN_TAG-$i.json"
    STORY_BLOCK="$TMP_DIR/story-$RUN_TAG-$i.md"
    select_story "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"
    if [[ "$REMAINING" = "unknown" ]]; then
      msg_error "Could not parse stories from PRD: $PRD_PATH"
      exit 1
    fi
    if [[ "$REMAINING" = "0" ]]; then
      # Clear checkpoint and switch state on successful completion
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      clear_checkpoint "$PRD_FOLDER"
      clear_switch_state "$PRD_FOLDER"
      msg_success "No remaining stories."
      exit 0
    fi
    STORY_ID="$(story_field "$STORY_META" "id")"
    STORY_TITLE="$(story_field "$STORY_META" "title")"

    # Check for experiment assignment (may override AGENT_CMD for this story)
    get_experiment_assignment "$STORY_ID"

    # Print current story being worked on
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_CYAN}  Working on: ${C_BOLD}$STORY_ID${C_RESET}${C_CYAN} - $STORY_TITLE${C_RESET}\n"

    # Get model routing decision
    ROUTING_JSON="$(get_routing_decision "$STORY_BLOCK" "${RALPH_MODEL_OVERRIDE:-}")"
    ROUTED_MODEL="$(parse_json_field "$ROUTING_JSON" "model")"
    ROUTED_SCORE="$(parse_json_field "$ROUTING_JSON" "score")"
    ROUTED_REASON="$(parse_json_field "$ROUTING_JSON" "reason")"
    ROUTED_OVERRIDE="$(parse_json_field "$ROUTING_JSON" "override")"

    # Parse complexity breakdown from routing JSON
    ROUTED_BREAKDOWN="$(parse_json_field "$ROUTING_JSON" "breakdown")"

    # Display routing decision with enhanced visualization
    printf "${C_DIM}  ┌─ Routing Decision ────────────────────────────────${C_RESET}\n"
    if [[ "$ROUTED_OVERRIDE" = "true" ]]; then
      printf "${C_DIM}  │${C_RESET} ${C_YELLOW}Model: ${C_BOLD}$ROUTED_MODEL${C_RESET}${C_YELLOW} (manual override)${C_RESET}\n"
    elif [[ -n "$ROUTED_SCORE" ]]; then
      # Determine complexity level and color
      level_color="$C_GREEN"
      level_label="low"
      if [[ "$(echo "$ROUTED_SCORE > 3" | bc -l 2>/dev/null || echo "0")" = "1" ]]; then
        level_color="$C_YELLOW"
        level_label="medium"
      fi
      if [[ "$(echo "$ROUTED_SCORE > 7" | bc -l 2>/dev/null || echo "0")" = "1" ]]; then
        level_color="$C_RED"
        level_label="high"
      fi
      printf "${C_DIM}  │${C_RESET} Complexity: ${level_color}${C_BOLD}${ROUTED_SCORE}/10${C_RESET} (${level_label})\n"
      printf "${C_DIM}  │${C_RESET} Model: ${C_BOLD}$ROUTED_MODEL${C_RESET}\n"
      printf "${C_DIM}  │${C_RESET} Reason: ${C_DIM}$ROUTED_REASON${C_RESET}\n"
    else
      printf "${C_DIM}  │${C_RESET} Model: ${C_BOLD}$ROUTED_MODEL${C_RESET}${C_DIM} (default - routing unavailable)${C_RESET}\n"
    fi

    # Get and display estimated cost before execution
    ESTIMATED_COST_JSON="$(estimate_execution_cost "$ROUTED_MODEL" "$ROUTED_SCORE")"
    ESTIMATED_COST="$(parse_json_field "$ESTIMATED_COST_JSON" "estimatedCost")"
    ESTIMATED_COST_RANGE="$(parse_json_field "$ESTIMATED_COST_JSON" "costRange")"
    ESTIMATED_TOKENS="$(parse_json_field "$ESTIMATED_COST_JSON" "estimatedTokens")"
    ESTIMATED_COMPARISON="$(parse_json_field "$ESTIMATED_COST_JSON" "comparison")"
    if [[ -n "$ESTIMATED_COST" ]] && [[ "$ESTIMATED_COST" != "null" ]]; then
      printf "${C_DIM}  │${C_RESET} Est. cost: ${C_CYAN}\$${ESTIMATED_COST}${C_RESET}"
      if [[ -n "$ESTIMATED_COST_RANGE" ]] && [[ "$ESTIMATED_COST_RANGE" != "null" ]]; then
        printf " ${C_DIM}($ESTIMATED_COST_RANGE)${C_RESET}"
      fi
      printf "\n"
      if [[ -n "$ESTIMATED_COMPARISON" ]] && [[ "$ESTIMATED_COMPARISON" != "null" ]]; then
        printf "${C_DIM}  │${C_RESET} ${C_DIM}$ESTIMATED_COMPARISON${C_RESET}\n"
      fi
    fi
    printf "${C_DIM}  └────────────────────────────────────────────────────${C_RESET}\n"

    # Log model selection to activity log
    log_activity "MODEL_SELECTION story=$STORY_ID complexity=${ROUTED_SCORE:-n/a} model=$ROUTED_MODEL reason=\"$ROUTED_REASON\" estimated_cost=\$${ESTIMATED_COST:-n/a}"
  fi

  HEAD_BEFORE="$(git_head)"
  PROMPT_RENDERED="$TMP_DIR/prompt-$RUN_TAG-$i.md"
  LOG_FILE="$RUNS_DIR/run-$RUN_TAG-iter-$i.log"
  RUN_META="$RUNS_DIR/run-$RUN_TAG-iter-$i.md"
  render_prompt "$PROMPT_FILE" "$PROMPT_RENDERED" "$STORY_META" "$STORY_BLOCK" "$RUN_TAG" "$i" "$LOG_FILE" "$RUN_META"

  if [[ "$MODE" = "build" ]] && [[ -n "${STORY_ID:-}" ]]; then
    log_activity "ITERATION $i start (mode=$MODE story=$STORY_ID)"
  else
    log_activity "ITERATION $i start (mode=$MODE)"
  fi

  # Save checkpoint before story execution (build mode only)
  if [[ "$MODE" = "build" ]] && [[ -n "${STORY_ID:-}" ]]; then
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    save_checkpoint "$PRD_FOLDER" "$ACTIVE_PRD_NUMBER" "$i" "$STORY_ID" "$HEAD_BEFORE" "$DEFAULT_AGENT_NAME"
  fi

  set +e
  # Start progress indicator before agent execution
  start_progress_indicator "$ITER_START"
  if [[ "${RALPH_DRY_RUN:-}" = "1" ]]; then
    echo "[RALPH_DRY_RUN] Skipping agent execution." | tee "$LOG_FILE"
    CMD_STATUS=0
  else
    # Use retry wrapper for automatic retries with exponential backoff
    run_agent_with_retry "$PROMPT_RENDERED" "$LOG_FILE" "$i"
    CMD_STATUS=$?
  fi
  # Stop progress indicator after agent execution
  stop_progress_indicator
  set -e
  if [[ "$CMD_STATUS" -eq 130 ]] || [[ "$CMD_STATUS" -eq 143 ]]; then
    msg_warn "Interrupted."
    exit "$CMD_STATUS"
  fi
  ITER_END=$(date +%s)
  ITER_END_FMT=$(date '+%Y-%m-%d %H:%M:%S')
  ITER_DURATION=$((ITER_END - ITER_START))
  HEAD_AFTER="$(git_head)"
  log_activity "ITERATION $i end (duration=${ITER_DURATION}s)"
  if [[ "$CMD_STATUS" -ne 0 ]]; then
    log_error "ITERATION $i command failed (status=$CMD_STATUS)"
    HAS_ERROR="true"
    # Track failed iteration details for summary
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_ITERATIONS="${FAILED_ITERATIONS}${FAILED_ITERATIONS:+,}$i:${STORY_ID:-plan}:$LOG_FILE"
    # Track failure for agent switching (US-001)
    if [[ "$MODE" = "build" ]] && [[ -n "${STORY_ID:-}" ]]; then
      track_failure "$CMD_STATUS" "$LOG_FILE" "$STORY_ID"
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      save_switch_state "$PRD_FOLDER"
      # Check if we should switch agents (US-002)
      if switch_threshold_reached; then
        if switch_to_next_agent; then
          # Reset failure count after successful switch
          CONSECUTIVE_FAILURES=0
          save_switch_state "$PRD_FOLDER"
          msg_info "Will retry story $STORY_ID with agent $CURRENT_AGENT in next iteration"
        fi
      fi
    fi
  fi
  COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
  CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"
  DIRTY_FILES="$(git_dirty_files)"
  STATUS_LABEL="success"
  if [[ "$CMD_STATUS" -ne 0 ]]; then
    STATUS_LABEL="error"
  else
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
    # Reset failure tracking on success (US-001)
    if [[ "$MODE" = "build" ]] && [[ -n "${STORY_ID:-}" ]]; then
      reset_failure_tracking
      # Reset chain position to primary agent on success (US-002)
      reset_chain_position
    fi
  fi
  # Track iteration result for summary table
  ITERATION_COUNT=$((ITERATION_COUNT + 1))
  TOTAL_DURATION=$((TOTAL_DURATION + ITER_DURATION))
  ITERATION_RESULTS="${ITERATION_RESULTS}${ITERATION_RESULTS:+,}$i|${STORY_ID:-plan}|$ITER_DURATION|$STATUS_LABEL|$LAST_RETRY_COUNT"

  if [[ "$MODE" = "build" ]] && [[ "$NO_COMMIT" = "false" ]] && [[ -n "$DIRTY_FILES" ]]; then
    msg_warn "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
    log_error "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
  fi

  # Extract token metrics from log file
  TOKEN_JSON="$(extract_tokens_from_log "$LOG_FILE")"
  TOKEN_INPUT="$(parse_json_field "$TOKEN_JSON" "inputTokens")"
  TOKEN_OUTPUT="$(parse_json_field "$TOKEN_JSON" "outputTokens")"
  TOKEN_MODEL="$(parse_json_field "$TOKEN_JSON" "model")"
  TOKEN_ESTIMATED="$(parse_json_field "$TOKEN_JSON" "estimated")"

  write_run_meta "$RUN_META" "$MODE" "$i" "$RUN_TAG" "${STORY_ID:-}" "${STORY_TITLE:-}" "$ITER_START_FMT" "$ITER_END_FMT" "$ITER_DURATION" "$STATUS_LABEL" "$LOG_FILE" "$HEAD_BEFORE" "$HEAD_AFTER" "$COMMIT_LIST" "$CHANGED_FILES" "$DIRTY_FILES" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$TOKEN_MODEL" "$TOKEN_ESTIMATED" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "${ROUTED_MODEL:-}" "${ROUTED_SCORE:-}" "${ROUTED_REASON:-}" "${ESTIMATED_COST:-}" "${ESTIMATED_TOKENS:-}" "$LAST_SWITCH_COUNT" "$LAST_SWITCH_FROM" "$LAST_SWITCH_TO" "$LAST_SWITCH_REASON"

  # Append context summary to run meta (build mode only)
  if [[ "$MODE" = "build" ]] && [[ -n "${STORY_BLOCK:-}" ]]; then
    CONTEXT_SUMMARY="$(generate_context_summary "$STORY_BLOCK" "${ROUTED_MODEL:-sonnet}" 15 "$ROOT_DIR")"
    if [[ -n "$CONTEXT_SUMMARY" ]]; then
      append_context_to_run_meta "$RUN_META" "$CONTEXT_SUMMARY"
    fi
  fi

  # Note: append_metrics is called after rollback logic to capture both rollback and switch data
  # See the metrics call below the rollback section

  if [[ "$MODE" = "build" ]] && [[ -n "${STORY_ID:-}" ]]; then
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | story=$STORY_ID | duration=${ITER_DURATION}s | status=$STATUS_LABEL"
  else
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | duration=${ITER_DURATION}s | status=$STATUS_LABEL"
  fi

  if [[ "$MODE" = "build" ]]; then
    select_story "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"

    # ─────────────────────────────────────────────────────────────────────────
    # Rollback on Failure (US-001 + US-003)
    # Check for failures based on ROLLBACK_TRIGGER config and rollback to pre-story state
    # ─────────────────────────────────────────────────────────────────────────
    if [[ "$CMD_STATUS" -ne 0 ]] && [[ "${ROLLBACK_ENABLED:-true}" = "true" ]] && [[ "$NO_COMMIT" = "false" ]]; then
      # US-003: Check for story-level rollback skip via <!-- no-rollback --> comment
      if story_has_no_rollback "${STORY_BLOCK:-}"; then
        log_activity "ROLLBACK_SKIPPED story=$STORY_ID reason=no-rollback-directive"
        msg_dim "Rollback skipped: story has <!-- no-rollback --> directive"
      # Check if failure matches configured trigger policy (US-003)
      elif detect_failure "$LOG_FILE" "${ROLLBACK_TRIGGER:-test-fail}"; then
        log_activity "FAILURE_DETECTED story=$STORY_ID trigger=${ROLLBACK_TRIGGER:-test-fail}"

        # Save failure context for retry before rollback
        FAILURE_CONTEXT_FILE="$(save_failure_context "$LOG_FILE" "$RUNS_DIR" "$RUN_TAG" "$i" "${STORY_ID:-unknown}")"

        # Determine failure reason based on trigger policy for notification
        local failure_reason
        case "${ROLLBACK_TRIGGER:-test-fail}" in
          test-fail) failure_reason="Test failure detected" ;;
          lint-fail) failure_reason="Lint failure detected" ;;
          type-fail) failure_reason="Type check failure detected" ;;
          any-fail)  failure_reason="Build failure detected (any-fail policy)" ;;
          *)         failure_reason="Failure detected" ;;
        esac

        # Perform rollback to pre-story state
        if rollback_to_checkpoint "$HEAD_BEFORE" "${STORY_ID:-unknown}" "${ROLLBACK_TRIGGER:-test-fail}"; then
          # Notify user of successful rollback
          notify_rollback "${STORY_ID:-unknown}" "$failure_reason" "$HEAD_BEFORE" "$FAILURE_CONTEXT_FILE"
          log_activity "ROLLBACK_SUCCESS story=$STORY_ID context=$FAILURE_CONTEXT_FILE"
          # Log rollback event for history tracking (US-004)
          log_rollback "${STORY_ID:-unknown}" "${ROLLBACK_TRIGGER:-test-fail}" "$(git_head)" "$HEAD_BEFORE" "1" "true" "$FAILURE_CONTEXT_FILE"

          # Update rollback tracking variables for metrics (US-004)
          LAST_ROLLBACK_COUNT=$((LAST_ROLLBACK_COUNT + 1))
          LAST_ROLLBACK_REASON="${ROLLBACK_TRIGGER:-test-fail}"
          LAST_ROLLBACK_SUCCESS="true"

          # Update HEAD_AFTER to reflect rollback
          HEAD_AFTER="$(git_head)"
          COMMIT_LIST=""
          CHANGED_FILES=""

          # ─────────────────────────────────────────────────────────────────────
          # Intelligent Retry (US-002)
          # Retry the story with enhanced context after successful rollback
          # ─────────────────────────────────────────────────────────────────────
          if [[ "${ROLLBACK_RETRY_ENABLED:-true}" = "true" ]]; then
            ROLLBACK_MAX="${ROLLBACK_MAX_RETRIES:-3}"

            # Track retry attempts for this story (use a simple file-based approach)
            RETRY_TRACKING_FILE="$RUNS_DIR/retry-count-${STORY_ID:-unknown}.txt"
            if [[ -f "$RETRY_TRACKING_FILE" ]]; then
              CURRENT_RETRY_COUNT=$(cat "$RETRY_TRACKING_FILE")
            else
              CURRENT_RETRY_COUNT=0
            fi

            CURRENT_RETRY_COUNT=$((CURRENT_RETRY_COUNT + 1))
            echo "$CURRENT_RETRY_COUNT" > "$RETRY_TRACKING_FILE"

            if [[ "$CURRENT_RETRY_COUNT" -le "$ROLLBACK_MAX" ]]; then
              printf "\n"
              printf "${C_CYAN}${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
              printf "${C_CYAN}${C_BOLD}║            INTELLIGENT RETRY (US-002)                 ║${C_RESET}\n"
              printf "${C_CYAN}${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
              printf "\n"
              printf "  ${C_BOLD}Story:${C_RESET}  %s\n" "${STORY_ID:-unknown}"
              printf "  ${C_BOLD}Retry:${C_RESET}  %s of %s\n" "$CURRENT_RETRY_COUNT" "$ROLLBACK_MAX"
              printf "  ${C_BOLD}Context:${C_RESET} %s\n" "$FAILURE_CONTEXT_FILE"
              printf "\n"
              printf "${C_DIM}  Preparing enhanced retry prompt with failure context...${C_RESET}\n"
              printf "\n"

              log_activity "ROLLBACK_RETRY story=$STORY_ID attempt=$CURRENT_RETRY_COUNT/$ROLLBACK_MAX context=$FAILURE_CONTEXT_FILE"

              # Render retry prompt with failure context
              RETRY_PROMPT_RENDERED="$TMP_DIR/prompt-retry-$RUN_TAG-$i-retry$CURRENT_RETRY_COUNT.md"
              RETRY_LOG_FILE="$RUNS_DIR/run-$RUN_TAG-iter-$i-retry$CURRENT_RETRY_COUNT.log"
              RETRY_RUN_META="$RUNS_DIR/run-$RUN_TAG-iter-$i-retry$CURRENT_RETRY_COUNT.md"

              render_retry_prompt "$PROMPT_RETRY" "$RETRY_PROMPT_RENDERED" "$STORY_META" "$STORY_BLOCK" "$RUN_TAG" "$i" "$RETRY_LOG_FILE" "$RETRY_RUN_META" "$FAILURE_CONTEXT_FILE" "$CURRENT_RETRY_COUNT" "$ROLLBACK_MAX"

              # Execute retry
              RETRY_START=$(date +%s)
              set +e
              start_progress_indicator "$RETRY_START"
              run_agent_with_retry "$RETRY_PROMPT_RENDERED" "$RETRY_LOG_FILE" "$i"
              RETRY_STATUS=$?
              stop_progress_indicator
              set -e

              RETRY_END=$(date +%s)
              RETRY_DURATION=$((RETRY_END - RETRY_START))

              if [[ "$RETRY_STATUS" -eq 0 ]]; then
                # Retry succeeded! Log success for rollback history (US-004)
                log_rollback "${STORY_ID:-unknown}" "retry_success" "$HEAD_BEFORE" "$(git_head)" "$CURRENT_RETRY_COUNT" "true" "$FAILURE_CONTEXT_FILE"
                printf "${C_GREEN}${C_BOLD}  Retry $CURRENT_RETRY_COUNT SUCCEEDED${C_RESET}\n"
                log_activity "ROLLBACK_RETRY_SUCCESS story=$STORY_ID attempt=$CURRENT_RETRY_COUNT duration=${RETRY_DURATION}s"

                # Update rollback tracking - mark as success since retry worked (US-004)
                LAST_ROLLBACK_COUNT=$CURRENT_RETRY_COUNT
                LAST_ROLLBACK_REASON="retry_success"
                LAST_ROLLBACK_SUCCESS="true"

                # Clear retry tracking file on success
                rm -f "$RETRY_TRACKING_FILE"

                # Update metrics with successful retry
                CMD_STATUS=0
                STATUS_LABEL="success"
                SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
                HEAD_AFTER="$(git_head)"
                COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
                CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"

                # Update run meta for the retry
                write_run_meta "$RETRY_RUN_META" "$MODE" "$i" "$RUN_TAG" "${STORY_ID:-}" "${STORY_TITLE:-} (Retry $CURRENT_RETRY_COUNT)" "$ITER_START_FMT" "$(date '+%Y-%m-%d %H:%M:%S')" "$RETRY_DURATION" "success" "$RETRY_LOG_FILE" "$HEAD_BEFORE" "$HEAD_AFTER" "$COMMIT_LIST" "$CHANGED_FILES" "" "" "" "" "" "" "" "" "" "" "" ""
              else
                # Retry failed
                printf "${C_YELLOW}  Retry $CURRENT_RETRY_COUNT failed${C_RESET}\n"
                log_activity "ROLLBACK_RETRY_FAILED story=$STORY_ID attempt=$CURRENT_RETRY_COUNT duration=${RETRY_DURATION}s"

                # Check if we should rollback this retry too (use same trigger policy)
                if detect_failure "$RETRY_LOG_FILE" "${ROLLBACK_TRIGGER:-test-fail}"; then
                  log_activity "RETRY_FAILURE story=$STORY_ID attempt=$CURRENT_RETRY_COUNT trigger=${ROLLBACK_TRIGGER:-test-fail}"
                  # Save new failure context
                  FAILURE_CONTEXT_FILE="$(save_failure_context "$RETRY_LOG_FILE" "$RUNS_DIR" "$RUN_TAG" "$i-retry$CURRENT_RETRY_COUNT" "${STORY_ID:-unknown}")"
                  # Rollback the retry attempt
                  if rollback_to_checkpoint "$HEAD_BEFORE" "${STORY_ID:-unknown}" "retry_${ROLLBACK_TRIGGER:-test-fail}"; then
                    # Log retry rollback for history tracking (US-004)
                    log_rollback "${STORY_ID:-unknown}" "retry_${ROLLBACK_TRIGGER:-test-fail}" "$(git_head)" "$HEAD_BEFORE" "$CURRENT_RETRY_COUNT" "true" "$FAILURE_CONTEXT_FILE"
                  fi
                fi
              fi
            else
              # Max retries exhausted
              printf "\n"
              printf "${C_RED}${C_BOLD}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
              printf "${C_RED}${C_BOLD}║          MAX RETRIES EXHAUSTED                        ║${C_RESET}\n"
              printf "${C_RED}${C_BOLD}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
              printf "\n"
              printf "  ${C_BOLD}Story:${C_RESET}  %s\n" "${STORY_ID:-unknown}"
              printf "  ${C_BOLD}Attempts:${C_RESET} %s (max: %s)\n" "$CURRENT_RETRY_COUNT" "$ROLLBACK_MAX"
              printf "\n"
              printf "${C_DIM}  Story will be skipped. Review failure context and fix manually.${C_RESET}\n"
              printf "${C_DIM}  Context file: %s${C_RESET}\n" "$FAILURE_CONTEXT_FILE"
              printf "\n"

              log_activity "MAX_RETRIES_EXHAUSTED story=$STORY_ID attempts=$CURRENT_RETRY_COUNT max=$ROLLBACK_MAX"
              log_error "MAX_RETRIES_EXHAUSTED story=$STORY_ID - manual intervention required"
              # Log max retries exhausted for history tracking (US-004)
              log_rollback "${STORY_ID:-unknown}" "max_retries_exhausted" "$(git_head)" "$HEAD_BEFORE" "$CURRENT_RETRY_COUNT" "false" "$FAILURE_CONTEXT_FILE"

              # Update rollback tracking - mark as failure since max retries exhausted (US-004)
              LAST_ROLLBACK_COUNT=$CURRENT_RETRY_COUNT
              LAST_ROLLBACK_REASON="max_retries_exhausted"
              LAST_ROLLBACK_SUCCESS="false"

              # Clear retry tracking file
              rm -f "$RETRY_TRACKING_FILE"
            fi
          fi
        else
          log_error "ROLLBACK_FAILED story=${STORY_ID:-unknown}"
          msg_error "Rollback failed - manual intervention may be required"
          # Log failed rollback for history tracking (US-004)
          log_rollback "${STORY_ID:-unknown}" "${ROLLBACK_TRIGGER:-test-fail}" "$(git_head)" "$HEAD_BEFORE" "1" "false" "${FAILURE_CONTEXT_FILE:-}"

          # Update rollback tracking variables for metrics (US-004)
          LAST_ROLLBACK_COUNT=$((LAST_ROLLBACK_COUNT + 1))
          LAST_ROLLBACK_REASON="${ROLLBACK_TRIGGER:-test-fail}"
          LAST_ROLLBACK_SUCCESS="false"
        fi
      fi
    fi

    # Append metrics to metrics.jsonl for historical tracking (build mode only)
    # Called after rollback logic to capture rollback data (US-004)
    PRD_FOLDER="$(dirname "$PRD_PATH")"
    append_metrics "$PRD_FOLDER" "${STORY_ID}" "${STORY_TITLE:-}" "$ITER_DURATION" "$TOKEN_INPUT" "$TOKEN_OUTPUT" "$DEFAULT_AGENT_NAME" "$TOKEN_MODEL" "$STATUS_LABEL" "$RUN_TAG" "$i" "$LAST_RETRY_COUNT" "$LAST_RETRY_TOTAL_TIME" "${ROUTED_SCORE:-}" "${ROUTED_REASON:-}" "${ESTIMATED_COST:-}" "${EXPERIMENT_NAME:-}" "${EXPERIMENT_VARIANT:-}" "${EXPERIMENT_EXCLUDED:-}" "$LAST_ROLLBACK_COUNT" "$LAST_ROLLBACK_REASON" "$LAST_ROLLBACK_SUCCESS"

    if [[ "$CMD_STATUS" -ne 0 ]]; then
      # Differentiate agent errors vs system errors
      if [[ "$CMD_STATUS" -eq 1 ]]; then
        show_error "ITERATION $i: Agent exited with error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "agent"
      else
        show_error "ITERATION $i: System/command error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "system"
      fi
      log_error "ITERATION $i exited non-zero (code=$CMD_STATUS); review $LOG_FILE"
    fi
    if grep -q "<promise>COMPLETE</promise>" "$LOG_FILE"; then
      if [[ "$REMAINING" = "0" ]]; then
        printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
        printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
        printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
        # Print summary table before exit
        print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
        rebuild_token_cache
        # Clear checkpoint and switch state on successful completion
        PRD_FOLDER="$(dirname "$PRD_PATH")"
        clear_checkpoint "$PRD_FOLDER"
        clear_switch_state "$PRD_FOLDER"
        msg_success "All stories complete."
        exit 0
      fi
      msg_info "Completion signal received; stories remaining: $REMAINING"
    fi
    # Iteration completion separator
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
    printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
    msg_success "Iteration $i complete. Remaining stories: $REMAINING"
    if [[ "$REMAINING" = "0" ]]; then
      # Print summary table before exit
      print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
      rebuild_token_cache
      # Clear checkpoint and switch state on successful completion
      PRD_FOLDER="$(dirname "$PRD_PATH")"
      clear_checkpoint "$PRD_FOLDER"
      clear_switch_state "$PRD_FOLDER"
      msg_success "No remaining stories."
      exit 0
    fi
  else
    # Handle plan mode errors
    if [[ "$CMD_STATUS" -ne 0 ]]; then
      # Differentiate agent errors vs system errors
      if [[ "$CMD_STATUS" -eq 1 ]]; then
        show_error "ITERATION $i: Agent exited with error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "agent"
      else
        show_error "ITERATION $i: System/command error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "system"
      fi
      log_error "ITERATION $i (plan) exited non-zero (code=$CMD_STATUS); review $LOG_FILE"
    fi
    # Iteration completion separator (plan mode)
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
    printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
    msg_success "Iteration $i complete."
  fi

  # Configurable delay between iterations (US-007)
  # Configure via ITERATION_DELAY in config.sh (default: 0, minimum: 2)
  local iter_delay="${ITERATION_DELAY:-$DEFAULT_ITERATION_DELAY}"
  if [[ "$iter_delay" -lt 2 ]]; then
    iter_delay=2  # Minimum 2 second delay for stability
  fi
  sleep "$iter_delay"

done

# Get final remaining count for summary
FINAL_REMAINING="${REMAINING:-unknown}"
if [[ "$MODE" = "build" ]] && [[ -f "$STORY_META" ]]; then
  FINAL_REMAINING="$(remaining_stories "$STORY_META")"
fi

# Print iteration summary table
print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "$FINAL_REMAINING"

# Rebuild token cache for dashboard
rebuild_token_cache

msg_warn "Reached max iterations ($MAX_ITERATIONS)."
if [[ "$MODE" = "plan" ]]; then
  echo ""
  msg_info "Next steps (if you want to proceed):"
  msg_dim "1) Review the plan in \"$PLAN_PATH\"."
  msg_dim "2) Start implementation with: ralph build"
  msg_dim "3) Test a single run without committing: ralph build 1 --no-commit"
fi

# Print error summary at end of run if any iterations failed
print_error_summary "$FAILED_ITERATIONS" "$FAILED_COUNT"

if [[ "$HAS_ERROR" = "true" ]]; then
  exit 1
fi
exit 0
