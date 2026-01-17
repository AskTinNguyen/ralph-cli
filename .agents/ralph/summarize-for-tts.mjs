#!/usr/bin/env node
/**
 * Summarize Claude Code response for TTS
 * Uses local Qwen model via TTSSummarizer with context-aware summarization
 *
 * Usage: node summarize-for-tts.mjs <transcript_path>
 */

import { readFileSync } from "fs";
import { createOutputFilter } from "../../ui/dist/voice-agent/filter/output-filter.js";

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

    // Step 2: Context-aware summarization with Qwen
    const summary = await contextAwareSummarize(filtered, userQuestion);

    if (summary && summary.trim().length > 0) {
      // Clean up the summary - remove quotes if present
      let cleaned = summary.trim();

      // Remove wrapping quotes (some LLMs add them)
      if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
          (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
      }

      // Output the summary
      console.log(cleaned.trim());
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
 */
async function contextAwareSummarize(response, userQuestion) {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
  const timeout = 10000;

  // Build context-aware prompt
  let prompt;
  if (userQuestion && userQuestion.trim().length > 0) {
    prompt = `You are a TTS summarizer. The user asked: "${userQuestion.trim().substring(0, 200)}"

The AI assistant responded with:
${response.substring(0, 2000)}

Create a brief spoken summary (1-2 sentences) that directly answers the user's question.

Rules:
- Focus on answering what the user asked
- Remove ALL code, markdown, file paths, and technical formatting
- Use natural conversational language
- If it's a simple answer, just give the answer
- If it's a task completion, say what was done
- Never include symbols like *, #, \`, |
- Never say "the assistant said" or "according to" - just state the information

Spoken summary:`;
  } else {
    // Fallback to standard summarization without context
    prompt = `You are a TTS summarizer. Convert this AI response into a brief spoken summary (1-2 sentences):

${response.substring(0, 2000)}

Rules:
- Extract ONLY the key information
- Remove ALL code, markdown, file paths
- Use natural conversational language
- Keep it under 2 sentences

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
          num_predict: 150,
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
    return fallbackSummarize(response);
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

  // Normalize whitespace
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

/**
 * Fallback summarization when LLM is unavailable
 */
function fallbackSummarize(text) {
  let result = cleanSummary(text);

  // If still too long, truncate at sentence boundary
  if (result.length > 200) {
    const truncated = result.substring(0, 200);
    const lastPeriod = truncated.lastIndexOf(". ");
    if (lastPeriod > 100) {
      return truncated.substring(0, lastPeriod + 1);
    }
    return truncated.substring(0, truncated.lastIndexOf(" ")) + "...";
  }

  return result;
}

main();
