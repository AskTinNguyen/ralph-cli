/**
 * Factory Orchestrator - FSM-based Execution Coordinator
 *
 * Coordinates Factory and Stage state machines with the scheduler, executor,
 * and verifier to drive factory execution through explicit state transitions.
 *
 * @module lib/factory/orchestrator
 */

'use strict';

const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');

const {
  FactoryState,
  StageState,
  FactoryEvent,
  StageEvent,
  FactoryStateMachine,
  StageStateMachine
} = require('./state-machine');
const scheduler = require('./scheduler');
const { StageExecutor, StageStatus } = require('./executor');
const verifier = require('./verifier');
const checkpoint = require('./checkpoint');
const parser = require('./parser');

/**
 * Factory Orchestrator - Drives FSM-based execution
 */
class FactoryOrchestrator extends EventEmitter {
  /**
   * Create a new orchestrator
   * @param {Object} factory - Parsed factory configuration
   * @param {string} projectRoot - Project root directory
   * @param {string} runDir - Run directory for outputs
   * @param {Object} options - Orchestrator options
   */
  constructor(factory, projectRoot, runDir, options = {}) {
    super();

    this.factory = factory;
    this.projectRoot = projectRoot;
    this.runDir = runDir;
    this.options = options;

    // Build dependency graph
    this.graph = scheduler.buildDependencyGraph(factory.stages);
    this.executionOrder = scheduler.getExecutionOrder(this.graph);

    // Create stage map for quick lookup
    this.stageMap = new Map(factory.stages.map(s => [s.id, s]));

    // Initialize factory FSM
    this.factoryFSM = new FactoryStateMachine(factory.name, {
      continueOnFailure: options.continueOnFailure || false
    });

    // Create stage FSMs
    for (const stage of factory.stages) {
      const stageFSM = new StageStateMachine(stage.id, stage);
      this.factoryFSM.addStageMachine(stage.id, stageFSM);
    }

    // Context for stage execution
    this.context = {
      project_root: projectRoot,
      run_dir: runDir,
      stages: {},
      recursion_count: 0,
      started_at: null,
      ...options.variables
    };

    // Executor instance
    this.executor = null;
    this.stopped = false;

    // Set up FSM event forwarding
    this.setupEventForwarding();
  }

  /**
   * Set up event forwarding from FSMs to orchestrator
   */
  setupEventForwarding() {
    // Forward factory state changes
    this.factoryFSM.on('transition', (data) => {
      this.emit('factory:transition', data);
    });

    // Forward stage state changes
    for (const [stageId, stageFSM] of this.factoryFSM.stageMachines) {
      stageFSM.on('transition', (data) => {
        this.emit('stage:transition', { stageId, ...data });
      });
    }
  }

  /**
   * Run the factory
   * @param {Object} variables - Additional variables
   * @returns {Promise<Object>} Execution result
   */
  async run(variables = {}) {
    // Merge variables into context
    Object.assign(this.context, variables);
    this.context.started_at = new Date().toISOString();

    // Create executor
    this.executor = new StageExecutor(
      this.factory,
      this.context,
      this.runDir,
      this.projectRoot,
      this.options
    );

    // Forward executor events
    this.setupExecutorEvents();

    // Start factory FSM
    const startResult = await this.factoryFSM.send(FactoryEvent.START);
    if (!startResult.success) {
      return {
        success: false,
        error: startResult.error,
        state: this.factoryFSM.serialize()
      };
    }

    this.emit('factory:started', { factory: this.factory.name });

    // Run execution loop
    try {
      await this.executionLoop();
    } catch (err) {
      this.emit('factory:error', { error: err.message });

      // Transition to failed state
      await this.factoryFSM.send(FactoryEvent.ANY_FAILED, { error: err.message });

      return {
        success: false,
        error: err.message,
        state: this.factoryFSM.serialize()
      };
    }

    // Determine final state
    const hasFailures = this.factoryFSM.hasFailedStages();

    if (hasFailures && !this.options.continueOnFailure) {
      await this.factoryFSM.send(FactoryEvent.ANY_FAILED);
    } else if (this.stopped) {
      await this.factoryFSM.send(FactoryEvent.STOP);
    } else {
      await this.factoryFSM.send(FactoryEvent.ALL_COMPLETED);
    }

    // Save final checkpoint
    this.saveCheckpoint();

    const result = this.buildResult();
    this.emit('factory:completed', result);

    return result;
  }

  /**
   * Set up executor event forwarding
   */
  setupExecutorEvents() {
    if (this.options.onStageStart) {
      this.executor.on('stage:started', this.options.onStageStart);
    }
    if (this.options.onStageComplete) {
      this.executor.on('stage:completed', this.options.onStageComplete);
    }
    if (this.options.onStageFail) {
      this.executor.on('stage:failed', this.options.onStageFail);
    }
    if (this.options.onOutput) {
      this.executor.on('output', this.options.onOutput);
    }

    // Forward to orchestrator emitter
    this.executor.on('stage:started', (data) => this.emit('stage:started', data));
    this.executor.on('stage:completed', (data) => this.emit('stage:completed', data));
    this.executor.on('stage:failed', (data) => this.emit('stage:failed', data));
    this.executor.on('stage:skipped', (data) => this.emit('stage:skipped', data));
    this.executor.on('output', (data) => this.emit('output', data));
    this.executor.on('verification:start', (data) => this.emit('verification:start', data));
    this.executor.on('verification:passed', (data) => this.emit('verification:passed', data));
    this.executor.on('verification:failed', (data) => this.emit('verification:failed', data));
  }

  /**
   * Main execution loop - processes stages through their FSMs
   */
  async executionLoop() {
    const completedSet = new Set();
    const failedSet = new Set();
    const skippedSet = new Set();

    // Track loop iterations for stages with loop_to
    let globalLoopCount = 0;
    const maxGlobalLoops = this.factory.variables?.max_recursion || 3;

    while (!this.stopped && !this.factoryFSM.isTerminal()) {
      // Get ready stages (dependencies met)
      const readyStageIds = this.getReadyStages(completedSet, failedSet, skippedSet);

      if (readyStageIds.length === 0) {
        // Check if all stages are terminal
        if (this.factoryFSM.allStagesTerminal()) {
          break;
        }

        // No stages ready and not all terminal - could be a deadlock
        const pendingStages = this.factoryFSM.getStagesInState(StageState.PENDING);
        if (pendingStages.length > 0) {
          // Check if all pending stages have failed dependencies
          const allBlocked = pendingStages.every(id => {
            const deps = scheduler.getDependencies(this.graph, id);
            return deps.some(depId => failedSet.has(depId));
          });

          if (allBlocked) {
            // Skip all blocked stages
            for (const stageId of pendingStages) {
              await this.skipStage(stageId, 'dependency_failed');
              skippedSet.add(stageId);
            }
          }
        }

        break;
      }

      // Execute ready stages (could parallelize here)
      for (const stageId of readyStageIds) {
        if (this.stopped) break;

        const result = await this.executeStage(stageId);

        if (result.status === StageState.COMPLETED) {
          completedSet.add(stageId);

          // Handle loop_to
          const stage = this.stageMap.get(stageId);
          if (stage.loop_to && globalLoopCount < maxGlobalLoops) {
            // Reset the loop target and subsequent stages
            const loopTargetIndex = this.executionOrder.indexOf(stage.loop_to);
            if (loopTargetIndex >= 0) {
              // Find stages to reset (from loop target to current stage)
              const currentIndex = this.executionOrder.indexOf(stageId);
              for (let i = loopTargetIndex; i < currentIndex; i++) {
                const resetStageId = this.executionOrder[i];
                if (completedSet.has(resetStageId)) {
                  completedSet.delete(resetStageId);
                  // Reset stage FSM
                  const stageFSM = this.factoryFSM.getStageMachine(resetStageId);
                  if (stageFSM) {
                    await stageFSM.send(StageEvent.LOOP);
                  }
                }
              }
              globalLoopCount++;
              this.context.recursion_count = globalLoopCount;
            }
          }
        } else if (result.status === StageState.FAILED) {
          failedSet.add(stageId);

          if (!this.options.continueOnFailure) {
            return;
          }
        } else if (result.status === StageState.SKIPPED) {
          skippedSet.add(stageId);
        }

        // Save checkpoint after each stage
        this.saveCheckpoint();
      }
    }
  }

  /**
   * Get stages that are ready to execute
   * @param {Set} completed - Completed stage IDs
   * @param {Set} failed - Failed stage IDs
   * @param {Set} skipped - Skipped stage IDs
   * @returns {Array} Ready stage IDs
   */
  getReadyStages(completed, failed, skipped) {
    const ready = [];

    for (const stageId of this.executionOrder) {
      const stageFSM = this.factoryFSM.getStageMachine(stageId);

      // Skip if not in PENDING state
      if (!stageFSM.isIn(StageState.PENDING)) {
        continue;
      }

      // Check dependencies
      const deps = scheduler.getDependencies(this.graph, stageId);
      const allDepsCompleted = deps.every(d => completed.has(d));
      const anyDepFailed = deps.some(d => failed.has(d) || skipped.has(d));

      if (anyDepFailed) {
        // Mark stage as skipped due to failed dependency
        ready.push(stageId); // Will be handled as skip
      } else if (allDepsCompleted) {
        ready.push(stageId);
      }
    }

    return ready;
  }

  /**
   * Execute a single stage through its FSM
   * @param {string} stageId - Stage ID
   * @returns {Promise<Object>} Stage result with final state
   */
  async executeStage(stageId) {
    const stage = this.stageMap.get(stageId);
    const stageFSM = this.factoryFSM.getStageMachine(stageId);

    if (!stage || !stageFSM) {
      return { status: StageState.FAILED, error: `Stage ${stageId} not found` };
    }

    // Check if dependencies failed
    const deps = scheduler.getDependencies(this.graph, stageId);
    const failedDeps = deps.filter(d => {
      const depFSM = this.factoryFSM.getStageMachine(d);
      return depFSM && (depFSM.isIn(StageState.FAILED) || depFSM.isIn(StageState.SKIPPED));
    });

    if (failedDeps.length > 0) {
      await stageFSM.send(StageEvent.DEPS_FAILED, { failedDeps });
      return { status: StageState.SKIPPED, reason: 'dependency_failed' };
    }

    // Transition to READY
    await stageFSM.send(StageEvent.DEPS_MET);

    // Check condition
    if (stage.condition) {
      const resolvedCondition = parser.resolveTemplate(stage.condition, this.context);
      const conditionMet = parser.evaluateExpression(resolvedCondition, this.context);

      if (!conditionMet) {
        await stageFSM.send(StageEvent.CONDITION_FALSE);
        this.emit('stage:skipped', { stage, reason: 'condition_not_met' });
        return { status: StageState.SKIPPED, reason: 'condition_not_met' };
      }
    }

    // Transition to EXECUTING
    await stageFSM.send(StageEvent.EXECUTE);

    // Execute the stage using the existing executor
    this.emit('stage:executing', { stage });

    try {
      const result = await this.executor.executeStage(stage);

      // Store result in FSM context
      stageFSM.setExecutionResult(result);

      // Update shared context
      this.context.stages[stageId] = result.output || {};

      if (result.status === StageStatus.FAILED) {
        stageFSM.setError(result.error);

        // Check retries
        if (stageFSM.context.retriesLeft > 0) {
          await stageFSM.send(StageEvent.EXEC_FAILED);
          await stageFSM.send(StageEvent.RETRY);

          // Recursive retry
          return this.executeStage(stageId);
        }

        await stageFSM.send(StageEvent.EXEC_FAILED);
        return { status: StageState.FAILED, error: result.error };
      }

      if (result.status === StageStatus.SKIPPED) {
        // This was already handled above, but executor can also skip
        return { status: StageState.SKIPPED, reason: 'executor_skipped' };
      }

      // Success - check if verification is needed
      await stageFSM.send(StageEvent.EXEC_SUCCESS);

      if (stageFSM.isIn(StageState.VERIFYING)) {
        // Run verification
        const verifyResult = verifier.runAllVerifications(
          stage.verify,
          this.context,
          this.projectRoot
        );

        stageFSM.setVerificationResult(verifyResult);

        if (verifyResult.status === verifier.VerificationStatus.FAILED) {
          await stageFSM.send(StageEvent.VERIFY_FAIL);
          return { status: StageState.FAILED, error: verifyResult.message };
        }

        await stageFSM.send(StageEvent.VERIFY_PASS);
      }

      return { status: stageFSM.getState() };
    } catch (err) {
      stageFSM.setError(err.message);
      await stageFSM.send(StageEvent.EXEC_FAILED);
      return { status: StageState.FAILED, error: err.message };
    }
  }

  /**
   * Skip a stage
   * @param {string} stageId - Stage ID
   * @param {string} reason - Skip reason
   */
  async skipStage(stageId, reason) {
    const stageFSM = this.factoryFSM.getStageMachine(stageId);
    if (stageFSM) {
      await stageFSM.send(StageEvent.SKIP, { reason });
      this.emit('stage:skipped', { stageId, reason });
    }
  }

  /**
   * Save checkpoint with FSM state
   */
  saveCheckpoint() {
    const checkpointData = {
      factory_name: this.factory.name,
      run_id: path.basename(this.runDir),
      current_stage: this.factoryFSM.context.stages
        ? Array.from(this.factoryFSM.context.stages.entries())
            .filter(([, state]) => state === StageState.EXECUTING)
            .map(([id]) => id)[0]
        : null,
      completed_stages: this.factoryFSM.context.completedStages,
      failed_stages: this.factoryFSM.context.failedStages,
      skipped_stages: this.factoryFSM.context.skippedStages,
      recursion_count: this.context.recursion_count,
      // FSM state for recovery
      fsm_state: {
        factory: this.factoryFSM.serialize(),
        stages: Object.fromEntries(
          Array.from(this.factoryFSM.stageMachines.entries())
            .map(([id, fsm]) => [id, fsm.serialize()])
        )
      }
    };

    checkpoint.saveCheckpoint(this.runDir, checkpointData);
  }

  /**
   * Build execution result
   * @returns {Object} Execution result
   */
  buildResult() {
    const factoryState = this.factoryFSM.getState();
    const success = factoryState === FactoryState.COMPLETED;

    return {
      success,
      state: factoryState,
      runId: path.basename(this.runDir),
      completedStages: [...this.factoryFSM.context.completedStages],
      failedStages: [...this.factoryFSM.context.failedStages],
      skippedStages: [...this.factoryFSM.context.skippedStages],
      stageResults: Object.fromEntries(
        Array.from(this.factoryFSM.stageMachines.entries())
          .map(([id, fsm]) => [id, {
            state: fsm.getState(),
            result: fsm.context.executionResult,
            error: fsm.context.error
          }])
      ),
      fsmState: this.factoryFSM.serialize(),
      error: this.factoryFSM.context.failedStages.length > 0
        ? `Failed stages: ${this.factoryFSM.context.failedStages.join(', ')}`
        : null
    };
  }

  /**
   * Stop execution
   */
  stop() {
    this.stopped = true;
    if (this.executor) {
      this.executor.stop();
    }
    this.emit('factory:stopped');
  }

  /**
   * Resume from checkpoint
   * @param {string} projectRoot - Project root
   * @param {string} factoryName - Factory name
   * @param {string} runDir - Run directory with checkpoint
   * @param {Object} options - Options
   * @returns {Promise<FactoryOrchestrator>} Restored orchestrator
   */
  static async resumeFromCheckpoint(projectRoot, factoryName, runDir, options = {}) {
    // Load checkpoint
    const checkpointResult = checkpoint.loadCheckpoint(runDir);
    if (!checkpointResult.success) {
      throw new Error(checkpointResult.error);
    }

    const savedCheckpoint = checkpointResult.checkpoint;

    // Load factory configuration
    const factoryDir = path.join(projectRoot, '.ralph', 'factory');
    const factoryPath = path.join(factoryDir, `${factoryName}.yaml`);

    if (!fs.existsSync(factoryPath)) {
      throw new Error(`Factory not found: ${factoryName}`);
    }

    const parseResult = parser.parseFactory(factoryPath);

    if (!parseResult.success) {
      throw new Error(`Failed to parse factory: ${parseResult.error}`);
    }

    const factory = parseResult.factory;

    // Validate checkpoint
    const validation = checkpoint.validateCheckpoint(savedCheckpoint, factory);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    // Create orchestrator
    const orchestrator = new FactoryOrchestrator(factory, projectRoot, runDir, options);

    // Restore FSM states if available
    if (savedCheckpoint.fsm_state) {
      // Restore factory FSM state
      orchestrator.factoryFSM.currentState = savedCheckpoint.fsm_state.factory?.currentState || FactoryState.IDLE;
      orchestrator.factoryFSM.context = {
        ...orchestrator.factoryFSM.context,
        ...savedCheckpoint.fsm_state.factory?.context,
        stages: new Map(savedCheckpoint.fsm_state.factory?.context?.stages || [])
      };

      // Restore stage FSM states
      for (const [stageId, stageData] of Object.entries(savedCheckpoint.fsm_state.stages || {})) {
        const stageFSM = orchestrator.factoryFSM.getStageMachine(stageId);
        if (stageFSM) {
          stageFSM.currentState = stageData.currentState;
          stageFSM.context = { ...stageFSM.context, ...stageData.context };
        }
      }
    } else {
      // Legacy checkpoint - restore from stage lists
      for (const stageId of savedCheckpoint.completed_stages || []) {
        const stageFSM = orchestrator.factoryFSM.getStageMachine(stageId);
        if (stageFSM) {
          stageFSM.currentState = StageState.COMPLETED;
        }
      }

      for (const stageId of savedCheckpoint.failed_stages || []) {
        const stageFSM = orchestrator.factoryFSM.getStageMachine(stageId);
        if (stageFSM) {
          stageFSM.currentState = StageState.FAILED;
        }
      }

      for (const stageId of savedCheckpoint.skipped_stages || []) {
        const stageFSM = orchestrator.factoryFSM.getStageMachine(stageId);
        if (stageFSM) {
          stageFSM.currentState = StageState.SKIPPED;
        }
      }
    }

    // Update factory FSM stats
    orchestrator.factoryFSM.updateStageStats();

    return orchestrator;
  }

  /**
   * Get current status
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      factoryState: this.factoryFSM.getState(),
      stages: Object.fromEntries(
        Array.from(this.factoryFSM.stageMachines.entries())
          .map(([id, fsm]) => [id, {
            state: fsm.getState(),
            history: fsm.history.slice(-5).map(h => h.toJSON())
          }])
      ),
      completedStages: this.factoryFSM.context.completedStages,
      failedStages: this.factoryFSM.context.failedStages,
      skippedStages: this.factoryFSM.context.skippedStages
    };
  }
}

/**
 * Run a factory using FSM-based orchestration
 * @param {string} projectRoot - Project root
 * @param {string} factoryName - Factory name
 * @param {Object} options - Options
 * @returns {Promise<Object>} Execution result
 */
async function runFactoryFSM(projectRoot, factoryName, options = {}) {
  const factoryDir = path.join(projectRoot, '.ralph', 'factory');
  const factoryPath = path.join(factoryDir, `${factoryName}.yaml`);

  if (!fs.existsSync(factoryPath)) {
    return {
      success: false,
      error: `Factory not found: ${factoryName}`
    };
  }

  // Parse factory
  const parseResult = parser.parseFactory(factoryPath);

  if (!parseResult.success) {
    return {
      success: false,
      error: `Failed to parse factory: ${parseResult.error}`
    };
  }

  const factory = parseResult.factory;

  // Create run directory
  const runsDir = path.join(factoryDir, 'runs');
  const runId = `run-${Date.now()}`;
  const runDir = path.join(runsDir, runId);

  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(runDir, 'stages'), { recursive: true });

  // Create orchestrator
  const orchestrator = new FactoryOrchestrator(factory, projectRoot, runDir, {
    ...options,
    variables: {
      ...factory.variables,
      ...options.variables
    }
  });

  // Run
  return orchestrator.run(options.variables || {});
}

/**
 * Resume a factory from checkpoint using FSM
 * @param {string} projectRoot - Project root
 * @param {string} factoryName - Factory name
 * @param {Object} options - Options
 * @returns {Promise<Object>} Execution result
 */
async function resumeFactoryFSM(projectRoot, factoryName, options = {}) {
  // Find latest run with checkpoint
  const factoryDir = path.join(projectRoot, '.ralph', 'factory');
  const runsDir = path.join(factoryDir, 'runs');

  if (!fs.existsSync(runsDir)) {
    return {
      success: false,
      error: 'No runs found for this factory'
    };
  }

  // Find runs with checkpoints
  const runs = fs.readdirSync(runsDir)
    .filter(d => d.startsWith('run-'))
    .filter(d => checkpoint.hasCheckpoint(path.join(runsDir, d)))
    .sort()
    .reverse();

  if (runs.length === 0) {
    return {
      success: false,
      error: 'No checkpointed runs found'
    };
  }

  const latestRunDir = path.join(runsDir, runs[0]);

  // Resume orchestrator
  const orchestrator = await FactoryOrchestrator.resumeFromCheckpoint(
    projectRoot,
    factoryName,
    latestRunDir,
    options
  );

  // Transition to RUNNING and continue
  await orchestrator.factoryFSM.send(FactoryEvent.RESUME);

  return orchestrator.run(options.variables || {});
}

module.exports = {
  FactoryOrchestrator,
  runFactoryFSM,
  resumeFactoryFSM
};
