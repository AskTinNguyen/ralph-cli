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

DEFAULT_PRD_PATH=".agents/tasks/prd.md"
DEFAULT_PLAN_PATH=".ralph/IMPLEMENTATION_PLAN.md"
DEFAULT_PROGRESS_PATH=".ralph/progress.md"
DEFAULT_AGENTS_PATH="AGENTS.md"
DEFAULT_PROMPT_PLAN=".agents/ralph/PROMPT_plan.md"
DEFAULT_PROMPT_BUILD=".agents/ralph/PROMPT_build.md"
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
PRD_REQUEST_PATH=""
PRD_INLINE=""

# Optional config overrides (simple shell vars)
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  . "$CONFIG_FILE"
fi

DEFAULT_AGENT_NAME="${DEFAULT_AGENT:-codex}"
resolve_agent_cmd() {
  local name="$1"
  case "$name" in
    claude)
      if [[ -n "${AGENT_CLAUDE_CMD:-}" ]]; then
        echo "$AGENT_CLAUDE_CMD"
      else
        echo "claude -p --dangerously-skip-permissions"
      fi
      ;;
    droid)
      if [[ -n "${AGENT_DROID_CMD:-}" ]]; then
        echo "$AGENT_DROID_CMD"
      else
        echo "droid exec --skip-permissions-unsafe -f {prompt}"
      fi
      ;;
    codex|"")
      if [[ -n "${AGENT_CODEX_CMD:-}" ]]; then
        echo "$AGENT_CODEX_CMD"
      else
        echo "codex exec --yolo --skip-git-repo-check -"
      fi
      ;;
    *)
      if [[ -n "${AGENT_CODEX_CMD:-}" ]]; then
        echo "$AGENT_CODEX_CMD"
      else
        echo "codex exec --yolo --skip-git-repo-check -"
      fi
      ;;
  esac
}
DEFAULT_AGENT_CMD="$(resolve_agent_cmd "$DEFAULT_AGENT_NAME")"

PRD_PATH="${PRD_PATH:-$DEFAULT_PRD_PATH}"
PLAN_PATH="${PLAN_PATH:-$DEFAULT_PLAN_PATH}"
PROGRESS_PATH="${PROGRESS_PATH:-$DEFAULT_PROGRESS_PATH}"
AGENTS_PATH="${AGENTS_PATH:-$DEFAULT_AGENTS_PATH}"
PROMPT_PLAN="${PROMPT_PLAN:-$DEFAULT_PROMPT_PLAN}"
PROMPT_BUILD="${PROMPT_BUILD:-$DEFAULT_PROMPT_BUILD}"
GUARDRAILS_PATH="${GUARDRAILS_PATH:-$DEFAULT_GUARDRAILS_PATH}"
ERRORS_LOG_PATH="${ERRORS_LOG_PATH:-$DEFAULT_ERRORS_LOG_PATH}"
ACTIVITY_LOG_PATH="${ACTIVITY_LOG_PATH:-$DEFAULT_ACTIVITY_LOG_PATH}"
TMP_DIR="${TMP_DIR:-$DEFAULT_TMP_DIR}"
RUNS_DIR="${RUNS_DIR:-$DEFAULT_RUNS_DIR}"
GUARDRAILS_REF="${GUARDRAILS_REF:-$DEFAULT_GUARDRAILS_REF}"
CONTEXT_REF="${CONTEXT_REF:-$DEFAULT_CONTEXT_REF}"
ACTIVITY_CMD="${ACTIVITY_CMD:-$DEFAULT_ACTIVITY_CMD}"
AGENT_CMD="${AGENT_CMD:-$DEFAULT_AGENT_CMD}"
MAX_ITERATIONS="${MAX_ITERATIONS:-$DEFAULT_MAX_ITERATIONS}"
NO_COMMIT="${NO_COMMIT:-$DEFAULT_NO_COMMIT}"

# Color output support with TTY detection
# Colors are disabled when stdout is not a TTY (pipes, redirects)
if [ -t 1 ]; then
  C_GREEN='\033[32m'
  C_RED='\033[31m'
  C_YELLOW='\033[33m'
  C_CYAN='\033[36m'
  C_DIM='\033[2m'
  C_BOLD='\033[1m'
  C_RESET='\033[0m'
else
  C_GREEN=''
  C_RED=''
  C_YELLOW=''
  C_CYAN=''
  C_DIM=''
  C_BOLD=''
  C_RESET=''
fi

# Colored output helper functions
msg_success() {
  printf "${C_GREEN}%s${C_RESET}\n" "$1"
}

msg_error() {
  printf "${C_BOLD}${C_RED}%s${C_RESET}\n" "$1"
}

msg_warn() {
  printf "${C_YELLOW}%s${C_RESET}\n" "$1"
}

msg_info() {
  printf "${C_CYAN}%s${C_RESET}\n" "$1"
}

msg_dim() {
  printf "${C_DIM}%s${C_RESET}\n" "$1"
}

abs_path() {
  local p="$1"
  if [[ "$p" = /* ]]; then
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
  if [ -z "$agent_bin" ]; then
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

run_agent() {
  local prompt_file="$1"
  if [[ "$AGENT_CMD" == *"{prompt}"* ]]; then
    local escaped
    escaped=$(printf '%q' "$prompt_file")
    local cmd="${AGENT_CMD//\{prompt\}/$escaped}"
    eval "$cmd"
  else
    cat "$prompt_file" | eval "$AGENT_CMD"
  fi
}

run_agent_inline() {
  local prompt_file="$1"
  local prompt_content
  prompt_content="$(cat "$prompt_file")"
  local escaped
  escaped=$(printf "%s" "$prompt_content" | sed "s/'/'\\\\''/g")
  if [[ "$PRD_AGENT_CMD" == *"{prompt}"* ]]; then
    local cmd="${PRD_AGENT_CMD//\{prompt\}/'$escaped'}"
    eval "$cmd"
  else
    eval "$PRD_AGENT_CMD '$escaped'"
  fi
}

MODE="build"
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
    *)
      if [ "$MODE" = "prd" ]; then
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
if [ "$MODE" = "plan" ] && [ "$MAX_ITERATIONS" = "$DEFAULT_MAX_ITERATIONS" ]; then
  MAX_ITERATIONS=1
fi

PROMPT_FILE="$PROMPT_BUILD"
if [ "$MODE" = "plan" ]; then
  PROMPT_FILE="$PROMPT_PLAN"
fi

if [ "$MODE" = "prd" ]; then
  PRD_USE_INLINE=1
  if [ -z "$PRD_AGENT_CMD" ]; then
    PRD_AGENT_CMD="$AGENT_CMD"
    PRD_USE_INLINE=0
  fi
  if [ "${RALPH_DRY_RUN:-}" != "1" ]; then
    require_agent "$PRD_AGENT_CMD"
  fi

  mkdir -p "$(dirname "$PRD_PATH")" "$TMP_DIR"

  if [ -z "$PRD_REQUEST_PATH" ] && [ -n "$PRD_INLINE" ]; then
    PRD_REQUEST_PATH="$TMP_DIR/prd-request-$(date +%Y%m%d-%H%M%S)-$$.txt"
    printf '%s\n' "$PRD_INLINE" > "$PRD_REQUEST_PATH"
  fi

  if [ -z "$PRD_REQUEST_PATH" ] || [ ! -f "$PRD_REQUEST_PATH" ]; then
    msg_error "PRD request missing. Provide a prompt string or --prompt <file>."
    exit 1
  fi

  if [ "${RALPH_DRY_RUN:-}" = "1" ]; then
    if [ ! -f "$PRD_PATH" ]; then
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

  if [ "$PRD_USE_INLINE" -eq 1 ]; then
    run_agent_inline "$PRD_PROMPT_FILE"
  else
    run_agent "$PRD_PROMPT_FILE"
  fi
  exit 0
fi

if [ "${RALPH_DRY_RUN:-}" != "1" ]; then
  require_agent
fi

if [ ! -f "$PROMPT_FILE" ]; then
  msg_warn "Prompt not found: $PROMPT_FILE"
  exit 1
fi

if [ "$MODE" != "prd" ] && [ ! -f "$PRD_PATH" ]; then
  msg_warn "PRD not found: $PRD_PATH"
  exit 1
fi

if [ "$MODE" = "build" ] && [ ! -f "$PLAN_PATH" ]; then
  msg_warn "Plan not found: $PLAN_PATH"
  echo "Create it first with:"
  msg_info "  ./.agents/ralph/loop.sh plan"
  exit 1
fi

mkdir -p "$(dirname "$PROGRESS_PATH")" "$TMP_DIR" "$RUNS_DIR"

if [ ! -f "$PROGRESS_PATH" ]; then
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

if [ ! -f "$GUARDRAILS_PATH" ]; then
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

if [ ! -f "$ERRORS_LOG_PATH" ]; then
  {
    echo "# Error Log"
    echo ""
    echo "> Failures and repeated issues. Use this to add guardrails."
    echo ""
  } > "$ERRORS_LOG_PATH"
fi

if [ ! -f "$ACTIVITY_LOG_PATH" ]; then
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

render_prompt() {
  local src="$1"
  local dst="$2"
  local story_meta="$3"
  local story_block="$4"
  local run_id="$5"
  local iter="$6"
  local run_log="$7"
  local run_meta="$8"
  python3 - "$src" "$dst" "$PRD_PATH" "$PLAN_PATH" "$AGENTS_PATH" "$PROGRESS_PATH" "$ROOT_DIR" "$GUARDRAILS_PATH" "$ERRORS_LOG_PATH" "$ACTIVITY_LOG_PATH" "$GUARDRAILS_REF" "$CONTEXT_REF" "$ACTIVITY_CMD" "$NO_COMMIT" "$story_meta" "$story_block" "$run_id" "$iter" "$run_log" "$run_meta" <<'PY'
import sys
from pathlib import Path

src = Path(sys.argv[1]).read_text()
prd, plan, agents, progress, root = sys.argv[3:8]
guardrails = sys.argv[8]
errors_log = sys.argv[9]
activity_log = sys.argv[10]
guardrails_ref = sys.argv[11]
context_ref = sys.argv[12]
activity_cmd = sys.argv[13]
no_commit = sys.argv[14]
meta_path = sys.argv[15] if len(sys.argv) > 15 else ""
block_path = sys.argv[16] if len(sys.argv) > 16 else ""
run_id = sys.argv[17] if len(sys.argv) > 17 else ""
iteration = sys.argv[18] if len(sys.argv) > 18 else ""
run_log = sys.argv[19] if len(sys.argv) > 19 else ""
run_meta = sys.argv[20] if len(sys.argv) > 20 else ""
repl = {
    "PRD_PATH": prd,
    "PLAN_PATH": plan,
    "AGENTS_PATH": agents,
    "PROGRESS_PATH": progress,
    "REPO_ROOT": root,
    "GUARDRAILS_PATH": guardrails,
    "ERRORS_LOG_PATH": errors_log,
    "ACTIVITY_LOG_PATH": activity_log,
    "GUARDRAILS_REF": guardrails_ref,
    "CONTEXT_REF": context_ref,
    "ACTIVITY_CMD": activity_cmd,
    "NO_COMMIT": no_commit,
    "RUN_ID": run_id,
    "ITERATION": iteration,
    "RUN_LOG_PATH": run_log,
    "RUN_META_PATH": run_meta,
}
story = {"id": "", "title": "", "block": ""}
if meta_path:
    try:
        import json
        meta = json.loads(Path(meta_path).read_text())
        story["id"] = meta.get("id", "") or ""
        story["title"] = meta.get("title", "") or ""
    except Exception:
        pass
if block_path and Path(block_path).exists():
    story["block"] = Path(block_path).read_text()
repl["STORY_ID"] = story["id"]
repl["STORY_TITLE"] = story["title"]
repl["STORY_BLOCK"] = story["block"]
for k, v in repl.items():
    src = src.replace("{{" + k + "}}", v)
Path(sys.argv[2]).write_text(src)
PY
}

select_story() {
  local meta_out="$1"
  local block_out="$2"
  python3 - "$PRD_PATH" "$meta_out" "$block_out" <<'PY'
import json
import re
import sys
from pathlib import Path

prd_path = Path(sys.argv[1])
meta_out = Path(sys.argv[2])
block_out = Path(sys.argv[3])

text = prd_path.read_text().splitlines()
pattern = re.compile(r'^###\s+(\[(?P<status>[ xX])\]\s+)?(?P<id>US-\d+):\s*(?P<title>.+)$')

stories = []
current = None
for line in text:
    m = pattern.match(line)
    if m:
        if current:
            stories.append(current)
        current = {
            "id": m.group("id"),
            "title": m.group("title").strip(),
            "status": (m.group("status") or " "),
            "lines": [line],
        }
    elif current is not None:
        current["lines"].append(line)
if current:
    stories.append(current)

if not stories:
    meta_out.write_text(json.dumps({"ok": False, "error": "No stories found in PRD"}, indent=2) + "\n")
    block_out.write_text("")
    sys.exit(0)

def is_done(story):
    return str(story.get("status", "")).strip().lower() == "x"

remaining = [s for s in stories if not is_done(s)]
meta = {"ok": True, "total": len(stories), "remaining": len(remaining)}

if remaining:
    target = remaining[0]
    meta.update({
        "id": target["id"],
        "title": target["title"],
    })
    block_out.write_text("\n".join(target["lines"]))
else:
    block_out.write_text("")

meta_out.write_text(json.dumps(meta, indent=2) + "\n")
PY
}

remaining_stories() {
  local meta_file="$1"
  python3 - "$meta_file" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
print(data.get("remaining", "unknown"))
PY
}

story_field() {
  local meta_file="$1"
  local field="$2"
  python3 - "$meta_file" "$field" <<'PY'
import json
import sys
from pathlib import Path

data = json.loads(Path(sys.argv[1]).read_text())
field = sys.argv[2]
print(data.get(field, ""))
PY
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

# Enhanced error display with path highlighting and suggestions
# Usage: show_error "message" ["log_path"]
show_error() {
  local message="$1"
  local log_path="${2:-}"
  msg_error "$message"
  if [ -n "$log_path" ]; then
    printf "  ${C_RED}Review logs at: ${C_BOLD}%s${C_RESET}\n" "$log_path"
  fi
}

# Show helpful suggestions when errors occur
show_error_suggestions() {
  local error_type="${1:-agent}"  # agent or system
  printf "\n${C_YELLOW}${C_BOLD}Suggested next steps:${C_RESET}\n"
  if [ "$error_type" = "agent" ]; then
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

  if [ -z "$failed_data" ] || [ "$count" -eq 0 ]; then
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
    if [ -n "$story" ] && [ "$story" != "plan" ]; then
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
  if [ "$mins" -gt 0 ]; then
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

  if [ -z "$results" ] || [ "$total_count" -eq 0 ]; then
    return
  fi

  # Only show table for multi-iteration runs (2+)
  if [ "$total_count" -lt 2 ]; then
    return
  fi

  echo ""
  printf "${C_CYAN}╔═══════════════════════════════════════════════════════╗${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD}${C_CYAN}            ITERATION SUMMARY                          ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╠═════╤════════════╤════════════╤════════════════════════╣${C_RESET}\n"
  printf "${C_CYAN}║${C_RESET}${C_BOLD} Iter│   Story    │  Duration  │         Status         ${C_RESET}${C_CYAN}║${C_RESET}\n"
  printf "${C_CYAN}╟─────┼────────────┼────────────┼────────────────────────╢${C_RESET}\n"

  # Parse and display each iteration result
  IFS=',' read -ra RESULTS <<< "$results"
  for result in "${RESULTS[@]}"; do
    IFS='|' read -r iter story duration status <<< "$result"
    local dur_str
    dur_str=$(format_duration "$duration")

    # Status symbol and color
    local status_display
    if [ "$status" = "success" ]; then
      status_display="${C_GREEN}✓ success${C_RESET}"
    else
      status_display="${C_RED}✗ error${C_RESET}"
    fi

    # Truncate story ID if too long (max 10 chars)
    local story_display="${story:-plan}"
    if [ "${#story_display}" -gt 10 ]; then
      story_display="${story_display:0:10}"
    fi

    printf "${C_CYAN}║${C_RESET} %3s │ %-10s │ %10s │ %-22b ${C_CYAN}║${C_RESET}\n" "$iter" "$story_display" "$dur_str" "$status_display"
  done

  printf "${C_CYAN}╠═════╧════════════╧════════════╧════════════════════════╣${C_RESET}\n"

  # Aggregate stats
  local total_dur_str
  total_dur_str=$(format_duration "$total_time")
  local success_rate
  if [ "$total_count" -gt 0 ]; then
    success_rate=$((success_count * 100 / total_count))
  else
    success_rate=0
  fi

  # Color-code success rate
  local rate_color="$C_GREEN"
  if [ "$success_rate" -lt 100 ]; then
    rate_color="$C_YELLOW"
  fi
  if [ "$success_rate" -lt 50 ]; then
    rate_color="$C_RED"
  fi

  printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Total time:${C_RESET} %-12s ${C_BOLD}Success rate:${C_RESET} ${rate_color}%d/%d (%d%%)${C_RESET}    ${C_CYAN}║${C_RESET}\n" "$total_dur_str" "$success_count" "$total_count" "$success_rate"
  if [ -n "$remaining" ] && [ "$remaining" != "unknown" ] && [ "$remaining" != "0" ]; then
    printf "${C_CYAN}║${C_RESET}  ${C_BOLD}Stories remaining:${C_RESET} %-35s ${C_CYAN}║${C_RESET}\n" "$remaining"
  fi
  printf "${C_CYAN}╚═══════════════════════════════════════════════════════╝${C_RESET}\n"
}

append_run_summary() {
  local line="$1"
  python3 - "$ACTIVITY_LOG_PATH" "$line" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
line = sys.argv[2]
text = path.read_text().splitlines()
out = []
inserted = False
for l in text:
    out.append(l)
    if not inserted and l.strip() == "## Run Summary":
        out.append(f"- {line}")
        inserted = True
if not inserted:
    out = [
        "# Activity Log",
        "",
        "## Run Summary",
        f"- {line}",
        "",
        "## Events",
        "",
    ] + text
Path(path).write_text("\n".join(out).rstrip() + "\n")
PY
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
  {
    echo "# Ralph Run Summary"
    echo ""
    echo "- Run ID: $run_id"
    echo "- Iteration: $iter"
    echo "- Mode: $mode"
    if [ -n "$story_id" ]; then
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
    if [ -n "$commit_list" ]; then
      echo "$commit_list"
    else
      echo "- (none)"
    fi
    echo ""
    echo "### Changed Files (commits)"
    if [ -n "$changed_files" ]; then
      echo "$changed_files"
    else
      echo "- (none)"
    fi
    echo ""
    echo "### Uncommitted Changes"
    if [ -n "$dirty_files" ]; then
      echo "$dirty_files"
    else
      echo "- (clean)"
    fi
    echo ""
  } > "$path"
}

git_head() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" rev-parse HEAD 2>/dev/null || true
  else
    echo ""
  fi
}

git_commit_list() {
  local before="$1"
  local after="$2"
  if [ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ]; then
    git -C "$ROOT_DIR" log --oneline "$before..$after" | sed 's/^/- /'
  else
    echo ""
  fi
}

git_changed_files() {
  local before="$1"
  local after="$2"
  if [ -n "$before" ] && [ -n "$after" ] && [ "$before" != "$after" ]; then
    git -C "$ROOT_DIR" diff --name-only "$before" "$after" | sed 's/^/- /'
  else
    echo ""
  fi
}

git_dirty_files() {
  if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git -C "$ROOT_DIR" status --porcelain | awk '{print "- " $2}'
  else
    echo ""
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

# Progress indicator: prints elapsed time every N seconds (TTY only)
# Usage: start_progress_indicator; ... long process ...; stop_progress_indicator
PROGRESS_PID=""
start_progress_indicator() {
  # Only show progress in TTY mode
  if [ ! -t 1 ]; then
    return
  fi
  local start_time="$1"
  local story_info="${2:-}"
  (
    while true; do
      sleep 5
      local now=$(date +%s)
      local elapsed=$((now - start_time))
      local mins=$((elapsed / 60))
      local secs=$((elapsed % 60))
      if [ "$mins" -gt 0 ]; then
        printf "${C_DIM}  ⏱ Elapsed: %dm %ds${C_RESET}\n" "$mins" "$secs"
      else
        printf "${C_DIM}  ⏱ Elapsed: %ds${C_RESET}\n" "$secs"
      fi
    done
  ) &
  PROGRESS_PID=$!
}

stop_progress_indicator() {
  if [ -n "$PROGRESS_PID" ]; then
    kill "$PROGRESS_PID" 2>/dev/null || true
    wait "$PROGRESS_PID" 2>/dev/null || true
    PROGRESS_PID=""
  fi
}

# Ensure progress indicator is stopped on exit/interrupt
trap 'stop_progress_indicator' EXIT INT TERM

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
  printf "${C_BOLD}${C_CYAN}  Running iteration $i/$MAX_ITERATIONS${C_RESET}\n"
  printf "${C_DIM}  Started: $(date '+%Y-%m-%d %H:%M:%S')${C_RESET}\n"
  printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"

  STORY_META=""
  STORY_BLOCK=""
  ITER_START=$(date +%s)
  ITER_START_FMT=$(date '+%Y-%m-%d %H:%M:%S')
  if [ "$MODE" = "build" ]; then
    STORY_META="$TMP_DIR/story-$RUN_TAG-$i.json"
    STORY_BLOCK="$TMP_DIR/story-$RUN_TAG-$i.md"
    select_story "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"
    if [ "$REMAINING" = "unknown" ]; then
      msg_error "Could not parse stories from PRD: $PRD_PATH"
      exit 1
    fi
    if [ "$REMAINING" = "0" ]; then
      msg_success "No remaining stories."
      exit 0
    fi
    STORY_ID="$(story_field "$STORY_META" "id")"
    STORY_TITLE="$(story_field "$STORY_META" "title")"
    # Print current story being worked on
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
    printf "${C_CYAN}  Working on: ${C_BOLD}$STORY_ID${C_RESET}${C_CYAN} - $STORY_TITLE${C_RESET}\n"
    printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
  fi

  HEAD_BEFORE="$(git_head)"
  PROMPT_RENDERED="$TMP_DIR/prompt-$RUN_TAG-$i.md"
  LOG_FILE="$RUNS_DIR/run-$RUN_TAG-iter-$i.log"
  RUN_META="$RUNS_DIR/run-$RUN_TAG-iter-$i.md"
  render_prompt "$PROMPT_FILE" "$PROMPT_RENDERED" "$STORY_META" "$STORY_BLOCK" "$RUN_TAG" "$i" "$LOG_FILE" "$RUN_META"

  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    log_activity "ITERATION $i start (mode=$MODE story=$STORY_ID)"
  else
    log_activity "ITERATION $i start (mode=$MODE)"
  fi
  set +e
  # Start progress indicator before agent execution
  start_progress_indicator "$ITER_START"
  if [ "${RALPH_DRY_RUN:-}" = "1" ]; then
    echo "[RALPH_DRY_RUN] Skipping agent execution." | tee "$LOG_FILE"
    CMD_STATUS=0
  else
    run_agent "$PROMPT_RENDERED" 2>&1 | tee "$LOG_FILE"
    CMD_STATUS=$?
  fi
  # Stop progress indicator after agent execution
  stop_progress_indicator
  set -e
  if [ "$CMD_STATUS" -eq 130 ] || [ "$CMD_STATUS" -eq 143 ]; then
    msg_warn "Interrupted."
    exit "$CMD_STATUS"
  fi
  ITER_END=$(date +%s)
  ITER_END_FMT=$(date '+%Y-%m-%d %H:%M:%S')
  ITER_DURATION=$((ITER_END - ITER_START))
  HEAD_AFTER="$(git_head)"
  log_activity "ITERATION $i end (duration=${ITER_DURATION}s)"
  if [ "$CMD_STATUS" -ne 0 ]; then
    log_error "ITERATION $i command failed (status=$CMD_STATUS)"
    HAS_ERROR="true"
    # Track failed iteration details for summary
    FAILED_COUNT=$((FAILED_COUNT + 1))
    FAILED_ITERATIONS="${FAILED_ITERATIONS}${FAILED_ITERATIONS:+,}$i:${STORY_ID:-plan}:$LOG_FILE"
  fi
  COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
  CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"
  DIRTY_FILES="$(git_dirty_files)"
  STATUS_LABEL="success"
  if [ "$CMD_STATUS" -ne 0 ]; then
    STATUS_LABEL="error"
  else
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  fi
  # Track iteration result for summary table
  ITERATION_COUNT=$((ITERATION_COUNT + 1))
  TOTAL_DURATION=$((TOTAL_DURATION + ITER_DURATION))
  ITERATION_RESULTS="${ITERATION_RESULTS}${ITERATION_RESULTS:+,}$i|${STORY_ID:-plan}|$ITER_DURATION|$STATUS_LABEL"

  if [ "$MODE" = "build" ] && [ "$NO_COMMIT" = "false" ] && [ -n "$DIRTY_FILES" ]; then
    msg_warn "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
    log_error "ITERATION $i left uncommitted changes; review run summary at $RUN_META"
  fi
  write_run_meta "$RUN_META" "$MODE" "$i" "$RUN_TAG" "${STORY_ID:-}" "${STORY_TITLE:-}" "$ITER_START_FMT" "$ITER_END_FMT" "$ITER_DURATION" "$STATUS_LABEL" "$LOG_FILE" "$HEAD_BEFORE" "$HEAD_AFTER" "$COMMIT_LIST" "$CHANGED_FILES" "$DIRTY_FILES"
  if [ "$MODE" = "build" ] && [ -n "${STORY_ID:-}" ]; then
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | story=$STORY_ID | duration=${ITER_DURATION}s | status=$STATUS_LABEL"
  else
    append_run_summary "$(date '+%Y-%m-%d %H:%M:%S') | run=$RUN_TAG | iter=$i | mode=$MODE | duration=${ITER_DURATION}s | status=$STATUS_LABEL"
  fi

  if [ "$MODE" = "build" ]; then
    select_story "$STORY_META" "$STORY_BLOCK"
    REMAINING="$(remaining_stories "$STORY_META")"
    if [ "$CMD_STATUS" -ne 0 ]; then
      # Differentiate agent errors vs system errors
      if [ "$CMD_STATUS" -eq 1 ]; then
        show_error "ITERATION $i: Agent exited with error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "agent"
      else
        show_error "ITERATION $i: System/command error (exit code: $CMD_STATUS)" "$LOG_FILE"
        show_error_suggestions "system"
      fi
      log_error "ITERATION $i exited non-zero (code=$CMD_STATUS); review $LOG_FILE"
    fi
    if grep -q "<promise>COMPLETE</promise>" "$LOG_FILE"; then
      if [ "$REMAINING" = "0" ]; then
        printf "${C_CYAN}───────────────────────────────────────────────────────${C_RESET}\n"
        printf "${C_DIM}  Finished: $(date '+%Y-%m-%d %H:%M:%S') (${ITER_DURATION}s)${C_RESET}\n"
        printf "${C_CYAN}═══════════════════════════════════════════════════════${C_RESET}\n"
        # Print summary table before exit
        print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
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
    if [ "$REMAINING" = "0" ]; then
      # Print summary table before exit
      print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "0"
      msg_success "No remaining stories."
      exit 0
    fi
  else
    # Handle plan mode errors
    if [ "$CMD_STATUS" -ne 0 ]; then
      # Differentiate agent errors vs system errors
      if [ "$CMD_STATUS" -eq 1 ]; then
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
  sleep 2

done

# Get final remaining count for summary
FINAL_REMAINING="${REMAINING:-unknown}"
if [ "$MODE" = "build" ] && [ -f "$STORY_META" ]; then
  FINAL_REMAINING="$(remaining_stories "$STORY_META")"
fi

# Print iteration summary table
print_summary_table "$ITERATION_RESULTS" "$TOTAL_DURATION" "$SUCCESS_COUNT" "$ITERATION_COUNT" "$FINAL_REMAINING"

msg_warn "Reached max iterations ($MAX_ITERATIONS)."
if [ "$MODE" = "plan" ]; then
  echo ""
  msg_info "Next steps (if you want to proceed):"
  msg_dim "1) Review the plan in \"$PLAN_PATH\"."
  msg_dim "2) Start implementation with: ralph build"
  msg_dim "3) Test a single run without committing: ralph build 1 --no-commit"
fi

# Print error summary at end of run if any iterations failed
print_error_summary "$FAILED_ITERATIONS" "$FAILED_COUNT"

if [ "$HAS_ERROR" = "true" ]; then
  exit 1
fi
exit 0
