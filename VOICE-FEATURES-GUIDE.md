# Ralph CLI Voice Features - Comprehensive Guide

> **⚠️ DEPRECATED:** This file has been consolidated into [`docs/VOICE.md`](docs/VOICE.md).
> Please use the new comprehensive voice guide for all voice features.
> This file will be removed in a future release.

**Last Updated:** January 17, 2026
**Status:** Browser STT Removed (January 2026)
**Voice Systems Remaining:** Auto-Speak Hook, Terminal STT, Standalone Speak, Electron App

---

## Executive Summary

Ralph CLI provides **three distinct voice/TTS implementations** with clear separation of concerns. Browser STT has been removed due to redundancy. This guide helps you understand each system and choose the optimal configuration.

### The Three Remaining Systems

1. **Auto-Speak Hook** (Recommended for most users) ✅
2. **Terminal Voice Command** (`ralph voice`)
3. **Standalone Speak Command** (`ralph speak`)
4. **Electron Voice App** (Separate desktop application)

---

## Feature Categories Breakdown

### Category 1: Text-to-Speech (TTS) Systems

#### 1.1 Auto-Speak Hook (Context-Aware TTS)

**Location:** `.agents/ralph/auto-speak-hook.sh` + `summarize-for-tts.mjs`

**What it does:**
- Automatically speaks Claude Code responses after every interaction
- Uses local Qwen 2.5:1.5b LLM to create intelligent 1-2 sentence summaries
- Context-aware: Considers your original question when summarizing

**How it works:**
```
Claude Code completes response
→ Stop hook triggers
→ Extract transcript
→ Find user question + assistant response
→ OutputFilter (remove code blocks, markdown)
→ Qwen LLM summarization (context-aware)
→ `ralph speak` (non-blocking TTS)
→ Audio output
```

**Example:**
- You ask: "How many tests passed?"
- Claude's response: [500 lines of test output]
- You hear: "All 47 tests passed"

**Enable/Disable:**
```bash
ralph speak --auto-on      # Enable
ralph speak --auto-off     # Disable
ralph speak --auto-status  # Check status
```

**Dependencies:**
- Ollama with `qwen2.5:1.5b` model
- macOS `say` command OR Piper TTS
- Optional: `jq` for robust JSON parsing

**Configuration:** `.ralph/voice-config.json`

**Pros:**
- ✅ Fully automatic - no user action required
- ✅ Intelligent summarization prevents information overload
- ✅ Context-aware - answers what you asked
- ✅ Non-blocking - doesn't slow down Claude Code
- ✅ Configurable voice, rate, provider

**Cons:**
- ❌ Requires Ollama running locally
- ❌ Adds ~200-300ms summarization latency
- ❌ May miss nuances in very complex responses

---

#### 1.2 Standalone Speak Command

**Location:** `lib/commands/speak.js`

**What it does:**
- Speaks any text you provide via command line
- Useful for testing TTS voices and settings
- No summarization - speaks exactly what you provide

**Usage:**
```bash
ralph speak "Hello world"
echo "Build finished" | ralph speak
ralph speak "Test" --voice Samantha --rate 180
```

**Pros:**
- ✅ Simple, direct control
- ✅ Great for testing TTS configuration
- ✅ Works standalone without Claude Code

**Cons:**
- ❌ Manual invocation only
- ❌ No summarization

---

#### 1.3 TTS in Electron Voice App

**Location:** `ralph-voice-app/src/voice-agent/tts/`

**What it does:**
- Provides TTS as part of the desktop voice assistant
- Integrated with STT for full voice conversation loop
- Supports multiple providers (macOS, Piper, OpenAI, ElevenLabs)

**Pros:**
- ✅ Full-featured desktop app with UI controls
- ✅ Multiple TTS provider support
- ✅ Voice selection UI

**Cons:**
- ❌ Requires running separate Electron app
- ❌ Heavier resource footprint
- ❌ Overlaps with CLI-based TTS

---

### Category 2: Speech-to-Text (STT) Systems

#### 2.1 Terminal STT (`ralph voice`)

**Location:** `lib/commands/voice.js`

**What it does:**
- Records audio from terminal using sox/ffmpeg
- Sends to Whisper STT server for transcription
- Routes intent to Claude Code, terminal, or app control
- Speaks response via TTS

**Full Pipeline:**
```
Audio capture (sox/ffmpeg)
→ Whisper STT (faster-whisper Python server)
→ Intent classification (Ollama Qwen)
→ Execute action (Claude/terminal/AppleScript)
→ Filter output
→ TTS response
```

**Usage:**
```bash
ralph voice                    # Record from mic, then transcribe
ralph voice "your text"        # Text mode (skip recording)
ralph voice --no-tts           # Disable TTS response
ralph voice --stt-stop         # Stop STT server
```

**Pros:**
- ✅ Full hands-free CLI operation
- ✅ Multi-platform audio support
- ✅ Auto-manages STT server lifecycle
- ✅ Intent-based routing

**Cons:**
- ❌ Requires Whisper STT server running
- ❌ Terminal-based - no visual feedback
- ❌ Overlaps with Electron app functionality

---

#### 2.2 Electron App STT

**Location:** `ralph-voice-app/src/voice-agent/stt/`

**What it does:**
- Desktop app with global hotkey (Cmd+Shift+Space)
- Floating window interface
- Always-available voice assistant
- Full STT→LLM→TTS loop

**Pros:**
- ✅ Global hotkey access from anywhere
- ✅ Menubar app - always available
- ✅ Compact, frameless floating window

**Cons:**
- ❌ Requires running separate Electron app
- ❌ Most feature overlap with CLI
- ❌ Additional process overhead

---

### Category 3: Integration Systems

#### 3.1 Claude Code Hooks Integration

**Location:** `.claude/settings.local.json` + `.agents/ralph/auto-speak-hook.sh`

**What it does:**
- Hooks into Claude Code's "Stop" event
- Automatically processes every response
- Enables auto-speak functionality
- Logs to `.ralph/auto-speak-hook.log`

**Configuration:**
```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/Users/tinnguyen/ralph-cli/.agents/ralph/auto-speak-hook.sh"
          }
        ]
      }
    ]
  }
}
```

**Pros:**
- ✅ Zero-friction integration with Claude Code
- ✅ No manual invocation needed
- ✅ Works transparently in background

**Cons:**
- ❌ Requires Claude Code CLI
- ❌ Hook adds minimal processing overhead per response

---

## Feature Overlap Analysis

### Overlap Matrix

| Feature | Auto-Speak Hook | Terminal STT | Electron App |
|---------|----------------|--------------|--------------|
| **TTS Output** | ✅ Context-aware | ✅ Full text | ✅ Full text |
| **Audio Recording** | ❌ | ✅ sox/ffmpeg | ✅ MediaRecorder |
| **STT** | ❌ | ✅ Whisper | ✅ Whisper |
| **Intent Classification** | ❌ | ✅ Ollama | ✅ Ollama |
| **Claude Code Integration** | ✅ Native hooks | ✅ Subprocess | ✅ Subprocess |
| **Visual Feedback** | ❌ | ❌ | ✅ Waveform |
| **Global Hotkey** | ❌ | ❌ | ✅ Cmd+Shift+Space |
| **Summarization** | ✅ Qwen LLM | ❌ | ❌ |
| **Resource Usage** | Low | Medium | High |

### Key Redundancies

1. **Two STT implementations** doing the same thing:
   - Terminal (`ralph voice`)
   - Electron app

2. **Multiple TTS systems** with different trade-offs:
   - Auto-speak hook (smart summarization)
   - `ralph speak` command (manual)
   - Electron TTS (desktop app)

3. **Two intent classifiers** (identical):
   - Terminal voice command uses Ollama
   - Electron app uses same Ollama service

---

## Recommended Configurations

### Scenario 1: Developer Using Claude Code (Most Common)

**Recommended Setup:**
- ✅ **Enable:** Auto-speak hook (`ralph speak --auto-on`)
- ✅ **Keep:** `ralph speak` command (for testing/manual TTS)
- ❌ **Disable:** Terminal STT (`ralph voice` - use Claude Code instead)
- ❌ **Disable:** Electron app (redundant with auto-speak)

**Why:**
- Auto-speak gives you automatic voice feedback on all Claude responses
- Context-aware summarization prevents information overload
- You still interact with Claude Code via text (more precise)
- `ralph speak` available for custom TTS needs

**Commands:**
```bash
# Enable auto-speak
ralph speak --auto-on

# Verify Ollama is running
ollama list | grep qwen2.5:1.5b

# Test TTS
ralph speak "Auto-speak enabled"
```

---

### Scenario 2: Hands-Free Voice-Only Workflow

**Recommended Setup:**
- ✅ **Enable:** Terminal STT (`ralph voice`)
- ✅ **Enable:** Auto-speak hook
- ❌ **Disable:** Electron app (terminal is lighter)

**Why:**
- Full voice input/output loop in terminal
- Auto-speak provides context-aware responses
- Single terminal session handles everything
- Lighter than running Electron app

**Commands:**
```bash
# Start Whisper STT server
cd skills/voice && ./start_stt_server.sh

# Enable auto-speak
ralph speak --auto-on

# Use voice input
ralph voice
# [Record your command, it will transcribe and execute]
```

---

### Scenario 3: Standalone Voice Assistant (Electron App)

**Recommended Setup:**
- ✅ **Enable:** Electron app
- ❌ **Disable:** All other voice features (Electron is self-contained)

**Why:**
- Global hotkey access from any app
- Menubar app always available
- Compact floating window
- Fully standalone experience

**Commands:**
```bash
# Package Electron app
cd ralph-voice-app
npm run build

# Install DMG (macOS)
open dist/Ralph-1.0.0.dmg

# Launch app
# Use Cmd+Shift+Space to activate voice
```

---

## Quick Reference: Enable/Disable Commands

### Auto-Speak Hook
```bash
ralph speak --auto-on          # Enable
ralph speak --auto-off         # Disable
ralph speak --auto-status      # Check status
```

### Terminal STT
```bash
# Start STT server
cd skills/voice && ./start_stt_server.sh

# Use voice input
ralph voice

# Stop STT server
ralph voice --stt-stop
```

### Electron App
```bash
# Development mode
cd ralph-voice-app && npm run dev

# Production build
npm run build
open dist/Ralph-1.0.0.dmg
```

---

## Dependencies Reference

### Core Dependencies (All Systems)
- **Node.js** - Ralph CLI runtime
- **Python 3.8+** - STT server runtime
- **faster-whisper** - Whisper model for STT
- **Ollama** - Local LLM server (intent classification, summarization)
- **Qwen 2.5:1.5b** - LLM model for intent + summarization

### Platform-Specific
- **macOS:** `say` command (built-in TTS fallback)
- **Linux:** Requires Piper or cloud TTS provider
- **Windows:** Requires Piper or cloud TTS provider

### Audio Tools (for Terminal STT)
- **sox** (macOS/Linux) or **ffmpeg** (all platforms)
- Install: `brew install sox` or `brew install ffmpeg`

### Optional
- **jq** - Robust JSON parsing in bash scripts
- **Piper TTS** - High-quality local neural TTS
- **ElevenLabs API** - Cloud TTS (premium voices)
- **OpenAI API** - Cloud TTS alternative

---

## Installation Commands

### 1. Install Core Dependencies
```bash
# Install Ollama (macOS)
curl -fsSL https://ollama.com/install.sh | sh

# Pull Qwen model
ollama pull qwen2.5:1.5b

# Install audio tools
brew install sox  # or: brew install ffmpeg

# Optional: Install jq
brew install jq
```

### 2. Install Python STT Server
```bash
cd skills/voice

# Create Python virtual environment
python3 -m venv venv

# Activate venv
source venv/bin/activate  # macOS/Linux
# or: venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Test STT server
./start_stt_server.sh
curl http://localhost:5001/health
```

### 3. Configure Voice Settings
```bash
# Initialize voice config
ralph speak --auto-on

# Edit config manually (optional)
nano .ralph/voice-config.json
```

Example config:
```json
{
  "provider": "macos",
  "voice": "Samantha",
  "rate": 175,
  "volume": 0.8,
  "enabled": true,
  "autoSpeak": true,
  "fallbackChain": ["piper", "macos", "system"],
  "providerVoices": {
    "piper": "alba",
    "macos": "Samantha",
    "openai": "alloy",
    "elevenlabs": "Rachel"
  }
}
```

---

## Troubleshooting

### Auto-Speak Not Working

**Check 1: Is Ollama running?**
```bash
ollama list | grep qwen2.5:1.5b
# If empty: ollama pull qwen2.5:1.5b
```

**Check 2: Is auto-speak enabled?**
```bash
ralph speak --auto-status
# Should show: "Auto-speak mode: enabled"
```

**Check 3: Check hook logs**
```bash
tail -f .ralph/auto-speak-hook.log
# Should show activity after each Claude response
```

**Check 4: Test TTS directly**
```bash
ralph speak "Test message"
# Should hear audio output
```

---

### Terminal STT Not Working

**Check 1: Is STT server running?**
```bash
curl http://localhost:5001/health
# Should return: {"status":"healthy"}
```

**Check 2: Audio recording tools installed?**
```bash
which sox
which rec
which ffmpeg
# At least one should return a path
```

**Check 3: Test audio capture**
```bash
rec -r 16000 -c 1 test.wav silence 1 0.1 -50d 1 2.0 -50d
# Record audio, then Ctrl+C
# Check file exists: ls -lh test.wav
```

---

### Electron App Not Launching

**Check 1: Build completed?**
```bash
cd ralph-voice-app
npm run build
ls -lh dist/
```

**Check 2: Dependencies installed?**
```bash
npm install
```

**Check 3: Check logs**
```bash
npm run dev
# Check terminal output for errors
```

---

## Performance Comparison

| System | Latency | CPU Usage | Memory | Accuracy |
|--------|---------|-----------|--------|----------|
| **Auto-Speak Hook** | 200-400ms | Low (Qwen inference) | ~200MB (Ollama) | High (context-aware) |
| **Terminal STT** | 1-3s | Medium (Whisper) | ~500MB (Whisper + Ollama) | Very High |
| **Electron App** | 1-3s | High | ~800MB (Electron + Whisper) | Very High |

**Recommendation:** Auto-speak hook is most efficient for passive listening. Terminal STT for active voice input.

---

## What to Disable for Best Performance

### Minimal Setup (Lowest Overhead)
```bash
# Keep only:
- Auto-speak hook (ralph speak --auto-on)
- ralph speak command (for testing)

# Disable:
- Terminal STT (don't use ralph voice)
- Electron app (don't launch)
```

**Resource savings:** ~600MB RAM, minimal CPU usage

---

### Balanced Setup (Voice Input + Auto Output)
```bash
# Keep:
- Auto-speak hook
- Terminal STT (ralph voice)

# Disable:
- Electron app
```

**Resource savings:** ~300MB RAM

---

### Full-Featured Setup (Everything Enabled)
```bash
# All systems running:
- Auto-speak hook
- Terminal STT
- Electron app

# When to use:
- Development/testing of voice features
- Comparing different voice interfaces
- Demonstrating capabilities
```

**Resource usage:** ~1.2GB RAM, higher CPU during voice activity

---

## Summary Decision Matrix

| If you want... | Enable | Disable |
|----------------|--------|---------|
| **Automatic voice feedback on Claude responses** | Auto-speak hook | Terminal STT, Electron app |
| **Hands-free voice input to Claude** | Terminal STT, Auto-speak | Electron app |
| **Global hotkey voice assistant** | Electron app | All others |
| **Minimal resource usage** | Auto-speak only | Everything else |
| **Best developer experience** | Auto-speak + Terminal STT | Electron app |

---

## Final Recommendations

### For 90% of Users (Developers using Claude Code):
```bash
# Enable this:
ralph speak --auto-on

# Use this when needed:
ralph speak "custom message"

# Don't use:
- ralph voice (use Claude Code text input instead)
- Electron app (redundant with auto-speak)
```

### Why This Works:
- ✅ Automatic voice feedback on all Claude responses
- ✅ Context-aware - only hear what matters
- ✅ Minimal resource overhead
- ✅ Works transparently in background
- ✅ Text input remains more precise than voice for coding

### When to Deviate:
- Use **Terminal STT** if you truly need hands-free input
- Use **Electron app** if you want a standalone voice assistant

---

## Related Documentation

- **Auto-Speak:** `AUTO-SPEAK-GUIDE.md`
- **Terminal STT:** `lib/commands/voice.js` (source code)
- **Electron App:** `ralph-voice-app/README.md`

---

## Removed: Browser STT

Browser STT (Web UI voice input) was removed in January 2026 due to:
- Redundancy with Terminal STT functionality
- High resource overhead (UI server + browser)
- Browser permission complexity
- Terminal STT provides better integration with Ralph CLI

For visual UI preferences, use the Electron app instead, which provides a dedicated desktop experience.
