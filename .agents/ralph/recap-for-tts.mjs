#!/usr/bin/env node
/**
 * Recap Claude Code response for TTS - Extended summarization
 * Uses local Qwen model with configurable length limits
 *
 * Usage: node recap-for-tts.mjs <transcript_path> [mode]
 * Modes: short (default auto-speak), medium (default recap), full
 */

import { readFileSync } from "fs";
import { MODES, getModeConfig } from "./lib/tts-modes.mjs";
import { detectLanguage } from "./language-voice-mapper.mjs";

// Inline output filter implementation (avoids missing dist file dependency)
function createOutputFilter(config = {}) {
  const defaultConfig = {
    maxLength: 500,
    maxCodeLines: 3,
    includeFilePaths: false,
    includeStats: true,
  };
  const finalConfig = { ...defaultConfig, ...config };

  return {
    filter(text) {
      if (!text || text.trim().length === 0) return "";

      let filtered = text;

      // Remove thinking blocks
      filtered = filtered.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
      filtered = filtered.replace(/<thinking>.*$/gim, "");
      filtered = filtered.replace(/^.*<\/thinking>/gim, "");

      // Remove tool call markers
      filtered = filtered.replace(/\[Tool:\s*\w+\]/gi, "");
      filtered = filtered.replace(/```tool[\s\S]*?```/gi, "");
      filtered = filtered.replace(/\[Reading\s+.*?\]/gi, "");
      filtered = filtered.replace(/\[Writing\s+.*?\]/gi, "");
      filtered = filtered.replace(/\[Editing\s+.*?\]/gi, "");
      filtered = filtered.replace(/\[Searching\s+.*?\]/gi, "");
      filtered = filtered.replace(/\[Running\s+.*?\]/gi, "");
      filtered = filtered.replace(/Tool result:.*$/gim, "");

      // Remove code blocks if maxCodeLines is 0
      if (finalConfig.maxCodeLines === 0) {
        filtered = filtered.replace(/```[\s\S]*?```/g, "");
      }

      // Remove ANSI escape codes
      filtered = filtered.replace(/\x1b\[[0-9;]*m/g, "");

      // Remove excessive whitespace
      filtered = filtered
        .split("\n")
        .map((line) => line.trim())
        .join("\n");
      filtered = filtered.replace(/\n{3,}/g, "\n\n");

      // Truncate if too long
      if (filtered.length > finalConfig.maxLength) {
        const truncated = filtered.substring(0, finalConfig.maxLength);
        const lastSentence = truncated.lastIndexOf(". ");
        if (lastSentence > finalConfig.maxLength * 0.5) {
          return truncated.substring(0, lastSentence + 1);
        }
        const lastSpace = truncated.lastIndexOf(" ");
        if (lastSpace > finalConfig.maxLength * 0.7) {
          return truncated.substring(0, lastSpace) + "...";
        }
        return truncated + "...";
      }

      return filtered.trim();
    },
  };
}

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
 * Detect response type for context-aware summarization
 * @param {string} response - Filtered response text
 * @returns {{ type: string, signals: string[], priority: string[] }}
 */
function detectResponseContext(response) {
  const signals = [];
  const priority = [];

  // Error signals (highest priority)
  const errorPatterns = [
    /error|failed|exception|crash|bug|broken/i,
    /cannot|couldn't|unable to|not found/i,
    /fix|resolve|debug|troubleshoot/i
  ];

  // Completion signals
  const completionPatterns = [
    /complete|done|finished|success|pass/i,
    /created|added|updated|modified|implemented/i,
    /✅|✓|PASS/
  ];

  // Blocker/waiting signals
  const blockerPatterns = [
    /blocked|waiting|need|requires|depends on/i,
    /before you can|first you must/i
  ];

  // Explanation signals
  const explanationPatterns = [
    /because|reason|explanation|why/i,
    /this means|in other words|to clarify/i
  ];

  // Check each category
  if (errorPatterns.some(p => p.test(response))) {
    signals.push('error');
    priority.push('error_description', 'affected_component', 'suggested_fix');
  }

  if (completionPatterns.some(p => p.test(response))) {
    signals.push('completion');
    priority.push('what_completed', 'key_outcome', 'next_steps');
  }

  if (blockerPatterns.some(p => p.test(response))) {
    signals.push('blocker');
    priority.push('what_blocked', 'blocker_reason', 'unblocking_action');
  }

  if (explanationPatterns.some(p => p.test(response))) {
    signals.push('explanation');
    priority.push('main_concept', 'key_takeaway');
  }

  // Determine primary type
  let type = 'general';
  if (signals.includes('error')) type = 'error';
  else if (signals.includes('blocker')) type = 'blocker';
  else if (signals.includes('completion')) type = 'completion';
  else if (signals.includes('explanation')) type = 'explanation';

  return { type, signals, priority };
}

/**
 * Context-aware summarization using Qwen with configurable length
 */
async function contextAwareSummarize(response, userQuestion, config, lang = "en") {
  const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:1.5b";
  const timeout = 15000; // Longer timeout for longer summaries

  // Detect response context
  const context = detectResponseContext(response);

  // Type-specific extraction instructions (English)
  const extractionInstructionsEn = {
    error: `EXTRACT IN ORDER:
1. What failed (brief)
2. Why it failed (if clear)
3. Fix or next step
IGNORE: Stack traces, technical details`,

    completion: `EXTRACT IN ORDER:
1. What was done (numbered list)
2. Key outcomes
3. Next steps (if mentioned)
IGNORE: Implementation details, process`,

    blocker: `EXTRACT:
1. What is blocked
2. What's needed to unblock
IGNORE: Technical reasons`,

    explanation: `EXTRACT:
1. Main concept
2. Why it matters (if clear)
IGNORE: Examples, details`,

    general: `EXTRACT:
1. Key outcomes (numbered)
IGNORE: Process, details`
  };

  // Type-specific extraction instructions (Vietnamese)
  const extractionInstructionsVi = {
    error: `TRÍCH XUẤT THEO THỨ TỰ:
1. Cái gì thất bại (ngắn gọn)
2. Tại sao thất bại (nếu rõ)
3. Cách sửa hoặc bước tiếp theo
BỎ QUA: Chi tiết kỹ thuật`,

    completion: `TRÍCH XUẤT THEO THỨ TỰ:
1. Đã làm gì (danh sách đánh số)
2. Kết quả chính
3. Bước tiếp theo (nếu có)
BỎ QUA: Chi tiết triển khai`,

    blocker: `TRÍCH XUẤT:
1. Cái gì bị chặn
2. Cần gì để tiếp tục
BỎ QUA: Lý do kỹ thuật`,

    explanation: `TRÍCH XUẤT:
1. Khái niệm chính
2. Tại sao quan trọng (nếu rõ)
BỎ QUA: Ví dụ, chi tiết`,

    general: `TRÍCH XUẤT:
1. Kết quả chính (đánh số)
BỎ QUA: Quy trình, chi tiết`
  };

  // Build context-aware prompt for recap style based on language
  let prompt;

  if (lang === "vi") {
    // Vietnamese prompts
    const extractionInstructions = extractionInstructionsVi[context.type];
    if (userQuestion && userQuestion.trim().length > 0) {
      prompt = `Bạn là công cụ TTS tóm tắt tạo bản tóm tắt giọng nói.

NGƯỜI DÙNG HỎI: "${userQuestion.trim().substring(0, 200)}"

LOẠI PHẢN HỒI: ${context.type.toUpperCase()}

${extractionInstructions}

---
PHẢN HỒI CẦN TÓM TẮT:
${response.substring(0, 2500)}
---

QUY TẮC QUAN TRỌNG:
- ${config.promptWords} TỐI ĐA
- KHÔNG tên file, đường dẫn, phần mở rộng (.js, .json, .md, v.v.)
- KHÔNG ký tự: ~ / \\ | @ # $ % ^ & * \` < > { } [ ] = + _
- KHÔNG viết tắt (API→dịch vụ, CLI→lệnh, TTS→giọng nói)
- Nêu mỗi thông tin MỘT LẦN - không diễn đạt lại
- CHỈ thông tin trích xuất - không văn bản phụ

VÍ DỤ:
TỐT: "Tính năng đăng nhập hoàn thành. Người dùng có thể đăng nhập với email."
XẤU: "Tôi đã cập nhật hệ thống xác thực để thêm chức năng đăng nhập. Tính năng đăng nhập đã được triển khai."

Chỉ xuất bản tóm tắt (${config.promptWords} TỐI ĐA):`;
    } else {
      prompt = `Bạn là công cụ TTS tóm tắt tạo bản tóm tắt giọng nói.

LOẠI PHẢN HỒI: ${context.type.toUpperCase()}

${extractionInstructions}

${response.substring(0, 2500)}

QUY TẮC QUAN TRỌNG:
- ${config.promptWords} TỐI ĐA
- KHÔNG tên file, đường dẫn, phần mở rộng
- KHÔNG ký tự: ~ / \\ | @ # $ % ^ & * \` < > { } [ ] = + _
- KHÔNG viết tắt
- Nêu mỗi thông tin MỘT LẦN

Chỉ xuất bản tóm tắt:`;
    }
  } else {
    // English prompts (default)
    const extractionInstructions = extractionInstructionsEn[context.type];
    if (userQuestion && userQuestion.trim().length > 0) {
      prompt = `You are a TTS voice assistant creating spoken recap.

USER ASKED: "${userQuestion.trim().substring(0, 200)}"

RESPONSE TYPE: ${context.type.toUpperCase()}

${extractionInstructions}

---
RESPONSE TO SUMMARIZE:
${response.substring(0, 2500)}
---

CRITICAL RULES:
- ${config.promptWords} MAXIMUM
- NO file names, paths, extensions (.js, .json, .md, etc.)
- NO symbols: ~ / \\ | @ # $ % ^ & * \` < > { } [ ] = + _
- NO abbreviations (API→service, CLI→command, TTS→voice)
- State each fact ONCE - no rephrasing
- ONLY the extracted information - no meta-text

EXAMPLE:
GOOD: "Login feature complete. One, users can sign in with email. Two, password reset works. Next, add two-factor auth."
BAD: "I've updated the authentication system to add login functionality. The login feature has been implemented."

Output ONLY the spoken recap (${config.promptWords} MAX):`;
    } else {
      prompt = `You are a TTS voice assistant creating spoken recap.

RESPONSE TYPE: ${context.type.toUpperCase()}

${extractionInstructions}

${response.substring(0, 2500)}

CRITICAL RULES:
- ${config.promptWords} MAXIMUM
- NO file names, paths, extensions
- NO symbols: ~ / \\ | @ # $ % ^ & * \` < > { } [ ] = + _
- NO abbreviations
- State each fact ONCE

Output ONLY the spoken recap:`;
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
          num_predict: Math.ceil(config.maxChars / 4), // ~4 chars per token
          temperature: 0.2,        // Lower for consistency (was 0.3)
          top_p: 0.75,             // More focused (was 0.9)
          top_k: 25,               // Reduced vocabulary
          repeat_penalty: 1.6,     // Stronger
          frequency_penalty: 0.8,  // Stronger
          presence_penalty: 0.6,   // Encourage conciseness
          stop: [
            "Summary:",
            "Note:",
            "Important:",
            "In summary",
            "\n\n",                // Stop at paragraph break
            "To summarize",
            "Let me",              // Self-referential text
            "I've",
            "I have"
          ]
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new Error(`Ollama returned ${res.status}`);
    }

    const data = await res.json();
    let summary = data.response || "";

    // ADDED: Two-pass verification
    summary = verifySummaryClean(summary, response, config);

    return cleanSummary(summary);
  } catch (error) {
    console.error(`[recap-for-tts] LLM failed: ${error.message}`);
    return fallbackSummarize(response, config);
  }
}

/**
 * Verify summary is clean for TTS, re-prompt if needed
 * @param {string} summary - Generated summary
 * @param {string} response - Original response (for context)
 * @param {object} config - Mode configuration
 * @returns {string} - Cleaned summary
 */
function verifySummaryClean(summary, response, config) {
  const violations = [];

  // 1. Symbol check
  const symbolPattern = /[~\/\\|@#$%^&*`<>{}\[\]=+_]/;
  if (symbolPattern.test(summary)) {
    violations.push('symbols');
  }

  // 2. File path/extension check
  const filePattern = /\.(js|ts|py|sh|json|md|tsx|jsx|mjs|html|css|yaml|yml)\b/i;
  const pathPattern = /[\w\-]+\/[\w\-]+/;
  if (filePattern.test(summary) || pathPattern.test(summary)) {
    violations.push('files');
  }

  // 3. Technical abbreviation check
  const techPattern = /\b(API|CLI|TTS|JSON|JWT|HTML|CSS|URL|HTTP|HTTPS|SSH|FTP|SQL|XML|YAML|CSV|PRD|US-\d+)\b/;
  if (techPattern.test(summary)) {
    violations.push('abbreviations');
  }

  // 4. Emoji check
  const emojiPattern = /[\u2705\u274C\u26A0\u{1F534}\u{1F7E2}\u{1F680}\u{1F4A1}]/u;
  if (emojiPattern.test(summary)) {
    violations.push('emojis');
  }

  // 5. Semantic repetition check
  if (detectSemanticRepetition(summary)) {
    violations.push('repetition');
  }

  // If no violations, return as-is
  if (violations.length === 0) {
    return summary;
  }

  // Log violations for debugging
  console.error(`[verify] Violations found: ${violations.join(', ')}`);

  // Apply regex cleanup
  let cleaned = cleanSummary(summary);

  // Re-check critical violations after cleanup
  const stillHasSymbols = symbolPattern.test(cleaned);
  const stillHasTech = techPattern.test(cleaned);

  if (stillHasSymbols || stillHasTech) {
    console.error(`[verify] Critical violations remain after cleanup`);
  }

  return cleaned;
}

// Synonym groups for semantic normalization
const SYNONYM_GROUPS = {
  action: ['added', 'created', 'implemented', 'built', 'made', 'developed'],
  change: ['updated', 'modified', 'changed', 'edited', 'adjusted', 'revised'],
  remove: ['removed', 'deleted', 'eliminated', 'dropped', 'cleared'],
  fix: ['fixed', 'resolved', 'repaired', 'corrected', 'addressed'],
  complete: ['completed', 'finished', 'done', 'accomplished', 'succeeded'],
  test: ['tested', 'verified', 'validated', 'checked', 'confirmed'],
  file: ['file', 'script', 'config', 'configuration', 'settings'],
  system: ['system', 'application', 'app', 'service', 'platform']
};

/**
 * Normalize word to canonical form using synonym groups
 */
function normalizeToCanonical(word) {
  const lower = word.toLowerCase();
  for (const [canonical, synonyms] of Object.entries(SYNONYM_GROUPS)) {
    if (synonyms.includes(lower)) {
      return canonical;
    }
  }
  return lower;
}

/**
 * Detect semantic repetition using synonym normalization
 */
function detectSemanticRepetition(text) {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  if (sentences.length < 2) return false;

  for (let i = 0; i < sentences.length; i++) {
    for (let j = i + 1; j < sentences.length; j++) {
      const words1 = sentences[i].toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .map(normalizeToCanonical);

      const words2 = sentences[j].toLowerCase()
        .replace(/[^\w\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 2)
        .map(normalizeToCanonical);

      const sig1 = [...new Set(words1)].sort().join('-');
      const sig2 = [...new Set(words2)].sort().join('-');

      const overlap = calculateOverlap(sig1, sig2);
      if (overlap > 0.55) { // Lower threshold due to normalization
        return true;
      }
    }
  }

  return false;
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
    // Extract key words (nouns/verbs) from sentence with semantic normalization
    const words = sentence.toLowerCase()
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 3)
      .map(normalizeToCanonical); // Use semantic normalization

    // Create a concept signature (sorted unique words)
    const conceptSig = [...new Set(words)].sort().join("-");

    // Check if we've seen a very similar sentence
    let isDuplicate = false;
    for (const seenSig of seenConcepts) {
      const overlap = calculateOverlap(conceptSig, seenSig);
      if (overlap > 0.65) { // More than 65% word overlap = duplicate concept
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

  // SMART SYMBOL REMOVAL
  // Remove problematic symbols but preserve meaningful ones

  // First, protect ratios (11/11) and percentages (100%) temporarily
  result = result.replace(/(\d+)\/(\d+)/g, "$1 out of $2");  // 11/11 → 11 out of 11
  result = result.replace(/(\d+)%/g, "$1 percent");            // 100% → 100 percent

  // Now remove problematic symbols that TTS reads literally
  result = result.replace(/[~\/\\|<>{}[\]@#$%^&*`+=_]/g, "");

  // Replace "dot" when it appears as word (from file extensions being read)
  result = result.replace(/\bdot\b/gi, "");
  result = result.replace(/\bslash\b/gi, "");
  result = result.replace(/\btilda\b/gi, "");
  result = result.replace(/\btilde\b/gi, "");

  // Remove technical abbreviations that slip through
  result = result.replace(/\b(API|CLI|TTS|JSON|JWT|HTML|CSS|URL|HTTP|HTTPS|SSH|FTP|SQL|XML|YAML|CSV)\b/g, "");

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
