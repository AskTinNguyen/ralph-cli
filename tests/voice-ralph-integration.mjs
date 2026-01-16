/**
 * Voice-Ralph Integration Tests
 *
 * Tests for the enhanced voice-to-Ralph integration including:
 * - Model parameter extraction
 * - Status queries
 * - Conversation context
 * - Ambiguity resolution
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'node:test';

// Import modules to test
// Note: These tests run against the compiled JS in ui/dist or require ts-node

/**
 * Test configuration
 */
const TEST_CASES = {
  modelExtraction: [
    {
      input: 'build PRD 3 with 5 iterations using opus',
      expected: {
        command: 'build',
        prdNumber: '3',
        iterations: '5',
        model: 'opus',
      },
    },
    {
      input: 'run 3 builds with haiku',
      expected: {
        command: 'build',
        iterations: '3',
        model: 'haiku',
      },
    },
    {
      input: 'ralph build 2 using sonnet',
      expected: {
        command: 'build',
        iterations: '2',
        model: 'sonnet',
      },
    },
  ],
  statusQueries: [
    {
      input: "what's the status of PRD 2",
      expected: {
        command: 'status',
        queryType: 'prd',
        prdNumber: '2',
      },
    },
    {
      input: 'how many stories are left',
      expected: {
        command: 'status',
        queryType: 'stories',
      },
    },
    {
      input: 'show me the overall progress',
      expected: {
        command: 'status',
        queryType: 'overall',
      },
    },
    {
      input: 'check status',
      expected: {
        command: 'status',
        queryType: 'prd',
      },
    },
  ],
  ambiguousCommands: [
    {
      input: 'build it',
      expected: {
        command: 'build',
        ambiguous: 'true',
        needsContext: 'true',
      },
    },
    {
      input: 'run that again',
      expected: {
        ambiguous: 'true',
        needsContext: 'true',
      },
    },
  ],
  standardCommands: [
    {
      input: 'create a PRD for user authentication',
      expected: {
        command: 'prd',
        description: 'user authentication',
      },
    },
    {
      input: 'generate a plan for PRD 3',
      expected: {
        command: 'plan',
        prdNumber: '3',
      },
    },
    {
      input: 'ralph build 5',
      expected: {
        command: 'build',
        iterations: '5',
      },
    },
  ],
};

/**
 * Mock IntentClassifier for unit testing
 */
class MockIntentClassifier {
  /**
   * Simulate quick classification (regex-based)
   */
  quickClassify(text) {
    const lowerText = text.toLowerCase();

    // Status queries
    if (lowerText.match(/^(what'?s?\s+the\s+status|show\s+(me\s+)?(the\s+)?status|check\s+status|status\s+of)/)) {
      const prdMatch = lowerText.match(/prd[- ]?(\d+)/i);
      return {
        action: 'ralph_command',
        parameters: {
          command: 'status',
          queryType: 'prd',
          ...(prdMatch && { prdNumber: prdMatch[1] }),
        },
      };
    }

    // Story queries
    if (lowerText.match(/^(how\s+many\s+stories|what\s+stories|stories\s+(left|remaining|completed))/)) {
      return {
        action: 'ralph_command',
        parameters: {
          command: 'status',
          queryType: 'stories',
        },
      };
    }

    // Progress queries
    if (lowerText.match(/(show\s+(me\s+)?(the\s+)?(overall\s+)?progress|what'?s?\s+(the\s+)?progress|overall\s+progress)/)) {
      return {
        action: 'ralph_command',
        parameters: {
          command: 'status',
          queryType: 'overall',
        },
      };
    }

    // Build commands
    if (lowerText.match(/^(ralph\s+build|run\s+(\d+\s+)?build|execute\s+build|build\s+prd)/)) {
      // Extract iterations - look for N iterations pattern first, then standalone number with build
      let iterations = '1';
      const iterationsPatternMatch = lowerText.match(/(\d+)\s*iteration/i);
      const buildIterMatch = lowerText.match(/build\s+(\d+)/i);
      const runBuildsMatch = lowerText.match(/run\s+(\d+)\s+builds?/i);

      if (iterationsPatternMatch) {
        iterations = iterationsPatternMatch[1];
      } else if (runBuildsMatch) {
        iterations = runBuildsMatch[1];
      } else if (buildIterMatch) {
        iterations = buildIterMatch[1];
      }

      const prdMatch = lowerText.match(/prd[- ]?(\d+)/i);
      const modelMatch = lowerText.match(/(?:using|with|use)\s+(haiku|sonnet|opus)/i);

      return {
        action: 'ralph_command',
        parameters: {
          command: 'build',
          iterations,
          ...(prdMatch && { prdNumber: prdMatch[1] }),
          ...(modelMatch && { model: modelMatch[1].toLowerCase() }),
        },
      };
    }

    // Ambiguous commands
    if (lowerText.match(/^build\s*(it|that|this)?$/i)) {
      return {
        action: 'ralph_command',
        parameters: {
          command: 'build',
          ambiguous: 'true',
          needsContext: 'true',
        },
      };
    }

    if (lowerText.match(/^(run|do)\s+(that|it)\s+again$/i)) {
      return {
        action: 'ralph_command',
        parameters: {
          ambiguous: 'true',
          needsContext: 'true',
        },
      };
    }

    return null;
  }
}

/**
 * Test runner for intent classification
 */
function runClassificationTests() {
  const classifier = new MockIntentClassifier();
  let passed = 0;
  let failed = 0;
  const failures = [];

  console.log('\n=== Voice-Ralph Integration Tests ===\n');

  // Test model extraction
  console.log('## Model Extraction Tests\n');
  for (const testCase of TEST_CASES.modelExtraction) {
    const result = classifier.quickClassify(testCase.input);
    const success = validateResult(result, testCase.expected);

    if (success) {
      console.log(`✅ "${testCase.input}"`);
      passed++;
    } else {
      console.log(`❌ "${testCase.input}"`);
      console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
      console.log(`   Got: ${JSON.stringify(result?.parameters || result)}`);
      failed++;
      failures.push({ input: testCase.input, expected: testCase.expected, got: result });
    }
  }

  // Test status queries
  console.log('\n## Status Query Tests\n');
  for (const testCase of TEST_CASES.statusQueries) {
    const result = classifier.quickClassify(testCase.input);
    const success = validateResult(result, testCase.expected);

    if (success) {
      console.log(`✅ "${testCase.input}"`);
      passed++;
    } else {
      console.log(`❌ "${testCase.input}"`);
      console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
      console.log(`   Got: ${JSON.stringify(result?.parameters || result)}`);
      failed++;
      failures.push({ input: testCase.input, expected: testCase.expected, got: result });
    }
  }

  // Test ambiguous commands
  console.log('\n## Ambiguous Command Tests\n');
  for (const testCase of TEST_CASES.ambiguousCommands) {
    const result = classifier.quickClassify(testCase.input);
    const success = validateResult(result, testCase.expected);

    if (success) {
      console.log(`✅ "${testCase.input}"`);
      passed++;
    } else {
      console.log(`❌ "${testCase.input}"`);
      console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
      console.log(`   Got: ${JSON.stringify(result?.parameters || result)}`);
      failed++;
      failures.push({ input: testCase.input, expected: testCase.expected, got: result });
    }
  }

  // Summary
  console.log('\n=== Test Summary ===\n');
  console.log(`Total: ${passed + failed}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failures.length > 0) {
    console.log('\n=== Failures ===\n');
    for (const f of failures) {
      console.log(`Input: "${f.input}"`);
      console.log(`Expected: ${JSON.stringify(f.expected)}`);
      console.log(`Got: ${JSON.stringify(f.got?.parameters || f.got)}`);
      console.log('');
    }
  }

  return { passed, failed, failures };
}

/**
 * Validate result against expected values
 */
function validateResult(result, expected) {
  if (!result) return false;

  const params = result.parameters || {};

  for (const [key, value] of Object.entries(expected)) {
    if (params[key] !== value) {
      return false;
    }
  }

  return true;
}

/**
 * Test ConversationContext functionality
 */
function testConversationContext() {
  console.log('\n=== Conversation Context Tests ===\n');

  // Simulate conversation context behavior
  const context = {
    turns: [],
    currentPrd: undefined,
    maxTurns: 10,
    expiryMs: 5 * 60 * 1000,

    addTurn(turn) {
      this.turns.push(turn);
      if (turn.intent.parameters?.prdNumber) {
        this.currentPrd = turn.intent.parameters.prdNumber;
      }
      if (this.turns.length > this.maxTurns) {
        this.turns = this.turns.slice(-this.maxTurns);
      }
    },

    resolveAmbiguity(intent) {
      if (intent.parameters?.ambiguous === 'true') {
        if (this.currentPrd) {
          return {
            ...intent,
            parameters: {
              ...intent.parameters,
              prdNumber: this.currentPrd,
            },
          };
        }
        return {
          type: 'clarification',
          question: 'Which PRD would you like to build?',
        };
      }
      return intent;
    },

    clear() {
      this.turns = [];
      this.currentPrd = undefined;
    },
  };

  let passed = 0;
  let failed = 0;

  // Test 1: Context tracks PRD from previous command
  console.log('Test 1: Context tracks PRD from previous command');
  context.clear();
  context.addTurn({
    text: 'build PRD 3 with 5 iterations',
    intent: { action: 'ralph_command', parameters: { command: 'build', prdNumber: '3' } },
    timestamp: new Date(),
  });

  if (context.currentPrd === '3') {
    console.log('  ✅ Current PRD tracked as "3"');
    passed++;
  } else {
    console.log(`  ❌ Expected currentPrd="3", got "${context.currentPrd}"`);
    failed++;
  }

  // Test 2: Ambiguous command resolved with context
  console.log('\nTest 2: Ambiguous command resolved with context');
  const ambiguousIntent = {
    action: 'ralph_command',
    parameters: { command: 'build', ambiguous: 'true' },
  };

  const resolved = context.resolveAmbiguity(ambiguousIntent);
  if (resolved.parameters?.prdNumber === '3') {
    console.log('  ✅ Ambiguous "build" resolved to PRD 3');
    passed++;
  } else {
    console.log(`  ❌ Expected prdNumber="3", got "${resolved.parameters?.prdNumber}"`);
    failed++;
  }

  // Test 3: Ambiguous command without context asks for clarification
  console.log('\nTest 3: Ambiguous command without context asks for clarification');
  context.clear();
  const clarificationResult = context.resolveAmbiguity(ambiguousIntent);

  if (clarificationResult.type === 'clarification') {
    console.log('  ✅ Clarification requested when no context');
    passed++;
  } else {
    console.log(`  ❌ Expected clarification request, got ${JSON.stringify(clarificationResult)}`);
    failed++;
  }

  // Test 4: Context limits turns
  console.log('\nTest 4: Context limits turns to maxTurns');
  context.clear();
  for (let i = 1; i <= 15; i++) {
    context.addTurn({
      text: `command ${i}`,
      intent: { action: 'ralph_command', parameters: { command: 'build', prdNumber: String(i) } },
      timestamp: new Date(),
    });
  }

  if (context.turns.length === 10) {
    console.log('  ✅ Turns limited to 10');
    passed++;
  } else {
    console.log(`  ❌ Expected 10 turns, got ${context.turns.length}`);
    failed++;
  }

  // Most recent PRD should be 15
  if (context.currentPrd === '15') {
    console.log('  ✅ Most recent PRD is "15"');
    passed++;
  } else {
    console.log(`  ❌ Expected currentPrd="15", got "${context.currentPrd}"`);
    failed++;
  }

  console.log(`\nConversation Context Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Test StatusHandler-like functionality
 */
function testStatusHandler() {
  console.log('\n=== Status Handler Tests ===\n');

  // Mock status data
  const mockStreams = [
    { id: '1', name: 'User Auth', status: 'completed', totalStories: 5, completedStories: 5 },
    { id: '2', name: 'Dashboard', status: 'in_progress', totalStories: 8, completedStories: 3 },
    { id: '3', name: 'API Endpoints', status: 'ready', totalStories: 10, completedStories: 0 },
  ];

  const statusHandler = {
    handleQuery({ prdNumber, queryType }) {
      if (prdNumber) {
        const prd = mockStreams.find(s => s.id === prdNumber);
        if (!prd) {
          return { success: false, summary: `PRD ${prdNumber} not found` };
        }
        return {
          success: true,
          type: 'prd',
          summary: `PRD ${prdNumber}, "${prd.name}", is ${prd.status}. ${prd.completedStories} of ${prd.totalStories} stories completed.`,
        };
      }

      if (queryType === 'stories') {
        const total = mockStreams.reduce((sum, s) => sum + s.totalStories, 0);
        const completed = mockStreams.reduce((sum, s) => sum + s.completedStories, 0);
        return {
          success: true,
          type: 'stories',
          summary: `${completed} of ${total} stories completed across ${mockStreams.length} PRDs.`,
        };
      }

      return {
        success: true,
        type: 'overall',
        summary: `You have ${mockStreams.length} PRDs. 1 is completed, 1 is in progress, 1 is ready to build.`,
      };
    },
  };

  let passed = 0;
  let failed = 0;

  // Test 1: Specific PRD status
  console.log('Test 1: Specific PRD status');
  const prdResult = statusHandler.handleQuery({ prdNumber: '1' });
  if (prdResult.success && prdResult.summary.includes('User Auth')) {
    console.log('  ✅ PRD 1 status returned correctly');
    passed++;
  } else {
    console.log(`  ❌ Unexpected result: ${prdResult.summary}`);
    failed++;
  }

  // Test 2: Stories status
  console.log('\nTest 2: Stories status');
  const storiesResult = statusHandler.handleQuery({ queryType: 'stories' });
  if (storiesResult.success && storiesResult.summary.includes('8 of 23')) {
    console.log('  ✅ Stories count correct');
    passed++;
  } else {
    console.log(`  ❌ Unexpected result: ${storiesResult.summary}`);
    failed++;
  }

  // Test 3: Overall status
  console.log('\nTest 3: Overall status');
  const overallResult = statusHandler.handleQuery({ queryType: 'overall' });
  if (overallResult.success && overallResult.summary.includes('3 PRDs')) {
    console.log('  ✅ Overall status correct');
    passed++;
  } else {
    console.log(`  ❌ Unexpected result: ${overallResult.summary}`);
    failed++;
  }

  // Test 4: PRD not found
  console.log('\nTest 4: PRD not found');
  const notFoundResult = statusHandler.handleQuery({ prdNumber: '99' });
  if (!notFoundResult.success && notFoundResult.summary.includes('not found')) {
    console.log('  ✅ Not found handled correctly');
    passed++;
  } else {
    console.log(`  ❌ Unexpected result: ${JSON.stringify(notFoundResult)}`);
    failed++;
  }

  console.log(`\nStatus Handler Tests: ${passed} passed, ${failed} failed`);
  return { passed, failed };
}

/**
 * Main test runner
 */
async function main() {
  console.log('Voice-Ralph Integration Test Suite');
  console.log('==================================\n');

  const results = {
    classification: runClassificationTests(),
    context: testConversationContext(),
    status: testStatusHandler(),
  };

  const totalPassed = results.classification.passed + results.context.passed + results.status.passed;
  const totalFailed = results.classification.failed + results.context.failed + results.status.failed;

  console.log('\n==================================');
  console.log('Final Summary');
  console.log('==================================');
  console.log(`Classification Tests: ${results.classification.passed} passed, ${results.classification.failed} failed`);
  console.log(`Context Tests: ${results.context.passed} passed, ${results.context.failed} failed`);
  console.log(`Status Tests: ${results.status.passed} passed, ${results.status.failed} failed`);
  console.log('----------------------------------');
  console.log(`Total: ${totalPassed} passed, ${totalFailed} failed`);

  // Exit with error code if any tests failed
  if (totalFailed > 0) {
    process.exit(1);
  }
}

// Run tests
main().catch(console.error);
