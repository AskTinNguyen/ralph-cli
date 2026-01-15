/**
 * Docs Header Component
 * Renders consistent header navigation across all documentation pages
 */

(function() {
  'use strict';

  /**
   * Render the docs header
   * @param {string} activePage - The current page name (e.g., 'home', 'tutorial', 'commands')
   */
  function renderDocsHeader(activePage = '') {
    const header = document.createElement('header');
    header.className = 'docs-header';

    // Determine active page from URL if not provided
    if (!activePage) {
      const path = window.location.pathname;
      if (path.endsWith('/') || path.endsWith('index.html')) {
        activePage = 'home';
      } else if (path.includes('tutorial')) {
        activePage = 'tutorial';
      } else if (path.includes('commands')) {
        activePage = 'commands';
      } else if (path.includes('examples')) {
        activePage = 'examples';
      } else if (path.includes('tips')) {
        activePage = 'tips';
      } else if (path.includes('streams')) {
        activePage = 'streams';
      } else if (path.includes('troubleshooting')) {
        activePage = 'troubleshooting';
      } else if (path.includes('integration')) {
        activePage = 'integration';
      }
    }

    // Navigation links configuration
    const navLinks = [
      { id: 'home', label: 'Home', href: '/docs/' },
      { id: 'tutorial', label: 'Tutorial', href: '/docs/tutorial.html' },
      { id: 'commands', label: 'Commands', href: '/docs/commands.html' },
      { id: 'examples', label: 'Examples', href: '/docs/examples.html' },
      { id: 'tips', label: 'Tips & Tricks', href: '/docs/tips.html' },
      { id: 'streams', label: 'Stream Workflows', href: '/docs/streams.html' },
      { id: 'troubleshooting', label: 'Troubleshooting', href: '/docs/troubleshooting.html' },
      { id: 'dashboard', label: 'Dashboard', href: '/' }
    ];

    header.innerHTML = `
      <a href="/docs/" class="docs-header-brand">
        <span class="docs-header-logo">Ralph CLI</span>
        <span class="docs-header-tag">Documentation</span>
      </a>
      <nav class="docs-header-nav">
        ${navLinks.map(link => `
          <a href="${link.href}" class="docs-header-link ${link.id === activePage ? 'active' : ''}">
            ${link.label}
          </a>
        `).join('')}
      </nav>
    `;

    return header;
  }

  /**
   * Initialize header on page load
   */
  function initDocsHeader() {
    // Wait for DOM to be ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initDocsHeader);
      return;
    }

    // Find placeholder element
    const placeholder = document.getElementById('docs-header-placeholder');
    if (!placeholder) {
      console.warn('docs-header: No placeholder element found. Add <div id="docs-header-placeholder"></div> to your HTML.');
      return;
    }

    // Get active page from data attribute or auto-detect
    const activePage = placeholder.getAttribute('data-active-page') || '';

    // Render and insert header
    const header = renderDocsHeader(activePage);
    placeholder.replaceWith(header);
  }

  // Auto-initialize
  initDocsHeader();

  // Export for manual use if needed
  window.DocsHeader = {
    render: renderDocsHeader,
    init: initDocsHeader
  };
})();
