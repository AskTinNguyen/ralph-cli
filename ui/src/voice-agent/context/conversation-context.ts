/**
 * Conversation Context
 *
 * Tracks multi-turn conversation context for voice commands to resolve
 * ambiguous references like "build it", "run that again", etc.
 */

import type { VoiceIntent, ExecutionResult } from '../types.js';

/**
 * A single turn in the conversation
 */
export interface ConversationTurn {
  /** Original text from user */
  text: string;

  /** Extracted intent */
  intent: VoiceIntent;

  /** Timestamp of the turn */
  timestamp: Date;

  /** Execution result if command was run */
  result?: ExecutionResult;
}

/**
 * Request for clarification from user
 */
export interface ClarificationRequest {
  type: 'clarification';

  /** Question to ask the user */
  question: string;

  /** Suggested options */
  options?: string[];

  /** The original ambiguous intent */
  originalIntent: VoiceIntent;
}

/**
 * Configuration for conversation context
 */
export interface ConversationContextConfig {
  /** Maximum turns to keep in history */
  maxTurns: number;

  /** Expiry time in milliseconds for context */
  expiryMs: number;

  /** Minimum confidence to auto-resolve ambiguity */
  minConfidenceForAutoResolve: number;
}

const DEFAULT_CONFIG: ConversationContextConfig = {
  maxTurns: 10,
  expiryMs: 5 * 60 * 1000, // 5 minutes
  minConfidenceForAutoResolve: 0.7,
};

/**
 * Conversation Context class
 */
export class ConversationContext {
  private turns: ConversationTurn[] = [];
  private currentPrd?: string;
  private lastCommand?: string;
  private config: ConversationContextConfig;

  constructor(config: Partial<ConversationContextConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Add a turn to the conversation
   */
  addTurn(turn: ConversationTurn): void {
    // Clean up expired turns
    this.pruneExpiredTurns();

    // Add new turn
    this.turns.push(turn);

    // Trim to max turns
    if (this.turns.length > this.config.maxTurns) {
      this.turns = this.turns.slice(-this.config.maxTurns);
    }

    // Track last referenced PRD
    if (turn.intent.parameters?.prdNumber) {
      this.currentPrd = turn.intent.parameters.prdNumber;
    }

    // Track last command type
    if (turn.intent.parameters?.command) {
      this.lastCommand = turn.intent.parameters.command;
    }
  }

  /**
   * Attempt to resolve an ambiguous intent using conversation context
   * Returns the resolved intent or a clarification request
   */
  resolveAmbiguity(intent: VoiceIntent): VoiceIntent | ClarificationRequest {
    // Check if intent is marked as ambiguous
    const isAmbiguous = intent.parameters?.ambiguous === 'true' ||
                        intent.parameters?.needsContext === 'true';

    if (!isAmbiguous) {
      return intent;
    }

    const command = intent.parameters?.command;

    // Handle "build it" / "run that" type commands
    if (command === 'build' || this.looksLikeBuildCommand(intent)) {
      return this.resolveBuildAmbiguity(intent);
    }

    // Handle "run that again" type commands
    if (this.looksLikeRepeatCommand(intent)) {
      return this.resolveRepeatAmbiguity(intent);
    }

    // Can't resolve - ask for clarification
    return {
      type: 'clarification',
      question: "I'm not sure what you'd like me to do. Could you be more specific?",
      originalIntent: intent,
    };
  }

  /**
   * Resolve ambiguity for build commands
   */
  private resolveBuildAmbiguity(intent: VoiceIntent): VoiceIntent | ClarificationRequest {
    // If we have a current PRD from context, use it
    if (this.currentPrd) {
      const resolvedIntent = { ...intent };
      resolvedIntent.parameters = {
        ...resolvedIntent.parameters,
        prdNumber: this.currentPrd,
      };
      delete resolvedIntent.parameters.ambiguous;
      delete resolvedIntent.parameters.needsContext;

      // Update command string
      if (resolvedIntent.command) {
        resolvedIntent.command = resolvedIntent.command.replace(
          /ralph build (\d+)/,
          `ralph build $1 --prd=${this.currentPrd}`
        );
      }

      // Increase confidence since we resolved it
      resolvedIntent.confidence = Math.min(intent.confidence + 0.1, 0.95);

      return resolvedIntent;
    }

    // No context - ask for clarification
    return {
      type: 'clarification',
      question: 'Which PRD would you like to build?',
      options: this.getRecentPrds(),
      originalIntent: intent,
    };
  }

  /**
   * Resolve ambiguity for repeat commands
   */
  private resolveRepeatAmbiguity(intent: VoiceIntent): VoiceIntent | ClarificationRequest {
    // Find the last executed command
    const lastExecutedTurn = this.turns
      .slice()
      .reverse()
      .find(t => t.result?.success);

    if (lastExecutedTurn) {
      // Return a copy of the last intent
      const resolvedIntent = { ...lastExecutedTurn.intent };
      resolvedIntent.originalText = intent.originalText;
      resolvedIntent.confidence = Math.min(lastExecutedTurn.intent.confidence, 0.85);
      return resolvedIntent;
    }

    return {
      type: 'clarification',
      question: "I don't have any previous commands to repeat. What would you like me to do?",
      originalIntent: intent,
    };
  }

  /**
   * Check if intent looks like a build command
   */
  private looksLikeBuildCommand(intent: VoiceIntent): boolean {
    const text = intent.originalText?.toLowerCase() || '';
    return /\b(build|execute|run)\s*(it|that|this)?\b/.test(text);
  }

  /**
   * Check if intent looks like a repeat command
   */
  private looksLikeRepeatCommand(intent: VoiceIntent): boolean {
    const text = intent.originalText?.toLowerCase() || '';
    return /\b(again|repeat|redo|same)\b/.test(text);
  }

  /**
   * Get recent PRD numbers mentioned in conversation
   */
  private getRecentPrds(): string[] {
    const prds = new Set<string>();

    this.turns.forEach(turn => {
      if (turn.intent.parameters?.prdNumber) {
        prds.add(`PRD ${turn.intent.parameters.prdNumber}`);
      }
    });

    return Array.from(prds).slice(0, 5);
  }

  /**
   * Remove expired turns from history
   */
  private pruneExpiredTurns(): void {
    const now = Date.now();
    this.turns = this.turns.filter(
      turn => now - turn.timestamp.getTime() < this.config.expiryMs
    );

    // If all turns expired, clear context
    if (this.turns.length === 0) {
      this.currentPrd = undefined;
      this.lastCommand = undefined;
    }
  }

  /**
   * Get the current PRD from context
   */
  getCurrentPrd(): string | undefined {
    this.pruneExpiredTurns();
    return this.currentPrd;
  }

  /**
   * Get the last command type
   */
  getLastCommand(): string | undefined {
    this.pruneExpiredTurns();
    return this.lastCommand;
  }

  /**
   * Get conversation history
   */
  getHistory(): ConversationTurn[] {
    this.pruneExpiredTurns();
    return [...this.turns];
  }

  /**
   * Clear all context
   */
  clear(): void {
    this.turns = [];
    this.currentPrd = undefined;
    this.lastCommand = undefined;
  }

  /**
   * Set current PRD explicitly
   */
  setCurrentPrd(prdNumber: string): void {
    this.currentPrd = prdNumber;
  }

  /**
   * Check if context has any turns
   */
  hasContext(): boolean {
    this.pruneExpiredTurns();
    return this.turns.length > 0;
  }

  /**
   * Get context summary for debugging
   */
  getSummary(): {
    turnCount: number;
    currentPrd?: string;
    lastCommand?: string;
    oldestTurn?: Date;
    newestTurn?: Date;
  } {
    this.pruneExpiredTurns();
    return {
      turnCount: this.turns.length,
      currentPrd: this.currentPrd,
      lastCommand: this.lastCommand,
      oldestTurn: this.turns[0]?.timestamp,
      newestTurn: this.turns[this.turns.length - 1]?.timestamp,
    };
  }
}

/**
 * Create a ConversationContext instance
 */
export function createConversationContext(
  config: Partial<ConversationContextConfig> = {}
): ConversationContext {
  return new ConversationContext(config);
}

// Export singleton instance
export const conversationContext = new ConversationContext();
