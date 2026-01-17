/**
 * Shared Formatting Utilities
 *
 * Common formatting functions for duration, tokens, cost, and currency values.
 * Used across API endpoints and HTML partial generators.
 */

/**
 * Format duration in human-readable format
 * @param minutes - Duration in minutes
 * @returns Formatted string (e.g., "45m", "2h", "2h 30m")
 */
export function formatDuration(minutes: number): string {
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (mins === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${mins}m`;
}

/**
 * Format duration from milliseconds
 * @param ms - Duration in milliseconds
 * @returns Formatted string (e.g., "1.2s", "2m 30s", "1h 15m")
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  if (ms < 60000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Format duration from seconds
 * @param seconds - Duration in seconds
 * @returns Formatted string (e.g., "45s", "2m 30s", "1h 15m")
 */
export function formatDurationSeconds(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

/**
 * Format token counts with K/M suffixes
 * @param tokens - Number of tokens
 * @returns Formatted string (e.g., "500", "1.5K", "2.3M")
 */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${(tokens / 1_000_000).toFixed(2)}M`;
  }
  if (tokens >= 1_000) {
    return `${(tokens / 1_000).toFixed(1)}K`;
  }
  return tokens.toString();
}

/**
 * Format cost as simple currency string
 * @param cost - Cost in dollars
 * @returns Formatted string (e.g., "$1.50", "$0.05")
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(2)}`;
}

/**
 * Format currency with appropriate decimal places based on magnitude
 * @param cost - Cost in dollars
 * @returns Formatted string with appropriate precision
 */
export function formatCurrency(cost: number): string {
  if (cost >= 1) {
    return `$${cost.toFixed(2)}`;
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(3)}`;
  }
  if (cost > 0) {
    return `$${cost.toFixed(4)}`;
  }
  return "$0.00";
}

/**
 * Format a relative time ago string
 * @param date - Date to format
 * @returns Formatted string (e.g., "just now", "5m ago", "2h ago", "3d ago")
 */
export function formatTimeAgo(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return "just now";
  }
  if (diffMins < 60) {
    return `${diffMins}m ago`;
  }
  if (diffHours < 24) {
    return `${diffHours}h ago`;
  }
  return `${diffDays}d ago`;
}
