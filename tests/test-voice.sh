#!/bin/bash
# Quick test script for ralph voice

cd "$(dirname "$0")"

case "${1:-}" in
  mic|"")
    # Default: test microphone recording
    ./bin/ralph voice
    ;;
  text)
    # Test text mode
    shift
    ./bin/ralph voice "${*:-what is 2 plus 2}"
    ;;
  quiet)
    # Test without TTS
    ./bin/ralph voice --no-tts
    ;;
  stop)
    # Stop STT server
    ./bin/ralph voice --stt-stop
    ;;
  *)
    echo "Usage: ./test-voice.sh [mic|text|quiet|stop]"
    echo ""
    echo "  mic    - Record from microphone (default)"
    echo "  text   - Send text: ./test-voice.sh text 'your question'"
    echo "  quiet  - Record without TTS output"
    echo "  stop   - Stop the STT server"
    ;;
esac
