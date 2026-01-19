# TTS Cutoff Issue - Root Cause & Fix

**Date:** 2026-01-19
**Issue:** TTS getting cut off or sounding incorrect
**Status:** ✅ FIXED

---

## Root Cause

The aggressive symbol removal was breaking legitimate uses of `/` and `%`:

### Before Fix
```javascript
// Removed ALL symbols including / and %
result = result.replace(/[~\/\\|<>{}[\]@#$%^&*`+=_]/g, "");
```

**Problem Examples:**
- `"11/11 tests passed"` → `"1111 tests passed"` (TTS says "eleven hundred eleven")
- `"100% coverage"` → `"100 coverage"` (TTS says "one hundred coverage")
- `"3/5 modules"` → `"35 modules"` (TTS says "thirty-five modules")

### Impact on TTS
- **Ratios broken:** "11/11" became "1111" (confusing)
- **Percentages broken:** "100%" became "100" (loses meaning)
- **Fractions broken:** "1/2" became "12" (wrong number)
- User reported: "getting cut off" (actually broken output, not truncation)

---

## The Fix

### Smart Symbol Replacement

```javascript
// SMART SYMBOL REMOVAL
// First, protect ratios (11/11) and percentages (100%)
result = result.replace(/(\d+)\/(\d+)/g, "$1 out of $2");  // 11/11 → 11 out of 11
result = result.replace(/(\d+)%/g, "$1 percent");            // 100% → 100 percent

// Now remove problematic symbols that TTS reads literally
result = result.replace(/[~\/\\|<>{}[\]@#$%^&*`+=_]/g, "");
```

### How It Works

1. **First Pass:** Convert meaningful symbols to words
   - `11/11` → `"11 out of 11"`
   - `100%` → `"100 percent"`
   - `3/5` → `"3 out of 5"`

2. **Second Pass:** Remove remaining problematic symbols
   - File paths: `~/.config/auth.json` → `"on"`
   - Operators: `@#$*` → removed
   - Brackets: `[]{}<>` → removed

---

## Test Results

### Before Fix
```
"Test Results: 11/11 PASSING (100%)"
↓
"Test Results: 1111 PASSING (100)"
↓
TTS: "Test results eleven hundred eleven passing one hundred"
```

### After Fix
```
"Test Results: 11/11 PASSING (100%)"
↓
"Test Results: 11 out of 11 PASSING (100 percent)"
↓
TTS: "Test results eleven out of eleven passing one hundred percent"
```

---

## Comprehensive Test Coverage

Created `test-symbol-fix.mjs` with 5 test cases:

✅ **Ratios and percentages:** `11/11 tests passed (100%)`
✅ **Multiple instances:** `Coverage: 94% across 3/5 modules`
✅ **File paths preserved removal:** `~/.config/auth.json`
✅ **Large numbers:** `Score: 85/100 (85%)`
✅ **Path + abbreviation removal:** `API service at /api/v1/users`

**Result:** 5/5 tests passing

---

## Files Modified

1. **`.agents/ralph/summarize-for-tts.mjs`** - Smart symbol removal (line 550-558)
2. **`.agents/ralph/recap-for-tts.mjs`** - Smart symbol removal (line 727-735)
3. **`.agents/ralph/test-symbol-fix.mjs`** - Test suite for symbol handling

---

## Edge Cases Handled

| Input | Output | TTS Speaks |
|-------|--------|------------|
| `11/11` | `11 out of 11` | "eleven out of eleven" |
| `100%` | `100 percent` | "one hundred percent" |
| `3/5` | `3 out of 5` | "three out of five" |
| `85/100` | `85 out of 100` | "eighty-five out of one hundred" |
| `94%` | `94 percent` | "ninety-four percent" |
| `/api/v1/` | _(removed)_ | _(silent)_ |
| `~/.config/` | _(removed)_ | _(silent)_ |

---

## What Still Gets Removed

✅ **File paths:** `/usr/local/bin`, `~/.config/`, `./src/components/`
✅ **File extensions:** `.js`, `.json`, `.tsx`, `.md`
✅ **Tech abbreviations:** `API`, `CLI`, `TTS`, `JSON`, `JWT`, `HTML`, `CSS`
✅ **Symbols:** `~`, `\\`, `|`, `@`, `#`, `$`, `^`, `&`, `*`, `` ` ``, `=`, `+`, `_`
✅ **Emojis:** All Unicode emojis removed

---

## Recommendations for Users

### When to Use Each Mode

**Short (150 chars):**
- Quick status updates
- Simple confirmations
- Error messages
- Example: "Tests passing. Coverage 94 percent."

**Medium (600 chars):**
- Feature summaries with outcomes
- Multi-step explanations
- Example: "Feature complete. One, added login. Two, added logout. Three, tests pass. Coverage 94 percent across 3 out of 5 modules."

**Full (1200 chars):**
- Comprehensive recaps
- Detailed progress reports
- Complex implementations
- Example: Full breakdown with numbered outcomes, next steps, and metrics

---

## Verification

To verify the fix is working:

```bash
# Create test transcript
echo '{"type":"user","message":{"content":"Show results"}}
{"type":"assistant","message":{"content":"11/11 tests passed (100% coverage)"}}' > /tmp/test.jsonl

# Run summarization
node .agents/ralph/summarize-for-tts.mjs /tmp/test.jsonl

# Expected output:
# "11 out of 11 tests passed (100 percent coverage)"
```

---

## Conclusion

**✅ Issue Resolved**

The TTS "cutoff" was actually broken output from aggressive symbol removal. The fix:

1. ✅ Converts ratios to spoken form ("11 out of 11")
2. ✅ Converts percentages to spoken form ("100 percent")
3. ✅ Still removes file paths and technical symbols
4. ✅ Maintains clean, speakable output
5. ✅ All tests passing (5/5 symbol tests, 11/11 length tests)

**User impact:** TTS now speaks numbers correctly without confusing "1111" or losing context from missing percentages.
