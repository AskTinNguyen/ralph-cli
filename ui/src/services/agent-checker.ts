/**
 * Agent Checker Service
 *
 * Checks availability of coding agents (Claude, Codex, Droid)
 * using the same logic as ralph doctor command.
 */

import { execSync } from 'node:child_process';

export interface AgentStatus {
  name: string;
  id: string;
  available: boolean;
  version: string | null;
  path: string | null;
  suggestion: string | null;
}

export interface AgentAvailability {
  agents: AgentStatus[];
  default: string;
  availableCount: number;
}

/**
 * Execute a command and return the output or null on failure
 */
function exec(cmd: string): string | null {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if Claude Code CLI is available
 */
function checkClaude(): AgentStatus {
  const result: AgentStatus = {
    name: 'Claude',
    id: 'claude',
    available: false,
    version: null,
    path: null,
    suggestion: null,
  };

  const which = exec('which claude');
  if (which) {
    result.path = which;
    result.available = true;

    const versionOutput = exec('claude --version 2>/dev/null');
    if (versionOutput) {
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      } else {
        result.version = versionOutput;
      }
    }
  } else {
    result.suggestion = 'npm install -g @anthropic-ai/claude-code';
  }

  return result;
}

/**
 * Check if Codex CLI is available
 */
function checkCodex(): AgentStatus {
  const result: AgentStatus = {
    name: 'Codex',
    id: 'codex',
    available: false,
    version: null,
    path: null,
    suggestion: null,
  };

  const which = exec('which codex');
  if (which) {
    result.path = which;
    result.available = true;

    const versionOutput = exec('codex --version 2>/dev/null');
    if (versionOutput) {
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      } else {
        result.version = versionOutput;
      }
    }
  } else {
    result.suggestion = 'npm install -g @openai/codex';
  }

  return result;
}

/**
 * Check if Droid CLI is available
 */
function checkDroid(): AgentStatus {
  const result: AgentStatus = {
    name: 'Droid',
    id: 'droid',
    available: false,
    version: null,
    path: null,
    suggestion: null,
  };

  const which = exec('which droid');
  if (which) {
    result.path = which;
    result.available = true;

    const versionOutput = exec('droid --version 2>/dev/null');
    if (versionOutput) {
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      } else {
        result.version = versionOutput;
      }
    }
  } else {
    result.suggestion = 'See droid installation docs';
  }

  return result;
}

/**
 * Get availability status for all agents
 * @returns Agent availability information
 */
export function getAgentAvailability(): AgentAvailability {
  const claude = checkClaude();
  const codex = checkCodex();
  const droid = checkDroid();

  const agents = [claude, codex, droid];
  const availableAgents = agents.filter(a => a.available);

  // Default agent is Claude if available, otherwise first available
  let defaultAgent = 'claude';
  if (!claude.available && availableAgents.length > 0) {
    defaultAgent = availableAgents[0].id;
  }

  return {
    agents,
    default: defaultAgent,
    availableCount: availableAgents.length,
  };
}

// Cache the result for 60 seconds to avoid repeated which/version checks
let cachedResult: AgentAvailability | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 60000; // 60 seconds

/**
 * Get cached agent availability (refreshes after TTL)
 */
export function getCachedAgentAvailability(): AgentAvailability {
  const now = Date.now();
  if (!cachedResult || (now - cacheTime) > CACHE_TTL) {
    cachedResult = getAgentAvailability();
    cacheTime = now;
  }
  return cachedResult;
}

/**
 * Clear the cache (useful for testing or after installation)
 */
export function clearAgentCache(): void {
  cachedResult = null;
  cacheTime = 0;
}
