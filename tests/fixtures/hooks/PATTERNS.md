# Test Framework Failure Detection Patterns

This document describes the regex patterns used by the PostToolUse hook to detect test failures across various frameworks.

## Current Hook Patterns (post-tool.sh)

### Jest
**Pattern:** `Tests:.*[0-9]+.*failed` or `Test Suites:.*[0-9]+.*failed`

**Example output triggering detection:**
```
Test Suites: 1 failed, 1 passed, 2 total
Tests:       1 failed, 5 passed, 6 total
```

### Vitest
**Pattern:** `Test Files.*[0-9]+ failed` or `Tests.*[0-9]+ failed \|`

**Example output triggering detection:**
```
 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

Note: Vitest uses double spaces before the numbers, distinguishing it from Jest format.

### pytest
**Pattern:** `=.*FAILURES.*=` or `[0-9]+ failed,`

**Example output triggering detection:**
```
=================================== FAILURES ===================================
...
========================= 1 failed, 4 passed in 0.32s =========================
```

### Go test
**Pattern:** `--- FAIL:` or `FAIL\t` (FAIL followed by tab)

**Example output triggering detection:**
```
--- FAIL: TestUserDelete (0.01s)
FAIL	github.com/example/project/pkg/user	0.123s
```

### Mocha
**Pattern:** `[0-9]+ failing`

**Example output triggering detection:**
```
  4 passing (234ms)
  2 failing
```

### RSpec
**Pattern:** `[0-9]+ examples,.*[0-9]+ failure`

**Example output triggering detection:**
```
10 examples, 2 failures
```

### Bats (TAP format)
**Pattern:** `\nnot ok` or `^not ok` (line starting with "not ok")

**Example output triggering detection:**
```
not ok 3 install script completes without error
```

### npm / yarn test failure
**Pattern:** `npm ERR! Test failed` or `error Command failed`

**Example output triggering detection:**
```
npm ERR! code ELIFECYCLE
npm ERR! errno 1
npm ERR! my-project@1.0.0 test: `jest --coverage`
npm ERR! Exit status 1

# or for yarn:
error Command failed with exit code 1.
```

## Test Fixtures

| Framework | Failure Fixture | Pass Fixture |
|-----------|-----------------|--------------|
| Jest | test-output-jest.txt | test-output-jest-pass.txt |
| Vitest | test-output-vitest.txt | - |
| pytest | test-output-pytest.txt | test-output-pytest-pass.txt |
| Go test | test-output-go.txt | test-output-go-pass.txt |
| Mocha | test-output-mocha.txt | test-output-mocha-pass.txt |
| RSpec | test-output-rspec.txt | test-output-rspec-pass.txt |
| Bats | test-output-bats.txt | test-output-bats-pass.txt |
| npm failure | test-output-npm-failure.txt | - |
| yarn failure | test-output-yarn-failure.txt | - |

## Pattern Verification

To verify patterns work correctly, run:
```bash
./tests/simplified-loop.test.sh
```

## Adding New Framework Support

1. Create fixture files in `tests/fixtures/hooks/`:
   - `test-output-<framework>.txt` (failure output)
   - `test-output-<framework>-pass.txt` (passing output)

2. Add detection pattern to `.agents/ralph/hooks/post-tool.sh`

3. Add test cases to `tests/simplified-loop.test.sh`

## Key Indicators by Framework

| Framework | Failure Indicator | Summary Line Format |
|-----------|------------------|---------------------|
| Jest | `FAIL src/...` | `Tests: N failed, M passed, T total` |
| Vitest | `FAIL src/...` | `Tests  N failed \| M passed (T)` |
| pytest | `FAILED` | `N failed, M passed in Xs` |
| Go | `--- FAIL:` | `FAIL\tpackage/path\tXs` |
| Mocha | `N failing` | `N passing\nM failing` |
| RSpec | `F` dots, `FAILED - N` | `N examples, M failures` |
| Bats | `not ok N` | `N tests, M failures` |
