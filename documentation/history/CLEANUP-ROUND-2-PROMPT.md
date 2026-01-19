# Repository Cleanup - Round 2 Prompt

**Purpose:** Further cleanup and organization of Ralph CLI repository following initial cleanup (Jan 19, 2026)

---

## Task Overview

Perform a second round of repository cleanup to identify and remove/reorganize:
- Redundant or outdated documentation
- Unused scripts or utilities
- Stale configuration files
- Duplicate content across documentation
- Overly verbose or outdated README/guide files
- Test fixtures or mock data that's no longer needed
- Legacy code paths or deprecated features

**Goal:** Reduce repository size and complexity while maintaining 100% functionality.

---

## Previous Cleanup Summary (Round 1)

**Completed Jan 19, 2026:**
- Removed .archive directory (511MB)
- Removed md2pdf package (unused)
- Consolidated 8 historical docs to documentation/history/
- Cleaned up temp files (*.tmp, *.bak, .DS_Store)
- Organized POC scripts to experimental/
- Removed deprecated VOICE-FEATURES-GUIDE.md
- **Result:** 5,237 lines removed, 29 files changed

---

## Cleanup Criteria for Round 2

### 1. Documentation Audit

**Check for:**
- Duplicate information across multiple markdown files
- Outdated installation/setup instructions
- Files with "DEPRECATED" or "TODO: Remove" markers
- Guides that reference removed features (wedding-planner-app, ralph-voice-app, S2-Game)
- Excessive documentation for simple features

**Action:**
- Consolidate duplicate content
- Move outdated guides to documentation/history/
- Update references to removed features
- Merge overly fragmented guides into comprehensive single files

### 2. Code & Script Audit

**Check for:**
- Unused shell scripts in .agents/ralph/
- Commented-out code blocks (>10 lines)
- Legacy feature flags or environment variables
- Unused utility functions in lib/
- Test files for removed features
- Mock data or fixtures not used by current tests

**Action:**
- Remove unused scripts
- Delete commented code (git history preserves it)
- Clean up unused test files
- Archive experimental code to experimental/

### 3. Configuration File Audit

**Check for:**
- Stale .gitignore entries (for removed directories)
- Unused npm scripts in package.json
- Legacy ESLint/Prettier rules
- Duplicate or conflicting configs
- Environment variable documentation for removed integrations

**Action:**
- Clean up .gitignore (remove entries for deleted paths)
- Remove unused npm scripts
- Simplify config files
- Update .env.example to reflect current integrations

### 4. Root Directory Organization

**Check for:**
- Markdown files count (currently 14 - can we reduce further?)
- Files that should be in docs/ instead of root
- CHANGELOG vs git history redundancy
- Multiple "quick start" or "getting started" files

**Target:**
- ≤10 markdown files in root
- Move detailed guides to docs/
- Consolidate quick-start content

### 5. Dependency Audit

**Check for:**
- Unused npm packages in package.json
- Dev dependencies that aren't used in any scripts
- Outdated dependencies with security issues
- Duplicate functionality across packages

**Action:**
- Run `npm prune`
- Remove unused dependencies
- Update outdated packages
- Document any intentionally locked versions

---

## Safety Requirements (CRITICAL)

**Before starting:**
1. ✅ Create new branch: `cleanup-round2-$(date +%Y%m%d)`
2. ✅ Create safety tag: `pre-cleanup2-$(date +%Y%m%d)`
3. ✅ Run full test suite: `npm test`
4. ✅ Verify no active Ralph processes: `ps aux | grep ralph-cli`

**During cleanup:**
1. ✅ Commit each phase separately (not one giant commit)
2. ✅ Test after each phase
3. ✅ Use `git mv` for file moves (preserves history)
4. ✅ Update .gitignore for any new ignore patterns

**After cleanup:**
1. ✅ Run full test suite: `npm test`
2. ✅ Test all core commands: ralph --help, prd, build, stream, factory, speak
3. ✅ Verify UI starts: `cd ui && npm run dev`
4. ✅ Check git status: `git status --short`
5. ✅ Create post-cleanup tag: `post-cleanup2-$(date +%Y%m%d)`

---

## Execution Plan Template

### Phase 0: Analysis & Planning
```bash
# Create branch and tag
git checkout -b cleanup-round2-$(date +%Y%m%d)
git tag -a pre-cleanup2-$(date +%Y%m%d) -m "Pre-cleanup snapshot"

# Analyze current state
du -sh .
find . -name "*.md" ! -path "./.git/*" ! -path "./node_modules/*" | wc -l
npm ls --depth=0 | grep -c "^├──\|^└──"

# Create analysis report
cat > CLEANUP-ROUND2-ANALYSIS.md << 'EOF'
# Cleanup Round 2 - Initial Analysis

## Current State
- Repository size: $(du -sh . | cut -f1)
- Markdown files: $(find . -name "*.md" ! -path "./.git/*" ! -path "./node_modules/*" | wc -l)
- NPM packages: $(npm ls --depth=0 2>/dev/null | grep -c "^├──\|^└──")

## Identified Issues
[List findings here]

## Proposed Changes
[List planned changes here]

## Risk Assessment
[Rate each change: ZERO/LOW/MEDIUM]
EOF
```

### Phase 1: Documentation Consolidation
**Focus:** Merge duplicate docs, move detailed guides to docs/

```bash
# Find duplicate content
grep -r "## Installation" --include="*.md" . | grep -v node_modules

# Identify candidates for consolidation
ls -lh *.md | awk '{if ($5 > 10000) print $9, $5}'

# Move detailed guides
mkdir -p docs/guides/
git mv [file] docs/guides/

# Commit
git commit -m "docs: consolidate duplicate documentation"
```

### Phase 2: Code & Script Cleanup
**Focus:** Remove unused scripts, commented code

```bash
# Find large commented blocks
grep -r "^#.*" --include="*.sh" .agents/ralph/ | wc -l

# Find unused shell scripts (not referenced anywhere)
for script in .agents/ralph/*.sh; do
  basename=$(basename "$script")
  refs=$(grep -r "$basename" --exclude-dir=.git . | wc -l)
  if [ "$refs" -lt 2 ]; then
    echo "Potentially unused: $script ($refs refs)"
  fi
done

# Remove unused scripts
git rm [unused-script].sh

# Commit
git commit -m "chore: remove unused scripts"
```

### Phase 3: Configuration Cleanup
**Focus:** Clean up config files, remove stale entries

```bash
# Audit .gitignore
grep -E "wedding-planner|ralph-voice-app|S2-Game" .gitignore

# Check for unused npm scripts
grep "\".*\":.*\"" package.json

# Clean up and commit
git commit -am "chore: clean up configuration files"
```

### Phase 4: Dependency Audit
**Focus:** Remove unused npm packages

```bash
# List all dependencies
npm ls --depth=0

# Check for unused (requires manual review)
npx depcheck

# Remove unused
npm uninstall [package-name]

# Commit
git commit -am "chore: remove unused dependencies"
```

### Phase 5: Validation & Merge
**Focus:** Test everything, merge to main

```bash
# Run tests
npm test

# Test commands
ralph --help
ralph prd --help
ralph stream status

# Merge
git checkout main
git merge cleanup-round2-$(date +%Y%m%d) --no-ff -m "chore: repository cleanup round 2

[Summary of changes]

Total impact:
- [X]MB saved
- [Y] files removed/moved
- Zero functionality loss"

# Tag
git tag -a post-cleanup2-$(date +%Y%m%d) -m "Post-cleanup snapshot"
```

---

## Success Criteria

**Quantitative:**
- Repository size reduced by 10-50MB
- Root markdown files ≤10
- npm dependencies reduced by 2-5 packages
- All tests passing

**Qualitative:**
- No duplicate documentation
- Clear, consolidated guides
- No stale references to removed features
- Improved repository navigation

**Validation:**
- ✅ All Ralph commands work
- ✅ UI server starts
- ✅ Tests pass
- ✅ No dangling references
- ✅ Git history clean

---

## Rollback Procedure

If anything goes wrong:

```bash
# Full rollback
git reset --hard pre-cleanup2-$(date +%Y%m%d)

# Partial rollback (specific commit)
git revert [commit-hash]

# Restore specific file
git checkout pre-cleanup2-$(date +%Y%m%d) -- [file-path]
```

---

## Example Areas to Investigate

### Potential Candidates for Removal/Consolidation:

1. **Documentation:**
   - CLEANUP-PROPOSAL.md (was this implemented? If yes, archive it)
   - Multiple AGENT*.md files (can they be consolidated?)
   - Redundant SKILL.md files across skills/
   - README files that duplicate CLAUDE.md content

2. **Scripts:**
   - .agents/ralph/test-tts-*.sh (are these still actively used?)
   - Experimental scripts in experimental/ (review if still needed)
   - Shell scripts with similar names (loop.sh variants?)

3. **Configuration:**
   - Multiple .prettierrc files
   - Legacy ESLint configs
   - Unused MCP server configurations

4. **Dependencies:**
   - Check if all packages in package.json are imported somewhere
   - Look for duplicate functionality (multiple markdown parsers?)

5. **Test Files:**
   - tests/fixtures/ - are all fixtures used?
   - Mocks for removed features
   - Stale integration test data

---

## Report Template

After completion, create CLEANUP-ROUND2-REPORT.md:

```markdown
# Repository Cleanup - Round 2 Report

**Date:** $(date)
**Branch:** cleanup-round2-$(date +%Y%m%d)

## Summary

- Repository size: [before] → [after] ([X]MB saved)
- Files removed: [count]
- Files moved: [count]
- Documentation files: [before] → [after]

## Changes Made

### Documentation
- [List changes]

### Code & Scripts
- [List changes]

### Configuration
- [List changes]

### Dependencies
- [List changes]

## Impact

- ✅ All tests passing
- ✅ All commands functional
- ✅ Zero feature loss

## Next Steps

- [ ] Push changes to remote
- [ ] Update README if needed
- [ ] Consider Round 3 cleanup (Y/N)
```

---

## Notes

- **Conservative approach:** When in doubt, move to experimental/ or documentation/history/ rather than delete
- **Git history is your friend:** Deleted files can always be recovered
- **Test frequently:** After each phase, run tests
- **Document decisions:** Note why files were kept or removed

---

**Ready to execute?** Start with Phase 0 analysis and create the branch/tag before making any changes.
