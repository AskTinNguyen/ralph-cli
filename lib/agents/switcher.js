/**
 * Agent Fallback Chain Switcher Module
 *
 * Provides utilities for managing agent fallback chains, checking agent availability,
 * and determining the next agent to try when failures occur.
 */

const { execSync } = require('child_process');

/**
 * Default agent fallback chain order
 * @constant {string[]}
 */
const DEFAULT_CHAIN = ['claude', 'codex', 'droid'];

/**
 * Test mode configuration - allows mocking agent availability for tests
 * @private
 */
let _testMode = {
  enabled: false,
  availableAgents: [],
};

/**
 * Enable test mode with mock available agents
 * @param {string[]} agents - Agents to consider available during tests
 */
function enableTestMode(agents) {
  _testMode.enabled = true;
  _testMode.availableAgents = agents || [];
}

/**
 * Disable test mode
 */
function disableTestMode() {
  _testMode.enabled = false;
  _testMode.availableAgents = [];
}

/**
 * Parse a space-separated chain string into an array
 * @param {string} chainStr - Space-separated agent names (e.g., "claude codex droid")
 * @returns {string[]} Array of agent names
 */
function parseChain(chainStr) {
  if (!chainStr || typeof chainStr !== 'string') {
    return [...DEFAULT_CHAIN];
  }
  const parsed = chainStr.trim().split(/\s+/).filter(Boolean);
  return parsed.length > 0 ? parsed : [...DEFAULT_CHAIN];
}

/**
 * Check if an agent CLI is available in the system PATH
 * @param {string} agent - Agent name (e.g., 'claude', 'codex', 'droid')
 * @returns {boolean} True if the agent binary is available
 */
function isAgentAvailable(agent) {
  if (!agent || typeof agent !== 'string') {
    return false;
  }

  const binaryName = agent.toLowerCase().trim();

  // In test mode, check against mock available agents
  if (_testMode.enabled) {
    return _testMode.availableAgents.includes(binaryName);
  }

  try {
    // Use 'command -v' which is POSIX-compliant
    execSync(`command -v ${binaryName}`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the next available agent in the fallback chain
 * @param {string[]|string} chain - Array of agent names or space-separated string
 * @param {string} current - Current agent name
 * @returns {string|null} Next available agent name, or null if chain exhausted
 */
function getNextAgent(chain, current) {
  // Parse chain if it's a string
  const chainArray = Array.isArray(chain) ? chain : parseChain(chain);

  if (chainArray.length === 0) {
    return null;
  }

  // Find current position in chain
  const currentIndex = chainArray.indexOf(current);
  const startIndex = currentIndex >= 0 ? currentIndex : -1;

  // Try each agent in the chain starting from current position + 1
  for (let i = 1; i <= chainArray.length; i++) {
    const nextIndex = (startIndex + i) % chainArray.length;
    const candidate = chainArray[nextIndex];

    // Skip if we're back at the current agent
    if (candidate === current) {
      continue;
    }

    if (isAgentAvailable(candidate)) {
      return candidate;
    }
  }

  // Chain exhausted - no available agents found
  return null;
}

/**
 * Get all available agents from a chain
 * @param {string[]|string} chain - Array of agent names or space-separated string
 * @returns {string[]} Array of available agent names
 */
function getAvailableAgents(chain) {
  const chainArray = Array.isArray(chain) ? chain : parseChain(chain);
  return chainArray.filter(isAgentAvailable);
}

/**
 * Get the first available agent from a chain (for initialization)
 * @param {string[]|string} chain - Array of agent names or space-separated string
 * @returns {string|null} First available agent name, or null if none available
 */
function getFirstAvailableAgent(chain) {
  const chainArray = Array.isArray(chain) ? chain : parseChain(chain);

  for (const agent of chainArray) {
    if (isAgentAvailable(agent)) {
      return agent;
    }
  }

  return null;
}

/**
 * Validate a chain configuration
 * @param {string[]|string} chain - Array of agent names or space-separated string
 * @returns {{ valid: boolean, errors: string[], warnings: string[], available: string[] }}
 */
function validateChain(chain) {
  const chainArray = Array.isArray(chain) ? chain : parseChain(chain);
  const result = {
    valid: true,
    errors: [],
    warnings: [],
    available: [],
  };

  if (chainArray.length === 0) {
    result.valid = false;
    result.errors.push('Chain is empty');
    return result;
  }

  // Check for duplicates
  const seen = new Set();
  for (const agent of chainArray) {
    if (seen.has(agent)) {
      result.warnings.push(`Duplicate agent in chain: ${agent}`);
    }
    seen.add(agent);
  }

  // Check availability of each agent
  for (const agent of chainArray) {
    if (isAgentAvailable(agent)) {
      result.available.push(agent);
    } else {
      result.warnings.push(`Agent not available: ${agent}`);
    }
  }

  if (result.available.length === 0) {
    result.valid = false;
    result.errors.push('No agents in chain are available');
  }

  return result;
}

/**
 * Suggest optimal agent for a story based on historical metrics (US-004)
 * @param {string} storyId - Story ID (e.g., "US-001", "BUG-123")
 * @param {Object[]} metrics - Array of historical metric records
 * @param {string[]|string} chain - Fallback chain to filter suggestions
 * @returns {Object} Suggestion { agent, confidence, reason, alternatives }
 */
function suggestAgentForStory(storyId, metrics, chain) {
  const chainArray = Array.isArray(chain) ? chain : parseChain(chain);
  const availableAgents = getAvailableAgents(chainArray);

  // Default response when no data
  const defaultResponse = {
    agent: availableAgents[0] || chainArray[0] || 'claude',
    confidence: 0,
    reason: 'No historical data available',
    alternatives: availableAgents.slice(1).map(a => ({ agent: a, successRate: null })),
    dataPoints: 0,
  };

  if (!metrics || !Array.isArray(metrics) || metrics.length === 0) {
    return defaultResponse;
  }

  // Extract story type prefix (e.g., "US-", "BUG-", "FEAT-")
  const storyType = storyId.match(/^([A-Z]+-)/)?.[1] || 'OTHER';

  // Collect stats for each agent on this story type
  const agentStats = {};

  for (const m of metrics) {
    if (!m.storyId || !m.agent) continue;

    const mType = m.storyId.match(/^([A-Z]+-)/)?.[1] || 'OTHER';
    if (mType !== storyType) continue;

    const agent = m.agent;

    if (!agentStats[agent]) {
      agentStats[agent] = {
        total: 0,
        success: 0,
        error: 0,
        totalDuration: 0,
      };
    }

    agentStats[agent].total++;
    agentStats[agent].totalDuration += m.duration || 0;

    if (m.status === 'success') {
      agentStats[agent].success++;
    } else {
      agentStats[agent].error++;
    }
  }

  // No data for this story type
  if (Object.keys(agentStats).length === 0) {
    return defaultResponse;
  }

  // Calculate success rates and find best available agent
  let bestAgent = null;
  let bestRate = -1;
  let bestTotal = 0;
  const alternatives = [];

  for (const [agent, stats] of Object.entries(agentStats)) {
    const successRate = stats.total > 0 ? Math.round((stats.success / stats.total) * 100) : 0;
    const avgDuration = stats.total > 0 ? Math.round(stats.totalDuration / stats.total) : 0;

    alternatives.push({
      agent,
      successRate,
      total: stats.total,
      avgDuration,
      available: availableAgents.includes(agent),
    });

    // Only consider available agents for best choice
    if (availableAgents.includes(agent) && successRate > bestRate) {
      bestRate = successRate;
      bestAgent = agent;
      bestTotal = stats.total;
    }
  }

  // Sort alternatives by success rate descending
  alternatives.sort((a, b) => b.successRate - a.successRate);

  // Calculate confidence based on sample size
  const confidence = Math.min(100, bestTotal * 20); // 5 samples = 100% confidence

  // Build reason string
  let reason;
  if (bestAgent) {
    reason = `${bestAgent} has ${bestRate}% success rate on ${storyType} stories (${bestTotal} samples)`;
  } else {
    reason = `No available agent has data for ${storyType} stories`;
    return {
      ...defaultResponse,
      reason,
      alternatives,
      dataPoints: alternatives.reduce((sum, a) => sum + a.total, 0),
    };
  }

  return {
    agent: bestAgent,
    confidence,
    reason,
    alternatives: alternatives.filter(a => a.agent !== bestAgent),
    dataPoints: alternatives.reduce((sum, a) => sum + a.total, 0),
    storyType,
  };
}

/**
 * Reorder chain based on historical performance for a story type (US-004)
 * @param {string} storyId - Story ID to optimize for
 * @param {Object[]} metrics - Historical metrics
 * @param {string[]|string} originalChain - Original fallback chain
 * @returns {string[]} Reordered chain with best performers first
 */
function optimizeChainForStory(storyId, metrics, originalChain) {
  const chainArray = Array.isArray(originalChain) ? originalChain : parseChain(originalChain);
  const suggestion = suggestAgentForStory(storyId, metrics, chainArray);

  // Not enough data to optimize
  if (suggestion.confidence < 40) {
    return chainArray;
  }

  // Get all alternatives sorted by success rate
  const allAgents = [
    { agent: suggestion.agent, successRate: suggestion.confidence },
    ...suggestion.alternatives,
  ].filter(a => chainArray.includes(a.agent));

  // Sort by success rate descending
  allAgents.sort((a, b) => (b.successRate || 0) - (a.successRate || 0));

  // Build new chain: sorted agents first, then any remaining from original chain
  const optimizedChain = allAgents.map(a => a.agent);
  for (const agent of chainArray) {
    if (!optimizedChain.includes(agent)) {
      optimizedChain.push(agent);
    }
  }

  return optimizedChain;
}

module.exports = {
  DEFAULT_CHAIN,
  parseChain,
  isAgentAvailable,
  getNextAgent,
  getAvailableAgents,
  getFirstAvailableAgent,
  validateChain,
  // Story-based agent suggestions (US-004)
  suggestAgentForStory,
  optimizeChainForStory,
  // Test mode utilities
  enableTestMode,
  disableTestMode,
};
