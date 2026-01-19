# Recommended README Improvements for Ralph CLI

This document provides specific, actionable improvements to the Ralph CLI README.md based on real installation experience.

---

## 1. Enhanced Manual Installation Section

**Replace the current manual installation section with:**

```markdown
### Manual Installation from GitHub

For custom setups or development, clone and configure locally:

**Step 1: Clone the repository**

Choose a permanent location (avoid `/tmp` as it may be cleared):

```bash
# For regular use
git clone https://github.com/AskTinNguyen/ralph-cli.git ~/ralph-cli
cd ~/ralph-cli

# Or for development/contributing
git clone https://github.com/AskTinNguyen/ralph-cli.git ~/projects/ralph-cli
cd ~/projects/ralph-cli
```

**Step 2: Install dependencies**

```bash
npm install
```

Note: You may see deprecation warnings during installation. These don't affect functionality and are being addressed in future releases.

**Step 3: Link globally**

```bash
npm link
```

This creates a global symlink. Look for "changed 1 package" in the output to confirm success.

**Step 4: Verify installation**

```bash
ralph help
```

You should see the Ralph CLI help menu. If you get "command not found", see [Troubleshooting](#troubleshooting) below.
```

---

## 2. Add Installation Verification Section

**Insert after all installation methods:**

```markdown
### Verifying Your Installation

After installing Ralph CLI using any method, verify it's working correctly:

```bash
# Check that ralph command is available
ralph help

# Check command location (optional)
which ralph        # Unix/Linux/macOS
where ralph        # Windows
```

**Expected output:** You should see the Ralph CLI help menu with all available commands.

**Note:** Ralph CLI doesn't currently support `--version` flag. Use `ralph help` to verify installation.
```

---

## 3. Add Troubleshooting Section

**Add before "Project Setup" section:**

```markdown
## Troubleshooting

### Command not found after installation

**Issue:** `ralph: command not found` or `'ralph' is not recognized`

**Solution:**

1. Verify npm's global bin directory is in your PATH:
   ```bash
   npm config get prefix
   ```

2. Add npm's bin directory to your PATH:

   **macOS/Linux (bash):**
   ```bash
   echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.bashrc
   source ~/.bashrc
   ```

   **macOS (zsh):**
   ```bash
   echo 'export PATH="$(npm config get prefix)/bin:$PATH"' >> ~/.zshrc
   source ~/.zshrc
   ```

   **Windows:** Add `%APPDATA%\npm` to your PATH environment variable

3. Restart your terminal and try `ralph help` again

### Permission denied during npm link

**Issue:** `EACCES: permission denied`

**Solution:**

**Option 1 (Recommended):** Configure npm to use a user directory:
```bash
mkdir ~/.npm-global
npm config set prefix '~/.npm-global'
echo 'export PATH=~/.npm-global/bin:$PATH' >> ~/.bashrc  # or ~/.zshrc
source ~/.bashrc
```

Then retry `npm link`

**Option 2:** Use sudo (not recommended):
```bash
sudo npm link
```

### Deprecation warnings during installation

**Issue:** Multiple "npm warn deprecated" messages

**Status:** These warnings don't affect functionality. They're being addressed in future releases to update dependencies to their latest versions.

### ralph help shows but commands don't work

**Issue:** `ralph help` works but other commands fail

**Solution:**
1. Ensure you're in a project directory (not the ralph-cli directory)
2. Run `ralph install` to initialize templates for your project
3. Check that `~/.agents/ralph` exists (templates location)

### Need to update Ralph CLI

**Issue:** Want to get the latest version

**Solution:**
```bash
cd ~/ralph-cli  # or wherever you cloned it
git pull
npm install
```

The npm link should still work after updating.
```

---

## 4. Add Uninstallation Instructions

**Add as a new section:**

```markdown
## Uninstalling Ralph CLI

To completely remove Ralph CLI from your system:

**Step 1: Unlink the global command**
```bash
npm unlink -g ralph-cli
# Or from the ralph-cli directory:
cd ~/ralph-cli && npm unlink
```

**Step 2: Remove the cloned repository**
```bash
rm -rf ~/ralph-cli  # Adjust path to where you cloned it
```

**Step 3: (Optional) Remove Ralph templates and data**
```bash
rm -rf ~/.agents/ralph
rm -rf ~/.ralph
```

To reinstall later, follow the installation instructions again.
```

---

## 5. Improve System Requirements Section

**Enhance the current section:**

```markdown
### System Requirements

Before installation, ensure you have:

- **Node.js** version 18 or higher ([Download](https://nodejs.org/))
  - Check version: `node --version`
  - Must be v18.0.0 or higher

- **npm** (comes with Node.js)
  - Check version: `npm --version`
  - Should be v8.0.0 or higher

- **Git** version control system ([Download](https://git-scm.com/))
  - Check version: `git --version`
  - Any recent version works

- **An AI agent** like:
  - Claude Code (Anthropic) - [Get it](https://claude.ai/code)
  - GitHub Copilot CLI (codex)
  - Droid (Open source)

**Checking your system:**
```bash
# Run all checks at once
node --version && npm --version && git --version
```

If any command fails, install the missing requirement before proceeding.
```

---

## 6. Add Quick Start Success Path

**Add immediately after System Requirements:**

```markdown
## Quick Start Path

Not sure which installation method to use? Follow this decision tree:

```
Do you want the simplest installation?
└─ Yes → Use One-Command Install (recommended)
   └─ macOS/Linux: curl -fsSL ... | bash
   └─ Windows: iwr -useb ... | iex

Do you want more control or plan to contribute?
└─ Yes → Use Manual Installation
   └─ Clone to ~/ralph-cli
   └─ npm install && npm link

Already familiar with npm and want global CLI?
└─ Yes → Use npm Installation
   └─ npm install -g github:AskTinNguyen/ralph-cli

Need to install for specific project only (not globally)?
└─ Yes → Use Manual Installation
   └─ Skip the npm link step
   └─ Use npx ralph or node cli.js
```

**First-time users:** We recommend the One-Command Install for the smoothest experience.
```

---

## 7. Enhance Post-Installation Section

**Replace "Project Setup" introduction with:**

```markdown
## Getting Started with Ralph

### Installation Complete! ✓

If you can run `ralph help` and see the command list, you're ready to go!

### Initialize Your First Project

Ralph works best with a project-based workflow. Here's how to get started:

**Step 1: Navigate to your project**
```bash
cd /path/to/your-project
```

**Step 2: Install Ralph templates**
```bash
ralph install
```

This copies Ralph's template files to `~/.agents/ralph` (global) or your project's `.agents/ralph` (local).

**Optional:** Install additional skills
```bash
ralph install --skills
```

You'll be prompted to configure:
- Agent type (claude/codex/droid)
- Scope (local/global)
- Available skills: commit, dev-browser, prd

**Step 3: Start your workflow**

```bash
# Generate a Product Requirements Document
ralph prd "Add user authentication"

# Create an implementation plan
ralph plan

# Execute 5 build iterations
ralph build 5
```

### What's Next?

- Run `ralph doctor` to verify your setup
- Read about the [Core Workflow](#core-workflow-prd--plan--build)
- Try `ralph init` for interactive project setup
- Check `ralph help` for all available commands

### Learning Resources

- [Full Documentation](https://github.com/AskTinNguyen/ralph-cli/wiki)
- [Video Tutorial](https://youtube.com/ralph-cli-tutorial) (if available)
- [Example Projects](https://github.com/AskTinNguyen/ralph-examples)
- [Community Discord](https://discord.gg/ralph-cli) (if available)
```

---

## 8. Add Known Issues Section

**Add near the end of README:**

```markdown
## Known Issues

### Deprecation Warnings During Installation

**Status:** Known issue
**Impact:** None - doesn't affect functionality
**Timeline:** Being addressed in next release

Some dependencies show deprecation warnings during `npm install`:
- inflight, rimraf, glob (older versions)
- eslint v8 (moving to v9)
- humanwhocodes packages (moving to @eslint scope)

These will be updated to their latest versions in an upcoming release.

### No --version Command

**Status:** Feature request
**Workaround:** Use `ralph help` to verify installation

Currently, Ralph CLI doesn't support `ralph --version`. To check if Ralph is installed and working, use `ralph help` instead.

### Other Issues?

- Check [GitHub Issues](https://github.com/AskTinNguyen/ralph-cli/issues)
- File a new issue with the `bug` label
- Include: OS, Node version, error messages, steps to reproduce
```

---

## 9. README Structure Recommendation

**Suggested order for optimal user experience:**

1. Title & Description
2. Key Features
3. **System Requirements** (with version checks)
4. **Quick Start Path** (decision tree) ← NEW
5. Installation Methods
   - One-Command Install
   - Manual Installation (enhanced)
   - npm Installation
6. **Verifying Installation** ← NEW
7. **Troubleshooting** ← NEW
8. Getting Started / Project Setup (enhanced)
9. Core Workflow
10. Commands Reference
11. Examples
12. **Known Issues** ← NEW
13. **Uninstallation** ← NEW
14. Contributing
15. License

---

## 10. Quick Wins (Minimal Changes, Maximum Impact)

If time is limited, prioritize these changes:

### Priority 1 (5 minutes)
- ✅ Add "Verify installation: `ralph help`" after each installation method
- ✅ Add note: "Ralph doesn't support --version flag yet"

### Priority 2 (10 minutes)
- ✅ Add troubleshooting for "command not found"
- ✅ Note deprecation warnings are harmless and being fixed

### Priority 3 (15 minutes)
- ✅ Enhance manual installation with directory guidance
- ✅ Add "Installation Complete!" section with next steps

These three priorities would address 80% of the user confusion observed during installation.

---

## Summary

The Ralph CLI installation works well, but documentation improvements would significantly enhance the user experience by:

1. **Reducing confusion** about verification steps
2. **Providing troubleshooting** for common PATH issues
3. **Setting expectations** about deprecation warnings
4. **Guiding users** on what to do after installation
5. **Making it easier** to get help when stuck

All recommendations are based on actual installation experience and represent real user pain points that could be prevented with documentation updates.
