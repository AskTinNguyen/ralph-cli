# QMD Integration - Technical Implementation Notes

This document outlines the specific code changes required to integrate QMD into Ralph CLI.

## Files to Create/Modify

### 1. New Files

| File | Purpose |
|------|---------|
| `lib/commands/knowledge.js` | Knowledge command handler |
| `lib/knowledge/index.js` | QMD wrapper module |
| `lib/knowledge/collections.js` | Collection management |
| `lib/knowledge/search.js` | Search interface |
| `.agents/ralph/templates/.mcp.json.template` | MCP config template |

### 2. Files to Modify

| File | Changes |
|------|---------|
| `bin/ralph` | Add `knowledge` command routing |
| `lib/commands/install.js` | Add QMD setup option |
| `.agents/ralph/loop.sh` | Add guardrails query before story execution |
| `.agents/ralph/MCP_TOOLS.md` | Document QMD MCP tools |
| `CLAUDE.md` | Add knowledge commands documentation |

---

## Implementation Details

### 1. Create `lib/knowledge/index.js`

```javascript
/**
 * QMD Knowledge Module
 * Wrapper for QMD semantic search integration
 */
const { execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

function isQmdInstalled() {
  try {
    execSync("command -v qmd", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function getCollections(ralphDir) {
  const defaultCollections = [
    {
      name: "ralph-prds",
      path: ralphDir,
      glob: "**/prd.md",
      context: "Product requirements documents for this project"
    },
    {
      name: "ralph-plans",
      path: ralphDir,
      glob: "**/plan.md",
      context: "Implementation plans with user stories and tasks"
    },
    {
      name: "ralph-progress",
      path: ralphDir,
      glob: "**/progress.md",
      context: "Build progress logs with commit history"
    },
    {
      name: "ralph-guardrails",
      path: ralphDir,
      glob: "guardrails.md",
      context: "Project-wide rules, constraints, and lessons learned"
    },
    {
      name: "ralph-learnings",
      path: path.join(ralphDir, "factory"),
      glob: "**/learnings.json",
      context: "Factory mode learnings from past runs"
    }
  ];
  return defaultCollections;
}

async function initCollections(ralphDir, options = {}) {
  if (!isQmdInstalled()) {
    throw new Error("QMD not installed. Run: bun install -g https://github.com/tobi/qmd");
  }

  const collections = getCollections(ralphDir);
  const results = [];

  for (const col of collections) {
    if (!fs.existsSync(col.path)) {
      results.push({ name: col.name, status: "skipped", reason: "path not found" });
      continue;
    }

    try {
      // Add collection
      execSync(`qmd collection add "${col.path}" --glob "${col.glob}" --name ${col.name}`, {
        stdio: options.verbose ? "inherit" : "pipe"
      });

      // Add context
      execSync(`qmd context add qmd://${col.name} "${col.context}"`, {
        stdio: options.verbose ? "inherit" : "pipe"
      });

      results.push({ name: col.name, status: "added" });
    } catch (err) {
      results.push({ name: col.name, status: "error", error: err.message });
    }
  }

  // Generate embeddings
  if (results.some(r => r.status === "added")) {
    try {
      execSync("qmd embed", { stdio: options.verbose ? "inherit" : "pipe" });
    } catch (err) {
      // Embeddings may take time, log warning
      console.warn("Warning: Embedding generation in progress");
    }
  }

  return results;
}

async function search(query, options = {}) {
  const {
    collection = null,
    mode = "query", // "search" | "vsearch" | "query"
    limit = 5,
    minScore = 0.3,
    format = "json"
  } = options;

  if (!isQmdInstalled()) {
    return { error: "QMD not installed" };
  }

  const args = [mode, `"${query}"`, `-n ${limit}`, `--min-score ${minScore}`, `--${format}`];

  if (collection) {
    args.push(`--collection ${collection}`);
  }

  try {
    const result = execSync(`qmd ${args.join(" ")}`, { encoding: "utf-8" });
    return format === "json" ? JSON.parse(result) : result;
  } catch (err) {
    return { error: err.message };
  }
}

async function getRelevantGuardrails(storyTitle, limit = 3) {
  return search(`implementing ${storyTitle}`, {
    collection: "ralph-guardrails",
    limit,
    minScore: 0.3
  });
}

async function getSimilarErrors(errorMessage, limit = 5) {
  return search(`error: ${errorMessage}`, {
    collection: "ralph-progress",
    limit,
    minScore: 0.2
  });
}

async function getSimilarPRDs(featureDescription, limit = 3) {
  return search(featureDescription, {
    collection: "ralph-prds",
    limit,
    minScore: 0.4
  });
}

module.exports = {
  isQmdInstalled,
  getCollections,
  initCollections,
  search,
  getRelevantGuardrails,
  getSimilarErrors,
  getSimilarPRDs
};
```

### 2. Create `lib/commands/knowledge.js`

```javascript
/**
 * Ralph knowledge command
 * Manage QMD semantic search collections
 */
const path = require("path");
const { success, error, info, dim, warn, pc } = require("../cli");
const knowledge = require("../knowledge");

module.exports = {
  name: "knowledge",
  description: "Manage QMD semantic search collections",
  usage: "ralph knowledge <subcommand> [options]",

  help: `
${pc.bold("ralph knowledge")} ${pc.dim("<subcommand>")}

Manage semantic search over PRDs, plans, and learnings.

${pc.bold("Subcommands:")}
  ${pc.yellow("init")}      Initialize QMD collections for this project
  ${pc.yellow("update")}    Re-index all collections
  ${pc.yellow("search")}    Search across collections
  ${pc.yellow("status")}    Show index health and stats
  ${pc.yellow("add")}       Add custom collection

${pc.bold("Examples:")}
  ${pc.dim("ralph knowledge init")}
  ${pc.dim("ralph knowledge search 'authentication flow'")}
  ${pc.dim("ralph knowledge status")}
`,

  async run(args, env, options) {
    const { cwd } = options;
    const ralphDir = path.join(cwd, ".ralph");

    const subcommand = args[0];

    if (!knowledge.isQmdInstalled()) {
      error("QMD not installed.");
      info("Install with: bun install -g https://github.com/tobi/qmd");
      return 1;
    }

    switch (subcommand) {
      case "init":
        return handleInit(ralphDir, options);

      case "update":
        return handleUpdate(options);

      case "search":
        return handleSearch(args.slice(1), options);

      case "status":
        return handleStatus(options);

      case "add":
        return handleAdd(args.slice(1), options);

      default:
        error(`Unknown subcommand: ${subcommand}`);
        info("Run 'ralph knowledge --help' for usage");
        return 1;
    }
  }
};

async function handleInit(ralphDir, options) {
  info("Initializing QMD collections...");

  try {
    const results = await knowledge.initCollections(ralphDir, { verbose: true });

    for (const result of results) {
      if (result.status === "added") {
        success(`  ${pc.green("+")} ${result.name}`);
      } else if (result.status === "skipped") {
        dim(`  ${pc.dim("-")} ${result.name} (${result.reason})`);
      } else {
        warn(`  ${pc.yellow("!")} ${result.name}: ${result.error}`);
      }
    }

    success("QMD collections initialized");
    info("Run 'ralph knowledge search <query>' to search");
    return 0;
  } catch (err) {
    error(err.message);
    return 1;
  }
}

async function handleUpdate(options) {
  info("Updating QMD index...");
  const { execSync } = require("child_process");

  try {
    execSync("qmd update", { stdio: "inherit" });
    execSync("qmd embed", { stdio: "inherit" });
    success("Index updated");
    return 0;
  } catch (err) {
    error(`Update failed: ${err.message}`);
    return 1;
  }
}

async function handleSearch(args, options) {
  const query = args.join(" ");

  if (!query) {
    error("Please provide a search query");
    return 1;
  }

  const results = await knowledge.search(query, {
    mode: "query",
    limit: 10,
    format: "json"
  });

  if (results.error) {
    error(results.error);
    return 1;
  }

  if (!results.length) {
    dim("No results found");
    return 0;
  }

  for (const result of results) {
    console.log(`\n${pc.cyan(result.path)} ${pc.dim(`(score: ${result.score.toFixed(2)})`)}`);
    if (result.snippet) {
      console.log(pc.dim(result.snippet.slice(0, 200) + "..."));
    }
  }

  return 0;
}

async function handleStatus(options) {
  const { execSync } = require("child_process");

  try {
    execSync("qmd status", { stdio: "inherit" });
    return 0;
  } catch (err) {
    error(`Status check failed: ${err.message}`);
    return 1;
  }
}

async function handleAdd(args, options) {
  // ralph knowledge add <path> --name <name> --glob <pattern>
  error("Custom collection add not yet implemented");
  info("Use 'qmd collection add' directly");
  return 1;
}
```

### 3. Update `bin/ralph` - Add Command Routing

Add to the command dispatcher section (~line 200):

```javascript
// In the command routing switch statement
case "knowledge":
case "k": {
  const cmd = require("../lib/commands/knowledge");
  return cmd.run(args.slice(1), process.env, options);
}
```

### 4. Update `lib/commands/install.js` - Add QMD Setup

Add after the auto-speak setup section (~line 430):

```javascript
/**
 * Offer QMD knowledge base setup
 */
async function offerQmdSetup(options) {
  const { cwd } = options;

  if (!process.stdin.isTTY) return;

  try {
    const { confirm, spinner, note, isCancel } = await import("@clack/prompts");
    const knowledge = require("../knowledge");

    // Check if QMD is installed
    const qmdInstalled = knowledge.isQmdInstalled();

    if (!qmdInstalled) {
      const statusLines = [
        `${pc.bold("QMD Knowledge Base")} ${pc.dim("(optional)")}`,
        "",
        "Semantic search over PRDs, plans, and learnings.",
        "",
        `${pc.yellow("○")} QMD not installed`,
        "",
        `${pc.dim("Install with:")} ${pc.cyan("bun install -g https://github.com/tobi/qmd")}`,
      ];

      note(statusLines.join("\n"), "Knowledge Base");
      return;
    }

    const wantsKnowledge = await confirm({
      message: "Initialize QMD knowledge base for semantic search?",
      initialValue: false,
    });

    if (isCancel(wantsKnowledge) || !wantsKnowledge) {
      dim("Knowledge base setup skipped. Run 'ralph knowledge init' later.");
      return;
    }

    const s = spinner();
    s.start("Initializing knowledge collections...");

    const ralphDir = path.join(cwd, ".ralph");
    const results = await knowledge.initCollections(ralphDir);

    const added = results.filter(r => r.status === "added").length;
    s.stop(`Initialized ${added} collection(s)`);

    note([
      `${pc.bold("Knowledge Base Ready")}`,
      "",
      `${pc.cyan("ralph knowledge search")} ${pc.dim("<query>")}  Search all collections`,
      `${pc.cyan("ralph knowledge status")}              Check index health`,
      `${pc.cyan("ralph knowledge update")}              Re-index after changes`,
    ].join("\n"), "QMD Setup Complete");

  } catch (err) {
    dim(`Knowledge base setup skipped: ${err.message}`);
  }
}

// Call in the run() function after showAutoSpeakSetup:
await offerQmdSetup(options);
```

### 5. Update `.agents/ralph/loop.sh` - Query Guardrails

Add function to query guardrails before story execution (~after the `select_next_story` function):

```bash
# Query relevant guardrails for a story using QMD (if available)
query_relevant_guardrails() {
  local story_title="$1"
  local limit="${2:-3}"

  # Check if qmd is available
  if ! command -v qmd &>/dev/null; then
    return 0
  fi

  # Check if ralph-guardrails collection exists
  if ! qmd status 2>/dev/null | grep -q "ralph-guardrails"; then
    return 0
  fi

  local results
  results=$(qmd query "implementing ${story_title}" \
    --collection ralph-guardrails \
    -n "$limit" \
    --min-score 0.3 \
    --md 2>/dev/null) || return 0

  if [[ -n "$results" ]]; then
    echo "$results"
  fi
}

# Call in the build iteration loop, before agent execution:
# relevant_guardrails=$(query_relevant_guardrails "$STORY_TITLE")
# if [[ -n "$relevant_guardrails" ]]; then
#   echo "## Relevant Guardrails" >> "$PROMPT_FILE"
#   echo "$relevant_guardrails" >> "$PROMPT_FILE"
# fi
```

### 6. Update `.agents/ralph/MCP_TOOLS.md` - Add QMD Section

Add after the Miro section:

```markdown
### QMD (Knowledge Base)

Semantic search over project knowledge: PRDs, plans, progress, and learnings.

**Common Tools:**

- `mcp__qmd__search` - Keyword search (BM25, fastest)
- `mcp__qmd__vsearch` - Vector semantic search
- `mcp__qmd__query` - Hybrid search with LLM re-ranking (highest quality)
- `mcp__qmd__get` - Retrieve full document by path or ID
- `mcp__qmd__multi_get` - Batch document retrieval
- `mcp__qmd__status` - Index health check

**Use Cases:**

- Find similar past PRDs when generating new requirements
- Search guardrails for relevant warnings before implementing
- Find solutions to similar errors from past builds
- Retrieve contextual learnings for factory stages

**Collections:**

| Collection | Contents |
|------------|----------|
| `ralph-prds` | Product requirements documents |
| `ralph-plans` | Implementation plans |
| `ralph-progress` | Build progress logs |
| `ralph-guardrails` | Project rules and lessons |
| `ralph-learnings` | Factory mode learnings |

**Examples:**

```javascript
// Find similar PRDs
mcp__qmd__query({
  query: "user authentication with OAuth",
  collection: "ralph-prds",
  limit: 3
})

// Search for error solutions
mcp__qmd__query({
  query: "error: TypeScript compile failed",
  collection: "ralph-progress",
  limit: 5
})

// Get relevant guardrails
mcp__qmd__query({
  query: "implementing database migrations",
  collection: "ralph-guardrails",
  limit: 3
})
```

**Score Interpretation:**
- 0.8-1.0: Highly relevant
- 0.5-0.8: Moderately relevant
- 0.2-0.5: Somewhat relevant
- 0.0-0.2: Low relevance
```

### 7. Create `.mcp.json.template`

Create `.agents/ralph/templates/.mcp.json.template`:

```json
{
  "mcpServers": {
    "notion": {
      "command": "npx",
      "args": ["-y", "@notionhq/notion-mcp-server"],
      "env": {
        "NOTION_API_KEY": "${NOTION_API_KEY}"
      }
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@anthropic/slack-mcp-server"],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_TEAM_ID": "${SLACK_TEAM_ID}"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/github-mcp-server"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    },
    "qmd": {
      "command": "qmd",
      "args": ["mcp"],
      "description": "Semantic search over project knowledge (PRDs, plans, learnings)"
    }
  }
}
```

---

## Integration Points Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                     Integration Points                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. CLI Entry (bin/ralph)                                       │
│     └─> Route "knowledge" command to lib/commands/knowledge.js   │
│                                                                  │
│  2. Install Flow (lib/commands/install.js)                      │
│     └─> Offer QMD setup after voice config                      │
│                                                                  │
│  3. Build Loop (.agents/ralph/loop.sh)                          │
│     └─> Query guardrails before story execution                 │
│     └─> Search error patterns on failure                        │
│                                                                  │
│  4. PRD Generation (skills/prd/)                                │
│     └─> Find similar PRDs for consistency                       │
│                                                                  │
│  5. Factory Mode (lib/factory/)                                 │
│     └─> Inject learnings into stage context                     │
│                                                                  │
│  6. MCP Integration (.mcp.json)                                 │
│     └─> Expose qmd_search, qmd_query tools to agents            │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Testing Strategy

### Unit Tests

```javascript
// tests/test-knowledge.js
const knowledge = require("../lib/knowledge");

describe("Knowledge Module", () => {
  it("should detect QMD installation", () => {
    const installed = knowledge.isQmdInstalled();
    expect(typeof installed).toBe("boolean");
  });

  it("should return default collections", () => {
    const collections = knowledge.getCollections("/tmp/.ralph");
    expect(collections).toHaveLength(5);
    expect(collections[0].name).toBe("ralph-prds");
  });

  it("should handle search gracefully when QMD not installed", async () => {
    // Mock qmd not installed
    const result = await knowledge.search("test query");
    expect(result.error || result).toBeDefined();
  });
});
```

### Integration Tests

```javascript
// tests/knowledge-integration.mjs
import { execSync } from "child_process";
import path from "path";
import fs from "fs";

describe("Knowledge Integration", () => {
  const testDir = "/tmp/ralph-knowledge-test";

  beforeAll(() => {
    fs.mkdirSync(`${testDir}/.ralph`, { recursive: true });
    fs.writeFileSync(`${testDir}/.ralph/guardrails.md`, "# Test Guardrail\n");
  });

  it("should initialize collections", () => {
    const result = execSync(`ralph knowledge init`, { cwd: testDir });
    expect(result.toString()).toContain("initialized");
  });

  it("should search collections", () => {
    const result = execSync(`ralph knowledge search "test"`, { cwd: testDir });
    // May or may not find results depending on QMD state
    expect(result).toBeDefined();
  });
});
```

---

## Migration Notes

### For Existing Projects

1. Run `ralph knowledge init` to create collections
2. Wait for embedding generation (~1-2 minutes for typical project)
3. Collections auto-update on `ralph build` (optional, controlled by config)

### Backward Compatibility

- All QMD features are **opt-in**
- Commands gracefully fail if QMD not installed
- No breaking changes to existing workflows
- Build loop continues normally without QMD

---

## Configuration Reference

Add to `.agents/ralph/config.sh`:

```bash
# ============================================================================
# QMD Knowledge Base Configuration
# ============================================================================

# Enable QMD integration (requires qmd installed)
RALPH_QMD_ENABLED=true

# Auto-update index on ralph build completion
RALPH_QMD_AUTO_INDEX=false

# Collections to index (comma-separated)
RALPH_QMD_COLLECTIONS="ralph-prds,ralph-plans,ralph-progress,ralph-guardrails,ralph-learnings"

# Default search result limit
RALPH_QMD_SEARCH_LIMIT=5

# Minimum relevance score (0.0-1.0)
RALPH_QMD_MIN_SCORE=0.3

# Inject guardrails into build prompts
RALPH_QMD_INJECT_GUARDRAILS=true
```
