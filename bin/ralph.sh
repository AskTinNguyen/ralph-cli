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

setup_path() {
    # Check if already in PATH
    if command -v ralph.sh &>/dev/null; then
        return 0
    fi

    # Detect shell config file
    local shell_config=""
    local shell_name="${SHELL##*/}"

    case "$shell_name" in
        zsh)  shell_config="$HOME/.zshrc" ;;
        bash)
            if [[ -f "$HOME/.bash_profile" ]]; then
                shell_config="$HOME/.bash_profile"
            else
                shell_config="$HOME/.bashrc"
            fi
            ;;
        *)    shell_config="$HOME/.profile" ;;
    esac

    # Check if already added to config
    if grep -q "ralph-cli/bin" "$shell_config" 2>/dev/null; then
        log_ok "PATH already configured in $shell_config"
        return 0
    fi

    echo ""
    echo "Add ralph.sh to PATH for easier access?"
    echo "  This will add a line to $shell_config"
    echo ""
    printf "  Add to PATH? [Y/n] "
    read -r response

    if [[ "$response" =~ ^[Nn] ]]; then
        echo ""
        echo "Skipped. To add manually later:"
        echo "  export PATH=\"$SCRIPT_DIR:\$PATH\""
        return 0
    fi

    # Add to shell config
    echo "" >> "$shell_config"
    echo "# Ralph CLI" >> "$shell_config"
    echo "export PATH=\"$SCRIPT_DIR:\$PATH\"" >> "$shell_config"

    log_ok "Added to $shell_config"
    echo ""
    echo "Run this to use immediately (or restart terminal):"
    echo "  source $shell_config"
}

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

    # Offer to add to PATH
    setup_path

    echo ""
    echo "Next steps:"
    echo "  1. Start Claude Code: claude"
    echo "  2. Create a task: /ralph-new Add my feature"
    echo "  3. Run the task:"
    echo "     - Autonomous loop: ralph.sh go 1"
    echo "     - Single iteration: /ralph-go 1 (inside Claude Code)"
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

cmd_upgrade() {
    log_info "Upgrading Ralph CLI..."
    echo ""

    # Find the ralph-cli repo directory (parent of bin/)
    local ralph_repo="${SCRIPT_DIR}/.."

    # Check if it's a git repo
    if [[ ! -d "$ralph_repo/.git" ]]; then
        log_error "Cannot upgrade: ralph-cli is not a git repository"
        echo "If you installed via curl, re-download the script:"
        echo "  curl -O https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/bin/ralph.sh"
        exit 1
    fi

    # Pull latest changes
    echo "Pulling latest changes..."
    if (cd "$ralph_repo" && git pull); then
        log_ok "Ralph CLI updated to latest version"
    else
        log_error "Failed to pull updates"
        exit 1
    fi

    echo ""

    # If in a project with ralph installed, update skills too
    if [[ -d "$CLAUDE_SKILLS_DIR/ralph-go" ]]; then
        echo "Updating skills in current project..."
        cmd_update
    else
        echo "No Ralph skills in current directory."
        echo "Run 'ralph.sh install' in your project to install skills."
    fi
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

cmd_status() {
    echo ""
    log_info "Ralph Status"
    echo ""

    # Check for running ralph processes
    local running_pids
    running_pids=$(pgrep -f "ralph.sh go" 2>/dev/null | grep -v $$ || true)

    if [[ -n "$running_pids" ]]; then
        echo "🔄 Active loops:"
        for pid in $running_pids; do
            local cmd
            cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
            if [[ -n "$cmd" ]]; then
                echo "   PID $pid: $cmd"
            fi
        done
        echo ""
    else
        echo "No active ralph loops running."
        echo ""
    fi

    if [[ ! -d "$RALPH_DIR" ]]; then
        echo "No .ralph/ directory found."
        return
    fi

    echo "Tasks:"
    echo "$(printf '─%.0s' {1..50})"

    for dir in $(ls -d "$RALPH_DIR"/ralph-* 2>/dev/null | sort -t- -k2 -n); do
        if [[ -d "$dir" ]]; then
            local task_id="${dir##*/}"
            local task_name="$task_id"
            local status_icon="⏸"
            local status_text="pending"
            local iterations=0
            local last_activity=""

            # Extract task name from frontmatter
            if [[ -f "$dir/plan.md" ]]; then
                local name
                name=$(grep -m1 '^task:' "$dir/plan.md" 2>/dev/null | sed 's/^task:[[:space:]]*//' || true)
                [[ -n "$name" ]] && task_name="$name"
            fi

            # Count iterations and check status from progress.md
            if [[ -f "$dir/progress.md" ]]; then
                iterations=$(grep -c '## Iteration' "$dir/progress.md" 2>/dev/null) || iterations=0

                # Check for completion
                if grep -q 'COMPLETE' "$dir/progress.md" 2>/dev/null; then
                    status_icon="✅"
                    status_text="complete"
                elif grep -q 'NEEDS_HUMAN' "$dir/progress.md" 2>/dev/null; then
                    status_icon="⚠️"
                    status_text="needs human"
                elif [[ $iterations -gt 0 ]]; then
                    status_icon="🔄"
                    status_text="in progress"
                fi

                # Get last activity time
                last_activity=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$dir/progress.md" 2>/dev/null || \
                               stat -c "%y" "$dir/progress.md" 2>/dev/null | cut -d. -f1 || true)
            fi

            # Check for errors
            local error_count=0
            if [[ -f "$dir/errors.log" ]] && [[ -s "$dir/errors.log" ]]; then
                error_count=$(wc -l < "$dir/errors.log" | tr -d ' ')
            fi

            echo ""
            echo "$status_icon $task_id: $task_name"
            echo "   Status: $status_text | Iterations: $iterations | Errors: $error_count"
            [[ -n "$last_activity" ]] && echo "   Last activity: $last_activity"
        fi
    done

    echo ""
}

cmd_log() {
    local task_id_arg="$1"
    local log_type="${2:-all}"  # all, progress, errors, activity

    if [[ -z "$task_id_arg" ]]; then
        log_error "Usage: ralph log <task-id> [progress|errors|all]"
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

    echo ""
    log_info "Logs for $task_id"
    echo ""

    case "$log_type" in
        progress)
            if [[ -f "$task_dir/progress.md" ]]; then
                cat "$task_dir/progress.md"
            else
                echo "No progress.md found"
            fi
            ;;
        errors)
            if [[ -f "$task_dir/errors.log" ]] && [[ -s "$task_dir/errors.log" ]]; then
                echo "=== Errors ==="
                cat "$task_dir/errors.log"
            else
                echo "No errors logged"
            fi
            ;;
        all|*)
            # Show progress
            if [[ -f "$task_dir/progress.md" ]]; then
                echo "$(printf '=%.0s' {1..50})"
                echo "PROGRESS"
                echo "$(printf '=%.0s' {1..50})"
                cat "$task_dir/progress.md"
                echo ""
            fi

            # Show errors if any
            if [[ -f "$task_dir/errors.log" ]] && [[ -s "$task_dir/errors.log" ]]; then
                echo "$(printf '=%.0s' {1..50})"
                echo "ERRORS"
                echo "$(printf '=%.0s' {1..50})"
                cat "$task_dir/errors.log"
                echo ""
            fi

            # Show plan summary
            if [[ -f "$task_dir/plan.md" ]]; then
                echo "$(printf '=%.0s' {1..50})"
                echo "PLAN"
                echo "$(printf '=%.0s' {1..50})"
                head -30 "$task_dir/plan.md"
                echo ""
            fi
            ;;
    esac
}

# Process stream-json output for real-time display
process_stream() {
    while IFS= read -r line; do
        # Skip non-JSON lines
        [[ "$line" != "{"* ]] && continue

        # Extract and print text from content_block_delta events
        if [[ "$line" == *'"content_block_delta"'* ]]; then
            if command -v jq &>/dev/null; then
                printf '%s' "$(echo "$line" | jq -j '.delta.text // empty' 2>/dev/null)"
            else
                # Fallback sed parsing
                printf '%s' "$(echo "$line" | sed -n 's/.*"text":"\([^"]*\)".*/\1/p' | sed 's/\\n/\n/g; s/\\"/"/g' 2>/dev/null)" || true
            fi
        fi
    done
    echo ""  # Final newline
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
        # Use temp file to capture output while streaming to terminal
        local tmpfile
        tmpfile=$(mktemp)

        # Run claude with stream-json for real-time events
        # --verbose is required for stream-json in print mode
        # --include-partial-messages shows chunks as they arrive
        claude -p "/ralph-go $task_id" \
            --output-format stream-json \
            --verbose \
            --include-partial-messages \
            --dangerously-skip-permissions \
            2>&1 | tee "$tmpfile" | process_stream

        # Check completion signals from captured output
        if grep -q '<promise>COMPLETE' "$tmpfile"; then
            rm -f "$tmpfile"
            echo ""
            log_ok "Task completed successfully"
            exit 0
        fi

        if grep -q 'NEEDS_HUMAN' "$tmpfile"; then
            rm -f "$tmpfile"
            echo ""
            log_warn "Task needs human intervention"
            exit 2
        fi

        rm -f "$tmpfile"

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
  ralph.sh install          Install skills to current repo
  ralph.sh new "task"       Create a new task
  ralph.sh list             List all tasks
  ralph.sh status           Show status of all tasks and running loops
  ralph.sh log <id>         Show logs for a task
  ralph.sh log <id> errors  Show only errors for a task
  ralph.sh go <id>          Run task (headless, loops until COMPLETE)
  ralph.sh update           Update skills in current project
  ralph.sh upgrade          Pull latest CLI + update skills

For interactive use (one iteration at a time):
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
        upgrade)
            cmd_upgrade
            ;;
        new)
            cmd_new "${*:-}"
            ;;
        list)
            cmd_list
            ;;
        status)
            cmd_status
            ;;
        log)
            cmd_log "${1:-}" "${2:-}"
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
