#!/usr/bin/env node
/**
 * Test script to measure token consumption before/after refactoring
 *
 * Simulates what an AI agent would need to read to understand a command.
 */

const fs = require("fs");
const path = require("path");

// Anthropic Claude uses ~4 characters per token on average
const CHARS_PER_TOKEN = 4;

function countTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    return "";
  }
}

function getFileSize(filePath) {
  try {
    const stats = fs.statSync(filePath);
    return stats.size;
  } catch {
    return 0;
  }
}

console.log("🔬 Token Consumption Analysis: Before vs After Refactoring\n");
console.log("Scenario: AI agent needs to understand how the 'stats' command works\n");
console.log("=".repeat(80));

// ============================================================================
// BEFORE: Monolithic bin/ralph
// ============================================================================
console.log("\n📦 BEFORE REFACTORING (Monolithic Architecture)");
console.log("-".repeat(80));

const oldRalph = readFile("bin/ralph-original");
const oldRalphTokens = countTokens(oldRalph);
const oldRalphLines = oldRalph.split("\n").length;

console.log("Files AI agent must read:");
console.log("  1. bin/ralph (entire file) - contains ALL commands");
console.log("");
console.log(`Total characters: ${oldRalph.length.toLocaleString()}`);
console.log(`Total lines:      ${oldRalphLines.toLocaleString()}`);
console.log(`Estimated tokens: ${oldRalphTokens.toLocaleString()}`);

// ============================================================================
// AFTER: Modular architecture
// ============================================================================
console.log("\n");
console.log("📦 AFTER REFACTORING (Modular Architecture)");
console.log("-".repeat(80));

const newRalph = readFile("bin/ralph");
const cliDisplay = readFile("lib/cli/display.js");
const cliArgs = readFile("lib/cli/args.js");
const statsCommand = readFile("lib/commands/stats.js");

const totalNew = newRalph + cliDisplay + cliArgs + statsCommand;
const newTotalTokens = countTokens(totalNew);

console.log("Files AI agent must read:");
console.log("  1. bin/ralph (thin dispatcher)");
console.log("  2. lib/cli/display.js (shared utilities)");
console.log("  3. lib/cli/args.js (argument parsing)");
console.log("  4. lib/commands/stats.js (stats command only)");
console.log("");

const breakdown = [
  { name: "bin/ralph", content: newRalph },
  { name: "lib/cli/display.js", content: cliDisplay },
  { name: "lib/cli/args.js", content: cliArgs },
  { name: "lib/commands/stats.js", content: statsCommand },
];

breakdown.forEach(({ name, content }) => {
  const lines = content.split("\n").length;
  const tokens = countTokens(content);
  console.log(`  ${name.padEnd(30)} ${lines.toString().padStart(5)} lines  ${tokens.toString().padStart(6)} tokens`);
});

console.log("");
console.log(`Total characters: ${totalNew.length.toLocaleString()}`);
console.log(`Total lines:      ${breakdown.reduce((sum, { content }) => sum + content.split("\n").length, 0).toLocaleString()}`);
console.log(`Estimated tokens: ${newTotalTokens.toLocaleString()}`);

// ============================================================================
// COMPARISON
// ============================================================================
console.log("\n");
console.log("📊 COMPARISON");
console.log("=".repeat(80));

const reduction = oldRalphTokens - newTotalTokens;
const reductionPercent = ((reduction / oldRalphTokens) * 100).toFixed(1);

console.log(`Token reduction:    ${reduction.toLocaleString()} tokens saved (${reductionPercent}% reduction)`);
console.log(`Efficiency factor:  ${(oldRalphTokens / newTotalTokens).toFixed(1)}x smaller context`);

console.log("\n💡 What this means:");
console.log("   - AI agents can understand commands faster");
console.log("   - Less context = lower costs per interaction");
console.log("   - More room in context window for actual code");
console.log("   - Faster response times from AI agents");

// ============================================================================
// TEST ALL COMMANDS
// ============================================================================
console.log("\n");
console.log("📋 TOKEN USAGE BY COMMAND");
console.log("=".repeat(80));

const commandFiles = fs.readdirSync("lib/commands").filter(f => f.endsWith(".js") && f !== "index.js");

console.log(`${"Command".padEnd(20)} ${"Lines".padStart(7)} ${"Tokens".padStart(8)} ${"With shared".padStart(15)}`);
console.log("-".repeat(80));

const sharedTokens = countTokens(newRalph + cliDisplay + cliArgs);

commandFiles.forEach(file => {
  const content = readFile(path.join("lib/commands", file));
  const lines = content.split("\n").length;
  const tokens = countTokens(content);
  const withShared = tokens + sharedTokens;
  const name = file.replace(".js", "");

  console.log(`${name.padEnd(20)} ${lines.toString().padStart(7)} ${tokens.toString().padStart(8)} ${withShared.toString().padStart(15)}`);
});

console.log("-".repeat(80));
console.log(`\nNote: "With shared" includes bin/ralph + lib/cli utilities (~${sharedTokens} tokens)`);
console.log(`Before refactoring, ANY command required reading ~${oldRalphTokens} tokens\n`);

// ============================================================================
// SUMMARY
// ============================================================================
console.log("✅ SUMMARY");
console.log("=".repeat(80));
console.log(`Worst case (largest command with shared): ~${Math.max(...commandFiles.map(f => {
  const content = readFile(path.join("lib/commands", f));
  return countTokens(content) + sharedTokens;
}))} tokens`);
console.log(`Best case (smallest command with shared):  ~${Math.min(...commandFiles.map(f => {
  const content = readFile(path.join("lib/commands", f));
  return countTokens(content) + sharedTokens;
}))} tokens`);
console.log(`Average per command:                        ~${Math.round(commandFiles.reduce((sum, f) => {
  const content = readFile(path.join("lib/commands", f));
  return sum + countTokens(content) + sharedTokens;
}, 0) / commandFiles.length)} tokens`);
console.log(`\nOld architecture (all commands):            ~${oldRalphTokens} tokens`);
console.log(`\nContext savings: ${reductionPercent}% - ${(oldRalphTokens / newTotalTokens).toFixed(1)}x improvement`);
console.log("=".repeat(80));
