# Commit Skill - Agent Guide

**Quick Reference for AI Agents**

The commit skill creates git commits following Conventional Commits format. This guide covers critical rules, format standards, and workflow patterns.

---

## What is the Commit Skill?

Creates git commits with:
- **Type:** What kind of change (feat, fix, refactor, test, etc.)
- **Scope:** What area changed (validation, auth, api, etc.)
- **Subject:** What was done (present tense, imperative)
- **Body:** Why and how (optional for complex changes)

**Purpose:** Maintain consistent commit history for automated changelog generation and semantic versioning.

---

## Critical Rules

### ❌ NEVER Commit:

- `.env`, `credentials.json`, secrets, API keys
- `node_modules/`, `__pycache__/`, `.venv/`, build artifacts
- Large binary files without explicit approval
- Unrelated changes in the same commit

### ❌ NEVER Use `--amend`:

Unless explicitly requested by user. Amending commits can cause confusion in collaborative workflows.

### ✅ ALWAYS Include:

- **Co-Authored-By trailer** when using Claude/AI assistance:
  ```
  Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
  ```
- **Scope in parentheses:** `feat(scope): subject`
- **Present tense imperative verb:** add, fix, implement, refactor

---

## Conventional Commit Format

**Basic format:**
```
type(scope): subject

Optional body explaining HOW and WHY.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Commit Types

| Type | Purpose |
|------|---------|
| `feat` | New feature or functionality |
| `fix` | Bug fix or issue resolution |
| `refactor` | Code refactoring without behavior change |
| `perf` | Performance improvements |
| `test` | Test additions or modifications |
| `docs` | Documentation updates |
| `chore` | Maintenance, dependencies, tooling |
| `style` | Code formatting, linting (non-functional) |
| `security` | Security vulnerability fixes or hardening |

### Scope (Required, kebab-case)

Examples: `validation`, `auth`, `cookie-service`, `template`, `config`, `tests`, `api`

### Subject Line Rules

- **Max 50 characters** after colon
- **Present tense imperative:** add, implement, fix, improve, enhance, refactor, remove, prevent
- **NO period at the end**
- **Specific and descriptive** - state WHAT, not WHY

---

## Workflow Pattern

### 1. Review Changes

```bash
git status
git diff --staged  # if already staged
git diff           # if not staged
```

### 2. Stage Files

```bash
git add <specific-files>  # preferred
# or
git add -A  # all changes
```

### 3. Create Commit

**Simple change:**
```bash
git commit -m "fix(auth): use hmac.compare_digest for secure comparison"
```

**Complex change (with body):**
```bash
git commit -m "$(cat <<'EOF'
feat(validation): add URLValidator with domain whitelist

Implement URLValidator class supporting:
- Domain whitelist enforcement (youtube.com, youtu.be)
- Dangerous scheme blocking (javascript, data, file)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

### 4. Verify Commit

```bash
git log -1 --format="%h %s"
git show --stat HEAD
```

---

## Common Examples

**Good:**
```
feat(validation): add URLValidator with domain whitelist
fix(auth): use hmac.compare_digest for secure key comparison
refactor(template): consolidate filename sanitization logic
test(security): add 102 path traversal prevention tests
```

**Bad:**
```
update validation code           # no type, no scope, vague
feat: add stuff                  # missing scope, too vague
fix(auth): fix bug               # circular, not specific
feat(security): improve things.  # has period, vague
```

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **Full Skill Reference:** [SKILL.md](SKILL.md) - Complete commit skill documentation
- **Commit Examples:** [references/commit_examples.md](references/commit_examples.md) - Extended examples

---

## Summary

**Key Takeaways:**

1. **Follow Conventional Commits format:** `type(scope): subject`
2. **Never commit secrets** - check .env, credentials, API keys
3. **Always use Co-Authored-By** when AI assists
4. **Present tense imperative verbs** - add, fix, implement
5. **Max 50 chars** for subject line, no period
6. **Specific subjects** - "add URLValidator" not "update code"
