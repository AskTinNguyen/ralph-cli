# Ralph Voice

Standalone Electron app for voice-controlled desktop automation on macOS.

## Features

- **Global Hotkey**: `Cmd+Shift+Space` to activate voice input
- **Menu Bar Icon**: Click to show/hide, right-click for menu
- **Compact UI**: Frameless floating window, always on top
- **31 Voice Commands**: Window management, browser, clipboard, terminal, communication
- **Offline STT**: Whisper-based speech-to-text
- **Local LLM**: Ollama for intent classification

## Requirements

- macOS 12.0+ (Monterey or later)
- [Ollama](https://ollama.ai) installed locally with `qwen2.5:1.5b` model
- Microphone permissions

## Installation

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Build for production
npm run build

# Package as DMG
npm run package
```

## Usage

1. **Launch the app** - It runs in the menu bar
2. **Press `Cmd+Shift+Space`** - Voice window appears
3. **Speak your command** - "Open Chrome", "Snap window left", etc.
4. **Press `Escape`** - Cancel and hide window

## Voice Commands

### Window Management
- "Snap window left/right"
- "Center the window"
- "Move to next display"

### Browser Control
- "Open google.com"
- "New tab"
- "Go back"

### App Control
- "Open Spotify"
- "Switch to Terminal"
- "Close Safari"

### Media
- "Play music"
- "Next track"
- "Volume up/down"

### Ralph CLI
- "What's the status?"
- "Create a new PRD"
- "Run build 5"

### Claude Code
- "Ask Claude to fix the bug"
- "Create a function that..."

## Development

```bash
# Run in development mode with hot reload
npm run dev

# Type check
npm run typecheck

# Lint
npm run lint
```

## Project Structure

```
ralph-voice-app/
├── src/
│   ├── main/           # Electron main process
│   │   ├── main.ts     # App entry, window management
│   │   ├── shortcuts.ts # Global hotkey registration
│   │   ├── tray.ts     # Menu bar icon
│   │   ├── ipc-handlers.ts # IPC communication
│   │   └── stt-service.ts  # STT server lifecycle
│   ├── preload/
│   │   └── preload.ts  # Secure context bridge
│   ├── renderer/
│   │   ├── index.html  # Compact voice UI
│   │   ├── styles/     # CSS styles
│   │   └── scripts/    # UI logic
│   └── voice-agent/    # Voice processing module
│       ├── llm/        # Intent classification
│       ├── executor/   # Command execution
│       ├── tts/        # Text-to-speech
│       └── stt/        # Speech-to-text client
├── assets/             # App icons
├── resources/          # Bundled resources
└── electron-builder.yml # Build configuration
```

## Building for Distribution

```bash
# Build and package as DMG
npm run package:dmg

# Output will be in ./release/
```

## License

MIT
