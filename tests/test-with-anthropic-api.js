#!/usr/bin/env node
/**
 * Verify token count using Anthropic's actual token counting
 *
 * Requires: npm install @anthropic-ai/sdk
 * Requires: ANTHROPIC_API_KEY environment variable
 *
 * This script uses Anthropic's official token counter to get exact counts.
 */

const fs = require("fs");
const path = require("path");

async function main() {
  console.log("🔍 Anthropic API Token Counter Test\n");
  console.log("=".repeat(80));

  // Check for @anthropic-ai/sdk
  let Anthropic;
  try {
    Anthropic = require("@anthropic-ai/sdk").default;
  } catch (err) {
    console.log("⚠️  @anthropic-ai/sdk not installed\n");
    console.log("To use the official Anthropic token counter:");
    console.log("  1. Install the SDK: npm install @anthropic-ai/sdk");
    console.log("  2. Set your API key: export ANTHROPIC_API_KEY=your_key");
    console.log("  3. Run this script again\n");
    console.log("For now, using character-based estimation (4 chars/token)...\n");
    return runFallbackTest();
  }

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log("⚠️  ANTHROPIC_API_KEY not set\n");
    console.log("Set your API key to use official token counting:");
    console.log("  export ANTHROPIC_API_KEY=your_key\n");
    console.log("Using fallback estimation...\n");
    return runFallbackTest();
  }

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    console.log("✓ Using Anthropic official token counter\n");
    console.log("-".repeat(80));

    // Test old architecture
    const oldRalph = fs.readFileSync("bin/ralph-original", "utf-8");
    const oldResult = await anthropic.messages.countTokens({
      model: "claude-sonnet-4-5-20250929",
      messages: [
        {
          role: "user",
          content: `Here is the Ralph CLI code:\n\n${oldRalph}\n\nHow does the stats command work?`,
        },
      ],
    });

    console.log("📦 OLD ARCHITECTURE (monolithic bin/ralph):");
    console.log(`   Exact tokens: ${oldResult.input_tokens.toLocaleString()}\n`);

    // Test new architecture
    const newRalph = fs.readFileSync("bin/ralph", "utf-8");
    const cliDisplay = fs.readFileSync("lib/cli/display.js", "utf-8");
    const cliArgs = fs.readFileSync("lib/cli/args.js", "utf-8");
    const statsCommand = fs.readFileSync("lib/commands/stats.js", "utf-8");

    const newContent = `
Here is the Ralph CLI code structure:

// bin/ralph (dispatcher)
${newRalph}

// lib/cli/display.js (utilities)
${cliDisplay}

// lib/cli/args.js (parsing)
${cliArgs}

// lib/commands/stats.js (stats command)
${statsCommand}

How does the stats command work?
`;

    const newResult = await anthropic.messages.countTokens({
      model: "claude-sonnet-4-5-20250929",
      messages: [
        {
          role: "user",
          content: newContent,
        },
      ],
    });

    console.log("📦 NEW ARCHITECTURE (modular):");
    console.log(`   Exact tokens: ${newResult.input_tokens.toLocaleString()}\n`);

    // Comparison
    const saved = oldResult.input_tokens - newResult.input_tokens;
    const percent = ((saved / oldResult.input_tokens) * 100).toFixed(1);

    console.log("-".repeat(80));
    console.log("📊 VERIFIED RESULTS:\n");
    console.log(`   Token reduction: ${saved.toLocaleString()} tokens`);
    console.log(`   Percentage:      ${percent}%`);
    console.log(`   Efficiency:      ${(oldResult.input_tokens / newResult.input_tokens).toFixed(1)}x improvement`);
    console.log("\n" + "=".repeat(80));

  } catch (err) {
    console.error("❌ Error using Anthropic API:", err.message);
    console.log("\nFalling back to estimation...\n");
    return runFallbackTest();
  }
}

function runFallbackTest() {
  const CHARS_PER_TOKEN = 4;

  const countTokens = (text) => Math.ceil(text.length / CHARS_PER_TOKEN);

  const oldRalph = fs.readFileSync("bin/ralph-original", "utf-8");
  const newRalph = fs.readFileSync("bin/ralph", "utf-8");
  const cliDisplay = fs.readFileSync("lib/cli/display.js", "utf-8");
  const cliArgs = fs.readFileSync("lib/cli/args.js", "utf-8");
  const statsCommand = fs.readFileSync("lib/commands/stats.js", "utf-8");

  const oldTokens = countTokens(oldRalph);
  const newTokens = countTokens(newRalph + cliDisplay + cliArgs + statsCommand);

  console.log("📦 OLD ARCHITECTURE (monolithic bin/ralph):");
  console.log(`   Estimated tokens: ${oldTokens.toLocaleString()}\n`);

  console.log("📦 NEW ARCHITECTURE (modular):");
  console.log(`   Estimated tokens: ${newTokens.toLocaleString()}\n`);

  const saved = oldTokens - newTokens;
  const percent = ((saved / oldTokens) * 100).toFixed(1);

  console.log("-".repeat(80));
  console.log("📊 ESTIMATED RESULTS:\n");
  console.log(`   Token reduction: ${saved.toLocaleString()} tokens`);
  console.log(`   Percentage:      ${percent}%`);
  console.log(`   Efficiency:      ${(oldTokens / newTokens).toFixed(1)}x improvement`);
  console.log("\n" + "=".repeat(80));
  console.log("\n💡 For exact counts, install @anthropic-ai/sdk and set ANTHROPIC_API_KEY");
}

main().catch(console.error);
