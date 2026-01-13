# Product Requirements Document

## Overview

Refactor ralph-cli shell scripts to reduce code duplication, improve maintainability, and apply bash best practices. The current implementation has significant duplication between `loop.sh` (1212 lines) and `stream.sh` (709 lines), with embedded Python code, duplicated color handling, and shared utility functions that should be extracted.

**Problem**: The codebase suffers from:
- Duplicated color/output functions across loop.sh and stream.sh
- Duplicated PRD folder management utilities
- Embedded Python code making scripts hard to test and maintain
- Security concerns with `eval` usage
- Dead code and legacy variables
- Suboptimal bash patterns (seq instead of arithmetic, useless cat, etc.)

**Solution**: Extract shared functionality into reusable libraries, move embedded Python to separate files, remove dead code, replace unsafe patterns, and apply bash best practices throughout.

**Impact**:
- **34% reduction** in loop.sh (~1212 → ~800 lines)
- **29% reduction** in stream.sh (~709 → ~500 lines)
- Improved testability through modular Python scripts
- Better security with reduced eval usage
- Easier maintenance with DRY principles applied

## User Stories

### [x] US-001: Extract shared color and output utilities
**As a** ralph-cli maintainer
**I want** color and output functions extracted to a shared library
**So that** both loop.sh and stream.sh can reuse the same formatting code

#### Acceptance Criteria
- [x] Create `.agents/ralph/lib/output.sh` with TTY detection, color variables, and msg_* functions
- [x] Extract msg_success, msg_error, msg_warn, msg_info, msg_dim from loop.sh:227-245
- [x] Extract visual helpers from stream.sh:63-107 (SYM_*, section_header, bullet, numbered_step, path_display, next_steps_header)
- [x] Update both loop.sh and stream.sh to source the shared library
- [x] Remove duplicated code from both files (loop.sh:206-245, stream.sh:24-107)
- [x] Test colored output works in both TTY and non-TTY modes
- [x] Verify `ralph stream list`, `ralph stream status`, `ralph build 1 --prd=5` work correctly

### [ ] US-002: Extract shared PRD utilities
**As a** ralph-cli maintainer
**I want** PRD folder management functions centralized
**So that** I don't maintain duplicate logic for finding and validating PRD directories

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/prd-utils.sh` with shared RALPH_DIR variable
- [ ] Extract from loop.sh:21-68: `get_next_prd_number()`, `get_latest_prd_number()`, `get_prd_dir()`
- [ ] Extract from stream.sh:113-159: `normalize_stream_id()` → `normalize_prd_id()`, `stream_exists()` → `prd_exists()`
- [ ] Consolidate `get_stream_dir()` with `get_prd_dir()`
- [ ] Update both loop.sh and stream.sh to source the library
- [ ] Update function call sites to use new names
- [ ] Test PRD folder resolution works correctly

### [ ] US-003: Extract embedded Python to separate files
**As a** ralph-cli maintainer
**I want** embedded Python code moved to standalone files
**So that** Python logic is testable, maintainable, and reusable

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/render_prompt.py` extracting Python from loop.sh:547-601
- [ ] Refactor to accept JSON config instead of 20 positional arguments
- [ ] Create `.agents/ralph/lib/select_story.py` extracting Python from loop.sh:607-660
- [ ] Create `.agents/ralph/lib/story_utils.py` extracting remaining_stories() and story_field() logic
- [ ] Simplify loop.sh functions to call external Python scripts
- [ ] Test prompt rendering, story selection, and story utilities work correctly
- [ ] Verify Python modules can be imported and tested independently

### [ ] US-004: Extract git utilities to shared library
**As a** ralph-cli maintainer
**I want** git helper functions centralized
**So that** git operations are consistent and reusable across scripts

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/git-utils.sh`
- [ ] Extract from loop.sh:940-974: `git_head()`, `git_commit_list()`, `git_changed_files()`, `git_dirty_files()`
- [ ] Add ROOT_DIR parameter support for worktree contexts
- [ ] Update loop.sh to source the library and remove duplicated functions
- [ ] Update stream.sh to use shared git functions where applicable
- [ ] Test git operations work correctly in both main repo and worktrees

### [ ] US-005: Remove dead code and unused variables
**As a** ralph-cli maintainer
**I want** dead code and legacy variables removed
**So that** the codebase is cleaner and easier to understand

#### Acceptance Criteria
- [ ] Remove legacy path variables from loop.sh:86-88 (LEGACY_PRD_PATH, LEGACY_PLAN_PATH, LEGACY_PROGRESS_PATH)
- [ ] Remove empty default variables from loop.sh:91-93 (DEFAULT_PRD_PATH, DEFAULT_PLAN_PATH, DEFAULT_PROGRESS_PATH)
- [ ] Consolidate resolve_agent_cmd() by merging codex|"") and *) cases using fall-through
- [ ] Audit AGENTS_PATH usage and remove if not referenced in templates
- [ ] Resolve log-activity.sh redundancy (keep inline function, deprecate standalone script)
- [ ] Test all agent types still work after cleanup

### [ ] US-006: Replace eval usage with safer alternatives
**As a** ralph-cli maintainer
**I want** eval usage minimized or replaced with safer alternatives
**So that** command injection risks are reduced

#### Acceptance Criteria
- [ ] Refactor run_agent() in loop.sh:300-310 to avoid eval where possible
- [ ] Use bash parameter expansion for {prompt} substitution
- [ ] Use bash -c with proper quoting for complex commands
- [ ] Use read -ra for parsing commands into arrays
- [ ] Add security comments where eval is still necessary
- [ ] Test all agent types (claude, codex, droid) after changes
- [ ] Verify no command injection vulnerabilities introduced

### [ ] US-007: Apply bash best practices improvements
**As a** ralph-cli maintainer
**I want** bash anti-patterns replaced with best practices
**So that** scripts are more efficient and maintainable

#### Acceptance Criteria
- [ ] Replace `seq` with bash arithmetic: `for ((i = 1; i <= MAX_ITERATIONS; i++))`
- [ ] Remove useless cat: change `cat "$file" | cmd` to `cmd < "$file"`
- [ ] Use [[ ]] consistently instead of [ ] for conditionals
- [ ] Add configurable delays to config.sh: ITERATION_DELAY, PROGRESS_INTERVAL
- [ ] Update loop.sh to use delay variables with defaults
- [ ] Test iteration timing and progress updates work correctly

### [ ] US-008: Add status constants and configuration
**As a** ralph-cli maintainer
**I want** magic strings replaced with named constants
**So that** code is more maintainable and less error-prone

#### Acceptance Criteria
- [ ] Add status constants to lib/output.sh or new lib/constants.sh
- [ ] Define: STATUS_RUNNING, STATUS_COMPLETED, STATUS_READY, STATUS_NOT_FOUND, STATUS_NO_PRD, STATUS_NO_STORIES
- [ ] Update stream.sh to use constants instead of string literals
- [ ] Document new config options in config.sh with comments
- [ ] Test status checks work with constants

## Technical Constraints

- **Backward Compatibility**: All existing commands must continue working
- **Zero Breaking Changes**: External CLI interface remains unchanged
- **Incremental Approach**: Each story is independently committable and testable
- **Testing Required**: Full test suite must pass after each library extraction
- **Rollback Strategy**: Each commit can be reverted independently
- **Security**: Eval usage must not introduce command injection vulnerabilities

## Proposed Directory Structure

```
.agents/ralph/
├── lib/
│   ├── output.sh         # Color/message helpers (~80 lines) [DONE]
│   ├── prd-utils.sh      # PRD folder utilities (~60 lines)
│   ├── git-utils.sh      # Git helper functions (~40 lines)
│   ├── render_prompt.py  # Prompt template rendering (~50 lines)
│   ├── select_story.py   # Story selection logic (~60 lines)
│   └── story_utils.py    # Story parsing utilities (~30 lines)
├── loop.sh               # Main execution loop (simplified to ~800 lines)
├── stream.sh             # Stream management (simplified to ~500 lines)
├── config.sh             # Configuration
├── agents.sh             # Agent definitions
└── log-activity.sh       # Activity logging (may deprecate)
```

## Testing Checklist

After each story implementation, verify:
- `ralph build 1 --no-commit` works (dry run)
- `ralph plan` works
- `ralph prd "test"` works
- `ralph stream list` works
- `ralph stream status` works
- `ralph stream build 1 1` works (with existing PRD)
- Colors display correctly in terminal
- Output is clean when piped (no color codes)
- All agent types work (claude, codex, droid)

## Success Metrics

- **Code Reduction**: 34% reduction in loop.sh, 29% reduction in stream.sh
- **Line Count**: New shared libraries total ~250 lines, net reduction ~400 lines
- **Test Coverage**: All existing functionality continues working
- **Maintainability**: Duplicated code eliminated, Python modules testable
- **Security**: Eval usage minimized, no command injection vulnerabilities
- **Performance**: No degradation in execution speed

## Risk Mitigation

1. **Incremental Commits**: Each story is a separate commit with full testing
2. **Test Coverage**: Run full test suite after each library extraction
3. **Comment First**: For first iteration, comment rather than delete
4. **Independent Rollback**: Each commit can be reverted without affecting others
5. **Backup Strategy**: Git history provides full rollback capability

## Out of Scope

- Rewriting in a different language (staying with bash)
- Adding new CLI commands (this is pure refactoring)
- Changing external CLI interface or behavior
- Performance optimizations beyond best practices
- Adding new features (focus is maintainability)
