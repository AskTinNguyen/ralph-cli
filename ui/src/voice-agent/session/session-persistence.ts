/**
 * Session Persistence
 *
 * Provides serialization and deserialization of voice session state
 * for persistence across browser refreshes. Stores session state in
 * localStorage keyed by session ID with automatic cleanup of stale sessions.
 */

import type {
  VoiceSession,
  VoiceSessionState,
  VoiceActionRecord,
  VoiceIntent,
  ExecutionResult,
} from '../types.js';
import type { ConversationTurn } from '../context/conversation-context.js';

/**
 * Serializable version of VoiceSession with JSON-safe date formats
 */
export interface SerializedVoiceSession {
  /** Unique session ID */
  id: string;

  /** Current state */
  state: VoiceSessionState;

  /** Timestamp when session started (ISO string) */
  startedAt: string;

  /** Last activity timestamp (ISO string) */
  lastActivity: string;

  /** Action history for this session */
  history: SerializedActionRecord[];

  /** Current pending intent (if confirming) */
  pendingIntent?: VoiceIntent;

  /** Conversation context for multi-turn support */
  conversationContext?: SerializedConversationContext;
}

/**
 * Serializable version of VoiceActionRecord
 */
export interface SerializedActionRecord {
  /** Unique action ID */
  id: string;

  /** Timestamp (ISO string) */
  timestamp: string;

  /** Original transcription */
  transcription: string;

  /** Extracted intent */
  intent: VoiceIntent;

  /** Execution result */
  result?: ExecutionResult;

  /** Whether user confirmed (if confirmation was required) */
  confirmed?: boolean;
}

/**
 * Serializable conversation context
 */
export interface SerializedConversationContext {
  /** Conversation turns */
  turns: SerializedConversationTurn[];

  /** Current PRD number being discussed */
  currentPrd?: string;

  /** Last command type executed */
  lastCommand?: string;
}

/**
 * Serializable conversation turn
 */
export interface SerializedConversationTurn {
  /** Original text from user */
  text: string;

  /** Extracted intent */
  intent: VoiceIntent;

  /** Timestamp (ISO string) */
  timestamp: string;

  /** Execution result if command was run */
  result?: ExecutionResult;
}

/**
 * Session storage configuration
 */
export interface SessionStorageConfig {
  /** Storage key prefix for localStorage */
  keyPrefix: string;

  /** Maximum age for sessions in milliseconds (default: 24 hours) */
  maxSessionAgeMs: number;

  /** Maximum number of sessions to keep (for cleanup) */
  maxSessions: number;
}

const DEFAULT_STORAGE_CONFIG: SessionStorageConfig = {
  keyPrefix: 'ralph-voice-session',
  maxSessionAgeMs: 24 * 60 * 60 * 1000, // 24 hours
  maxSessions: 10,
};

/**
 * Session Persistence class
 *
 * Handles serialization, deserialization, and storage of voice sessions.
 */
export class SessionPersistence {
  private config: SessionStorageConfig;

  constructor(config: Partial<SessionStorageConfig> = {}) {
    this.config = { ...DEFAULT_STORAGE_CONFIG, ...config };
  }

  /**
   * Serialize a VoiceSession to a JSON string
   */
  serialize(session: VoiceSession, conversationContext?: {
    turns: ConversationTurn[];
    currentPrd?: string;
    lastCommand?: string;
  }): string {
    const serialized: SerializedVoiceSession = {
      id: session.id,
      state: session.state,
      startedAt: session.startedAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      history: session.history.map(this.serializeActionRecord),
      pendingIntent: session.pendingIntent,
    };

    // Include conversation context if provided
    if (conversationContext) {
      serialized.conversationContext = {
        turns: conversationContext.turns.map(this.serializeConversationTurn),
        currentPrd: conversationContext.currentPrd,
        lastCommand: conversationContext.lastCommand,
      };
    }

    return JSON.stringify(serialized);
  }

  /**
   * Deserialize a JSON string to a VoiceSession
   */
  deserialize(json: string): {
    session: VoiceSession;
    conversationContext?: SerializedConversationContext;
  } {
    const parsed: SerializedVoiceSession = JSON.parse(json);

    const session: VoiceSession = {
      id: parsed.id,
      state: parsed.state,
      startedAt: new Date(parsed.startedAt),
      lastActivity: new Date(parsed.lastActivity),
      history: parsed.history.map(this.deserializeActionRecord),
      pendingIntent: parsed.pendingIntent,
    };

    return {
      session,
      conversationContext: parsed.conversationContext,
    };
  }

  /**
   * Get the storage key for a session ID
   */
  getStorageKey(sessionId: string): string {
    return `${this.config.keyPrefix}-${sessionId}`;
  }

  /**
   * Get the index key for tracking all sessions
   */
  getIndexKey(): string {
    return `${this.config.keyPrefix}-index`;
  }

  /**
   * Save a session to localStorage
   * Returns true if saved successfully
   */
  saveSession(
    session: VoiceSession,
    conversationContext?: {
      turns: ConversationTurn[];
      currentPrd?: string;
      lastCommand?: string;
    }
  ): boolean {
    // Check if we're in a browser environment
    if (typeof localStorage === 'undefined') {
      console.warn('[SessionPersistence] localStorage not available');
      return false;
    }

    try {
      const serialized = this.serialize(session, conversationContext);
      const key = this.getStorageKey(session.id);

      localStorage.setItem(key, serialized);

      // Update index
      this.updateSessionIndex(session.id, session.lastActivity);

      // Cleanup old sessions
      this.cleanupStaleSessions();

      return true;
    } catch (error) {
      console.error('[SessionPersistence] Failed to save session:', error);
      return false;
    }
  }

  /**
   * Load a session from localStorage
   * Returns null if session not found or expired
   */
  loadSession(sessionId: string): {
    session: VoiceSession;
    conversationContext?: SerializedConversationContext;
  } | null {
    // Check if we're in a browser environment
    if (typeof localStorage === 'undefined') {
      console.warn('[SessionPersistence] localStorage not available');
      return null;
    }

    try {
      const key = this.getStorageKey(sessionId);
      const serialized = localStorage.getItem(key);

      if (!serialized) {
        return null;
      }

      const result = this.deserialize(serialized);

      // Check if session is too old
      const age = Date.now() - result.session.lastActivity.getTime();
      if (age > this.config.maxSessionAgeMs) {
        // Session is stale, remove it
        this.removeSession(sessionId);
        return null;
      }

      return result;
    } catch (error) {
      console.error('[SessionPersistence] Failed to load session:', error);
      return null;
    }
  }

  /**
   * Remove a session from localStorage
   */
  removeSession(sessionId: string): boolean {
    if (typeof localStorage === 'undefined') {
      return false;
    }

    try {
      const key = this.getStorageKey(sessionId);
      localStorage.removeItem(key);

      // Update index
      this.removeFromSessionIndex(sessionId);

      return true;
    } catch (error) {
      console.error('[SessionPersistence] Failed to remove session:', error);
      return false;
    }
  }

  /**
   * Get all stored session IDs
   */
  getAllSessionIds(): string[] {
    if (typeof localStorage === 'undefined') {
      return [];
    }

    try {
      const indexKey = this.getIndexKey();
      const indexData = localStorage.getItem(indexKey);

      if (!indexData) {
        return [];
      }

      const index: SessionIndex = JSON.parse(indexData);
      return Object.keys(index.sessions);
    } catch (error) {
      console.error('[SessionPersistence] Failed to get session IDs:', error);
      return [];
    }
  }

  /**
   * Get the most recent session ID
   */
  getMostRecentSessionId(): string | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const indexKey = this.getIndexKey();
      const indexData = localStorage.getItem(indexKey);

      if (!indexData) {
        return null;
      }

      const index: SessionIndex = JSON.parse(indexData);
      const entries = Object.entries(index.sessions);

      if (entries.length === 0) {
        return null;
      }

      // Sort by lastActivity descending
      entries.sort((a, b) =>
        new Date(b[1].lastActivity).getTime() - new Date(a[1].lastActivity).getTime()
      );

      return entries[0][0];
    } catch (error) {
      console.error('[SessionPersistence] Failed to get recent session:', error);
      return null;
    }
  }

  /**
   * Cleanup sessions older than maxSessionAgeMs
   */
  cleanupStaleSessions(): number {
    if (typeof localStorage === 'undefined') {
      return 0;
    }

    try {
      const indexKey = this.getIndexKey();
      const indexData = localStorage.getItem(indexKey);

      if (!indexData) {
        return 0;
      }

      const index: SessionIndex = JSON.parse(indexData);
      const now = Date.now();
      let removedCount = 0;

      for (const [sessionId, metadata] of Object.entries(index.sessions)) {
        const age = now - new Date(metadata.lastActivity).getTime();

        if (age > this.config.maxSessionAgeMs) {
          this.removeSession(sessionId);
          removedCount++;
        }
      }

      // Also limit total sessions
      const remainingIds = this.getAllSessionIds();
      if (remainingIds.length > this.config.maxSessions) {
        // Get sessions with metadata for sorting
        const sessionsWithMeta: Array<{id: string; lastActivity: Date}> = [];

        for (const id of remainingIds) {
          const loaded = this.loadSession(id);
          if (loaded) {
            sessionsWithMeta.push({
              id,
              lastActivity: loaded.session.lastActivity,
            });
          }
        }

        // Sort by lastActivity ascending (oldest first)
        sessionsWithMeta.sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime());

        // Remove oldest sessions until we're under the limit
        const toRemove = sessionsWithMeta.slice(0, sessionsWithMeta.length - this.config.maxSessions);
        for (const session of toRemove) {
          this.removeSession(session.id);
          removedCount++;
        }
      }

      return removedCount;
    } catch (error) {
      console.error('[SessionPersistence] Failed to cleanup sessions:', error);
      return 0;
    }
  }

  /**
   * Clear all stored sessions
   */
  clearAllSessions(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      const sessionIds = this.getAllSessionIds();

      for (const id of sessionIds) {
        this.removeSession(id);
      }

      // Clear index
      const indexKey = this.getIndexKey();
      localStorage.removeItem(indexKey);
    } catch (error) {
      console.error('[SessionPersistence] Failed to clear sessions:', error);
    }
  }

  /**
   * Update the session index with a session ID
   */
  private updateSessionIndex(sessionId: string, lastActivity: Date): void {
    try {
      const indexKey = this.getIndexKey();
      const indexData = localStorage.getItem(indexKey);

      const index: SessionIndex = indexData
        ? JSON.parse(indexData)
        : { sessions: {} };

      index.sessions[sessionId] = {
        lastActivity: lastActivity.toISOString(),
      };

      localStorage.setItem(indexKey, JSON.stringify(index));
    } catch (error) {
      console.error('[SessionPersistence] Failed to update index:', error);
    }
  }

  /**
   * Remove a session from the index
   */
  private removeFromSessionIndex(sessionId: string): void {
    try {
      const indexKey = this.getIndexKey();
      const indexData = localStorage.getItem(indexKey);

      if (!indexData) {
        return;
      }

      const index: SessionIndex = JSON.parse(indexData);
      delete index.sessions[sessionId];

      localStorage.setItem(indexKey, JSON.stringify(index));
    } catch (error) {
      console.error('[SessionPersistence] Failed to remove from index:', error);
    }
  }

  /**
   * Serialize an action record
   */
  private serializeActionRecord(record: VoiceActionRecord): SerializedActionRecord {
    return {
      id: record.id,
      timestamp: record.timestamp.toISOString(),
      transcription: record.transcription,
      intent: record.intent,
      result: record.result,
      confirmed: record.confirmed,
    };
  }

  /**
   * Deserialize an action record
   */
  private deserializeActionRecord(record: SerializedActionRecord): VoiceActionRecord {
    return {
      id: record.id,
      timestamp: new Date(record.timestamp),
      transcription: record.transcription,
      intent: record.intent,
      result: record.result,
      confirmed: record.confirmed,
    };
  }

  /**
   * Serialize a conversation turn
   */
  private serializeConversationTurn(turn: ConversationTurn): SerializedConversationTurn {
    return {
      text: turn.text,
      intent: turn.intent,
      timestamp: turn.timestamp.toISOString(),
      result: turn.result,
    };
  }
}

/**
 * Session index for tracking all stored sessions
 */
interface SessionIndex {
  sessions: {
    [sessionId: string]: {
      lastActivity: string;
    };
  };
}

/**
 * Create a SessionPersistence instance
 */
export function createSessionPersistence(
  config: Partial<SessionStorageConfig> = {}
): SessionPersistence {
  return new SessionPersistence(config);
}

/**
 * Create a new VoiceSession with a unique ID
 */
export function createVoiceSession(id?: string): VoiceSession {
  const now = new Date();
  return {
    id: id || generateSessionId(),
    state: 'idle',
    startedAt: now,
    lastActivity: now,
    history: [],
  };
}

/**
 * Generate a unique session ID
 */
export function generateSessionId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `voice-${timestamp}-${random}`;
}

/**
 * Check if a session is valid (not expired)
 * @param session The session to check
 * @param maxAgeMs Maximum age in milliseconds (default: 1 hour for restore, 24h for storage)
 */
export function isSessionValid(session: VoiceSession, maxAgeMs: number = 60 * 60 * 1000): boolean {
  const age = Date.now() - session.lastActivity.getTime();
  return age < maxAgeMs;
}

// Export singleton instance
export const sessionPersistence = new SessionPersistence();
