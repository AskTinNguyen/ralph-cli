/**
 * Conversation State Manager
 *
 * Maintains conversation history and context for follow-up commands.
 * Enables contextual commands like "fix it", "do that again", "now commit".
 */

/**
 * Conversation entry
 */
export interface ConversationEntry {
  /** The prompt that was sent */
  prompt: string;

  /** The full response received */
  response: string;

  /** Filtered response for display/TTS */
  filteredResponse: string;

  /** Whether the command succeeded */
  success: boolean;

  /** Timestamp */
  timestamp: Date;

  /** Files that were modified (if any) */
  modifiedFiles?: string[];

  /** Error message (if failed) */
  error?: string;
}

/**
 * Conversation session
 */
export interface ConversationSession {
  /** Session ID */
  id: string;

  /** Conversation history */
  history: ConversationEntry[];

  /** When session was created */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivity: Date;

  /** Current working context */
  context?: {
    /** Current directory/project */
    cwd?: string;

    /** Active file being discussed */
    activeFile?: string;

    /** Last action taken */
    lastAction?: string;
  };
}

/**
 * Conversation manager configuration
 */
export interface ConversationManagerConfig {
  /** Maximum history entries per session */
  maxHistorySize: number;

  /** Session timeout in milliseconds */
  sessionTimeout: number;

  /** Maximum number of concurrent sessions */
  maxSessions: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CONVERSATION_CONFIG: ConversationManagerConfig = {
  maxHistorySize: 20,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  maxSessions: 10,
};

/**
 * Conversation State Manager class
 */
export class ConversationStateManager {
  private sessions: Map<string, ConversationSession> = new Map();
  private config: ConversationManagerConfig;

  constructor(config: Partial<ConversationManagerConfig> = {}) {
    this.config = { ...DEFAULT_CONVERSATION_CONFIG, ...config };

    // Set up periodic cleanup
    setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  /**
   * Get or create a session
   */
  getOrCreateSession(sessionId: string): ConversationSession {
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        id: sessionId,
        history: [],
        createdAt: new Date(),
        lastActivity: new Date(),
      };
      this.sessions.set(sessionId, session);

      // Clean up if too many sessions
      this.enforceMaxSessions();
    }

    return session;
  }

  /**
   * Add an entry to conversation history
   */
  addToHistory(sessionId: string, entry: ConversationEntry): void {
    const session = this.getOrCreateSession(sessionId);

    session.history.push(entry);
    session.lastActivity = new Date();

    // Extract context from the entry
    this.updateContext(session, entry);

    // Trim history if needed
    if (session.history.length > this.config.maxHistorySize) {
      session.history = session.history.slice(-this.config.maxHistorySize);
    }
  }

  /**
   * Get conversation history for a session
   */
  getHistory(sessionId: string): ConversationEntry[] {
    const session = this.sessions.get(sessionId);
    return session?.history || [];
  }

  /**
   * Get the last successful entry
   */
  getLastSuccessfulEntry(sessionId: string): ConversationEntry | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    for (let i = session.history.length - 1; i >= 0; i--) {
      if (session.history[i].success) {
        return session.history[i];
      }
    }

    return null;
  }

  /**
   * Get context string for prompt injection
   */
  getContextForPrompt(sessionId: string): string | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.history.length === 0) {
      return null;
    }

    // Build context from recent history
    const recentHistory = session.history.slice(-3); // Last 3 entries
    const contextParts: string[] = [];

    contextParts.push("Previous conversation context:");

    for (const entry of recentHistory) {
      contextParts.push(`- User asked: "${entry.prompt}"`);
      if (entry.success) {
        // Include a brief summary of what happened
        const summary = this.summarizeEntry(entry);
        if (summary) {
          contextParts.push(`  Result: ${summary}`);
        }
      } else {
        contextParts.push(`  Failed: ${entry.error || "Unknown error"}`);
      }
    }

    // Add current context if available
    if (session.context) {
      if (session.context.activeFile) {
        contextParts.push(`Currently discussing: ${session.context.activeFile}`);
      }
      if (session.context.lastAction) {
        contextParts.push(`Last action: ${session.context.lastAction}`);
      }
    }

    return contextParts.join("\n");
  }

  /**
   * Update session context from an entry
   */
  private updateContext(
    session: ConversationSession,
    entry: ConversationEntry
  ): void {
    if (!session.context) {
      session.context = {};
    }

    // Extract modified files
    if (entry.modifiedFiles && entry.modifiedFiles.length > 0) {
      session.context.activeFile = entry.modifiedFiles[0];
    }

    // Extract action from prompt
    const actionMatch = entry.prompt.match(
      /^(?:run|create|build|fix|update|add|remove|delete|install|test)\s+/i
    );
    if (actionMatch) {
      session.context.lastAction = entry.prompt;
    }

    // Look for file mentions in the response
    const fileMatches = entry.response.match(
      /(?:created|wrote|updated|modified|edited)\s+([^\s,]+\.[a-z]+)/gi
    );
    if (fileMatches && fileMatches.length > 0) {
      entry.modifiedFiles = fileMatches.map((m) => {
        const parts = m.split(/\s+/);
        return parts[parts.length - 1];
      });
      session.context.activeFile = entry.modifiedFiles[0];
    }
  }

  /**
   * Summarize an entry for context
   */
  private summarizeEntry(entry: ConversationEntry): string {
    // Use filtered response if available
    if (entry.filteredResponse && entry.filteredResponse.length < 200) {
      return entry.filteredResponse;
    }

    // Extract key information
    if (entry.modifiedFiles && entry.modifiedFiles.length > 0) {
      return `Modified ${entry.modifiedFiles.length} file(s): ${entry.modifiedFiles.slice(0, 3).join(", ")}`;
    }

    // Check for common outcomes
    if (entry.response.includes("success")) {
      return "Completed successfully";
    }

    if (entry.response.includes("test")) {
      const passMatch = entry.response.match(/(\d+)\s*pass/i);
      const failMatch = entry.response.match(/(\d+)\s*fail/i);
      if (passMatch || failMatch) {
        return `Tests: ${passMatch?.[1] || 0} passed, ${failMatch?.[1] || 0} failed`;
      }
    }

    return "Completed";
  }

  /**
   * Clear session history
   */
  clearHistory(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.history = [];
      session.context = undefined;
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();

    for (const [sessionId, session] of this.sessions) {
      const age = now - session.lastActivity.getTime();
      if (age > this.config.sessionTimeout) {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Enforce maximum sessions limit
   */
  private enforceMaxSessions(): void {
    if (this.sessions.size <= this.config.maxSessions) {
      return;
    }

    // Remove oldest sessions
    const sessions = Array.from(this.sessions.entries()).sort(
      (a, b) => a[1].lastActivity.getTime() - b[1].lastActivity.getTime()
    );

    const toRemove = sessions.slice(0, sessions.length - this.config.maxSessions);
    for (const [sessionId] of toRemove) {
      this.sessions.delete(sessionId);
    }
  }

  /**
   * Check if a command appears to need context
   */
  needsContext(text: string): boolean {
    const contextPatterns = [
      /^now\s+/i,
      /^then\s+/i,
      /^also\s+/i,
      /^next\s+/i,
      /^and\s+/i,
      /^fix\s+it/i,
      /^do\s+(that|it)\s+again/i,
      /^commit\s+(that|those|it|the\s+changes)/i,
      /^push\s+(that|those|it)/i,
      /^undo\s+that/i,
      /^revert\s+that/i,
      /^what\s+(did|was)/i,
      /^why\s+did/i,
      /^(that|it|those|the\s+\w+)\s/i, // Pronouns referring to previous context
    ];

    return contextPatterns.some((pattern) => pattern.test(text.trim()));
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<ConversationManagerConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): ConversationManagerConfig {
    return { ...this.config };
  }
}

/**
 * Create a ConversationStateManager instance
 */
export function createConversationStateManager(
  config: Partial<ConversationManagerConfig> = {}
): ConversationStateManager {
  return new ConversationStateManager(config);
}

// Export singleton instance
export const conversationStateManager = new ConversationStateManager();
