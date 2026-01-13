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
      echo "${AGENT_CLAUDE_CMD:-claude -p --dangerously-skip-permissions \"\$(cat {prompt})\"}"
      ;;
    droid)
      echo "${AGENT_DROID_CMD:-droid exec --skip-permissions-unsafe -f {prompt}}"
      ;;
    codex|"")
      echo "${AGENT_CODEX_CMD:-codex exec --yolo --skip-git-repo-check -}"
      ;;
    *)
      echo "${AGENT_CODEX_CMD:-codex exec --yolo --skip-git-repo-check -}"
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
    echo "AGENT_CMD is empty. Set it in config.sh."
    exit 1
  fi
  if ! command -v "$agent_bin" >/dev/null 2>&1; then
    echo "Agent command not found: $agent_bin"
    case "$agent_bin" in
      codex)
        echo "Install: npm i -g @openai/codex"
        ;;
      claude)
        echo "Install: curl -fsSL https://claude.ai/install.sh | bash"
        ;;
      droid)
        echo "Install: curl -fsSL https://app.factory.ai/cli | sh"
        ;;
    esac
    echo "Then authenticate per the CLI's instructions."
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
        echo "Unknown arg: $1"
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
    echo "PRD request missing. Provide a prompt string or --prompt <file>."
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
  echo "Prompt not found: $PROMPT_FILE"
  exit 1
fi

if [ "$MODE" != "prd" ] && [ ! -f "$PRD_PATH" ]; then
  echo "PRD not found: $PRD_PATH"
  exit 1
fi

if [ "$MODE" = "build" ] && [ ! -f "$PLAN_PATH" ]; then
  echo "Plan not found: $PLAN_PATH"
  echo "Create it first with:"
  echo "  ./.agents/ralph/loop.sh plan"
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

echo "Ralph mode: $MODE"
echo "Max iterations: $MAX_ITERATIONS"
echo "PRD: $PRD_PATH"
echo "Plan: $PLAN_PATH"
HAS_ERROR="false"

for i in $(seq 1 "$MAX_ITERATIONS"); do
  echo ""
  echo "═══════════════════════════════════════════════════════"
  echo "  Ralph Iteration $i of $MAX_ITERATIONS"
  echo "═══════════════════════════════════════════════════════"

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
      echo "Could not parse stories from PRD: $PRD_PATH"
      exit 1
    fi
    if [ "$REMAINING" = "0" ]; then
      echo "No remaining stories."
      exit 0
    fi
    STORY_ID="$(story_field "$STORY_META" "id")"
    STORY_TITLE="$(story_field "$STORY_META" "title")"
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
  if [ "${RALPH_DRY_RUN:-}" = "1" ]; then
    echo "[RALPH_DRY_RUN] Skipping agent execution." | tee "$LOG_FILE"
    CMD_STATUS=0
  else
    run_agent "$PROMPT_RENDERED" 2>&1 | tee "$LOG_FILE"
    CMD_STATUS=$?
  fi
  set -e
  if [ "$CMD_STATUS" -eq 130 ] || [ "$CMD_STATUS" -eq 143 ]; then
    echo "Interrupted."
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
  fi
  COMMIT_LIST="$(git_commit_list "$HEAD_BEFORE" "$HEAD_AFTER")"
  CHANGED_FILES="$(git_changed_files "$HEAD_BEFORE" "$HEAD_AFTER")"
  DIRTY_FILES="$(git_dirty_files)"
  STATUS_LABEL="success"
  if [ "$CMD_STATUS" -ne 0 ]; then
    STATUS_LABEL="error"
  fi
  if [ "$MODE" = "build" ] && [ "$NO_COMMIT" = "false" ] && [ -n "$DIRTY_FILES" ]; then
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
      log_error "ITERATION $i exited non-zero; review $LOG_FILE"
    fi
    if grep -q "<promise>COMPLETE</promise>" "$LOG_FILE"; then
      if [ "$REMAINING" = "0" ]; then
        echo "All stories complete."
        exit 0
      fi
      echo "Completion signal received; stories remaining: $REMAINING"
    fi
    echo "Iteration $i complete. Remaining stories: $REMAINING"
    if [ "$REMAINING" = "0" ]; then
      echo "No remaining stories."
      exit 0
    fi
  else
    echo "Iteration $i complete."
  fi
  sleep 2

done

echo "Reached max iterations ($MAX_ITERATIONS)."
if [ "$MODE" = "plan" ]; then
  echo ""
  echo "Next steps (if you want to proceed):"
  echo "1) Review the plan in \"$PLAN_PATH\"."
  echo "2) Start implementation with: ralph build"
  echo "3) Test a single run without committing: ralph build 1 --no-commit"
fi
if [ "$HAS_ERROR" = "true" ]; then
  exit 1
fi
exit 0
