# Ralph CLI Installation Issues & Improvements

**Date:** 2026-01-19
**Installation Method:** Manual installation from GitHub
**Environment:** macOS (Darwin 24.6.0), Node.js v18+

## Overview
This document tracks issues encountered during Ralph CLI installation and suggests improvements for the official repository's README.md.

---

## Issues Identified

### 1. Dependency Deprecation Warnings

**Severity:** Medium
**Impact:** Future compatibility concerns, potential security issues

During `npm install`, multiple deprecation warnings were displayed:

```
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated @humanwhocodes/config-array@0.13.0: Use @eslint/config-array instead
npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported
npm warn deprecated glob@7.2.3: Glob versions prior to v9 are no longer supported
npm warn deprecated @humanwhocodes/object-schema@2.0.3: Use @eslint/object-schema instead
npm warn deprecated eslint@8.57.1: This version is no longer supported. Please see https://eslint.org/version-support for other options.
```

**Recommended Actions:**
- Update dependencies to their latest stable versions
- Replace deprecated packages:
  - `inflight` → `lru-cache` or remove dependency
  - `@humanwhocodes/config-array` → `@eslint/config-array`
  - `@humanwhocodes/object-schema` → `@eslint/object-schema`
  - `rimraf` → v4+
  - `glob` → v9+
  - `eslint` → v9+ (ESLint Flat Config)

---

### 2. Unclear Installation Verification Step

**Severity:** Low
**Impact:** User confusion about whether installation succeeded

The README states: "After global installation, initialize Ralph in your project" but doesn't provide a clear verification command before proceeding.

**Issue:**
- Users don't know how to verify the installation succeeded
- Running `ralph --version` (common convention) returns an error:
  ```
  Unknown command: --version
  ```

**Recommended Actions:**
- Add explicit verification step in README:
  ```markdown
  ### Verify Installation

  After installation, verify Ralph CLI is working:
  ```bash
  ralph help
  ```

  You should see the Ralph CLI help menu. Note: Ralph doesn't support `--version` flag yet.
  ```

---

### 3. Missing Version Command

**Severity:** Low
**Impact:** Inconsistent with CLI conventions

Most CLI tools support `--version` or `-v` flags to show the installed version. Ralph CLI doesn't have this feature.

**Recommended Actions:**
- Implement `ralph --version` or `ralph version` command
- Display version from package.json
- Example output: `ralph-cli v1.2.3`

---

### 4. npm link Success Feedback

**Severity:** Low
**Impact:** User uncertainty about installation status

After running `npm link`, the output is minimal:
```
changed 1 package, and audited 3 packages in 465ms
found 0 vulnerabilities
```

This doesn't clearly indicate that the global symlink was created successfully.

**Recommended Actions:**
- Update README to clarify expected output
- Add note that success is indicated by "changed 1 package"
- Suggest running `which ralph` (Unix) or `where ralph` (Windows) to confirm global installation

---

### 5. Installation Directory Clarity

**Severity:** Low
**Impact:** Users may be confused about where to install

The README shows installation to `/tmp/ralph-cli` in our case, but the manual installation section doesn't specify:
- Where should users clone the repo?
- Is /tmp appropriate for permanent installation?
- What if they want to contribute/develop?

**Recommended Actions:**
Add installation directory guidance:
```markdown
### Manual Installation from GitHub

Choose your installation location:

**For regular use (recommended):**
```bash
# Clone to a permanent location
git clone https://github.com/AskTinNguyen/ralph-cli.git ~/ralph-cli
cd ~/ralph-cli
npm install && npm link
```

**For development/contributing:**
```bash
# Clone to your projects directory
git clone https://github.com/AskTinNguyen/ralph-cli.git ~/projects/ralph-cli
cd ~/projects/ralph-cli
npm install && npm link
```

**Note:** Avoid using `/tmp` as it may be cleared on system restart.
```

---

### 6. Post-Installation Next Steps

**Severity:** Low
**Impact:** Users don't know what to do after installation

The README jumps directly to "Project Setup" without acknowledging the installation is complete.

**Recommended Actions:**
Add a clear transition section:
```markdown
### Installation Complete!

Ralph CLI is now installed globally. You can verify by running:
```bash
ralph help
```

Next steps:
1. Navigate to your project directory: `cd your-project`
2. Initialize Ralph templates: `ralph install`
3. Start your workflow: `ralph prd`

For detailed usage, see [Usage Guide](#usage) or run `ralph help`.
```

---

## Summary of Recommendations

### High Priority
1. ✅ Update deprecated dependencies (security & maintenance)
2. ✅ Add clear verification step to README
3. ✅ Clarify installation directory recommendations

### Medium Priority
4. ✅ Implement `ralph --version` command
5. ✅ Add post-installation confirmation section
6. ✅ Document expected npm link output

### Low Priority
7. ✅ Add troubleshooting section for common issues
8. ✅ Include uninstallation instructions

---

## Additional Suggestions

### Add Troubleshooting Section

```markdown
## Troubleshooting

### "ralph: command not found"
- Ensure npm's global bin directory is in your PATH
- Run: `npm config get prefix` and verify the bin directory is in PATH
- On Unix: Add `export PATH="$(npm config get prefix)/bin:$PATH"` to ~/.bashrc or ~/.zshrc

### "Permission denied" during npm link
- Use sudo: `sudo npm link` (not recommended)
- Or configure npm to use a user-owned directory (recommended)
- See: https://docs.npmjs.com/resolving-eacces-permissions-errors-when-installing-packages-globally

### Deprecation warnings during installation
- These are being addressed in upcoming releases
- They don't affect functionality but will be fixed
```

### Add Uninstallation Instructions

```markdown
## Uninstalling

To remove Ralph CLI:

```bash
# Unlink global command
npm unlink -g ralph-cli

# Remove cloned repository
rm -rf ~/ralph-cli  # or wherever you cloned it
```
```

---

## Installation Success Criteria

For a successful installation experience, users should:
1. ✅ Know where to clone the repository
2. ✅ See clear success indicators at each step
3. ✅ Be able to verify installation worked
4. ✅ Know what command to run next
5. ✅ Have troubleshooting resources if issues arise

---

## Notes

- Installation completed successfully despite minor issues
- All issues are cosmetic/documentation-related
- Core functionality works as expected
- These improvements would enhance user experience and reduce support burden
