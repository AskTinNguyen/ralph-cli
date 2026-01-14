# Product Requirements Document: Refactor Shell Scripts

## Overview

Refactor ralph-cli shell scripts to reduce code duplication, improve maintainability, and apply bash best practices. Since this PRD was created, `loop.sh` has grown significantly due to new features (experiments, checkpoints, model routing, retry logic, metrics tracking).

**Current State** (Updated January 2025):
- `loop.sh`: **2073 lines** (was 1212 when PRD created)
- `stream.sh`: **801 lines** (was 709)
- Only US-001 completed (output.sh extraction)

**Problem**: The codebase suffers from:
- Embedded Python code (5 blocks, ~180 lines) making scripts hard to test
- New features added without modular extraction (checkpoints, routing, retry, metrics)
- Duplicated JSON parsing functions (`parse_routing_field` and `parse_token_field`)
- Duplicated PRD folder management utilities
- Security concerns with `eval` usage
- Suboptimal bash patterns (seq instead of arithmetic)

**Solution**: Extract shared functionality into reusable libraries, move embedded Python to separate files, consolidate duplicates, and apply bash best practices.

**Impact**:
- **46% reduction** in loop.sh (~2073 → ~1100 lines)
- **25% reduction** in stream.sh (~801 → ~600 lines)
- Improved testability through modular scripts
- Better security with reduced eval usage
- Lower token consumption per iteration (critical for agentic loop costs)

## User Stories

### [x] US-001: Extract shared color and output utilities
**As a** ralph-cli maintainer
**I want** color and output functions extracted to a shared library
**So that** both loop.sh and stream.sh can reuse the same formatting code

#### Acceptance Criteria
- [x] Create `.agents/ralph/lib/output.sh` with TTY detection, color variables, and msg_* functions
- [x] Extract msg_success, msg_error, msg_warn, msg_info, msg_dim
- [x] Extract visual helpers (SYM_*, section_header, bullet, numbered_step, path_display, next_steps_header)
- [x] Update both loop.sh and stream.sh to source the shared library
- [x] Test colored output works in both TTY and non-TTY modes

### [x] US-002: Extract shared PRD utilities
**As a** ralph-cli maintainer
**I want** PRD folder management functions centralized
**So that** I don't maintain duplicate logic for finding and validating PRD directories

#### Acceptance Criteria
- [x] Create `.agents/ralph/lib/prd-utils.sh` with shared RALPH_DIR variable
- [x] Extract from loop.sh:25-72: `get_next_prd_number()`, `get_latest_prd_number()`, `get_prd_dir()`
- [x] Extract from stream.sh: `normalize_stream_id()` → `normalize_prd_id()`, `stream_exists()` → `prd_exists()`
- [x] Consolidate `get_stream_dir()` with `get_prd_dir()`
- [x] Update both loop.sh and stream.sh to source the library
- [x] Test PRD folder resolution works correctly

### [x] US-003: Extract embedded Python to separate files
**As a** ralph-cli maintainer
**I want** embedded Python code moved to standalone files
**So that** Python logic is testable, maintainable, and reduces loop.sh token count

#### Acceptance Criteria
- [x] Create `.agents/ralph/lib/prd-parser.py` with all PRD parsing logic
- [x] Extract `render_prompt()` Python from loop.sh:733-788 (~55 lines)
- [x] Extract `select_story()` Python from loop.sh:793-847 (~55 lines)
- [x] Extract `remaining_stories()` Python from loop.sh:849-859 (~10 lines)
- [x] Extract `story_field()` Python from loop.sh:861-873 (~12 lines)
- [x] Extract `append_run_summary()` Python from loop.sh:1332-1360 (~28 lines)
- [x] Simplify loop.sh functions to single-line calls to external script
- [x] Test prompt rendering, story selection work correctly
- [x] Verify ~140 lines removed from loop.sh

### [x] US-004: Extract git utilities to shared library
**As a** ralph-cli maintainer
**I want** git helper functions centralized
**So that** git operations are consistent and reusable across scripts

#### Acceptance Criteria
- [x] Create `.agents/ralph/lib/git-utils.sh`
- [x] Extract from loop.sh:1517-1551: `git_head()`, `git_commit_list()`, `git_changed_files()`, `git_dirty_files()`
- [x] Add ROOT_DIR parameter support for worktree contexts
- [x] Update loop.sh and stream.sh to source the library
- [x] Test git operations work correctly in both main repo and worktrees

### [x] US-005: Remove dead code and consolidate duplicates
**As a** ralph-cli maintainer
**I want** dead code removed and duplicate functions consolidated
**So that** the codebase is cleaner and easier to understand

#### Acceptance Criteria
- [x] Consolidate `parse_routing_field()` (lines 1091-1102) and `parse_token_field()` (lines 1573-1584) into single `parse_json_field()`
- [x] Audit AGENTS_PATH usage and remove if not referenced in templates
- [x] Resolve log-activity.sh redundancy (keep inline function, deprecate standalone script)
- [x] Test all agent types still work after cleanup

### [x] US-006: Replace eval usage with safer alternatives
**As a** ralph-cli maintainer
**I want** eval usage minimized or replaced with safer alternatives
**So that** command injection risks are reduced

#### Acceptance Criteria
- [x] Refactor run_agent() in loop.sh:330-340 to avoid eval where possible
- [x] Use bash parameter expansion for {prompt} substitution
- [x] Add security comments where eval is still necessary
- [x] Test all agent types (claude, codex, droid) after changes

### [x] US-007: Apply bash best practices improvements
**As a** ralph-cli maintainer
**I want** bash anti-patterns replaced with best practices
**So that** scripts are more efficient and maintainable

#### Acceptance Criteria
- [x] Replace `seq` with bash arithmetic at line 1797: `for ((i = START_ITERATION; i <= MAX_ITERATIONS; i++))`
- [x] Use [[ ]] consistently instead of [ ] for conditionals
- [x] Add configurable delays to config.sh: ITERATION_DELAY, PROGRESS_INTERVAL
- [x] Test iteration timing and progress updates work correctly

### [x] US-008: Add status constants and configuration
**As a** ralph-cli maintainer
**I want** magic strings replaced with named constants
**So that** code is more maintainable and less error-prone

#### Acceptance Criteria
- [x] Add status constants to lib/output.sh or new lib/constants.sh
- [x] Define: STATUS_RUNNING, STATUS_COMPLETED, STATUS_READY, STATUS_NOT_FOUND
- [x] Update stream.sh to use constants instead of string literals
- [x] Test status checks work with constants

### [x] US-009: Extract retry logic to shared library
**As a** ralph-cli maintainer
**I want** retry/backoff logic extracted to a reusable module
**So that** retry behavior is consistent and loop.sh is simplified

#### Acceptance Criteria
- [x] Create `.agents/ralph/lib/retry.sh`
- [x] Extract `calculate_backoff_delay()` from loop.sh:368-390
- [x] Extract `run_agent_with_retry()` from loop.sh:401-505
- [x] Move retry configuration constants (RETRY_MAX_ATTEMPTS, RETRY_BASE_DELAY_MS, etc.)
- [x] Update loop.sh to source the library
- [x] Test retry logic works with exponential backoff
- [x] Verify ~140 lines removed from loop.sh

### [ ] US-010: Extract checkpoint functions to shared library
**As a** ralph-cli maintainer
**I want** checkpoint/resume logic extracted
**So that** checkpoint behavior is modular and testable

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/checkpoint.sh`
- [ ] Extract `save_checkpoint()` from loop.sh:891-925
- [ ] Extract `clear_checkpoint()` from loop.sh:929-951
- [ ] Extract `load_checkpoint()` from loop.sh:956-991
- [ ] Extract `validate_git_state()` from loop.sh:995-1033
- [ ] Extract `prompt_resume_confirmation()` from loop.sh:1037-1062
- [ ] Update loop.sh to source the library
- [ ] Test checkpoint save/load/resume works correctly
- [ ] Verify ~175 lines removed from loop.sh

### [ ] US-011: Extract routing and cost estimation functions
**As a** ralph-cli maintainer
**I want** model routing and cost estimation extracted
**So that** routing logic is modular and loop.sh is simplified

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/routing.sh`
- [ ] Extract `get_routing_decision()` from loop.sh:1067-1088
- [ ] Extract `estimate_execution_cost()` from loop.sh:1107-1128
- [ ] Extract `calculate_actual_cost()` from loop.sh:1133-1162
- [ ] Move `parse_json_field()` (consolidated from US-005) to this library
- [ ] Update loop.sh to source the library
- [ ] Test routing and cost estimation work correctly
- [ ] Verify ~100 lines removed from loop.sh

### [ ] US-012: Extract error display functions to output.sh
**As a** ralph-cli maintainer
**I want** error display functions in the shared output library
**So that** error formatting is consistent across scripts

#### Acceptance Criteria
- [ ] Move `show_error()` from loop.sh:1166-1173 to lib/output.sh
- [ ] Move `show_error_suggestions()` from loop.sh:1176-1188 to lib/output.sh
- [ ] Move `print_error_summary()` from loop.sh:1192-1220 to lib/output.sh
- [ ] Update loop.sh to use functions from lib/output.sh
- [ ] Test error display works correctly
- [ ] Verify ~60 lines removed from loop.sh

### [ ] US-013: Extract summary table functions to output.sh
**As a** ralph-cli maintainer
**I want** summary table functions in the shared output library
**So that** summary formatting is reusable

#### Acceptance Criteria
- [ ] Move `format_duration()` from loop.sh:1222-1232 to lib/output.sh
- [ ] Move `print_summary_table()` from loop.sh:1236-1330 to lib/output.sh
- [ ] Update loop.sh to use functions from lib/output.sh
- [ ] Test summary table displays correctly
- [ ] Verify ~100 lines removed from loop.sh

### [ ] US-014: Extract metrics functions to shared library
**As a** ralph-cli maintainer
**I want** token extraction and metrics functions extracted
**So that** metrics tracking is modular and testable

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/metrics.sh`
- [ ] Extract `extract_tokens_from_log()` from loop.sh:1555-1570
- [ ] Extract `append_metrics()` from loop.sh:1588-1684
- [ ] Extract `rebuild_token_cache()` from loop.sh:1688-1717
- [ ] Update loop.sh to source the library
- [ ] Test metrics tracking works correctly
- [ ] Verify ~130 lines removed from loop.sh

### [ ] US-015: Extract agent functions to shared library
**As a** ralph-cli maintainer
**I want** agent resolution and execution functions extracted
**So that** agent handling is modular and consistent

#### Acceptance Criteria
- [ ] Create `.agents/ralph/lib/agent.sh`
- [ ] Extract `resolve_agent_cmd()` from loop.sh:123-148
- [ ] Extract `require_agent()` from loop.sh:304-328
- [ ] Extract `run_agent()` from loop.sh:330-340
- [ ] Extract `run_agent_inline()` from loop.sh:342-354
- [ ] Extract `get_experiment_assignment()` from loop.sh:163-208
- [ ] Update loop.sh to source the library
- [ ] Test all agent types work correctly
- [ ] Verify ~150 lines removed from loop.sh

### [ ] US-016: Simplify write_run_meta function
**As a** ralph-cli maintainer
**I want** the run metadata writer simplified
**So that** the function is more maintainable and less verbose

#### Acceptance Criteria
- [ ] Refactor `write_run_meta()` (loop.sh:1362-1515) to accept JSON object instead of 27 parameters
- [ ] Consider extracting to external Python/Node script for markdown generation
- [ ] Reduce function from ~155 lines to ~30 lines
- [ ] Test run metadata files are generated correctly

## Technical Constraints

- **Backward Compatibility**: All existing commands must continue working
- **Zero Breaking Changes**: External CLI interface remains unchanged
- **Incremental Approach**: Each story is independently committable and testable
- **Testing Required**: Full test suite must pass after each library extraction
- **Rollback Strategy**: Each commit can be reverted independently
- **Token Efficiency**: Prioritize extractions that reduce tokens passed through loop

## Proposed Directory Structure

```
.agents/ralph/
├── lib/
│   ├── output.sh         # Color/message/error/summary helpers (~180 lines) [PARTIAL]
│   ├── prd-utils.sh      # PRD folder utilities (~60 lines)
│   ├── git-utils.sh      # Git helper functions (~40 lines)
│   ├── retry.sh          # Retry logic with backoff (~100 lines)
│   ├── checkpoint.sh     # Checkpoint save/load/resume (~120 lines)
│   ├── routing.sh        # Model routing and cost estimation (~80 lines)
│   ├── metrics.sh        # Token extraction and metrics (~100 lines)
│   ├── agent.sh          # Agent resolution and execution (~100 lines)
│   └── prd-parser.py     # All PRD parsing Python logic (~120 lines)
├── loop.sh               # Main execution loop (target: ~1100 lines)
├── stream.sh             # Stream management (target: ~600 lines)
├── config.sh             # Configuration
└── agents.sh             # Agent definitions
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
- Retry logic works with backoff
- Checkpoint save/resume works

## Success Metrics

- **Code Reduction**: 46% reduction in loop.sh (2073 → ~1100 lines)
- **Line Count**: New shared libraries total ~800 lines, net reduction ~700 lines
- **Test Coverage**: All existing functionality continues working
- **Maintainability**: Duplicated code eliminated, Python modules testable
- **Token Efficiency**: ~50% reduction in tokens per loop iteration
- **Security**: Eval usage minimized, no command injection vulnerabilities

## Priority Order

Stories should be implemented in this order to maximize impact:

1. **US-003** (Python extraction) - Highest token savings, ~140 lines
2. **US-009** (Retry logic) - Self-contained, ~140 lines
3. **US-010** (Checkpoints) - Self-contained, ~175 lines
4. **US-014** (Metrics) - Self-contained, ~130 lines
5. **US-012 + US-013** (Error/Summary to output.sh) - ~160 lines
6. **US-011** (Routing) - Depends on US-005 consolidation, ~100 lines
7. **US-015** (Agent functions) - ~150 lines
8. **US-002** (PRD utilities) - ~50 lines
9. **US-004** (Git utilities) - ~35 lines
10. **US-005** (Dead code/duplicates) - Quick wins
11. **US-016** (Simplify write_run_meta) - ~125 lines saved
12. **US-006, US-007, US-008** (Best practices, constants)

## Risk Mitigation

1. **Incremental Commits**: Each story is a separate commit with full testing
2. **Test Coverage**: Run full test suite after each library extraction
3. **Independent Rollback**: Each commit can be reverted without affecting others
4. **Backup Strategy**: Git history provides full rollback capability

## Routing Policy

- Commit URLs are invalid.
- Unknown GitHub subpaths canonicalize to repo root.

## Out of Scope

- Rewriting in a different language (staying with bash)
- Adding new CLI commands (this is pure refactoring)
- Changing external CLI interface or behavior
- Performance optimizations beyond best practices
- Adding new features (focus is maintainability)
