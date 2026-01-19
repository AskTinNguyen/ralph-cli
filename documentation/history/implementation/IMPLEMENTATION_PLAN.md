# Implementation Plan

## Summary

This plan implements the Ralph Self-Improvement System — a comprehensive evaluation, learning, and cross-project knowledge sharing system for Ralph loops. The current codebase is a Node.js CLI (`bin/ralph`) with bash scripts (`.agents/ralph/loop.sh`, `stream.sh`) that orchestrate agent-based code generation.

**Key gaps identified:**
- No evaluation/scoring commands exist (`eval`, `stats`, `diagnose`)
- No automated guardrail generation (`improve`)
- No cross-project knowledge registry (`~/.ralph/registry/`)
- No search capabilities (`search`)
- No import functionality (`import guardrails`)
- No prompt optimization tooling (`optimize prompts`)

**Priority order:** Start with US-001 (evaluation foundation), then US-008 (failure detection) to enable US-002 (guardrail generation). Cross-project features (US-003, US-004, US-005) come after single-project metrics (US-006) are working.

## Tasks

### US-001: Run Evaluation and Scoring

- [x] Create evaluation scoring module
  - Scope: Add `lib/eval/scorer.js` with functions to analyze run logs and compute scores for: success rate, verification pass rate, duration efficiency, commit quality (based on diff size and test pass)
  - Acceptance: Module exports `scoreRun(runLogPath, runMetaPath)` returning `{ successRate, verificationRate, duration, commitQuality, overall }`
  - Verification: `node -e "require('./lib/eval/scorer').scoreRun('.ralph/runs/run-*.log')"` returns valid score object
  - **Done**: Implemented in `lib/eval/scorer.js` with weighted scoring (success 40%, verification 30%, commit 20%, efficiency 10%)

- [x] Parse run logs for verification outcomes
  - Scope: In `lib/eval/parser.js`, create log parser to extract: exit codes, `<promise>COMPLETE</promise>` markers, test command outputs, git status before/after
  - Acceptance: Parser extracts structured data from run-*.log and run-*.md files
  - Verification: Unit test with sample run log returns expected parsed structure
  - **Done**: Implemented in `lib/eval/parser.js` with parseRunSummary() and parseRunLog() functions

- [x] Implement `ralph eval` command for single run
  - Scope: Add `eval` case in `bin/ralph`, accept run ID argument, load run log/meta from `.ralph/runs/`, call scorer, output formatted report to console and `.ralph/evaluations/eval-{run-id}.md`
  - Acceptance: `ralph eval 20260113-175316-44711` produces evaluation report file
  - Verification: `ralph eval {run-id}` creates `.ralph/evaluations/eval-{run-id}.md` with scores
  - **Done**: Command added to bin/ralph with colored console output and report generation

- [x] Implement `ralph eval --all` for batch evaluation
  - Scope: Add `--all` flag to scan `.ralph/runs/` for all run-*.md files, score each, output summary table with aggregates
  - Acceptance: `ralph eval --all` processes all runs and shows summary metrics
  - Verification: `ralph eval --all` outputs table with avg duration, success rate, common patterns
  - **Done**: Evaluates all runs, shows summary with score breakdown and failure patterns

- [x] Generate evaluation report file
  - Scope: In `lib/eval/reporter.js`, format evaluation data as markdown with sections: Summary, Scores, Breakdown, Recommendations
  - Acceptance: Report includes numerical scores, pass/fail breakdown, and actionable suggestions
  - Verification: Evaluation report is readable markdown with proper formatting
  - **Done**: Reports saved to `.ralph/evaluations/` with grades, scores, and recommendations

### US-008: Failure Pattern Detection

- [ ] Create error signature extraction module
  - Scope: Add `lib/diagnose/extractor.js` to scan run logs for common error patterns: stack traces, exit codes, test failures, TypeScript errors, shell errors
  - Acceptance: Module exports `extractErrors(logPath)` returning array of `{ type, message, location, frequency }`
  - Verification: Extract errors from sample log containing known failure patterns

- [ ] Implement error clustering logic
  - Scope: In `lib/diagnose/cluster.js`, group similar errors using edit distance on error messages, bucket by error type (test, type, shell, dependency)
  - Acceptance: Similar errors cluster together, distinct errors remain separate
  - Verification: Test with 10 sample errors, verify correct clustering into 3-4 groups

- [ ] Add root cause classification
  - Scope: Map error clusters to root cause categories: `missing-dependency`, `type-error`, `test-failure`, `shell-error`, `permission-error`, `timeout`
  - Acceptance: Each cluster has assigned root cause and remediation suggestion
  - Verification: Clustered errors show appropriate root cause labels

- [ ] Implement `ralph diagnose` command
  - Scope: Add `diagnose` case in `bin/ralph`, scan `.ralph/runs/` and `.ralph/errors.log`, run extractor and clusterer, output pattern summary
  - Acceptance: `ralph diagnose` shows top failure patterns with counts and suggestions
  - Verification: `ralph diagnose` outputs readable table of patterns sorted by frequency

- [ ] Add `--run` flag for single-run diagnosis
  - Scope: Allow `ralph diagnose --run {run-id}` to analyze specific run only
  - Acceptance: Command shows failures from specified run with remediation suggestions
  - Verification: `ralph diagnose --run {run-id}` analyzes single run

### US-002: Automated Guardrail Generation

- [ ] Create guardrail candidate generator
  - Scope: Add `lib/improve/generator.js` that takes clustered failures and generates guardrail candidates with: trigger (when it applies), instruction (what to do), context (why added)
  - Acceptance: Generator produces markdown-formatted guardrail candidates from failure clusters
  - Verification: Feed 5 clustered failures, receive 5 guardrail candidates

- [ ] Implement failure-to-guardrail mapping
  - Scope: Create mapping rules in `lib/improve/rules.js` from error types to guardrail templates (e.g., "test-failure" → "Run tests before commit")
  - Acceptance: Each error type has at least one guardrail template
  - Verification: All 6 root cause types produce appropriate guardrails

- [ ] Store candidates in `.ralph/candidates/guardrails-pending.md`
  - Scope: Write generated candidates to pending file with provenance (which run/failure led to this)
  - Acceptance: Pending file contains guardrail candidates with source references
  - Verification: File includes guardrail format and "Added after: run-{id}" provenance

- [ ] Implement `ralph improve` command with interactive review
  - Scope: Add `improve` case in `bin/ralph`, read candidates, present each for accept/reject using @clack/prompts, write accepted to `.ralph/guardrails.md`
  - Acceptance: User can review candidates one-by-one, accepted ones added to guardrails
  - Verification: `ralph improve` shows candidates, accepted ones appear in guardrails.md

- [ ] Track guardrail provenance
  - Scope: When adding guardrail, include metadata: source run ID, original failure message, date added
  - Acceptance: Guardrails in guardrails.md show "Added after: Iteration N - [failure description]"
  - Verification: New guardrails have provenance comments

### US-006: Performance Metrics Dashboard

- [ ] Create metrics aggregation module
  - Scope: Add `lib/stats/aggregator.js` to compute: total runs, success rate, avg duration, guardrails created, runs per day
  - Acceptance: Module exports `aggregateMetrics(runsDir)` returning stats object
  - Verification: Run against `.ralph/runs/` returns valid metrics

- [ ] Implement `ralph stats` command
  - Scope: Add `stats` case in `bin/ralph`, call aggregator, format output as terminal table using picocolors
  - Acceptance: `ralph stats` shows formatted metrics table for current project
  - Verification: Command outputs readable stats with colors

- [ ] Add `--json` flag for machine-readable output
  - Scope: When `--json` passed, output metrics as JSON instead of table
  - Acceptance: `ralph stats --json` outputs valid JSON
  - Verification: `ralph stats --json | jq .` parses successfully

- [ ] Track success rate trends over time
  - Scope: Group runs by day/week, compute rolling success rate, show trend (improving/declining)
  - Acceptance: Stats show "Success rate: 75% (↑ from 60% last week)"
  - Verification: With runs spanning multiple days, trend calculation is correct

- [ ] Store metrics in `.ralph/metrics/stats.json`
  - Scope: Cache computed metrics to file, update on each stats run, include timestamp
  - Acceptance: Metrics cached and reused when run logs haven't changed
  - Verification: Second `ralph stats` runs faster (uses cache)

### US-003: Cross-Loop Knowledge Registry

- [ ] Create global registry directory structure
  - Scope: On first registry command, create `~/.ralph/registry/`, `~/.ralph/index/`, `~/.ralph/cache/`
  - Acceptance: Directories created with proper permissions
  - Verification: `ls ~/.ralph/` shows registry structure

- [ ] Implement `ralph registry add` command
  - Scope: Add `registry` command with `add` subcommand, register current project path in `~/.ralph/registry.json` with metadata: path, name (from package.json or dirname), last updated, tags
  - Acceptance: `ralph registry add` adds current project to global registry
  - Verification: `cat ~/.ralph/registry.json` shows current project entry

- [ ] Add project metadata indexing
  - Scope: When registering, scan `.ralph/guardrails.md`, `.ralph/progress.md`, compute stats, store in registry entry
  - Acceptance: Registry entry includes guardrail count, run count, success rate
  - Verification: Registry entry has stats fields populated

- [ ] Implement `ralph registry list` command
  - Scope: Show all registered projects with last updated time and stats
  - Acceptance: `ralph registry list` outputs table of all registered projects
  - Verification: Command shows projects added via `ralph registry add`

- [ ] Add tagging support with `--tags` flag
  - Scope: Allow `ralph registry add --tags typescript,cli,api` to categorize project
  - Acceptance: Tags stored in registry entry and searchable
  - Verification: `ralph registry add --tags foo` stores tags in registry.json

### US-004: Cross-Loop Search and Retrieval

- [ ] Create search index builder
  - Scope: Add `lib/search/indexer.js` to build text index from guardrails.md, progress.md across all registered projects
  - Acceptance: Index built as JSON file in `~/.ralph/index/`
  - Verification: Index file contains searchable entries with project references

- [ ] Implement simple text search (grep-based)
  - Scope: Add `lib/search/searcher.js` with `search(query, options)` function using regex matching
  - Acceptance: Search returns ranked results with snippets and source info
  - Verification: Search for known term returns matching entries

- [ ] Add `ralph search <query>` command
  - Scope: Add `search` case in `bin/ralph`, accept query string, search index, display results
  - Acceptance: `ralph search "test before commit"` returns matching guardrails
  - Verification: Command outputs results with project name, type, and snippet

- [ ] Implement search filters
  - Scope: Add `--project`, `--type` (guardrail|progress|evaluation), `--tags`, `--since` flags
  - Acceptance: Filters narrow search results appropriately
  - Verification: `ralph search "error" --type guardrail` returns only guardrails

- [ ] Display results with context snippets
  - Scope: Show surrounding context (2-3 lines) for each match, highlight query terms
  - Acceptance: Results show context around matches with highlighting
  - Verification: Output includes highlighted matches in context

### US-005: Automatic Knowledge Import

- [ ] Implement `ralph import guardrails` command
  - Scope: Add `import` command with `guardrails` subcommand, prompt user to select source project from registry, show preview of guardrails to import
  - Acceptance: User can select project and preview guardrails before import
  - Verification: `ralph import guardrails` shows selection and preview UI

- [ ] Add guardrail preview and selection UI
  - Scope: Use @clack/prompts multiselect to let user choose which guardrails to import
  - Acceptance: User can select specific guardrails from preview list
  - Verification: Only selected guardrails are imported

- [ ] Mark imported guardrails with source project
  - Scope: Append "(imported from {project})" to imported guardrails in guardrails.md
  - Acceptance: Imported guardrails clearly marked with source
  - Verification: Guardrails show "Imported from: {project}" in comment

- [ ] Add `--import-from` flag to `ralph init`
  - Scope: Extend init/install to accept `--import-from <project>` flag, auto-import guardrails during setup
  - Acceptance: `ralph install --import-from myproject` copies guardrails
  - Verification: New project has guardrails from specified source

- [ ] Suggest relevant projects based on tech stack
  - Scope: Detect tech stack (package.json, Cargo.toml, etc.), suggest registered projects with matching tags
  - Acceptance: When importing, show "Suggested projects" based on detected stack
  - Verification: TypeScript project shows other TypeScript projects first

### US-007: Prompt Template Optimization

- [ ] Track prompt template versions
  - Scope: Add version comment to PROMPT_build.md and PROMPT_plan.md headers, increment on changes
  - Acceptance: Prompt files have version identifier (e.g., `# Version: 1.0.0`)
  - Verification: Prompt files contain version strings

- [ ] Correlate prompt sections with success rates
  - Scope: In `lib/optimize/correlator.js`, analyze which prompt instructions are followed/ignored by comparing prompts to run outcomes
  - Acceptance: Module identifies sections that correlate with success/failure
  - Verification: Correlation analysis shows which sections most impact outcomes

- [ ] Generate prompt improvement suggestions
  - Scope: Write suggestions to `.ralph/candidates/prompt-suggestions.md` based on correlation analysis
  - Acceptance: Suggestions include: strengthen successful sections, clarify ignored sections
  - Verification: Suggestions file contains actionable improvement ideas

- [ ] Implement `ralph optimize prompts` command
  - Scope: Add `optimize` command with `prompts` subcommand, show suggestions, apply accepted changes to prompt templates
  - Acceptance: User can review and apply prompt improvements
  - Verification: `ralph optimize prompts` shows suggestions with apply option

- [ ] Track effectiveness per prompt version
  - Scope: Store version-to-success mapping in `.ralph/metrics/prompt-versions.json`
  - Acceptance: Stats show "Version 1.2 success rate: 80% (vs 65% in v1.1)"
  - Verification: Multiple versions tracked with comparative stats

## Notes

- **CLI Pattern**: Ralph uses Node.js (`bin/ralph`) as entry point that dispatches to bash scripts. New commands should follow this pattern — Node.js for argument parsing and user interaction, bash/Python for core logic if needed.

- **Dependencies**: The CLI already uses `@clack/prompts` for interactive UI and `picocolors` for colored output. New commands should reuse these.

- **File Locations**: Per-project state goes in `.ralph/`, global state in `~/.ralph/`. Run logs are in `.ralph/runs/`, evaluations in `.ralph/evaluations/`, candidates in `.ralph/candidates/`.

- **Search Implementation**: Start with grep-based search for simplicity. SQLite FTS5 mentioned in PRD is an optimization for later if needed.

- **Testing**: Per AGENTS.md: `npm test` for dry-run tests, `npm run test:ping` for quick agent check. New commands should have corresponding test coverage.

- **Backward Compatibility**: Existing commands (`build`, `plan`, `prd`, `stream`) must continue working. New commands are additive.

