# Scope Validation Tests (Layer 3)

Tests for the scope validation layer that prevents PRD contamination in sequential mode.

## What is Tested

The `validate_prd_scope()` function in `.agents/ralph/loop.sh` (lines 1826-1884) is responsible for:

1. **Detecting cross-PRD contamination** - Identifies when an agent modifies files in other PRD directories
2. **Automatic rollback** - Reverts commits that violate scope boundaries
3. **Configuration respect** - Honors `RALPH_VALIDATE_SCOPE` flag

## Test Coverage

### ✅ Configuration Tests
- **Validation disabled** - Skips checks when `RALPH_VALIDATE_SCOPE=false`
- **No active PRD** - Skips validation when `ACTIVE_PRD_NUMBER` is unset

### ✅ Valid Scenarios (Should Pass)
- **No files changed** - Empty commits pass validation
- **Current PRD files only** - Changes to active PRD directory allowed
- **Shared .ralph files** - Changes to `guardrails.md` and other shared files allowed
- **PRD pattern in source code** - `src/PRD-helpers/` doesn't trigger false positive

### ✅ Invalid Scenarios (Should Fail & Rollback)
- **Other PRD files changed** - Detects modifications to different PRD directories
- **Multiple violations** - Detects and reports all cross-PRD changes in one commit

### ✅ Edge Cases
- **PRD number extraction** - Handles both `PRD-2` and `2` formats
- **Lowercase PRD directories** - Documents current behavior (uppercase only)

## How It Works

Each test:

1. **Sets up a test repository** with:
   - Git repo with initial commit
   - Multiple PRD directories (PRD-1, PRD-2, PRD-3)
   - Shared files (guardrails.md)
   - Source code files

2. **Creates test commits** with specific file changes

3. **Runs validation** with controlled environment variables:
   - `RALPH_VALIDATE_SCOPE` - Enable/disable validation
   - `ACTIVE_PRD_NUMBER` - Current working PRD

4. **Verifies behavior**:
   - Exit code (0 = pass, 1 = fail)
   - Git commit history (rollback detection)
   - Error message content

## Running Tests

```bash
# Run scope validation tests only
npm run test:scope

# Run all integration tests (includes scope tests)
npm run test:integration

# Run tests directly
node tests/test-scope-validation.mjs
./tests/test-scope-validation.mjs
```

## Test Output

```
🧪 Scope Validation Layer Tests (Layer 3)

═══════════════════════════════════════════════════════

📁 Test directory: /tmp/ralph-scope-test-xyz123
✅ Validation disabled (RALPH_VALIDATE_SCOPE=false)
✅ No active PRD set - should skip validation
✅ No files changed - should pass
✅ Only current PRD files changed - should pass
✅ Other PRD files changed - should detect and rollback
✅ Shared .ralph files (guardrails.md) - should pass
✅ Multiple PRD violations - should detect all
✅ PRD number extraction - various formats
✅ PRD pattern in source code - should not false positive
✅ Lowercase prd directories - should detect violations

═══════════════════════════════════════════════════════

✅ Passed: 10
❌ Failed: 0
📊 Total:  10
```

## Implementation Details

### Test Repository Structure

```
/tmp/ralph-scope-test-xyz/
├── .git/                    # Git repository
├── .ralph/
│   ├── PRD-1/
│   │   ├── prd.md
│   │   ├── plan.md
│   │   └── progress.md
│   ├── PRD-2/
│   │   ├── prd.md
│   │   ├── plan.md
│   │   └── progress.md
│   ├── PRD-3/
│   │   ├── prd.md
│   │   ├── plan.md
│   │   └── progress.md
│   └── guardrails.md        # Shared file
├── src/
│   ├── app.ts
│   └── feature.ts
└── validate_scope.sh        # Extracted validation function
```

### Validation Logic

```bash
validate_prd_scope() {
  # 1. Check if enabled
  if [[ "${RALPH_VALIDATE_SCOPE:-false}" != "true" ]]; then
    return 0
  fi

  # 2. Check active PRD
  if [[ -z "${ACTIVE_PRD_NUMBER:-}" ]]; then
    return 0
  fi

  # 3. Get changed files
  changed_files=$(git diff --name-only HEAD~1)

  # 4. Detect violations
  while IFS= read -r file; do
    # Skip current PRD files
    if [[ "$file" == ".ralph/PRD-${prd_num}/"* ]]; then
      continue
    fi

    # Check for other PRD directories
    if [[ "$file" =~ \.ralph/PRD-([0-9]+)/ ]]; then
      violations="${violations}  - $file (PRD-$other_prd)"
    fi
  done <<< "$changed_files"

  # 5. Rollback on violation
  if [[ -n "$violations" ]]; then
    echo "SCOPE VIOLATION DETECTED"
    git reset --hard HEAD~1
    return 1
  fi

  return 0
}
```

## Test Scenarios

### Scenario 1: Valid - Current PRD Only
```bash
# Working on PRD-2
ACTIVE_PRD_NUMBER="PRD-2"
RALPH_VALIDATE_SCOPE="true"

# Changes:
- src/feature.ts           ✅ OK (source code)
- .ralph/PRD-2/progress.md ✅ OK (current PRD)

# Result: PASS (no violations)
```

### Scenario 2: Invalid - Cross-PRD Contamination
```bash
# Working on PRD-2
ACTIVE_PRD_NUMBER="PRD-2"
RALPH_VALIDATE_SCOPE="true"

# Changes:
- src/feature.ts           ✅ OK
- .ralph/PRD-2/progress.md ✅ OK
- .ralph/PRD-3/plan.md     ❌ VIOLATION!

# Result: FAIL + ROLLBACK
# Output:
SCOPE VIOLATION DETECTED
Agent modified files outside PRD-2 scope:
  - .ralph/PRD-3/plan.md (PRD-3)
Rolling back this iteration...
```

### Scenario 3: Valid - Shared Files
```bash
# Working on PRD-2
ACTIVE_PRD_NUMBER="PRD-2"
RALPH_VALIDATE_SCOPE="true"

# Changes:
- .ralph/PRD-2/progress.md ✅ OK (current PRD)
- .ralph/guardrails.md     ✅ OK (shared file, not PRD-specific)

# Result: PASS (guardrails.md is not a PRD directory)
```

## Why This Matters

In sequential mode (large repos without worktrees), Ralph builds one PRD at a time. Without scope validation:

❌ **Problem:**
- Agent working on PRD-2 might discover `.ralph/PRD-3/plan.md`
- Agent decides to "helpfully" update PRD-3's plan
- PRD-3 now has unexpected changes
- Context contamination spreads across PRDs

✅ **Solution (Scope Validation):**
- Detects cross-PRD changes immediately after iteration
- Rolls back contaminating commit automatically
- Ensures each PRD remains isolated
- Maintains clean separation of concerns

## Related Documentation

- [CLAUDE.md](../CLAUDE.md#status-validation--troubleshooting) - Main Ralph CLI documentation
- [4-Layer Protection System](../CLAUDE.md#merge-safety) - Overview of all contamination prevention layers
- [Sequential Mode](../CLAUDE.md#stream-commands-parallel-execution) - When scope validation is critical

## Future Enhancements

Potential improvements to scope validation:

1. **Lowercase PRD support** - Validate legacy `prd-N` directories
2. **Configurable allowed paths** - Whitelist certain cross-PRD paths
3. **Warning mode** - Log violations without rollback
4. **Violation history** - Track repeated violations for debugging
5. **Auto-fix mode** - Attempt to split commits by PRD scope
