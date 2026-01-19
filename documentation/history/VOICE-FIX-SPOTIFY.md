# Spotify Playback Fix

> **⚠️ DEPRECATED:** This file has been merged into [`docs/VOICE_CHANGELOG.md`](docs/VOICE_CHANGELOG.md).
> Please check the changelog for bug fixes and improvements.
> This file will be removed in a future release.

## Issue
When you said "play music" or "play a song", the voice agent was defaulting to Apple Music instead of Spotify, resulting in errors like "Come on, not found."

## Root Cause
1. **Stage 1 (Regex)**: Media control patterns (play, pause, next, previous) were missing from the intent detector
2. **Stage 2 (LLM)**: The entity extractor was defaulting to "Music" (Apple Music) instead of "Spotify" for generic media commands

## Fix Applied

### 1. Added Media Control Patterns to Stage 1
```javascript
// Added regex patterns for media commands
if (lowerText.match(/^(play|pause|stop|resume)\s*(music|spotify|song)?$/)) {
  return "app_control";
}

if (lowerText.match(/^(next|skip|previous|back)\s*(track|song)?$/)) {
  return "app_control";
}
```

### 2. Updated Entity Extractor to Default to Spotify
```typescript
// System Prompt (entity-extractor.ts:141-149)
IMPORTANT RULES:
3. For media commands (play, pause, stop, next, previous) WITHOUT a
   specified app, default to "Spotify"

// Few-shot Examples (entity-extractor.ts:73-89)
User: "play music"
{"appName": "Spotify", "action": "play"}

User: "play a song"
{"appName": "Spotify", "action": "play"}

User: "next track"
{"appName": "Spotify", "action": "next"}
```

## Test Results ✅

All media commands now default to Spotify:

| Command | Intent | App | Action | Status |
|---------|--------|-----|--------|--------|
| "play music" | app_control | Spotify | play | ✅ |
| "play a song" | app_control | Spotify | play | ✅ |
| "pause" | app_control | Spotify | pause | ✅ |
| "next track" | app_control | Spotify | next | ✅ |
| "previous song" | app_control | Spotify | previous | ✅ |

## How to Test

### Quick Test
```bash
node tests/test-hybrid-simple.mjs --interactive <<< "play music"
```

Expected output:
```json
{
  "action": "play",
  "appName": "Spotify"
}
```

### Interactive Testing
```bash
node tests/test-hybrid-simple.mjs --interactive
```

Then try:
```
> play music
> pause
> next track
> previous song
```

### Test with Actual Voice Agent
1. Start the UI server: `cd ui && npm run dev`
2. Open http://localhost:3000/voice.html
3. Speak: "play music"
4. Spotify should start playing!

## Specifying Different Apps

If you want to use Apple Music instead of Spotify, just say:
- "play music in apple music"
- "open apple music and play"
- "apple music play"

The system will respect your choice if you specify the app explicitly.

## Files Modified

- ✅ `ui/src/voice-agent/llm/entity-extractor.ts` - Updated default to Spotify
- ✅ `tests/test-hybrid-simple.mjs` - Added media control patterns

## Commits

1. `806568a` - feat(voice): implement two-stage hybrid intent classification
2. `1104854` - fix(voice): default to Spotify for media playback commands

---

**Ready to use!** 🎵 Say "play music" and enjoy Spotify! 🎉
