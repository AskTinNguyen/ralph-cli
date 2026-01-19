#!/usr/bin/env node
/**
 * Show actual summaries generated for analysis
 */

import { execSync } from "child_process";
import { writeFileSync } from "fs";

const testCases = [
  {
    name: "Error (short)",
    mode: "short",
    user: "Can you fix the login bug?",
    assistant: "I've encountered an error in the ~/.config/auth.json file. The authentication API service failed with error 401. The TTS system cannot read the config.js file. I'll fix this by updating the settings in /usr/local/lib/auth.sh."
  },
  {
    name: "Explanation (medium) - WITH VIOLATION",
    mode: "medium",
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

The system uses industry-standard JWT (JSON Web Token) implementation.`
  }
];

console.log("=== Actual Summaries Generated ===\n");

for (const tc of testCases) {
  const transcript = [
    JSON.stringify({ type: "user", message: { content: tc.user }}),
    JSON.stringify({ type: "assistant", message: { content: tc.assistant }})
  ].join("\n");

  const path = `/tmp/test-summary-${tc.mode}.jsonl`;
  writeFileSync(path, transcript);

  try {
    const result = execSync(
      `node .agents/ralph/recap-for-tts.mjs ${path} ${tc.mode} 2>&1`,
      { encoding: "utf-8", timeout: 5000 }
    );

    const lines = result.trim().split("\n");
    let summary = "";
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].startsWith("[") && lines[i].length > 0) {
        summary = lines[i];
        break;
      }
    }

    console.log(`**${tc.name}**`);
    console.log(`Mode: ${tc.mode}`);
    console.log(`Length: ${summary.length} chars, ${summary.split(/\s+/).length} words`);
    console.log(`Summary: "${summary}"`);
    console.log();

    // Check for violations
    const violations = [];
    if (/\b(API|CLI|TTS|JSON|HTML|CSS|JWT)\b/.test(summary)) {
      violations.push(`Tech abbrev: ${summary.match(/\b(API|CLI|TTS|JSON|HTML|CSS|JWT)\b/g)?.join(", ")}`);
    }
    if (/[\w\-]+\/[\w\-]+/.test(summary)) {
      violations.push("Paths found");
    }
    if (/\.(js|ts|json|sh)\b/i.test(summary)) {
      violations.push("File extensions found");
    }

    if (violations.length > 0) {
      console.log(`⚠️  VIOLATIONS: ${violations.join("; ")}`);
      console.log();
    }
  } catch (err) {
    console.log(`Error: ${err.message}`);
  }
}
