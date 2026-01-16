/**
 * Test: Two-Stage Hybrid Intent Classification
 *
 * Tests the hybrid approach:
 * - Stage 1: Quick regex intent detection (~1ms)
 * - Stage 2: LLM entity extraction with JSON schema (~200-300ms)
 */

import { IntentClassifier } from "../ui/src/voice-agent/llm/intent-classifier.js";
import { EntityExtractor } from "../ui/src/voice-agent/llm/entity-extractor.js";

// Test configuration
const config = {
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen2.5:1.5b",
};

// Test cases covering different intent types
const testCases = [
  // App control
  {
    input: "open chrome",
    expectedAction: "app_control",
    expectedCommand: "open",
    expectedTarget: "Google Chrome",
  },
  {
    input: "close slack and then open spotify",
    expectedAction: "app_control",
    expectedCommand: "quit",
    expectedTarget: "Slack",
  },
  {
    input: "play music",
    expectedAction: "app_control",
    expectedCommand: "play",
    expectedTarget: "Music",
  },

  // Terminal commands
  {
    input: "run npm test",
    expectedAction: "terminal",
    expectedCommand: "npm test",
  },
  {
    input: "git status",
    expectedAction: "terminal",
    expectedCommand: "git status",
  },
  {
    input: "list all files",
    expectedAction: "terminal",
    expectedCommand: "ls -la",
  },

  // Ralph commands
  {
    input: "create a PRD for user authentication",
    expectedAction: "ralph_command",
    expectedCommand: /ralph prd/,
  },
  {
    input: "ralph build 5 for PRD 3",
    expectedAction: "ralph_command",
    expectedCommand: /ralph build 5.*--prd=3/,
  },
  {
    input: "generate plan for PRD 2",
    expectedAction: "ralph_command",
    expectedCommand: /ralph plan.*--prd=2/,
  },

  // Web search
  {
    input: "search for typescript best practices",
    expectedAction: "web_search",
  },
];

/**
 * Run the hybrid classifier tests
 */
async function runTests() {
  console.log("🧪 Testing Two-Stage Hybrid Intent Classifier\n");
  console.log("═══════════════════════════════════════════════\n");

  const classifier = new IntentClassifier(config);
  const extractor = new EntityExtractor(config);

  // Check if Ollama model is available
  console.log("🔍 Checking Ollama model availability...");
  const modelCheck = await classifier.checkModel();
  if (!modelCheck.available) {
    console.error(`❌ ${modelCheck.error}`);
    process.exit(1);
  }
  console.log(`✅ Model ready: ${config.ollamaModel}\n`);

  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    console.log(`\n📝 Input: "${testCase.input}"`);

    // Run hybrid classification
    const startTime = Date.now();
    const result = await classifier.classifyHybrid(testCase.input);
    const totalTime = Date.now() - startTime;

    if (!result.success || !result.intent) {
      console.error(`❌ Classification failed: ${result.error}`);
      failed++;
      continue;
    }

    const { intent } = result;

    // Validate action type
    const actionMatch = intent.action === testCase.expectedAction;
    if (!actionMatch) {
      console.error(
        `❌ Action mismatch: expected "${testCase.expectedAction}", got "${intent.action}"`
      );
      failed++;
      continue;
    }

    // Validate command (if specified)
    if (testCase.expectedCommand) {
      let commandMatch = false;
      if (testCase.expectedCommand instanceof RegExp) {
        commandMatch = testCase.expectedCommand.test(intent.command || "");
      } else {
        commandMatch = intent.command === testCase.expectedCommand;
      }

      if (!commandMatch) {
        console.error(
          `❌ Command mismatch: expected "${testCase.expectedCommand}", got "${intent.command}"`
        );
        failed++;
        continue;
      }
    }

    // Validate target (if specified)
    if (testCase.expectedTarget && intent.target !== testCase.expectedTarget) {
      console.error(
        `❌ Target mismatch: expected "${testCase.expectedTarget}", got "${intent.target}"`
      );
      failed++;
      continue;
    }

    // Test passed
    console.log(`✅ Action: ${intent.action}`);
    if (intent.command) console.log(`   Command: ${intent.command}`);
    if (intent.target) console.log(`   Target: ${intent.target}`);
    if (intent.parameters)
      console.log(`   Parameters: ${JSON.stringify(intent.parameters)}`);
    console.log(`   Confidence: ${intent.confidence.toFixed(2)}`);
    console.log(`   ⏱️  Time: ${totalTime}ms`);

    passed++;
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log(`\n📊 Results: ${passed}/${testCases.length} passed`);

  if (failed > 0) {
    console.log(`❌ ${failed} tests failed\n`);
    process.exit(1);
  } else {
    console.log("✅ All tests passed!\n");
  }
}

/**
 * Benchmark: Compare Stage 1 (regex) vs Full LLM classification
 */
async function runBenchmark() {
  console.log("\n⚡ Performance Benchmark\n");
  console.log("═══════════════════════════════════════════════\n");

  const classifier = new IntentClassifier(config);
  const testInput = "open chrome";

  // Benchmark Stage 1 only (regex detection)
  const stage1Start = Date.now();
  const stage1Intent = classifier["detectIntentType"](testInput.toLowerCase());
  const stage1Time = Date.now() - stage1Start;

  console.log(`Stage 1 (Regex):      ${stage1Time}ms`);
  console.log(`  Detected: ${stage1Intent}\n`);

  // Benchmark Two-Stage Hybrid
  const hybridStart = Date.now();
  const hybridResult = await classifier.classifyHybrid(testInput);
  const hybridTime = Date.now() - hybridStart;

  console.log(`Two-Stage Hybrid:     ${hybridTime}ms`);
  console.log(`  Intent: ${hybridResult.intent?.action}`);
  console.log(`  Command: ${hybridResult.intent?.command}`);
  console.log(`  Target: ${hybridResult.intent?.target}\n`);

  // Benchmark Full LLM classification (old approach)
  const llmStart = Date.now();
  const llmResult = await classifier.classify(testInput);
  const llmTime = Date.now() - llmStart;

  console.log(`Full LLM (Old):       ${llmTime}ms`);
  console.log(`  Intent: ${llmResult.intent?.action}\n`);

  console.log("═══════════════════════════════════════════════");
  console.log(
    `\n🚀 Speedup: ${(llmTime / hybridTime).toFixed(1)}x faster with hybrid approach\n`
  );
}

// Run tests
try {
  await runTests();
  await runBenchmark();
} catch (error) {
  console.error(`\n❌ Test error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
