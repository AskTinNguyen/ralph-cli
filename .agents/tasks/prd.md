# Product Requirements Document: Ralph Self-Improvement System

## Overview

Build a self-evaluation and cross-loop learning system that allows Ralph loops to analyze their own performance, automatically improve from failures, and search/retrieve knowledge from other Ralph loops across projects.

**Why this matters:** Currently, Ralph loops learn within a single project through guardrails and progress logs. This system enables:

1. **Quantitative self-assessment** - Measure what's working and what's not
2. **Automated improvement** - Generate better guardrails and prompts from patterns
3. **Cross-project learning** - Share knowledge across all Ralph-powered projects

## User Stories

### [x] US-001: Run Evaluation and Scoring

**As a** developer using Ralph
**I want** automated evaluation of each run's quality
**So that** I can identify patterns in successful vs failed iterations

#### Acceptance Criteria

- [x] Create `ralph eval` command that analyzes completed runs
- [x] Score runs on: success rate, commit quality, verification pass rate, time efficiency
- [x] Generate evaluation report in `.ralph/evaluations/eval-{run-id}.md`
- [x] Display summary metrics: avg duration, success rate, common failure patterns
- [x] Support evaluating single run (`ralph eval {run-id}`) or all runs (`ralph eval --all`)

### [ ] US-002: Automated Guardrail Generation

**As a** Ralph loop
**I want** automatic extraction of learnings from failures
**So that** guardrails are generated without manual intervention

#### Acceptance Criteria

- [ ] Analyze error patterns in run logs to identify repeating failures
- [ ] Auto-generate guardrail candidates with trigger, instruction, context
- [ ] Add `ralph improve` command to review and apply guardrail candidates
- [ ] Store candidates in `.ralph/candidates/guardrails-pending.md`
- [ ] Track which failures led to which guardrails (provenance)

### [ ] US-003: Cross-Loop Knowledge Registry

**As a** developer with multiple Ralph-powered projects
**I want** a central registry of all Ralph loop knowledge
**So that** learnings can be shared across projects

#### Acceptance Criteria

- [ ] Create `~/.ralph/registry/` for cross-project knowledge
- [ ] Implement `ralph registry add` to register current project
- [ ] Store project metadata: path, name, last updated, stats
- [ ] Index guardrails, progress entries, and evaluations
- [ ] Support tagging projects for categorization (e.g., "typescript", "cli", "api")

### [ ] US-004: Cross-Loop Search and Retrieval

**As a** developer starting a new project
**I want** to search learnings from all my Ralph projects
**So that** I can apply relevant knowledge immediately

#### Acceptance Criteria

- [ ] Add `ralph search <query>` command for full-text search
- [ ] Search across: guardrails, progress logs, evaluations, run summaries
- [ ] Return ranked results with source project and relevance score
- [ ] Support filters: `--project`, `--type`, `--tags`, `--since`
- [ ] Display results with context snippets and links to full entries

### [ ] US-005: Automatic Knowledge Import

**As a** new Ralph project
**I want** to automatically import relevant guardrails from similar projects
**So that** I start with accumulated wisdom

#### Acceptance Criteria

- [ ] Add `ralph init --import-from <project>` flag
- [ ] Suggest relevant projects based on detected tech stack
- [ ] Show guardrail preview before import with accept/reject UI
- [ ] Track imported guardrails separately (mark as "imported from X")
- [ ] Support `ralph import guardrails` as standalone command

### [ ] US-006: Performance Metrics Dashboard

**As a** developer
**I want** aggregate metrics across all runs and projects
**So that** I can track Ralph's effectiveness over time

#### Acceptance Criteria

- [ ] Add `ralph stats` command for current project metrics
- [ ] Add `ralph stats --global` for cross-project metrics
- [ ] Track: total runs, success rate trend, avg duration trend, guardrails created
- [ ] Show improvement over time (e.g., "success rate improved 15% after guardrail X")
- [ ] Output in terminal table format and optional JSON for tooling

### [ ] US-007: Prompt Template Optimization

**As a** Ralph loop
**I want** prompt templates improved based on successful patterns
**So that** future iterations are more effective

#### Acceptance Criteria

- [ ] Analyze correlation between prompt variations and success rates
- [ ] Track which prompt sections are consistently followed/ignored
- [ ] Generate prompt improvement suggestions in `.ralph/candidates/prompt-suggestions.md`
- [ ] Add `ralph optimize prompts` to apply suggestions
- [ ] Version prompt templates and track effectiveness per version

### [ ] US-008: Failure Pattern Detection

**As a** Ralph loop
**I want** automatic detection of recurring failure patterns
**So that** systemic issues are identified and addressed

#### Acceptance Criteria

- [ ] Parse run logs for common error signatures
- [ ] Cluster similar failures across runs
- [ ] Identify root causes (e.g., "missing dependency", "type error", "test failure")
- [ ] Suggest remediation actions for each pattern
- [ ] Add `ralph diagnose` command to show current failure patterns

## Routing Policy

- Commit URLs are invalid.
- Unknown GitHub subpaths canonicalize to repo root.

## Technical Notes

### File Structure

```
~/.ralph/                          # Global registry
├── registry.json                  # Registered projects
├── index/                         # Search index
│   ├── guardrails.idx
│   ├── progress.idx
│   └── evaluations.idx
└── cache/                         # Search cache

.ralph/                            # Per-project (existing + new)
├── evaluations/                   # New: run evaluations
│   └── eval-{run-id}.md
├── candidates/                    # New: improvement candidates
│   ├── guardrails-pending.md
│   └── prompt-suggestions.md
└── metrics/                       # New: aggregated metrics
    └── stats.json
```

### Implementation Approach

1. Evaluation scoring uses heuristics on: exit codes, git diff size, verification commands
2. Full-text search via SQLite FTS5 or simple grep-based indexing
3. Pattern detection via log parsing and clustering (bag of words + edit distance)
4. Cross-project sync is pull-based (no daemon, runs on command)

### Integration Points

- `loop.sh`: Call evaluation after each run completion
- `stream.sh`: Aggregate metrics across parallel streams
- New commands: `eval`, `improve`, `registry`, `search`, `stats`, `diagnose`, `optimize`
