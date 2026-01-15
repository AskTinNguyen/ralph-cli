# Ralph CLI - GitHub Configuration

This directory contains GitHub-specific configuration files, workflows, and documentation.

---

## 📂 Directory Structure

```
.github/
├── workflows/              # GitHub Actions workflows
│   ├── deploy-docs.yml     # 🚀 Deploy documentation to GitHub Pages
│   ├── validate-docs.yml   # ✅ Validate docs on PRs
│   ├── ci.yml              # CI pipeline (tests, linting)
│   ├── release.yml         # Release automation
│   └── ralph-example.yml   # Example workflow
├── PAGES_SETUP.md          # 📖 GitHub Pages setup guide
├── WORKFLOWS.md            # 📋 Workflows quick reference
└── README.md               # This file
```

---

## 🚀 Quick Start

### Deploy Documentation to GitHub Pages

**1. Enable GitHub Pages:**

Go to **Settings** → **Pages** → Source: **GitHub Actions**

**2. Set Permissions:**

Go to **Settings** → **Actions** → **General** → **Workflow permissions** → **Read and write permissions**

**3. Trigger Deployment:**

```bash
git commit --allow-empty -m "docs: Initial deployment"
git push origin main
```

**4. Access Your Documentation:**

`https://<username>.github.io/ralph-cli/docs/`

📖 **Full Setup Guide:** [PAGES_SETUP.md](PAGES_SETUP.md)

---

## 🔧 Workflows

### Documentation Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| **Deploy Documentation** | `deploy-docs.yml` | Push to main, Manual | Builds and deploys docs to GitHub Pages |
| **Validate Documentation** | `validate-docs.yml` | Pull requests | Validates docs build on PRs (no deploy) |

### Other Workflows

| Workflow | File | Trigger | Purpose |
|----------|------|---------|---------|
| **CI** | `ci.yml` | Push, PR | Runs tests and linting |
| **Release** | `release.yml` | Tag push | Creates GitHub releases |
| **Example** | `ralph-example.yml` | Manual | Example workflow template |

📋 **Workflows Reference:** [WORKFLOWS.md](WORKFLOWS.md)

---

## 📊 Workflow Status

Add these badges to your README.md:

```markdown
[![Deploy Docs](https://github.com/<username>/ralph-cli/actions/workflows/deploy-docs.yml/badge.svg)](https://github.com/<username>/ralph-cli/actions/workflows/deploy-docs.yml)
[![CI](https://github.com/<username>/ralph-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/<username>/ralph-cli/actions/workflows/ci.yml)
```

---

## 🛠️ Customization

### Modify Deployment Workflow

Edit `workflows/deploy-docs.yml`:

```yaml
# Change Node.js version
- name: Setup Node.js
  uses: actions/setup-node@v4
  with:
    node-version: '20'  # Change to '18' or '22'

# Add custom build steps
- name: Custom step
  run: echo "Custom build step"
```

### Add New Workflow

1. Create `workflows/your-workflow.yml`
2. Define triggers:
   ```yaml
   on:
     push:
       branches: [main]
   ```
3. Add jobs and steps
4. Commit and push

### Disable Workflow

**Option 1: Via GitHub UI**
- Actions → Select workflow → ⋯ → Disable workflow

**Option 2: Via file**
- Rename `workflow.yml` to `workflow.yml.disabled`
- Or move to different directory

---

## 🔐 Security

### Secrets

No secrets required for documentation deployment!

GitHub automatically provides:
- `GITHUB_TOKEN` - Used for deployment

### Permissions

Required repository permissions:
- ✅ **Contents:** Write
- ✅ **Pages:** Write
- ✅ **Pull requests:** Write (for PR comments)

### Best Practices

1. **Never commit secrets** to workflow files
2. **Use repository secrets** for sensitive data (Settings → Secrets)
3. **Restrict workflow permissions** to minimum required
4. **Review PR workflow changes** carefully
5. **Keep actions updated** (Dependabot enabled by default)

---

## 📈 Monitoring

### View Workflow Runs

**Via GitHub UI:**
1. Go to **Actions** tab
2. Select workflow from left sidebar
3. View run history and logs

**Via GitHub CLI:**
```bash
# Install GitHub CLI
brew install gh  # macOS
# or visit: https://cli.github.com/

# View workflow runs
gh workflow view deploy-docs.yml

# List recent runs
gh run list --workflow=deploy-docs.yml

# View specific run
gh run view <run-id> --log
```

### Notifications

**Enable notifications:**
1. **Watch** button (top right of repo)
2. Select **Custom**
3. Check **Actions**
4. Choose notification method (email, web, mobile)

---

## 🚨 Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Workflow not triggering | Check file paths, ensure Actions enabled |
| Build failing | Run `cd ui && npm run build:docs` locally |
| Deployment failing | Verify Pages enabled, check permissions |
| 404 after deployment | Wait 2-3 minutes, check URL ends with `/docs/` |
| Permission denied | Set workflow permissions to Read and write |

📖 **Full Troubleshooting Guide:** [PAGES_SETUP.md](PAGES_SETUP.md#-troubleshooting)

---

## 📚 Documentation

- [PAGES_SETUP.md](PAGES_SETUP.md) - Complete GitHub Pages setup guide
- [WORKFLOWS.md](WORKFLOWS.md) - Workflow quick reference and commands
- [GitHub Actions Docs](https://docs.github.com/en/actions) - Official documentation
- [GitHub Pages Docs](https://docs.github.com/en/pages) - Pages documentation

---

## ✅ Setup Checklist

**GitHub Pages Deployment:**
- [ ] Workflows committed to main branch
- [ ] GitHub Pages enabled (Source: GitHub Actions)
- [ ] Workflow permissions set (Read and write)
- [ ] First deployment triggered and succeeded
- [ ] Documentation accessible at GitHub Pages URL
- [ ] Warning banner appears on docs pages
- [ ] Stream features properly greyed out

**Optional:**
- [ ] Custom domain configured
- [ ] Status badges added to README
- [ ] Notifications enabled
- [ ] Monitoring dashboard set up

---

## 🆘 Support

- **Setup Issues:** See [PAGES_SETUP.md](PAGES_SETUP.md)
- **Workflow Issues:** See [WORKFLOWS.md](WORKFLOWS.md)
- **General Issues:** [GitHub Issues](https://github.com/AskTinNguyen/ralph-cli/issues)
- **GitHub Actions Support:** [GitHub Community](https://github.community)

---

**Last Updated:** January 15, 2026
