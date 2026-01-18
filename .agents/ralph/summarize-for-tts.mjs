#!/usr/bin/env node
/**
 * Summarize Claude Code response for TTS
 * Uses local Qwen model via TTSSummarizer with context-aware summarization
 *
 * Supports adaptive mode detection for optimal summary length based on response complexity.
 *
 * Usage: node summarize-for-tts.mjs <transcript_path>
 */

import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { MODES, detectOptimalMode, getModeConfig } from "./lib/tts-modes.mjs";
import { detectLanguage } from "./language-voice-mapper.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { createOutputFilter } from "../../ui/dist/voice-agent/filter/output-filter.js";

/**
 * Read auto-speak configuration from voice-config.json
 * Supports both legacy format ({ autoSpeak: true }) and new format
 * @returns {{ enabled: boolean, mode: string, fallbackMode: string }}
 */
function getAutoSpeakConfig() {
  // Try to find .ralph directory - walk up from cwd
  let searchDir = process.cwd();
  let configPath = null;

  while (searchDir !== dirname(searchDir)) {
    const candidate = join(searchDir, ".ralph", "voice-config.json");
    if (existsSync(candidate)) {
      configPath = candidate;
      break;
    }
    searchDir = dirname(searchDir);
  }

  // Default config
  const defaultConfig = {
    enabled: true,
    mode: "short", // Default to short for backwards compatibility
    fallbackMode: "short",
  };

  if (!configPath) {
    return defaultConfig;
  }

  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));

    // Handle legacy format: { autoSpeak: true/false }
    if (typeof config.autoSpeak === "boolean") {
      return {
        enabled: config.autoSpeak,
        mode: "short",
        fallbackMode: "short",
      };
    }

    // Handle new format: { autoSpeak: { enabled: true, mode: "adaptive" } }
    if (typeof config.autoSpeak === "object") {
      return {
        enabled: config.autoSpeak.enabled !== false,
        mode: config.autoSpeak.mode || "short",
        fallbackMode: config.autoSpeak.fallbackMode || "short",
      };
    }

    return defaultConfig;
  } catch (err) {
    return defaultConfig;
  }
}

async function main() {
  const transcriptPath = process.argv[2];

  if (!transcriptPath) {
    console.error("Usage: node summarize-for-tts.mjs <transcript_path>");
    process.exit(1);
  }

  try {
    // Read transcript - it's JSONL format (one JSON per line)
    const transcriptData = readFileSync(transcriptPath, "utf-8");
    const lines = transcriptData.trim().split("\n");

    // Parse each line and collect messages in order
    const messages = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if ((entry.type === "assistant" || entry.type === "user") && entry.message) {
          messages.push(entry);
        }
      } catch (e) {
        // Skip malformed lines
      }
    }

    // Find the last assistant message that has text content (not just tool_use)
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].type === "assistant") {
        const content = messages[i].message?.content;
        // Check if this message has actual text content
        if (Array.isArray(content)) {
          const hasText = content.some(block => block.type === "text");
          if (hasText) {
            lastAssistantIdx = i;
            break;
          }
        } else if (typeof content === "string" && content.trim()) {
          lastAssistantIdx = i;
          break;
        }
      }
    }

    if (lastAssistantIdx === -1) {
      process.exit(0); // No assistant message, silent exit
    }

    // Find the user message that preceded this assistant message
    // Skip system messages like <local-command-caveat>, <bash-input>, etc.
    let userQuestion = "";
    for (let i = lastAssistantIdx - 1; i >= 0; i--) {
      if (messages[i].type === "user") {
        const userContent = messages[i].message?.content;
        let text = "";
        if (typeof userContent === "string") {
          text = userContent;
        } else if (Array.isArray(userContent)) {
          const textBlocks = userContent.filter((b) => b.type === "text");
          text = textBlocks.map((b) => b.text).join("\n");
        }
        // Skip system/meta messages (local-command-caveat, bash tags, system-reminder)
        if (text && !text.startsWith("<") && text.trim().length > 0) {
          userQuestion = text;
          break;
        }
      }
    }

    // Get the last assistant message content
    const lastEntry = messages[lastAssistantIdx];
    const content = lastEntry.message.content;

    // Extract text content from assistant response
    let responseText = "";
    if (typeof content === "string") {
      responseText = content;
    } else if (Array.isArray(content)) {
      const textBlocks = content.filter(
        (block) => block.type === "text"
      );
      responseText = textBlocks.map((block) => block.text).join("\n");
    }

    if (!responseText || responseText.trim().length === 0) {
      process.exit(0); // No text content
    }

    // Step 1: Apply output filter to remove verbose content
    const filter = createOutputFilter({
      maxLength: 1000, // Allow longer for summarization
      maxCodeLines: 0, // Remove all code blocks
      includeFilePaths: false,
      includeStats: false,
    });

    const filtered = filter.filter(responseText);

    if (!filtered || filtered.trim().length === 0) {
      process.exit(0); // Nothing speakable after filtering
    }

    // Step 2: Determine mode configuration
    const autoSpeakConfig = getAutoSpeakConfig();
    let modeConfig;
    let modeName;

    if (autoSpeakConfig.mode === "adaptive") {
      const detection = detectOptimalMode(responseText);
      modeConfig = getModeConfig(detection.mode);
      modeName = detection.mode;
      console.error(`[auto-speak] Adaptive mode: ${detection.mode} (${detection.reason})`);
    } else {
      modeConfig = getModeConfig(autoSpeakConfig.mode);
      modeName = autoSpeakConfig.mode;
    }

    // Step 3: Context-aware summarization with Qwen
    const summary = await contextAwareSummarize(filtered, userQuestion, modeConfig);

    if (summary && summary.trim().length > 0) {
      // Clean up the summary - remove quotes if present
      let cleaned = summary.trim();

      // Remove wrapping quotes (some LLMs add them)
      if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
          (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
      }

      // CRITICAL: Enforce max length for TTS (prevents jibberish from overly long text)
      // Truncate at sentence boundary based on mode configuration
      cleaned = truncateForTTS(cleaned.trim(), modeConfig.maxChars);

      // Output the summary
      console.log(cleaned);
    }

    process.exit(0);
  } catch (error) {
    // Log error but don't speak it
    console.error(`[summarize-for-tts] Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Context-aware summarization using Qwen
 * Considers the user's original question when summarizing
 * @param {string} response - The filtered response text
 * @param {string} userQuestion - The user's original question
 * @param {object} modeConfig - Mode configuration with maxChars, maxTokens, promptWords, promptStyle
 */
async function contextAwareSummarize(response, userQuestion, modeConfig) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
  const timeout = modeConfig.maxTokens > 200 ? 15000 : 10000; // Longer timeout for longer summaries

  // Detect language of the response for proper TTS routing
  const detectedLang = detectLanguage(response);
  const isVietnamese = detectedLang === "vi";

  // Language-specific instructions
  const langInstruction = isVietnamese
    ? "- CRITICAL: Summarize in Vietnamese (tiếng Việt) - preserve the original language"
    : "- Use ONLY plain conversational English - no technical terms";

  // Build context-aware prompt based on mode
  let prompt;
  if (userQuestion && userQuestion.trim().length > 0) {
    prompt = `You are a TTS summarizer. The user asked: "${userQuestion.trim().substring(0, 200)}"

The AI assistant responded with:
${response.substring(0, 3000)}

Create a spoken summary as ${modeConfig.promptStyle}, ${modeConfig.promptWords}.

CRITICAL RULES:
- Focus on answering what the user asked
${langInstruction}
- NEVER mention file names, paths, or extensions (e.g., .sh, .js, .agents)
- NEVER include symbols: @ * # \` | < > { } [ ] / .
- NEVER say "the file" or "the script" - describe what was DONE
- If it's about code changes, say what changed in plain language
- For lists, use numbered words: "One, ... Two, ... Three, ..."
- State key outcomes and next steps

Spoken summary:`;
  } else {
    // Fallback to standard summarization without context
    prompt = `You are a TTS summarizer. Convert this AI response into a spoken summary:

${response.substring(0, 3000)}

Create a spoken summary as ${modeConfig.promptStyle}, ${modeConfig.promptWords}.

CRITICAL RULES:
- Extract the key outcomes and actions
- NEVER mention file names, paths, or extensions
- NEVER include symbols: @ * # \` | < > { } [ ] / .
${langInstruction}
- For lists, use numbered words: "One, ... Two, ... Three, ..."

Spoken summary:`;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(`${ollamaUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: {
          num_predict: modeConfig.maxTokens,
          temperature: 0.3,
          top_p: 0.9,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = await res.json();
    return cleanSummary(data.response || "");
  } catch (error) {
    // Fallback to regex-based cleanup
    console.error(`[summarize-for-tts] LLM failed, using fallback: ${error.message}`);
    return fallbackSummarize(response, modeConfig);
  }
}

/**
 * Clean up the generated summary
 */
function cleanSummary(text) {
  let result = text.trim();

  // Remove code blocks
  result = result.replace(/```[\s\S]*?```/g, "");
  result = result.replace(/`([^`]+)`/g, "$1");

  // Remove markdown formatting
  result = result.replace(/^#{1,6}\s+/gm, "");
  result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
  result = result.replace(/\*([^*]+)\*/g, "$1");
  result = result.replace(/__([^_]+)__/g, "$1");
  result = result.replace(/_([^_]+)_/g, "$1");

  // Remove bullet points
  result = result.replace(/^[\s]*[-*+]\s+/gm, "");
  result = result.replace(/^[\s]*\d+\.\s+/gm, "");

  // Remove @ symbols (markdown mentions)
  result = result.replace(/@/g, "");

  // Remove file paths and extensions
  // Matches: path/to/file.ext, .agents/ralph/script.sh, etc.
  result = result.replace(/[\w\-./]+\.(sh|js|mjs|ts|tsx|jsx|json|md|txt|py|yaml|yml)/gi, "");

  // Remove remaining path-like patterns (e.g., .agents/ralph/lib/)
  result = result.replace(/\.[\w\-/]+\//g, "");

  // Remove URLs
  result = result.replace(/https?:\/\/[^\s]+/g, "");

  // Remove XML/HTML-like tags
  result = result.replace(/<[^>]+>/g, "");

  // Remove special characters that TTS struggles with
  result = result.replace(/[|<>{}[\]]/g, "");

  // Remove common status emojis that TTS reads literally
  // Includes: ✅ ❌ ⚠️ ✓ ✔ ☑ ❎ ⬜ ⬛ 🔴 🟢 🟡 ⭐ 🎉 👍 👎 🚀 💡 📝 🔧 🐛 etc.
  result = result.replace(/[\u2705\u274C\u26A0\u2713\u2714\u2611\u274E\u2B1C\u2B1B\u{1F534}\u{1F7E2}\u{1F7E1}\u2B50\u{1F389}\u{1F44D}\u{1F44E}\u{1F680}\u{1F4A1}\u{1F4DD}\u{1F527}\u{1F41B}]/gu, "");

  // Fallback: remove any remaining emoji characters (comprehensive Unicode ranges)
  result = result.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "");

  // Remove extra punctuation (multiple periods, etc.)
  result = result.replace(/\.{2,}/g, ".");
  result = result.replace(/,{2,}/g, ",");

  // Normalize whitespace
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

/**
 * Truncate text for TTS at a clean sentence boundary
 * Ensures summary ends with proper punctuation and doesn't cut mid-word
 */
function truncateForTTS(text, maxLength = 150) {
  if (!text || text.length <= maxLength) {
    // Ensure it ends with punctuation
    if (text && !text.match(/[.!?]$/)) {
      return text + ".";
    }
    return text;
  }

  // Try to truncate at sentence boundary (., !, ?)
  const truncated = text.substring(0, maxLength);

  // Look for last sentence ending
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastExclaim = truncated.lastIndexOf("! ");
  const lastQuestion = truncated.lastIndexOf("? ");

  const lastSentenceEnd = Math.max(lastPeriod, lastExclaim, lastQuestion);

  if (lastSentenceEnd > maxLength * 0.5) {
    // Found a sentence boundary in the second half - use it
    return truncated.substring(0, lastSentenceEnd + 1);
  }

  // No good sentence boundary - truncate at last word
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + ".";
  }

  // Fallback: just truncate and add period
  return truncated + ".";
}

/**
 * Fallback summarization when LLM is unavailable
 * @param {string} text - Text to summarize
 * @param {object} modeConfig - Mode configuration with maxChars
 */
function fallbackSummarize(text, modeConfig) {
  let result = cleanSummary(text);
  const maxLength = modeConfig?.maxChars || 200;

  // If still too long, truncate at sentence boundary
  if (result.length > maxLength) {
    const truncated = result.substring(0, maxLength);
    const lastPeriod = truncated.lastIndexOf(". ");
    if (lastPeriod > maxLength * 0.5) {
      return truncated.substring(0, lastPeriod + 1);
    }
    return truncated.substring(0, truncated.lastIndexOf(" ")) + "...";
  }

  return result;
}

main();
