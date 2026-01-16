# Two-Stage Hybrid Intent Classification

The voice agent uses a **two-stage hybrid approach** that combines the speed of regex pattern matching with the accuracy and flexibility of LLM-based entity extraction.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  Stage 1: Quick Intent Detection (Regex)                    │
│  - Detect command TYPE: "open X" → app_control              │
│  - Fast, <1ms                                               │
└─────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────┐
│  Stage 2: Entity Extraction (LLM with JSON schema)          │
│  - Use qwen2.5:1.5b with structured output                  │
│  - Few-shot examples in prompt                              │
│  - ~200-300ms                                               │
└─────────────────────────────────────────────────────────────┘
```

## Why Hybrid?

### Problems with Full LLM Classification:
- **Slow**: ~400-500ms even with small models
- **Inconsistent**: Can misclassify simple commands
- **Resource-intensive**: Uses LLM tokens unnecessarily
- **Brittle**: JSON parsing can fail

### Problems with Pure Regex:
- **Limited**: Can't handle variations ("launch chrome" vs "open google chrome")
- **Maintenance nightmare**: Endless regex patterns for every variation
- **Fragile**: Breaks on natural language variations

### Hybrid Approach Benefits:
- **Fast**: Stage 1 is <1ms, total ~200-300ms (2x faster than full LLM)
- **Accurate**: LLM handles variations and normalization in Stage 2
- **Reliable**: Structured JSON output with schema validation
- **Maintainable**: Regex for intent type, LLM for entity extraction

## How It Works

### Stage 1: Intent Type Detection (IntentClassifier)

File: `ui/src/voice-agent/llm/intent-classifier.ts`

Regex patterns detect the **type** of command:

```typescript
detectIntentType(lowerText: string): VoiceActionType {
  // "open chrome" → app_control
  if (lowerText.match(/^(open|launch|start)\s+(.+)/)) {
    return "app_control";
  }

  // "npm test" → terminal
  if (lowerText.match(/^(run\s+)?npm\s+/)) {
    return "terminal";
  }

  // "ralph prd ..." → ralph_command
  if (lowerText.match(/^ralph\s+prd/)) {
    return "ralph_command";
  }

  // ... more patterns

  return "unknown"; // Fall back to full LLM
}
```

### Stage 2: Entity Extraction (EntityExtractor)

File: `ui/src/voice-agent/llm/entity-extractor.ts`

LLM extracts **entities** based on intent type:

```typescript
// For app_control commands:
Input: "open chrome"
Output: {
  "action": "open",
  "appName": "Google Chrome"
}

// For ralph_command:
Input: "ralph build 5 for PRD 3"
Output: {
  "ralphCommand": "build",
  "iterations": "5",
  "prdNumber": "3"
}
```

**Key features:**
- **Type-specific schemas**: Each intent type has its own JSON schema
- **Few-shot examples**: Prompts include 3-5 examples per type
- **Post-processing**: Normalizes app names (chrome → Google Chrome)
- **Validation**: Ensures required fields are present

## Usage

### Basic Classification

```typescript
import { IntentClassifier } from "./voice-agent";

const classifier = new IntentClassifier({
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:1.5b",
});

// Two-stage hybrid (recommended)
const result = await classifier.classifyHybrid("open chrome");

console.log(result.intent.action);    // "app_control"
console.log(result.intent.command);   // "open"
console.log(result.intent.target);    // "Google Chrome"
console.log(result.duration_ms);      // ~200-300ms
```

### Fallback for Unknown Intents

If Stage 1 returns `"unknown"`, the system falls back to full LLM classification:

```typescript
// Complex/ambiguous command
const result = await classifier.classifyHybrid(
  "check if the server is running and restart it if not"
);

// Falls back to full LLM classification
```

## Performance

### Benchmarks

| Approach | Avg Time | Use Case |
|----------|----------|----------|
| **Regex Only** | <1ms | Simple pattern matching, no variations |
| **Two-Stage Hybrid** | 200-300ms | **Recommended** - Fast + accurate |
| **Full LLM** | 400-500ms | Complex commands, ambiguous intent |

### Why qwen2.5:1.5b?

- **Small & fast**: 1.5B parameters, runs locally
- **Good JSON output**: Can achieve 84-90% accuracy on structured output
- **Low latency**: ~200-300ms on M1/M2 Macs
- **Resource efficient**: <2GB RAM

Alternative models to try:
- `nuextract` - Specialized extraction model (phi-3-mini based)
- `llama2:7b` - Larger, more accurate but slower

## Entity Extraction Schemas

### app_control

```json
{
  "action": "string (required) - open, quit, hide, minimize, activate, play, pause, stop",
  "appName": "string (required) - The application name to control"
}
```

Examples:
- "open chrome" → `{"action": "open", "appName": "Google Chrome"}`
- "close slack" → `{"action": "quit", "appName": "Slack"}`
- "play music" → `{"action": "play", "appName": "Music"}`

### terminal

```json
{
  "command": "string (required) - The exact shell command to execute"
}
```

Examples:
- "run npm test" → `{"command": "npm test"}`
- "list files" → `{"command": "ls -la"}`

### ralph_command

```json
{
  "ralphCommand": "string (required) - prd, plan, build, stream, factory",
  "prdNumber": "number (optional) - PRD number if specified",
  "iterations": "number (optional) - Number of build iterations",
  "description": "string (optional) - PRD description"
}
```

Examples:
- "create PRD for user auth" → `{"ralphCommand": "prd", "description": "user auth"}`
- "ralph build 5 for PRD 3" → `{"ralphCommand": "build", "iterations": "5", "prdNumber": "3"}`

### web_search

```json
{
  "query": "string (required) - The search query"
}
```

Examples:
- "search for react hooks" → `{"query": "react hooks"}`

### file_operation

```json
{
  "action": "string (required) - create, delete, move, copy, rename",
  "path": "string (required) - Source file/directory path",
  "extra": "object (optional) - Additional parameters like destination"
}
```

Examples:
- "create file index.ts" → `{"action": "create", "path": "index.ts"}`
- "move config.json to backup" → `{"action": "move", "path": "config.json", "extra": {"destination": "backup"}}`

## Testing

Run the test suite:

```bash
cd ralph-cli
node tests/voice-hybrid-classifier.mjs
```

This tests:
- ✅ Intent type detection (Stage 1)
- ✅ Entity extraction (Stage 2)
- ✅ Full pipeline (hybrid classification)
- ✅ Performance benchmarks

## Debugging

### Enable verbose logging

```typescript
const classifier = new IntentClassifier(config);

// Get raw LLM response for debugging
const result = await classifier.classifyHybrid("open chrome");
console.log(result.raw); // Raw JSON from Ollama
```

### Common issues

**Issue**: Entities not extracted correctly
- **Solution**: Check few-shot examples in `entity-extractor.ts`
- **Solution**: Try a larger model like `qwen2.5:3b`

**Issue**: Slow performance (>500ms)
- **Solution**: Ensure Ollama is running locally: `ollama serve`
- **Solution**: Pre-load model: `ollama run qwen2.5:1.5b`

**Issue**: JSON parsing errors
- **Solution**: Check `maxTokens` is sufficient (default: 150-300)
- **Solution**: Ensure `temperature: 0.1` for consistent output

## Research References

This implementation is based on research from:

1. **RAG-based classification**: Embed training examples, retrieve similar ones during inference
   - https://legacy-docs-oss.rasa.com/docs/rasa/next/llms/llm-intent/

2. **Hybrid LLM + NLU approach**: Combine traditional NLU with LLMs
   - https://medium.com/data-science-collective/intent-driven-natural-language-interface

3. **Structured output optimization**: Few-shot examples + JSON schema
   - https://agenta.ai/blog/the-guide-to-structured-outputs-and-function-calling-with-llms
   - https://docs.together.ai/docs/json-mode

4. **Specialized extraction models**:
   - NuExtract: https://ollama.com/library/nuextract
   - Universal NER: https://ollama.com/zeffmuks/universal-ner

## Future Improvements

Potential enhancements:

1. **Cache Stage 1 patterns**: Precompile regex for even faster detection
2. **Embeddings for intent matching**: Use semantic similarity instead of regex
3. **Try NuExtract model**: Specialized phi-3-mini for entity extraction
4. **Fine-tune qwen2.5**: Train on domain-specific voice commands
5. **Add confidence thresholds**: Fall back to LLM if Stage 2 confidence < 0.7
6. **Multi-command support**: Handle chained commands ("open chrome and go to google.com")
