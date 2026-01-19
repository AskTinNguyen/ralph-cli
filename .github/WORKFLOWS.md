# GitHub Actions Workflows

Quick reference for Ralph CLI documentation workflows.

---

## 📋 Available Workflows

### 1. **Deploy Documentation** (`deploy-docs.yml`)

**Purpose:** Build and deploy documentation to GitHub Pages

**Triggers:**
- Push to `main` branch (affecting docs files)
- Manual trigger (workflow_dispatch)

**Jobs:**
- `build` - Builds static documentation
- `deploy` - Deploys to GitHub Pages

**Runtime:** ~2-3 minutes

**Usage:**
```bash
# Automatic (on push)
git push origin main

# Manual trigger
# Go to Actions → Deploy Documentation → Run workflow
```

---

### 2. **Validate Documentation** (`validate-docs.yml`)

**Purpose:** Validate documentation builds on PRs (no deployment)

**Triggers:**
- Pull requests affecting docs files

**Jobs:**
- `validate` - Builds docs and runs checks

**Runtime:** ~1-2 minutes

**Checks:**
- ✅ Build succeeds
- ✅ Critical files present
- ✅ Docs-mode properly injected
- ✅ Warning banners added
- ✅ Link validation (if script exists)

**Usage:**
```bash
# Automatic on PR creation/update
# Comments build report on PR
```

---

## 🎯 Quick Commands

### Trigger Deployment

```bash
# Option 1: Make a change and push
git add .
git commit -m "docs: Update documentation"
git push origin main

# Option 2: Empty commit (just to trigger)
git commit --allow-empty -m "docs: Trigger deployment"
git push origin main

# Option 3: Manual (via GitHub UI)
# Actions → Deploy Documentation → Run workflow
```

### View Workflow Status

```bash
# Using GitHub CLI (gh)
gh workflow view deploy-docs.yml
gh run list --workflow=deploy-docs.yml

# View latest run
gh run view --web
```

### View Logs

```bash
# Using GitHub CLI
gh run view <run-id> --log

# Or via UI
# Actions → Click workflow run → Click job → Expand steps
```

### Cancel Running Workflow

```bash
# Using GitHub CLI
gh run cancel <run-id>

# Or via UI
# Actions → Click workflow run → Cancel workflow
```

---

## 🔧 Workflow Configuration

### File Paths Watched

Both workflows monitor these paths:

```yaml
paths:
  - 'ui/public/docs/**'
  - 'ui/public/css/**'
  - 'ui/public/js/**'
  - 'ui/scripts/**'
  - '*.md'
  - '.github/workflows/**'
```

**What this means:**
- Changes to these paths trigger workflows
- Changes to other files (e.g., `bin/`, `.agents/`) don't trigger
- Root markdown files (README.md, CLAUDE.md, etc.) trigger workflows

### Modify Watched Paths

Edit the workflow file:

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'ui/public/docs/**'
      - 'your/custom/path/**'  # Add custom path
```

---

## 📊 Workflow Outputs

### Deploy Documentation

**Outputs:**
- GitHub Pages URL (in deployment job)
- Commit comment with deployment URL
- Build statistics (file count, size)

**Artifacts:**
- `github-pages` - Uploaded docs/ directory (retained for 90 days)

### Validate Documentation

**Outputs:**
- PR comment with build report
- Build statistics
- Validation check results

**Artifacts:**
- None (validation only, no deployment)

---

## 🛠️ Local Testing

### Test Build Process Locally

```bash
# Simulate workflow build
cd ui
npm ci                    # Install dependencies (like CI)
npm run build:docs        # Build docs

# Verify output
ls -la ../docs/
find ../docs -type f | wc -l
du -sh ../docs/
```

### Test with act (GitHub Actions locally)

Install [act](https://github.com/nektos/act):

```bash
brew install act  # macOS
# or
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash

# Run workflow locally
act -W .github/workflows/deploy-docs.yml

# Run specific job
act -j build -W .github/workflows/deploy-docs.yml

# Use specific secrets
act -s GITHUB_TOKEN=<token>
```

---

## 🔐 Permissions

### Required Permissions

Both workflows require:

```yaml
permissions:
  contents: write      # Push to gh-pages branch
  pages: write         # Deploy to Pages
  id-token: write      # OIDC token for deployment
```

### Repository Settings

**Settings → Actions → General:**
- ✅ **Workflow permissions:** Read and write permissions
- ✅ **Allow GitHub Actions to create and approve pull requests**

---

## 🚨 Troubleshooting

### Workflow Not Running

**Check:**
```bash
# Verify workflow file exists
ls -la .github/workflows/deploy-docs.yml

# Check syntax
# Use GitHub's workflow validator or act
act -l
```

**Common issues:**
- YAML syntax error
- File not committed to main
- Actions disabled in repo settings
- Paths don't match changed files

### Build Failing

**Debug steps:**

1. **View logs:**
   ```bash
   gh run view --log
   ```

2. **Test locally:**
   ```bash
   cd ui
   npm ci
   npm run build:docs
   ```

3. **Check for errors in:**
   - `ui/scripts/build-static-docs.js`
   - `ui/scripts/prepare-docs-deployment.js`
   - `ui/package.json` (scripts section)

### Deployment Failing

**Common causes:**
- Permissions not set (see above)
- GitHub Pages not enabled
- Deployment quota exceeded (rare)

**Fix:**
```bash
# Re-run deployment job only (not entire workflow)
# Actions → Click workflow → Re-run jobs → deploy
```

---

## 📈 Performance Optimization

### Current Optimizations

1. **Dependency caching:**
   ```yaml
   - uses: actions/setup-node@v4
     with:
       cache: 'npm'
   ```
   Speeds up installs by ~30 seconds

2. **Path filtering:**
   Only runs when docs files change

3. **Concurrency control:**
   ```yaml
   concurrency:
     group: "pages"
     cancel-in-progress: true
   ```
   Cancels old deployments when new one starts

### Additional Optimizations

**Add build caching:**

```yaml
- name: Cache build output
  uses: actions/cache@v4
  with:
    path: docs/
    key: ${{ runner.os }}-docs-${{ hashFiles('ui/**') }}
```

**Parallelize jobs:**

```yaml
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - run: npm run lint

  build:
    needs: lint  # Only build after lint passes
    runs-on: ubuntu-latest
    # ... build steps
```

---

## 📝 Workflow Maintenance

### Update Dependencies

Dependabot automatically updates workflow dependencies. Or manually:

```yaml
# Update actions versions
- uses: actions/checkout@v4  # Check for v5
- uses: actions/setup-node@v4  # Check for v5
```

### Monitor Workflow Usage

**Settings → Actions → General:**
- View workflow run minutes (2,000 free/month for public repos)
- View storage usage (500 MB free)

### Workflow Retention

**Default retention:** 90 days

**Change retention:**
```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: docs/
          retention-days: 30  # Custom retention
```

---

## 🎓 Best Practices

1. **Test locally first:** Always run `npm run build:docs` before pushing

2. **Use PR validation:** Let `validate-docs.yml` catch issues before merging

3. **Monitor deployments:** Check Actions tab after pushing

4. **Version workflow actions:** Pin to major version (e.g., `@v4` not `@latest`)

5. **Document changes:** Add comments to workflow files for complex logic

6. **Keep workflows simple:** Each workflow should do one thing well

7. **Use concurrency control:** Prevent duplicate deployments

8. **Cache dependencies:** Speed up builds with caching

---

## 📚 Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [Workflow Syntax](https://docs.github.com/en/actions/reference/workflow-syntax-for-github-actions)
- [GitHub Pages Actions](https://github.com/actions/deploy-pages)
- [Setup Guide](../documentation/DEPLOYMENT_GUIDE.md)

---

## ✅ Workflow Health Checklist

- [ ] Workflows trigger on correct events
- [ ] Build completes successfully
- [ ] Deployment succeeds
- [ ] Permissions properly set
- [ ] Dependencies cached
- [ ] Logs are clear and helpful
- [ ] Error handling in place
- [ ] Documentation up to date
- [ ] Status badges working (if added)
- [ ] Monitoring in place

---

**Last Updated:** January 15, 2026
