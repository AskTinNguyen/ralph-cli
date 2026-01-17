/**
 * HTML Helper Utilities
 *
 * Common HTML manipulation and sanitization functions.
 * Used across API endpoints that generate HTML partials.
 */

/**
 * Map of characters to their HTML entity equivalents
 */
const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape HTML special characters to prevent XSS
 * @param text - Raw text to escape
 * @returns Escaped HTML-safe string
 */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] || char);
}

/**
 * Create an HTML attribute value, properly escaped
 * @param value - Attribute value
 * @returns Escaped attribute value safe for HTML
 */
export function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

/**
 * Join class names, filtering out empty/falsy values
 * @param classes - Array of class names or falsy values
 * @returns Space-separated class string
 */
export function classNames(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
