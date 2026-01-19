# Auto-Speak Implementation Summary

## Overview

Automatic text-to-speech for all Claude Code responses using:
- **Claude Code Stop Hook** - Fires when Claude finishes responding
- **Local Qwen 2.5:1.5b LLM** - Context-aware summarization via Ollama
- **OutputFilter** - Removes code blocks, tool calls, verbose logs
- **Context-Aware Summarization** - Considers user's question when generating summary
- **Ralph Speak** - TTS playback (piper, macOS say, or other provider)

## Architecture

```
Claude Code Response
        ↓
Stop Hook (.claude/settings.local.json)
        ↓
auto-speak-hook.sh
        ↓
summarize-for-tts.mjs
        ↓
Extract User Question + Assistant Response
        ↓
OutputFilter (remove code/logs)
        ↓
Context-Aware Qwen Summarization
(prompt includes user's original question)
        ↓
ralph speak
        ↓
TTS Audio Output
```

## Context-Aware Summarization

The key improvement is that the summarizer now knows what you asked:

| User Question | Response (verbose) | Summary (context-aware) |
|---------------|-------------------|------------------------|
| "How many tests passed?" | 47 tests, 4 suites, 3.2s... | "All 47 tests passed" |
| "Why is the build failing?" | TS2345 error, TS2304... | "TypeScript errors in api.ts and utils.ts" |
| "What files are in src?" | index.ts, config.ts... | "5 files including main entry and config" |

The prompt sent to Qwen includes:
```
The user asked: "{userQuestion}"
The AI responded with: {filteredResponse}
Create a brief spoken summary that directly answers the user's question.
```

## Files Created/Modified

### New Files
- `.agents/ralph/auto-speak-hook.sh` - Bash hook triggered by Claude Code Stop event
- `.agents/ralph/summarize-for-tts.mjs` - Node.js script using OutputFilter + TTSSummarizer
- `.agents/ralph/auto-speak-wrapper.sh` - Manual clipboard-based TTS helper
- `.agents/ralph/auto-speak-monitor.sh` - Background monitor (alternative approach)
- `AUTO-SPEAK-GUIDE.md` - User documentation

### Modified Files
- `.claude/settings.local.json` - Added Stop hook configuration
- `bin/ralph` - Added `speak` command to module list
- `lib/commands/speak.js` - Standalone TTS command
- `lib/commands/voice.js` - Voice input/output command (existing)

### Existing Voice-Agent Modules (Used)
- `ui/src/voice-agent/filter/output-filter.ts` - Verbose content removal
- `ui/src/voice-agent/filter/tts-summarizer.ts` - Qwen-based summarization
- `ui/src/voice-agent/filter/output-summarizer.ts` - Alternative summarizer
- `ui/dist/voice-agent/*` - Compiled JS modules

## How It Works

### 1. Hook Trigger
When Claude Code finishes a response, the Stop hook fires:

```json
{
  "hooks": {
    "Stop": [{
      "hooks": [{
        "type": "command",
        "command": "/Users/tinnguyen/ralph-cli/.agents/ralph/auto-speak-hook.sh"
      }]
    }]
  }
}
```

### 2. Extract & Summarize
`auto-speak-hook.sh` receives hook data (including transcript path), then calls:

```bash
node summarize-for-tts.mjs /path/to/transcript.json
```

### 3. Filter & Summarize with Qwen
The Node.js script:

1. **Extracts** last assistant message from transcript JSON
2. **Filters** using OutputFilter:
   - Removes code blocks (```)
   - Removes tool calls/markers
   - Removes markdown formatting
   - Removes URLs, file paths
   - Removes verbose logs (npm output, git status)
3. **Summarizes** using TTSSummarizer + Qwen:
   - Sends filtered text to Ollama (qwen2.5:1.5b)
   - Prompt: "Summarize this for spoken audio in 1-2 sentences"
   - Qwen generates natural conversational summary
   - Fallback to regex cleanup if Qwen fails

### 4. TTS Playback
Summary is piped to `ralph speak`:

```bash
echo "$summary" | ralph speak
```

## Example Transformations

### Example 1: Code Response
**Input (Claude's full response):**
```
Let me calculate that for you.

```javascript
function add(a, b) {
  return a + b;
}

console.log(add(2, 2));
```

The answer is **4**. This is a simple addition where we add 2 and 2 together.
```

**After OutputFilter:**
```
Let me calculate that for you.

The answer is 4. This is a simple addition where we add 2 and 2 together.
```

**After Qwen Summarization:**
```
The answer is 4.
```

**TTS speaks:** "The answer is four."

---

### Example 2: npm install
**Input (Claude's full response):**
```
I'll install the project dependencies using npm.

⏺ Running: npm install

added 847 packages, and audited 848 packages in 23s

285 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities

Successfully installed all dependencies! The project now has 847 packages installed.
```

**After OutputFilter:**
```
I'll install the project dependencies using npm.

added 847 packages, and audited 848 packages in 23s

285 packages are looking for funding

found 0 vulnerabilities

Successfully installed all dependencies! The project now has 847 packages installed.
```

**After Qwen Summarization:**
```
Running npm install... Installed 847 packages and funded 285 projects.
```

**TTS speaks:** "Running npm install... Installed eight hundred forty-seven packages and funded two hundred eighty-five projects."

## Configuration

### Enable/Disable
```bash
# Enable
ralph speak --auto-on

# Disable
ralph speak --auto-off

# Check status
ralph speak --auto-status
```

Config stored in `.ralph/voice-config.json`:
```json
{
  "autoSpeak": true
}
```

### Qwen Model Settings
Environment variables:
```bash
export OLLAMA_URL="http://localhost:11434"
export OLLAMA_MODEL="qwen2.5:1.5b"  # or qwen2.5:3b for better quality
```

Or edit `.agents/ralph/summarize-for-tts.mjs`:
```javascript
const summarizer = createTTSSummarizer({
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5:1.5b",
  maxTokens: 150,
  timeout: 8000,
  fallbackToRegex: true,
});
```

## Testing

### Test Hook Manually
```bash
# Create test transcript
cat > /tmp/test.json << 'EOF'
{
  "messages": [{
    "role": "assistant",
    "content": "The answer is 42."
  }]
}
EOF

# Test summarizer
node .agents/ralph/summarize-for-tts.mjs /tmp/test.json

# Should output: "The answer is 42."
```

### Test Qwen Directly
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "qwen2.5:1.5b",
  "prompt": "Summarize this for spoken audio in 1-2 sentences: The project has 847 packages installed.",
  "stream": false
}'
```

### Test TTS
```bash
echo "This is a test" | ralph speak
```

## Logs

Hook execution logged to `.ralph/auto-speak-hook.log`:

```bash
tail -f .ralph/auto-speak-hook.log
```

Example log output:
```
[2026-01-17 12:30:45] === Auto-speak hook triggered ===
[2026-01-17 12:30:45] Hook data received: {"transcript_path": "/Users/..."}...
[2026-01-17 12:30:45] Transcript path: /Users/tinnguyen/.claude/sessions/session_abc/transcript.json
[2026-01-17 12:30:45] Running Qwen-based summarization...
[2026-01-17 12:30:46] Summary generated: 52 characters
[2026-01-17 12:30:46] Summary preview: Running npm install... Installed 847 packages and funded...
[2026-01-17 12:30:46] TTS started (PID: 12345)
[2026-01-17 12:30:46] === Hook complete ===
```

## Requirements

- ✅ Claude Code CLI (authenticated)
- ✅ Ollama running locally with qwen2.5:1.5b model
- ✅ TTS provider (piper, macOS say, or other)
- ✅ jq (for JSON parsing in bash hook)
- ✅ Node.js (for summarizer script)
- ✅ ui/dist/voice-agent modules built

## Troubleshooting

See `AUTO-SPEAK-GUIDE.md` for detailed troubleshooting.

Quick checks:
```bash
# 1. Check auto-speak is enabled
ralph speak --auto-status

# 2. Check Ollama is running
ollama list | grep qwen

# 3. Check hook logs
tail .ralph/auto-speak-hook.log

# 4. Test TTS
echo "test" | ralph speak

# 5. Test summarizer manually
node .agents/ralph/summarize-for-tts.mjs /path/to/transcript.json
```

## Known Limitations

1. **Hook doesn't fire in same session**: Stop hook requires Claude Code restart to take effect
2. **Qwen latency**: Summarization adds ~1-2 seconds (acceptable trade-off for quality)
3. **Ollama required**: Falls back to regex if Ollama unavailable, but quality is lower
4. **No streaming**: Summary generated after full response (can't speak incrementally)

## Future Enhancements

- [ ] Streaming summarization (speak while Claude is typing)
- [ ] Voice interruption (Ctrl+C to stop speaking)
- [ ] Summary caching (avoid re-summarizing identical responses)
- [ ] User feedback loop (rate summaries, improve prompts)
- [ ] Multi-language support (detect language, speak in same language)
- [ ] Custom voices per response type (different voice for errors vs success)

## Credits

Built using existing voice-agent infrastructure:
- OutputFilter by @tinnguyen (commit 97a9314)
- TTSSummarizer by @tinnguyen (commit 7e96fd5)
- Voice command integration (commits 1914517, e5a3bd3, d6fe0e6, 5b07ad7)
