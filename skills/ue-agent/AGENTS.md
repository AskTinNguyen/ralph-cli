# ue-agent Skill - Agent Guide

**Quick Reference for Unreal Engine Multi-Agent Orchestration**

The ue-agent skill orchestrates 5 specialized agents to implement Unreal Engine features with full autonomy. This guide covers the orchestration flow, agent responsibilities, and critical rules.

---

## What is the ue-agent Skill?

Multi-agent orchestrator for Unreal Engine development that dispatches to specialists:

1. **Explorer** - Finds relevant code, docs, and patterns
2. **Architect** - Creates implementation plan
3. **Implementer** - Writes code changes (game repo only)
4. **Validator** - Runs build and tests
5. **UnitTest** - Generates tests and verifies pass/fail

**Purpose:** Full autonomous UE feature implementation with built-in retry logic and human checkpoints.

---

## Critical Rule: Engine Source is Read-Only

### 🚨 THE IRON LAW

```
ENGINE SOURCE IS READ-ONLY. NEVER MODIFY ENGINE FILES.
```

**No exceptions:**
- Not for "just a quick fix"
- Not for "the bug is clearly in engine"
- Not for "it's faster than a workaround"
- Not for "I'll submit a PR to Epic later"

### Game-Side Solutions

| Temptation | Game-Side Solution |
|------------|-------------------|
| "Fix crash in engine class" | Override method, add null check before `Super::` |
| "Add feature to engine subsystem" | Create game subsystem that composes engine one |
| "Change engine behavior" | Use config, delegates, or game-level intercept |
| "Patch deprecated API" | Wrap in game utility, migrate callers |

**Game-side approaches:**
- Override virtual functions in game classes
- Intercept with delegates/events
- Validate inputs before calling engine APIs
- Wrap engine functionality in game utilities

---

## Agent Orchestration Flow

```
[1] EXPLORER ──────▶ Context artifacts
        ▼
[2] ARCHITECT ─────▶ Implementation plan
        ▼
[3] IMPLEMENTER ───▶ Code changes (game repo only)
        ▼
[4] VALIDATOR ─────▶ Build + test results
        ▼
[5] UNITTEST ──────▶ Generated tests + results
```

**Retry logic:** Each agent gets max 3 attempts. On failure, orchestrator retries with accumulated context.

**Human checkpoint:** After 3 failed attempts, human intervention required.

---

## Specialist Responsibilities

### 1. Explorer Agent

**Input:** Task description

**Output:** Relevant code, docs, engine patterns

**Max Attempts:** 3

**Responsibilities:**
- Find relevant game code
- Reference engine source (read-only)
- Identify existing patterns
- Collect API documentation

### 2. Architect Agent

**Input:** Explorer artifacts

**Output:** Implementation plan

**Max Attempts:** 3

**Responsibilities:**
- Design game-side solution
- Specify files to modify
- Identify engine APIs to use
- Plan testing strategy

### 3. Implementer Agent

**Input:** Architect plan

**Output:** Code changes (game repo only)

**Max Attempts:** 3

**Responsibilities:**
- Modify game code only
- Follow UE coding standards
- Use engine APIs correctly
- Respect read-only constraint

### 4. Validator Agent

**Input:** Changed files

**Output:** Build result, test results

**Max Attempts:** 3

**Responsibilities:**
- Run UBT (Unreal Build Tool)
- Execute tests
- Report compilation errors
- Validate runtime behavior

### 5. UnitTest Agent

**Input:** Implementation

**Output:** Generated tests + pass/fail

**Max Attempts:** 3

**Responsibilities:**
- Generate unit tests
- Run generated tests
- Verify coverage
- Report failures

---

## Error Handling per Agent Type

### Explorer Failures

**Common issues:**
- Irrelevant code found
- Missing engine documentation
- Wrong engine version referenced

**Retry strategy:** Broaden search, check different patterns

### Architect Failures

**Common issues:**
- Plan modifies engine source
- Incomplete file list
- Missing dependencies

**Retry strategy:** Add game-side constraint, re-plan

### Implementer Failures

**Common issues:**
- Syntax errors
- Type mismatches
- Missing includes

**Retry strategy:** Fix errors, consult engine docs

### Validator Failures

**Common issues:**
- Compilation errors
- Linker errors
- Test failures

**Retry strategy:** Pass errors to Implementer for fixes

### UnitTest Failures

**Common issues:**
- Tests don't compile
- Tests fail
- Insufficient coverage

**Retry strategy:** Regenerate tests, fix implementation

---

## Integration Patterns

### When Task Requires UE Context

```bash
# Task involves UE code
ue-agent "Implement damage system with blueprint exposure"

# Orchestrator dispatches Explorer → Architect → Implementer → Validator → UnitTest
# Each specialist runs autonomously with retry logic
# Final result: Implemented feature with passing tests
```

### When Task is Simple

```bash
# Simple UE task (no orchestration needed)
# Use standard Ralph workflow instead
ralph prd "Add health variable to Character"
ralph plan
ralph build 1
```

---

## Related Documentation

- **Root Guide:** [/AGENTS.md](/AGENTS.md) - Core Ralph agent rules
- **Full Skill Reference:** [SKILL.md](SKILL.md) - Complete ue-agent documentation
- **Integration Guide:** [INTEGRATION.md](INTEGRATION.md) - Detailed orchestration patterns

---

## Summary

**Key Takeaways:**

1. **Engine source is READ-ONLY** - Never modify engine files
2. **5-agent orchestration** - Explorer → Architect → Implementer → Validator → UnitTest
3. **Max 3 attempts per agent** - Built-in retry logic
4. **Human checkpoint after 3 failures** - Manual intervention required
5. **Game-side solutions only** - Override, intercept, validate, wrap
6. **Use for complex UE tasks** - Simple tasks use standard Ralph workflow
