# Usage-Specific Voice Configuration

Ralph supports configuring different voices and TTS engines for different usage types (summary, acknowledgment, progress) and languages.

## Configuration Structure

In `.ralph/voice-config.json`, add a `usageVoices` section:

```json
{
  "ttsEngine": "piper",
  "voice": "ryan",
  "usageVoices": {
    "en": {
      "summary": {
        "voice": "ryan",
        "engine": "piper"
      },
      "acknowledgment": {
        "voice": "ryan",
        "engine": "piper"
      },
      "progress": {
        "voice": "ryan",
        "engine": "piper"
      }
    },
    "vi": {
      "summary": {
        "voice": "Vinh",
        "engine": "vieneu"
      },
      "acknowledgment": {
        "voice": "Vinh",
        "engine": "vieneu"
      },
      "progress": {
        "voice": "Vinh",
        "engine": "vieneu"
      }
    }
  }
}
```

## Usage Types

- **summary**: Auto-speak final response summaries (after Claude Code completes)
- **acknowledgment**: Initial "Got it" or quick acknowledgments (when prompt submitted)
- **progress**: Periodic "Still working..." status updates during long operations

## Language Codes

- **en**: English
- **vi**: Vietnamese
- **zh**: Chinese

Ralph auto-detects the language of the text being spoken and routes to the appropriate voice configuration.

## Fallback Behavior

If `usageVoices` is not configured, Ralph falls back to:
- Engine: Value from `ttsEngine` field (default: "macos")
- Voice: Value from `voice` field (default: "" - uses engine default)

## Example Configurations

### Same Voice for All Types (Piper Ryan)

```json
{
  "ttsEngine": "piper",
  "voice": "ryan",
  "usageVoices": {
    "en": {
      "summary": { "voice": "ryan", "engine": "piper" },
      "acknowledgment": { "voice": "ryan", "engine": "piper" },
      "progress": { "voice": "ryan", "engine": "piper" }
    }
  }
}
```

### Different Voices per Type (macOS)

```json
{
  "ttsEngine": "macos",
  "usageVoices": {
    "en": {
      "summary": { "voice": "Samantha", "engine": "macos" },
      "acknowledgment": { "voice": "Alex", "engine": "macos" },
      "progress": { "voice": "Victoria", "engine": "macos" }
    }
  }
}
```

### Multilingual with Different Engines

```json
{
  "ttsEngine": "piper",
  "usageVoices": {
    "en": {
      "summary": { "voice": "ryan", "engine": "piper" },
      "acknowledgment": { "voice": "ryan", "engine": "piper" },
      "progress": { "voice": "ryan", "engine": "piper" }
    },
    "vi": {
      "summary": { "voice": "Vinh", "engine": "vieneu" },
      "acknowledgment": { "voice": "Vinh", "engine": "vieneu" },
      "progress": { "voice": "Vinh", "engine": "vieneu" }
    }
  },
  "multilingual": {
    "enabled": true,
    "autoDetect": true,
    "preferredLanguage": "en"
  }
}
```

## Testing Your Configuration

After updating `voice-config.json`:

```bash
# Test summary voice (auto-speak)
# Just run Claude Code - it will speak the summary after each response

# Test acknowledgment voice (immediate)
ralph speak --test-acknowledgment

# Test progress voice
ralph speak --test-progress

# Manually test a specific usage type
ralph speak "Test message" --usage-type=summary
```

## Troubleshooting

**Voice not changing:**
- Check that `usageVoices.{lang}.{type}` structure matches exactly
- Verify voice name is valid for the TTS engine (case-sensitive)
- Check logs: `tail -f .ralph/auto-speak-hook.log`

**Wrong engine being used:**
- Ensure `engine` field is set in each usage type
- Check that the engine is installed (`piper`, `vieneu`, `macos`)
- Verify language detection is working (logs show detected lang)

**Fallback to wrong voice:**
- If `usageVoices` is not found, it uses `ttsEngine` + `voice` fallback
- Make sure language code matches detected language ("en" not "eng")

## Related Documentation

- [Voice Features Guide](VOICE.md) - Main voice documentation
- [Auto-Speak Guide](auto-speak-guide.md) - Auto-speak setup and usage
- [Voice Changelog](VOICE_CHANGELOG.md) - Feature history
