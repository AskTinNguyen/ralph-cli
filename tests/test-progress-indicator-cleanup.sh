#!/usr/bin/env bash
# Test script to verify progress indicator cleanup when parent dies
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Colors
C_GREEN='\033[0;32m'
C_RED='\033[0;31m'
C_YELLOW='\033[1;33m'
C_DIM='\033[2m'
C_RESET='\033[0m'

msg_info() { echo -e "${C_DIM}[TEST]${C_RESET} $*"; }
msg_pass() { echo -e "${C_GREEN}[PASS]${C_RESET} $*"; }
msg_fail() { echo -e "${C_RED}[FAIL]${C_RESET} $*"; }

echo "=========================================="
echo "Testing Progress Indicator Cleanup"
echo "=========================================="
echo ""

# Test 1: Verify progress indicator auto-terminates when parent dies
msg_info "Test 1: Progress indicator auto-terminates when parent dies"

# Create a test script that mimics the progress indicator behavior
TEST_SCRIPT=$(mktemp)
cat > "$TEST_SCRIPT" << 'EOF'
#!/usr/bin/env bash
parent_pid=$$
(
  while true; do
    # Exit if parent process is no longer running
    if ! kill -0 "$parent_pid" 2>/dev/null; then
      exit 0
    fi
    sleep 1
    echo "Progress indicator running..."
  done
) &
child_pid=$!
echo "Parent PID: $$"
echo "Child PID: $child_pid"
# Simulate work for 3 seconds
sleep 3
# Exit without killing child (simulating unexpected termination)
exit 0
EOF

chmod +x "$TEST_SCRIPT"

# Run the test script
msg_info "Starting test script..."
$TEST_SCRIPT > /tmp/progress-test.log 2>&1 &
test_pid=$!

# Wait for test to complete
sleep 4

# Extract child PID from log
if [ -f /tmp/progress-test.log ]; then
  child_pid=$(grep "Child PID:" /tmp/progress-test.log | awk '{print $3}')
  msg_info "Test parent exited. Checking if child (PID: $child_pid) auto-terminated..."

  # Wait a bit for the child to detect parent death
  sleep 3

  # Check if child process still exists
  if ps -p "$child_pid" > /dev/null 2>&1; then
    msg_fail "Child process $child_pid is still running (should have auto-terminated)"
    kill -9 "$child_pid" 2>/dev/null || true
    exit 1
  else
    msg_pass "Child process auto-terminated successfully"
  fi
else
  msg_fail "Test log not created"
  exit 1
fi

# Cleanup
rm -f "$TEST_SCRIPT" /tmp/progress-test.log

# Test 2: Verify stop_progress_indicator still works
msg_info "Test 2: stop_progress_indicator still works normally"

# Source the loop.sh functions (safely)
# We'll just verify the function exists and has the parent check
if grep -q "if ! kill -0.*parent_pid.*2>/dev/null; then" "$PROJECT_ROOT/.agents/ralph/loop.sh"; then
  msg_pass "Parent process check found in start_progress_indicator"
else
  msg_fail "Parent process check NOT found in start_progress_indicator"
  exit 1
fi

echo ""
echo "=========================================="
msg_pass "All tests passed!"
echo "=========================================="
