# Handoff + Claude Agent SDK Integration Guide

This guide explains how to leverage the Claude Agent SDK with Ralph's handoff feature for seamless context transfer between AI agent sessions.

## Overview

Ralph's handoff system and the Claude Agent SDK serve complementary purposes:

| Feature | Ralph Handoffs | Claude Agent SDK |
|---------|----------------|------------------|
| **Context Transfer** | File-based JSON (persistent) | API-level (in-memory) |
| **Persistence** | Permanent disk storage | Session-only |
| **Sub-agents** | Bash processes | Native SDK subagents |
| **Auto-trigger** | Configurable threshold | At context limit |
| **Thread Mapping** | Visual graph support | Linear only |

**Best approach**: Use both together - Ralph for persistent state, SDK for execution.

## Integration Modes

### Mode 1: Ralph Handoffs + SDK Execution (Recommended)

Use Ralph to capture/restore state, SDK for agent execution:

```javascript
const { Agent } = require('@anthropic-ai/claude-agent-sdk');
const handoff = require('ralph-cli/lib/handoff');
const { generateSystemPromptFromHandoff } = require('ralph-cli/lib/handoff/sdk-integration');

async function executeWithHandoffContext(projectRoot, task) {
  // 1. Load latest handoff
  const result = handoff.loadLatestHandoff(projectRoot);

  // 2. Generate system prompt from handoff
  const systemPrompt = result.success
    ? generateSystemPromptFromHandoff(result.handoff)
    : 'You are a helpful coding assistant.';

  // 3. Create SDK agent with handoff context
  const agent = new Agent({
    model: 'claude-sonnet-4-5',
    systemPrompt,
    autoCompact: true
  });

  // 4. Monitor context and create handoff when needed
  agent.on('contextUpdate', async ({ percentUsed }) => {
    if (percentUsed >= 90) {
      const newHandoff = handoff.createNewHandoff(projectRoot, {
        summary: `Context at ${percentUsed}%, creating handoff`,
        reason: 'context_limit',
        parent_id: result.handoff?.id
      });
      console.log(`Handoff created: ${newHandoff.handoff.id}`);
    }
  });

  // 5. Execute task
  return agent.execute(task);
}
```

### Mode 2: SDK Subagents with Handoff State

Use SDK subagents for parallel work, Ralph for state persistence:

```javascript
const { Agent } = require('@anthropic-ai/claude-agent-sdk');
const handoff = require('ralph-cli/lib/handoff');

async function parallelExecutionWithHandoffs(projectRoot, tasks) {
  const agent = new Agent({
    model: 'claude-sonnet-4-5',
    allowSubagents: true
  });

  const results = [];

  for (const task of tasks) {
    // Create handoff before spawning subagent
    const preHandoff = handoff.createNewHandoff(projectRoot, {
      summary: `Starting: ${task.name}`,
      reason: 'checkpoint'
    });

    // Spawn subagent with isolated context
    const subagent = agent.spawnSubagent({
      systemPrompt: `Task: ${task.name}\n${task.instructions}`,
      tools: task.tools
    });

    // Execute in subagent
    const result = await subagent.execute(task.prompt);

    // Create completion handoff
    handoff.createNewHandoff(projectRoot, {
      summary: `Completed: ${task.name}`,
      reason: 'completion',
      parent_id: preHandoff.handoff.id,
      learnings: result.learnings || []
    });

    results.push(result);
  }

  return results;
}
```

### Mode 3: Auto-Handoff with SDK Hooks

Register hooks to automatically create handoffs:

```javascript
const { Agent } = require('@anthropic-ai/claude-agent-sdk');
const { sdkHooks, SDKHandoffExecutor } = require('ralph-cli/lib/handoff/sdk-integration');

async function executeWithAutoHandoff(projectRoot, handoffId, task) {
  // Initialize executor from existing handoff
  const executor = new SDKHandoffExecutor(projectRoot);
  const config = await executor.initFromHandoff(handoffId);

  // Create agent with hooks
  const agent = new Agent({
    ...config,
    hooks: {
      beforeTurn: async (ctx) => {
        const result = await sdkHooks.beforeTurn(ctx);
        if (result.shouldHandoff) {
          await executor.createHandoffAndContinue(
            `Auto-handoff at ${result.usagePercent.toFixed(1)}% context`
          );
        }
        return result;
      },
      afterComplete: sdkHooks.afterComplete,
      onError: sdkHooks.onError
    }
  });

  return agent.execute(task);
}
```

## CLI Integration

### Resume in SDK Mode

```bash
# Export handoff context for SDK consumption
ralph handoff export --format=sdk-prompt > /tmp/handoff-context.txt

# Use in your SDK script
cat /tmp/handoff-context.txt | node my-sdk-agent.js
```

### Create Handoff from SDK

```javascript
// In your SDK agent script
const handoff = require('ralph-cli/lib/handoff');

// After agent completes
handoff.createNewHandoff(process.cwd(), {
  summary: 'SDK agent session complete',
  reason: 'completion',
  metadata: {
    agent: 'sdk',
    model: 'claude-sonnet-4-5',
    tokens_used: tokenCount
  }
});
```

## Configuration

### Enable SDK Integration

In `.agents/ralph/config.sh`:

```bash
# Enable SDK-based execution (requires @anthropic-ai/claude-agent-sdk)
RALPH_SDK_ENABLED=true

# SDK model preference
RALPH_SDK_MODEL=claude-sonnet-4-5

# Auto-handoff threshold (applies to both Ralph and SDK)
RALPH_AUTO_HANDOFF_THRESHOLD=90
```

### Per-Task Model Routing

```javascript
const { SDK_CONFIG } = require('ralph-cli/lib/handoff/sdk-integration');

// Override model selection
SDK_CONFIG.models = {
  low: 'claude-haiku-4-5',      // Simple tasks
  medium: 'claude-sonnet-4-5',  // Standard tasks
  high: 'claude-opus-4-5'       // Complex architecture
};
```

## Best Practices

### 1. Handoff Granularity

Create handoffs at meaningful boundaries:
- **Good**: After completing a user story
- **Good**: Before starting a risky operation
- **Avoid**: Every few minutes (too noisy)

### 2. Context Preservation

Include critical context in handoffs:
```javascript
handoff.createNewHandoff(projectRoot, {
  summary: 'Meaningful description of progress',
  critical_files: ['src/auth.ts', 'tests/auth.test.ts'],
  learnings: [
    'Auth uses JWT with 24h expiry',
    'Tests require TEST_DB_URL env var'
  ]
});
```

### 3. Subagent Isolation

Use subagents for focused tasks to prevent context pollution:
```javascript
// Bad: Long task in main agent context
await agent.execute(longComplexTask);

// Good: Spawn subagent for focused work
const subagent = agent.spawnSubagent({
  systemPrompt: 'Focus on implementing the auth module only'
});
await subagent.execute(authTask);
```

### 4. Error Recovery

Create error handoffs for debugging:
```javascript
try {
  await agent.execute(task);
} catch (error) {
  handoff.createNewHandoff(projectRoot, {
    summary: `Error: ${error.message}`,
    reason: 'error',
    blockers: [{
      type: 'error',
      message: error.message,
      stack: error.stack
    }]
  });
  throw error;
}
```

## Workflow Example

Complete workflow using Ralph handoffs + SDK:

```bash
# 1. Start work, create initial handoff
ralph handoff create "Starting auth feature implementation"

# 2. Run SDK agent with handoff context
node scripts/sdk-agent.js --resume-from-handoff

# 3. When SDK reaches context limit, it creates handoff
#    Output: "Handoff created: handoff-1737494400000-abc123"

# 4. Continue in new session
ralph handoff resume handoff-1737494400000-abc123

# 5. View the work progression
ralph handoff map

# 6. Generate Mermaid diagram for documentation
ralph handoff map --mermaid > docs/handoff-flow.md
```

## Troubleshooting

### SDK Not Detecting Context Limits

Ensure you're using a model with context awareness:
```javascript
// These models support context token budget
const supportedModels = ['claude-sonnet-4-5', 'claude-haiku-4-5'];
```

### Handoffs Not Persisting

Check write permissions:
```bash
ls -la .ralph/handoffs/
```

### Subagent Not Receiving Context

Verify system prompt generation:
```javascript
const prompt = generateSystemPromptFromHandoff(handoff);
console.log(prompt); // Debug output
```

## API Reference

### `SDKHandoffExecutor`

```javascript
const executor = new SDKHandoffExecutor(projectRoot, options);

// Initialize from handoff
await executor.initFromHandoff(handoffId);

// Check if handoff needed
executor.shouldTriggerHandoff(contextUsagePercent);

// Create continuation handoff
const { handoff, subagentConfig } = await executor.createHandoffAndContinue(summary);
```

### `generateSystemPromptFromHandoff(handoff)`

Converts a Ralph handoff to an SDK-compatible system prompt.

### `createAgentConfigFromHandoff(handoff, options)`

Creates full SDK agent configuration from handoff with model routing.

### `sdkHooks`

Pre-built hooks for automatic handoff management:
- `beforeTurn` - Check context, trigger handoff
- `afterComplete` - Create completion handoff
- `onError` - Create error recovery handoff
