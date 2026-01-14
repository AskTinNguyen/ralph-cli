#!/bin/bash
# Ralph CLI GitHub Action Entrypoint
# This script handles the execution of ralph commands in GitHub Actions

set -e

# Colors for output (GitHub Actions supports ANSI colors)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[ralph-action]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[ralph-action]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[ralph-action]${NC} $1"
}

log_error() {
    echo -e "${RED}[ralph-action]${NC} $1"
}

# Validate API key is present
validate_api_key() {
    if [ -z "$ANTHROPIC_API_KEY" ] && [ -z "$OPENAI_API_KEY" ]; then
        log_error "No API key provided. Set 'api-key' input with your agent API key."
        echo "success=false" >> "$GITHUB_OUTPUT"
        echo "exit_code=1" >> "$GITHUB_OUTPUT"
        exit 1
    fi
    log_success "API key validated"
}

# Get the current timestamp in seconds
get_timestamp() {
    date +%s
}

# Count completed stories from progress.md
count_completed_stories() {
    local prd_num="$1"
    local progress_file=".ralph/PRD-${prd_num}/progress.md"

    if [ -f "$progress_file" ]; then
        grep -c "^## \[" "$progress_file" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Get the latest PRD number
get_latest_prd() {
    local latest=0
    if [ -d ".ralph" ]; then
        for dir in .ralph/PRD-*; do
            if [ -d "$dir" ]; then
                num="${dir##*-}"
                if [ "$num" -gt "$latest" ] 2>/dev/null; then
                    latest="$num"
                fi
            fi
        done
    fi
    echo "$latest"
}

# Main function to run ralph
run_ralph() {
    local command="${1:-build}"
    local iterations="${2:-5}"
    local agent="${3:-claude}"
    local prd="${4:-}"
    local no_commit="${5:-false}"

    log_info "Starting Ralph CLI Action"
    log_info "Command: $command"
    log_info "Iterations: $iterations"
    log_info "Agent: $agent"
    log_info "PRD: ${prd:-latest}"
    log_info "No-commit: $no_commit"

    # Validate API key
    validate_api_key

    # Build the ralph command
    local ralph_cmd="ralph"
    local ralph_args=""

    case "$command" in
        build)
            ralph_args="build $iterations"
            if [ -n "$prd" ]; then
                ralph_args="$ralph_args --prd=$prd"
            fi
            if [ "$no_commit" = "true" ]; then
                ralph_args="$ralph_args --no-commit"
            fi
            ralph_args="$ralph_args --agent=$agent"
            ;;
        plan)
            ralph_args="plan"
            if [ -n "$prd" ]; then
                ralph_args="$ralph_args --prd=$prd"
            fi
            ;;
        prd)
            ralph_args="prd"
            ;;
        *)
            ralph_args="$command"
            ;;
    esac

    # Record start time
    local start_time
    start_time=$(get_timestamp)

    # Determine PRD number for metrics
    local prd_num="$prd"
    if [ -z "$prd_num" ]; then
        prd_num=$(get_latest_prd)
    fi

    # Count stories before run
    local stories_before
    stories_before=$(count_completed_stories "$prd_num")

    log_info "Executing: $ralph_cmd $ralph_args"
    echo "::group::Ralph Output"

    # Run ralph and capture exit code
    local exit_code=0
    $ralph_cmd $ralph_args || exit_code=$?

    echo "::endgroup::"

    # Record end time and calculate duration
    local end_time
    end_time=$(get_timestamp)
    local duration=$((end_time - start_time))

    # Count stories after run
    local stories_after
    stories_after=$(count_completed_stories "$prd_num")
    local stories_completed=$((stories_after - stories_before))

    # Determine success
    local success="false"
    if [ "$exit_code" -eq 0 ]; then
        success="true"
        log_success "Ralph completed successfully"
    else
        log_error "Ralph exited with code $exit_code"
    fi

    # Set GitHub Action outputs
    echo "success=$success" >> "$GITHUB_OUTPUT"
    echo "stories_completed=$stories_completed" >> "$GITHUB_OUTPUT"
    echo "duration=$duration" >> "$GITHUB_OUTPUT"
    echo "exit_code=$exit_code" >> "$GITHUB_OUTPUT"

    # Log summary
    log_info "=== Build Summary ==="
    log_info "Success: $success"
    log_info "Stories completed: $stories_completed"
    log_info "Duration: ${duration}s"
    log_info "Exit code: $exit_code"

    # Create job summary if available
    if [ -n "$GITHUB_STEP_SUMMARY" ]; then
        {
            echo "## Ralph Build Summary"
            echo ""
            echo "| Metric | Value |"
            echo "|--------|-------|"
            echo "| Command | \`$command\` |"
            echo "| Success | $success |"
            echo "| Stories Completed | $stories_completed |"
            echo "| Duration | ${duration}s |"
            echo "| Exit Code | $exit_code |"
            echo "| Agent | $agent |"
            echo "| PRD | ${prd:-latest} |"
        } >> "$GITHUB_STEP_SUMMARY"
    fi

    return $exit_code
}

# Export functions for use in action.yml
export -f log_info log_success log_warning log_error
export -f validate_api_key get_timestamp count_completed_stories get_latest_prd
export -f run_ralph
