# GitHub Pages Setup Guide

**Last Updated:** January 15, 2026

This guide walks you through enabling GitHub Pages auto-deployment for Ralph CLI documentation.

---

## 📋 Prerequisites

- GitHub repository with admin access
- Documentation built at least once locally (`cd ui && npm run build:docs`)
- `.github/workflows/deploy-docs.yml` committed to main branch

---

## 🚀 Step-by-Step Setup

### Step 1: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (top navigation bar)
3. In the left sidebar, click **Pages** (under "Code and automation")

### Step 2: Configure Source

In the **Build and deployment** section:

1. **Source:** Select `GitHub Actions` from the dropdown

   **Important:** Do NOT select "Deploy from a branch"

   Select the new "GitHub Actions" option which allows custom workflows.

2. That's it! No branch or folder selection needed with GitHub Actions.

### Step 3: Verify Workflow Permissions

1. Still in **Settings**, click **Actions** → **General** (left sidebar)
2. Scroll to **Workflow permissions**
3. Select **Read and write permissions**
4. Check ✅ **Allow GitHub Actions to create and approve pull requests**
5. Click **Save**

### Step 4: Trigger First Deployment

**Option A: Push to main**
```bash
# Make a small change (or use --allow-empty)
git commit --allow-empty -m "docs: Trigger initial deployment"
git push origin main
```

**Option B: Manual trigger**
1. Go to **Actions** tab
2. Click **Deploy Documentation** workflow
3. Click **Run workflow** dropdown
4. Click **Run workflow** button

### Step 5: Monitor Deployment

1. Go to **Actions** tab
2. Click on the running workflow
3. Watch the `build` and `deploy` jobs
4. Deployment takes ~2-3 minutes

### Step 6: Verify Deployment

Once complete:

1. In **Settings** → **Pages**, you'll see:
   ```
   ✅ Your site is live at https://<username>.github.io/ralph-cli/
   ```

2. Click the URL or visit manually:
   - Homepage: `https://<username>.github.io/ralph-cli/`
   - Docs: `https://<username>.github.io/ralph-cli/docs/`

3. Verify:
   - [ ] Warning banner appears
   - [ ] Stream features are greyed out
   - [ ] Navigation works
   - [ ] All pages load

---

## 🔧 Workflow Details

### What Happens on Push

The workflow (`deploy-docs.yml`) triggers when:

- Changes are pushed to `main` branch
- Changes affect documentation files:
  - `ui/public/docs/**`
  - `ui/public/css/**`
  - `ui/public/js/**`
  - `ui/scripts/**`
  - `*.md` files
  - Workflow files

### Build Process

1. **Checkout** - Clones repository
2. **Setup Node.js** - Installs Node.js 20
3. **Install dependencies** - Runs `npm ci` in ui/
4. **Build docs** - Runs `npm run build:docs`
5. **Verify** - Checks build output
6. **Upload** - Uploads docs/ as artifact
7. **Deploy** - Deploys to GitHub Pages

### Deployment Time

- **First deployment:** ~3-5 minutes
- **Subsequent deployments:** ~2-3 minutes
- **PR validation:** ~1-2 minutes (no deployment)

---

## 🎯 Custom Domain Setup (Optional)

### Step 1: Configure DNS

Add a CNAME record in your DNS provider:

```
docs.yoursite.com  →  <username>.github.io
```

### Step 2: Add CNAME to Build

Edit `ui/scripts/build-static-docs.js`:

```javascript
async function createCNAME() {
  await fs.writeFile(
    path.join(outputDir, 'CNAME'),
    'docs.yoursite.com'
  );
}
```

Or set environment variable:

```bash
RALPH_DOCS_DOMAIN=docs.yoursite.com
```

### Step 3: Configure in GitHub

1. Go to **Settings** → **Pages**
2. In **Custom domain**, enter: `docs.yoursite.com`
3. Click **Save**
4. Wait for DNS check (can take 24-48 hours)
5. Check ✅ **Enforce HTTPS**

---

## 📊 Monitoring & Status

### Check Deployment Status

**In GitHub:**
- **Actions** tab - Shows all workflow runs
- **Settings** → **Pages** - Shows current deployment status
- **Environments** tab - Shows deployment history

**Status Badge:**

Add to README.md:

```markdown
[![Deploy Docs](https://github.com/<username>/ralph-cli/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/<username>/ralph-cli/actions/workflows/deploy-docs.yml)
```

### View Deployment Logs

1. **Actions** tab
2. Click a workflow run
3. Click `build` or `deploy` job
4. Expand steps to see logs

---

## 🔍 Troubleshooting

### Issue: Workflow Not Triggering

**Check:**
- Workflow file is in `.github/workflows/deploy-docs.yml`
- File is committed to main branch
- Actions are enabled in repo settings
- File paths in `on.push.paths` match your changes

**Fix:**
```bash
# Verify file exists
ls -la .github/workflows/deploy-docs.yml

# Check if Actions are enabled
# Settings → Actions → General → "Allow all actions"

# Trigger manually
# Actions tab → Deploy Documentation → Run workflow
```

### Issue: Build Fails

**Common causes:**

1. **Missing dependencies**
   ```bash
   cd ui && npm ci
   ```

2. **fs-extra not installed**
   ```bash
   cd ui && npm install fs-extra
   ```

3. **Scripts not executable**
   ```bash
   chmod +x ui/scripts/*.js
   ```

**View error:**
- Go to Actions → failed workflow → build job → expand failed step

### Issue: 404 Page Not Found

**Causes:**
- Deployment hasn't propagated yet (wait 2-3 minutes)
- GitHub Pages not enabled
- Wrong URL (should end with `/docs/`)

**Fix:**
1. Go to **Settings** → **Pages**
2. Verify source is `GitHub Actions`
3. Check URL shown on Pages settings
4. Try URL with `/docs/` suffix

### Issue: Stream Features Still Work

**Cause:** Docs-mode not properly injected

**Fix:**
```bash
cd ui
npm run build:docs  # Rebuilds with docs-mode
```

**Verify:**
```bash
# Check if docs-mode.css exists
cat docs/css/docs-mode.css

# Check if injected in HTML
grep "docs-mode" docs/docs/index.html
```

### Issue: Changes Not Appearing

**Causes:**
- Browser cache
- CDN cache (GitHub Pages)
- Workflow didn't trigger

**Fix:**
1. Hard refresh: Ctrl+Shift+R (Windows/Linux) or Cmd+Shift+R (Mac)
2. Clear browser cache
3. Wait 2-3 minutes for CDN propagation
4. Check workflow ran: **Actions** tab

### Issue: Deployment Permissions Error

**Error:**
```
Error: Resource not accessible by integration
```

**Fix:**
1. **Settings** → **Actions** → **General**
2. **Workflow permissions** → Select **Read and write permissions**
3. Check ✅ **Allow GitHub Actions to create and approve pull requests**
4. **Save**
5. Re-run workflow

### Issue: Custom Domain Not Working

**Causes:**
- DNS not propagated (takes 24-48 hours)
- CNAME record incorrect
- HTTPS check failing

**Fix:**
1. Verify DNS:
   ```bash
   nslookup docs.yoursite.com
   # Should show: <username>.github.io
   ```

2. Wait 24-48 hours for propagation

3. Check CNAME file exists:
   ```bash
   cat docs/CNAME
   # Should contain: docs.yoursite.com
   ```

4. In **Settings** → **Pages**, verify custom domain is set

---

## 🔐 Security

### Repository Secrets (Not Needed)

GitHub Pages deployment doesn't require secrets. The workflow uses:
- `GITHUB_TOKEN` - Automatically provided by GitHub Actions

### Access Control

**Public documentation:**
- Anyone can view
- Only repo contributors can trigger deployments

**Private documentation:**
- Only users with repo access can view
- Requires GitHub Pro or organization account

---

## 📈 Advanced Configuration

### Deploy to Specific Environment

Edit workflow to add environment variables:

```yaml
- name: Build static documentation
  env:
    RALPH_DOCS_URL: https://docs.yoursite.com
    RALPH_DOCS_DOMAIN: docs.yoursite.com
  run: |
    cd ui
    npm run build:docs
```

### Cache Dependencies

Already configured! The workflow uses:

```yaml
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    cache: 'npm'
    cache-dependency-path: ui/package-lock.json
```

This speeds up builds by caching `node_modules`.

### Parallel Jobs

Current workflow runs:
1. `build` job (builds docs)
2. `deploy` job (deploys to Pages) - waits for build

To add testing:

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Test something
        run: npm test

  build:
    needs: test  # Wait for tests to pass
    runs-on: ubuntu-latest
    # ... existing steps
```

---

## 🎓 Best Practices

### 1. Test Locally First

Always build and test documentation locally before pushing:

```bash
cd ui
npm run build:docs
npx serve ../docs -p 8080
# Visit http://localhost:8080
```

### 2. Use PR Validation

The `validate-docs.yml` workflow automatically validates PRs:
- Builds documentation
- Checks critical files
- Verifies docs-mode injection
- Comments on PR with results

### 3. Monitor Deployments

- Check Actions tab after each push
- Set up notifications: **Settings** → **Notifications** → Watch → Custom → Actions

### 4. Keep Dependencies Updated

Update dependencies monthly:

```bash
cd ui
npm update
npm audit fix
```

### 5. Backup Old Versions

GitHub automatically keeps deployment history:
- **Environments** tab shows all deployments
- Rollback if needed

---

## 📚 Resources

- [GitHub Pages Documentation](https://docs.github.com/en/pages)
- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Ralph CLI Main Repo](https://github.com/AskTinNguyen/ralph-cli)
- [Deployment Guide](../DEPLOYMENT_GUIDE.md)

---

## ✅ Setup Checklist

- [ ] Repository has admin access
- [ ] Workflows committed to main branch
- [ ] GitHub Pages enabled (Source: GitHub Actions)
- [ ] Workflow permissions set (Read and write)
- [ ] First deployment triggered
- [ ] Deployment succeeded
- [ ] Documentation website accessible
- [ ] Warning banner appears
- [ ] Stream features greyed out
- [ ] Navigation works correctly
- [ ] Custom domain configured (if applicable)
- [ ] Status badge added to README (optional)

---

**Need Help?**
- [Open an Issue](https://github.com/AskTinNguyen/ralph-cli/issues)
- [View Workflow Runs](https://github.com/AskTinNguyen/ralph-cli/actions)
