/**
 * TTS Summarizer
 *
 * Uses local Qwen LLM via Ollama to intelligently extract
 * speakable content from Claude Code output.
 *
 * Produces natural, conversational summaries suitable for TTS.
 */

/**
 * Summarizer configuration
 */
export interface TTSSummarizerConfig {
  /** Ollama server URL */
  ollamaUrl: string;

  /** Model to use for summarization */
  model: string;

  /** Maximum tokens for summary */
  maxTokens: number;

  /** Timeout in milliseconds */
  timeout: number;

  /** Whether to fall back to regex if LLM fails */
  fallbackToRegex: boolean;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: TTSSummarizerConfig = {
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5:1.5b",
  maxTokens: 150,
  timeout: 5000,
  fallbackToRegex: true,
};

/**
 * Summarization prompt template
 */
const SUMMARIZE_PROMPT = `You are a TTS (text-to-speech) summarizer. Convert the following AI assistant output into a brief, natural spoken response.

Rules:
- Extract ONLY the key information a human would want to hear
- Remove ALL code, markdown, tables, file paths, and technical formatting
- Use natural conversational language
- Keep it under 2-3 sentences unless more detail is essential
- If the output is a simple answer, just give the answer
- If it's a task completion, summarize what was done
- Never include symbols like *, #, \`, |, or code syntax
- Never say "here is" or "I will" - just state the information directly

Examples:
- Code output with explanation → "Created a function that calculates prime numbers."
- Error message → "There was an error: the file wasn't found."
- List of items → "Found three matching files in the source directory."
- Simple answer → "The result is 42."

AI Output to summarize:
{output}

Spoken summary (1-3 sentences, no markdown):`;

/**
 * TTS Summarizer class
 */
export class TTSSummarizer {
  private config: TTSSummarizerConfig;

  constructor(config: Partial<TTSSummarizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Summarize output for TTS using local LLM
   */
  async summarize(output: string, context?: string): Promise<string> {
    if (!output || output.trim().length === 0) {
      return "";
    }

    // Skip very short outputs - they're likely already suitable
    const trimmed = output.trim();
    if (trimmed.length < 50 && !this.containsMarkdown(trimmed)) {
      return trimmed;
    }

    try {
      const summary = await this.callOllama(trimmed);
      return summary || this.fallbackSummarize(trimmed);
    } catch (error) {
      console.warn("[TTS Summarizer] LLM failed, using fallback:", error);
      return this.fallbackSummarize(trimmed);
    }
  }

  /**
   * Summarize a streaming chunk (lighter processing)
   * For chunks, we do quick regex cleanup rather than full LLM call
   */
  summarizeChunk(chunk: string): string {
    if (!chunk || chunk.trim().length === 0) {
      return "";
    }

    // Quick regex-based cleanup for streaming chunks
    return this.quickClean(chunk);
  }

  /**
   * Call Ollama for summarization
   */
  private async callOllama(output: string): Promise<string> {
    const prompt = SUMMARIZE_PROMPT.replace("{output}", output.substring(0, 2000));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.ollamaUrl}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          prompt,
          stream: false,
          options: {
            num_predict: this.config.maxTokens,
            temperature: 0.3,
            top_p: 0.9,
          },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama returned ${response.status}`);
      }

      const data = await response.json() as { response?: string };
      const summary = data.response?.trim() || "";

      // Clean up any remaining markdown the LLM might have included
      return this.quickClean(summary);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Quick regex-based cleanup (fallback and for chunks)
   */
  private quickClean(text: string): string {
    let result = text;

    // Remove code blocks
    result = result.replace(/```[\s\S]*?```/g, "");
    result = result.replace(/`([^`]+)`/g, "$1");

    // Remove markdown formatting
    result = result.replace(/^#{1,6}\s+/gm, "");
    result = result.replace(/\*\*([^*]+)\*\*/g, "$1");
    result = result.replace(/\*([^*]+)\*/g, "$1");
    result = result.replace(/__([^_]+)__/g, "$1");
    result = result.replace(/_([^_]+)_/g, "$1");

    // Remove links but keep text
    result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");

    // Remove images
    result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, "");

    // Remove tables
    result = result.replace(/^\|[\s\S]*?\|$/gm, "");
    result = result.replace(/\|/g, ", ");

    // Remove bullet points
    result = result.replace(/^[\s]*[-*+]\s+/gm, "");
    result = result.replace(/^[\s]*\d+\.\s+/gm, "");

    // Remove special characters
    result = result.replace(/[│├┤┌┐└┘┬┴┼═║╔╗╚╝╠╣╦╩╬]/g, "");
    result = result.replace(/[*#_~`]{2,}/g, "");

    // Clean whitespace
    result = result.replace(/[ \t]+/g, " ");
    result = result.replace(/\n{2,}/g, " ");

    return result.trim();
  }

  /**
   * Fallback summarization when LLM is unavailable
   */
  private fallbackSummarize(text: string): string {
    const cleaned = this.quickClean(text);

    // If still too long, truncate intelligently
    if (cleaned.length > 300) {
      // Try to find a good sentence break
      const truncated = cleaned.substring(0, 300);
      const lastPeriod = truncated.lastIndexOf(". ");
      if (lastPeriod > 150) {
        return truncated.substring(0, lastPeriod + 1);
      }
      return truncated.substring(0, truncated.lastIndexOf(" ")) + "...";
    }

    return cleaned;
  }

  /**
   * Check if text contains markdown
   */
  private containsMarkdown(text: string): boolean {
    const markdownPatterns = [
      /```/,
      /^#{1,6}\s/m,
      /\*\*[^*]+\*\*/,
      /\|.*\|/,
      /^\s*[-*+]\s/m,
    ];

    return markdownPatterns.some((p) => p.test(text));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<TTSSummarizerConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Create a TTS summarizer instance
 */
export function createTTSSummarizer(
  config: Partial<TTSSummarizerConfig> = {}
): TTSSummarizer {
  return new TTSSummarizer(config);
}

// Export singleton
export const ttsSummarizer = new TTSSummarizer();
