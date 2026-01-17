/**
 * Ollama LLM Client
 *
 * HTTP client for communicating with the local Ollama server.
 * Used for intent classification and natural language understanding.
 */

import type { LLMServerStatus, VoiceAgentConfig } from "../types.js";
import {
  withTimeout,
  SERVICE_TIMEOUTS,
  TimeoutError,
  isTimeoutError,
  formatTimeoutMessage,
} from "../utils/retry.js";

/**
 * Ollama chat message format
 */
export interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Ollama chat request options
 */
export interface OllamaChatOptions {
  /** Model to use (e.g., "qwen2.5") */
  model?: string;

  /** System prompt */
  system?: string;

  /** Temperature (0-1) for randomness */
  temperature?: number;

  /** Maximum tokens to generate */
  maxTokens?: number;

  /** Whether to stream the response */
  stream?: boolean;

  /** Format: "json" for JSON mode */
  format?: "json" | string;

  /** Stop sequences */
  stop?: string[];

  /** Timeout in milliseconds (default: 10s for intent classification) */
  timeoutMs?: number;
}

/**
 * Ollama chat response
 */
export interface OllamaChatResponse {
  /** Whether the request succeeded */
  success: boolean;

  /** Generated text */
  text?: string;

  /** Model used */
  model?: string;

  /** Token counts */
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };

  /** Response time in milliseconds */
  duration_ms?: number;

  /** Error message if failed */
  error?: string;

  /** Whether the error was a timeout */
  isTimeout?: boolean;
}

/**
 * Callback type for timeout events
 */
export type OllamaTimeoutCallback = (timeoutMs: number, message: string) => void;

/**
 * Ollama model info
 */
export interface OllamaModel {
  name: string;
  modified_at: string;
  size: number;
  digest: string;
}

/**
 * Client for the Ollama LLM server
 */
export class OllamaClient {
  private baseUrl: string;
  private defaultModel: string;
  private timeoutMs: number;
  private onTimeoutCallback?: OllamaTimeoutCallback;

  constructor(config: Partial<VoiceAgentConfig> = {}) {
    this.baseUrl = config.ollamaUrl || "http://localhost:11434";
    this.defaultModel = config.ollamaModel || "qwen2.5:1.5b";
    this.timeoutMs = SERVICE_TIMEOUTS.INTENT; // 10s default for intent classification
  }

  /**
   * Set callback for timeout events (for UI updates)
   */
  setTimeoutCallback(callback: OllamaTimeoutCallback): void {
    this.onTimeoutCallback = callback;
  }

  /**
   * Set the timeout for LLM operations (in milliseconds)
   * Default: 10000ms (10 seconds)
   */
  setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  /**
   * Get the current timeout setting (in milliseconds)
   */
  getTimeoutMs(): number {
    return this.timeoutMs;
  }

  /**
   * Check if the Ollama server is healthy
   */
  async checkHealth(): Promise<LLMServerStatus> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return {
          healthy: false,
          model: this.defaultModel,
          url: this.baseUrl,
        };
      }

      return {
        healthy: true,
        model: this.defaultModel,
        url: this.baseUrl,
      };
    } catch {
      return {
        healthy: false,
        model: this.defaultModel,
        url: this.baseUrl,
      };
    }
  }

  /**
   * List available models
   */
  async listModels(): Promise<OllamaModel[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { models?: OllamaModel[] };
      return data.models || [];
    } catch {
      return [];
    }
  }

  /**
   * Check if a specific model is available
   */
  async hasModel(modelName: string): Promise<boolean> {
    const models = await this.listModels();
    return models.some(
      (m) => m.name === modelName || m.name.startsWith(`${modelName}:`)
    );
  }

  /**
   * Send a chat completion request
   */
  async chat(
    messages: OllamaChatMessage[],
    options: OllamaChatOptions = {}
  ): Promise<OllamaChatResponse> {
    const startTime = Date.now();
    const model = options.model || this.defaultModel;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    try {
      const requestBody: Record<string, unknown> = {
        model,
        messages,
        stream: false,
        options: {
          temperature: options.temperature ?? 0.1,
          num_predict: options.maxTokens ?? 500,
        },
      };

      // Add JSON format if requested
      if (options.format === "json") {
        requestBody.format = "json";
      }

      // Add stop sequences if provided
      if (options.stop && options.stop.length > 0) {
        (requestBody.options as Record<string, unknown>).stop = options.stop;
      }

      // Wrap fetch in timeout
      const fetchPromise = async () => {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
        }

        return await response.json() as {
          message?: { content?: string };
          model?: string;
          prompt_eval_count?: number;
          eval_count?: number;
        };
      };

      const data = await withTimeout(fetchPromise, timeoutMs, 'Intent classification');
      const duration_ms = Date.now() - startTime;

      return {
        success: true,
        text: data.message?.content || "",
        model: data.model || model,
        tokens: {
          prompt: data.prompt_eval_count || 0,
          completion: data.eval_count || 0,
          total: (data.prompt_eval_count || 0) + (data.eval_count || 0),
        },
        duration_ms,
      };
    } catch (error) {
      // Handle timeout errors specifically
      if (isTimeoutError(error)) {
        const message = formatTimeoutMessage('Intent classification', error.timeoutMs);
        console.warn(`[OllamaClient] ${message}`);
        if (this.onTimeoutCallback) {
          this.onTimeoutCallback(error.timeoutMs, message);
        }
        return {
          success: false,
          error: message,
          isTimeout: true,
        };
      }

      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Ollama request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Send a single prompt and get a response
   */
  async prompt(
    prompt: string,
    options: OllamaChatOptions = {}
  ): Promise<OllamaChatResponse> {
    const messages: OllamaChatMessage[] = [];

    if (options.system) {
      messages.push({
        role: "system",
        content: options.system,
      });
    }

    messages.push({
      role: "user",
      content: prompt,
    });

    return this.chat(messages, options);
  }

  /**
   * Send a prompt and parse the response as JSON
   */
  async promptJSON<T = unknown>(
    prompt: string,
    options: OllamaChatOptions = {}
  ): Promise<{
    success: boolean;
    data?: T;
    raw?: string;
    error?: string;
    duration_ms?: number;
  }> {
    const response = await this.prompt(prompt, {
      ...options,
      format: "json",
    });

    if (!response.success) {
      return {
        success: false,
        error: response.error,
        duration_ms: response.duration_ms,
      };
    }

    try {
      const text = response.text || "";
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          success: false,
          raw: text,
          error: "No JSON object found in response",
          duration_ms: response.duration_ms,
        };
      }

      const data = JSON.parse(jsonMatch[0]) as T;
      return {
        success: true,
        data,
        raw: text,
        duration_ms: response.duration_ms,
      };
    } catch (parseError) {
      return {
        success: false,
        raw: response.text,
        error: `JSON parse error: ${parseError instanceof Error ? parseError.message : "Unknown"}`,
        duration_ms: response.duration_ms,
      };
    }
  }

  /**
   * Generate embeddings for text
   */
  async embed(
    text: string,
    model?: string
  ): Promise<{
    success: boolean;
    embedding?: number[];
    error?: string;
  }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          model: model || this.defaultModel,
          prompt: text,
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Ollama API error: ${response.status}`,
        };
      }

      const data = await response.json() as { embedding?: number[] };
      return {
        success: true,
        embedding: data.embedding,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Embedding request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Pull (download) a model
   */
  async pullModel(
    modelName: string,
    onProgress?: (progress: { status: string; completed?: number; total?: number }) => void
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/api/pull`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: modelName,
          stream: true,
        }),
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to pull model: ${response.status}`,
        };
      }

      // Stream progress updates
      const reader = response.body?.getReader();
      if (reader && onProgress) {
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const lines = decoder.decode(value).split("\n").filter(Boolean);
          for (const line of lines) {
            try {
              const progress = JSON.parse(line);
              onProgress(progress);
            } catch {
              // Ignore parse errors
            }
          }
        }
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      return {
        success: false,
        error: `Pull request failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Update server URL
   */
  setServerUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Update default model
   */
  setDefaultModel(model: string): void {
    this.defaultModel = model;
  }

  /**
   * Get current configuration
   */
  getConfig(): { url: string; model: string } {
    return {
      url: this.baseUrl,
      model: this.defaultModel,
    };
  }
}

/**
 * Create an OllamaClient instance with default configuration
 */
export function createOllamaClient(
  config: Partial<VoiceAgentConfig> = {}
): OllamaClient {
  return new OllamaClient(config);
}

// Export singleton instance for convenience
export const ollamaClient = new OllamaClient();
