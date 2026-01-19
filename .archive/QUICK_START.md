# GitHub Pages Deployment - Quick Start Card

⏱️ **Total Time:** 5 minutes

---

## 🚀 Deploy in 3 Steps

### 1. Enable GitHub Pages (30 seconds)

```
Settings → Pages → Source: GitHub Actions
```

### 2. Set Permissions (30 seconds)

```
Settings → Actions → General
→ Workflow permissions
→ Read and write permissions ✅
→ Save
```

### 3. Trigger Deployment (4 minutes)

```bash
git commit --allow-empty -m "docs: Deploy documentation"
git push origin main
```

**Monitor:** Actions tab → Deploy Documentation

**URL:** `https://<username>.github.io/ralph-cli/docs/`

---

## 📋 What's Included

✅ **Auto-deploy** - Push to main = auto-deploy
✅ **PR validation** - Validates docs on PRs
✅ **Stream disabling** - CLI features greyed out
✅ **Warning banners** - Installation instructions
✅ **SEO optimized** - Sitemap, robots.txt, meta tags

---

## 📖 Full Guides

- **Setup:** [PAGES_SETUP.md](PAGES_SETUP.md)
- **Workflows:** [WORKFLOWS.md](WORKFLOWS.md)
- **Complete:** [../DEPLOYMENT_GUIDE.md](../DEPLOYMENT_GUIDE.md)
- **Summary:** [../DEPLOYMENT_SUMMARY.md](../DEPLOYMENT_SUMMARY.md)

---

## 🆘 Troubleshooting

**Workflow not running?**
→ Check Actions enabled: Settings → Actions

**Build failing?**
→ Test locally: `cd ui && npm run build:docs`

**404 error?**
→ Wait 2-3 minutes, use `/docs/` suffix

**Full troubleshooting:** [PAGES_SETUP.md](PAGES_SETUP.md#-troubleshooting)

---

**Last Updated:** January 15, 2026
