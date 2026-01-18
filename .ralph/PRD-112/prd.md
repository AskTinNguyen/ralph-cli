# Product Requirements Document: Phase 3 Executive Automation

**PRD ID:** PRD-112
**Created:** 2026-01-18
**Status:** Ready for Implementation
**Priority:** High
**Project:** Ralph CLI
**Team:** Automation

## Overview

Implement production-ready executive automation for game studio CEO managing multiple PRD streams across teams. This includes real-time blocker escalation, comprehensive bug root cause analysis, real Slack integration, and GitHub archiving of metrics.

**Design Approval:** All decisions finalized in `.ralph/PRD-110/PHASE3_PROPOSAL.md`

## Objectives

1. **Real Slack Integration** - Replace mock sends with production Slack API
2. **Blocker Escalation** - Smart 3-level escalation (2/4/7 days) with manual resolution tracking
3. **GitHub Archiving** - Version-controlled metrics storage with automated PRs
4. **Bug Root Cause Analysis** - Build institutional "Bug Wikipedia" with pattern detection

## Implementation Timeline

- **Week 1:** Real Slack Integration
- **Week 2:** Blocker Escalation System
- **Week 3:** GitHub Archiving
- **Week 4:** Bug Root Cause Analysis

---

## User Stories

### Week 1: Real Slack Integration

### [x] US-001: Replace mock Slack sends with real Slack Web API

**As a** CEO
**I want** real Slack notifications for daily status, weekly summaries, and alerts
**So that** I receive timely updates without checking the UI manually

#### Acceptance Criteria

- [x] Update `scripts/slack-reporter.js` to use real Slack API (MCP or `@slack/web-api`)
- [x] Support message types: channel posts, direct messages, file uploads
- [x] Implement retry logic: 3 attempts with exponential backoff
- [x] Add rate limiting: respect 1 msg/sec per channel, 20 req/min global
- [x] Queue failed messages for retry
- [x] Fallback to email if Slack fails after retries
- [x] Log all send attempts (success/failure)
- [x] Configuration via `SLACK_BOT_TOKEN` env var
- [x] Channel mapping in `.ralph/automation-config.json`
- [x] Test with real Slack workspace (dry-run mode verified with `npm run test:slack`)

**Technical Notes:**
- Prefer MCP Slack server if available: `mcp__slack__send_message`, `mcp__slack__create_dm`
- Fallback to `@slack/web-api` npm package for direct API access
- Store channel IDs in automation-config.json: `{ "slackChannels": { "gameplay": "C123", "leadership": "C456" } }`

---

### [x] US-002: Slack message formatting with Block Kit

**As a** team lead
**I want** rich-formatted Slack messages with sections, buttons, and context blocks
**So that** I can quickly scan status updates and take action

#### Acceptance Criteria

- [x] Convert existing plaintext messages to Block Kit format
- [x] Daily status: use sections for discipline grouping, context blocks for metrics
- [x] Weekly summary: header blocks, dividers, action buttons (View Details)
- [x] Include links to UI: `http://localhost:3000/prd/{id}`
- [x] Use emoji indicators: 🟢 (healthy), 🟡 (at-risk), 🔴 (blocked)
- [x] Add metadata blocks: timestamp, run count, last activity
- [x] Test rendering in Slack mobile and desktop

**Block Kit Structure Example:**
```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Daily PRD Status - 2026-01-18" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Gameplay Team*\n🟢 PRD-45: 3 stories completed\n🔴 PRD-46: Blocked for 2 days" }
    }
  ]
}
```

---

### [x] US-013: CLI commands for automation scripts and installation guide

**As a** developer installing Ralph in a new game dev repo
**I want** simple CLI commands to run automation scripts and clear installation documentation
**So that** I can quickly enable executive automation without manually invoking Node scripts

#### Acceptance Criteria

- [x] Add `ralph automation` subcommands for all automation scripts:
  - `ralph automation slack-report` → runs slack-reporter.js
  - `ralph automation check-blockers` → runs check-blockers.js
  - `ralph automation github-archive` → runs github-archiver.js
  - `ralph automation scan-bugs` → runs bug-scanner.js
- [x] Each subcommand invokes the script from Ralph CLI package (not local copy)
- [x] Scripts use `process.cwd()` to find current project's `.ralph/` directory
- [x] Create `AUTOMATION_INSTALL.md` in Ralph CLI repo with:
  - Prerequisites (Node.js, npm, Ralph CLI installed)
  - Step-by-step setup guide for new repos
  - Configuration template for `.ralph/automation-config.json`
  - Environment variable setup
  - Cron/GitHub Actions integration examples
  - Troubleshooting section
  - Agent-optimized format (concise, numbered steps, copy-paste ready)
- [x] Document how to verify installation is working
- [x] Include example cron schedule for all automation scripts

**Technical Notes:**
- CLI subcommands go in `bin/ralph` or new file `lib/commands/automation.js`
- Scripts remain in `scripts/` directory of Ralph CLI package (single source of truth)
- When installed globally: scripts run from global package
- When installed locally: scripts run from local node_modules/ralph-cli
- INSTALL.md should be copyable to game repos or readable from Ralph docs

---

### Week 2: Blocker Escalation System

### [x] US-003: Implement 3-level blocker detection

**As a** CEO
**I want** automatic escalation when PRDs are blocked for 2/4/7 days
**So that** I can intervene before critical delays impact deadlines

#### Acceptance Criteria

- [x] Detect blockers: zero velocity (no successful runs) for >2/4/7 days
- [x] Track escalation state: not escalated, level1, level2, level3
- [x] Store blocker metadata in `.ralph/PRD-N/blocker-status.json`
- [x] Metadata includes: blocker_since, days_blocked, escalation_level, last_escalation_date
- [x] Run daily check: `scripts/check-blockers.js` (called by automation cron)
- [x] Prevent duplicate alerts: only escalate once per level
- [x] Update blocker status file after each escalation

**Blocker Status File Schema:**
```json
{
  "prd_id": 123,
  "is_blocked": true,
  "blocker_since": "2026-01-14T10:00:00Z",
  "days_blocked": 4,
  "escalation_level": 2,
  "escalation_history": [
    { "level": 1, "date": "2026-01-16T10:00:00Z", "alerted": ["@team-lead"] },
    { "level": 2, "date": "2026-01-18T10:00:00Z", "alerted": ["@director", "@team-lead"] }
  ],
  "last_successful_run": "2026-01-13T15:30:00Z"
}
```

---

### [x] US-004: Send escalation alerts with root cause context

**As a** team lead
**I want** escalation alerts with who/why/what/how context
**So that** I can quickly understand and resolve the blocker

#### Acceptance Criteria

- [x] Level 1 (2 days): Slack to team channel, mention @team-lead
- [x] Level 2 (4 days): Slack to team + leadership channels, mention @director + @team-lead
- [x] Level 3 (7 days): DM to CEO + leadership channel, mention @ceo + @director + @team-lead
- [x] Alert includes 5 context fields:
  - [x] **Who caused:** Developer who introduced issue (via git blame on failing files)
  - [x] **Why:** Root cause category (from bug wikipedia if available)
  - [x] **What happened before:** Timeline of events leading to blocker
  - [x] **How to fix:** Recommended remediation steps
  - [x] **Who should fix:** Suggested assignee based on expertise
- [x] Link to PRD details: `http://localhost:3000/prd/{id}`
- [x] Track alerted users for resolution notifications

**Alert Template:**
```
🚨 Blocker Escalation - Level 2

PRD: PRD-123 (Mobile Gameplay Feature)
Team: Gameplay | Priority: High
Days Blocked: 4 | Last Activity: 2026-01-14

🔍 ROOT CAUSE ANALYSIS:
Who Caused: @alice (commit abc123)
Why: Module refactor broke import paths
What Happened Before:
  - 2026-01-13: Refactored PlayerInventory
  - 2026-01-14: 10 consecutive build failures

💡 HOW TO FIX:
1. Update import paths in src/gameplay/player.ts
2. Check PlayerInventory exports

👤 WHO SHOULD FIX:
Recommended: @alice (original author)
Backup: @bob (team lead)

View Details: http://localhost:3000/prd/123
```

---

### [x] US-005: Manual blocker resolution with tracking

**As a** team lead
**I want** to manually confirm blocker resolution and document what fixed it
**So that** we build knowledge about effective interventions

#### Acceptance Criteria

- [x] CLI command: `ralph stream resolve-blocker <prd-id> --reason "explanation"`
- [x] UI button: "Resolve Blocker" (requires reason input) - Endpoint available at POST /api/blocker/
- [x] Automatic detection: when successful run detected after blocker, send notification "🟢 PRD may be resolved"
- [x] Detection does NOT auto-clear blocker status (requires manual confirmation)
- [x] Resolution tracking: time from escalation to resolution, escalation level that triggered fix
- [x] Send "all clear" notification to all alerted users - Integrated with CLI command
- [x] Store resolution explanation in `.ralph/PRD-N/blocker-status.json`
- [x] Feed resolution data into bug wikipedia for pattern analysis

**Resolution Workflow:**
```
Blocker detected → Level 1 alert (2 days)
                      ↓
                  Level 2 alert (4 days)
                      ↓
              Successful run detected
                      ↓
        "May be resolved" notification
                      ↓
    Human confirms: ralph stream resolve-blocker 123 --reason "Fixed dependency"
                      ↓
          "All clear" sent to alerted users
                      ↓
       Resolution logged to bug wikipedia
```

---

### [x] US-006: Auto-create GitHub issue for Level 3 escalations

**As a** CEO
**I want** critical blockers (7+ days) to auto-create GitHub issues
**So that** they are formally tracked and assigned for resolution

#### Acceptance Criteria

- [x] Trigger: Level 3 escalation reached (7 days blocked)
- [x] Create issue in game repo via MCP GitHub: `mcp__github__create_issue`
- [x] Title: `[Critical Blocker] PRD-{id}: {prd_title}`
- [x] Labels: `critical`, `blocker`, `ralph-escalation`
- [x] Assignees: team lead, director (from PRD metadata)
- [x] Body includes full escalation context (who/why/what/how/who-should-fix)
- [x] Link back to PRD UI and blocker status file
- [x] Auto-close issue when blocker resolved (via `ralph stream resolve-blocker`)
- [x] Add resolution comment with explanation
- [x] Track issue URL in blocker-status.json

**GitHub Issue Body Template:**
```markdown
# Critical Blocker: PRD-123

**Status:** Blocked for 7 days (Level 3 Escalation)
**Team:** Gameplay
**Priority:** High
**Last Activity:** 2026-01-11

## Root Cause Analysis
- **Who Caused:** @alice (commit abc123)
- **Why:** Module refactor broke import paths
- **What Happened Before:**
  - 2026-01-13: Refactored PlayerInventory
  - 2026-01-14: 10 consecutive build failures

## Recommended Fix
1. Update import paths in src/gameplay/player.ts
2. Check PlayerInventory exports

## Recommended Assignee
@alice (original author) or @bob (team lead)

**PRD Details:** http://localhost:3000/prd/123
**Blocker Status:** `.ralph/PRD-123/blocker-status.json`

---
*Auto-generated by Ralph Blocker Escalation System*
```

---

### Week 3: GitHub Archiving

### [x] US-007: Push metrics to ralph-metrics branch

**As a** CEO
**I want** all metrics stored in game repos on a ralph-metrics branch
**So that** metrics are version-controlled and accessible to the team

#### Acceptance Criteria

- [x] Create `scripts/github-archiver.js`
- [x] Authenticate via `GITHUB_TOKEN` env var
- [x] Target branch: `ralph-metrics` (create if doesn't exist)
- [x] Directory structure in game repos:
  ```
  .ralph-metrics/
  ├── daily/2026-01-18.json
  ├── weekly/2026-W03.md
  ├── monthly/2026-01.md
  └── bug-wikipedia/
      ├── index.md
      ├── categories/
      ├── by-developer/
      ├── by-module/
      └── metrics/
  ```
- [x] Bot user commits: `ralph-automation-bot <ralph-bot@studio.com>`
- [x] Commit message: `[Ralph] Daily metrics for 2026-01-18`
- [x] Handle merge conflicts: prefer newest data
- [x] Run daily via cron or GitHub Actions

**Configuration:**
```json
{
  "githubArchiving": {
    "enabled": true,
    "repositories": [
      {
        "name": "game-a",
        "owner": "studio-org",
        "repo": "game-a",
        "branch": "ralph-metrics",
        "metricsPath": ".ralph-metrics"
      }
    ],
    "botUser": {
      "name": "ralph-automation-bot",
      "email": "ralph-bot@studio.com"
    }
  }
}
```

---

### [x] US-008: Daily PR from ralph-metrics to main with auto-merge

**As a** team member
**I want** metrics automatically merged to main daily
**So that** the latest data is always available without manual intervention

#### Acceptance Criteria

- [x] After committing to ralph-metrics, auto-create PR to main
- [x] PR title: `[Ralph] Metrics update - 2026-01-18`
- [x] PR body includes:
  - [x] Summary of new metrics (# PRDs active, # blockers, notable changes)
  - [x] Link to detailed daily report
  - [x] List of critical alerts (new blockers, budget overruns)
- [x] Labels: `ralph-metrics`, `auto-merge`
- [x] Merge strategy: squash commit
- [x] Auto-merge: YES if CI passes (JSON validation, linting)
- [x] No review required (trust automated metrics)
- [x] Frequency: 1 PR per day (consolidates all daily updates)
- [x] Emergency: immediate PR for critical blocker alerts

**PR Workflow:**
```
Daily metrics generated
         ↓
Commit to ralph-metrics branch
         ↓
Create PR: ralph-metrics → main
         ↓
CI checks pass (JSON validation)
         ↓
Auto-merge to main
         ↓
Close PR
```

---

### Week 4: Bug Root Cause Analysis

### [x] US-009: Scan git history for bug-related commits

**As a** CEO
**I want** all bug fixes automatically analyzed for root cause
**So that** we build institutional knowledge about what goes wrong and why

#### Acceptance Criteria

- [x] Create `scripts/bug-scanner.js`
- [x] Scan git history for bug-related keywords: `fix`, `bug`, `issue`, `hotfix`, `patch`
- [x] Extract commit data: message, author, date, files changed, diff
- [x] Identify related PRs/issues via commit message references (#123, PRD-45)
- [x] Store raw bug data in `.ralph/bug-wikipedia/raw/bug-{sha}.json`
- [x] Link to original commit: git SHA, GitHub URL
- [x] Run daily to catch new bug fixes

**Bug Data Schema:**
```json
{
  "id": "bug-abc123",
  "commit_sha": "abc123def456",
  "commit_message": "fix: race condition in session manager",
  "author": { "name": "Alice", "email": "alice@studio.com" },
  "date_fixed": "2026-01-18T10:00:00Z",
  "files_changed": ["src/auth/session-manager.ts"],
  "diff": "...",
  "related_issues": ["#456", "PRD-45"],
  "error_message": "Concurrent access to shared state"
}
```

---

### [x] US-010: AI-powered bug categorization with Claude Haiku

**As a** CEO
**I want** bugs automatically categorized by root cause
**So that** I can identify patterns and high-risk areas

#### Acceptance Criteria

- [x] Use Claude Haiku to analyze each bug commit
- [x] Input: commit message, diff, error message, files changed
- [x] Output: JSON with primary category, secondary categories, severity, reasoning
- [x] Categories:
  - [x] Logic error (wrong algorithm, off-by-one)
  - [x] Race condition / concurrency
  - [x] Requirements misunderstanding
  - [x] Integration issue (API mismatch)
  - [x] Environment-specific
  - [x] Dependency issue
  - [x] Performance degradation
  - [x] Security vulnerability
  - [x] Data corruption
  - [x] User input validation
- [x] Store categorization in `.ralph/bug-wikipedia/categorized/bug-{sha}.json`
- [x] Include prevention tips in output

**Haiku Prompt:**
```
Analyze this bug and categorize its root cause:

Commit: {{commit_message}}
Files: {{files_changed}}
Diff: {{diff_snippet}}
Error: {{error_message}}

Output JSON:
{
  "primary_category": "race-condition",
  "secondary_categories": ["concurrency", "performance"],
  "severity": "high",
  "reasoning": "Bug caused by race condition in concurrent map access...",
  "prevention_tips": "Use mutex locks for shared state access",
  "similar_bugs": ["bug-123", "bug-456"]
}
```

---

### [x] US-011: Build Bug Wikipedia structure

**As a** developer
**I want** bugs organized by category, developer, and module
**So that** I can learn from past issues and avoid repeating mistakes

#### Acceptance Criteria

- [x] Create directory structure:
  ```
  .ralph/bug-wikipedia/
  ├── index.md                          # Table of contents
  ├── categories/
  │   ├── logic-errors.md
  │   ├── race-conditions.md
  │   └── ...
  ├── by-developer/
  │   ├── developer-alice.md
  │   └── developer-bob.md
  ├── by-module/
  │   ├── authentication.md
  │   └── payment-processing.md
  ├── patterns/
  │   └── recurring-issues.md
  └── metrics/
      └── summary.json
  ```
- [x] Auto-generate markdown files with bug summaries
- [x] Link to original commits, PRs, issues
- [x] Include timeline: introduced → discovered → fixed
- [x] Track attribution: who introduced, who fixed, who reviewed
- [x] Calculate metrics: time to detect, time to fix
- [x] Update daily as new bugs are scanned

**Example: categories/race-conditions.md**
```markdown
# Race Condition Bugs

## Summary
- Total: 12 bugs
- Severity: 8 high, 4 medium
- Avg time to fix: 4.2 days
- Most affected module: src/auth/

## Bugs
### Bug-abc123: Session manager race condition
- **Fixed:** 2026-01-18 by @alice
- **Introduced:** 2025-12-10 by @alice (commit xyz789)
- **Time to fix:** 3 days
- **Files:** src/auth/session-manager.ts
- **Prevention tip:** Use mutex locks for shared state
- [Commit](https://github.com/org/repo/commit/abc123)
```

---

### [x] US-012: Pattern detection and auto-create deep dive issue

**As a** CEO
**I want** recurring bug patterns to trigger automatic deep dive analysis
**So that** we proactively fix systemic issues before they compound

#### Acceptance Criteria

- [x] Detect patterns: 3+ bugs in same category + module within 30 days
- [x] Auto-create GitHub issue when pattern detected
- [x] Title: `[Bug Pattern] {category} in {module}`
- [x] Labels: `bug-pattern`, `needs-analysis`, `deep-dive`
- [x] Body includes:
  - [x] Pattern summary (category, module, occurrences, trend)
  - [x] List of similar bugs with links
  - [x] Recommended actions (immediate + long-term)
  - [x] Timeline (first → latest occurrence)
- [x] Trigger deep dive factory: `.ralph/factory/bug-deep-dive-analysis.yaml`
- [x] Factory output: root cause analysis, refactor recommendations, prevention strategy
- [x] Notify team in Slack with link to issue
- [x] Track pattern resolution: auto-close when pattern stops (no new bugs in 60 days)

**Pattern Detection Logic:**
```javascript
// Group bugs by (category, module)
const patterns = bugs.reduce((acc, bug) => {
  const key = `${bug.primary_category}-${bug.module}`
  if (!acc[key]) acc[key] = []
  acc[key].push(bug)
  return acc
}, {})

// Find patterns: 3+ bugs in 30 days
Object.entries(patterns).forEach(([key, bugs]) => {
  const recent = bugs.filter(b => Date.now() - b.date_fixed < 30 * 24 * 60 * 60 * 1000)
  if (recent.length >= 3) {
    createPatternIssue(key, recent)
    triggerDeepDiveFactory(key, recent)
  }
})
```

**Deep Dive Factory Definition:**
```yaml
# .ralph/factory/bug-deep-dive-analysis.yaml
name: bug-deep-dive-analysis
description: Root cause analysis for recurring bug patterns

stages:
  - name: analyze_pattern
    agent: claude-sonnet
    prompt: |
      Analyze this recurring bug pattern:
      {{pattern_summary}}

      Output:
      1. Root cause (why does this keep happening?)
      2. Recommended refactor (how to prevent permanently?)
      3. Prevention strategy (tests, architecture changes)

  - name: generate_recommendations
    agent: claude-sonnet
    prompt: |
      Based on analysis: {{analyze_pattern.output}}

      Generate:
      1. Immediate action items
      2. Long-term refactor plan
      3. Test coverage recommendations

outputs:
  - deep_dive_report.md
  - refactor_recommendations.md
  - prevention_checklist.md
```

---

## Configuration Files

### `.ralph/automation-config.json`

```json
{
  "slackChannels": {
    "gameplay": "C07L2GUNV6Y",
    "art": "C02RGAP67BL",
    "leadership": "C05V8KNACTU",
    "critical_alerts": "C05V8KNACTU"
  },
  "slackUsers": {
    "ceo": "U123456",
    "director_gameplay": "U234567",
    "director_art": "U345678"
  },
  "blockerEscalation": {
    "enabled": true,
    "thresholds": {
      "level1_days": 2,
      "level2_days": 4,
      "level3_days": 7
    },
    "actions": {
      "level1": {
        "channels": ["team"],
        "mentions": ["teamLead"],
        "severity": "warning"
      },
      "level2": {
        "channels": ["team", "leadership"],
        "mentions": ["teamLead", "director"],
        "severity": "error"
      },
      "level3": {
        "channels": ["leadership"],
        "mentions": ["ceo", "director", "teamLead"],
        "severity": "critical",
        "dm_ceo": true
      }
    },
    "contextFields": [
      "who_caused",
      "why",
      "what_happened_before",
      "how_to_fix",
      "who_should_fix"
    ]
  },
  "githubArchiving": {
    "enabled": true,
    "repositories": [
      {
        "name": "game-a",
        "owner": "studio-org",
        "repo": "game-a",
        "branch": "ralph-metrics",
        "metricsPath": ".ralph-metrics"
      }
    ],
    "botUser": {
      "name": "ralph-automation-bot",
      "email": "ralph-bot@studio.com"
    }
  },
  "bugWikipedia": {
    "enabled": true,
    "patternThreshold": 3,
    "patternWindow_days": 30,
    "autoCreateIssues": true,
    "deepDiveFactory": ".ralph/factory/bug-deep-dive-analysis.yaml"
  }
}
```

---

## Environment Variables

```bash
# Slack
SLACK_BOT_TOKEN=xoxb-your-token-here
SLACK_TEAM_ID=T01234567

# GitHub
GITHUB_TOKEN=ghp_your-token-here

# Ralph
RALPH_ROOT=/path/to/.ralph
```

---

## Success Metrics

### Real Slack Integration
- [ ] 100% delivery rate for notifications
- [ ] <1% error rate on sends
- [ ] Zero missed critical alerts

### Blocker Escalation
- [ ] 95% of blockers resolved within escalation timeframe
- [ ] Zero blockers reach Level 3 after first month (all caught earlier)
- [ ] Average blocker resolution time: <3 days
- [ ] 100% resolution tracking (all blockers documented)

### GitHub Archiving
- [ ] Daily metrics committed 100% of days
- [ ] Auto-merge success rate: >95%
- [ ] Full history available for analysis (30+ days)

### Bug Root Cause Analysis
- [ ] Bug wikipedia has 100+ entries within 3 months
- [ ] Pattern detection identifies 5+ recurring issues in first month
- [ ] Time to fix decreases by 20% (due to prevention tips)
- [ ] 100% of patterns trigger deep dive analysis

---

## Technical Dependencies

- Node.js scripts: `scripts/slack-reporter.js`, `scripts/check-blockers.js`, `scripts/github-archiver.js`, `scripts/bug-scanner.js`
- MCP servers: Slack, GitHub (or fallback to npm packages)
- Claude Haiku API access for bug categorization
- Cron jobs or GitHub Actions for daily automation
- UI endpoints: `/api/resolve-blocker` for manual confirmation

---

## Routing Policy

- Commit URLs are invalid.
- Unknown GitHub subpaths canonicalize to repo root.
- **Backend stories**: Standard implementation (no frontend skill needed).

---

## Notes

- **All design decisions approved:** See `.ralph/PRD-110/PHASE3_PROPOSAL.md`
- **No team overrides:** Single CEO flow for all teams
- **Manual resolution required:** Blockers not auto-resolved on successful run
- **Daily PR auto-merge:** Trust automated metrics, no review needed
- **Pattern detection threshold:** 3+ bugs in 30 days triggers deep dive
- **Privacy:** Developer tracking approved, no anonymization needed
