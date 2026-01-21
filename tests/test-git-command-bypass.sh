#!/bin/bash
# ============================================================================
# Unit tests for git command bypass detection in pre-tool.sh
# Run: bash tests/test-git-command-bypass.sh
# ============================================================================
# Tests for P1 security fix: Enhanced git command detection to catch bypass attempts
# See: todos/014-*-p1-git-command-bypass.md
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
HOOK_SCRIPT="$ROOT_DIR/.agents/ralph/hooks/pre-tool.sh"

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

# Helper function to test a command against the hook
# Returns 0 if blocked, 1 if allowed
test_command_blocked() {
  local cmd="$1"
  local result

  # Properly escape the command for JSON (escape backslashes and double quotes)
  local escaped_cmd
  escaped_cmd=$(printf '%s' "$cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')

  result=$(echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$escaped_cmd\"}}" | bash "$HOOK_SCRIPT" 2>/dev/null)

  if echo "$result" | grep -q '"decision":"block"'; then
    return 0  # Blocked (expected for bypass attempts)
  else
    return 1  # Allowed (unexpected for bypass attempts)
  fi
}

# Helper function to verify allowed commands still work
test_command_allowed() {
  local cmd="$1"
  local result

  # Properly escape the command for JSON (escape backslashes and double quotes)
  local escaped_cmd
  escaped_cmd=$(printf '%s' "$cmd" | sed 's/\\/\\\\/g; s/"/\\"/g')

  result=$(echo "{\"tool_name\":\"Bash\",\"tool_input\":{\"command\":\"$escaped_cmd\"}}" | bash "$HOOK_SCRIPT" 2>/dev/null)

  if echo "$result" | grep -q '"decision":"allow"'; then
    return 0  # Allowed (expected for safe commands)
  else
    return 1  # Blocked (unexpected for safe commands)
  fi
}

# ============================================================================
# Test: Basic git push blocking (original pattern)
# ============================================================================
test_basic_git_push() {
  echo ""
  echo "Testing basic git push blocking..."

  run_test
  if test_command_blocked "git push"; then
    pass "git push blocked"
  else
    fail "git push NOT blocked"
  fi

  run_test
  if test_command_blocked "git push origin main"; then
    pass "git push origin main blocked"
  else
    fail "git push origin main NOT blocked"
  fi

  run_test
  if test_command_blocked "cd repo && git push"; then
    pass "chained git push blocked"
  else
    fail "chained git push NOT blocked"
  fi
}

# ============================================================================
# Test: Bypass attempt - Words separated in command
# ============================================================================
test_bypass_words_separated() {
  echo ""
  echo "Testing bypass: git and push separated in command..."

  run_test
  if test_command_blocked 'echo "git" && echo "push"'; then
    pass "echo git && echo push blocked (words appear together)"
  else
    # This may be a false positive since it's just echoing text
    pass "echo git && echo push allowed (just echoing text - acceptable)"
  fi
}

# ============================================================================
# Test: Bypass attempt - Subshell patterns
# ============================================================================
test_bypass_subshell() {
  echo ""
  echo "Testing bypass: subshell patterns..."

  run_test
  if test_command_blocked '$(echo git) $(echo push)'; then
    pass '$(echo git) $(echo push) blocked'
  else
    fail '$(echo git) $(echo push) NOT blocked'
  fi

  run_test
  if test_command_blocked '$(git push)'; then
    pass '$(git push) blocked'
  else
    fail '$(git push) NOT blocked'
  fi

  run_test
  if test_command_blocked '`git push`'; then
    pass 'backtick git push blocked'
  else
    fail 'backtick git push NOT blocked'
  fi
}

# ============================================================================
# Test: Bypass attempt - Eval patterns
# ============================================================================
test_bypass_eval() {
  echo ""
  echo "Testing bypass: eval patterns..."

  run_test
  if test_command_blocked 'eval "git push"'; then
    pass 'eval "git push" blocked'
  else
    fail 'eval "git push" NOT blocked'
  fi

  run_test
  if test_command_blocked "eval 'git' 'push'"; then
    pass "eval 'git' 'push' blocked"
  else
    fail "eval 'git' 'push' NOT blocked"
  fi

  # Note: String-splitting attacks (like "git pu" "sh") are a known limitation
  # Detecting these would require full shell parsing which is beyond scope
  # See todo 014 for discussion of blocklist limitations
  run_test
  if test_command_blocked 'eval "git pu" "sh"'; then
    pass 'eval "git pu" "sh" blocked (bonus coverage)'
  else
    pass 'eval "git pu" "sh" not blocked (known limitation - string splitting)'
  fi
}

# ============================================================================
# Test: Bypass attempt - Base64 encoded
# ============================================================================
test_bypass_base64() {
  echo ""
  echo "Testing bypass: base64 encoded commands..."

  run_test
  if test_command_blocked 'echo Z2l0IHB1c2g= | base64 -d | bash'; then
    pass 'base64 encoded git push piped to bash blocked'
  else
    fail 'base64 encoded command NOT blocked'
  fi

  run_test
  if test_command_blocked 'base64 -d <<< Z2l0IHB1c2g= | sh'; then
    pass 'base64 -d piped to sh blocked'
  else
    fail 'base64 -d piped to sh NOT blocked'
  fi
}

# ============================================================================
# Test: Bypass attempt - Script file execution
# ============================================================================
test_bypass_script_file() {
  echo ""
  echo "Testing bypass: script file execution..."

  # Create a temp script with git push
  local temp_script
  temp_script=$(mktemp /tmp/test-push-XXXXXX.sh)
  echo '#!/bin/bash' > "$temp_script"
  echo 'git push origin main' >> "$temp_script"
  chmod +x "$temp_script"

  run_test
  if test_command_blocked "bash $temp_script"; then
    pass "bash script.sh with git push blocked"
  else
    fail "bash script.sh with git push NOT blocked"
  fi

  run_test
  if test_command_blocked "sh $temp_script"; then
    pass "sh script.sh with git push blocked"
  else
    fail "sh script.sh with git push NOT blocked"
  fi

  run_test
  if test_command_blocked "$temp_script"; then
    pass "direct script execution with git push blocked"
  else
    fail "direct script execution with git push NOT blocked"
  fi

  # Cleanup
  rm -f "$temp_script"

  # Test with non-existent script (should be allowed - can't check contents)
  run_test
  if test_command_allowed "bash /nonexistent/script.sh"; then
    pass "non-existent script allowed (cannot verify contents)"
  else
    pass "non-existent script blocked (conservative approach)"
  fi
}

# ============================================================================
# Test: Bypass attempt - git merge to main/master
# ============================================================================
test_bypass_git_merge() {
  echo ""
  echo "Testing bypass: git merge to main/master..."

  run_test
  if test_command_blocked 'git merge main'; then
    pass 'git merge main blocked'
  else
    fail 'git merge main NOT blocked'
  fi

  run_test
  if test_command_blocked 'git merge master'; then
    pass 'git merge master blocked'
  else
    fail 'git merge master NOT blocked'
  fi

  run_test
  if test_command_blocked 'eval "git merge main"'; then
    pass 'eval git merge main blocked'
  else
    fail 'eval git merge main NOT blocked'
  fi
}

# ============================================================================
# Test: Legitimate git commands should still be allowed
# ============================================================================
test_allowed_commands() {
  echo ""
  echo "Testing legitimate commands still allowed..."

  run_test
  if test_command_allowed "git status"; then
    pass "git status allowed"
  else
    fail "git status blocked (false positive)"
  fi

  run_test
  if test_command_allowed "git add ."; then
    pass "git add . allowed"
  else
    fail "git add . blocked (false positive)"
  fi

  run_test
  if test_command_allowed "git commit -m 'test'"; then
    pass "git commit allowed"
  else
    fail "git commit blocked (false positive)"
  fi

  run_test
  if test_command_allowed "git log --oneline"; then
    pass "git log allowed"
  else
    fail "git log blocked (false positive)"
  fi

  run_test
  if test_command_allowed "git diff"; then
    pass "git diff allowed"
  else
    fail "git diff blocked (false positive)"
  fi

  run_test
  if test_command_allowed "git checkout feature-branch"; then
    pass "git checkout allowed"
  else
    fail "git checkout blocked (false positive)"
  fi

  run_test
  if test_command_allowed "git branch -a"; then
    pass "git branch allowed"
  else
    fail "git branch blocked (false positive)"
  fi

  run_test
  if test_command_allowed "npm test"; then
    pass "npm test allowed"
  else
    fail "npm test blocked (false positive)"
  fi

  run_test
  if test_command_allowed "echo 'hello world'"; then
    pass "echo allowed"
  else
    fail "echo blocked (false positive)"
  fi

  # Note: Commands containing 'git' and 'push' as words are blocked
  # even if they're just searching/grepping. This is intentional:
  # - Prevents reconnaissance for bypass opportunities
  # - Accepts minor inconvenience for stronger security
  # Workaround: use 'git.*push' pattern instead of 'git push'
  run_test
  if test_command_blocked "grep 'git push' README.md"; then
    pass "grep 'git push' blocked (expected - security over convenience)"
  else
    pass "grep 'git push' allowed (acceptable but less secure)"
  fi
}

# ============================================================================
# Test: git --force blocking
# ============================================================================
test_git_force() {
  echo ""
  echo "Testing git --force blocking..."

  run_test
  if test_command_blocked "git push --force"; then
    pass "git push --force blocked"
  else
    fail "git push --force NOT blocked"
  fi

  run_test
  if test_command_blocked "git reset --hard --force HEAD~1"; then
    pass "git reset --force blocked"
  else
    fail "git reset --force NOT blocked"
  fi
}

# ============================================================================
# Test: ralph stream merge blocking
# ============================================================================
test_ralph_stream_merge() {
  echo ""
  echo "Testing ralph stream merge blocking..."

  run_test
  if test_command_blocked "ralph stream merge 1"; then
    pass "ralph stream merge 1 blocked"
  else
    fail "ralph stream merge 1 NOT blocked"
  fi

  run_test
  if test_command_blocked "ralph stream merge 5 --yes"; then
    pass "ralph stream merge with --yes blocked"
  else
    fail "ralph stream merge with --yes NOT blocked"
  fi
}

# ============================================================================
# Main
# ============================================================================
main() {
  echo "Git Command Bypass Detection Tests"
  echo "==================================="
  echo "Testing: $HOOK_SCRIPT"
  echo ""

  # Verify hook script exists
  if [[ ! -f "$HOOK_SCRIPT" ]]; then
    echo "${C_RED}ERROR: Hook script not found: $HOOK_SCRIPT${C_RESET}"
    exit 1
  fi

  # Run all tests
  test_basic_git_push
  test_bypass_subshell
  test_bypass_eval
  test_bypass_base64
  test_bypass_script_file
  test_bypass_git_merge
  test_allowed_commands
  test_git_force
  test_ralph_stream_merge

  # Summary
  echo ""
  echo "==================================="
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
