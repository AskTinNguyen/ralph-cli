# Repository Cleanup - Round 3 Prompt

**Purpose:** Consolidate scattered markdown files across the repository into organized documentation structure.

**Focus:** Documentation organization - eliminate duplication, consolidate scattered files, create clear information architecture.

---

## Task Overview

After two rounds of cleanup, markdown files are still scattered across multiple directories. This round focuses on:

1. **Consolidating scattered `.ralph/` root markdown files**
2. **Organizing `docs/` directory into logical subdirectories**
3. **Removing duplicate content between `docs/` and `ui/public/docs/`**
4. **Cleaning up scattered UI documentation**
5. **Creating clear documentation navigation**

**Goal:** Create a clear, hierarchical documentation structure where every file has an obvious home.

---

## Current State Analysis

### Markdown File Distribution

```
Root (7 files) ✅
├── AGENTS.md
├── CLAUDE.md
├── CLEANUP-ROUND2-ANALYSIS.md
├── CLEANUP-ROUND2-REPORT.md
├── README.md
├── ROADMAP.md
└── VISION.md

docs/ (15 files) ⚠️ - NEEDS ORGANIZATION
├── agent-browser-cheatsheet.md
├── applescript-features.md
├── auto-speak-guide.md
├── automation-install.md
├── DESIGN_SYSTEM.md
├── good-spec-cheatsheet.md
├── PLAN_IMPROVEMENT_GUIDE.md
├── ralph-cli-documentation-summary.md ⚠️ - Meta-doc, archive?
├── ralph-cli-installation-issues.md ⚠️ - Meta-doc, archive?
├── ralph-cli-readme-improvements.md ⚠️ - Meta-doc, archive?
├── TESTING_CHEATSHEET.md
├── TESTING.md
├── ui-testing-guide.md
├── VOICE_CHANGELOG.md
└── VOICE.md

documentation/history/ (13 files) ✅ - Historical archive, keep as-is

.agents/ralph/ (11 files) ✅ - Prompts and agent docs, keep as-is

.ralph/ root (10 files) ⚠️ - SCATTERED, NEEDS CONSOLIDATION
├── auto-speak-implementation.md
├── BACKFILL_SUMMARY.md
├── diagnosis.md
├── guardrails.md ✅ - Active file, keep
├── IMPLEMENTATION_PLAN.md
├── MERGE_SAFEGUARDS_SUMMARY.md
├── MISSING_METRICS_ANALYSIS.md
├── tts-overlap-fix-summary.md
├── voice-fix-summary.md
└── voice-management-summary.md

ui/ (6 files) ⚠️ - SCATTERED
├── PLACEHOLDER_LINKS_STATUS.md ⚠️ - Temp doc?
├── CONTRIBUTING.md ✅ - Keep
├── LINK_RELATIONSHIPS.md ⚠️ - Meta-doc, archive?
├── tests/wizard-functional-test.md ⚠️ - Should be in tests/
└── public/docs/AGENT_GUIDE_IMPROVEMENTS.md ⚠️ - Meta-doc, archive?

ui/public/docs/ (HTML docs) ✅ - UI documentation site, keep
```

---

## Identified Issues

### 1. Scattered `.ralph/` Implementation Summaries

**Problem:** `.ralph/` root has 9 implementation summary files that are historical records but clutter the directory.

**Files:**
- `auto-speak-implementation.md`
- `BACKFILL_SUMMARY.md`
- `diagnosis.md`
- `IMPLEMENTATION_PLAN.md`
- `MERGE_SAFEGUARDS_SUMMARY.md`
- `MISSING_METRICS_ANALYSIS.md`
- `tts-overlap-fix-summary.md`
- `voice-fix-summary.md`
- `voice-management-summary.md`

**Action:** Move to `.ralph/implementation-history/` or `documentation/history/implementation/`

**Keep in `.ralph/` root:** Only `guardrails.md` (active file used by build system)

---

### 2. Meta-Documentation in `docs/`

**Problem:** `docs/` contains meta-documentation about Ralph itself (not user-facing guides).

**Files:**
- `ralph-cli-documentation-summary.md` - Analysis of documentation
- `ralph-cli-installation-issues.md` - Installation problem tracking
- `ralph-cli-readme-improvements.md` - README improvement proposals

**Action:** Move to `documentation/history/` (these are historical analysis documents)

---

### 3. Unorganized `docs/` Directory

**Problem:** `docs/` is a flat directory with 15 files - no logical grouping.

**Proposed Structure:**

```
docs/
├── guides/                    # User-facing guides
│   ├── installation/
│   │   └── automation-install.md
│   ├── testing/
│   │   ├── TESTING.md
│   │   ├── TESTING_CHEATSHEET.md
│   │   └── ui-testing-guide.md
│   ├── voice/
│   │   ├── VOICE.md
│   │   ├── VOICE_CHANGELOG.md
│   │   └── auto-speak-guide.md
│   └── features/
│       ├── applescript-features.md
│       └── agent-browser-cheatsheet.md
├── planning/                  # Planning and design docs
│   ├── PLAN_IMPROVEMENT_GUIDE.md
│   └── good-spec-cheatsheet.md
└── design/                    # Design system docs
    └── DESIGN_SYSTEM.md
```

**Benefits:**
- Clear categorization
- Easier navigation
- Logical grouping
- Scalable structure

---

### 4. Duplicate Content: `docs/` vs `ui/public/docs/`

**Problem:** Some content exists in both locations.

**Examples:**
- `docs/VOICE.md` vs references in `ui/public/docs/`
- `docs/TESTING.md` vs `ui/public/docs/TESTING.md` (potential)

**Action:**
- Identify duplicates with `diff`
- Keep `ui/public/docs/` for UI server (HTML rendered)
- Keep `docs/` for standalone markdown reading
- If identical, delete one and symlink (or document relationship)

---

### 5. Scattered UI Documentation

**Problem:** UI documentation scattered across `ui/` directory.

**Files:**
- `ui/PLACEHOLDER_LINKS_STATUS.md` - Temporary tracking doc
- `ui/LINK_RELATIONSHIPS.md` - Meta-documentation
- `ui/public/docs/AGENT_GUIDE_IMPROVEMENTS.md` - Improvement proposals
- `ui/tests/wizard-functional-test.md` - Should be with tests

**Actions:**
- Move `wizard-functional-test.md` to `ui/tests/docs/` or inline with test
- Archive `PLACEHOLDER_LINKS_STATUS.md` and `LINK_RELATIONSHIPS.md` to `documentation/history/ui/`
- Archive `AGENT_GUIDE_IMPROVEMENTS.md` to `documentation/history/ui/`

---

### 6. Root Directory Cleanup Candidates

**Current Root (7 files):**
- ✅ `AGENTS.md` - Keep (core agent rules)
- ✅ `CLAUDE.md` - Keep (main reference)
- ⚠️ `CLEANUP-ROUND2-ANALYSIS.md` - Archive to `documentation/history/`
- ⚠️ `CLEANUP-ROUND2-REPORT.md` - Archive to `documentation/history/`
- ✅ `README.md` - Keep (entry point)
- ✅ `ROADMAP.md` - Keep (project roadmap)
- ✅ `VISION.md` - Keep (project vision)

**Action:** Archive cleanup reports → `documentation/history/cleanup/`

**Target:** 5 root markdown files (AGENTS.md, CLAUDE.md, README.md, ROADMAP.md, VISION.md)

---

## Proposed Changes

### Phase 1: Consolidate `.ralph/` Implementation Summaries

**Goal:** Clean up `.ralph/` root directory

```bash
# Create implementation history directory
mkdir -p documentation/history/implementation

# Move implementation summaries
git mv .ralph/auto-speak-implementation.md documentation/history/implementation/
git mv .ralph/BACKFILL_SUMMARY.md documentation/history/implementation/
git mv .ralph/diagnosis.md documentation/history/implementation/
git mv .ralph/IMPLEMENTATION_PLAN.md documentation/history/implementation/
git mv .ralph/MERGE_SAFEGUARDS_SUMMARY.md documentation/history/implementation/
git mv .ralph/MISSING_METRICS_ANALYSIS.md documentation/history/implementation/
git mv .ralph/tts-overlap-fix-summary.md documentation/history/implementation/
git mv .ralph/voice-fix-summary.md documentation/history/implementation/
git mv .ralph/voice-management-summary.md documentation/history/implementation/

# Commit
git commit -m "docs: consolidate .ralph/ implementation summaries to documentation/history/implementation/"
```

**Result:** `.ralph/` root clean, only `guardrails.md` remains

---

### Phase 2: Organize `docs/` Into Subdirectories

**Goal:** Create logical hierarchy in `docs/`

```bash
# Create subdirectories
mkdir -p docs/guides/{installation,testing,voice,features}
mkdir -p docs/planning
mkdir -p docs/design

# Move files to categories
# Installation
git mv docs/automation-install.md docs/guides/installation/

# Testing
git mv docs/TESTING.md docs/guides/testing/
git mv docs/TESTING_CHEATSHEET.md docs/guides/testing/
git mv docs/ui-testing-guide.md docs/guides/testing/

# Voice
git mv docs/VOICE.md docs/guides/voice/
git mv docs/VOICE_CHANGELOG.md docs/guides/voice/
git mv docs/auto-speak-guide.md docs/guides/voice/

# Features
git mv docs/applescript-features.md docs/guides/features/
git mv docs/agent-browser-cheatsheet.md docs/guides/features/

# Planning
git mv docs/PLAN_IMPROVEMENT_GUIDE.md docs/planning/
git mv docs/good-spec-cheatsheet.md docs/planning/

# Design
git mv docs/DESIGN_SYSTEM.md docs/design/

# Commit
git commit -m "docs: organize docs/ directory into logical subdirectories"
```

**Result:** Clear docs/ hierarchy with categories

---

### Phase 3: Archive Meta-Documentation

**Goal:** Remove meta-docs from `docs/` to history

```bash
# Archive Ralph meta-docs
git mv docs/ralph-cli-documentation-summary.md documentation/history/
git mv docs/ralph-cli-installation-issues.md documentation/history/
git mv docs/ralph-cli-readme-improvements.md documentation/history/

# Create UI history directory
mkdir -p documentation/history/ui

# Archive UI meta-docs
git mv ui/PLACEHOLDER_LINKS_STATUS.md documentation/history/ui/
git mv ui/LINK_RELATIONSHIPS.md documentation/history/ui/
git mv ui/public/docs/AGENT_GUIDE_IMPROVEMENTS.md documentation/history/ui/

# Commit
git commit -m "docs: archive meta-documentation to documentation/history/"
```

---

### Phase 4: Move Misplaced Test Documentation

**Goal:** Put test docs with tests

```bash
# Create test docs directory
mkdir -p ui/tests/docs

# Move test documentation
git mv ui/tests/wizard-functional-test.md ui/tests/docs/

# Commit
git commit -m "docs: move test documentation to ui/tests/docs/"
```

---

### Phase 5: Archive Cleanup Reports

**Goal:** Clean up root directory

```bash
# Create cleanup history directory
mkdir -p documentation/history/cleanup

# Move cleanup reports
git mv CLEANUP-ROUND2-ANALYSIS.md documentation/history/cleanup/
git mv CLEANUP-ROUND2-REPORT.md documentation/history/cleanup/

# Move this prompt after execution
git mv CLEANUP-ROUND-3-PROMPT.md documentation/history/cleanup/

# Commit
git commit -m "docs: archive cleanup reports to documentation/history/cleanup/"
```

**Result:** Root directory has 5 essential files only

---

### Phase 6: Update References

**Goal:** Update all links to moved files

```bash
# Files that may reference moved docs:
# - CLAUDE.md
# - README.md
# - .agents/ralph/AGENTS.md
# - skills/*/AGENTS.md

# Search for broken links
grep -r "docs/VOICE.md\|docs/TESTING.md\|docs/auto-speak-guide.md" --include="*.md" .

# Update references (use Edit tool)

# Commit
git commit -m "docs: update references to moved documentation files"
```

---

### Phase 7: Create Documentation Index

**Goal:** Make documentation discoverable

```bash
# Create docs/README.md with navigation
cat > docs/README.md << 'EOF'
# Ralph CLI Documentation

**Complete documentation for Ralph CLI autonomous coding system.**

---

## 📚 User Guides

### Installation & Setup
- [Automation Install Guide](guides/installation/automation-install.md)

### Testing
- [Complete Testing Guide](guides/testing/TESTING.md)
- [Testing Cheatsheet](guides/testing/TESTING_CHEATSHEET.md)
- [UI Testing Guide](guides/testing/ui-testing-guide.md)

### Voice Features
- [Voice & TTS Guide](guides/voice/VOICE.md)
- [Voice Feature Changelog](guides/voice/VOICE_CHANGELOG.md)
- [Auto-Speak Setup Guide](guides/voice/auto-speak-guide.md)

### Features
- [AppleScript Features](guides/features/applescript-features.md)
- [Agent Browser Cheatsheet](guides/features/agent-browser-cheatsheet.md)

---

## 📋 Planning & Design

### Planning
- [Plan Improvement Guide](planning/PLAN_IMPROVEMENT_GUIDE.md)
- [Good Spec Cheatsheet](planning/good-spec-cheatsheet.md)

### Design
- [Design System](design/DESIGN_SYSTEM.md)

---

## 🔗 Quick Links

- **Main Reference:** [CLAUDE.md](../CLAUDE.md) - Complete agent reference
- **Agent Rules:** [AGENTS.md](../AGENTS.md) - Core agent decision trees
- **Roadmap:** [ROADMAP.md](../ROADMAP.md) - Feature roadmap
- **Vision:** [VISION.md](../VISION.md) - Project vision

---

## 📖 Historical Documentation

See [documentation/history/](../documentation/history/) for historical docs, implementation summaries, and past cleanup reports.
EOF

git add docs/README.md
git commit -m "docs: add documentation index with navigation"
```

---

## Safety Requirements (CRITICAL)

**Before starting:**
1. ✅ Create new branch: `cleanup-round3-$(date +%Y%m%d)`
2. ✅ Create safety tag: `pre-cleanup3-$(date +%Y%m%d)`
3. ✅ Verify no active Ralph processes: `ps aux | grep ralph-cli`

**During cleanup:**
1. ✅ Commit each phase separately
2. ✅ Use `git mv` for all file moves (preserves history)
3. ✅ Verify no broken links after each phase
4. ✅ Update references in CLAUDE.md, README.md, and AGENTS.md

**After cleanup:**
1. ✅ Search for broken markdown links: `grep -r "\[.*\](.*\.md)" --include="*.md" .`
2. ✅ Verify core commands work: `ralph --help`, `ralph prd --help`
3. ✅ Check documentation accessibility
4. ✅ Create post-cleanup tag: `post-cleanup3-$(date +%Y%m%d)`

---

## Success Criteria

### Quantitative Goals

| Metric | Target |
|--------|--------|
| Root markdown files | 5 (down from 7) |
| `.ralph/` root markdown files | 1 (guardrails.md only) |
| Unorganized docs/ files | 0 (all in subdirectories) |
| Scattered UI docs | 0 (all organized) |

### Qualitative Goals

- ✅ Clear documentation hierarchy (guides, planning, design)
- ✅ All implementation summaries archived
- ✅ No meta-documentation in user-facing directories
- ✅ Easy navigation with docs/README.md index
- ✅ Zero broken links
- ✅ Logical file locations (obvious where things belong)

---

## Validation Checklist

**File Organization:**
- [ ] `.ralph/` root has only `guardrails.md`
- [ ] `docs/` has clear subdirectory structure
- [ ] No meta-docs in `docs/` or `ui/`
- [ ] Root directory has 5 markdown files
- [ ] Test docs are with tests

**Reference Integrity:**
- [ ] No broken links in CLAUDE.md
- [ ] No broken links in README.md
- [ ] No broken links in AGENTS.md
- [ ] docs/README.md navigation works

**Functionality:**
- [ ] Ralph commands work
- [ ] Documentation accessible
- [ ] Git history preserved (check with `git log --follow`)

---

## Expected Impact

**Before:**
```
Root: 7 files
docs/: 15 files (flat, unorganized)
.ralph/ root: 10 files (cluttered with summaries)
ui/: 6 scattered docs
Total: 38 markdown files in wrong places
```

**After:**
```
Root: 5 files (essential only)
docs/: Hierarchical structure with README.md index
  └── guides/, planning/, design/ subdirectories
.ralph/ root: 1 file (guardrails.md)
ui/: 1 file (CONTRIBUTING.md)
documentation/history/: All historical/meta-docs archived
Total: Clean, organized, discoverable documentation
```

---

## Rollback Procedure

If issues arise:

```bash
# Full rollback
git reset --hard pre-cleanup3-$(date +%Y%m%d)

# Partial rollback (specific phase)
git revert [commit-hash]

# Restore specific file
git checkout pre-cleanup3-$(date +%Y%m%d) -- [file-path]

# Restore directory
git checkout pre-cleanup3-$(date +%Y%m%d) -- docs/
```

---

## Post-Cleanup Tasks

1. **Update README.md:** Add link to `docs/README.md`
2. **Update CLAUDE.md:** Update paths to moved files
3. **Create docs/README.md:** Navigation index (included in Phase 7)
4. **Verify UI server:** Test that `ui/public/docs/` still works
5. **Update .gitignore:** Ensure new directories aren't ignored

---

## Notes

- **Conservative approach:** Move to `documentation/history/` rather than delete
- **Git history preserved:** All moves use `git mv`
- **Searchability maintained:** Files still in repo, just better organized
- **Reversible:** All changes can be rolled back via git tags

---

## Execution Order

**Recommended sequence:**

1. Phase 1: Consolidate `.ralph/` → Reduces clutter immediately
2. Phase 5: Archive cleanup reports → Clean root directory
3. Phase 2: Organize `docs/` → Create structure
4. Phase 3: Archive meta-docs → Remove clutter
5. Phase 4: Move test docs → Put things in right place
6. Phase 6: Update references → Fix broken links
7. Phase 7: Create index → Make discoverable

**Reasoning:** Do the high-impact, low-risk changes first (moving summaries, archiving reports), then tackle the more complex documentation reorganization.

---

**Ready to execute?** Start with Phase 1 after creating branch and tag.
