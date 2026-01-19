# Quick Test Reference

## Run All Tests

```bash
# Automated comprehensive test (recommended)
./tests/test-install.sh

# Expected: 30 passed, 0 failed, 0 warnings
```

## Quick Manual Test

```bash
# 1. Create test project
mkdir /tmp/ralph-quick-test && cd /tmp/ralph-quick-test && git init

# 2. Run ralph install (interactive)
ralph install
# Say YES to: Skills installation
# Say YES to: UI installation
# Say NO to: Auto-speak setup (optional)

# 3. Verify installation
ls .agents/ralph  # Should show templates
ralph ui          # Should start server

# 4. Test UI in browser
# Open: http://localhost:3000

# 5. Cleanup
cd .. && rm -rf /tmp/ralph-quick-test
```

## What to Check

✅ **Installation Prompts**:
- [ ] Skills installation prompt appears
- [ ] UI installation prompt appears (NEW!)
- [ ] Auto-speak setup prompt appears

✅ **UI Installation**:
- [ ] Progress spinner shows during installation
- [ ] Success message appears
- [ ] Quick start instructions shown

✅ **Server Startup**:
- [ ] `ralph ui` starts without errors
- [ ] Server runs on port 3000
- [ ] Browser can access http://localhost:3000

## Files Changed

- `lib/commands/install.js` - Added UI installation flow
- `tests/test-install.sh` - New automated test suite
- `tests/INSTALL_TEST_RESULTS.md` - Test results documentation
- `tests/MANUAL_TEST_GUIDE.md` - Comprehensive testing guide

## Key Enhancement

**Before**:
```bash
ralph install
# → Only installs templates and skills
# → User must manually: cd ui && npm install
```

**After**:
```bash
ralph install
# → Installs templates and skills
# → Prompts to install UI dependencies
# → Installs automatically if user confirms
# → Shows quick start guide
```

## Troubleshooting

**UI prompt doesn't appear?**
→ Check: Is this an interactive terminal? (Run `tty`)

**UI installation fails?**
→ Check: Internet connection, npm registry access
→ Manual fix: `cd <ralph-cli>/ui && npm install`

**ralph ui fails?**
→ Check: Did UI dependencies install? (`ls <ralph-cli>/ui/node_modules`)
→ Retry: `cd <ralph-cli>/ui && npm install`

## Success Criteria

✅ Installation completes in under 5 minutes
✅ All prompts appear and respond correctly
✅ UI dependencies install automatically
✅ `ralph ui` starts successfully
✅ UI accessible at http://localhost:3000
✅ No errors in browser console

## Contact

If issues found, create GitHub issue with:
- Output of `./tests/test-install.sh`
- Node.js version (`node --version`)
- OS (`uname -a`)
- Error messages
