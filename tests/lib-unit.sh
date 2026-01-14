#!/bin/bash
# Unit tests for ralph bash libraries
# Run: bash tests/lib-unit.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LIB_DIR="$ROOT_DIR/.agents/ralph/lib"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors for test output
C_GREEN=$'\033[32m'
C_RED=$'\033[31m'
C_YELLOW=$'\033[33m'
C_RESET=$'\033[0m'

pass() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  printf "  ${C_GREEN}✓${C_RESET} %s\n" "$1"
}

fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  printf "  ${C_RED}✗${C_RESET} %s\n" "$1"
  [[ -n "${2:-}" ]] && printf "    ${C_YELLOW}→ %s${C_RESET}\n" "$2"
}

run_test() {
  TESTS_RUN=$((TESTS_RUN + 1))
}

# ============================================================================
# Test: output.sh
# ============================================================================
test_output_sh() {
  echo ""
  echo "Testing output.sh..."

  # Source the library
  # shellcheck source=../.agents/ralph/lib/output.sh
  source "$LIB_DIR/output.sh"

  # Test: msg_* functions exist
  run_test
  if declare -f msg_success >/dev/null 2>&1; then
    pass "msg_success function exists"
  else
    fail "msg_success function missing"
  fi

  run_test
  if declare -f msg_error >/dev/null 2>&1; then
    pass "msg_error function exists"
  else
    fail "msg_error function missing"
  fi

  run_test
  if declare -f msg_warn >/dev/null 2>&1; then
    pass "msg_warn function exists"
  else
    fail "msg_warn function missing"
  fi

  run_test
  if declare -f msg_info >/dev/null 2>&1; then
    pass "msg_info function exists"
  else
    fail "msg_info function missing"
  fi

  run_test
  if declare -f msg_dim >/dev/null 2>&1; then
    pass "msg_dim function exists"
  else
    fail "msg_dim function missing"
  fi

  # Test: Status constants defined
  run_test
  if [[ "$STATUS_RUNNING" == "running" ]]; then
    pass "STATUS_RUNNING constant defined"
  else
    fail "STATUS_RUNNING constant missing or incorrect"
  fi

  run_test
  if [[ "$STATUS_COMPLETED" == "completed" ]]; then
    pass "STATUS_COMPLETED constant defined"
  else
    fail "STATUS_COMPLETED constant missing or incorrect"
  fi

  # Test: Symbol constants defined
  run_test
  if [[ -n "$SYM_SUCCESS" ]]; then
    pass "SYM_SUCCESS symbol defined"
  else
    fail "SYM_SUCCESS symbol missing"
  fi

  # Test: msg_success outputs correctly
  run_test
  local output
  output=$(msg_success "test message" 2>&1)
  if [[ "$output" == *"test message"* ]]; then
    pass "msg_success outputs message"
  else
    fail "msg_success output incorrect" "$output"
  fi
}

# ============================================================================
# Test: prd-utils.sh
# ============================================================================
test_prd_utils_sh() {
  echo ""
  echo "Testing prd-utils.sh..."

  # Set required vars
  RALPH_DIR=".ralph"

  # Source the library
  # shellcheck source=../.agents/ralph/lib/prd-utils.sh
  source "$LIB_DIR/prd-utils.sh"

  # Test: Functions exist
  run_test
  if declare -f get_next_prd_number >/dev/null 2>&1; then
    pass "get_next_prd_number function exists"
  else
    fail "get_next_prd_number function missing"
  fi

  run_test
  if declare -f get_latest_prd_number >/dev/null 2>&1; then
    pass "get_latest_prd_number function exists"
  else
    fail "get_latest_prd_number function missing"
  fi

  run_test
  if declare -f get_prd_dir >/dev/null 2>&1; then
    pass "get_prd_dir function exists"
  else
    fail "get_prd_dir function missing"
  fi

  # Test: get_prd_dir returns correct path
  run_test
  local prd_dir
  prd_dir=$(get_prd_dir 5)
  if [[ "$prd_dir" == *"PRD-5"* ]]; then
    pass "get_prd_dir returns correct path format"
  else
    fail "get_prd_dir returned unexpected format" "$prd_dir"
  fi
}

# ============================================================================
# Test: git-utils.sh
# ============================================================================
test_git_utils_sh() {
  echo ""
  echo "Testing git-utils.sh..."

  # Source the library
  # shellcheck source=../.agents/ralph/lib/git-utils.sh
  source "$LIB_DIR/git-utils.sh"

  # Test: Functions exist
  run_test
  if declare -f git_head >/dev/null 2>&1; then
    pass "git_head function exists"
  else
    fail "git_head function missing"
  fi

  run_test
  if declare -f git_commit_list >/dev/null 2>&1; then
    pass "git_commit_list function exists"
  else
    fail "git_commit_list function missing"
  fi

  run_test
  if declare -f git_changed_files >/dev/null 2>&1; then
    pass "git_changed_files function exists"
  else
    fail "git_changed_files function missing"
  fi

  run_test
  if declare -f git_dirty_files >/dev/null 2>&1; then
    pass "git_dirty_files function exists"
  else
    fail "git_dirty_files function missing"
  fi

  # Test: git_head returns a commit hash (if in git repo)
  run_test
  if git rev-parse --git-dir >/dev/null 2>&1; then
    local head
    head=$(git_head)
    if [[ ${#head} -ge 7 ]]; then
      pass "git_head returns commit hash"
    else
      fail "git_head returned invalid hash" "$head"
    fi
  else
    pass "git_head skipped (not in git repo)"
  fi
}

# ============================================================================
# Test: retry.sh
# ============================================================================
test_retry_sh() {
  echo ""
  echo "Testing retry.sh..."

  # Source dependencies
  source "$LIB_DIR/output.sh"

  # Set required vars
  ROOT_DIR="$ROOT_DIR"

  # Source the library
  # shellcheck source=../.agents/ralph/lib/retry.sh
  source "$LIB_DIR/retry.sh"

  # Test: Functions exist
  run_test
  if declare -f calculate_backoff_delay >/dev/null 2>&1; then
    pass "calculate_backoff_delay function exists"
  else
    fail "calculate_backoff_delay function missing"
  fi

  # Test: Default constants
  run_test
  if [[ -n "${RETRY_MAX_ATTEMPTS:-}" ]]; then
    pass "RETRY_MAX_ATTEMPTS constant defined ($RETRY_MAX_ATTEMPTS)"
  else
    fail "RETRY_MAX_ATTEMPTS constant missing"
  fi

  run_test
  if [[ -n "${RETRY_BASE_DELAY_MS:-}" ]]; then
    pass "RETRY_BASE_DELAY_MS constant defined ($RETRY_BASE_DELAY_MS)"
  else
    fail "RETRY_BASE_DELAY_MS constant missing"
  fi

  # Test: calculate_backoff_delay returns a number (may be decimal)
  run_test
  local delay
  delay=$(calculate_backoff_delay 1 2>/dev/null || echo "0")
  if [[ "$delay" =~ ^[0-9]+\.?[0-9]*$ ]]; then
    pass "calculate_backoff_delay returns number ($delay)"
  else
    fail "calculate_backoff_delay returned non-number" "$delay"
  fi
}

# ============================================================================
# Test: checkpoint.sh
# ============================================================================
test_checkpoint_sh() {
  echo ""
  echo "Testing checkpoint.sh..."

  # Source dependencies
  source "$LIB_DIR/output.sh"

  # Set required vars
  ROOT_DIR="$ROOT_DIR"
  CHECKPOINT_FILE="$ROOT_DIR/.ralph/test-checkpoint.json"

  # Source the library
  # shellcheck source=../.agents/ralph/lib/checkpoint.sh
  source "$LIB_DIR/checkpoint.sh"

  # Test: Functions exist
  run_test
  if declare -f save_checkpoint >/dev/null 2>&1; then
    pass "save_checkpoint function exists"
  else
    fail "save_checkpoint function missing"
  fi

  run_test
  if declare -f load_checkpoint >/dev/null 2>&1; then
    pass "load_checkpoint function exists"
  else
    fail "load_checkpoint function missing"
  fi

  run_test
  if declare -f clear_checkpoint >/dev/null 2>&1; then
    pass "clear_checkpoint function exists"
  else
    fail "clear_checkpoint function missing"
  fi

  run_test
  if declare -f validate_git_state >/dev/null 2>&1; then
    pass "validate_git_state function exists"
  else
    fail "validate_git_state function missing"
  fi

  # Cleanup
  rm -f "$CHECKPOINT_FILE"
}

# ============================================================================
# Test: routing.sh
# ============================================================================
test_routing_sh() {
  echo ""
  echo "Testing routing.sh..."

  # Source dependencies
  source "$LIB_DIR/output.sh"

  # Set required vars
  ROOT_DIR="$ROOT_DIR"

  # Source the library
  # shellcheck source=../.agents/ralph/lib/routing.sh
  source "$LIB_DIR/routing.sh"

  # Test: Functions exist
  run_test
  if declare -f get_routing_decision >/dev/null 2>&1; then
    pass "get_routing_decision function exists"
  else
    fail "get_routing_decision function missing"
  fi

  run_test
  if declare -f calculate_actual_cost >/dev/null 2>&1; then
    pass "calculate_actual_cost function exists"
  else
    fail "calculate_actual_cost function missing"
  fi

  run_test
  if declare -f estimate_execution_cost >/dev/null 2>&1; then
    pass "estimate_execution_cost function exists"
  else
    fail "estimate_execution_cost function missing"
  fi

  run_test
  if declare -f parse_json_field >/dev/null 2>&1; then
    pass "parse_json_field function exists (in routing.sh)"
  else
    fail "parse_json_field function missing"
  fi
}

# ============================================================================
# Test: metrics.sh
# ============================================================================
test_metrics_sh() {
  echo ""
  echo "Testing metrics.sh..."

  # Source dependencies
  source "$LIB_DIR/output.sh"

  # Set required vars
  ROOT_DIR="$ROOT_DIR"

  # Source the library
  # shellcheck source=../.agents/ralph/lib/metrics.sh
  source "$LIB_DIR/metrics.sh"

  # Test: Functions exist
  run_test
  if declare -f extract_tokens_from_log >/dev/null 2>&1; then
    pass "extract_tokens_from_log function exists"
  else
    fail "extract_tokens_from_log function missing"
  fi

  run_test
  if declare -f parse_token_field >/dev/null 2>&1; then
    pass "parse_token_field function exists"
  else
    fail "parse_token_field function missing"
  fi

  run_test
  if declare -f append_metrics >/dev/null 2>&1; then
    pass "append_metrics function exists"
  else
    fail "append_metrics function missing"
  fi

  run_test
  if declare -f rebuild_token_cache >/dev/null 2>&1; then
    pass "rebuild_token_cache function exists"
  else
    fail "rebuild_token_cache function missing"
  fi
}

# ============================================================================
# Test: agent.sh
# ============================================================================
test_agent_sh() {
  echo ""
  echo "Testing agent.sh..."

  # Source dependencies
  source "$LIB_DIR/output.sh"

  # Set required vars
  SCRIPT_DIR="$ROOT_DIR/.agents/ralph"
  ROOT_DIR="$ROOT_DIR"
  DEFAULT_AGENT_NAME="claude"
  AGENT_CMD="claude --print"

  # Source the library
  # shellcheck source=../.agents/ralph/lib/agent.sh
  source "$LIB_DIR/agent.sh"

  # Test: Functions exist
  run_test
  if declare -f require_agent >/dev/null 2>&1; then
    pass "require_agent function exists"
  else
    fail "require_agent function missing"
  fi

  run_test
  if declare -f run_agent >/dev/null 2>&1; then
    pass "run_agent function exists"
  else
    fail "run_agent function missing"
  fi

  run_test
  if declare -f run_agent_inline >/dev/null 2>&1; then
    pass "run_agent_inline function exists"
  else
    fail "run_agent_inline function missing"
  fi

  run_test
  if declare -f get_experiment_assignment >/dev/null 2>&1; then
    pass "get_experiment_assignment function exists"
  else
    fail "get_experiment_assignment function missing"
  fi

  run_test
  if declare -f resolve_agent_cmd >/dev/null 2>&1; then
    pass "resolve_agent_cmd function exists"
  else
    fail "resolve_agent_cmd function missing"
  fi
}

# ============================================================================
# Test: Python libraries syntax
# ============================================================================
test_python_syntax() {
  echo ""
  echo "Testing Python libraries syntax..."

  # Test: prd-parser.py compiles
  run_test
  if python3 -m py_compile "$LIB_DIR/prd-parser.py" 2>/dev/null; then
    pass "prd-parser.py syntax valid"
  else
    fail "prd-parser.py has syntax errors"
  fi

  # Test: run-meta-writer.py compiles
  run_test
  if python3 -m py_compile "$LIB_DIR/run-meta-writer.py" 2>/dev/null; then
    pass "run-meta-writer.py syntax valid"
  else
    fail "run-meta-writer.py has syntax errors"
  fi
}

# ============================================================================
# Test: loop.sh syntax and sourcing
# ============================================================================
test_loop_sh() {
  echo ""
  echo "Testing loop.sh..."

  # Test: loop.sh syntax
  run_test
  if bash -n "$ROOT_DIR/.agents/ralph/loop.sh" 2>/dev/null; then
    pass "loop.sh syntax valid"
  else
    fail "loop.sh has syntax errors"
  fi

  # Test: All lib/*.sh files have valid syntax
  run_test
  local errors=0
  for lib_file in "$LIB_DIR"/*.sh; do
    if ! bash -n "$lib_file" 2>/dev/null; then
      fail "$(basename "$lib_file") has syntax errors"
      errors=$((errors + 1))
    fi
  done
  if [[ $errors -eq 0 ]]; then
    pass "All lib/*.sh files have valid syntax"
  fi
}

# ============================================================================
# Main
# ============================================================================
main() {
  echo "Ralph Library Unit Tests"
  echo "========================"

  # Run all tests
  test_output_sh
  test_prd_utils_sh
  test_git_utils_sh
  test_retry_sh
  test_checkpoint_sh
  test_routing_sh
  test_metrics_sh
  test_agent_sh
  test_python_syntax
  test_loop_sh

  # Summary
  echo ""
  echo "========================"
  echo "Tests run: $TESTS_RUN"
  echo "${C_GREEN}Passed: $TESTS_PASSED${C_RESET}"
  if [[ $TESTS_FAILED -gt 0 ]]; then
    echo "${C_RED}Failed: $TESTS_FAILED${C_RESET}"
    exit 1
  else
    echo "Failed: 0"
    echo ""
    echo "${C_GREEN}All tests passed!${C_RESET}"
  fi
}

main "$@"
