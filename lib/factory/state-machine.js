/**
 * Factory Mode State Machine Module
 *
 * Provides explicit state machine pattern for factory execution with:
 * - Event-driven transitions
 * - Guard conditions
 * - Entry/exit actions
 * - Full state history for debugging
 * - Serialization for checkpoint/resume
 */

'use strict';

// ============================================================================
// STATE DEFINITIONS
// ============================================================================

/**
 * Factory-level states
 */
const FactoryState = {
  IDLE: 'IDLE',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  STOPPED: 'STOPPED'
};

/**
 * Stage-level states
 */
const StageState = {
  PENDING: 'PENDING',
  READY: 'READY',
  EXECUTING: 'EXECUTING',
  VERIFYING: 'VERIFYING',
  RETRYING: 'RETRYING',
  LOOPING: 'LOOPING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  SKIPPED: 'SKIPPED'
};

/**
 * Factory-level events
 */
const FactoryEvent = {
  START: 'START',
  ALL_COMPLETED: 'ALL_COMPLETED',
  ANY_FAILED: 'ANY_FAILED',
  STOP: 'STOP',
  RESUME: 'RESUME',
  RESET: 'RESET'
};

/**
 * Stage-level events
 */
const StageEvent = {
  DEPS_MET: 'DEPS_MET',
  DEPS_FAILED: 'DEPS_FAILED',
  CONDITION_FALSE: 'CONDITION_FALSE',
  EXECUTE: 'EXECUTE',
  EXEC_SUCCESS: 'EXEC_SUCCESS',
  EXEC_FAILED: 'EXEC_FAILED',
  VERIFY_PASS: 'VERIFY_PASS',
  VERIFY_FAIL: 'VERIFY_FAIL',
  LOOP: 'LOOP',
  RETRY: 'RETRY',
  SKIP: 'SKIP'
};

// ============================================================================
// STATE HISTORY
// ============================================================================

/**
 * Entry in the state history for audit trail
 */
class StateHistoryEntry {
  constructor(fromState, toState, event, payload = null) {
    this.fromState = fromState;
    this.toState = toState;
    this.event = event;
    this.payload = payload;
    this.timestamp = new Date().toISOString();
  }

  toJSON() {
    return {
      fromState: this.fromState,
      toState: this.toState,
      event: this.event,
      payload: this.payload,
      timestamp: this.timestamp
    };
  }
}

// ============================================================================
// BASE STATE MACHINE
// ============================================================================

/**
 * Base state machine class with event-driven transitions
 */
class StateMachine {
  constructor(id, initialState, transitions, options = {}) {
    this.id = id;
    this.currentState = initialState;
    this.transitions = transitions;
    this.history = [];
    this.context = options.context || {};
    this.listeners = new Map();
    this.entryActions = options.entryActions || {};
    this.exitActions = options.exitActions || {};
    this.maxHistorySize = options.maxHistorySize || 100;
    this.createdAt = new Date().toISOString();
    this.updatedAt = this.createdAt;
  }

  /**
   * Get current state
   */
  getState() {
    return this.currentState;
  }

  /**
   * Check if in a specific state
   */
  isIn(state) {
    return this.currentState === state;
  }

  /**
   * Check if in a terminal state
   */
  isTerminal() {
    return false; // Override in subclasses
  }

  /**
   * Send an event to trigger a transition
   * @param {string} event - The event to send
   * @param {object} payload - Optional payload data
   * @returns {Promise<{success: boolean, fromState: string, toState: string, error?: string}>}
   */
  async send(event, payload = {}) {
    const fromState = this.currentState;

    // Find matching transition
    const transition = this.findTransition(event);

    if (!transition) {
      return {
        success: false,
        fromState,
        toState: fromState,
        error: `No transition for event '${event}' in state '${fromState}'`
      };
    }

    // Check guard condition if present
    if (transition.guard && !transition.guard(this.context, payload)) {
      return {
        success: false,
        fromState,
        toState: fromState,
        error: `Guard condition failed for transition ${fromState} --${event}--> ${transition.target}`
      };
    }

    const toState = transition.target;

    // Execute exit action for current state
    if (this.exitActions[fromState]) {
      try {
        await this.exitActions[fromState](this.context, payload);
      } catch (err) {
        return {
          success: false,
          fromState,
          toState: fromState,
          error: `Exit action failed: ${err.message}`
        };
      }
    }

    // Execute transition action if present
    if (transition.action) {
      try {
        await transition.action(this.context, payload);
      } catch (err) {
        return {
          success: false,
          fromState,
          toState: fromState,
          error: `Transition action failed: ${err.message}`
        };
      }
    }

    // Perform the state change
    this.currentState = toState;
    this.updatedAt = new Date().toISOString();

    // Record in history
    const historyEntry = new StateHistoryEntry(fromState, toState, event, payload);
    this.history.push(historyEntry);

    // Trim history if exceeds max size
    if (this.history.length > this.maxHistorySize) {
      this.history = this.history.slice(-this.maxHistorySize);
    }

    // Execute entry action for new state
    if (this.entryActions[toState]) {
      try {
        await this.entryActions[toState](this.context, payload);
      } catch (err) {
        // Log but don't fail the transition since state already changed
        console.warn(`Entry action failed for state ${toState}: ${err.message}`);
      }
    }

    // Emit state change event
    this.emit('transition', { fromState, toState, event, payload });
    this.emit(`state:${toState}`, { fromState, event, payload });

    return {
      success: true,
      fromState,
      toState
    };
  }

  /**
   * Find a valid transition for the given event from current state
   */
  findTransition(event) {
    const stateTransitions = this.transitions[this.currentState];
    if (!stateTransitions) return null;
    return stateTransitions[event] || null;
  }

  /**
   * Check if an event can be sent (has valid transition)
   */
  can(event) {
    return this.findTransition(event) !== null;
  }

  /**
   * Get available events from current state
   */
  getAvailableEvents() {
    const stateTransitions = this.transitions[this.currentState];
    if (!stateTransitions) return [];
    return Object.keys(stateTransitions);
  }

  /**
   * Subscribe to events
   */
  on(eventName, callback) {
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, []);
    }
    this.listeners.get(eventName).push(callback);
    return () => this.off(eventName, callback);
  }

  /**
   * Unsubscribe from events
   */
  off(eventName, callback) {
    if (this.listeners.has(eventName)) {
      const callbacks = this.listeners.get(eventName);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Emit an event to listeners
   */
  emit(eventName, data) {
    if (this.listeners.has(eventName)) {
      for (const callback of this.listeners.get(eventName)) {
        try {
          callback(data);
        } catch (err) {
          console.warn(`Event listener error for ${eventName}: ${err.message}`);
        }
      }
    }
  }

  /**
   * Update context
   */
  updateContext(updates) {
    this.context = { ...this.context, ...updates };
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Serialize state machine for persistence
   */
  serialize() {
    return {
      id: this.id,
      currentState: this.currentState,
      context: this.context,
      history: this.history.map(h => h.toJSON()),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  /**
   * Restore state machine from serialized data
   */
  static deserialize(data, transitions, options = {}) {
    const machine = new this(data.id, data.currentState, transitions, options);
    machine.context = data.context || {};
    machine.history = (data.history || []).map(h =>
      Object.assign(new StateHistoryEntry(h.fromState, h.toState, h.event, h.payload), { timestamp: h.timestamp })
    );
    machine.createdAt = data.createdAt;
    machine.updatedAt = data.updatedAt;
    return machine;
  }
}

// ============================================================================
// FACTORY STATE MACHINE
// ============================================================================

/**
 * Factory-level state machine
 * States: IDLE → RUNNING → COMPLETED | FAILED | STOPPED
 */
class FactoryStateMachine extends StateMachine {
  constructor(factoryName, options = {}) {
    const transitions = {
      [FactoryState.IDLE]: {
        [FactoryEvent.START]: { target: FactoryState.RUNNING }
      },
      [FactoryState.RUNNING]: {
        [FactoryEvent.ALL_COMPLETED]: { target: FactoryState.COMPLETED },
        [FactoryEvent.ANY_FAILED]: {
          target: FactoryState.FAILED,
          guard: (ctx) => !ctx.continueOnFailure
        },
        [FactoryEvent.STOP]: { target: FactoryState.STOPPED }
      },
      [FactoryState.COMPLETED]: {
        [FactoryEvent.RESET]: { target: FactoryState.IDLE }
      },
      [FactoryState.FAILED]: {
        [FactoryEvent.RESUME]: { target: FactoryState.RUNNING },
        [FactoryEvent.RESET]: { target: FactoryState.IDLE }
      },
      [FactoryState.STOPPED]: {
        [FactoryEvent.RESUME]: { target: FactoryState.RUNNING },
        [FactoryEvent.RESET]: { target: FactoryState.IDLE }
      }
    };

    super(factoryName, FactoryState.IDLE, transitions, {
      context: {
        factoryName,
        continueOnFailure: options.continueOnFailure || false,
        stages: new Map(),
        completedStages: [],
        failedStages: [],
        skippedStages: [],
        startedAt: null,
        completedAt: null,
        ...options.context
      },
      entryActions: {
        [FactoryState.RUNNING]: async (ctx) => {
          if (!ctx.startedAt) {
            ctx.startedAt = new Date().toISOString();
          }
        },
        [FactoryState.COMPLETED]: async (ctx) => {
          ctx.completedAt = new Date().toISOString();
        },
        [FactoryState.FAILED]: async (ctx) => {
          ctx.completedAt = new Date().toISOString();
        },
        [FactoryState.STOPPED]: async (ctx) => {
          ctx.stoppedAt = new Date().toISOString();
        }
      },
      ...options
    });

    this.stageMachines = new Map();
  }

  /**
   * Check if factory is in a terminal state
   */
  isTerminal() {
    return [FactoryState.COMPLETED, FactoryState.FAILED, FactoryState.STOPPED]
      .includes(this.currentState);
  }

  /**
   * Add a stage state machine
   */
  addStageMachine(stageId, stageMachine) {
    this.stageMachines.set(stageId, stageMachine);
    this.context.stages.set(stageId, stageMachine.getState());

    // Listen for stage state changes
    stageMachine.on('transition', ({ toState }) => {
      this.context.stages.set(stageId, toState);
      this.updateStageStats();
    });
  }

  /**
   * Get a stage state machine
   */
  getStageMachine(stageId) {
    return this.stageMachines.get(stageId);
  }

  /**
   * Update completed/failed/skipped stage lists
   */
  updateStageStats() {
    this.context.completedStages = [];
    this.context.failedStages = [];
    this.context.skippedStages = [];

    for (const [stageId, machine] of this.stageMachines) {
      const state = machine.getState();
      if (state === StageState.COMPLETED) {
        this.context.completedStages.push(stageId);
      } else if (state === StageState.FAILED) {
        this.context.failedStages.push(stageId);
      } else if (state === StageState.SKIPPED) {
        this.context.skippedStages.push(stageId);
      }
    }
  }

  /**
   * Check if all stages are in terminal states
   */
  allStagesTerminal() {
    for (const machine of this.stageMachines.values()) {
      if (!machine.isTerminal()) {
        return false;
      }
    }
    return true;
  }

  /**
   * Check if any stage has failed
   */
  hasFailedStages() {
    for (const machine of this.stageMachines.values()) {
      if (machine.getState() === StageState.FAILED) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get stages in a specific state
   */
  getStagesInState(state) {
    const stages = [];
    for (const [stageId, machine] of this.stageMachines) {
      if (machine.getState() === state) {
        stages.push(stageId);
      }
    }
    return stages;
  }

  /**
   * Serialize factory state machine including all stage machines
   */
  serialize() {
    const base = super.serialize();
    return {
      ...base,
      type: 'factory',
      context: {
        ...base.context,
        stages: Array.from(this.context.stages.entries())
      },
      stageMachines: Object.fromEntries(
        Array.from(this.stageMachines.entries()).map(([id, machine]) => [id, machine.serialize()])
      )
    };
  }

  /**
   * Restore factory state machine from serialized data
   */
  static deserialize(data, stageConfigs, options = {}) {
    const factory = new FactoryStateMachine(data.id, {
      ...options,
      context: {
        ...data.context,
        stages: new Map(data.context.stages || [])
      }
    });
    factory.currentState = data.currentState;
    factory.history = (data.history || []).map(h =>
      Object.assign(new StateHistoryEntry(h.fromState, h.toState, h.event, h.payload), { timestamp: h.timestamp })
    );
    factory.createdAt = data.createdAt;
    factory.updatedAt = data.updatedAt;

    // Restore stage machines
    if (data.stageMachines) {
      for (const [stageId, stageData] of Object.entries(data.stageMachines)) {
        const stageConfig = stageConfigs[stageId] || {};
        const stageMachine = StageStateMachine.deserialize(stageData, stageConfig);
        factory.addStageMachine(stageId, stageMachine);
      }
    }

    return factory;
  }
}

// ============================================================================
// STAGE STATE MACHINE
// ============================================================================

/**
 * Stage-level state machine
 * States: PENDING → READY → EXECUTING → VERIFYING → COMPLETED | FAILED | SKIPPED
 */
class StageStateMachine extends StateMachine {
  constructor(stageId, stageConfig = {}, options = {}) {
    const transitions = {
      [StageState.PENDING]: {
        [StageEvent.DEPS_MET]: { target: StageState.READY },
        [StageEvent.DEPS_FAILED]: { target: StageState.SKIPPED },
        [StageEvent.CONDITION_FALSE]: { target: StageState.SKIPPED },
        [StageEvent.SKIP]: { target: StageState.SKIPPED }
      },
      [StageState.READY]: {
        [StageEvent.EXECUTE]: { target: StageState.EXECUTING },
        [StageEvent.DEPS_FAILED]: { target: StageState.SKIPPED },
        [StageEvent.CONDITION_FALSE]: { target: StageState.SKIPPED },
        [StageEvent.SKIP]: { target: StageState.SKIPPED }
      },
      [StageState.EXECUTING]: {
        [StageEvent.EXEC_SUCCESS]: {
          target: StageState.VERIFYING,
          guard: (ctx) => ctx.hasVerification
        },
        [StageEvent.EXEC_SUCCESS + '_NO_VERIFY']: {
          target: StageState.COMPLETED,
          guard: (ctx) => !ctx.hasVerification
        },
        [StageEvent.EXEC_FAILED]: {
          target: StageState.RETRYING,
          guard: (ctx) => ctx.retriesLeft > 0
        },
        [StageEvent.EXEC_FAILED + '_NO_RETRY']: {
          target: StageState.FAILED,
          guard: (ctx) => ctx.retriesLeft <= 0
        }
      },
      [StageState.VERIFYING]: {
        [StageEvent.VERIFY_PASS]: { target: StageState.COMPLETED },
        [StageEvent.VERIFY_FAIL]: { target: StageState.FAILED },
        [StageEvent.LOOP]: { target: StageState.LOOPING }
      },
      [StageState.RETRYING]: {
        [StageEvent.RETRY]: {
          target: StageState.EXECUTING,
          action: async (ctx) => {
            ctx.retriesLeft--;
            ctx.retryCount++;
          }
        },
        [StageEvent.EXEC_FAILED]: { target: StageState.FAILED }
      },
      [StageState.LOOPING]: {
        [StageEvent.EXECUTE]: { target: StageState.EXECUTING }
      },
      [StageState.COMPLETED]: {
        [StageEvent.LOOP]: { target: StageState.LOOPING }
      },
      [StageState.FAILED]: {},
      [StageState.SKIPPED]: {}
    };

    super(stageId, StageState.PENDING, transitions, {
      context: {
        stageId,
        stageType: stageConfig.type || 'custom',
        hasVerification: !!(stageConfig.verify && stageConfig.verify.length > 0),
        retriesLeft: stageConfig.retries || 0,
        maxRetries: stageConfig.retries || 0,
        retryCount: 0,
        loopTo: stageConfig.loop_to || null,
        loopCount: 0,
        maxLoops: stageConfig.max_loops || 10,
        condition: stageConfig.condition || null,
        dependsOn: stageConfig.depends_on || [],
        executionResult: null,
        verificationResult: null,
        error: null,
        startedAt: null,
        completedAt: null,
        ...options.context
      },
      entryActions: {
        [StageState.EXECUTING]: async (ctx) => {
          if (!ctx.startedAt) {
            ctx.startedAt = new Date().toISOString();
          }
          ctx.executionStartedAt = new Date().toISOString();
        },
        [StageState.COMPLETED]: async (ctx) => {
          ctx.completedAt = new Date().toISOString();
        },
        [StageState.FAILED]: async (ctx) => {
          ctx.completedAt = new Date().toISOString();
        },
        [StageState.SKIPPED]: async (ctx) => {
          ctx.completedAt = new Date().toISOString();
        },
        [StageState.LOOPING]: async (ctx) => {
          ctx.loopCount++;
        }
      },
      ...options
    });

    this.stageConfig = stageConfig;
  }

  /**
   * Check if stage is in a terminal state
   */
  isTerminal() {
    return [StageState.COMPLETED, StageState.FAILED, StageState.SKIPPED]
      .includes(this.currentState);
  }

  /**
   * Special send method that handles composite events
   * (e.g., EXEC_SUCCESS with or without verification)
   */
  async send(event, payload = {}) {
    // Handle composite events based on context
    if (event === StageEvent.EXEC_SUCCESS) {
      const actualEvent = this.context.hasVerification
        ? StageEvent.EXEC_SUCCESS
        : StageEvent.EXEC_SUCCESS + '_NO_VERIFY';
      return super.send(actualEvent, payload);
    }

    if (event === StageEvent.EXEC_FAILED) {
      const actualEvent = this.context.retriesLeft > 0
        ? StageEvent.EXEC_FAILED
        : StageEvent.EXEC_FAILED + '_NO_RETRY';
      return super.send(actualEvent, payload);
    }

    return super.send(event, payload);
  }

  /**
   * Set execution result
   */
  setExecutionResult(result) {
    this.context.executionResult = result;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Set verification result
   */
  setVerificationResult(result) {
    this.context.verificationResult = result;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Set error
   */
  setError(error) {
    this.context.error = error;
    this.updatedAt = new Date().toISOString();
  }

  /**
   * Check if can loop
   */
  canLoop() {
    return this.context.loopTo && this.context.loopCount < this.context.maxLoops;
  }

  /**
   * Serialize stage state machine
   */
  serialize() {
    const base = super.serialize();
    return {
      ...base,
      type: 'stage',
      stageConfig: this.stageConfig
    };
  }

  /**
   * Restore stage state machine from serialized data
   */
  static deserialize(data, stageConfig = null) {
    const config = stageConfig || data.stageConfig || {};
    const stage = new StageStateMachine(data.id, config, {
      context: data.context
    });
    stage.currentState = data.currentState;
    stage.history = (data.history || []).map(h =>
      Object.assign(new StateHistoryEntry(h.fromState, h.toState, h.event, h.payload), { timestamp: h.timestamp })
    );
    stage.createdAt = data.createdAt;
    stage.updatedAt = data.updatedAt;
    return stage;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // States
  FactoryState,
  StageState,

  // Events
  FactoryEvent,
  StageEvent,

  // Classes
  StateHistoryEntry,
  StateMachine,
  FactoryStateMachine,
  StageStateMachine
};
