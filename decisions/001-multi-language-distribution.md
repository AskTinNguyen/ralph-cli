# ADR-001: Multi-Language Distribution Strategy

**Status:** Accepted
**Date:** 2025-01-13
**Decision:** Add Bash implementation alongside TypeScript for universal Unix compatibility

---

## Context

Ralph CLI is currently implemented in TypeScript and requires Bun runtime. This creates friction for developers working in non-JavaScript ecosystems (C++, Rust, Go, Python) who must install a foreign runtime just to use Ralph.

The core functionality of Ralph is remarkably simple:
1. File I/O (read/write markdown)
2. Run a shell command in a loop
3. Check output for patterns

This simplicity means the tool can be implemented in virtually any language with minimal code.

## Decision Drivers

- **Universality**: Ralph should work in any codebase without ecosystem-specific dependencies
- **Philosophy alignment**: Ralph's core is `while :; do cat prompt.md | agent ; done` - bash embodies this
- **Minimal friction**: Zero-dependency installation for Unix users
- **Maintainability**: Keep TypeScript as primary development version

## Considered Options

### Option 1: Stay with Bun/TypeScript Only
- **Pros**: Already written, fast iteration, native for JS/TS
- **Cons**: Requires ~100MB runtime, foreign to non-JS developers
- **Verdict**: Keep for development, but not sufficient alone

### Option 2: Pure Bash Implementation
- **Pros**: Zero dependencies, ~50 lines, runs everywhere Unix, transparent
- **Cons**: Windows needs WSL, clunky error handling
- **Verdict**: ✅ Add as universal Unix option

### Option 3: Go Rewrite
- **Pros**: Single static binary, cross-platform, industry standard for CLIs
- **Cons**: Requires full rewrite, more verbose
- **Verdict**: Future consideration if Windows/enterprise needs arise

### Option 4: Rust Rewrite
- **Pros**: Single binary, extremely fast, memory safe
- **Cons**: Steep learning curve, overkill for this simplicity
- **Verdict**: Skip - unnecessary complexity

### Option 5: Compile TypeScript to Binary
- **Pros**: No code rewrite, single file distribution
- **Cons**: Large binary (~80MB), embeds entire runtime
- **Verdict**: Add as distribution option alongside bash

## Decision

Implement a **hybrid distribution strategy**:

1. **`ralph.sh`** - Pure Bash (~50 lines)
   - Zero dependencies
   - Universal Unix compatibility
   - Embodies the core philosophy
   - Primary recommendation for non-JS ecosystems

2. **`ralph.ts`** - TypeScript (existing)
   - Full-featured development version
   - Native experience for JS/TS developers
   - Source of truth for features

3. **Compiled binaries** (future)
   - `bun build --compile` for standalone distribution
   - macOS (arm64, x64), Linux (x64)
   - For users who want single-file install

## Comparison Matrix

```
                    │ Bun/TS │ Bash  │  Go   │ Compiled
────────────────────┼────────┼───────┼───────┼──────────
Zero dependencies   │   ✗    │  ✓✓   │  ✓✓   │    ✓
Cross-platform      │   ✓    │  ~    │  ✓✓   │    ✓
Binary size         │  N/A   │  0KB  │ ~5MB  │  ~80MB
Lines of code       │  370   │  ~50  │ ~200  │   370
Windows native      │   ✓    │  ✗    │  ✓✓   │    ✓
```

## File Structure

```
ralph-cli/
├── src/
│   └── ralph.ts          # Full TypeScript (development)
├── bin/
│   └── ralph.sh          # Pure Bash (universal Unix)
├── dist/                  # Compiled binaries (future)
└── decisions/
    └── 001-multi-language-distribution.md
```

## Consequences

### Positive
- C++/Rust/Go developers can use Ralph with zero extra dependencies
- Bash version is auditable and transparent
- Maintains TypeScript for rapid feature development
- Aligns with Unix philosophy

### Negative
- Two implementations to maintain (mitigated: bash is ~50 lines)
- Bash version may lag behind TypeScript features
- Windows users still need WSL for bash version

### Neutral
- Go rewrite remains an option if enterprise needs arise
- Compiled binaries can be added later without architectural changes

## Implementation Notes

The Bash implementation should:
- Support all core commands: `install`, `new`, `list`, `go`
- Use the same file structure (`.ralph/`, `.claude/skills/`)
- Produce identical output signals (`<promise>COMPLETE`, `NEEDS_HUMAN`)
- Be portable across bash 3.2+ (macOS default) and bash 4+

---

## References

- [ARCHITECTURE.md](../ARCHITECTURE.md) - Pure loop vs context-based design
- [CLAUDE.md](../CLAUDE.md) - Core philosophy and file structure
