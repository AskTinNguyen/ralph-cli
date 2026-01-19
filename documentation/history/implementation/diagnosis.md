# Failure Pattern Diagnosis

> Analysis of all runs

Generated: 2026-01-14T14:59:29.554Z

---

## Summary

- **Total Errors:** 75
- **Unique Patterns:** 13
- **Affected Runs:** 13

### Error Type Breakdown

- **uncommitted_changes:** 65 errors in 9 patterns
- **shell_error:** 6 errors in 3 patterns
- **loop_error:** 4 errors in 1 patterns

---

## Top Failure Patterns

### Git Error [MEDIUM]

**Occurrences:** 30
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
Uncommitted Changes
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Git Error [MEDIUM]

**Occurrences:** 13
**Affected Runs:** 12
**Type:** uncommitted_changes

**Representative Error:**
```
ITERATION 1 left uncommitted changes; review run summary at /Users/tinnguyen/ralph/.ralph/runs/run-20260113-173513-30110-iter-1.md
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Git Error [MEDIUM]

**Occurrences:** 6
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
1 uncommitted changes: ui/public/streams.html
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Git Error [MEDIUM]

**Occurrences:** 5
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
18 uncommitted changes: .agents/ralph/loop.sh, bin/ralph, lib/estimate/schema.js...
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Git Error [MEDIUM]

**Occurrences:** 4
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
2 uncommitted changes: .ralph/activity.log, proposals/
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Shell/Command Error [MEDIUM]

**Occurrences:** 4
**Affected Runs:** 0
**Type:** shell_error

**Representative Error:**
```
ITERATION 1 command failed (status=1)
```

**Remediation:**
- Verify command exists in PATH
- Check command arguments and flags
- Handle non-zero exit codes appropriately

### Shell/Command Error [MEDIUM]

**Occurrences:** 4
**Affected Runs:** 0
**Type:** loop_error

**Representative Error:**
```
Run ended with error status
```

**Remediation:**
- Verify command exists in PATH
- Check command arguments and flags
- Handle non-zero exit codes appropriately

### Git Error [MEDIUM]

**Occurrences:** 3
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
4 uncommitted changes: ui/public/css/styles.css, ui/public/logs.html, ui/src/routes/api.ts...
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Git Error [MEDIUM]

**Occurrences:** 2
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
3 uncommitted changes: .agents/ralph/agents.sh, .agents/ralph/stream.sh, .agents/tasks/prd.md
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

### Git Error [MEDIUM]

**Occurrences:** 1
**Affected Runs:** 0
**Type:** uncommitted_changes

**Representative Error:**
```
6 uncommitted changes: lib/parallel/analyzer.js, lib/parallel/executor.js, tests/test-analyzer.js...
```

**Remediation:**
- Pull latest changes before starting work
- Resolve merge conflicts manually
- Commit changes before switching branches

---

## Recommended Actions

### Git Error

- Occurrences: 65
- Severity: medium

**Steps:**
1. Pull latest changes before starting work
1. Resolve merge conflicts manually
1. Commit changes before switching branches
1. Check git status before committing

### Shell/Command Error

- Occurrences: 10
- Severity: medium

**Steps:**
1. Verify command exists in PATH
1. Check command arguments and flags
1. Handle non-zero exit codes appropriately
1. Use absolute paths when possible

---

## Agent Recommendations

**Best Agent:** claude (Score: 100/100)
**Reasoning:** claude has no recorded failures

**Agent Rankings:**
- claude: 100/100 (0 failures)
- codex: 100/100 (0 failures)
- droid: 100/100 (0 failures)

---

## Agent Weakness Analysis

### unknown
- Total Failures: 75
- Primary Weakness: uncommitted_changes (65 occurrences)
- Primary Root Cause: git_error
