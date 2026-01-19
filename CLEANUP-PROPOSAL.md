# Ralph CLI Comprehensive Cleanup Proposal

**Date:** January 19, 2026
**Status:** Proposal - Awaiting Approval
**Impact:** Reduces repository size by ~550MB, removes 100+ irrelevant files

---

## Executive Summary

This proposal identifies and categorizes all code, assets, files, and components that are not related to Ralph CLI's core workflows (autonomous coding loop, PRD/plan/build system) and Ralph Voice TTS (auto-speak, recap commands). The repository currently contains significant unrelated content that can be safely removed.

**Key Stats:**
- **511MB** `.archive/` directory (wedding-planner-app with full node_modules)
- **21** markdown files in root (many are historical analysis reports)
- **100+** temporary/backup files across worktrees
- **20+** `.DS_Store` files (macOS metadata)
- **6** POC/experimental scripts in `.agents/ralph/`

---

## Cleanup Categories

### Category 1: ALREADY STAGED FOR DELETION ✅

**Status:** These files are marked with "D" (deleted) in git status and ready for commit.

#### 1.1 Unrelated Demo Applications

**wedding-planner-app/** (11 files, ~5KB source + large node_modules)
- **Type:** Full-stack Express.js demo
- **Purpose:** Example REST API + guest management
- **Reason:** Demo/testing only, not core Ralph functionality
- **Impact:** Low - completely standalone application
- **Action:** DELETE ✅ (already staged)

**ralph-voice-app/** (30+ files, ~50KB source)
- **Type:** Standalone Electron desktop application
- **Purpose:** Voice-controlled desktop automation (separate from CLI)
- **Reason:** Voice TTS integrated into main CLI instead; this is isolated/unmaintained
- **Impact:** Low - separate application, not used by CLI
- **Action:** DELETE ✅ (already staged)
- **Note:** Voice features now in `/lib/commands/speak.js`, `/lib/commands/voice.js`, `.agents/ralph/auto-speak-*`

#### 1.2 External Project Documentation

**S2-Game/** (5 files, ~2KB)
- **Type:** Game design reference documents
- **Purpose:** External game project index
- **Reason:** Game project links, not Ralph CLI code
- **Impact:** None - external references only
- **Action:** DELETE ✅ (already staged)

**docs/GDDs-Dec-2025/** (32 files, ~100KB)
- **Type:** Game design document snapshots
- **Purpose:** Historical reference for S2 game project
- **Reason:** External game project docs, no Ralph CLI relevance
- **Impact:** None - unrelated content
- **Action:** DELETE ✅ (already staged)

#### 1.3 Redundant Documentation Files

- `.github/PAGES_SETUP.md` - GitHub Pages no longer used
- `.github/QUICK_START.md` - Redundant with README.md
- `AGENT_QUICKSTART.md` - Old file references, superseded by ui/public/docs/agent-guide.html

**Action:** DELETE ✅ (already staged)

**Total staged for deletion:** ~100 files

---

### Category 2: ARCHIVE DIRECTORY REMOVAL (Recommended)

**.archive/** (511MB total)

**Current Status:**
- Tracked in git (comment in .gitignore: "for historical reference")
- Contains full wedding-planner-app with **node_modules/** (~500MB)
- Duplicates files already staged for deletion

**Recommendation:** **REMOVE ENTIRELY**

**Rationale:**
1. Git history already preserves deleted files (no need for archive)
2. 511MB is excessive for "historical reference"
3. node_modules in archive defeats purpose (external dependencies)
4. Files are accessible via `git log --follow` if needed

**Alternative (if historical reference needed):**
- Keep `.archive/` but remove `node_modules/`: `rm -rf .archive/wedding-planner-app/node_modules`
- Reduces size from 511MB to ~10MB

**Commands:**
```bash
# Option 1: Complete removal (recommended)
git rm -rf .archive
echo ".archive/" >> .gitignore

# Option 2: Remove node_modules only
find .archive -name "node_modules" -type d -exec rm -rf {} +
git add .archive
```

**Impact:** High storage savings (511MB), no functional impact

---

### Category 3: HISTORICAL ANALYSIS FILES (Recommended)

**Root markdown files** (21 total, ~150KB)

**Files to Move to `.archive/` or `documentation/history/`:**

#### 3.1 Bug Fix Analysis Reports
- `ACCESSIBILITY_FIXES.md` (7.7KB) - Accessibility fixes summary (completed Jan 17)
- `BLACK_ON_BLACK_FIX.md` - CSS bug root cause analysis (bug already fixed)
- `DESIGN_SYSTEM_FIXES.md` - Design system fixes summary (completed)

#### 3.2 Completion Reports
- `BROKEN_LINKS_REPORT.md` - Cross-reference update report (completed Jan 19)
- `TEST-SUMMARY.md` (7.1KB) - Test summary from Jan 17
- `TTS_PROMPT_IMPROVEMENTS.md` (9KB) - TTS improvements summary (completed Jan 19)

#### 3.3 Feature Documentation (Potentially Redundant)
- `VOICE-FIX-SPOTIFY.md` (2.8KB) - Specific Spotify voice fix (dated Jan 17)
- `VOICE-NEW-FEATURES.md` (8.5KB) - Voice features summary (dated Jan 17)
- `VOICE-FEATURES-GUIDE.md` (15K) - Comprehensive but dated (mentions "Browser STT Removed")
- `AUTOMATION_INSTALL.md` (9.2KB) - Installation automation (covered in AUTO-SPEAK-GUIDE.md?)
- `APPLESCRIPT-FEATURES.md` (11.6KB) - AppleScript integration docs

**Keep These (Core Documentation):**
- `CLAUDE.md` ✅ (31KB) - Main reference guide
- `AGENTS.md` ✅ (8.8KB) - Agent decision trees
- `AUTO-SPEAK-GUIDE.md` ✅ (17KB) - Voice TTS setup
- `README.md` ✅ (12KB) - Project overview
- `ROADMAP.md` ✅ (18.5KB) - Strategic direction
- `VISION.md` ✅ (13.7KB) - Project vision
- `TESTING.md` ✅ - Test organization standards
- `AGENT_BROWSER_CHEATSHEET.md` ✅ - Browser automation reference
- `UI_TESTING_GUIDE.md` ✅ (10.4KB) - UI testing
- `DOCUMENTATION_STRUCTURE.md` ✅ (11KB) - Docs organization

**Action Plan:**
```bash
# Option 1: Move to archive
mkdir -p .archive/analysis-reports
git mv ACCESSIBILITY_FIXES.md BLACK_ON_BLACK_FIX.md DESIGN_SYSTEM_FIXES.md \
       BROKEN_LINKS_REPORT.md TEST-SUMMARY.md TTS_PROMPT_IMPROVEMENTS.md \
       VOICE-FIX-SPOTIFY.md VOICE-NEW-FEATURES.md \
       .archive/analysis-reports/

# Option 2: Move to documentation/history
mkdir -p documentation/history
git mv [same files] documentation/history/

# Option 3: Complete removal (if redundant with current docs)
git rm ACCESSIBILITY_FIXES.md BLACK_ON_BLACK_FIX.md [etc.]
```

**Recommendation:**
- **Move** analysis reports to `documentation/history/` (preserve but organize)
- **Evaluate** VOICE-*.md files for consolidation with AUTO-SPEAK-GUIDE.md
- **Update** references in CLAUDE.md if needed

**Impact:** Low - historical documentation only, no functional changes

---

### Category 4: TEMPORARY & BACKUP FILES (High Priority)

#### 4.1 Temporary Files in .ralph/

**Wizard temp files:**
```
.ralph/PRD-42/.wizard-description.tmp
.ralph/PRD-43/.wizard-description.tmp
.ralph/PRD-44/.wizard-description.tmp
```

**General temp:**
```
.ralph/.tmp/
.ralph/PRD-65/.ralph/.tmp
```

**Commands:**
```bash
find .ralph -name "*.tmp" -type f -delete
find .ralph -name ".tmp" -type d -exec rm -rf {} +
```

#### 4.2 Backup Files

**HTML backups in worktrees:**
```
.ralph/worktrees/PRD-*/ui/public/docs/troubleshooting.html.bak
ui/public/docs/troubleshooting.html.bak
```

**Old prompt backups:**
```
.ralph/backups/spec-improvements-20260117-220509/PROMPT_prd.md.backup
.ralph/backups/spec-improvements-20260117-220509/PROMPT_plan.md.backup
.ralph/backups/spec-improvements-20260117-220509/agent-guide.html.backup
.ralph/backups/spec-improvements-20260117-220509/CLAUDE.md.backup
.ralph/backups/spec-improvements-20260117-220509/AGENTS.md.backup
```

**Commands:**
```bash
# Remove all .bak files
find .ralph -name "*.bak" -type f -delete
find ui -name "*.bak" -type f -delete

# Remove old backups directory (dated Jan 17)
rm -rf .ralph/backups/spec-improvements-20260117-220509
```

#### 4.3 macOS Metadata Files

**20+ .DS_Store files** (already in .gitignore but committed)

**Commands:**
```bash
# Remove all .DS_Store files
find . -name ".DS_Store" -type f -delete

# Ensure they're ignored
grep -q "^\.DS_Store$" .gitignore || echo ".DS_Store" >> .gitignore

# Remove from git tracking (if any committed)
git rm --cached -r .DS_Store 2>/dev/null || true
```

#### 4.4 Browser Profile Data (Already Ignored)

**Location:** `skills/dev-browser/profiles/browser-data/`

**Status:** Properly ignored in `.gitignore` (line 35: `skills/dev-browser/profiles/`)

**Files:** LOG.old files, LevelDB data, browser cache

**Action:** No action needed - already gitignored ✅

**Impact:** High priority - cleans up development artifacts (minimal size ~1-5MB)

---

### Category 5: POC & EXPERIMENTAL CODE (Optional)

**Location:** `.agents/ralph/`

#### 5.1 POC Scripts

**Files:**
- `monitor-poc.sh` - Monitoring POC
- `start-poc.sh` - POC starter script
- `test-poc-setup.sh` - POC setup testing

**Recommendation:**
- **Remove** if POCs are completed/abandoned
- **Keep** if actively developing these features
- **Move** to `.agents/ralph/experimental/` if keeping for reference

#### 5.2 Test/Debug Scripts

**Files:**
- `test-tts-overlap.sh` - TTS overlap testing
- `test-tts-cleanup.mjs` - TTS cleanup testing

**Recommendation:**
- **Keep** if used for active TTS development/debugging
- **Move** to `tests/` directory if integration tests
- **Remove** if obsolete testing scripts

#### 5.3 UI Testing Script

**File:** `.agents/ralph/test-ui.sh`

**Status:** Actively used utility (UI_TESTING_GUIDE.md references it)

**Action:** KEEP ✅

**Decision Required:**
```bash
# Option 1: Remove all POC/test scripts
rm .agents/ralph/*-poc*.sh .agents/ralph/test-tts-*.{sh,mjs}

# Option 2: Organize experimental code
mkdir -p .agents/ralph/experimental
git mv .agents/ralph/*-poc*.sh .agents/ralph/test-tts-*.* .agents/ralph/experimental/

# Option 3: Keep as-is (if actively used)
```

**Impact:** Medium priority - organizational cleanup, no functional impact if removing obsolete POCs

---

### Category 6: GENERATED & NON-ESSENTIAL DIRECTORIES

#### 6.1 Coverage Reports

**Location:** `coverage/` (already in .gitignore)

**Status:** Generated during tests, properly ignored ✅

**Action:** No action needed - already gitignored

#### 6.2 Package Directory

**Location:** `packages/md2pdf/`

**Status:** Single utility package for PDF generation

**Recommendation:**
- **Keep** if used by Ralph CLI
- **Remove** if obsolete/unused utility

**Check usage:**
```bash
# Search for md2pdf references
grep -r "md2pdf" --exclude-dir=node_modules --exclude-dir=packages .
```

#### 6.3 Auto-Claude Directory

**Location:** `.auto-claude/` (ignored in .gitignore line 45)

**Status:** AI-generated intelligence, properly ignored ✅

**Action:** No action needed - already gitignored

**Impact:** Low - properly managed by .gitignore

---

## Cleanup Implementation Plan

### Phase 1: Safe & Immediate (Commit Staged Deletions)

**Status:** Files already staged with "D" in git status

```bash
# Review staged deletions
git status | grep "^D"

# Commit all staged deletions
git commit -m "chore: remove unrelated demo apps and external project docs

- Remove wedding-planner-app demo application
- Remove ralph-voice-app (standalone Electron app, superseded by CLI integration)
- Remove S2-Game and GDDs-Dec-2025 (external game project references)
- Remove redundant documentation (.github/PAGES_SETUP.md, etc.)

Voice TTS now integrated in main CLI via speak.js, voice.js, and auto-speak hooks.
Demo apps were examples only and not part of core Ralph functionality."
```

**Risk:** ✅ NONE - files already staged, reviewed, and confirmed irrelevant

---

### Phase 2: Archive Directory Cleanup (Recommended)

**Option A: Complete Removal (Recommended)**
```bash
git rm -rf .archive
echo "" >> .gitignore
echo "# Archive directory (use git history instead)" >> .gitignore
echo ".archive/" >> .gitignore

git commit -m "chore: remove .archive directory (511MB)

Files preserved in git history. Use 'git log --follow <file>' to access.
Archive contained node_modules (~500MB) which defeats archival purpose."
```

**Option B: Remove node_modules Only**
```bash
find .archive -name "node_modules" -type d -exec rm -rf {} +
git add .archive
git commit -m "chore: remove node_modules from .archive (reduces 511MB to ~10MB)"
```

**Risk:** ⚠️ LOW - files accessible via git history; confirm no active references

**Size Impact:** Saves 500-511MB

---

### Phase 3: Historical Documentation Consolidation

```bash
# Create history directory
mkdir -p documentation/history

# Move analysis reports
git mv ACCESSIBILITY_FIXES.md BLACK_ON_BLACK_FIX.md DESIGN_SYSTEM_FIXES.md \
       BROKEN_LINKS_REPORT.md TEST-SUMMARY.md TTS_PROMPT_IMPROVEMENTS.md \
       VOICE-FIX-SPOTIFY.md VOICE-NEW-FEATURES.md \
       documentation/history/

# Commit
git commit -m "docs: consolidate historical analysis reports

Move completed fix/analysis reports to documentation/history/:
- ACCESSIBILITY_FIXES.md (completed Jan 17)
- BLACK_ON_BLACK_FIX.md (bug already fixed)
- DESIGN_SYSTEM_FIXES.md (completed)
- BROKEN_LINKS_REPORT.md (completed Jan 19)
- TEST-SUMMARY.md (dated Jan 17)
- TTS_PROMPT_IMPROVEMENTS.md (completed Jan 19)
- VOICE-FIX-SPOTIFY.md (specific fix, dated)
- VOICE-NEW-FEATURES.md (dated Jan 17)

Keeps root clean while preserving historical context."
```

**Risk:** ✅ NONE - purely organizational, no functionality affected

---

### Phase 4: Temporary & Backup File Cleanup

```bash
# Remove temporary files
find .ralph -name "*.tmp" -type f -delete
find .ralph -name ".tmp" -type d -exec rm -rf {} +

# Remove backup files
find . -name "*.bak" -type f -delete

# Remove old backup directory
rm -rf .ralph/backups/spec-improvements-20260117-220509

# Remove .DS_Store files
find . -name ".DS_Store" -type f -delete

# Verify .gitignore entries
grep -q "^\\.DS_Store$" .gitignore || echo ".DS_Store" >> .gitignore
grep -q "^\*\\.tmp$" .gitignore || echo "*.tmp" >> .gitignore
grep -q "^\*\\.bak$" .gitignore || echo "*.bak" >> .gitignore

# Commit cleanup
git add .gitignore
git commit -m "chore: clean up temporary and backup files

- Remove *.tmp wizard files from .ralph/PRD-*
- Remove *.bak backup files from worktrees
- Remove old spec-improvements backup directory
- Remove .DS_Store macOS metadata files
- Update .gitignore to prevent future temp file commits"
```

**Risk:** ✅ NONE - temporary files by definition, .gitignore prevents recurrence

---

### Phase 5: POC/Experimental Code Review (Optional)

**Decision Required:** Review POC scripts with development team

```bash
# Option 1: Remove completed/abandoned POCs
rm .agents/ralph/monitor-poc.sh
rm .agents/ralph/start-poc.sh
rm .agents/ralph/test-poc-setup.sh
rm .agents/ralph/test-tts-overlap.sh
rm .agents/ralph/test-tts-cleanup.mjs

git commit -m "chore: remove completed POC scripts"

# Option 2: Organize experimental code
mkdir -p .agents/ralph/experimental
git mv .agents/ralph/*-poc*.sh .agents/ralph/test-tts-*.* .agents/ralph/experimental/
git commit -m "chore: organize experimental code into dedicated directory"
```

**Risk:** ⚠️ MEDIUM - verify scripts are not actively used before removal

**Action:** Review with team before executing

---

### Phase 6: Package Audit (Optional)

```bash
# Check if md2pdf is used
grep -r "md2pdf" --exclude-dir=node_modules --exclude-dir=packages .

# If no results, consider removing
git rm -rf packages/md2pdf
git commit -m "chore: remove unused md2pdf package utility"
```

**Risk:** ⚠️ MEDIUM - verify no active usage before removal

**Action:** Run usage check first

---

## Updated .gitignore Recommendations

Add these entries to prevent future accumulation:

```gitignore
# Temporary files
*.tmp
*.bak
*.backup
*.swp
*.swo
*~

# OS files
.DS_Store
Thumbs.db
Desktop.ini

# Archive (use git history)
.archive/

# Generated files
coverage/
*.log

# Browser automation
skills/dev-browser/profiles/
skills/dev-browser/tmp/

# Local Ralph state
.ralph/
```

**Note:** Most of these already exist in .gitignore (see lines 2, 23, 28, 34-38)

**Action:** Verify all entries present

---

## Validation Checklist

Before executing cleanup:

- [ ] **Phase 1:** Review `git status` staged deletions
- [ ] **Phase 2:** Confirm no active references to `.archive/` files
- [ ] **Phase 3:** Verify historical docs not referenced in CLAUDE.md or README.md
- [ ] **Phase 4:** No active PRD builds using temp files
- [ ] **Phase 5:** Confirm POC scripts are completed/abandoned
- [ ] **Phase 6:** Check md2pdf package usage
- [ ] **Post-cleanup:** Run full test suite: `npm test`
- [ ] **Post-cleanup:** Verify Ralph commands work: `ralph --help`, `ralph prd`, `ralph build`
- [ ] **Post-cleanup:** Test voice features: `ralph speak "test"`, `ralph recap`
- [ ] **Post-cleanup:** Test UI: `cd ui && npm run dev`

---

## Risk Assessment

| Phase | Risk Level | Impact | Reversibility |
|-------|-----------|--------|---------------|
| Phase 1: Staged deletions | ✅ NONE | High (staged files) | Git history |
| Phase 2: .archive removal | ⚠️ LOW | High (511MB saved) | Git history |
| Phase 3: Docs consolidation | ✅ NONE | Low (organizational) | Git revert |
| Phase 4: Temp file cleanup | ✅ NONE | Medium (1-5MB saved) | Cannot revert (temp files) |
| Phase 5: POC removal | ⚠️ MEDIUM | Low (organizational) | Git revert |
| Phase 6: Package audit | ⚠️ MEDIUM | Medium (if unused) | Git revert |

**Overall Risk:** LOW - Most changes are organizational or remove already-staged files

---

## Expected Outcomes

### Size Reduction
- **Before:** ~600MB repository (including .archive and node_modules)
- **After:** ~50-100MB repository (core code only)
- **Savings:** ~500-550MB (92% reduction)

### File Count Reduction
- **Staged deletions:** ~100 files (wedding-planner, ralph-voice-app, game docs)
- **Archive removal:** ~500+ files (if removing .archive entirely)
- **Temp/backup files:** ~50 files
- **Historical docs:** 8 markdown files (moved, not deleted)
- **Total reduction:** 150-650 files (depending on .archive decision)

### Organizational Benefits
- ✅ Root directory cleaned (21 → 13 markdown files)
- ✅ Clear separation of core vs historical docs
- ✅ No temporary/backup files in worktrees
- ✅ .gitignore prevents future accumulation
- ✅ Faster `git clone` and `git pull` operations

### Functionality Preserved
- ✅ All Ralph CLI core workflows intact
- ✅ Voice TTS features fully functional (integrated in CLI)
- ✅ UI web application unchanged
- ✅ Test suite complete and passing
- ✅ Documentation accurate and up-to-date
- ✅ Git history preserves all removed files

---

## Approval Required

**Recommended Actions:**
1. ✅ **Execute Phase 1 immediately** (staged deletions - already reviewed)
2. ⚠️ **Review & approve Phase 2** (.archive removal - size impact)
3. ✅ **Execute Phase 3** (docs consolidation - low risk)
4. ✅ **Execute Phase 4** (temp cleanup - standard maintenance)
5. ⚠️ **Team review Phase 5** (POC scripts - verify not in use)
6. ⚠️ **Team review Phase 6** (package audit - verify usage)

**Decision Points:**
- **Archive Strategy:** Complete removal vs. node_modules removal only?
- **POC Scripts:** Remove vs. organize vs. keep as-is?
- **md2pdf Package:** Remove if unused?

---

## Execution Timeline

**Immediate (Today):**
- Phase 1: Commit staged deletions (0 risk)
- Phase 4: Clean temporary/backup files (0 risk)

**This Week:**
- Phase 2: Archive directory decision & execution
- Phase 3: Docs consolidation
- Validation: Run full test suite

**Next Sprint:**
- Phase 5: POC/experimental code review (team decision)
- Phase 6: Package audit and cleanup

---

## Rollback Plan

If issues arise:

```bash
# Revert to commit before cleanup
git log --oneline | head -5  # Find commit hash
git revert <commit-hash>

# Restore specific file from history
git log --all --full-history -- <file-path>
git checkout <commit-hash> -- <file-path>

# Restore entire .archive directory
git checkout HEAD~1 -- .archive
```

---

## Conclusion

This proposal provides a comprehensive, phased approach to cleaning up the Ralph CLI repository. The cleanup removes 500-550MB of unrelated code while preserving all core functionality and maintaining full git history for recovery if needed.

**Total Impact:**
- 🗑️ Remove ~650 files (100 staged + 500+ archive + 50 temp)
- 💾 Save ~550MB storage (92% reduction)
- 🎯 Improve clarity and maintainability
- ✅ Zero functionality loss
- 📚 Better documentation organization

**Recommendation:** Proceed with Phases 1-4 immediately. Schedule team review for Phases 5-6.
