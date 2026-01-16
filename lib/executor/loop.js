#!/usr/bin/env node
/**
 * TypeScript Executor for Ralph Build Loop
 *
 * Optional TypeScript implementation of the build loop.
 * Opt-in via: export RALPH_EXECUTOR=typescript
 *
 * Features:
 * - Full build orchestration
 * - Parallel execution support
 * - Checkpoint/resume
 * - Agent switching/fallback
 * - Rollback on failures
 * - Graceful fallback to bash on errors
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Import existing modules
let storyModule, checkpointModule, stateModule;
try {
  storyModule = require('../story');
  checkpointModule = require('../checkpoint');
  stateModule = require('../state');
} catch (e) {
  // Modules may not be available in all environments
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG = {
  maxIterations: 5,
  prdPath: null,
  planPath: null,
  progressPath: null,
  workDir: process.cwd(),
  agent: 'claude',
  agentFallbackChain: ['claude', 'codex', 'droid'],
  agentSwitchThreshold: 2,
  rollbackEnabled: true,
  rollbackMaxRetries: 3,
  timeoutAgent: 3600000,     // 60 minutes
  timeoutIteration: 5400000, // 90 minutes
  noCommit: false,
  headless: false,
  verbose: false,
};

/**
 * Agent command templates
 */
const AGENT_COMMANDS = {
  claude: 'claude -p --dangerously-skip-permissions',
  codex: 'codex exec --yolo --skip-git-repo-check -',
  droid: 'droid exec --skip-permissions-unsafe -f',
};

/**
 * Build state tracking
 */
class BuildState {
  constructor(config) {
    this.config = config;
    this.iteration = 0;
    this.currentStory = null;
    this.currentAgent = config.agent;
    this.consecutiveFailures = 0;
    this.chainPosition = 0;
    this.startTime = Date.now();
    this.stories = [];
    this.completedStories = [];
    this.failedStories = [];
    this.totalCost = 0;
  }

  getElapsedSeconds() {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  toJSON() {
    return {
      iteration: this.iteration,
      currentStory: this.currentStory,
      currentAgent: this.currentAgent,
      consecutiveFailures: this.consecutiveFailures,
      chainPosition: this.chainPosition,
      elapsedSeconds: this.getElapsedSeconds(),
      completedCount: this.completedStories.length,
      failedCount: this.failedStories.length,
      totalCost: this.totalCost,
    };
  }
}

/**
 * Status file management
 */
function updateStatusFile(prdFolder, phase, storyId, storyTitle, iteration) {
  const statusPath = path.join(prdFolder, '.status.json');
  const status = {
    phase,
    story_id: storyId || '',
    story_title: storyTitle || '',
    iteration,
    elapsed_seconds: Math.floor((Date.now() - global.buildStartTime) / 1000),
    updated_at: new Date().toISOString(),
  };
  try {
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch (e) {
    // Ignore status file errors
  }
}

function clearStatusFile(prdFolder) {
  const statusPath = path.join(prdFolder, '.status.json');
  try {
    if (fs.existsSync(statusPath)) {
      fs.unlinkSync(statusPath);
    }
  } catch (e) {
    // Ignore
  }
}

/**
 * Event logging
 */
function logEvent(prdFolder, level, message, details = '') {
  const eventsPath = path.join(prdFolder, '.events.log');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${timestamp}] ${level} ${message}${details ? ' | ' + details : ''}\n`;
  try {
    fs.appendFileSync(eventsPath, line);
  } catch (e) {
    // Ignore event log errors
  }
}

/**
 * Activity logging
 */
function logActivity(prdFolder, message) {
  const activityPath = path.join(prdFolder, 'activity.log');
  const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const line = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(activityPath, line);
  } catch (e) {
    // Ignore activity log errors
  }
}

/**
 * Parse stories from plan.md
 */
function parseStories(planPath) {
  // Try using story module if available
  if (storyModule && storyModule.parseStoriesFromFile) {
    try {
      const result = storyModule.parseStoriesFromFile(planPath);
      if (Array.isArray(result)) {
        return result;
      }
    } catch (e) {
      // Fall through to manual parsing
    }
  }

  // Fallback: basic parsing
  const content = fs.readFileSync(planPath, 'utf8');
  const stories = [];
  const storyRegex = /^###\s*\[([x ])\]\s*(US-\d+):\s*(.+)$/gim;
  let match;

  while ((match = storyRegex.exec(content)) !== null) {
    stories.push({
      id: match[2],
      title: match[3].trim(),
      status: match[1].toLowerCase() === 'x' ? 'completed' : 'pending',
    });
  }

  return stories;
}

/**
 * Select next story to work on
 */
function selectNextStory(stories) {
  if (storyModule && storyModule.selectNextStory) {
    return storyModule.selectNextStory(stories);
  }

  // Fallback: find first pending story
  return stories.find(s => s.status !== 'completed') || null;
}

/**
 * Save checkpoint
 */
function saveCheckpoint(prdFolder, state) {
  // Always use direct file writing for consistency
  const checkpointPath = path.join(prdFolder, '.checkpoint.json');
  const checkpoint = {
    iteration: state.iteration,
    story_id: state.currentStory?.id,
    story_title: state.currentStory?.title,
    agent: state.currentAgent,
    timestamp: new Date().toISOString(),
    git_sha: getGitSha(),
  };
  try {
    fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Load checkpoint
 */
function loadCheckpoint(prdFolder) {
  // Always use direct file reading for consistency
  const checkpointPath = path.join(prdFolder, '.checkpoint.json');
  if (fs.existsSync(checkpointPath)) {
    try {
      return JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Clear checkpoint
 */
function clearCheckpoint(prdFolder) {
  const checkpointPath = path.join(prdFolder, '.checkpoint.json');
  try {
    if (fs.existsSync(checkpointPath)) {
      fs.unlinkSync(checkpointPath);
    }
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Get current git SHA
 */
function getGitSha() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch (e) {
    return '';
  }
}

/**
 * Check for uncommitted changes
 */
function hasUncommittedChanges() {
  try {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    return status.trim().length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Git rollback to specific SHA
 */
function rollbackTo(sha) {
  try {
    execSync(`git reset --hard ${sha}`, { stdio: 'pipe' });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Run agent with prompt
 */
async function runAgent(agentName, promptPath, config) {
  const agentCmd = AGENT_COMMANDS[agentName] || AGENT_COMMANDS.claude;
  const timeout = config.timeoutAgent || 3600000;

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    let output = '';
    let exitCode = null;

    // Build command
    const cmd = agentCmd.includes('-f')
      ? `${agentCmd} ${promptPath}`
      : `cat ${promptPath} | ${agentCmd}`;

    const proc = spawn('bash', ['-c', cmd], {
      cwd: config.workDir,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout,
    });

    proc.stdout.on('data', (data) => {
      output += data.toString();
      if (config.verbose) {
        process.stdout.write(data);
      }
    });

    proc.stderr.on('data', (data) => {
      output += data.toString();
      if (config.verbose) {
        process.stderr.write(data);
      }
    });

    proc.on('close', (code) => {
      exitCode = code;
      resolve({
        exitCode: code,
        output,
        duration: Date.now() - startTime,
        timedOut: false,
      });
    });

    proc.on('error', (err) => {
      reject(err);
    });

    // Timeout handling
    setTimeout(() => {
      if (exitCode === null) {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (exitCode === null) {
            proc.kill('SIGKILL');
          }
        }, 5000);
        resolve({
          exitCode: 124,
          output,
          duration: timeout,
          timedOut: true,
        });
      }
    }, timeout);
  });
}

/**
 * Switch to next agent in fallback chain
 */
function switchAgent(state, config) {
  const chain = config.agentFallbackChain || DEFAULT_CONFIG.agentFallbackChain;
  const currentIndex = chain.indexOf(state.currentAgent);
  const nextIndex = currentIndex + 1;

  if (nextIndex < chain.length) {
    const prevAgent = state.currentAgent;
    state.currentAgent = chain[nextIndex];
    state.chainPosition = nextIndex;
    state.consecutiveFailures = 0;
    logActivity(config.prdFolder, `AGENT_SWITCH from=${prevAgent} to=${state.currentAgent}`);
    return true;
  }

  return false; // No more agents to try
}

/**
 * Generate build prompt
 */
function generatePrompt(config, state, story) {
  const promptTemplate = fs.readFileSync(
    path.join(config.templatesPath, 'PROMPT_build.md'),
    'utf8'
  );

  // Replace placeholders
  let prompt = promptTemplate
    .replace(/{PRD_PATH}/g, config.prdPath)
    .replace(/{PLAN_PATH}/g, config.planPath)
    .replace(/{PROGRESS_PATH}/g, config.progressPath)
    .replace(/{STORY_ID}/g, story.id)
    .replace(/{STORY_TITLE}/g, story.title)
    .replace(/{ITERATION}/g, state.iteration)
    .replace(/{ROOT_DIR}/g, config.workDir);

  return prompt;
}

/**
 * Run single iteration
 */
async function runIteration(state, config) {
  const prdFolder = path.dirname(config.prdPath);

  // Update status
  updateStatusFile(prdFolder, 'selecting', null, null, state.iteration);

  // Parse and select story
  const stories = parseStories(config.planPath);
  const story = selectNextStory(stories);

  if (!story) {
    return { success: true, complete: true, message: 'No more stories to complete' };
  }

  state.currentStory = story;

  // Update status with story
  updateStatusFile(prdFolder, 'executing', story.id, story.title, state.iteration);

  // Save checkpoint
  saveCheckpoint(prdFolder, state);

  // Log iteration start
  logEvent(prdFolder, 'INFO', `Iteration ${state.iteration} started`, `story=${story.id}`);
  logActivity(prdFolder, `ITERATION ${state.iteration} start (story=${story.id})`);

  // Get git SHA before changes
  const preSha = getGitSha();

  // Generate and write prompt
  const promptPath = path.join(prdFolder, 'runs', `prompt-${state.iteration}.md`);
  fs.mkdirSync(path.dirname(promptPath), { recursive: true });
  const prompt = generatePrompt(config, state, story);
  fs.writeFileSync(promptPath, prompt);

  // Run agent with retry
  let result = null;
  let attempts = 0;
  const maxAttempts = config.rollbackMaxRetries || 3;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      result = await runAgent(state.currentAgent, promptPath, config);

      if (result.exitCode === 0) {
        // Success
        state.consecutiveFailures = 0;
        logEvent(prdFolder, 'INFO', `Iteration ${state.iteration} completed`, `story=${story.id}`);
        logActivity(prdFolder, `ITERATION ${state.iteration} end SUCCESS`);

        // Clear checkpoint on success
        clearCheckpoint(prdFolder);

        return { success: true, complete: false, story };
      }

      // Failure
      state.consecutiveFailures++;
      logEvent(prdFolder, 'ERROR', `Agent failed`, `exit=${result.exitCode} attempt=${attempts}`);

      // Check if we should switch agents
      if (state.consecutiveFailures >= config.agentSwitchThreshold) {
        if (!switchAgent(state, config)) {
          // No more agents
          logEvent(prdFolder, 'ERROR', 'Agent fallback chain exhausted');

          // Rollback if enabled
          if (config.rollbackEnabled && preSha) {
            rollbackTo(preSha);
            logActivity(prdFolder, `ROLLBACK to ${preSha}`);
          }

          return { success: false, complete: false, story, error: 'All agents failed' };
        }
      }

      // Retry with backoff
      if (attempts < maxAttempts) {
        const delay = Math.min(1000 * Math.pow(2, attempts), 16000);
        logEvent(prdFolder, 'RETRY', `Retry ${attempts}/${maxAttempts}`, `delay=${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

    } catch (err) {
      logEvent(prdFolder, 'ERROR', `Agent exception`, err.message);
      state.consecutiveFailures++;
    }
  }

  // Max retries exhausted
  logEvent(prdFolder, 'ERROR', 'All retries exhausted', `story=${story.id}`);

  // Rollback if enabled
  if (config.rollbackEnabled && preSha) {
    rollbackTo(preSha);
    logActivity(prdFolder, `ROLLBACK to ${preSha}`);
  }

  return { success: false, complete: false, story, error: 'Max retries exhausted' };
}

/**
 * Main build function
 */
async function runBuild(userConfig = {}) {
  // Merge config
  const config = { ...DEFAULT_CONFIG, ...userConfig };

  // Validate required paths
  if (!config.prdPath || !fs.existsSync(config.prdPath)) {
    throw new Error('PRD path is required and must exist');
  }
  if (!config.planPath || !fs.existsSync(config.planPath)) {
    throw new Error('Plan path is required and must exist');
  }

  const prdFolder = path.dirname(config.prdPath);
  config.prdFolder = prdFolder;
  config.progressPath = config.progressPath || path.join(prdFolder, 'progress.md');
  config.templatesPath = config.templatesPath || path.join(config.workDir, '.agents/ralph');

  // Initialize state
  const state = new BuildState(config);
  global.buildStartTime = Date.now();

  // Check for existing checkpoint
  const checkpoint = loadCheckpoint(prdFolder);
  if (checkpoint) {
    state.iteration = checkpoint.iteration || 0;
    state.currentAgent = checkpoint.agent || config.agent;
    console.log(`Resuming from checkpoint: iteration=${state.iteration}, agent=${state.currentAgent}`);
    logActivity(prdFolder, `RESUME from checkpoint iteration=${state.iteration}`);
  }

  // Log build start
  logEvent(prdFolder, 'INFO', 'Build started', `iterations=${config.maxIterations}`);
  logActivity(prdFolder, `BUILD START iterations=${config.maxIterations}`);
  updateStatusFile(prdFolder, 'starting', null, null, 0);

  // Main iteration loop
  let iterationsRun = 0;

  while (iterationsRun < config.maxIterations) {
    state.iteration++;
    iterationsRun++;

    console.log(`\n=== Iteration ${state.iteration}/${config.maxIterations} ===`);

    const result = await runIteration(state, config);

    if (result.complete) {
      // All stories done
      console.log('\n✓ All stories completed!');
      logEvent(prdFolder, 'INFO', 'Build complete', 'All stories done');
      logActivity(prdFolder, 'BUILD COMPLETE - All stories done');
      clearStatusFile(prdFolder);
      return { success: true, state: state.toJSON() };
    }

    if (!result.success) {
      // Iteration failed
      console.log(`\n✗ Iteration failed: ${result.error}`);
      state.failedStories.push(result.story);

      // Continue to next iteration (may try different story or agent)
    } else {
      // Iteration succeeded
      state.completedStories.push(result.story);
    }
  }

  // Max iterations reached
  console.log(`\nMax iterations (${config.maxIterations}) reached`);
  logEvent(prdFolder, 'INFO', 'Build stopped', `max_iterations=${config.maxIterations}`);
  logActivity(prdFolder, `BUILD STOPPED - Max iterations reached`);
  clearStatusFile(prdFolder);

  return {
    success: state.failedStories.length === 0,
    state: state.toJSON(),
  };
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
TypeScript Executor for Ralph Build Loop

Usage:
  node lib/executor/loop.js [options]

Options:
  --prd=<path>          Path to PRD file (required)
  --plan=<path>         Path to plan file (required)
  --iterations=<n>      Max iterations (default: 5)
  --agent=<name>        Initial agent: claude, codex, droid (default: claude)
  --no-commit           Don't commit changes
  --no-rollback         Disable automatic rollback
  --verbose             Show agent output
  --help, -h            Show this help

Environment Variables:
  RALPH_EXECUTOR=typescript    Enable TypeScript executor (in bin/ralph)

Examples:
  node lib/executor/loop.js --prd=.ralph/PRD-1/prd.md --plan=.ralph/PRD-1/plan.md
  node lib/executor/loop.js --prd=.ralph/PRD-1/prd.md --iterations=10 --agent=codex
`);
    process.exit(0);
  }

  // Parse arguments
  const config = {};

  for (const arg of args) {
    if (arg.startsWith('--prd=')) {
      config.prdPath = arg.slice(6);
    } else if (arg.startsWith('--plan=')) {
      config.planPath = arg.slice(7);
    } else if (arg.startsWith('--iterations=')) {
      config.maxIterations = parseInt(arg.slice(13), 10);
    } else if (arg.startsWith('--agent=')) {
      config.agent = arg.slice(8);
    } else if (arg === '--no-commit') {
      config.noCommit = true;
    } else if (arg === '--no-rollback') {
      config.rollbackEnabled = false;
    } else if (arg === '--verbose') {
      config.verbose = true;
    }
  }

  if (!config.prdPath) {
    console.error('Error: --prd=<path> is required');
    process.exit(1);
  }

  // Derive plan path if not provided
  if (!config.planPath) {
    config.planPath = config.prdPath.replace('prd.md', 'plan.md');
  }

  try {
    const result = await runBuild(config);
    console.log('\nBuild result:', JSON.stringify(result, null, 2));
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error('Build error:', err.message);
    process.exit(1);
  }
}

// Export for module use
module.exports = {
  runBuild,
  BuildState,
  parseStories,
  selectNextStory,
  saveCheckpoint,
  loadCheckpoint,
  clearCheckpoint,
  runAgent,
  switchAgent,
  DEFAULT_CONFIG,
  AGENT_COMMANDS,
};

// Run CLI if executed directly
if (require.main === module) {
  main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
}
