/**
 * Claude Agent SDK Integration for Handoffs
 *
 * This module provides integration between Ralph's file-based handoff system
 * and the Claude Agent SDK's native capabilities.
 *
 * Two integration modes:
 * 1. SDK-Native: Use subagents for context isolation and handoffs
 * 2. Hybrid: Use Ralph handoffs + SDK for execution
 */

/**
 * SDK Integration Configuration
 */
const SDK_CONFIG = {
  // Enable SDK-native subagent handoffs
  useSubagents: false, // Set to true when SDK is available

  // Context threshold for auto-handoff (percentage)
  contextThreshold: 90,

  // Model preferences by task complexity
  models: {
    low: 'claude-haiku-4-5',
    medium: 'claude-sonnet-4-5',
    high: 'claude-sonnet-4-5' // Opus for most complex
  },

  // Subagent configuration
  subagent: {
    maxDepth: 1, // Subagents can't spawn subagents
    inheritTools: true,
    inheritPermissions: false // Each subagent gets explicit permissions
  }
};

/**
 * Generate a system prompt from a handoff for SDK agent
 * @param {Object} handoff - Ralph handoff object
 * @returns {string} System prompt for agent
 */
function generateSystemPromptFromHandoff(handoff) {
  const lines = [];

  lines.push('You are continuing work from a previous session.');
  lines.push('');
  lines.push('## Previous Session Context');
  lines.push('');

  if (handoff.summary) {
    lines.push(`**Summary:** ${handoff.summary}`);
    lines.push('');
  }

  if (handoff.prd_id) {
    lines.push(`**Working on:** PRD-${handoff.prd_id}`);
  }

  if (handoff.iteration) {
    lines.push(`**Iteration:** ${handoff.iteration}`);
  }

  if (handoff.story_id) {
    lines.push(`**Current Story:** ${handoff.story_id}`);
  }

  // Completed work
  if (handoff.state?.completed_stories?.length > 0) {
    lines.push('');
    lines.push('## Completed Work');
    for (const story of handoff.state.completed_stories) {
      if (typeof story === 'object') {
        lines.push(`- [x] ${story.id}: ${story.title || story.message || ''}`);
      } else {
        lines.push(`- [x] ${story}`);
      }
    }
  }

  // Remaining work
  if (handoff.remaining_work?.length > 0) {
    lines.push('');
    lines.push('## Remaining Work (Continue from here)');
    for (const item of handoff.remaining_work) {
      if (typeof item === 'object') {
        lines.push(`- [ ] ${item.id}: ${item.title || ''}`);
      } else {
        lines.push(`- [ ] ${item}`);
      }
    }
  }

  // Blockers
  if (handoff.blockers?.length > 0) {
    lines.push('');
    lines.push('## Blockers to Address');
    for (const blocker of handoff.blockers) {
      if (typeof blocker === 'object') {
        lines.push(`- ${blocker.message || JSON.stringify(blocker)}`);
      } else {
        lines.push(`- ${blocker}`);
      }
    }
  }

  // Critical files
  if (handoff.critical_files?.length > 0) {
    lines.push('');
    lines.push('## Key Files to Review');
    for (const file of handoff.critical_files.slice(0, 10)) {
      lines.push(`- \`${file}\``);
    }
  }

  // Learnings
  if (handoff.learnings?.length > 0) {
    lines.push('');
    lines.push('## Learnings from Previous Session');
    for (const learning of handoff.learnings.slice(0, 5)) {
      if (typeof learning === 'object') {
        lines.push(`- ${learning.content || learning.message || ''}`);
      } else {
        lines.push(`- ${learning}`);
      }
    }
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('Continue from where the previous session left off.');

  return lines.join('\n');
}

/**
 * Create SDK-compatible agent configuration from handoff
 * @param {Object} handoff - Ralph handoff object
 * @param {Object} options - Additional options
 * @returns {Object} SDK agent configuration
 */
function createAgentConfigFromHandoff(handoff, options = {}) {
  const complexity = options.complexity || 'medium';

  return {
    // Model selection based on task complexity
    model: SDK_CONFIG.models[complexity] || SDK_CONFIG.models.medium,

    // System prompt with handoff context
    systemPrompt: generateSystemPromptFromHandoff(handoff),

    // Context management
    autoCompact: true, // Enable automatic compaction
    contextTokenBudget: options.tokenBudget || undefined,

    // Subagent configuration
    allowSubagents: true,
    subagentConfig: {
      maxDepth: SDK_CONFIG.subagent.maxDepth,
      inheritTools: SDK_CONFIG.subagent.inheritTools
    },

    // Metadata for tracking
    metadata: {
      handoffId: handoff.id,
      parentHandoff: handoff.parent_id,
      prdId: handoff.prd_id,
      iteration: handoff.iteration
    }
  };
}

/**
 * SDK-based handoff executor
 * Executes a task using Claude Agent SDK with automatic handoff support
 */
class SDKHandoffExecutor {
  constructor(projectRoot, options = {}) {
    this.projectRoot = projectRoot;
    this.options = options;
    this.agent = null;
    this.currentHandoff = null;
    this.contextUsage = 0;
  }

  /**
   * Initialize from a handoff
   * @param {string|Object} handoff - Handoff ID or object
   */
  async initFromHandoff(handoff) {
    // Load handoff if string ID provided
    if (typeof handoff === 'string') {
      const handoffLib = require('./index');
      const result = handoffLib.loadHandoff(this.projectRoot, handoff);
      if (!result.success) {
        throw new Error(`Failed to load handoff: ${result.error}`);
      }
      this.currentHandoff = result.handoff;
    } else {
      this.currentHandoff = handoff;
    }

    // Create agent config
    const config = createAgentConfigFromHandoff(this.currentHandoff, this.options);

    // Note: Actual SDK initialization would go here
    // this.agent = new Agent(config);

    return config;
  }

  /**
   * Check if handoff should be triggered based on context usage
   * @param {number} currentUsage - Current context usage percentage
   * @returns {boolean}
   */
  shouldTriggerHandoff(currentUsage) {
    this.contextUsage = currentUsage;
    return currentUsage >= SDK_CONFIG.contextThreshold;
  }

  /**
   * Create a handoff and spawn continuation subagent
   * @param {string} summary - Handoff summary
   * @returns {Object} New handoff and subagent config
   */
  async createHandoffAndContinue(summary) {
    const handoffLib = require('./index');

    // Create new handoff linked to current
    const result = handoffLib.createNewHandoff(this.projectRoot, {
      summary,
      reason: 'context_limit',
      parent_id: this.currentHandoff?.id,
      prd_id: this.currentHandoff?.prd_id,
      iteration: this.currentHandoff?.iteration,
      metadata: {
        context_usage_percent: this.contextUsage,
        triggered_by: 'sdk_auto_handoff'
      }
    });

    if (!result.success) {
      throw new Error(`Failed to create handoff: ${result.error}`);
    }

    // Generate subagent config for continuation
    const subagentConfig = createAgentConfigFromHandoff(result.handoff, {
      complexity: this.options.complexity || 'medium'
    });

    return {
      handoff: result.handoff,
      subagentConfig,
      // Note: Actual subagent spawning would use SDK
      // subagent: this.agent.spawnSubagent(subagentConfig)
    };
  }

  /**
   * Extract current state for handoff
   * @returns {Object} Current execution state
   */
  extractCurrentState() {
    return {
      contextUsage: this.contextUsage,
      currentHandoff: this.currentHandoff,
      // Add SDK agent state extraction here when available
    };
  }
}

/**
 * Hooks for Claude Agent SDK integration
 * These can be registered with the SDK's hook system
 */
const sdkHooks = {
  /**
   * Called before each agent turn
   * Checks context usage and triggers handoff if needed
   */
  beforeTurn: async (context) => {
    const { agent, tokenUsage } = context;
    const usagePercent = (tokenUsage.used / tokenUsage.limit) * 100;

    if (usagePercent >= SDK_CONFIG.contextThreshold) {
      // Trigger handoff
      console.log(`Context at ${usagePercent.toFixed(1)}%, triggering handoff...`);

      // Signal to create handoff
      return {
        shouldHandoff: true,
        usagePercent
      };
    }

    return { shouldHandoff: false };
  },

  /**
   * Called after agent completes
   * Creates final handoff for session
   */
  afterComplete: async (context) => {
    const { result, tokenUsage } = context;

    // Create completion handoff
    return {
      createHandoff: true,
      reason: 'completion',
      summary: `Session complete: ${result.summary || 'Task finished'}`
    };
  },

  /**
   * Called on error
   * Creates error recovery handoff
   */
  onError: async (context) => {
    const { error, tokenUsage } = context;

    return {
      createHandoff: true,
      reason: 'error',
      summary: `Error recovery: ${error.message}`,
      blockers: [{ type: 'error', message: error.message }]
    };
  }
};

/**
 * Example usage with Claude Agent SDK (when available)
 *
 * ```javascript
 * const { Agent } = require('@anthropic-ai/claude-agent-sdk');
 * const sdkIntegration = require('./sdk-integration');
 *
 * // Create agent with handoff support
 * const executor = new sdkIntegration.SDKHandoffExecutor(projectRoot);
 * await executor.initFromHandoff('handoff-123456');
 *
 * // Register hooks
 * const agent = new Agent({
 *   ...executor.getConfig(),
 *   hooks: sdkIntegration.sdkHooks
 * });
 *
 * // Execute with automatic handoff
 * const result = await agent.execute(task);
 * ```
 */

module.exports = {
  SDK_CONFIG,
  generateSystemPromptFromHandoff,
  createAgentConfigFromHandoff,
  SDKHandoffExecutor,
  sdkHooks
};
