/**
 * Environment validation checks for ralph doctor
 *
 * Validates agent CLIs, Node.js version, and git installation
 */
const { execSync } = require("child_process");

/**
 * Execute a command and return the output or null on failure
 * @param {string} cmd - Command to execute
 * @returns {string|null} - Output or null
 */
function exec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Check if Claude Code CLI is available
 * @returns {object} Check result with status and details
 */
function checkClaude() {
  const result = {
    name: "Claude Code",
    type: "agent",
    available: false,
    version: null,
    path: null,
    suggestion: null,
  };

  // Try to find claude
  const which = exec("which claude");
  if (which) {
    result.path = which;
    result.available = true;

    // Try to get version
    const versionOutput = exec("claude --version 2>/dev/null");
    if (versionOutput) {
      // Parse version from output like "claude-code version 1.2.3" or "1.2.3"
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      } else {
        result.version = versionOutput;
      }
    }
  } else {
    result.suggestion = "npm install -g @anthropic-ai/claude-code";
  }

  return result;
}

/**
 * Check if Codex CLI is available
 * @returns {object} Check result with status and details
 */
function checkCodex() {
  const result = {
    name: "Codex",
    type: "agent",
    available: false,
    version: null,
    path: null,
    suggestion: null,
  };

  // Try to find codex
  const which = exec("which codex");
  if (which) {
    result.path = which;
    result.available = true;

    // Try to get version
    const versionOutput = exec("codex --version 2>/dev/null");
    if (versionOutput) {
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      } else {
        result.version = versionOutput;
      }
    }
  } else {
    result.suggestion = "npm install -g @openai/codex";
  }

  return result;
}

/**
 * Check if Droid CLI is available
 * @returns {object} Check result with status and details
 */
function checkDroid() {
  const result = {
    name: "Droid",
    type: "agent",
    available: false,
    version: null,
    path: null,
    suggestion: null,
  };

  // Try to find droid
  const which = exec("which droid");
  if (which) {
    result.path = which;
    result.available = true;

    // Try to get version
    const versionOutput = exec("droid --version 2>/dev/null");
    if (versionOutput) {
      const versionMatch = versionOutput.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        result.version = versionMatch[1];
      } else {
        result.version = versionOutput;
      }
    }
  } else {
    result.suggestion = "See droid installation docs";
  }

  return result;
}

/**
 * Check Node.js version (requires 18+)
 * @returns {object} Check result with validity, version, and suggestion
 */
function checkNodeVersion() {
  const MIN_NODE_VERSION = 18;

  const result = {
    name: "Node.js",
    type: "runtime",
    valid: false,
    version: null,
    minRequired: `${MIN_NODE_VERSION}+`,
    suggestion: null,
  };

  // Get Node.js version
  const versionOutput = exec("node --version");
  if (versionOutput) {
    // Parse version from "v20.10.0" format
    const versionMatch = versionOutput.match(/v?(\d+)\.(\d+)\.(\d+)/);
    if (versionMatch) {
      const major = parseInt(versionMatch[1], 10);
      result.version = `${versionMatch[1]}.${versionMatch[2]}.${versionMatch[3]}`;
      result.valid = major >= MIN_NODE_VERSION;

      if (!result.valid) {
        result.suggestion = `Upgrade Node.js to v${MIN_NODE_VERSION}+ (current: v${result.version})`;
      }
    }
  } else {
    result.suggestion = "Install Node.js v18+ from https://nodejs.org";
  }

  return result;
}

/**
 * Check git installation and state
 * @param {string} projectPath - Path to check git state in
 * @returns {object} Check result with installation and state details
 */
function checkGitVersion(projectPath = ".") {
  const result = {
    name: "Git",
    type: "vcs",
    valid: false,
    version: null,
    path: null,
    state: {
      isRepo: false,
      hasRemote: false,
      hasUncommitted: false,
      hasConflicts: false,
      branch: null,
    },
    suggestion: null,
  };

  // Check git installation
  const which = exec("which git");
  if (which) {
    result.path = which;

    // Get version
    const versionOutput = exec("git --version");
    if (versionOutput) {
      const versionMatch = versionOutput.match(/(\d+\.\d+(\.\d+)?)/);
      if (versionMatch) {
        result.version = versionMatch[1];
        result.valid = true;
      }
    }
  } else {
    result.suggestion = "Install git from https://git-scm.com";
    return result;
  }

  // Check git repo state (in project context)
  try {
    // Check if it's a git repo
    const gitDir = exec(`git -C "${projectPath}" rev-parse --git-dir 2>/dev/null`);
    if (gitDir) {
      result.state.isRepo = true;

      // Get current branch
      const branch = exec(`git -C "${projectPath}" rev-parse --abbrev-ref HEAD 2>/dev/null`);
      if (branch) {
        result.state.branch = branch;
      }

      // Check for remote
      const remotes = exec(`git -C "${projectPath}" remote 2>/dev/null`);
      result.state.hasRemote = remotes && remotes.length > 0;

      // Check for uncommitted changes
      const status = exec(`git -C "${projectPath}" status --porcelain 2>/dev/null`);
      result.state.hasUncommitted = status && status.length > 0;

      // Check for merge conflicts
      const conflictMarkers = exec(`git -C "${projectPath}" diff --check 2>/dev/null`);
      result.state.hasConflicts = !!(conflictMarkers && conflictMarkers.includes("conflict"));
    }
  } catch {
    // Not a git repo or git error - state remains default
  }

  return result;
}

/**
 * Run all environment checks
 * @param {string} projectPath - Path to project root
 * @returns {object} Aggregated results
 */
function runAllChecks(projectPath = ".") {
  const checks = [];
  let passed = 0;
  let warnings = 0;
  let errors = 0;

  // Agent checks - at least one agent should be available
  const claudeCheck = checkClaude();
  const codexCheck = checkCodex();
  const droidCheck = checkDroid();

  checks.push(claudeCheck, codexCheck, droidCheck);

  // Count available agents
  const availableAgents = [claudeCheck, codexCheck, droidCheck].filter((c) => c.available);
  if (availableAgents.length === 0) {
    errors++;
  } else if (availableAgents.length < 3) {
    // Having some agents is okay, count as partial pass
    passed += availableAgents.length;
    warnings += 3 - availableAgents.length;
  } else {
    passed += 3;
  }

  // Node.js check - required
  const nodeCheck = checkNodeVersion();
  checks.push(nodeCheck);
  if (nodeCheck.valid) {
    passed++;
  } else {
    errors++;
  }

  // Git check - required
  const gitCheck = checkGitVersion(projectPath);
  checks.push(gitCheck);
  if (gitCheck.valid) {
    passed++;
    // State warnings
    if (gitCheck.state.hasConflicts) {
      warnings++;
    }
  } else {
    errors++;
  }

  return {
    category: "environment",
    checks,
    passed,
    warnings,
    errors,
    summary: {
      totalChecks: checks.length,
      agentsAvailable: availableAgents.length,
      nodeValid: nodeCheck.valid,
      gitValid: gitCheck.valid,
    },
  };
}

module.exports = {
  checkClaude,
  checkCodex,
  checkDroid,
  checkNodeVersion,
  checkGitVersion,
  runAllChecks,
};
