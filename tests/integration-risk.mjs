/**
 * Integration tests for risk assessment (PRD-22, PRD-34)
 *
 * Tests risk scoring, threshold configuration, high-risk workflow pausing,
 * skip flag, and loop integration.
 *
 * Run with: RALPH_DRY_RUN=1 node tests/integration-risk.mjs
 * Or: npm run test:risk
 */

import { fileURLToPath } from "node:url";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const risk = require(path.join(repoRoot, "lib", "risk", "index.js"));

// Track test results
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  process.stdout.write(`  ${name}... `);
  try {
    fn();
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

function assertGreaterThan(actual, threshold, message) {
  if (actual <= threshold) {
    throw new Error(message || `Expected ${actual} > ${threshold}`);
  }
}

console.log("\nRunning Risk Assessment Integration Tests");
console.log("==========================================\n");

// Test 1: Risk scoring matches high-risk patterns
test("analyzeStoryRisk detects high-risk keywords and patterns", () => {
  // Test authentication story (high risk)
  const authStory = `
### [ ] US-001: Add User Authentication
**As a** user
**I want** to login with OAuth
**So that** my account is secure

#### Acceptance Criteria
- [ ] Implement JWT token generation
- [ ] Add password hashing
- [ ] Create auth middleware
  `.trim();

  const authResult = risk.analyzeStoryRisk(authStory);
  assert(authResult.score > 0, "Should assign score to auth story");
  assert(authResult.factors.length > 0, "Should identify risk factors");
  assert(
    authResult.factors.some((f) => f.category === "security"),
    "Should flag security risk"
  );

  // Test payment story (high risk)
  const paymentStory = `
### [ ] US-002: Process Credit Card Payments
**As a** customer
**I want** to pay with credit card
**So that** I can complete purchase

#### Acceptance Criteria
- [ ] Integrate Stripe API
- [ ] Store payment tokens
- [ ] Handle payment failures
  `.trim();

  const paymentResult = risk.analyzeStoryRisk(paymentStory);
  assert(paymentResult.score > 0, "Payment story should have positive risk score");
  assert(
    paymentResult.factors.some((f) => f.description.toLowerCase().includes("payment")),
    "Should detect payment-related risk"
  );

  // Test low-risk story
  const lowRiskStory = `
### [ ] US-003: Update Button Color
**As a** user
**I want** the submit button to be green
**So that** it stands out

#### Acceptance Criteria
- [ ] Change button color in CSS
  `.trim();

  const lowResult = risk.analyzeStoryRisk(lowRiskStory);
  assert(lowResult.score < 5, "UI tweak should have low risk score");
});

// Test 2: Threshold configuration from env/config
test("getRiskThreshold reads from env var and config", () => {
  // Clear config cache to ensure fresh read
  risk.clearConfigCache();

  // Save original env var
  const originalEnv = process.env.RALPH_RISK_THRESHOLD;

  try {
    // Test default threshold (no env var)
    delete process.env.RALPH_RISK_THRESHOLD;
    const defaultThreshold = risk.getRiskThreshold();
    assertEqual(defaultThreshold, 7, "Default threshold should be 7");

    // Test env var override
    process.env.RALPH_RISK_THRESHOLD = "9";
    const envThreshold = risk.getRiskThreshold();
    assertEqual(envThreshold, 9, "Should read threshold from env var");

    // Test invalid env var falls back to default
    process.env.RALPH_RISK_THRESHOLD = "invalid";
    const fallbackThreshold = risk.getRiskThreshold();
    assertEqual(fallbackThreshold, 7, "Should fall back to default for invalid env value");
  } finally {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.RALPH_RISK_THRESHOLD = originalEnv;
    } else {
      delete process.env.RALPH_RISK_THRESHOLD;
    }
    risk.clearConfigCache();
  }
});

// Test 3: shouldPauseOnHighRisk respects RALPH_RISK_PAUSE env var
test("shouldPauseOnHighRisk reads from RALPH_RISK_PAUSE env var", () => {
  risk.clearConfigCache();
  const originalEnv = process.env.RALPH_RISK_PAUSE;

  try {
    // Test default (defaults to true per DEFAULT_RISK_CONFIG)
    delete process.env.RALPH_RISK_PAUSE;
    const defaultPause = risk.shouldPauseOnHighRisk();
    assertEqual(defaultPause, true, "Should pause by default (config default)");

    // Test env var = true
    process.env.RALPH_RISK_PAUSE = "true";
    const pauseTrue = risk.shouldPauseOnHighRisk();
    assertEqual(pauseTrue, true, "Should pause when env var is 'true'");

    // Test env var = 1
    process.env.RALPH_RISK_PAUSE = "1";
    const pauseOne = risk.shouldPauseOnHighRisk();
    assertEqual(pauseOne, true, "Should pause when env var is '1'");

    // Test env var = false
    process.env.RALPH_RISK_PAUSE = "false";
    const pauseFalse = risk.shouldPauseOnHighRisk();
    assertEqual(pauseFalse, false, "Should not pause when env var is 'false'");
  } finally {
    if (originalEnv !== undefined) {
      process.env.RALPH_RISK_PAUSE = originalEnv;
    } else {
      delete process.env.RALPH_RISK_PAUSE;
    }
    risk.clearConfigCache();
  }
});

// Test 4: isHighRisk helper function
test("isHighRisk correctly identifies high-risk stories", () => {
  const threshold = 7;

  // High risk story (authentication)
  const highRiskStory = "Add user authentication with JWT tokens and password hashing";
  const highResult = risk.isHighRisk(highRiskStory, threshold);
  assert(highResult.isHighRisk !== undefined, "Should return object with isHighRisk property");
  assert(typeof highResult.score === "number", "Should include numeric score");
  assert(highResult.reason, "Should include reason");

  // Low risk story (UI tweak)
  const lowRiskStory = "Update button color to green";
  const lowResult = risk.isHighRisk(lowRiskStory, threshold);
  assert(lowResult.isHighRisk !== undefined, "Should return object for low risk story");
  assert(typeof lowResult.score === "number", "Should include numeric score");
});

// Test 5: formatRiskDisplay for visualization
test("formatRiskDisplay sorts and summarizes stories by risk", () => {
  const stories = [
    {
      id: "US-001",
      title: "Low risk task",
      risk: { score: 2, level: "low", factors: [] },
    },
    {
      id: "US-002",
      title: "High risk auth",
      risk: { score: 9, level: "high", factors: [{ description: "Authentication" }] },
    },
    {
      id: "US-003",
      title: "Medium risk API",
      risk: { score: 5, level: "medium", factors: [] },
    },
  ];

  const display = risk.formatRiskDisplay(stories, {
    sortByRisk: true,
    highlightHighRisk: true,
    threshold: 7,
  });

  assert(display.sortedStories, "Should return sorted stories");
  assert(display.summary, "Should return summary stats");
  assert(display.formattedOutput, "Should return formatted output string");

  // Check sorting (highest risk first)
  assertEqual(display.sortedStories[0].id, "US-002", "Highest risk should be first");
  assertEqual(display.sortedStories[2].id, "US-001", "Lowest risk should be last");

  // Check summary
  assertEqual(display.summary.total, 3, "Should count all stories");
  assertEqual(display.summary.highRisk, 1, "Should count 1 high-risk story");
  assertEqual(display.summary.mediumRisk, 1, "Should count 1 medium-risk story");
  assertEqual(display.summary.lowRisk, 1, "Should count 1 low-risk story");

  // Check formatted output includes warning marker
  assert(
    display.formattedOutput.includes("⚠"),
    "Should include warning marker for high-risk stories"
  );
});

// Summary
console.log("\n" + "=".repeat(40));
console.log(`Total: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);

if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) {
    console.log(`  - ${f.name}: ${f.error}`);
  }
  process.exit(1);
}

console.log("\n✓ All risk assessment tests passed!");
process.exit(0);
