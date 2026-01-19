/**
 * Footer component module - returns HTML string for footer rendering
 * Provides a reusable footer component with configurable copyright text and social links
 */

(function() {
  /**
   * Create a footer component
   * @param {Object} [config={}] - Optional configuration object
   * @param {string} [config.copyrightText] - Custom copyright text (default: "© 2024 Wedding Planner. All rights reserved.")
   * @param {Array} [config.socialLinks] - Array of social link objects with name and href properties
   * @returns {string} - HTML string for the footer element
   */
  const footer = function(config = {}) {
    // Default configuration
    const defaultConfig = {
      copyrightText: '© 2024 Wedding Planner. All rights reserved.',
      socialLinks: [
        { name: 'Facebook', href: '#' },
        { name: 'Instagram', href: '#' },
        { name: 'Twitter/X', href: '#' },
        { name: 'Pinterest', href: '#' }
      ]
    };

    // Merge provided config with defaults
    const finalConfig = {
      copyrightText: config.copyrightText || defaultConfig.copyrightText,
      socialLinks: config.socialLinks || defaultConfig.socialLinks
    };

    // Generate social links HTML
    const socialLinksHtml = finalConfig.socialLinks
      .map(link => `<a href="${link.href}" target="_blank" rel="noopener noreferrer">${link.name}</a>`)
      .join('');

    // Return footer HTML string
    return `
    <footer>
      <div class="footer-content">
        <div class="footer-copyright">
          ${finalConfig.copyrightText}
        </div>
        <div class="footer-social">
          ${socialLinksHtml}
        </div>
      </div>
    </footer>
  `;
  };

  // Export as global variable for browser usage
  if (typeof window !== 'undefined') {
    window.footer = footer;
  }

  // For Node.js/CommonJS usage (testing, server-side)
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = footer;
  }
})();
