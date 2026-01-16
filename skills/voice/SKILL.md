---
name: voice
description: Interactive voice control for Claude Code CLI. Speak commands that Claude Code executes, with TTS responses for hands-free coding.
---

# Voice Control for Claude Code

Bidirectional voice capability for Claude Code CLI. Users speak commands that Claude Code executes, and Claude Code responds with succinct TTS summaries.

## Quick Start

```bash
# 1. Start the UI server
cd ui && npm run dev

# 2. Navigate to voice page
open http://localhost:3000/voice.html

# 3. Click microphone and speak
"Fix the bug in auth.ts"
```

## Architecture

```
User Voice → Wispr STT → Intent Classifier → Claude Code Executor → Output Filter → TTS → User Hears
                              ↓
                    Conversation State Manager (context for follow-ups)
```

## Voice Command Types

### Direct Claude Code Commands

| Voice Command | Action |
|---------------|--------|
| "Ask Claude to fix the tests" | Routes to Claude Code with prompt |
| "Tell Claude to add error handling" | Routes to Claude Code with prompt |
| "Create a function that validates email" | Claude Code creates the function |
| "Fix the bug in auth.ts" | Claude Code fixes the bug |
| "Refactor this component" | Claude Code refactors |
| "Explain how this works" | Claude Code explains |

### Follow-up Commands

Follow-up commands maintain context from previous interactions:

| Voice Command | Action |
|---------------|--------|
| "Now commit those changes" | Uses context to commit recent changes |
| "Then push to main" | Uses context to push |
| "Also add tests for it" | Uses context to add tests |
| "Fix it" | References previous error/file |
| "Do that again" | Repeats previous command |

### Other Voice Commands

| Voice Command | Action Type | Example |
|---------------|-------------|---------|
| "Run npm test" | terminal | Executes npm test |
| "Open Chrome" | app_control | Opens Chrome browser |
| "Play Spotify" | app_control | Plays Spotify |
| "Git status" | terminal | Runs git status |
| "Ralph build 3" | ralph_command | Runs Ralph build |

## Components

### ClaudeCodeExecutor

Executes voice commands through Claude Code CLI:

- Uses `claude -p --dangerously-skip-permissions "{prompt}"`
- Streams output through OutputFilter
- Injects conversation context for follow-ups
- Handles timeouts and errors gracefully

**Configuration:**
```bash
VOICE_CLAUDE_TIMEOUT=300000  # 5 minute timeout
```

### OutputFilter

Filters Claude Code output for TTS readability:

**Removes (don't speak):**
- `<thinking>...</thinking>` blocks
- Tool call details: `[Tool: Read]`, `[Tool: Write]`
- File content dumps (>20 lines)
- Verbose logs (npm install output, etc.)
- Long IDs/hashes (UUIDs, commit SHAs)

**Keeps (speaks):**
- Final answers and summaries
- Error messages
- Success confirmations
- Counts/statistics ("42 tests passed")

### TTSEngine (macOS)

Text-to-speech using macOS `say` command:

- Zero latency, no dependencies
- Interruptible playback
- Configurable voice and rate

**Configuration:**
```bash
VOICE_TTS_PROVIDER=macos
VOICE_TTS_VOICE=Samantha     # macOS voice name
VOICE_TTS_RATE=200           # Words per minute
```

**Available voices (macOS):**
```bash
say -v ?  # List all available voices
```

### ConversationStateManager

Tracks conversation history for follow-up commands:

- Maintains last 10 conversation turns
- Detects follow-up patterns ("now", "then", "fix it")
- Injects context into prompts for continuity

## API Endpoints

### Voice Session

```bash
# Create session
POST /api/voice/session

# Session state
GET /api/voice/session/:id
POST /api/voice/session/:id/state

# Process audio
POST /api/voice/transcribe

# Classify intent
POST /api/voice/classify

# Execute intent
POST /api/voice/execute
```

### TTS Control

```bash
# Get TTS status
GET /api/voice/tts/status

# Speak text
POST /api/voice/tts/speak
{
  "text": "Hello world"
}

# Stop playback
POST /api/voice/tts/stop

# Enable/disable TTS
POST /api/voice/tts/enable
POST /api/voice/tts/disable

# Get available voices
GET /api/voice/tts/voices
```

### Service Health

```bash
GET /api/voice/health
# Returns status of: sttServer, ollama, claudeCode, tts
```

## UI Features

### Voice Page (voice.html)

- **Microphone button**: Click to start/stop recording
- **Waveform visualization**: Real-time audio feedback
- **Transcription display**: Shows what was heard
- **Intent display**: Shows classified action and confidence
- **Output display**: Full Claude Code output
- **Filtered output**: TTS-friendly summary
- **TTS controls**: Enable/disable, stop button
- **Service status**: STT, Ollama, Claude Code, TTS health

### Output Toggle

Switch between:
- **Filtered view**: What TTS speaks (clean, concise)
- **Full view**: Complete Claude Code output

## Intent Classification

The intent classifier uses a hybrid approach:

1. **Pattern matching**: Fast regex-based detection for common commands
2. **LLM fallback**: Ollama-based classification for ambiguous commands

### Pattern Priorities

```
1. Claude Code explicit: "ask claude...", "tell claude..."
2. Coding tasks: "create/write/build/implement/add/fix..."
3. Follow-ups: "now/then/also/next..."
4. Terminal: npm, git, ls, etc.
5. App control: open, play, pause
6. Ralph commands: ralph prd, ralph build
```

## Testing

### Manual Testing

```bash
# Start services
cd ui && npm run dev

# Open voice page
open http://localhost:3000/voice.html

# Test commands:
1. "Run the tests"              → Should hear test summary
2. "Fix the failing test"       → Claude fixes, hear confirmation
3. "Now commit those changes"   → Uses context, commits
```

### Service Health Check

```bash
curl http://localhost:3000/api/voice/health
```

### TTS Test

```bash
# Test TTS directly
curl -X POST http://localhost:3000/api/voice/tts/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, this is a test"}'
```

## Troubleshooting

### STT Server Not Running

```bash
# Start the Python STT server
cd ui/python && python stt_server.py
```

### Ollama Not Running

```bash
# Start Ollama
ollama serve

# Verify model is available
ollama list
```

### TTS Not Working (macOS)

```bash
# Test say command directly
say "Hello world"

# List available voices
say -v ?

# Set different voice in config
VOICE_TTS_VOICE=Alex
```

### Claude Code Not Found

```bash
# Verify Claude Code is installed
which claude

# Test Claude Code directly
claude -p "Say hello"
```

## File Structure

```
ui/src/voice-agent/
├── executor/
│   ├── action-router.ts          # Routes intents to executors
│   ├── claude-code-executor.ts   # Claude Code execution
│   └── terminal-executor.ts      # Terminal commands
├── filter/
│   └── output-filter.ts          # Filters output for TTS
├── llm/
│   └── intent-classifier.ts      # Intent classification
├── state/
│   └── conversation-manager.ts   # Conversation context
├── tts/
│   ├── tts-engine.ts             # TTS interface
│   └── macos-tts.ts              # macOS implementation
└── types.ts                      # Type definitions

ui/src/routes/
└── voice.ts                      # API endpoints

ui/public/
├── voice.html                    # Voice UI
└── js/voice-client.js            # Client-side JS
```

## Configuration

### Environment Variables

```bash
# TTS Configuration
VOICE_TTS_PROVIDER=macos          # TTS provider (macos)
VOICE_TTS_VOICE=Samantha          # Voice name
VOICE_TTS_RATE=200                # Speech rate (WPM)

# Claude Code Configuration
VOICE_CLAUDE_TIMEOUT=300000       # Execution timeout (ms)

# Output Filtering
VOICE_FILTER_MAX_LENGTH=500       # Max TTS message length
```

## Future Enhancements

- Alternative TTS providers (ElevenLabs, OpenAI TTS)
- Wake word detection ("Hey Claude")
- LLM-powered summarization for long outputs
- Voice authentication
- Multi-language support
