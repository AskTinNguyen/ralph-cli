# Ralph CLI Installation Test Results

**Date**: 2026-01-19
**Test Script**: `tests/test-install.sh`

## Summary

The one-click installation test validated the end-to-end installation flow for Ralph CLI, including global setup, project installation, and UI dependencies.

### Test Results

**Overall**: ✅ All critical tests passed
**Warnings**: 1 warning identified

| Test | Status | Details |
|------|--------|---------|
| Prerequisites Check | ✅ PASS | Git, Node.js, npm all installed |
| Global Installation | ✅ PASS | Repository cloned, dependencies installed, binary executable |
| Project Installation | ✅ PASS | `.agents/ralph` created, all key files present |
| UI Dependencies | ⚠️ WARNING | Dependencies not auto-installed |
| UI Server Startup | ✅ PASS | Server starts successfully |
| Interactive Prompts | ✅ PASS | Both install.sh and ralph install use prompts |
| Skills Installation | ✅ PASS | All skills (commit, dev-browser, prd) available |
| Documentation | ✅ PASS | Key docs present (README, CLAUDE.md, TESTING.md) |

**Final Score**: 30 passed, 0 failed, 1 warning

## Key Finding

### Issue: UI Dependencies Not Auto-Installed

**Current Behavior**:
- User runs `ralph install` to set up Ralph in their project
- UI dependencies are NOT automatically installed
- User must manually run: `cd ui && npm install` before using `ralph ui`

**Impact**:
- Users may be confused when `ralph ui` fails to start
- Extra manual step required for UI functionality
- Not truly "one-click" installation for UI features

**Recommendation**:
Enhance `ralph install` to include an interactive prompt:
```
? Install Ralph UI dashboard? (Y/n)
  - Installs UI dependencies automatically
  - Enables 'ralph ui' command
  - Requires ~50MB disk space
```

## Installation Flow Analysis

### Current Flow

1. **Global Installation** (via curl)
   ```bash
   curl -fsSL https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.sh | bash
   ```
   - ✅ Checks dependencies (Node.js, Git, npm)
   - ✅ Installs missing dependencies with prompts
   - ✅ Clones repository
   - ✅ Runs `npm install` and `npm link`
   - ✅ Shows auto-speak setup guidance

2. **Project Installation** (via ralph install)
   ```bash
   cd your-project
   ralph install
   ```
   - ✅ Copies `.agents/ralph` templates
   - ✅ Prompts for skills installation
   - ✅ Shows auto-speak setup guidance
   - ❌ **Does NOT install UI dependencies**

3. **UI Setup** (manual)
   ```bash
   cd ralph-cli/ui
   npm install
   ```
   - ⚠️ **Required but not automated**

### Recommended Flow

Enhance step 2 to include UI setup:

```bash
cd your-project
ralph install
```
- ✅ Copies `.agents/ralph` templates
- ✅ Prompts for skills installation
- ✅ **NEW**: Prompts for UI installation
  - If yes: automatically runs `npm install` in UI directory
  - Shows estimated install time and disk space
- ✅ Shows auto-speak setup guidance

## Test Script Features

The test script (`tests/test-install.sh`) provides:

- **Isolated testing**: Creates temporary directory, cleans up after
- **Comprehensive checks**: Validates all installation steps
- **Non-interactive mode**: Can run in CI/CD
- **Detailed reporting**: Color-coded pass/fail/warning output
- **Cross-platform**: Works on macOS, Linux (with minor adjustments for Windows)

### Running the Test

```bash
# Run the full test suite
./tests/test-install.sh

# Expected output:
# - 30 passed tests
# - 0 failed tests
# - 1 warning (UI dependencies)
```

## Next Steps

1. **Enhance ralph install** (recommended)
   - Add UI installation prompt
   - Implement automatic `npm install` in UI directory
   - Show progress indicator during installation
   - Handle errors gracefully

2. **Update documentation**
   - Update CLAUDE.md with new installation flow
   - Add UI setup section to README.md
   - Update quick reference guide

3. **Test in production**
   - Test on fresh machines (macOS, Linux, Windows)
   - Validate with different Node.js versions
   - Test with slow/unreliable network connections

4. **CI/CD integration**
   - Add test-install.sh to CI pipeline
   - Validate installation on each commit
   - Test on multiple OS/environments

## Implementation Plan

### Phase 1: Enhance ralph install (Priority: High)

**File**: `lib/commands/install.js`

Add after skills installation prompt:

```javascript
// UI installation (after skills)
if (!process.stdin.isTTY) {
  // Non-interactive mode - skip UI install
  return 0;
}

try {
  const { confirm, spinner } = await import("@clack/prompts");

  const wantsUI = await confirm({
    message: "Install Ralph UI dashboard?",
    initialValue: true,
  });

  if (!isCancel(wantsUI) && wantsUI) {
    const uiDir = path.join(repoRoot, "ui");

    if (!exists(uiDir)) {
      warn("UI directory not found - skipping");
      return 0;
    }

    const s = spinner();
    s.start("Installing UI dependencies (this may take a minute)...");

    try {
      execSync("npm install --silent", {
        cwd: uiDir,
        stdio: "pipe"
      });

      s.stop("UI dependencies installed successfully");
      success("Ralph UI is ready! Run: " + pc.cyan("ralph ui"));
    } catch (err) {
      s.stop("UI installation failed");
      error("Failed to install UI dependencies");
      warn("You can install manually: cd ui && npm install");
    }
  }
} catch {
  dim("Skipped UI install (non-interactive).");
}
```

### Phase 2: Update Documentation

- [ ] Update CLAUDE.md installation section
- [ ] Add UI setup to README.md
- [ ] Update quick reference table
- [ ] Add troubleshooting section

### Phase 3: Test and Validate

- [ ] Run test-install.sh with new changes
- [ ] Test on fresh VM/container
- [ ] Validate on Windows (WSL/native)
- [ ] Test with slow network connection
- [ ] Test error handling (no internet, disk full, etc.)

## Conclusion

The Ralph CLI installation flow is **mostly solid** with one improvement area:

**✅ Strengths**:
- Robust dependency checking
- Interactive prompts for user choices
- Good error handling
- Comprehensive documentation
- Skills installation works well

**⚠️ Improvement Area**:
- UI dependencies require manual installation
- Should be automated with user confirmation

**Impact**: With the recommended enhancement, Ralph will have a truly seamless one-click installation experience for all features, including the UI dashboard.
