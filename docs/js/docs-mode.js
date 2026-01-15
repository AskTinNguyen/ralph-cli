/**
 * Documentation Mode JavaScript
 *
 * Detects when Ralph CLI documentation is running as a standalone website
 * (without Claude Code CLI access) and disables interactive features that
 * require local CLI installation.
 *
 * Auto-enables when:
 * - Not running on localhost
 * - No data-live-mode attribute on <body>
 * - API endpoints return 503/unavailable
 */

(function() {
  'use strict';

  // ============================================================
  // Configuration
  // ============================================================

  const CONFIG = {
    // Detection rules
    localHostnames: ['localhost', '127.0.0.1', '0.0.0.0'],
    apiHealthCheckPath: '/api/health',
    apiCheckTimeout: 3000, // 3 seconds

    // UI elements
    bannerClass: 'docs-mode-banner',
    cliOnlyClass: 'cli-only',

    // Links
    installURL: 'https://github.com/AskTinNguyen/ralph-cli#installation',
    claudeCodeURL: 'https://github.com/anthropics/claude-code',
    repoURL: 'https://github.com/AskTinNguyen/ralph-cli'
  };

  // ============================================================
  // Detection Logic
  // ============================================================

  /**
   * Check if running in documentation-only mode
   */
  function isDocumentationMode() {
    // Explicit override via body attribute
    if (document.body.dataset.liveMode === 'true') {
      return false;
    }
    if (document.body.dataset.docsMode === 'true') {
      return true;
    }

    // Check hostname (not localhost = docs mode)
    const hostname = window.location.hostname;
    const isLocal = CONFIG.localHostnames.some(h => hostname === h);

    return !isLocal;
  }

  /**
   * Check if API is available (async)
   */
  async function checkAPIAvailability() {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CONFIG.apiCheckTimeout);

      const response = await fetch(CONFIG.apiHealthCheckPath, {
        signal: controller.signal,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      clearTimeout(timeoutId);

      // API available if status is 200-299
      return response.ok;
    } catch (error) {
      // Network error or timeout = API unavailable
      return false;
    }
  }

  // ============================================================
  // UI Modifications
  // ============================================================

  /**
   * Enable documentation mode UI
   */
  function enableDocumentationMode() {
    console.log('[Docs Mode] Enabled');

    // Add CSS classes
    document.documentElement.classList.add('docs-mode');
    document.body.classList.add('docs-mode');

    // Inject warning banner
    injectWarningBanner();

    // Disable interactive features
    disableStreamFeatures();
    disableWizards();
    disableActions();

    // Mock API calls
    mockAPIEndpoints();

    // Update navigation
    updateNavigation();
  }

  /**
   * Inject warning banner at top of main content
   */
  function injectWarningBanner() {
    const mainContent = document.querySelector('main') ||
                        document.querySelector('.rams-main') ||
                        document.body;

    // Check if banner already exists
    if (document.querySelector(`.${CONFIG.bannerClass}`)) {
      return;
    }

    const banner = document.createElement('div');
    banner.className = CONFIG.bannerClass;
    banner.innerHTML = `
      <h4>📖 Documentation Website</h4>
      <p>
        You're viewing the static documentation. Stream features and build automation require
        <a href="${CONFIG.claudeCodeURL}" target="_blank" rel="noopener">Claude Code CLI</a>
        to be installed locally.
        <a href="${CONFIG.installURL}" target="_blank" rel="noopener">Installation instructions →</a>
      </p>
    `;

    mainContent.insertBefore(banner, mainContent.firstChild);
  }

  /**
   * Disable stream-related features
   */
  function disableStreamFeatures() {
    const selectors = [
      'a[href="/streams.html"]',
      'a[href*="stream"]',
      '[data-feature="streams"]',
      '[data-action*="stream"]',
      '.stream-controls',
      '.stream-workflow'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(el => {
        el.classList.add(CONFIG.cliOnlyClass);
        el.setAttribute('data-requires', 'cli');
        el.setAttribute('aria-disabled', 'true');

        // Prevent default action
        el.addEventListener('click', preventCLIAction, { capture: true });
      });
    });
  }

  /**
   * Disable wizard features
   */
  function disableWizards() {
    const wizardTriggers = document.querySelectorAll(
      '.wizard-trigger, [data-action="open-wizard"], .rams-btn-wizard'
    );

    wizardTriggers.forEach(trigger => {
      trigger.classList.add(CONFIG.cliOnlyClass);
      trigger.setAttribute('data-requires', 'cli');
      trigger.disabled = true;
      trigger.addEventListener('click', preventCLIAction, { capture: true });
    });

    // Hide wizard overlays
    document.querySelectorAll('.wizard-overlay, .modal-overlay').forEach(overlay => {
      overlay.style.display = 'none';
    });
  }

  /**
   * Disable action buttons
   */
  function disableActions() {
    const actionButtons = document.querySelectorAll(
      'button[data-action*="build"], ' +
      'button[data-action*="stream"], ' +
      '[data-requires="cli"]'
    );

    actionButtons.forEach(btn => {
      btn.classList.add(CONFIG.cliOnlyClass);
      btn.disabled = true;
      btn.addEventListener('click', preventCLIAction, { capture: true });
    });
  }

  /**
   * Prevent CLI action and show alert
   */
  function preventCLIAction(event) {
    event.preventDefault();
    event.stopPropagation();

    const message = `⚠️ This feature requires Claude Code CLI

This is a documentation website. To use stream features, build automation, and interactive wizards, you need to:

1. Install Claude Code CLI: ${CONFIG.claudeCodeURL}
2. Install Ralph CLI: ${CONFIG.installURL}
3. Run commands locally in your terminal

Visit the installation guide for step-by-step instructions.`;

    alert(message);
  }

  /**
   * Mock API endpoints
   */
  function mockAPIEndpoints() {
    if (!window.fetch) return;

    const originalFetch = window.fetch;

    window.fetch = function(...args) {
      const url = args[0];

      // Check if it's an API call
      if (typeof url === 'string' && url.startsWith('/api/')) {
        console.log('[Docs Mode] API call blocked:', url);

        return Promise.resolve({
          ok: false,
          status: 503,
          statusText: 'Service Unavailable',
          headers: new Headers({
            'Content-Type': 'application/json'
          }),
          json: () => Promise.resolve({
            error: 'Documentation mode: API not available',
            message: 'This feature requires Claude Code CLI to be installed locally',
            docs: CONFIG.installURL
          }),
          text: () => Promise.resolve(JSON.stringify({
            error: 'Documentation mode: API not available'
          }))
        });
      }

      // Pass through non-API requests
      return originalFetch.apply(this, args);
    };
  }

  /**
   * Update navigation to show CLI requirements
   */
  function updateNavigation() {
    // Add lock icon to stream links
    document.querySelectorAll('.rams-nav a[href*="stream"]').forEach(link => {
      if (!link.querySelector('.cli-lock-icon')) {
        const icon = document.createElement('span');
        icon.className = 'cli-lock-icon';
        icon.textContent = ' 🔒';
        icon.style.fontSize = '12px';
        icon.style.marginLeft = '4px';
        link.appendChild(icon);
      }
    });
  }

  // ============================================================
  // HTMX Integration
  // ============================================================

  /**
   * Disable HTMX requests in docs mode
   */
  function disableHTMX() {
    if (window.htmx) {
      document.body.addEventListener('htmx:beforeRequest', function(event) {
        const xhr = event.detail.xhr;
        const path = event.detail.path;

        // Block API requests
        if (path.startsWith('/api/')) {
          event.preventDefault();
          console.log('[Docs Mode] HTMX request blocked:', path);

          // Show error message
          const target = event.detail.target;
          if (target) {
            target.innerHTML = `
              <div class="${CONFIG.bannerClass}" style="margin: 16px 0;">
                <h4>⚠️ Feature Unavailable</h4>
                <p>This feature requires Claude Code CLI. <a href="${CONFIG.installURL}" target="_blank">Install →</a></p>
              </div>
            `;
          }
        }
      });
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  /**
   * Initialize documentation mode
   */
  async function init() {
    console.log('[Docs Mode] Initializing...');

    // Check if docs mode should be enabled
    const docsMode = isDocumentationMode();

    if (docsMode) {
      // Check API availability (async)
      const apiAvailable = await checkAPIAvailability();

      if (!apiAvailable) {
        console.log('[Docs Mode] API unavailable, enabling docs mode');
        enableDocumentationMode();
        disableHTMX();
      } else {
        console.log('[Docs Mode] API available, staying in live mode');
      }
    } else {
      console.log('[Docs Mode] Running locally, live mode enabled');
    }
  }

  // ============================================================
  // Auto-run
  // ============================================================

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for manual control
  window.ralphDocsMode = {
    enable: enableDocumentationMode,
    isEnabled: () => document.body.classList.contains('docs-mode'),
    config: CONFIG
  };

})();
