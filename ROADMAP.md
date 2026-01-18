# Ralph CLI Roadmap: Q1 2026

> **For the full vision, see [VISION.md](VISION.md)** — Ralph's philosophy of autonomous development that lets you ship while you sleep.

## Vision Statement

Transform Ralph from a minimal agent loop into the **premier autonomous development platform** — a tireless AI partner that executes features autonomously while developers focus on architecture, strategy, and life outside of code.

**Core Promise:** Define what you want, walk away, return to working code.

---

## Progress Overview

| Theme                           | Completion | Status                                      |
| ------------------------------- | ---------- | ------------------------------------------- |
| **Month 1**: Stability & DX     | **75%**    | Major features complete, some gaps remain   |
| **Month 2**: Intelligence       | **55%**    | Model routing done, learning systems partial |
| **Month 3**: Scale & Enterprise | **25%**    | Cost tracking complete, cloud/team pending  |

---

## Autonomy Milestones

Progress toward **fully unattended operation** — the ability to run Ralph for hours or days without human intervention.

| Milestone | Target Runtime | Key Features | Status |
|-----------|----------------|--------------|--------|
| **Level 1: Supervised** | 30 minutes | Basic retry, manual recovery | ✅ Complete |
| **Level 2: Semi-Autonomous** | 2-4 hours | Checkpoint/resume, agent switching, watchdog | ✅ Complete |
| **Level 3: Autonomous** | 8-12 hours | Self-healing, multi-channel notifications, rollback | 🔄 In Progress |
| **Level 4: Overnight** | 24+ hours | Full recovery, pattern learning, health checks | 📋 Planned |
| **Level 5: Continuous** | Unlimited | Cloud infrastructure, queue management | 📋 Planned |

### Current State: Level 2 Achieved

**What works today:**
- ✅ Basic retry with exponential backoff
- ✅ Agent fallback chain on failures
- ✅ Parallel streams in isolated worktrees
- ✅ Budget limits prevent runaway costs
- ✅ Risk assessment flags dangerous changes
- ✅ Checkpoint system with auto-resume
- ✅ Watchdog process for auto-recovery
- ✅ Real-time status visibility and event logging
- ✅ Cost tracking with budget warnings

**Blocking Level 3 autonomy:**
- ⏳ Complete notification system (multi-channel alerts)
- ⏳ Self-healing with automatic rollback
- ⏳ Full health check pre-flight system
- ⏳ Heartbeat monitoring across all streams

---

## Recently Completed (January 2026)

### Voice Agent System
- ✅ **STT/TTS Pipeline**: Complete voice input/output with faster-whisper and Piper
- ✅ **Multi-Provider TTS**: OpenAI, ElevenLabs, and Piper neural voices
- ✅ **Wake Word Detection**: Hands-free activation with server-side processing
- ✅ **Session Management**: Persistent state and cross-process coordination
- ✅ **Voice Queue System**: Prevents TTS overlap with atomic file locking
- ✅ **E2E Test Suite**: Comprehensive voice pipeline testing infrastructure
- ✅ **31 Voice Commands**: Full intent classification across all categories

### UI/UX Enhancements
- ✅ **Kanban Board**: Visual project status with RAMS design system
- ✅ **Real-time Updates**: Live build progress with animations and badges
- ✅ **WCAG 2.1 Compliance**: Full accessibility with screen reader support
- ✅ **Counter Component**: Digital Bauhaus design with increment functionality
- ✅ **Deep Linking**: Direct navigation to specific PRDs and stories
- ✅ **agent-browser Testing**: Automated UI testing with Vercel's agent-browser

### Developer Tools & Testing
- ✅ **Test Mode**: CI-compatible agent switching for automated tests
- ✅ **Component Tests**: Jest/Vitest tests for UI components
- ✅ **Integration Tests**: E2E tests with mock agents
- ✅ **Spec Quality**: Integrated Addy Osmani's best practices
- ✅ **LLM-Executable Docs**: Mintlify-standard INSTALL.md

### Reliability & Monitoring
- ✅ **Checkpoint System**: Auto-resume after crashes with state recovery
- ✅ **Watchdog Process**: Auto-recovery for stalled builds
- ✅ **Event Logging**: Errors, warnings, and retry tracking
- ✅ **Status Visibility**: Real-time dashboard widgets
- ✅ **Failure Detection**: TypeScript-based failure analysis
- ✅ **Budget Warnings**: Cost enforcement with configurable limits

### Demo Applications
- ✅ **Wedding Planner**: Guest module with Jest test suite
- ✅ **Wedding Planner UI**: Footer with gradient theme and social links

### Architecture & Performance
- ✅ **TypeScript Executor**: Optional TypeScript-based build execution
- ✅ **BuildStateManager**: Transactional state updates for builds
- ✅ **Story Selection**: Extracted to TypeScript for reliability
- ✅ **Failure Detection**: TypeScript-based failure analysis
- ✅ **Metrics Builder**: Structured metrics collection
- ✅ **Factory Mode**: Meta-orchestration with FSM and verification gates
- ✅ **Authorship Tracking**: Track PRD/plan authorship (human vs AI)
- ✅ **Headless Mode**: Non-interactive execution for UI/automation

---

## Month 1: Stability, Polish & Developer Experience

### Theme: Production-Ready Foundation

**Goal**: Make Ralph reliable enough for daily production use with excellent developer experience.

### 1.1 Core Reliability (Autonomy-Critical)

These features are **essential for unattended operation**. Without them, Ralph requires human supervision.

| Feature | Description | Autonomy Impact | Status |
| ------- | ----------- | --------------- | ------ |
| **Retry & Recovery** | Automatic retry with exponential backoff on agent failures | Handles transient failures | ✅ DONE |
| **Checkpoint System** | Save/restore loop state for resumable builds | **CRITICAL:** Resume after crash/restart | ✅ DONE |
| **Graceful Shutdown** | Handle SIGINT/SIGTERM, save progress, clean up worktrees | **CRITICAL:** Clean state on interrupt | PARTIAL |
| **Watchdog Process** | Monitor builds, restart stalled executions | Recover from hangs | ✅ DONE |
| **Health Checks** | Pre-flight validation of agent availability, git state, disk space | Fail fast, not mid-build | PARTIAL |
| **Heartbeat System** | Periodic health signals, detect unresponsive builds | Identify hung processes | ✅ DONE |

### 1.2 Developer Experience

| Feature                     | Description                                               | Status      |
| --------------------------- | --------------------------------------------------------- | ----------- |
| **`ralph init`**            | Interactive project setup wizard with sensible defaults   | NOT STARTED |
| **`ralph doctor`**          | Diagnose environment issues (agents, permissions, config) | NOT STARTED |
| **`ralph watch`**           | Live-reload development mode with file watching           | NOT STARTED |
| **Improved Error Messages** | Actionable errors with suggested fixes                    | PARTIAL     |
| **Shell Completions**       | Bash/Zsh/Fish autocomplete for all commands               | NOT STARTED |

### 1.3 UI Enhancements

| Feature                         | Description                                         | Status   |
| ------------------------------- | --------------------------------------------------- | -------- |
| **Mobile-Responsive Dashboard** | Access from any device                              | ✅ DONE  |
| **Dark Mode**                   | System preference detection + toggle                | ✅ DONE  |
| **Kanban Board View**           | Visual project status with drag-drop support        | ✅ DONE  |
| **Real-time Status Updates**    | Live build progress with event logging              | ✅ DONE  |
| **Animations & Transitions**    | Smooth UI interactions and loading states           | ✅ DONE  |
| **WCAG 2.1 Accessibility**      | Full compliance with a11y standards                 | ✅ DONE  |
| **RAMS Design System**          | Dieter Rams-inspired minimalist UI                  | ✅ DONE  |
| **Notification System**         | Desktop notifications for build completion/failures | PARTIAL  |
| **Log Search & Filter**         | Full-text search across run history                 | ✅ DONE  |
| **agent-browser Testing**       | Automated UI testing with browser automation        | ✅ DONE  |

### 1.4 Testing & Quality

| Feature                    | Description                                      | Status      |
| -------------------------- | ------------------------------------------------ | ----------- |
| **CI/CD Pipeline**         | GitHub Actions for automated testing             | NOT STARTED |
| **Integration Test Suite** | End-to-end tests with mock agents                | ✅ DONE     |
| **Test Mode Support**      | CI-compatible agent switching and isolation      | ✅ DONE     |
| **Voice E2E Tests**        | Complete voice pipeline testing infrastructure   | ✅ DONE     |
| **Component Testing**      | Jest/Vitest tests for UI components              | ✅ DONE     |
| **Documentation Site**     | Docusaurus site with tutorials and API reference | NOT STARTED |

---

## Month 2: Intelligence & Automation

### Theme: Smarter Autonomous Execution

**Goal**: Make Ralph intelligent enough to optimize its own execution and recover from failures automatically.

### 2.1 Intelligent Agent Selection

| Feature                     | Description                                        | Status      |
| --------------------------- | -------------------------------------------------- | ----------- |
| **Auto-Model Selection**    | Choose optimal model based on task complexity      | ✅ DONE     |
| **Cost-Optimized Routing**  | Use Haiku for simple tasks, Opus for complex       | ✅ DONE     |
| **Customizable Tiers**      | Configure model per complexity tier (low/med/high) | ✅ DONE     |
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
| **Story Dependency Graph**    | Visualize and respect task dependencies         | ✅ DONE     |
| **Critical Path Analysis**    | Optimize execution order for fastest completion | ✅ DONE     |
| **Factory Mode Workflows**    | Declarative multi-stage pipelines with gates    | ✅ DONE     |
| **Verification Gates**        | Tamper-resistant checks (tests, builds, git)    | ✅ DONE     |
| **Risk Assessment**           | Flag high-risk changes for human review         | NOT STARTED |
| **Automatic Story Splitting** | Break large stories into smaller, atomic tasks  | NOT STARTED |

### 2.4 Context Intelligence

| Feature                    | Description                                         | Status      |
| -------------------------- | --------------------------------------------------- | ----------- |
| **Codebase Indexing**      | Build semantic index for better agent context       | PARTIAL     |
| **Cross-Project Learning** | Apply lessons from similar projects                 | ✅ DONE     |
| **Pattern Library**        | Reusable solution patterns from past work           | ✅ DONE     |
| **Guardrails System**      | Project-wide lessons learned and best practices     | ✅ DONE     |
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
| **Budget Policies**         | Team/project budget limits and approvals | ✅ DONE     |
| **Cost Tracking**           | Real-time cost accumulation and warnings | ✅ DONE     |
| **Token Usage Analytics**   | Comprehensive token and cost reporting   | ✅ DONE     |
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
| **Cost Attribution**      | Track costs by project, team, feature    | ✅ DONE     |
| **Build State Tracking**  | Transactional state management for builds| ✅ DONE     |
| **Metrics Builder**       | Structured metrics collection and export | ✅ DONE     |
| **Trend Analysis**        | Week-over-week improvement tracking      | PARTIAL     |
| **Custom Reports**        | Scheduled reports to Slack/email         | NOT STARTED |

---

## Success Metrics

| Metric                | Baseline (Q4 2025) | Current (Jan 2026) | Month 1 Target | Month 2 Target | Month 3 Target |
| --------------------- | ------------------ | ------------------ | -------------- | -------------- | -------------- |
| Story success rate    | ~70%               | ~82%               | 85%            | 92%            | 95%            |
| Mean time to recovery | Manual             | ~1 min (watchdog)  | 30 sec         | 15 sec         | Automatic      |
| Cost per story        | Untracked          | Tracked + Budgeted | Optimized      | Attributed     | Forecasted     |
| Active users          | 1                  | 5                  | 10             | 50             | 200+           |
| UI accessibility      | ~60%               | **100% WCAG 2.1**  | Maintained     | Enhanced       | AAA Compliant  |
| Test coverage         | ~40%               | ~75%               | 85%            | 90%            | 95%            |

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
