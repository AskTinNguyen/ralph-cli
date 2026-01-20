# QMD Integration Proposal for Ralph CLI

## Executive Summary

[QMD (Quick Markdown Search)](https://github.com/tobi/qmd) is an on-device semantic search engine that combines BM25 full-text search, vector embeddings, and LLM re-ranking. Integrating QMD into Ralph CLI would enable **intelligent knowledge retrieval** across PRDs, plans, progress logs, guardrails, and learnings—helping agents make better decisions by learning from historical context.

## What is QMD?

QMD provides hybrid search over markdown collections:

| Feature | Description |
|---------|-------------|
| **BM25 Search** | Fast keyword matching via SQLite FTS5 |
| **Vector Search** | Semantic similarity using local embeddings (~300MB model) |
| **LLM Re-ranking** | Quality refinement using local Qwen model (~640MB) |
| **MCP Integration** | Native tools for Claude Desktop/Code |
| **100% Local** | No cloud dependencies, privacy-preserving |

**Search Modes:**
- `search` - Keyword-only (fastest)
- `vsearch` - Vector semantic-only
- `query` - Hybrid with expansion and re-ranking (highest quality)

---

## Integration Opportunities

### 1. Historical PRD Knowledge Base

**Problem:** Agents generate PRDs without awareness of past implementations.

**Solution:** Index all `.ralph/PRD-*/prd.md` files as a searchable collection.

**Benefits:**
- Find similar past features when generating new PRDs
- Maintain terminology and structure consistency
- Reuse proven acceptance criteria patterns
- Avoid re-solving solved problems

**Implementation:**
```bash
# Auto-index PRDs on ralph install
qmd collection add .ralph --glob "**/prd.md" --name ralph-prds
qmd context add qmd://ralph-prds "Product requirements documents for this project"
```

**Agent Usage:**
```javascript
// In PRD generation skill
const similarPRDs = await mcp__qmd__query({
  query: "user authentication with OAuth",
  collection: "ralph-prds",
  limit: 3
});
// Inject into prompt: "Reference these similar implementations..."
```

---

### 2. Guardrails & Learnings Retrieval

**Problem:** `guardrails.md` and `learnings.json` grow large; agents don't always find relevant lessons.

**Solution:** Semantic search over guardrails and factory learnings.

**Benefits:**
- Surface relevant warnings before agents make mistakes
- Retrieve contextual lessons from past failures
- Enable "just-in-time" guidance during builds

**Implementation:**
```bash
# Index guardrails
qmd collection add .ralph --glob "guardrails.md" --name guardrails
qmd context add qmd://guardrails "Project-wide rules, constraints, and lessons learned"

# Index factory learnings
qmd collection add .ralph/factory --glob "**/learnings.json" --name factory-learnings
```

**Build Loop Integration:**
```bash
# Before story execution in loop.sh
relevant_guardrails=$(qmd query -n 3 --json "implementing $STORY_TITLE")
# Inject into agent prompt
```

---

### 3. Progress & Error Pattern Search

**Problem:** Agents repeat mistakes; no way to search "how did we fix X before?"

**Solution:** Index all `progress.md` files and run logs.

**Benefits:**
- Find solutions to similar errors from past iterations
- Identify recurring failure patterns
- Enable "error resolution assistant" mode

**Implementation:**
```bash
# Index progress logs
qmd collection add .ralph --glob "**/progress.md" --name progress-logs
qmd collection add .ralph --glob "**/runs/*/output.log" --name run-logs
```

**Error Handling Enhancement:**
```javascript
// When build fails with error
const pastSolutions = await mcp__qmd__query({
  query: `error: ${errorMessage}`,
  collection: "progress-logs",
  limit: 5
});
// Show agent: "This error was previously resolved by..."
```

---

### 4. Plan Similarity & Pattern Reuse

**Problem:** Agents create plans from scratch each time, missing proven patterns.

**Solution:** Search similar plans when generating new ones.

**Benefits:**
- Reuse successful implementation patterns
- Consistent task breakdown across similar features
- Better effort estimation based on past work

**Agent Prompt Enhancement:**
```markdown
## Similar Past Plans
{{#each similarPlans}}
- **{{this.title}}**: {{this.taskCount}} tasks, {{this.outcome}}
{{/each}}
Consider these patterns when breaking down the current feature.
```

---

### 5. MCP Server Integration

**Problem:** Ralph agents lack semantic search capabilities.

**Solution:** Add QMD as an MCP server in `.mcp.json`.

**Implementation:**
```json
{
  "mcpServers": {
    "qmd": {
      "command": "qmd",
      "args": ["mcp"],
      "description": "Semantic search over project knowledge"
    }
  }
}
```

**Available MCP Tools:**
| Tool | Purpose |
|------|---------|
| `qmd_search` | Keyword search |
| `qmd_vsearch` | Vector semantic search |
| `qmd_query` | Hybrid search with re-ranking |
| `qmd_get` | Retrieve full document |
| `qmd_multi_get` | Batch document retrieval |
| `qmd_status` | Index health check |

---

### 6. TTS Summarization Enhancement

**Problem:** Current TTS uses basic Qwen summarization.

**Solution:** Use QMD's indexed context for better summaries.

**Benefits:**
- "What did we accomplish today?" queries
- Summarize progress across multiple PRDs
- Voice-driven status reports

**Example:**
```bash
# Voice command integration
ralph recap --query "what changed in authentication today"
# Uses QMD to find relevant progress entries, then summarizes
```

---

### 7. Factory Mode Context Injection

**Problem:** Factory stages lack awareness of past run history.

**Solution:** Query learnings before each stage execution.

**YAML Integration:**
```yaml
stages:
  - id: build_auth
    type: build
    context:
      # Auto-injected from QMD search
      relevant_learnings: "{{ qmd_query('authentication implementation') }}"
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Ralph CLI                                │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │   PRD    │  │   Plan   │  │  Build   │  │ Factory  │    │
│  │  Skill   │  │  Skill   │  │  Loop    │  │  Mode    │    │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│       │             │             │             │           │
│       └─────────────┴─────────────┴─────────────┘           │
│                          │                                   │
│                          ▼                                   │
│              ┌───────────────────────┐                      │
│              │    QMD MCP Server     │                      │
│              │  (Knowledge Retrieval) │                      │
│              └───────────┬───────────┘                      │
│                          │                                   │
│       ┌──────────────────┼──────────────────┐               │
│       ▼                  ▼                  ▼               │
│  ┌─────────┐       ┌──────────┐       ┌─────────┐          │
│  │  PRDs   │       │ Progress │       │Learnings│          │
│  │ Index   │       │  Index   │       │  Index  │          │
│  └─────────┘       └──────────┘       └─────────┘          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: Foundation (Core Integration)

1. **Add QMD dependency**
   - Optional dependency (graceful fallback if not installed)
   - Add to `ralph install` with opt-in prompt

2. **Create collection management**
   - `ralph knowledge init` - Initialize QMD collections
   - `ralph knowledge update` - Re-index after changes
   - `ralph knowledge search <query>` - CLI search interface

3. **MCP server configuration**
   - Add QMD to `.mcp.json` template
   - Auto-configure during `ralph install`

### Phase 2: Build Loop Integration

4. **Guardrails retrieval**
   - Query relevant guardrails before story execution
   - Inject into agent prompts

5. **Error pattern matching**
   - On build failure, search for similar past errors
   - Present solutions to agent

### Phase 3: PRD Enhancement

6. **Similar PRD discovery**
   - Search existing PRDs during generation
   - Add "Related Features" section

7. **Acceptance criteria suggestions**
   - Find proven criteria patterns
   - Offer as suggestions during PRD creation

### Phase 4: Advanced Features

8. **Voice-driven queries**
   - `ralph recap --query "..."` semantic search
   - Natural language status reports

9. **Factory context injection**
   - YAML syntax for QMD queries
   - Automatic learnings retrieval

---

## New Commands

| Command | Description |
|---------|-------------|
| `ralph knowledge init` | Initialize QMD collections for project |
| `ralph knowledge update` | Re-index all collections |
| `ralph knowledge search <query>` | Search across all collections |
| `ralph knowledge status` | Show index health and stats |
| `ralph knowledge add <path>` | Add custom collection |

---

## Configuration

Add to `.agents/ralph/config.sh`:

```bash
# QMD Integration
RALPH_QMD_ENABLED=true              # Enable/disable QMD features
RALPH_QMD_AUTO_INDEX=true           # Auto-update index on ralph build
RALPH_QMD_COLLECTIONS="prds,guardrails,progress,learnings"
RALPH_QMD_SEARCH_LIMIT=5            # Default result limit
RALPH_QMD_MIN_SCORE=0.3             # Minimum relevance score
```

---

## Dependencies

| Dependency | Size | Purpose |
|------------|------|---------|
| Bun | ~50MB | QMD runtime |
| qmd | ~5MB | Search engine |
| embedding-gemma-300M | ~300MB | Embeddings |
| qwen3-reranker-0.6b | ~640MB | Re-ranking |
| Qwen3-0.6B | ~640MB | Query expansion |

**Total:** ~1.6GB (models auto-downloaded on first use)

**Note:** Ralph already uses Qwen for TTS summarization, so some models may overlap.

---

## Compatibility

| Feature | Works With |
|---------|------------|
| macOS | ✅ Full support |
| Linux | ✅ Full support |
| Windows | ⚠️ Requires WSL2 |
| CI/CD | ✅ Headless mode |
| Codex Agent | ⚠️ MCP tools not available |
| Droid Agent | ⚠️ MCP tools not available |

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Large model downloads | Lazy loading, optional feature |
| Index staleness | Auto-update hooks, `--no-index` flag |
| Performance overhead | Async indexing, caching |
| Dependency conflicts | Isolated Bun runtime |

---

## Success Metrics

1. **PRD Quality**: Measure consistency score across PRDs
2. **Error Reduction**: Track repeat errors before/after
3. **Build Velocity**: Time to complete similar features
4. **Agent Efficiency**: Token usage with/without context retrieval

---

## Next Steps

1. [ ] Create `lib/knowledge/` module structure
2. [ ] Implement `ralph knowledge` command group
3. [ ] Add QMD MCP server to `.mcp.json` template
4. [ ] Update `ralph install` with QMD setup option
5. [ ] Integrate guardrails retrieval in `loop.sh`
6. [ ] Add PRD similarity search to PRD skill
7. [ ] Document in CLAUDE.md and agent-guide.html

---

## References

- [QMD GitHub Repository](https://github.com/tobi/qmd)
- [Ralph CLI Architecture](../guides/architecture.md)
- [MCP Integration Guide](../../.agents/ralph/MCP_TOOLS.md)
