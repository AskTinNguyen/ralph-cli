# Missing Metrics Root Cause Analysis

**Date**: 2026-01-14
**Issue**: PRDs 15-30 show 0 data in trends dashboard despite being completed
**Reporter**: Gap analysis during PRD-28 review

---

## Summary

**Root Cause**: PRDs 15-21, 24, 25-30 were implemented **outside the ralph build loop**, resulting in plan-only runs with no story tracking data.

**Impact**: Trends dashboard shows these PRDs as 0% complete with 0 velocity, even though they're merged to main.

---

## Investigation Results

### Run File Audit

```
PRD-5:   1 run   (plan only)
PRD-6:   5 runs  (plan + builds) ✓
PRD-7:   0 runs
PRD-8:   0 runs
PRD-9:  11 runs  (plan + builds) ✓
PRD-10: 14 runs  (plan + builds) ✓
PRD-11:  4 runs  (plan + builds) ✓
PRD-12:  8 runs  (plan + builds) ✓
PRD-13:  8 runs  (plan + builds) ✓
PRD-14:  5 runs  (plan + builds) ✓
---------------------------------
PRD-15:  1 run   (plan only) ✗ BUT MERGED
PRD-16:  1 run   (plan only) ✗ BUT MERGED
PRD-17:  1 run   (plan only) ✗ BUT MERGED
PRD-18: 18 runs  (plan + builds) ✓
PRD-19:  1 run   (plan only) ✗ BUT MERGED
PRD-20:  9 runs  (plan + builds) ✓
PRD-21:  1 run   (plan only) ✗ BUT MERGED
PRD-22:  0 runs
PRD-23:  0 runs
PRD-24:  1 run   (plan only) ✗
PRD-25:  0 runs
PRD-26:  0 runs
PRD-27:  0 runs
PRD-28:  0 runs  ✗ BUT MERGED (trends dashboard itself!)
PRD-29:  0 runs
PRD-30:  0 runs
PRD-31: 16 runs  (plan + builds) ✓
PRD-32:  7 runs  (plan + builds) ✓
PRD-33:  0 runs
PRD-34:  2 runs
```

### Git History Verification

All of these PRDs ARE merged to main:

```bash
c516b03 Merge PRD-15: Shell completions
86e76a8 Merge PRD-16: CI/CD pipeline
e7c958b Merge PRD-17: Auto-Model Selection
21b72de Merge PRD-19: A/B testing framework
5e99a4c Merge PRD-20: Auto-remediation
7c4945c Merge PRD-21: Rollback & Retry
542b522 Merge PRD-28: Trends dashboard
```

### Example Plan-Only Run

**File**: `.ralph/PRD-15/runs/run-20260114-101755-25082-iter-1.md`

```markdown
# Ralph Run Summary

- Run ID: 20260114-101755-25082
- Iteration: 1
- Mode: plan          ← PLAN, not BUILD
- Started: 2026-01-14 10:17:55
- Ended: 2026-01-14 10:20:10
- Duration: 135s
- Status: success
- Log: /Users/tinnguyen/ralph-cli/.ralph/PRD-15/runs/...

## Git
- Head (before): 25e985d...
- Head (after): 25e985d...   ← No commits!

### Commits
- (none)                     ← No commits!

## Token Usage
- Input tokens: 173
- Output tokens: 74
- Model: None
```

**Missing**: No `Story:` field!

### Example Build Run (Working PRD)

**File**: `.ralph/PRD-9/runs/run-*.md`

```markdown
# Ralph Run Summary

- Run ID: 20260114-...
- Iteration: 2
- Mode: build         ← BUILD mode
- Story: US-001: Extract token metrics  ← HAS STORY!
- Started: 2026-01-14 10:20:15
- Status: success

## Git
### Commits
- feat(tokens): add token extraction from run logs  ← ACTUAL COMMIT!
```

---

## Technical Root Cause

### Aggregator Filter Logic

**File**: `lib/metrics/aggregator.js:734` (velocity function)

```javascript
// Only count successful story completions
const completedRuns = allRuns.filter((r) => r.status === "success" && r.story);
                                                                    ^^^^^^^^
                                                     This filters out plan runs!
```

**Why it filters out plan-only PRDs**:
1. Plan runs have `mode: "plan"` but NO `story:` field
2. Build runs have `mode: "build"` AND `story: "US-XXX: ..."`
3. Velocity filter: `r.story` → **excludes all plan runs**
4. PRDs with ONLY plan runs → 0 stories counted

### Burndown Logic

**File**: `lib/metrics/aggregator.js:860` (burndown function)

```javascript
function getPrdBurndown(ralphRoot, prdId) {
  // ...
  const runs = getRunsFromPrd(prdPath);
  const completedRuns = runs.filter((r) => r.status === "success" && r.story);
                                                                    ^^^^^^^^
                                                     Same filter!

  const completedStories = new Set(completedRuns.map((r) => r.story));
  const remaining = totalStories - completedStories.size;

  // If no story runs, remaining = total (0% complete)
}
```

---

## Why This Happened

### Hypothesis: Manual Implementation

These PRDs appear to have been:
1. **Planned** using `ralph plan` (generated plan run)
2. **Implemented manually** by developers (outside ralph build loop)
3. **Committed directly** to git
4. **Merged** to main

**Evidence**:
- Git shows completed PRDs with actual code changes
- But `.ralph/PRD-N/runs/` only has 1 plan run
- No build runs = no story completion tracking

### Why Manual Implementation?

Possible reasons:
- Developers bypassing ralph for speed
- Complex features requiring manual work
- Ralph build loop not used for these PRDs
- Testing workflow outside automated loop

---

## Impact Assessment

### Dashboard Display

**Trends Dashboard shows**:
- PRD-15 to PRD-21: 0% complete, 0 velocity, 0 stories
- Stream comparison: "N/A" estimated completion
- Burndown: Flat line at total story count
- Cost trends: Missing cost data (no token tracking)

**User Perception**:
- Looks like PRDs are stalled/abandoned
- Actually merged and complete
- Metrics are **misleading**

### Historical Data Loss

**What's missing**:
- ❌ Story completion timestamps
- ❌ Token usage per story
- ❌ Cost per feature
- ❌ Velocity trends
- ❌ Time-to-complete metrics
- ❌ Success/failure rates per story

**What's preserved**:
- ✓ Git commits (but not linked to stories)
- ✓ Code changes
- ✓ Merge history

---

## Solutions

### Option 1: Backfill Run Logs (RECOMMENDED)

**Create synthetic build runs from git history**

Script: `lib/metrics/backfill.js`

```javascript
// For each merged PRD without build runs:
// 1. Parse prd.md to extract stories
// 2. Parse git commits for story completion
// 3. Generate synthetic run-*.md files
// 4. Populate with:
//    - mode: "build"
//    - story: "US-XXX: ..."
//    - timestamp from git commit
//    - status: "success"
//    - commits: [commit hash]
```

**Pros**:
- Restores historical metrics
- Dashboard shows accurate completion %
- No code changes needed
- One-time operation

**Cons**:
- Synthetic data (not real run logs)
- Token costs unknown (can estimate)
- May not match exact workflow

### Option 2: Exclude Plan-Only PRDs

**Filter out PRDs with only plan runs from dashboard**

```javascript
// In aggregator, skip PRDs with no build runs:
function getStreamVelocityComparison(ralphRoot, options) {
  // ...
  const streams = streams.filter(s => s.buildRunCount > 0);
}
```

**Pros**:
- Quick fix
- No synthetic data
- Accurate for actual tracked PRDs

**Cons**:
- Hides completed PRDs
- Incomplete historical view
- Doesn't solve root problem

### Option 3: Git-Based Fallback

**Read story completion from git when no run logs exist**

```javascript
function getCompletedStories(prdPath) {
  const runs = getRunsFromPrd(prdPath);
  const buildRuns = runs.filter(r => r.story);

  if (buildRuns.length === 0) {
    // FALLBACK: Parse git log for PRD branch
    return getStoriesFromGitHistory(prdPath);
  }

  return buildRuns.map(r => r.story);
}
```

**Pros**:
- Automatic fallback
- Works for future manual implementations
- No backfill needed

**Cons**:
- Complex git parsing
- Slower than run log reading
- May miss stories without git conventions

---

## Recommendations

### Immediate (P0)
1. ✅ **Backfill PRDs 15-21, 28** using Option 1
2. ✅ **Document workflow**: Update CLAUDE.md to mandate `ralph build` usage
3. ✅ **Add validation**: Warn if PRD merged without build runs

### Short-Term (P1)
4. **Implement Option 3**: Git fallback for future manual PRDs
5. **Add metric**: Track "implementation method" (ralph vs manual)
6. **Dashboard indicator**: Show "estimated metrics" badge for git-derived data

### Long-Term (P2)
7. **Enforce ralph build**: Pre-commit hooks to require run logs
8. **Alternative tracking**: Support manual story completion logging
9. **Audit report**: Monthly check for PRDs with missing metrics

---

## Prevention

### For Future PRDs

**ALWAYS use ralph build loop**:
```bash
# ✓ CORRECT
ralph plan
ralph build 10

# ✗ INCORRECT
ralph plan
# ... manually implement code ...
git add . && git commit && git push
```

### Validation Hook

Add to `.agents/ralph/stream.sh`:
```bash
# Before merge, check for build runs
if [ $(ls .ralph/PRD-$N/runs/*.md 2>/dev/null | wc -l) -eq 1 ]; then
  echo "⚠️  WARNING: PRD-$N has only plan run, no build runs!"
  echo "Metrics will show 0% complete."
  read -p "Continue merge anyway? [y/N] " confirm
fi
```

---

## Files Modified

### Analysis Documents
- `.ralph/PRD-28/GAP_ANALYSIS.md` - PRD-28 specific gaps
- `.ralph/MISSING_METRICS_ANALYSIS.md` - This document

### Code To Review
- `lib/metrics/aggregator.js:734` - Velocity filter
- `lib/metrics/aggregator.js:860` - Burndown filter
- `lib/eval/parser.js` - Run summary parser

### PRDs Affected
- PRD-15 (Shell completions)
- PRD-16 (CI/CD)
- PRD-17 (Auto-model selection)
- PRD-19 (A/B testing)
- PRD-21 (Rollback/retry)
- PRD-28 (Trends dashboard - IRONIC!)

---

## Conclusion

The trends dashboard works correctly for PRDs tracked through `ralph build`, but shows 0 data for manually-implemented PRDs. This creates a misleading view that 6+ completed PRDs are at 0% progress.

**Next Action**: Implement backfill script to generate synthetic run logs from git history, restoring accurate metrics for completed PRDs.
