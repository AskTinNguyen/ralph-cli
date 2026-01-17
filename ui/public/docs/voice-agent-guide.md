# Ralph Voice Agent User Guide

The Ralph Voice Agent provides hands-free voice control for Ralph CLI and Claude Code. Speak commands naturally, and the agent transcribes, interprets, and executes them while providing spoken feedback.

---

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Using the Voice Agent](#using-the-voice-agent)
4. [Voice Commands](#voice-commands)
5. [Settings Panel](#settings-panel)
6. [Keyboard Shortcuts](#keyboard-shortcuts)
7. [Troubleshooting](#troubleshooting)

---

## Overview

The Voice Agent is a browser-based interface that connects speech recognition, intent classification, and text-to-speech to create a seamless voice interaction experience. It allows you to:

- Control Ralph CLI with spoken commands
- Execute Claude Code queries hands-free
- Run terminal commands by voice
- Open applications and perform system tasks
- Receive spoken summaries of command output

The agent uses a pipeline architecture:

```
Voice Input -> Transcription (Whisper) -> Intent Classification (Ollama) -> Execution -> TTS Output
```

---

## Features

### Wake Word Detection

Say **"Hey Claude"** to activate the voice agent without clicking. When enabled, the agent continuously listens for the wake phrase and automatically begins recording your command.

**How it works:**

1. Enable wake word detection using the toggle in the voice controls
2. The purple indicator shows "Listening for 'Hey Claude'..."
3. Say "Hey Claude" followed by your command
4. The agent activates and processes your request

**Privacy note:** When wake word detection is enabled, audio is monitored for the wake phrase. A privacy indicator appears to remind you that the microphone is active.

### Text-to-Speech Providers

The Voice Agent supports three TTS providers, each with different characteristics:

| Provider | Description | Voices | Best For |
|----------|-------------|--------|----------|
| **macOS** | Built-in system voices | 100+ voices | Offline use, no API keys needed |
| **ElevenLabs** | Premium AI voices | Dynamic (fetched from API) | Natural, expressive speech |
| **OpenAI** | High-quality neural voices | alloy, echo, fable, onyx, nova, shimmer | Consistent, professional output |

**Provider fallback:** If a cloud provider fails or lacks an API key, the agent automatically falls back to macOS system voices.

### Voice Configuration

Customize the voice experience through the settings panel:

- **Provider:** Select macOS, ElevenLabs, or OpenAI
- **Voice:** Choose from available voices for the selected provider
- **Speech Rate:** Adjust speed from 100 to 300 words per minute
- **Volume:** Control output volume from 0% to 100%

Settings persist across sessions via localStorage and server configuration.

### LLM-Powered Output Summarization

Long command outputs are automatically summarized for spoken feedback. When output exceeds 500 characters:

1. The raw output is filtered to remove code blocks and formatting
2. A local Ollama LLM generates a 1-2 sentence summary
3. The summary is spoken via TTS instead of the full output

**Example:** A `git status` command that lists 50 modified files becomes: "The repository has uncommitted changes on the main branch with several modified files in the src directory."

**Output view modes:**
- **Summary:** Shows the LLM-generated summary (default)
- **Filtered:** Shows filtered output without code blocks
- **Full Output:** Shows complete raw output

### Session Persistence

Your voice session persists across browser refreshes:

- **Command history** is saved and restored
- **Conversation context** (like current PRD) is maintained
- **Settings** (provider, voice, rate, volume) are preserved

Sessions remain valid for 1 hour. Sessions older than 24 hours are automatically cleaned up.

---

## Using the Voice Agent

### Starting a Voice Session

1. Navigate to the Voice Agent page in Ralph UI
2. Wait for the status indicators to turn green:
   - **Whisper STT:** Speech-to-text server
   - **Ollama LLM:** Intent classification
   - **Claude Code:** Command execution
   - **TTS:** Text-to-speech
   - **Session:** Active session
3. Click the microphone button or say "Hey Claude" (if wake word is enabled)

### Recording a Command

**Click-to-record method:**

1. Click the large microphone button (it turns red while recording)
2. Speak your command clearly
3. Click again to stop recording
4. Wait for transcription and execution

**Wake word method:**

1. Enable wake word detection
2. Say "Hey Claude" followed by your command
3. The agent automatically stops recording after a pause

### Understanding the Interface

**Status Bar:** Shows health of all connected services
- Green dot: Service healthy
- Red dot: Service unavailable
- Pulsing dot: Service in use

**State Badge:** Shows current agent state
- **Idle:** Ready for input
- **Listening:** Recording audio
- **Transcribing:** Converting speech to text
- **Classifying:** Determining intent
- **Confirming:** Waiting for user confirmation
- **Executing:** Running the command
- **Error:** Something went wrong

**Transcription Display:** Shows what the agent heard

**Intent Display:** Shows how the agent interpreted your command
- **Action:** Type of command (terminal, Claude Code, etc.)
- **Command:** The extracted command
- **Confidence:** How confident the agent is in the interpretation

### Confirmation Dialogs

Potentially destructive commands require confirmation:

- Commands containing `rm`, `delete`, `sudo`
- File system modifications
- System-level operations

When confirmation is required:
1. Review the displayed command
2. Click **Execute** to proceed or **Cancel** to abort

---

## Voice Commands

### Terminal Commands

Speak terminal commands naturally:

- "Run git status"
- "Show me the current directory"
- "List all files in the src folder"
- "Check disk space"

### Claude Code Commands

Ask Claude Code to perform tasks:

- "Ask Claude to fix the TypeScript errors"
- "Have Claude review my code"
- "Use Claude to explain this function"
- "Ask Claude about the project structure"

### Ralph Commands

Control Ralph CLI directly:

- "Start a new PRD"
- "Run ralph plan"
- "Build 5 iterations"
- "Check stream status"

### Application Control

Open and control applications (macOS):

- "Open Chrome"
- "Launch VS Code"
- "Open the terminal"
- "Switch to Safari"

### Web Search

Perform web searches:

- "Search for Node.js documentation"
- "Look up React hooks"
- "Find information about TypeScript generics"

---

## Settings Panel

Click the gear icon to open the voice settings panel.

### TTS Provider Selection

Select your preferred text-to-speech provider:

1. **macOS (System):** Uses built-in macOS voices. No configuration needed.

2. **ElevenLabs:** Requires `ELEVENLABS_API_KEY` environment variable. Provides premium AI voices with natural intonation.

3. **OpenAI:** Requires `OPENAI_API_KEY` environment variable. Offers six distinct voices:
   - **alloy:** Balanced, neutral
   - **echo:** Warm, conversational
   - **fable:** British, expressive
   - **onyx:** Deep, authoritative
   - **nova:** Friendly, upbeat
   - **shimmer:** Soft, gentle

### Voice Selection

The voice dropdown updates based on the selected provider:

- For macOS: Shows all system voices (100+)
- For ElevenLabs: Fetches available voices from your account
- For OpenAI: Shows the six available voices

A loading spinner appears while fetching voices. If fetching fails, an error message is displayed.

### Speech Rate

Adjust how fast the voice speaks:

- **Minimum:** 100 WPM (slow, deliberate)
- **Default:** 175 WPM (comfortable listening)
- **Maximum:** 300 WPM (fast playback)

The slider shows real-time values and updates immediately.

### Volume Control

Adjust output volume:

- Drag the slider from 0% (muted) to 100% (full volume)
- Changes take effect on the next TTS output

---

## Keyboard Shortcuts

Currently, the Voice Agent is primarily mouse/touch controlled. Key interactions:

| Action | Method |
|--------|--------|
| Start/stop recording | Click microphone button |
| Confirm command | Click "Execute" button |
| Cancel command | Click "Cancel" button |
| Stop TTS | Click "Stop Speaking" button |
| Toggle settings | Click gear icon |

---

## Troubleshooting

### Microphone Access Denied

**Error:** "Microphone access denied"

**Solution:**
1. Click the lock icon in your browser's address bar
2. Find "Microphone" in the permissions list
3. Change from "Block" to "Allow"
4. Refresh the page

### No Microphone Detected

**Error:** "No microphone detected"

**Solution:**
1. Check that a microphone is connected
2. Verify the microphone appears in System Preferences > Sound > Input
3. Try a different USB port if using an external microphone
4. Restart the browser

### Microphone In Use

**Error:** "Microphone in use by another app"

**Solution:**
1. Close other applications using the microphone (Zoom, Teams, etc.)
2. Check for browser tabs with microphone access
3. Restart the browser if the issue persists

### STT Server Unreachable

**Status:** STT indicator shows red

**Solution:**
1. Verify the Whisper STT server is running:
   ```bash
   python ui/python/stt_server.py
   ```
2. Check that the server is accessible on the expected port
3. Review server logs for errors

### Ollama Not Running

**Status:** Ollama indicator shows red

**Solution:**
1. Start Ollama:
   ```bash
   ollama serve
   ```
2. Verify the required model is available:
   ```bash
   ollama list
   ```
3. Pull the intent classification model if needed:
   ```bash
   ollama pull qwen2.5:1.5b
   ```

### TTS Not Working

**Symptoms:** Commands execute but no spoken output

**Checks:**
1. Verify TTS is enabled (checkbox in voice controls)
2. Check volume is not at 0%
3. For cloud providers, verify API keys are set:
   - `OPENAI_API_KEY` for OpenAI TTS
   - `ELEVENLABS_API_KEY` for ElevenLabs
4. Try switching to macOS provider as fallback

### Network/Connection Issues

**Symptoms:** Intermittent failures, retry messages

The Voice Agent includes automatic retry logic:
- STT calls retry up to 3 times with exponential backoff
- TTS calls retry up to 3 times before falling back to macOS
- SSE connections automatically reconnect up to 5 times

**If retries are exhausted:**
1. Check your internet connection
2. Verify the API services are not rate-limited
3. Refresh the page to restart the session

### Session Not Restoring

**Symptoms:** History missing after page refresh

**Checks:**
1. Sessions older than 1 hour are not restored
2. Verify localStorage is not disabled or full
3. Check browser privacy settings

**To clear and start fresh:**
1. Open browser Developer Tools
2. Go to Application > Local Storage
3. Delete entries starting with `ralph-voice-session`

### Timeout Errors

**Error:** "Operation timed out after Xs"

Default timeouts:
- STT transcription: 30 seconds
- Intent classification: 10 seconds
- TTS generation: 15 seconds

**Solutions:**
1. For STT timeouts: Speak more clearly or closer to the microphone
2. For intent timeouts: Simplify your command
3. For TTS timeouts: Try a shorter response or switch providers
4. Use the "Retry" button that appears with timeout errors

### Wake Word Not Triggering

**Symptoms:** Saying "Hey Claude" has no effect

**Checks:**
1. Verify wake word detection is enabled (toggle is on)
2. Check that the purple indicator shows "Listening for 'Hey Claude'..."
3. Speak clearly with a brief pause after "Hey Claude"
4. Ensure no other voice assistant is capturing the audio

### Audio Quality Issues

**Symptoms:** Poor transcription accuracy

**Tips:**
1. Use a good quality microphone
2. Reduce background noise
3. Speak at a moderate pace
4. Position the microphone 6-12 inches from your mouth
5. Check the waveform visualization to ensure audio is being captured

---

## Additional Resources

- **Configuration Guide:** See the separate setup documentation for server configuration
- **API Reference:** Voice Agent API endpoints are documented in `/api/voice/*`
- **Source Code:** Implementation details in `ui/src/voice-agent/`

For issues not covered here, check the server logs or file an issue on GitHub.
