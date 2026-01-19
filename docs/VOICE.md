# Ralph Voice Features - Comprehensive Guide

**Complete guide to text-to-speech and voice features in Ralph CLI**

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Auto-Speak Hook](#auto-speak-hook)
3. [TTS Engines](#tts-engines)
4. [Configuration](#configuration)
5. [Advanced Features](#advanced-features)
6. [Troubleshooting](#troubleshooting)
7. [Technical Details](#technical-details)

---

## Quick Start

### For 90% of Users (Developers using Claude Code)

```bash
# 1. Install Ralph to your project
ralph install

# 2. Follow auto-speak setup prompts
# This will:
#  - Check dependencies (Ollama, jq, TTS provider)
#  - Create voice config
#  - Provide hook configuration instructions

# 3. Enable auto-speak
ralph speak --auto-on

# 4. Use Claude Code normally
# Every response will be spoken automatically!
```

### System Architecture

Ralph provides **three distinct voice/TTS implementations**:

1. **Auto-Speak Hook** (Recommended) - Automatic TTS for Claude Code responses
2. **Terminal Voice Command** (`ralph voice`) - Full hands-free CLI with STT
3. **Standalone Speak Command** (`ralph speak`) - Manual TTS invocation

**Note:** Browser STT was removed in January 2026 due to redundancy.

---

## Auto-Speak Hook

### What It Does

Automatically speaks Claude Code responses after every interaction using:
- **Local Qwen 2.5:1.5b LLM** for intelligent 1-2 sentence summaries
- **Context-aware summarization** - considers your original question
- **Non-blocking execution** - doesn't slow down Claude Code

### How It Works

```
Claude Code completes response
→ Stop hook triggers (.agents/ralph/auto-speak-hook.sh)
→ Extract transcript (user question + assistant response)
→ OutputFilter (remove code blocks, markdown)
→ Qwen LLM summarization (context-aware)
→ ralph speak (non-blocking TTS)
→ Audio output
```

**Example:**
- You ask: "How many tests passed?"
- Claude's response: [500 lines of test output]
- You hear: "All 47 tests passed"

### Enable/Disable

```bash
# Enable auto-speak mode
ralph speak --auto-on

# Disable auto-speak mode
ralph speak --auto-off

# Check status
ralph speak --auto-status
```

### Auto-Speak Modes

Auto-speak supports multiple summarization modes:

| Mode | Chars | Tokens | Words | Use Case |
|------|-------|--------|-------|----------|
| `short` | 150 | 150 | ~30 | Simple answers, confirmations (default) |
| `medium` | 800 | 400 | ~100 | Explanations, multi-step changes |
| `full` | 1500 | 600 | ~200 | PRDs, plans, complex summaries |
| `adaptive` | varies | varies | varies | Auto-detect based on response complexity |

**Set mode:**
```bash
# Adaptive mode (recommended for varied responses)
ralph speak --auto-mode=adaptive

# Full mode (always use long summaries)
ralph speak --auto-mode=full

# Short mode (default)
ralph speak --auto-mode=short

# Show current mode
ralph speak --auto-mode
```

**Adaptive mode detection:**
- **User Stories**: 3+ `US-XXX` patterns → `full` mode
- **Multi-week/phase plans**: 2+ week/phase references → `full` mode
- **Response length**:
  - Under 500 chars → `short`
  - 500-2000 chars → `medium`
  - Over 2000 chars → `full`
- **List density**: 5+ bullet points → upgrade to `medium`/`full`

### On-Demand Recap

Auto-speak is intentionally short (~20-30 words). For more detail:

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
- When you want key decisions, caveats, or next steps

### Headless Mode (Ralph Build)

When running Ralph in headless mode (`ralph build`), auto-speak behavior is optimized:

**What works:**
- Initial acknowledgment (Claude's first response)
- Progress updates (periodic "Still working..." phrases)
- Final summarization (completion summary)

**Configuration:**
```json
{
  "skipSessionStart": {
    "headlessAlwaysSpeak": true  // Bypasses session-start detection
  },
  "progress": {
    "initialDelaySeconds": 5,    // First progress phrase delay
    "intervalSeconds": 15        // Interval between phrases
  }
}
```

**Force headless mode:**
```bash
export RALPH_HEADLESS=true
ralph build 5
```

---

## TTS Engines

Ralph supports multiple TTS providers with automatic fallback.

### macOS (Built-in)

**Default provider on macOS** - uses built-in `say` command.

```bash
# Set as default
ralph speak --set-tts-engine macos

# Test voices
say -v '?'  # List available voices

# Speak with specific voice
ralph speak "Hello" --voice Samantha
```

### VieNeu-TTS (Vietnamese Voice Cloning)

High-quality Vietnamese text-to-speech with voice cloning capability.

**Installation:**
```bash
# Run setup script (installs to ~/.agents/ralph/vieneu/)
.agents/ralph/setup/vieneu-setup.sh

# Configure
ralph speak --set-tts-engine vieneu
ralph speak --set-vieneu-voice Vinh
```

**Available preset voices:**
| Voice | Description |
|-------|-------------|
| Binh | Male voice |
| Tuyen | Female voice |
| Vinh | Male voice |
| Doan | Male voice |
| Ly | Female voice |
| Ngoc | Female voice |

**Usage:**
```bash
# Speak Vietnamese text
ralph speak "Xin chào thế giới"

# One-time use without changing default
ralph speak --engine vieneu "Xin chào"

# Switch back to macOS TTS
ralph speak --set-tts-engine macos
```

**Voice cloning (advanced):**
```bash
# Clone custom voice from audio sample
source ~/.agents/ralph/vieneu/venv/bin/activate
python ~/.agents/ralph/vieneu/clone-voice.py your_audio.wav my_voice

# Use cloned voice
ralph speak --set-vieneu-voice my_voice
```

**Requirements for voice cloning:**
- 3-5 second audio sample (WAV format)
- 16kHz or 22kHz sample rate recommended
- Clean speech, minimal background noise

### Multilingual Auto-Detection

Ralph can automatically detect Vietnamese text and route it to VieNeu-TTS.

**How it works:**
1. Text is analyzed with [franc-min](https://github.com/wooorm/franc) language detector
2. If Vietnamese detected (requires 20+ characters) and VieNeu installed → routes to VieNeu-TTS
3. Otherwise → uses configured default TTS engine

**Enable/disable:**
```bash
# Check status
ralph speak --multilingual-status

# Enable auto-detection (default)
ralph speak --multilingual-on

# Disable auto-detection
ralph speak --multilingual-off
```

**Usage examples:**
```bash
# English text → uses default engine (macOS/Piper)
ralph speak "Hello world, this is a test"

# Vietnamese text → auto-detects and routes to VieNeu
ralph speak "Xin chào thế giới, đây là một bài kiểm tra"

# Force specific engine (bypasses auto-detection)
ralph speak --engine vieneu "Hello"
ralph speak --engine macos "Xin chào"
```

**Detection requirements:**
- Minimum text length: 20 characters for reliable detection
- Short text defaults to English (prevents false positives)
- VieNeu must be installed for Vietnamese routing

### Piper (Linux Neural TTS)

High-quality local neural TTS for Linux. *(Installation instructions available in project setup)*

---

## Configuration

### Voice Config Location

All voice settings are stored in `.ralph/voice-config.json`.

### Configuration Structure

```json
{
  "ttsEngine": "macos",
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
  },
  "multilingual": {
    "enabled": true,
    "autoDetect": true
  },
  "vieneuVoice": "Vinh"
}
```

### Configuration Options

**autoSpeak:**
- `enabled`: Whether auto-speak is active (`true`/`false`)
- `mode`: Summarization mode (`"short"`, `"medium"`, `"full"`, `"adaptive"`)

**acknowledgment:**
- `enabled`: Whether initial acknowledgment voice is enabled
- `immediate`: Speak quick acknowledgment on prompt submit (`false` default)
- `immediatePhrase`: The phrase to speak immediately (default: `"Got it"`)

**progress:**
- `enabled`: Whether periodic progress phrases are enabled
- `intervalSeconds`: Interval between progress phrases (default: 15)
- `initialDelaySeconds`: Delay before first progress phrase (default: 5)

**skipSessionStart:**
- `enabled`: Skip voice on first prompt of new session
- `minUserMessages`: Minimum user messages before voice enabled (default: 1)
- `headlessAlwaysSpeak`: In headless/automation mode, always speak (default: `true`)

**multilingual:**
- `enabled`: Master switch for multilingual features
- `autoDetect`: Whether to auto-detect language and route accordingly

### Claude Code Hooks Integration

Auto-speak requires hook configuration in `~/.claude/settings.local.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "/full/path/to/.agents/ralph/auto-speak-hook.sh"
          }
        ]
      }
    ]
  }
}
```

**Automatic setup:**
```bash
# Automated hook installation (uses jq)
.agents/ralph/setup/post-install.sh

# Manual setup: Copy hook snippet from setup guidance
ralph install  # Shows hook configuration instructions
```

---

## Advanced Features

### Window Management (macOS)

Voice commands for window management:

```
"snap window left"        → Tiles active window to left half
"snap window right"       → Tiles right
"tile left/right/top/bottom"
"center window"           → Centers the active window
"move to next display"    → Moves to next monitor
```

### Browser Control

```
"open google.com"         → Opens URL in default browser
"new tab"                 → Opens new browser tab
"close tab"               → Closes current tab
"refresh page"            → Reloads current page
"go back/forward"         → Browser navigation
```

### Clipboard Operations

```
"copy that"              → Copies selected text (Cmd+C)
"paste"                  → Pastes from clipboard (Cmd+V)
"select all"             → Selects all text (Cmd+A)
"what's on the clipboard" → Reads clipboard contents aloud
```

### Media Control (Spotify Default)

```
"play music"             → Plays Spotify (defaults to Spotify)
"pause"                  → Pauses playback
"next track"             → Skip to next song
"previous song"          → Previous track
```

**Specify different app:**
```
"play music in apple music"  → Uses Apple Music instead
```

### Finder Navigation

```
"open documents"         → Opens Documents folder
"open desktop"           → Opens Desktop
"open downloads"         → Opens Downloads
"new finder window"      → Creates new Finder window
```

### VS Code / Cursor

```
"command palette"        → Opens command palette (Cmd+Shift+P)
"go to line 42"          → Jumps to specific line
"open file"              → Opens file picker
```

### Terminal

```
"clear terminal"         → Clears the terminal (Cmd+K)
"delete this line"       → Deletes current line (Ctrl+U)
"delete word"            → Deletes last word (Opt+Delete)
```

**Note:** Advanced features require Terminal STT (`ralph voice`) or Electron app. See [Voice Features Guide](#voice-systems) for setup.

---

## Troubleshooting

### No Audio Output

**Check 1: Is auto-speak enabled?**
```bash
ralph speak --auto-status
```

**Check 2: Is Ollama running?**
```bash
curl http://localhost:11434/api/tags
ollama list | grep qwen2.5:1.5b
```

**Check 3: Test TTS manually**
```bash
echo "test" | ralph speak
```

**Check 4: Check logs**
```bash
tail -f .ralph/auto-speak-hook.log
```

### Hook Not Firing

**Check 1: Verify hook configuration**
```bash
cat ~/.claude/settings.local.json | grep -A5 "hooks"
```

**Check 2: Ensure script is executable**
```bash
chmod +x .agents/ralph/auto-speak-hook.sh
```

**Check 3: Check hook logs**
```bash
tail -20 .ralph/auto-speak-hook.log
```

### Qwen Summarization Failing

**Check 1: Ollama service**
```bash
ollama list
```

**Check 2: Pull Qwen model**
```bash
ollama pull qwen2.5:1.5b
```

**Check 3: Test Ollama directly**
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:1.5b",
  "prompt": "Summarize: Hello world",
  "stream": false
}'
```

**Fallback:** If Qwen fails, system uses regex-based cleanup (no LLM summarization).

### Headless Mode / Ralph Build Issues

**Check 1: Verify headless mode detection**
```bash
tail -20 .ralph/session-detect.log | grep -i headless
```
Should show: `Headless mode detected, always speak enabled - allowing voice`

**Check 2: Verify headlessAlwaysSpeak setting**
```bash
jq '.skipSessionStart.headlessAlwaysSpeak' .ralph/voice-config.json
```
Should return `true`

**Check 3: Force headless mode**
```bash
export RALPH_HEADLESS=true
ralph build 5
```

**Check 4: Check progress timer logs**
```bash
tail -30 .ralph/progress-timer.log
```

**Check 5: Verify TTS manager**
```bash
tail -30 .ralph/tts-manager.log
```

### Text Not Clean (Code Blocks Spoken)

The system uses two-stage filtering:
1. **OutputFilter** - Removes code blocks, tool calls, markdown, URLs
2. **TTSSummarizer** (Qwen) - Generates natural 1-2 sentence summary

**If you hear code being spoken:**
- Check `.ralph/auto-speak-hook.log` for summary preview
- Verify Qwen model is working (test with curl command above)
- Adjust `maxTokens` in `.agents/ralph/summarize-for-tts.mjs`

### Recap Not Finding Transcript

**If `ralph recap` says "No transcript found":**
1. Ensure you're in a directory where Claude Code has been used
2. Check Claude projects exist: `ls ~/.claude/projects/`
3. Transcripts are stored per-project with encoded paths

---

## Technical Details

### Prompt Engineering

The TTS summarization uses carefully engineered prompts to eliminate:
- **Symbols** - File paths, technical syntax (`~`, `/`, `.`, etc.)
- **Repetition** - Duplicate points with different wording
- **Technical jargon** - API, CLI, TTS abbreviations
- **File references** - `voice-config.json`, `.agents/ralph/`

**Prompt structure:**
```
Your task: Create a clear spoken summary answering what the user asked.

FORMAT ([style], [words]):
- Use natural conversational speech
- For lists: "First, [action]. Second, [action]. Third, [action]."
- State ONLY the main point once - do not repeat or rephrase

STRICT RULES - NEVER include:
- File names or paths
- File extensions (.sh, .js, .py, .md)
- Technical references ("the file", "the script")
- Symbols: ~ / \ | @ # $ % ^ & * ` < > { } [ ] = + _
- Abbreviations (TTS, API, CLI) - say full words

WHAT TO SAY:
- Actions completed: "Added feature X", "Fixed the login bug"
- Key outcomes: "Users can now...", "The system will..."
- Next steps: "You should...", "Consider..."
```

### Cleanup Pipeline

**Stage 1: OutputFilter** (`.agents/ralph/output-filter.mjs`)
- Remove code blocks (```...```)
- Remove tool calls (<function_calls>...