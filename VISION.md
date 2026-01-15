# Ralph CLI Vision & Roadmap

> **Ship while you sleep.** Ralph is your tireless AI development partner that autonomously executes features and stories while you focus on what matters most.

---

## The Vision: Autonomous Development at Scale

### The Problem

Modern software development is bottlenecked by human attention. Even with AI coding assistants, developers must:
- Manually break down features into tasks
- Babysit each code generation session
- Context-switch constantly between planning and execution
- Handle failures, retries, and edge cases themselves
- Stay tethered to their terminal during builds

**The result:** Developers become supervisors instead of architects. AI amplifies productivity, but attention remains the constraint.

### The Ralph Solution

Ralph inverts this relationship. Instead of AI assisting humans, **humans guide Ralph, then step away**.

```
┌─────────────────────────────────────────────────────────────────┐
│                    TRADITIONAL AI CODING                        │
│                                                                 │
│   Human ──prompt──> AI ──code──> Human ──review──> AI ──fix──>  │
│                     ↑              ↓                            │
│                     └──────────────┘ (repeat endlessly)         │
│                                                                 │
│   Bottleneck: Human attention at every step                     │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      RALPH WORKFLOW                             │
│                                                                 │
│   Human ──PRD──> Ralph ────────────────────────────> Commits    │
│                    │                                     ↑      │
│                    └──plan──>build──>test──>fix──>commit─┘      │
│                         (autonomous loop, hours/days)           │
│                                                                 │
│   Bottleneck: None. Human attention optional.                   │
└─────────────────────────────────────────────────────────────────┘
```

**Ralph's Promise:** Define what you want built, then go live your life. Return to completed, committed, working code.

---

## Core Philosophy

### 1. Files as Memory, Git as Truth

Ralph stores all state in plain text files (`.ralph/`). No databases, no cloud dependencies, no lock-in.

- **PRDs** define requirements (`prd.md`)
- **Plans** break down work (`plan.md`)
- **Progress** tracks iterations (`progress.md`)
- **Git commits** prove work actually happened

**Why this matters:** You can inspect, version, and restore any state. The system is fully transparent.

### 2. Stateless Iterations

Each build iteration:
1. Reads current state from disk
2. Picks the next story
3. Executes autonomously
4. Commits results
5. Updates progress
6. Starts fresh for next iteration

**Why this matters:** Crashes, timeouts, and interruptions don't corrupt state. Resume from any point.

### 3. Parallel by Design

Multiple PRDs run simultaneously in isolated git worktrees:

```bash
ralph stream build 1 &   # Feature A (background)
ralph stream build 2 &   # Feature B (background)
ralph stream build 3 &   # Feature C (background)
# Go to lunch. Return to 3 features completed.
```

**Why this matters:** Your development velocity scales with compute, not with your availability.

### 4. Self-Healing Execution

Ralph doesn't just run—it recovers:
- **Retry with context:** Failed attempts inform next try
- **Agent switching:** If Claude struggles, try Codex
- **Rollback on failure:** Bad commits are automatically reverted
- **Graceful degradation:** Partial progress is saved

**Why this matters:** Ralph keeps working even when individual operations fail.

---

## Current Capabilities

### What Ralph Does Today

| Capability | Status | Description |
|------------|--------|-------------|
| **PRD Generation** | ✅ Complete | Natural language → structured requirements |
| **Story Planning** | ✅ Complete | PRD → ordered implementation stories |
| **Build Loop** | ✅ Complete | Autonomous iteration through stories |
| **Multi-Agent** | ✅ Complete | Claude, Codex, Droid support |
| **Parallel Streams** | ✅ Complete | Multiple PRDs simultaneously |
| **Git Integration** | ✅ Complete | Auto-commit, auto-branch, worktrees |
| **Cost Optimization** | ✅ Complete | Smart model routing (Haiku/Sonnet/Opus) |
| **Budget Control** | ✅ Complete | Daily/monthly spending limits |
| **Risk Assessment** | ✅ Complete | Flag high-risk changes for review |
| **Retry & Recovery** | ✅ Partial | Automatic retry with enhanced context |
| **Checkpoint/Resume** | ⏳ In Progress | Save and restore loop state |
| **Web Dashboard** | ✅ Complete | Track progress, view logs, manage PRDs |

### The Workflow

```bash
# 1. Define what you want (5 minutes)
ralph prd "Build a user authentication system with OAuth"

# 2. Generate implementation plan (2 minutes)
ralph plan

# 3. Start autonomous execution (then walk away)
ralph build 20

# 4. Return to completed feature
git log  # See all the commits Ralph made
```

---

## Roadmap: The Path to Fully Autonomous Development

### Phase 1: Bulletproof Foundation
**Goal:** Zero-maintenance operation for hours at a time

| Feature | Priority | Impact | Status |
|---------|----------|--------|--------|
| **Complete Checkpoint System** | P0 | Resume after crashes/restarts | 🔄 In Progress |
| **Graceful Shutdown** | P0 | Clean exit on SIGINT/SIGTERM | 🔄 In Progress |
| **Enhanced Error Recovery** | P0 | Auto-fix common failures | ✅ Partial |
| **Watchdog Process** | P1 | Restart stalled builds | 📋 Planned |
| **Health Heartbeats** | P1 | Detect hung processes | 📋 Planned |
| **Notification System** | P1 | Alert on completion/failure | ✅ Partial |

**Success Metric:** Run `ralph build 50` overnight, wake up to working code.

### Phase 2: Intelligent Autonomy
**Goal:** Ralph makes smart decisions without human input

| Feature | Priority | Impact | Status |
|---------|----------|--------|--------|
| **Context-Aware Agent Switching** | P0 | Right agent for each task | 📋 Planned |
| **Smart Story Ordering** | P0 | Dependencies first | ✅ Complete |
| **Automatic Story Splitting** | P1 | Break large stories into smaller ones | 📋 Planned |
| **Cross-Project Learning** | P1 | Apply patterns from past work | 🔄 Partial |
| **Codebase Understanding** | P1 | Deep semantic indexing | 🔄 Partial |
| **Test Generation** | P2 | Auto-create tests for new code | 📋 Planned |

**Success Metric:** Story success rate > 95% without human intervention.

### Phase 3: Scale Without Limits
**Goal:** Run Ralph across teams, projects, and organizations

| Feature | Priority | Impact | Status |
|---------|----------|--------|--------|
| **Ralph Cloud Dashboard** | P0 | Centralized monitoring | 📋 Planned |
| **Team Workspaces** | P0 | Shared PRDs and progress | 📋 Planned |
| **Build Queue** | P1 | Prioritized job scheduling | 📋 Planned |
| **Remote Execution** | P1 | Run on cloud infrastructure | 📋 Planned |
| **Custom Agent Integration** | P1 | Bring your own LLM | 📋 Planned |
| **Audit Logging** | P2 | Enterprise compliance | 📋 Planned |
| **Role-Based Access** | P2 | Admin/Developer/Viewer roles | 📋 Planned |

**Success Metric:** Teams running 100+ concurrent streams across projects.

---

## Use Cases: When to Use Ralph

### Perfect For

| Scenario | Example | Why Ralph Excels |
|----------|---------|------------------|
| **Feature Implementation** | "Add user settings page" | Complete PRD → code pipeline |
| **Bug Fixes** | "Fix all TypeScript errors" | Iterative, testable work |
| **Refactoring** | "Migrate to new API format" | Systematic file-by-file changes |
| **Documentation** | "Add JSDoc to all exports" | Repetitive, well-defined tasks |
| **Testing** | "Increase coverage to 80%" | Generate tests story-by-story |
| **Overnight Development** | Large feature while you sleep | Autonomous execution |
| **Parallel Features** | Multiple PRDs simultaneously | Stream isolation |

### Not Ideal For

| Scenario | Better Approach |
|----------|-----------------|
| Quick one-liner fixes | Direct AI chat |
| Exploratory prototyping | Interactive development |
| Highly ambiguous requirements | Clarify first, then Ralph |
| Security-critical code | Human review required |

---

## Architecture Principles

### 1. Offline-First
Ralph works without internet for core operations. Only agent API calls require connectivity.

### 2. No Lock-In
- State is plain Markdown
- Git is the database
- Switch agents anytime
- No proprietary formats

### 3. Incremental Adoption
```bash
# Start simple
ralph prd "Add dark mode"
ralph build 5

# Scale up gradually
ralph stream build 1 & ralph stream build 2 &

# Eventually run CI/CD
ralph build --ci --headless
```

### 4. Transparent Operations
Every decision Ralph makes is logged:
- Why a story was selected
- Which agent handled it
- What commands were run
- Why something failed
- What the fix attempt was

---

## Metrics & Goals

### Current Performance (Baseline)

| Metric | Current State |
|--------|---------------|
| Story success rate | ~75% |
| Mean time to recovery | Manual intervention |
| Cost per story | ~$0.50-2.00 |
| Max unattended runtime | ~1-2 hours |
| Parallel streams | 3-4 stable |

### Target Performance (6 months)

| Metric | Target | How |
|--------|--------|-----|
| Story success rate | **95%** | Enhanced retry, agent switching |
| Mean time to recovery | **< 30 seconds** | Automatic checkpoint/resume |
| Cost per story | **$0.20-0.80** | Smart model routing |
| Max unattended runtime | **24+ hours** | Watchdog, heartbeats |
| Parallel streams | **10+ stable** | Improved isolation |

### Target Performance (12 months)

| Metric | Target | How |
|--------|--------|-----|
| Story success rate | **98%** | Cross-project learning |
| Mean time to recovery | **Automatic** | Self-healing loop |
| Cost per story | **$0.10-0.50** | Pattern caching |
| Max unattended runtime | **Unlimited** | Cloud infrastructure |
| Parallel streams | **50+** | Distributed execution |

---

## Getting Started Today

### Quick Start (5 minutes)

```bash
# Install Ralph
curl -fsSL https://raw.githubusercontent.com/AskTinNguyen/ralph-cli/main/install.sh | bash

# Navigate to your project
cd my-project

# Install Ralph locally
ralph install

# Create your first PRD
ralph prd "Build a REST API for user management"

# Generate implementation plan
ralph plan

# Start autonomous development (then go do something else)
ralph build 10
```

### Recommended Workflow

1. **Morning:** Define PRDs for the day's features
2. **Midday:** Start builds, go to meetings
3. **Evening:** Review completed work, merge PRs
4. **Overnight:** Run larger features with `ralph build 50`

### Best Practices

- **Start small:** 5-10 iteration runs until you trust the system
- **Define clear acceptance criteria:** Better PRDs = better results
- **Use streams for isolation:** Parallel work without conflicts
- **Set budget limits:** `RALPH_BUDGET_DAILY=25.00`
- **Review before merge:** Trust but verify

---

## Contributing to the Vision

### Priority Areas

1. **Reliability** - Improve checkpoint/resume system
2. **Intelligence** - Better agent switching logic
3. **Documentation** - Tutorials and examples
4. **Integrations** - New agent adapters (Gemini, local LLMs)
5. **Enterprise** - Team features, audit logging

### How to Contribute

1. Check `.ralph/` for existing PRDs with open stories
2. Run `ralph stream status` to see what's in progress
3. Pick an unclaimed story or create a new PRD
4. Submit PR with your changes

---

## The Future We're Building

Imagine a world where:

- **Feature requests become features overnight** — Define requirements before bed, wake up to pull requests
- **Technical debt gets cleaned automatically** — Ralph refactors during off-hours
- **Test coverage improves continuously** — Autonomous test generation fills gaps
- **Documentation stays current** — Changes trigger doc updates
- **Multiple features ship in parallel** — Limited only by compute, not attention

**Ralph is the tireless team member who never sleeps, never gets distracted, and never loses context.**

---

## Summary

| Aspect | Ralph's Approach |
|--------|------------------|
| **State** | Files on disk, Git commits |
| **Execution** | Stateless iterations |
| **Reliability** | Self-healing, checkpoint/resume |
| **Scaling** | Parallel streams, worktrees |
| **Intelligence** | Multi-agent, smart routing |
| **Control** | Budget limits, risk flags |

**One command to ship features while you focus on what matters:**

```bash
ralph build 20 && echo "Going to lunch"
```

---

*Ralph CLI is open source under MIT license. Built by developers who believe AI should do the work while humans do the thinking.*
