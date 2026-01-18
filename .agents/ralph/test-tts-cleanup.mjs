#!/usr/bin/env node
/**
 * Test script for TTS cleanup improvements
 * Verifies that symbols, technical terms, and repetition are removed
 */

import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the cleanup function from summarize-for-tts.mjs
// Note: This is a test-only import - the function is not exported normally
import { readFileSync } from "fs";
import { join } from "path";

// Load the summarize-for-tts.mjs file and extract the cleanSummary function
const summarizerCode = readFileSync(join(__dirname, "summarize-for-tts.mjs"), "utf-8");

// Extract cleanSummary, removeRepetitiveSentences, and calculateOverlap functions
const cleanSummaryMatch = summarizerCode.match(/function cleanSummary\(text\) {[\s\S]*?^}/m);
const removeRepMatch = summarizerCode.match(/function removeRepetitiveSentences\(text\) {[\s\S]*?^}/m);
const calcOverlapMatch = summarizerCode.match(/function calculateOverlap\(sig1, sig2\) {[\s\S]*?^}/m);

if (!cleanSummaryMatch || !removeRepMatch || !calcOverlapMatch) {
  console.error("❌ Could not extract cleanup functions");
  process.exit(1);
}

// Create isolated scope and evaluate functions
const functionCode = `
${removeRepMatch[0]}
${calcOverlapMatch[0]}
${cleanSummaryMatch[0]}
cleanSummary
`;

const cleanSummary = eval(`(${functionCode})`);

// Test cases
const tests = [
  {
    name: "Symbol removal (tilde, slash)",
    input: "Updated the voice-config.json file in ~/.agents/ralph/ to set maxChars to 700",
    expectsNotContain: ["~", "/", ".json", "dot", "slash", "tilde"],
  },
  {
    name: "Technical abbreviations",
    input: "The API returns JSON data via HTTP to the CLI with TTS config",
    expectsNotContain: ["API", "JSON", "HTTP", "CLI", "TTS"],
  },
  {
    name: "Technical references",
    input: "Modified the file to update the function in the config",
    expectsNotContain: ["the file", "the function", "the config"],
  },
  {
    name: "Repetitive sentences",
    input: "Modified the configuration. Updated the configuration. Changed the configuration. Tests pass.",
    expectsNotContain: ["Updated the configuration", "Changed the configuration"],
    expectsContain: ["Modified", "Tests pass"],
  },
  {
    name: "File extensions",
    input: "Created test.js, updated config.json, and modified index.html files",
    expectsNotContain: [".js", ".json", ".html"],
  },
  {
    name: "Path patterns",
    input: "Files in .agents/ralph/lib/ and src/components/ were updated",
    expectsNotContain: [".agents/ralph/lib", "src/components"],
  },
  {
    name: "Multiple symbols",
    input: "Config has keys: @name, #id, $value, %rate, ^level, &mode, *flag, `code`, ~path, /dir, |pipe",
    expectsNotContain: ["@", "#", "$", "%", "^", "&", "*", "`", "~", "/", "|"],
  },
];

// Run tests
console.log("\n" + "=".repeat(60));
console.log("TTS Cleanup Function Test Suite");
console.log("=".repeat(60) + "\n");

let passed = 0;
let failed = 0;

for (const test of tests) {
  console.log(`\n📝 Test: ${test.name}`);
  console.log(`   Input:  "${test.input}"`);

  const output = cleanSummary(test.input);
  console.log(`   Output: "${output}"`);

  let testPassed = true;

  // Check that unwanted content is removed
  if (test.expectsNotContain) {
    for (const unwanted of test.expectsNotContain) {
      if (output.includes(unwanted)) {
        console.log(`   ❌ FAIL: Still contains "${unwanted}"`);
        testPassed = false;
      }
    }
  }

  // Check that wanted content is present
  if (test.expectsContain) {
    for (const wanted of test.expectsContain) {
      if (!output.includes(wanted)) {
        console.log(`   ❌ FAIL: Missing "${wanted}"`);
        testPassed = false;
      }
    }
  }

  if (testPassed) {
    console.log(`   ✅ PASS`);
    passed++;
  } else {
    failed++;
  }
}

// Summary
console.log("\n" + "=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log("=".repeat(60) + "\n");

if (failed > 0) {
  console.log("❌ Some tests failed - review cleanup logic");
  process.exit(1);
} else {
  console.log("✅ All tests passed - cleanup is working correctly!");
  process.exit(0);
}
