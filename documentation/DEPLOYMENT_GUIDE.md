# Ralph CLI Documentation - Deployment Guide

**Last Updated:** January 15, 2026

This guide explains how to deploy Ralph CLI documentation as a standalone website via GitHub, with Stream features appropriately disabled/greyed out since they require CLI access.

---

## Quick Decision Matrix

| Use Case | Best Option | Why |
|----------|-------------|-----|
| **Fastest deployment** | GitHub Pages | Zero config, free, auto-deploy |
| **Most flexible (keep Node.js)** | Vercel | Free, serverless functions, preview deployments |
| **Global CDN + unlimited bandwidth** | Cloudflare Pages | Free, fastest edge network, Workers support |
| **Just documentation (no server)** | GitHub Pages | Pure static site, simplest setup |

---

## Option 1: GitHub Pages (Recommended for Static Docs)

### Pros
- ✅ **Zero cost** - completely free
- ✅ **Zero configuration** - enable in repo settings
- ✅ **Automatic deployments** - push to main = auto-deploy
- ✅ **Custom domain support** - docs.ralph-cli.com
- ✅ **HTTPS included** - free SSL certificate
- ✅ **GitHub native** - no external service

### Cons
- ❌ **Static files only** - no Node.js server support
- ❌ **No API endpoints** - must remove/mock API calls
- ❌ **Limited build customization** - basic Jekyll/static site

### Implementation Steps

#### Step 1: Create Static Docs Build

Create a new build script in `ui/package.json`:

```json
{
  "scripts": {
    "build:static-docs": "node scripts/build-static-docs.js"
  }
}
```

Create `ui/scripts/build-static-docs.js`:

```javascript
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '../public');
const outputDir = path.join(__dirname, '../../docs');

// Clean output directory
await fs.emptyDir(outputDir);

// Copy documentation pages
await fs.copy(
  path.join(publicDir, 'docs'),
  path.join(outputDir, 'docs')
);

// Copy static assets
await fs.copy(
  path.join(publicDir, 'css'),
  path.join(outputDir, 'css')
);
await fs.copy(
  path.join(publicDir, 'js'),
  path.join(outputDir, 'js')
);
await fs.copy(
  path.join(publicDir, 'favicon.png'),
  path.join(outputDir, 'favicon.png')
);

// Copy root-level documentation
const rootDocs = ['README.md', 'AGENTS.md', 'TESTING.md', 'DESIGN_SYSTEM.md'];
for (const doc of rootDocs) {
  await fs.copy(
    path.join(__dirname, '../../', doc),
    path.join(outputDir, doc)
  );
}

// Create index.html redirect
await fs.writeFile(
  path.join(outputDir, 'index.html'),
  `<!DOCTYPE html>
<html>
<head>
  <meta http-equiv="refresh" content="0; url=/docs/">
  <title>Ralph CLI Documentation</title>
</head>
<body>
  <p>Redirecting to <a href="/docs/">documentation</a>...</p>
</body>
</html>`
);

console.log('✅ Static documentation built successfully!');
console.log('📁 Output directory:', outputDir);
```

#### Step 2: Disable Stream Features

Create `ui/scripts/disable-streams.js`:

```javascript
import fs from 'fs-extra';
import path from 'path';

const docsDir = path.join(__dirname, '../../docs');

// Pages to modify
const streamPages = [
  'docs/streams.html',
  'docs/commands.html',
  'docs/index.html'
];

// CSS to inject (grey out stream features)
const streamDisabledCSS = `
<style>
  /* Grey out stream-related features */
  .stream-feature,
  a[href*="stream"],
  [data-feature="streams"] {
    opacity: 0.4;
    pointer-events: none;
    position: relative;
  }

  .stream-feature::after {
    content: "⚠️ Requires Claude Code CLI";
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(255, 193, 7, 0.95);
    color: #000;
    padding: 8px 16px;
    border-radius: 4px;
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    z-index: 100;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
  }
</style>
`;

// Add warning banner
const streamWarningBanner = `
<div class="rams-alert rams-alert-warning" style="margin-bottom: 24px;">
  <div class="rams-alert-icon">⚠️</div>
  <div class="rams-alert-content">
    <h4 class="rams-alert-title">Documentation Mode</h4>
    <p class="rams-alert-text">You're viewing the documentation website. Stream features require <a href="https://github.com/anthropics/claude-code" target="_blank">Claude Code CLI</a> to be installed locally.</p>
  </div>
</div>
`;

for (const pagePath of streamPages) {
  const fullPath = path.join(docsDir, pagePath);

  if (await fs.pathExists(fullPath)) {
    let html = await fs.readFile(fullPath, 'utf-8');

    // Inject CSS before </head>
    html = html.replace('</head>', `${streamDisabledCSS}\n</head>`);

    // Inject warning banner after <main> or first <section>
    html = html.replace(
      /<main[^>]*>/,
      `$&\n${streamWarningBanner}`
    );

    await fs.writeFile(fullPath, html);
    console.log(`✅ Updated ${pagePath}`);
  }
}
```

#### Step 3: Configure GitHub Pages

1. Create `.github/workflows/deploy-docs.yml`:

```yaml
name: Deploy Documentation

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: write
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: |
          cd ui
          npm ci

      - name: Build static docs
        run: |
          cd ui
          npm run build:static-docs

      - name: Disable stream features
        run: |
          cd ui
          node scripts/disable-streams.js

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./docs
          cname: docs.ralph-cli.com  # Optional: custom domain
```

2. Enable GitHub Pages in repo settings:
   - Go to **Settings** → **Pages**
   - Source: **Deploy from a branch**
   - Branch: **gh-pages** / **root**
   - Save

#### Step 4: Deploy

```bash
# Build and test locally
cd ui
npm run build:static-docs
node scripts/disable-streams.js

# Preview locally
npx serve ../docs -p 8080

# Commit and push (triggers auto-deploy)
git add .
git commit -m "docs: Add static documentation build"
git push origin main
```

#### Access

- GitHub Pages URL: `https://<username>.github.io/ralph-cli/docs/`
- Custom domain: `https://docs.ralph-cli.com` (if configured)

---

## Option 2: Vercel (Recommended for Full Features)

### Pros
- ✅ **Node.js support** - keep Hono server
- ✅ **Free tier** - generous limits (100 GB bandwidth/month)
- ✅ **Automatic deployments** - push to deploy
- ✅ **Preview deployments** - every PR gets a URL
- ✅ **Serverless functions** - API endpoints still work
- ✅ **Custom domains** - free SSL
- ✅ **Edge network** - global CDN

### Cons
- ❌ **External service** - not GitHub native
- ❌ **Requires account** - sign up with GitHub

### Implementation Steps

#### Step 1: Create Vercel Configuration

Create `vercel.json` at repo root:

```json
{
  "version": 2,
  "name": "ralph-cli-docs",
  "builds": [
    {
      "src": "ui/src/server.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/docs/(.*)",
      "dest": "/ui/public/docs/$1"
    },
    {
      "src": "/css/(.*)",
      "dest": "/ui/public/css/$1"
    },
    {
      "src": "/js/(.*)",
      "dest": "/ui/public/js/$1"
    },
    {
      "src": "/(.*\\.(png|jpg|svg|ico))",
      "dest": "/ui/public/$1"
    },
    {
      "src": "/api/(.*)",
      "dest": "/ui/src/server.ts",
      "methods": ["GET", "POST"]
    },
    {
      "src": "/",
      "dest": "/ui/public/docs/index.html"
    }
  ],
  "env": {
    "RALPH_DOCS_MODE": "true"
  }
}
```

#### Step 2: Create Documentation Mode Server

Modify `ui/src/server.ts` to detect docs mode:

```typescript
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

const app = new Hono();

// Documentation mode (no live CLI data)
const DOCS_MODE = process.env.RALPH_DOCS_MODE === 'true';

if (DOCS_MODE) {
  // Serve static files only (no API endpoints)
  app.use('/*', serveStatic({ root: './public' }));

  // Mock API responses with documentation data
  app.get('/api/*', (c) => {
    return c.json({
      error: 'This is a documentation website. Install Ralph CLI to use this feature.',
      docs: 'https://github.com/AskTinNguyen/ralph-cli'
    }, 503);
  });
} else {
  // Full server mode (with API endpoints)
  // ... existing server code ...
}

export default app;
```

#### Step 3: Deploy to Vercel

**Via Vercel CLI:**

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod
```

**Via Vercel Dashboard:**

1. Go to https://vercel.com/new
2. Import GitHub repository
3. Configure:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** `cd ui && npm install && npm run build`
   - **Output Directory:** `ui/dist`
   - **Install Command:** `npm install`
4. Add environment variable: `RALPH_DOCS_MODE=true`
5. Deploy

#### Access

- Vercel URL: `https://ralph-cli-docs.vercel.app`
- Custom domain: `https://docs.ralph-cli.com` (configured in Vercel dashboard)

---

## Option 3: Cloudflare Pages

### Pros
- ✅ **Unlimited bandwidth** - no traffic limits
- ✅ **Lightning fast CDN** - global edge network
- ✅ **Workers support** - serverless functions
- ✅ **Free tier** - very generous

### Cons
- ❌ **Learning curve** - Cloudflare Workers API
- ❌ **External service** - not GitHub native

### Implementation Steps

#### Step 1: Create Cloudflare Pages Build

Create `wrangler.toml`:

```toml
name = "ralph-cli-docs"
compatibility_date = "2024-01-01"

[site]
bucket = "./docs"

[[routes]]
pattern = "/*"
zone_name = "ralph-cli.com"
```

#### Step 2: Build Configuration

Add to `package.json`:

```json
{
  "scripts": {
    "build:cloudflare": "npm run build:static-docs && npm run disable:streams"
  }
}
```

#### Step 3: Deploy

**Via Cloudflare Dashboard:**

1. Go to https://dash.cloudflare.com/
2. Pages → Create a project
3. Connect GitHub repository
4. Configure:
   - **Build command:** `cd ui && npm run build:cloudflare`
   - **Build output directory:** `docs`
5. Deploy

**Via Wrangler CLI:**

```bash
npm i -g wrangler
wrangler login
wrangler pages deploy docs
```

#### Access

- Cloudflare URL: `https://ralph-cli-docs.pages.dev`
- Custom domain: configured in Cloudflare dashboard

---

## Disabling/Greying Out Stream Features

### Approach 1: CSS-Only (Simplest)

Add to `ui/public/css/docs-mode.css`:

```css
/* Documentation mode: grey out CLI-only features */
body.docs-mode .cli-only,
body.docs-mode [data-requires="cli"],
body.docs-mode a[href="/streams.html"],
body.docs-mode .stream-controls {
  opacity: 0.4;
  pointer-events: none;
  cursor: not-allowed;
  position: relative;
}

/* Tooltip on hover */
body.docs-mode .cli-only::after {
  content: "⚠️ Requires Claude Code CLI";
  position: absolute;
  top: -40px;
  left: 50%;
  transform: translateX(-50%);
  background: #f59e0b;
  color: #000;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
  z-index: 1000;
}

body.docs-mode .cli-only:hover::after {
  opacity: 1;
}

/* Warning banner */
.docs-mode-banner {
  background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
  border-left: 4px solid #f59e0b;
  padding: 16px 24px;
  margin-bottom: 32px;
  border-radius: 8px;
}

.docs-mode-banner h4 {
  margin: 0 0 8px 0;
  color: #92400e;
  font-size: 16px;
  font-weight: 600;
}

.docs-mode-banner p {
  margin: 0;
  color: #78350f;
  font-size: 14px;
  line-height: 1.6;
}

.docs-mode-banner a {
  color: #92400e;
  font-weight: 600;
  text-decoration: underline;
}
```

Add to all documentation pages:

```html
<!DOCTYPE html>
<html lang="en" class="docs-mode">
<head>
  <!-- ... -->
  <link rel="stylesheet" href="/css/docs-mode.css">
</head>
<body class="docs-mode">
  <div class="docs-mode-banner">
    <h4>📖 Documentation Website</h4>
    <p>
      You're viewing the static documentation. Stream features require
      <a href="https://github.com/anthropics/claude-code" target="_blank">Claude Code CLI</a>
      to be installed locally.
      <a href="https://github.com/AskTinNguyen/ralph-cli#installation">Installation instructions →</a>
    </p>
  </div>
  <!-- ... rest of content ... -->
</body>
</html>
```

### Approach 2: JavaScript Detection (Dynamic)

Add to `ui/public/js/docs-mode.js`:

```javascript
// Detect if running in docs-only mode
const isDocsMode = !window.location.hostname.includes('localhost') &&
                   !document.body.dataset.liveMode;

if (isDocsMode) {
  document.documentElement.classList.add('docs-mode');
  document.body.classList.add('docs-mode');

  // Disable stream-related buttons
  document.querySelectorAll('[data-action*="stream"]').forEach(btn => {
    btn.disabled = true;
    btn.title = '⚠️ Requires Claude Code CLI';
  });

  // Add warning tooltips to stream links
  document.querySelectorAll('a[href*="stream"]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      alert('⚠️ Stream features require Claude Code CLI to be installed locally.\n\nVisit: https://github.com/AskTinNguyen/ralph-cli');
    });
  });

  // Mock API calls
  if (window.fetch) {
    const originalFetch = window.fetch;
    window.fetch = function(...args) {
      const url = args[0];
      if (typeof url === 'string' && url.startsWith('/api/')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: () => Promise.resolve({
            error: 'Documentation mode: API not available',
            message: 'Install Ralph CLI to use this feature'
          })
        });
      }
      return originalFetch.apply(this, args);
    };
  }
}
```

### Approach 3: Build-Time Modification (Most Robust)

Create `ui/scripts/prepare-docs-deployment.js`:

```javascript
import fs from 'fs-extra';
import path from 'path';
import { JSDOM } from 'jsdom';

const docsDir = path.join(__dirname, '../../docs');

async function processHTMLFile(filePath) {
  const html = await fs.readFile(filePath, 'utf-8');
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // Add docs-mode class
  document.documentElement.classList.add('docs-mode');
  document.body.classList.add('docs-mode');

  // Inject warning banner
  const mainContent = document.querySelector('main') || document.body;
  const banner = document.createElement('div');
  banner.className = 'docs-mode-banner';
  banner.innerHTML = `
    <h4>📖 Documentation Website</h4>
    <p>
      You're viewing the static documentation. Stream features require
      <a href="https://github.com/anthropics/claude-code" target="_blank">Claude Code CLI</a>
      to be installed locally.
      <a href="https://github.com/AskTinNguyen/ralph-cli#installation">Installation instructions →</a>
    </p>
  `;
  mainContent.insertBefore(banner, mainContent.firstChild);

  // Grey out stream features
  const streamElements = document.querySelectorAll(
    'a[href*="stream"], [data-feature="streams"], .stream-controls'
  );
  streamElements.forEach(el => {
    el.classList.add('cli-only');
    el.setAttribute('data-requires', 'cli');
  });

  // Add docs-mode.css link
  const head = document.querySelector('head');
  const cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = '/css/docs-mode.css';
  head.appendChild(cssLink);

  // Add docs-mode.js script
  const script = document.createElement('script');
  script.src = '/js/docs-mode.js';
  script.defer = true;
  document.body.appendChild(script);

  // Write modified HTML
  await fs.writeFile(filePath, dom.serialize());
}

async function processAllDocs() {
  const htmlFiles = await fs.readdir(path.join(docsDir, 'docs'));

  for (const file of htmlFiles) {
    if (file.endsWith('.html')) {
      const filePath = path.join(docsDir, 'docs', file);
      await processHTMLFile(filePath);
      console.log(`✅ Processed ${file}`);
    }
  }

  console.log('✨ Documentation prepared for deployment!');
}

processAllDocs().catch(console.error);
```

Run before deployment:

```bash
npm run build:static-docs
node ui/scripts/prepare-docs-deployment.js
```

---

## Complete Deployment Workflow

### Recommended: Vercel with Stream Disabling

```bash
# 1. Install dependencies
cd ui && npm install

# 2. Add build scripts to package.json
npm pkg set scripts.build:docs="node scripts/build-static-docs.js && node scripts/prepare-docs-deployment.js"

# 3. Create necessary scripts
mkdir -p ui/scripts
# (Copy build-static-docs.js and prepare-docs-deployment.js from above)

# 4. Create docs-mode assets
mkdir -p ui/public/css ui/public/js
# (Copy docs-mode.css and docs-mode.js from above)

# 5. Build and test locally
npm run build:docs
npx serve ../docs -p 8080

# 6. Create vercel.json
# (Copy configuration from Option 2)

# 7. Deploy to Vercel
npm i -g vercel
vercel login
vercel --prod

# 8. Configure custom domain (optional)
# In Vercel dashboard: Settings → Domains → Add docs.ralph-cli.com
```

---

## Testing Checklist

Before deploying:

- [ ] All documentation pages load correctly
- [ ] Stream features are visually greyed out
- [ ] Warning banner appears on all pages
- [ ] Clicking stream links shows helpful error message
- [ ] Navigation works (sidebar, breadcrumbs, links)
- [ ] Static assets load (CSS, JS, images)
- [ ] Mobile responsive design works
- [ ] Search functionality disabled/removed
- [ ] No API errors in console (or properly mocked)
- [ ] Custom domain DNS configured (if using)

---

## Maintenance

### Updating Documentation

**For GitHub Pages:**
```bash
# 1. Update markdown files
# 2. Rebuild static docs
cd ui && npm run build:docs

# 3. Commit and push
git add docs/
git commit -m "docs: Update documentation"
git push origin main
```

**For Vercel:**
```bash
# 1. Update markdown files
# 2. Push to main branch
git push origin main

# Vercel auto-deploys on push
```

### Monitoring

- **GitHub Pages:** Check Actions tab for build status
- **Vercel:** Check dashboard for deployment status and analytics
- **Cloudflare:** Check dashboard for traffic and performance

---

## Cost Analysis

| Service | Free Tier | Paid Plans Start At |
|---------|-----------|---------------------|
| **GitHub Pages** | 100 GB bandwidth/month, unlimited repos | N/A (always free for public repos) |
| **Vercel** | 100 GB bandwidth/month, 100 builds/month | $20/month (Pro) |
| **Cloudflare Pages** | Unlimited bandwidth, 500 builds/month | $20/month (Pages Pro) |

**Recommendation:** Start with GitHub Pages for pure static docs, or Vercel if you need Node.js server features.

---

## Next Steps

1. **Choose deployment option** (GitHub Pages recommended for simplest setup)
2. **Implement stream disabling** (CSS + warning banners)
3. **Test locally** (`npx serve docs -p 8080`)
4. **Deploy to production**
5. **Configure custom domain** (optional)
6. **Monitor and maintain**

---

## Support

- **GitHub Issues:** https://github.com/AskTinNguyen/ralph-cli/issues
- **Documentation:** This guide
- **Community:** GitHub Discussions (if enabled)
