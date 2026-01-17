#!/usr/bin/env bash
# Test script for TTS overlap prevention
# Simulates the scenario where progress timer and final summary overlap

set -euo pipefail

RALPH_ROOT="${RALPH_ROOT:-$(pwd)}"

# Source TTS manager
source "${RALPH_ROOT}/.agents/ralph/lib/tts-manager.sh"

echo "=== TTS Overlap Prevention Test ==="
echo ""

# Test 1: Cancel existing TTS
echo "Test 1: Speaking first message, then canceling with second..."
speak_exclusive "This is the first message that should be interrupted"
sleep 1
speak_exclusive "This is the second message that interrupted the first"

echo "✓ Test 1 complete"
echo ""

# Test 2: Rapid fire (simulating progress timer + final summary)
echo "Test 2: Rapid succession (like progress timer then final summary)..."
speak_exclusive "Still working"
sleep 0.5
speak_exclusive "Almost done"
sleep 0.5
speak_exclusive "Here is your final summary"

echo "✓ Test 2 complete"
echo ""

# Test 3: Multiple overlaps in quick succession
echo "Test 3: Multiple rapid overlaps..."
for i in {1..5}; do
  speak_exclusive "Message number $i"
  sleep 0.3
done

echo "✓ Test 3 complete"
echo ""

# Test 4: Wait for TTS to complete
echo "Test 4: Normal flow (no overlap)..."
speak_exclusive "This message should complete without interruption"
sleep 3
speak_exclusive "This is the next message after the first finished"

echo "✓ Test 4 complete"
echo ""

# Clean up
rm -f "${RALPH_ROOT}/.ralph/tts.pid"

echo "=== All tests complete ==="
echo ""
echo "Expected behavior:"
echo "  - Earlier messages should be cut off when new messages arrive"
echo "  - No overlapping voice output should occur"
echo "  - Final message in each test should play completely"
echo ""
echo "Check TTS manager log:"
echo "  tail -f .ralph/tts-manager.log"
