# Debugging Scope Validation Issues

Quick guide for troubleshooting scope validation problems in Ralph CLI.

## Quick Diagnosis

### Is scope validation enabled?

```bash
# Check config
grep RALPH_VALIDATE_SCOPE .agents/ralph/config.sh

# Expected output for enabled:
export RALPH_VALIDATE_SCOPE=true
```

### Is sequential mode enabled?

```bash
# Check config
grep RALPH_SEQUENTIAL_MODE .agents/ralph/config.sh

# Expected output for enabled:
export RALPH_SEQUENTIAL_MODE=true
```

### Check current active PRD

```bash
# Read active PRD marker
cat .ralph/.active-prd

# No such file? No active PRD (validation will skip)
```

## Common Issues

### Issue 1: Validation not running

**Symptoms:**
- Agent modifies other PRD files
- No rollback happens
- No "SCOPE VIOLATION" message

**Diagnosis:**
```bash
# Check if validation is enabled
grep RALPH_VALIDATE_SCOPE .agents/ralph/config.sh

# Check if active PRD is set during build
echo $ACTIVE_PRD_NUMBER  # Run during build iteration
```

**Fix:**
```bash
# Enable validation in config
echo 'export RALPH_VALIDATE_SCOPE=true' >> .agents/ralph/config.sh

# Verify it's set during build
# Active PRD should be set automatically by stream.sh:1157
```

### Issue 2: False positives (legitimate changes blocked)

**Symptoms:**
- Validation fails on legitimate source code changes
- Files with "PRD" in path get flagged incorrectly

**Example:**
```bash
# This SHOULD pass but gets blocked:
- src/PRD-helpers/utils.ts  # Not in .ralph/, should be allowed
```

**Diagnosis:**
```bash
# Run test to verify behavior
npm run test:scope

# Check specific test:
# "PRD pattern in source code - should not false positive"
```

**Current behavior:**
- ✅ Validation ONLY checks `.ralph/PRD-N/` pattern
- ✅ Files outside `.ralph/` are never flagged
- If you're seeing false positives, it's a bug

### Issue 3: Shared .ralph files blocked

**Symptoms:**
- Changes to `.ralph/guardrails.md` get blocked
- Other shared files in `.ralph/` get flagged

**Expected behavior:**
```bash
# These SHOULD pass (not PRD-specific):
- .ralph/guardrails.md         ✅ OK
- .ralph/locks/PRD-2.lock       ✅ OK
- .ralph/.active-prd            ✅ OK

# These SHOULD fail (PRD-specific):
- .ralph/PRD-3/plan.md          ❌ VIOLATION (if working on PRD-2)
```

**Diagnosis:**
```bash
# Check the regex pattern in validate_prd_scope()
# File: .agents/ralph/loop.sh:1857

# Current pattern:
if [[ "$file" =~ \.ralph/PRD-([0-9]+)/ ]]; then
  # Only matches .ralph/PRD-N/ (uppercase)
fi
```

**Fix:**
- Pattern is correct
- Shared files should pass
- If blocked, check git diff output manually

### Issue 4: Rollback not working

**Symptoms:**
- "SCOPE VIOLATION DETECTED" message appears
- But commit is NOT rolled back
- Violating files remain in history

**Diagnosis:**
```bash
# Check if git reset command succeeds
# Manually test rollback:
git commit --allow-empty -m "Test commit"
git reset --hard HEAD~1  # Should rollback

# Check if HEAD~1 exists
git log --oneline -2
```

**Possible causes:**
- Git repo in detached HEAD state
- Not enough commits (need at least 2)
- Git error not handled properly

**Fix:**
```bash
# Ensure you're on a branch
git checkout main

# Ensure multiple commits exist
git log --oneline | head -3
```

### Issue 5: Validation runs but passes when it shouldn't

**Symptoms:**
- Agent modified other PRD files
- No violation detected
- Commit remains in history

**Diagnosis:**
```bash
# Check what files were actually changed
git diff --name-only HEAD~1

# Expected to see cross-PRD changes like:
# .ralph/PRD-3/plan.md (while working on PRD-2)

# Check if ACTIVE_PRD_NUMBER matches
echo $ACTIVE_PRD_NUMBER  # Should be set to current PRD
```

**Debug validation manually:**
```bash
# Set environment
export RALPH_VALIDATE_SCOPE=true
export ACTIVE_PRD_NUMBER="PRD-2"

# Run validation function directly
# (Extract from loop.sh and run in isolated shell)
```

## Testing Specific Scenarios

### Test cross-PRD contamination detection

```bash
# Create test scenario
cd /tmp
git init ralph-test
cd ralph-test
mkdir -p .ralph/PRD-{1,2,3}
touch .ralph/PRD-1/plan.md
touch .ralph/PRD-2/plan.md
touch .ralph/PRD-3/plan.md
git add . && git commit -m "Initial"

# Simulate violation: modify PRD-3 while working on PRD-2
echo "Modified" >> .ralph/PRD-3/plan.md
git add . && git commit -m "Violation"

# Run validation
export RALPH_VALIDATE_SCOPE=true
export ACTIVE_PRD_NUMBER="PRD-2"

# Extract and run validate_prd_scope() function
# Should detect .ralph/PRD-3/plan.md and rollback
```

### Test shared file allowance

```bash
# Same setup as above
echo "Updated guardrails" >> .ralph/guardrails.md
git add . && git commit -m "Update shared file"

# Run validation
export RALPH_VALIDATE_SCOPE=true
export ACTIVE_PRD_NUMBER="PRD-2"

# Should PASS (guardrails.md is not PRD-specific)
```

## Running Tests

### Run all scope validation tests

```bash
npm run test:scope
```

### Run specific test scenario

```bash
# Edit tests/test-scope-validation.mjs
# Comment out unwanted tests in runAll()

# Run
node tests/test-scope-validation.mjs
```

### Manual test in real repo

```bash
# 1. Enable validation
echo 'export RALPH_VALIDATE_SCOPE=true' >> .agents/ralph/config.sh

# 2. Start build with sequential mode
export RALPH_SEQUENTIAL_MODE=true
ralph stream build 2 1

# 3. Watch for violations in output
# Look for: "SCOPE VIOLATION DETECTED"

# 4. Check if rollback happened
git log --oneline -3
# Should NOT see the violating commit
```

## Log Analysis

### Check iteration logs for violations

```bash
# Find recent run log
ls -t .ralph/PRD-2/runs/*.log | head -1

# Search for violations
grep -i "scope violation" .ralph/PRD-2/runs/*.log

# Expected output if violation occurred:
# SCOPE VIOLATION DETECTED
# Agent modified files outside PRD-2 scope:
#   - .ralph/PRD-3/plan.md (PRD-3)
```

### Check progress.md for failed iterations

```bash
# Look for scope-violation failure
cat .ralph/PRD-2/progress.md | grep -A 5 "scope-violation"

# Expected format:
# ## Iteration 3 - Failed
# - Story: US-003
# - Reason: scope-violation
# - Files: .ralph/PRD-3/plan.md
```

## Performance Impact

Scope validation adds minimal overhead:

- **Per iteration:** ~50ms (single `git diff` command)
- **On violation:** ~200ms (rollback via `git reset`)
- **No impact when disabled:** 0ms (early return)

## Disabling Validation

### Temporary (single build)

```bash
# Override in environment
RALPH_VALIDATE_SCOPE=false ralph stream build 2 5
```

### Permanent (all builds)

```bash
# Edit config
echo 'export RALPH_VALIDATE_SCOPE=false' >> .agents/ralph/config.sh
```

### Per-PRD basis

Not currently supported. Validation is global (all PRDs) or disabled.

Future enhancement: `.ralph/PRD-2/.no-validate` marker file?

## Related Issues

- **Issue #1:** Scope validation should support lowercase prd-N directories
- **Issue #2:** Add warning mode (log violations without rollback)
- **Issue #3:** Track violation history in progress.md

## Getting Help

If scope validation isn't working as expected:

1. **Run tests:** `npm run test:scope` (should all pass)
2. **Check config:** `cat .agents/ralph/config.sh`
3. **Enable debug mode:** Add `set -x` to validate_prd_scope()
4. **Create minimal reproduction:** Use test scenario above
5. **Open issue:** Include test repo + logs

## See Also

- [README-scope-validation.md](./README-scope-validation.md) - Full test documentation
- [CLAUDE.md](../CLAUDE.md#stream-commands-parallel-execution) - Sequential mode docs
- [loop.sh:1826-1884](../.agents/ralph/loop.sh) - Validation implementation
