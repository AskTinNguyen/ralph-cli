/**
 * Greeting Component
 *
 * A distinctive greeting component with kinetic typography animation.
 * Follows Rams design system with a brutalist aesthetic: mechanical precision,
 * monospace typography, and high-contrast black/white palette with electric lime accent.
 *
 * @example
 * ```typescript
 * // With a name
 * const html = renderGreeting("Alice");
 * // Returns: <div class="greeting">...</div> displaying "Hello, Alice!"
 *
 * // Without a name (fallback to Guest)
 * const html = renderGreeting();
 * // Returns: <div class="greeting">...</div> displaying "Hello, Guest!"
 * ```
 */

import type { GreetingProps } from "../../types.js";
import { escapeHtml } from "./html-helpers.js";

/**
 * Renders a greeting component with kinetic typography animation.
 *
 * The component displays "Hello, {name}!" with a distinctive brutalist aesthetic:
 * - Monospace typography for the name (IBM Plex Mono aesthetic)
 * - Letter-by-letter fade-in animation with staggered delays
 * - High-contrast black/white with electric lime accent on exclamation mark
 * - Scanline texture overlay for retro-terminal feel
 * - Generous letter spacing for Swiss typography precision
 *
 * @param {string} [name] - The name to display. Defaults to "Guest" if empty/undefined.
 * @returns {string} HTML string for the greeting component
 *
 * @example
 * renderGreeting("Alice")  // "Hello, Alice!"
 * renderGreeting("")       // "Hello, Guest!"
 * renderGreeting()         // "Hello, Guest!"
 */
export function renderGreeting(name?: string): string {
  // Default to "Guest" if name is empty, undefined, or null
  const displayName = name && name.trim() !== "" ? escapeHtml(name.trim()) : "Guest";

  // Split the greeting into characters for kinetic animation
  // "Hello, " stays as one unit, then each letter of the name animates individually
  const greeting = "Hello, ";
  const nameChars = displayName.split("");
  const exclamation = "!";

  // Generate animated spans for each character with staggered delays
  const animatedName = nameChars
    .map((char, i) => {
      const delay = i * 0.05; // 50ms stagger between letters
      return `<span class="greeting__char" style="animation-delay: ${delay}s">${char === " " ? "&nbsp;" : char}</span>`;
    })
    .join("");

  return `
    <div class="greeting" data-testid="greeting-component">
      <div class="greeting__content">
        <span class="greeting__prefix">Hello,&nbsp;</span>
        <span class="greeting__name">${animatedName}</span>
        <span class="greeting__exclamation">!</span>
      </div>
      <div class="greeting__scanline" aria-hidden="true"></div>
    </div>
  `;
}
