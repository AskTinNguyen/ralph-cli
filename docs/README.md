# Ralph CLI Documentation - Standalone Website

This directory contains the **standalone documentation website** for Ralph CLI, built for deployment to static hosting services.

## 🎯 What's Inside

This is a fully self-contained documentation website that:

- ✅ **Works without Claude Code CLI** - All stream features are appropriately disabled
- ✅ **Fully static** - Can be hosted on GitHub Pages, Vercel, Cloudflare, etc.
- ✅ **SEO optimized** - Includes sitemap.xml, robots.txt, meta tags
- ✅ **Responsive** - Mobile-friendly design
- ✅ **Fast** - No server required, pure static HTML/CSS/JS

## 📦 Contents

```
docs/
├── index.html              # Redirect to /docs/
├── .nojekyll               # Disable Jekyll (GitHub Pages)
├── sitemap.xml             # SEO sitemap
├── robots.txt              # Search engine instructions
├── build-info.json         # Build metadata
├── docs/                   # Documentation pages
│   ├── index.html          # Documentation home
│   ├── tutorial.html       # Getting started guide
│   ├── commands.html       # Command reference
│   ├── examples.html       # Usage examples
│   ├── tips.html           # Best practices
│   ├── troubleshooting.html
│   ├── streams.html        # Streams (with CLI warnings)
│   ├── integration.html    # MCP integrations
│   └── agent-guide.html    # Agent reference
├── css/                    # Stylesheets
│   ├── rams-ui.css
│   ├── docs-theme.css
│   └── docs-mode.css       # ⚠️ Greys out CLI features
├── js/                     # JavaScript
│   ├── htmx.min.js
│   ├── marked.min.js
│   └── docs-mode.js        # ⚠️ Disables CLI features
└── *.md                    # Root documentation

Total: 44 files, ~9 MB
```

## 🚀 Quick Test

Test the documentation locally:

```bash
# Install serve (if not already installed)
npm install -g serve

# Serve the docs directory
serve docs -p 8080

# Open in browser
open http://localhost:8080
```

## 🔒 How Stream Features Are Disabled

### 1. **CSS (Visual)**

File: `css/docs-mode.css`

- Greys out all stream-related elements (opacity: 0.4)
- Adds "⚠️ Requires Claude Code CLI" tooltip on hover
- Displays prominent warning banner at top of pages
- Disables pointer events (clicks don't work)

### 2. **JavaScript (Functional)**

File: `js/docs-mode.js`

- Detects if running on non-localhost domain
- Marks all `[data-requires="cli"]` elements as disabled
- Blocks HTMX API requests
- Mocks `/api/*` endpoints to return 503 errors
- Prevents wizard overlays from opening
- Shows alert message when CLI features are clicked

### 3. **Build-Time (HTML)**

Script: `ui/scripts/prepare-docs-deployment.js`

- Adds `docs-mode` class to `<html>` and `<body>`
- Injects warning banners at top of each page
- Adds `cli-only` class to stream elements
- Injects docs-mode CSS and JavaScript links
- Special warning on `streams.html` page

## 🌐 Deployment Options

### Option 1: GitHub Pages (Simplest)

**Setup:**
1. Go to repo **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **gh-pages** / **root**
4. Folder: Select `/docs`
5. Save

**Auto-deploy:** GitHub Actions workflow at `.github/workflows/deploy-docs.yml`

**URL:** `https://<username>.github.io/ralph-cli/docs/`

---

### Option 2: Vercel (Most Flexible)

**Setup:**
```bash
npm install -g vercel
vercel login
vercel --prod
```

**Configuration:** `vercel.json` at repo root

**URL:** `https://ralph-cli-docs.vercel.app`

---

### Option 3: Cloudflare Pages

**Setup:**
1. Connect GitHub repo at https://dash.cloudflare.com/
2. Build command: `cd ui && npm run build:docs`
3. Output directory: `docs`
4. Deploy

**URL:** `https://ralph-cli-docs.pages.dev`

---

## 🛠️ Rebuilding Documentation

To rebuild the documentation after making changes:

```bash
# 1. Navigate to ui directory
cd ui

# 2. Install dependencies (first time only)
npm install

# 3. Build static docs + inject docs-mode
npm run build:docs

# 4. Test locally
npx serve ../docs -p 8080
```

**Build steps:**
- `npm run build:static-docs` - Copies files, generates sitemap, robots.txt
- `node scripts/prepare-docs-deployment.js` - Injects docs-mode CSS/JS, adds warnings

## 📝 File Overview

### Key Files Created

| File | Purpose |
|------|---------|
| `ui/public/css/docs-mode.css` | Greys out stream features |
| `ui/public/js/docs-mode.js` | Disables CLI functionality |
| `ui/scripts/build-static-docs.js` | Builds static site |
| `ui/scripts/prepare-docs-deployment.js` | Injects docs-mode |
| `DEPLOYMENT_GUIDE.md` | Complete deployment guide |

### Modified Files

| File | Changes |
|------|---------|
| `ui/package.json` | Added `build:docs` script |
| All HTML pages in `docs/` | Injected docs-mode assets, warning banners |

## 🔍 Testing Checklist

Before deploying:

- [ ] Run `npm run build:docs` successfully
- [ ] Test locally with `npx serve docs -p 8080`
- [ ] Verify warning banner appears on all pages
- [ ] Check stream links are greyed out
- [ ] Click stream links → see warning message
- [ ] Verify navigation works (sidebar, breadcrumbs)
- [ ] Test on mobile (responsive design)
- [ ] Check browser console for errors
- [ ] Verify all CSS/JS assets load
- [ ] Test search functionality (if implemented)

## 📚 Documentation

See `DEPLOYMENT_GUIDE.md` for:
- Detailed deployment instructions
- Custom domain setup
- CI/CD configuration
- Troubleshooting
- Cost analysis
- Monitoring setup

## 🆘 Troubleshooting

**Issue:** Stream features not greyed out
- **Fix:** Run `npm run build:docs` again (ensures docs-mode.css is injected)

**Issue:** Warning banner not showing
- **Fix:** Check if `docs-mode-banner` class exists in HTML

**Issue:** Clicking streams still works
- **Fix:** Verify `docs-mode.js` is loaded (check browser console)

**Issue:** CSS not loading
- **Fix:** Check paths in HTML are absolute (`/css/...` not `css/...`)

**Issue:** Build fails
- **Fix:** Ensure `fs-extra` is installed: `npm install fs-extra`

## 📞 Support

- **Issues:** https://github.com/AskTinNguyen/ralph-cli/issues
- **Full Guide:** [DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md)
- **Main Repo:** https://github.com/AskTinNguyen/ralph-cli

---

**Built with:** Node.js, JSDOM, fs-extra
**Last updated:** January 15, 2026
**Version:** 1.0.0
