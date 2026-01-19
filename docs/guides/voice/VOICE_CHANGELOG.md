# Voice Features - Changelog

**History of voice feature improvements, bug fixes, and new capabilities**

---

## Recent Improvements

### TTS Prompt Engineering (January 19, 2026)

**Comprehensive enhancements to eliminate symbols, technical jargon, and repetitive content.**

**Issues Fixed:**

1. **Symbol Leakage** - TTS reading symbols literally ("tilde", "slash", "dot")
   - ✅ Aggressive symbol removal: `~ / \ | @ # $ % ^ & * ` < > { } [ ] = + _`
   - ✅ Post-processing removes "dot", "slash", "tilda", "tilde" words
   - ✅ Enhanced file extension filtering (.sh, .js, .py, .md, .json, etc.)
   - ✅ Path pattern removal (`.agents/ralph/`, `src/components/`)

2. **Repetitive Content** - LLM repeating same point with different wording
   - ✅ Prompt instruction: "State ONLY the main point once"
   - ✅ Sentence deduplication (60%+ similarity detection)
   - ✅ LLM parameters: `repeat_penalty` 1.3, `frequency_penalty` 0.5
   - ✅ Stop sequences halt at meta-text ("Summary:", "Note:")

3. **Technical Jargon** - Abbreviations not expanded
   - ✅ Remove abbreviations: API, CLI, TTS, JSON, HTML, CSS
   - ✅ Replace technical references: "the file" → "it"
   - ✅ Prompt explicitly forbids file names, paths, extensions

**Before/After Examples:**

| Before | After |
|--------|-------|
| "Updated voice-config dot json in dot agents slash ralph" | "Changed the voice settings" |
| "Modified the config. Updated the config. Changed the config." | "Modified the configuration." |
| "The API returns JSON with TTS config via HTTP" | "The system returns voice settings" |
| "Path is tilde slash dot agents slash ralph" | "Located in the agents directory" |

**Technical Changes:**
- Enhanced cleanup function with 150+ lines of improvements
- Sentence deduplication algorithm (concept signature matching)
- LLM parameters optimized (temperature 0.2, repeat_penalty 1.3)
- Stop sequences prevent meta-commentary

**Files Modified:** `.agents/ralph/summarize-for-tts.mjs`

---

## Bug Fixes

### Spotify Playback Default (January 17, 2026)

**Issue:** When saying "play music" or "play a song", voice agent defaulted to Apple Music, causing "Come on, not found" errors.

**Root Cause:**
1. Stage 1 (Regex) - Media control patterns missing from intent detector
2. Stage 2 (LLM) - Entity extractor defaulting to "Music" (Apple Music) instead of "Spotify"

**Fix Applied:**

**Stage 1 - Added regex patterns:**
```javascript
if (lowerText.match(/^(play|pause|stop|resume)\s*(music|spotify|song)?$/)) {
  return "app_control";
}

if (lowerText.match(/^(next|skip|previous|back)\s*(track|song)?$/)) {
  return "app_control";
}
```

**Stage 2 - Updated entity extractor:**
```typescript
// System Prompt
IMPORTANT RULES:
3. For media commands (play, pause, stop, next, previous) WITHOUT
   a specified app, default to "Spotify"

// Few-shot Examples
User: "play music"
{"appName": "Spotify", "action": "play"}
```

**Test Results:**
| Command | Intent | App | Action | Status |
|---------|--------|-----|--------|--------|
| "play music" | app_control | Spotify | play | ✅ |
| "play a song" | app_control | Spotify | play | ✅ |
| "pause" | app_control | Spotify | pause | ✅ |
| "next track" | app_control | Spotify | next | ✅ |

**Specifying Different Apps:**
To use Apple Music: "play music in apple music" or "open apple music and play"

**Files Modified:** `ui/src/voice-agent/llm/entity-extractor.ts`, `tests/test-hybrid-simple.mjs`

---

## New Features

### Window Management (January 17, 2026)

**31 new voice commands for macOS window and app control.**

#### Window Tiling (8 commands)
```
"snap window left/right/top/bottom"
"tile left/right"
"center window"
"move to next display"
```

**How it works:**
- Automatically detects screen size and positions windows
- Works with any app (Chrome, VS Code, Terminal)
- Multi-monitor support with "move to next display"

#### Browser Control (6 commands)
```
"open google.com"         → Opens URL in default browser
"new tab"                 → Opens new browser tab
"close tab"               → Closes current tab
"refresh page"            → Reloads current page
"go back/forward"         → Browser navigation
```

**Supported browsers:** Safari, Chrome, Firefox, Arc, Microsoft Edge

#### Clipboard Operations (4 commands)
```
"copy that"              → Cmd+C
"paste"                  → Cmd+V
"select all"             → Cmd+A
"what's on the clipboard" → Reads clipboard aloud
```

#### Finder Navigation (3 commands)
```
"open documents/desktop/downloads"
"new finder window"
"go to /path/to/folder"
```

#### VS Code / Cursor (3 commands)
```
"command palette"        → Cmd+Shift+P
"go to line 42"          → Jump to line
"open file"              → File picker
```

#### Terminal (3 commands)
```
"clear terminal"         → Cmd+K
"delete this line"       → Ctrl+U
"delete word"            → Opt+Delete
```

#### Communication (4 commands)
```
"text John hey running late"     → iMessage
"send email to colleague@company.com"
"create event Team Meeting"
"create reminder Review PR"
```

**Architecture: Two-Stage Hybrid**
```
Stage 1: Regex Pattern Matching (<1ms)
├─ Detects command type (window, browser, clipboard, etc.)
└─ Fast intent classification

Stage 2: LLM Entity Extraction (200-400ms)
├─ Extracts parameters (URL, path, line number)
├─ Normalizes app names
└─ Validates actions
```

**Files Modified:**
- `ui/src/voice-agent/executor/applescript-executor.ts` (31 new actions)
- `ui/src/voice-agent/llm/entity-extractor.ts` (updated examples)
- `ui/src/voice-agent/llm/intent-classifier.ts` (regex patterns)

**Safety Features:**
- Blocked apps: kernel_task, launchd, WindowServer, loginwindow
- Permissions required: Accessibility, Screen Recording, Automation

---

### Multilingual Auto-Detection (Earlier 2026)

**Automatic language detection and TTS routing.**

**How it works:**
1. Uses [franc-min](https://github.com/wooorm/franc) to detect language
2. Vietnamese detected (20+ chars) → routes to VieNeu-TTS
3. Otherwise → uses default TTS engine (macOS/Piper)

**Usage:**
```bash
# Enable (default)
ralph speak --multilingual-on

# Check status
ralph speak --multilingual-status

# Disable
ralph speak --multilingual-off
```

**Detection Requirements:**
- Minimum 20 characters for reliable detection
- Short text defaults to English (prevents false positives)
- VieNeu must be installed for Vietnamese routing

**Files Modified:** `lib/commands/speak.js`, `.agents/ralph/language-voice-mapper.mjs`

---

### VieNeu-TTS Integration (Earlier 2026)

**High-quality Vietnamese text-to-speech with voice cloning.**

**Installation:**
```bash
.agents/ralph/setup/vieneu-setup.sh
```

**Available Voices:** Binh (M), Tuyen (F), Vinh (M), Doan (M), Ly (F), Ngoc (F)

**Voice Cloning:**
```bash
source ~/.agents/ralph/vieneu/venv/bin/activate
python ~/.agents/ralph/vieneu/clone-voice.py audio.wav my_voice
ralph speak --set-vieneu-voice my_voice
```

**Requirements for cloning:**
- 3-5 second WAV audio sample
- 16kHz or 22kHz sample rate
- Clean speech, minimal background noise

**Files Modified:** `lib/commands/speak.js`, `.agents/ralph/setup/vieneu-setup.sh`

---

### Auto-Speak Modes (Earlier 2026)

**Adaptive summarization based on response complexity.**

**Modes:**
| Mode | Words | Use Case |
|------|-------|----------|
| `short` | ~30 | Simple answers (default) |
| `medium` | ~100 | Explanations, multi-step changes |
| `full` | ~200 | PRDs, plans, complex summaries |
| `adaptive` | varies | Auto-detect based on complexity |

**Adaptive detection:**
- 3+ user stories → `full` mode
- 2+ week/phase references → `full` mode
- Response length thresholds → `short`/`medium`/`full`
- 5+ bullet points → upgrade mode

**Usage:**
```bash
ralph speak --auto-mode=adaptive
ralph speak --auto-mode=full
ralph speak --auto-mode=short
```

**Files Modified:** `.agents/ralph/auto-speak-hook.sh`, `.agents/ralph/summarize-for-tts.mjs`

---

### On-Demand Recap (Earlier 2026)

**Longer summaries when you want more detail.**

```bash
# Medium summary (~100 words) - default
ralph recap

# Detailed summary (~200 words)
ralph recap --full

# Short summary (~30 words)
ralph recap --short

# Preview without speaking
ralph recap --preview
```

**Recap style:** Concise, bulleted format optimized for listening:
```
"Feature completed. One, added login endpoint. Two, added logout endpoint.
Three, tests passing. Next steps: add rate limiting, add email verification."
```

**Files Modified:** `lib/commands/speak.js`, `.agents/ralph/summarize-for-tts.mjs`

---

## Removed Features

### Browser STT (January 2026)

**Removed due to redundancy and complexity.**

**Reasons for removal:**
- Redundant with Terminal STT functionality
- High resource overhead (UI server + browser)
- Browser permission complexity
- Terminal STT provides better CLI integration

**Alternative:** Use Electron app for visual UI preferences with dedicated desktop experience.

**Files Removed:** Web UI voice input components, browser STT handlers

---

## Performance Improvements

### TTS Prompt Engineering Impact (January 19, 2026)

| Component | Before | After | Impact |
|-----------|--------|-------|--------|
| Prompt length | ~400 chars | ~1200 chars | +3x tokens (negligible) |
| Cleanup time | ~2ms | ~5ms | +3ms (negligible) |
| LLM latency | ~800ms | ~750ms | Faster (lower temp) |
| Summary quality | Variable | Consistent | 📈 Better |

**Overall:** Minimal performance impact, significant quality improvement.

---

## Configuration Changes

### Voice Config Evolution

**Initial format (legacy):**
```json
{
  "autoSpeak": true
}
```

**Current format:**
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

**Legacy format still supported** - auto-migrates to new format on first use.

---

## Known Issues

### Current Limitations

1. **VieNeu voice cloning** - Requires 3-5s clean audio sample (may not work with noisy recordings)
2. **Multilingual detection** - Requires 20+ characters (short phrases default to English)
3. **Window management** - macOS only (requires Accessibility permissions)
4. **Media control** - Spotify default may conflict with users who prefer Apple Music
5. **Headless mode progress** - Initial delay may miss very fast responses (<5s)

### Planned Improvements

1. **Language-specific cleanup** - Different symbol handling for Vietnamese vs English
2. **Context-aware symbols** - Keep symbols when meaningful (e.g., "Route /api/users")
3. **User feedback loop** - Flag bad summaries for retraining
4. **A/B testing** - Compare old vs new prompts with metrics
5. **Adaptive repetition threshold** - Learn optimal overlap threshold per user
6. **Windows/Linux window management** - Cross-platform support

---

## Migration Notes

### Upgrading from Old Voice Config

**If you have the old format:**
```json
{
  "autoSpeak": true
}
```

**It will auto-migrate to:**
```json
{
  "autoSpeak": {
    "enabled": true,
    "mode": "short"
  }
}
```

**No action required** - migration happens automatically on first use.

### Uninstalling Auto-Speak Hooks

**To remove Claude Code hooks:**
```bash
.agents/ralph/setup/remove-hooks.sh
```

This removes hook configuration from `~/.claude/settings.local.json`.

---

## Related Documentation

- [Main Voice Guide](VOICE.md) - Comprehensive setup and usage
- [Auto-Speak Guide](../AUTO-SPEAK-GUIDE.md) - Deprecated, see VOICE.md instead
- [Voice Features Guide](../VOICE-FEATURES-GUIDE.md) - Deprecated, see VOICE.md instead
- [Testing Guide](TESTING.md) - How to test voice features

---

## Contributing

**Found an issue or have an improvement?**

1. Create a GitHub issue with details
2. Tag with `voice` label
3. Include audio samples or transcripts if applicable
4. Describe expected vs actual behavior

**Want to add a new TTS provider?**

See implementation in `lib/commands/speak.js` and follow the provider pattern.

---

**Last Updated:** January 19, 2026
