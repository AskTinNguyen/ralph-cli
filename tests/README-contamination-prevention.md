# Contamination Prevention Test Suite

Comprehensive testing for Ralph CLI's 4-layer contamination prevention system.

## Overview

Ralph CLI uses a **defense-in-depth** approach to prevent PRD contamination in large repositories. This test suite validates Layers 2, 3, and 4 of the protection system.

## Test Coverage Summary

| Layer | Component | Tests | Status | Documentation |
|-------|-----------|-------|--------|---------------|
| **Layer 1** | Configuration | Manual | ✅ | [CLAUDE.md](../CLAUDE.md) |
| **Layer 2** | Active PRD Marker | 18 tests | ✅ Passing | [README-active-prd-marker.md](./README-active-prd-marker.md) |
| **Layer 3** | Scope Validation | 10 tests | ✅ Passing | [README-scope-validation.md](./README-scope-validation.md) |
| **Layer 4** | Lock Mechanism | 15 tests | ✅ Passing | Built into stream.sh |

**Total:** 43 automated tests covering Layers 2, 3 & 4

## What Gets Tested

### Layer 2: Active PRD Marker (18 tests)

**Purpose:** Prevent multiple PRDs from building simultaneously in sequential mode

**Test categories:**
- ✅ Marker file operations (8 tests)
- ✅ Sequential mode enforcement (6 tests)
- ✅ Marker lifecycle (4 tests)

**Key scenarios:**
```bash
# Scenario 1: Sequential blocking
Terminal 1: ralph stream build 1 10  # Sets .active-prd = "1"
Terminal 2: ralph stream build 2 5   # BLOCKED (PRD-1 active)

# Scenario 2: Sequential workflow
PRD-1 completes → Marker cleared → PRD-2 starts
```

**Run tests:**
```bash
npm run test:marker
```

### Layer 3: Scope Validation (10 tests)

**Purpose:** Detect and rollback commits that modify files outside current PRD scope

**Test categories:**
- ✅ Configuration tests (2 tests)
- ✅ Valid scenarios (4 tests)
- ✅ Invalid scenarios (2 tests)
- ✅ Edge cases (2 tests)

**Key scenarios:**
```bash
# Scenario 1: Cross-PRD contamination detected
Working on: PRD-2
Changes: src/app.ts, .ralph/PRD-3/plan.md  # ❌ VIOLATION!
Result: ROLLBACK commit, mark iteration failed

# Scenario 2: Valid changes
Working on: PRD-2
Changes: src/app.ts, .ralph/PRD-2/progress.md  # ✅ OK
Result: Pass validation, continue
```

**Run tests:**
```bash
npm run test:scope
```

### Layer 4: Lock Mechanism (15 tests)

**Purpose:** Prevent the same PRD from running multiple concurrent builds

**Test categories:**
- ✅ Lock acquisition and release (2 tests)
- ✅ Concurrent build detection (3 tests)
- ✅ Stale lock detection and cleanup (5 tests)
- ✅ Lock file management (3 tests)
- ✅ Lock persistence (2 tests)

**Key scenarios:**
```bash
# Scenario 1: Same PRD blocked
Terminal 1: ralph stream build 1 10  # Acquires lock: .ralph/locks/PRD-1.lock
Terminal 2: ralph stream build 1 5   # BLOCKED (PRD-1 lock exists)

# Scenario 2: Different PRDs allowed
Terminal 1: ralph stream build 1 10  # Lock: PRD-1.lock
Terminal 2: ralph stream build 2 5   # ALLOWED (different PRD)

# Scenario 3: Stale lock cleanup
Lock file exists with PID 12345
Process 12345 is dead → Lock is stale → Auto-cleanup on next acquire
```

**Run tests:**
```bash
npm run test:lock
```

## Running Tests

### Individual test suites

```bash
# Layer 2 tests only
npm run test:marker

# Layer 3 tests only
npm run test:scope

# Layer 4 tests only
npm run test:lock

# Run all contamination prevention tests
npm run test:marker && npm run test:scope && npm run test:lock
```

### All integration tests

```bash
# Run all integration tests (includes Layers 2, 3 & 4)
npm run test:integration

# Run all tests
npm run test:all
```

### Direct execution

```bash
# Layer 2
./tests/test-active-prd-marker.mjs
node tests/test-active-prd-marker.mjs

# Layer 3
./tests/test-scope-validation.mjs
node tests/test-scope-validation.mjs

# Layer 4
./tests/test-lock-mechanism.mjs
node tests/test-lock-mechanism.mjs
```

## Expected Output

### Layer 2 (Active PRD Marker)

```
🧪 Active PRD Marker Tests (Layer 2)

═══════════════════════════════════════════════════════

✅ Set active PRD marker - creates file
✅ Sequential mode enabled - blocks concurrent PRDs
✅ Sequential workflow - PRD-1 completes, then PRD-2 starts
... (15 more tests)

═══════════════════════════════════════════════════════

✅ Passed: 18
❌ Failed: 0
📊 Total:  18
```

### Layer 3 (Scope Validation)

```
🧪 Scope Validation Layer Tests (Layer 3)

═══════════════════════════════════════════════════════

✅ Validation disabled (RALPH_VALIDATE_SCOPE=false)
✅ Other PRD files changed - should detect and rollback
✅ Multiple PRD violations - should detect all
... (7 more tests)

═══════════════════════════════════════════════════════

✅ Passed: 10
❌ Failed: 0
📊 Total:  10
```

### Layer 4 (Lock Mechanism)

```
🧪 Lock Mechanism Tests (Layer 4)

═══════════════════════════════════════════════════════

✅ Acquire lock - creates lock file with PID
✅ Concurrent same PRD - blocks duplicate builds
✅ Stale lock detection - identifies dead PIDs
... (12 more tests)

═══════════════════════════════════════════════════════

✅ Passed: 15
❌ Failed: 0
📊 Total:  15
```

## How Layers Work Together

### Example: Building PRD-2 in Sequential Mode

```bash
# Step 1: User starts build
$ ralph stream build 2 5

# Layer 2: Active PRD Marker Check (BEFORE build starts)
if [[ "$RALPH_SEQUENTIAL_MODE" == "true" ]]; then
  if has_active_prd && ! is_prd_active "PRD-2"; then
    echo "BLOCKED: PRD-1 is already building"
    exit 1  # ← Blocks entire build
  fi
fi

# ✅ Pass Layer 2 → Set marker: .ralph/.active-prd = "2"
# Build starts...

# Step 2: Agent completes iteration 1
# ... makes changes to files
# ... commits changes
# git commit -m "US-001: Add feature"

# Layer 3: Scope Validation (AFTER each iteration)
validate_prd_scope() {
  if [[ "$RALPH_VALIDATE_SCOPE" != "true" ]]; then
    return 0  # Skip if disabled
  fi

  # Check files changed in last commit
  changed_files=$(git diff --name-only HEAD~1)

  # Detect violations
  if [[ "$file" =~ \.ralph/PRD-([0-9]+)/ ]]; then
    if [[ "$other_prd" != "2" ]]; then
      # VIOLATION: Modified PRD-3 while working on PRD-2
      git reset --hard HEAD~1  # ← Rollback this iteration
      return 1
    fi
  fi
}

# ✅ Pass Layer 3 → Iteration marked complete
# Continue to next iteration...

# Step 3: Build completes
trap "clear_active_prd" EXIT  # ← Layer 2 cleanup
# .ralph/.active-prd removed
```

### Defense in Depth Benefits

| Scenario | Layer 2 | Layer 3 | Layer 4 | Result |
|----------|---------|---------|---------|---------|
| **Concurrent different PRDs** | ✅ Blocks | N/A | ✅ Allow | Build prevented (sequential mode) |
| **Concurrent same PRD** | N/A | N/A | ✅ Blocks | Duplicate build prevented |
| **Cross-PRD file change** | N/A | ✅ Rollback | N/A | Iteration failed |
| **Same PRD, valid changes** | ✅ Allow | ✅ Pass | ✅ Allow | Iteration succeeds |
| **Sequential disabled** | ⏭ Skip | ✅ Still validates | ✅ Still locks | Contamination caught |

**Key insight:** Even if one layer is disabled, others still provide protection.

## Debugging

### Layer 2 Issues

```bash
# Check marker state
cat .ralph/.active-prd

# Diagnose problems
# See: tests/DEBUG-active-prd-marker.md

# Common fix: Remove stale marker
rm -f .ralph/.active-prd
```

### Layer 3 Issues

```bash
# Check validation config
grep RALPH_VALIDATE_SCOPE .agents/ralph/config.sh

# Check active PRD
echo $ACTIVE_PRD_NUMBER

# See: tests/DEBUG-scope-validation.md
```

### Layer 4 Issues

```bash
# Check lock files
ls -la .ralph/locks/

# Check if lock is stale
cat .ralph/locks/PRD-1.lock  # Get PID
kill -0 <PID>  # Returns 0 if running, 1 if stale

# Common fix: Remove stale lock
rm -f .ralph/locks/PRD-1.lock
```

### Combined Issues

**Symptom:** Contamination still occurs despite sequential mode

**Diagnosis:**
```bash
# 1. Check Layer 2 (marker)
cat .ralph/.active-prd
echo $RALPH_SEQUENTIAL_MODE

# 2. Check Layer 3 (validation)
echo $RALPH_VALIDATE_SCOPE
echo $ACTIVE_PRD_NUMBER

# 3. Check Layer 4 (locks)
ls -la .ralph/locks/
cat .ralph/locks/PRD-*.lock

# 4. Run health checks
npm run test:marker
npm run test:scope
npm run test:lock
```

**Common causes:**
- Sequential mode disabled (`RALPH_SEQUENTIAL_MODE=false`)
- Validation disabled (`RALPH_VALIDATE_SCOPE=false`)
- Stale marker file (`.ralph/.active-prd` from crashed build)
- Stale lock files (`.ralph/locks/*.lock` from crashed builds)
- Missing `ACTIVE_PRD_NUMBER` environment variable

## Configuration

### Enable full protection

```bash
# .agents/ralph/config.sh

# Layer 1: Enable policies
export RALPH_SEQUENTIAL_MODE=true
export RALPH_VALIDATE_SCOPE=true

# Layer 4: Locks enabled by default (no config needed)
```

### Disable for parallel mode

```bash
# For worktree-based parallel execution
export RALPH_SEQUENTIAL_MODE=false
export RALPH_VALIDATE_SCOPE=false

# Layers 2 & 3 skip checks
# Layer 4 (locks) still prevents same PRD from running twice
```

### Hybrid mode

```bash
# Enable validation but allow parallel (not recommended)
export RALPH_SEQUENTIAL_MODE=false
export RALPH_VALIDATE_SCOPE=true

# Result:
# - Multiple PRDs can build (Layer 2 disabled)
# - But cross-PRD changes still caught (Layer 3 active)
```

## Architecture

### Test Structure

```
tests/
├── test-active-prd-marker.mjs      # Layer 2 tests (18)
├── test-scope-validation.mjs       # Layer 3 tests (10)
├── test-lock-mechanism.mjs         # Layer 4 tests (15)
├── README-active-prd-marker.md     # Layer 2 docs
├── README-scope-validation.md      # Layer 3 docs
├── DEBUG-active-prd-marker.md      # Layer 2 troubleshooting
├── DEBUG-scope-validation.md       # Layer 3 troubleshooting
└── README-contamination-prevention.md  # This file
```

### Test Methodology

All three test suites use the same approach:

1. **Isolated environment:** Each test creates temp directory
2. **Real functions:** Extracts actual code from stream.sh/loop.sh
3. **End-to-end:** Simulates real build scenarios
4. **Automatic cleanup:** Removes temp directories on completion

**Benefits:**
- Tests real implementation (not mocks)
- Catches regressions immediately
- Validates actual file operations
- Safe (isolated from real .ralph directory)

## Performance

### Test Execution Speed

| Test Suite | Tests | Avg Time | Operations |
|------------|-------|----------|------------|
| Layer 2 | 18 tests | ~2s | File ops, function calls |
| Layer 3 | 10 tests | ~3s | Git repos, commits, rollbacks |
| Layer 4 | 15 tests | ~2s | Lock files, PID checks, background processes |
| **Total** | **43 tests** | **~7s** | **Full coverage** |

**Why fast?**
- Minimal git operations
- Temp directories (in-memory on macOS)
- Parallel test execution possible
- No network calls
- Real background processes (not mocks)

### Runtime Overhead (in production)

| Layer | Per Build | Per Iteration | Impact |
|-------|-----------|---------------|--------|
| Layer 2 | ~5ms | 0ms | Negligible |
| Layer 3 | 0ms | ~50ms | Minimal |
| Layer 4 | ~5ms | ~2ms | Negligible |
| **Total** | **~10ms** | **~52ms** | **< 0.1% overhead** |

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Contamination Prevention

on: [push, pull_request]

jobs:
  test-layers:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm install
      - name: Test Layer 2 (Active PRD Marker)
        run: npm run test:marker
      - name: Test Layer 3 (Scope Validation)
        run: npm run test:scope
      - name: Test Layer 4 (Lock Mechanism)
        run: npm run test:lock
```

### Pre-commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit

# Run contamination prevention tests before commit
npm run test:marker && npm run test:scope && npm run test:lock

if [[ $? -ne 0 ]]; then
  echo "❌ Contamination prevention tests failed"
  echo "   Fix tests before committing"
  exit 1
fi
```

## Contributing

### Adding New Tests

1. **Choose appropriate test file:**
   - Layer 2 tests → `test-active-prd-marker.mjs`
   - Layer 3 tests → `test-scope-validation.mjs`
   - Layer 4 tests → `test-lock-mechanism.mjs`

2. **Follow existing patterns:**
   ```javascript
   testYourScenario() {
     this.test('Test description', () => {
       // Setup
       this.setupTestRepo();

       // Action
       const result = this.runSomething();

       // Assert
       assert.strictEqual(result, expected);
     });
   }
   ```

3. **Add to runAll():**
   ```javascript
   async runAll() {
     // ... existing tests
     this.testYourScenario();
   }
   ```

4. **Update documentation:**
   - Add test to README-*.md
   - Add troubleshooting to DEBUG-*.md if needed

### Test Quality Guidelines

- ✅ **Isolated:** Each test cleans up after itself
- ✅ **Fast:** No unnecessary delays or sleeps
- ✅ **Deterministic:** Same input = same output
- ✅ **Clear errors:** Assertions explain what failed
- ✅ **Documented:** Test name explains what it verifies

## Related Documentation

- **Layer 2:** [README-active-prd-marker.md](./README-active-prd-marker.md)
- **Layer 3:** [README-scope-validation.md](./README-scope-validation.md)
- **Main docs:** [CLAUDE.md](../CLAUDE.md#stream-commands-parallel-execution)
- **Implementation:** [stream.sh](../.agents/ralph/stream.sh) and [loop.sh](../.agents/ralph/loop.sh)

## See Also

- [TESTING.md](../TESTING.md) - General testing guide
- [.agents/ralph/config.sh](../.agents/ralph/config.sh) - Configuration
- [GitHub Issues](https://github.com/AskTinNguyen/ralph-cli/issues) - Report bugs
