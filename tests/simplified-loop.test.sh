#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Tests for Simplified Ralph Loop and Hooks
# ─────────────────────────────────────────────────────────────────────────────
# Usage: ./tests/simplified-loop.test.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOKS_DIR="$ROOT_DIR/.agents/ralph/hooks"
LIB_DIR="$ROOT_DIR/.agents/ralph/lib"
FIXTURES_DIR="$SCRIPT_DIR/fixtures/hooks"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Colors
C_GREEN=$'\033[32m'
C_RED=$'\033[31m'
C_YELLOW=$'\033[33m'
C_RESET=$'\033[0m'

# ─────────────────────────────────────────────────────────────────────────────
# Test utilities
# ─────────────────────────────────────────────────────────────────────────────
test_start() {
  TESTS_RUN=$((TESTS_RUN + 1))
  echo -n "  $1... "
}

test_pass() {
  TESTS_PASSED=$((TESTS_PASSED + 1))
  echo "${C_GREEN}PASS${C_RESET}"
}

test_fail() {
  TESTS_FAILED=$((TESTS_FAILED + 1))
  echo "${C_RED}FAIL${C_RESET}"
  echo "    ${C_YELLOW}$1${C_RESET}"
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-}"

  if [[ "$expected" == "$actual" ]]; then
    return 0
  else
    echo "Expected: $expected"
    echo "Actual:   $actual"
    return 1
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"

  if [[ "$haystack" == *"$needle"* ]]; then
    return 0
  else
    echo "String does not contain: $needle"
    return 1
  fi
}

# ─────────────────────────────────────────────────────────────────────────────
# Test: minimal.sh utilities
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Testing lib/minimal.sh..."

test_start "log functions exist"
source "$LIB_DIR/minimal.sh"
if declare -f log >/dev/null && declare -f log_success >/dev/null && declare -f log_error >/dev/null; then
  test_pass
else
  test_fail "Missing log functions"
fi

test_start "atomic_write creates file"
TEST_FILE="/tmp/ralph-test-atomic-$$"
atomic_write "$TEST_FILE" "test content"
if [[ -f "$TEST_FILE" ]] && [[ "$(cat "$TEST_FILE")" == "test content" ]]; then
  test_pass
  rm -f "$TEST_FILE"
else
  test_fail "File not created or content mismatch"
fi

test_start "get_story_block extracts story"
story_block=$(get_story_block "US-002" "$FIXTURES_DIR/plan-partial.md")
if [[ "$story_block" == *"Add user registration"* ]]; then
  test_pass
else
  test_fail "Story block not extracted correctly"
fi

test_start "mark_story_complete marks checkbox"
cp "$FIXTURES_DIR/plan-partial.md" "/tmp/plan-test-$$.md"
mark_story_complete "US-002" "/tmp/plan-test-$$.md"
if grep -q '\[x\].*US-002' "/tmp/plan-test-$$.md"; then
  test_pass
else
  test_fail "Story not marked complete"
fi
rm -f "/tmp/plan-test-$$.md"

# ─────────────────────────────────────────────────────────────────────────────
# Test: pre-tool.sh hook
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Testing hooks/pre-tool.sh..."

test_start "allows empty input"
result=$(echo "" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if [[ "$result" == '{"decision":"allow"}' ]]; then
  test_pass
else
  test_fail "Expected allow, got: $result"
fi

test_start "allows invalid JSON"
result=$(echo "not json" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if assert_contains "$result" '"decision":"allow"'; then
  test_pass
else
  test_fail "Expected allow for invalid JSON"
fi

test_start "allows Read tool"
result=$(echo '{"tool_name":"Read","tool_input":{"file_path":"/test.txt"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if [[ "$result" == '{"decision":"allow"}' ]]; then
  test_pass
else
  test_fail "Expected allow for Read"
fi

test_start "blocks git push"
result=$(echo '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if assert_contains "$result" '"decision":"block"'; then
  test_pass
else
  test_fail "Expected block for git push"
fi

test_start "blocks git merge to main"
result=$(echo '{"tool_name":"Bash","tool_input":{"command":"git merge feature-branch main"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if assert_contains "$result" '"decision":"block"'; then
  test_pass
else
  test_fail "Expected block for git merge"
fi

test_start "blocks ralph stream merge"
result=$(echo '{"tool_name":"Bash","tool_input":{"command":"ralph stream merge 1"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if assert_contains "$result" '"decision":"block"'; then
  test_pass
else
  test_fail "Expected block for ralph stream merge"
fi

test_start "allows safe git commands"
result=$(echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if [[ "$result" == '{"decision":"allow"}' ]]; then
  test_pass
else
  test_fail "Expected allow for git status"
fi

test_start "blocks git --force"
result=$(echo '{"tool_name":"Bash","tool_input":{"command":"git push --force origin main"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if assert_contains "$result" '"decision":"block"'; then
  test_pass
else
  test_fail "Expected block for git --force"
fi

test_start "blocks Edit without prior Read"
mkdir -p "/tmp/ralph-test-$$/.ralph"
echo "" > "/tmp/ralph-test-$$/.ralph/session.log"
result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/some/file.txt"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if assert_contains "$result" '"decision":"block"'; then
  test_pass
else
  test_fail "Expected block for Edit without Read"
fi
rm -rf "/tmp/ralph-test-$$"

test_start "allows Edit after Read"
mkdir -p "/tmp/ralph-test-$$/.ralph"
echo "Read: /some/file.txt" > "/tmp/ralph-test-$$/.ralph/session.log"
result=$(echo '{"tool_name":"Edit","tool_input":{"file_path":"/some/file.txt"}}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-tool.sh")
if [[ "$result" == '{"decision":"allow"}' ]]; then
  test_pass
else
  test_fail "Expected allow for Edit after Read"
fi
rm -rf "/tmp/ralph-test-$$"

# ─────────────────────────────────────────────────────────────────────────────
# Test: post-tool.sh hook (test failure detection)
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Testing hooks/post-tool.sh..."

test_start "exits 0 on empty input"
result=$(echo "" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]]; then
  test_pass
else
  test_fail "Expected exit 0"
fi

test_start "exits 0 on invalid JSON"
result=$(echo "not json" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]]; then
  test_pass
else
  test_fail "Expected exit 0"
fi

# Test Jest failure detection
test_start "detects Jest test failure"
jest_output=$(cat "$FIXTURES_DIR/test-output-jest.txt")
json_input=$(jq -n --arg output "$jest_output" '{"tool_name":"Bash","tool_output":$output}')
# Create temp ralph dir (note: hooks expect RALPH_ROOT/.ralph structure)
mkdir -p "/tmp/ralph-test-$$/.ralph/PRD-1"
echo "abc123" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log to be created"
fi

# Test pytest failure detection
test_start "detects pytest test failure"
pytest_output=$(cat "$FIXTURES_DIR/test-output-pytest.txt")
json_input=$(jq -n --arg output "$pytest_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "def456" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for pytest"
fi

# Test Go test failure detection
test_start "detects Go test failure"
go_output=$(cat "$FIXTURES_DIR/test-output-go.txt")
json_input=$(jq -n --arg output "$go_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "ghi789" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for Go test"
fi

# Test Mocha failure detection
test_start "detects Mocha test failure"
mocha_output=$(cat "$FIXTURES_DIR/test-output-mocha.txt")
json_input=$(jq -n --arg output "$mocha_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "mocha123" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for Mocha"
fi

# Test RSpec failure detection
test_start "detects RSpec test failure"
rspec_output=$(cat "$FIXTURES_DIR/test-output-rspec.txt")
json_input=$(jq -n --arg output "$rspec_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "rspec456" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for RSpec"
fi

# Test Bats (TAP) failure detection
test_start "detects Bats test failure"
bats_output=$(cat "$FIXTURES_DIR/test-output-bats.txt")
json_input=$(jq -n --arg output "$bats_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "bats789" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for Bats"
fi

# Test npm test failure detection
test_start "detects npm test failure"
npm_output=$(cat "$FIXTURES_DIR/test-output-npm-failure.txt")
json_input=$(jq -n --arg output "$npm_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "npm101" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for npm"
fi

# Test yarn test failure detection
test_start "detects yarn test failure"
yarn_output=$(cat "$FIXTURES_DIR/test-output-yarn-failure.txt")
json_input=$(jq -n --arg output "$yarn_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "yarn202" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for yarn"
fi

# Test Vitest failure detection
test_start "detects Vitest test failure"
vitest_output=$(cat "$FIXTURES_DIR/test-output-vitest.txt")
json_input=$(jq -n --arg output "$vitest_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "vitest303" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Expected failure log for Vitest"
fi

# Test that passing tests do NOT trigger failure detection
test_start "ignores passing Jest tests"
jest_pass_output=$(cat "$FIXTURES_DIR/test-output-jest-pass.txt")
json_input=$(jq -n --arg output "$jest_pass_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "pass001" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ ! -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Should not create failure log for passing tests"
fi

test_start "ignores passing Mocha tests"
mocha_pass_output=$(cat "$FIXTURES_DIR/test-output-mocha-pass.txt")
json_input=$(jq -n --arg output "$mocha_pass_output" '{"tool_name":"Bash","tool_output":$output}')
rm -f "/tmp/ralph-test-$$/.ralph/failure-context.log"
echo "pass002" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
result=$(echo "$json_input" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/post-tool.sh"; echo $?)
if [[ "$result" == "0" ]] && [[ ! -f "/tmp/ralph-test-$$/.ralph/failure-context.log" ]]; then
  test_pass
else
  test_fail "Should not create failure log for passing Mocha tests"
fi

# Cleanup
rm -rf "/tmp/ralph-test-$$/.ralph"

# ─────────────────────────────────────────────────────────────────────────────
# Test: on-stop.sh hook
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Testing hooks/on-stop.sh..."

test_start "exits 0 always"
result=$(echo "" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/on-stop.sh"; echo $?)
if [[ "$result" == "0" ]]; then
  test_pass
else
  test_fail "Expected exit 0"
fi

test_start "cleans up temp files"
mkdir -p "/tmp/ralph-test-$$/.ralph"
echo "US-001" > "/tmp/ralph-test-$$/.ralph/current-story"
echo "abc123" > "/tmp/ralph-test-$$/.ralph/.checkpoint"
echo "Read: /test.txt" > "/tmp/ralph-test-$$/.ralph/session.log"
echo '{}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/on-stop.sh"
if [[ ! -f "/tmp/ralph-test-$$/.ralph/current-story" ]] && [[ ! -f "/tmp/ralph-test-$$/.ralph/.checkpoint" ]]; then
  test_pass
else
  test_fail "Temp files not cleaned up"
fi
rm -rf "/tmp/ralph-test-$$"

# ─────────────────────────────────────────────────────────────────────────────
# Test: pre-prompt.sh hook
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "Testing hooks/pre-prompt.sh..."

test_start "exits 0 always"
result=$(echo "" | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-prompt.sh"; echo $?)
if [[ "$result" == "0" ]]; then
  test_pass
else
  test_fail "Expected exit 0"
fi

test_start "clears session log"
mkdir -p "/tmp/ralph-test-$$/.ralph"
echo "Read: /old.txt" > "/tmp/ralph-test-$$/.ralph/session.log"
echo '{"prompt":"test"}' | RALPH_ROOT="/tmp/ralph-test-$$" "$HOOKS_DIR/pre-prompt.sh"
if [[ ! -s "/tmp/ralph-test-$$/.ralph/session.log" ]]; then
  test_pass
else
  test_fail "Session log not cleared"
fi
rm -rf "/tmp/ralph-test-$$"

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
echo ""
echo "─────────────────────────────────────────"
echo "Tests: $TESTS_RUN | ${C_GREEN}Passed: $TESTS_PASSED${C_RESET} | ${C_RED}Failed: $TESTS_FAILED${C_RESET}"
echo "─────────────────────────────────────────"

if [[ $TESTS_FAILED -gt 0 ]]; then
  exit 1
fi
exit 0
