/**
 * Unit tests for Factory State Machine Module
 *
 * Tests state transitions, guards, events, and serialization for:
 * - Base StateMachine class
 * - FactoryStateMachine
 * - StageStateMachine
 *
 * Run with: node tests/factory-state-machine.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateMachine = require(path.join(repoRoot, "lib", "factory", "state-machine.js"));

const {
  FactoryState,
  StageState,
  FactoryEvent,
  StageEvent,
  StateMachine,
  FactoryStateMachine,
  StageStateMachine,
  StateHistoryEntry
} = stateMachine;

// Track test results
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    const result = fn();
    if (result instanceof Promise) {
      result
        .then(() => {
          console.log("PASS");
          passed++;
        })
        .catch((err) => {
          console.log("FAIL");
          failures.push({ name, error: err.message });
          failed++;
        });
    } else {
      console.log("PASS");
      passed++;
    }
  } catch (err) {
    console.log("FAIL");
    failures.push({ name, error: err.message });
    failed++;
  }
}

async function asyncTest(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL");
    failures.push({ name, error: err.message });
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || "Assertion failed");
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
    );
  }
}

function assertIncludes(array, item, message) {
  if (!array.includes(item)) {
    throw new Error(message || `Array ${JSON.stringify(array)} does not include ${JSON.stringify(item)}`);
  }
}

console.log("\nRunning Factory State Machine Unit Tests");
console.log("=========================================\n");

// ============================================================================
// StateHistoryEntry Tests
// ============================================================================

console.log("StateHistoryEntry Tests:");

test("StateHistoryEntry creates valid entry", () => {
  const entry = new StateHistoryEntry("IDLE", "RUNNING", "START", { foo: "bar" });

  assertEqual(entry.fromState, "IDLE");
  assertEqual(entry.toState, "RUNNING");
  assertEqual(entry.event, "START");
  assertEqual(entry.payload.foo, "bar");
  assert(entry.timestamp, "Should have timestamp");
});

test("StateHistoryEntry serializes to JSON", () => {
  const entry = new StateHistoryEntry("A", "B", "GO", null);
  const json = entry.toJSON();

  assertEqual(json.fromState, "A");
  assertEqual(json.toState, "B");
  assertEqual(json.event, "GO");
  assert(json.timestamp, "JSON should have timestamp");
});

// ============================================================================
// Base StateMachine Tests
// ============================================================================

console.log("\nBase StateMachine Tests:");

test("StateMachine initializes with correct state", () => {
  const transitions = {
    IDLE: { START: { target: "RUNNING" } },
    RUNNING: { STOP: { target: "IDLE" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);

  assertEqual(machine.getState(), "IDLE");
  assertEqual(machine.id, "test");
  assert(machine.isIn("IDLE"), "Should be in IDLE state");
  assert(!machine.isIn("RUNNING"), "Should not be in RUNNING state");
});

test("StateMachine.can() returns correct availability", () => {
  const transitions = {
    IDLE: { START: { target: "RUNNING" } },
    RUNNING: { STOP: { target: "IDLE" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);

  assert(machine.can("START"), "Should be able to START from IDLE");
  assert(!machine.can("STOP"), "Should not be able to STOP from IDLE");
});

test("StateMachine.getAvailableEvents() returns events", () => {
  const transitions = {
    IDLE: {
      START: { target: "RUNNING" },
      CONFIGURE: { target: "CONFIGURED" }
    },
    RUNNING: { STOP: { target: "IDLE" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);
  const events = machine.getAvailableEvents();

  assertIncludes(events, "START");
  assertIncludes(events, "CONFIGURE");
  assertEqual(events.length, 2);
});

// ============================================================================
// Async StateMachine Tests
// ============================================================================

console.log("\nAsync StateMachine Tests:");

await asyncTest("StateMachine.send() transitions state", async () => {
  const transitions = {
    IDLE: { START: { target: "RUNNING" } },
    RUNNING: { STOP: { target: "IDLE" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);

  const result = await machine.send("START");

  assert(result.success, "Transition should succeed");
  assertEqual(result.fromState, "IDLE");
  assertEqual(result.toState, "RUNNING");
  assertEqual(machine.getState(), "RUNNING");
});

await asyncTest("StateMachine.send() fails for invalid event", async () => {
  const transitions = {
    IDLE: { START: { target: "RUNNING" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);

  const result = await machine.send("INVALID_EVENT");

  assert(!result.success, "Transition should fail");
  assert(result.error, "Should have error message");
  assertEqual(machine.getState(), "IDLE", "State should not change");
});

await asyncTest("StateMachine records history", async () => {
  const transitions = {
    A: { GO_B: { target: "B" } },
    B: { GO_C: { target: "C" } },
    C: {}
  };

  const machine = new StateMachine("test", "A", transitions);

  await machine.send("GO_B");
  await machine.send("GO_C");

  assertEqual(machine.history.length, 2);
  assertEqual(machine.history[0].fromState, "A");
  assertEqual(machine.history[0].toState, "B");
  assertEqual(machine.history[1].fromState, "B");
  assertEqual(machine.history[1].toState, "C");
});

await asyncTest("StateMachine guard condition blocks transition", async () => {
  const transitions = {
    IDLE: {
      START: {
        target: "RUNNING",
        guard: (ctx) => ctx.allowed === true
      }
    }
  };

  const machine = new StateMachine("test", "IDLE", transitions, {
    context: { allowed: false }
  });

  const result = await machine.send("START");

  assert(!result.success, "Transition should be blocked by guard");
  assertEqual(machine.getState(), "IDLE", "State should not change");
});

await asyncTest("StateMachine guard condition allows transition", async () => {
  const transitions = {
    IDLE: {
      START: {
        target: "RUNNING",
        guard: (ctx) => ctx.allowed === true
      }
    }
  };

  const machine = new StateMachine("test", "IDLE", transitions, {
    context: { allowed: true }
  });

  const result = await machine.send("START");

  assert(result.success, "Transition should be allowed by guard");
  assertEqual(machine.getState(), "RUNNING");
});

await asyncTest("StateMachine executes transition action", async () => {
  let actionCalled = false;

  const transitions = {
    IDLE: {
      START: {
        target: "RUNNING",
        action: async () => {
          actionCalled = true;
        }
      }
    }
  };

  const machine = new StateMachine("test", "IDLE", transitions);

  await machine.send("START");

  assert(actionCalled, "Transition action should be called");
});

await asyncTest("StateMachine executes entry actions", async () => {
  let entryActionCalled = false;

  const transitions = {
    IDLE: { START: { target: "RUNNING" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions, {
    entryActions: {
      RUNNING: async () => {
        entryActionCalled = true;
      }
    }
  });

  await machine.send("START");

  assert(entryActionCalled, "Entry action for RUNNING should be called");
});

await asyncTest("StateMachine executes exit actions", async () => {
  let exitActionCalled = false;

  const transitions = {
    IDLE: { START: { target: "RUNNING" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions, {
    exitActions: {
      IDLE: async () => {
        exitActionCalled = true;
      }
    }
  });

  await machine.send("START");

  assert(exitActionCalled, "Exit action for IDLE should be called");
});

// ============================================================================
// StateMachine Event Emitter Tests
// ============================================================================

console.log("\nStateMachine Event Emitter Tests:");

await asyncTest("StateMachine emits transition event", async () => {
  let eventReceived = null;

  const transitions = {
    IDLE: { START: { target: "RUNNING" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);
  machine.on("transition", (data) => {
    eventReceived = data;
  });

  await machine.send("START");

  assert(eventReceived, "Should receive transition event");
  assertEqual(eventReceived.fromState, "IDLE");
  assertEqual(eventReceived.toState, "RUNNING");
  assertEqual(eventReceived.event, "START");
});

await asyncTest("StateMachine emits state-specific events", async () => {
  let stateEventReceived = false;

  const transitions = {
    IDLE: { START: { target: "RUNNING" } }
  };

  const machine = new StateMachine("test", "IDLE", transitions);
  machine.on("state:RUNNING", () => {
    stateEventReceived = true;
  });

  await machine.send("START");

  assert(stateEventReceived, "Should receive state:RUNNING event");
});

await asyncTest("StateMachine.off() removes listener", async () => {
  let callCount = 0;

  const transitions = {
    A: { GO: { target: "B" } },
    B: { GO: { target: "C" } },
    C: {}
  };

  const machine = new StateMachine("test", "A", transitions);

  const listener = () => { callCount++; };
  machine.on("transition", listener);

  await machine.send("GO");
  assertEqual(callCount, 1);

  machine.off("transition", listener);
  await machine.send("GO");
  assertEqual(callCount, 1, "Listener should not be called after removal");
});

// ============================================================================
// StateMachine Serialization Tests
// ============================================================================

console.log("\nStateMachine Serialization Tests:");

await asyncTest("StateMachine.serialize() returns valid structure", async () => {
  const transitions = {
    IDLE: { START: { target: "RUNNING" } },
    RUNNING: {}
  };

  const machine = new StateMachine("test", "IDLE", transitions, {
    context: { foo: "bar" }
  });

  await machine.send("START");

  const serialized = machine.serialize();

  assertEqual(serialized.id, "test");
  assertEqual(serialized.currentState, "RUNNING");
  assertEqual(serialized.context.foo, "bar");
  assert(Array.isArray(serialized.history), "Should have history array");
  assertEqual(serialized.history.length, 1);
  assert(serialized.createdAt, "Should have createdAt");
  assert(serialized.updatedAt, "Should have updatedAt");
});

// ============================================================================
// FactoryStateMachine Tests
// ============================================================================

console.log("\nFactoryStateMachine Tests:");

test("FactoryStateMachine initializes in IDLE state", () => {
  const factory = new FactoryStateMachine("my-factory");

  assertEqual(factory.getState(), FactoryState.IDLE);
  assertEqual(factory.id, "my-factory");
  assert(!factory.isTerminal(), "Should not be in terminal state");
});

await asyncTest("FactoryStateMachine START transitions to RUNNING", async () => {
  const factory = new FactoryStateMachine("test-factory");

  const result = await factory.send(FactoryEvent.START);

  assert(result.success, "START should succeed");
  assertEqual(factory.getState(), FactoryState.RUNNING);
});

await asyncTest("FactoryStateMachine ALL_COMPLETED transitions to COMPLETED", async () => {
  const factory = new FactoryStateMachine("test-factory");

  await factory.send(FactoryEvent.START);
  await factory.send(FactoryEvent.ALL_COMPLETED);

  assertEqual(factory.getState(), FactoryState.COMPLETED);
  assert(factory.isTerminal(), "COMPLETED should be terminal");
});

await asyncTest("FactoryStateMachine STOP transitions to STOPPED", async () => {
  const factory = new FactoryStateMachine("test-factory");

  await factory.send(FactoryEvent.START);
  await factory.send(FactoryEvent.STOP);

  assertEqual(factory.getState(), FactoryState.STOPPED);
  assert(factory.isTerminal(), "STOPPED should be terminal");
});

await asyncTest("FactoryStateMachine ANY_FAILED transitions to FAILED", async () => {
  const factory = new FactoryStateMachine("test-factory");

  await factory.send(FactoryEvent.START);
  await factory.send(FactoryEvent.ANY_FAILED);

  assertEqual(factory.getState(), FactoryState.FAILED);
  assert(factory.isTerminal(), "FAILED should be terminal");
});

await asyncTest("FactoryStateMachine RESUME transitions from FAILED to RUNNING", async () => {
  const factory = new FactoryStateMachine("test-factory");

  await factory.send(FactoryEvent.START);
  await factory.send(FactoryEvent.ANY_FAILED);
  await factory.send(FactoryEvent.RESUME);

  assertEqual(factory.getState(), FactoryState.RUNNING);
});

await asyncTest("FactoryStateMachine RESET transitions to IDLE", async () => {
  const factory = new FactoryStateMachine("test-factory");

  await factory.send(FactoryEvent.START);
  await factory.send(FactoryEvent.ALL_COMPLETED);
  await factory.send(FactoryEvent.RESET);

  assertEqual(factory.getState(), FactoryState.IDLE);
});

await asyncTest("FactoryStateMachine continueOnFailure guard", async () => {
  const factory = new FactoryStateMachine("test-factory", {
    continueOnFailure: true
  });

  await factory.send(FactoryEvent.START);

  // With continueOnFailure=true, ANY_FAILED should NOT transition
  const result = await factory.send(FactoryEvent.ANY_FAILED);

  assert(!result.success, "Guard should block transition when continueOnFailure is true");
  assertEqual(factory.getState(), FactoryState.RUNNING);
});

// ============================================================================
// FactoryStateMachine with Stage Machines Tests
// ============================================================================

console.log("\nFactoryStateMachine Stage Management Tests:");

await asyncTest("FactoryStateMachine manages stage machines", async () => {
  const factory = new FactoryStateMachine("test-factory");

  const stage1 = new StageStateMachine("stage1", { type: "prd" });
  const stage2 = new StageStateMachine("stage2", { type: "build", depends_on: ["stage1"] });

  factory.addStageMachine("stage1", stage1);
  factory.addStageMachine("stage2", stage2);

  const retrieved = factory.getStageMachine("stage1");
  assertEqual(retrieved, stage1, "Should retrieve added stage machine");

  const stages = factory.context.stages;
  assert(stages.get("stage1"), "Stage1 should be in context");
  assert(stages.get("stage2"), "Stage2 should be in context");
});

await asyncTest("FactoryStateMachine tracks stage completion", async () => {
  const factory = new FactoryStateMachine("test-factory");

  const stage1 = new StageStateMachine("stage1", { type: "prd" });
  factory.addStageMachine("stage1", stage1);

  // Simulate stage completion
  await stage1.send(StageEvent.DEPS_MET);
  await stage1.send(StageEvent.EXECUTE);
  await stage1.send(StageEvent.EXEC_SUCCESS);

  factory.updateStageStats();

  assertIncludes(factory.context.completedStages, "stage1");
});

await asyncTest("FactoryStateMachine.allStagesTerminal() works correctly", async () => {
  const factory = new FactoryStateMachine("test-factory");

  const stage1 = new StageStateMachine("stage1", { type: "prd" });
  const stage2 = new StageStateMachine("stage2", { type: "build" });

  factory.addStageMachine("stage1", stage1);
  factory.addStageMachine("stage2", stage2);

  assert(!factory.allStagesTerminal(), "Not all stages terminal initially");

  // Complete stage1
  await stage1.send(StageEvent.DEPS_MET);
  await stage1.send(StageEvent.EXECUTE);
  await stage1.send(StageEvent.EXEC_SUCCESS);

  assert(!factory.allStagesTerminal(), "Still not all terminal");

  // Complete stage2
  await stage2.send(StageEvent.DEPS_MET);
  await stage2.send(StageEvent.EXECUTE);
  await stage2.send(StageEvent.EXEC_SUCCESS);

  assert(factory.allStagesTerminal(), "All stages should be terminal now");
});

// ============================================================================
// StageStateMachine Tests
// ============================================================================

console.log("\nStageStateMachine Tests:");

test("StageStateMachine initializes in PENDING state", () => {
  const stage = new StageStateMachine("my-stage", { type: "prd" });

  assertEqual(stage.getState(), StageState.PENDING);
  assertEqual(stage.id, "my-stage");
  assert(!stage.isTerminal(), "PENDING should not be terminal");
});

await asyncTest("StageStateMachine DEPS_MET transitions to READY", async () => {
  const stage = new StageStateMachine("test-stage", { type: "build" });

  await stage.send(StageEvent.DEPS_MET);

  assertEqual(stage.getState(), StageState.READY);
});

await asyncTest("StageStateMachine EXECUTE transitions to EXECUTING", async () => {
  const stage = new StageStateMachine("test-stage", { type: "build" });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);

  assertEqual(stage.getState(), StageState.EXECUTING);
});

await asyncTest("StageStateMachine EXEC_SUCCESS transitions to COMPLETED (no verify)", async () => {
  const stage = new StageStateMachine("test-stage", { type: "build" });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);
  await stage.send(StageEvent.EXEC_SUCCESS);

  assertEqual(stage.getState(), StageState.COMPLETED);
  assert(stage.isTerminal(), "COMPLETED should be terminal");
});

await asyncTest("StageStateMachine EXEC_SUCCESS transitions to VERIFYING (with verify)", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    verify: [{ type: "test_suite" }]
  });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);
  await stage.send(StageEvent.EXEC_SUCCESS);

  assertEqual(stage.getState(), StageState.VERIFYING);
});

await asyncTest("StageStateMachine VERIFY_PASS transitions to COMPLETED", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    verify: [{ type: "test_suite" }]
  });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);
  await stage.send(StageEvent.EXEC_SUCCESS);
  await stage.send(StageEvent.VERIFY_PASS);

  assertEqual(stage.getState(), StageState.COMPLETED);
});

await asyncTest("StageStateMachine VERIFY_FAIL transitions to FAILED", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    verify: [{ type: "test_suite" }]
  });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);
  await stage.send(StageEvent.EXEC_SUCCESS);
  await stage.send(StageEvent.VERIFY_FAIL);

  assertEqual(stage.getState(), StageState.FAILED);
  assert(stage.isTerminal(), "FAILED should be terminal");
});

await asyncTest("StageStateMachine DEPS_FAILED transitions to SKIPPED", async () => {
  const stage = new StageStateMachine("test-stage", { type: "build" });

  await stage.send(StageEvent.DEPS_FAILED);

  assertEqual(stage.getState(), StageState.SKIPPED);
  assert(stage.isTerminal(), "SKIPPED should be terminal");
});

await asyncTest("StageStateMachine CONDITION_FALSE transitions to SKIPPED", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    condition: "{{ some_condition }}"
  });

  await stage.send(StageEvent.CONDITION_FALSE);

  assertEqual(stage.getState(), StageState.SKIPPED);
});

await asyncTest("StageStateMachine retry workflow", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    retries: 2
  });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);

  // First failure - should go to RETRYING
  await stage.send(StageEvent.EXEC_FAILED);
  assertEqual(stage.getState(), StageState.RETRYING);

  // Retry
  await stage.send(StageEvent.RETRY);
  assertEqual(stage.getState(), StageState.EXECUTING);
  assertEqual(stage.context.retryCount, 1);
  assertEqual(stage.context.retriesLeft, 1);

  // Second failure - still has retries
  await stage.send(StageEvent.EXEC_FAILED);
  assertEqual(stage.getState(), StageState.RETRYING);

  // Second retry
  await stage.send(StageEvent.RETRY);
  assertEqual(stage.context.retryCount, 2);
  assertEqual(stage.context.retriesLeft, 0);

  // Third failure - no retries left, should fail
  await stage.send(StageEvent.EXEC_FAILED);
  assertEqual(stage.getState(), StageState.FAILED);
});

await asyncTest("StageStateMachine LOOP transitions to LOOPING", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    loop_to: "earlier_stage"
  });

  await stage.send(StageEvent.DEPS_MET);
  await stage.send(StageEvent.EXECUTE);
  await stage.send(StageEvent.EXEC_SUCCESS);

  // After completion, can loop
  await stage.send(StageEvent.LOOP);

  assertEqual(stage.getState(), StageState.LOOPING);
  assertEqual(stage.context.loopCount, 1);
});

await asyncTest("StageStateMachine.canLoop() respects max_loops", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    loop_to: "earlier_stage",
    max_loops: 2
  });

  assert(stage.canLoop(), "Should be able to loop initially");

  stage.context.loopCount = 2;
  assert(!stage.canLoop(), "Should not be able to loop after max");
});

// ============================================================================
// StageStateMachine Serialization Tests
// ============================================================================

console.log("\nStageStateMachine Serialization Tests:");

await asyncTest("StageStateMachine.serialize() includes stage config", async () => {
  const stage = new StageStateMachine("test-stage", {
    type: "build",
    retries: 3,
    verify: [{ type: "test_suite" }]
  });

  await stage.send(StageEvent.DEPS_MET);

  const serialized = stage.serialize();

  assertEqual(serialized.type, "stage");
  assertEqual(serialized.currentState, StageState.READY);
  assert(serialized.stageConfig, "Should include stage config");
  assertEqual(serialized.stageConfig.type, "build");
  assertEqual(serialized.stageConfig.retries, 3);
});

await asyncTest("StageStateMachine.deserialize() restores state", async () => {
  const original = new StageStateMachine("test-stage", {
    type: "build",
    retries: 3
  });

  await original.send(StageEvent.DEPS_MET);
  await original.send(StageEvent.EXECUTE);

  original.setExecutionResult({ success: true });
  original.context.retryCount = 1;

  const serialized = original.serialize();
  const restored = StageStateMachine.deserialize(serialized);

  assertEqual(restored.getState(), StageState.EXECUTING);
  assertEqual(restored.context.retryCount, 1);
  assertEqual(restored.context.executionResult.success, true);
});

// ============================================================================
// Summary
// ============================================================================

// Wait a bit for async tests to complete
await new Promise(resolve => setTimeout(resolve, 100));

console.log("\n=========================================");
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const { name, error } of failures) {
    console.log(`  - ${name}: ${error}`);
  }
  process.exit(1);
}

console.log("\nAll tests passed!");
process.exit(0);
