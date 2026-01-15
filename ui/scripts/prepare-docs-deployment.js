/**
 * Prepare Documentation for Deployment
 *
 * Modifies HTML files to enable documentation mode:
 * - Injects docs-mode CSS and JavaScript
 * - Adds warning banners
 * - Marks stream features as CLI-only
 * - Disables interactive features that require local CLI
 *
 * Usage: node ui/scripts/prepare-docs-deployment.js
 */

import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '../../docs');

// ============================================================
// Configuration
// ============================================================

const CONFIG = {
  docsDir,
  cssPath: '/css/docs-mode.css',
  jsPath: '/js/docs-mode.js',

  // Selectors for stream features
  streamSelectors: [
    'a[href="/streams.html"]',
    'a[href*="stream"]',
    '[data-feature="streams"]',
    '[data-action*="stream"]',
    '.stream-controls',
    '.stream-workflow',
    'button[data-action*="build"]',
    '.wizard-trigger'
  ],

  // Pages to process
  pages: [
    'docs/index.html',
    'docs/tutorial.html',
    'docs/commands.html',
    'docs/examples.html',
    'docs/tips.html',
    'docs/troubleshooting.html',
    'docs/streams.html',
    'docs/integration.html',
    'docs/agent-guide.html'
  ]
};

// ============================================================
// HTML Processing Functions
// ============================================================

/**
 * Process a single HTML file
 */
async function processHTMLFile(filePath) {
  const relativePath = path.relative(docsDir, filePath);
  console.log(`  Processing ${relativePath}...`);

  // Read HTML
  const html = await fs.readFile(filePath, 'utf-8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Apply modifications
  addDocsModeClass(document);
  injectDocsModeAssets(document);
  injectWarningBanner(document);
  markStreamFeatures(document);
  addMetaTags(document);

  // Write modified HTML
  const modifiedHTML = dom.serialize();
  await fs.writeFile(filePath, modifiedHTML);

  console.log(`  ✅ ${relativePath} processed`);
}

/**
 * Add docs-mode class to <html> and <body>
 */
function addDocsModeClass(document) {
  document.documentElement.classList.add('docs-mode');
  document.body.classList.add('docs-mode');
  document.body.setAttribute('data-docs-mode', 'true');
}

/**
 * Inject docs-mode CSS and JavaScript
 */
function injectDocsModeAssets(document) {
  const head = document.querySelector('head');

  // Check if already injected
  if (document.querySelector(`link[href="${CONFIG.cssPath}"]`)) {
    return;
  }

  // Inject CSS
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = CONFIG.cssPath;
  head.appendChild(cssLink);

  // Inject JavaScript
  const script = document.createElement('script');
  script.src = CONFIG.jsPath;
  script.defer = true;
  document.body.appendChild(script);
}

/**
 * Inject warning banner
 */
function injectWarningBanner(document) {
  const mainContent = document.querySelector('main') ||
                      document.querySelector('.rams-main') ||
                      document.querySelector('article') ||
                      document.body;

  // Check if banner already exists
  if (document.querySelector('.docs-mode-banner')) {
    return;
  }

  // Create banner
  const banner = document.createElement('div');
  banner.className = 'docs-mode-banner';
  banner.innerHTML = `
    <h4>📖 Documentation Website</h4>
    <p>
      You're viewing the static documentation. Stream features and build automation require
      <a href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener">Claude Code CLI</a>
      to be installed locally.
      <a href="https://github.com/AskTinNguyen/ralph-cli#installation" target="_blank" rel="noopener">Installation instructions →</a>
    </p>
  `;

  // Insert at the beginning of main content
  mainContent.insertBefore(banner, mainContent.firstChild);
}

/**
 * Mark stream features with cli-only class
 */
function markStreamFeatures(document) {
  CONFIG.streamSelectors.forEach(selector => {
    try {
      const elements = document.querySelectorAll(selector);

      elements.forEach(el => {
        el.classList.add('cli-only');
        el.setAttribute('data-requires', 'cli');

        // Disable buttons
        if (el.tagName === 'BUTTON') {
          el.setAttribute('disabled', 'true');
          el.setAttribute('aria-disabled', 'true');
        }

        // Add aria-label for accessibility
        if (!el.getAttribute('aria-label')) {
          el.setAttribute('aria-label', 'Requires Claude Code CLI installation');
        }
      });
    } catch (error) {
      // Selector might be invalid in JSDOM, skip
      console.warn(`    ⚠️  Skipped selector: ${selector}`);
    }
  });
}

/**
 * Add meta tags for SEO and social sharing
 */
function addMetaTags(document) {
  const head = document.querySelector('head');
  const title = document.querySelector('title')?.textContent || 'Ralph CLI Documentation';

  // Meta tags to add
  const metaTags = [
    { name: 'author', content: 'Ralph CLI' },
    { name: 'robots', content: 'index, follow' },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: 'Autonomous coding loop for Claude Code. PRD-based workflow with bash implementation.' },
    { property: 'og:site_name', content: 'Ralph CLI' },
    { name: 'twitter:card', content: 'summary_large_image' },
    { name: 'twitter:title', content: title }
  ];

  // Check if meta tag already exists
  metaTags.forEach(({ name, property, content }) => {
    const selector = name ? `meta[name="${name}"]` : `meta[property="${property}"]`;

    if (!document.querySelector(selector)) {
      const meta = document.createElement('meta');
      if (name) meta.name = name;
      if (property) meta.setAttribute('property', property);
      meta.content = content;
      head.appendChild(meta);
    }
  });
}

// ============================================================
// Stream Page Special Processing
// ============================================================

/**
 * Add special warning to streams.html
 */
async function processStreamsPage() {
  const streamsPath = path.join(docsDir, 'docs/streams.html');

  if (!(await fs.pathExists(streamsPath))) {
    console.log('  ⚠️  streams.html not found, skipping');
    return;
  }

  console.log('  Processing streams.html (special)...');

  const html = await fs.readFile(streamsPath, 'utf-8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Add prominent warning at the top
  const article = document.querySelector('article') || document.querySelector('main');

  if (article) {
    const warning = document.createElement('div');
    warning.className = 'rams-alert rams-alert-warning';
    warning.style.margin = '32px 0';
    warning.style.padding = '24px';
    warning.style.background = 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)';
    warning.style.border = '2px solid #f59e0b';
    warning.style.borderRadius = '12px';
    warning.innerHTML = `
      <div style="display: flex; gap: 16px; align-items: start;">
        <div style="font-size: 32px;">⚠️</div>
        <div>
          <h3 style="margin: 0 0 12px 0; color: #92400e; font-size: 20px; font-weight: 700;">
            Stream Features Require CLI Installation
          </h3>
          <p style="margin: 0 0 12px 0; color: #78350f; font-size: 16px; line-height: 1.6;">
            The stream workflow and parallel execution features documented on this page
            require <strong>Claude Code CLI</strong> and <strong>Ralph CLI</strong> to be installed locally.
          </p>
          <p style="margin: 0; color: #78350f; font-size: 14px;">
            <a href="https://github.com/anthropics/claude-code" target="_blank" rel="noopener"
               style="color: #92400e; font-weight: 600; text-decoration: underline;">
              Install Claude Code CLI →
            </a>
            &nbsp;&nbsp;|&nbsp;&nbsp;
            <a href="https://github.com/AskTinNguyen/ralph-cli#installation" target="_blank" rel="noopener"
               style="color: #92400e; font-weight: 600; text-decoration: underline;">
              Install Ralph CLI →
            </a>
          </p>
        </div>
      </div>
    `;

    article.insertBefore(warning, article.firstChild);
  }

  await fs.writeFile(streamsPath, dom.serialize());
  console.log('  ✅ streams.html special processing complete');
}

// ============================================================
// Main Process
// ============================================================

async function prepareDocumentation() {
  try {
    console.log('🎨 Preparing documentation for deployment...\n');

    // Check if docs directory exists
    if (!(await fs.pathExists(docsDir))) {
      throw new Error(`Documentation directory not found: ${docsDir}`);
    }

    // Process each HTML page
    console.log('📄 Processing HTML pages...');
    for (const page of CONFIG.pages) {
      const filePath = path.join(docsDir, page);

      if (await fs.pathExists(filePath)) {
        await processHTMLFile(filePath);
      } else {
        console.log(`  ⚠️  ${page} not found, skipping`);
      }
    }

    // Special processing for streams page
    console.log('\n🌊 Processing streams page...');
    await processStreamsPage();

    // Summary
    console.log('\n' + '='.repeat(50));
    console.log('✨ Documentation prepared for deployment!');
    console.log('='.repeat(50));
    console.log('\n✅ All HTML pages modified');
    console.log('✅ Docs-mode CSS and JavaScript injected');
    console.log('✅ Warning banners added');
    console.log('✅ Stream features marked as CLI-only');
    console.log('\n🚀 Ready to deploy to:');
    console.log('  - GitHub Pages');
    console.log('  - Vercel');
    console.log('  - Cloudflare Pages');
    console.log('  - Any static hosting service');
    console.log('');

  } catch (error) {
    console.error('\n❌ Preparation failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run preparation
prepareDocumentation();
