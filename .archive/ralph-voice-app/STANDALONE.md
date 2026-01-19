# Standalone Setup Guide

This guide documents how to run Ralph Voice as a completely standalone project, separate from the ralph-cli repository.

## Prerequisites

### Required Software

| Software | Version | Purpose |
|----------|---------|---------|
| **Node.js** | 18+ | Electron app runtime |
| **Python** | 3.10+ | STT server |
| **Ollama** | Latest | Local LLM for intent classification |
| **ralph CLI** | Latest | Optional - for Ralph commands |

### macOS Requirements

- macOS 12.0+ (Monterey or later)
- Microphone permissions granted to the app
- Accessibility permissions (for window management)

## Quick Start

```bash
# 1. Install Node.js dependencies
npm install

# 2. Set up Python STT server
cd python
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cd ..

# 3. Install Ollama and pull required model
ollama pull qwen2.5:1.5b

# 4. Run in development mode
npm run dev
```

## Detailed Setup

### 1. Electron App Setup

```bash
# Clone or copy the ralph-voice-app directory
cd ralph-voice-app

# Install dependencies
npm install

# Verify TypeScript compiles
npm run typecheck

# Run development mode
npm run dev

# Build for production
npm run build

# Package as DMG
npm run package:dmg
```

### 2. Python STT Server Setup

The STT (Speech-to-Text) server uses faster-whisper for local transcription.

```bash
cd python

# Create virtual environment
python -m venv venv

# Activate (macOS/Linux)
source venv/bin/activate

# Activate (Windows)
# venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Run the server manually (for testing)
python stt_server.py
```

The STT server runs on `http://localhost:8765` by default.

**Requirements:**
- `faster-whisper>=1.0.0` - Whisper model for speech recognition
- First run will download the Whisper model (~500MB)

### 3. Ollama Setup

Ollama provides local LLM inference for intent classification.

```bash
# Install Ollama (if not installed)
# macOS: brew install ollama
# Or download from https://ollama.ai

# Start Ollama service
ollama serve

# Pull the required model
ollama pull qwen2.5:1.5b
```

The app expects Ollama running on `http://localhost:11434`.

### 4. Ralph CLI (Optional)

If you want Ralph-related voice commands to work:

```bash
# Install ralph-cli globally
npm install -g ralph-cli

# Or use from source
curl -fsSL https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.sh | bash

# Verify installation
ralph --version
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `STT_SERVER_URL` | `http://localhost:8765` | STT server endpoint |
| `RALPH_PATH` | `ralph` (from PATH) | Path to ralph CLI executable |

## File Structure (Standalone)

```
ralph-voice-app/
├── src/
│   ├── main/              # Electron main process
│   ├── preload/           # Context bridge
│   ├── renderer/          # UI components
│   └── voice-agent/       # Voice processing (decoupled)
├── python/                # STT server
│   ├── stt_server.py      # Whisper-based STT
│   └── requirements.txt   # Python dependencies
├── docs/
│   └── shared/            # Symlinked docs (or copies)
│       ├── AGENTS.md
│       ├── CLAUDE.md
│       └── MCP_TOOLS.md
├── assets/                # App icons
├── resources/             # Bundled resources
├── package.json
├── electron-builder.yml
├── README.md
└── STANDALONE.md          # This file
```

## Breaking Symlinks for Full Independence

The `docs/shared/` directory contains symlinks to the parent ralph-cli project. To make this a fully standalone project:

```bash
cd ralph-voice-app/docs/shared

# Remove symlinks and copy actual files
rm AGENTS.md CLAUDE.md MCP_TOOLS.md

# Copy from ralph-cli (adjust path as needed)
cp /path/to/ralph-cli/AGENTS.md .
cp /path/to/ralph-cli/CLAUDE.md .
cp /path/to/ralph-cli/.agents/ralph/MCP_TOOLS.md .

# Or if no longer needed, remove the docs/shared directory
rm -rf docs/shared
```

## Decoupling Architecture

The voice app is designed to be fully decoupled from ralph-cli:

### How It Works

1. **Ralph CLI calls** - Uses `spawn('ralph', [...])` to execute CLI commands
2. **No direct imports** - No imports from parent directories (`../../`)
3. **External services** - STT, Ollama accessed via HTTP APIs
4. **Own type definitions** - `src/voice-agent/types.ts` defines all types locally

### Verifying Decoupling

```bash
# Check for parent directory imports
grep -r "from '\.\.\." src/
grep -r "require('\.\.\." src/

# Should return no results (only internal ../types imports)
```

## Extracting to Separate Repository

When ready to spin out to a separate repo:

1. **Copy directory**
   ```bash
   cp -r ralph-voice-app /path/to/new/repo
   ```

2. **Break symlinks** (see above)

3. **Update package.json**
   - Change `name` field
   - Update repository URL
   - Add npm publish config if needed

4. **Set up CI/CD**
   - GitHub Actions for build/test
   - Release workflow for DMG distribution

5. **Update paths**
   - Review any hardcoded paths in electron-builder.yml
   - Update entitlements.mac.plist if bundleId changes

## Troubleshooting

### STT Server Issues

```bash
# Check if server is running
curl http://localhost:8765/health

# Check logs
python python/stt_server.py  # Run manually to see errors

# Common issue: Missing model
# Solution: First run downloads ~500MB model, be patient
```

### Ollama Issues

```bash
# Check Ollama status
curl http://localhost:11434/api/tags

# Ensure model is pulled
ollama list  # Should show qwen2.5:1.5b

# Re-pull if needed
ollama pull qwen2.5:1.5b
```

### Ralph CLI Not Found

```bash
# Check if ralph is in PATH
which ralph

# If not found, install it
npm install -g ralph-cli

# Or set RALPH_PATH environment variable
export RALPH_PATH=/path/to/ralph
```

### Microphone Permissions

1. Open **System Settings** > **Privacy & Security** > **Microphone**
2. Enable permission for "Ralph Voice" (or Terminal during development)

## License

MIT
