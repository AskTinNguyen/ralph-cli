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

  // Map agent names to their binary names (usually the same)
  const binaryName = agent.toLowerCase().trim();

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

module.exports = {
  DEFAULT_CHAIN,
  parseChain,
  isAgentAvailable,
  getNextAgent,
  getAvailableAgents,
  getFirstAvailableAgent,
  validateChain,
};
