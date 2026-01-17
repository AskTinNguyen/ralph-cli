# Voice Summarization System Improvements (Future Enhancement)

**Status:** Recommendation for future upgrade
**Date:** 2026-01-17
**Scope:** User customization and robustness improvements for voice summarization

---

## Executive Summary

This document outlines a comprehensive enhancement plan for Ralph's voice summarization system, addressing two key areas:
1. **User Customization** - Three-tier verbosity system with context-aware defaults
2. **Robustness** - Four-tier fallback chain that guarantees speakable output

The proposed improvements maintain backward compatibility while providing flexible, fail-proof voice summarization.

---

## Overview

Enhance Ralph's voice summarization system with:
- **Three-tier verbosity system** (brief/standard/detailed)
- **Context-aware auto-detection** (build progress, errors, simple answers, etc.)
- **Four-tier fallback chain** (primary LLM → fallback LLM → regex → smart truncate)
- **Performance safeguards** (caching, async processing, aggressive timeouts)

## Current System Analysis

### Three Existing Summarization Approaches

1. **TTSSummarizer** (`ui/src/voice-agent/filter/tts-summarizer.ts`)
   - Uses Ollama with Qwen 2.5:1.5b LLM
   - Fixed prompt: "under 2-3 sentences"
   - Single fallback: regex cleanup
   - 5s timeout, maxTokens: 150

2. **OutputSummarizer** (`ui/src/voice-agent/filter/output-summarizer.ts`)
   - Length-threshold based (500 chars)
   - Simpler prompt: "1-2 sentences"
   - 10s timeout, maxTokens: 100

3. **Context-Aware** (`.agents/ralph/summarize-for-tts.mjs`)
   - Most sophisticated - considers user's original question
   - Used by auto-speak hook
   - Pipeline: Filter → LLM → Cleanup → TTS

### Current Limitations

- ❌ **One-size-fits-all** - No verbosity control
- ❌ **Hard-coded prompts** - No per-context customization
- ❌ **Weak error recovery** - Only regex fallback
- ❌ **No caching** - Re-summarizes identical content
- ❌ **Fixed thresholds** - maxLength=500 hardcoded in multiple places

---

## Proposed Design

### 1. Three-Tier Verbosity System

| Level | Target | Content | Use Case |
|-------|--------|---------|----------|
| **Brief** | 1 sentence (15-25 words) | Critical info only | Status checks, simple answers |
| **Standard** | 2-3 sentences (25-50 words) | Key info + context | Default mode, balanced detail |
| **Detailed** | 3-5 sentences (50-100 words) | Full info + nuance | Errors, complex tasks |

#### Verbosity-Specific Prompts

**Brief Mode:**
```
You are a TTS summarizer. Extract ONLY the most critical information in ONE sentence.

Rules:
- Maximum 25 words
- Answer the question directly - no preamble
- Remove ALL code, markdown, file paths
- If it's a number/yes/no, just say it

User asked: {question}
AI response: {response}

One-sentence summary:
```

**Standard Mode (Default):**
```
You are a TTS summarizer. Summarize in 2-3 natural sentences.

Rules:
- 25-50 words total
- Focus on answering the user's question
- Include key context but be concise
- Remove ALL code, markdown, file paths

User asked: {question}
AI response: {response}

Spoken summary (2-3 sentences):
```

**Detailed Mode:**
```
You are a TTS summarizer. Provide a thorough spoken explanation.

Rules:
- 50-100 words (3-5 sentences)
- Answer the question with full context
- Include important details and nuance
- Remove code blocks but mention their purpose

User asked: {question}
AI response: {response}

Detailed spoken summary (3-5 sentences):
```

#### Context-Aware Auto-Detection

Automatically detect context and apply appropriate verbosity:

```typescript
function detectContext(userQuestion: string, response: string): SummarizationContext {
  const lower = response.toLowerCase();

  // Build progress (brief)
  if (lower.includes("iteration") || lower.includes("building")) {
    return "buildProgress";
  }

  // Errors (detailed)
  if (lower.includes("error") || lower.includes("failed")) {
    return "buildError";
  }

  // Simple answer (brief)
  if (response.length < 100 && lower.match(/^(yes|no|true|false|\d+)/i)) {
    return "simpleAnswer";
  }

  // Complex answer (detailed)
  if (lower.includes("because") || lower.includes("architecture")) {
    return "complexAnswer";
  }

  return "general";
}
```

**Example Mappings:**
- `buildProgress` → **brief** ("Working on story US-003")
- `buildComplete` → **standard** ("Build complete. 5 stories done.")
- `buildError` → **detailed** ("Build failed due to TypeScript errors in api.ts line 42...")
- `simpleAnswer` → **brief** ("47 tests passed")
- `complexAnswer` → **detailed** ("The architecture uses microservices because...")

### 2. Four-Tier Fallback Chain

Guarantees speakable output even when LLM services fail:

```
Input Text (any length/format)
    ↓
┌─────────────────────────────────────────┐
│ TIER 1: Primary LLM (Qwen 2.5:1.5b)    │
│ - Timeout: 10s                          │
│ - Context-aware prompt                  │
│ - Verbosity-specific                    │
└─────────────────────────────────────────┘
    ↓ (network error, timeout)
┌─────────────────────────────────────────┐
│ TIER 2: Fallback LLM (Qwen 0.5b/Tiny)  │
│ - Timeout: 5s                           │
│ - Simpler model, faster                 │
│ - Generic prompt                        │
└─────────────────────────────────────────┘
    ↓ (LLM unavailable)
┌─────────────────────────────────────────┐
│ TIER 3: Regex-Based Cleanup             │
│ - Remove code blocks                    │
│ - Remove markdown                       │
│ - Extract key sentences                 │
│ - Instant (no network)                  │
└─────────────────────────────────────────┘
    ↓ (still too long)
┌─────────────────────────────────────────┐
│ TIER 4: Smart Truncate (GUARANTEED)    │
│ - Sentence boundary if possible         │
│ - Word boundary if no sentence          │
│ - Hard cutoff as last resort            │
│ - NEVER FAILS                           │
└─────────────────────────────────────────┘
    ↓
Valid Speakable Text ✓
```

#### Validation at Each Tier

```typescript
function isValidSummary(text: string, verbosity: VerbosityLevel): boolean {
  const maxLength = { brief: 150, standard: 300, detailed: 500 }[verbosity];

  // Not empty
  if (!text || text.trim().length === 0) return false;

  // No code blocks
  if (text.includes("```")) return false;

  // No markdown artifacts
  if (/^#{1,6}\s/.test(text) || text.includes("[Tool:")) return false;

  // Reasonable length
  if (text.length < 5 || text.length > maxLength) return false;

  // No non-speakable syntax
  if (/[\[\]{}<>]/.test(text)) return false;

  return true;
}
```

### 3. Extended Configuration Schema

#### New `.ralph/voice-config.json` Structure

```json
{
  "provider": "piper",
  "voice": "alba",
  "rate": 200,
  "volume": 1,
  "enabled": true,
  "autoSpeak": true,
  "fallbackChain": ["piper", "macos", "system"],

  "summarization": {
    "enabled": true,

    "verbosity": {
      "level": "standard",
      "maxLength": {
        "brief": 25,
        "standard": 50,
        "detailed": 100
      },
      "includeCodePurpose": {
        "brief": false,
        "standard": false,
        "detailed": true
      },
      "includeFilePaths": {
        "brief": false,
        "standard": false,
        "detailed": true
      }
    },

    "contextOverrides": {
      "buildProgress": "brief",
      "buildComplete": "standard",
      "buildError": "detailed",
      "simpleAnswer": "brief",
      "complexAnswer": "detailed"
    },

    "llm": {
      "primary": {
        "url": "http://localhost:11434",
        "model": "qwen2.5:1.5b",
        "timeout": 10000
      },
      "fallback": {
        "url": "http://localhost:11434",
        "model": "qwen2.5:0.5b",
        "timeout": 5000,
        "enabled": true
      }
    },

    "filter": {
      "maxLength": 1000,
      "maxCodeLines": 0,
      "includeFilePaths": false,
      "includeStats": false
    },

    "performance": {
      "cacheEnabled": true,
      "cacheSize": 50,
      "cacheTTL": 900000,
      "asyncThreshold": 500
    }
  }
}
```

#### Auto-Migration Strategy

Existing configs without `summarization` section get auto-upgraded on first load:

```typescript
function migrateVoiceConfig(oldConfig: Partial<VoiceConfigSettings>): ExtendedVoiceConfig {
  const newConfig = { ...DEFAULT_VOICE_CONFIG, ...oldConfig };

  // Add summarization section if missing
  if (!newConfig.summarization) {
    newConfig.summarization = DEFAULT_SUMMARIZATION_CONFIG;
    console.log("[Voice Config] Adding summarization defaults...");
    saveVoiceConfig(newConfig);
  }

  return newConfig;
}
```

### 4. Performance Safeguards

#### Async Processing with Quick Fallback

```typescript
async summarizeWithTimeout(
  output: string,
  context: SummarizationContext,
  verbosity: VerbosityLevel
): Promise<string> {
  // Quick check - very short output
  if (output.length < 100 && !containsMarkdown(output)) {
    return output;
  }

  // Start regex cleanup immediately (backup plan)
  const quickResult = regexCleanup(output);

  // Race LLM against timeout
  try {
    const llmPromise = callPrimaryLLM(output, context, verbosity);
    const timeoutPromise = delay(10000).then(() => quickResult);

    const result = await Promise.race([llmPromise, timeoutPromise]);

    return isValidSummary(result, verbosity) ? result : quickResult;
  } catch (error) {
    console.warn("[Summarizer] LLM failed, using regex:", error.message);
    return quickResult;
  }
}
```

#### Simple LRU Cache

```typescript
class SummaryCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize = 50;
  private ttl = 15 * 60 * 1000; // 15 minutes

  getCacheKey(output: string, context: string, verbosity: string): string {
    const content = `${output.substring(0, 500)}|${context}|${verbosity}`;
    return hashString(content);
  }

  get(key: string): string | null {
    const entry = this.cache.get(key);
    if (!entry || Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return null;
    }
    return entry.summary;
  }

  set(key: string, summary: string): void {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { summary, timestamp: Date.now() });
  }
}
```

---

## Implementation Plan

### Phase 1: Core Infrastructure

**New Files to Create:**

1. **`ui/src/voice-agent/filter/verbosity-types.ts`**
   - Type definitions: `VerbosityLevel`, `SummarizationContext`, `SummarizationConfig`
   - Default config constants

2. **`ui/src/voice-agent/filter/prompt-manager.ts`**
   - Verbosity-specific prompt templates
   - Template rendering with variables

3. **`ui/src/voice-agent/filter/context-detector.ts`**
   - Auto-detect context from response
   - Helper functions: `isSimpleAnswer()`, `containsError()`, etc.

4. **`ui/src/voice-agent/filter/summary-cache.ts`**
   - Simple LRU cache implementation
   - Methods: `get()`, `set()`, `getCacheKey()`, `clear()`

5. **`ui/src/voice-agent/filter/robust-summarizer.ts`** ⭐ CRITICAL
   - Main summarizer with four-tier fallback
   - Core methods:
     - `summarize(output, context?, verbosity?)` → SummarizationResult
     - `tryPrimaryLLM()` → string
     - `tryFallbackLLM()` → string
     - `regexCleanup()` → string
     - `smartTruncate()` → string (GUARANTEED)
     - `isValidSummary()` → boolean

6. **`ui/src/voice-agent/filter/config-migrator.ts`**
   - Auto-migration for old configs
   - Functions: `migrateVoiceConfig()`, `loadConfigWithMigration()`

**Files to Modify:**

1. **`ui/src/voice-agent/tts/types.ts`**
   - Import: `SummarizationConfig`
   - Extend `VoiceConfigSettings` with `summarization?: SummarizationConfig`

2. **`ui/src/voice-agent/filter/tts-summarizer.ts`**
   - Add verbosity parameter: `summarize(output, context?, verbosity?)`
   - Integrate `RobustSummarizer` for fallback chain

3. **`ui/src/voice-agent/filter/output-filter.ts`**
   - Make `maxLength` configurable (not hard-coded 500)
   - Add verbosity-aware filtering methods

4. **`ui/src/voice-agent/tts/config-manager.ts`**
   - Add migration in `loadVoiceConfig()`
   - New methods: `getSummarizationConfig()`, `updateSummarizationConfig()`, `setVerbosity()`

### Phase 2: CLI & API Integration

**Files to Modify:**

1. **`lib/commands/speak.js`**
   - Add CLI flags:
     ```bash
     ralph speak --verbosity <level>        # Set verbosity
     ralph speak --verbosity-status          # Show current settings
     ralph speak --context <type>            # Override context
     ralph speak --summarization-config      # Show full config
     ```

2. **`ui/src/routes/voice.ts`**
   - New API routes:
     - `GET /voice/tts/summarization/config` - Get current config
     - `POST /voice/tts/summarization/config` - Update config
     - `POST /voice/tts/summarization/verbosity` - Set verbosity level
     - `GET /voice/tts/summarization/metrics` - Cache/performance metrics

### Phase 3: Auto-Speak Hook Integration

**Files to Modify:**

1. **`.agents/ralph/summarize-for-tts.mjs`** ⭐ CRITICAL
   - Load summarization config from `voice-config.json`
   - Auto-detect context from transcript
   - Apply context overrides
   - Use `RobustSummarizer` with proper verbosity

   ```javascript
   const voiceConfig = JSON.parse(fs.readFileSync(voiceConfigPath));
   const summaryConfig = voiceConfig.summarization || DEFAULT_CONFIG;

   const context = detectContext(userQuestion, responseText);
   const verbosity = summaryConfig.contextOverrides[context] ||
                     summaryConfig.verbosity.level;

   const summarizer = new RobustSummarizer(summaryConfig);
   const result = await summarizer.summarize(responseText, context, verbosity);
   console.log(result.text);
   ```

### Phase 4: Testing & Documentation

**New Test Files:**

1. **`tests/test-verbosity-summarizer.mjs`**
   - Test all three verbosity levels
   - Test context detection accuracy
   - Test fallback chain (mock Ollama failures)
   - Test cache hit/miss scenarios

2. **`tests/test-summarization-config.mjs`**
   - Test config migration
   - Test config persistence
   - Test API endpoints
   - Test validation

3. **`tests/e2e-voice-verbosity.mjs`**
   - E2E: Auto-speak with different verbosity levels
   - E2E: Build progress vs build error
   - E2E: Simple answer vs complex answer

**Documentation Updates:**

1. **`CLAUDE.md`** - Add "Voice Summarization Configuration" section
2. **`docs/VOICE_SUMMARIZATION.md`** - Create technical deep dive
3. **`ui/public/docs/agent-guide.html`** - Add voice customization

---

## Critical Files

**Must Modify (Priority Order):**

1. `/Users/tinnguyen/ralph-cli/ui/src/voice-agent/filter/robust-summarizer.ts` (NEW - core logic)
2. `/Users/tinnguyen/ralph-cli/ui/src/voice-agent/filter/verbosity-types.ts` (NEW - types)
3. `/Users/tinnguyen/ralph-cli/ui/src/voice-agent/tts/types.ts` (extend VoiceConfigSettings)
4. `/Users/tinnguyen/ralph-cli/.agents/ralph/summarize-for-tts.mjs` (integrate RobustSummarizer)
5. `/Users/tinnguyen/ralph-cli/ui/src/voice-agent/tts/config-manager.ts` (migration)
6. `/Users/tinnguyen/ralph-cli/ui/src/routes/voice.ts` (API routes)
7. `/Users/tinnguyen/ralph-cli/lib/commands/speak.js` (CLI flags)

---

## Verification & Testing

### Manual Testing Checklist

1. **Config Migration:**
   ```bash
   # Remove summarization section from voice-config.json
   ralph speak "test"
   # Verify: summarization section auto-added
   ```

2. **Verbosity Levels:**
   ```bash
   ralph speak --verbosity=brief "Long technical text with code blocks..."
   ralph speak --verbosity=standard "Long technical text with code blocks..."
   ralph speak --verbosity=detailed "Long technical text with code blocks..."
   # Verify: Output length increases brief → standard → detailed
   ```

3. **Context Detection:**
   ```bash
   # Create mock build log with error
   # Run auto-speak hook
   # Verify: Uses "detailed" verbosity automatically
   ```

4. **Fallback Chain:**
   ```bash
   killall ollama  # Stop Ollama
   ralph speak "test message"
   # Verify: Falls back to regex, still produces output
   ```

5. **API Endpoints:**
   ```bash
   curl http://localhost:3000/voice/tts/summarization/config
   curl -X POST http://localhost:3000/voice/tts/summarization/verbosity \
     -d '{"level": "detailed"}'
   curl http://localhost:3000/voice/tts/summarization/metrics
   ```

### Automated Tests

Run test suite:
```bash
npm test tests/test-verbosity-summarizer.mjs
npm test tests/test-summarization-config.mjs
npm test tests/e2e-voice-verbosity.mjs
```

**Expected Results:**
- ✅ All verbosity levels produce valid output
- ✅ Context detection accuracy > 90%
- ✅ Fallback chain works with Ollama down
- ✅ Config migration preserves settings
- ✅ API endpoints return expected responses

---

## Trade-offs & Design Decisions

### ✅ Chosen Approach

**Three verbosity levels:**
- Clear differentiation without overwhelming users
- Covers spectrum: terse → balanced → thorough

**Four-tier fallback:**
- Guarantees speakable output
- Never fails, even with all LLM services down

**Context auto-detection:**
- Reduces manual configuration burden
- Intelligent defaults based on response type

**Auto-migration:**
- Existing configs work unchanged
- Backward compatible

### ❌ Rejected Alternatives

**Custom user prompts:**
- Too complex for most users
- Easy to break with bad prompts
- Verbosity levels provide 90% of needed customization

**Five verbosity levels:**
- Decision paralysis
- Hard to distinguish between similar levels
- Three levels clearly differentiated

**ML context classifier:**
- Over-engineering
- Rule-based detection sufficient
- Avoids training data requirement

**Per-provider summarization:**
- Summarization is about content, not TTS provider
- No clear use case

### 🔮 Future Enhancements (Out of Scope)

**User feedback loop:**
- Let users rate summaries (thumbs up/down)
- Learn preferences over time
- Adjust verbosity automatically
- *Deferred: Requires analytics infrastructure, UI work*

**Multi-language summarization:**
- Summaries in user's native language
- *Deferred: Current Qwen model is English-focused*

**Per-story verbosity:**
- Different verbosity for each PRD story
- *Deferred: Over-granular, context detection handles this*

---

## Rollout Strategy

### Backward Compatibility

- Existing configs work unchanged
- Missing `summarization` section → auto-migrated
- Existing behavior preserved (standard verbosity default)
- No breaking changes to API or CLI

### Feature Flags

Master switch in config:
```json
{
  "summarization": {
    "enabled": true  // Can disable entire new system
  }
}
```

Graceful degradation:
- If `enabled = false` → use old TTSSummarizer
- If Ollama unavailable → regex fallback
- If config invalid → use defaults

### Observability

**Structured logging** (`.ralph/summarization.log`):
```json
{
  "timestamp": 1705512345678,
  "inputLength": 1250,
  "outputLength": 85,
  "verbosity": "standard",
  "context": "buildComplete",
  "method": "primary_llm",
  "duration": 1450,
  "cacheHit": false
}
```

**Metrics API:**
```typescript
// GET /voice/tts/summarization/metrics
{
  "totalRequests": 156,
  "cacheHits": 23,
  "llmSuccesses": 128,
  "llmFailures": 5,
  "averageDuration": 1250,
  "verbosityDistribution": {
    "brief": 45,
    "standard": 98,
    "detailed": 13
  }
}
```

---

## CLI Usage Examples

```bash
# Set verbosity
ralph speak --verbosity=brief
ralph speak --verbosity=standard
ralph speak --verbosity=detailed

# Check current settings
ralph speak --verbosity-status

# Override context detection
ralph speak --context=buildError "Error message"

# View summarization config
ralph speak --summarization-config

# Debug mode
export RALPH_DEBUG_VOICE=1
ralph speak "test message"

# Clear cache
ralph speak --clear-cache

# Test all verbosity levels side-by-side
ralph speak --test-verbosity "Sample text"
```

---

## Benefits Summary

**For Users:**
- 🎯 **Customizable verbosity** - Brief status checks, detailed error explanations
- 🛡️ **Fail-proof** - Always get speakable output, even if LLM is down
- 🚀 **Performance** - Caching avoids re-summarization, async processing prevents blocking
- 🤖 **Smart defaults** - Context-aware auto-detection reduces manual configuration

**For System:**
- ✅ **Backward compatible** - Existing configs work unchanged
- ✅ **Observable** - Metrics, logging, debug tools
- ✅ **Testable** - Unit, integration, E2E tests
- ✅ **Maintainable** - Clear separation of concerns, documented trade-offs

---

## Estimated Effort

- **Development:** 2-3 weeks (1 developer)
- **Testing:** 1 week (manual + automated)
- **Documentation:** 2-3 days

**Total:** ~4 weeks for complete implementation

---

**Questions or feedback?** See the main plan at `/Users/tinnguyen/.claude/plans/cheerful-purring-torvalds.md` for technical details.
