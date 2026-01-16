/**
 * Entity Extractor
 *
 * Uses local LLM (Ollama) with structured JSON output to extract
 * entities from voice commands. Part of the two-stage hybrid approach:
 * Stage 1: Quick regex detection of intent type
 * Stage 2: LLM-based entity extraction (this module)
 */

import { OllamaClient, createOllamaClient } from "./ollama-client.js";
import type { VoiceActionType, VoiceAgentConfig } from "../types.js";

/**
 * Extracted entities from a voice command
 */
export interface ExtractedEntities {
  /** Target application name (for app_control) */
  appName?: string;

  /** Action to perform (open, close, play, pause, etc.) */
  action?: string;

  /** Command to execute (for terminal) */
  command?: string;

  /** Search query (for web_search) */
  query?: string;

  /** File or directory path (for file_operation) */
  path?: string;

  /** Ralph command type (prd, plan, build, etc.) */
  ralphCommand?: string;

  /** PRD number */
  prdNumber?: string;

  /** Number of iterations (for build) */
  iterations?: string;

  /** Description (for PRD creation) */
  description?: string;

  /** Additional parameters */
  extra?: Record<string, string>;
}

/**
 * Entity extraction result
 */
export interface ExtractionResult {
  success: boolean;
  entities?: ExtractedEntities;
  raw?: string;
  error?: string;
  duration_ms?: number;
}

/**
 * Few-shot examples for each intent type
 */
const FEW_SHOT_EXAMPLES: Record<VoiceActionType, string> = {
  app_control: `Examples:
User: "open chrome"
{"appName": "Google Chrome", "action": "open"}

User: "launch spotify and play some music"
{"appName": "Spotify", "action": "open"}

User: "close safari"
{"appName": "Safari", "action": "close"}

User: "play music"
{"appName": "Music", "action": "play"}

User: "pause spotify"
{"appName": "Spotify", "action": "pause"}

User: "quit visual studio code"
{"appName": "Visual Studio Code", "action": "quit"}`,

  terminal: `Examples:
User: "run npm test"
{"command": "npm test"}

User: "execute git status"
{"command": "git status"}

User: "list all files in the current directory"
{"command": "ls -la"}

User: "show me the git log"
{"command": "git log"}

User: "install lodash package"
{"command": "npm install lodash"}`,

  ralph_command: `Examples:
User: "create a PRD for user authentication"
{"ralphCommand": "prd", "description": "user authentication"}

User: "generate a plan for PRD 3"
{"ralphCommand": "plan", "prdNumber": "3"}

User: "run ralph build 5 iterations"
{"ralphCommand": "build", "iterations": "5"}

User: "ralph build 3 for PRD 2"
{"ralphCommand": "build", "iterations": "3", "prdNumber": "2"}

User: "start the factory my-factory"
{"ralphCommand": "factory", "description": "my-factory"}`,

  web_search: `Examples:
User: "search for typescript best practices"
{"query": "typescript best practices"}

User: "google how to center a div"
{"query": "how to center a div"}

User: "look up the weather in San Francisco"
{"query": "weather in San Francisco"}`,

  file_operation: `Examples:
User: "create a new file called index.ts"
{"action": "create", "path": "index.ts"}

User: "delete the temp folder"
{"action": "delete", "path": "temp"}

User: "move config.json to the backup folder"
{"action": "move", "path": "config.json", "extra": {"destination": "backup"}}`,

  unknown: ``,
};

/**
 * System prompts for entity extraction by intent type
 */
const EXTRACTION_PROMPTS: Record<VoiceActionType, string> = {
  app_control: `You are an entity extractor for macOS app control commands.
Extract ONLY the application name and action from the user's command.

IMPORTANT RULES:
1. Extract ONLY the app name - ignore everything after "and", "then", or punctuation
2. Normalize common app names (chrome → Google Chrome, vscode → Visual Studio Code)
3. For media commands (play, pause, stop), default to "Music" app if no app specified
4. Action should be one of: open, close, quit, play, pause, stop, next, previous, hide, minimize

Respond with ONLY a JSON object. No explanation.`,

  terminal: `You are an entity extractor for terminal/shell commands.
Extract the shell command to execute from the user's voice command.

IMPORTANT RULES:
1. Convert natural language to actual shell commands
2. "list files" → "ls -la"
3. "show git history" → "git log"
4. Keep the command safe - no sudo or destructive commands unless explicit

Respond with ONLY a JSON object. No explanation.`,

  ralph_command: `You are an entity extractor for Ralph CLI commands.
Extract the Ralph command details from the user's voice command.

IMPORTANT RULES:
1. ralphCommand should be one of: prd, plan, build, stream, factory
2. Extract PRD numbers if mentioned (e.g., "PRD 3" → prdNumber: "3")
3. Extract iteration counts for build (e.g., "5 iterations" → iterations: "5")
4. Extract descriptions for PRD creation

Respond with ONLY a JSON object. No explanation.`,

  web_search: `You are an entity extractor for web search queries.
Extract the search query from the user's voice command.

IMPORTANT RULES:
1. Remove filler words like "search for", "google", "look up"
2. Keep the actual search query intact

Respond with ONLY a JSON object. No explanation.`,

  file_operation: `You are an entity extractor for file system operations.
Extract the file operation details from the user's voice command.

IMPORTANT RULES:
1. action should be one of: create, delete, move, copy, rename
2. Extract file/folder paths
3. For move/copy, extract both source and destination

Respond with ONLY a JSON object. No explanation.`,

  unknown: `Extract any relevant information from this command.
Respond with ONLY a JSON object. No explanation.`,
};

/**
 * Entity Extractor class
 */
export class EntityExtractor {
  private ollamaClient: OllamaClient;
  private model: string;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.ollamaClient = createOllamaClient(config);
    this.model = config.ollamaModel || "qwen2.5:1.5b";
  }

  /**
   * Extract entities from a voice command based on the detected intent type
   */
  async extract(
    text: string,
    intentType: VoiceActionType
  ): Promise<ExtractionResult> {
    if (!text || text.trim().length === 0) {
      return {
        success: false,
        error: "Empty input text",
      };
    }

    const startTime = Date.now();

    try {
      const systemPrompt = this.buildPrompt(intentType);

      const response = await this.ollamaClient.promptJSON<ExtractedEntities>(
        `User command: "${text}"`,
        {
          model: this.model,
          system: systemPrompt,
          temperature: 0.1, // Low temperature for consistent extraction
          maxTokens: 150,
          format: "json",
        }
      );

      const duration_ms = Date.now() - startTime;

      if (!response.success || !response.data) {
        return {
          success: false,
          raw: response.raw,
          error: response.error || "Failed to extract entities",
          duration_ms,
        };
      }

      // Post-process and validate the extracted entities
      const entities = this.postProcess(response.data, intentType);

      return {
        success: true,
        entities,
        raw: response.raw,
        duration_ms,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Extraction failed",
        duration_ms: Date.now() - startTime,
      };
    }
  }

  /**
   * Build the full prompt with system instructions and few-shot examples
   */
  private buildPrompt(intentType: VoiceActionType): string {
    const systemPrompt = EXTRACTION_PROMPTS[intentType] || EXTRACTION_PROMPTS.unknown;
    const examples = FEW_SHOT_EXAMPLES[intentType] || "";

    if (examples) {
      return `${systemPrompt}\n\n${examples}`;
    }
    return systemPrompt;
  }

  /**
   * Post-process extracted entities to normalize and validate
   */
  private postProcess(
    entities: ExtractedEntities,
    intentType: VoiceActionType
  ): ExtractedEntities {
    const processed = { ...entities };

    // Normalize app names for app_control
    if (intentType === "app_control" && processed.appName) {
      processed.appName = this.normalizeAppName(processed.appName);
    }

    // Normalize actions
    if (processed.action) {
      processed.action = processed.action.toLowerCase().trim();
      // Map common variations
      const actionMap: Record<string, string> = {
        launch: "open",
        start: "open",
        exit: "quit",
        kill: "quit",
        resume: "play",
        skip: "next",
        back: "previous",
      };
      processed.action = actionMap[processed.action] || processed.action;
    }

    return processed;
  }

  /**
   * Normalize application names to their proper macOS names
   */
  private normalizeAppName(name: string): string {
    const appNameMap: Record<string, string> = {
      // Browsers
      chrome: "Google Chrome",
      "google chrome": "Google Chrome",
      firefox: "Firefox",
      safari: "Safari",
      edge: "Microsoft Edge",
      arc: "Arc",

      // Media
      spotify: "Spotify",
      music: "Music",
      "apple music": "Music",
      itunes: "Music",
      vlc: "VLC",

      // Productivity
      slack: "Slack",
      discord: "Discord",
      zoom: "zoom.us",
      teams: "Microsoft Teams",

      // Development
      vscode: "Visual Studio Code",
      "vs code": "Visual Studio Code",
      "visual studio code": "Visual Studio Code",
      code: "Visual Studio Code",
      terminal: "Terminal",
      iterm: "iTerm",
      iterm2: "iTerm",
      xcode: "Xcode",
      cursor: "Cursor",

      // System
      finder: "Finder",
      notes: "Notes",
      mail: "Mail",
      messages: "Messages",
      calendar: "Calendar",
      reminders: "Reminders",
      photos: "Photos",
      preview: "Preview",
      "system preferences": "System Preferences",
      "system settings": "System Settings",
      settings: "System Settings",
    };

    const lowerName = name.toLowerCase().trim();
    return appNameMap[lowerName] || name;
  }

  /**
   * Update the model to use
   */
  setModel(model: string): void {
    this.model = model;
    this.ollamaClient.setDefaultModel(model);
  }
}

/**
 * Create an EntityExtractor instance
 */
export function createEntityExtractor(
  config: Partial<VoiceAgentConfig> = {}
): EntityExtractor {
  return new EntityExtractor(config);
}

// Export singleton instance
export const entityExtractor = new EntityExtractor();
