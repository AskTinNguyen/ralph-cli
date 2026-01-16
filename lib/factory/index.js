/**
 * Ralph Factory Mode - Main Module
 *
 * Meta-orchestration layer that enables factorial-style sequences of agent workflows.
 * Chains PRD→Plan→Build pipelines where outcomes feed into new agents.
 *
 * @module lib/factory
 */
const fs = require("fs");
const path = require("path");

const parser = require("./parser");
const scheduler = require("./scheduler");
const executor = require("./executor");
const context = require("./context");
const factoryCheckpoint = require("./checkpoint");
const verifier = require("./verifier");
const orchestrator = require("./orchestrator");
const stateMachine = require("./state-machine");

/**
 * Check if FSM mode is enabled
 * @param {Object} options - Options object
 * @returns {boolean} True if FSM mode should be used
 */
function isFSMEnabled(options = {}) {
  // Check explicit option first
  if (options.useFSM !== undefined) {
    return options.useFSM;
  }

  // Check environment variable
  return process.env.RALPH_FACTORY_FSM === 'true';
}

/**
 * Factory configuration version
 */
const FACTORY_VERSION = "1";

/**
 * Default factory directory structure
 */
const DEFAULT_FACTORY_DIR = ".ralph/factory";

/**
 * Get the factory directory path for a project
 * @param {string} projectRoot - Project root directory
 * @returns {string} Path to factory directory
 */
function getFactoryDir(projectRoot) {
  return path.join(projectRoot, DEFAULT_FACTORY_DIR);
}

/**
 * Check if a factory exists
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name (optional, uses default if not specified)
 * @returns {boolean} True if factory exists
 */
function factoryExists(projectRoot, factoryName = "factory") {
  const factoryDir = getFactoryDir(projectRoot);
  const configPath = path.join(factoryDir, `${factoryName}.yaml`);
  return fs.existsSync(configPath);
}

/**
 * Initialize a new factory
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {Object} options - Initialization options
 * @returns {Object} { success: boolean, path?: string, error?: string }
 */
function initFactory(projectRoot, factoryName = "factory", options = {}) {
  const factoryDir = getFactoryDir(projectRoot);

  try {
    // Create factory directory structure
    const dirs = [
      factoryDir,
      path.join(factoryDir, "templates"),
      path.join(factoryDir, "runs"),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Create default factory configuration
    const configPath = path.join(factoryDir, `${factoryName}.yaml`);

    if (fs.existsSync(configPath) && !options.force) {
      return {
        success: false,
        error: `Factory '${factoryName}' already exists. Use --force to overwrite.`,
      };
    }

    const defaultConfig = generateDefaultConfig(factoryName, options);
    fs.writeFileSync(configPath, defaultConfig, "utf8");

    // Create empty learnings file
    const learningsPath = path.join(factoryDir, "learnings.json");
    if (!fs.existsSync(learningsPath)) {
      fs.writeFileSync(learningsPath, JSON.stringify({ learnings: [], version: 1 }, null, 2));
    }

    // Create variables file
    const varsPath = path.join(factoryDir, "variables.yaml");
    if (!fs.existsSync(varsPath)) {
      const defaultVars = `# Factory Variables
# These variables are available in all stages via {{ variable_name }}

# Default budget limit (optional)
max_budget: 25.00

# Default iteration counts
default_iterations: 5
max_recursion: 3
`;
      fs.writeFileSync(varsPath, defaultVars, "utf8");
    }

    return {
      success: true,
      path: configPath,
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to initialize factory: ${err.message}`,
    };
  }
}

/**
 * Generate default factory configuration
 * @param {string} name - Factory name
 * @param {Object} options - Configuration options
 * @returns {string} YAML configuration string
 */
function generateDefaultConfig(name, options = {}) {
  const template = options.template || "basic";

  if (template === "full") {
    return `# ${name} - Full Factorial Factory
# A complete example with branching, parallelism, and loops

version: "1"
name: "${name}"

# Variables available to all stages
variables:
  max_budget: 25.00
  max_recursion: 3

# Agent configuration
agents:
  default: claude
  planning: claude
  implementation: claude

# Pipeline stages
stages:
  # Stage 1: Generate PRD from user request
  - id: generate_prd
    type: prd
    input:
      request: "{{ user_request }}"
      context: "{{ learnings }}"

  # Stage 2: Create implementation plan
  - id: create_plan
    type: plan
    depends_on: [generate_prd]

  # Stage 3a: Simple build path (parallel branch)
  - id: build_simple
    type: build
    depends_on: [create_plan]
    condition: "{{ stages.create_plan.stories_count <= 5 }}"
    config:
      iterations: 10

  # Stage 3b: Complex build path (parallel branch)
  - id: build_complex
    type: build
    depends_on: [create_plan]
    condition: "{{ stages.create_plan.stories_count > 5 }}"
    config:
      iterations: 25
      parallel: 3

  # Stage 4: Run tests (merges both branches)
  - id: run_tests
    type: custom
    depends_on: [build_simple, build_complex]
    merge_strategy: any
    command: "npm test"

  # Stage 5: Fix issues (recursive loop)
  - id: fix_issues
    type: prd
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.failed && recursion_count < max_recursion }}"
    input:
      request: "Fix: {{ stages.run_tests.error_summary }}"
    loop_to: create_plan

  # Stage 6: Generate docs (on success)
  - id: generate_docs
    type: prd
    depends_on: [run_tests]
    condition: "{{ stages.run_tests.passed }}"
    input:
      request: "Generate docs for {{ stages.generate_prd.feature_name }}"
`;
  }

  // Basic template
  return `# ${name} - Ralph Factory Configuration
# See CLAUDE.md for full documentation

version: "1"
name: "${name}"

# Variables available to all stages
variables:
  max_budget: 25.00

# Agent configuration
agents:
  default: claude

# Pipeline stages
stages:
  # Stage 1: Generate PRD
  - id: generate_prd
    type: prd
    input:
      request: "{{ user_request }}"

  # Stage 2: Create plan
  - id: create_plan
    type: plan
    depends_on: [generate_prd]

  # Stage 3: Build
  - id: build_feature
    type: build
    depends_on: [create_plan]
    config:
      iterations: 10

  # Stage 4: Run tests (optional)
  # - id: run_tests
  #   type: custom
  #   depends_on: [build_feature]
  #   command: "npm test"
`;
}

/**
 * Run a factory
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {Object} options - Run options
 * @returns {Promise<Object>} { success: boolean, runId?: string, error?: string }
 */
async function runFactory(projectRoot, factoryName = "factory", options = {}) {
  // Use FSM-based execution if enabled
  if (isFSMEnabled(options)) {
    return runFactoryFSM(projectRoot, factoryName, options);
  }

  // Legacy execution path
  return runFactoryLegacy(projectRoot, factoryName, options);
}

/**
 * Run factory using FSM-based orchestration
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {Object} options - Run options
 * @returns {Promise<Object>} Execution result
 */
async function runFactoryFSM(projectRoot, factoryName, options = {}) {
  return orchestrator.runFactoryFSM(projectRoot, factoryName, options);
}

/**
 * Run factory using legacy imperative execution
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {Object} options - Run options
 * @returns {Promise<Object>} { success: boolean, runId?: string, error?: string }
 */
async function runFactoryLegacy(projectRoot, factoryName = "factory", options = {}) {
  const factoryDir = getFactoryDir(projectRoot);
  const configPath = path.join(factoryDir, `${factoryName}.yaml`);

  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      error: `Factory '${factoryName}' not found. Run 'ralph factory init ${factoryName}' first.`,
    };
  }

  try {
    // Parse factory configuration
    const parseResult = parser.parseFactory(configPath);
    if (!parseResult.success) {
      return {
        success: false,
        error: `Failed to parse factory: ${parseResult.error}`,
      };
    }

    const factory = parseResult.factory;

    // Merge variables from options
    if (options.variables) {
      factory.variables = { ...factory.variables, ...options.variables };
    }

    // Create run directory
    const runId = `run-${Date.now()}`;
    const runDir = path.join(factoryDir, "runs", runId);
    fs.mkdirSync(runDir, { recursive: true });
    fs.mkdirSync(path.join(runDir, "stages"), { recursive: true });

    // Initialize execution state
    const state = {
      runId,
      factoryName,
      status: "running",
      startedAt: new Date().toISOString(),
      completedAt: null,
      currentStage: null,
      completedStages: [],
      failedStages: [],
      variables: factory.variables,
      recursionCount: 0,
    };

    // Save initial state
    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(state, null, 2)
    );

    // Initialize context
    const ctx = context.createContext(projectRoot, runDir, factory.variables);

    // Build dependency graph and get execution order
    const graph = scheduler.buildDependencyGraph(factory.stages);
    const executionOrder = scheduler.getExecutionOrder(graph);

    // Execute stages
    const result = await executor.executeFactory(
      factory,
      executionOrder,
      ctx,
      runDir,
      projectRoot,
      options
    );

    // Update final state
    state.status = result.success ? "completed" : "failed";
    state.completedAt = new Date().toISOString();
    state.completedStages = result.completedStages || [];
    state.failedStages = result.failedStages || [];

    fs.writeFileSync(
      path.join(runDir, "state.json"),
      JSON.stringify(state, null, 2)
    );

    // Save final context
    context.saveContext(ctx, path.join(runDir, "context.json"));

    return {
      success: result.success,
      runId,
      state,
      error: result.error,
    };
  } catch (err) {
    return {
      success: false,
      error: `Factory execution failed: ${err.message}`,
    };
  }
}

/**
 * Get factory status
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @returns {Object} Factory status information
 */
function getFactoryStatus(projectRoot, factoryName = "factory") {
  const factoryDir = getFactoryDir(projectRoot);
  const runsDir = path.join(factoryDir, "runs");

  if (!fs.existsSync(runsDir)) {
    return { runs: [], activeRun: null };
  }

  const runs = [];
  const entries = fs.readdirSync(runsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.startsWith("run-")) {
      const stateFile = path.join(runsDir, entry.name, "state.json");
      if (fs.existsSync(stateFile)) {
        try {
          const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
          runs.push({
            runId: entry.name,
            ...state,
          });
        } catch {
          // Skip corrupted state files
        }
      }
    }
  }

  // Sort by start time (newest first)
  runs.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));

  // Find active run
  const activeRun = runs.find((r) => r.status === "running");

  return {
    runs,
    activeRun,
    latestRun: runs[0] || null,
  };
}

/**
 * Stop a running factory
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {string} runId - Run ID (optional, stops active run)
 * @returns {Object} { success: boolean, error?: string }
 */
function stopFactory(projectRoot, factoryName, runId) {
  const factoryDir = getFactoryDir(projectRoot);
  const status = getFactoryStatus(projectRoot, factoryName);

  const targetRun = runId
    ? status.runs.find((r) => r.runId === runId)
    : status.activeRun;

  if (!targetRun) {
    return {
      success: false,
      error: runId
        ? `Run '${runId}' not found`
        : "No active run to stop",
    };
  }

  if (targetRun.status !== "running") {
    return {
      success: false,
      error: `Run '${targetRun.runId}' is not running (status: ${targetRun.status})`,
    };
  }

  try {
    const runDir = path.join(factoryDir, "runs", targetRun.runId);
    const stateFile = path.join(runDir, "state.json");

    const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    state.status = "stopped";
    state.stoppedAt = new Date().toISOString();

    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to stop run: ${err.message}`,
    };
  }
}

/**
 * Resume a stopped or failed factory run
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {string} runId - Run ID to resume
 * @param {Object} options - Resume options
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function resumeFactory(projectRoot, factoryName, runId, options = {}) {
  // Use FSM-based execution if enabled
  if (isFSMEnabled(options)) {
    return resumeFactoryFSM(projectRoot, factoryName, runId, options);
  }

  // Legacy execution path
  return resumeFactoryLegacy(projectRoot, factoryName, runId, options);
}

/**
 * Resume factory using FSM-based orchestration
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {string} runId - Run ID to resume (unused, FSM finds latest)
 * @param {Object} options - Resume options
 * @returns {Promise<Object>} Execution result
 */
async function resumeFactoryFSM(projectRoot, factoryName, runId, options = {}) {
  return orchestrator.resumeFactoryFSM(projectRoot, factoryName, options);
}

/**
 * Resume factory using legacy imperative execution
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @param {string} runId - Run ID to resume
 * @param {Object} options - Resume options
 * @returns {Promise<Object>} { success: boolean, error?: string }
 */
async function resumeFactoryLegacy(projectRoot, factoryName, runId, options = {}) {
  const factoryDir = getFactoryDir(projectRoot);
  const status = getFactoryStatus(projectRoot, factoryName);

  const targetRun = runId
    ? status.runs.find((r) => r.runId === runId)
    : status.latestRun;

  if (!targetRun) {
    return {
      success: false,
      error: runId
        ? `Run '${runId}' not found`
        : "No runs found to resume",
    };
  }

  if (targetRun.status === "completed") {
    return {
      success: false,
      error: `Run '${targetRun.runId}' already completed`,
    };
  }

  // Load factory config
  const configPath = path.join(factoryDir, `${factoryName}.yaml`);
  const parseResult = parser.parseFactory(configPath);
  if (!parseResult.success) {
    return {
      success: false,
      error: `Failed to parse factory: ${parseResult.error}`,
    };
  }

  const factory = parseResult.factory;
  const runDir = path.join(factoryDir, "runs", targetRun.runId);

  // Load context
  const contextPath = path.join(runDir, "context.json");
  const ctx = fs.existsSync(contextPath)
    ? context.loadContext(contextPath)
    : context.createContext(projectRoot, runDir, factory.variables);

  // Build dependency graph
  const graph = scheduler.buildDependencyGraph(factory.stages);
  const executionOrder = scheduler.getExecutionOrder(graph);

  // Filter out completed stages
  const remainingStages = executionOrder.filter(
    (stageId) => !targetRun.completedStages.includes(stageId)
  );

  // Update state
  targetRun.status = "running";
  targetRun.resumedAt = new Date().toISOString();

  fs.writeFileSync(
    path.join(runDir, "state.json"),
    JSON.stringify(targetRun, null, 2)
  );

  // Resume execution
  const result = await executor.executeFactory(
    factory,
    remainingStages,
    ctx,
    runDir,
    projectRoot,
    { ...options, resumeFrom: targetRun.currentStage }
  );

  // Update final state
  targetRun.status = result.success ? "completed" : "failed";
  targetRun.completedAt = new Date().toISOString();
  targetRun.completedStages = [
    ...targetRun.completedStages,
    ...(result.completedStages || []),
  ];
  targetRun.failedStages = result.failedStages || [];

  fs.writeFileSync(
    path.join(runDir, "state.json"),
    JSON.stringify(targetRun, null, 2)
  );

  // Save final context
  context.saveContext(ctx, contextPath);

  return {
    success: result.success,
    runId: targetRun.runId,
    state: targetRun,
    error: result.error,
  };
}

/**
 * List all stages in a factory
 * @param {string} projectRoot - Project root directory
 * @param {string} factoryName - Factory name
 * @returns {Object} { success: boolean, stages?: Array, error?: string }
 */
function listStages(projectRoot, factoryName = "factory") {
  const factoryDir = getFactoryDir(projectRoot);
  const configPath = path.join(factoryDir, `${factoryName}.yaml`);

  if (!fs.existsSync(configPath)) {
    return {
      success: false,
      error: `Factory '${factoryName}' not found`,
    };
  }

  const parseResult = parser.parseFactory(configPath);
  if (!parseResult.success) {
    return {
      success: false,
      error: `Failed to parse factory: ${parseResult.error}`,
    };
  }

  return {
    success: true,
    stages: parseResult.factory.stages,
  };
}

/**
 * Get learnings for a project
 * @param {string} projectRoot - Project root directory
 * @returns {Object} Learnings data
 */
function getLearnings(projectRoot) {
  const factoryDir = getFactoryDir(projectRoot);
  const learningsPath = path.join(factoryDir, "learnings.json");

  if (!fs.existsSync(learningsPath)) {
    return { learnings: [], version: 1 };
  }

  try {
    return JSON.parse(fs.readFileSync(learningsPath, "utf8"));
  } catch {
    return { learnings: [], version: 1 };
  }
}

/**
 * Add a learning to the project
 * @param {string} projectRoot - Project root directory
 * @param {Object} learning - Learning to add
 * @returns {Object} { success: boolean, error?: string }
 */
function addLearning(projectRoot, learning) {
  const factoryDir = getFactoryDir(projectRoot);
  const learningsPath = path.join(factoryDir, "learnings.json");

  try {
    const data = getLearnings(projectRoot);

    data.learnings.push({
      ...learning,
      addedAt: new Date().toISOString(),
    });

    // Keep only last 100 learnings
    if (data.learnings.length > 100) {
      data.learnings = data.learnings.slice(-100);
    }

    if (!fs.existsSync(factoryDir)) {
      fs.mkdirSync(factoryDir, { recursive: true });
    }

    fs.writeFileSync(learningsPath, JSON.stringify(data, null, 2));

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: `Failed to add learning: ${err.message}`,
    };
  }
}

module.exports = {
  FACTORY_VERSION,
  DEFAULT_FACTORY_DIR,
  getFactoryDir,
  factoryExists,
  initFactory,
  runFactory,
  runFactoryFSM,
  runFactoryLegacy,
  getFactoryStatus,
  stopFactory,
  resumeFactory,
  resumeFactoryFSM,
  resumeFactoryLegacy,
  listStages,
  getLearnings,
  addLearning,
  // FSM utilities
  isFSMEnabled,
  // Re-export submodules
  parser,
  scheduler,
  executor,
  context,
  checkpoint: factoryCheckpoint,
  verifier,
  orchestrator,
  stateMachine,
};
