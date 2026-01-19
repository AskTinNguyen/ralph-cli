# Cleanup Round 2 - Initial Analysis

**Date:** 2026-01-19
**Branch:** cleanup-round2-20260119

## Current State

- **Repository size:** 2.9GB
- **Markdown files (total):** 5,190 (excluding node_modules, venv)
- **Root markdown files:** 15
- **NPM packages:** 7

## Markdown File Distribution

Top directories with markdown files:
- `.ralph/.tmp/` - 994 files (temporary data - **CLEANUP TARGET**)
- `.ralph/bug-wikipedia/by-module/` - 109 files (evaluation data)
- `.ralph/runs/` - 59 files (run logs)
- Various PRD run directories - multiple files

## Identified Issues

### 1. Root Directory Cleanup (15 files → target: ≤10)

**Archive to documentation/history/:**
- `CLEANUP-PROPOSAL.md` (20K) - Implemented in Round 1, historical reference
- `DOCUMENTATION_CLEANUP_SUMMARY.md` (13K) - Summary of past cleanup
- `CLEANUP-ROUND-2-PROMPT.md` (9.5K) - Current prompt, archive after completion
- `DOCUMENTATION_STRUCTURE.md` (11K) - Meta-documentation

**Move to docs/:**
- `AGENT_BROWSER_CHEATSHEET.md` (5.7K) → docs/agent-browser-cheatsheet.md
- `AUTO-SPEAK-GUIDE.md` (17K) → docs/auto-speak-guide.md
- `UI_TESTING_GUIDE.md` (10K) → docs/ui-testing-guide.md
- `AUTOMATION_INSTALL.md` (8.9K) → docs/automation-install.md
- `APPLESCRIPT-FEATURES.md` (11K) → docs/applescript-features.md

**Keep in root:**
- `CLAUDE.md` (31K) - Main agent reference (referenced by AI agents)
- `README.md` (14K) - User-facing entry point
- `AGENTS.md` (8.6K) - Core agent rules
- `ROADMAP.md` (18K) - Project roadmap
- `VISION.md` (13K) - Project vision
- `TESTING.md` (6.2K) - Core testing guide

### 2. Temporary File Cleanup

**Remove `.ralph/.tmp/` entirely:**
- 994 markdown files (likely evaluation runs, temporary data)
- Estimate: 10-50MB saved

### 3. Documentation Duplication

**Found duplicate content:**
- `docs/TESTING.md` vs root `TESTING.md` (2 versions exist)
- `docs/VOICE.md` vs root references in CLAUDE.md
- Multiple design system files:
  - `docs/DESIGN_SYSTEM.md` (7.5K)
  - `documentation/DESIGN_SYSTEM.md` (14K)

**Action:** Consolidate and keep single authoritative version

### 4. Configuration Files

**Review needed:**
- `.gitignore` - Check for stale entries
- `package.json` - Check for unused scripts
- npm scripts audit

### 5. Unused Scripts

**Check:**
- `.agents/ralph/*.sh` - Identify unused scripts
- `experimental/` - Review if still needed

## Proposed Changes

### Phase 1: Documentation Consolidation
1. Move 5 guides from root → docs/
2. Archive 4 meta-docs → documentation/history/
3. Consolidate duplicate TESTING.md
4. Consolidate duplicate DESIGN_SYSTEM.md
5. Result: 15 → 6 root markdown files

### Phase 2: Temporary Data Cleanup
1. Remove `.ralph/.tmp/` (994 files)
2. Estimate: 10-50MB saved

### Phase 3: Configuration Cleanup
1. Clean .gitignore
2. Remove unused npm scripts
3. Update references to moved files

### Phase 4: Script Audit
1. Find unused shell scripts
2. Archive/remove as needed

### Phase 5: Validation
1. Run tests
2. Verify all commands work
3. Check UI server starts

## Risk Assessment

| Change | Risk Level | Mitigation |
|--------|-----------|------------|
| Move guides to docs/ | ZERO | Update links in CLAUDE.md |
| Archive meta-docs | ZERO | Git history preserves them |
| Remove .ralph/.tmp/ | LOW | Temporary data, not used |
| Consolidate duplicates | LOW | Keep most recent version |
| Config cleanup | LOW | Test after each change |
| Remove unused scripts | MEDIUM | Verify no references first |

## Success Metrics

**Quantitative:**
- Repository size: 2.9GB → ~2.85GB (50-100MB reduction)
- Root markdown files: 15 → 6 (60% reduction)
- Total markdown files: 5,190 → ~4,200 (19% reduction)

**Qualitative:**
- Clearer root directory structure
- No duplicate documentation
- Faster repository navigation
- All functionality preserved

## Next Steps

1. Execute Phase 1: Documentation consolidation
2. Execute Phase 2: Temporary data cleanup
3. Execute Phase 3: Configuration cleanup
4. Execute Phase 4: Script audit
5. Validate and create report
