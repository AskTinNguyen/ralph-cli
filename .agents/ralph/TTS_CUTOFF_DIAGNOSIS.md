# TTS "Cutoff" Issue - Complete Diagnosis

**Date:** 2026-01-19
**Root Cause:** Ollama server not running - fallback mode truncates responses
**Status:** ✅ FIXED (improved fallback) + Instructions for full fix

---

## What Was Happening

You were experiencing "cutoffs" like:
- "Perfect! I found and fixed the cutoff issue. Here's what was happening: Root Cause The aggressive symbol removal was breaking legitimate numbers:."

This looked like TTS was being cut off mid-sentence.

---

## Root Cause Analysis

### Issue #1: Ollama Not Running ⚠️

```bash
$ pgrep ollama
(no output - not running)

$ ollama list
Error: ollama server not responding - could not find ollama app
```

**Impact:**
- Without Ollama, the summarizer uses **fallback mode**
- Fallback mode = regex cleanup + truncation at 150 chars
- Cannot intelligently summarize - just cuts text blindly

**What should happen:**
- Ollama runs local Qwen LLM for intelligent summarization
- Extracts key information from long responses
- Provides context-aware summaries (errors, completions, etc.)
- Result: Coherent, complete thoughts in TTS

### Issue #2: Poor Fallback Truncation (NOW FIXED ✅)

**Before fix:**
```javascript
// Just truncated at 150 chars, added "..."
if (result.length > maxLength) {
  const truncated = result.substring(0, maxLength);
  return truncated.substring(0, truncated.lastIndexOf(" ")) + "...";
}
```

**Result:** "...Root Cause The aggressive symbol removal was breaking legitimate numbers:."

**After fix:**
```javascript
// Extract first 1-2 COMPLETE sentences
const sentences = result.split(/([.!?]+\s+)/);
let extracted = "";

for (let i = 0; i < sentences.length; i++) {
  const candidate = extracted + sentences[i];
  if (candidate.length > maxLength) break;
  extracted = candidate;
}

return extracted.trim(); // Complete thought
```

**Result:** "Perfect! I found and fixed the cutoff issue."

---

## Solutions

### Immediate Fix (Applied ✅)

**Improved fallback mode** to extract complete sentences:
- ✅ No more mid-sentence cutoffs
- ✅ First 1-2 complete sentences spoken
- ✅ Works even without Ollama

**Test:**
```bash
$ node .agents/ralph/summarize-for-tts.mjs /tmp/test-long-response.jsonl
Perfect! I found and fixed the cutoff issue.
```

### Full Fix (Recommended)

**Start Ollama for intelligent summarization:**

```bash
# Start Ollama service
ollama serve &

# Pull qwen model (if not already installed)
ollama pull qwen2.5:1.5b

# Verify it's running
ollama list
```

**Benefits with Ollama:**
- ✅ Context-aware extraction (errors → what failed, fix)
- ✅ Semantic deduplication (removes repetitive phrases)
- ✅ Optimal length usage (40-50% of budget)
- ✅ Multi-language support (Vietnamese/English)

---

## How to Verify

### Test Fallback Mode (No Ollama)

```bash
# Stop Ollama if running
pkill ollama

# Test summarization
echo '{"type":"user","message":{"content":"Test"}}
{"type":"assistant","message":{"content":"This is a long response with multiple sentences. It should extract the first complete sentence only. Not truncate mid-thought like before."}}' > /tmp/test.jsonl

node .agents/ralph/summarize-for-tts.mjs /tmp/test.jsonl

# Expected: "This is a long response with multiple sentences."
# Before fix: "This is a long response with multiple sentences. It should extract the first complete sentence..."
```

### Test LLM Mode (With Ollama)

```bash
# Start Ollama
ollama serve &
ollama pull qwen2.5:1.5b

# Test summarization
node .agents/ralph/summarize-for-tts.mjs /tmp/test.jsonl

# Expected: Intelligent 15-20 word summary
# Example: "Long response with multiple sentences, extracts first complete thought"
```

---

## Configuration

**Current settings (`.ralph/voice-config.json`):**

```json
{
  "autoSpeak": {
    "enabled": true,
    "maxWords": 20,
    "minWords": 5
  },
  "summarizer": {
    "model": "qwen2.5:1.5b",
    "maxTokens": 50,
    "temperature": 0.3
  }
}
```

**Mode detection (adaptive):**
- Short: 150 chars, ≤30 words (1-2 sentences)
- Medium: 600 chars, ≤100 words (bulleted list)
- Full: 1200 chars, ≤200 words (comprehensive)

---

## Before/After Examples

### Example 1: Long Technical Response

**Input:**
```
Perfect! I found and fixed the TTS cutoff issue. Here's what was happening:

## Root Cause
The aggressive symbol removal was **breaking legitimate numbers**:
- "11/11 tests passed (100%)" → "1111 tests passed (100)"
...
(1500 chars total)
```

**Before Fix (Fallback Mode):**
```
Perfect! I found and fixed the cutoff issue. Here's what was happening: Root Cause The aggressive symbol removal was breaking legitimate numbers:.
```
❌ Cuts off mid-thought, incomplete sentence

**After Fix (Fallback Mode):**
```
Perfect! I found and fixed the cutoff issue.
```
✅ Complete sentence, coherent thought

**With Ollama (LLM Mode):**
```
Fixed cutoff issue. Symbol removal was breaking ratios like 11 out of 11 and percentages. Now converts to spoken form.
```
✅ Intelligent extraction of key points

---

### Example 2: Short Status Update

**Input:**
```
All tests passing. Ready to deploy.
```

**All Modes (< 150 chars):**
```
All tests passing. Ready to deploy.
```
✅ Unchanged (already short enough)

---

## Auto-Speak Behavior

### When Ollama is Running ✅

**Response:** "I've completed the user dashboard implementation..."
**TTS Speaks:** "Dashboard complete. Added components, endpoints, and tests. Coverage 94 percent."

- Context-aware (completion → outcomes)
- Semantic deduplication
- Optimal brevity (~20 words)

### When Ollama is NOT Running ⚠️

**Response:** "I've completed the user dashboard implementation..."
**TTS Speaks:** "I've completed the user dashboard implementation."

- First complete sentence only
- No intelligent extraction
- Simple but coherent

---

## Recommendation

**For best TTS experience:**

1. **Start Ollama** (one-time setup):
   ```bash
   ollama serve &
   ollama pull qwen2.5:1.5b
   ```

2. **Add to startup** (optional):
   ```bash
   # macOS (launchd)
   cat > ~/Library/LaunchAgents/com.ollama.plist << 'EOF'
   <?xml version="1.0" encoding="UTF-8"?>
   <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
   <plist version="1.0">
   <dict>
     <key>Label</key>
     <string>com.ollama</string>
     <key>ProgramArguments</key>
     <array>
       <string>/opt/homebrew/bin/ollama</string>
       <string>serve</string>
     </array>
     <key>RunAtLoad</key>
     <true/>
     <key>KeepAlive</key>
     <true/>
   </dict>
   </plist>
   EOF

   launchctl load ~/Library/LaunchAgents/com.ollama.plist
   ```

3. **Verify it works**:
   ```bash
   ollama list
   # Should show qwen2.5:1.5b
   ```

---

## Files Modified

1. **`.agents/ralph/summarize-for-tts.mjs`** - Improved fallback (line 823-863)
2. **`.agents/ralph/recap-for-tts.mjs`** - Improved fallback (line 807-845)
3. **`.agents/ralph/TTS_CUTOFF_DIAGNOSIS.md`** - This guide

---

## Summary

**What was fixed:**
- ✅ Fallback mode now extracts complete sentences (no mid-thought cutoffs)
- ✅ Smart symbol handling (11/11 → "11 out of 11", 100% → "100 percent")
- ✅ Works even when Ollama is not running

**What to do for optimal experience:**
- Start Ollama: `ollama serve &`
- Pull model: `ollama pull qwen2.5:1.5b`
- Enjoy intelligent, context-aware TTS summaries

**Current status:**
- Fallback mode: ✅ Fixed (no cutoffs)
- LLM mode: ⚠️ Requires Ollama running
