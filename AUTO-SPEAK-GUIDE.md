# Auto-Speak Guide for Claude Code CLI

> **⚠️ DEPRECATED:** This file has been consolidated into [`docs/VOICE.md`](docs/VOICE.md).
> Please use the new comprehensive voice guide for all voice features.
> This file will be removed in a future release.

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

## Auto-Speak Modes

Auto-speak supports multiple summarization modes to adapt to different response types:

| Mode | Chars | Tokens | Words | Use Case |
|------|-------|--------|-------|----------|
| `short` | 150 | 150 | ~30 | Simple answers, confirmations (default) |
| `medium` | 800 | 400 | ~100 | Explanations, multi-step changes |
| `full` | 1500 | 600 | ~200 | PRDs, plans, complex summaries |
| `adaptive` | varies | varies | varies | Auto-detect based on response complexity |

### Set Auto-Speak Mode

```bash
# Set mode to adaptive (recommended for varied responses)
ralph speak --auto-mode=adaptive

# Set mode to full (always use long summaries)
ralph speak --auto-mode=full

# Set mode to short (default, brief summaries)
ralph speak --auto-mode=short

# Show current mode
ralph speak --auto-mode
```

### Adaptive Mode Detection

When using `adaptive` mode, the system automatically selects the appropriate summary length based on:

- **User Stories**: If the response contains 3+ `US-XXX` patterns, uses `full` mode
- **Multi-week/phase plans**: If 2+ week or phase references found, uses `full` mode
- **Response length**:
  - Under 500 chars → `short` mode
  - 500-2000 chars → `medium` mode
  - Over 2000 chars → `full` mode
- **List density**: If 5+ bullet points, upgrades to `medium` or `full`

This prevents summaries from cutting off at "Week 1" when Claude returns a multi-week PRD.

## On-Demand Recap (Longer Summaries)

Auto-speak is intentionally short (~20-30 words). When you want more detail, use `ralph recap`:

```bash
# Medium summary (~100 words) - default
ralph recap

# Detailed summary (~200 words)
ralph recap --full

# Short summary (~30 words, same as auto-speak)
ralph recap --short

# Preview without speaking
ralph recap --preview
```

**When to use recap:**
- After complex responses with multiple steps
- When you missed details in the auto-speak summary
- When you want to hear key decisions, caveats, or next steps

**Recap style:**
Recaps use concise, bulleted format optimized for listening:
```
"Feature completed. One, added login endpoint. Two, added logout endpoint.
Three, tests passing. Next steps: add rate limiting, add email verification."
```

**Limits by mode:**

| Mode | Characters | Tokens | Target Words |
|------|------------|--------|--------------|
| `--short` | 150 | 150 | ~30 |
| (default) | 800 | 400 | ~100 |
| `--full` | 1500 | 600 | ~200 |

## Configuration

Auto-speak settings are stored in `.ralph/voice-config.json`:

```json
{
  "autoSpeak": {
    "enabled": true,
    "mode": "adaptive"
  },
  "acknowledgment": {
    "enabled": true,
    "immediate": false,
    "immediatePhrase": "Got it"
  },
  "progress": {
    "enabled": true,
    "intervalSeconds": 15,
    "initialDelaySeconds": 5
  },
  "skipSessionStart": {
    "enabled": true,
    "minUserMessages": 1,
    "headlessAlwaysSpeak": true
  }
}
```

**Configuration options:**

**autoSpeak:**
- `enabled`: Whether auto-speak is active (`true`/`false`)
- `mode`: Summarization mode (`"short"`, `"medium"`, `"full"`, `"adaptive"`)

**acknowledgment:**
- `enabled`: Whether initial acknowledgment voice is enabled (`true`/`false`)
- `immediate`: Whether to speak a quick acknowledgment immediately on prompt submit (`true`/`false`, default: `false`)
- `immediatePhrase`: The phrase to speak immediately (default: `"Got it"`)

**progress:**
- `enabled`: Whether periodic progress phrases are enabled (`true`/`false`)
- `intervalSeconds`: Interval between progress phrases (default: 15)
- `initialDelaySeconds`: Delay before first progress phrase (default: 5)

**skipSessionStart:**
- `enabled`: Whether to skip voice on first prompt of a new session (`true`/`false`)
- `minUserMessages`: Minimum user messages before voice is enabled (default: 1)
- `headlessAlwaysSpeak`: In headless/automation mode, always speak regardless of session state (default: `true`)

**Legacy format** (still supported):
```json
{
  "autoSpeak": true
}
```
When using the legacy format, `short` mode is used by default.

The hook script checks this config file before speaking. If `autoSpeak.enabled` is `false` (or `autoSpeak` is `false` in legacy format), the hook exits silently.

## Usage Flow

1. **Enable auto-speak**: `ralph speak --auto-on`
2. **Use Claude Code normally**: Every response will be spoken automatically
3. **Disable when done**: `ralph speak --auto-off`

## Headless Mode (Ralph Build)

When running Ralph in headless mode (`ralph build` with piped input), auto-speak behavior is optimized:

**What works in headless mode:**
- Initial acknowledgment (Claude's first response)
- Progress updates (periodic "Still working..." phrases)
- Final summarization (completion summary)

**Configuration for headless mode:**

By default, `headlessAlwaysSpeak: true` bypasses the session-start detection in headless mode. This ensures voice output works correctly even with single-message sessions.

```json
{
  "skipSessionStart": {
    "headlessAlwaysSpeak": true
  }
}
```

**Environment variable override:**
```bash
# Force headless mode behavior
export RALPH_HEADLESS=true
ralph build 5
```

**Timing considerations:**
- Initial delay before progress phrases: 5 seconds (configurable via `progress.initialDelaySeconds`)
- If Claude responds in under 5 seconds, you'll hear acknowledgment + summary but no progress phrases
- For longer tasks, progress phrases speak every 15 seconds (configurable via `progress.intervalSeconds`)

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

### Headless Mode / Ralph Build Issues

If auto-speak isn't working during `ralph build` or other headless operations:

1. **Verify headless mode is detected:**
   ```bash
   tail -20 .ralph/session-detect.log | grep -i headless
   ```
   Should show: `Headless mode detected, always speak enabled - allowing voice`

2. **Check if headlessAlwaysSpeak is enabled:**
   ```bash
   jq '.skipSessionStart.headlessAlwaysSpeak' .ralph/voice-config.json
   ```
   Should return `true`

3. **Force headless mode via environment:**
   ```bash
   export RALPH_HEADLESS=true
   ralph build 5
   ```

4. **Check progress timer logs:**
   ```bash
   tail -30 .ralph/progress-timer.log
   ```
   Look for "Timer started" and "Speaking:" entries

5. **Verify TTS manager is working:**
   ```bash
   tail -30 .ralph/tts-manager.log
   ```
   Look for "TTS started with PID" entries

6. **Test TTS directly in headless context:**
   ```bash
   echo "Test message" | ralph speak
   ```

**Common headless mode issues:**
- **No audio device access**: Some CI/CD environments don't have audio output
- **Progress timer killed too quickly**: Reduce `initialDelaySeconds` if Claude responds very fast
- **Session start skip blocking voice**: Ensure `headlessAlwaysSpeak: true` in config

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

### Recap not finding transcript

If `ralph recap` says "No transcript found":
1. Make sure you're in a directory where Claude Code has been used
2. Check Claude projects exist: `ls ~/.claude/projects/`
3. Transcripts are stored per-project with encoded paths

## VieNeu-TTS (Vietnamese Voice Cloning)

Ralph supports VieNeu-TTS for high-quality Vietnamese text-to-speech with voice cloning capability.

### Installation

```bash
# Run the setup script
.agents/ralph/setup/vieneu-setup.sh
```

This installs VieNeu-TTS to `~/.agents/ralph/vieneu/` (shared across all projects).

### Configuration

```bash
# Set VieNeu as the TTS engine
ralph speak --set-tts-engine vieneu

# Choose a preset voice
ralph speak --set-vieneu-voice Vinh

# Check current settings
ralph speak --get-tts-engine
ralph speak --list-vieneu-voices
```

### Available Preset Voices

| Voice | Description |
|-------|-------------|
| Binh | Male voice |
| Tuyen | Female voice |
| Vinh | Male voice |
| Doan | Male voice |
| Ly | Female voice |
| Ngoc | Female voice |

### Usage

```bash
# Speak Vietnamese text
ralph speak "Xin chào thế giới"

# One-time use without changing default engine
ralph speak --engine vieneu "Xin chào"

# Switch back to macOS TTS
ralph speak --set-tts-engine macos
```

### Voice Cloning (Advanced)

You can clone custom voices from audio samples:

```bash
# Activate venv and run clone script
source ~/.agents/ralph/vieneu/venv/bin/activate
python ~/.agents/ralph/vieneu/clone-voice.py your_audio.wav my_voice

# Then use your cloned voice
ralph speak --set-vieneu-voice my_voice
```

**Requirements for voice cloning:**
- 3-5 second audio sample (WAV format)
- 16kHz or 22kHz sample rate recommended
- Clean speech, minimal background noise

### VieNeu Configuration in voice-config.json

```json
{
  "ttsEngine": "vieneu",
  "vieneuVoice": "Vinh",
  "vieneuModel": "vieneu-0.3b",
  "autoSpeak": {
    "enabled": true,
    "mode": "adaptive"
  }
}
```

## Multilingual Auto-Detection

Ralph can automatically detect Vietnamese text and route it to VieNeu-TTS without manual engine switching. This eliminates the need to run `--set-tts-engine vieneu` before speaking Vietnamese content.

### How It Works

1. When you run `ralph speak "text"`, the system checks if multilingual auto-detection is enabled
2. If enabled, it uses [franc-min](https://github.com/wooorm/franc) to detect the language
3. If Vietnamese is detected (requires 20+ characters for reliable detection) and VieNeu is installed, it automatically routes to VieNeu-TTS
4. Otherwise, it uses your configured default TTS engine (macOS/Piper)

### Enable/Disable

```bash
# Check current status
ralph speak --multilingual-status

# Enable auto-detection (default)
ralph speak --multilingual-on

# Disable auto-detection
ralph speak --multilingual-off
```

### Usage Examples

```bash
# English text → uses default engine (macOS/Piper)
ralph speak "Hello world, this is a test"

# Vietnamese text → auto-detects and routes to VieNeu
ralph speak "Xin chào thế giới, đây là một bài kiểm tra"

# Force specific engine (bypasses auto-detection)
ralph speak --engine vieneu "Hello"
ralph speak --engine macos "Xin chào"
```

### Configuration

Multilingual settings in `.ralph/voice-config.json`:

```json
{
  "ttsEngine": "macos",
  "multilingual": {
    "enabled": true,
    "autoDetect": true
  },
  "vieneuVoice": "Vinh"
}
```

**Options:**
- `multilingual.enabled`: Master switch for multilingual features (`true`/`false`)
- `multilingual.autoDetect`: Whether to auto-detect language and route accordingly (`true`/`false`)

### Detection Requirements

- **Minimum text length**: 20 characters for reliable detection
- **Short text**: Defaults to English (prevents false positives)
- **VieNeu must be installed**: If VieNeu is not installed, Vietnamese text will use the default engine

### Supported Languages

| Language | ISO Code | TTS Engine |
|----------|----------|------------|
| English | en | macOS/Piper (default) |
| Vietnamese | vi | VieNeu-TTS |
| Chinese | zh | macOS/Piper |

Additional languages can be added by extending `.agents/ralph/language-voice-mapper.mjs`.

## Requirements

- **Claude Code CLI**: Must be installed and authenticated
- **TTS provider**: macOS `say` command, Piper TTS, or VieNeu-TTS
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
- **VieNeu-TTS** (optional): For Vietnamese voice cloning
  ```bash
  # Install VieNeu-TTS
  .agents/ralph/setup/vieneu-setup.sh

  # Configure
  ralph speak --set-tts-engine vieneu
  ralph speak --set-vieneu-voice Vinh
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
