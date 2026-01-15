# Using ue-agent with Ralph CLI

## Overview

Ralph CLI follows: **PRD → Plan → Build**

ue-agent integrates by:
1. Triggering automatically when Ralph detects UE-related tasks
2. Orchestrating 5 sub-agents during the Build phase
3. Following Ralph's commit and progress logging conventions

---

## Quick Start

```bash
# 1. In your UE game project, install ralph
ralph install

# 2. Create a UE-specific PRD
ralph prd "Fix crash in inventory system when player picks up null item"

# 3. Generate the plan
ralph plan

# 4. Run the build loop (ue-agent auto-triggers)
ralph build 5
```

---

## Setup: AGENTS.md for Unreal Projects

Create `.agents/AGENTS.md` in your UE project:

```markdown
# Unreal Engine Project Agent Configuration

## Engine Reference
- **Engine Path:** Set `UE_ROOT` environment variable or specify here
- **Engine Version:** 5.7.1 (custom)
- **Engine Source:** READ-ONLY reference only

## Project Info
- **Target:** MyGameEditor
- **Platform:** Win64
- **Configuration:** Development

## Build Commands

### Compile (No Cook)
```bash
"%UE_ROOT%/Build/BatchFiles/Build.bat" MyGameEditor Win64 Development -Project="%cd%/MyGame.uproject"
```

### Run Tests
```bash
"%UE_ROOT%/Binaries/Win64/UnrealEditor-Cmd.exe" "%cd%/MyGame.uproject" -ExecCmds="Automation RunTests MyGame;Quit" -unattended -NullRHI
```

## Skills Required
- **ue-agent** - For all UE implementation tasks (auto-triggers on UE patterns)
- **commit** - For conventional commits

## Coding Standards
Follow Epic's Unreal Engine coding standards:
- PascalCase for types and functions
- Prefixes: A (Actor), U (UObject), F (struct), E (enum), I (interface)
- UPROPERTY/UFUNCTION for reflection

## Constraints
- NEVER modify engine source (anything under UE_ROOT)
- All changes must be in project Source/ or Plugins/
- Run tests after every implementation
```

---

## Command Reference

| Command | Description |
|---------|-------------|
| `ralph prd "description"` | Create PRD in `.ralph/PRD-N/prd.md` |
| `ralph plan` | Generate plan from latest PRD |
| `ralph plan --prd=N` | Generate plan for specific PRD |
| `ralph build M` | Run M iterations on latest PRD |
| `ralph build M --prd=N` | Run M iterations on PRD-N |
| `ralph build M --no-commit` | Dry run without commits |
| `ralph build M --resume` | Resume from checkpoint |
| `ralph stream init N` | Create worktree for PRD-N |
| `ralph stream build N M` | Run M iterations on PRD-N in worktree |
| `ralph stream merge N` | Merge PRD-N worktree to main |
| `ralph stream status` | Show all stream statuses |

---

## The Build Flow with ue-agent

```
ralph build 5
    │
    ▼
┌─────────────────────────────────────────┐
│ Loop reads PRD, finds next [ ] story    │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│ Agent detects UE patterns → ue-agent    │
└─────────────────────────────────────────┘
    │
    ├──▶ [1] EXPLORER    → Context artifacts
    ├──▶ [2] ARCHITECT   → Implementation plan
    ├──▶ [3] IMPLEMENTER → Code changes
    ├──▶ [4] VALIDATOR   → Build + test results
    └──▶ [5] UNITTEST    → Generated tests
    │
    ▼
┌─────────────────────────────────────────┐
│ Update PRD [x], commit, log progress    │
│ Loop continues to next story            │
└─────────────────────────────────────────┘
```

---

## PRD Format for UE Tasks

```markdown
# PRD: Feature Name

## Overview
What we're building and why.

## User Stories

### [ ] US-001: Story title
**As a** user/developer
**I want** feature
**So that** benefit

#### Acceptance Criteria
- [ ] Criterion with UE-specific details
- [ ] Compile passes
- [ ] All tests pass
```

---

## Parallel Streams

Run multiple features simultaneously using worktrees:

```bash
# Create PRDs
ralph prd "Feature A"    # Creates PRD-1
ralph prd "Feature B"    # Creates PRD-2

# Init worktrees (isolated git branches)
ralph stream init 1      # Creates .ralph/worktrees/PRD-1/
ralph stream init 2      # Creates .ralph/worktrees/PRD-2/

# Run in parallel
ralph stream build 1 5 &  # PRD-1 with 5 iterations
ralph stream build 2 5 &  # PRD-2 with 5 iterations
wait

# Merge completed work
ralph stream merge 1
ralph stream merge 2
```

---

## How ue-agent Triggers

| Trigger | Example |
|---------|---------|
| `.uproject` file | `MyGame.uproject` |
| UPROPERTY/UFUNCTION | `UPROPERTY(EditAnywhere)` |
| UE class patterns | `class MYGAME_API AMyActor` |
| Engine API references | `Super::BeginPlay()` |
| UBT in AGENTS.md | `Build.bat` |

---

## Troubleshooting

### ue-agent Not Triggering
1. Verify `.uproject` exists
2. Check AGENTS.md has UE patterns
3. Ensure story mentions UE concepts

### Build Failing
1. Check `UE_ROOT` is set
2. Verify Build.bat path
3. Look at Validator errors

### Human Checkpoint
After 3 failures, ue-agent pauses:
1. Provide guidance and retry
2. Manually fix and resume
3. Abort and investigate

---

## Integration Checklist

- [ ] `ralph install` completed
- [ ] `.agents/AGENTS.md` created
- [ ] `UE_ROOT` environment variable set
- [ ] Build commands tested manually
- [ ] First PRD created
- [ ] Plan reviewed before build
