/**
 * Sentence Buffer
 *
 * Buffers incoming text chunks into complete sentences before flushing.
 * Used for streaming TTS to avoid choppy speech from small chunks.
 */

/**
 * Sentence Buffer options
 */
export interface SentenceBufferOptions {
  /** Flush timeout in milliseconds (default: 500ms) */
  flushTimeoutMs?: number;

  /** Minimum characters before considering flush (default: 20) */
  minChunkSize?: number;

  /** Maximum characters to buffer before force flush (default: 200) */
  maxBufferSize?: number;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: Required<SentenceBufferOptions> = {
  flushTimeoutMs: 500,
  minChunkSize: 20,
  maxBufferSize: 200,
};

/**
 * Sentence boundary patterns
 */
const SENTENCE_BOUNDARIES = /([.!?]+)\s*/g;

/**
 * SentenceBuffer class
 *
 * Accumulates text until sentence boundaries are found,
 * then flushes complete sentences for TTS.
 */
export class SentenceBuffer {
  private buffer: string = "";
  private flushTimeout: NodeJS.Timeout | null = null;
  private options: Required<SentenceBufferOptions>;
  private onFlush: (text: string) => void;
  private paused: boolean = false;

  constructor(
    onFlush: (text: string) => void,
    options: SentenceBufferOptions = {}
  ) {
    this.onFlush = onFlush;
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Add text to the buffer
   * Complete sentences are flushed immediately.
   * Incomplete text is held until more arrives or timeout.
   */
  add(text: string): void {
    if (this.paused) return;

    this.buffer += text;
    this.clearFlushTimeout();

    // Extract and flush complete sentences
    const sentences = this.extractCompleteSentences();
    for (const sentence of sentences) {
      if (sentence.trim().length >= this.options.minChunkSize) {
        this.onFlush(sentence.trim());
      }
    }

    // Force flush if buffer exceeds max size
    if (this.buffer.length >= this.options.maxBufferSize) {
      this.forceFlushBuffer();
      return;
    }

    // Set timeout for remaining buffer content
    if (this.buffer.trim().length > 0) {
      this.setFlushTimeout();
    }
  }

  /**
   * Extract complete sentences from buffer
   * Returns array of complete sentences, leaves incomplete text in buffer.
   */
  private extractCompleteSentences(): string[] {
    const sentences: string[] = [];
    let lastIndex = 0;

    // Find all sentence boundaries
    SENTENCE_BOUNDARIES.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = SENTENCE_BOUNDARIES.exec(this.buffer)) !== null) {
      const sentenceEnd = match.index + match[0].length;
      const sentence = this.buffer.slice(lastIndex, sentenceEnd);
      sentences.push(sentence);
      lastIndex = sentenceEnd;
    }

    // Keep the remaining incomplete text in buffer
    this.buffer = this.buffer.slice(lastIndex);

    return sentences;
  }

  /**
   * Force flush the current buffer content
   */
  private forceFlushBuffer(): void {
    if (this.buffer.trim().length > 0) {
      // Try to find a good break point (comma, word boundary)
      const breakPoint = this.findBreakPoint();
      if (breakPoint > this.options.minChunkSize) {
        const toFlush = this.buffer.slice(0, breakPoint).trim();
        this.buffer = this.buffer.slice(breakPoint).trim();
        if (toFlush.length > 0) {
          this.onFlush(toFlush);
        }
      } else {
        // Flush everything
        this.onFlush(this.buffer.trim());
        this.buffer = "";
      }
    }
  }

  /**
   * Find a good break point for partial flush
   */
  private findBreakPoint(): number {
    // Look for comma or semicolon
    const commaIndex = this.buffer.lastIndexOf(",", this.options.maxBufferSize);
    if (commaIndex > this.options.minChunkSize) {
      return commaIndex + 1;
    }

    // Look for space
    const spaceIndex = this.buffer.lastIndexOf(" ", this.options.maxBufferSize);
    if (spaceIndex > this.options.minChunkSize) {
      return spaceIndex + 1;
    }

    return this.options.maxBufferSize;
  }

  /**
   * Set timeout to flush remaining buffer
   */
  private setFlushTimeout(): void {
    this.flushTimeout = setTimeout(() => {
      this.timeoutFlush();
    }, this.options.flushTimeoutMs);
  }

  /**
   * Clear the flush timeout
   */
  private clearFlushTimeout(): void {
    if (this.flushTimeout) {
      clearTimeout(this.flushTimeout);
      this.flushTimeout = null;
    }
  }

  /**
   * Flush due to timeout
   */
  private timeoutFlush(): void {
    if (this.buffer.trim().length >= this.options.minChunkSize) {
      this.onFlush(this.buffer.trim());
      this.buffer = "";
    }
    this.flushTimeout = null;
  }

  /**
   * Force flush all remaining buffer content
   * Call this when stream ends to ensure nothing is left.
   */
  flush(): void {
    this.clearFlushTimeout();
    if (this.buffer.trim().length > 0) {
      this.onFlush(this.buffer.trim());
      this.buffer = "";
    }
  }

  /**
   * Clear the buffer without flushing
   */
  clear(): void {
    this.clearFlushTimeout();
    this.buffer = "";
  }

  /**
   * Pause buffering (incoming text is discarded)
   */
  pause(): void {
    this.paused = true;
    this.clearFlushTimeout();
  }

  /**
   * Resume buffering
   */
  resume(): void {
    this.paused = false;
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Get current buffer content (for debugging)
   */
  getBufferContent(): string {
    return this.buffer;
  }

  /**
   * Get current buffer length
   */
  getBufferLength(): number {
    return this.buffer.length;
  }
}

/**
 * Create a SentenceBuffer instance
 */
export function createSentenceBuffer(
  onFlush: (text: string) => void,
  options: SentenceBufferOptions = {}
): SentenceBuffer {
  return new SentenceBuffer(onFlush, options);
}
