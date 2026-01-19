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
    prompt = `You are a voice assistant. The user asked: "${userQuestion.trim().substring(0, 200)}"

The assistant's response:
${response.substring(0, 3000)}

Your task: Create a clear, CONCISE spoken summary answering what the user asked.

CRITICAL LENGTH LIMIT: ${modeConfig.promptWords}
FORMAT (${modeConfig.promptStyle}):
${langInstruction}
- Use natural conversational speech
- For lists: "First, [action]. Second, [action]. Third, [action]."
- State ONLY the main point once - NEVER repeat or rephrase the same idea
- Be direct and concise - every word must add value

STRICT RULES - NEVER include:
- File names or paths (voice-config.json, .agents/ralph, src/components)
- File extensions (.sh, .js, .py, .md, .json, .tsx)
- Technical references ("the file", "the script", "the function", "the config")
- Symbols: ~ / \\ | @ # $ % ^ & * \` < > { } [ ] = + _
- Numbers with units unless essential (150ms, 10s, 200MB)
- Abbreviations (TTS, API, CLI) - say full words
- Code syntax or technical jargon

WHAT TO SAY:
- Actions completed: "Added feature X", "Fixed the login bug"
- Key outcomes: "Users can now...", "The system will..."
- Next steps: "You should...", "Consider..."
- Answer directly - what did we accomplish?

BAD: "Updated the voice config dot json file in dot agents slash ralph"
GOOD: "Changed the voice settings to use a quieter tone"

BAD: "One, modified the file. Two, tested the file. Three, the file works now."
GOOD: "First, adjusted the settings. Second, verified it works. Done."

BAD: "I've updated the configuration. The configuration now uses new settings. These new settings improve performance."
GOOD: "Updated configuration for better performance."

Generate ONLY the spoken summary (${modeConfig.promptWords} MAX, no meta-text, no repetition):`;
  } else {
    // Fallback to standard summarization without context
    prompt = `You are a voice assistant converting this response to natural speech:

${response.substring(0, 3000)}

CRITICAL LENGTH LIMIT: ${modeConfig.promptWords}
Create a CONCISE spoken summary (${modeConfig.promptStyle}).

STRICT RULES - NEVER include:
- File names, paths, or extensions
- Symbols: ~ / \\ | @ # $ % ^ & * \` < > { } [ ] = + _
${langInstruction}
- Technical references or abbreviations
- Repetitive phrases - state each idea ONCE only

FORMAT:
- Natural conversational speech
- For lists: "First, [item]. Second, [item]. Third, [item]."
- Be direct and concise - every word must add value

Generate ONLY the spoken summary (${modeConfig.promptWords} MAX, no repetition):`;
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
          temperature: 0.3,        // Slightly higher for more natural variety
          top_p: 0.8,              // More deterministic
          top_k: 30,               // Reduced vocabulary diversity
          repeat_penalty: 1.5,     // Strongly penalize repetition
          frequency_penalty: 0.7,  // Strongly reduce word reuse
          presence_penalty: 0.5,   // Encourage concept variety
          // Removed aggressive stop sequences that were cutting off summaries
          stop: ["Summary:", "Note:", "Important:", "In summary"], // Only stop at meta-text, not paragraph breaks
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
 * Enhanced to catch symbols, technical terms, and repetitive patterns
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

  // Remove file paths and extensions (aggressive)
  // Matches: path/to/file.ext, .agents/ralph/script.sh, etc.
  result = result.replace(/[\w\-./]+\.(sh|js|mjs|ts|tsx|jsx|json|md|txt|py|yaml|yml|css|html|xml|sql|rb|go|rs|java|c|cpp|h)/gi, "");

  // Remove path-like patterns (e.g., .agents/ralph/lib/, src/components/)
  result = result.replace(/\.[\w\-/]+\//g, "");
  result = result.replace(/[\w\-]+\/[\w\-]+\//g, ""); // foo/bar/ patterns

  // Remove URLs
  result = result.replace(/https?:\/\/[^\s]+/g, "");

  // Remove XML/HTML-like tags
  result = result.replace(/<[^>]+>/g, "");

  // AGGRESSIVE SYMBOL REMOVAL
  // Remove ALL problematic symbols that TTS reads literally
  result = result.replace(/[~\/\\|<>{}[\]@#$%^&*`+=_]/g, "");

  // Replace "dot" when it appears as word (from file extensions being read)
  result = result.replace(/\bdot\b/gi, "");
  result = result.replace(/\bslash\b/gi, "");
  result = result.replace(/\btilda\b/gi, "");
  result = result.replace(/\btilde\b/gi, "");

  // Remove technical abbreviations that slip through
  result = result.replace(/\b(API|CLI|TTS|JSON|HTML|CSS|URL|HTTP|HTTPS|SSH|FTP)\b/g, "");

  // Remove common technical words when followed by generic terms
  result = result.replace(/\bthe (file|script|function|config|directory|folder|repository|repo)\b/gi, "it");
  result = result.replace(/\bin the (file|script|function|config|directory|folder)\b/gi, "");

  // Remove common status emojis that TTS reads literally
  result = result.replace(/[\u2705\u274C\u26A0\u2713\u2714\u2611\u274E\u2B1C\u2B1B\u{1F534}\u{1F7E2}\u{1F7E1}\u2B50\u{1F389}\u{1F44D}\u{1F44E}\u{1F680}\u{1F4A1}\u{1F4DD}\u{1F527}\u{1F41B}]/gu, "");

  // Fallback: remove any remaining emoji characters
  result = result.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "");

  // Fix spacing around punctuation
  result = result.replace(/\s+([,.!?;:])/g, "$1"); // Remove space before punctuation
  result = result.replace(/([,.!?;:])\s*/g, "$1 "); // Ensure space after punctuation

  // Remove extra punctuation (multiple periods, etc.)
  result = result.replace(/\.{2,}/g, ".");
  result = result.replace(/,{2,}/g, ",");

  // Remove repetitive sentence patterns
  // Detect "First, X. Second, X. Third, X." where X is very similar
  result = removeRepetitiveSentences(result);

  // Normalize whitespace
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

/**
 * Remove repetitive sentences that say the same thing differently
 * E.g., "Modified the file. Updated the file. Changed the file." → "Modified the file."
 */
function removeRepetitiveSentences(text) {
  const sentences = text.split(/\.\s+/);

  if (sentences.length <= 2) {
    return text; // Not enough sentences to have repetition
  }

  // If text is already short (< 100 chars), don't risk removing content
  if (text.length < 100) {
    return text;
  }

  const uniqueSentences = [];
  const seenConcepts = new Set();

  for (const sentence of sentences) {
    // Extract key words (nouns/verbs) from sentence
    const words = sentence.toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3); // Only meaningful words

    // Create a concept signature (sorted unique words)
    const conceptSig = [...new Set(words)].sort().join("-");

    // Check if we've seen a very similar sentence
    let isDuplicate = false;
    for (const seenSig of seenConcepts) {
      const overlap = calculateOverlap(conceptSig, seenSig);
      if (overlap > 0.65) { // More than 65% word overlap = duplicate concept (reduced from 0.75 for stronger deduplication)
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      uniqueSentences.push(sentence);
      seenConcepts.add(conceptSig);
    }
  }

  return uniqueSentences.join(". ");
}

/**
 * Calculate word overlap between two concept signatures
 */
function calculateOverlap(sig1, sig2) {
  const words1 = new Set(sig1.split("-"));
  const words2 = new Set(sig2.split("-"));

  let intersection = 0;
  for (const word of words1) {
    if (words2.has(word)) {
      intersection++;
    }
  }

  const union = words1.size + words2.size - intersection;
  return union > 0 ? intersection / union : 0;
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
