# Design: Historical Log Context for Ralph Iterations

> **Status**: Proposal
> **Author**: Claude Agent
> **Date**: 2026-01-19
> **Branch**: claude/ralph-loop-historical-logs-ymzNV

## Problem Statement

When Ralph runs multiple iterations to complete a PRD, each iteration starts with a **fresh context**. While this follows the "malloc/free" metaphor (preventing context pollution), it also means:

1. **Lost learnings**: Detailed debugging insights from previous iterations are not available
2. **Repeated mistakes**: Agents may try the same failed approaches
3. **Missing decision context**: Why certain approaches were chosen/abandoned is not captured
4. **Stuck in loops**: Without knowing what didn't work, agents get stuck on the same problems

As noted by [@airesearch12](https://x.com/airesearch12):
> "If Claude Code can effectively look back into logs containing the complete context of all past chat histories, it will stop getting stuck."

## Current Architecture

### Context Flow (Per Iteration)

```
┌─────────────────────────────────────────────────────────────────┐
│                    ITERATION N CONTEXT                          │
├─────────────────────────────────────────────────────────────────┤
│  PROMPT_build.md (template)                                     │
│    ├── PRD (prd.md) - Full requirements                         │
│    ├── Plan (plan.md) - Task breakdown                          │
│    ├── Progress (progress.md) - High-level summaries            │
│    ├── Guardrails (guardrails.md) - Lessons learned             │
│    ├── Errors Log (errors.log) - Repeated failures              │
│    ├── Activity Log (activity.log) - Action history             │
│    └── Story Block - Current story details                      │
└─────────────────────────────────────────────────────────────────┘
```

### What's Missing

```
┌─────────────────────────────────────────────────────────────────┐
│                    NOT IN CONTEXT                               │
├─────────────────────────────────────────────────────────────────┤
│  Historical Logs (runs/*.log)                                   │
│    ├── Detailed agent decision-making                           │
│    ├── Specific error messages and stack traces                 │
│    ├── Commands tried and their outputs                         │
│    ├── Files read/modified and why                              │
│    └── Approach reasoning ("I tried X because Y")               │
│                                                                 │
│  Run Summaries (runs/*.md)                                      │
│    ├── Token usage patterns                                     │
│    ├── Files changed per iteration                              │
│    ├── Retry statistics and patterns                            │
│    └── Context file selections                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Design Goals

1. **Optional**: Historical context should be opt-in to avoid overwhelming fresh starts
2. **Summarized**: Raw logs are too large; need intelligent summarization
3. **Relevant**: Only include logs relevant to the current story or similar failures
4. **Token-aware**: Stay within context budget constraints
5. **Actionable**: Extracted insights should be directly usable

## Proposed Architecture

### New Component: Historical Context Provider

```
┌─────────────────────────────────────────────────────────────────┐
│                 HISTORICAL CONTEXT PROVIDER                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐    │
│  │ Log Scanner │ -> │ Summarizer   │ -> │ Context Builder │    │
│  └─────────────┘    └──────────────┘    └─────────────────┘    │
│        │                   │                    │               │
│        v                   v                    v               │
│  - Parse *.log       - LLM summary       - Token counting      │
│  - Parse *.md        - Pattern extract   - Priority ranking    │
│  - Parse metrics.jsonl - Key decisions   - Format for prompt   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### New Files & Structure

```
.ralph/PRD-N/
├── runs/
│   ├── *.log                    # Raw agent output (existing)
│   ├── *.md                     # Run summaries (existing)
│   ├── metrics.jsonl            # Iteration metrics (existing)
│   └── history-index.json       # NEW: Searchable index
├── history/                     # NEW: Processed history
│   ├── decisions.jsonl          # Key decisions per iteration
│   ├── failures.jsonl           # Failure patterns with context
│   ├── approaches.jsonl         # Approaches tried per story
│   └── summary.md               # Human-readable summary
└── .history-config.json         # NEW: History access settings
```

### Configuration

#### `.history-config.json`
```json
{
  "enabled": true,
  "mode": "smart",           // "off" | "smart" | "full"
  "tokenBudget": 10000,      // Max tokens for historical context
  "lookback": 5,             // Max iterations to look back
  "includeFailures": true,   // Include failed iteration details
  "includeDecisions": true,  // Include decision reasoning
  "includeApproaches": true, // Include approaches tried
  "summarizeWith": "local",  // "local" (qwen) | "claude" | "none"
  "relevanceThreshold": 0.7  // Min relevance score (0-1)
}
```

#### CLI Flags
```bash
# Enable historical context for a build
ralph build 5 --with-history

# Disable historical context (override config)
ralph build 5 --no-history

# Full historical context (all iterations, no summarization)
ralph build 5 --history-mode=full

# Set lookback explicitly
ralph build 5 --history-lookback=3
```

## Implementation Details

### 1. Log Indexer (`lib/history/indexer.js`)

Parses raw logs and extracts structured data:

```javascript
interface IterationIndex {
  runId: string;
  iteration: number;
  storyId: string;
  status: 'success' | 'error' | 'timeout';

  // Extracted insights
  filesRead: string[];
  filesModified: string[];
  commandsRun: CommandResult[];
  errorsEncountered: ErrorEntry[];
  decisionsExplained: Decision[];
  approachesTried: Approach[];

  // Metadata
  duration: number;
  tokens: { input: number; output: number };
  model: string;
}

interface Decision {
  context: string;      // What triggered the decision
  choice: string;       // What was decided
  reasoning: string;    // Why (extracted from agent output)
  outcome: 'success' | 'failure' | 'partial';
}

interface Approach {
  storyId: string;
  description: string;  // What was tried
  files: string[];      // Files involved
  result: 'worked' | 'failed' | 'abandoned';
  failureReason?: string;
}
```

### 2. History Summarizer (`lib/history/summarizer.js`)

Uses local LLM (qwen2.5) to summarize logs into actionable insights:

```javascript
interface SummarizeOptions {
  iterations: IterationIndex[];
  currentStory: StoryMeta;
  tokenBudget: number;
}

interface HistorySummary {
  relevantFailures: string[];    // "Iteration 3: Route registration failed because..."
  approachesForStory: string[];  // "For US-005: Tried X (failed), Y (worked)"
  keyDecisions: string[];        // "Decided to use TypeScript for type safety"
  patternsDiscovered: string[];  // "All API routes need middleware registration"
  warnings: string[];            // "Avoid modifying loop.sh directly - causes cascade"
  tokenCount: number;
}
```

**Summarization Prompt:**
```markdown
Analyze these Ralph iteration logs and extract actionable insights for a new iteration.

Current story: {{STORY_ID}} - {{STORY_TITLE}}

Focus on:
1. Failed approaches for this or similar stories (what NOT to do)
2. Successful patterns that could apply
3. Key decisions with reasoning
4. Warnings and gotchas discovered

Keep total output under {{TOKEN_BUDGET}} tokens.

Logs:
{{ITERATION_LOGS}}
```

### 3. Context Builder (`lib/history/context-builder.js`)

Assembles historical context for the prompt:

```javascript
interface HistoryContext {
  // High-priority: failures for current story
  storyFailures: ApproachSummary[];

  // Medium-priority: patterns from successful iterations
  successPatterns: PatternSummary[];

  // Low-priority: general decisions and warnings
  generalInsights: string[];

  // Metadata
  iterationsScanned: number;
  totalTokens: number;
}
```

### 4. Prompt Template Changes

New template variable `{{HISTORICAL_CONTEXT}}`:

```markdown
# Build

## Paths
- PRD: {{PRD_PATH}}
- ...existing paths...

## Historical Context (Optional)

{{#if HISTORY_ENABLED}}
### Previous Iteration Insights

{{HISTORICAL_CONTEXT}}

**Important**: Use this context to avoid repeating failed approaches, but don't let it constrain creative solutions. If all previous approaches failed, try something fundamentally different.
{{/if}}

## Selected Story
...
```

### 5. Loop Integration (`loop.sh`)

```bash
# In loop.sh, before render_prompt()

if [ "${HISTORY_ENABLED:-false}" = "true" ]; then
  # Generate historical context
  HISTORY_CONTEXT_FILE="$TMP_DIR/history-context-$RUN_TAG-$i.md"

  node lib/history/cli.js generate \
    --prd="$prd_folder" \
    --story="$STORY_ID" \
    --iteration="$i" \
    --budget="${HISTORY_TOKEN_BUDGET:-10000}" \
    --lookback="${HISTORY_LOOKBACK:-5}" \
    --output="$HISTORY_CONTEXT_FILE"

  # Pass to render_prompt
  export HISTORICAL_CONTEXT_FILE
fi

render_prompt "$PROMPT_FILE" "$PROMPT_RENDERED" ...
```

## Modes of Operation

### Mode: `off` (Default)

No historical context is provided. Same as current behavior.
- Use when: Fresh start, unrelated stories, context budget is tight

### Mode: `smart` (Recommended)

Intelligent selection based on relevance:
- Includes failures for current story or similar stories
- Includes successful patterns from recent iterations
- Summarizes to fit token budget
- Use when: Building complex features, hitting recurring issues

### Mode: `full`

Complete historical context (token budget permitting):
- All iterations, minimal summarization
- Useful for debugging persistent issues
- Use when: Agent is stuck, need complete picture

## Data Flow

```
Iteration 1 (fresh start)
    │
    ├── Agent executes → output to run-XXX-iter-1.log
    ├── Log indexer → extracts decisions, failures, approaches
    └── Metrics recorded → metrics.jsonl

Iteration 2 (with history)
    │
    ├── History provider reads:
    │   ├── runs/run-XXX-iter-1.log
    │   ├── runs/run-XXX-iter-1.md
    │   └── history/decisions.jsonl
    │
    ├── Summarizer (qwen2.5):
    │   └── Creates focused summary for story US-002
    │
    ├── Context builder:
    │   └── Formats as {{HISTORICAL_CONTEXT}}
    │
    └── Agent executes with historical context
```

## Token Budget Management

Historical context competes with other context for the ~80k token budget:

| Component | Typical Tokens | Priority |
|-----------|---------------|----------|
| Story block | 500-2000 | Critical |
| Plan section | 1000-3000 | Critical |
| Progress log | 2000-8000 | High |
| Guardrails | 500-1500 | High |
| **Historical context** | **5000-10000** | Medium |
| Context files (auto) | 30000-50000 | Low |

**Strategy:**
1. Historical context has a configurable budget (default 10k tokens)
2. If budget exceeded, prioritize by relevance score
3. Summarize aggressively when necessary
4. Always leave room for critical components

## Privacy & Security Considerations

1. **No external transmission**: All summarization uses local LLM (qwen2.5)
2. **Sensitive data**: Logs may contain API keys - summarizer should redact
3. **Cross-PRD isolation**: History only from current PRD (no cross-contamination)

## Performance Impact

| Operation | Time | Frequency |
|-----------|------|-----------|
| Log indexing | 100-500ms | Per iteration (async) |
| Summarization | 2-5s | Per iteration (if enabled) |
| Context building | 50-100ms | Per iteration |

**Mitigation:**
- Index asynchronously after iteration completes
- Cache summaries for unchanged logs
- Pre-generate history on `ralph build` start

## Migration & Backwards Compatibility

- **Existing builds**: Work unchanged (history defaults to off)
- **Config file**: Auto-created on first `--with-history` use
- **Log format**: No changes to existing log format
- **Index files**: Regenerated on demand if missing

## Success Metrics

1. **Stuck reduction**: Measure iterations needed per story (before/after)
2. **Repeat failure rate**: Track same-error-twice occurrences
3. **Token efficiency**: Historical context tokens vs. value added
4. **User adoption**: Opt-in rate once feature is available

## Implementation Phases

### Phase 1: Foundation (MVP)
- [ ] Log indexer - extract basic structure from logs
- [ ] Simple text-based history summary (no LLM)
- [ ] `--with-history` CLI flag
- [ ] Basic {{HISTORICAL_CONTEXT}} template variable

### Phase 2: Smart Summarization
- [ ] Qwen-based summarization
- [ ] Relevance scoring by story similarity
- [ ] Token budget management
- [ ] Decision/approach extraction

### Phase 3: Advanced Features
- [ ] Cross-story pattern recognition
- [ ] Failure clustering (group similar failures)
- [ ] Auto-enable for stuck iterations (3+ failures)
- [ ] UI integration (history viewer)

## Example Output

### Generated Historical Context (Smart Mode)

```markdown
### Previous Iteration Insights (5 iterations scanned)

#### Failed Approaches for US-008 (Budget warnings)

**Iteration 7** (failed):
- Tried: Adding budget check in `loop.sh` main loop
- Failed because: `bc` command not available on all systems
- Files touched: `.agents/ralph/loop.sh`
- Lesson: Use Node.js for numeric calculations

**Iteration 8** (failed):
- Tried: Shell arithmetic with `$(( ))` for budget math
- Failed because: Floating point not supported in bash arithmetic
- Lesson: Budget values have decimals, need proper math library

#### Successful Patterns from Recent Iterations

**Iteration 5** (US-006 - similar UI feature):
- Pattern: API endpoint returns JSON, frontend polls via SSE
- Files: `ui/src/routes/api.ts`, `ui/public/dashboard.html`
- Reusable: SSE event streaming setup

#### Key Decisions

- Iteration 3: "Chose TypeScript for story selection to get type safety on complex JSON parsing"
- Iteration 6: "Used existing `lib/cost.sh` helpers rather than reimplementing"

#### Warnings

- `loop.sh` is 4000+ lines - avoid direct edits, use lib/ modules
- Token extraction from logs requires specific regex patterns
```

## Appendix: Related Work

### Similar Approaches

1. **Devin** - Maintains conversation memory across sessions
2. **AutoGPT** - Uses "memories" JSON file for persistent learning
3. **Langchain Memory** - Conversation summarization chains

### Key Difference

Ralph's approach is **file-based and stateless** - each iteration reads from files, writes to files. Historical context is just another file that can be read, not a hidden memory store.

## Open Questions

1. **Summary quality**: How to ensure LLM summaries are accurate and actionable?
2. **Relevance scoring**: What signals indicate one iteration is relevant to another?
3. **Failure patterns**: How to distinguish "wrong approach" from "implementation bug"?
4. **Contamination risk**: Could historical context bias agents away from valid approaches?

---

## Feedback Welcome

This design is a proposal. Key areas needing input:

1. Default mode - should history be opt-in or opt-out?
2. Token budget - is 10k tokens sufficient for meaningful history?
3. Summarization - local LLM vs. just structured extraction?
4. UI integration - should history be viewable/editable in Ralph UI?
