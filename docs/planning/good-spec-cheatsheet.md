# How to Write a Good Spec for AI Agents

*Cheatsheet from [addyosmani.com/blog/good-spec](https://addyosmani.com/blog/good-spec/)*

---

## 5 Core Principles

### 1. Start High-Level, Let AI Expand

- Begin with concise product brief, not over-engineered specs
- Use **Plan Mode** (read-only) to enforce planning before coding
- Create persistent reference document for project duration

### 2. Structure Like a PRD

**6 Essential Sections:**

| Section | What to Include |
|---------|-----------------|
| Commands | Full executable commands with flags |
| Testing | Framework, file locations, coverage expectations |
| Project Structure | Explicit directory organization |
| Code Style | Real code examples of your conventions |
| Git Workflow | Branch naming, commit formats, PR requirements |
| Boundaries | Always do / Ask first / Never touch |

### 3. Break Into Modular Prompts

- Avoid monolithic prompts (causes performance drops)
- Divide specs by domain (backend/frontend)
- Feed only relevant sections per task
- Refresh context between major features
- Use subagents for specialized domains

### 4. Build in Self-Checks & Constraints

**Three-tier boundary system:**

- ✅ **Always** - Actions requiring no approval
- ⚠️ **Ask first** - High-impact decisions needing review
- 🚫 **Never** - Hard stops (e.g., never commit secrets)

Include: library pitfalls, edge cases, domain preferences

### 5. Test, Iterate & Evolve

- Treat specs as living documents
- Version control your specs
- Update when discovering gaps
- Log agent reasoning for debugging

---

## Template

```markdown
# Project Spec: [Name]

## Objective
[Clear goal statement]

## Tech Stack
[Specific versions and dependencies]

## Commands
- Build: `[command]`
- Test: `[command]`
- Lint: `[command]`

## Project Structure
- src/ – Application code
- tests/ – Test files
- docs/ – Documentation

## Boundaries
- ✅ Always: [specific practices]
- ⚠️ Ask first: [high-impact changes]
- 🚫 Never: [prohibited actions]
```

---

## Anti-Patterns to Avoid

| Don't | Do Instead |
|-------|------------|
| Vague prompts ("Build something cool") | Clear goal statements |
| Overlong contexts | Hierarchical summaries |
| Skip human review | Review critical code paths |
| Confuse prototyping with production | Separate concerns explicitly |
| Missing core spec sections | Include all 6 sections |

---

## Key Insight

> Specs are **executable artifacts** that drive implementation, testing, and task breakdowns—not afterthoughts. Balance thoroughness with focus.
