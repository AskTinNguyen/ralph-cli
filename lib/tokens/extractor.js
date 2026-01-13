/**
 * Token extractor - parses agent run logs for token usage data
 *
 * Supports:
 * - Claude Code token output format: `tokens: {input: N, output: N}`
 * - Variations like `Total tokens: N` or `Input: N, Output: N`
 * - Model detection from log content
 * - Fallback estimation based on text length when tokens unavailable
 */

/**
 * Extract token metrics from log content
 * @param {string} logContent - The raw log file content
 * @returns {Object} Token metrics: { inputTokens, outputTokens, model, estimated }
 */
function extractTokensFromLog(logContent) {
  if (!logContent || typeof logContent !== "string") {
    return {
      inputTokens: null,
      outputTokens: null,
      model: null,
      estimated: false,
    };
  }

  const result = {
    inputTokens: null,
    outputTokens: null,
    model: null,
    estimated: false,
  };

  // Try to detect model from log content
  result.model = detectModel(logContent);

  // Pattern 1: `tokens: {input: N, output: N}` (Claude Code primary format)
  const jsonPattern = /tokens:\s*\{\s*input:\s*(\d+)\s*,\s*output:\s*(\d+)\s*\}/i;
  let match = logContent.match(jsonPattern);
  if (match) {
    result.inputTokens = parseInt(match[1], 10);
    result.outputTokens = parseInt(match[2], 10);
    return result;
  }

  // Pattern 2: `input_tokens: N` and `output_tokens: N` (API response format)
  const inputTokensPattern = /input[_\s]?tokens:\s*(\d+)/i;
  const outputTokensPattern = /output[_\s]?tokens:\s*(\d+)/i;
  const inputMatch = logContent.match(inputTokensPattern);
  const outputMatch = logContent.match(outputTokensPattern);
  if (inputMatch && outputMatch) {
    result.inputTokens = parseInt(inputMatch[1], 10);
    result.outputTokens = parseInt(outputMatch[1], 10);
    return result;
  }

  // Pattern 3: `Total input: N tokens` and `Total output: N tokens`
  const totalInputPattern = /total\s+input:\s*(\d+)\s*tokens?/i;
  const totalOutputPattern = /total\s+output:\s*(\d+)\s*tokens?/i;
  const totalInputMatch = logContent.match(totalInputPattern);
  const totalOutputMatch = logContent.match(totalOutputPattern);
  if (totalInputMatch && totalOutputMatch) {
    result.inputTokens = parseInt(totalInputMatch[1], 10);
    result.outputTokens = parseInt(totalOutputMatch[1], 10);
    return result;
  }

  // Pattern 4: `Input tokens: N, Output tokens: N` (comma separated)
  const commaPattern = /input\s*tokens?:\s*(\d+)\s*,\s*output\s*tokens?:\s*(\d+)/i;
  match = logContent.match(commaPattern);
  if (match) {
    result.inputTokens = parseInt(match[1], 10);
    result.outputTokens = parseInt(match[2], 10);
    return result;
  }

  // Pattern 5: `usage: {"input_tokens": N, "output_tokens": N}` (JSON in log)
  const usageJsonPattern = /"input_tokens":\s*(\d+)[\s\S]*?"output_tokens":\s*(\d+)/;
  match = logContent.match(usageJsonPattern);
  if (match) {
    result.inputTokens = parseInt(match[1], 10);
    result.outputTokens = parseInt(match[2], 10);
    return result;
  }

  // Pattern 6: Check for total tokens only (when breakdown unavailable)
  const totalTokensPattern = /total\s*tokens?:\s*(\d+)/i;
  const totalMatch = logContent.match(totalTokensPattern);
  if (totalMatch) {
    const total = parseInt(totalMatch[1], 10);
    // Estimate 60% input, 40% output ratio (typical for coding tasks)
    result.inputTokens = Math.round(total * 0.6);
    result.outputTokens = Math.round(total * 0.4);
    result.estimated = true;
    return result;
  }

  // No token data found - return nulls (caller can use estimation if needed)
  return result;
}

/**
 * Detect the model used from log content
 * @param {string} logContent - Log file content
 * @returns {string|null} Detected model name or null
 */
function detectModel(logContent) {
  if (!logContent) return null;

  // Check for model name patterns
  const modelPatterns = [
    // Claude models
    { pattern: /claude[- ]?opus|opus[- ]?4/i, model: "opus" },
    { pattern: /claude[- ]?sonnet|sonnet[- ]?3\.5|sonnet[- ]?4/i, model: "sonnet" },
    { pattern: /claude[- ]?haiku|haiku[- ]?3/i, model: "haiku" },
    // Generic Claude (default to sonnet)
    { pattern: /model[=:]\s*["']?claude/i, model: "sonnet" },
    // OpenAI Codex
    { pattern: /codex|gpt[- ]?4|openai/i, model: "codex" },
    // Droid/Factory
    { pattern: /droid|factory/i, model: "droid" },
  ];

  for (const { pattern, model } of modelPatterns) {
    if (pattern.test(logContent)) {
      return model;
    }
  }

  return null;
}

/**
 * Estimate token count based on text length
 * Uses approximation: ~4 characters per token for English text
 * @param {string} text - Text content
 * @returns {number} Estimated token count
 */
function estimateTokensFromText(text) {
  if (!text) return 0;
  // Rough estimation: ~4 chars per token for English text
  return Math.ceil(text.length / 4);
}

/**
 * Extract tokens with fallback estimation from log content
 * @param {string} logContent - Log file content
 * @param {Object} options - Options for estimation
 * @param {boolean} options.useEstimation - Whether to use estimation fallback
 * @returns {Object} Token metrics with estimation if needed
 */
function extractTokensWithFallback(logContent, options = {}) {
  const { useEstimation = true } = options;

  const result = extractTokensFromLog(logContent);

  // If tokens found, return them
  if (result.inputTokens !== null && result.outputTokens !== null) {
    return result;
  }

  // If no estimation requested, return nulls
  if (!useEstimation) {
    return result;
  }

  // Estimate based on log content length
  // Log content typically contains both prompt and response
  // Estimate 70% as input (prompt), 30% as output (response) for agent runs
  const totalEstimated = estimateTokensFromText(logContent);
  result.inputTokens = Math.round(totalEstimated * 0.7);
  result.outputTokens = Math.round(totalEstimated * 0.3);
  result.estimated = true;

  return result;
}

/**
 * Parse token data from a run summary file (Markdown)
 * Looks for ## Token Usage section
 * @param {string} summaryContent - Run summary file content
 * @returns {Object|null} Token metrics or null if not found
 */
function parseTokensFromSummary(summaryContent) {
  if (!summaryContent) return null;

  // Look for Token Usage section
  const tokenSectionPattern = /## Token Usage\s*([\s\S]*?)(?=##|$)/i;
  const sectionMatch = summaryContent.match(tokenSectionPattern);

  if (!sectionMatch) return null;

  const section = sectionMatch[1];
  const result = {
    inputTokens: null,
    outputTokens: null,
    model: null,
    estimated: false,
  };

  // Parse fields from section
  const inputMatch = section.match(/- Input tokens:\s*(\d+)/i);
  const outputMatch = section.match(/- Output tokens:\s*(\d+)/i);
  const modelMatch = section.match(/- Model:\s*(\w+)/i);
  const estimatedMatch = section.match(/- Estimated:\s*(true|false)/i);

  if (inputMatch) result.inputTokens = parseInt(inputMatch[1], 10);
  if (outputMatch) result.outputTokens = parseInt(outputMatch[1], 10);
  if (modelMatch) result.model = modelMatch[1].toLowerCase();
  if (estimatedMatch) result.estimated = estimatedMatch[1].toLowerCase() === "true";

  // Only return if we found at least some token data
  if (result.inputTokens !== null || result.outputTokens !== null) {
    return result;
  }

  return null;
}

/**
 * Format token metrics section for run summary (Markdown)
 * @param {Object} tokens - Token metrics object
 * @returns {string} Formatted Markdown section
 */
function formatTokenSection(tokens) {
  const lines = ["## Token Usage"];

  if (tokens.inputTokens !== null) {
    lines.push(`- Input tokens: ${tokens.inputTokens}`);
  } else {
    lines.push("- Input tokens: (unavailable)");
  }

  if (tokens.outputTokens !== null) {
    lines.push(`- Output tokens: ${tokens.outputTokens}`);
  } else {
    lines.push("- Output tokens: (unavailable)");
  }

  if (tokens.model) {
    lines.push(`- Model: ${tokens.model}`);
  }

  lines.push(`- Estimated: ${tokens.estimated}`);

  if (tokens.inputTokens !== null && tokens.outputTokens !== null) {
    lines.push(`- Total tokens: ${tokens.inputTokens + tokens.outputTokens}`);
  }

  return lines.join("\n");
}

module.exports = {
  extractTokensFromLog,
  extractTokensWithFallback,
  detectModel,
  estimateTokensFromText,
  parseTokensFromSummary,
  formatTokenSection,
};
