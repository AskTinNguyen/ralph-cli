# Ralph Voice Agent Setup Guide

Complete setup and configuration guide for the Ralph Voice Agent - a voice-controlled interface for Claude Code CLI with bidirectional voice capabilities.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Environment Variables](#environment-variables)
3. [Setting Up Dependencies](#setting-up-dependencies)
4. [Configuration Options](#configuration-options)
5. [Starting the Voice Agent](#starting-the-voice-agent)
6. [Verifying Setup](#verifying-setup)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### System Requirements

| Requirement | Details |
|-------------|---------|
| **Operating System** | macOS (primary support), Linux (partial) |
| **Node.js** | v18 or higher |
| **Python** | 3.9 or higher (for STT server) |
| **Browser** | Chrome, Firefox, or Safari (desktop) |
| **Microphone** | USB or built-in microphone |

### Required Services

The voice agent requires the following services to be running:

| Service | Purpose | Default URL |
|---------|---------|-------------|
| **Ollama** | Intent classification (LLM) | `http://localhost:11434` |
| **Whisper STT Server** | Speech-to-text transcription | `http://localhost:5001` |
| **Ralph UI Server** | Voice interface and API | `http://localhost:3000` |
| **Claude Code CLI** | Command execution | System PATH |

### Browser Permissions

The voice agent requires microphone access. When you first visit the voice page, your browser will prompt for microphone permission. Grant access to enable voice recording.

---

## Environment Variables

Create a `.env` file in the `ui/` directory or set these environment variables in your shell:

### Required for Cloud TTS Providers

```bash
# OpenAI TTS (for high-quality voice synthesis)
OPENAI_API_KEY=sk-your-openai-api-key-here

# ElevenLabs TTS (alternative cloud TTS provider)
ELEVENLABS_API_KEY=your-elevenlabs-api-key-here
```

### Optional Configuration

```bash
# STT Server Configuration
STT_PORT=5001                      # Port for Whisper STT server
STT_MODEL=base.en                  # Whisper model (tiny, base, small, medium, large)

# Voice Agent Configuration
VOICE_TTS_PROVIDER=macos           # TTS provider (macos, openai, elevenlabs)
VOICE_TTS_VOICE=Samantha           # Voice name (provider-specific)
VOICE_TTS_RATE=200                 # Speech rate in words per minute (100-300)

# Claude Code Configuration
VOICE_CLAUDE_TIMEOUT=300000        # Execution timeout in milliseconds (5 minutes)

# Output Filtering
VOICE_FILTER_MAX_LENGTH=500        # Max TTS message length before summarization
```

### API Key Sources

| Provider | Get API Key |
|----------|-------------|
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| ElevenLabs | [elevenlabs.io/api](https://elevenlabs.io/api) |

**Note:** Cloud TTS providers (OpenAI, ElevenLabs) will automatically fall back to macOS TTS if API keys are missing or the API is unreachable.

---

## Setting Up Dependencies

### 1. Install and Configure Ollama

Ollama is required for intent classification (understanding voice commands).

```bash
# Install Ollama (macOS)
brew install ollama

# Or download from https://ollama.ai/download

# Start Ollama service
ollama serve
```

Pull the required model for intent classification:

```bash
# Recommended: Fast, lightweight model
ollama pull qwen2.5:1.5b

# Alternative: More accurate but slower
ollama pull llama3.2:3b
```

Verify Ollama is running:

```bash
curl http://localhost:11434/api/tags
```

### 2. Set Up the Whisper STT Server

The Python STT server handles speech-to-text transcription using faster-whisper.

```bash
# Navigate to the voice skills directory
cd skills/voice/

# Create a virtual environment (recommended)
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install faster-whisper>=1.0.0

# Optional: Install PyAV for multi-format audio support
pip install av

# Optional: Install numpy for audio processing
pip install numpy
```

**Whisper Model Options:**

| Model | Size | Speed | Accuracy | Recommended For |
|-------|------|-------|----------|-----------------|
| `tiny.en` | 39M | Fastest | Low | Testing |
| `base.en` | 74M | Fast | Good | **Default (recommended)** |
| `small.en` | 244M | Medium | Better | Higher accuracy |
| `medium.en` | 769M | Slow | High | Complex commands |
| `large-v3` | 1.5G | Slowest | Highest | Maximum accuracy |

Start the STT server:

```bash
# Default configuration
python3 stt_server.py

# Or with custom model
STT_MODEL=small.en python3 stt_server.py

# Or custom port
STT_PORT=5002 python3 stt_server.py
```

### 3. Verify Claude Code CLI

The voice agent executes commands through Claude Code CLI.

```bash
# Check Claude Code is installed
which claude

# Test Claude Code directly
claude -p "Say hello"
```

If not installed, see the [Claude Code installation guide](https://github.com/anthropics/claude-code).

### 4. Install UI Dependencies

```bash
cd ui/
npm install
```

---

## Configuration Options

### TTS Provider Selection

The voice agent supports multiple TTS providers:

| Provider | Type | Quality | Latency | API Key Required |
|----------|------|---------|---------|------------------|
| `macos` | Local | Good | Zero | No |
| `openai` | Cloud | Excellent | Low | Yes (`OPENAI_API_KEY`) |
| `elevenlabs` | Cloud | Excellent | Low | Yes (`ELEVENLABS_API_KEY`) |
| `piper` | Local | Good | Low | No |
| `espeak` | Local | Basic | Zero | No |

Configure in the UI settings panel or via environment variables:

```bash
VOICE_TTS_PROVIDER=openai
```

### Voice Configuration

#### macOS Voices

```bash
# List available macOS voices
say -v ?

# Common high-quality voices
VOICE_TTS_VOICE=Samantha    # Female, American English
VOICE_TTS_VOICE=Alex        # Male, American English
VOICE_TTS_VOICE=Daniel      # Male, British English
```

#### OpenAI Voices

| Voice | Description |
|-------|-------------|
| `alloy` | Neutral, balanced |
| `echo` | Clear, articulate |
| `fable` | Warm, narrative |
| `onyx` | Deep, authoritative |
| `nova` | Bright, energetic |
| `shimmer` | Soft, calm |

#### ElevenLabs Voices

ElevenLabs fetches voices dynamically from your account. The default voice is "Rachel" - a clear, professional voice.

### Timeout Settings

Configure service timeouts (in milliseconds):

| Service | Default | Setting |
|---------|---------|---------|
| STT Transcription | 30,000ms | `setTimeoutMs()` on WhisperClient |
| Intent Classification | 10,000ms | `timeoutMs` in OllamaChatOptions |
| TTS Generation | 15,000ms | `setTimeoutMs()` on TTS engine |
| Claude Code Execution | 300,000ms | `VOICE_CLAUDE_TIMEOUT` |

### Session Persistence

Voice sessions persist automatically:

- **Session data**: Stored in localStorage keyed by session ID
- **Session age limit**: Sessions older than 1 hour are not restored
- **Auto-cleanup**: Sessions older than 24 hours are automatically removed
- **Settings persistence**: TTS settings saved to both localStorage and `.ralph/voice-config.json`

---

## Starting the Voice Agent

### Quick Start (All Services)

Open three terminal windows:

**Terminal 1 - Ollama:**
```bash
ollama serve
```

**Terminal 2 - STT Server:**
```bash
cd skills/voice/
source venv/bin/activate
python3 stt_server.py
```

**Terminal 3 - UI Server:**
```bash
cd ui/
npm run dev
```

### Access the Voice Interface

Open your browser and navigate to:

```
http://localhost:3000/voice.html
```

### Using the Voice Agent

1. **Click the microphone button** to start recording
2. **Speak your command** clearly (e.g., "Fix the bug in auth.ts")
3. **Release the button** or wait for automatic silence detection
4. **Listen to the response** via TTS

### Voice Command Examples

| Command Type | Example |
|--------------|---------|
| Claude Code | "Ask Claude to fix the tests" |
| Terminal | "Run npm test" |
| App Control | "Open Chrome" |
| Ralph CLI | "Ralph build 3" |
| Follow-up | "Now commit those changes" |

---

## Verifying Setup

### 1. Check Service Health

```bash
curl http://localhost:3000/api/voice/health
```

Expected response:
```json
{
  "sttServer": { "healthy": true, "model": "base.en" },
  "ollama": { "healthy": true, "model": "qwen2.5:1.5b" },
  "claudeCode": { "available": true },
  "tts": { "available": true, "provider": "macos" }
}
```

### 2. Test STT Server

```bash
curl http://localhost:5001/health
```

Expected response:
```json
{
  "status": "healthy",
  "model": "base.en",
  "ready": true
}
```

### 3. Test TTS

```bash
curl -X POST http://localhost:3000/api/voice/tts/speak \
  -H "Content-Type: application/json" \
  -d '{"text": "Hello, voice agent is working"}'
```

### 4. Test Intent Classification

```bash
curl -X POST http://localhost:3000/api/voice/classify \
  -H "Content-Type: application/json" \
  -d '{"text": "run npm test"}'
```

Expected response:
```json
{
  "success": true,
  "intent": {
    "action": "terminal",
    "command": "npm test",
    "confidence": 0.95
  }
}
```

### 5. Browser Verification

1. Navigate to `http://localhost:3000/voice.html`
2. Check the service status indicators (should all be green)
3. Click the gear icon to verify settings panel opens
4. Test microphone by clicking the record button

---

## Troubleshooting

### STT Server Not Running

**Symptoms:** Transcription fails, "STT server unreachable" error

**Solutions:**
```bash
# Check if server is running
curl http://localhost:5001/health

# Start the server
cd skills/voice/
python3 stt_server.py

# Check for missing dependencies
pip install faster-whisper av numpy
```

### Ollama Not Running

**Symptoms:** Intent classification fails, "Ollama server unreachable" error

**Solutions:**
```bash
# Start Ollama
ollama serve

# Verify model is available
ollama list

# Pull model if missing
ollama pull qwen2.5:1.5b
```

### TTS Not Working (macOS)

**Symptoms:** No audio output after command execution

**Solutions:**
```bash
# Test say command directly
say "Hello world"

# List available voices
say -v ?

# Try a different voice
VOICE_TTS_VOICE=Alex
```

### TTS Not Working (Cloud)

**Symptoms:** Falls back to macOS, "API key not set" warning

**Solutions:**
```bash
# Verify API key is set
echo $OPENAI_API_KEY
echo $ELEVENLABS_API_KEY

# Test API key validity
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

### Claude Code Not Found

**Symptoms:** Execution fails, "Claude Code not installed" error

**Solutions:**
```bash
# Verify installation
which claude

# Test directly
claude -p "Say hello"

# Check PATH
echo $PATH
```

### Microphone Permission Denied

**Symptoms:** "Microphone access denied" error in browser

**Solutions:**
1. Click the lock icon in browser address bar
2. Find microphone permission and set to "Allow"
3. Refresh the page
4. Try a different browser if issue persists

### Audio Recording Errors

| Error | Meaning | Solution |
|-------|---------|----------|
| `NotAllowedError` | Permission denied | Grant microphone permission in browser |
| `NotFoundError` | No microphone | Connect a microphone device |
| `NotReadableError` | Device in use | Close other apps using microphone |
| `AbortError` | Recording aborted | Refresh page and try again |

### Network/Timeout Errors

The voice agent includes automatic retry logic with exponential backoff:

- **STT calls**: 3 attempts with 1s, 2s, 4s delays
- **TTS calls**: 3 attempts with fallback to macOS
- **SSE reconnection**: 5 attempts with exponential backoff

If timeouts persist:
1. Check network connectivity
2. Increase timeout settings
3. Try a smaller Whisper model
4. Verify services are not overloaded

---

## Additional Resources

- [Voice Skill Documentation](../../../skills/voice/SKILL.md)
- [Ralph CLI Documentation](../../../CLAUDE.md)
- [API Endpoints Reference](../../../ui/src/routes/voice.ts)

---

## Version Information

- **Voice Agent Version:** Phase 2 (PRD-70)
- **Supported TTS Providers:** macOS, OpenAI, ElevenLabs, Piper, espeak
- **Supported STT Engine:** Whisper (via faster-whisper)
- **Intent Classification:** Ollama with qwen2.5:1.5b
