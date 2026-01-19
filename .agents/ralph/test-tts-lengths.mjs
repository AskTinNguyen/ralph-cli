#!/usr/bin/env node
/**
 * Test TTS summarization length compliance
 * Verifies summaries stay within design specifications
 *
 * Design Specs:
 * - short: 150 chars max, under 30 words (target: ≤75 chars / ≤15 words)
 * - medium: 600 chars max, under 100 words (target: ≤300 chars / ≤50 words)
 * - full: 1200 chars max, under 200 words (target: ≤600 chars / ≤100 words)
 *
 * Success Criteria:
 * - Summaries use ≤50% of character budget
 * - Zero symbols/file paths/technical abbreviations
 */

import { readFileSync, writeFileSync } from "fs";
import { getModeConfig } from "./lib/tts-modes.mjs";

// Test response templates
const TEST_RESPONSES = {
  error_short: {
    type: "error",
    user: "Can you fix the login bug?",
    assistant: "I've encountered an error in the ~/.config/auth.json file. The authentication API service failed with error 401. The TTS system cannot read the config.js file. I'll fix this by updating the settings in /usr/local/lib/auth.sh.",
    expectedContext: "error"
  },

  completion_short: {
    type: "completion",
    user: "Add a delete button",
    assistant: "I've successfully implemented the delete button feature. Created the DeleteButton.tsx component in src/components/buttons/. Added the API endpoint in server/api/delete.js. Updated the UserProfile.jsx to include the new button. All 47 unit tests pass. The feature is ready for deployment.",
    expectedContext: "completion"
  },

  blocker_short: {
    type: "blocker",
    user: "Can we deploy now?",
    assistant: "Deployment is blocked. The CI/CD pipeline requires the API_KEY environment variable to be set. You'll need to add the credentials to .env.production before we can proceed. The system also needs the SSH keys configured in ~/.ssh/config.",
    expectedContext: "blocker"
  },

  explanation_medium: {
    type: "explanation",
    user: "How does authentication work?",
    assistant: `Authentication works through a multi-step process:

1. User submits credentials via the login.tsx form
2. Client sends POST request to /api/auth/login endpoint
3. Server validates credentials against database using bcrypt.js
4. JWT token generated with secret from .env file
5. Token stored in localStorage via auth-storage.js
6. Subsequent requests include token in Authorization header
7. Middleware in server/middleware/auth.ts verifies token
8. Protected routes check req.user object populated by middleware

The system uses industry-standard JWT (JSON Web Token) implementation. Session expiry set to 24 hours. Refresh tokens handled by refresh-token.js service. HTTPS/TLS encryption ensures security. Rate limiting prevents brute force attacks via rate-limiter.config.json.`,
    expectedContext: "explanation"
  },

  completion_full: {
    type: "completion",
    user: "Implement the user dashboard",
    assistant: `I've completed the user dashboard implementation. Here's what was done:

**Components Created:**
- Dashboard.tsx - Main dashboard container (src/components/dashboard/)
- UserStats.tsx - Statistics widget showing metrics
- ActivityFeed.tsx - Real-time activity display
- QuickActions.tsx - Action buttons panel
- ProfileCard.tsx - User profile summary

**API Endpoints:**
- GET /api/dashboard/stats - Fetch user statistics
- GET /api/dashboard/activity - Get recent activity
- POST /api/dashboard/preferences - Save user preferences
- PUT /api/users/:id/settings - Update user settings

**Features Implemented:**
1. Real-time updates via WebSocket connection
2. Responsive design for mobile/tablet/desktop
3. Dark mode support using theme-switcher.js
4. Data visualization with Chart.js library
5. Export data to CSV functionality
6. Customizable widget layout (drag & drop)
7. Keyboard shortcuts for power users
8. Accessibility features (ARIA labels, screen reader support)

**Files Modified:**
- src/App.tsx - Added dashboard route
- src/routes.config.js - Configured routing
- server/api/dashboard.js - Backend logic
- server/db/queries/dashboard.sql - Database queries
- tests/dashboard.test.ts - 23 unit tests
- tests/e2e/dashboard.spec.js - 12 integration tests

**Testing Results:**
- All 35 tests passing ✅
- Coverage: 94% (src/components/dashboard/)
- Performance: < 2s initial load
- Bundle size: +45KB gzipped

**Next Steps:**
- Add analytics tracking
- Implement user onboarding tour
- Create admin analytics dashboard
- Add export to PDF feature`,
    expectedContext: "completion"
  },

  vietnamese_short: {
    type: "completion",
    user: "Thêm nút xóa",
    assistant: "Tôi đã triển khai tính năng nút xóa. Tạo component DeleteButton.tsx trong src/components/. Thêm API endpoint trong server/api/delete.js. Cập nhật UserProfile.tsx để bao gồm nút mới. Tất cả 47 bài kiểm tra đều pass.",
    expectedContext: "completion"
  }
};

// Generate test transcript
function createTranscript(testCase) {
  return [
    JSON.stringify({
      type: "user",
      message: { content: testCase.user }
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: testCase.assistant }
    })
  ].join("\n");
}

// Count words in text
function countWords(text) {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// Check for violations
function checkViolations(text) {
  const violations = [];

  // Check for symbols
  if (/[~\/\\|@#$%^&*`<>{}\[\]=+_]/.test(text)) {
    violations.push("symbols");
  }

  // Check for file paths/extensions
  if (/\.(js|ts|py|sh|json|md|tsx|jsx|mjs|html|css|yaml|yml)\b/i.test(text)) {
    violations.push("file_extensions");
  }

  // Check for path patterns
  if (/[\w\-]+\/[\w\-]+/.test(text)) {
    violations.push("paths");
  }

  // Check for technical abbreviations
  if (/\b(API|CLI|TTS|JSON|JWT|HTML|CSS|URL|HTTP|HTTPS|SSH|FTP|SQL|XML|YAML|CSV)\b/.test(text)) {
    violations.push("tech_abbreviations");
  }

  // Check for emojis
  if (/[\u2705\u274C\u26A0\u{1F534}\u{1F7E2}\u{1F680}\u{1F4A1}]/u.test(text)) {
    violations.push("emojis");
  }

  return violations;
}

// Run test for a mode
async function testMode(modeName, testCase, scriptPath) {
  const config = getModeConfig(modeName);
  const transcript = createTranscript(testCase);
  const transcriptPath = `/tmp/test-tts-${modeName}-${testCase.type}.jsonl`;

  // Write transcript
  writeFileSync(transcriptPath, transcript);

  // Run summarization (will use fallback since Ollama likely not running)
  const { execSync } = await import("child_process");
  let summary = "";
  let error = null;

  try {
    const result = execSync(
      `node ${scriptPath} ${transcriptPath} ${modeName} 2>&1`,
      { encoding: "utf-8", timeout: 5000 }
    );

    // Extract summary (last line that's not an error)
    const lines = result.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith("[") && lines[i].length > 0) {
        summary = lines[i];
        break;
      }
    }
  } catch (err) {
    error = err.message;
  }

  // Analyze results
  const charCount = summary.length;
  const wordCount = countWords(summary);
  const violations = checkViolations(summary);

  const charBudget = config.maxChars;
  const charUsage = (charCount / charBudget * 100).toFixed(1);
  const charTarget = charBudget * 0.5;
  const withinBudget = charCount <= charBudget;
  const within50Percent = charCount <= charTarget;

  // Parse word limit from promptWords
  const wordLimitMatch = config.promptWords.match(/under (\d+) words/);
  const wordBudget = wordLimitMatch ? parseInt(wordLimitMatch[1]) : null;
  const wordUsage = wordBudget ? (wordCount / wordBudget * 100).toFixed(1) : "N/A";
  const withinWordBudget = wordBudget ? wordCount <= wordBudget : true;

  return {
    mode: modeName,
    testCase: testCase.type,
    summary,
    charCount,
    charBudget,
    charTarget,
    charUsage: `${charUsage}%`,
    wordCount,
    wordBudget,
    wordUsage: wordBudget ? `${wordUsage}%` : "N/A",
    violations,
    withinBudget,
    within50Percent,
    withinWordBudget,
    pass: withinBudget && violations.length === 0,
    error
  };
}

// Main test runner
async function main() {
  console.log("=== TTS Summarization Length Tests ===\n");

  const summarizeScript = ".agents/ralph/summarize-for-tts.mjs";
  const recapScript = ".agents/ralph/recap-for-tts.mjs";

  const results = [];

  // Test summarize-for-tts.mjs with auto-detected modes
  console.log("## Testing summarize-for-tts.mjs (auto-speak)\n");

  for (const [name, testCase] of Object.entries(TEST_RESPONSES)) {
    // Auto-speak uses adaptive mode detection, but we'll test with explicit modes
    const mode = name.includes("_full") ? "full" :
                 name.includes("_medium") ? "medium" : "short";

    const result = await testMode(mode, testCase, summarizeScript);
    results.push({ script: "summarize", ...result });

    const status = result.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} [${result.mode}] ${result.testCase}`);
    console.log(`  Chars: ${result.charCount}/${result.charBudget} (${result.charUsage}, target: ≤${result.charTarget})`);
    console.log(`  Words: ${result.wordCount}/${result.wordBudget || "N/A"} (${result.wordUsage})`);

    if (!result.within50Percent) {
      console.log(`  ⚠️  Exceeds 50% budget target (${result.charCount} > ${result.charTarget})`);
    }

    if (result.violations.length > 0) {
      console.log(`  ❌ Violations: ${result.violations.join(", ")}`);
    }

    if (result.error) {
      console.log(`  ⚠️  Error: ${result.error}`);
    }

    console.log();
  }

  // Test recap-for-tts.mjs with explicit modes
  console.log("\n## Testing recap-for-tts.mjs (manual recap)\n");

  const recapTests = [
    { name: "error_short", mode: "short" },
    { name: "completion_short", mode: "medium" },
    { name: "explanation_medium", mode: "medium" },
    { name: "completion_full", mode: "full" },
    { name: "vietnamese_short", mode: "short" }
  ];

  for (const { name, mode } of recapTests) {
    const testCase = TEST_RESPONSES[name];
    const result = await testMode(mode, testCase, recapScript);
    results.push({ script: "recap", ...result });

    const status = result.pass ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} [${result.mode}] ${result.testCase}`);
    console.log(`  Chars: ${result.charCount}/${result.charBudget} (${result.charUsage}, target: ≤${result.charTarget})`);
    console.log(`  Words: ${result.wordCount}/${result.wordBudget || "N/A"} (${result.wordUsage})`);

    if (!result.within50Percent) {
      console.log(`  ⚠️  Exceeds 50% budget target (${result.charCount} > ${result.charTarget})`);
    }

    if (result.violations.length > 0) {
      console.log(`  ❌ Violations: ${result.violations.join(", ")}`);
    }

    console.log();
  }

  // Summary statistics
  console.log("\n=== Summary Statistics ===\n");

  const totalTests = results.length;
  const passedTests = results.filter(r => r.pass).length;
  const failedTests = totalTests - passedTests;

  const within50 = results.filter(r => r.within50Percent).length;
  const withViolations = results.filter(r => r.violations.length > 0).length;

  const avgCharUsage = (results.reduce((sum, r) =>
    sum + parseFloat(r.charUsage), 0) / totalTests).toFixed(1);

  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests} (${(passedTests/totalTests*100).toFixed(1)}%)`);
  console.log(`Failed: ${failedTests}`);
  console.log();
  console.log(`Within 50% Budget: ${within50}/${totalTests} (${(within50/totalTests*100).toFixed(1)}%)`);
  console.log(`With Violations: ${withViolations}/${totalTests}`);
  console.log(`Avg Character Usage: ${avgCharUsage}%`);

  // Detailed breakdown by mode
  console.log("\n=== Breakdown by Mode ===\n");

  for (const mode of ["short", "medium", "full"]) {
    const modeResults = results.filter(r => r.mode === mode);
    if (modeResults.length === 0) continue;

    const config = getModeConfig(mode);
    const avgChars = (modeResults.reduce((sum, r) => sum + r.charCount, 0) / modeResults.length).toFixed(0);
    const avgWords = (modeResults.reduce((sum, r) => sum + r.wordCount, 0) / modeResults.length).toFixed(0);
    const within50 = modeResults.filter(r => r.within50Percent).length;

    console.log(`**${mode.toUpperCase()}** (budget: ${config.maxChars} chars, ${config.promptWords})`);
    console.log(`  Tests: ${modeResults.length}`);
    console.log(`  Avg: ${avgChars} chars, ${avgWords} words`);
    console.log(`  Within 50% budget: ${within50}/${modeResults.length}`);
    console.log();
  }

  // Exit with appropriate code
  process.exit(failedTests > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
