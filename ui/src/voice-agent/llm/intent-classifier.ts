/**
 * Intent Classifier (Two-Stage Hybrid)
 *
 * Stage 1: Quick regex-based intent detection (~1ms)
 * Stage 2: LLM-based entity extraction with JSON schema (~200-300ms)
 *
 * This hybrid approach combines the speed of pattern matching with
 * the accuracy and flexibility of LLM extraction.
 */

import { OllamaClient, createOllamaClient } from "./ollama-client.js";
import { EntityExtractor, createEntityExtractor } from "./entity-extractor.js";
import type { VoiceIntent, VoiceActionType, VoiceAgentConfig } from "../types.js";

/**
 * System prompt for intent classification
 */
const INTENT_CLASSIFICATION_PROMPT = `You are a voice command classifier for a desktop automation system.

Classify the user's voice command into ONE of these action types:
- "claude_code": Ask Claude to help with coding tasks (ask claude, tell claude, claude can you, create/build/implement/add/fix/refactor code, what/how/why/explain code)
- "terminal": Execute shell/terminal commands (npm, git, ls, mkdir, etc.)
- "app_control": Control Mac applications (open, close, switch apps)
- "ralph_command": Execute Ralph CLI commands (ralph prd, ralph build, ralph plan)
- "web_search": Search the web for information
- "file_operation": File system operations (create, delete, move, copy files)
- "unknown": Cannot determine the intent

Respond with ONLY a valid JSON object in this exact format:
{
  "action": "<action_type>",
  "command": "<extracted command or null>",
  "target": "<target app/file/path or null>",
  "parameters": {},
  "confidence": <0.0 to 1.0>,
  "requiresConfirmation": <true/false>
}

Rules:
1. For terminal commands, extract the exact command to run
2. For app_control, extract the app name as "target"
3. For ralph_command, extract the full ralph command
4. Set requiresConfirmation=true for destructive operations (delete, remove, etc.)
5. Be conservative with confidence - if unsure, use lower values
6. For ambiguous commands, prefer "terminal" if it sounds like a CLI command

Examples:
User: "run npm test"
{"action": "terminal", "command": "npm test", "target": null, "parameters": {}, "confidence": 0.95, "requiresConfirmation": false}

User: "open chrome"
{"action": "app_control", "command": "open", "target": "Google Chrome", "parameters": {}, "confidence": 0.9, "requiresConfirmation": false}

User: "create a new PRD for user authentication"
{"action": "ralph_command", "command": "ralph prd \"user authentication\"", "target": null, "parameters": {"description": "user authentication"}, "confidence": 0.85, "requiresConfirmation": false}

User: "delete all node modules"
{"action": "terminal", "command": "rm -rf node_modules", "target": "node_modules", "parameters": {}, "confidence": 0.8, "requiresConfirmation": true}

User: "what's the weather like"
{"action": "web_search", "command": null, "target": null, "parameters": {"query": "weather"}, "confidence": 0.7, "requiresConfirmation": false}`;

/**
 * Intent classification result with metadata
 */
export interface ClassificationResult {
  /** Whether classification succeeded */
  success: boolean;

  /** The extracted intent */
  intent?: VoiceIntent;

  /** Raw LLM response */
  raw?: string;

  /** Error message if failed */
  error?: string;

  /** Classification time in milliseconds */
  duration_ms?: number;
}

/**
 * Intent Classifier class (Two-Stage Hybrid)
 */
export class IntentClassifier {
  private ollamaClient: OllamaClient;
  private entityExtractor: EntityExtractor;
  private model: string;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.ollamaClient = createOllamaClient(config);
    this.entityExtractor = createEntityExtractor(config);
    this.model = config.ollamaModel || "qwen2.5:1.5b";
  }

  /**
   * Classify a voice command into an intent
   */
  async classify(text: string): Promise<ClassificationResult> {
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: "Empty input text",
      };
    }

    const startTime = Date.now();

    try {
      const response = await this.ollamaClient.promptJSON<{
        action: VoiceActionType;
        command?: string;
        target?: string;
        parameters?: Record<string, string>;
        confidence?: number;
        requiresConfirmation?: boolean;
      }>(
        `User command: "${text}"`,
        {
          model: this.model,
          system: INTENT_CLASSIFICATION_PROMPT,
          temperature: 0.1,
          maxTokens: 200,
        }
      );

      const duration_ms = Date.now() - startTime;

      if (!response.success || !response.data) {
        return {
          success: false,
          raw: response.raw,
          error: response.error || "Failed to parse intent",
          duration_ms,
        };
      }

      const data = response.data;

      // Validate action type
      const validActions: VoiceActionType[] = [
        "claude_code",
        "terminal",
        "app_control",
        "ralph_command",
        "web_search",
        "file_operation",
        "unknown",
      ];

      if (!validActions.includes(data.action)) {
        return {
          success: false,
          raw: response.raw,
          error: `Invalid action type: ${data.action}`,
          duration_ms,
        };
      }

      const intent: VoiceIntent = {
        action: data.action,
        command: data.command || undefined,
        target: data.target || undefined,
        parameters: data.parameters || {},
        confidence: Math.min(1, Math.max(0, data.confidence ?? 0.5)),
        originalText: text,
        requiresConfirmation: data.requiresConfirmation ?? false,
      };

      return {
        success: true,
        intent,
        raw: response.raw,
        duration_ms,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Classification failed",
        duration_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * Two-Stage Hybrid Classification (RECOMMENDED)
   *
   * Stage 1: Quick regex-based intent detection (~1ms)
   * Stage 2: LLM-based entity extraction with JSON schema (~200-300ms)
   *
   * This is faster and more accurate than full LLM classification.
   */
  async classifyHybrid(text: string): Promise<ClassificationResult> {
    const startTime = Date.now();
    const lowerText = text.toLowerCase().trim();

    // Stage 1: Quick intent detection via regex
    const stage1Intent = this.detectIntentType(lowerText);
    const stage1Time = Date.now() - startTime;

    // If unknown intent, fall back to full LLM classification
    if (stage1Intent === "unknown") {
      return this.classify(text);
    }

    // Stage 2: Entity extraction via LLM with JSON schema
    const extractionResult = await this.entityExtractor.extract(text, stage1Intent);

    if (!extractionResult.success || !extractionResult.entities) {
      // Fall back to quick classify if extraction fails
      const quickIntent = this.quickClassify(lowerText, text);
      if (quickIntent) {
        return {
          success: true,
          intent: quickIntent,
          duration_ms: Date.now() - startTime,
        };
      }

      return {
        success: false,
        error: extractionResult.error || "Entity extraction failed",
        duration_ms: Date.now() - startTime,
      };
    }

    // Convert extracted entities to VoiceIntent
    const intent = this.buildIntentFromEntities(
      stage1Intent,
      extractionResult.entities,
      text
    );

    return {
      success: true,
      intent,
      raw: extractionResult.raw,
      duration_ms: Date.now() - startTime,
    };
  }

  /**
   * Classify with fallback for common patterns
   *
   * Uses regex patterns for quick classification of common commands
   * before falling back to LLM classification.
   *
   * @deprecated Use classifyHybrid() instead for better performance
   */
  async classifyWithFallback(text: string): Promise<ClassificationResult> {
    return this.classifyHybrid(text);
  }

  /**
   * Stage 1: Detect intent type using regex patterns (fast ~1ms)
   */
  private detectIntentType(lowerText: string): VoiceActionType {
    // Terminal commands - npm
    if (lowerText.match(/^(run\s+)?npm\s+(test|install|build|start|run\s+\w+)/)) {
      return "terminal";
    }

    // Terminal commands - git
    if (lowerText.match(/^(run\s+)?git\s+(status|log|diff|add|commit|push|pull|checkout|branch)/)) {
      return "terminal";
    }

    // Terminal commands - ls, cd, pwd
    if (lowerText.match(/^(list\s+(files|directory)|ls\b|show\s+files)/)) {
      return "terminal";
    }

    // Ralph commands - Status queries
    if (lowerText.match(/^(what'?s?\s+the\s+status|show\s+(me\s+)?(the\s+)?status|check\s+status|status\s+of)/)) {
      return "ralph_command";
    }

    // Ralph commands - Story queries
    if (lowerText.match(/^(how\s+many\s+stories|what\s+stories|stories\s+(left|remaining|completed))/)) {
      return "ralph_command";
    }

    // Ralph commands - Progress queries
    if (lowerText.match(/^(show\s+(me\s+)?(the\s+)?progress|what'?s?\s+(the\s+)?progress|overall\s+progress)/)) {
      return "ralph_command";
    }

    // Ralph commands - PRD
    if (lowerText.match(/^(ralph\s+prd|create\s+(a\s+)?(new\s+)?prd|generate\s+(a\s+)?prd|write\s+(a\s+)?prd)/)) {
      return "ralph_command";
    }

    // Ralph commands - Plan
    if (lowerText.match(/^(ralph\s+plan|create\s+(a\s+)?plan|generate\s+(a\s+)?plan)/)) {
      return "ralph_command";
    }

    // Ralph commands - Build
    if (lowerText.match(/^(ralph\s+build|run\s+(ralph\s+)?build|execute\s+build)/)) {
      return "ralph_command";
    }

    // Ralph commands - Stream
    if (lowerText.match(/^ralph\s+stream/)) {
      return "ralph_command";
    }

    // Ralph commands - Factory
    if (lowerText.match(/^ralph\s+factory/)) {
      return "ralph_command";
    }

    // Window management
    if (lowerText.match(/^(snap|tile|move)\s+(window\s+)?(to\s+)?(left|right|top|bottom)/)) {
      return "app_control";
    }

    if (lowerText.match(/^(center|centre)\s+(the\s+)?window/)) {
      return "app_control";
    }

    if (lowerText.match(/^move\s+to\s+(next|other)\s+display/)) {
      return "app_control";
    }

    // Browser control
    if (lowerText.match(/^(open|go\s+to|navigate\s+to)\s+[\w.-]+\.[\w]+/)) {
      return "app_control"; // URLs
    }

    if (lowerText.match(/^(new\s+tab|close\s+tab|refresh|reload|go\s+back|go\s+forward)/)) {
      return "app_control";
    }

    // Clipboard
    if (lowerText.match(/^(copy|paste|select\s+all|what'?s?\s+on\s+(the\s+)?clipboard)/)) {
      return "app_control";
    }

    // Finder
    if (lowerText.match(/^(open|go\s+to)\s+(documents|desktop|downloads|pictures|home|music|movies)/)) {
      return "app_control";
    }

    if (lowerText.match(/^(new\s+finder\s+window|finder)/)) {
      return "app_control";
    }

    // VS Code / Cursor
    if (lowerText.match(/^(command\s+palette|go\s+to\s+line|open\s+file)/)) {
      return "app_control";
    }

    // Terminal
    if (lowerText.match(/^(clear|cls|clean)\s+(terminal|screen|console)/)) {
      return "app_control";
    }

    if (lowerText.match(/^(delete|remove)\s+(this\s+)?(line|word)/)) {
      return "app_control";
    }

    // Communication
    if (lowerText.match(/^(send|text|message)\s+/)) {
      return "app_control";
    }

    if (lowerText.match(/^(send\s+)?email\s+/)) {
      return "app_control";
    }

    if (lowerText.match(/^(create|add|schedule)\s+(event|meeting|appointment)/)) {
      return "app_control";
    }

    if (lowerText.match(/^(create|add|set)\s+reminder/)) {
      return "app_control";
    }

    // App control - open/launch/start
    if (lowerText.match(/^(open|launch|start)\s+(.+)/)) {
      return "app_control";
    }

    // App control - close/quit/exit
    if (lowerText.match(/^(close|quit|exit)\s+(.+)/)) {
      return "app_control";
    }

    // App control - hide
    if (lowerText.match(/^hide\s+(.+)/)) {
      return "app_control";
    }

    // App control - minimize
    if (lowerText.match(/^minimize\s+(.+)/)) {
      return "app_control";
    }

    // App control - switch to
    if (lowerText.match(/^switch\s+to\s+(.+)/)) {
      return "app_control";
    }

    // Media control - play/pause/stop/next/previous
    if (lowerText.match(/^(play|pause|stop|resume)\s*(music|spotify|song)?$/)) {
      return "app_control";
    }

    if (lowerText.match(/^(next|skip)\s*(track|song)?$/)) {
      return "app_control";
    }

    if (lowerText.match(/^(previous|back)\s*(track|song)?$/)) {
      return "app_control";
    }

    // Volume control
    if (lowerText.match(/^(volume\s+up|turn\s+up|louder)$/)) {
      return "app_control";
    }

    if (lowerText.match(/^(volume\s+down|turn\s+down|quieter|softer)$/)) {
      return "app_control";
    }

    if (lowerText.match(/^mute$/)) {
      return "app_control";
    }

    // Web search
    if (lowerText.match(/^(search|google|look\s+up|find\s+information)\s+(.+)/)) {
      return "web_search";
    }

    // File operations
    if (lowerText.match(/^(create|make|new)\s+(file|folder|directory)/)) {
      return "file_operation";
    }

    if (lowerText.match(/^(delete|remove|rm)\s+/)) {
      return "file_operation";
    }

    if (lowerText.match(/^(move|mv|copy|cp)\s+/)) {
      return "file_operation";
    }

    // Claude Code - explicit requests to Claude
    if (lowerText.match(/^(ask|tell)\s+claude/i)) {
      return "claude_code";
    }

    if (lowerText.match(/^claude[,.]?\s+(can\s+you|please|help|what|how|why)/i)) {
      return "claude_code";
    }

    // Claude Code - coding tasks (create/build/implement/add/fix/refactor)
    if (lowerText.match(/^(create|write|build|implement|add|fix|refactor|update|modify|change)\s+(a\s+)?(function|class|component|module|file|test|code|method|api|endpoint|feature)/i)) {
      return "claude_code";
    }

    // Claude Code - explanation requests about code
    if (lowerText.match(/^(what|how|why|explain|describe|show\s+me)\s+(does|is|are|the|this|that)/i)) {
      return "claude_code";
    }

    // Claude Code - follow-up commands
    if (lowerText.match(/^(now|then|also|next|and)\s+(fix|update|add|change|commit|push)/i)) {
      return "claude_code";
    }

    // Claude Code - do it again / fix it patterns
    if (lowerText.match(/^(fix\s+it|do\s+(that|it)\s+again|undo\s+that|revert\s+that)/i)) {
      return "claude_code";
    }

    // Default to unknown for LLM fallback
    return "unknown";
  }

  /**
   * Build VoiceIntent from extracted entities
   */
  private buildIntentFromEntities(
    actionType: VoiceActionType,
    entities: any,
    originalText: string
  ): VoiceIntent {
    const baseIntent: VoiceIntent = {
      action: actionType,
      confidence: 0.9, // High confidence from hybrid approach
      originalText,
      requiresConfirmation: false,
    };

    switch (actionType) {
      case "app_control":
        return {
          ...baseIntent,
          command: entities.action,
          target: entities.appName,
          parameters: { action: entities.action },
        };

      case "terminal":
        return {
          ...baseIntent,
          command: entities.command,
          requiresConfirmation: entities.command?.includes("rm -rf") || false,
        };

      case "ralph_command":
        return {
          ...baseIntent,
          command: this.buildRalphCommand(entities),
          parameters: {
            command: entities.ralphCommand,
            ...(entities.prdNumber && { prdNumber: entities.prdNumber }),
            ...(entities.iterations && { iterations: entities.iterations }),
            ...(entities.description && { description: entities.description }),
            ...(entities.model && { model: entities.model }),
            ...(entities.queryType && { queryType: entities.queryType }),
            ...(entities.streamIds && { streamIds: entities.streamIds.join(',') }),
            ...(entities.parallel && { parallel: 'true' }),
            ...(entities.ambiguous && { ambiguous: 'true' }),
            ...(entities.needsContext && { needsContext: 'true' }),
          },
        };

      case "web_search":
        return {
          ...baseIntent,
          parameters: { query: entities.query },
        };

      case "file_operation":
        return {
          ...baseIntent,
          command: entities.action,
          target: entities.path,
          parameters: { ...entities.extra },
          requiresConfirmation: entities.action === "delete" || entities.action === "remove",
        };

      default:
        return baseIntent;
    }
  }

  /**
   * Build Ralph CLI command from extracted entities
   */
  private buildRalphCommand(entities: any): string {
    const cmd = entities.ralphCommand || "prd";

    // Handle status queries (not an actual CLI command, but a query)
    if (cmd === "status") {
      let command = "ralph stream status";
      if (entities.prdNumber) {
        command = `ralph stream status ${entities.prdNumber}`;
      }
      return command;
    }

    let command = `ralph ${cmd}`;

    if (cmd === "prd" && entities.description) {
      command += ` "${entities.description}"`;
    } else if (cmd === "build") {
      const iterations = entities.iterations || "1";
      command += ` ${iterations}`;
      if (entities.prdNumber) {
        command += ` --prd=${entities.prdNumber}`;
      }
      if (entities.model) {
        command += ` --model=${entities.model}`;
      }
    } else if (cmd === "plan" && entities.prdNumber) {
      command += ` --prd=${entities.prdNumber}`;
    } else if (cmd === "factory" && entities.description) {
      command += ` run ${entities.description}`;
    } else if (cmd === "stream") {
      if (entities.streamIds && Array.isArray(entities.streamIds)) {
        if (entities.parallel) {
          // For parallel streams, output as separate commands
          command = entities.streamIds.map((id: string) => `ralph stream build ${id}`).join(' & ');
        } else {
          command += ` build ${entities.streamIds[0]}`;
        }
      } else if (entities.extra?.subcommand) {
        command += ` ${entities.extra.subcommand}`;
      } else {
        command += " status";
      }
    }

    return command;
  }

  /**
   * Quick pattern-based classification for common commands
   */
  private quickClassify(lowerText: string, originalText: string): VoiceIntent | null {
    // Terminal commands - npm
    if (lowerText.match(/^(run\s+)?npm\s+(test|install|build|start|run\s+\w+)/)) {
      const npmMatch = lowerText.match(/npm\s+(.+)/);
      return {
        action: "terminal",
        command: npmMatch ? `npm ${npmMatch[1]}` : "npm",
        confidence: 0.95,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Terminal commands - git
    if (lowerText.match(/^(run\s+)?git\s+(status|log|diff|add|commit|push|pull|checkout|branch)/)) {
      const gitMatch = lowerText.match(/git\s+(.+)/);
      return {
        action: "terminal",
        command: gitMatch ? `git ${gitMatch[1]}` : "git status",
        confidence: 0.95,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Terminal commands - ls, cd, pwd
    if (lowerText.match(/^(list\s+(files|directory)|ls\b|show\s+files)/)) {
      return {
        action: "terminal",
        command: "ls -la",
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Status queries
    if (lowerText.match(/^(what'?s?\s+the\s+status|show\s+(me\s+)?(the\s+)?status|check\s+status|status\s+of)/)) {
      const prdMatch = lowerText.match(/prd[- ]?(\d+)/i);
      return {
        action: "ralph_command",
        command: prdMatch ? `ralph stream status ${prdMatch[1]}` : "ralph stream status",
        parameters: {
          command: "status",
          queryType: "prd",
          ...(prdMatch && { prdNumber: prdMatch[1] }),
        },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Story queries
    if (lowerText.match(/^(how\s+many\s+stories|what\s+stories|stories\s+(left|remaining|completed))/)) {
      const prdMatch = lowerText.match(/prd[- ]?(\d+)/i);
      return {
        action: "ralph_command",
        command: "ralph stream status",
        parameters: {
          command: "status",
          queryType: "stories",
          ...(prdMatch && { prdNumber: prdMatch[1] }),
        },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Progress queries
    if (lowerText.match(/^(show\s+(me\s+)?(the\s+)?progress|what'?s?\s+(the\s+)?progress|overall\s+progress)/)) {
      return {
        action: "ralph_command",
        command: "ralph stream status",
        parameters: { command: "status", queryType: "overall" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - PRD
    if (lowerText.match(/^(ralph\s+prd|create\s+(a\s+)?(new\s+)?prd|generate\s+(a\s+)?prd|write\s+(a\s+)?prd)/)) {
      const descMatch = originalText.match(/(?:prd|requirement)[s]?\s+(?:for\s+)?["']?(.+?)["']?$/i);
      return {
        action: "ralph_command",
        command: descMatch ? `ralph prd "${descMatch[1]}"` : "ralph prd",
        parameters: descMatch ? { description: descMatch[1], command: "prd" } : { command: "prd" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Plan
    if (lowerText.match(/^(ralph\s+plan|create\s+(a\s+)?plan|generate\s+(a\s+)?plan)/)) {
      const prdMatch = lowerText.match(/prd[- ]?(\d+)/i);
      const prdNum = prdMatch ? prdMatch[1] : undefined;
      return {
        action: "ralph_command",
        command: prdNum ? `ralph plan --prd=${prdNum}` : "ralph plan",
        parameters: { command: "plan", ...(prdNum && { prdNumber: prdNum }) },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Build
    if (lowerText.match(/^(ralph\s+build|run\s+(ralph\s+)?build|execute\s+build)/)) {
      const iterMatch = lowerText.match(/(\d+)\s*(?:iteration|time|round|build)?/);
      const iterations = iterMatch ? iterMatch[1] : "1";
      const prdMatch = lowerText.match(/prd[- ]?(\d+)/i);
      let cmd = `ralph build ${iterations}`;
      if (prdMatch) {
        cmd += ` --prd=${prdMatch[1]}`;
      }
      return {
        action: "ralph_command",
        command: cmd,
        parameters: { command: "build", iterations, ...(prdMatch && { prdNumber: prdMatch[1] }) },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Stream
    if (lowerText.match(/^ralph\s+stream/)) {
      return {
        action: "ralph_command",
        command: originalText.replace(/^run\s+/i, ""),
        parameters: { command: "stream" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Ralph commands - Factory
    if (lowerText.match(/^ralph\s+factory/)) {
      return {
        action: "ralph_command",
        command: originalText.replace(/^run\s+/i, ""),
        parameters: { command: "factory" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // App control - open/launch/start (extract just the app name, stop at "and", "then", etc.)
    if (lowerText.match(/^(open|launch|start)\s+(.+)/)) {
      const appMatch = originalText.match(/(?:open|launch|start)\s+([a-zA-Z0-9\s]+?)(?:\s+and\s+|\s+then\s+|[.,!?]|$)/i);
      const rawAppName = appMatch?.[1]?.trim() || "";
      const appName = this.normalizeAppName(rawAppName);
      return {
        action: "app_control",
        command: "open",
        target: appName,
        parameters: { action: "open" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // App control - close/quit/exit
    if (lowerText.match(/^(close|quit|exit)\s+(.+)/)) {
      const appMatch = originalText.match(/(?:close|quit|exit)\s+([a-zA-Z0-9\s]+?)(?:\s+and\s+|\s+then\s+|[.,!?]|$)/i);
      const rawAppName = appMatch?.[1]?.trim() || "";
      const appName = this.normalizeAppName(rawAppName);
      return {
        action: "app_control",
        command: "quit",
        target: appName,
        parameters: { action: "quit" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // App control - hide
    if (lowerText.match(/^hide\s+(.+)/)) {
      const appMatch = originalText.match(/hide\s+([a-zA-Z0-9\s]+?)(?:\s+and\s+|\s+then\s+|[.,!?]|$)/i);
      const rawAppName = appMatch?.[1]?.trim() || "";
      const appName = this.normalizeAppName(rawAppName);
      return {
        action: "app_control",
        command: "hide",
        target: appName,
        parameters: { action: "hide" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // App control - minimize
    if (lowerText.match(/^minimize\s+(.+)/)) {
      const appMatch = originalText.match(/minimize\s+([a-zA-Z0-9\s]+?)(?:\s+and\s+|\s+then\s+|[.,!?]|$)/i);
      const rawAppName = appMatch?.[1]?.trim() || "";
      const appName = this.normalizeAppName(rawAppName);
      return {
        action: "app_control",
        command: "minimize",
        target: appName,
        parameters: { action: "minimize" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // App control - switch to
    if (lowerText.match(/^switch\s+to\s+(.+)/)) {
      const appMatch = originalText.match(/switch\s+to\s+([a-zA-Z0-9\s]+?)(?:\s+and\s+|\s+then\s+|[.,!?]|$)/i);
      const rawAppName = appMatch?.[1]?.trim() || "";
      const appName = this.normalizeAppName(rawAppName);
      return {
        action: "app_control",
        command: "activate",
        target: appName,
        parameters: { action: "activate" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Media control - play/pause/stop/next/previous
    if (lowerText.match(/^(play|pause|stop|resume)\s*(music|spotify|song)?$/)) {
      const action = lowerText.match(/^(play|pause|stop|resume)/)?.[1] || "play";
      const normalizedAction = action === "resume" ? "play" : action;
      return {
        action: "app_control",
        command: normalizedAction,
        target: "Music",
        parameters: { action: normalizedAction },
        confidence: 0.85,
        originalText,
        requiresConfirmation: false,
      };
    }

    if (lowerText.match(/^(next|skip)\s*(track|song)?$/)) {
      return {
        action: "app_control",
        command: "next",
        target: "Music",
        parameters: { action: "next" },
        confidence: 0.85,
        originalText,
        requiresConfirmation: false,
      };
    }

    if (lowerText.match(/^(previous|back)\s*(track|song)?$/)) {
      return {
        action: "app_control",
        command: "previous",
        target: "Music",
        parameters: { action: "previous" },
        confidence: 0.85,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Volume control
    if (lowerText.match(/^(volume\s+up|turn\s+up|louder)$/)) {
      return {
        action: "app_control",
        command: "volume_up",
        target: "System",
        parameters: { action: "volume_up" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    if (lowerText.match(/^(volume\s+down|turn\s+down|quieter|softer)$/)) {
      return {
        action: "app_control",
        command: "volume_down",
        target: "System",
        parameters: { action: "volume_down" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    if (lowerText.match(/^mute$/)) {
      return {
        action: "app_control",
        command: "mute",
        target: "System",
        parameters: { action: "mute" },
        confidence: 0.9,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Web search
    if (lowerText.match(/^(search|google|look\s+up|find\s+information)\s+(.+)/)) {
      const queryMatch = originalText.match(/(?:search|google|look\s+up|find\s+information)\s+(?:for\s+)?(.+)/i);
      const query = queryMatch?.[1] || originalText;
      return {
        action: "web_search",
        parameters: { query },
        confidence: 0.85,
        originalText,
        requiresConfirmation: false,
      };
    }

    // Dangerous commands requiring confirmation
    if (lowerText.match(/\b(rm\s+-rf|delete|remove)\s+/)) {
      return {
        action: "terminal",
        command: originalText.replace(/^(run\s+)?/i, ""),
        confidence: 0.7,
        originalText,
        requiresConfirmation: true,
      };
    }

    return null;
  }

  /**
   * Normalize app names to their proper application bundle names
   */
  private normalizeAppName(name: string): string {
    const appNameMap: Record<string, string> = {
      chrome: "Google Chrome",
      "google chrome": "Google Chrome",
      firefox: "Firefox",
      safari: "Safari",
      slack: "Slack",
      discord: "Discord",
      spotify: "Spotify",
      vscode: "Visual Studio Code",
      "vs code": "Visual Studio Code",
      "visual studio code": "Visual Studio Code",
      code: "Visual Studio Code",
      terminal: "Terminal",
      iterm: "iTerm",
      finder: "Finder",
      notes: "Notes",
      mail: "Mail",
      messages: "Messages",
      calendar: "Calendar",
      music: "Music",
      "apple music": "Music",
    };

    const lowerName = name.toLowerCase().trim();
    return appNameMap[lowerName] || name;
  }

  /**
   * Check if the Ollama model is available
   */
  async checkModel(): Promise<{ available: boolean; error?: string }> {
    const hasModel = await this.ollamaClient.hasModel(this.model);
    if (!hasModel) {
      return {
        available: false,
        error: `Model "${this.model}" not found. Run: ollama pull ${this.model}`,
      };
    }
    return { available: true };
  }

  /**
   * Update the model to use
   */
  setModel(model: string): void {
    this.model = model;
    this.ollamaClient.setDefaultModel(model);
    this.entityExtractor.setModel(model);
  }
}

/**
 * Create an IntentClassifier instance
 */
export function createIntentClassifier(
  config: Partial<VoiceAgentConfig> = {}
): IntentClassifier {
  return new IntentClassifier(config);
}

// Export singleton instance
export const intentClassifier = new IntentClassifier();
