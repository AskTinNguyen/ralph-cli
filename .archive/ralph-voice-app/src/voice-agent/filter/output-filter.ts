/**
 * Output Filter for TTS
 *
 * Filters Claude Code output to remove verbose content unsuitable for text-to-speech.
 * Keeps final answers, summaries, and important messages.
 */

/**
 * Filter configuration
 */
export interface FilterConfig {
  /** Maximum length for TTS output (characters) */
  maxLength: number;

  /** Maximum lines of code to speak */
  maxCodeLines: number;

  /** Whether to include file paths */
  includeFilePaths: boolean;

  /** Whether to include statistics */
  includeStats: boolean;
}

/**
 * Default filter configuration
 */
export const DEFAULT_FILTER_CONFIG: FilterConfig = {
  maxLength: 500,
  maxCodeLines: 3,
  includeFilePaths: false,
  includeStats: true,
};

/**
 * Output Filter class
 */
export class OutputFilter {
  private config: FilterConfig;

  constructor(config: Partial<FilterConfig> = {}) {
    this.config = { ...DEFAULT_FILTER_CONFIG, ...config };
  }

  /**
   * Filter output for TTS - main entry point
   */
  filter(output: string): string {
    if (!output || output.trim().length === 0) {
      return "";
    }

    let filtered = output;

    // Remove thinking blocks
    filtered = this.removeThinkingBlocks(filtered);

    // Remove tool call markers
    filtered = this.removeToolCalls(filtered);

    // Remove long file content dumps
    filtered = this.removeFileContentDumps(filtered);

    // Remove verbose logs
    filtered = this.removeVerboseLogs(filtered);

    // Remove long IDs and hashes
    filtered = this.removeLongIdentifiers(filtered);

    // Remove code blocks (but keep short ones)
    filtered = this.filterCodeBlocks(filtered);

    // Remove excessive whitespace
    filtered = this.normalizeWhitespace(filtered);

    // Truncate if too long
    filtered = this.truncate(filtered);

    return filtered.trim();
  }

  /**
   * Filter a streaming chunk for real-time TTS
   */
  filterChunk(chunk: string): string {
    if (!chunk || chunk.trim().length === 0) {
      return "";
    }

    // Skip chunks that are clearly not speakable
    if (this.isNonSpeakableChunk(chunk)) {
      return "";
    }

    // Apply basic filtering
    let filtered = chunk;

    // Remove ANSI escape codes
    filtered = filtered.replace(/\x1b\[[0-9;]*m/g, "");

    // Remove thinking block content
    if (filtered.includes("<thinking>") || filtered.includes("</thinking>")) {
      return "";
    }

    // Remove tool markers
    filtered = filtered.replace(/\[Tool:\s*\w+\]/gi, "");
    filtered = filtered.replace(/\[Reading\s+.*?\]/gi, "");
    filtered = filtered.replace(/\[Writing\s+.*?\]/gi, "");

    return filtered.trim();
  }

  /**
   * Generate a TTS-friendly summary of the full output
   */
  generateTTSSummary(fullOutput: string, originalCommand: string): string {
    const filtered = this.filter(fullOutput);

    // If output is already short, use it directly
    if (filtered.length <= this.config.maxLength) {
      return filtered || this.generateFallbackSummary(fullOutput, originalCommand);
    }

    // Try to extract key information
    const summary = this.extractKeySummary(fullOutput);
    if (summary) {
      return summary;
    }

    // Truncate with "..." indicator
    return filtered.substring(0, this.config.maxLength - 3) + "...";
  }

  /**
   * Remove <thinking>...</thinking> blocks
   */
  private removeThinkingBlocks(text: string): string {
    // Remove multi-line thinking blocks
    let result = text.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");

    // Remove single-line thinking markers
    result = result.replace(/<thinking>.*$/gim, "");
    result = result.replace(/^.*<\/thinking>/gim, "");

    return result;
  }

  /**
   * Remove tool call details
   */
  private removeToolCalls(text: string): string {
    let result = text;

    // Remove [Tool: X] markers
    result = result.replace(/\[Tool:\s*\w+\]/gi, "");

    // Remove tool call blocks
    result = result.replace(/```tool[\s\S]*?```/gi, "");

    // Remove specific tool patterns
    const toolPatterns = [
      /\[Reading\s+.*?\]/gi,
      /\[Writing\s+.*?\]/gi,
      /\[Editing\s+.*?\]/gi,
      /\[Searching\s+.*?\]/gi,
      /\[Running\s+.*?\]/gi,
      /Tool result:.*$/gim,
      /⏺\s*Read\s+.*$/gim,
      /⏺\s*Write\s+.*$/gim,
      /⏺\s*Edit\s+.*$/gim,
      /⏺\s*Bash\s+.*$/gim,
    ];

    for (const pattern of toolPatterns) {
      result = result.replace(pattern, "");
    }

    return result;
  }

  /**
   * Remove file content dumps (more than N lines)
   */
  private removeFileContentDumps(text: string): string {
    const maxLines = 20;
    const lines = text.split("\n");
    const result: string[] = [];

    let inCodeBlock = false;
    let codeBlockLines = 0;

    for (const line of lines) {
      // Track code blocks
      if (line.trim().startsWith("```")) {
        if (inCodeBlock) {
          // Ending code block
          if (codeBlockLines > maxLines) {
            result.push("[Code block with " + codeBlockLines + " lines omitted]");
          }
          inCodeBlock = false;
          codeBlockLines = 0;
        } else {
          // Starting code block
          inCodeBlock = true;
          codeBlockLines = 0;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockLines++;
        if (codeBlockLines <= maxLines) {
          result.push(line);
        }
      } else {
        result.push(line);
      }
    }

    return result.join("\n");
  }

  /**
   * Remove verbose logs (npm install, git status, etc.)
   */
  private removeVerboseLogs(text: string): string {
    let result = text;

    // npm verbose output
    result = result.replace(/npm WARN.*$/gim, "");
    result = result.replace(/npm notice.*$/gim, "");
    result = result.replace(/added \d+ packages.*$/gim, (match) => {
      // Keep summary but simplify
      const numMatch = match.match(/added (\d+) packages/);
      return numMatch ? `Added ${numMatch[1]} packages.` : "";
    });

    // Git verbose output
    result = result.replace(/^\s*\d+\s+files? changed.*$/gim, "");
    result = result.replace(/^\s*\d+ insertions?\(\+\).*$/gim, "");
    result = result.replace(/^\s*\d+ deletions?\(-\).*$/gim, "");

    // Progress indicators
    result = result.replace(/\[={2,}.*?\]/g, "");
    result = result.replace(/\d+%\s*\|[█▓▒░ ]*\|/g, "");
    result = result.replace(/⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏/g, "");

    // Remove repeated blank lines
    result = result.replace(/\n{3,}/g, "\n\n");

    return result;
  }

  /**
   * Remove long identifiers (hashes, UUIDs, etc.)
   */
  private removeLongIdentifiers(text: string): string {
    let result = text;

    // Git commit hashes (40 chars)
    result = result.replace(/\b[0-9a-f]{40}\b/gi, "[commit]");

    // Short git hashes (7-8 chars) - be careful not to remove words
    result = result.replace(/\b[0-9a-f]{7,8}\b(?=\s|$)/gi, "[commit]");

    // UUIDs
    result = result.replace(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
      "[id]"
    );

    // Long base64 strings
    result = result.replace(/[A-Za-z0-9+/]{50,}={0,2}/g, "[encoded data]");

    return result;
  }

  /**
   * Filter code blocks - keep short ones, summarize long ones
   */
  private filterCodeBlocks(text: string): string {
    const maxLines = this.config.maxCodeLines;

    return text.replace(/```[\s\S]*?```/g, (block) => {
      const lines = block.split("\n").filter((l) => l.trim());
      if (lines.length <= maxLines + 2) {
        // +2 for ``` markers
        return block;
      }
      return `[Code block with ${lines.length - 2} lines]`;
    });
  }

  /**
   * Normalize whitespace
   */
  private normalizeWhitespace(text: string): string {
    // Remove leading/trailing whitespace from lines
    let result = text
      .split("\n")
      .map((line) => line.trim())
      .join("\n");

    // Collapse multiple blank lines
    result = result.replace(/\n{3,}/g, "\n\n");

    // Remove ANSI escape codes
    result = result.replace(/\x1b\[[0-9;]*m/g, "");

    return result;
  }

  /**
   * Truncate to max length
   */
  private truncate(text: string): string {
    if (text.length <= this.config.maxLength) {
      return text;
    }

    // Try to truncate at a sentence boundary
    const truncated = text.substring(0, this.config.maxLength);
    const lastSentence = truncated.lastIndexOf(". ");

    if (lastSentence > this.config.maxLength * 0.5) {
      return truncated.substring(0, lastSentence + 1);
    }

    // Truncate at word boundary
    const lastSpace = truncated.lastIndexOf(" ");
    if (lastSpace > this.config.maxLength * 0.7) {
      return truncated.substring(0, lastSpace) + "...";
    }

    return truncated + "...";
  }

  /**
   * Check if a chunk is clearly not speakable
   */
  private isNonSpeakableChunk(chunk: string): boolean {
    // Thinking block content
    if (chunk.includes("<thinking>") || chunk.includes("</thinking>")) {
      return true;
    }

    // Tool markers
    if (/^\[Tool:\s*\w+\]$/i.test(chunk.trim())) {
      return true;
    }

    // Pure whitespace
    if (chunk.trim().length === 0) {
      return true;
    }

    // Only special characters
    if (/^[─│┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬\s]+$/.test(chunk)) {
      return true;
    }

    // Progress bars
    if (/^[\s█▓▒░]+$/.test(chunk)) {
      return true;
    }

    return false;
  }

  /**
   * Extract a key summary from the output
   */
  private extractKeySummary(output: string): string | null {
    // Look for success/completion messages
    const successPatterns = [
      /(?:successfully|completed|done|finished)[^.]*\./gi,
      /(?:created|wrote|updated|modified|fixed|added|removed)[^.]*\./gi,
      /(?:\d+)\s+(?:tests?|files?|changes?)[^.]*\./gi,
      /(?:all\s+\d+\s+tests?\s+passed)[^.]*/gi,
      /(?:error|failed|warning)[^.]*\./gi,
    ];

    const summaries: string[] = [];

    for (const pattern of successPatterns) {
      const matches = output.match(pattern);
      if (matches) {
        summaries.push(...matches.slice(0, 2)); // Take up to 2 matches per pattern
      }
    }

    if (summaries.length > 0) {
      const summary = summaries.slice(0, 3).join(" ");
      return this.truncate(summary);
    }

    // Look for the last meaningful sentence
    const sentences = output.match(/[^.!?]*[.!?]/g);
    if (sentences && sentences.length > 0) {
      // Filter out non-meaningful sentences
      const meaningful = sentences.filter(
        (s) =>
          s.trim().length > 20 &&
          !/^\s*\d+\s*$/.test(s) &&
          !/^[\s\-_=]+$/.test(s)
      );

      if (meaningful.length > 0) {
        return this.truncate(meaningful[meaningful.length - 1].trim());
      }
    }

    return null;
  }

  /**
   * Generate a fallback summary when filtering produces no useful output
   */
  private generateFallbackSummary(output: string, originalCommand: string): string {
    // Check for common outcomes
    if (output.includes("error") || output.includes("Error")) {
      return "The command encountered an error. Check the full output for details.";
    }

    if (output.includes("success") || output.includes("Success")) {
      return "The command completed successfully.";
    }

    if (output.includes("test") || output.includes("Test")) {
      const passMatch = output.match(/(\d+)\s*(?:tests?\s+)?pass/i);
      const failMatch = output.match(/(\d+)\s*(?:tests?\s+)?fail/i);

      if (passMatch || failMatch) {
        const passed = passMatch ? passMatch[1] : "0";
        const failed = failMatch ? failMatch[1] : "0";
        return `Tests completed: ${passed} passed, ${failed} failed.`;
      }
    }

    // Default fallback
    const actionMatch = originalCommand.match(
      /^(?:run|create|build|fix|update|add|remove|delete|install)/i
    );
    const action = actionMatch ? actionMatch[0].toLowerCase() : "process";

    return `The ${action} operation has completed.`;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): FilterConfig {
    return { ...this.config };
  }
}

/**
 * Create an OutputFilter instance
 */
export function createOutputFilter(
  config: Partial<FilterConfig> = {}
): OutputFilter {
  return new OutputFilter(config);
}

// Export singleton instance
export const outputFilter = new OutputFilter();
