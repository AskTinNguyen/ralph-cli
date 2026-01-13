#!/usr/bin/env bash
#
# Ralph CLI - Autonomous Coding Loop (Pure Bash)
#
# Philosophy: while :; do cat prompt.md | agent ; done
# Same task. New brain each iteration. Memory is filesystem + git, not chat.
#
# Usage:
#   ralph install          Install skills to current repo
#   ralph update           Update skills to latest version
#   ralph new "task"       Create a new task
#   ralph list             List all tasks
#   ralph go <id>          Run task (headless, pure loop)
#
# Zero dependencies. Works on any Unix system with bash 3.2+.

set -euo pipefail

# ============================================================================
# Configuration
# ============================================================================

RALPH_DIR=".ralph"
CLAUDE_SKILLS_DIR=".claude/skills"

# Find the script's directory (for bundled skills/templates)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILLS_SOURCE="${SCRIPT_DIR}/../skills"
TEMPLATES_SOURCE="${SCRIPT_DIR}/../templates"

# Colors (if terminal supports it)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    NC='\033[0m' # No Color
else
    RED='' GREEN='' YELLOW='' BLUE='' NC=''
fi

# ============================================================================
# Helpers
# ============================================================================

log_info()  { echo -e "${BLUE}$*${NC}"; }
log_ok()    { echo -e "${GREEN}✓ $*${NC}"; }
log_warn()  { echo -e "${YELLOW}⚠ $*${NC}"; }
log_error() { echo -e "${RED}✗ $*${NC}" >&2; }

# Normalize task ID: "1" -> "ralph-1", "ralph-1" -> "ralph-1"
normalize_id() {
    local id="$1"
    if [[ "$id" =~ ^[0-9]+$ ]]; then
        echo "ralph-$id"
    else
        echo "$id"
    fi
}

# Get the next available task ID
get_next_task_id() {
    local max_id=0
    if [[ -d "$RALPH_DIR" ]]; then
        for dir in "$RALPH_DIR"/ralph-*; do
            if [[ -d "$dir" ]]; then
                local num="${dir##*ralph-}"
                if [[ "$num" =~ ^[0-9]+$ ]] && (( num > max_id )); then
                    max_id=$num
                fi
            fi
        done
    fi
    echo "ralph-$((max_id + 1))"
}

# ============================================================================
# Commands
# ============================================================================

cmd_install() {
    log_info "Installing Ralph skills..."
    echo ""

    # Check if skills source exists
    if [[ ! -d "$SKILLS_SOURCE" ]]; then
        log_error "Skills not found at: $SKILLS_SOURCE"
        log_error "Make sure you're running from the ralph-cli package."
        exit 1
    fi

    # Create skills directory
    mkdir -p "$CLAUDE_SKILLS_DIR"

    # Copy each skill
    for skill in ralph-go ralph-new ralph-plan; do
        if [[ -d "$SKILLS_SOURCE/$skill" ]]; then
            cp -r "$SKILLS_SOURCE/$skill" "$CLAUDE_SKILLS_DIR/"
            log_ok "Installed $skill"
        fi
    done

    # Create .ralph directory with guardrails
    mkdir -p "$RALPH_DIR"

    if [[ ! -f "$RALPH_DIR/guardrails.md" ]]; then
        if [[ -f "$TEMPLATES_SOURCE/guardrails.md" ]]; then
            cp "$TEMPLATES_SOURCE/guardrails.md" "$RALPH_DIR/"
            log_ok "Created $RALPH_DIR/guardrails.md"
        fi
    else
        echo "  - $RALPH_DIR/guardrails.md already exists"
    fi

    echo ""
    log_ok "Ralph installed successfully!"
    echo ""
    echo "Next steps:"
    echo "  1. Start Claude Code: claude"
    echo "  2. Create a task: /ralph-new Add my feature"
    echo "  3. Run the task: /ralph-go 1"
}

cmd_update() {
    log_info "Updating Ralph skills..."
    echo ""

    # Check if skills source exists
    if [[ ! -d "$SKILLS_SOURCE" ]]; then
        log_error "Skills not found at: $SKILLS_SOURCE"
        exit 1
    fi

    # Check if already installed
    local has_existing=false
    for skill in ralph-go ralph-new ralph-plan; do
        if [[ -d "$CLAUDE_SKILLS_DIR/$skill" ]]; then
            has_existing=true
            break
        fi
    done

    if [[ "$has_existing" == "false" ]]; then
        echo "No Ralph skills found. Running install instead..."
        cmd_install
        return
    fi

    # Update each skill
    for skill in ralph-go ralph-new ralph-plan; do
        if [[ -d "$SKILLS_SOURCE/$skill" ]]; then
            rm -rf "${CLAUDE_SKILLS_DIR:?}/$skill"
            cp -r "$SKILLS_SOURCE/$skill" "$CLAUDE_SKILLS_DIR/"
            log_ok "Updated $skill"
        fi
    done

    # Update guardrails if not customized
    if [[ -f "$RALPH_DIR/guardrails.md" ]]; then
        if grep -q "(Add your project's constraints here)" "$RALPH_DIR/guardrails.md" 2>/dev/null; then
            if [[ -f "$TEMPLATES_SOURCE/guardrails.md" ]]; then
                cp "$TEMPLATES_SOURCE/guardrails.md" "$RALPH_DIR/"
                log_ok "Updated $RALPH_DIR/guardrails.md"
            fi
        else
            echo "  - $RALPH_DIR/guardrails.md skipped (customized)"
        fi
    fi

    echo ""
    log_ok "Ralph skills updated successfully!"
}

cmd_new() {
    local task_name="$1"

    if [[ -z "$task_name" ]]; then
        log_error "Usage: ralph new \"task description\""
        exit 1
    fi

    local task_id
    task_id=$(get_next_task_id)
    local task_dir="$RALPH_DIR/$task_id"

    # Create task directory
    mkdir -p "$task_dir"

    # Create guardrails if first task
    if [[ ! -f "$RALPH_DIR/guardrails.md" ]]; then
        if [[ -f "$TEMPLATES_SOURCE/guardrails.md" ]]; then
            cp "$TEMPLATES_SOURCE/guardrails.md" "$RALPH_DIR/"
        fi
    fi

    # Create plan.md from template
    if [[ -f "$TEMPLATES_SOURCE/plan.md" ]]; then
        sed "s/{{TASK_NAME}}/$task_name/g" "$TEMPLATES_SOURCE/plan.md" > "$task_dir/plan.md"
    else
        # Inline template if source not found
        cat > "$task_dir/plan.md" << EOF
---
task: $task_name
test_command: make test
completion_promise: "All tests pass and $task_name is complete"
max_iterations: 15
---

# Task: $task_name

## Context
(Describe what needs to be done)

## Success Criteria
- [ ] First criterion
- [ ] Second criterion
- [ ] All tests pass
EOF
    fi

    # Create empty state files
    echo "# Progress" > "$task_dir/progress.md"
    touch "$task_dir/errors.log"

    echo "Created task: $task_id"
    echo "  $RALPH_DIR/$task_id/plan.md"
    echo ""
    echo "To start:"
    echo "  claude then /ralph-go ${task_id#ralph-}"
    echo "Or headless:"
    echo "  ralph go ${task_id#ralph-}"
}

cmd_list() {
    if [[ ! -d "$RALPH_DIR" ]]; then
        echo "No .ralph/ directory found."
        echo "Run: ralph new \"task description\""
        return
    fi

    local found=false
    echo "Ralph tasks:"

    # Sort numerically by extracting the number
    for dir in $(ls -d "$RALPH_DIR"/ralph-* 2>/dev/null | sort -t- -k2 -n); do
        if [[ -d "$dir" ]]; then
            found=true
            local task_id="${dir##*/}"
            local task_name="$task_id"
            local iterations=0

            # Extract task name from frontmatter
            if [[ -f "$dir/plan.md" ]]; then
                local name
                name=$(grep -m1 '^task:' "$dir/plan.md" 2>/dev/null | sed 's/^task:[[:space:]]*//' || true)
                [[ -n "$name" ]] && task_name="$name"
            fi

            # Count iterations from progress.md
            if [[ -f "$dir/progress.md" ]]; then
                iterations=$(grep -c '## Iteration' "$dir/progress.md" 2>/dev/null) || iterations=0
            fi

            echo "  $task_id: $task_name ($iterations iterations)"
        fi
    done

    if [[ "$found" == "false" ]]; then
        echo "No tasks found."
    fi
}

cmd_go() {
    local task_id_arg="$1"

    if [[ -z "$task_id_arg" ]]; then
        log_error "Usage: ralph go <task-id>"
        exit 1
    fi

    local task_id
    task_id=$(normalize_id "$task_id_arg")
    local task_dir="$RALPH_DIR/$task_id"

    if [[ ! -d "$task_dir" ]]; then
        log_error "Task not found: $task_id"
        cmd_list
        exit 1
    fi

    # Read max_iterations from plan.md frontmatter
    local max_iterations=15
    if [[ -f "$task_dir/plan.md" ]]; then
        local max
        max=$(grep -m1 'max_iterations:' "$task_dir/plan.md" 2>/dev/null | sed 's/.*:[[:space:]]*//' || true)
        [[ "$max" =~ ^[0-9]+$ ]] && max_iterations=$max
    fi

    log_info "Running Ralph on $task_id..."
    echo "Max iterations: $max_iterations"
    echo ""

    # =========================================================================
    # PURE LOOP: Fresh brain each iteration, memory is filesystem + git
    # =========================================================================
    for (( iteration=1; iteration<=max_iterations; iteration++ )); do
        echo ""
        echo "$(printf '=%.0s' {1..50})"
        echo "Iteration $iteration/$max_iterations"
        echo "$(printf '=%.0s' {1..50})"
        echo ""

        # Fresh Claude invocation - no accumulated context
        local output
        output=$(claude -p "/ralph-go $task_id" --output-format text 2>&1) || true

        echo "$output"

        # Check completion signals
        if echo "$output" | grep -q '<promise>COMPLETE'; then
            echo ""
            log_ok "Task completed successfully"
            exit 0
        fi

        if echo "$output" | grep -q 'NEEDS_HUMAN'; then
            echo ""
            log_warn "Task needs human intervention"
            exit 2
        fi

        # Loop continues: new brain, same task, updated filesystem
    done

    echo ""
    log_error "Max iterations ($max_iterations) reached without completion"
    exit 1
}

cmd_help() {
    cat << 'EOF'
Ralph - Autonomous Coding Loop

Usage:
  ralph install          Install skills to current repo
  ralph update           Update skills to latest version
  ralph new "task"       Create a new task
  ralph list             List all tasks
  ralph go <id>          Run task (headless, pure loop)

For interactive use:
  claude
  /ralph-go <id>

Philosophy:
  while :; do cat prompt.md | agent ; done
  Same task. New brain each iteration. Memory is filesystem + git, not chat.

EOF
}

# ============================================================================
# Main
# ============================================================================

main() {
    local command="${1:-}"
    shift || true

    case "$command" in
        install)
            cmd_install
            ;;
        update)
            cmd_update
            ;;
        new)
            cmd_new "${*:-}"
            ;;
        list)
            cmd_list
            ;;
        go)
            cmd_go "${1:-}"
            ;;
        -h|--help|help|"")
            cmd_help
            ;;
        *)
            log_error "Unknown command: $command"
            cmd_help
            exit 1
            ;;
    esac
}

main "$@"
