#!/bin/bash
# Manual Test Script for Voice Intent Classifier

OLLAMA_URL="http://localhost:11434"
MODEL="qwen2.5:1.5b"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[0;33m'
NC='\033[0m'

echo -e "${BLUE}🎤 Voice Command Testing${NC}\n"
echo "Testing various voice commands with the hybrid classifier..."
echo ""

# Function to test a command
test_command() {
  local cmd="$1"
  echo -e "${YELLOW}Command:${NC} \"$cmd\""

  # Call the test script
  node tests/test-hybrid-simple.mjs --test "$cmd" 2>/dev/null || {
    # Manual test using curl
    result=$(curl -s "$OLLAMA_URL/api/generate" \
      -H "Content-Type: application/json" \
      -d "{
        \"model\": \"$MODEL\",
        \"prompt\": \"Extract entities from this voice command: \\\"$cmd\\\"\nRespond ONLY with JSON.\",
        \"format\": \"json\",
        \"stream\": false,
        \"options\": {\"temperature\": 0.1, \"num_predict\": 100}
      }" | jq -r '.response')

    echo -e "${GREEN}Result:${NC} $result"
  }
  echo ""
}

# Test commands
echo "Testing App Control Commands:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_command "open chrome"
test_command "close slack"
test_command "play music"
test_command "switch to vscode"

echo ""
echo "Testing Terminal Commands:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_command "run npm test"
test_command "git status"
test_command "list all files"

echo ""
echo "Testing Ralph Commands:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_command "create a PRD for user authentication"
test_command "ralph build 5 for PRD 3"
test_command "generate plan for PRD 2"

echo ""
echo "Testing Web Search:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
test_command "search for typescript best practices"
test_command "look up weather in San Francisco"

echo ""
echo -e "${GREEN}✅ Manual testing complete!${NC}"
