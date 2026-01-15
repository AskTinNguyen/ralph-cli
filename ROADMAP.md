# Ralph CLI Roadmap: Q1 2026

> **For the full vision, see [VISION.md](VISION.md)** — Ralph's philosophy of autonomous development that lets you ship while you sleep.

## Vision Statement

Transform Ralph from a minimal agent loop into the **premier autonomous development platform** — a tireless AI partner that executes features autonomously while developers focus on architecture, strategy, and life outside of code.

**Core Promise:** Define what you want, walk away, return to working code.

---

## Progress Overview

| Theme                           | Completion | Status                                |
| ------------------------------- | ---------- | ------------------------------------- |
| **Month 1**: Stability & DX     | **45%**    | UI done, reliability gaps             |
| **Month 2**: Intelligence       | **35%**    | Foundations exist, automation missing |
| **Month 3**: Scale & Enterprise | **15%**    | Local-first, no cloud/team features   |

---

## Autonomy Milestones

Progress toward **fully unattended operation** — the ability to run Ralph for hours or days without human intervention.

| Milestone | Target Runtime | Key Features | Status |
|-----------|----------------|--------------|--------|
| **Level 1: Supervised** | 30 minutes | Basic retry, manual recovery | ✅ Complete |
| **Level 2: Semi-Autonomous** | 2-4 hours | Checkpoint/resume, agent switching | 🔄 In Progress |
| **Level 3: Autonomous** | 8-12 hours | Watchdog, self-healing, notifications | 📋 Planned |
| **Level 4: Overnight** | 24+ hours | Full recovery, pattern learning | 📋 Planned |
| **Level 5: Continuous** | Unlimited | Cloud infrastructure, queue management | 📋 Planned |

### Current State: Level 1-2 Transition

**What works today:**
- ✅ Basic retry with exponential backoff
- ✅ Agent fallback chain on failures
- ✅ Parallel streams in isolated worktrees
- ✅ Budget limits prevent runaway costs
- ✅ Risk assessment flags dangerous changes

**Blocking full autonomy:**
- ⏳ Checkpoint system (resume after crash)
- ⏳ Graceful shutdown (clean state on interrupt)
- ⏳ Watchdog process (restart stalled builds)
- ⏳ Complete notification system (alert on completion)

---

## Month 1: Stability, Polish & Developer Experience

### Theme: Production-Ready Foundation

**Goal**: Make Ralph reliable enough for daily production use with excellent developer experience.

### 1.1 Core Reliability (Autonomy-Critical)

These features are **essential for unattended operation**. Without them, Ralph requires human supervision.

| Feature | Description | Autonomy Impact | Status |
| ------- | ----------- | --------------- | ------ |
| **Retry & Recovery** | Automatic retry with exponential backoff on agent failures | Handles transient failures | PARTIAL |
| **Checkpoint System** | Save/restore loop state for resumable builds | **CRITICAL:** Resume after crash/restart | NOT STARTED |
| **Graceful Shutdown** | Handle SIGINT/SIGTERM, save progress, clean up worktrees | **CRITICAL:** Clean state on interrupt | PARTIAL |
| **Watchdog Process** | Monitor builds, restart stalled executions | Recover from hangs | NOT STARTED |
| **Health Checks** | Pre-flight validation of agent availability, git state, disk space | Fail fast, not mid-build | PARTIAL |
| **Heartbeat System** | Periodic health signals, detect unresponsive builds | Identify hung processes | NOT STARTED |

### 1.2 Developer Experience

| Feature                     | Description                                               | Status      |
| --------------------------- | --------------------------------------------------------- | ----------- |
| **`ralph init`**            | Interactive project setup wizard with sensible defaults   | NOT STARTED |
| **`ralph doctor`**          | Diagnose environment issues (agents, permissions, config) | NOT STARTED |
| **`ralph watch`**           | Live-reload development mode with file watching           | NOT STARTED |
| **Improved Error Messages** | Actionable errors with suggested fixes                    | PARTIAL     |
| **Shell Completions**       | Bash/Zsh/Fish autocomplete for all commands               | NOT STARTED |

### 1.3 UI Enhancements

| Feature                         | Description                                         | Status  |
| ------------------------------- | --------------------------------------------------- | ------- |
| **Mobile-Responsive Dashboard** | Access from any device                              | DONE    |
| **Dark Mode**                   | System preference detection + toggle                | DONE    |
| **Notification System**         | Desktop notifications for build completion/failures | PARTIAL |
| **Log Search & Filter**         | Full-text search across run history                 | DONE    |

### 1.4 Testing & Quality

| Feature                    | Description                                      | Status      |
| -------------------------- | ------------------------------------------------ | ----------- |
| **CI/CD Pipeline**         | GitHub Actions for automated testing             | NOT STARTED |
| **Integration Test Suite** | End-to-end tests with mock agents                | PARTIAL     |
| **Documentation Site**     | Docusaurus site with tutorials and API reference | NOT STARTED |

---

## Month 2: Intelligence & Automation

### Theme: Smarter Autonomous Execution

**Goal**: Make Ralph intelligent enough to optimize its own execution and recover from failures automatically.

### 2.1 Intelligent Agent Selection

| Feature                     | Description                                        | Status      |
| --------------------------- | -------------------------------------------------- | ----------- |
| **Auto-Model Selection**    | Choose optimal model based on task complexity      | PARTIAL     |
| **Cost-Optimized Routing**  | Use Haiku for simple tasks, Opus for complex       | DONE        |
| **Context-Aware Switching** | Switch agents mid-stream based on failure patterns | NOT STARTED |
| **A/B Testing Framework**   | Automatically compare agent performance            | NOT STARTED |

### 2.2 Self-Healing Capabilities

| Feature                    | Description                                           | Status      |
| -------------------------- | ----------------------------------------------------- | ----------- |
| **Auto-Fix Common Errors** | Detect and fix lint/type/test failures automatically  | PARTIAL     |
| **Dependency Resolution**  | Auto-install missing packages                         | NOT STARTED |
| **Conflict Resolution**    | Intelligent merge conflict handling                   | PARTIAL     |
| **Rollback & Retry**       | Automatic rollback on test failures, retry with fixes | NOT STARTED |

### 2.3 Advanced Planning

| Feature                       | Description                                     | Status      |
| ----------------------------- | ----------------------------------------------- | ----------- |
| **Story Dependency Graph**    | Visualize and respect task dependencies         | DONE        |
| **Critical Path Analysis**    | Optimize execution order for fastest completion | DONE        |
| **Risk Assessment**           | Flag high-risk changes for human review         | NOT STARTED |
| **Automatic Story Splitting** | Break large stories into smaller, atomic tasks  | NOT STARTED |

### 2.4 Context Intelligence

| Feature                    | Description                                         | Status      |
| -------------------------- | --------------------------------------------------- | ----------- |
| **Codebase Indexing**      | Build semantic index for better agent context       | PARTIAL     |
| **Cross-Project Learning** | Apply lessons from similar projects                 | PARTIAL     |
| **Pattern Library**        | Reusable solution patterns from past work           | PARTIAL     |
| **Smart Context Window**   | Dynamically select relevant files for agent context | NOT STARTED |

---

## Month 3: Scale & Enterprise

### Theme: Team Collaboration & Production Scale

**Goal**: Enable teams to use Ralph collaboratively with enterprise-grade features.

### 3.1 Team Collaboration

| Feature                     | Description                                | Status      |
| --------------------------- | ------------------------------------------ | ----------- |
| **Ralph Cloud Dashboard**   | Hosted web UI for team visibility          | NOT STARTED |
| **Real-Time Collaboration** | Multiple developers watching same build    | NOT STARTED |
| **Role-Based Access**       | Admin, developer, viewer permissions       | NOT STARTED |
| **Team Activity Feed**      | Slack/Discord integration for team updates | PARTIAL     |

### 3.2 CI/CD Integration

| Feature                        | Description                            | Status      |
| ------------------------------ | -------------------------------------- | ----------- |
| **GitHub Actions Integration** | `ralph-action` for automated PR builds | NOT STARTED |
| **PR Auto-Creation**           | Generate PRs from completed streams    | NOT STARTED |
| **Review Automation**          | Auto-request reviews, run checks       | NOT STARTED |
| **Deployment Triggers**        | Trigger deploys on successful builds   | NOT STARTED |

### 3.3 Enterprise Features

| Feature                     | Description                              | Status      |
| --------------------------- | ---------------------------------------- | ----------- |
| **SSO/SAML Authentication** | Enterprise identity providers            | NOT STARTED |
| **Audit Logging**           | Complete audit trail for compliance      | NOT STARTED |
| **Budget Policies**         | Team/project budget limits and approvals | DONE        |
| **Private Model Support**   | Connect to self-hosted LLMs              | NOT STARTED |

### 3.4 Scalability

| Feature                 | Description                          | Status      |
| ----------------------- | ------------------------------------ | ----------- |
| **Remote Execution**    | Run builds on cloud workers          | NOT STARTED |
| **Build Queue**         | Priority queue for team builds       | NOT STARTED |
| **Distributed Streams** | Coordinate builds across machines    | PARTIAL     |
| **Artifact Caching**    | Cache dependencies and build outputs | PARTIAL     |

### 3.5 Analytics & Insights

| Feature                   | Description                              | Status      |
| ------------------------- | ---------------------------------------- | ----------- |
| **Team Velocity Metrics** | Stories/week, success rates by developer | PARTIAL     |
| **Cost Attribution**      | Track costs by project, team, feature    | PARTIAL     |
| **Trend Analysis**        | Week-over-week improvement tracking      | PARTIAL     |
| **Custom Reports**        | Scheduled reports to Slack/email         | NOT STARTED |

---

## Success Metrics

| Metric                | Current | Month 1   | Month 2  | Month 3    |
| --------------------- | ------- | --------- | -------- | ---------- |
| Story success rate    | ~70%    | 85%       | 92%      | 95%        |
| Mean time to recovery | Manual  | 2 min     | 30 sec   | Automatic  |
| Cost per story        | Tracked | Optimized | Budgeted | Attributed |
| Active users          | 1       | 10        | 50       | 200+       |

---

## Technical Priorities

1. **Backward Compatibility**: All upgrades must preserve existing `.ralph/` state
2. **Agent Agnostic**: Support new agents (Gemini, GPT, local LLMs) without core changes
3. **Offline First**: Core functionality works without cloud connectivity
4. **Extension System**: Plugin architecture for custom integrations

---

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Priority areas for community contribution:

- Agent adapters (new LLM providers)
- UI themes and components
- Documentation and tutorials
- Integration plugins (Jira, Linear, etc.)

---

## Future: Day in the Life

What autonomous development looks like when this roadmap is complete:

### Morning (15 minutes)

```bash
# Review PRs from overnight builds
gh pr list --author=ralph-bot

# Merge completed features
ralph stream merge 1
ralph stream merge 2

# Define today's features
ralph prd "Add user analytics dashboard"
ralph prd "Implement webhook system"
ralph plan
```

### Workday (Focus on other things)

```bash
# Start parallel builds and walk away
ralph stream build 1 50 &
ralph stream build 2 50 &

# Notifications arrive via Slack:
# ✅ PRD-1: US-001 completed (commit abc123)
# ✅ PRD-1: US-002 completed (commit def456)
# ⚠️ PRD-2: US-003 flagged for review (high risk)
```

### Evening (10 minutes)

```bash
# Check status
ralph stream status

# Review flagged changes
git diff main..ralph/PRD-2 -- src/payments/

# Approve and continue
ralph stream build 2 --continue

# Start overnight run
ralph build 100 --notify-on-complete
```

### Results

- **Features shipped:** 2-3 per day
- **Developer time:** < 1 hour
- **Build time:** 8-12 hours (parallel)
- **Cost:** $20-50 per day (optimized routing)

**Ralph does the work. You do the thinking.**

---

## Quick Links

- [VISION.md](VISION.md) — Philosophy and long-term vision
- [CLAUDE.md](CLAUDE.md) — Complete reference for AI agents
- [documentation/](documentation/) — Detailed guides
- [ui/public/docs/](ui/public/docs/) — Web documentation
