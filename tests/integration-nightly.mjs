/**
 * Integration tests for nightly AI recommendations
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const RALPH_BIN = path.join(ROOT, "bin", "ralph");

// Test utilities
function runRalph(args, options = {}) {
  const result = spawnSync("node", [RALPH_BIN, ...args], {
    cwd: options.cwd || ROOT,
    env: { ...process.env, ...options.env },
    encoding: "utf-8",
  });
  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    status: result.status,
  };
}

function createTempDir() {
  const tempDir = path.join(ROOT, ".test-temp-nightly-" + Date.now());
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(path.join(tempDir, ".ralph"), { recursive: true });
  return tempDir;
}

function cleanup(tempDir) {
  if (tempDir && fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Tests
console.log("Testing nightly AI recommendations...\n");

let passed = 0;
let failed = 0;
let tempDir = null;

// Test 1: Help command works
try {
  const result = runRalph(["nightly", "--help"]);
  assert.strictEqual(result.status, 0, "Help command should exit with 0");
  assert.ok(
    result.stdout.includes("AI-powered nightly recommendations"),
    "Help should mention AI-powered nightly recommendations"
  );
  assert.ok(
    result.stdout.includes("run"),
    "Help should list run subcommand"
  );
  assert.ok(
    result.stdout.includes("config"),
    "Help should list config subcommand"
  );
  assert.ok(
    result.stdout.includes("schedule"),
    "Help should list schedule subcommand"
  );
  console.log("✓ Help command works");
  passed++;
} catch (err) {
  console.error("✗ Help command failed:", err.message);
  failed++;
}

// Test 2: Status command works without config
try {
  tempDir = createTempDir();
  const result = runRalph(["nightly", "status"], { cwd: tempDir });
  assert.strictEqual(result.status, 0, "Status should exit with 0");
  assert.ok(
    result.stdout.includes("Configuration") || result.stdout.includes("config"),
    "Status should mention configuration"
  );
  console.log("✓ Status command works without config");
  passed++;
} catch (err) {
  console.error("✗ Status command failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 3: Test command detects missing API key
try {
  tempDir = createTempDir();
  const result = runRalph(["nightly", "test"], {
    cwd: tempDir,
    env: { ANTHROPIC_API_KEY: "" },
  });
  // Should fail or warn about missing API key
  assert.ok(
    result.stdout.includes("ANTHROPIC_API_KEY") ||
      result.stderr.includes("ANTHROPIC_API_KEY"),
    "Test should mention missing API key"
  );
  console.log("✓ Test command detects missing API key");
  passed++;
} catch (err) {
  console.error("✗ Test command failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 4: History command works with no history
try {
  tempDir = createTempDir();
  const result = runRalph(["nightly", "history"], { cwd: tempDir });
  assert.strictEqual(result.status, 0, "History should exit with 0");
  assert.ok(
    result.stdout.includes("No recommendations") ||
      result.stdout.includes("ralph nightly run"),
    "History should indicate no recommendations yet"
  );
  console.log("✓ History command works with no history");
  passed++;
} catch (err) {
  console.error("✗ History command failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 5: History with JSON output
try {
  tempDir = createTempDir();
  const result = runRalph(["nightly", "history", "--json"], { cwd: tempDir });
  assert.strictEqual(result.status, 0, "History --json should exit with 0");
  const json = JSON.parse(result.stdout);
  assert.ok(
    Array.isArray(json.recommendations),
    "JSON should have recommendations array"
  );
  console.log("✓ History command works with JSON output");
  passed++;
} catch (err) {
  console.error("✗ History JSON command failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 6: Config file is loaded correctly
try {
  tempDir = createTempDir();

  // Create a config file
  const configPath = path.join(tempDir, ".ralph", "nightly-config.json");
  const config = {
    sources: [{ name: "test", type: "ralph_metrics" }],
    email: { enabled: false },
    slack: { enabled: false },
    context: { businessType: "saas" },
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

  const result = runRalph(["nightly", "status"], { cwd: tempDir });
  assert.strictEqual(result.status, 0, "Status should exit with 0");
  assert.ok(
    result.stdout.includes("nightly-config.json") ||
      result.stdout.includes("Sources: 1"),
    "Status should show config is loaded"
  );
  console.log("✓ Config file is loaded correctly");
  passed++;
} catch (err) {
  console.error("✗ Config file loading failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 7: Collector module - Ralph metrics collector
try {
  const collector = await import("../lib/nightly/collector.js");

  tempDir = createTempDir();
  const ralphDir = path.join(tempDir, ".ralph");

  // Create a mock PRD directory with some data
  const prdDir = path.join(ralphDir, "PRD-1");
  fs.mkdirSync(prdDir, { recursive: true });
  fs.writeFileSync(
    path.join(prdDir, ".cost.json"),
    JSON.stringify({ total_cost: 0.05 })
  );
  fs.writeFileSync(
    path.join(ralphDir, "guardrails.md"),
    "- Do not use deprecated APIs\n- Always handle errors"
  );

  const ralphCollector = new collector.RalphMetricsCollector({ cwd: tempDir });
  await ralphCollector.connect();
  const data = await ralphCollector.collect();

  assert.ok(data.tokens, "Should have tokens data");
  assert.ok(data.guardrails, "Should have guardrails data");
  assert.strictEqual(
    data.guardrails.data.length,
    2,
    "Should have 2 guardrails"
  );
  console.log("✓ Ralph metrics collector works");
  passed++;
} catch (err) {
  console.error("✗ Ralph metrics collector failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 8: Reporter module - Markdown generation
try {
  const reporter = await import("../lib/nightly/reporter.js");

  const mockResult = {
    recommendation: {
      title: "Improve user onboarding",
      summary: "Focus on reducing time-to-value for new users",
      details: "Analysis shows 40% of users drop off during onboarding.",
      priority: "high",
      effort: "medium",
      expectedImpact: "20% improvement in activation rate",
      dataPoints: ["40% drop-off rate", "Average onboarding time: 15 minutes"],
      nextSteps: ["Review onboarding flow", "Add progress indicators"],
    },
    analysis: {
      keyInsights: ["High drop-off during step 3"],
      positiveSignals: ["Good retention after activation"],
      concerningTrends: [],
    },
    metadata: {
      dataQuality: "good",
      confidence: "high",
    },
    usage: {
      inputTokens: 1000,
      outputTokens: 500,
      model: "claude-opus-4-5-20251101",
    },
  };

  const markdown = reporter.generateMarkdownReport(mockResult);

  assert.ok(
    markdown.includes("Improve user onboarding"),
    "Markdown should include title"
  );
  assert.ok(markdown.includes("HIGH"), "Markdown should include priority");
  assert.ok(
    markdown.includes("40% drop-off"),
    "Markdown should include data points"
  );
  assert.ok(
    markdown.includes("Next Steps"),
    "Markdown should include next steps"
  );
  console.log("✓ Markdown report generation works");
  passed++;
} catch (err) {
  console.error("✗ Markdown report generation failed:", err.message);
  failed++;
}

// Test 9: Reporter module - Save markdown report
try {
  const reporter = await import("../lib/nightly/reporter.js");

  tempDir = createTempDir();
  const content = "# Test Recommendation\n\nThis is a test.";

  const result = reporter.saveMarkdownReport(content, {
    outputDir: ".ralph/recommendations",
    cwd: tempDir,
  });

  assert.ok(result.success, "Save should succeed");
  assert.ok(result.path.endsWith(".md"), "Path should be a markdown file");
  assert.ok(fs.existsSync(result.path), "File should exist");
  console.log("✓ Markdown report saving works");
  passed++;
} catch (err) {
  console.error("✗ Markdown report saving failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 10: Scheduler module - Cron expression generation
try {
  const scheduler = await import("../lib/nightly/scheduler.js");

  const cron1 = scheduler.timeToCron("00:00");
  assert.strictEqual(cron1, "0 0 * * *", "Midnight should be 0 0 * * *");

  const cron2 = scheduler.timeToCron("06:30");
  assert.strictEqual(cron2, "30 6 * * *", "6:30 AM should be 30 6 * * *");

  const cron3 = scheduler.timeToCron("23:59");
  assert.strictEqual(cron3, "59 23 * * *", "11:59 PM should be 59 23 * * *");

  console.log("✓ Cron expression generation works");
  passed++;
} catch (err) {
  console.error("✗ Cron expression generation failed:", err.message);
  failed++;
}

// Test 11: Scheduler module - GitHub Actions workflow generation
try {
  const scheduler = await import("../lib/nightly/scheduler.js");

  const workflow = scheduler.generateGitHubActionsWorkflow({
    time: "09:00",
    branch: "main",
    createPR: false,
  });

  assert.ok(
    workflow.includes("Nightly AI Recommendations"),
    "Workflow should have correct name"
  );
  assert.ok(
    workflow.includes("cron: '0 9 * * *'"),
    "Workflow should have correct cron"
  );
  assert.ok(
    workflow.includes("ralph nightly run"),
    "Workflow should run nightly command"
  );
  assert.ok(
    workflow.includes("ANTHROPIC_API_KEY"),
    "Workflow should use API key secret"
  );
  console.log("✓ GitHub Actions workflow generation works");
  passed++;
} catch (err) {
  console.error("✗ GitHub Actions workflow generation failed:", err.message);
  failed++;
}

// Test 12: Executor module - Implementation prompt generation
try {
  const executor = await import("../lib/nightly/executor.js");

  const recommendation = {
    title: "Add caching layer",
    summary: "Implement Redis caching for API responses",
    details: "API response times are slow. Add caching.",
    expectedImpact: "50% reduction in API latency",
    nextSteps: ["Install Redis", "Add cache middleware", "Set TTL policies"],
    dataPoints: ["Average response time: 500ms"],
  };

  const prompt = executor.generateImplementationPrompt(recommendation, {
    codebaseContext: "Node.js Express app",
    constraints: ["Use existing Redis connection"],
  });

  assert.ok(
    prompt.includes("Add caching layer"),
    "Prompt should include title"
  );
  assert.ok(
    prompt.includes("Node.js Express"),
    "Prompt should include context"
  );
  assert.ok(
    prompt.includes("Use existing Redis"),
    "Prompt should include constraints"
  );
  console.log("✓ Implementation prompt generation works");
  passed++;
} catch (err) {
  console.error("✗ Implementation prompt generation failed:", err.message);
  failed++;
}

// Test 13: Schedule status detection
try {
  const scheduler = await import("../lib/nightly/scheduler.js");

  tempDir = createTempDir();
  const status = scheduler.getScheduleStatus({ projectPath: tempDir });

  assert.ok(
    typeof status.cron === "object",
    "Status should have cron section"
  );
  assert.ok(
    typeof status.githubActions === "object",
    "Status should have githubActions section"
  );
  assert.strictEqual(
    status.cron.installed,
    false,
    "Cron should not be installed in temp dir"
  );
  assert.strictEqual(
    status.githubActions.installed,
    false,
    "GitHub Actions should not be installed in temp dir"
  );
  console.log("✓ Schedule status detection works");
  passed++;
} catch (err) {
  console.error("✗ Schedule status detection failed:", err.message);
  failed++;
} finally {
  cleanup(tempDir);
  tempDir = null;
}

// Test 14: Unknown subcommand returns error
try {
  const result = runRalph(["nightly", "unknown-subcommand"]);
  assert.strictEqual(result.status, 1, "Unknown subcommand should exit with 1");
  assert.ok(
    result.stdout.includes("Unknown") || result.stderr.includes("Unknown"),
    "Should mention unknown command"
  );
  console.log("✓ Unknown subcommand returns error");
  passed++;
} catch (err) {
  console.error("✗ Unknown subcommand test failed:", err.message);
  failed++;
}

// Test 15: Email subject generation
try {
  const reporter = await import("../lib/nightly/reporter.js");

  const criticalSubject = reporter.generateEmailSubject({
    priority: "critical",
    title: "Fix security vulnerability",
  });
  assert.ok(
    criticalSubject.includes("CRITICAL"),
    "Critical should have CRITICAL label"
  );
  assert.ok(
    criticalSubject.includes("🚨"),
    "Critical should have alarm emoji"
  );

  const highSubject = reporter.generateEmailSubject({
    priority: "high",
    title: "Improve conversion rate",
  });
  assert.ok(highSubject.includes("HIGH"), "High should have HIGH label");

  const mediumSubject = reporter.generateEmailSubject({
    priority: "medium",
    title: "Update documentation",
  });
  assert.ok(
    mediumSubject.includes("💡"),
    "Medium should have lightbulb emoji"
  );

  console.log("✓ Email subject generation works");
  passed++;
} catch (err) {
  console.error("✗ Email subject generation failed:", err.message);
  failed++;
}

// Summary
console.log("\n" + "=".repeat(50));
console.log(`Tests: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log("\n✓ All nightly recommendation tests passed!");
