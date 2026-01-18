#!/usr/bin/env node
/**
 * Recap Claude Code response for TTS - Extended summarization
 * Uses local Qwen model with configurable length limits
 *
 * Usage: node recap-for-tts.mjs <transcript_path> [mode]
 * Modes: short (default auto-speak), medium (default recap), full
 */

import { readFileSync } from "fs";
import { createOutputFilter } from "../../ui/dist/voice-agent/filter/output-filter.js";
import { MODES, getModeConfig } from "./lib/tts-modes.mjs";
import { detectLanguage } from "./language-voice-mapper.mjs";

async function main() {
  const transcriptPath = process.argv[2];
  const mode = process.argv[3] || "medium";

  if (!transcriptPath) {
    console.error("Usage: node recap-for-tts.mjs <transcript_path> [mode]");
    console.error("Modes: short, medium, full");
    process.exit(1);
  }

  const config = getModeConfig(mode);

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
        // Skip system/meta messages
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
      maxLength: 3000, // Allow more for longer summaries
      maxCodeLines: 0, // Remove all code blocks
      includeFilePaths: false,
      includeStats: false,
    });

    const filtered = filter.filter(responseText);

    if (!filtered || filtered.trim().length === 0) {
      process.exit(0); // Nothing speakable after filtering
    }

    // Detect language from the filtered text
    const detectedLang = detectLanguage(filtered);

    // Step 2: Context-aware summarization with Qwen
    const summary = await contextAwareSummarize(filtered, userQuestion, config, detectedLang);

    if (summary && summary.trim().length > 0) {
      // Clean up the summary
      let cleaned = summary.trim();

      // Remove wrapping quotes
      if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
          (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
        cleaned = cleaned.slice(1, -1);
      }

      // Enforce max length for TTS
      cleaned = truncateForTTS(cleaned.trim(), config.maxChars);

      // Output the summary
      console.log(cleaned);
    }

    process.exit(0);
  } catch (error) {
    console.error(`[recap-for-tts] Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Context-aware summarization using Qwen with configurable length
 */
async function contextAwareSummarize(response, userQuestion, config, lang = "en") {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
  const timeout = 15000; // Longer timeout for longer summaries

  // Build context-aware prompt for recap style based on language
  let prompt;

  if (lang === "vi") {
    // Vietnamese prompts
    if (userQuestion && userQuestion.trim().length > 0) {
      prompt = `Bạn là một công cụ tóm tắt TTS tạo bản tóm tắt bằng giọng nói.

Người dùng hỏi: "${userQuestion.trim().substring(0, 300)}"

Phản hồi của AI:
${response.substring(0, 3000)}

Tạo bản tóm tắt bằng giọng nói ${config.promptStyle}, ${config.promptWords}.

QUY TẮC QUAN TRỌNG:
- Sử dụng điểm đánh số: "Một, ... Hai, ... Ba, ..."
- Cụm từ ngắn, không phải câu đầy đủ
- KHÔNG dùng thuật ngữ kỹ thuật, tên thư viện, hoặc phần mở rộng tệp
- KHÔNG dùng cú pháp code, đường dẫn, hoặc ký tự đặc biệt
- Chỉ dùng tiếng Việt đàm thoại thông thường
- Tập trung vào ĐÃ LÀM GÌ, không phải LÀM NHƯ THẾ NÀO
- Nêu kết quả và bước tiếp theo

Ví dụ định dạng:
"Tính năng hoàn thành. Một, thêm endpoint đăng nhập. Hai, thêm endpoint đăng xuất. Ba, kiểm tra đã pass. Bước tiếp theo: thêm giới hạn tốc độ, thêm xác minh email."

Bản tóm tắt:`;
    } else {
      prompt = `Bạn là một công cụ tóm tắt TTS tạo bản tóm tắt bằng giọng nói.

Phản hồi của AI:
${response.substring(0, 3000)}

Tạo bản tóm tắt bằng giọng nói ${config.promptStyle}, ${config.promptWords}.

QUY TẮC QUAN TRỌNG:
- Sử dụng điểm đánh số: "Một, ... Hai, ... Ba, ..."
- Cụm từ ngắn, không phải câu đầy đủ
- KHÔNG dùng thuật ngữ kỹ thuật, tên thư viện, hoặc phần mở rộng tệp
- KHÔNG dùng cú pháp code, đường dẫn, hoặc ký tự đặc biệt
- Chỉ dùng tiếng Việt đàm thoại thông thường
- Tập trung vào ĐÃ LÀM GÌ, không phải LÀM NHƯ THẾ NÀO

Bản tóm tắt:`;
    }
  } else {
    // English prompts (default)
    if (userQuestion && userQuestion.trim().length > 0) {
      prompt = `You are a TTS summarizer creating a spoken recap.

User asked: "${userQuestion.trim().substring(0, 300)}"

AI response:
${response.substring(0, 3000)}

Create a spoken summary as ${config.promptStyle}, ${config.promptWords}.

CRITICAL RULES:
- Use numbered points: "One, ... Two, ... Three, ..."
- Short phrases, not full sentences
- NO technical jargon, library names, or file extensions
- NO code syntax, paths, or special characters
- Plain conversational English only
- Focus on WHAT was done, not HOW
- State outcomes and next steps

Example format:
"Feature completed. One, added login endpoint. Two, added logout endpoint. Three, tests passing. Next steps: add rate limiting, add email verification."

Spoken recap:`;
    } else {
      prompt = `You are a TTS summarizer creating a spoken recap.

AI response:
${response.substring(0, 3000)}

Create a spoken summary as ${config.promptStyle}, ${config.promptWords}.

CRITICAL RULES:
- Use numbered points: "One, ... Two, ... Three, ..."
- Short phrases, not full sentences
- NO technical jargon, library names, or file extensions
- NO code syntax, paths, or special characters
- Plain conversational English only
- Focus on WHAT was done, not HOW

Spoken recap:`;
    }
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
          num_predict: config.maxTokens,
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
    console.error(`[recap-for-tts] LLM failed: ${error.message}`);
    return fallbackSummarize(response, config);
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

  // Remove bullet points (convert to spoken form)
  result = result.replace(/^[\s]*[-*+]\s+/gm, "");
  result = result.replace(/^[\s]*\d+\.\s+/gm, "");

  // Remove @ symbols
  result = result.replace(/@/g, "");

  // Remove file paths and extensions
  result = result.replace(/[\w\-./]+\.(sh|js|mjs|ts|tsx|jsx|json|md|txt|py|yaml|yml)/gi, "");
  result = result.replace(/\.[\w\-/]+\//g, "");

  // Remove URLs
  result = result.replace(/https?:\/\/[^\s]+/g, "");

  // Remove XML/HTML-like tags
  result = result.replace(/<[^>]+>/g, "");

  // Remove special characters
  result = result.replace(/[|<>{}[\]`]/g, "");

  // Remove emojis
  result = result.replace(/[\u2705\u274C\u26A0\u2713\u2714\u2611\u274E\u2B1C\u2B1B\u{1F534}\u{1F7E2}\u{1F7E1}\u2B50\u{1F389}\u{1F44D}\u{1F44E}\u{1F680}\u{1F4A1}\u{1F4DD}\u{1F527}\u{1F41B}]/gu, "");
  result = result.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/gu, "");

  // Clean up punctuation
  result = result.replace(/\.{2,}/g, ".");
  result = result.replace(/,{2,}/g, ",");

  // Normalize whitespace
  result = result.replace(/\s+/g, " ");

  return result.trim();
}

/**
 * Truncate text for TTS at a clean sentence boundary
 */
function truncateForTTS(text, maxLength) {
  if (!text || text.length <= maxLength) {
    if (text && !text.match(/[.!?]$/)) {
      return text + ".";
    }
    return text;
  }

  const truncated = text.substring(0, maxLength);

  // Look for last sentence ending
  const lastPeriod = truncated.lastIndexOf(". ");
  const lastExclaim = truncated.lastIndexOf("! ");
  const lastQuestion = truncated.lastIndexOf("? ");

  const lastSentenceEnd = Math.max(lastPeriod, lastExclaim, lastQuestion);

  if (lastSentenceEnd > maxLength * 0.5) {
    return truncated.substring(0, lastSentenceEnd + 1);
  }

  // Truncate at last word
  const lastSpace = truncated.lastIndexOf(" ");
  if (lastSpace > maxLength * 0.7) {
    return truncated.substring(0, lastSpace) + ".";
  }

  return truncated + ".";
}

/**
 * Fallback summarization when LLM is unavailable
 */
function fallbackSummarize(text, config) {
  let result = cleanSummary(text);

  if (result.length > config.maxChars) {
    const truncated = result.substring(0, config.maxChars);
    const lastPeriod = truncated.lastIndexOf(". ");
    if (lastPeriod > config.maxChars * 0.5) {
      return truncated.substring(0, lastPeriod + 1);
    }
    return truncated.substring(0, truncated.lastIndexOf(" ")) + "...";
  }

  return result;
}

main();
