# TTS Auto-Speak Hooks Status Report

**Date:** 2026-01-19
**Status:** ✅ All hooks configured and enabled

---

## Hook Configuration Overview

### Claude Code Hooks (`~/.claude/settings.local.json`)

```json
{
  "UserPromptSubmit": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "$CLAUDE_PROJECT_DIR/.agents/ralph/prompt-ack-hook.sh"
        }
      ]
    }
  ],
  "Stop": [
    {
      "hooks": [
        {
          "type": "command",
          "command": "$CLAUDE_PROJECT_DIR/.agents/ralph/auto-speak-hook.sh"
        }
      ]
    }
  ]
}
```

**Status:** ✅ Configured

---

## TTS Features Configuration (`.ralph/voice-config.json`)

### 1. Auto-Speak (Final Summary) ✅ ENABLED

**Purpose:** Speaks intelligent summary after Claude finishes responding

**Configuration:**
```json
{
  "autoSpeak": {
    "enabled": true,
    "maxWords": 20,
    "minWords": 5
  }
}
```

**Hook:** `Stop` → `auto-speak-hook.sh`

**Behavior:**
- Triggered when Claude finishes responding
- Summarizes response using Qwen LLM
- Speaks concise summary (15-20 words)
- Example: "Fixed cutoff issue by implementing smart symbol cleanup for ratios and percentages."

**Status:** ✅ Working (verified with Ollama running)

---

### 2. Acknowledgment (Prompt Confirmation) ✅ NOW ENABLED

**Purpose:** Speaks acknowledgment when you submit a prompt

**Configuration:**
```json
{
  "acknowledgment": {
    "enabled": true,
    "immediate": false,
    "immediatePhrase": "Got it",
    "immediatePhraseVi": "Được rồi"
  }
}
```

**Hook:** `UserPromptSubmit` → `prompt-ack-hook.sh`

**Behavior:**
- **immediate: false** → Waits for Claude's first text response, then speaks it
- **immediate: true** → Instantly speaks "Got it" when you submit prompt
- Starts transcript watcher to catch first response
- Example: "I'll check the TTS logs to see what's causing the cutoff."

**Status:** ✅ NOW ENABLED (was disabled due to missing config)

---

### 3. Progress Updates ✅ NOW ENABLED

**Purpose:** Speaks periodic status updates while Claude is working

**Configuration:**
```json
{
  "progress": {
    "enabled": true,
    "intervalSeconds": 30,
    "initialDelaySeconds": 5
  }
}
```

**Hook:** Started by `transcript-watcher.mjs` → `progress-timer.sh`

**Behavior:**
- Waits 5 seconds after prompt submission
- Then speaks every 30 seconds: "Still working", "Processing", "Almost there", "Working on it"
- Cycles through phrases
- Stops when Claude finishes responding
- Supports English and Vietnamese phrases

**Status:** ✅ NOW ENABLED (was disabled due to missing config)

---

## Complete TTS Flow

### Scenario: User submits "help me fix the bug"

**Timeline:**

1. **T+0s:** User submits prompt
   - `UserPromptSubmit` hook fires
   - `prompt-ack-hook.sh` executes
   - Starts `transcript-watcher.mjs`

2. **T+0.5s:** Claude starts thinking
   - Transcript watcher starts `progress-timer.sh`

3. **T+5s:** First progress update
   - TTS speaks: "Still working"

4. **T+35s:** Second progress update (if still processing)
   - TTS speaks: "Processing"

5. **T+65s:** Third progress update (if still processing)
   - TTS speaks: "Almost there"

6. **T+XYZ:** Claude finishes first text response
   - Transcript watcher catches it
   - TTS speaks acknowledgment: "I'll help you fix the bug."
   - Progress timer stops

7. **T+final:** Claude completes full response
   - `Stop` hook fires
   - `auto-speak-hook.sh` executes
   - TTS speaks summary: "Fixed authentication bug in config file. Updated settings and tested successfully."

---

## Testing the Configuration

### Test 1: Check Current Status

```bash
# Check if progress timer is configured
cat .ralph/voice-config.json | jq '{
  autoSpeak: .autoSpeak.enabled,
  acknowledgment: .acknowledgment.enabled,
  progress: .progress.enabled
}'

# Expected output:
# {
#   "autoSpeak": true,
#   "acknowledgment": true,
#   "progress": true
# }
```

### Test 2: Test Progress Timer Manually

```bash
# Start progress timer
.agents/ralph/progress-timer.sh start

# Wait 5 seconds - should hear "Still working"
# Wait 30 more seconds - should hear "Processing"

# Check status
.agents/ralph/progress-timer.sh status

# Stop timer
.agents/ralph/progress-timer.sh stop
```

### Test 3: Test Full Flow

1. Ask Claude a question that takes 10+ seconds to answer
2. Listen for:
   - **T+5s:** "Still working"
   - **T+35s:** "Processing" (if still working)
   - **End:** Summary of response

---

## Configuration Options

### Immediate Acknowledgment

Change `"immediate": false` to `"immediate": true` to hear instant "Got it" feedback:

```json
{
  "acknowledgment": {
    "enabled": true,
    "immediate": true
  }
}
```

**Trade-off:**
- ✅ Faster feedback (instant)
- ❌ Generic phrase instead of Claude's actual response

### Adjust Progress Interval

Change how often progress updates occur:

```json
{
  "progress": {
    "enabled": true,
    "intervalSeconds": 15,    // Speak every 15s (default: 30s)
    "initialDelaySeconds": 3  // First update after 3s (default: 5s)
  }
}
```

### Disable Progress Updates

If you find them annoying:

```json
{
  "progress": {
    "enabled": false
  }
}
```

---

## Troubleshooting

### No Acknowledgment or Progress Updates

**Check logs:**
```bash
tail -20 .ralph/prompt-ack-hook.log
tail -20 .ralph/progress-timer.log
```

**Common issues:**
1. **"Acknowledgment disabled, skipping"** → Fixed! (config now enabled)
2. **"No PID file found"** → Progress timer not starting (check config)
3. **"Progress updates disabled"** → Set `progress.enabled: true`

### Progress Timer Not Starting

```bash
# Check if transcript watcher is running
ps aux | grep transcript-watcher

# Check progress timer logs
tail -f .ralph/progress-timer.log

# Manually test progress timer
.agents/ralph/progress-timer.sh start
.agents/ralph/progress-timer.sh status
```

### Hooks Not Firing

```bash
# Verify hooks are configured
cat ~/.claude/settings.local.json | jq '.hooks'

# Check hook scripts exist and are executable
ls -la .agents/ralph/*hook*.sh
```

---

## Files Modified

- **`.ralph/voice-config.json`** - Added acknowledgment and progress configuration

---

## Summary

**Before:**
- ✅ Auto-speak (final summary) working
- ❌ Acknowledgment disabled (missing config)
- ❌ Progress updates disabled (missing config)

**After:**
- ✅ Auto-speak (final summary) working
- ✅ Acknowledgment enabled (now speaks first response or "Got it")
- ✅ Progress updates enabled (speaks every 30s while processing)

**All three TTS features are now active!** 🎉

Test it by asking Claude a question that takes 10+ seconds to process. You should hear:
1. Progress updates while waiting
2. Acknowledgment of first response
3. Final summary when complete
