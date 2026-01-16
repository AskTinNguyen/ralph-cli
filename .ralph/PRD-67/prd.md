# Product Requirements Document

## Overview

Improve Ralph CLI's core developer experience to enable true "Ship While You Sleep" autonomous development by adding real-time visibility, error discoverability, production monitoring, and optional TypeScript migration for long-term maintainability.

**Context:** Ralph CLI has superior features (parallel execution, agent fallback, multi-stack detection) compared to NightShift Ralph, but suffers from poor visibility and discoverability. The infrastructure exists—we need to expose it to developers.

**Goal:** Enable developers to confidently run `ralph build 50` overnight and wake up to working code or clear actionable alerts.

---

## User Stories

### Phase 1: Real-Time Feedback (Priority: P0)

### [x] US-001: Real-time status visibility during builds

**As a** developer running `ralph build`
**I want** to see live status updates (phase, story, elapsed time)
**So that** I know what Ralph is doing instead of just seeing a timer

#### Acceptance Criteria

- [x] CLI shows current phase (planning|executing|committing|verifying)
- [x] CLI shows current story ID and title
- [x] CLI shows elapsed time
- [x] Status updates every 1 second without flickering
- [x] `.status.json` file created/updated in PRD folder
- [x] No performance regression (< 5% overhead)

---

### [x] US-002: Event log for errors, warnings, and retries

**As a** developer
**I want** to see errors, warnings, and retry attempts as they happen
**So that** I can understand build progress and issues in real-time

#### Acceptance Criteria

- [x] `.events.log` file captures errors, warnings, info messages
- [x] CLI displays new events with visual indicators (✗, ⚠, ℹ)
- [x] Events shown with color coding (red=error, yellow=warn, dim=info)
- [x] Retry attempts visible: "Retry 2/3 (delay: 2s)"
- [x] Events persist to disk for historical review

---

### [x] US-003: UI real-time dashboard widget

**As a** developer monitoring builds via UI
**I want** the dashboard to show live status updates
**So that** I don't need to refresh or poll manually

#### Acceptance Criteria

- [x] Live status widget shows: phase, story, elapsed time
- [x] Widget updates via SSE (leverages existing file watcher)
- [x] Recent events displayed in widget (last 5-10)
- [x] Widget appears/hides based on build running state
- [x] API endpoints: GET `/api/streams/:id/status`, GET `/api/streams/:id/events`

---

### Phase 2: Error Visibility & Resume (Priority: P0)

### [x] US-004: Inline error context when builds fail

**As a** developer debugging failed builds
**I want** to see error context immediately when failure occurs
**So that** I don't need to hunt through multiple log files

#### Acceptance Criteria

- [x] Error events include last 3-10 lines containing error keywords
- [x] Context shown in both CLI and `.events.log`
- [x] Context includes: iteration number, story ID, agent name
- [x] CLI displays error context with proper formatting

---

### [x] US-005: Auto-detect resume capability

**As a** developer whose build was interrupted
**I want** Ralph to automatically detect checkpoints and prompt me to resume
**So that** I don't need to remember the `--resume` flag

#### Acceptance Criteria

- [x] Checkpoint detection happens on every `ralph build` start (no flag needed)
- [x] Visual prompt shows: last iteration, story ID, agent used
- [x] Interactive prompt: "Resume from checkpoint? [Y/n]"
- [x] Choosing "n" clears checkpoint and starts fresh
- [x] Non-interactive mode (CI/CD) auto-resumes
- [x] Validation before resume (git state, plan hash unchanged)

---

### [x] US-006: UI checkpoint banner with resume button

**As a** developer using the web dashboard
**I want** a visual indicator when builds can be resumed
**So that** I can easily restart interrupted builds

#### Acceptance Criteria

- [x] Checkpoint banner appears when `.checkpoint.json` exists
- [x] Banner shows: iteration number, story ID, timestamp
- [x] "Resume Build" button triggers build with resume
- [x] "Start Fresh" button clears checkpoint
- [x] API endpoint: GET `/api/streams/:id/checkpoint`, POST `/api/streams/:id/resume`

---

### Phase 3: Cost Tracking (Priority: P1)

### [x] US-007: Real-time cost accumulation

**As a** developer concerned about API costs
**I want** to see running cost during builds
**So that** I can track spending in real-time

#### Acceptance Criteria

- [x] `.cost.json` file updated after each agent call
- [x] Running total calculated using existing estimator
- [x] Cost displayed in CLI: `$0.0234` next to status
- [x] UI dashboard shows cost with 4 decimal precision
- [x] Cost persists across checkpoint/resume

---

### [x] US-008: Budget warnings and enforcement

**As a** developer with budget limits
**I want** warnings before exceeding budget
**So that** I can control spending proactively

#### Acceptance Criteria

- [x] Budget config file: `.ralph/PRD-N/.budget.json`
- [x] Warning at 75% of budget (yellow)
- [x] Warning at 90% of budget (orange)
- [x] Error at 100% of budget (red, build pauses)
- [x] Warnings visible in both CLI and UI
- [x] Budget config command: `ralph budget set <amount>`

---

### Phase 4: Production Monitoring (Priority: P1)

### [x] US-009: Stall detection system

**As a** developer running unattended builds
**I want** Ralph to detect when builds are stuck
**So that** hung processes don't waste time

#### Acceptance Criteria

- [x] Heartbeat file (`.heartbeat`) updated every agent output
- [x] Stall detected after 30 minutes of no output
- [x] Stall logged to `activity.log` and `.events.log`
- [x] Stall creates `.stalled` marker file with diagnostics
- [x] Configurable threshold via `RALPH_STALL_THRESHOLD_SILENT`

---

### [ ] US-010: Watchdog process for auto-recovery

**As a** developer
**I want** external monitoring to restart failed/stalled builds
**So that** builds can recover without manual intervention

#### Acceptance Criteria

- [ ] Watchdog spawns as separate process when stream build starts
- [ ] Watchdog checks heartbeat every 60 seconds
- [ ] 3 consecutive stall checks trigger restart
- [ ] Max 3 restarts before escalating to NEEDS_HUMAN
- [ ] Watchdog logs to `watchdog.log`
- [ ] Watchdog terminates when lock file disappears

---

### [ ] US-011: Timeout enforcement

**As a** developer
**I want** automatic timeouts for long-running operations
**So that** infinite hangs are prevented

#### Acceptance Criteria

- [ ] Agent call timeout: 60 minutes (uses `timeout` command)
- [ ] Iteration timeout: 90 minutes (watchdog enforced)
- [ ] Story timeout: 3 hours across multiple attempts
- [ ] Timeout logged with context (agent, story, duration)
- [ ] Configurable via env vars: `RALPH_TIMEOUT_AGENT`, `RALPH_TIMEOUT_ITERATION`

---

### [ ] US-012: Multi-channel notifications

**As a** developer
**I want** notifications when builds complete or need attention
**So that** I know results without actively monitoring

#### Acceptance Criteria

- [ ] Notification channels: CLI, Slack, Discord, Email, Webhooks
- [ ] Events: build_complete, build_failed, stalled, needs_human
- [ ] Configuration file: `.agents/ralph/notify.conf`
- [ ] Graceful failure if channel unavailable (don't block builds)
- [ ] Notification includes: stream ID, event details, timestamp
- [ ] Test notification command: `ralph notify test`

---

### Phase 5: TypeScript Migration (Priority: P2)

### [ ] US-013: Extract failure detection to TypeScript

**As a** developer maintaining Ralph
**I want** failure detection patterns to be unit testable
**So that** we can confidently add/modify patterns

#### Acceptance Criteria

- [ ] Module: `lib/failure-detection/index.js`
- [ ] 40+ regex patterns extracted from loop.sh
- [ ] Unit tests for each pattern
- [ ] Bash integration: `node lib/failure-detection/cli.js "$log_file"`
- [ ] Test coverage >80%

---

### [ ] US-014: Extract metrics builder to TypeScript

**As a** developer
**I want** metrics handling to be type-safe
**So that** adding new metrics doesn't break builds

#### Acceptance Criteria

- [ ] Module: `lib/metrics/builder.js`
- [ ] Replace 27-argument bash function with JSON object
- [ ] Schema validation for metrics data
- [ ] Bash integration: `node lib/metrics/cli.js "$json_data"`
- [ ] Backward compatible with existing metrics.jsonl

---

### [ ] US-015: Extract story selection to TypeScript

**As a** developer
**I want** story parsing and locking to be reliable
**So that** parallel execution works correctly

#### Acceptance Criteria

- [ ] Module: `lib/story/index.js`
- [ ] Parse plan.md into structured Story objects
- [ ] Atomic lock + select operation
- [ ] Unit tests for race conditions
- [ ] Bash integration: `node lib/story/cli.js select-and-lock "$plan"`

---

### [ ] US-016: BuildStateManager for transactional updates

**As a** developer
**I want** progress.md updates to be transactional
**So that** concurrent builds don't corrupt state

#### Acceptance Criteria

- [ ] Module: `lib/state/index.js`
- [ ] Transactional updates to progress.md/activity.log
- [ ] Backward compatible file format
- [ ] Atomic operations for concurrent access
- [ ] Bash integration: `node lib/state/cli.js update-iteration ...`

---

### [ ] US-017: Optional TypeScript executor

**As a** developer
**I want** option to run builds with TypeScript loop
**So that** I can benefit from type safety and testability

#### Acceptance Criteria

- [ ] Module: `lib/executor/loop.js`
- [ ] Full orchestration in TypeScript
- [ ] Preserves: parallel execution, resume, agent switching, rollback
- [ ] Opt-in via: `export RALPH_EXECUTOR=typescript`
- [ ] Performance within 10% of bash loop
- [ ] Graceful fallback to bash on errors

---

## Success Metrics

### Phase 1 Success (Real-Time Feedback)
- CLI shows live status (phase, story, elapsed)
- UI dashboard updates in real-time via SSE
- Events (retries, warnings) visible immediately
- No performance regression (< 5% overhead)

### Phase 2 Success (Error & Resume)
- Errors show inline context (last 3 error lines)
- Resume prompt appears automatically (no --resume flag)
- UI checkpoint banner with resume button works
- Resume rate increases by 50%

### Phase 3 Success (Cost Tracking)
- CLI shows running cost next to status
- Budget warnings at 75%/90%/100%
- UI cost dashboard with real-time updates
- Zero builds exceed budget without warning

### Phase 4 Success (Monitoring)
- Stalls detected within 30 minutes
- Watchdog restarts builds automatically
- Timeouts prevent infinite hangs
- Notifications delivered to configured channels
- 24-hour unattended builds succeed

### Phase 5 Success (TypeScript)
- TypeScript modules have >80% test coverage
- BuildStateManager handles concurrent updates
- TypeScript executor (opt-in) works for full builds
- Performance parity with bash loop

### Overall Success
**Target:** Run `ralph build 50` overnight
- Zero manual interventions needed
- Clear audit trail in activity.log
- Notifications sent on completion/failure
- Graceful recovery from transient failures
- Developer wakes up to working code or actionable alert

---

## Out of Scope

- Complete rewrite of loop.sh (incremental migration only)
- Database requirement (maintain file-based state)
- Breaking changes to existing commands
- UI redesign (enhancements only)
- New agent integrations (focus on existing agents)

---

## Routing Policy

- Commit URLs are invalid.
- Unknown GitHub subpaths canonicalize to repo root.
- This PRD is backend/CLI-focused: no frontend skill required.

---

## Dependencies

**Required:**
- Node.js 18+ (already required)
- Existing modules: tokens, metrics, checkpoint
- File watcher service (already in ui/)

**Optional:**
- Slack/Discord webhooks (for notifications)
- TypeScript 5+ (for Phase 5)

**No Breaking Changes:**
- All features opt-in or backward compatible
- Existing `ralph build` commands work unchanged
- File formats remain readable