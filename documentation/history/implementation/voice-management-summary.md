# Piper Voice Management - Summary

## New Features Added

Users can now manage Piper TTS voices directly from the terminal using `ralph speak` commands.

### 1. List Available Voices

```bash
ralph speak --list-voices
```

**Output:**
```
Available Piper Voices:

Installed:
  ✓ alba            [en_GB]      medium
  ✓ hfc_female      [en_US]      medium
  ✓ jenny_dioco     [en_GB]      medium
  ✓ lessac          [en_US]      medium
  ✓ libritts_r      [en_US]      medium
  ✓ ryan            [en_US]      medium

Use ralph speak --set-voice <name> to set default voice
```

**Features:**
- Shows all available Piper voices (both installed and discoverable)
- Color-coded: ✓ green for installed, ○ dim for available but not installed
- Displays language code and quality level for each voice
- Provides installation instructions if no voices found

### 2. Set Default Voice

```bash
ralph speak --set-voice ryan
```

**Output:**
```
Default voice set to: ryan
Test it: ralph speak "Hello from ryan"
```

**Features:**
- Validates voice exists in Piper voice catalog before saving
- Saves to `.ralph/voice-config.json` for persistence
- Warns if voice is not installed locally (needs model download)
- Shows helpful test command after setting

### 3. Get Current Voice

```bash
ralph speak --get-voice
```

**Output:**
```
Current voice: ryan
```

**Features:**
- Shows currently configured default voice
- Displays "lessac (default)" if no voice has been configured
- Reads from `.ralph/voice-config.json`

### 4. One-Time Voice Override

```bash
ralph speak "Hello" --voice alba
```

**Output:**
```
[TTS Factory] Created piper engine with voice alba
Using piper TTS...
Voice: alba
```

**Features:**
- Uses specified voice for this command only (doesn't save to config)
- Overrides configured default voice
- Updated help text clarifies this is one-time use

## Configuration Storage

Voice preferences are stored in `.ralph/voice-config.json`:

```json
{
  "voice": "ryan",
  "autoSpeak": true
}
```

**Location:** Project root → `.ralph/voice-config.json`
**Scope:** Per-project configuration
**Persistence:** Survives restarts, used by all TTS calls

## Voice Discovery

Piper voices are automatically discovered from:
- **Directory:** `~/.local/share/piper-voices/`
- **Format:** ONNX model files (e.g., `en_US-ryan-medium.onnx`)
- **Caching:** 30-second cache for performance
- **Fallback:** Uses default catalog if no voices found

**Voice naming pattern:**
- `en_US-lessac-medium.onnx` → voice ID: `lessac`
- `en_GB-alba-medium.onnx` → voice ID: `alba`
- Language and quality extracted automatically

## Available Voices (Default Catalog)

### American English (en_US)
- **lessac** - Default voice, medium quality
- **ryan** - Male voice, medium quality
- **libritts** - High-quality female voice
- **hfc_female** - Female voice, medium quality

### British English (en_GB)
- **alba** - Scottish accent, medium quality
- **jenny** - British female voice, medium quality

## Integration with Auto-Speak

The configured voice is used automatically by:
1. **Auto-speak hooks** (Stop hook, acknowledgment hook)
2. **Progress timer** (background voice updates)
3. **Manual speak commands**
4. **Voice command TTS output**

All voice output respects the configured default voice setting.

## Updated Help Text

```bash
ralph speak --help
```

**New options shown:**
```
Options:
  --voice <name>       Use specific voice (one-time)
  --rate <speed>       Speech rate (macOS only, default: 200)
  --list-voices        List all available Piper voices
  --set-voice <name>   Set default voice in config
  --get-voice          Show current default voice
  --auto-on            Enable auto-speak mode
  --auto-off           Disable auto-speak mode
  --auto-status        Check auto-speak status
```

## Examples

### Complete Workflow

```bash
# 1. List available voices
ralph speak --list-voices

# 2. Set your preferred voice
ralph speak --set-voice alba

# 3. Verify it was set
ralph speak --get-voice

# 4. Test the voice
ralph speak "Testing the Alba voice"

# 5. Try a different voice temporarily
ralph speak "Testing Ryan voice" --voice ryan

# 6. Back to configured voice
ralph speak "Back to Alba voice"
```

### Auto-Speak Integration

```bash
# Enable auto-speak with your preferred voice
ralph speak --set-voice jenny
ralph speak --auto-on

# Now all Claude Code responses will use Jenny voice automatically
# Includes acknowledgments and progress updates
```

## Technical Implementation

### Voice Resolution Order

1. **Command-line flag:** `--voice <name>` (highest priority)
2. **Config file:** `.ralph/voice-config.json` → `voice` field
3. **Provider default:** Piper uses `lessac` as fallback

### Code Changes

**File:** `lib/commands/speak.js`

**New functions:**
- `getConfiguredVoice()` - Read voice from config file
- Updated `speakText()` - Use configured voice with TTSFactory
- Added parsers for: `--list-voices`, `--set-voice`, `--get-voice`

**Integration:**
- Voice passed to `TTSFactory.getEngine(provider, voice)`
- Voice config validated against `getVoiceDetails()` from piper-tts
- Voice discovery uses `discoverInstalledVoices()` with caching

## Troubleshooting

### No voices found

```bash
ralph speak --list-voices
# Shows: "No Piper voices found"
```

**Solution:**
1. Install piper: `pip3 install piper-tts`
2. Download voice models to `~/.local/share/piper-voices/`

### Voice not installed warning

```bash
ralph speak --set-voice alba
# Shows: "Voice 'alba' is not installed yet"
```

**What it means:**
- Voice exists in catalog but model file not found locally
- Voice will work once model is downloaded
- Config still saved for future use

### Voice not found

```bash
ralph speak --set-voice nonexistent
# Shows: "Voice 'nonexistent' not found"
```

**Solution:**
- Run `ralph speak --list-voices` to see available voices
- Use exact voice ID from the list

## Future Enhancements (Optional)

1. **Voice download command:** `ralph speak --download-voice <name>`
2. **Voice samples:** `ralph speak --preview <voice>`
3. **Global vs project config:** `~/.ralph/voice-config.json` for user defaults
4. **Voice ratings:** User preferences and usage stats
5. **Custom voice catalog:** Support for user-added voice models

## Commit

```
612cca0 feat(voice): add Piper voice management to speak command
```

**Changes:**
- 1 file changed
- 171 insertions, 4 deletions
- All tests passed
