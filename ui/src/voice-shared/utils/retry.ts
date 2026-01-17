/**
 * Retry Utility
 *
 * Provides exponential backoff retry logic for network requests.
 * Used by STT and TTS clients for graceful error recovery.
 */

/**
 * Configuration for retry behavior
 */
export interface RetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxAttempts: number;
  /** Initial delay in milliseconds (default: 1000) */
  initialDelayMs: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier: number;
  /** Maximum delay between retries in milliseconds (default: 10000) */
  maxDelayMs: number;
  /** Optional timeout in milliseconds for each attempt (default: no timeout) */
  timeoutMs?: number;
  /** Optional callback for retry events */
  onRetry?: (attempt: number, error: Error, delayMs: number) => void;
  /** Optional callback for timeout events */
  onTimeout?: (attempt: number, timeoutMs: number) => void;
  /** Optional function to determine if an error is retryable */
  isRetryable?: (error: Error) => boolean;
}

/**
 * Result of a retry operation
 */
export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result if successful */
  result?: T;
  /** The final error if all retries failed */
  error?: Error;
  /** Number of attempts made */
  attempts: number;
  /** Total time spent in milliseconds */
  totalTimeMs: number;
}

/**
 * Default retry configuration
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  backoffMultiplier: 2,
  maxDelayMs: 10000,
};

/**
 * Service-specific timeout defaults (in milliseconds)
 */
export const SERVICE_TIMEOUTS = {
  STT: 30000,        // 30 seconds for speech-to-text
  INTENT: 10000,     // 10 seconds for intent classification
  TTS: 15000,        // 15 seconds for text-to-speech
} as const;

/**
 * Custom error class for timeout errors
 */
export class TimeoutError extends Error {
  public readonly timeoutMs: number;
  public readonly serviceName: string;

  constructor(serviceName: string, timeoutMs: number) {
    super(`${serviceName} operation timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
    this.serviceName = serviceName;
  }
}

/**
 * Check if an error is a timeout error
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError;
}

/**
 * Execute a function with a timeout
 *
 * @param fn - The async function to execute
 * @param timeoutMs - Timeout in milliseconds
 * @param serviceName - Name of the service for error messages
 * @returns The result of the function
 * @throws TimeoutError if the operation times out
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  serviceName: string = 'Operation'
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new TimeoutError(serviceName, timeoutMs));
    }, timeoutMs);

    fn()
      .then((result) => {
        clearTimeout(timeoutId);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

/**
 * Default function to check if an error is retryable
 * Retries on network errors, server errors (5xx), and timeout errors
 */
export function isNetworkRetryable(error: Error): boolean {
  const errorMessage = error.message.toLowerCase();

  // Network errors
  if (
    errorMessage.includes('fetch failed') ||
    errorMessage.includes('network') ||
    errorMessage.includes('econnrefused') ||
    errorMessage.includes('econnreset') ||
    errorMessage.includes('etimedout') ||
    errorMessage.includes('socket') ||
    errorMessage.includes('dns')
  ) {
    return true;
  }

  // Server unreachable
  if (
    errorMessage.includes('unreachable') ||
    errorMessage.includes('unavailable') ||
    errorMessage.includes('failed to fetch')
  ) {
    return true;
  }

  // HTTP 5xx errors (server errors)
  if (
    errorMessage.includes('http 5') ||
    errorMessage.includes('500') ||
    errorMessage.includes('502') ||
    errorMessage.includes('503') ||
    errorMessage.includes('504')
  ) {
    return true;
  }

  // Timeout errors
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('timed out')
  ) {
    return true;
  }

  return false;
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for a given retry attempt using exponential backoff
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  const delay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt - 1);
  return Math.min(delay, config.maxDelayMs);
}

/**
 * Execute an async function with exponential backoff retry
 *
 * @param fn - The async function to execute
 * @param config - Retry configuration (optional, uses defaults)
 * @returns Result containing success status, result/error, and metadata
 *
 * @example
 * ```ts
 * const result = await withRetry(
 *   () => fetch('https://api.example.com/data'),
 *   {
 *     maxAttempts: 3,
 *     onRetry: (attempt, error, delay) => {
 *       console.log(`Retry ${attempt}, waiting ${delay}ms: ${error.message}`);
 *     }
 *   }
 * );
 * ```
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: Partial<RetryConfig> = {}
): Promise<RetryResult<T>> {
  const fullConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= fullConfig.maxAttempts; attempt++) {
    try {
      // Wrap function with timeout if configured
      let result: T;
      if (fullConfig.timeoutMs) {
        result = await withTimeout(fn, fullConfig.timeoutMs, 'Operation');
      } else {
        result = await fn();
      }
      return {
        success: true,
        result,
        attempts: attempt,
        totalTimeMs: Date.now() - startTime,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Notify about timeout specifically
      if (isTimeoutError(lastError) && fullConfig.onTimeout) {
        fullConfig.onTimeout(attempt, lastError.timeoutMs);
      }

      // Check if we should retry
      const isRetryable = fullConfig.isRetryable ?? isNetworkRetryable;
      const shouldRetry = attempt < fullConfig.maxAttempts && isRetryable(lastError);

      if (!shouldRetry) {
        break;
      }

      // Calculate delay with exponential backoff
      const delayMs = calculateBackoffDelay(attempt, fullConfig);

      // Notify about retry
      if (fullConfig.onRetry) {
        fullConfig.onRetry(attempt, lastError, delayMs);
      }

      // Wait before next attempt
      await sleep(delayMs);
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: fullConfig.maxAttempts,
    totalTimeMs: Date.now() - startTime,
  };
}

/**
 * Create a retryable fetch wrapper with built-in retry logic
 *
 * @param url - The URL to fetch
 * @param options - Fetch options
 * @param retryConfig - Retry configuration
 * @returns The fetch response or throws on final failure
 *
 * @example
 * ```ts
 * const response = await retryFetch('https://api.example.com/data', {
 *   method: 'POST',
 *   body: JSON.stringify(data),
 * }, {
 *   maxAttempts: 3,
 *   onRetry: (attempt, error, delay) => {
 *     console.log(`Retry ${attempt}...`);
 *   }
 * });
 * ```
 */
export async function retryFetch(
  url: string,
  options?: RequestInit,
  retryConfig?: Partial<RetryConfig>
): Promise<Response> {
  const result = await withRetry(
    async () => {
      const response = await fetch(url, options);

      // Treat 5xx errors as retryable
      if (response.status >= 500 && response.status < 600) {
        throw new Error(`HTTP ${response.status}: Server error`);
      }

      return response;
    },
    retryConfig
  );

  if (!result.success || !result.result) {
    throw result.error || new Error('Request failed after retries');
  }

  return result.result;
}

/**
 * Format retry status message for display
 */
export function formatRetryMessage(
  attempt: number,
  maxAttempts: number,
  serviceName: string
): string {
  if (attempt === maxAttempts) {
    return `${serviceName} unreachable after ${maxAttempts} attempts`;
  }
  return `${serviceName} unreachable, retrying... (${attempt}/${maxAttempts})`;
}

/**
 * Format timeout status message for display
 */
export function formatTimeoutMessage(
  serviceName: string,
  timeoutMs: number
): string {
  const seconds = Math.round(timeoutMs / 1000);
  return `${serviceName} timed out after ${seconds}s. Please try again.`;
}
