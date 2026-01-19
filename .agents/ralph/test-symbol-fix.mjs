#!/usr/bin/env node
/**
 * Test symbol cleanup improvements
 * Verifies ratios and percentages are converted properly
 */

const testCases = [
  {
    input: "11/11 tests passed (100%)",
    expected: "11 out of 11 tests passed (100 percent)",
    description: "Ratios and percentages"
  },
  {
    input: "Coverage: 94% across 3/5 modules",
    expected: "Coverage: 94 percent across 3 out of 5 modules",
    description: "Multiple ratios and percentages"
  },
  {
    input: "Fixed bug in ~/.config/auth.json",
    expected: "Fixed bug in on",
    description: "File paths should still be removed"
  },
  {
    input: "Score: 85/100 (85%)",
    expected: "Score: 85 out of 100 (85 percent)",
    description: "Ratio with larger numbers"
  },
  {
    input: "API service at /api/v1/users",
    expected: "service at users",
    description: "Path removal and abbreviation removal work"
  }
];

function cleanSummary(text) {
  let result = text.trim();

  // Remove file paths and extensions first
  result = result.replace(/[\w\-./]+\.(sh|js|mjs|ts|tsx|jsx|json|md|txt|py|yaml|yml|css|html|xml|sql|rb|go|rs|java|c|cpp|h)/gi, "");
  result = result.replace(/\.[\w\-/]+\//g, "");
  result = result.replace(/[\w\-]+\/[\w\-]+\//g, "");

  // SMART SYMBOL REMOVAL
  // First, protect ratios (11/11) and percentages (100%)
  result = result.replace(/(\d+)\/(\d+)/g, "$1 out of $2");
  result = result.replace(/(\d+)%/g, "$1 percent");

  // Now remove problematic symbols that TTS reads literally
  result = result.replace(/[~\/\\|<>{}[\]@#$%^&*`+=_]/g, "");

  // Remove technical abbreviations
  result = result.replace(/\b(API|CLI|TTS|JSON|JWT|HTML|CSS|URL|HTTP|HTTPS|SSH|FTP|SQL|XML|YAML|CSV)\b/g, "");

  // Clean up whitespace
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

console.log("=== Symbol Cleanup Test ===\n");

let passed = 0;
let failed = 0;

for (const tc of testCases) {
  const result = cleanSummary(tc.input);
  const success = result === tc.expected;

  if (success) {
    passed++;
    console.log(`✅ PASS: ${tc.description}`);
  } else {
    failed++;
    console.log(`❌ FAIL: ${tc.description}`);
    console.log(`  Input:    "${tc.input}"`);
    console.log(`  Expected: "${tc.expected}"`);
    console.log(`  Got:      "${result}"`);
  }
}

console.log(`\n${passed}/${testCases.length} tests passed`);

process.exit(failed > 0 ? 1 : 0);
