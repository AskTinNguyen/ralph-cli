# Manual Testing Guide for Ralph CLI Installation

This guide provides step-by-step instructions for manually testing the Ralph CLI installation flow, including the new UI setup feature.

## Prerequisites

- Clean test environment (VM, Docker container, or fresh directory)
- Git installed
- Node.js 18+ installed
- npm installed

## Test Scenarios

### Scenario 1: Fresh Global Installation (Simulated)

**Goal**: Test the global installation script

```bash
# 1. Create test directory
mkdir -p /tmp/ralph-test && cd /tmp/ralph-test

# 2. Clone Ralph CLI
git clone https://github.com/AskTinNguyen/ralph-cli.git
cd ralph-cli

# 3. Install dependencies
npm install

# 4. Link globally (or add to PATH)
npm link

# 5. Verify installation
ralph --version
ralph help
```

**Expected Results**:
- ✅ All dependencies install successfully
- ✅ ralph command is available
- ✅ Version and help commands work

---

### Scenario 2: Project Installation with UI Setup

**Goal**: Test `ralph install` with interactive UI setup

```bash
# 1. Create test project
mkdir -p /tmp/test-project && cd /tmp/test-project

# 2. Initialize git
git init
git config user.name "Test User"
git config user.email "test@example.com"

# 3. Run ralph install
ralph install
```

**Interactive Prompts You'll See**:

1. **Skills Installation Prompt**
   ```
   ? Install skills (commit + prd)? (Y/n)
   ```
   - **Action**: Press `Y` or Enter to accept
   - **Verify**: Check for `.codex/skills` or `.claude/skills` directory

2. **UI Installation Prompt** (NEW)
   ```
   ? Install Ralph UI dashboard? (Y/n)
   ```
   - **Action**: Press `Y` or Enter to accept
   - **Expected**: See spinner: "Installing UI dependencies (this may take 1-2 minutes)..."
   - **Verify**: Check for UI installation success message

3. **Auto-Speak Setup Prompt**
   ```
   ? Show auto-speak setup instructions? (Y/n)
   ```
   - **Action**: Press `N` to skip (or `Y` to see instructions)

**Expected Results**:
- ✅ `.agents/ralph` directory created with all templates
- ✅ Skills installed (if accepted)
- ✅ UI dependencies installed in `<ralph-cli>/ui/node_modules`
- ✅ Clear success messages and next steps shown

---

### Scenario 3: Test UI Server Startup

**Goal**: Verify the UI server starts correctly after installation

```bash
# 1. Start UI server
ralph ui

# Expected output:
# [INFO] Starting Ralph UI server on port 3000...
# Server running at http://localhost:3000
```

**In another terminal**:
```bash
# 2. Test API endpoint
curl http://localhost:3000/api/status

# Expected: {"status":"ok"}
```

**In browser**:
```bash
# 3. Open browser (or use ralph gui)
open http://localhost:3000
# OR
ralph gui
```

**Verify UI Pages**:
- [ ] Homepage loads
- [ ] PRD list page works
- [ ] Logs page accessible
- [ ] No console errors

**Stop the server**:
- Press `Ctrl+C` in the terminal running `ralph ui`

**Expected Results**:
- ✅ Server starts on port 3000
- ✅ API endpoint responds
- ✅ UI pages load correctly
- ✅ Server stops gracefully

---

### Scenario 4: Skip UI Installation

**Goal**: Test skipping UI installation

```bash
# 1. Create fresh test project
mkdir -p /tmp/test-project-no-ui && cd /tmp/test-project-no-ui
git init

# 2. Run ralph install
ralph install
```

**At the UI prompt**:
```
? Install Ralph UI dashboard? (Y/n)
```
- **Action**: Press `N` to skip

**Expected Results**:
- ✅ Installation continues without UI setup
- ✅ Message shown: "UI Installation Skipped" with manual install instructions
- ✅ UI dependencies NOT installed
- ✅ `ralph ui` will fail with helpful error message

**Verify**:
```bash
# UI dependencies should NOT exist
ls <ralph-cli-path>/ui/node_modules
# Should show: No such file or directory

# Manual installation still works
cd <ralph-cli-path>/ui
npm install
# Now ralph ui should work
```

---

### Scenario 5: Re-running Installation

**Goal**: Test running `ralph install` when UI is already installed

```bash
# 1. In a project where you already ran ralph install with UI
cd /tmp/test-project

# 2. Run ralph install again
ralph install --force
```

**Expected Results**:
- ✅ Templates are reinstalled (with --force)
- ✅ Skills prompt appears again
- ✅ UI installation is SKIPPED with message: "UI dependencies already installed."
- ✅ No duplicate npm install

---

### Scenario 6: Non-Interactive Mode

**Goal**: Test installation in CI/CD or non-interactive environments

```bash
# Simulate non-interactive mode (no TTY)
echo "" | ralph install

# OR use --force flag
ralph install --force < /dev/null
```

**Expected Results**:
- ✅ Installation completes without prompts
- ✅ Skills installation skipped
- ✅ UI installation skipped
- ✅ Templates installed successfully

---

## Automated Test

Run the comprehensive test suite:

```bash
./tests/test-install.sh
```

**Expected Output**:
```
╔═══════════════════════════════════════════╗
║   Ralph CLI Installation Test Suite      ║
╚═══════════════════════════════════════════╝

==> Checking prerequisites
[PASS] Git is installed
[PASS] Node.js is installed
[PASS] npm is installed

==> Test 1: Simulating global installation
[PASS] Ralph CLI repository cloned
[PASS] npm dependencies installed
[PASS] ralph binary is executable
[PASS] ralph command works

==> Test 2: Project installation (ralph install)
[PASS] Test project created and initialized
[PASS] ralph install completed
[PASS] .agents/ralph directory created
[PASS] All key files present

==> Test 3: UI dependencies and installation
[PASS] UI directory exists
[PASS] UI package.json exists
[PASS] UI dependencies installed successfully
[PASS] UI server file exists
[PASS] tsx is available for running TypeScript

==> Test 4: UI server startup test
[PASS] UI server started successfully

==> Test 5: Interactive installation prompts
[PASS] install.sh has interactive prompts
[PASS] ralph install uses interactive prompts

==> Test 6: Skills installation
[PASS] Skills directory exists
[PASS] All skills found

==> Test 7: Documentation and guides
[PASS] All key docs present

==> Test Summary
Results:
  Passed:   30
  Failed:   0
  Warnings: 0

✓ All critical tests passed!
```

---

## Troubleshooting

### Issue: "UI Installation Failed"

**Symptoms**:
- Installation spinner stops with error
- Error message shows npm error

**Solutions**:
1. Check internet connection
2. Verify npm registry is accessible: `npm ping`
3. Try manual installation:
   ```bash
   cd <ralph-cli-path>/ui
   npm install --verbose
   ```
4. Check for disk space: `df -h`
5. Clear npm cache: `npm cache clean --force`

### Issue: "ralph ui fails to start"

**Symptoms**:
- `ralph ui` shows error about missing dependencies
- Server fails to start

**Solutions**:
1. Verify UI dependencies are installed:
   ```bash
   ls <ralph-cli-path>/ui/node_modules
   ```
2. Reinstall UI dependencies:
   ```bash
   cd <ralph-cli-path>/ui
   rm -rf node_modules
   npm install
   ```
3. Check for port conflicts:
   ```bash
   lsof -i :3000
   # If port is in use, kill the process or use a different port
   ralph ui 3001
   ```

### Issue: "Prompts don't appear"

**Symptoms**:
- Installation runs but no prompts shown
- Non-interactive behavior in interactive terminal

**Solutions**:
1. Verify TTY is available:
   ```bash
   tty
   # Should show: /dev/ttys000 (or similar)
   ```
2. Run in actual terminal, not in a pipe or background
3. Check if stdin is redirected
4. Try with explicit TTY:
   ```bash
   script -q /dev/null ralph install
   ```

---

## Success Criteria

✅ **Installation is successful if**:
1. All dependencies install without errors
2. Interactive prompts appear and work correctly
3. UI installation completes (if accepted)
4. `ralph ui` starts successfully
5. UI pages load in browser
6. No warnings or errors in console

✅ **User experience is good if**:
1. Installation takes less than 5 minutes total
2. Progress is clearly indicated (spinners, messages)
3. Errors provide helpful guidance
4. Skip options work correctly
5. Documentation is clear and accessible

---

## Reporting Issues

If you encounter issues during testing:

1. **Capture the full output**:
   ```bash
   ralph install 2>&1 | tee install-output.log
   ```

2. **Include environment info**:
   ```bash
   node --version
   npm --version
   git --version
   uname -a
   ```

3. **Check for error logs**:
   - `/tmp/ralph-ui-test.log` (from automated tests)
   - `<ralph-cli>/ui/npm-debug.log` (if UI install fails)

4. **Create GitHub issue**:
   - Include output logs
   - Describe the test scenario
   - Mention OS and Node.js version
   - Include error messages

---

## Next Steps After Testing

Once testing is complete:

1. **Update documentation**:
   - [ ] Update CLAUDE.md with new UI installation flow
   - [ ] Add UI setup section to README.md
   - [ ] Update quick reference guide

2. **Create demo video** (optional):
   - Screen recording of installation process
   - Show interactive prompts
   - Demonstrate UI startup

3. **Test on multiple platforms**:
   - [ ] macOS (Intel and Apple Silicon)
   - [ ] Linux (Ubuntu, Debian, Fedora)
   - [ ] Windows (WSL and native)

4. **Gather user feedback**:
   - Ask beta testers to try the installation
   - Collect feedback on clarity and ease of use
   - Iterate on prompts and messaging
