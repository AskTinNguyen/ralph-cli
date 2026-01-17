/**
 * Output Summarizer for TTS
 *
 * Uses local Ollama LLM to generate concise 1-2 sentence summaries
 * of long Claude Code output for text-to-speech playback.
 *
 * Only invoked when output exceeds 500 characters after filtering.
 */

import { OllamaClient, createOllamaClient } from "../llm/ollama-client.js";

/**
 * Summarizer configuration
 */
export interface OutputSummarizerConfig {
  /** Ollama server URL */
  ollamaUrl: string;

  /** Model to use for summarization */
  model: string;

  /** Minimum length threshold (chars) before summarization is invoked */
  minLengthThreshold: number;

  /** Maximum tokens for generated summary */
  maxTokens: number;

  /** Timeout in milliseconds */
  timeout: number;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: OutputSummarizerConfig = {
  ollamaUrl: "http://localhost:11434",
  model: "qwen2.5:1.5b",
  minLengthThreshold: 500,
  maxTokens: 100,
  timeout: 10000,
};

/**
 * Summarization prompt as specified in PRD
 */
const SUMMARIZE_PROMPT =
  "Summarize this command output in 1-2 sentences for spoken audio: {output}";

/**
 * Output Summarizer class
 *
 * Uses local Ollama LLM to generate 1-2 sentence summaries
 * of command output for TTS playback.
 */
export class OutputSummarizer {
  private config: OutputSummarizerConfig;
  private ollamaClient: OllamaClient;

  constructor(config: Partial<OutputSummarizerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ollamaClient = createOllamaClient({
      ollamaUrl: this.config.ollamaUrl,
      ollamaModel: this.config.model,
    });
  }

  /**
   * Summarize command output for TTS
   *
   * Only invokes LLM when output exceeds the minimum length threshold (default: 500 chars).
   * Returns the original output if it's short enough or if summarization fails.
   *
   * @param output - The command output to summarize
   * @returns The summary (1-2 sentences) or original output if short
   */
  async summarize(output: string): Promise<string> {
    // Handle empty input
    if (!output || output.trim().length === 0) {
      return "";
    }

    const trimmedOutput = output.trim();

    // Only invoke LLM when output exceeds threshold (per PRD requirement)
    if (trimmedOutput.length <= this.config.minLengthThreshold) {
      return trimmedOutput;
    }

    try {
      const summary = await this.callOllama(trimmedOutput);
      return summary || trimmedOutput;
    } catch (error) {
      console.warn("[OutputSummarizer] LLM summarization failed:", error);
      // Return original output on failure
      return trimmedOutput;
    }
  }

  /**
   * Check if output should be summarized based on length threshold
   *
   * @param output - The output to check
   * @returns True if output exceeds the threshold and should be summarized
   */
  shouldSummarize(output: string): boolean {
    if (!output) return false;
    return output.trim().length > this.config.minLengthThreshold;
  }

  /**
   * Call Ollama LLM for summarization
   */
  private async callOllama(output: string): Promise<string> {
    // Build prompt with output (truncate if very long to avoid token limits)
    const truncatedOutput = output.substring(0, 4000);
    const prompt = SUMMARIZE_PROMPT.replace("{output}", truncatedOutput);

    // Create an AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      // Use Ollama client's prompt method
      const response = await this.ollamaClient.prompt(prompt, {
        model: this.config.model,
        maxTokens: this.config.maxTokens,
        temperature: 0.3,
      });

      clearTimeout(timeoutId);

      if (!response.success) {
        throw new Error(response.error || "Ollama request failed");
      }

      const summary = response.text?.trim() || "";

      // Clean up summary - remove any remaining markdown or formatting
      return this.cleanSummary(summary);
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * Clean up the generated summary
   * Remove any markdown formatting or artifacts
   */
  private cleanSummary(summary: string): string {
    let result = summary;

    // Remove markdown code blocks
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
   * Update configuration
   */
  updateConfig(config: Partial<OutputSummarizerConfig>): void {
    this.config = { ...this.config, ...config };

    // Update Ollama client if URL or model changed
    if (config.ollamaUrl || config.model) {
      this.ollamaClient = createOllamaClient({
        ollamaUrl: this.config.ollamaUrl,
        ollamaModel: this.config.model,
      });
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): OutputSummarizerConfig {
    return { ...this.config };
  }

  /**
   * Get the length threshold
   */
  getThreshold(): number {
    return this.config.minLengthThreshold;
  }
}

/**
 * Create an OutputSummarizer instance
 */
export function createOutputSummarizer(
  config: Partial<OutputSummarizerConfig> = {}
): OutputSummarizer {
  return new OutputSummarizer(config);
}

// Export singleton instance
export const outputSummarizer = new OutputSummarizer();
