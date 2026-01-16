/**
 * Simple Test: Two-Stage Hybrid Intent Classification
 * Tests the Ollama API directly without TypeScript compilation
 */

// Test configuration
const OLLAMA_URL = "http://localhost:11434";
const MODEL = "qwen2.5:1.5b";

// Colors for terminal output
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

/**
 * Stage 1: Quick Intent Detection (Regex)
 */
function detectIntentType(text) {
  const lowerText = text.toLowerCase().trim();

  // App control - open/close apps
  if (lowerText.match(/^(open|launch|start|close|quit)\s+(.+)/)) {
    return "app_control";
  }

  // App control - media commands (play, pause, stop, etc.)
  if (lowerText.match(/^(play|pause|stop|resume)\s*(music|spotify|song)?$/)) {
    return "app_control";
  }

  if (lowerText.match(/^(next|skip|previous|back)\s*(track|song)?$/)) {
    return "app_control";
  }

  // App control - window/system commands
  if (lowerText.match(/^(hide|minimize|switch\s+to)\s+(.+)/)) {
    return "app_control";
  }

  // Terminal commands
  if (lowerText.match(/^(run\s+)?npm\s+/)) {
    return "terminal";
  }
  if (lowerText.match(/^(run\s+)?git\s+/)) {
    return "terminal";
  }
  if (lowerText.match(/^(list|ls|show)\s+(files|directory)/)) {
    return "terminal";
  }

  // Ralph commands
  if (lowerText.match(/^(ralph\s+)?(prd|plan|build|stream|factory)/)) {
    return "ralph_command";
  }
  if (lowerText.match(/^(create|generate|write)\s+(a\s+)?(new\s+)?(prd|plan)/)) {
    return "ralph_command";
  }

  // Web search
  if (lowerText.match(/^(search|google|look\s+up)\s+/)) {
    return "web_search";
  }

  return "unknown";
}

/**
 * Stage 2: Entity Extraction (LLM)
 */
async function extractEntities(text, intentType) {
  const prompts = {
    app_control: `Extract the app name and action from this command.
For media commands (play, pause, stop) without a specified app, default to "Spotify".
Respond ONLY with JSON: {"action": "open/close/quit/play/pause", "appName": "App Name"}

Examples:
"open chrome" → {"action": "open", "appName": "Google Chrome"}
"close slack" → {"action": "quit", "appName": "Slack"}
"play music" → {"action": "play", "appName": "Spotify"}
"play a song" → {"action": "play", "appName": "Spotify"}
"pause" → {"action": "pause", "appName": "Spotify"}
"next track" → {"action": "next", "appName": "Spotify"}

User command: "${text}"`,

    terminal: `Extract the shell command to execute.
Respond ONLY with JSON: {"command": "exact command"}

Examples:
"run npm test" → {"command": "npm test"}
"git status" → {"command": "git status"}
"list files" → {"command": "ls -la"}

User command: "${text}"`,

    ralph_command: `Extract Ralph command details.
Respond ONLY with JSON: {"ralphCommand": "prd/plan/build", "prdNumber": "X", "iterations": "Y", "description": "..."}

Examples:
"create PRD for user auth" → {"ralphCommand": "prd", "description": "user auth"}
"ralph build 5 for PRD 3" → {"ralphCommand": "build", "iterations": "5", "prdNumber": "3"}

User command: "${text}"`,

    web_search: `Extract the search query.
Respond ONLY with JSON: {"query": "search terms"}

Examples:
"search for react hooks" → {"query": "react hooks"}

User command: "${text}"`,
  };

  const prompt = prompts[intentType] || prompts.app_control;

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: prompt,
      format: "json",
      stream: false,
      options: {
        temperature: 0.1,
        num_predict: 150,
      },
    }),
  });

  const data = await response.json();
  const entities = JSON.parse(data.response);

  return entities;
}

/**
 * Run hybrid classification
 */
async function classifyHybrid(text) {
  const startTime = Date.now();

  // Stage 1: Intent detection
  const stage1Start = Date.now();
  const intentType = detectIntentType(text);
  const stage1Time = Date.now() - stage1Start;

  if (intentType === "unknown") {
    return {
      success: false,
      error: "Unknown intent type",
      duration_ms: Date.now() - startTime,
    };
  }

  // Stage 2: Entity extraction
  const stage2Start = Date.now();
  const entities = await extractEntities(text, intentType);
  const stage2Time = Date.now() - stage2Start;

  const totalTime = Date.now() - startTime;

  return {
    success: true,
    intentType,
    entities,
    timings: {
      stage1: stage1Time,
      stage2: stage2Time,
      total: totalTime,
    },
  };
}

/**
 * Run test suite
 */
async function runTests() {
  console.log(`${colors.cyan}🧪 Testing Two-Stage Hybrid Intent Classifier${colors.reset}\n`);
  console.log("═══════════════════════════════════════════════\n");

  // Check Ollama availability
  console.log("🔍 Checking Ollama server...");
  try {
    const response = await fetch(`${OLLAMA_URL}/api/tags`);
    const data = await response.json();
    const hasModel = data.models.some((m) => m.name === MODEL);

    if (!hasModel) {
      console.error(`${colors.red}❌ Model ${MODEL} not found${colors.reset}`);
      console.error(`   Run: ollama pull ${MODEL}`);
      process.exit(1);
    }

    console.log(`${colors.green}✅ Ollama ready with ${MODEL}${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}❌ Ollama not running${colors.reset}`);
    console.error(`   Run: ollama serve`);
    process.exit(1);
  }

  // Test cases
  const tests = [
    {
      name: "App Control - Open Chrome",
      input: "open chrome",
      expectedIntent: "app_control",
      expectedEntities: { action: "open", appName: /chrome/i },
    },
    {
      name: "App Control - Close Slack",
      input: "close slack",
      expectedIntent: "app_control",
      expectedEntities: { action: /quit|close/, appName: /slack/i },
    },
    {
      name: "Terminal - NPM Test",
      input: "run npm test",
      expectedIntent: "terminal",
      expectedEntities: { command: "npm test" },
    },
    {
      name: "Terminal - Git Status",
      input: "git status",
      expectedIntent: "terminal",
      expectedEntities: { command: "git status" },
    },
    {
      name: "Ralph - Create PRD",
      input: "create a PRD for user authentication",
      expectedIntent: "ralph_command",
      expectedEntities: { ralphCommand: /prd/i, description: /auth/i },
    },
    {
      name: "Ralph - Build with PRD",
      input: "ralph build 5 for PRD 3",
      expectedIntent: "ralph_command",
      expectedEntities: { ralphCommand: "build", iterations: "5", prdNumber: "3" },
    },
    {
      name: "Web Search",
      input: "search for typescript best practices",
      expectedIntent: "web_search",
      expectedEntities: { query: /typescript/i },
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    console.log(`\n${colors.blue}📝 Test: ${test.name}${colors.reset}`);
    console.log(`   Input: "${test.input}"`);

    try {
      const result = await classifyHybrid(test.input);

      if (!result.success) {
        console.log(`${colors.red}   ❌ Failed: ${result.error}${colors.reset}`);
        failed++;
        continue;
      }

      // Validate intent type
      if (result.intentType !== test.expectedIntent) {
        console.log(
          `${colors.red}   ❌ Intent mismatch: expected "${test.expectedIntent}", got "${result.intentType}"${colors.reset}`
        );
        failed++;
        continue;
      }

      // Validate entities
      let entitiesValid = true;
      for (const [key, expected] of Object.entries(test.expectedEntities)) {
        const actual = result.entities[key];
        const matches =
          expected instanceof RegExp
            ? expected.test(String(actual))
            : actual === expected;

        if (!matches) {
          console.log(
            `${colors.red}   ❌ Entity mismatch: ${key} expected "${expected}", got "${actual}"${colors.reset}`
          );
          entitiesValid = false;
        }
      }

      if (!entitiesValid) {
        failed++;
        continue;
      }

      // Test passed
      console.log(`${colors.green}   ✅ Intent: ${result.intentType}${colors.reset}`);
      console.log(`      Entities: ${JSON.stringify(result.entities)}`);
      console.log(
        `      ${colors.yellow}⏱️  Stage 1: ${result.timings.stage1}ms, Stage 2: ${result.timings.stage2}ms, Total: ${result.timings.total}ms${colors.reset}`
      );
      passed++;
    } catch (error) {
      console.log(`${colors.red}   ❌ Error: ${error.message}${colors.reset}`);
      failed++;
    }
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log(`\n📊 Results: ${passed}/${tests.length} passed`);

  if (failed > 0) {
    console.log(`${colors.red}❌ ${failed} tests failed${colors.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${colors.green}✅ All tests passed!${colors.reset}\n`);
  }
}

/**
 * Interactive test mode
 */
async function interactiveTest() {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`\n${colors.cyan}🎤 Interactive Test Mode${colors.reset}`);
  console.log("Type voice commands to test classification (Ctrl+C to exit)\n");

  const prompt = () => {
    rl.question(`${colors.blue}> ${colors.reset}`, async (input) => {
      if (!input.trim()) {
        prompt();
        return;
      }

      try {
        const result = await classifyHybrid(input);

        if (result.success) {
          console.log(`${colors.green}Intent:${colors.reset} ${result.intentType}`);
          console.log(
            `${colors.green}Entities:${colors.reset} ${JSON.stringify(result.entities, null, 2)}`
          );
          console.log(
            `${colors.yellow}Timings:${colors.reset} Stage1=${result.timings.stage1}ms, Stage2=${result.timings.stage2}ms, Total=${result.timings.total}ms\n`
          );
        } else {
          console.log(`${colors.red}Error:${colors.reset} ${result.error}\n`);
        }
      } catch (error) {
        console.log(`${colors.red}Error:${colors.reset} ${error.message}\n`);
      }

      prompt();
    });
  };

  prompt();
}

// Run tests
const args = process.argv.slice(2);
if (args.includes("--interactive") || args.includes("-i")) {
  interactiveTest();
} else {
  runTests().catch((error) => {
    console.error(`\n${colors.red}❌ Test error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  });
}
