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

# Check if this is an issue-triggered event
is_issue_trigger() {
    [ "$GITHUB_EVENT_NAME" = "issues" ]
}

# Check if issue has the "ralph" label
has_ralph_label() {
    local event_path="${GITHUB_EVENT_PATH:-}"
    if [ -z "$event_path" ] || [ ! -f "$event_path" ]; then
        return 1
    fi

    # Check for ralph label in event payload
    if command -v jq &> /dev/null; then
        jq -e '.issue.labels[]? | select(.name == "ralph")' "$event_path" > /dev/null 2>&1
    else
        grep -q '"name"[[:space:]]*:[[:space:]]*"ralph"' "$event_path" 2>/dev/null
    fi
}

# Convert issue to PRD using the issue-to-prd.js script
convert_issue_to_prd() {
    local script_dir="${GITHUB_ACTION_PATH:-$(dirname "$0")}"
    local converter="$script_dir/issue-to-prd.js"

    if [ ! -f "$converter" ]; then
        log_error "issue-to-prd.js not found at $converter"
        return 1
    fi

    log_info "Converting issue to PRD format..."

    local result
    result=$(node "$converter" 2>&1)
    local exit_code=$?

    if [ $exit_code -ne 0 ]; then
        log_error "Failed to convert issue to PRD: $result"
        return 1
    fi

    # Parse result JSON to get PRD number
    local prd_num
    if command -v jq &> /dev/null; then
        prd_num=$(echo "$result" | jq -r '.prdNum')
    else
        prd_num=$(echo "$result" | grep -o '"prdNum":[0-9]*' | grep -o '[0-9]*')
    fi

    log_success "Created PRD-$prd_num from issue"
    echo "$prd_num"
}

# Post comment on issue with build results
comment_on_issue() {
    local success="$1"
    local stories_completed="$2"
    local duration="$3"
    local exit_code="$4"
    local prd_num="$5"

    local script_dir="${GITHUB_ACTION_PATH:-$(dirname "$0")}"
    local commenter="$script_dir/comment-results.js"

    if [ ! -f "$commenter" ]; then
        log_warning "comment-results.js not found, skipping issue comment"
        return 0
    fi

    # Check if GITHUB_TOKEN is available
    if [ -z "$GITHUB_TOKEN" ]; then
        log_warning "GITHUB_TOKEN not set, skipping issue comment"
        return 0
    fi

    log_info "Posting build results to issue..."

    # Set environment variables for the commenter script
    BUILD_SUCCESS="$success" \
    STORIES_COMPLETED="$stories_completed" \
    BUILD_DURATION="$duration" \
    BUILD_EXIT_CODE="$exit_code" \
    PRD_NUM="$prd_num" \
    node "$commenter" 2>&1 || {
        log_warning "Failed to post comment to issue"
        return 0  # Don't fail the build if commenting fails
    }

    log_success "Posted results to issue"
}

# Run plan and build from issue
run_issue_build() {
    local iterations="${1:-5}"
    local agent="${2:-claude}"
    local no_commit="${3:-false}"

    log_info "=== Issue-Driven Build ==="

    # Validate ralph label
    if ! has_ralph_label; then
        log_warning "Issue does not have 'ralph' label, skipping build"
        echo "success=true" >> "$GITHUB_OUTPUT"
        echo "stories_completed=0" >> "$GITHUB_OUTPUT"
        echo "exit_code=0" >> "$GITHUB_OUTPUT"
        return 0
    fi

    # Convert issue to PRD
    local prd_num
    prd_num=$(convert_issue_to_prd)
    if [ -z "$prd_num" ] || [ "$prd_num" = "null" ]; then
        log_error "Failed to create PRD from issue"
        echo "success=false" >> "$GITHUB_OUTPUT"
        echo "exit_code=1" >> "$GITHUB_OUTPUT"
        return 1
    fi

    # Run plan
    log_info "Running ralph plan for PRD-$prd_num..."
    ralph plan --prd="$prd_num" || {
        log_error "Planning failed"
        echo "success=false" >> "$GITHUB_OUTPUT"
        echo "exit_code=1" >> "$GITHUB_OUTPUT"
        return 1
    }

    # Run build
    log_info "Running ralph build for PRD-$prd_num..."
    local build_args="build $iterations --prd=$prd_num --agent=$agent"
    if [ "$no_commit" = "true" ]; then
        build_args="$build_args --no-commit"
    fi

    local start_time
    start_time=$(get_timestamp)
    local stories_before
    stories_before=$(count_completed_stories "$prd_num")

    ralph $build_args
    local exit_code=$?

    local end_time
    end_time=$(get_timestamp)
    local duration=$((end_time - start_time))
    local stories_after
    stories_after=$(count_completed_stories "$prd_num")
    local stories_completed=$((stories_after - stories_before))

    # Set outputs
    local success="false"
    if [ $exit_code -eq 0 ]; then
        success="true"
        log_success "Issue build completed successfully"
    else
        log_error "Issue build failed with exit code $exit_code"
    fi

    echo "success=$success" >> "$GITHUB_OUTPUT"
    echo "stories_completed=$stories_completed" >> "$GITHUB_OUTPUT"
    echo "duration=$duration" >> "$GITHUB_OUTPUT"
    echo "exit_code=$exit_code" >> "$GITHUB_OUTPUT"
    echo "prd_num=$prd_num" >> "$GITHUB_OUTPUT"

    # Post comment to issue with results
    comment_on_issue "$success" "$stories_completed" "$duration" "$exit_code" "$prd_num"

    return $exit_code
}

# Check if this is a PR-triggered event
is_pr_trigger() {
    [ "$GITHUB_EVENT_NAME" = "pull_request" ] || [ "$GITHUB_EVENT_NAME" = "pull_request_target" ]
}

# Get PR info from GitHub event
get_pr_info() {
    local event_path="${GITHUB_EVENT_PATH:-}"
    if [ -z "$event_path" ] || [ ! -f "$event_path" ]; then
        log_error "GITHUB_EVENT_PATH not found or invalid"
        return 1
    fi

    if command -v jq &> /dev/null; then
        local pr_number pr_head_sha
        pr_number=$(jq -r '.pull_request.number // .number // empty' "$event_path")
        pr_head_sha=$(jq -r '.pull_request.head.sha // empty' "$event_path")
        echo "${pr_number}:${pr_head_sha}"
    else
        log_error "jq is required for PR validation"
        return 1
    fi
}

# Run tests on PR branch
run_tests() {
    local test_command="${1:-npm test}"

    log_info "Running tests: $test_command"
    echo "::group::Test Output"

    local test_output
    local exit_code=0
    test_output=$(eval "$test_command" 2>&1) || exit_code=$?

    echo "$test_output"
    echo "::endgroup::"

    # Store output for later use (truncate if too long)
    local truncated_output="${test_output:0:10000}"
    if [ ${#test_output} -gt 10000 ]; then
        truncated_output="${truncated_output}... (truncated)"
    fi

    # Set output for test results
    {
        echo "test_output<<EOF"
        echo "$truncated_output"
        echo "EOF"
    } >> "$GITHUB_OUTPUT"

    return $exit_code
}

# Create or update status check
report_status_check() {
    local success="$1"
    local summary="$2"
    local test_output="$3"

    local script_dir="${GITHUB_ACTION_PATH:-$(dirname "$0")}"
    local status_script="$script_dir/status-check.js"

    if [ ! -f "$status_script" ]; then
        log_warning "status-check.js not found, skipping status check"
        return 0
    fi

    # Check if GITHUB_TOKEN is available
    if [ -z "$GITHUB_TOKEN" ]; then
        log_warning "GITHUB_TOKEN not set, skipping status check"
        return 0
    fi

    log_info "Reporting status check..."

    # Set environment variables for the status check script
    CHECK_SUCCESS="$success" \
    CHECK_SUMMARY="$summary" \
    CHECK_OUTPUT="$test_output" \
    node "$status_script" 2>&1 || {
        log_warning "Failed to report status check"
        return 0  # Don't fail the build if status check fails
    }

    log_success "Status check reported"
}

# Add review comments for test failures
add_review_comments() {
    local test_output="$1"

    local script_dir="${GITHUB_ACTION_PATH:-$(dirname "$0")}"
    local status_script="$script_dir/status-check.js"

    if [ ! -f "$status_script" ]; then
        log_warning "status-check.js not found, skipping review comments"
        return 0
    fi

    # Check if GITHUB_TOKEN is available
    if [ -z "$GITHUB_TOKEN" ]; then
        log_warning "GITHUB_TOKEN not set, skipping review comments"
        return 0
    fi

    log_info "Adding review comments for issues..."

    # The status-check.js script handles adding review comments
    REVIEW_COMMENTS="true" \
    CHECK_OUTPUT="$test_output" \
    node "$status_script" add-comments 2>&1 || {
        log_warning "Failed to add review comments"
        return 0  # Don't fail the build if commenting fails
    }
}

# Run PR validation
run_pr_validation() {
    local test_command="${1:-npm test}"
    local block_on_failure="${2:-false}"

    log_info "=== PR Validation ==="

    # Get PR info
    local pr_info
    pr_info=$(get_pr_info)
    if [ -z "$pr_info" ]; then
        log_error "Failed to get PR info"
        echo "success=false" >> "$GITHUB_OUTPUT"
        echo "exit_code=1" >> "$GITHUB_OUTPUT"
        return 1
    fi

    local pr_number="${pr_info%%:*}"
    local pr_head_sha="${pr_info##*:}"

    log_info "PR Number: $pr_number"
    log_info "Head SHA: $pr_head_sha"
    log_info "Test Command: $test_command"
    log_info "Block on Failure: $block_on_failure"

    # Record start time
    local start_time
    start_time=$(get_timestamp)

    # Create initial "in progress" status check
    report_status_check "pending" "Running tests..." ""

    # Run tests
    local test_output=""
    local test_exit_code=0
    test_output=$(run_tests "$test_command" 2>&1) || test_exit_code=$?

    # Record end time and calculate duration
    local end_time
    end_time=$(get_timestamp)
    local duration=$((end_time - start_time))

    # Determine success
    local success="false"
    local summary=""
    if [ $test_exit_code -eq 0 ]; then
        success="true"
        summary="All tests passed"
        log_success "PR validation passed"
    else
        summary="Tests failed with exit code $test_exit_code"
        log_error "PR validation failed: $summary"

        # Add review comments for test failures
        add_review_comments "$test_output"
    fi

    # Report final status check
    report_status_check "$success" "$summary" "$test_output"

    # Set GitHub Action outputs
    echo "success=$success" >> "$GITHUB_OUTPUT"
    echo "duration=$duration" >> "$GITHUB_OUTPUT"
    echo "exit_code=$test_exit_code" >> "$GITHUB_OUTPUT"

    # Log summary
    log_info "=== PR Validation Summary ==="
    log_info "Success: $success"
    log_info "Duration: ${duration}s"
    log_info "Exit code: $test_exit_code"

    # Create job summary if available
    if [ -n "$GITHUB_STEP_SUMMARY" ]; then
        {
            echo "## PR Validation Summary"
            echo ""
            echo "| Metric | Value |"
            echo "|--------|-------|"
            echo "| PR Number | #$pr_number |"
            echo "| Success | $success |"
            echo "| Duration | ${duration}s |"
            echo "| Exit Code | $test_exit_code |"
            echo "| Test Command | \`$test_command\` |"
            echo ""
            if [ "$success" = "false" ]; then
                echo "<details>"
                echo "<summary>Test Output</summary>"
                echo ""
                echo '```'
                echo "${test_output:0:5000}"
                echo '```'
                echo ""
                echo "</details>"
            fi
        } >> "$GITHUB_STEP_SUMMARY"
    fi

    # Exit with appropriate code if blocking is enabled
    if [ "$block_on_failure" = "true" ] && [ "$success" = "false" ]; then
        log_error "Blocking merge due to validation failure"
        return 1
    fi

    return $test_exit_code
}

# Export functions for use in action.yml
export -f log_info log_success log_warning log_error
export -f validate_api_key get_timestamp count_completed_stories get_latest_prd
export -f is_issue_trigger has_ralph_label convert_issue_to_prd run_issue_build
export -f is_pr_trigger get_pr_info run_tests report_status_check add_review_comments run_pr_validation
export -f run_ralph
