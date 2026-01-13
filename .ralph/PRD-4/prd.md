# Product Requirements Document: Ralph Self-Improvement System

## Overview

The Ralph Self-Improvement System adds comprehensive evaluation, learning, and cross-project knowledge sharing capabilities to Ralph loops. This system enables Ralph to learn from its execution history, detect failure patterns, automatically generate guardrails, and share knowledge across projects.

**Problem**: Currently, Ralph loops lack evaluation mechanisms, failure analysis, and cross-project learning. Each loop execution generates logs but no systematic learning occurs. Projects cannot share successful patterns or guardrails.

**Solution**: Implement a full feedback loop with evaluation scoring, failure pattern detection, automated guardrail generation, performance metrics, cross-project registry, search capabilities, guardrail import/export, and prompt optimization.

**Impact**: Improved loop success rates through automatic guardrail generation, faster debugging via failure pattern detection, knowledge reuse across projects, and data-driven prompt optimization.

## User Stories

### [x] US-001: Run Evaluation and Scoring
**As a** Ralph user
**I want** to evaluate completed loop runs with numerical scores
**So that** I can measure loop quality and track improvement over time

#### Acceptance Criteria
- [x] `ralph eval {run-id}` analyzes single run and outputs score report
- [x] `ralph eval --all` processes all runs and shows aggregate metrics
- [x] Evaluation considers: success rate, verification pass rate, duration efficiency, commit quality
- [x] Reports saved to `.ralph/evaluations/eval-{run-id}.md` with scores and recommendations
- [x] Parser extracts structured data from run logs (exit codes, COMPLETE markers, test outputs, git status)

### [x] US-008: Failure Pattern Detection
**As a** Ralph user
**I want** to identify common failure patterns across loop runs
**So that** I can understand root causes and prevent recurring issues

#### Acceptance Criteria
- [x] `ralph diagnose` scans all runs and shows top failure patterns
- [x] `ralph diagnose --run {run-id}` analyzes specific run
- [x] Error extraction handles: stack traces, test failures, TypeScript errors, shell errors, exit codes
- [x] Error clustering groups similar failures using edit distance
- [x] Root cause classification maps errors to categories: missing-dependency, type-error, test-failure, shell-error, permission-error, timeout
- [x] Report saved to `.ralph/diagnosis.md` with remediation suggestions

### [x] US-002: Automated Guardrail Generation
**As a** Ralph user
**I want** guardrails to be automatically generated from detected failures
**So that** future loops avoid repeating the same mistakes

#### Acceptance Criteria
- [x] `ralph improve --generate` analyzes failures and generates guardrail candidates
- [x] `ralph improve --apply` presents candidates for interactive review (accept/reject)
- [x] Guardrail candidates include: trigger (when it applies), instruction (what to do), context (why added)
- [x] Candidates stored in `.ralph/candidates/guardrails-pending.md` with provenance
- [x] Accepted guardrails added to `.ralph/guardrails.md` with metadata: source run ID, failure message, date added
- [x] Failure-to-guardrail mapping covers all error types

### [x] US-006: Performance Metrics Dashboard
**As a** Ralph user
**I want** to view performance metrics for loop executions
**So that** I can track trends and measure system effectiveness

#### Acceptance Criteria
- [x] `ralph stats` displays project metrics: total runs, success rate, avg duration, guardrails created, runs per day
- [x] `ralph stats --json` outputs machine-readable JSON
- [x] `ralph stats --global` shows cross-project aggregate metrics
- [x] Success rate trends show week-over-week changes with directional indicators
- [x] Metrics cached to `.ralph/metrics/stats.json` for performance
- [x] Display includes: overview, duration stats, trends, mode breakdown, guardrail impacts, weekly activity

### [x] US-003: Cross-Loop Knowledge Registry
**As a** Ralph user
**I want** to register projects in a global registry
**So that** I can share knowledge and guardrails across multiple Ralph projects

#### Acceptance Criteria
- [x] `ralph registry add` registers current project in `~/.ralph/registry.json`
- [x] `ralph registry list` shows all registered projects with stats
- [x] Registry metadata includes: path, name, last updated, tags, guardrail count, run count, success rate
- [x] `--tags` flag supports project categorization (e.g., `--tags typescript,cli,api`)
- [x] Auto-detection of tech stack from package.json, Cargo.toml, pyproject.toml
- [x] Global directory structure: `~/.ralph/registry/`, `~/.ralph/index/`, `~/.ralph/cache/`

### [x] US-004: Cross-Loop Search and Retrieval
**As a** Ralph user
**I want** to search across all registered projects
**So that** I can find relevant guardrails, solutions, and patterns from other loops

#### Acceptance Criteria
- [x] `ralph search <query>` searches across all registered projects
- [x] Search index built from: guardrails.md, progress.md, evaluations, run summaries
- [x] Filters supported: `--project`, `--type` (guardrail|progress|evaluation|run), `--tags`, `--since`, `--limit`
- [x] Results show: project name, type badge, relevance score, context snippet (2-3 lines)
- [x] Query terms highlighted in results
- [x] `--rebuild` flag refreshes search index

### [x] US-005: Automatic Knowledge Import
**As a** Ralph user
**I want** to import guardrails from other projects
**So that** I can reuse proven patterns without manual copying

#### Acceptance Criteria
- [x] `ralph import guardrails` provides interactive project selection and preview
- [x] Multiselect UI allows choosing specific guardrails to import
- [x] `--all` flag imports all guardrails without selection
- [x] Imported guardrails marked with source: "Imported from: {project}" and timestamp
- [x] `ralph install --import-from <project>` auto-imports during project setup
- [x] Suggested projects ranked by tech stack similarity (matching tags)
- [x] Imported guardrails stored in "## Imported Signs" section

### [x] US-007: Prompt Template Optimization
**As a** Ralph user
**I want** to optimize prompt templates based on execution outcomes
**So that** prompts become more effective over time

#### Acceptance Criteria
- [x] Prompt templates (PROMPT_build.md, PROMPT_plan.md) include version identifiers
- [x] `ralph optimize prompts` analyzes correlation between prompt sections and success rates
- [x] Suggestions generated for: strengthen (high-impact), clarify (ignored), remove (low-impact), review (negative-impact)
- [x] `ralph optimize prompts --apply` provides interactive review of suggestions
- [x] Version metrics tracked in `.ralph/metrics/prompt-versions.json`
- [x] `ralph optimize prompts --versions` shows version comparison with success rates
- [x] Suggestions saved to `.ralph/candidates/prompt-suggestions.md`

## Technical Constraints

- **CLI Pattern**: Use Node.js (bin/ralph) for CLI entry point, dispatch to bash/JS modules
- **Dependencies**: Reuse existing `@clack/prompts` for interactive UI, `picocolors` for colored output
- **File Structure**: Per-project state in `.ralph/`, global state in `~/.ralph/`
- **Backward Compatibility**: Existing commands (build, plan, prd, stream) must continue working unchanged
- **Search Implementation**: Start with regex-based search; SQLite FTS5 is future optimization
- **Testing**: Follow existing patterns with `npm test` for dry-run tests

## Success Metrics

- 30%+ improvement in loop success rates after guardrail generation
- 50%+ reduction in time to debug recurring failures via pattern detection
- 10+ projects registered in global registry within first month
- 80%+ user acceptance rate for automatically generated guardrails
- Measurable prompt effectiveness improvement (tracked via version metrics)

## Out of Scope

- Real-time loop monitoring (future enhancement)
- Machine learning-based pattern detection (start with rule-based)
- Web UI dashboard (CLI-only for now)
- Multi-user collaboration features
- Cloud-based registry (local filesystem only)
