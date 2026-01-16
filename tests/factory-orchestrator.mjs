/**
 * Integration tests for Factory Orchestrator
 *
 * Tests FSM-based execution coordination with scheduler, executor, and verifier.
 * Uses mock factories to avoid actual command execution.
 *
 * Run with: node tests/factory-orchestrator.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const {
  FactoryOrchestrator,
  runFactoryFSM,
  resumeFactoryFSM
} = require(path.join(repoRoot, "lib", "factory", "orchestrator.js"));

const {
  FactoryState,
  StageState
} = require(path.join(repoRoot, "lib", "factory", "state-machine.js"));

const checkpoint = require(path.join(repoRoot, "lib", "factory", "checkpoint.js"));

// Track test results
let passed = 0;
let failed = 0;
const failures = [];

async function asyncTest(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    await fn();
    console.log("PASS");
    passed++;
  } catch (err) {
    console.log("FAIL");
    failures.push({ name, error: err.message, stack: err.stack });
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

// Helper to create a test factory directory
function createTestFactory(tmpDir, factoryName, stages) {
  const factoryDir = path.join(tmpDir, ".ralph", "factory");
  mkdirSync(factoryDir, { recursive: true });

  // Build YAML content properly
  let yamlLines = [
    'version: "1"',
    `name: "${factoryName}"`,
    'variables:',
    '  test_var: "test_value"',
    'stages:'
  ];

  for (const s of stages) {
    yamlLines.push(`  - id: ${s.id}`);
    yamlLines.push(`    type: ${s.type}`);

    if (s.depends_on && s.depends_on.length > 0) {
      yamlLines.push(`    depends_on: [${s.depends_on.join(", ")}]`);
    }

    if (s.condition) {
      yamlLines.push(`    condition: "${s.condition}"`);
    }

    if (s.verify && s.verify.length > 0) {
      yamlLines.push('    verify:');
      for (const v of s.verify) {
        yamlLines.push(`      - type: ${v.type}`);
      }
    }

    if (s.loop_to) {
      yamlLines.push(`    loop_to: ${s.loop_to}`);
    }

    if (s.retries !== undefined) {
      yamlLines.push('    config:');
      yamlLines.push(`      retries: ${s.retries}`);
    }

    // Add command for custom stages
    if (s.type === 'custom') {
      yamlLines.push('    command: "echo test"');
    }
  }

  const yamlContent = yamlLines.join('\n') + '\n';
  writeFileSync(path.join(factoryDir, `${factoryName}.yaml`), yamlContent);

  // Create runs directory
  mkdirSync(path.join(factoryDir, "runs"), { recursive: true });

  return factoryDir;
}

// Mock executor that doesn't actually run commands
function createMockExecutor(stageResults = {}) {
  return {
    executeStage: async (stage) => {
      const result = stageResults[stage.id] || { status: "completed" };
      return {
        stageId: stage.id,
        status: result.status || "completed",
        output: result.output || {},
        error: result.error || null,
        completedAt: new Date().toISOString()
      };
    }
  };
}

console.log("\nRunning Factory Orchestrator Integration Tests");
console.log("==============================================\n");

// ============================================================================
// FactoryOrchestrator Initialization Tests
// ============================================================================

console.log("FactoryOrchestrator Initialization Tests:");

await asyncTest("FactoryOrchestrator initializes with parsed factory", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom", depends_on: ["stage1"] }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    assert(orchestrator.factoryFSM, "Should have factory FSM");
    assertEqual(orchestrator.factoryFSM.getState(), FactoryState.IDLE);
    assert(orchestrator.factoryFSM.getStageMachine("stage1"), "Should have stage1 FSM");
    assert(orchestrator.factoryFSM.getStageMachine("stage2"), "Should have stage2 FSM");
    assertEqual(orchestrator.executionOrder.length, 2);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("FactoryOrchestrator builds correct execution order", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage3", type: "custom", depends_on: ["stage1", "stage2"] },
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom", depends_on: ["stage1"] }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    // Execution order should be: stage1 -> stage2 -> stage3
    assertEqual(orchestrator.executionOrder[0], "stage1");
    assertEqual(orchestrator.executionOrder[1], "stage2");
    assertEqual(orchestrator.executionOrder[2], "stage3");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// FactoryOrchestrator Status Tests
// ============================================================================

console.log("\nFactoryOrchestrator Status Tests:");

await asyncTest("FactoryOrchestrator.getStatus() returns current state", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom", depends_on: ["stage1"] }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    const status = orchestrator.getStatus();

    assertEqual(status.factoryState, FactoryState.IDLE);
    assert(status.stages, "Should have stages in status");
    assert(status.stages.stage1, "Should have stage1 status");
    assertEqual(status.stages.stage1.state, StageState.PENDING);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Orchestrator Event Emission Tests
// ============================================================================

console.log("\nOrchestrator Event Emission Tests:");

await asyncTest("FactoryOrchestrator emits factory:transition events", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    let transitionReceived = false;
    orchestrator.on("factory:transition", (data) => {
      if (data.fromState === FactoryState.IDLE && data.toState === FactoryState.RUNNING) {
        transitionReceived = true;
      }
    });

    // Manually send START to test event emission
    await orchestrator.factoryFSM.send("START");

    assert(transitionReceived, "Should receive factory:transition event");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("FactoryOrchestrator emits stage:transition events", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    let stageTransitionReceived = false;
    orchestrator.on("stage:transition", (data) => {
      if (data.stageId === "stage1") {
        stageTransitionReceived = true;
      }
    });

    // Trigger stage transition
    const stageFSM = orchestrator.factoryFSM.getStageMachine("stage1");
    await stageFSM.send("DEPS_MET");

    assert(stageTransitionReceived, "Should receive stage:transition event");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Orchestrator Stop Tests
// ============================================================================

console.log("\nOrchestrator Stop Tests:");

await asyncTest("FactoryOrchestrator.stop() sets stopped flag", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    assert(!orchestrator.stopped, "Should not be stopped initially");

    let stopEventReceived = false;
    orchestrator.on("factory:stopped", () => {
      stopEventReceived = true;
    });

    orchestrator.stop();

    assert(orchestrator.stopped, "Should be stopped after stop()");
    assert(stopEventReceived, "Should emit factory:stopped event");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Checkpoint Integration Tests
// ============================================================================

console.log("\nCheckpoint Integration Tests:");

await asyncTest("FactoryOrchestrator.saveCheckpoint() creates FSM checkpoint", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom", depends_on: ["stage1"] }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    // Manually trigger some state changes
    await orchestrator.factoryFSM.send("START");
    const stage1FSM = orchestrator.factoryFSM.getStageMachine("stage1");
    await stage1FSM.send("DEPS_MET");
    await stage1FSM.send("EXECUTE");
    await stage1FSM.send("EXEC_SUCCESS");

    orchestrator.factoryFSM.updateStageStats();

    // Save checkpoint
    orchestrator.saveCheckpoint();

    // Verify checkpoint was created
    const checkpointPath = path.join(runDir, "checkpoint.json");
    assert(existsSync(checkpointPath), "Checkpoint file should exist");

    const savedCheckpoint = JSON.parse(readFileSync(checkpointPath, "utf8"));
    assert(savedCheckpoint.fsm_state, "Should have FSM state in checkpoint");
    assert(savedCheckpoint.fsm_state.factory, "Should have factory FSM state");
    assert(savedCheckpoint.fsm_state.stages, "Should have stages FSM states");
    assert(savedCheckpoint.fsm_state.stages.stage1, "Should have stage1 FSM state");
    assertEqual(savedCheckpoint.fsm_state.stages.stage1.currentState, StageState.COMPLETED);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Stage Execution Logic Tests
// ============================================================================

console.log("\nStage Execution Logic Tests:");

await asyncTest("FactoryOrchestrator.getReadyStages() returns stages with met dependencies", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom", depends_on: ["stage1"] },
      { id: "stage3", type: "custom" }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    // Initially, stage1 and stage3 should be ready (no dependencies)
    const readyInitial = orchestrator.getReadyStages(new Set(), new Set(), new Set());
    assertIncludes(readyInitial, "stage1");
    assertIncludes(readyInitial, "stage3");
    assert(!readyInitial.includes("stage2"), "stage2 should not be ready initially");

    // Simulate stage1 completion by transitioning its FSM
    const stage1FSM = orchestrator.factoryFSM.getStageMachine("stage1");
    await stage1FSM.send("DEPS_MET");
    await stage1FSM.send("EXECUTE");
    await stage1FSM.send("EXEC_SUCCESS");

    // After stage1 completes, stage2 should be ready
    const readyAfter = orchestrator.getReadyStages(new Set(["stage1"]), new Set(), new Set());
    assertIncludes(readyAfter, "stage2", "stage2 should be ready after stage1 completes");
    // Note: stage1 FSM is now in COMPLETED state, so it won't show up as ready
    assert(!readyAfter.includes("stage1"), "stage1 should not be ready (FSM in COMPLETED state)");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("FactoryOrchestrator.getReadyStages() handles failed dependencies", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom", depends_on: ["stage1"] }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", `run-${Date.now()}`);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    // If stage1 fails, stage2 should show up (for skip handling)
    const ready = orchestrator.getReadyStages(new Set(), new Set(["stage1"]), new Set());
    assertIncludes(ready, "stage2", "stage2 should be in ready list (to be skipped)");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Build Result Tests
// ============================================================================

console.log("\nBuild Result Tests:");

await asyncTest("FactoryOrchestrator.buildResult() returns correct structure", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "factory-test-"));

  try {
    createTestFactory(tmpDir, "test-factory", [
      { id: "stage1", type: "custom" },
      { id: "stage2", type: "custom" }
    ]);

    const parser = require(path.join(repoRoot, "lib", "factory", "parser.js"));
    const factory = parser.parseFactory(path.join(tmpDir, ".ralph", "factory", "test-factory.yaml")).factory;

    const runId = `run-${Date.now()}`;
    const runDir = path.join(tmpDir, ".ralph", "factory", "runs", runId);
    mkdirSync(runDir, { recursive: true });
    mkdirSync(path.join(runDir, "stages"), { recursive: true });

    const orchestrator = new FactoryOrchestrator(factory, tmpDir, runDir);

    // Simulate some state
    await orchestrator.factoryFSM.send("START");
    orchestrator.factoryFSM.context.completedStages = ["stage1"];
    orchestrator.factoryFSM.context.failedStages = ["stage2"];

    const result = orchestrator.buildResult();

    assert(result, "Should return result");
    assert(!result.success, "Should not be success with failed stages");
    assertEqual(result.runId, runId);
    assertIncludes(result.completedStages, "stage1");
    assertIncludes(result.failedStages, "stage2");
    assert(result.stageResults, "Should have stageResults");
    assert(result.fsmState, "Should have FSM state");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Feature Flag Tests
// ============================================================================

console.log("\nFeature Flag Tests:");

await asyncTest("isFSMEnabled() returns false by default", async () => {
  const { isFSMEnabled } = require(path.join(repoRoot, "lib", "factory", "index.js"));

  // Save original env value
  const originalEnv = process.env.RALPH_FACTORY_FSM;
  delete process.env.RALPH_FACTORY_FSM;

  try {
    const enabled = isFSMEnabled();
    assertEqual(enabled, false, "Should be disabled by default");
  } finally {
    // Restore env
    if (originalEnv !== undefined) {
      process.env.RALPH_FACTORY_FSM = originalEnv;
    }
  }
});

await asyncTest("isFSMEnabled() respects environment variable", async () => {
  const { isFSMEnabled } = require(path.join(repoRoot, "lib", "factory", "index.js"));

  // Save original env value
  const originalEnv = process.env.RALPH_FACTORY_FSM;

  try {
    process.env.RALPH_FACTORY_FSM = "true";
    const enabled = isFSMEnabled();
    assertEqual(enabled, true, "Should be enabled when env var is true");
  } finally {
    // Restore env
    if (originalEnv !== undefined) {
      process.env.RALPH_FACTORY_FSM = originalEnv;
    } else {
      delete process.env.RALPH_FACTORY_FSM;
    }
  }
});

await asyncTest("isFSMEnabled() respects explicit option", async () => {
  const { isFSMEnabled } = require(path.join(repoRoot, "lib", "factory", "index.js"));

  // Explicit option should override env
  const originalEnv = process.env.RALPH_FACTORY_FSM;

  try {
    process.env.RALPH_FACTORY_FSM = "false";

    const enabledByOption = isFSMEnabled({ useFSM: true });
    assertEqual(enabledByOption, true, "Explicit option should override env");

    const disabledByOption = isFSMEnabled({ useFSM: false });
    assertEqual(disabledByOption, false, "Explicit option should override env");
  } finally {
    // Restore env
    if (originalEnv !== undefined) {
      process.env.RALPH_FACTORY_FSM = originalEnv;
    } else {
      delete process.env.RALPH_FACTORY_FSM;
    }
  }
});

// ============================================================================
// FSM Checkpoint Functions Tests
// ============================================================================

console.log("\nFSM Checkpoint Functions Tests:");

await asyncTest("saveFSMCheckpoint creates v2.0 checkpoint", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));

  try {
    const result = checkpoint.saveFSMCheckpoint(tmpDir, {
      factory_name: "test-factory",
      run_id: "run-123",
      completed_stages: ["stage1"],
      fsm_state: {
        factory: { currentState: "RUNNING" },
        stages: { stage1: { currentState: "COMPLETED" } }
      }
    });

    assert(result.success, "Save should succeed");

    const loaded = checkpoint.loadFSMCheckpoint(tmpDir);
    assert(loaded.success, "Load should succeed");
    assert(loaded.isFSM, "Should be identified as FSM checkpoint");
    assertEqual(loaded.checkpoint.version, "2.0");
    assert(loaded.checkpoint.fsm_state, "Should have FSM state");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("loadFSMCheckpoint identifies legacy vs FSM checkpoints", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));

  try {
    // Create legacy checkpoint
    checkpoint.saveCheckpoint(tmpDir, {
      factory_name: "test-factory",
      run_id: "run-123"
    });

    const loaded = checkpoint.loadFSMCheckpoint(tmpDir);
    assert(loaded.success, "Load should succeed");
    assertEqual(loaded.isFSM, false, "Should identify as legacy checkpoint");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("hasFSMState correctly detects FSM state presence", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));

  try {
    // Initially no FSM state
    assert(!checkpoint.hasFSMState(tmpDir), "Should return false when no checkpoint");

    // Save legacy checkpoint
    checkpoint.saveCheckpoint(tmpDir, {
      factory_name: "test-factory",
      run_id: "run-123"
    });
    assert(!checkpoint.hasFSMState(tmpDir), "Should return false for legacy checkpoint");

    // Save FSM checkpoint
    checkpoint.saveFSMCheckpoint(tmpDir, {
      factory_name: "test-factory",
      run_id: "run-123",
      fsm_state: { factory: { currentState: "RUNNING" } }
    });
    assert(checkpoint.hasFSMState(tmpDir), "Should return true for FSM checkpoint");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("getFSMState retrieves FSM state from checkpoint", async () => {
  const tmpDir = mkdtempSync(path.join(tmpdir(), "checkpoint-test-"));

  try {
    const fsmState = {
      factory: { currentState: "RUNNING", context: { foo: "bar" } },
      stages: { stage1: { currentState: "COMPLETED" } }
    };

    checkpoint.saveFSMCheckpoint(tmpDir, {
      factory_name: "test-factory",
      run_id: "run-123",
      fsm_state: fsmState
    });

    const retrieved = checkpoint.getFSMState(tmpDir);
    assert(retrieved, "Should retrieve FSM state");
    assertEqual(retrieved.factory.currentState, "RUNNING");
    assertEqual(retrieved.factory.context.foo, "bar");
    assertEqual(retrieved.stages.stage1.currentState, "COMPLETED");
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

await asyncTest("migrateLegacyCheckpoint adds FSM fields", async () => {
  const legacy = {
    version: "1.0",
    factory_name: "test-factory",
    run_id: "run-123",
    completed_stages: ["stage1"]
  };

  const migrated = checkpoint.migrateLegacyCheckpoint(legacy);

  assertEqual(migrated.version, "2.0");
  assertEqual(migrated.factory_name, "test-factory");
  assertIncludes(migrated.completed_stages, "stage1");
  assertEqual(migrated.fsm_state, null);
  assertEqual(migrated.migrated_from, "1.0");
  assert(migrated.migrated_at, "Should have migration timestamp");
});

// ============================================================================
// Summary
// ============================================================================

// Wait a bit for async tests to complete
await new Promise(resolve => setTimeout(resolve, 100));

console.log("\n==============================================");
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
