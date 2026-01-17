# Auto-Speak Guide for Claude Code CLI

Automatic text-to-speech for all Claude Code responses using Claude Code hooks + local Qwen LLM.

## How It Works

When enabled, every time Claude Code finishes responding (Stop hook):
1. **Stop hook fires** → `.agents/ralph/auto-speak-hook.sh` is triggered
2. **Extract messages** → Node.js script reads both user question AND assistant response from transcript
3. **Filter content** → OutputFilter removes code blocks, tool calls, verbose logs
4. **Context-aware summarization** → Qwen 2.5:1.5b considers your original question when summarizing
5. **TTS playback** → Summary is piped to `ralph speak` for audio output

**Context-aware means:**
- If you ask "How many tests passed?" → You hear "All 47 tests passed"
- If you ask "Why is the build failing?" → You hear the specific errors and fixes
- The summary focuses on answering YOUR question, not just regurgitating the response

This prevents Claude from reading out every code block, file path, and technical detail - you only hear the essential information relevant to what you asked.

## Setup

The auto-speak hook is now configured in `.claude/settings.local.json`. The hook script (`.agents/ralph/auto-speak-hook.sh`) will:

1. Receive the Stop hook event from Claude Code
2. Extract the last assistant message from the transcript
3. Clean the text (remove code blocks, tool calls, markdown)
4. Pipe the cleaned text to `ralph speak` (non-blocking)

## Enable/Disable Auto-Speak

```bash
# Enable auto-speak mode
ralph speak --auto-on

# Disable auto-speak mode
ralph speak --auto-off

# Check status
ralph speak --auto-status
```

## Configuration

Auto-speak settings are stored in `.ralph/voice-config.json`:

```json
{
  "autoSpeak": true
}
```

The hook script checks this config file before speaking. If `autoSpeak` is `false`, the hook exits silently.

## Usage Flow

1. **Enable auto-speak**: `ralph speak --auto-on`
2. **Use Claude Code normally**: Every response will be spoken automatically
3. **Disable when done**: `ralph speak --auto-off`

## Logs

Hook execution is logged to `.ralph/auto-speak-hook.log` for debugging:

```bash
# View recent hook activity
tail -f .ralph/auto-speak-hook.log
```

## Manual Speaking (Alternative)

If you prefer manual control, use the clipboard-based workflow:

```bash
# Source the wrapper functions
source .agents/ralph/auto-speak-wrapper.sh

# Copy my response, then run:
sl  # alias for speak-last

# Or speak any clipboard content:
sc  # alias for speak-clipboard
```

## Troubleshooting

### No audio output

1. Check auto-speak is enabled: `ralph speak --auto-status`
2. Check logs: `tail .ralph/auto-speak-hook.log`
3. Test TTS manually: `echo "test" | ralph speak`
4. Verify Ollama is running: `curl http://localhost:11434/api/tags`

### Hook not firing

1. Verify hook configuration in `.claude/settings.local.json`
2. Ensure hook script is executable: `chmod +x .agents/ralph/auto-speak-hook.sh`
3. Check Claude Code hook execution (hooks are enabled by default)
4. Check permissions for the hook script in `.claude/settings.local.json`

### Qwen summarization failing

1. Check Ollama is running: `ollama list`
2. Verify Qwen model is installed: `ollama pull qwen2.5:1.5b`
3. Test Ollama directly:
   ```bash
   curl http://localhost:11434/api/generate -d '{
     "model": "qwen2.5:1.5b",
     "prompt": "Summarize: Hello world",
     "stream": false
   }'
   ```
4. Check logs for errors: `tail .ralph/auto-speak-hook.log`

If Qwen fails, the system falls back to regex-based cleanup (no LLM summarization).

### Text not clean (code blocks spoken)

The system uses two-stage filtering:
1. **OutputFilter**: Removes code blocks, tool calls, markdown, URLs
2. **TTSSummarizer** (Qwen): Generates natural 1-2 sentence summary

If you hear code being spoken:
- Check `.ralph/auto-speak-hook.log` for summary preview
- Verify Qwen model is working: Test with the curl command above
- Adjust `maxTokens` in `.agents/ralph/summarize-for-tts.mjs` for longer summaries

## Requirements

- **Claude Code CLI**: Must be installed and authenticated
- **TTS provider**: macOS `say` command or voice-agent TTS (piper, etc.)
- **Ollama**: Local LLM server running Qwen 2.5:1.5b
  ```bash
  # Install Ollama
  curl -fsSL https://ollama.com/install.sh | sh

  # Pull Qwen model
  ollama pull qwen2.5:1.5b

  # Verify Ollama is running
  ollama list
  ```
- **jq** (recommended): For robust JSON parsing of transcripts
  ```bash
  # macOS
  brew install jq

  # Linux
  sudo apt install jq
  ```

## Advanced Configuration

### Custom TTS voice/rate

Edit `lib/commands/speak.js` to change default voice or rate:

```javascript
// In speakText function
const args = [];
if (voice) args.push("-v", voice);
if (rate) args.push("-r", rate);
```

Or set via command line when testing:
```bash
ralph speak "test" --voice Samantha --rate 180
```

### Configure Qwen model

Edit `.agents/ralph/summarize-for-tts.mjs` to change Qwen settings:

```javascript
const summarizer = createTTSSummarizer({
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5:1.5b",      // Try qwen2.5:3b for better quality
  maxTokens: 200,              // Increase for longer summaries
  timeout: 10000,              // Increase if Qwen is slow
  fallbackToRegex: true,       // Set false to require LLM
});
```

Or use environment variables:
```bash
export OLLAMA_URL="http://localhost:11434"
export OLLAMA_MODEL="qwen2.5:3b"
```

### Filter specific response types

Edit `.agents/ralph/auto-speak-hook.sh` to add custom filtering:

```bash
# Example: Skip responses containing specific keywords
if echo "$summary" | grep -qi "error\|failed"; then
  log "Skipping error message TTS"
  exit 0
fi
```

### Hook matchers

To trigger auto-speak only for specific types of responses, add matchers to `.claude/settings.local.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "matchers": [
          {
            "contains": "success"
          }
        ],
        "hooks": [
          {
            "type": "command",
            "command": ".agents/ralph/auto-speak-hook.sh"
          }
        ]
      }
    ]
  }
}
```

## Next Steps

- Test with a simple Claude Code prompt
- Adjust TTS voice/rate to your preference
- Customize text filtering in the hook script
- Consider adding conditional matchers for selective speaking

## Sources

- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Stop Hook Documentation](https://docs.claude.com/en/docs/claude-code/hooks)
- [Claude Code Hook Examples](https://github.com/disler/claude-code-hooks-mastery)
